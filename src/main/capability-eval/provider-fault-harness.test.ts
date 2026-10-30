import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CapabilityAgentBroker } from '../capabilities/agent-tools'
import type { CapabilityCallerContext } from '../../shared/capability-broker'
import {
  CAPABILITY_EVAL_FAULT_POLICY_ENV,
  CAPABILITY_EVAL_FAULT_MATCH_LOG_ENV,
  CapabilityEvalProviderFaultError,
  createCapabilityEvalFaultBroker,
  parseCapabilityEvalFaultPolicy,
  readCapabilityEvalFaultPolicy,
  scopeCapabilityEvalFaultPolicy
} from './provider-fault-harness'

describe('capability eval provider fault harness', () => {
  it('injects only the configured attempts and then delegates to the real broker', async () => {
    const invoke = vi.fn(async () => ({
      actionId: 'paper-radar.search',
      output: { resultCount: 1 },
      changed: false,
      replayed: false,
      completedAt: '2026-09-17T00:00:00.000Z'
    }))
    const broker = stubBroker({ invoke })
    const wrapped = createCapabilityEvalFaultBroker(broker, parseCapabilityEvalFaultPolicy({
      rules: [{
        actionId: 'paper-radar.search',
        inputContains: 'AlphaFold',
        failures: 1,
        errorCode: 'timeout'
      }]
    }))
    const caller = testCaller('codex:thread-1')
    const request = {
      actionId: 'paper-radar.search',
      input: { query: 'AlphaFold 3' }
    } as const

    await expect(wrapped.invoke(caller, request)).rejects.toMatchObject({
      code: 'timeout',
      failureClass: 'provider',
      retryable: true,
      providerStage: 'provider',
      details: { attempt: 1 }
    })
    await expect(wrapped.invoke(caller, request)).resolves.toMatchObject({ actionId: 'paper-radar.search' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('keeps persistent faults scoped to the caller and input match', async () => {
    const invoke = vi.fn(async () => ({
      actionId: 'paper-radar.search',
      output: {},
      changed: false,
      replayed: false,
      completedAt: '2026-09-17T00:00:00.000Z'
    }))
    const wrapped = createCapabilityEvalFaultBroker(
      stubBroker({ invoke }),
      parseCapabilityEvalFaultPolicy({
        rules: [{
          actionId: 'paper-radar.search',
          inputContains: 'controlled-source',
          failures: 'always',
          errorCode: 'provider_unavailable',
          retryable: false
        }]
      })
    )
    const request = {
      actionId: 'paper-radar.search',
      input: { query: 'controlled-source' }
    } as const

    await expect(wrapped.invoke(testCaller('thread-a'), request)).rejects.toMatchObject({
      code: 'provider_unavailable',
      retryable: false,
      details: { attempt: 1 }
    })
    await expect(wrapped.invoke(testCaller('thread-a'), request)).rejects.toMatchObject({
      code: 'provider_unavailable',
      details: { attempt: 2 }
    })
    await expect(wrapped.invoke(testCaller('thread-b'), request)).rejects.toMatchObject({
      code: 'provider_unavailable',
      details: { attempt: 1 }
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('injects faults on the Host-authenticated ordinary Session route', async () => {
    const invokeOrdinarySession = vi.fn(async () => ({
      actionId: 'paper-radar.search',
      output: { resultCount: 1 },
      changed: false,
      replayed: false,
      completedAt: '2026-09-17T00:00:00.000Z'
    }))
    const wrapped = createCapabilityEvalFaultBroker(
      stubBroker({ invokeOrdinarySession }),
      parseCapabilityEvalFaultPolicy({
        rules: [{
          actionId: 'paper-radar.search',
          failures: 1,
          errorCode: 'timeout'
        }]
      })
    )
    const request = {
      actionId: 'paper-radar.search',
      input: { query: 'ordinary-session' }
    } as const

    await expect(wrapped.invokeOrdinarySession?.(
      testCaller('codex:thread-ordinary'),
      request,
      { runtimeId: 'codex', threadId: 'thread-ordinary' }
    )).rejects.toMatchObject({
      code: 'timeout',
      details: { attempt: 1 }
    })
    await expect(wrapped.invokeOrdinarySession?.(
      testCaller('codex:thread-ordinary'),
      request,
      { runtimeId: 'codex', threadId: 'thread-ordinary' }
    )).resolves.toMatchObject({ actionId: 'paper-radar.search' })
    expect(invokeOrdinarySession).toHaveBeenCalledTimes(1)
  })

  it('does not wrap the broker when no policy is supplied', () => {
    const broker = stubBroker()
    expect(createCapabilityEvalFaultBroker(broker, undefined)).toBe(broker)
  })

  it('requires case scope before a policy can be used by a live case', () => {
    const policy = parseCapabilityEvalFaultPolicy({
      rules: [
        { caseId: 'case-a', actionId: 'paper-radar.search', failures: 'always', errorCode: 'timeout' },
        { caseId: 'case-b', actionId: 'paper-radar.search', failures: 1, errorCode: 'provider_unavailable' }
      ]
    })
    expect(scopeCapabilityEvalFaultPolicy(policy, 'case-a').rules).toHaveLength(1)
    expect(scopeCapabilityEvalFaultPolicy(policy, 'case-a').rules[0]?.caseId).toBe('case-a')
    expect(scopeCapabilityEvalFaultPolicy(policy, 'case-unmatched').rules).toHaveLength(0)
    expect(() => scopeCapabilityEvalFaultPolicy(parseCapabilityEvalFaultPolicy({
      rules: [{ actionId: 'paper-radar.search', failures: 1, errorCode: 'timeout' }]
    }), 'case-a')).toThrow(/declare caseId/iu)
  })

  it('persists matched and injected fault attempts for case evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sciforge-fault-harness-test-'))
    const logPath = join(directory, 'faults.jsonl')
    vi.stubEnv(CAPABILITY_EVAL_FAULT_MATCH_LOG_ENV, logPath)
    try {
      const broker = stubBroker()
      const wrapped = createCapabilityEvalFaultBroker(broker, parseCapabilityEvalFaultPolicy({
        rules: [{
          id: 'rule-1',
          caseId: 'case-a',
          actionId: 'paper-radar.search',
          failures: 1,
          errorCode: 'timeout'
        }]
      }))
      const request = { actionId: 'paper-radar.search', input: { query: 'case-a' } } as const
      await expect(wrapped.invoke(testCaller('thread-a'), request)).rejects.toMatchObject({ code: 'timeout' })
      await expect(wrapped.invoke(testCaller('thread-a'), request)).resolves.toMatchObject({ actionId: 'paper-radar.search' })
      const matches = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
      expect(matches).toEqual([
        expect.objectContaining({ ruleId: 'rule-1', caseId: 'case-a', attempt: 1, injected: true }),
        expect.objectContaining({ ruleId: 'rule-1', caseId: 'case-a', attempt: 2, injected: false })
      ])
    } finally {
      vi.unstubAllEnvs()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('parses explicit environment policy and rejects invalid policy', () => {
    const policy = readCapabilityEvalFaultPolicy({
      [CAPABILITY_EVAL_FAULT_POLICY_ENV]: JSON.stringify({
        rules: [{ actionId: 'paper-radar.search', failures: 1, errorCode: 'timeout' }]
      })
    })
    expect(policy?.rules).toEqual([{
      actionId: 'paper-radar.search',
      failures: 1,
      errorCode: 'timeout'
    }])
    expect(() => parseCapabilityEvalFaultPolicy({ rules: [{ actionId: 'paper-radar.search', failures: 0, errorCode: 'timeout' }] }))
      .toThrow(/failures must be/u)
    expect(new CapabilityEvalProviderFaultError({
      actionId: 'paper-radar.search',
      errorCode: 'timeout',
      attempt: 1
    })).toBeInstanceOf(Error)
  })
})

function stubBroker(overrides: Partial<CapabilityAgentBroker> = {}): CapabilityAgentBroker {
  const broker = {
    discover: vi.fn(async () => []),
    observe: vi.fn(async () => ({ state: {}, semanticRevision: 'revision-1', operationIds: [] })),
    bindResourceRef: vi.fn(async () => ({ token: 'resource-1', resourceId: 'resource-1', resourceKind: 'fixture', semanticRevision: 'revision-1' })),
    describeResourceHandle: vi.fn(async () => ({ resourceRef: 'resource-1', resourceKind: 'fixture', semanticRevision: 'revision-1' })),
    invoke: vi.fn(async () => ({
      actionId: 'paper-radar.search',
      output: {},
      changed: false,
      replayed: false,
      completedAt: '2026-09-17T00:00:00.000Z'
    })),
    listEvents: vi.fn(async () => []),
    ...overrides
  }
  return broker as unknown as CapabilityAgentBroker
}

function testCaller(callerId: string): CapabilityCallerContext {
  return { audience: 'agent', callerId, approvals: [] }
}

import { describe, expect, it } from 'vitest'
import type { CapabilityJsonValue } from '../../shared/capability-broker'
import { evaluateCase, evaluateDiscovery } from './evaluators'
import { evalCaseSchema, type EvalTrace } from './schema'

const trace = (overrides: Partial<EvalTrace> = {}): EvalTrace => ({
  discoveredActions: ['paper-radar.search'],
  selectedActions: [{
    actionId: 'paper-radar.search',
    args: { query: 'AlphaFold 3' },
    success: true,
    retryCount: 0,
    latencyMs: 10,
    sequence: 2
  }],
  invocations: [{
    actionId: 'paper-radar.search',
    args: { query: 'AlphaFold 3' },
    success: true,
    retryCount: 0,
    latencyMs: 10,
    sequence: 2
  }],
  authorizationEvents: [],
  toolCalls: 1,
  retryCount: 0,
  latencyMs: 10,
  taskSuccess: true,
  ...overrides
})

function evalCase(expected: Record<string, unknown>) {
  return evalCaseSchema.parse({
    id: 'paper-search',
    query: 'Search Paper Radar',
    expected: {
      domain: 'paper-radar',
      mustDiscover: ['paper-radar.search'],
      requiredActions: ['paper-radar.search'],
      allowedActions: ['paper-radar.search'],
      ...expected
    }
  })
}

describe('capability evaluators', () => {
  it('passes a correct action, discovery, arguments, and task', () => {
    const result = evaluateCase(evalCase({
      authorization: { 'paper-radar.search': 'allow' },
      invocation: { 'paper-radar.search': { success: true } },
      arguments: {
        'paper-radar.search': {
          required: ['query'],
          types: { query: 'string' },
          values: { query: 'AlphaFold 3' }
        }
      },
      taskSuccess: true
    }), { trace: trace() })
    expect(result.passed).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('fails on wrong action and missing required action', () => {
    const wrong = trace({
      domain: 'scientific-compute',
      selectedActions: [{
        actionId: 'scientific-compute.status',
        args: {},
        success: true,
        retryCount: 0,
        latencyMs: 1
      }],
      invocations: [{
        actionId: 'scientific-compute.status',
        args: {},
        success: true,
        retryCount: 0,
        latencyMs: 1
      }]
    })
    const result = evaluateCase(evalCase({
      authorization: { 'paper-radar.search': 'allow' },
      invocation: { 'paper-radar.search': { success: true } }
    }), { trace: wrong })
    expect(result.passed).toBe(false)
    expect(result.failures.map((failure) => failure.type)).toEqual(expect.arrayContaining([
      'wrong_domain',
      'wrong_action',
      'invocation_missing'
    ]))
  })

  it('fails when a forbidden action is called', () => {
    const forbidden: EvalTrace = trace({
      selectedActions: [{
        actionId: 'paper-radar.sync-arxiv',
        args: {},
        success: false,
        errorCode: 'approval_denied',
        retryCount: 0,
        latencyMs: 1
      }],
      invocations: [{
        actionId: 'paper-radar.sync-arxiv',
        args: {},
        success: false,
        errorCode: 'approval_denied',
        retryCount: 0,
        latencyMs: 1
      }]
    })
    const result = evaluateCase(evalCase({
      requiredActions: [],
      allowedActions: ['paper-radar.search'],
      forbiddenActions: ['paper-radar.sync-arxiv'],
      authorization: { 'paper-radar.sync-arxiv': 'deny' },
      invocation: { 'paper-radar.sync-arxiv': { success: false, errorCode: 'approval_denied' } },
      taskSuccess: false
    }), { trace: forbidden })
    expect(result.failures.map((failure) => failure.type)).toContain('forbidden_action')
  })

  it('calculates discovery recall without penalizing extra discovered actions', () => {
    const result = evaluateDiscovery(evalCase({
      mustDiscover: ['paper-radar.search', 'paper-radar.rank']
    }), trace({ discoveredActions: ['paper-radar.search', 'paper-radar.rank', 'paper-radar.digest'] }))
    expect(result.score).toBe(1)
    expect(result.failures).toEqual([])
  })

  it('detects authorization mismatch and invocation failure', () => {
    const result = evaluateCase(evalCase({
      authorization: { 'paper-radar.search': 'confirmation' },
      invocation: { 'paper-radar.search': { success: false, errorCode: 'provider_unavailable' } },
      taskSuccess: false
    }), { trace: trace({
      invocations: [{
        actionId: 'paper-radar.search',
        args: { query: 'AlphaFold 3' },
        success: false,
        errorCode: 'provider_unavailable',
        retryCount: 1,
        latencyMs: 30
      }],
      selectedActions: [{
        actionId: 'paper-radar.search',
        args: { query: 'AlphaFold 3' },
        success: false,
        errorCode: 'provider_unavailable',
        retryCount: 1,
        latencyMs: 30
      }],
      retryCount: 1,
      latencyMs: 30,
      taskSuccess: false
    }) })
    expect(result.failures.map((failure) => failure.type)).toContain('authorization_mismatch')
    expect(result.scores.invocation).toBe(1)
  })

  it('checks nested final-state values with deterministic rubric support', () => {
    const result = evaluateCase(evalCase({
      requiredActions: [],
      allowedActions: [],
      taskSuccess: true
    }), {
      trace: trace({
        discoveredActions: [],
        selectedActions: [],
        invocations: [],
        finalState: { artifact: { path: 'result.csv', rows: 4 } } as CapabilityJsonValue
      })
    })
    const withAssertions = evalCaseSchema.parse({
      ...evalCase({ requiredActions: [], allowedActions: [], taskSuccess: true }),
      expectedFinalState: { assertions: [{ path: 'artifact.rows', operator: 'equals', value: 4 }] },
      rubric: [{
        id: 'row-count',
        description: 'At least four rows',
        type: 'deterministic',
        weight: 1,
        assertion: { path: 'artifact.rows', operator: 'equals', value: 4 }
      }]
    })
    const asserted = evaluateCase(withAssertions, {
      trace: trace({
        discoveredActions: [],
        selectedActions: [],
        invocations: [],
        finalState: { artifact: { path: 'result.csv', rows: 4 } } as CapabilityJsonValue
      })
    })
    expect(result.scores.finalState).toBe(1)
    expect(asserted.scores.finalState).toBe(1)
    expect(asserted.scores.rubric).toBe(1)
  })

  it('reports unsupported LLM rubrics without treating them as a scored pass', () => {
    const unsupported = evalCaseSchema.parse({
      ...evalCase({ requiredActions: [], allowedActions: [], taskSuccess: true }),
      rubric: [{
        id: 'quality-judge',
        description: 'Judge the quality of the result',
        type: 'llm_judge',
        weight: 1
      }]
    })
    const result = evaluateCase(unsupported, { trace: trace() })
    expect(result.passed).toBe(true)
    expect(result.rubric).toMatchObject([{ id: 'quality-judge', status: 'unsupported', score: 0 }])
    expect(result.scores.rubric).toBe(0)
  })
})

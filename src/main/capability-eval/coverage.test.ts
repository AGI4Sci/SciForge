import { describe, expect, it } from 'vitest'
import { createCapabilityCoverageReport } from './coverage'
import { parseCapabilityReferenceMarkdown } from './reference'
import { createDeterministicSimulationExecutor, runEvalCases } from './runner'
import { evalCaseSchema } from './schema'

const reference = parseCapabilityReferenceMarkdown([
  '| Action ID | Version | Audiences | Effect | Approval | Scope |',
  '| --- | --- | --- | --- | --- | --- |',
  '| `paper-radar.search` | 1.0.0 | agent | read | none | global |',
  '| `paper-radar.sync-arxiv` | 1.0.0 | agent | external-write | confirmation | global |',
  '| `scientific-compute.status` | 1.0.0 | agent | read | none | global |'
].join('\n'))

describe('capability coverage', () => {
  it('separates references, positive design and observed execution', async () => {
    const cases = [
      evalCaseSchema.parse({
        id: 'search',
        query: 'Search papers',
        tags: ['paper-radar', 'happy-path'],
        expected: {
          domain: 'paper-radar',
          mustDiscover: ['paper-radar.search'],
          requiredActions: ['paper-radar.search'],
          allowedActions: ['paper-radar.search'],
          authorization: { 'paper-radar.search': 'allow' },
          invocation: { 'paper-radar.search': { success: true } },
          taskSuccess: true
        },
        simulation: {
          discoveries: [{ actions: ['paper-radar.search'] }],
          calls: [{ actionId: 'paper-radar.search', outcome: 'success' }],
          taskSuccess: true
        }
      }),
      evalCaseSchema.parse({
        id: 'sync-approval',
        query: 'Sync papers',
        tags: ['authorization'],
        expected: {
          domain: 'paper-radar',
          mustDiscover: ['paper-radar.sync-arxiv'],
          requiredActions: ['paper-radar.sync-arxiv'],
          allowedActions: ['paper-radar.sync-arxiv'],
          authorization: { 'paper-radar.sync-arxiv': 'confirmation' },
          invocation: { 'paper-radar.sync-arxiv': { success: true } },
          taskSuccess: true
        },
        simulation: {
          discoveries: [{ actions: ['paper-radar.sync-arxiv'] }],
          authorizationEvents: [{ actionId: 'paper-radar.sync-arxiv', status: 'requested' }],
          calls: [{ actionId: 'paper-radar.sync-arxiv', outcome: 'success' }],
          taskSuccess: true
        }
      }),
      evalCaseSchema.parse({
        id: 'forbidden-only',
        query: 'Do not sync papers',
        tags: ['no-call'],
        expected: {
          domain: 'paper-radar',
          forbiddenActions: ['scientific-compute.status'],
          noCapabilityCalls: true,
          taskSuccess: true
        },
        simulation: {
          discoveries: [],
          calls: [],
          taskSuccess: true
        }
      })
    ]
    const results = await runEvalCases(cases, createDeterministicSimulationExecutor(reference))
    const report = createCapabilityCoverageReport(cases, reference, {
      generatedAt: '2026-01-01T00:00:00.000Z',
      executionMode: 'deterministic-simulation',
      results
    })
    expect(report.referencedActions).toBe(3)
    expect(report.positiveDesignedActions).toBe(2)
    expect(report.invokedActions).toBe(2)
    expect(report.invocationSucceededActions).toBe(2)
    expect(report.outcomeVerifiedActions).toBe(0)
    expect(report.coveredDomains).toBe(2)
    expect(report.caseTypeCounts.authorization).toBe(1)
    expect(report.caseTypeCounts.happyPath).toBe(1)
    expect(report.confirmationWithoutAuthorizationCoverage).toEqual([])
    expect(report.unreferencedActions).toEqual([])
    expect(report.noPositiveTaskActions).toEqual(['scientific-compute.status'])
    expect(report.actions.find((action) => action.actionId === 'scientific-compute.status')?.referencedCaseCount).toBe(1)
    expect(report.actions.find((action) => action.actionId === 'scientific-compute.status')?.positiveDesignedCaseCount).toBe(0)
    expect(report.actions.find((action) => action.actionId === 'paper-radar.sync-arxiv')?.dimensions.authorization).toBe(true)
  })

  it('requires independent action evidence for outcome coverage', async () => {
    const evalCase = evalCaseSchema.parse({
      id: 'verified-output',
      query: 'Create and verify a result',
      expected: {
        requiredActions: ['paper-radar.search'],
        invocation: { 'paper-radar.search': { success: true } }
      },
      expectedFinalState: { assertions: [] },
      simulation: {
        discoveries: [{ actions: ['paper-radar.search'] }],
        calls: [{ actionId: 'paper-radar.search', outcome: 'success' }],
        taskSuccess: true
      }
    })
    const [result] = await runEvalCases([evalCase], createDeterministicSimulationExecutor(reference))
    expect(result).toBeDefined()

    const receiptOnly = createCapabilityCoverageReport([evalCase], reference, { results: [result] })
    expect(receiptOnly.actions.find((action) => action.actionId === 'paper-radar.search')?.invocationSucceededCaseCount).toBe(1)
    expect(receiptOnly.actions.find((action) => action.actionId === 'paper-radar.search')?.outcomeVerifiedCaseCount).toBe(0)

    const independentlyVerified = {
      ...result,
      actual: { ...result.actual, finalStateSource: 'inspector' as const, verifiedActionIds: ['paper-radar.search'] }
    }
    const verified = createCapabilityCoverageReport([evalCase], reference, { results: [independentlyVerified] })
    expect(verified.actions.find((action) => action.actionId === 'paper-radar.search')?.outcomeVerifiedCaseCount).toBe(1)
  })

  it('rejects contradictory positive, alternative and no-call contracts', () => {
    expect(() => evalCaseSchema.parse({
      id: 'contradictory-contract',
      query: 'invalid contract',
      expected: {
        requiredActions: ['paper-radar.search'],
        alternativeActionGroups: [['paper-radar.rank']],
        allowedActions: ['paper-radar.search'],
        forbiddenActions: ['paper-radar.search'],
        noCapabilityCalls: true
      }
    })).toThrow(/cannot also be forbidden|no-capability-call|must be included in allowedActions/)
  })

  it('requires a recorded provider-fault hit before counting a controlled boundary', async () => {
    const evalCase = evalCaseSchema.parse({
      id: 'fault-boundary',
      query: 'Report a controlled provider failure',
      tags: ['expected-failure', 'requires-provider-fault'],
      expected: {
        requiredActions: ['paper-radar.search'],
        invocation: { 'paper-radar.search': { success: false, errorCode: 'provider_unavailable' } },
        taskSuccess: false
      },
      expectedFailure: {
        actionId: 'paper-radar.search',
        errorCode: 'provider_unavailable',
        handling: 'reported'
      },
      simulation: {
        calls: [{ actionId: 'paper-radar.search', outcome: 'failure', errorCode: 'provider_unavailable' }],
        taskSuccess: false
      }
    })
    const [result] = await runEvalCases([evalCase], createDeterministicSimulationExecutor(reference))
    expect(result?.outcome).toBe('PASS')
    const withoutHit = createCapabilityCoverageReport([evalCase], reference, { results: [result!] })
    expect(withoutHit.boundaryVerifiedActions).toBe(0)

    const withHit = createCapabilityCoverageReport([evalCase], reference, {
      results: [{
        ...result!,
        actual: {
          ...result!.actual,
          faultMatches: [{
            caseId: evalCase.id,
            actionId: 'paper-radar.search',
            callerId: 'codex:thread-1',
            attempt: 1,
            injected: true,
            errorCode: 'provider_unavailable'
          }]
        }
      }]
    })
    expect(withHit.boundaryVerifiedActions).toBe(1)
  })
})

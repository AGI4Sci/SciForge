import { describe, expect, it } from 'vitest'
import { createCapabilityCoverageReport } from './coverage'
import { parseCapabilityReferenceMarkdown } from './reference'
import { evalCaseSchema } from './schema'

const reference = parseCapabilityReferenceMarkdown([
  '| Action ID | Version | Audiences | Effect | Approval | Scope |',
  '| --- | --- | --- | --- | --- | --- |',
  '| `paper-radar.search` | 1.0.0 | agent | read | none | global |',
  '| `paper-radar.sync-arxiv` | 1.0.0 | agent | external-write | confirmation | global |',
  '| `scientific-compute.status` | 1.0.0 | agent | read | none | global |'
].join('\n'))

describe('capability coverage', () => {
  it('reports covered dimensions and registry gaps', () => {
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
      })
    ]
    const report = createCapabilityCoverageReport(cases, reference, { generatedAt: '2026-01-01T00:00:00.000Z' })
    expect(report.coveredActions).toBe(2)
    expect(report.coveredDomains).toBe(1)
    expect(report.caseTypeCounts.authorization).toBe(1)
    expect(report.caseTypeCounts.happyPath).toBe(1)
    expect(report.noAuthorizationCoverage).toEqual([])
    expect(report.uncoveredActions).toEqual(['scientific-compute.status'])
    expect(report.actions.find((action) => action.actionId === 'paper-radar.sync-arxiv')?.dimensions.authorization).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import {
  createAggregateReport,
  createSelfTestReport,
  renderSelfTestHtmlReport,
  terminalSelfTestSummary,
  terminalSummary
} from './report'
import type { EvalCaseResult } from './schema'

function result(input: Partial<EvalCaseResult> = {}): EvalCaseResult {
  return {
    caseId: 'case-1',
    query: 'test',
    tags: [],
    passed: true,
    domain: 'paper-radar',
    scores: {
      routing: 1, discovery: 1, selection: 1, arguments: 1, authorization: 1,
      invocation: 1, taskSuccess: 1, finalState: 1, rubric: 1
    },
    metrics: { toolCalls: 2, retryCount: 1, latencyMs: 100 },
    discoveredActions: ['paper-radar.search'],
    selectedActions: ['paper-radar.search'],
    invocations: [{ actionId: 'paper-radar.search', args: {}, success: true, retryCount: 1, latencyMs: 100 }],
    authorizationEvents: [],
    expected: {
      mustDiscover: [], requiredActions: [], allowedActions: [], forbiddenActions: [],
      authorization: {}, invocation: {}, arguments: {}
    },
    actual: {
      domain: 'paper-radar', discoveredActions: ['paper-radar.search'], selectedActions: [],
      invocations: [{ actionId: 'paper-radar.search', args: {}, success: true, retryCount: 1, latencyMs: 100 }],
      authorizationEvents: [], toolCalls: 2, retryCount: 1, latencyMs: 100, taskSuccess: true
    },
    rubric: [],
    failures: [],
    ...input
  }
}

describe('capability aggregate report', () => {
  it('calculates case and invocation metrics and lists failures', () => {
    const report = createAggregateReport([
      result(),
      result({
        caseId: 'case-2',
        passed: false,
        domain: 'scientific-compute',
        scores: { ...result().scores, routing: 0 },
        failures: [{ type: 'wrong_domain', message: 'wrong domain' }]
      })
    ], { executionMode: 'deterministic-simulation' })
    expect(report.passed).toBe(1)
    expect(report.failed).toBe(1)
    expect(report.passRate).toBe(0.5)
    expect(report.metrics.invocationSuccessRate).toBe(1)
    expect(report.metrics.averageToolCalls).toBe(2)
    expect(report.failureBreakdown.wrong_domain).toEqual({ count: 1, rate: 0.5 })
    expect(terminalSummary(report)).toContain('Pass Rate: 50.0%')
  })

  it('keeps evaluator self-test results out of capability metrics', () => {
    const report = createSelfTestReport([
      result({ passed: false, failures: [{ type: 'argument_mismatch', message: 'bad argument' }] }),
      result({ caseId: 'case-2', passed: false, failures: [{ type: 'wrong_domain', message: 'bad domain' }] })
    ], { executionMode: 'deterministic-simulation' })
    expect(report.runKind).toBe('evaluator-self-test')
    expect(report.expectedFailuresDetected).toBe(2)
    expect(report.missedFailures).toBe(0)
    expect(report.detectionRate).toBe(1)
    expect(report.cases[0]).toMatchObject({ subjectResult: 'FAIL', evaluatorTestResult: 'PASS' })
    expect(terminalSelfTestSummary(report)).toContain('Expected Failures Detected: 2')
    expect(renderSelfTestHtmlReport(report)).toContain('<h1>Evaluator Self-Test</h1>')
  })
})

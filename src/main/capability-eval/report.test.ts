import { describe, expect, it } from 'vitest'
import {
  createAggregateReport,
  createSelfTestReport,
  renderHtmlReport,
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
    outcome: 'PASS',
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
      requiredDomains: [], mustDiscover: [], requiredActions: [], expectedActions: [], acceptableActions: [], alternativeActionGroups: [], allowedActions: [], forbiddenActions: [],
      unnecessaryActions: [], ordering: [],
      authorization: {}, invocation: {}, arguments: {},
      tools: { required: [], allowed: [], forbidden: [], unnecessary: [] }
    },
    actual: {
      domain: 'paper-radar', discoveredActions: ['paper-radar.search'], selectedActions: [],
      invocations: [{ actionId: 'paper-radar.search', args: {}, success: true, retryCount: 1, latencyMs: 100 }],
      authorizationEvents: [], toolCalls: 2, retryCount: 1, latencyMs: 100, taskSuccess: true
    },
    rubric: [],
    expectedFailureHandling: 'not-applicable',
    failures: [],
    ...input
  }
}

describe('capability aggregate report', () => {
  it('shows queries and tool comparisons for passing cases while escaping untrusted evidence', () => {
    const sample = result({
      query: '查询 <script>alert(1)</script>',
      expected: { ...result().expected, requiredActions: ['paper-radar.rank'], allowedActions: ['paper-radar.rank'] },
      actual: {
        ...result().actual,
        toolCallDetails: [{
          callId: 'unknown-call', toolName: 'sciforge_invoke', operationRef: 'op_opaque',
          status: 'error', errorCode: 'non_serializable_output', sequence: 1,
          args: { query: '<img src=x onerror=alert(1)>' }
        }],
        finalAnswer: 'The task could not be completed.'
      }
    })
    const report = createAggregateReport([sample], { executionMode: 'live-agent' })
    const original = JSON.stringify(report)
    const html = renderHtmlReport(report)
    expect(html).toContain('用户任务（Query）')
    expect(html).toContain('查询 &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('必需调用（requiredActions）')
    expect(html).toContain('paper-radar.rank')
    expect(html).toContain('sciforge_invoke')
    expect(html).toContain('op_opaque')
    expect(html).toContain('non_serializable_output')
    expect(html).toContain('Action 尚未解析')
    expect(html).toContain('未要求固定顺序。')
    expect(html).toContain('Agent 最终回答')
    expect(html).toContain('The task could not be completed.')
    expect(report.metrics.runtimeToolSuccessRate).toBe(0)
    expect(report.metricCoverage?.runtimeToolSuccessRate).toEqual({ numerator: 0, denominator: 1 })
    expect(JSON.stringify(report)).toBe(original)
    const selfTest = createSelfTestReport([sample], { executionMode: 'deterministic-simulation' })
    expect(renderSelfTestHtmlReport(selfTest)).toContain('必需调用（requiredActions）')
    expect(selfTest.cases[0].actual).toEqual(sample.actual)
  })

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
    expect(report.scope).toBe('capability-unit')
    expect(report.failureBreakdown.wrong_domain).toEqual({ count: 1, rate: 0.5 })
    expect(terminalSummary(report)).toContain('通过率: 50.0%')
    const html = renderHtmlReport(report)
    expect(html).toContain('<html lang="zh-CN">')
    expect(html).toContain('领域路由不匹配（wrong_domain）')
    expect(html).toContain('<option value="failed">失败</option>')
    expect(html).toContain('data-status="failed"')
    expect(html).toContain('data-failures="wrong_domain"')
  })

  it('keeps semantics-v2 N/A dimensions out of aggregate denominators', () => {
    const sample = result({
      semanticsVersion: 'semantics-v2',
      taskType: 'routing',
      scores: {
        routing: 0, discovery: 0, selection: 0, arguments: 0, authorization: 0,
        invocation: 0, taskSuccess: 0, finalState: 0, rubric: 0
      },
      dimensionResults: {
        discovery: { status: 'N/A', note: 'not evaluated' },
        action_selection: { status: 'PASS', score: 1 },
        arguments: { status: 'N/A', note: 'not evaluated' }
      }
    })
    const report = createAggregateReport([sample], { executionMode: 'trace' })
    expect(report.metrics.actionSelectionAccuracy).toBe(1)
    expect(report.metricCoverage?.actionSelectionAccuracy).toEqual({ numerator: 1, denominator: 1 })
    expect(report.metricCoverage?.discoveryRecall).toEqual({ numerator: 0, denominator: 0 })
    expect(report.metrics.taskSuccessRate).toBeNull()
    expect(report.metrics.taskOutcomeAccuracy).toBeNull()
    expect(report.metricCoverage?.taskSuccessRate).toEqual({ numerator: 0, denominator: 0 })
  })

  it('includes explicitly unnecessary Runtime Tools in efficiency metrics', () => {
    const sample = result({
      expected: {
        ...result().expected,
        tools: { required: [], allowed: [], forbidden: [], unnecessary: ['exec_command'] }
      },
      actual: {
        ...result().actual,
        toolCallDetails: [{ callId: 'terminal-1', toolName: 'exec_command', status: 'success', sequence: 1 }]
      }
    })
    const report = createAggregateReport([sample], { executionMode: 'live-agent' })
    expect(report.metrics.unnecessaryToolCallRate).toBe(1)
    expect(report.metrics.unnecessaryCallsPerTask).toBe(1)
    expect(report.metricCoverage?.unnecessaryToolCallRate).toEqual({ numerator: 1, denominator: 1 })
  })

  it('keeps evaluator self-test results out of capability metrics', () => {
    const report = createSelfTestReport([
      result({
        passed: false,
        selfTest: { expectedFailureTypes: ['argument_mismatch'] },
        failures: [{ type: 'argument_mismatch', message: 'bad argument' }]
      }),
      result({
        caseId: 'case-2',
        passed: false,
        selfTest: { expectedFailureTypes: ['wrong_domain'] },
        failures: [{ type: 'wrong_domain', message: 'bad domain' }]
      })
    ], { executionMode: 'deterministic-simulation' })
    expect(report.runKind).toBe('evaluator-self-test')
    expect(report.expectedFailuresDetected).toBe(2)
    expect(report.missedFailures).toBe(0)
    expect(report.detectionRate).toBe(1)
    expect(report.cases[0]).toMatchObject({ subjectResult: 'FAIL', evaluatorTestResult: 'PASS' })
    expect(terminalSelfTestSummary(report)).toContain('已检出的预期错误: 2')
    expect(renderSelfTestHtmlReport(report)).toContain('<h1>评测器自检（Evaluator Self-Test）</h1>')
  })

  it('requires self-tests to detect exactly the declared failure types', () => {
    const report = createSelfTestReport([
      result({
        passed: false,
        selfTest: { expectedFailureTypes: ['argument_mismatch'] },
        failures: [{ type: 'wrong_action', message: 'different failure' }]
      }),
      result({
        caseId: 'case-2',
        passed: false,
        selfTest: { expectedFailureTypes: ['argument_mismatch'] },
        failures: [{ type: 'argument_mismatch', message: 'expected failure' }]
      })
    ], { executionMode: 'deterministic-simulation' })
    expect(report.expectedFailuresDetected).toBe(1)
    expect(report.missedFailures).toBe(1)
    expect(report.cases[0]).toMatchObject({
      evaluatorTestResult: 'FAIL',
      missedFailureTypes: ['argument_mismatch'],
      unexpectedFailureTypes: ['wrong_action']
    })
    expect(report.cases[1].evaluatorTestResult).toBe('PASS')
  })

  it('keeps expected failures visible without treating them as unexpected', () => {
    const report = createAggregateReport([
      result({
        expectedFailure: {
          actionId: 'paper-radar.search',
          errorCode: 'provider_unavailable',
          handling: 'reported'
        },
        expectedFailureHandling: 'passed',
        actual: {
          ...result().actual,
          invocations: [{
            actionId: 'paper-radar.search', args: {}, success: false,
            errorCode: 'provider_unavailable', retryCount: 0, latencyMs: 10
          }],
          taskSuccess: false
        },
        invocations: [{
          actionId: 'paper-radar.search', args: {}, success: false,
          errorCode: 'provider_unavailable', retryCount: 0, latencyMs: 10
        }]
      })
    ], { executionMode: 'deterministic-simulation' })
    expect(report.metrics.contractPassRate).toBe(1)
    expect(report.metrics.rawInvocationSuccessRate).toBe(0)
    expect(report.metrics.unexpectedInvocationFailureRate).toBe(0)
    expect(report.metrics.expectedFailureHandlingAccuracy).toBe(1)
    expect(report.metrics.rawTaskSuccessRate).toBe(0)
    expect(report.metrics.taskOutcomeAccuracy).toBe(1)
  })

  it('reports workflow, final-state, and attempt metrics separately', () => {
    const invocation = {
      actionId: 'paper-radar.search',
      args: {},
      success: true,
      logicalInvocationId: 'call-1',
      providerAttempts: [
        { attempt: 1, success: false, errorCode: 'timeout', latencyMs: 10 },
        { attempt: 2, success: true, latencyMs: 12 }
      ],
      firstAttemptSuccess: false,
      eventualSuccess: true,
      retryCount: 1,
      latencyMs: 22
    }
    const workflow = result({
      workflowType: 'multi-step',
      expected: {
        ...result().expected,
        requiredDomains: ['paper-radar'],
        requiredActions: ['paper-radar.search']
      },
      expectedFinalState: { assertions: [{ path: 'artifact', operator: 'exists' }] },
      actual: {
        ...result().actual,
        domains: ['paper-radar'],
        invocations: [invocation],
        selectedActions: [invocation],
        taskSuccess: true,
        taskLatencyMs: 200,
        attemptEvidence: 'complete',
        finalStateSource: 'inspector',
        finalState: { artifact: 'plot.png' }
      },
      invocations: [invocation],
      metrics: { toolCalls: 1, retryCount: 1, latencyMs: 22 }
    })
    const report = createAggregateReport([workflow], { executionMode: 'trace' })
    expect(report.metrics.multiStepCompletionRate).toBe(1)
    expect(report.metrics.finalStateAccuracy).toBe(1)
    expect(report.metrics.firstAttemptSuccessRate).toBe(0)
    expect(report.metrics.eventualInvocationSuccessRate).toBe(1)
    expect(report.metrics.retryRecoveryRate).toBe(1)
    expect(report.metrics.averageTaskLatencyMs).toBe(200)
    expect(report.scope).toBe('agent-workflow')
    expect(terminalSummary(report)).toContain('任务成功率: 100.0%')
    expect(terminalSummary(report)).toContain('平均任务耗时: 200ms')
    expect(renderHtmlReport(report)).toContain('<h1>Capability Golden Regression（Agent Workflow）</h1>')
  })

  it('does not turn missing task outcome evidence into a zero success rate', () => {
    const report = createAggregateReport([
      result({
        workflowType: 'multi-step',
        expectedFinalState: { assertions: [{ path: 'artifact', operator: 'exists' }] },
        actual: { ...result().actual, invocations: [], taskSuccess: undefined },
        invocations: []
      })
    ], { executionMode: 'live-agent' })

    expect(report.metricCoverage?.taskSuccessRate).toEqual({ numerator: 0, denominator: 0 })
    expect(report.metricCoverage?.rawTaskSuccessRate).toEqual({ numerator: 0, denominator: 0 })
    expect(report.metricCoverage?.taskOutcomeAccuracy).toEqual({ numerator: 0, denominator: 0 })
    expect(report.metricCoverage?.multiStepCompletionRate).toEqual({ numerator: 0, denominator: 0 })
    expect(report.metricCoverage?.finalStateAccuracy).toEqual({ numerator: 0, denominator: 0 })
    expect(terminalSummary(report)).toContain('任务成功率: N/A')
    expect(terminalSummary(report)).toContain('原始任务成功率: N/A')
    expect(terminalSummary(report)).toContain('任务结果匹配准确率: N/A')
    expect(terminalSummary(report)).toContain('多步任务完成率: N/A')
    expect(terminalSummary(report)).toContain('最终状态准确率: N/A')
    expect(terminalSummary(report)).toContain('调用成功率: N/A')
    expect(terminalSummary(report)).toContain('预期错误处理准确率: N/A')
    expect(report.metrics.taskSuccessRate).toBeNull()
    expect(report.metrics.rawTaskSuccessRate).toBeNull()
    expect(report.metrics.finalStateAccuracy).toBeNull()
    expect(report.metrics.invocationSuccessRate).toBeNull()
    expect(report.metrics.expectedFailureHandlingAccuracy).toBeNull()
  })

  it('does not count unsupported artifact inspection as evidence coverage', () => {
    const sample = result({
      expectedFinalState: {
        assertions: [],
        artifacts: [{ path: 'result.json', format: 'json' }],
        dataLineage: []
      },
      actual: {
        ...result().actual,
        finalStateSource: 'inspector',
        finalState: { artifacts: { 'result.json': { status: 'unsupported' } } },
        evidenceStatus: 'complete'
      }
    })
    const report = createAggregateReport([sample], { executionMode: 'live-agent' })

    expect(report.evidenceCoverage?.artifactEvidence).toEqual({ numerator: 0, denominator: 1 })
    expect(report.evidenceCoverage?.finalStateEvidence).toEqual({ numerator: 0, denominator: 1 })
    expect(report.metricCoverage?.finalStateAccuracy).toEqual({ numerator: 0, denominator: 0 })
  })

  it('keeps an executor failure without trace as inconclusive', () => {
    const report = createAggregateReport([
      result({
        passed: false,
        outcome: 'INCONCLUSIVE',
        failures: [{ type: 'execution_error', message: 'bridge unavailable' }]
      })
    ], { executionMode: 'live-agent' })
    expect(report.passed).toBe(0)
    expect(report.failed).toBe(0)
    expect(report.inconclusive).toBe(1)
    expect(report.decisiveCases).toBe(0)
    expect(report.passRate).toBeNull()
    expect(terminalSummary(report)).toContain('证据不足（INCONCLUSIVE）: 1')
    expect(terminalSummary(report)).toContain('通过率: N/A')
    expect(renderHtmlReport(report)).toContain('data-status="inconclusive"')
  })
})

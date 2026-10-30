import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  CAPABILITY_EVAL_SCHEMA_VERSION,
  type EvalAggregateMetrics,
  type EvalAggregateReport,
  type EvalBaselineComparison,
  type EvalCaseResult,
  type EvalDomainAggregate,
  type EvalEvidenceCoverage,
  type EvalFailureAggregate,
  type EvalExecutionMode,
  type EvalMetricKey,
  type EvalSelfTestCaseResult,
  type EvalSelfTestReport
} from './schema'

const METRIC_KEYS: readonly EvalMetricKey[] = [
  'routingAccuracy',
  'discoveryRecall',
  'actionSelectionAccuracy',
  'argumentAccuracy',
  'authorizationAccuracy',
  'invocationSuccessRate',
  'runtimeToolSuccessRate',
  'taskSuccessRate',
  'contractPassRate',
  'rawInvocationSuccessRate',
  'unexpectedInvocationFailureRate',
  'expectedFailureHandlingAccuracy',
  'retryRecoveryRate',
  'taskOutcomeAccuracy',
  'rawTaskSuccessRate',
  'averageToolCalls',
  'averageRetryCount',
  'averageLatencyMs',
  'requiredDomainAccuracy',
  'multiStepCompletionRate',
  'finalStateAccuracy',
  'forbiddenActionRate',
  'unnecessaryToolCallRate',
  'unexpectedToolCallRate',
  'firstAttemptSuccessRate',
  'eventualInvocationSuccessRate',
  'averageApprovalCount',
  'averageCapabilityToolCalls',
  'averageTaskLatencyMs',
  'unnecessaryCallsPerTask',
  'passYield',
  'evaluableCoverage',
  'unresolvedActionRate'
]


const METRIC_LABELS: Readonly<Record<EvalMetricKey, string>> = {
  routingAccuracy: '路由准确率',
  discoveryRecall: '能力发现召回率',
  actionSelectionAccuracy: 'Action 选择准确率',
  argumentAccuracy: '参数准确率',
  authorizationAccuracy: '授权准确率',
  invocationSuccessRate: '调用成功率',
  runtimeToolSuccessRate: 'Runtime Tool 成功率',
  taskSuccessRate: '任务成功率',
  contractPassRate: '评测要求通过率',
  rawInvocationSuccessRate: '原始调用成功率',
  unexpectedInvocationFailureRate: '非预期调用失败率',
  expectedFailureHandlingAccuracy: '预期错误处理准确率',
  retryRecoveryRate: '重试恢复率',
  taskOutcomeAccuracy: '任务结果匹配准确率',
  rawTaskSuccessRate: '原始任务成功率',
  averageToolCalls: '平均工具调用次数',
  averageRetryCount: '平均重试次数',
  averageLatencyMs: '平均调用耗时',
  requiredDomainAccuracy: '必需领域路由准确率',
  multiStepCompletionRate: '多步任务完成率',
  finalStateAccuracy: '最终状态准确率',
  forbiddenActionRate: '禁用 Action 调用率',
  unnecessaryToolCallRate: '多余工具调用率',
  unexpectedToolCallRate: '非预期 Runtime Tool 调用率',
  firstAttemptSuccessRate: '首次尝试成功率',
  eventualInvocationSuccessRate: '最终调用成功率',
  averageApprovalCount: '平均审批次数',
  averageCapabilityToolCalls: '平均 Capability 调用次数',
  averageTaskLatencyMs: '平均任务耗时',
  unnecessaryCallsPerTask: '每个任务的多余调用次数',
  passYield: '全部预登记运行通过率',
  evaluableCoverage: '可判定覆盖率',
  unresolvedActionRate: 'Action identity 未解析率'
}

const PROTOCOL_TOOL_NAMES = new Set([
  'sciforge_discover',
  'sciforge_observe',
  'sciforge_invoke',
  'sciforge_events'
])

function executionModeLabel(mode: EvalExecutionMode): string {
  const labels: Record<EvalExecutionMode, string> = {
    'deterministic-simulation': '确定性模拟',
    'live-agent': '真实 Agent 运行',
    trace: '轨迹回放（trace）'
  }
  return labels[mode]
}

function failureLabel(type: string): string {
  const labels: Readonly<Record<string, string>> = {
    wrong_domain: '领域路由不匹配',
    ordering_mismatch: 'Action 执行顺序不符合要求',
    missing_discovery: '缺少必需的能力发现记录',
    wrong_action: 'Action 选择不符合要求',
    missing_alternative_action: '没有选择任何合理的替代 Action',
    unexpected_action: '调用了不应调用的 Action',
    forbidden_action: '调用了禁止的 Action',
    unnecessary_action: '发生多余的 Action 调用',
    missing_tool: '缺少必需的 Runtime Tool 调用',
    unexpected_tool: '调用了未预期的 Runtime Tool',
    forbidden_tool: '调用了禁止的 Runtime Tool',
    unnecessary_tool: '发生多余的 Runtime Tool 调用',
    tool_failure: 'Runtime Tool 调用失败',
    argument_mismatch: '参数不符合要求',
    authorization_mismatch: '授权结果不符合要求或缺少记录',
    authorization_order: '授权与调用顺序不符合要求',
    invocation_missing: '缺少必需的调用记录',
    invocation_failure: '调用结果不符合要求',
    expected_failure_mismatch: '预期错误或处理方式不匹配',
    retry_exceeded: '重试次数超出限制',
    task_failure: '任务结果不符合要求',
    final_state_mismatch: '最终状态不符合要求',
    rubric_failure: '评分规则未通过',
    execution_error: '执行出错',
    trace_unsupported: 'trace 证据不足或暂不支持评分',
    cleanup_failure: '评测环境清理失败',
    workspace_persistence_failure: '实际工作区产物保存失败',
    behavior_mismatch: '预期行为不匹配'
  }
  return labels[type] ? `${labels[type]}（${type}）` : type
}

const BEHAVIOR_CSS = '.case-behavior{margin:12px 0;padding:12px;border:1px solid #cbd5e1;border-radius:8px;background:white;overflow-wrap:anywhere}.case-behavior pre{white-space:pre-wrap;overflow-wrap:anywhere}.case-behavior summary{cursor:pointer}'

export type CreateReportOptions = Readonly<{
  executionMode: EvalAggregateReport['executionMode']
  capabilityReference?: string
  evaluatorRevision?: string
  generatedAt?: string
  baseline?: EvalAggregateReport
}>

export function createAggregateReport(
  results: readonly EvalCaseResult[],
  options: CreateReportOptions
): EvalAggregateReport {
  const totalCases = results.length
  const outcomes = results.map((result) => caseOutcome(result))
  const passed = outcomes.filter((outcome) => outcome === 'PASS').length
  const failed = outcomes.filter((outcome) => outcome === 'FAIL').length
  const inconclusive = outcomes.filter((outcome) => outcome === 'INCONCLUSIVE').length
  const decisiveCases = passed + failed
  const completeEvidenceResults = results.filter(hasCompleteEvidence)
  const invocationValues = results.flatMap((result) => result.actual.invocations)
  const invocationRecords = results.flatMap((result) => result.actual.invocations.map((invocation) => ({ result, invocation })))
  const runtimeToolRecords = results.flatMap((result) => (result.actual.toolCallDetails ?? []).map((tool) => ({ result, tool })))
  const terminalRuntimeToolRecords = runtimeToolRecords.filter(({ tool }) => tool.status === 'success' || tool.status === 'error')
  const nonProtocolToolRecords = runtimeToolRecords.filter(({ tool }) => !PROTOCOL_TOOL_NAMES.has(tool.toolName))
  const constrainedNonProtocolToolRecords = nonProtocolToolRecords.filter(({ result }) => {
    const expected = result.expected.tools
    return expected.allowed.length > 0 || expected.forbidden.length > 0 || expected.unnecessary.length > 0
  })
  const unexpectedToolRecords = constrainedNonProtocolToolRecords.filter(({ result, tool }) => {
    const expected = result.expected.tools
    return expected.forbidden.includes(tool.toolName) ||
      expected.unnecessary.includes(tool.toolName) ||
      (expected.allowed.length > 0 && !expected.allowed.includes(tool.toolName))
  })
  const expectedFailureCases = results.filter((result) => result.expectedFailure)
  const workflowCases = results.filter(isWorkflowCase)
  const multiStepCases = workflowCases.filter((result) => result.workflowType !== 'single-action')
  const finalStateCases = results.filter((result) => (result.expectedFinalState?.assertions.length ?? 0) > 0)
  const finalStateContractCases = results.filter(hasFinalStateContract)
  const artifactContractCases = results.filter((result) => (result.expectedFinalState?.artifacts?.length ?? 0) > 0)
  const lineageContractCases = results.filter((result) => (result.expectedFinalState?.dataLineage?.length ?? 0) > 0)
  const multiStepEvidenceCases = multiStepCases.filter((result) => hasCompleteEvidence(result) && result.actual.taskSuccess !== undefined)
  const finalStateEvidenceCases = finalStateCases.filter(hasFinalStateEvidence)
  const finalStateEvidenceContractCases = finalStateContractCases.filter(hasFinalStateEvidence)
  const artifactEvidenceCases = artifactContractCases.filter(hasArtifactEvidence)
  const lineageEvidenceCases = lineageContractCases.filter(hasLineageEvidence)
  const attemptRecords = invocationRecords.filter(({ result, invocation }) => (
    result.actual.attemptEvidence === 'complete' &&
    invocation.firstAttemptSuccess !== undefined
  ))
  const recoveryRecords = attemptRecords.filter(({ invocation }) => (
    invocation.providerAttempts !== undefined &&
    invocation.providerAttempts.length > 1 &&
    invocation.firstAttemptSuccess === false
  ))
  const rawInvocationSuccessRate = ratio(
    invocationValues.filter(invocationSucceeded).length,
    invocationValues.length
  )
  const unresolvedActionCount = invocationValues.filter((invocation) => !invocation.actionId).length
  const taskEvidenceResults = completeEvidenceResults.filter((result) => (
    result.actual.taskSuccess !== undefined && hasTaskCompletionContract(result)
  ))
  const rawTaskSuccessRate = ratio(
    taskEvidenceResults.filter((result) => result.actual.taskSuccess === true).length,
    taskEvidenceResults.length
  )
  const unexpectedInvocationFailures = invocationRecords.filter(({ result, invocation }) => (
    invocationFailed(invocation) && !isExpectedFailureInvocation(result, invocation)
  )).length
  const forbiddenActionCases = results.filter((result) => result.expected.forbiddenActions.length > 0)
  const forbiddenCases = forbiddenActionCases.filter((result) => result.actual.invocations.some((invocation) => (
    invocation.actionId !== undefined && result.expected.forbiddenActions.includes(invocation.actionId)
  )))
  const unnecessaryContractCases = results.filter((result) => (
    result.expected.unnecessaryActions.length > 0 || result.expected.tools.unnecessary.length > 0
  ))
  const unnecessaryActionCalls = invocationRecords.filter(({ result, invocation }) => (
    invocation.actionId !== undefined && (result.expected.unnecessaryActions ?? []).includes(invocation.actionId)
  ))
  const unnecessaryRuntimeToolCalls = runtimeToolRecords.filter(({ result, tool }) => (
    result.expected.tools.unnecessary.includes(tool.toolName)
  ))
  const unnecessaryCalls = [
    ...unnecessaryActionCalls.map(({ result }) => ({ result })),
    ...unnecessaryRuntimeToolCalls.map(({ result }) => ({ result }))
  ]
  const unnecessaryCaseIds = new Set(unnecessaryCalls.map(({ result }) => result.caseId))
  const approvals = results.map((result) => result.actual.approvalCount ?? result.actual.authorizationEvents.filter((event) => event.status === 'requested').length)
  const taskLatencies = results
    .map((result) => result.actual.taskLatencyMs)
    .filter((value): value is number => value !== undefined)
  const requiredDomainCases = completeEvidenceResults.filter((result) => (result.expected.requiredDomains ?? []).length > 0)
  const metrics: EvalAggregateMetrics = {
    routingAccuracy: averageScoresOrNull(completeEvidenceResults, (result) => result.scores.routing),
    discoveryRecall: averageScoresOrNull(completeEvidenceResults, (result) => dimensionScore(result, 'discovery', result.scores.discovery)),
    actionSelectionAccuracy: averageScoresOrNull(completeEvidenceResults, (result) => dimensionScore(result, 'action_selection', result.scores.selection)),
    argumentAccuracy: averageScoresOrNull(completeEvidenceResults, (result) => dimensionScore(result, 'arguments', result.scores.arguments)),
    authorizationAccuracy: averageScoresOrNull(completeEvidenceResults, (result) => dimensionScore(result, 'authorization', result.scores.authorization)),
    invocationSuccessRate: rawInvocationSuccessRate,
    runtimeToolSuccessRate: ratio(
      terminalRuntimeToolRecords.filter(({ tool }) => tool.status === 'success').length,
      terminalRuntimeToolRecords.length
    ),
    taskSuccessRate: rawTaskSuccessRate,
    contractPassRate: ratio(passed, decisiveCases),
    rawInvocationSuccessRate,
    unexpectedInvocationFailureRate: ratio(unexpectedInvocationFailures, invocationValues.length),
    expectedFailureHandlingAccuracy: ratio(
      expectedFailureCases.filter((result) => result.expectedFailureHandling === 'passed').length,
      expectedFailureCases.length
    ),
    retryRecoveryRate: ratio(
      recoveryRecords.filter(({ invocation }) => invocation.eventualSuccess === true || invocationSucceeded(invocation)).length,
      recoveryRecords.length
    ),
    taskOutcomeAccuracy: averageScoresOrNull(taskEvidenceResults, (result) => dimensionScore(result, 'task_completion', result.scores.taskSuccess)),
    rawTaskSuccessRate,
    averageToolCalls: averageOrNull(results.map((result) => result.metrics.toolCalls)),
    averageRetryCount: averageOrNull(results.map((result) => result.metrics.retryCount)),
    averageLatencyMs: averageOrNull(results.map((result) => result.metrics.latencyMs)),
    requiredDomainAccuracy: averageScoresOrNull(requiredDomainCases, (result) => result.scores.routing),
    multiStepCompletionRate: ratio(
      multiStepEvidenceCases.filter((result) => taskCompleted(result)).length,
      multiStepEvidenceCases.length
    ),
    finalStateAccuracy: averageScoresOrNull(finalStateEvidenceCases, (result) => dimensionScore(result, 'result_correctness', result.scores.finalState)),
    forbiddenActionRate: ratio(forbiddenCases.length, forbiddenActionCases.length),
    unnecessaryToolCallRate: ratio(unnecessaryCaseIds.size, unnecessaryContractCases.length),
    unexpectedToolCallRate: ratio(unexpectedToolRecords.length, constrainedNonProtocolToolRecords.length),
    firstAttemptSuccessRate: ratio(
      attemptRecords.filter(({ invocation }) => invocation.firstAttemptSuccess === true).length,
      attemptRecords.length
    ),
    eventualInvocationSuccessRate: rawInvocationSuccessRate,
    averageApprovalCount: averageOrNull(approvals),
    averageCapabilityToolCalls: averageOrNull(results.map((result) => result.actual.capabilityToolCalls ?? result.actual.invocations.length)),
    averageTaskLatencyMs: averageOrNull(taskLatencies),
    unnecessaryCallsPerTask: ratio(unnecessaryCalls.length, unnecessaryContractCases.length),
    passYield: totalCases === 0 ? null : passed / totalCases,
    evaluableCoverage: totalCases === 0 ? null : decisiveCases / totalCases,
    unresolvedActionRate: invocationValues.length === 0 ? null : unresolvedActionCount / invocationValues.length
  }
  const report: EvalAggregateReport = {
    schemaVersion: CAPABILITY_EVAL_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    runKind: 'golden-regression',
    scope: results.some(isExplicitWorkflowCase) ? 'agent-workflow' : 'capability-unit',
    executionMode: options.executionMode,
    ...(options.capabilityReference ? { capabilityReference: options.capabilityReference } : {}),
    ...(options.evaluatorRevision ? { evaluatorRevision: options.evaluatorRevision } : {}),
    totalCases,
    passed,
    failed,
    inconclusive,
    decisiveCases,
    passRate: ratio(passed, decisiveCases),
    metrics,
    metricCoverage: {
      invocationSuccessRate: coverage(invocationValues.length, invocationValues.filter(invocationSucceeded).length),
      routingAccuracy: scoreCoverage(completeEvidenceResults, (result) => result.scores.routing),
      discoveryRecall: scoreCoverage(completeEvidenceResults, (result) => dimensionScore(result, 'discovery', result.scores.discovery)),
      actionSelectionAccuracy: scoreCoverage(completeEvidenceResults, (result) => dimensionScore(result, 'action_selection', result.scores.selection)),
      argumentAccuracy: scoreCoverage(completeEvidenceResults, (result) => dimensionScore(result, 'arguments', result.scores.arguments)),
      authorizationAccuracy: scoreCoverage(completeEvidenceResults, (result) => dimensionScore(result, 'authorization', result.scores.authorization)),
      contractPassRate: coverage(decisiveCases, passed),
      runtimeToolSuccessRate: coverage(
        terminalRuntimeToolRecords.length,
        terminalRuntimeToolRecords.filter(({ tool }) => tool.status === 'success').length
      ),
      rawInvocationSuccessRate: coverage(invocationValues.length, invocationValues.filter(invocationSucceeded).length),
      unexpectedInvocationFailureRate: coverage(invocationValues.length, invocationRecords.filter(({ result, invocation }) => (
        invocationFailed(invocation) && !isExpectedFailureInvocation(result, invocation)
      )).length),
      expectedFailureHandlingAccuracy: coverage(expectedFailureCases.length, expectedFailureCases.filter((result) => result.expectedFailureHandling === 'passed').length),
      requiredDomainAccuracy: scoreCoverage(requiredDomainCases, (result) => result.scores.routing),
      taskSuccessRate: coverage(taskEvidenceResults.length, taskEvidenceResults.filter((result) => result.actual.taskSuccess === true).length),
      rawTaskSuccessRate: coverage(taskEvidenceResults.length, taskEvidenceResults.filter((result) => result.actual.taskSuccess === true).length),
      taskOutcomeAccuracy: scoreCoverage(taskEvidenceResults, (result) => dimensionScore(result, 'task_completion', result.scores.taskSuccess)),
      multiStepCompletionRate: coverage(multiStepEvidenceCases.length, multiStepEvidenceCases.filter(taskCompleted).length),
      finalStateAccuracy: scoreCoverage(finalStateEvidenceCases, (result) => dimensionScore(result, 'result_correctness', result.scores.finalState)),
      forbiddenActionRate: coverage(forbiddenActionCases.length, forbiddenCases.length),
      unnecessaryToolCallRate: coverage(unnecessaryContractCases.length, unnecessaryCaseIds.size),
      unexpectedToolCallRate: coverage(constrainedNonProtocolToolRecords.length, unexpectedToolRecords.length),
      firstAttemptSuccessRate: coverage(attemptRecords.length, attemptRecords.filter(({ invocation }) => invocation.firstAttemptSuccess === true).length),
      eventualInvocationSuccessRate: coverage(invocationValues.length, invocationValues.filter(invocationSucceeded).length),
      retryRecoveryRate: coverage(recoveryRecords.length, recoveryRecords.filter(({ invocation }) => invocation.eventualSuccess === true || invocationSucceeded(invocation)).length),
      averageApprovalCount: coverage(results.length, results.length),
      averageCapabilityToolCalls: coverage(results.length, results.length),
      averageTaskLatencyMs: coverage(taskLatencies.length, taskLatencies.length),
      unnecessaryCallsPerTask: coverage(unnecessaryContractCases.length, unnecessaryCalls.length),
      passYield: coverage(totalCases, passed),
      evaluableCoverage: coverage(totalCases, decisiveCases),
      unresolvedActionRate: coverage(invocationValues.length, unresolvedActionCount)
    },
    evidenceCoverage: {
      completeTrace: coverage(results.length, completeEvidenceResults.length),
      finalStateContract: coverage(results.length, finalStateContractCases.length),
      finalStateEvidence: coverage(finalStateContractCases.length, finalStateEvidenceContractCases.length),
      artifactContract: coverage(results.length, artifactContractCases.length),
      artifactEvidence: coverage(artifactContractCases.length, artifactEvidenceCases.length),
      dataLineageContract: coverage(results.length, lineageContractCases.length),
      dataLineageEvidence: coverage(lineageContractCases.length, lineageEvidenceCases.length)
    },
    domainBreakdown: aggregateDomains(results),
    failureBreakdown: aggregateFailures(results),
    failures: results.filter((result) => caseOutcome(result) === 'FAIL').map((result) => result.caseId),
    cases: results
  }
  if (options.baseline) {
    return {
      ...report,
      baselineComparison: baselineComparison(options.baseline.metrics, metrics)
    }
  }
  return report
}

export async function writeEvalReports(
  report: EvalAggregateReport,
  outputDirectory: string
): Promise<Readonly<{ jsonPath: string; htmlPath: string }>> {
  return writeReportFiles(report.generatedAt, JSON.stringify(report, null, 2), renderHtmlReport(report), outputDirectory)
}

export function createSelfTestReport(
  results: readonly EvalCaseResult[],
  options: Readonly<{ executionMode: EvalExecutionMode; generatedAt?: string }>
): EvalSelfTestReport {
  const cases: EvalSelfTestCaseResult[] = results.map((result) => ({
    caseId: result.caseId,
    query: result.query,
    subjectResult: result.passed ? 'PASS' : 'FAIL',
    evaluatorTestResult: selfTestPassed(result) ? 'PASS' : 'FAIL',
    detectedFailures: [...result.failures],
    expected: result.expected,
    ...(result.selfTest ? { selfTest: result.selfTest } : {}),
    expectedFailureTypes: result.selfTest?.expectedFailureTypes ?? [],
    detectedExpectedFailureTypes: result.selfTest
      ? result.selfTest.expectedFailureTypes.filter((type) => result.failures.some((failure) => failure.type === type))
      : [],
    missedFailureTypes: result.selfTest
      ? result.selfTest.expectedFailureTypes.filter((type) => !result.failures.some((failure) => failure.type === type))
      : [],
    unexpectedFailureTypes: result.selfTest
      ? [...new Set(result.failures.map((failure) => failure.type))].filter((type) => !result.selfTest?.expectedFailureTypes.includes(type))
      : [...new Set(result.failures.map((failure) => failure.type))],
    actual: result.actual
  }))
  const expectedFailuresDetected = cases.filter((result) => result.evaluatorTestResult === 'PASS').length
  return {
    schemaVersion: CAPABILITY_EVAL_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    runKind: 'evaluator-self-test',
    executionMode: options.executionMode,
    totalCases: cases.length,
    expectedFailuresDetected,
    missedFailures: cases.length - expectedFailuresDetected,
    detectionRate: cases.length === 0 ? 0 : expectedFailuresDetected / cases.length,
    cases
  }
}

export function terminalSelfTestSummary(report: EvalSelfTestReport): string {
  const lines = [
    `评测器自检（Evaluator Self-Test） (${executionModeLabel(report.executionMode)})`,
    `用例总数: ${report.totalCases}`,
    `已检出的预期错误: ${report.expectedFailuresDetected}`,
    `漏检错误: ${report.missedFailures}`,
    `检出率: ${percent(report.detectionRate)}`
  ]
  const missed = report.cases.filter((result) => result.evaluatorTestResult === 'FAIL').map((result) => result.caseId)
  if (missed.length > 0) lines.push('', `漏检用例: ${missed.join(', ')}`)
  return lines.join('\n')
}

function selfTestPassed(result: EvalCaseResult): boolean {
  const expected = result.selfTest?.expectedFailureTypes ?? []
  if (result.passed || expected.length === 0) return false
  const actual = new Set(result.failures.map((failure) => failure.type))
  return expected.every((type) => actual.has(type)) &&
    [...actual].every((type) => expected.includes(type))
}

export function renderSelfTestHtmlReport(report: EvalSelfTestReport): string {
  const rows = report.cases.map((result) => {
    const failures = [...new Set(result.detectedFailures.map((failure) => failure.type))]
    const discrepancies = [...new Set([...result.missedFailureTypes, ...result.unexpectedFailureTypes])]
    return `<tr class="${result.evaluatorTestResult === 'PASS' ? 'passed' : 'failed'}"><td><code>${escapeHtml(result.caseId)}</code></td><td>${result.subjectResult === 'PASS' ? '通过（PASS）' : '失败（FAIL）'}</td><td>${result.evaluatorTestResult === 'PASS' ? '通过（PASS）' : '失败（FAIL）'}</td><td>${escapeHtml(result.expectedFailureTypes.map(failureLabel).join(', ') || '未配置')}</td><td>${escapeHtml(failures.map(failureLabel).join(', ') || '无')}</td><td>${escapeHtml(discrepancies.map(failureLabel).join(', ') || '无')}</td></tr>`
  }).join('')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>评测器自检（Evaluator Self-Test）</title>
<style>${BEHAVIOR_CSS}</style>
<style>body{font:14px/1.45 system-ui,sans-serif;color:#172033;background:#f5f7fb;margin:0 auto;padding:24px;max-width:1100px}table{border-collapse:collapse;width:100%;background:white;border:1px solid #e2e8f0}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0}th{background:#eef2f7}.passed{background:#f0fdf4}.failed{background:#fff1f2}.cards{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.card{background:white;border:1px solid #e2e8f0;border-radius:8px;padding:12px}.card strong{display:block;font-size:22px}</style></head><body>
<h1>评测器自检（Evaluator Self-Test）</h1><p>生成时间：${escapeHtml(report.generatedAt)} · 执行模式：${escapeHtml(executionModeLabel(report.executionMode))}</p><p>被测行为失败是预期结果，不代表 SciForge 回归失败。当前自检要求每条用例声明并准确检出预期 failure type，且不出现未声明的 failure type。</p>
<div class="cards"><div class="card">用例总数<strong>${report.totalCases}</strong></div><div class="card">已检出的预期错误<strong>${report.expectedFailuresDetected}</strong></div><div class="card">漏检错误<strong>${report.missedFailures}</strong></div><div class="card">检出率<strong>${percent(report.detectionRate)}</strong></div></div>
<table><thead><tr><th>用例</th><th>被测行为结果</th><th>评测器自检结果</th><th>预期 failure type</th><th>实际检出</th><th>漏检或未声明</th></tr></thead><tbody>${rows || '<tr><td colspan="6">没有用例。</td></tr>'}</tbody></table>
<h2>任务与工具对照</h2>
${report.cases.map((result) => behaviorDetail(result, report.cases.length === 1)).join('')}
</body></html>`
}

export async function writeSelfTestReports(
  report: EvalSelfTestReport,
  outputDirectory: string
): Promise<Readonly<{ jsonPath: string; htmlPath: string }>> {
  return writeReportFiles(report.generatedAt, JSON.stringify(report, null, 2), renderSelfTestHtmlReport(report), outputDirectory)
}

async function writeReportFiles(
  generatedAt: string,
  jsonBody: string,
  html: string,
  outputDirectory: string
): Promise<Readonly<{ jsonPath: string; htmlPath: string }>> {
  const directory = resolve(outputDirectory)
  const historyDirectory = resolve(directory, 'history')
  await mkdir(historyDirectory, { recursive: true })
  const jsonPath = resolve(directory, 'latest.json')
  const htmlPath = resolve(directory, 'latest.html')
  const json = `${jsonBody}\n`
  await writeFile(jsonPath, json, 'utf8')
  await writeFile(htmlPath, html, 'utf8')
  const stamp = generatedAt.replace(/[^0-9]/gu, '').slice(0, 14) || String(Date.now())
  await writeFile(resolve(historyDirectory, `${stamp}.json`), json, 'utf8')
  await writeFile(resolve(historyDirectory, `${stamp}.html`), html, 'utf8')
  return { jsonPath, htmlPath }
}

export function terminalSummary(report: EvalAggregateReport): string {
  const lines = [
    `${reportTitle(report)} (${executionModeLabel(report.executionMode)})`,
    `用例总数: ${report.totalCases}`,
    `通过: ${report.passed}`,
    `失败: ${report.failed}`,
    `证据不足（INCONCLUSIVE）: ${report.inconclusive}`,
    `可判定用例: ${report.decisiveCases}`,
    `通过率: ${metricDisplay(report.passRate)}`,
    `评测要求通过率: ${metricPercent(report, 'contractPassRate')}`,
    `全部预登记运行通过率: ${metricPercent(report, 'passYield')}`,
    `可判定覆盖率: ${metricPercent(report, 'evaluableCoverage')}`,
    `Action identity 未解析率: ${metricPercent(report, 'unresolvedActionRate')}`,
    '',
    `路由准确率: ${metricPercent(report, 'routingAccuracy')}`,
    `能力发现召回率: ${metricPercent(report, 'discoveryRecall')}`,
    `Action 选择准确率: ${metricPercent(report, 'actionSelectionAccuracy')}`,
    `参数准确率: ${metricPercent(report, 'argumentAccuracy')}`,
    `授权准确率: ${metricPercent(report, 'authorizationAccuracy')}`,
    `调用成功率: ${metricPercent(report, 'invocationSuccessRate')}`,
    `Runtime Tool 成功率: ${metricPercent(report, 'runtimeToolSuccessRate')}`,
    `原始调用成功率: ${metricPercent(report, 'rawInvocationSuccessRate')}`,
    `非预期调用失败率: ${metricPercent(report, 'unexpectedInvocationFailureRate')}`,
    `预期错误处理准确率: ${metricPercent(report, 'expectedFailureHandlingAccuracy')}`,
    `重试恢复率: ${metricPercent(report, 'retryRecoveryRate')}`,
    `任务结果匹配准确率: ${metricPercent(report, 'taskOutcomeAccuracy')}`,
    `任务成功率: ${metricPercent(report, 'taskSuccessRate')}`,
    `原始任务成功率: ${metricPercent(report, 'rawTaskSuccessRate')}`,
    `多步任务完成率: ${metricPercent(report, 'multiStepCompletionRate')}`,
    `最终状态准确率: ${metricPercent(report, 'finalStateAccuracy')}`,
    `首次尝试成功率: ${metricPercent(report, 'firstAttemptSuccessRate')}`,
    `最终调用成功率: ${metricPercent(report, 'eventualInvocationSuccessRate')}`,
    `禁用 Action 调用率: ${metricPercent(report, 'forbiddenActionRate')}`,
    `多余工具调用率: ${metricPercent(report, 'unnecessaryToolCallRate')}`,
    `非预期 Runtime Tool 调用率: ${metricPercent(report, 'unexpectedToolCallRate')}`,
    '',
    `完整 trace 证据: ${coverageText(report.evidenceCoverage?.completeTrace)}`,
    `Final-state contract: ${coverageText(report.evidenceCoverage?.finalStateContract)}`,
    `Final-state evidence: ${coverageText(report.evidenceCoverage?.finalStateEvidence)}`,
    `Artifact contract: ${coverageText(report.evidenceCoverage?.artifactContract)}`,
    `Artifact evidence: ${coverageText(report.evidenceCoverage?.artifactEvidence)}`,
    `Data-lineage contract: ${coverageText(report.evidenceCoverage?.dataLineageContract)}`,
    `Data-lineage evidence: ${coverageText(report.evidenceCoverage?.dataLineageEvidence)}`,
    '',
    `平均工具调用次数: ${formatMetric(report.metrics.averageToolCalls, 'averageToolCalls')}`,
    `平均重试次数: ${formatMetric(report.metrics.averageRetryCount, 'averageRetryCount')}`,
    `平均审批次数: ${formatMetric(report.metrics.averageApprovalCount, 'averageApprovalCount')}`,
    `平均 Capability 调用次数: ${formatMetric(report.metrics.averageCapabilityToolCalls, 'averageCapabilityToolCalls')}`,
    `平均调用耗时: ${formatMetric(report.metrics.averageLatencyMs, 'averageLatencyMs')}`,
    `平均任务耗时: ${metricAverage(report, 'averageTaskLatencyMs')}`,
    `每个任务的多余调用次数: ${metricAverage(report, 'unnecessaryCallsPerTask')}`
  ]
  if (report.failures.length > 0) {
    lines.push('', `失败用例: ${report.failures.join(', ')}`)
  }
  return lines.join('\n')
}

export function renderHtmlReport(report: EvalAggregateReport): string {
  const metricCards = [
    ['用例总数', String(report.totalCases)],
    ['通过', String(report.passed)],
    ['失败', String(report.failed)],
    ['证据不足（INCONCLUSIVE）', String(report.inconclusive)],
    ['可判定用例', String(report.decisiveCases)],
    ['评测要求通过率', metricPercent(report, 'contractPassRate')],
    ['全部预登记运行通过率', metricPercent(report, 'passYield')],
    ['可判定覆盖率', metricPercent(report, 'evaluableCoverage')],
    ['Action identity 未解析率', metricPercent(report, 'unresolvedActionRate')],
    ['路由准确率', metricPercent(report, 'routingAccuracy')],
    ['能力发现召回率', metricPercent(report, 'discoveryRecall')],
    ['Action 选择准确率', metricPercent(report, 'actionSelectionAccuracy')],
    ['参数准确率', metricPercent(report, 'argumentAccuracy')],
    ['授权准确率', metricPercent(report, 'authorizationAccuracy')],
    ['调用成功率', metricPercent(report, 'invocationSuccessRate')],
    ['Runtime Tool 成功率', metricPercent(report, 'runtimeToolSuccessRate')],
    ['原始调用成功率', metricPercent(report, 'rawInvocationSuccessRate')],
    ['非预期调用失败率', metricPercent(report, 'unexpectedInvocationFailureRate')],
    ['预期错误处理', metricPercent(report, 'expectedFailureHandlingAccuracy')],
    ['重试恢复率', metricPercent(report, 'retryRecoveryRate')],
    ['任务结果匹配准确率', metricPercent(report, 'taskOutcomeAccuracy')],
    ['任务成功率', metricPercent(report, 'taskSuccessRate')],
    ['原始任务成功率', metricPercent(report, 'rawTaskSuccessRate')],
    ['多步任务完成率', metricPercent(report, 'multiStepCompletionRate')],
    ['最终状态准确率', metricPercent(report, 'finalStateAccuracy')],
    ['首次尝试成功率', metricPercent(report, 'firstAttemptSuccessRate')],
    ['最终调用成功率', metricPercent(report, 'eventualInvocationSuccessRate')],
    ['禁用 Action 调用率', metricPercent(report, 'forbiddenActionRate')],
    ['多余工具调用率', metricPercent(report, 'unnecessaryToolCallRate')],
    ['非预期 Runtime Tool 调用率', metricPercent(report, 'unexpectedToolCallRate')],
    ['平均工具调用次数', formatMetric(report.metrics.averageToolCalls, 'averageToolCalls')],
    ['平均重试次数', formatMetric(report.metrics.averageRetryCount, 'averageRetryCount')],
    ['平均审批次数', formatMetric(report.metrics.averageApprovalCount, 'averageApprovalCount')],
    ['平均 Capability 调用次数', formatMetric(report.metrics.averageCapabilityToolCalls, 'averageCapabilityToolCalls')],
    ['平均调用耗时', formatMetric(report.metrics.averageLatencyMs, 'averageLatencyMs')],
    ['平均任务耗时', metricAverage(report, 'averageTaskLatencyMs')],
    ['每个任务的多余调用次数', metricAverage(report, 'unnecessaryCallsPerTask')]
  ].map(([label, value]) => `<div class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')

  const domains = Object.entries(report.domainBreakdown).map(([domain, value]) => `
    <tr>
      <td>${escapeHtml(domain)}</td><td>${value.total}</td><td>${value.passed}</td><td>${value.failed}</td><td>${value.inconclusive}</td><td>${metricDisplay(value.passRate)}</td>
      <td>${metricDisplay(value.routingAccuracy)}</td><td>${metricDisplay(value.discoveryRecall)}</td>
      <td>${metricDisplay(value.actionSelectionAccuracy)}</td><td>${metricDisplay(value.authorizationAccuracy)}</td>
      <td>${metricDisplay(value.taskSuccessRate)}</td>
    </tr>`).join('')
  const failureRows = Object.entries(report.failureBreakdown).map(([type, value]) => `
    <tr><td>${escapeHtml(failureLabel(type))}</td><td>${value.count}</td><td>${percent(value.rate)}</td></tr>`).join('')
  const expectedFailureRows = report.cases.filter((result) => result.expectedFailure).map((result) => {
    const expectation = result.expectedFailure!
    const invocations = result.actual.invocations.filter((invocation) => invocation.actionId === expectation.actionId)
    const outcomes = invocations.map((invocation) => `${invocationOutcome(invocation)}${invocation.errorCode ? ` (${invocation.errorCode})` : ''}`).join(' → ')
    return `<tr><td><code>${escapeHtml(result.caseId)}</code></td><td>${escapeHtml(expectation.actionId)}</td><td>${escapeHtml(expectation.handling === 'reported' ? '报告错误' : '重试恢复')}</td><td>${escapeHtml(outcomes || '无')}</td><td>${escapeHtml(result.expectedFailureHandling === 'passed' ? '通过' : result.expectedFailureHandling === 'failed' ? '失败' : '不适用')}</td><td>${result.passed ? '通过（PASS）' : '失败（FAIL）'}</td></tr>`
  }).join('')
  const domainOptions = Object.keys(report.domainBreakdown).map((domain) => `<option value="${escapeHtml(domain)}">${escapeHtml(domain)}</option>`).join('')
  const failureOptions = Object.keys(report.failureBreakdown).map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(failureLabel(type))}</option>`).join('')
  const caseRows = report.cases.map((result) => caseRow(result)).join('')
  const failedDetails = report.cases.filter((result) => caseOutcome(result) !== 'PASS').map((result) => `
    <details class="failure-detail" data-domain="${escapeHtml(result.domain ?? 'unknown')}">
      <summary>${escapeHtml(result.caseId)} — ${caseOutcome(result)} — ${escapeHtml(result.failures.map((failure) => failureLabel(failure.type)).join(', '))}</summary>
      <p><strong>用户任务：</strong> ${escapeHtml(result.query)}</p>
      <ul>${result.failures.map((failure) => `<li>${escapeHtml(failureLabel(failure.type))}；预期：<code>${escapeHtml(JSON.stringify(failure.expected) ?? '未提供')}</code>；实际：<code>${escapeHtml(JSON.stringify(failure.actual) ?? '未提供')}</code></li>`).join('')}</ul>
      <p>原始诊断数据（JSON，保留字段名与错误原文）：</p>
      <pre>${escapeHtml(JSON.stringify({
        expected: result.expected,
        actual: result.actual,
        rubric: result.rubric,
        failures: result.failures
      }, null, 2))}</pre>
    </details>`).join('') || '<p>没有失败用例。</p>'
  const baseline = report.baselineComparison ? baselineTable(report.baselineComparison) : ''
  const evidenceRows = ([
    ['完整 trace 证据', 'completeTrace', '已收集到足以做 absence claim 的 trace。'],
    ['Final-state contract', 'finalStateContract', 'case 声明了最终状态、artifact 或 lineage 验收条件。'],
    ['Final-state evidence', 'finalStateEvidence', '有独立 inspector/oracle 提供最终状态证据。'],
    ['Artifact contract', 'artifactContract', 'case 声明了需要核验的实际文件。'],
    ['Artifact evidence', 'artifactEvidence', '实际文件已被 inspector 核验。'],
    ['Data-lineage contract', 'dataLineageContract', 'case 声明了 source → target 数据传递关系。'],
    ['Data-lineage evidence', 'dataLineageEvidence', 'source/target 字段值已被独立核验。']
  ] as const).map(([label, key, description]) => (
    `<tr><td>${escapeHtml(label)}</td><td>${coverageText(report.evidenceCoverage?.[key])}</td><td>${escapeHtml(description)}</td></tr>`
  )).join('')

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${reportTitle(report)}</title>
<style>${BEHAVIOR_CSS}</style>
<style>
:root{font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb}
body{margin:0;padding:24px;max-width:1440px;margin-inline:auto}h1{margin:0 0 4px}h2{margin-top:32px}small{color:#64748b}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-top:20px}.card{background:white;border:1px solid #e2e8f0;border-radius:10px;padding:12px;box-shadow:0 1px 2px #0f172a0d}.card span{display:block;color:#64748b;font-size:12px}.card strong{display:block;font-size:22px;margin-top:4px}table{border-collapse:collapse;width:100%;background:white;border:1px solid #e2e8f0}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top}th{background:#eef2f7;font-size:12px;color:#475569}tr.failed{background:#fff1f2}select{padding:7px;border:1px solid #cbd5e1;border-radius:6px;margin:0 8px 10px 0;background:white}.filters{margin-top:12px}details{background:white;border:1px solid #fecdd3;border-radius:8px;padding:10px;margin:8px 0}pre{white-space:pre-wrap;overflow:auto;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:6px;font-size:12px}.delta-positive{color:#15803d}.delta-negative{color:#b91c1c}
</style></head><body>
<h1>${reportTitle(report)}</h1><small>生成时间：${escapeHtml(report.generatedAt)} · 执行模式：${escapeHtml(executionModeLabel(report.executionMode))}${report.capabilityReference ? ` · 参考文件：${escapeHtml(basename(report.capabilityReference))}` : ''}</small>
<p>指标中的 N/A 表示没有可用观测数据或不适用。技术标识与原始 JSON 保留原文，便于核对 trace。</p>
<div class="cards">${metricCards}</div>
<h2>验收证据覆盖</h2><p>工具调用成功不等于任务完成；artifact 和 data lineage 只在有显式 contract 且由独立 inspector/oracle 核验时计入证据。</p><table><thead><tr><th>证据层</th><th>覆盖</th><th>含义</th></tr></thead><tbody>${evidenceRows}</tbody></table>
<h2>按领域统计</h2>
<table><thead><tr><th>领域</th><th>总数</th><th>通过</th><th>失败</th><th>证据不足</th><th>通过率</th><th>路由</th><th>能力发现</th><th>Action 选择</th><th>授权</th><th>任务成功率</th></tr></thead><tbody>${domains || '<tr><td colspan="11">没有用例。</td></tr>'}</tbody></table>
<h2>按错误类型统计</h2>
<table><thead><tr><th>错误类型</th><th>数量</th><th>用例占比</th></tr></thead><tbody>${failureRows || '<tr><td colspan="3">没有错误。</td></tr>'}</tbody></table>
<h2>预期错误处理</h2>
<p>预期的 provider 失败仍计入原始调用指标。只有观察到预期错误及对应处理行为，评测要求判定才为通过。</p>
<table><thead><tr><th>用例</th><th>Action</th><th>预期处理方式</th><th>调用结果</th><th>处理结果</th><th>评测要求判定</th></tr></thead><tbody>${expectedFailureRows || '<tr><td colspan="6">没有预期失败用例。</td></tr>'}</tbody></table>
<h2>用例列表</h2>
  <div class="filters"><label>状态 <select id="status-filter"><option value="all">全部</option><option value="passed">通过</option><option value="failed">失败</option><option value="inconclusive">证据不足</option></select></label><label>领域 <select id="domain-filter"><option value="all">全部</option>${domainOptions}</select></label><label>错误类型 <select id="failure-filter"><option value="all">全部</option>${failureOptions}</select></label></div>
<table id="case-table"><thead><tr><th>用例</th><th>领域</th><th>状态</th><th>路由</th><th>能力发现</th><th>Action 选择</th><th>授权</th><th>调用</th><th>任务</th><th>耗时</th><th>调用次数</th></tr></thead><tbody>${caseRows}</tbody></table>
<h2>任务与工具对照</h2>
<p>预期工具来自用例的 expected。必需、允许与禁止列表不代表固定调用顺序；仅在明确配置顺序约束时检查顺序。模拟评测中的调用来自 simulation，live / trace 中的调用来自运行记录。</p>
${report.cases.map((result) => behaviorDetail(result, report.cases.length === 1)).join('')}
<h2>失败与证据不足详情</h2>${failedDetails}
${baseline}
<script>
const applyFilters=()=>{const status=document.querySelector('#status-filter').value,domain=document.querySelector('#domain-filter').value,failure=document.querySelector('#failure-filter').value;document.querySelectorAll('#case-table tbody tr').forEach(row=>{const okStatus=status==='all'||row.dataset.status===status,okDomain=domain==='all'||row.dataset.domain===domain,okFailure=failure==='all'||row.dataset.failures.split(',').includes(failure);row.hidden=!(okStatus&&okDomain&&okFailure)});document.querySelectorAll('.case-behavior').forEach(detail=>{const row=[...document.querySelectorAll('#case-table tbody tr')].find(row=>row.dataset.caseId===detail.dataset.caseId);detail.hidden=Boolean(row?.hidden)});document.querySelectorAll('.failure-detail').forEach(detail=>{detail.hidden=domain!=='all'&&detail.dataset.domain!==domain})};document.querySelectorAll('select').forEach(select=>select.addEventListener('change',applyFilters));
</script></body></html>`
}

function caseRow(result: EvalCaseResult): string {
  const outcome = caseOutcome(result)
  const status = outcome === 'PASS' ? 'passed' : outcome === 'FAIL' ? 'failed' : 'inconclusive'
  const failures = [...new Set(result.failures.map((failure) => failure.type))]
  return `<tr class="${status}" data-case-id="${escapeHtml(result.caseId)}" data-status="${status}" data-domain="${escapeHtml(result.domain ?? 'unknown')}" data-failures="${escapeHtml(failures.join(','))}">
    <td><code>${escapeHtml(result.caseId)}</code><br>${escapeHtml(result.query)}<br><small>${escapeHtml(result.tags.join(', '))}</small></td>
    <td>${escapeHtml(result.domain ?? 'unknown')}</td><td>${outcome === 'PASS' ? '通过（PASS）' : outcome === 'FAIL' ? '失败（FAIL）' : '证据不足（INCONCLUSIVE）'}</td>
    <td>${result.semanticsVersion === 'semantics-v2' ? percent(result.scores.routing) : dimensionDisplay(result, 'discovery', result.scores.routing)}</td><td>${dimensionDisplay(result, 'discovery', result.scores.discovery)}</td><td>${dimensionDisplay(result, 'action_selection', result.scores.selection)}</td>
    <td>${dimensionDisplay(result, 'authorization', result.scores.authorization)}</td><td>${dimensionDisplay(result, 'invocation', result.scores.invocation)}</td><td>${dimensionDisplay(result, 'task_completion', result.scores.taskSuccess)}</td>
    <td>${formatLatency(result.metrics.latencyMs)}</td><td>${result.metrics.toolCalls}</td>
  </tr>`
}

function actionList(actions: readonly string[], emptyText: string): string {
  return actions.length > 0
    ? `<ul>${actions.map((action) => `<li><code>${escapeHtml(action)}</code></li>`).join('')}</ul>`
    : `<p>${emptyText}</p>`
}

type BehaviorDetailSource = Readonly<{
  caseId: string
  query: string
  expected?: EvalCaseResult['expected']
  actual?: EvalCaseResult['actual']
  semanticsVersion?: EvalCaseResult['semanticsVersion']
  taskType?: EvalCaseResult['taskType']
  expectedBehavior?: EvalCaseResult['expectedBehavior']
  dimensionResults?: EvalCaseResult['dimensionResults']
  diagnostics?: EvalCaseResult['diagnostics']
}>

function behaviorDetail(
  result: BehaviorDetailSource,
  open: boolean
): string {
  const { expected, actual } = result
  const statusLabels = { success: '成功', error: '失败', running: '运行中', unknown: '未知' }
  const calls = actual?.toolCallDetails ?? actual?.invocations.map((invocation, index) => ({
    callId: invocation.logicalInvocationId ?? `invocation-${index + 1}`,
    toolName: invocation.actionId ?? 'sciforge_invoke',
    actionId: invocation.actionId,
    operationRef: undefined,
    args: invocation.args,
    ...(invocation.output !== undefined ? { output: invocation.output } : {}),
    status: invocationOutcome(invocation) === 'success' ? 'success' as const : invocationOutcome(invocation) === 'failure' ? 'error' as const : 'unknown' as const,
    errorCode: invocation.errorCode,
    sequence: invocation.sequence ?? index
  })) ?? []
  const rows = [...calls].sort((a, b) => a.sequence - b.sequence).map((call, index) => `<tr>
    <td>${index + 1}</td><td><code>${escapeHtml(call.toolName)}</code><br><small>${escapeHtml(call.callId)}</small></td>
    <td>${call.actionId ? `<code>${escapeHtml(call.actionId)}</code>` : call.toolName === 'sciforge_invoke' ? 'Action 尚未解析' : '—'}${call.operationRef ? `<br><code>${escapeHtml(call.operationRef)}</code>` : ''}</td>
    <td>${statusLabels[call.status]}${call.errorCode ? `<br><code>${escapeHtml(call.errorCode)}</code>` : ''}</td>
    <td><details><summary>参数</summary><pre>${escapeHtml(JSON.stringify(call.args, null, 2) ?? '未记录')}</pre></details></td>
    <td>${call.output !== undefined ? `<details><summary>结构化输出</summary><pre>${escapeHtml(JSON.stringify(call.output, null, 2))}</pre></details>` : '<span>未记录</span>'}</td>
  </tr>`).join('')
  const observed = new Set(actual?.invocations.flatMap((invocation) => invocation.actionId ? [invocation.actionId] : []) ?? [])
  const missing = expected?.requiredActions.filter((action) => !observed.has(action)) ?? []
  const forbidden = expected?.forbiddenActions.filter((action) => observed.has(action)) ?? []
  const outside = expected?.allowedActions.length
    ? [...observed].filter((action): action is string => Boolean(action) && !expected.allowedActions.includes(action)) : []
  const expectedTools = expected?.tools
  const observedRuntimeTools = [...new Set((actual?.toolCallDetails ?? [])
    .map((call) => call.toolName)
    .filter((toolName) => !PROTOCOL_TOOL_NAMES.has(toolName)))]
  const missingRuntimeTools = expectedTools?.required.filter((toolName) => !observedRuntimeTools.includes(toolName)) ?? []
  const forbiddenRuntimeTools = expectedTools?.forbidden.filter((toolName) => observedRuntimeTools.includes(toolName)) ?? []
  const unnecessaryRuntimeTools = expectedTools?.unnecessary.filter((toolName) => observedRuntimeTools.includes(toolName)) ?? []
  const unexpectedRuntimeTools = expectedTools?.allowed.length
    ? observedRuntimeTools.filter((toolName) => !expectedTools.allowed.includes(toolName))
    : []
  return `<details class="case-behavior" data-case-id="${escapeHtml(result.caseId)}"${open ? ' open' : ''}>
    <summary><code>${escapeHtml(result.caseId)}</code> — ${escapeHtml(result.query)}</summary>
    <p><strong>用户任务（Query）：</strong>${escapeHtml(result.query)}</p>
    ${result.semanticsVersion ? `<p><strong>评分语义：</strong><code>${escapeHtml(result.semanticsVersion)}</code>${result.taskType ? ` · <code>${escapeHtml(result.taskType)}</code>` : ''}${result.expectedBehavior ? ` · expected behavior: <code>${escapeHtml(result.expectedBehavior)}</code>` : ''}</p>` : ''}
    ${result.dimensionResults ? `<h3>评价维度</h3><table><thead><tr><th>维度</th><th>状态</th><th>分数</th><th>说明</th></tr></thead><tbody>${Object.entries(result.dimensionResults).map(([dimension, item]) => `<tr><td><code>${escapeHtml(dimension)}</code></td><td>${item?.status ?? 'N/A'}</td><td>${item?.score === undefined ? 'N/A' : percent(item.score)}</td><td>${escapeHtml(item?.note ?? item?.failures?.map((failure) => failure.type).join(', ') ?? '')}</td></tr>`).join('')}</tbody></table>` : ''}
    ${result.diagnostics?.length ? `<p><strong>诊断项（不阻断任务通过）：</strong>${escapeHtml(result.diagnostics.map((item) => `${item.type}: ${item.message}`).join('；'))}</p>` : ''}
    <h3>预期应该调用哪些工具</h3>
    ${expected ? `<strong>必需调用（requiredActions）</strong>${actionList(expected.requiredActions, '未要求特定 Action。')}
    <strong>首选 Action（expectedActions）</strong>${actionList(expected.expectedActions ?? [], '未配置首选 Action。')}
    <strong>等价替代 Action（acceptableActions）</strong>${actionList(expected.acceptableActions ?? [], '未配置等价替代 Action。')}
    <strong>合理替代 Action 组（alternativeActionGroups）</strong>${expected.alternativeActionGroups?.map((group) => actionList(group, '无。')).join('') || '<p>无。</p>'}
    <strong>允许调用（allowedActions）</strong>${actionList(expected.allowedActions, '未配置允许列表限制；仍需遵守禁止列表。')}
    <strong>禁止调用（forbiddenActions）</strong>${actionList(expected.forbiddenActions, '未配置禁止的 Action。')}
    <strong>是否必须不调用 Capability</strong><p>${expected.noCapabilityCalls ? '是（noCapabilityCalls）' : '否'}</p>
    <strong>顺序约束</strong>${actionList((expected.ordering ?? []).map((order) => `${order.before} → ${order.after}`), '未要求固定顺序。')}
    <strong>Runtime Tool 约束</strong>
    <p>必需 Runtime Tool：</p>${actionList(expected.tools.required, '无。')}
    <p>允许的额外 Runtime Tool：</p>${actionList(expected.tools.allowed, '未配置 allow-list；观察到的非 protocol tool 默认只记入 trace，不自动判为非预期。')}
    <p>禁止 Runtime Tool：</p>${actionList(expected.tools.forbidden, '无。')}
    <p>多余 Runtime Tool：</p>${actionList(expected.tools.unnecessary, '无。')}` : '<p>此报告未保存预期工具信息。</p>'}
    <h3>实际调用了哪些工具</h3>
    <p>${actual?.toolCallDetails ? '按 trace 首次出现顺序展示，每个 callId 合并为一条记录；包含 discovery 和尚未解析 Action 的调用。重复生命周期事件不计为新调用。' : '仅展示报告中已记录的 capability 调用；没有完整的 runtime tool 明细。'} Action identity 优先来自 Host 在 terminal fact 中记录的 <code>meta.capabilityIdentity</code>；旧 trace 才使用经过校验的 structured receipt 关联。工具执行成功不等于任务完成。</p>
    <table><thead><tr><th>顺序</th><th>Tool / callId</th><th>Action / operationRef</th><th>执行结果</th><th>调用参数</th><th>实际结构化输出</th></tr></thead><tbody>${rows || '<tr><td colspan="6">没有可展示的调用记录。</td></tr>'}</tbody></table>
    <h3>Agent 最终回答</h3>
    <pre>${escapeHtml(actual?.finalAnswer ?? '没有捕获到最终回答。')}</pre>
    <h3>任务验收证据</h3>
    <p>执行状态：<code>${escapeHtml(actual?.executionStatus ?? '未记录')}</code>；任务结果：<code>${actual?.taskSuccess === undefined ? '未记录' : actual.taskSuccess ? '成功' : '失败'}</code>；最终状态来源：<code>${escapeHtml(actual?.finalStateSource ?? '未记录')}</code></p>
    <p>效率诊断：tool_call_count=${actual?.toolCallDetails?.length ?? actual?.invocations.length ?? 0}；retry_count=${actual?.retryCount ?? 0}；latency=${formatLatency(actual?.taskLatencyMs ?? actual?.latencyMs ?? 0)}；token_usage=${actual?.usage ? escapeHtml(JSON.stringify(actual.usage)) : 'N/A'}</p>
    ${actual?.workspaceSnapshotDirectory ? `<p>实际工作区快照：<code>${escapeHtml(actual.workspaceSnapshotDirectory)}</code></p>` : ''}
    <pre>${escapeHtml(JSON.stringify({
      finalState: actual?.finalState ?? null,
      evidence: actual?.evidence ?? [],
      evidenceStatus: actual?.evidenceStatus ?? null,
      expectedLatestSeq: actual?.expectedLatestSeq ?? null,
      observedLatestSeq: actual?.observedLatestSeq ?? null,
      traceSequenceWarning: actual?.traceSequenceWarning ?? null,
      traceStatusWarning: actual?.traceStatusWarning ?? null,
      traceCollectionError: actual?.traceCollectionError ?? null,
      tracePersistenceError: actual?.tracePersistenceError ?? null,
      executionError: actual?.executionError ?? null
    }, null, 2))}</pre>
    <h3>预期与实际对照</h3>
    <strong>未见可识别调用记录的必需 Action</strong>${actionList(missing, expected ? '无。' : '缺少预期工具信息，无法对照。')}
    <strong>未见的必需 Runtime Tool</strong>${actionList(missingRuntimeTools, expected ? '无。' : '缺少预期工具信息，无法对照。')}
    <strong>已调用的禁止 Action</strong>${actionList(forbidden, '无可识别记录。')}
    <strong>已调用的禁止 Runtime Tool</strong>${actionList(forbiddenRuntimeTools, '无。')}
    <strong>已调用的多余 Runtime Tool</strong>${actionList(unnecessaryRuntimeTools, '无。')}
    <strong>允许列表之外的已识别 Action</strong>${actionList(outside, '无可识别记录，或未配置允许列表限制。')}
    <strong>允许列表之外的 Runtime Tool</strong>${actionList(unexpectedRuntimeTools, expectedTools?.allowed.length ? '无。' : '未配置 Runtime Tool allow-list。')}
    <p>尚未解析的 Action 无法参与上述对照；缺少可识别记录不等于 Agent 从未尝试调用该能力。成功、失败及任务完成情况请结合执行结果和评分查看。</p>
  </details>`
}

function baselineTable(comparison: EvalBaselineComparison): string {
  const keys: readonly EvalMetricKey[] = [
    'routingAccuracy', 'discoveryRecall', 'actionSelectionAccuracy', 'authorizationAccuracy',
    'contractPassRate', 'runtimeToolSuccessRate', 'rawInvocationSuccessRate', 'unexpectedInvocationFailureRate',
    'expectedFailureHandlingAccuracy', 'retryRecoveryRate', 'taskOutcomeAccuracy', 'rawTaskSuccessRate',
    'averageToolCalls', 'averageRetryCount', 'averageLatencyMs', 'requiredDomainAccuracy',
    'multiStepCompletionRate', 'finalStateAccuracy', 'forbiddenActionRate', 'unnecessaryToolCallRate',
    'firstAttemptSuccessRate', 'eventualInvocationSuccessRate', 'averageApprovalCount',
    'averageCapabilityToolCalls', 'averageTaskLatencyMs', 'unnecessaryCallsPerTask',
    'passYield', 'evaluableCoverage', 'unresolvedActionRate'
  ]
  const rows = keys.map((key) => `<tr><td>${escapeHtml(METRIC_LABELS[key])}</td><td>${formatMetric(comparison.baseline[key], key)}</td><td>${formatMetric(comparison.current[key], key)}</td><td class="${(comparison.delta[key] ?? 0) >= 0 ? 'delta-positive' : 'delta-negative'}">${formatDelta(key, comparison.delta[key])}</td></tr>`).join('')
  return `<h2>基线对比</h2><table><thead><tr><th>指标</th><th>基线</th><th>当前</th><th>变化</th></tr></thead><tbody>${rows}</tbody></table>`
}

function aggregateDomains(results: readonly EvalCaseResult[]): Readonly<Record<string, EvalDomainAggregate>> {
  const groups = new Map<string, EvalCaseResult[]>()
  for (const result of results) {
    const domain = result.domain ?? 'unknown'
    const group = groups.get(domain) ?? []
    group.push(result)
    groups.set(domain, group)
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([domain, group]) => {
    const invocations = group.flatMap((result) => result.actual.invocations)
    const groupOutcomes = group.map((result) => caseOutcome(result))
    const passed = groupOutcomes.filter((outcome) => outcome === 'PASS').length
    const failed = groupOutcomes.filter((outcome) => outcome === 'FAIL').length
    const inconclusive = groupOutcomes.filter((outcome) => outcome === 'INCONCLUSIVE').length
    const decisiveCases = passed + failed
    const taskEvidence = group.filter((result) => (
      result.actual.taskSuccess !== undefined && hasTaskCompletionContract(result)
    ))
    return [domain, {
      total: group.length,
      passed,
      failed,
      inconclusive,
      decisiveCases,
      passRate: ratio(passed, decisiveCases),
      routingAccuracy: averageScoresOrNull(group, (result) => result.scores.routing),
      discoveryRecall: averageScoresOrNull(group, (result) => dimensionScore(result, 'discovery', result.scores.discovery)),
      actionSelectionAccuracy: averageScoresOrNull(group, (result) => dimensionScore(result, 'action_selection', result.scores.selection)),
      argumentAccuracy: averageScoresOrNull(group, (result) => dimensionScore(result, 'arguments', result.scores.arguments)),
      authorizationAccuracy: averageScoresOrNull(group, (result) => dimensionScore(result, 'authorization', result.scores.authorization)),
      invocationSuccessRate: ratio(invocations.filter(invocationSucceeded).length, invocations.length),
      taskSuccessRate: ratio(
        taskEvidence.filter((result) => result.actual.taskSuccess === true).length,
        taskEvidence.length
      )
    } satisfies EvalDomainAggregate]
  }))
}

function aggregateFailures(results: readonly EvalCaseResult[]): Readonly<Record<string, EvalFailureAggregate>> {
  const counts = new Map<string, number>()
  for (const result of results) {
    for (const type of new Set(result.failures.map((failure) => failure.type))) {
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([type, count]) => [type, {
    count,
    rate: results.length === 0 ? 0 : count / results.length
  } satisfies EvalFailureAggregate]))
}

function isExpectedFailureInvocation(
  result: EvalCaseResult,
  invocation: EvalCaseResult['invocations'][number]
): boolean {
  const expectation = result.expectedFailure
  return expectation !== undefined &&
    expectation.actionId === invocation.actionId &&
    invocationFailed(invocation) &&
    (expectation.errorCode === undefined || expectation.errorCode === invocation.errorCode)
}

function invocationSucceeded(invocation: EvalCaseResult['invocations'][number]): boolean {
  return invocation.outcome === 'success' || (invocation.outcome === undefined && invocation.success)
}

function invocationFailed(invocation: EvalCaseResult['invocations'][number]): boolean {
  return invocation.outcome === 'failure' || (invocation.outcome === undefined && !invocation.success)
}

function invocationOutcome(invocation: EvalCaseResult['invocations'][number]): 'success' | 'failure' | 'unknown' {
  if (invocation.outcome) return invocation.outcome
  return invocation.success ? 'success' : 'failure'
}

function isWorkflowCase(result: EvalCaseResult): boolean {
  return result.workflowType !== undefined ||
    result.tags.includes('multi-step') ||
    result.tags.includes('cross-domain') ||
    (result.expected.requiredDomains ?? []).length > 1
}

function taskCompleted(result: EvalCaseResult): boolean {
  const requiredActionsCompleted = result.expected.requiredActions.every((actionId) => (
    result.actual.invocations.some((invocation) => invocation.actionId === actionId && invocationSucceeded(invocation))
  ))
  const finalStateCompleted = (result.expectedFinalState?.assertions.length ?? 0) === 0 ||
    dimensionScore(result, 'result_correctness', result.scores.finalState) === 1
  const taskScore = dimensionScore(result, 'task_completion', result.scores.taskSuccess)
  return requiredActionsCompleted && finalStateCompleted && taskScore === 1
}

function hasTaskCompletionContract(result: EvalCaseResult): boolean {
  if (result.semanticsVersion !== 'semantics-v2') return true
  if (result.taskType === 'end_to_end') return true
  const status = result.dimensionResults?.task_completion?.status
  return status === 'PASS' || status === 'FAIL' || status === 'INCONCLUSIVE'
}

function coverage(denominator: number, numerator: number): { numerator: number; denominator: number } {
  return { numerator, denominator }
}

function baselineComparison(baseline: EvalAggregateMetrics, current: EvalAggregateMetrics): EvalBaselineComparison {
  const normalizedBaseline = Object.fromEntries(METRIC_KEYS.map((key) => [key, baseline[key] ?? null])) as EvalAggregateMetrics
  const delta = Object.fromEntries(METRIC_KEYS.map((key) => [
    key,
    current[key] === null || current[key] === undefined || normalizedBaseline[key] === null || normalizedBaseline[key] === undefined
      ? null
      : current[key] - normalizedBaseline[key]
  ])) as EvalAggregateMetrics
  return { baseline: normalizedBaseline, current, delta }
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}

function averageOrNull(values: readonly number[]): number | null {
  return values.length === 0 ? null : average(values)
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function metricDisplay(value: number | null): string {
  return value === null ? 'N/A' : percent(value)
}

function formatLatency(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)}s` : `${value.toFixed(0)}ms`
}

function formatMetric(value: number | null | undefined, key: EvalMetricKey): string {
  if (value === null || value === undefined) return 'N/A'
  return key === 'averageToolCalls' || key === 'averageRetryCount' || key === 'averageApprovalCount' || key === 'averageCapabilityToolCalls' || key === 'unnecessaryCallsPerTask'
    ? value.toFixed(2)
    : key === 'averageLatencyMs' || key === 'averageTaskLatencyMs'
      ? formatLatency(value)
      : percent(value)
}

function metricPercent(report: EvalAggregateReport, key: EvalMetricKey): string {
  return hasNoObservations(report, key) || report.metrics[key] === null ? 'N/A' : percent(report.metrics[key] as number)
}

function metricAverage(report: EvalAggregateReport, key: EvalMetricKey): string {
  return hasNoObservations(report, key) ? 'N/A' : formatMetric(report.metrics[key], key)
}

function hasNoObservations(report: EvalAggregateReport, key: EvalMetricKey): boolean {
  return report.metricCoverage?.[key]?.denominator === 0
}

function formatDelta(key: EvalMetricKey, value: number | null): string {
  if (value === null) return 'N/A'
  const prefix = value >= 0 ? '+' : ''
  return key === 'averageToolCalls' || key === 'averageRetryCount' || key === 'averageApprovalCount' || key === 'averageCapabilityToolCalls' || key === 'unnecessaryCallsPerTask'
    ? `${prefix}${value.toFixed(2)}`
    : key === 'averageLatencyMs' || key === 'averageTaskLatencyMs'
      ? `${prefix}${formatLatency(Math.abs(value))}`
      : `${prefix}${(value * 100).toFixed(1)}pp`
}

function reportTitle(report: EvalAggregateReport): string {
  return report.scope === 'agent-workflow'
    ? 'Capability Golden Regression（Agent Workflow）'
    : 'Capability Golden Regression'
}

function isExplicitWorkflowCase(result: EvalCaseResult): boolean {
  return result.workflowType !== undefined ||
    result.tags.includes('cross-domain') ||
    (result.expected.requiredDomains ?? []).length > 1
}

function caseOutcome(result: EvalCaseResult): 'PASS' | 'FAIL' | 'INCONCLUSIVE' {
  // Older callers may construct a result without updating outcome after
  // changing passed. Preserve that compatibility while trusting the runner's
  // explicit INCONCLUSIVE outcome for infrastructure evidence gaps.
  if (result.outcome === 'PASS' && !result.passed) return 'FAIL'
  return result.outcome
}

function hasCompleteEvidence(result: EvalCaseResult): boolean {
  return result.actual.evidenceStatus !== 'partial' && result.actual.evidenceStatus !== 'unavailable'
}

function hasFinalStateContract(result: EvalCaseResult): boolean {
  return (result.expectedFinalState?.assertions.length ?? 0) > 0 ||
    (result.expectedFinalState?.artifacts?.length ?? 0) > 0 ||
    (result.expectedFinalState?.dataLineage?.length ?? 0) > 0
}

function hasArtifactEvidence(result: EvalCaseResult): boolean {
  if (result.actual.finalStateSource !== 'inspector' || !isRecord(result.actual.finalState)) return false
  const expectedArtifacts = result.expectedFinalState?.artifacts ?? []
  const actualArtifacts = result.actual.finalState.artifacts
  return isRecord(actualArtifacts) && Object.keys(actualArtifacts).length >= expectedArtifacts.length &&
    Object.values(actualArtifacts).every((value) => !isRecord(value) || value.status !== 'unsupported')
}

function hasLineageEvidence(result: EvalCaseResult): boolean {
  if (result.actual.finalStateSource !== 'inspector' || !isRecord(result.actual.finalState)) return false
  const expectedLineage = result.expectedFinalState?.dataLineage ?? []
  const actualLineage = result.actual.finalState.dataLineage
  return isRecord(actualLineage) && Object.keys(actualLineage).length >= expectedLineage.length &&
    Object.values(actualLineage).every((value) => !isRecord(value) || value.status !== 'unsupported')
}

function hasFinalStateEvidence(result: EvalCaseResult): boolean {
  return hasCompleteEvidence(result) && result.actual.finalStateSource === 'inspector' &&
    isRecord(result.actual.finalState) &&
    ((result.expectedFinalState?.artifacts?.length ?? 0) === 0 || hasArtifactEvidence(result)) &&
    ((result.expectedFinalState?.dataLineage?.length ?? 0) === 0 || hasLineageEvidence(result))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function coverageText(value: EvalEvidenceCoverage[keyof EvalEvidenceCoverage] | undefined): string {
  return value ? `${value.numerator}/${value.denominator}` : 'N/A'
}

function dimensionScore(
  result: EvalCaseResult,
  dimension: keyof NonNullable<EvalCaseResult['dimensionResults']>,
  legacyScore: number
): number | undefined {
  if (result.semanticsVersion !== 'semantics-v2') return legacyScore
  const value = result.dimensionResults?.[dimension]
  if (!value || value.status === 'N/A' || value.status === 'INCONCLUSIVE') return undefined
  return value.score ?? (value.status === 'PASS' ? 1 : 0)
}

function dimensionDisplay(result: EvalCaseResult, dimension: keyof NonNullable<EvalCaseResult['dimensionResults']>, legacyScore: number): string {
  const score = dimensionScore(result, dimension, legacyScore)
  return score === undefined ? 'N/A' : percent(score)
}

function averageScoresOrNull(
  results: readonly EvalCaseResult[],
  score: (result: EvalCaseResult) => number | undefined
): number | null {
  return averageOrNull(results.map(score).filter((value): value is number => value !== undefined))
}

function scoreCoverage(
  results: readonly EvalCaseResult[],
  score: (result: EvalCaseResult) => number | undefined
): { numerator: number; denominator: number } {
  const values = results.map(score).filter((value): value is number => value !== undefined)
  return {
    numerator: values.reduce((total, value) => total + value, 0),
    denominator: values.length
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

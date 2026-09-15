import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  CAPABILITY_EVAL_SCHEMA_VERSION,
  type EvalAggregateMetrics,
  type EvalAggregateReport,
  type EvalBaselineComparison,
  type EvalCaseResult,
  type EvalDomainAggregate,
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
  'taskSuccessRate',
  'averageToolCalls',
  'averageRetryCount',
  'averageLatencyMs'
]

export type CreateReportOptions = Readonly<{
  executionMode: EvalAggregateReport['executionMode']
  capabilityReference?: string
  generatedAt?: string
  baseline?: EvalAggregateReport
}>

export function createAggregateReport(
  results: readonly EvalCaseResult[],
  options: CreateReportOptions
): EvalAggregateReport {
  const totalCases = results.length
  const passed = results.filter((result) => result.passed).length
  const invocationValues = results.flatMap((result) => result.actual.invocations)
  const metrics: EvalAggregateMetrics = {
    routingAccuracy: average(results.map((result) => result.scores.routing)),
    discoveryRecall: average(results.map((result) => result.scores.discovery)),
    actionSelectionAccuracy: average(results.map((result) => result.scores.selection)),
    argumentAccuracy: average(results.map((result) => result.scores.arguments)),
    authorizationAccuracy: average(results.map((result) => result.scores.authorization)),
    invocationSuccessRate: invocationValues.length === 0
      ? 1
      : invocationValues.filter((invocation) => invocation.success).length / invocationValues.length,
    taskSuccessRate: totalCases === 0
      ? 0
      : results.filter((result) => result.actual.taskSuccess === true).length / totalCases,
    averageToolCalls: average(results.map((result) => result.metrics.toolCalls)),
    averageRetryCount: average(results.map((result) => result.metrics.retryCount)),
    averageLatencyMs: average(results.map((result) => result.metrics.latencyMs))
  }
  const report: EvalAggregateReport = {
    schemaVersion: CAPABILITY_EVAL_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    runKind: 'golden-regression',
    executionMode: options.executionMode,
    ...(options.capabilityReference ? { capabilityReference: options.capabilityReference } : {}),
    totalCases,
    passed,
    failed: totalCases - passed,
    passRate: totalCases === 0 ? 0 : passed / totalCases,
    metrics,
    domainBreakdown: aggregateDomains(results),
    failureBreakdown: aggregateFailures(results),
    failures: results.filter((result) => !result.passed).map((result) => result.caseId),
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
    evaluatorTestResult: result.passed ? 'FAIL' : 'PASS',
    detectedFailures: [...result.failures]
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
    `Evaluator Self-Test (${report.executionMode})`,
    `Total Cases: ${report.totalCases}`,
    `Expected Failures Detected: ${report.expectedFailuresDetected}`,
    `Missed Failures: ${report.missedFailures}`,
    `Detection Rate: ${percent(report.detectionRate)}`
  ]
  const missed = report.cases.filter((result) => result.evaluatorTestResult === 'FAIL').map((result) => result.caseId)
  if (missed.length > 0) lines.push('', `Missed Cases: ${missed.join(', ')}`)
  return lines.join('\n')
}

export function renderSelfTestHtmlReport(report: EvalSelfTestReport): string {
  const rows = report.cases.map((result) => {
    const failures = [...new Set(result.detectedFailures.map((failure) => failure.type))]
    return `<tr class="${result.evaluatorTestResult === 'PASS' ? 'passed' : 'failed'}"><td><code>${escapeHtml(result.caseId)}</code></td><td>${result.subjectResult}</td><td>${result.evaluatorTestResult}</td><td>${escapeHtml(failures.join(', ') || 'none')}</td></tr>`
  }).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evaluator Self-Test</title>
<style>body{font:14px/1.45 system-ui,sans-serif;color:#172033;background:#f5f7fb;margin:0 auto;padding:24px;max-width:1100px}table{border-collapse:collapse;width:100%;background:white;border:1px solid #e2e8f0}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0}th{background:#eef2f7}.passed{background:#f0fdf4}.failed{background:#fff1f2}.cards{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.card{background:white;border:1px solid #e2e8f0;border-radius:8px;padding:12px}.card strong{display:block;font-size:22px}</style></head><body>
<h1>Evaluator Self-Test</h1><p>Subject failures are expected. The evaluator test passes when a case produces at least one evaluator failure.</p>
<div class="cards"><div class="card">Total Cases<strong>${report.totalCases}</strong></div><div class="card">Expected Failures Detected<strong>${report.expectedFailuresDetected}</strong></div><div class="card">Missed Failures<strong>${report.missedFailures}</strong></div><div class="card">Detection Rate<strong>${percent(report.detectionRate)}</strong></div></div>
<table><thead><tr><th>Case</th><th>Subject Result</th><th>Evaluator Test</th><th>Detected Failures</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No cases.</td></tr>'}</tbody></table>
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
    `Capability Golden Regression (${report.executionMode})`,
    `Total Cases: ${report.totalCases}`,
    `Passed: ${report.passed}`,
    `Failed: ${report.failed}`,
    `Pass Rate: ${percent(report.passRate)}`,
    '',
    `Routing Accuracy: ${percent(report.metrics.routingAccuracy)}`,
    `Discovery Recall: ${percent(report.metrics.discoveryRecall)}`,
    `Action Selection Accuracy: ${percent(report.metrics.actionSelectionAccuracy)}`,
    `Argument Accuracy: ${percent(report.metrics.argumentAccuracy)}`,
    `Authorization Accuracy: ${percent(report.metrics.authorizationAccuracy)}`,
    `Invocation Success Rate: ${percent(report.metrics.invocationSuccessRate)}`,
    `Task Success Rate: ${percent(report.metrics.taskSuccessRate)}`,
    '',
    `Average Tool Calls: ${report.metrics.averageToolCalls.toFixed(2)}`,
    `Average Retry Count: ${report.metrics.averageRetryCount.toFixed(2)}`,
    `Average Latency: ${formatLatency(report.metrics.averageLatencyMs)}`
  ]
  if (report.failures.length > 0) {
    lines.push('', `Failed Cases: ${report.failures.join(', ')}`)
  }
  return lines.join('\n')
}

export function renderHtmlReport(report: EvalAggregateReport): string {
  const metricCards = [
    ['Total Cases', String(report.totalCases)],
    ['Passed', String(report.passed)],
    ['Failed', String(report.failed)],
    ['Pass Rate', percent(report.passRate)],
    ['Routing Accuracy', percent(report.metrics.routingAccuracy)],
    ['Discovery Recall', percent(report.metrics.discoveryRecall)],
    ['Selection Accuracy', percent(report.metrics.actionSelectionAccuracy)],
    ['Argument Accuracy', percent(report.metrics.argumentAccuracy)],
    ['Authorization Accuracy', percent(report.metrics.authorizationAccuracy)],
    ['Invocation Success', percent(report.metrics.invocationSuccessRate)],
    ['Task Success', percent(report.metrics.taskSuccessRate)],
    ['Avg Tool Calls', report.metrics.averageToolCalls.toFixed(2)],
    ['Avg Retry', report.metrics.averageRetryCount.toFixed(2)],
    ['Avg Latency', formatLatency(report.metrics.averageLatencyMs)]
  ].map(([label, value]) => `<div class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')

  const domains = Object.entries(report.domainBreakdown).map(([domain, value]) => `
    <tr>
      <td>${escapeHtml(domain)}</td><td>${value.total}</td><td>${value.passed}</td><td>${percent(value.passRate)}</td>
      <td>${percent(value.routingAccuracy)}</td><td>${percent(value.discoveryRecall)}</td>
      <td>${percent(value.actionSelectionAccuracy)}</td><td>${percent(value.authorizationAccuracy)}</td>
      <td>${percent(value.taskSuccessRate)}</td>
    </tr>`).join('')
  const failureRows = Object.entries(report.failureBreakdown).map(([type, value]) => `
    <tr><td>${escapeHtml(type)}</td><td>${value.count}</td><td>${percent(value.rate)}</td></tr>`).join('')
  const domainOptions = Object.keys(report.domainBreakdown).map((domain) => `<option value="${escapeHtml(domain)}">${escapeHtml(domain)}</option>`).join('')
  const failureOptions = Object.keys(report.failureBreakdown).map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('')
  const caseRows = report.cases.map((result) => caseRow(result)).join('')
  const failedDetails = report.cases.filter((result) => !result.passed).map((result) => `
    <details class="failure-detail" data-domain="${escapeHtml(result.domain ?? 'unknown')}">
      <summary>${escapeHtml(result.caseId)} — ${escapeHtml(result.failures.map((failure) => failure.type).join(', '))}</summary>
      <p><strong>Query:</strong> ${escapeHtml(result.query)}</p>
      <pre>${escapeHtml(JSON.stringify({
        expected: result.expected,
        actual: result.actual,
        rubric: result.rubric,
        failures: result.failures
      }, null, 2))}</pre>
    </details>`).join('') || '<p>No failed cases.</p>'
  const baseline = report.baselineComparison ? baselineTable(report.baselineComparison) : ''

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SciForge Capability Eval</title>
<style>
:root{font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb}
body{margin:0;padding:24px;max-width:1440px;margin-inline:auto}h1{margin:0 0 4px}h2{margin-top:32px}small{color:#64748b}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-top:20px}.card{background:white;border:1px solid #e2e8f0;border-radius:10px;padding:12px;box-shadow:0 1px 2px #0f172a0d}.card span{display:block;color:#64748b;font-size:12px}.card strong{display:block;font-size:22px;margin-top:4px}table{border-collapse:collapse;width:100%;background:white;border:1px solid #e2e8f0}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top}th{background:#eef2f7;font-size:12px;color:#475569}tr.failed{background:#fff1f2}select{padding:7px;border:1px solid #cbd5e1;border-radius:6px;margin:0 8px 10px 0;background:white}.filters{margin-top:12px}details{background:white;border:1px solid #fecdd3;border-radius:8px;padding:10px;margin:8px 0}pre{white-space:pre-wrap;overflow:auto;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:6px;font-size:12px}.delta-positive{color:#15803d}.delta-negative{color:#b91c1c}
</style></head><body>
<h1>Capability Golden Regression</h1><small>Generated ${escapeHtml(report.generatedAt)} · mode ${escapeHtml(report.executionMode)}${report.capabilityReference ? ` · reference ${escapeHtml(basename(report.capabilityReference))}` : ''}</small>
<div class="cards">${metricCards}</div>
<h2>Domain Breakdown</h2>
<table><thead><tr><th>Domain</th><th>Total</th><th>Passed</th><th>Pass</th><th>Routing</th><th>Discovery</th><th>Selection</th><th>Authorization</th><th>Task Success</th></tr></thead><tbody>${domains || '<tr><td colspan="9">No cases.</td></tr>'}</tbody></table>
<h2>Failure Breakdown</h2>
<table><thead><tr><th>Failure Type</th><th>Count</th><th>Case Rate</th></tr></thead><tbody>${failureRows || '<tr><td colspan="3">No failures.</td></tr>'}</tbody></table>
<h2>Cases</h2>
<div class="filters"><label>Status <select id="status-filter"><option value="all">all</option><option value="passed">passed</option><option value="failed">failed</option></select></label><label>Domain <select id="domain-filter"><option value="all">all</option>${domainOptions}</select></label><label>Failure <select id="failure-filter"><option value="all">all</option>${failureOptions}</select></label></div>
<table id="case-table"><thead><tr><th>Case</th><th>Domain</th><th>Status</th><th>Routing</th><th>Discovery</th><th>Selection</th><th>Authorization</th><th>Invocation</th><th>Task</th><th>Latency</th><th>Calls</th></tr></thead><tbody>${caseRows}</tbody></table>
<h2>Failed Case Detail</h2>${failedDetails}
${baseline}
<script>
const applyFilters=()=>{const status=document.querySelector('#status-filter').value,domain=document.querySelector('#domain-filter').value,failure=document.querySelector('#failure-filter').value;document.querySelectorAll('#case-table tbody tr').forEach(row=>{const okStatus=status==='all'||row.dataset.status===status,okDomain=domain==='all'||row.dataset.domain===domain,okFailure=failure==='all'||row.dataset.failures.split(',').includes(failure);row.hidden=!(okStatus&&okDomain&&okFailure)});document.querySelectorAll('.failure-detail').forEach(detail=>{detail.hidden=domain!=='all'&&detail.dataset.domain!==domain})};document.querySelectorAll('select').forEach(select=>select.addEventListener('change',applyFilters));
</script></body></html>`
}

function caseRow(result: EvalCaseResult): string {
  const status = result.passed ? 'passed' : 'failed'
  const failures = [...new Set(result.failures.map((failure) => failure.type))]
  return `<tr class="${status}" data-status="${status}" data-domain="${escapeHtml(result.domain ?? 'unknown')}" data-failures="${escapeHtml(failures.join(','))}">
    <td><code>${escapeHtml(result.caseId)}</code><br><small>${escapeHtml(result.tags.join(', '))}</small></td>
    <td>${escapeHtml(result.domain ?? 'unknown')}</td><td>${status}</td>
    <td>${percent(result.scores.routing)}</td><td>${percent(result.scores.discovery)}</td><td>${percent(result.scores.selection)}</td>
    <td>${percent(result.scores.authorization)}</td><td>${percent(result.scores.invocation)}</td><td>${percent(result.scores.taskSuccess)}</td>
    <td>${formatLatency(result.metrics.latencyMs)}</td><td>${result.metrics.toolCalls}</td>
  </tr>`
}

function baselineTable(comparison: EvalBaselineComparison): string {
  const keys: readonly EvalMetricKey[] = [
    'routingAccuracy', 'discoveryRecall', 'actionSelectionAccuracy', 'authorizationAccuracy',
    'invocationSuccessRate', 'taskSuccessRate', 'averageToolCalls', 'averageRetryCount', 'averageLatencyMs'
  ]
  const rows = keys.map((key) => `<tr><td>${escapeHtml(key)}</td><td>${formatMetric(key, comparison.baseline[key])}</td><td>${formatMetric(key, comparison.current[key])}</td><td class="${comparison.delta[key] >= 0 ? 'delta-positive' : 'delta-negative'}">${formatDelta(key, comparison.delta[key])}</td></tr>`).join('')
  return `<h2>Baseline Comparison</h2><table><thead><tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Delta</th></tr></thead><tbody>${rows}</tbody></table>`
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
    return [domain, {
      total: group.length,
      passed: group.filter((result) => result.passed).length,
      passRate: average(group.map((result) => result.passed ? 1 : 0)),
      routingAccuracy: average(group.map((result) => result.scores.routing)),
      discoveryRecall: average(group.map((result) => result.scores.discovery)),
      actionSelectionAccuracy: average(group.map((result) => result.scores.selection)),
      argumentAccuracy: average(group.map((result) => result.scores.arguments)),
      authorizationAccuracy: average(group.map((result) => result.scores.authorization)),
      invocationSuccessRate: invocations.length === 0 ? 1 : invocations.filter((invocation) => invocation.success).length / invocations.length,
      taskSuccessRate: average(group.map((result) => result.actual.taskSuccess === true ? 1 : 0))
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

function baselineComparison(baseline: EvalAggregateMetrics, current: EvalAggregateMetrics): EvalBaselineComparison {
  const delta = Object.fromEntries(METRIC_KEYS.map((key) => [key, current[key] - baseline[key]])) as EvalAggregateMetrics
  return { baseline, current, delta }
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatLatency(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)}s` : `${value.toFixed(0)}ms`
}

function formatMetric(key: EvalMetricKey, value: number): string {
  return key === 'averageToolCalls' || key === 'averageRetryCount'
    ? value.toFixed(2)
    : key === 'averageLatencyMs'
      ? formatLatency(value)
      : percent(value)
}

function formatDelta(key: EvalMetricKey, value: number): string {
  const prefix = value >= 0 ? '+' : ''
  return key === 'averageToolCalls' || key === 'averageRetryCount'
    ? `${prefix}${value.toFixed(2)}`
    : key === 'averageLatencyMs'
      ? `${prefix}${formatLatency(Math.abs(value))}`
      : `${prefix}${(value * 100).toFixed(1)}pp`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

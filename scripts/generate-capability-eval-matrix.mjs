#!/usr/bin/env node

/**
 * Builds the product-scenario evaluation matrix from canonical capability case
 * files and persisted evaluator reports. This is an inventory/reporting
 * boundary; it does not change case contracts or turn simulation into live
 * evidence.
 */

import { createHash } from 'node:crypto'
import { access, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const capabilityCasesDirectory = path.join(root, 'eval-cases/capability')
const defaultJsonPath = path.join(capabilityCasesDirectory, 'evaluation-matrix.json')
const defaultMarkdownPath = path.join(root, 'docs/generated/capability-evaluation-matrix.md')
const defaultHtmlPath = path.join(root, 'docs/generated/capability-evaluation-matrix.html')
const scenarioCatalogPath = path.join(capabilityCasesDirectory, 'product-scenario-catalog.json')
const defaultEvidenceRoot = path.join(root, 'eval-results')

export const MATRIX_SCHEMA_VERSION = 'sciforge.capability-eval.matrix.v1'

export const MATRIX_DIMENSIONS = [
  {
    id: 'runtime',
    label: '运行可用性',
    description: 'Host、模型响应、事件流和终态是否可观测。',
    evidence: 'live-agent'
  },
  {
    id: 'interaction',
    label: '理解与交互',
    description: '任务理解、澄清、无工具边界和多轮行为。',
    evidence: 'live-agent'
  },
  {
    id: 'tool_execution',
    label: '工具执行',
    description: '发现、选择、参数、授权和 Capability 调用。',
    evidence: 'live-agent-or-deterministic-contract'
  },
  {
    id: 'task_result',
    label: '任务结果',
    description: '用户目标、回答正确性和 rubric 是否满足。',
    evidence: 'independent-oracle-or-rubric'
  },
  {
    id: 'state',
    label: '状态与产物',
    description: '最终状态、文件内容和数据血缘是否独立核验。',
    evidence: 'independent-final-state'
  },
  {
    id: 'robustness',
    label: '鲁棒与安全',
    description: '故障、重试、授权拒绝、取消和无副作用。',
    evidence: 'controlled-live'
  }
]

const TOOL_DIMENSIONS = new Set(['discovery', 'action_selection', 'arguments', 'authorization', 'invocation'])
const RESULT_DIMENSIONS = new Set(['task_completion', 'result_correctness'])
const STATE_DIMENSIONS = new Set(['artifact_state_correctness'])
const ROBUSTNESS_TAG = /adversarial|approval|cancel|deny|empty|fault|failure|retry|robust|timeout/iu
const CANONICAL_FILE = /^(?:golden|natural-routing-v2|workflow-golden|workflow-scenarios)\.jsonl$/u
const AUXILIARY_FILE = /-(?:live|controlled)\.jsonl$/u
const CORE_FILE = /^core-scenarios-v1\.jsonl$/u

const MATRIX_TO_EVAL_DIMENSIONS = {
  interaction: ['behavior'],
  tool_execution: ['discovery', 'action_selection', 'arguments', 'authorization', 'invocation'],
  task_result: ['task_completion', 'result_correctness'],
  state: ['artifact_state_correctness'],
  robustness: ['robustness']
}

if (isMainModule()) {
  await main()
}

export function deriveCaseMatrixContract(evalCase) {
  const declared = new Set(evalCase.evaluationDimensions ?? [])
  const expected = evalCase.expected ?? {}
  const dimensions = {}

  dimensions.runtime = { source: 'harness', covered: true }
  dimensions.interaction = declared.has('behavior')
    ? { source: 'declared', covered: true }
    : expectedBehaviorContract(evalCase)
      ? { source: 'inferred', covered: true }
      : { source: 'absent', covered: false }
  dimensions.tool_execution = hasToolContract(evalCase)
    ? { source: declared.size > 0 && [...declared].some((value) => TOOL_DIMENSIONS.has(value)) ? 'declared' : 'inferred', covered: true }
    : { source: 'absent', covered: false }
  dimensions.task_result = hasResultContract(evalCase)
    ? { source: declared.size > 0 && [...declared].some((value) => RESULT_DIMENSIONS.has(value)) ? 'declared' : 'inferred', covered: true }
    : { source: 'absent', covered: false }
  dimensions.state = hasStateContract(evalCase)
    ? { source: declared.has('artifact_state_correctness') ? 'declared' : 'inferred', covered: true }
    : { source: 'absent', covered: false }
  dimensions.robustness = hasRobustnessContract(evalCase)
    ? { source: declared.has('robustness') ? 'declared' : 'inferred', covered: true }
    : { source: 'absent', covered: false }
  return dimensions
}

export function createEvaluationMatrix(cases, observations = [], catalog = []) {
  const canonicalCases = deduplicateCases(cases.map((entry) => (
    entry.case
      ? { case: entry.case, sources: entry.sources ?? (entry.source ? [entry.source] : []) }
      : { case: entry, sources: entry.source ? [entry.source] : [] }
  )))
  const observationsByCase = groupBy(observations, (observation) => observation.caseId)
  const scenarios = new Map()

  for (const catalogEntry of catalog) {
    if (!catalogEntry || typeof catalogEntry.scenarioId !== 'string') continue
    scenarios.set(catalogEntry.scenarioId, {
      scenarioId: catalogEntry.scenarioId,
      domain: catalogEntry.domain ?? 'unknown',
      taskType: catalogEntry.taskType ?? 'end_to_end',
      workflowTypes: new Set(catalogEntry.workflowType ? [catalogEntry.workflowType] : []),
      tags: new Set(catalogEntry.tags ?? []),
      caseIds: new Set(),
      sourceFiles: new Set(['eval-cases/capability/product-scenario-catalog.json']),
      cases: [],
      observations: [],
      catalog: catalogEntry
    })
  }

  for (const entry of canonicalCases) {
    const scenarioId = entry.case.scenarioId ?? entry.case.id
    const scenario = scenarios.get(scenarioId) ?? {
      scenarioId,
      domain: domainOf(entry.case),
      taskType: entry.case.taskType ?? inferTaskType(entry.case),
      workflowTypes: new Set(),
      tags: new Set(),
      caseIds: new Set(),
      sourceFiles: new Set(),
      cases: [],
      observations: [],
      catalog: undefined
    }
    scenario.domain = scenario.domain === 'unknown' ? domainOf(entry.case) : scenario.domain
    if (entry.case.workflowType) scenario.workflowTypes.add(entry.case.workflowType)
    for (const tag of entry.case.tags ?? []) scenario.tags.add(tag)
    scenario.caseIds.add(entry.case.id)
    for (const source of entry.sources) scenario.sourceFiles.add(source)
    scenario.cases.push(entry.case)
    scenario.observations.push(...(observationsByCase.get(entry.case.id) ?? []))
    scenarios.set(scenarioId, scenario)
  }

  const scenarioRows = [...scenarios.values()]
    .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))
    .map((scenario) => {
      const contracts = mergeContracts(scenario.cases, scenario.catalog)
      const dimensions = Object.fromEntries(MATRIX_DIMENSIONS.map((dimension) => [
        dimension.id,
        summarizeDimension(dimension.id, contracts[dimension.id], scenario.observations, scenario.cases)
      ]))
      return {
        scenarioId: scenario.scenarioId,
        domain: scenario.domain,
        taskType: scenario.taskType,
        workflowTypes: [...scenario.workflowTypes].sort(),
        tags: [...scenario.tags].sort(),
        caseIds: [...scenario.caseIds].sort(),
        plannedCaseIds: [...new Set(scenario.catalog?.caseIds ?? [])].sort(),
        sourceFiles: [...scenario.sourceFiles].sort(),
        dimensions,
        readiness: scenarioReadiness(dimensions, scenario),
        catalog: scenario.catalog
          ? {
              priority: scenario.catalog.priority,
              status: scenario.catalog.status,
              userGoal: scenario.catalog.userGoal,
              requiredDimensions: [...(scenario.catalog.requiredDimensions ?? [])]
            }
          : undefined,
        evidence: summarizeEvidence(scenario.observations)
      }
    })

  const dimensionSummary = Object.fromEntries(MATRIX_DIMENSIONS.map((dimension) => {
    const cells = scenarioRows.map((scenario) => scenario.dimensions[dimension.id])
    return [dimension.id, summarizeCells(cells)]
  }))
  const sourceSummary = summarizeSources(canonicalCases)
  const domainSummary = summarizeDomains(scenarioRows)
  const evidenceSummary = summarizeEvidence(observations)
  const catalogScenarioCount = catalog.length
  const coveredCatalogScenarios = scenarioRows.filter((scenario) => (
    scenario.catalog && scenario.caseIds.length > 0
  )).length

  return {
    schemaVersion: MATRIX_SCHEMA_VERSION,
    generatedBy: 'scripts/generate-capability-eval-matrix.mjs',
    contract: {
      deduplication: 'case ID is canonical; source files are retained on each case and scenario row',
      statuses: ['NOT_COVERED', 'NOT_RUN', 'SIMULATION_ONLY', 'OBSERVED'],
      evidenceRule: 'replay validates scoring reproducibility; only live-agent observations count as live evidence',
      independentOracleRule: 'tool receipts and completed turns do not count as task or state evidence without an oracle',
      dimensionOutcomeRule: 'PASS/FAIL/INCONCLUSIVE in a dimension column require that dimension result; case-level outcomes are not copied into dimension columns',
      runIdentityRule: 'observations are deduplicated by persisted run identity; reports without a run identity remain report-local observations',
      datasetBindingRule: 'live evidence is current only when the run manifest binds the report to the current case-file SHA-256; legacy reports are marked unverified'
    },
    dimensions: MATRIX_DIMENSIONS,
    summary: {
      uniqueCaseCount: canonicalCases.length,
      scenarioCount: scenarioRows.length,
      catalogScenarioCount,
      coveredCatalogScenarios,
      uncoveredCatalogScenarios: Math.max(0, catalogScenarioCount - coveredCatalogScenarios),
      sourceCount: sourceSummary.length,
      domainCount: domainSummary.length,
      readiness: countBy(scenarioRows, (scenario) => scenario.readiness),
      evidenceModes: {
        live: evidenceSummary.live,
        replay: evidenceSummary.replay,
        deterministic: evidenceSummary.deterministic
      },
      independentEvidence: {
        task: evidenceSummary.liveTask,
        state: evidenceSummary.independentState,
        controlled: evidenceSummary.controlled
      },
      liveEvidenceValidity: evidenceSummary.liveValidity,
      outcomes: evidenceSummary.outcomes,
      dimensions: dimensionSummary
    },
    sources: sourceSummary,
    domains: domainSummary,
    scenarios: scenarioRows
  }
}

export function renderMatrixMarkdown(matrix) {
  const lines = [
    '# Capability evaluation matrix',
    '',
    'This generated matrix maps canonical product-evaluation cases to six evidence layers. It is a coverage inventory, not a single product quality score.',
    '',
    `Unique executable cases: **${matrix.summary.uniqueCaseCount}** · scenarios in bounded catalog: **${matrix.summary.catalogScenarioCount}** · domains: **${matrix.summary.domainCount}**`,
    '',
    `Catalog coverage: ${matrix.summary.coveredCatalogScenarios}/${matrix.summary.catalogScenarioCount}. Readiness: ${formatCounts(matrix.summary.readiness)}. Persisted observation counts by mode: ${formatCounts(matrix.summary.evidenceModes)}; these are run observations, not unique scenarios.`,
    '',
    `Live evidence binding: ${formatCounts(matrix.summary.liveEvidenceValidity)}. Only \`verified\` runs are current-case evidence; legacy reports without a dataset SHA are retained as \`unverified\`.`,
    '',
    '## Dimension summary',
    '',
    '| Dimension | Planned | Declared | Inferred | Not covered | Live-observed | Live-verified | Independent evidence | PASS | FAIL | INCONCLUSIVE |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...MATRIX_DIMENSIONS.map((dimension) => {
      const summary = matrix.summary.dimensions[dimension.id]
      return `| ${dimension.label} | ${summary.planned} | ${summary.declared} | ${summary.inferred} | ${summary.notCovered} | ${summary.liveObserved} | ${summary.liveVerified} | ${summary.independentEvidence} | ${summary.outcomes.PASS} | ${summary.outcomes.FAIL} | ${summary.outcomes.INCONCLUSIVE} |`
    }),
    '',
    '## Domain summary',
    '',
    '| Domain | Scenarios | Cases | Ready | Partial | Catalog-only | Blocked | Live runs | Live verified | PASS | FAIL | INCONCLUSIVE |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...matrix.domains.map((domain) => `| ${domain.domain} | ${domain.scenarios} | ${domain.cases} | ${domain.readiness.ready} | ${domain.readiness.partial} | ${domain.readiness.catalog_only} | ${domain.readiness.blocked} | ${domain.liveRuns} | ${domain.liveVerifiedRuns} | ${domain.outcomes.PASS} | ${domain.outcomes.FAIL} | ${domain.outcomes.INCONCLUSIVE} |`),
    '',
    '## Scenario matrix',
    '',
    '| Scenario | Domain | Cases | Runtime | Interaction | Tool execution | Task result | State | Robustness | Readiness |',
    '| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |',
    ...matrix.scenarios.map((scenario) => `| \`${scenario.scenarioId}\` | ${scenario.domain} | ${scenario.caseIds.length} | ${cellLabel(scenario.dimensions.runtime)} | ${cellLabel(scenario.dimensions.interaction)} | ${cellLabel(scenario.dimensions.tool_execution)} | ${cellLabel(scenario.dimensions.task_result)} | ${cellLabel(scenario.dimensions.state)} | ${cellLabel(scenario.dimensions.robustness)} | ${scenario.readiness} |`),
    '',
    '### Status semantics',
    '',
    '- `NOT_COVERED`: no executable contract for this layer; it is a scope gap, not a failure.',
    '- `NOT_RUN`: a contract exists, but no persisted observation was found.',
    '- `SIMULATION_ONLY`: only deterministic/synthetic evidence was found; it is not live Agent evidence.',
    '- `OBSERVED`: a live Agent observation exists. PASS/FAIL/INCONCLUSIVE counts remain separate.',
    '- `catalog_only`: the product scenario is in the bounded catalog but has no executable case yet.',
    '- Dimension PASS/FAIL/INCONCLUSIVE counts come from that dimension\'s evaluator result. A case-level PASS is not copied into every dimension.',
    '- `verified` live binding means the run manifest contains the current case-file SHA-256. Older reports remain visible but are not current-case evidence.',
    '- `inferred` contracts are legacy metadata inferred from existing fields and should be upgraded to explicit dimensions before formal acceptance.',
    ''
  ]
  return `${lines.join('\n')}\n`
}

export function renderMatrixHtml(matrix) {
  const domains = [...new Set(matrix.scenarios.map((scenario) => scenario.domain))].sort()
  const readiness = [...new Set(matrix.scenarios.map((scenario) => scenario.readiness))].sort()
  const options = (values) => values.map((value) => `<option value="${htmlEscape(value)}">${htmlEscape(value)}</option>`).join('')
  const rows = matrix.scenarios.map((scenario) => {
    const dimensionCells = MATRIX_DIMENSIONS.map((dimension) => {
      const cell = scenario.dimensions[dimension.id]
      return `<td data-status="${htmlEscape(cell.status)}">${htmlEscape(cell.status)}<small>${htmlEscape(cell.contract)}</small></td>`
    }).join('')
    return `<tr data-domain="${htmlEscape(scenario.domain)}" data-readiness="${htmlEscape(scenario.readiness)}">` +
      `<th scope="row"><code>${htmlEscape(scenario.scenarioId)}</code><small>${htmlEscape(scenario.catalog?.userGoal ?? '')}</small></th>` +
      `<td>${htmlEscape(scenario.domain)}</td><td>${scenario.caseIds.length}</td>${dimensionCells}` +
      `<td>${htmlEscape(scenario.readiness)}</td><td>${scenario.evidence.liveValidity.verified ?? 0}/${scenario.evidence.live}</td></tr>`
  }).join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SciForge capability evaluation matrix</title>
<style>
:root{color-scheme:light dark;font-family:Inter,system-ui,sans-serif}body{margin:2rem;line-height:1.4}h1{margin-bottom:.25rem}p{color:#687386}.controls{display:flex;gap:.75rem;flex-wrap:wrap;margin:1rem 0}label{display:flex;gap:.35rem;align-items:center}select{padding:.35rem;background:Canvas;color:CanvasText;border:1px solid #8792a2;border-radius:.3rem}table{border-collapse:collapse;width:100%;font-size:.86rem}th,td{border:1px solid #8792a2;padding:.45rem;text-align:left;vertical-align:top}thead th{position:sticky;top:0;background:Canvas}tbody tr[data-hidden="true"]{display:none}td[data-status="NOT_COVERED"]{background:#fff0f0}td[data-status="NOT_RUN"],td[data-status="SIMULATION_ONLY"]{background:#fff8df}td[data-status="OBSERVED"]{background:#e9f8ef}small{display:block;color:#687386;font-size:.75rem;margin-top:.15rem}code{font-family:ui-monospace,SFMono-Regular,monospace} .summary{display:flex;gap:1rem;flex-wrap:wrap}.card{border:1px solid #8792a2;border-radius:.4rem;padding:.65rem 1rem}.muted{color:#687386}
</style></head><body>
<h1>SciForge capability evaluation matrix</h1>
<p>Bounded product-scenario coverage inventory. Live evidence is not inferred from simulation; the binding column is verified-run count / all live observations.</p>
<div class="summary"><div class="card">Catalog scenarios <strong>${matrix.summary.catalogScenarioCount}</strong></div><div class="card">Executable cases <strong>${matrix.summary.uniqueCaseCount}</strong></div><div class="card">Catalog covered <strong>${matrix.summary.coveredCatalogScenarios}/${matrix.summary.catalogScenarioCount}</strong></div><div class="card">Live binding <strong>${formatCounts(matrix.summary.liveEvidenceValidity)}</strong></div></div>
<div class="controls"><label>Domain <select id="domain"><option value="">All</option>${options(domains)}</select></label><label>Readiness <select id="readiness"><option value="">All</option>${options(readiness)}</select></label><label>Dimension status <select id="status"><option value="">All</option><option>NOT_COVERED</option><option>NOT_RUN</option><option>SIMULATION_ONLY</option><option>OBSERVED</option></select></label></div>
<table><thead><tr><th>Scenario</th><th>Domain</th><th>Cases</th>${MATRIX_DIMENSIONS.map((dimension) => `<th>${htmlEscape(dimension.label)}</th>`).join('')}<th>Readiness</th><th>Live</th></tr></thead><tbody>${rows}</tbody></table>
<script>
const filters=[document.querySelector('#domain'),document.querySelector('#readiness'),document.querySelector('#status')];
function apply(){const [domain,readiness,status]=filters.map((node)=>node.value);document.querySelectorAll('tbody tr').forEach((row)=>{const matchesDomain=!domain||row.dataset.domain===domain;const matchesReadiness=!readiness||row.dataset.readiness===readiness;const matchesStatus=!status||[...row.querySelectorAll('td[data-status]')].some((cell)=>cell.dataset.status===status);row.dataset.hidden=String(!(matchesDomain&&matchesReadiness&&matchesStatus));});}
filters.forEach((node)=>node.addEventListener('change',apply));
</script></body></html>\n`
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

async function main() {
  const jsonPath = path.resolve(root, valueOf('--output') ?? path.relative(root, defaultJsonPath))
  const markdownPath = path.resolve(root, valueOf('--markdown') ?? path.relative(root, defaultMarkdownPath))
  const htmlPath = path.resolve(root, valueOf('--html') ?? path.relative(root, defaultHtmlPath))
  const evidenceRoot = path.resolve(root, valueOf('--evidence-root') ?? path.relative(root, defaultEvidenceRoot))
  const cases = await loadCanonicalCases()
  const catalog = await loadScenarioCatalog()
  const observations = await loadObservations(evidenceRoot, cases)
  const matrix = createEvaluationMatrix(cases, observations, catalog)
  const json = `${JSON.stringify(matrix, null, 2)}\n`
  const markdown = renderMatrixMarkdown(matrix)
  const html = renderMatrixHtml(matrix)

  if (process.argv.includes('--check')) {
    const [currentJson, currentMarkdown, currentHtml] = await Promise.all([
      readFile(jsonPath, 'utf8'),
      readFile(markdownPath, 'utf8'),
      readFile(htmlPath, 'utf8')
    ])
    if (currentJson !== json || currentMarkdown !== markdown || currentHtml !== html) {
      throw new Error('Evaluation matrix is stale. Run npm run capability:eval:matrix.')
    }
    console.log(`Evaluation matrix is fresh: ${path.relative(root, jsonPath)}`)
    return
  }

  await Promise.all([
    writeFile(jsonPath, json, 'utf8'),
    writeFile(markdownPath, markdown, 'utf8'),
    writeFile(htmlPath, html, 'utf8')
  ])
  console.log(`Evaluation matrix: ${path.relative(root, jsonPath)}`)
  console.log(`Evaluation matrix Markdown: ${path.relative(root, markdownPath)}`)
  console.log(`Evaluation matrix HTML: ${path.relative(root, htmlPath)}`)
  console.log(`Cases: ${matrix.summary.uniqueCaseCount}; scenarios: ${matrix.summary.scenarioCount}; live observations: ${matrix.summary.evidenceModes.live}`)
}

async function loadCanonicalCases() {
  const names = (await readdir(capabilityCasesDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && (CANONICAL_FILE.test(entry.name) || AUXILIARY_FILE.test(entry.name) || CORE_FILE.test(entry.name)))
    .map((entry) => entry.name)
    .sort()
  const records = []
  for (const name of names) {
    const filePath = path.join(capabilityCasesDirectory, name)
    const contents = await readFile(filePath, 'utf8')
    const fileHash = createHash('sha256').update(contents).digest('hex')
    const lines = contents.split(/\r?\n/u)
    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      let value
      try {
        value = JSON.parse(trimmed)
      } catch (error) {
        throw new Error(`Invalid JSON at ${path.relative(root, filePath)}:${index + 1}: ${error.message}`)
      }
      if (!value || typeof value.id !== 'string') {
        throw new Error(`Evaluation matrix source row at ${path.relative(root, filePath)}:${index + 1} has no string id.`)
      }
      records.push({ case: value, source: path.relative(root, filePath), sourceHash: fileHash, line: index + 1 })
    }
  }
  return records
}

async function loadScenarioCatalog() {
  try {
    const parsed = JSON.parse(await readFile(scenarioCatalogPath, 'utf8'))
    if (!Array.isArray(parsed.scenarios)) throw new Error('scenarios must be an array')
    return parsed.scenarios
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw new Error(`Invalid product scenario catalog: ${error.message}`)
  }
}

async function loadObservations(evidenceRoot, caseRecords = []) {
  const reportPaths = await findReportPaths(evidenceRoot)
  const currentHashes = new Map()
  for (const record of caseRecords) {
    if (record.source && record.sourceHash) currentHashes.set(path.resolve(root, record.source), record.sourceHash)
  }
  const observations = []
  for (const reportPath of reportPaths) {
    let report
    try {
      report = JSON.parse(await readFile(reportPath, 'utf8'))
    } catch {
      continue
    }
    if (report.runKind === 'evaluator-self-test') continue
    const mode = report.executionMode
    if (!['live-agent', 'trace', 'deterministic-simulation'].includes(mode)) continue
    const manifest = await readJsonIfPresent(path.join(path.dirname(reportPath), 'run-manifest.json'))
    const manifestCases = [...(manifest?.cases ?? []), ...(manifest?.runs ?? [])]
    for (const result of report.cases ?? []) {
      if (typeof result.caseId !== 'string') continue
      const actual = result.actual ?? {}
      const manifestRecord = manifestCases.find((entry) => (
        entry.caseId === result.caseId && (!actual.runId || entry.runId === actual.runId)
      ))
      const runId = actual.runId ?? manifestRecord?.runId
      const dimensionResults = result.dimensionResults ?? {}
      const caseBinding = resolveCaseBinding({
        mode,
        manifest,
        currentHashes
      })
      observations.push({
        caseId: result.caseId,
        mode,
        observationId: runId ? `run:${runId}` : `report:${path.relative(root, reportPath)}:${result.caseId}`,
        runId,
        outcome: result.outcome ?? (result.passed === true ? 'PASS' : 'FAIL'),
        evidenceStatus: actual.evidenceStatus ?? 'unavailable',
        executionStatus: actual.executionStatus ?? 'unknown',
        taskEvidence: actual.finalStateSource === 'inspector' && actual.taskSuccess !== undefined,
        independentStateEvidence: actual.finalStateSource === 'inspector',
        // A report directory named "fault" or "approval" is only a hint. It
        // is not proof that the injected rule matched. Count controlled
        // evidence only when the persisted trace contract explicitly records
        // a verified control hit.
        controlledEvidence: actual.controlEvidence === 'verified' || actual.faultPolicyMatch === 'verified' ||
          (actual.faultMatches ?? []).some((match) => match?.injected === true),
        caseBinding,
        dimensionResults,
        dimensionOutcomes: dimensionOutcomes(dimensionResults),
        runtimeOutcome: runtimeOutcome(actual, result),
        reportPath: path.relative(root, reportPath),
        generatedAt: report.generatedAt ?? ''
      })
    }
  }
  return deduplicateObservations(observations)
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return undefined
  }
}

function resolveCaseBinding({ mode, manifest, currentHashes }) {
  if (mode !== 'live-agent') return 'not-applicable'
  if (!manifest?.casesSha256 || typeof manifest.casesPath !== 'string') return 'unverified'
  const currentHash = currentHashes.get(path.resolve(manifest.casesPath))
  if (!currentHash) return 'unverified'
  return currentHash === manifest.casesSha256 ? 'verified' : 'stale'
}

function dimensionOutcomes(dimensionResults) {
  return Object.fromEntries(Object.entries(dimensionResults).flatMap(([dimension, result]) => (
    result?.status && result.status !== 'N/A' ? [[dimension, result.status]] : []
  )))
}

function runtimeOutcome(actual, result) {
  if (['failed', 'aborted', 'cancelled', 'timed-out'].includes(actual.executionStatus)) return 'FAIL'
  if (actual.executionStatus === 'completed') return result.outcome ?? 'FAIL'
  return 'INCONCLUSIVE'
}

function deduplicateObservations(observations) {
  const byId = new Map()
  for (const observation of observations) {
    const current = byId.get(observation.observationId)
    if (!current || `${observation.generatedAt}` > `${current.generatedAt}`) byId.set(observation.observationId, observation)
  }
  return [...byId.values()].sort((left, right) => `${left.observationId}`.localeCompare(`${right.observationId}`))
}

async function findReportPaths(directory) {
  try {
    await access(directory)
  } catch {
    return []
  }
  const entries = await readdir(directory, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name === 'latest.json')
    .map((entry) => path.join(entry.parentPath ?? directory, entry.name))
    .sort()
}

function deduplicateCases(records) {
  const byId = new Map()
  for (const record of records) {
    const current = byId.get(record.case.id)
    if (!current) {
      byId.set(record.case.id, { case: record.case, sources: [...record.sources] })
      continue
    }
    for (const source of record.sources) {
      if (!current.sources.includes(source)) current.sources.push(source)
    }
    current.case = preferCase(current.case, record.case)
  }
  return [...byId.values()].sort((left, right) => left.case.id.localeCompare(right.case.id))
}

function preferCase(left, right) {
  const score = (value) => (
    (value.semanticsVersion === 'semantics-v2' ? 8 : 0) +
    (value.evaluationDimensions?.length ?? 0) * 2 +
    (value.expectedFinalState ? 4 : 0) +
    (value.fixtureProfile ? 2 : 0) +
    (value.rubric?.length ?? 0)
  )
  return score(right) > score(left) ? right : left
}

function mergeContracts(cases, catalogEntry) {
  const merged = {}
  for (const dimension of MATRIX_DIMENSIONS) {
    const sources = cases.map((entry) => deriveCaseMatrixContract(entry)[dimension.id])
    if (catalogEntry?.requiredDimensions?.includes(dimension.id)) {
      sources.push({ source: 'declared', covered: true })
    }
    const active = sources.filter((value) => value.covered)
    if (dimension.id === 'runtime') {
      merged[dimension.id] = { source: 'harness', covered: true }
    } else if (active.some((value) => value.source === 'declared')) {
      merged[dimension.id] = { source: 'declared', covered: true }
    } else if (active.length > 0) {
      merged[dimension.id] = { source: 'inferred', covered: true }
    } else {
      merged[dimension.id] = { source: 'absent', covered: false }
    }
  }
  return merged
}

function summarizeDimension(dimension, contract, observations, cases) {
  const relevant = observations.filter((observation) => cases.some((entry) => entry.id === observation.caseId))
  const live = relevant.filter((observation) => observation.mode === 'live-agent')
  const replay = relevant.filter((observation) => observation.mode === 'trace')
  const deterministic = relevant.filter((observation) => observation.mode === 'deterministic-simulation')
  const independentEvidence = dimension === 'state'
    ? live.filter((observation) => observation.caseBinding === 'verified' && observation.independentStateEvidence)
    : dimension === 'task_result'
      ? live.filter((observation) => observation.caseBinding === 'verified' && observation.taskEvidence)
      : dimension === 'robustness'
        ? live.filter((observation) => observation.caseBinding === 'verified' && observation.controlledEvidence)
        : []
  const dimensionValues = dimension === 'runtime'
    ? live.map((observation) => observation.runtimeOutcome)
    : live.flatMap((observation) => {
        const statuses = MATRIX_TO_EVAL_DIMENSIONS[dimension]?.map((key) => observation.dimensionOutcomes?.[key]).filter(Boolean) ?? []
        if (statuses.length === 0) return []
        if (statuses.includes('INCONCLUSIVE')) return ['INCONCLUSIVE']
        if (statuses.includes('FAIL')) return ['FAIL']
        return ['PASS']
      })
  const outcomes = contract.covered ? summarizeOutcome(dimensionValues) : emptyOutcomes()
  const outcomeSource = dimension === 'runtime' ? 'harness' : dimensionValues.length > 0 ? 'dimension-result' : 'none'
  let status = 'NOT_COVERED'
  if (contract.covered) {
    if (live.length > 0) status = 'OBSERVED'
    else if (replay.length > 0 || deterministic.length > 0) status = 'SIMULATION_ONLY'
    else status = 'NOT_RUN'
  }
  return {
    contract: contract.source,
    status,
    planned: cases.length,
    liveObserved: contract.covered ? new Set(live.map((observation) => observation.caseId)).size : 0,
    liveVerified: contract.covered
      ? new Set(live.filter((observation) => observation.caseBinding === 'verified').map((observation) => observation.caseId)).size
      : 0,
    liveRuns: contract.covered ? live.length : 0,
    replayRuns: contract.covered ? replay.length : 0,
    deterministicRuns: contract.covered ? deterministic.length : 0,
    independentEvidence: contract.covered ? new Set(independentEvidence.map((observation) => observation.caseId)).size : 0,
    outcomeSource,
    outcomes
  }
}

function summarizeEvidence(observations) {
  const live = observations.filter((observation) => observation.mode === 'live-agent')
  return {
    live: live.length,
    replay: observations.filter((observation) => observation.mode === 'trace').length,
    deterministic: observations.filter((observation) => observation.mode === 'deterministic-simulation').length,
    independentState: new Set(live.filter((observation) => observation.caseBinding === 'verified' && observation.independentStateEvidence).map((observation) => observation.caseId)).size,
    liveTask: new Set(live.filter((observation) => observation.caseBinding === 'verified' && observation.taskEvidence).map((observation) => observation.caseId)).size,
    controlled: new Set(live.filter((observation) => observation.caseBinding === 'verified' && observation.controlledEvidence).map((observation) => observation.caseId)).size,
    liveValidity: countBy(live, (observation) => observation.caseBinding),
    outcomes: countOutcome(live)
  }
}

function summarizeCells(cells) {
  return {
    planned: cells.length,
    declared: cells.filter((cell) => cell.contract === 'declared').length,
    inferred: cells.filter((cell) => cell.contract === 'inferred').length,
    harness: cells.filter((cell) => cell.contract === 'harness').length,
    notCovered: cells.filter((cell) => cell.status === 'NOT_COVERED').length,
    notRun: cells.filter((cell) => cell.status === 'NOT_RUN').length,
    simulationOnly: cells.filter((cell) => cell.status === 'SIMULATION_ONLY').length,
    liveObserved: cells.filter((cell) => cell.liveObserved > 0).length,
    liveVerified: cells.filter((cell) => cell.liveVerified > 0).length,
    independentEvidence: cells.filter((cell) => cell.independentEvidence > 0).length,
    outcomes: {
      PASS: cells.reduce((sum, cell) => sum + cell.outcomes.PASS, 0),
      FAIL: cells.reduce((sum, cell) => sum + cell.outcomes.FAIL, 0),
      INCONCLUSIVE: cells.reduce((sum, cell) => sum + cell.outcomes.INCONCLUSIVE, 0)
    }
  }
}

function summarizeSources(records) {
  const groups = new Map()
  for (const record of records) {
    for (const source of record.sources) {
      const current = groups.get(source) ?? { source, kind: sourceKind(source), cases: 0, scenarioIds: new Set() }
      current.cases += 1
      current.scenarioIds.add(record.case.scenarioId ?? record.case.id)
      groups.set(source, current)
    }
  }
  return [...groups.values()].sort((left, right) => left.source.localeCompare(right.source)).map((value) => ({
    source: value.source,
    kind: value.kind,
    cases: value.cases,
    scenarios: value.scenarioIds.size
  }))
}

function summarizeDomains(scenarios) {
  const groups = new Map()
  for (const scenario of scenarios) {
    const current = groups.get(scenario.domain) ?? {
      domain: scenario.domain,
      scenarios: 0,
      cases: 0,
      readiness: { ready: 0, partial: 0, catalog_only: 0, blocked: 0 },
      liveRuns: 0,
      liveVerifiedRuns: 0,
      outcomes: { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 }
    }
    current.scenarios += 1
    current.cases += scenario.caseIds.length
    current.readiness[scenario.readiness] += 1
    current.liveRuns += scenario.evidence.live
    current.liveVerifiedRuns += scenario.evidence.liveValidity.verified ?? 0
    current.outcomes.PASS += scenario.evidence.outcomes.PASS
    current.outcomes.FAIL += scenario.evidence.outcomes.FAIL
    current.outcomes.INCONCLUSIVE += scenario.evidence.outcomes.INCONCLUSIVE
    groups.set(scenario.domain, current)
  }
  return [...groups.values()].sort((left, right) => left.domain.localeCompare(right.domain))
}

function scenarioReadiness(dimensions, scenario) {
  if (scenario.cases.length === 0 && scenario.catalog) return 'catalog_only'
  const active = Object.values(dimensions).filter((dimension) => dimension.contract !== 'harness' && dimension.contract !== 'absent')
  if (active.length === 0) return 'blocked'
  if (active.every((dimension) => dimension.contract === 'declared')) return 'ready'
  return 'partial'
}

function domainOf(evalCase) {
  return evalCase.expected?.domain ?? evalCase.expected?.requiredDomains?.[0] ?? 'unknown'
}

function inferTaskType(evalCase) {
  if (evalCase.workflowType) return 'end_to_end'
  if (evalCase.scenarioId || evalCase.evaluationDimensions?.length) return 'routing'
  return 'action_smoke'
}

function expectedBehaviorContract(evalCase) {
  return evalCase.expectedBehavior !== undefined || evalCase.expected?.noCapabilityCalls === true
}

function hasToolContract(evalCase) {
  const expected = evalCase.expected ?? {}
  return [
    expected.domain,
    ...(expected.requiredDomains ?? []),
    ...(expected.mustDiscover ?? []),
    ...(expected.requiredActions ?? []),
    ...(expected.expectedActions ?? []),
    ...(expected.acceptableActions ?? []),
    ...(expected.allowedActions ?? []),
    ...(expected.forbiddenActions ?? []),
    ...(expected.unnecessaryActions ?? []),
    ...Object.keys(expected.authorization ?? {}),
    ...Object.keys(expected.invocation ?? {}),
    ...Object.keys(expected.arguments ?? {})
  ].length > 0
}

function hasResultContract(evalCase) {
  return evalCase.expected?.taskSuccess !== undefined ||
    (evalCase.rubric?.length ?? 0) > 0 ||
    evalCase.expectedBehavior === 'complete'
}

function hasStateContract(evalCase) {
  const finalState = evalCase.expectedFinalState
  return (finalState?.assertions?.length ?? 0) > 0 ||
    (finalState?.artifacts?.length ?? 0) > 0 ||
    (finalState?.dataLineage?.length ?? 0) > 0
}

function hasRobustnessContract(evalCase) {
  const expected = evalCase.expected ?? {}
  return Boolean(
    evalCase.expectedFailure ||
    evalCase.evaluationDimensions?.includes('robustness') ||
    Object.values(expected.authorization ?? {}).some((value) => value === 'deny' || value === 'confirmation') ||
    (evalCase.tags ?? []).some((tag) => ROBUSTNESS_TAG.test(tag))
  )
}

function summarizeOutcome(outcomes) {
  return {
    PASS: outcomes.filter((value) => value === 'PASS').length,
    FAIL: outcomes.filter((value) => value === 'FAIL').length,
    INCONCLUSIVE: outcomes.filter((value) => value === 'INCONCLUSIVE').length
  }
}

function countOutcome(observations) {
  return summarizeOutcome(observations.map((observation) => observation.outcome))
}

function emptyOutcomes() {
  return { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 }
}

function groupBy(values, selector) {
  const groups = new Map()
  for (const value of values) {
    const key = selector(value)
    const group = groups.get(key) ?? []
    group.push(value)
    groups.set(key, group)
  }
  return groups
}

function countBy(values, selector) {
  return values.reduce((counts, value) => {
    const key = selector(value)
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

function formatCounts(counts) {
  return Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join(', ')
}

function cellLabel(cell) {
  return `${cell.status} (${cell.contract})`
}

function sourceKind(source) {
  const name = path.basename(source)
  if (name === 'core-scenarios-v1.jsonl') return 'core-acceptance'
  if (name === 'golden.jsonl') return 'deterministic-regression'
  if (name === 'natural-routing-v2.jsonl') return 'natural-routing'
  if (name === 'workflow-golden.jsonl') return 'workflow'
  if (name === 'workflow-scenarios.jsonl') return 'controlled-workflow'
  if (name.endsWith('-controlled.jsonl')) return 'controlled-domain'
  return 'package-action'
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
}

function valueOf(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

#!/usr/bin/env node

import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const casePaths = [
  { set: 'golden', path: path.join(root, 'eval-cases/capability/workflow-golden.jsonl') },
  { set: 'scenarios', path: path.join(root, 'eval-cases/capability/workflow-scenarios.jsonl') }
]
const actionPlanPath = path.join(root, 'eval-cases/capability/action-directed-plan.jsonl')
const auditPath = path.join(root, 'eval-cases/capability/workflow-readiness-audit.jsonl')
const markdownPath = path.join(root, 'docs/generated/capability-workflow-readiness.md')
const checkOnly = process.argv.includes('--check')

const caseSets = await Promise.all(casePaths.map(async ({ set, path: filePath }) => (
  (await parseJsonl(filePath)).map((value, index) => ({ ...value, __set: set, __line: index + 1 }))
)))
const cases = caseSets.flat()
const actionPlans = new Map((await parseJsonl(actionPlanPath)).map((entry) => [entry.actionId, entry]))
const observedEvidence = await loadObservedEvidence()
const auditEntries = cases.map((evalCase) => createAuditEntry(evalCase, observedEvidence))
const auditContent = `${auditEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
const markdownContent = renderMarkdown(auditEntries)

if (checkOnly) {
  const [currentAudit, currentMarkdown] = await Promise.all([
    readFile(auditPath, 'utf8'),
    readFile(markdownPath, 'utf8')
  ])
  if (currentAudit !== auditContent || currentMarkdown !== markdownContent) {
    throw new Error('Workflow readiness audit is stale. Run npm run capability:eval:workflow-readiness.')
  }
  console.log(`Verified workflow readiness audit for ${auditEntries.length} cases.`)
} else {
  await writeFile(auditPath, auditContent, 'utf8')
  await writeFile(markdownPath, markdownContent, 'utf8')
  const counts = countBy(auditEntries, (entry) => entry.readiness)
  console.log(`Audited ${auditEntries.length} workflow cases: ${formatCounts(counts)}.`)
  console.log(`Wrote ${path.relative(root, auditPath)} and ${path.relative(root, markdownPath)}.`)
}

function parseJsonl(filePath) {
  return readFile(filePath, 'utf8').then((content) => content.split(/\r?\n/u)
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, index }) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path.relative(root, filePath)}:${index + 1}: ${error.message}`)
      }
    }))
}

function createAuditEntry(evalCase, evidenceIndex) {
  const requiredActions = unique([
    ...(evalCase.expected?.requiredActions ?? []),
    ...((evalCase.expected?.noCapabilityCalls || false) ? [] : [])
  ])
  const actionReadiness = requiredActions.map((actionId) => actionReadinessFor(actionId))
  const fixture = fixtureStrategy(evalCase, actionReadiness)
  const oracle = oracleStrategy(evalCase)
  const readiness = readinessFor(evalCase, actionReadiness)
  const observed = evidenceIndex.get(evalCase.id) ?? { live: null, replay: null, other: [] }

  return {
    schemaVersion: 'sciforge.capability-eval.workflow-readiness.v1',
    caseId: evalCase.id,
    set: evalCase.__set,
    workflowType: evalCase.workflowType ?? 'unspecified',
    requiredActionIds: requiredActions,
    packageOwners: unique(actionReadiness.map((entry) => entry.owner).filter(Boolean)),
    actionReadiness,
    fixture,
    oracle,
    approvalStrategy: approvalStrategy(evalCase),
    faultStrategy: faultStrategy(evalCase),
    runStrategy: {
      live: 'isolated-live-agent',
      persistedEvidence: ['run-manifest', 'raw-trace', 'normalized-sidecar', 'workspace-snapshot', 'oracle-evidence'],
      replay: 'same-trace-replay'
    },
    readiness,
    observedEvidence: observed,
    notes: notesFor(evalCase, actionReadiness, readiness)
  }
}

function actionReadinessFor(actionId) {
  const plan = actionPlans.get(actionId)
  if (!plan) {
    return {
      actionId,
      owner: actionId.split('.')[0],
      status: 'missing-from-action-plan',
      fixtureStatus: 'unknown',
      oracleStatus: 'unknown'
    }
  }
  const fixtureStatus = plan.fixture?.status ?? 'unknown'
  const oracleStatus = plan.oracle?.status ?? 'unknown'
  return {
    actionId,
    owner: plan.owner,
    batch: plan.batch,
    status: fixtureStatus === 'ready' && oracleStatus === 'ready'
      ? 'ready'
      : fixtureStatus === 'ready'
        ? 'needs-independent-oracle'
        : oracleStatus === 'ready'
          ? 'needs-domain-fixture'
          : 'needs-domain-fixture-and-independent-oracle',
    fixtureStatus,
    oracleStatus,
    effect: plan.effect,
    approval: plan.approval
  }
}

function fixtureStrategy(evalCase, actionReadiness) {
  const files = evalCase.fixtures?.files ?? []
  const tags = new Set(evalCase.tags ?? [])
  const strategies = []
  if (files.length > 0) strategies.push('case-inline-workspace-fixture')
  if (tags.has('requires-controlled-index')) strategies.push('controlled-provider-or-index')
  if (tags.has('requires-provider-fault')) strategies.push('case-scoped-provider-fault')
  if (tags.has('requires-approval-control')) strategies.push('case-scoped-approval-control')
  if (evalCase.expected?.noCapabilityCalls === true) strategies.push('no-capability-boundary')
  if (strategies.length === 0) {
    const packageReady = actionReadiness.length > 0 && actionReadiness.every((entry) => entry.status === 'ready')
    strategies.push(packageReady ? 'package-owned-fixture' : 'package-owned-fixture-required')
  }
  return {
    strategies,
    fileCount: files.length,
    paths: files.map((file) => file.path).filter((value) => typeof value === 'string'),
    status: files.length > 0 || strategies.includes('no-capability-boundary')
      ? 'declared'
      : strategies.includes('package-owned-fixture')
        ? 'available-through-package'
        : 'needs-case-or-package-fixture'
  }
}

function oracleStrategy(evalCase) {
  const finalState = evalCase.expectedFinalState
  const artifactCount = finalState?.artifacts?.length ?? 0
  const lineageCount = finalState?.dataLineage?.length ?? 0
  const strategies = []
  if (evalCase.expected?.noCapabilityCalls === true) strategies.push('no-capability-call-trace')
  if (finalState) strategies.push('independent-final-state-inspector')
  if (artifactCount > 0) strategies.push('artifact-existence-and-content-readback')
  if (lineageCount > 0) strategies.push('data-lineage-hash-readback')
  if (evalCase.rubric?.some((rubric) => rubric.type === 'llm_judge')) strategies.push('llm-judge')
  if (strategies.length === 0) strategies.push('invocation-and-task-contract')
  return {
    strategies,
    finalStateAssertions: finalState?.assertions?.length ?? 0,
    artifactAssertions: artifactCount,
    lineageAssertions: lineageCount,
    status: finalState || evalCase.expected?.noCapabilityCalls === true ? 'declared' : 'needs-final-state-contract'
  }
}

function approvalStrategy(evalCase) {
  const modes = new Set(Object.values(evalCase.expected?.authorization ?? {}))
  if (modes.has('deny')) return 'approval-denied-no-side-effect'
  if (modes.has('confirmation')) return 'approval-allowed-and-denied'
  return modes.size > 0 ? 'allow-only' : 'not-applicable'
}

function faultStrategy(evalCase) {
  if (evalCase.expectedFailure) {
    return `case-scoped-provider-fault:${evalCase.expectedFailure.errorCode}:${evalCase.expectedFailure.handling}`
  }
  if ((evalCase.tags ?? []).some((tag) => tag === 'requires-provider-fault')) return 'case-scoped-provider-fault:required'
  return 'no-injected-provider-fault'
}

function readinessFor(evalCase, actionReadiness) {
  if (evalCase.expected?.noCapabilityCalls === true) return 'ready'
  if (actionReadiness.length === 0) return 'blocked-no-positive-action'
  const readyCount = actionReadiness.filter((entry) => entry.status === 'ready').length
  if (readyCount === actionReadiness.length) return 'ready'
  if (readyCount > 0) return 'partial'
  return 'blocked'
}

function notesFor(evalCase, actionReadiness, readiness) {
  const notes = []
  if (readiness !== 'ready') notes.push('Package-owned fixture and independent oracle readiness is incomplete; keep this case in the denominator.')
  if (evalCase.expectedFailure) notes.push('Expected failure handling is part of the contract; uncontrolled provider behavior must not be scored as recovery.')
  if (approvalStrategy(evalCase) === 'approval-denied-no-side-effect') notes.push('Verify both the denial response and absence of the write-side effect.')
  if (evalCase.expected?.noCapabilityCalls === true) notes.push('This is a no-call boundary case; zero capability calls is the positive result.')
  if (actionReadiness.some((entry) => entry.status === 'missing-from-action-plan')) notes.push('Required action is absent from the generated Agent-visible action plan and must be fixed before execution.')
  return notes
}

async function loadObservedEvidence() {
  const index = new Map()
  let entries
  try {
    entries = await readdir(path.join(root, 'eval-results'), { withFileTypes: true })
  } catch {
    return index
  }
  const reports = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directory = path.join(root, 'eval-results', entry.name)
    const reportPath = path.join(directory, 'latest.json')
    try {
      await access(reportPath)
      const report = JSON.parse(await readFile(reportPath, 'utf8'))
      reports.push({ directory: entry.name, report })
    } catch {
      // A result directory without a complete report is not evidence for this audit.
    }
  }
  for (const { directory, report } of reports) {
    for (const result of report.cases ?? []) {
      if (typeof result.caseId !== 'string') continue
      const mode = report.executionMode === 'trace' ? 'replay' : report.executionMode === 'live-agent' ? 'live' : 'other'
      const item = {
        directory,
        executionMode: report.executionMode ?? 'unknown',
        outcome: result.outcome ?? (result.passed ? 'PASS' : 'FAIL'),
        passed: result.passed === true,
        evidenceStatus: result.actual?.evidenceStatus ?? 'unavailable',
        finalStateObserved: result.actual?.finalState !== undefined,
        failureTypes: unique((result.failures ?? []).map((failure) => failure.type).filter(Boolean)).slice(0, 6)
      }
      const current = index.get(result.caseId) ?? { live: null, replay: null, other: [] }
      if (mode === 'other') current.other.push(item)
      else if (!current[mode] || compareReports(report, current[mode].__report) > 0) current[mode] = item
      if (mode !== 'other') item.__report = report
      index.set(result.caseId, current)
    }
  }
  for (const current of index.values()) {
    delete current.live?.__report
    delete current.replay?.__report
    current.other = current.other.sort((left, right) => left.directory.localeCompare(right.directory)).slice(-3)
  }
  return index
}

function compareReports(left, right) {
  return String(left.generatedAt ?? '').localeCompare(String(right?.generatedAt ?? ''))
}

function renderMarkdown(entries) {
  const counts = countBy(entries, (entry) => entry.readiness)
  const lines = [
    '# Capability workflow readiness audit',
    '',
    `Generated from the two canonical workflow case files. It covers ${entries.length} cases: ${entries.filter((entry) => entry.set === 'golden').length} golden and ${entries.filter((entry) => entry.set === 'scenarios').length} controlled scenarios.`,
    '',
    `Readiness counts: ${formatCounts(counts)}. Readiness means the case has package-owned fixture and independent-oracle contracts; it does not mean the latest live run passed.`,
    '',
    '| Case | Set | Type | Required actions | Readiness | Fixture | Oracle | Latest live | Latest replay |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...entries.map((entry) => {
      const live = entry.observedEvidence.live ? `${entry.observedEvidence.live.outcome} (${entry.observedEvidence.live.directory})` : 'not observed'
      const replay = entry.observedEvidence.replay ? `${entry.observedEvidence.replay.outcome} (${entry.observedEvidence.replay.directory})` : 'not observed'
      return `| \`${entry.caseId}\` | ${entry.set} | ${entry.workflowType} | ${entry.requiredActionIds.map((actionId) => `\`${actionId}\``).join('<br>') || 'none'} | ${entry.readiness} | ${entry.fixture.status} | ${entry.oracle.status} | ${live} | ${replay} |`
    }),
    '',
    'The audit records observed failures and inconclusive traces as evidence; it does not turn them into passes or relax the case contract.',
    ''
  ]
  return lines.join('\n')
}

function unique(values) {
  return [...new Set(values)]
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

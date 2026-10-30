#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
const paths = {
  actions: path.join(root, 'eval-cases/capability/action-directed-planned.jsonl'),
  workflows: path.join(root, 'eval-cases/capability/workflow-expansion-plan.jsonl'),
  workflowCases: path.join(root, 'eval-cases/capability/workflow-expansion-cases.jsonl'),
  confirmations: path.join(root, 'eval-cases/capability/confirmation-action-matrix.jsonl'),
  sourceIndex: path.join(root, 'eval-cases/capability/case-source-index.json'),
  liveIndex: path.join(root, 'eval-cases/capability/live-evidence-index.jsonl'),
  manifest: path.join(root, 'eval-cases/capability/full-execution-plan.json'),
  markdown: path.join(root, 'docs/generated/capability-full-execution-plan.md')
}

const actionCases = await readJsonl(paths.actions)
const workflowCases = await readJsonl(paths.workflows)
const executableWorkflowCases = await readJsonl(paths.workflowCases)
const confirmationRows = await readJsonl(paths.confirmations)
const sourceIndex = JSON.parse(await readFile(paths.sourceIndex, 'utf8'))
const liveIndex = await readJsonl(paths.liveIndex)

assertUnique(actionCases.map((entry) => entry.expected?.requiredActions?.[0]), 'action target')
assertUnique(actionCases.map((entry) => entry.id), 'action case')
assertUnique(workflowCases.map((entry) => entry.id), 'workflow case')
assertUnique(executableWorkflowCases.map((entry) => entry.id), 'executable workflow case')
assertUnique(confirmationRows.map((entry) => entry.actionId), 'confirmation action')
const agentActionCount = actionCases.length
const confirmationActionCount = confirmationRows.length
assertEqual(workflowCases.length, 42, 'workflow expansion case count')
assertEqual(executableWorkflowCases.length, workflowCases.length, 'executable workflow case count')
const plannedWorkflowIds = new Set(workflowCases.map((entry) => entry.id))
for (const entry of executableWorkflowCases) {
  if (!plannedWorkflowIds.has(entry.id)) throw new Error(`Executable workflow ${entry.id} has no plan entry.`)
  if (typeof entry.query !== 'string' || !entry.query.trim()) throw new Error(`Executable workflow ${entry.id} is missing query.`)
  if (!entry.expected || !Array.isArray(entry.expected.requiredActions)) {
    throw new Error(`Executable workflow ${entry.id} is missing expected.requiredActions.`)
  }
}

const workflowCounts = countBy(workflowCases, (entry) => entry.category)
const workflowReadinessByCategory = summarizeWorkflowReadiness(workflowCases)
for (const [category, expected] of [['same-domain', 18], ['cross-domain', 12], ['recovery-boundary', 12]]) {
  assertEqual(workflowCounts[category] ?? 0, expected, `${category} workflow count`)
}
const liveCounts = countBy(liveIndex, (entry) => entry.status)
const designReadyActionCount = liveIndex.filter((entry) => (
  entry.designStatus.fixture === 'ready' && entry.designStatus.oracle === 'ready'
)).length
const workflowReadiness = countBy(workflowCases, (entry) => entry.readiness)

const manifest = {
  schemaVersion: 'sciforge.capability-eval.full-execution-plan.v1',
  generatedAt: new Date().toISOString(),
  denominator: {
    agentVisibleActions: actionCases.length,
    workflowDesignCases: workflowCases.length,
    confirmationDeniedScenarios: confirmationRows.length,
    plannedLiveScenarioUnits: actionCases.length + workflowCases.length + confirmationRows.length,
    note: `Confirmation branches are scenario executions and do not add action IDs to the ${agentActionCount}-action denominator.`
  },
  actionAnchors: {
    caseFile: 'eval-cases/capability/action-directed-planned.jsonl',
    count: actionCases.length,
    uniqueActions: actionCases.map((entry) => entry.expected.requiredActions[0]).sort()
  },
  workflows: {
    caseFile: 'eval-cases/capability/workflow-expansion-plan.jsonl',
    executableCaseFile: 'eval-cases/capability/workflow-expansion-cases.jsonl',
    count: workflowCases.length,
    byCategory: workflowCounts,
    readiness: workflowReadiness,
    readinessByCategory: workflowReadinessByCategory
  },
  confirmations: {
    caseFile: 'eval-cases/capability/confirmation-action-matrix.jsonl',
    count: confirmationRows.length,
    deniedCaseIds: confirmationRows.map((entry) => entry.deniedScenario.caseId).sort(),
    allCaseScoped: confirmationRows.every((entry) => entry.executionPolicy.caseScopedApproval === true)
  },
  caseSources: {
    index: 'eval-cases/capability/case-source-index.json',
    totalDeterministicCases: sourceIndex.totalCases,
    canonicalSourceCount: sourceIndex.sources.length,
    duplicateFree: true
  },
  currentEvidence: {
    liveIndex: 'eval-cases/capability/live-evidence-index.jsonl',
    designReadyActionCount,
    liveStatusCounts: liveCounts,
    outcomeVerifiedActions: liveIndex.filter((entry) => entry.status === 'outcome-verified').map((entry) => entry.actionId).sort()
  },
  runPolicy: {
    live: 'isolated-live-agent per case, bounded timeout and case-scoped approval/fault policy',
    replay: 'replay the persisted raw trace with the same oracle and compare coverage/outcome/failure type',
    evidence: ['run-manifest', 'raw-trace', 'normalized-sidecar', 'workspace-snapshot', 'oracle-evidence'],
    blockedItemsStayInDenominator: true
  }
}
manifest.generatedAt = 'generated'
const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`
const markdownContent = renderMarkdown(manifest)
await writeOrCheck(paths.manifest, manifestContent)
await writeOrCheck(paths.markdown, markdownContent)

if (checkOnly) console.log(`Verified full capability evaluation execution plan: ${agentActionCount} actions, 42 workflows, ${confirmationActionCount} confirmation denials.`)
else console.log(`Generated full capability evaluation execution plan: ${agentActionCount} actions, 42 workflows, ${confirmationActionCount} confirmation denials.`)

function renderMarkdown(value) {
  const counts = value.currentEvidence.liveStatusCounts
  const liveSummary = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${key}=${count}`).join(', ')
  return [
    '# Capability full execution plan',
    '',
    'This is the executable denominator for the complete capability evaluation. It separates unique action coverage from workflow and confirmation scenario executions.',
    '',
    '| Scope | Planned units | Current design/live evidence |',
    '| --- | ---: | --- |',
    `| Agent-visible action anchors | ${value.denominator.agentVisibleActions} | design-ready ${value.currentEvidence.designReadyActionCount}; live ${liveSummary} |`,
    `| Same-domain workflows | ${value.workflows.byCategory['same-domain'] ?? 0} | readiness ${value.workflows.readinessByCategory['same-domain']?.ready ?? 0} ready, ${value.workflows.readinessByCategory['same-domain']?.blocked ?? 0} blocked |`,
    `| Cross-domain workflows | ${value.workflows.byCategory['cross-domain'] ?? 0} | readiness ${value.workflows.readinessByCategory['cross-domain']?.ready ?? 0} ready, ${value.workflows.readinessByCategory['cross-domain']?.blocked ?? 0} blocked |`,
    `| Recovery/boundary workflows | ${value.workflows.byCategory['recovery-boundary'] ?? 0} | readiness ${value.workflows.readinessByCategory['recovery-boundary']?.ready ?? 0} ready, ${value.workflows.readinessByCategory['recovery-boundary']?.blocked ?? 0} blocked |`,
    `| Confirmation-denied scenarios | ${value.denominator.confirmationDeniedScenarios} | case-scoped: ${value.confirmations.allCaseScoped ? 'yes' : 'no'} |`,
    '',
    `The planned scenario-unit count is ${value.denominator.plannedLiveScenarioUnits}. The ${value.denominator.confirmationDeniedScenarios} confirmation-denied branches are not extra action IDs; they are explicit authorization executions attached to the ${value.denominator.agentVisibleActions}-action denominator.`,
    '',
    'Canonical inputs:',
    '',
    '- `action-directed-planned.jsonl`: one positive natural-language anchor per Agent-visible action.',
    '- `workflow-expansion-plan.jsonl`: 18 same-domain, 12 cross-domain, and 12 recovery/boundary workflow designs.',
    '- `workflow-expansion-cases.jsonl`: runner-compatible cases generated from the workflow plan.',
    '- `confirmation-action-matrix.jsonl`: one approved and one denied configuration per confirmation action.',
    '- `case-source-index.json`: package-owned versus integration-owned deterministic case sources.',
    '',
    'Blocked or unobserved entries remain in the denominator. No action is accepted from discovery, invocation alone, package unit tests, or a model self-report; acceptance requires independent outcome evidence.',
    ''
  ].join('\n')
}

async function readJsonl(filePath) {
  return (await readFile(filePath, 'utf8')).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

async function writeOrCheck(filePath, content) {
  if (checkOnly) {
    const current = await readFile(filePath, 'utf8').catch(() => '')
    if (current !== content) throw new Error(`Generated execution plan is stale: ${path.relative(root, filePath)}`)
    return
  }
  await writeFile(filePath, content, 'utf8')
}

function assertUnique(values, label) {
  const filtered = values.filter(Boolean)
  if (new Set(filtered).size !== filtered.length) throw new Error(`Duplicate ${label} detected.`)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`Expected ${label} to be ${expected}, received ${actual}.`)
}

function countBy(values, selector) {
  return values.reduce((result, value) => {
    const key = selector(value)
    result[key] = (result[key] ?? 0) + 1
    return result
  }, {})
}

function summarizeWorkflowReadiness(values) {
  return values.reduce((result, value) => {
    const category = value.category
    const readiness = result[category] ?? {}
    readiness[value.readiness] = (readiness[value.readiness] ?? 0) + 1
    result[category] = readiness
    return result
  }, {})
}

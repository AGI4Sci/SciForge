#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkflowDefinitions } from './generate-capability-eval-workflow-expansion.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
const paths = {
  actionPlans: path.join(root, 'eval-cases/capability/action-directed-plan.jsonl'),
  actions: path.join(root, 'eval-cases/capability/action-directed-planned.jsonl'),
  workflows: path.join(root, 'eval-cases/capability/workflow-expansion-plan.jsonl'),
  workflowCases: path.join(root, 'eval-cases/capability/workflow-expansion-cases.jsonl'),
  confirmations: path.join(root, 'eval-cases/capability/confirmation-action-matrix.jsonl'),
  sourceIndex: path.join(root, 'eval-cases/capability/case-source-index.json'),
  liveIndex: path.join(root, 'eval-cases/capability/live-evidence-index.jsonl'),
  manifest: path.join(root, 'eval-cases/capability/full-execution-plan.json'),
  markdown: path.join(root, 'docs/generated/capability-full-execution-plan.md')
}

async function main() {
  const canonicalWorkflows = createWorkflowDefinitions(await readJsonl(paths.actionPlans)).entries
  const actionCases = await readJsonl(paths.actions)
  const workflowCases = await readJsonl(paths.workflows)
  const executableWorkflowCases = await readJsonl(paths.workflowCases)
  const confirmationRows = await readJsonl(paths.confirmations)
  const sourceIndex = JSON.parse(await readFile(paths.sourceIndex, 'utf8'))
  const liveIndex = await readJsonl(paths.liveIndex)

  assertUnique(actionCases.map((entry) => entry.expected?.requiredActions?.[0]), 'action target')
  assertUnique(actionCases.map((entry) => entry.id), 'action case')
  assertUnique(confirmationRows.map((entry) => entry.actionId), 'confirmation action')
  const agentActionCount = actionCases.length
  const confirmationActionCount = confirmationRows.length
  const workflowCounts = validateWorkflowMapping(workflowCases, executableWorkflowCases, canonicalWorkflows)
  const workflowReadinessByCategory = summarizeWorkflowReadiness(workflowCases)
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

  if (checkOnly) console.log(`Verified full capability evaluation execution plan: ${agentActionCount} actions, ${workflowCases.length} workflows, ${confirmationActionCount} confirmation denials.`)
  else console.log(`Generated full capability evaluation execution plan: ${agentActionCount} actions, ${workflowCases.length} workflows, ${confirmationActionCount} confirmation denials.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}

// Compare both generated projections with an independently regenerated canonical denominator.
export function validateWorkflowMapping(workflows, executableCases, canonicalWorkflows) {
  const categories = ['same-domain', 'cross-domain', 'recovery-boundary']
  for (const [entries, label] of [[canonicalWorkflows, 'canonical workflow'], [workflows, 'workflow case'], [executableCases, 'executable workflow case']]) {
    assertUnique(entries.map((entry) => entry.id), label)
  }
  if (canonicalWorkflows.length === 0) throw new Error('Canonical workflow definitions must not be empty.')
  for (const entry of [...canonicalWorkflows, ...workflows]) {
    if (!categories.includes(entry.category)) throw new Error(`Unknown workflow category: ${entry.category}.`)
  }
  const counts = countBy(workflows, (entry) => entry.category)
  for (const category of categories) {
    if (!(counts[category] > 0)) throw new Error(`Missing ${category} workflow cases.`)
  }
  assertEqual(workflows.length, canonicalWorkflows.length, 'canonical workflow case count')
  assertEqual(executableCases.length, canonicalWorkflows.length, 'executable workflow case count')
  const canonicalById = new Map(canonicalWorkflows.map((entry) => [entry.id, entry]))
  for (const entry of workflows) {
    const canonical = canonicalById.get(entry.id)
    if (!canonical) throw new Error(`Workflow ${entry.id} has no canonical definition.`)
    assertEqual(entry.category, canonical.category, `workflow ${entry.id} category`)
    assertRequiredActions(entry.requiredActions, canonical.requiredActions, entry.id)
  }
  for (const entry of executableCases) {
    const canonical = canonicalById.get(entry.id)
    if (!canonical) throw new Error(`Executable workflow ${entry.id} has no canonical definition.`)
    if (typeof entry.query !== 'string' || !entry.query.trim()) throw new Error(`Executable workflow ${entry.id} is missing query.`)
    assertRequiredActions(entry.expected?.requiredActions, canonical.requiredActions, entry.id)
  }
  return counts
}

function assertRequiredActions(actual, expected, id) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) throw new Error(`Workflow ${id} is missing requiredActions.`)
  assertUnique(actual, `workflow ${id} required action`)
  assertUnique(expected, `canonical workflow ${id} required action`)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Workflow ${id} requiredActions do not match canonical definition.`)
}

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
    `- \`workflow-expansion-plan.jsonl\`: ${value.workflows.byCategory['same-domain'] ?? 0} same-domain, ${value.workflows.byCategory['cross-domain'] ?? 0} cross-domain, and ${value.workflows.byCategory['recovery-boundary'] ?? 0} recovery/boundary workflow designs.`,
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
  if (values.some((value) => typeof value !== 'string' || !value.trim())) throw new Error(`Empty ${label} ID detected.`)
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} detected.`)
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

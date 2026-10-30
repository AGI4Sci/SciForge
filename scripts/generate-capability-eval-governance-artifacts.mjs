#!/usr/bin/env node

import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const planPath = path.join(root, 'eval-cases/capability/action-directed-plan.jsonl')
const casesDirectory = path.join(root, 'eval-cases/capability')
const matrixPath = path.join(root, 'eval-cases/capability/confirmation-action-matrix.jsonl')
const matrixMarkdownPath = path.join(root, 'docs/generated/capability-confirmation-matrix.md')
const effectMarkdownPath = path.join(root, 'docs/generated/capability-result-acceptance-audit.md')
const checkOnly = process.argv.includes('--check')

const plans = (await readJsonl(planPath)).sort((left, right) => left.actionId.localeCompare(right.actionId))
const existingCases = await loadExistingCases()
const confirmationPlans = plans.filter((plan) => plan.approval === 'confirmation')
const confirmationEntries = confirmationPlans.map((plan) => confirmationEntry(plan, existingCases))
const matrixContent = `${confirmationEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
const matrixMarkdown = renderConfirmationMarkdown(confirmationEntries)
const effectMarkdown = renderEffectMarkdown(plans)

if (checkOnly) {
  const [currentMatrix, currentMatrixMarkdown, currentEffectMarkdown] = await Promise.all([
    readFile(matrixPath, 'utf8'),
    readFile(matrixMarkdownPath, 'utf8'),
    readFile(effectMarkdownPath, 'utf8')
  ])
  if (currentMatrix !== matrixContent || currentMatrixMarkdown !== matrixMarkdown || currentEffectMarkdown !== effectMarkdown) {
    throw new Error('Capability governance artifacts are stale. Run npm run capability:eval:governance.')
  }
  console.log(`Verified ${confirmationEntries.length} confirmation rows and ${plans.length} effect audit rows.`)
} else {
  await writeFile(matrixPath, matrixContent, 'utf8')
  await writeFile(matrixMarkdownPath, matrixMarkdown, 'utf8')
  await writeFile(effectMarkdownPath, effectMarkdown, 'utf8')
  console.log(`Generated ${confirmationEntries.length} confirmation rows and result-acceptance audit for ${plans.length} actions.`)
}

async function loadExistingCases() {
  const entries = await readdir(casesDirectory, { withFileTypes: true })
  const cases = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl') || entry.name.includes('action-directed') || entry.name.includes('workflow-readiness') || entry.name.includes('evaluator-self-test')) continue
    const filePath = path.join(casesDirectory, entry.name)
    for (const value of await readJsonl(filePath)) {
      if (typeof value.id === 'string' && value.expected) cases.push(value)
    }
  }
  return cases
}

function confirmationEntry(plan, cases) {
  const slug = plan.actionId.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '')
  const relatedCases = cases.filter((evalCase) => evalCase.expected?.requiredActions?.includes(plan.actionId))
  const approvedEvidenceCaseIds = relatedCases
    .filter((evalCase) => Object.values(evalCase.expected?.authorization ?? {}).some((value) => value === 'allow' || value === 'confirmation'))
    .map((evalCase) => evalCase.id)
  const deniedEvidenceCaseIds = relatedCases
    .filter((evalCase) => Object.values(evalCase.expected?.authorization ?? {}).some((value) => value === 'deny'))
    .map((evalCase) => evalCase.id)
  return {
    schemaVersion: 'sciforge.capability-eval.confirmation-matrix.v1',
    actionId: plan.actionId,
    owner: plan.owner,
    batch: plan.batch,
    effect: plan.effect,
    approvedScenario: {
      caseId: `capability-confirm-${slug}-approved`,
      authorization: 'allow',
      expectedInvocation: 'success',
      sideEffectOracle: sideEffectOracleFor(plan.effect),
      status: 'designed'
    },
    deniedScenario: {
      caseId: `capability-confirm-${slug}-denied`,
      authorization: 'deny',
      expectedInvocation: 'approval_denied',
      sideEffectOracle: 'independent absence of protected state change or external submission',
      status: 'designed'
    },
    existingCaseIds: {
      approvedEvidenceCaseIds,
      deniedEvidenceCaseIds
    },
    executionPolicy: {
      isolatedWorkspace: true,
      isolatedProviderNamespace: true,
      caseScopedApproval: true,
      persistRawTraceAndOracleEvidence: true
    },
    readiness: approvedEvidenceCaseIds.length > 0 && deniedEvidenceCaseIds.length > 0 ? 'needs-live-verification' : 'needs-scenario-fixture-and-harness'
  }
}

function sideEffectOracleFor(effect) {
  if (effect === 'read') return 'readback remains unchanged and no write receipt is created'
  if (effect === 'workspace-write') return 'before/after workspace manifest and content hash readback'
  if (effect === 'external-write') return 'isolated service receipt plus independent server-side state readback'
  if (effect === 'compute') return 'run status, output artifact and workspace manifest readback'
  return 'before/after state readback, protected resource absence/presence and audit record'
}

function renderConfirmationMarkdown(entries) {
  const ready = entries.filter((entry) => entry.readiness === 'needs-live-verification').length
  const lines = [
    '# Confirmation action matrix',
    '',
    `The current generated Registry contains ${entries.length} Agent-visible confirmation actions. Every row has an approved and denied scenario; ${ready} already have both related case definitions and still require live verification.`,
    '',
    '| Action | Owner | Effect | Approved case | Denied case | Existing approved | Existing denied | Readiness |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...entries.map((entry) => `| \`${entry.actionId}\` | ${entry.owner} | ${entry.effect} | \`${entry.approvedScenario.caseId}\` | \`${entry.deniedScenario.caseId}\` | ${entry.existingCaseIds.approvedEvidenceCaseIds.join(', ') || 'none'} | ${entry.existingCaseIds.deniedEvidenceCaseIds.join(', ') || 'none'} | ${entry.readiness} |`),
    '',
    'A denied scenario is not accepted from an assistant statement alone: it must observe the denial and independently verify that no protected state or external submission changed.',
    ''
  ]
  return lines.join('\n')
}

function renderEffectMarkdown(plans) {
  const groups = new Map()
  for (const plan of plans) {
    const group = groups.get(plan.effect) ?? []
    group.push(plan)
    groups.set(plan.effect, group)
  }
  const methods = {
    read: ['structured value/state readback', 'identity, count, ordering, range, empty-result and missing-resource checks'],
    'workspace-write': ['parse workspace output plus manifest/content hashes', 'before/after state, format validity, parent lineage and idempotency where applicable'],
    'external-write': ['isolated service receipt plus service-side readback', 'request payload, response identity, protected side effect and approval-denied absence'],
    compute: ['terminal state plus trace closure and artifact readback', 'provider mode, attempts, event sequence, output schema, artifact count and blocked/failure semantics'],
    destructive: ['before/after protected-state readback', 'target identity, deletion/restoration result, absence/presence and audit record']
  }
  const lines = [
    '# Capability result-acceptance audit',
    '',
    `Generated from the ${plans.length}-action Agent-visible plan. Effect counts are derived from the Registry: ${formatCounts(countBy(plans, (plan) => plan.effect))}.`,
    '',
    '| Effect | Actions | Fixture/oracle status | Acceptance method | Boundary obligations |',
    '| --- | ---: | --- | --- | --- |',
    ...[...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([effect, group]) => {
      const method = methods[effect] ?? ['independent structured readback', 'contract-specific state and side-effect checks']
      const fixtureReady = group.filter((plan) => plan.fixture?.status === 'ready').length
      const oracleReady = group.filter((plan) => plan.oracle?.status === 'ready').length
      const obligations = [...new Set(group.flatMap((plan) => plan.boundary?.obligations ?? []))]
      return `| ${effect} | ${group.length} | fixture ${fixtureReady}/${group.length}; oracle ${oracleReady}/${group.length} | ${method[0]}；${method[1]} | ${obligations.join(', ')} |`
    }),
    '',
    'The methods above are acceptance contracts, not live acceptance results. A successful invocation without independent output/state readback remains invocation-succeeded only.',
    ''
  ]
  return lines.join('\n')
}

async function readJsonl(filePath) {
  const content = await readFile(filePath, 'utf8')
  return content.split(/\r?\n/u).filter((line) => line.trim().length > 0).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid JSONL at ${path.relative(root, filePath)}:${index + 1}: ${error.message}`)
    }
  })
}

function countBy(values, selector) {
  return values.reduce((counts, value) => {
    const key = selector(value)
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

function formatCounts(counts) {
  return Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key} ${value}`).join('; ')
}

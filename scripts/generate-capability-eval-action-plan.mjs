#!/usr/bin/env node

import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const positionalArgs = process.argv.slice(2).filter((argument) => argument !== '--check')
const referencePath = path.resolve(root, positionalArgs[0] ?? 'docs/generated/capabilities.md')
const outputPath = path.resolve(root, positionalArgs[1] ?? 'eval-cases/capability/action-directed-plan.jsonl')
const caseOutputPath = path.resolve(root, positionalArgs[2] ?? 'eval-cases/capability/action-directed-planned.jsonl')
const batchConfigPath = path.resolve(root, 'eval-cases/capability/evaluation-batches.json')

const checkOnly = process.argv.includes('--check')
const batchConfig = JSON.parse(await readFile(batchConfigPath, 'utf8'))
const reference = await readFile(referencePath, 'utf8')
const lines = reference.split(/\r?\n/u)
const entries = []
const seenActionIds = new Set()
for (const line of lines) {
  const match = /^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/u.exec(line.trim())
  if (!match) continue
  const [, actionId, version, audiences, effect, approval, scope] = match
  if (!audiences.split(',').map((value) => value.trim()).includes('agent')) continue
  if (seenActionIds.has(actionId)) throw new Error(`Duplicate Agent-visible action in ${referencePath}: ${actionId}`)
  seenActionIds.add(actionId)
  const headingIndex = lines.indexOf(`## \`${actionId}\``)
  const description = headingIndex >= 0
    ? lines.slice(headingIndex + 1).find((value) => value.trim() && !value.startsWith('- '))?.trim()
    : undefined
  const domain = actionId.split('.')[0]
  const inputShape = inputShapeForAction(lines, actionId, headingIndex)
  const evidence = await actionEvidence(actionId)
  entries.push({
    schemaVersion: 'sciforge.capability-eval.action-plan.v2',
    status: 'planned',
    actionId,
    owner: domain,
    batch: batchForOwner(domain),
    version: version.trim(),
    effect: effect.trim(),
    approval: approval.trim(),
    scope: scope.trim(),
    task: {
      query: taskQuery(description, actionId),
      requiredAction: actionId
    },
    fixture: {
      kind: fixtureKind(effect.trim(), scope.trim()),
      status: evidence?.fixture?.status === 'available-in-package' ? 'ready' : 'needs-domain-fixture'
    },
    oracle: {
      kind: evidence?.oracle?.kind ?? oracleKind(effect.trim()),
      status: evidence?.oracle?.status === 'available-package-oracle' ? 'ready' : 'needs-independent-inspector'
    },
    boundary: {
      obligations: boundaryObligations(approval.trim(), effect.trim()),
      status: 'needs-case-scoped-harness'
    },
    inputShape,
    ...(evidence ? { evidence } : {})
  })
}

entries.sort((left, right) => left.actionId.localeCompare(right.actionId))
if (entries.length === 0) throw new Error(`No Agent-visible actions found in ${referencePath}.`)
const planContent = `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
const caseContent = `${entries.map(toEvalCase).map((entry) => JSON.stringify(entry)).join('\n')}\n`
await verifyEvidencePaths(entries)
if (checkOnly) {
  const [currentPlan, currentCases] = await Promise.all([
    readFile(outputPath, 'utf8'),
    readFile(caseOutputPath, 'utf8')
  ])
  if (currentPlan !== planContent || currentCases !== caseContent) {
    throw new Error(`Generated action evaluation plans are stale. Run npm run capability:eval:action-plan.`)
  }
  const { loadEvalCasesFromJsonl } = await import('../src/main/capability-eval/loader.ts')
  const plannedCases = await loadEvalCasesFromJsonl(caseOutputPath)
  if (plannedCases.length !== entries.length) {
    throw new Error(`Planned action case count ${plannedCases.length} does not match Agent-visible action count ${entries.length}.`)
  }
  const plannedActionIds = new Set(plannedCases.flatMap((evalCase) => evalCase.expected.requiredActions))
  const missingCases = entries
    .map((entry) => entry.actionId)
    .filter((actionId) => !plannedActionIds.has(actionId))
  if (missingCases.length > 0) {
    throw new Error(`Planned action cases are missing positive targets: ${missingCases.join(', ')}`)
  }
  const missingInputShapes = entries
    .filter((entry) => !entry.inputShape || typeof entry.inputShape !== 'object')
    .map((entry) => entry.actionId)
  if (missingInputShapes.length > 0) {
    throw new Error(`Action plans are missing input shapes: ${missingInputShapes.join(', ')}`)
  }
  const casesById = new Map(plannedCases.map((evalCase) => [evalCase.id, evalCase]))
  for (const entry of entries) {
    const evalCase = casesById.get(`planned-${entry.actionId}`)
    const argumentContract = evalCase?.expected.arguments[entry.actionId]
    const expectedArgumentContract = argumentExpectation(entry.inputShape)
    if (!argumentContract || JSON.stringify(argumentContract) !== JSON.stringify(expectedArgumentContract)) {
      throw new Error(`Planned action case argument contract is stale for ${entry.actionId}.`)
    }
  }
  console.log(`Verified ${entries.length} Agent-visible action plans are current.`)
} else {
  await writeFile(outputPath, planContent, 'utf8')
  await writeFile(caseOutputPath, caseContent, 'utf8')
  console.log(`Generated ${entries.length} Agent-visible action plans at ${path.relative(root, outputPath)}.`)
  console.log(`Generated ${entries.length} planned evaluator cases at ${path.relative(root, caseOutputPath)}.`)
}

function taskQuery(description, actionId) {
  const text = description?.replace(/\s+/gu, ' ').trim()
  if (text) return `Complete this request using the relevant SciForge capability: ${lowerFirst(text.replace(/[.]$/u, ''))}.`
  return `Complete the task supported by the relevant SciForge capability for ${actionId.split('.').slice(1).join(' ')}.`
}

function inputShapeForAction(lines, actionId, headingIndex) {
  if (headingIndex < 0) throw new Error(`Missing capability heading for ${actionId}.`)
  const nextHeadingIndex = lines.findIndex((value, index) => index > headingIndex && /^## `[^`]+`$/u.test(value.trim()))
  const sectionEnd = nextHeadingIndex >= 0 ? nextHeadingIndex : lines.length
  const contractHeadingIndex = lines.findIndex((value, index) => (
    index > headingIndex && index < sectionEnd && value.trim() === '### Contract'
  ))
  if (contractHeadingIndex < 0) throw new Error(`Missing contract for ${actionId}.`)
  const jsonStart = lines.findIndex((value, index) => (
    index > contractHeadingIndex && index < sectionEnd && value.trim() === '```json'
  ))
  if (jsonStart < 0) throw new Error(`Missing JSON contract for ${actionId}.`)
  const jsonEnd = lines.findIndex((value, index) => index > jsonStart && index < sectionEnd && value.trim() === '```')
  if (jsonEnd < 0) throw new Error(`Unterminated JSON contract for ${actionId}.`)
  let contract
  try {
    contract = JSON.parse(lines.slice(jsonStart + 1, jsonEnd).join('\n'))
  } catch (error) {
    throw new Error(`Invalid JSON contract for ${actionId}: ${error.message}`)
  }
  const inputSchema = contract?.inputSchema
  if (!inputSchema || typeof inputSchema !== 'object') throw new Error(`Missing inputSchema for ${actionId}.`)
  const properties = {}
  for (const [property, schema] of Object.entries(inputSchema.properties ?? {})) {
    if (!schema || typeof schema !== 'object') continue
    const shape = {}
    if (typeof schema.type === 'string') shape.type = schema.type
    if (Array.isArray(schema.enum)) shape.enum = schema.enum
    if (Array.isArray(schema.required)) shape.required = schema.required
    if (typeof schema.minItems === 'number') shape.minItems = schema.minItems
    if (typeof schema.maxItems === 'number') shape.maxItems = schema.maxItems
    properties[property] = shape
  }
  return {
    required: Array.isArray(inputSchema.required) ? inputSchema.required : [],
    properties
  }
}

async function actionEvidence(actionId) {
  const domain = actionId.split('.')[0]
  const evidencePath = path.resolve(root, 'packages', 'domains', domain, 'eval-cases', 'action-evidence.json')
  let payload
  try {
    payload = JSON.parse(await readFile(evidencePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw new Error(`Invalid package-owned evaluation evidence at ${path.relative(root, evidencePath)}: ${error.message}`, { cause: error })
  }
  const evidence = payload?.actionEvidence?.[actionId]
  return evidence
}

async function verifyEvidencePaths(entries) {
  const paths = [...new Set(entries.flatMap((entry) => [
    ...(entry.evidence?.unitEvidence ?? []).map((evidence) => evidence.path),
    ...(entry.evidence?.fixture?.paths ?? [])
  ]))]
  for (const relativePath of paths) {
    try {
      await access(path.resolve(root, relativePath))
    } catch (error) {
      throw new Error(`Evidence path does not exist: ${relativePath}`, { cause: error })
    }
  }
}

function lowerFirst(value) {
  return value.length === 0 ? value : value[0].toLowerCase() + value.slice(1)
}

function fixtureKind(effect, scope) {
  if (scope === 'resource') return 'owned-resource-fixture'
  if (effect === 'read') return 'deterministic-readable-state'
  if (effect === 'compute') return 'deterministic-compute-input'
  if (effect === 'destructive') return 'disposable-state-fixture'
  if (effect === 'external-write') return 'isolated-test-provider'
  return 'disposable-workspace-fixture'
}

function oracleKind(effect) {
  if (effect === 'read') return 'state-readback'
  if (effect === 'compute') return 'artifact-and-result-readback'
  if (effect === 'destructive') return 'state-transition-and-recovery-readback'
  if (effect === 'external-write') return 'isolated-service-observation'
  return 'content-and-lineage-readback'
}

function boundaryObligations(approval, effect) {
  const obligations = ['invalid-input-or-missing-resource']
  if (approval === 'confirmation') obligations.push('approval-allowed', 'approval-denied-no-side-effect')
  if (effect === 'compute') obligations.push('provider-failure-or-timeout')
  if (effect === 'destructive') obligations.push('stale-revision-or-precondition')
  return obligations
}

function toEvalCase(entry) {
  const expected = {
    mustDiscover: [entry.actionId],
    requiredActions: [entry.actionId],
    allowedActions: [entry.actionId],
    authorization: {
      [entry.actionId]: entry.approval === 'confirmation' ? 'confirmation' : 'allow'
    },
    invocation: {
      [entry.actionId]: { success: true }
    },
    arguments: {
      [entry.actionId]: argumentExpectation(entry.inputShape)
    }
  }
  return {
    id: `planned-${entry.actionId}`,
    query: entry.task.query,
    tags: ['action-directed', 'planned', entry.batch, entry.owner, entry.effect, ...(entry.approval === 'confirmation' ? ['authorization'] : [])],
    workflowType: 'single-action',
    expected
  }
}

function argumentExpectation(inputShape) {
  const types = {}
  for (const [property, shape] of Object.entries(inputShape.properties ?? {})) {
    if (typeof shape.type === 'string' && ['array', 'boolean', 'integer', 'number', 'object', 'string'].includes(shape.type)) {
      types[property] = shape.type === 'integer' ? 'number' : shape.type
    }
  }
  return {
    required: inputShape.required,
    types,
    values: {}
  }
}

function batchForOwner(owner) {
  return typeof batchConfig[owner] === 'string' ? batchConfig[owner] : 'unassigned'
}

#!/usr/bin/env node

/**
 * Builds the Phase 1 inventory for capability evaluation data.
 *
 * This command is deliberately metadata-only. It never rewrites a case and
 * never chooses one conflicting case body over another. A record is retained
 * for every source row and conflicts are reported in the manifest.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultOutput = path.resolve(root, 'eval-cases/capability/dataset-manifest.json')
const checkOnly = process.argv.includes('--check')
const outputPath = path.resolve(root, positionalValue('--output') ?? defaultOutput)

const referencePath = path.resolve(root, 'docs/generated/capabilities.md')
const referenceText = await readFile(referencePath, 'utf8')
const registry = parseRegistryReference(referenceText)
const sourceFiles = await discoverSourceFiles()
const records = []
for (const sourceFile of sourceFiles) {
  const content = await readFile(sourceFile, 'utf8')
  const relativeFile = path.relative(root, sourceFile)
  for (const [lineIndex, line] of content.split(/\r?\n/u).entries()) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    let raw
    try {
      raw = JSON.parse(trimmed)
    } catch (error) {
      throw new Error(`Invalid JSONL at ${relativeFile}:${lineIndex + 1}: ${error.message}`)
    }
    records.push(toRecord(raw, {
      sourceFile: relativeFile,
      line: lineIndex + 1,
      registry
    }))
  }
}

records.sort((left, right) => left.recordId.localeCompare(right.recordId))
const conflicts = buildConflicts(records)
const conflictByRecordId = new Map(conflicts.flatMap((conflict) => (
  conflict.recordIds.map((recordId) => [recordId, conflict.conflictGroup])
)))
for (const record of records) {
  const conflictGroup = conflictByRecordId.get(record.recordId)
  if (conflictGroup) record.conflictGroup = conflictGroup
}

const executable = records.filter((record) => record.recordKind === 'eval_case')
const uniqueCaseIds = new Set(executable.map((record) => record.caseId))
const authoritativeExecutable = executable.filter((record) => record.authoritativeSource)
const uniqueExecutable = uniqueByCase(executable)
const uniqueAuthoritativeExecutable = uniqueByCase(authoritativeExecutable)
const counts = {
  recordCount: records.length,
  executableRecordCount: executable.length,
  uniqueCaseCount: uniqueCaseIds.size,
  authoritativeExecutableCaseCount: authoritativeExecutable.length,
  authoritativeUniqueCaseCount: new Set(authoritativeExecutable.map((record) => record.caseId)).size,
  plannedRecordCount: records.filter((record) => record.recordKind === 'planned_action').length,
  metadataRecordCount: records.filter((record) => record.recordKind === 'metadata').length,
  naturalRoutingCaseCount: executable.filter((record) => record.source === 'natural-routing').length,
  naturalRoutingScenarioCount: new Set(executable.filter((record) => record.source === 'natural-routing').map((record) => record.scenarioId)).size,
  directActionRecords: executable.filter((record) => record.directActionLeakage).length,
  directActionUniqueCases: new Set(executable.filter((record) => record.directActionLeakage).map((record) => record.caseId)).size,
  directActionRatioAllUniqueCases: ratio(
    new Set(executable.filter((record) => record.directActionLeakage).map((record) => record.caseId)).size,
    uniqueCaseIds.size
  ),
  directActionRatioAuthoritativeCases: ratio(
    uniqueAuthoritativeExecutable.filter((record) => record.directActionLeakage).length,
    uniqueAuthoritativeExecutable.length
  ),
  nonActionPlanUniqueCaseCount: new Set(executable.filter((record) => record.source !== 'action-plan').map((record) => record.caseId)).size,
  directActionNonActionPlanUniqueCases: new Set(
    executable.filter((record) => record.source !== 'action-plan' && record.directActionLeakage).map((record) => record.caseId)
  ).size,
  directActionRatioNonActionPlanUniqueCases: ratio(
    new Set(executable.filter((record) => record.source !== 'action-plan' && record.directActionLeakage).map((record) => record.caseId)).size,
    new Set(executable.filter((record) => record.source !== 'action-plan').map((record) => record.caseId)).size
  ),
  uniqueCaseTaskTypes: countBy(uniqueExecutable, (record) => record.taskType),
  authoritativeUniqueCaseTaskTypes: countBy(uniqueAuthoritativeExecutable, (record) => record.taskType),
  leakageBreakdown: {
    exactActionNameRecords: executable.filter((record) => record.leakageSignals?.actionIds?.length > 0).length,
    exactActionNameAuthoritativeUniqueCases: uniqueAuthoritativeExecutable.filter((record) => record.leakageSignals?.actionIds?.length > 0).length,
    exactActionNameAllUniqueCases: uniqueExecutable.filter((record) => record.leakageSignals?.actionIds?.length > 0).length,
    explicitToolNameRecords: executable.filter((record) => record.leakageSignals?.toolNames?.length > 0).length,
    internalTermRecords: executable.filter((record) => record.leakageSignals?.internalTerms?.length > 0).length,
    hiddenInternalTermRecords: executable.filter((record) => record.leakageSignals?.hiddenInternalTerms?.length > 0).length,
    invocationCueRecords: executable.filter((record) => record.leakageSignals?.explicitInvocationCue).length
  },
  taskTypes: countBy(executable, (record) => record.taskType),
  executionModes: countBy(executable, (record) => record.executionMode),
  sourceKinds: countBy(records, (record) => record.source),
  split: countBy(records, (record) => record.split)
}

const actionDirectedPlanRecords = records.filter((record) => (
  record.source === 'action-plan' && record.recordKind === 'planned_action'
))
const actionDirectedExecutableRecords = executable.filter((record) => record.source === 'action-plan')

const manifestBase = {
  schemaVersion: 'sciforge.capability-eval.dataset-manifest.v1',
  manifestRevision: 'phase-1-environment-g0-v2',
  generator: 'scripts/generate-capability-eval-dataset-manifest.mjs',
  authoritativeSourcePolicy: {
    authoritativeExecutableSources: [
      'packages/domains/*/eval-cases/capability-golden.jsonl',
      'eval-cases/capability/integration-golden.jsonl'
    ],
    executableProjection: 'eval-cases/capability/golden.jsonl',
    executableProjectionRule: 'one generated row per authoritative case_id; the projection is the only executable input for the deterministic regression set',
    conflictRule: 'retain every source row; never silently overwrite a conflicting case ID',
    unassignedSplitRule: 'split remains unassigned when no source field or existing governance artifact proves train/holdout membership'
  },
  naturalRoutingSourcePolicy: {
    source: 'eval-cases/capability/natural-routing-v2.jsonl',
    executable: true,
    executionMode: 'live-agent',
    splitUnit: 'scenario_id',
    deterministicRegressionProjection: false
  },
  registry: {
    source: 'docs/generated/capabilities.md (generated from application registry composition)',
    totalRegisteredDescriptors: registry.entries.length,
    agentVisibleActions: registry.agentVisibleEntries.length,
    nonAgentVisibleDescriptors: registry.entries.length - registry.agentVisibleEntries.length,
    registeredDescriptorsComposedByCapabilityRegistry: true,
    audienceCounts: registry.audienceCounts,
    disabledActions: null,
    disabledActionsStatus: 'not-represented-by-capability-descriptor-schema',
    actionSetSha256: sha256(JSON.stringify(registry.entries.map(({ id, version, audiences }) => ({ id, version, audiences }))))
  },
  actionDirected: {
    planRecords: actionDirectedPlanRecords.length,
    executableProjectionRecords: actionDirectedExecutableRecords.length,
    uniqueActionIds: new Set([
      ...actionDirectedPlanRecords.map((record) => record.actionId),
      ...actionDirectedExecutableRecords.flatMap((record) => record.expectedActions ?? [])
    ]).size,
    sourceOfTruth: 'registry.agentVisibleActions'
  },
  counts,
  conflicts,
  records: records.map(toPublicRecord)
}
manifestBase.datasetSha256 = sha256(JSON.stringify(manifestBase))
const output = `${JSON.stringify(manifestBase, null, 2)}\n`

if (checkOnly) {
  const current = await readFile(outputPath, 'utf8')
  if (current !== output) {
    throw new Error(`Dataset manifest is stale. Run npm run capability:eval:dataset-manifest.`)
  }
  console.log(`Verified dataset manifest: ${path.relative(root, outputPath)}`)
} else {
  await writeFile(outputPath, output, 'utf8')
  console.log(`Wrote dataset manifest: ${path.relative(root, outputPath)}`)
  console.log(JSON.stringify(counts, null, 2))
  if (conflicts.length > 0) console.log(`Retained ${conflicts.length} conflicting case ID groups.`)
}

async function discoverSourceFiles() {
  const paths = new Set()
  const domainRoot = path.resolve(root, 'packages/domains')
  for (const domain of await readdir(domainRoot, { withFileTypes: true })) {
    if (!domain.isDirectory()) continue
    const candidate = path.join(domainRoot, domain.name, 'eval-cases/capability-golden.jsonl')
    if (await exists(candidate)) paths.add(candidate)
  }

  const capabilityRoot = path.resolve(root, 'eval-cases/capability')
  const jsonlFiles = (await readdir(capabilityRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl') && entry.name !== 'golden.jsonl')
    .map((entry) => path.join(capabilityRoot, entry.name))
  for (const candidate of jsonlFiles) paths.add(candidate)
  return [...paths].sort()
}

function toRecord(raw, context) {
  const source = sourceKind(context.sourceFile, raw)
  const isEvalCase = typeof raw?.id === 'string' && typeof raw?.query === 'string' && raw?.expected && typeof raw.expected === 'object'
  const isPlanned = typeof raw?.actionId === 'string' && raw?.task && typeof raw.task.query === 'string'
  const recordKind = isEvalCase ? 'eval_case' : isPlanned ? 'planned_action' : 'metadata'
  const caseId = isEvalCase ? raw.id : isPlanned ? `planned-${raw.actionId}` : raw?.caseId ?? raw?.id ?? `${context.sourceFile}:${context.line}`
  const scenarioId = isEvalCase ? String(raw.scenarioId ?? raw.id) : caseId
  const revision = String(raw.revision ?? '1')
  const contentHash = sha256(JSON.stringify(raw))
  const recordId = `${context.sourceFile}:${context.line}:${caseId}`
  const actionMatches = isEvalCase ? context.registry.actionIds.filter((actionId) => containsToken(raw.query, actionId)) : []
  const toolMatches = isEvalCase ? extractToolMatches(raw.query, raw.expected?.tools) : []
  const internalTermMatches = isEvalCase ? internalTerms(raw.query) : []
  const hiddenInternalTermMatches = isEvalCase ? hiddenInternalTerms(raw.query) : []
  const explicitInvocationCue = isEvalCase && invocationCue(raw.query)
  const directActionLeakage = isEvalCase && (
    actionMatches.length > 0 ||
    toolMatches.length > 0 ||
    hiddenInternalTermMatches.length > 0 ||
    explicitInvocationCue
  )
  const taskType = isEvalCase
    ? classifyTask(raw, { source, directActionLeakage })
    : isPlanned ? 'action_smoke' : 'evaluator_self_test'
  const executionMode = isEvalCase
    ? raw.simulation
      ? 'deterministic-simulation'
      : source === 'workflow-expansion' || source === 'action-plan'
        ? 'planned'
        : 'no-simulation-contract'
    : isPlanned ? 'planned' : 'metadata'
  const split = raw?.split ?? (
    recordKind === 'metadata' && (raw?.split === 'train' || raw?.split === 'holdout')
      ? raw.split
      : source === 'action-plan'
        ? 'planned'
        : source === 'evaluator-self-test'
          ? 'evaluator-self-test'
          : source === 'domain-package' || source === 'integration'
            ? 'regression'
            : 'unassigned'
  )
  const record = {
    recordId,
    recordKind,
    caseId,
    scenarioId,
    revision,
    source,
    sourceFile: context.sourceFile,
    sourceLine: context.line,
    authoritativeSource: source === 'domain-package' || source === 'integration',
    split,
    executionMode,
    contentSha256: contentHash
  }
  if (isEvalCase) {
    Object.assign(record, {
      taskType,
      querySha256: sha256(raw.query),
      queryPreview: raw.query.slice(0, 180),
      expectedActions: unique([
        ...(raw.expected.requiredActions ?? []),
        ...(raw.expected.expectedActions ?? []),
        ...(raw.expected.acceptableActions ?? []),
        ...(raw.expected.mustDiscover ?? []),
        ...(raw.expected.allowedActions ?? []),
        ...(raw.expected.alternativeActionGroups ?? []).flat()
      ]).sort(),
      directActionLeakage,
      leakageSignals: {
        actionIds: actionMatches,
        toolNames: toolMatches,
        internalTerms: internalTermMatches,
        hiddenInternalTerms: hiddenInternalTermMatches,
        explicitInvocationCue
      },
      hasSimulation: Boolean(raw.simulation),
      workflowType: raw.workflowType ?? null,
      tags: raw.tags ?? [],
      ...(raw.scenarioId ? { scenarioId: raw.scenarioId } : {}),
      ...(raw.queryStyle ? { queryStyle: raw.queryStyle } : {}),
      ...(raw.difficulty ? { difficulty: raw.difficulty } : {}),
      ...(raw.source ? { caseSource: raw.source } : {}),
      expectedTaskSuccess: raw.expected.taskSuccess ?? null,
      noCapabilityCalls: raw.expected.noCapabilityCalls ?? null
    })
  } else if (isPlanned) {
    Object.assign(record, {
      actionId: raw.actionId,
      querySha256: sha256(raw.task.query),
      queryPreview: raw.task.query.slice(0, 180),
      expectedActions: [raw.actionId]
    })
  } else {
    record.metadataKeys = Object.keys(raw ?? {}).sort()
    if (raw?.split === 'train' || raw?.split === 'holdout') record.declaredSplit = raw.split
  }
  return record
}

function classifyTask(raw, context) {
  if (raw.selfTest) return 'evaluator_self_test'
  if (context.source === 'action-plan') return 'action_smoke'
  if (context.directActionLeakage) return 'action_smoke'
  const required = raw.expected?.requiredActions ?? []
  const workflow = raw.workflowType
  if (
    workflow === 'multi-step' ||
    workflow === 'cross-domain' ||
    required.length > 1 ||
    (raw.tags ?? []).some((tag) => /workflow|multi[-_ ]?step|cross[-_ ]?domain/iu.test(tag)) ||
    context.source === 'workflow' ||
    context.source === 'workflow-expansion'
  ) return 'end_to_end'
  return 'routing'
}

function sourceKind(relativeFile, raw) {
  if (relativeFile.startsWith('packages/domains/')) return 'domain-package'
  if (relativeFile.endsWith('/integration-golden.jsonl')) return 'integration'
  if (relativeFile.endsWith('/golden.jsonl')) return 'generated-aggregate'
  if (relativeFile.includes('action-directed')) return 'action-plan'
  if (relativeFile.includes('evaluator-self-test')) return 'evaluator-self-test'
  if (relativeFile.includes('workflow-expansion')) return 'workflow-expansion'
  if (relativeFile.includes('natural-routing-v2')) return 'natural-routing'
  if (relativeFile.includes('workflow-')) return 'workflow'
  if (relativeFile.includes('-controlled')) return 'controlled'
  if (relativeFile.includes('-live')) return 'live'
  if (raw?.selfTest) return 'evaluator-self-test'
  return 'metadata'
}

function buildConflicts(records) {
  const byCase = new Map()
  for (const record of records.filter((entry) => entry.recordKind === 'eval_case')) {
    const list = byCase.get(record.caseId) ?? []
    list.push(record)
    byCase.set(record.caseId, list)
  }
  return [...byCase.entries()]
    .filter(([, list]) => new Set(list.map((entry) => entry.contentSha256)).size > 1)
    .map(([caseId, list]) => ({
      conflictGroup: `case:${caseId}`,
      caseId,
      recordIds: list.map((entry) => entry.recordId).sort(),
      sourceFiles: unique(list.map((entry) => entry.sourceFile)).sort(),
      contentSha256: unique(list.map((entry) => entry.contentSha256)).sort(),
      authoritativeRecordIds: list.filter((entry) => entry.authoritativeSource).map((entry) => entry.recordId).sort(),
      resolution: 'unresolved-in-phase-1; retain all records and require an explicit scenario/revision decision before merge'
    }))
}

function parseRegistryReference(markdown) {
  const entries = []
  for (const line of markdown.split(/\r?\n/u)) {
    const match = /^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/u.exec(line.trim())
    if (!match) continue
    const [, id, version, audiences] = match
    entries.push({
      id,
      version: version.trim(),
      audiences: audiences.split(',').map((value) => value.trim()).filter(Boolean)
    })
  }
  if (entries.length === 0) throw new Error(`No capability table found in ${referencePath}`)
  const audienceCounts = {}
  for (const entry of entries) for (const audience of entry.audiences) audienceCounts[audience] = (audienceCounts[audience] ?? 0) + 1
  return {
    entries: entries.sort((left, right) => left.id.localeCompare(right.id)),
    agentVisibleEntries: entries.filter((entry) => entry.audiences.includes('agent')),
    audienceCounts,
    actionIds: entries.map((entry) => entry.id)
  }
}

function containsToken(text, token) {
  return text.includes(token)
}

function extractToolMatches(query, tools) {
  const names = [
    ...(tools?.required ?? []),
    ...(tools?.allowed ?? []),
    ...(tools?.forbidden ?? []),
    ...(tools?.unnecessary ?? [])
  ].filter((value) => typeof value === 'string' && value.length > 2)
  return unique(names.filter((name) => query.includes(name))).sort()
}

function internalTerms(query) {
  const terms = [
    'operationRef', 'idempotencyKey', 'runtimeId', 'requiredActions', 'mustDiscover',
    'action id', 'action name', 'capability id', 'capability name', 'function name',
    'action', 'capability', 'tool', 'function', 'operation', 'schema', 'discovery',
    '调用', '使用', '通过', '工具', '能力', '函数', '操作', '接口'
  ]
  return terms.filter((term) => query.toLocaleLowerCase().includes(term.toLocaleLowerCase()))
}

function hiddenInternalTerms(query) {
  const terms = [
    'operationRef', 'idempotencyKey', 'runtimeId', 'requiredActions', 'mustDiscover',
    'action id', 'action name', 'capability id', 'capability name', 'function name',
    'opaque operationRef'
  ]
  return terms.filter((term) => query.toLocaleLowerCase().includes(term.toLocaleLowerCase()))
}

function invocationCue(query) {
  return /(?:调用|使用|通过|执行|直接).{0,80}(?:action|capability|tool|function|operation|能力|工具|函数|操作|接口)|(?:call|invoke|use|execute|run).{0,80}(?:action|capability|tool|function|operation)/iu.test(query)
}

function countBy(values, selector) {
  return values.reduce((counts, value) => {
    const key = selector(value)
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

function uniqueByCase(values) {
  return [...new Map(values.map((value) => [value.caseId, value])).values()]
}

function toPublicRecord(record) {
  const {
    recordId,
    recordKind,
    caseId,
    scenarioId,
    sourceFile,
    sourceLine,
    taskType,
    executionMode,
    contentSha256,
    ...rest
  } = record
  return {
    record_id: recordId,
    record_kind: recordKind,
    case_id: caseId,
    scenario_id: scenarioId,
    revision: record.revision,
    source: record.source,
    source_file: sourceFile,
    source_line: sourceLine,
    task_type: taskType ?? null,
    execution_mode: executionMode,
    split: record.split,
    authoritative_source: record.authoritativeSource,
    content_sha256: contentSha256,
    ...rest
  }
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4))
}

function unique(values) {
  return [...new Set(values)]
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function exists(filePath) {
  try {
    await readFile(filePath, { encoding: 'utf8', flag: 'r' })
    return true
  } catch {
    return false
  }
}

function positionalValue(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

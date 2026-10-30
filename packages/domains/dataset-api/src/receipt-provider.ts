import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  defineDomainWorkflowExecutionReceiptProvider,
  type DomainWorkflowExecutionReceiptProvider
} from '@sciforge/domain-sdk/workflow-template'

const DEFAULT_MAX_RUN_DURATION_MS = 30 * 60_000
const MAX_DATASET_GENERATION_RUN_DURATION_MS = 3 * 60 * 60_000
const DATASET_AGENT_NODE_TIMEOUT_MS = 12 * 60_000
const DATASET_PREPARATION_NODE_TIMEOUT_MS = 6 * 60_000
const DATASET_LLM_NODE_TIMEOUT_MS = 8 * 60_000
const TRANSIENT_MODEL_CONTEXT_KEYS = new Set([
  'challengerContext',
  'strongSolverContext',
  'judgeContext',
  'verifierContext',
  'strategyContext'
])

type WorkflowRecord = Record<string, unknown> & {
  id: string
  env: Array<{ key?: unknown; value?: unknown }>
  nodes: Array<Record<string, unknown>>
}

type RunRecord = Record<string, unknown> & {
  id: string
  status: string
  message: string
  startedAt: string
  finishedAt: string
  nodeResults: Array<Record<string, unknown> & {
    nodeId: string
    status: string
    outputJson: string
  }>
}

export function createDatasetWorkflowExecutionReceiptProvider(): DomainWorkflowExecutionReceiptProvider {
  return defineDomainWorkflowExecutionReceiptProvider({
    id: 'dataset-api.synthetic-generation.receipts',
    matches: isGeneratedDatasetWorkflow,
    nodeTimeoutMs: (_workflow, value) => {
      const node = requiredRecord(value, 'workflow node')
      if (node.type === 'ai-agent') {
        return node.id === 'preparation'
          ? DATASET_PREPARATION_NODE_TIMEOUT_MS
          : DATASET_AGENT_NODE_TIMEOUT_MS
      }
      return node.type === 'llm' ? DATASET_LLM_NODE_TIMEOUT_MS : 0
    },
    workflowTimeoutMs: workflowRunDurationMs,
    normalizeModelOutput: ({ workflow, node, incoming, responseText }) =>
      normalizeGeneratedDatasetLlmOutput(workflow, node, incoming, responseText),
    hydrateAgentResult: async ({ node, text, workspaceRoot, incoming, nodeStartedAt }) => {
      if (requiredRecord(node, 'workflow node').id !== 'preparation') return text
      return hydrateDatasetPreparationReceipt(text, workspaceRoot, incoming, nodeStartedAt)
    },
    recoverAgentResult: async ({ node, incoming, workspaceRoot, nodeStartedAt }) => {
      if (requiredRecord(node, 'workflow node').id !== 'preparation') {
        throw new Error('This workflow node has no execution receipt recovery contract.')
      }
      return recoverDatasetPreparationReceipt(incoming, workspaceRoot, nodeStartedAt)
    },
    writeRunReceipt: ({ statePath, workflow, run, workspaceRoot }) =>
      writeDatasetLoopRunReport({ statePath, workflow, run, workspaceRoot })
  })
}

export async function writeDatasetLoopRunReport(input: {
  statePath: string
  workflow: unknown
  run: unknown
  workspaceRoot: string
}): Promise<string> {
  const workflow = parseWorkflow(input.workflow)
  const run = parseRun(input.run)
  const workspaceRoot = input.workspaceRoot.trim()
  const reportDirectory = workspaceRoot && path.isAbsolute(workspaceRoot)
    ? path.join(workspaceRoot, '.sciforge', 'datasets', 'runs', 'create-loop', workflow.id)
    : path.join(path.dirname(input.statePath), 'reports', workflow.id)
  await mkdir(reportDirectory, { recursive: true })
  const reportPath = path.join(reportDirectory, `${run.id}.md`)
  const temporaryPath = `${reportPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, renderDatasetLoopRunReport(workflow, run), { flag: 'wx' })
  try {
    await rename(temporaryPath, reportPath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
  return reportPath
}

export function renderDatasetLoopRunReport(workflowValue: unknown, runValue: unknown): string {
  const workflow = parseWorkflow(workflowValue)
  const run = parseRun(runValue)
  const parsed = new Map(run.nodeResults.map((result) => [
    result.nodeId,
    parseOutputRecord(result.outputJson)
  ]))
  const latestState = [...run.nodeResults]
    .reverse()
    .map((result) => parseOutputRecord(result.outputJson))
    .find(hasAuditableState) ?? {}
  const state = ['batch-quality', 'ready', 'generation-loop']
    .map((nodeId) => parsed.get(nodeId) ?? {})
    .find(hasAuditableState) ?? latestState
  const design = recordObject(state.design)
  const schema = recordObject(state.outputSchema)
  const rubric = stringList(state.rubric).length
    ? stringList(state.rubric)
    : stringList(design?.rubric)
  const recipe = recordList(state.processingRecipe).length
    ? recordList(state.processingRecipe)
    : recordList(design?.processingRecipe)
  const preparation = recordObject(state.preparationExecution)
  const strategy = recordObject(state.strategy)
  const revisions = recordList(strategy?.revisions)
  const batchQuality = recordObject(state.batchQuality)
  const verdicts = recordList(state.verdicts)
  const loopTrace = recordList(state.loopExecutionTrace)
  const publication = parsed.get('parse-publication') ?? parsed.get('output') ?? {}
  const artifacts = collectArtifacts([state, publication])
  const lines = [
    '# Synthetic Dataset Loop Run Report',
    '',
    '## Run Summary',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Workflow | \`${markdownCode(workflow.id)}\` |`,
    `| Run | \`${markdownCode(run.id)}\` |`,
    `| Status | **${markdownCell(run.status)}** |`,
    `| Message | ${markdownCell(run.message)} |`,
    `| Started | ${markdownCell(run.startedAt)} |`,
    `| Finished | ${markdownCell(run.finishedAt)} |`,
    '',
    '## Designed Output Schema',
    ''
  ]
  if (!schema || Object.keys(schema).length === 0) {
    lines.push('_No designed schema was captured._')
  } else {
    lines.push('| Field | Type | Required | Description |', '| --- | --- | --- | --- |')
    for (const [field, raw] of Object.entries(schema)) {
      const definition = recordObject(raw) ?? {}
      lines.push(`| ${markdownCell(field)} | ${markdownCell(String(definition.type ?? 'unknown'))} | ${definition.required === true ? 'yes' : 'no'} | ${markdownCell(String(definition.description ?? ''))} |`)
    }
  }
  lines.push('', '## Task Rubric', '')
  if (rubric.length) rubric.forEach((item) => lines.push(`- ${item}`))
  else lines.push('_No task rubric was captured._')
  lines.push('', '## Dataset API Processing Recipe', '')
  if (recipe.length) {
    lines.push('| Step | Capability | Purpose |', '| ---: | --- | --- |')
    recipe.forEach((entry, index) => lines.push(
      `| ${index + 1} | \`${markdownCode(String(entry.capability ?? 'unknown'))}\` | ${markdownCell(String(entry.purpose ?? ''))} |`
    ))
  } else lines.push('_No processing recipe was captured._')
  lines.push('', '## Dataset API Preparation Execution', '')
  if (!preparation) {
    lines.push('_No plan-gated preparation was required or captured._')
  } else {
    lines.push(`- Plan: ${typeof state.preparationPlanId === 'string' ? `\`${markdownCode(state.preparationPlanId)}\`` : 'not captured'}`)
    lines.push(`- Status: **${markdownCell(String(preparation.status ?? 'unknown'))}**`)
    for (const step of recordList(preparation.steps)) {
      lines.push(`- \`${markdownCode(String(step.tool ?? 'unknown'))}\`: ${markdownCell(String(step.status ?? 'unknown'))}`)
    }
    for (const artifact of recordList(state.preparationArtifacts)) {
      if (artifact.path) lines.push(`- Evidence: \`${markdownCode(String(artifact.path))}\`${artifact.sha256 ? ` — SHA-256 \`${markdownCode(String(artifact.sha256))}\`` : ''}`)
    }
  }
  lines.push('', '## Node Execution', '', '| Node | Status | Retries | Error |', '| --- | --- | ---: | --- |')
  for (const result of run.nodeResults) {
    lines.push(`| \`${markdownCode(result.nodeId)}\` | ${markdownCell(result.status)} | ${Number(result.retries ?? 0)} | ${markdownCell(String(result.error ?? ''))} |`)
  }
  lines.push('', '### Loop Node Execution', '')
  if (!loopTrace.length) lines.push('_No loop-node execution trace was captured._')
  for (const iteration of loopTrace) {
    for (const node of recordList(iteration.nodes)) {
      lines.push(`- Round ${iteration.round ?? '?'}: \`${markdownCode(String(node.nodeId ?? 'unknown'))}\` — ${markdownCell(String(node.status ?? 'unknown'))}`)
    }
  }
  lines.push('', '## Candidate Evaluation and Independent Verification', '')
  if (!verdicts.length) lines.push('_No candidate verdicts were captured._')
  for (const verdict of verdicts) {
    lines.push(`- Round ${verdict.round ?? '?'}: ${verdict.accepted === true ? 'accepted' : 'rejected'}${stringList(verdict.failureReasons).length ? ` — ${stringList(verdict.failureReasons).join('; ')}` : ''}`)
  }
  lines.push('', '## Strategy Evolution', '')
  lines.push(`- Current recipe version: ${String(strategy?.version ?? 1)}`)
  if (typeof strategy?.currentRecipe === 'string') lines.push(`- Current recipe: ${strategy.currentRecipe}`)
  for (const revision of revisions) {
    lines.push(`- Round ${revision.round ?? '?'} / version ${revision.version ?? '?'}: ${String(revision.reason ?? '')}`)
    if (typeof revision.revisedRecipe === 'string') lines.push(`  - ${revision.revisedRecipe}`)
  }
  lines.push('', '## Batch Quality', '')
  if (!batchQuality) lines.push('_No batch-quality summary was captured._')
  else {
    lines.push('| Metric | Value |', '| --- | ---: |')
    for (const [key, value] of Object.entries(batchQuality)) {
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        lines.push(`| ${markdownCell(key)} | ${markdownCell(String(value))} |`)
      }
    }
  }
  lines.push('', '## Data Lineage and Artifact Hashes', '')
  for (const parent of stringList(state.parentArtifacts)) lines.push(`- Grounding parent: \`${markdownCode(parent)}\``)
  for (const artifact of artifacts) lines.push(`- \`${markdownCode(artifact.path)}\`${artifact.sha256 ? ` — SHA-256 \`${artifact.sha256}\`` : ''}`)
  if (!stringList(state.parentArtifacts).length && !artifacts.length) lines.push('_No artifact evidence was captured._')
  lines.push('', '## Publication', '')
  const publicationRecord = recordObject(publication.publication)
  if (typeof publication.planId === 'string') lines.push(`- Plan: \`${markdownCode(publication.planId)}\``)
  if (publicationRecord?.path) lines.push(`- Publication: \`${markdownCode(String(publicationRecord.path))}\``)
  if (publicationRecord?.manifestPath) lines.push(`- Manifest: \`${markdownCode(String(publicationRecord.manifestPath))}\``)
  for (const artifact of recordList(publicationRecord?.artifacts)) {
    if (artifact.path) lines.push(`- Published artifact: \`${markdownCode(String(artifact.path))}\`${artifact.sha256 ? ` — SHA-256 \`${markdownCode(String(artifact.sha256))}\`` : ''}`)
  }
  if (!publicationRecord?.path) lines.push('_No publication receipt was captured._')
  lines.push('')
  return `${lines.join('\n')}\n`
}

async function hydrateDatasetPreparationReceipt(
  text: string,
  workspaceRoot: string,
  incoming: unknown,
  nodeStartedAt: string
): Promise<string> {
  const reported = parseJson(text)
  if (!isRecord(reported)) throw new Error('Dataset preparation Agent did not return an object receipt.')
  const reportedExecution = recordObject(reported.preparationExecution)
  const planId = typeof reported.preparationPlanId === 'string'
    ? reported.preparationPlanId
    : typeof reportedExecution?.planId === 'string' ? reportedExecution.planId : ''
  if (!planId) {
    const reportedArtifacts = Array.isArray(reported.preparationArtifacts)
      ? reported.preparationArtifacts
      : []
    if (!reportedExecution && reportedArtifacts.length === 0) return JSON.stringify(reported)
    throw new Error('Dataset preparation Agent did not return a plan id.')
  }
  const actual = await latestRun(workspaceRoot, (execution) => execution.planId === planId)
  if (!actual) throw new Error(`No immutable Dataset API execution report exists for plan '${planId}'.`)
  if (actual.execution.status !== 'succeeded') {
    return recoverDatasetPreparationReceipt(incoming, workspaceRoot, nodeStartedAt)
  }
  return JSON.stringify({
    ...reported,
    preparationPlanId: planId,
    preparationExecution: actual.execution,
    preparationArtifacts: await verifiedDatasetPreparationArtifacts(actual.path, actual.execution),
    processingComplete: true,
    groundingComplete: true
  })
}

async function recoverDatasetPreparationReceipt(
  incoming: unknown,
  workspaceRoot: string,
  nodeStartedAt: string
): Promise<string> {
  if (!isRecord(incoming)) throw new Error('Dataset preparation recovery requires an object state.')
  const toolByCapability: Record<string, string> = {
    'dataset-api.profile': 'dataset_profile',
    'dataset-api.filter': 'dataset_filter',
    'dataset-api.select-columns': 'dataset_select_columns',
    'dataset-api.transform': 'dataset_transform',
    'dataset-api.deduplicate': 'dataset_deduplicate',
    'dataset-api.id-map': 'dataset_id_map',
    'dataset-api.id-map-provider': 'dataset_id_map_provider',
    'dataset-api.join': 'dataset_join',
    'dataset-api.structure-profile': 'dataset_structure_profile',
    'dataset-api.structure-validate': 'dataset_structure_validate',
    'dataset-api.graph-organize': 'dataset_graph_organize'
  }
  const expectedTools = (Array.isArray(incoming.processingRecipe) ? incoming.processingRecipe : [])
    .flatMap((entry) => isRecord(entry) && typeof entry.capability === 'string' && toolByCapability[entry.capability]
      ? [toolByCapability[entry.capability]!]
      : [])
  if (!expectedTools.length) throw new Error('No plan-gated preparation steps require recovery.')
  const nodeStartMs = Date.parse(nodeStartedAt)
  const actual = await latestRun(workspaceRoot, (execution) => {
    if (execution.status !== 'succeeded' || typeof execution.planId !== 'string') return false
    const startedMs = typeof execution.startedAt === 'string' ? Date.parse(execution.startedAt) : Number.NaN
    if (!Number.isFinite(startedMs) || startedMs < nodeStartMs) return false
    const steps = recordList(execution.steps)
    return steps.length === expectedTools.length &&
      steps.every((step, index) => step.tool === expectedTools[index] && step.status === 'succeeded')
  })
  if (!actual) throw new Error('No matching successful Dataset API execution exists for recovery.')
  return JSON.stringify({
    ...incoming,
    preparationPlanId: actual.execution.planId,
    preparationExecution: actual.execution,
    preparationArtifacts: await verifiedDatasetPreparationArtifacts(actual.path, actual.execution),
    processingComplete: true,
    groundingComplete: true
  })
}

async function latestRun(
  workspaceRoot: string,
  matches: (execution: Record<string, unknown>) => boolean
): Promise<{ path: string; execution: Record<string, unknown> } | null> {
  const runsRoot = path.join(workspaceRoot, '.sciforge', 'datasets', 'runs')
  const candidates: Array<{ path: string; execution: Record<string, unknown>; completedAt: string }> = []
  for (const name of await readdir(runsRoot)) {
    if (!/^run-[a-z0-9-]+\.json$/iu.test(name)) continue
    const runPath = path.join(runsRoot, name)
    try {
      const execution = JSON.parse(await readFile(runPath, 'utf8')) as unknown
      if (!isRecord(execution) || !matches(execution)) continue
      candidates.push({
        path: runPath,
        execution,
        completedAt: typeof execution.completedAt === 'string'
          ? execution.completedAt
          : typeof execution.updatedAt === 'string' ? execution.updatedAt : ''
      })
    } catch {
      // Ignore unrelated or partially-written run files.
    }
  }
  return candidates.sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0] ?? null
}

async function verifiedDatasetPreparationArtifacts(
  runPath: string,
  execution: Record<string, unknown>
): Promise<Array<{ path: string; sha256: string }>> {
  const artifacts = new Map<string, { path: string; sha256: string }>()
  for (const step of recordList(execution.steps)) {
    for (const artifact of recordList(step.artifacts)) {
      if (artifact.key !== 'artifact' || typeof artifact.path !== 'string' || typeof artifact.sha256 !== 'string') continue
      const observed = createHash('sha256').update(await readFile(artifact.path)).digest('hex')
      if (observed !== artifact.sha256) {
        throw new Error(`Dataset preparation artifact hash mismatch: ${artifact.path}`)
      }
      artifacts.set(artifact.path, { path: artifact.path, sha256: artifact.sha256 })
    }
  }
  artifacts.set(runPath, {
    path: runPath,
    sha256: createHash('sha256').update(await readFile(runPath)).digest('hex')
  })
  return [...artifacts.values()]
}

function normalizeGeneratedDatasetLlmOutput(
  workflow: unknown,
  nodeValue: unknown,
  incomingValue: unknown,
  responseText: string
): string {
  if (!isGeneratedDatasetWorkflow(workflow)) return responseText
  const node = requiredRecord(nodeValue, 'workflow node')
  if (!['challenger', 'weak-solver', 'strong-solver', 'judge', 'verifier', 'strategy-learner'].includes(String(node.id))) return responseText
  const parsed = parseJson(responseText)
  const incoming = requiredRecord(incomingValue, 'workflow input')
  const incomingJson = requiredRecord(incoming.json, 'workflow input envelope')
  const stableIncomingJson = requiredRecord(
    stripTransientModelContexts(incomingJson),
    'stable workflow input envelope'
  )
  if (!isRecord(parsed)) throw new Error(`Generated dataset ${String(node.id)} must return a JSON object envelope.`)
  if (node.id === 'challenger') {
    if (!isRecord(parsed.candidate) || !isRecord(parsed.generation)) {
      throw new Error('Generated dataset challenger must return candidate and generation objects.')
    }
    return JSON.stringify({ state: stableIncomingJson, candidate: parsed.candidate, generation: parsed.generation })
  }
  if (!isRecord(stableIncomingJson.state) || !isRecord(stableIncomingJson.candidate)) {
    throw new Error(`Generated dataset ${String(node.id)} input is missing state or candidate.`)
  }
  const fieldByNode: Record<string, string> = {
    'weak-solver': 'weak',
    'strong-solver': 'strong',
    verifier: 'verifier',
    judge: 'verdict',
    'strategy-learner': 'strategyUpdate'
  }
  const field = fieldByNode[String(node.id)]!
  if (!isRecord(parsed[field])) throw new Error(`Generated dataset ${String(node.id)} must return ${field}.`)
  return JSON.stringify({ ...stableIncomingJson, [field]: parsed[field] })
}

function stripTransientModelContexts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTransientModelContexts)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) =>
    TRANSIENT_MODEL_CONTEXT_KEYS.has(key)
      ? []
      : [[key, stripTransientModelContexts(entry)]]
  ))
}

function workflowRunDurationMs(workflow: unknown): number {
  if (!isGeneratedDatasetWorkflow(workflow)) return DEFAULT_MAX_RUN_DURATION_MS
  const parsed = parseWorkflow(workflow)
  const loop = parsed.nodes.find((node) => node.type === 'loop')
  const config = recordObject(loop?.config)
  if (config?.mode !== 'condition') return DEFAULT_MAX_RUN_DURATION_MS
  const iterations = Math.min(100, Math.max(1, Number(config.maxIterations) || 1))
  return Math.min(
    MAX_DATASET_GENERATION_RUN_DURATION_MS,
    Math.max(DEFAULT_MAX_RUN_DURATION_MS, (iterations + 2) * 20 * 60_000)
  )
}

function isGeneratedDatasetWorkflow(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.env)) return false
  return value.env.some((entry) => isRecord(entry) &&
    entry.key === 'SCIFORGE_GENERATED_KIND' && entry.value === 'dataset-generation')
}

function parseWorkflow(value: unknown): WorkflowRecord {
  const workflow = requiredRecord(value, 'workflow')
  if (typeof workflow.id !== 'string' || !Array.isArray(workflow.env) || !Array.isArray(workflow.nodes)) {
    throw new TypeError('Dataset workflow execution receipt requires a valid workflow.')
  }
  return workflow as WorkflowRecord
}

function parseRun(value: unknown): RunRecord {
  const run = requiredRecord(value, 'workflow run')
  if (typeof run.id !== 'string' || !Array.isArray(run.nodeResults)) {
    throw new TypeError('Dataset workflow execution receipt requires a valid run.')
  }
  return {
    ...run,
    id: run.id,
    status: String(run.status ?? ''),
    message: String(run.message ?? ''),
    startedAt: String(run.startedAt ?? ''),
    finishedAt: String(run.finishedAt ?? ''),
    nodeResults: run.nodeResults.map((value) => {
      const result = requiredRecord(value, 'workflow node result')
      return {
        ...result,
        nodeId: String(result.nodeId ?? ''),
        status: String(result.status ?? ''),
        outputJson: String(result.outputJson ?? '')
      }
    })
  }
}

function parseJson(text: string): unknown {
  const trimmed = text.trim()
  const candidates = [trimmed]
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)) {
    candidates.push(match[1]!.trim())
  }
  candidates.push(...extractBalancedJsonValues(trimmed).reverse())
  let lastError: unknown
  for (const candidate of [...new Set(candidates)]) {
    for (const value of [candidate, repairJsonLike(candidate)]) {
      try {
        return JSON.parse(value)
      } catch (error) {
        lastError = error
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Invalid JSON.')
}

function repairJsonLike(text: string): string {
  return escapeUnquotedQuotesInStrings(text
    .replace(/^\uFEFF/u, '')
    .replace(/([{,]\s*)'([^'\\\r\n]+)'(\s*:)/gu, '$1"$2"$3')
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)(\s*:)/gu, '$1"$2"$3')
    .replace(/,\s*([}\]])/gu, '$1'))
}

function escapeUnquotedQuotesInStrings(text: string): string {
  let repaired = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (!inString) {
      repaired += character
      if (character === '"') inString = true
      continue
    }
    if (escaped) {
      repaired += character
      escaped = false
      continue
    }
    if (character === '\\') {
      repaired += character
      escaped = true
      continue
    }
    if (character !== '"') {
      repaired += character
      continue
    }
    const nextSignificant = text.slice(index + 1).match(/^\s*([,:}\]])/u)?.[1]
    if (nextSignificant || text.slice(index + 1).trim() === '') {
      repaired += character
      inString = false
    } else {
      repaired += '\\"'
    }
  }
  return repaired
}

function extractBalancedJsonValues(text: string): string[] {
  const values: string[] = []
  for (let start = 0; start < text.length; start += 1) {
    const opening = text[start]
    if (opening !== '{' && opening !== '[') continue
    const stack: string[] = [opening]
    let inString = false
    let escaped = false
    for (let index = start + 1; index < text.length; index += 1) {
      const character = text[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') {
        inString = true
        continue
      }
      if (character === '{' || character === '[') stack.push(character)
      else if (character === '}' || character === ']') {
        const expected = character === '}' ? '{' : '['
        if (stack.pop() !== expected) break
        if (stack.length === 0) {
          values.push(text.slice(start, index + 1))
          start = index
          break
        }
      }
    }
  }
  return values
}

function parseOutputRecord(value: string): Record<string, unknown> {
  try {
    return recordObject(JSON.parse(value)) ?? {}
  } catch {
    return {}
  }
}

function hasAuditableState(value: Record<string, unknown>): boolean {
  return Boolean(recordObject(value.design) || recordObject(value.outputSchema) ||
    recordList(value.processingRecipe).length || recordObject(value.strategy))
}

function collectArtifacts(values: unknown[]): Array<{ path: string; sha256?: string }> {
  const found = new Map<string, { path: string; sha256?: string }>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || !value || typeof value !== 'object') return
    if (Array.isArray(value)) return value.forEach((entry) => visit(entry, depth + 1))
    const record = value as Record<string, unknown>
    if (typeof record.path === 'string') {
      found.set(record.path, {
        path: record.path,
        ...(typeof record.sha256 === 'string' ? { sha256: record.sha256 } : {})
      })
    }
    Object.values(record).forEach((entry) => visit(entry, depth + 1))
  }
  values.forEach((value) => visit(value, 0))
  return [...found.values()]
}

function requiredRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`Dataset execution receipt requires a valid ${name}.`)
  return value
}

function recordObject(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function markdownCode(value: string): string {
  return value.replace(/`/g, '\\`')
}

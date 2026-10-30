import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  datasetExecutePlanInputSchema,
  datasetResumePlanInputSchema,
  type DatasetExecutePlanInput,
  type DatasetResumePlanInput
} from './contract.js'
import type { DatasetProcessingService } from './processing.js'
import type { DatasetApiService } from './service.js'

type PlanOperation = {
  tool?: string
  description?: string
  parameters?: Record<string, unknown>
}

type ArtifactReference = {
  path: string
  sha256: string
  key: string
}

type ExecutionStep = {
  index: number
  tool: string
  description: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  attempts: number
  declaredParameters: Record<string, unknown>
  resolvedParameters?: Record<string, unknown>
  startedAt?: string
  completedAt?: string
  error?: string
  counts?: Record<string, unknown>
  artifacts: ArtifactReference[]
}

export type DatasetPlanExecutionState = {
  version: 1
  runId: string
  planId: string
  planSha256: string
  planPath: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  currentStepIndex: number | null
  steps: ExecutionStep[]
  artifactBindings: Record<string, ArtifactReference>
  startedAt: string
  updatedAt: string
  completedAt?: string
}

const ARTIFACT_PARAMETER_KEYS = new Set([
  'inputArtifact',
  'mappingArtifact',
  'leftArtifact',
  'rightArtifact',
  'artifact',
  'artifacts'
])

const activeRuns = new Set<string>()

export function createDatasetPlanExecutor(
  service: DatasetApiService,
  processing: DatasetProcessingService
) {
  return {
    async execute(raw: DatasetExecutePlanInput) {
      const input = datasetExecutePlanInputSchema.parse(raw)
      const confirmed = await processing.confirmedPlan(input)
      const runId = executionRunId(input.planId, confirmed.sha256)
      return withRunLock(runId, async () => {
        const path = runStatePath(confirmed.workspaceRoot, runId)
        const existing = await readState(path)
        if (existing) {
          verifyStateIdentity(existing, input.planId, confirmed.sha256)
          if (existing.status === 'succeeded') return executionResult(existing, path, true)
          if (existing.status === 'failed') return executionResult(existing, path, true)
          return runPlan(existing, path, confirmed.workspaceRoot, service, processing)
        }
        const state = createState(runId, input.planId, confirmed.sha256, confirmed.path, confirmed.plan.operations ?? [])
        await persistState(path, state)
        return runPlan(state, path, confirmed.workspaceRoot, service, processing)
      })
    },

    async resume(raw: DatasetResumePlanInput) {
      const input = datasetResumePlanInputSchema.parse(raw)
      const confirmed = await processing.confirmedPlan(input)
      const expectedRunId = executionRunId(input.planId, confirmed.sha256)
      if (input.runId && input.runId !== expectedRunId) {
        throw new Error(`Run '${input.runId}' does not belong to the current immutable plan '${input.planId}'.`)
      }
      return withRunLock(expectedRunId, async () => {
        const path = runStatePath(confirmed.workspaceRoot, expectedRunId)
        const state = await readState(path)
        if (!state) throw new Error(`No checkpoint exists for plan '${input.planId}'. Execute the plan before attempting to resume it.`)
        verifyStateIdentity(state, input.planId, confirmed.sha256)
        await repairCheckpoint(state)
        if (state.status === 'succeeded') return executionResult(state, path, true)
        await persistState(path, state)
        return runPlan(state, path, confirmed.workspaceRoot, service, processing)
      })
    }
  }
}

function createState(
  runId: string,
  planId: string,
  planSha256: string,
  planPath: string,
  operations: PlanOperation[]
): DatasetPlanExecutionState {
  if (!operations.length) throw new Error(`Confirmed plan '${planId}' contains no executable operations.`)
  const steps = operations.map((operation, index) => {
    if (!operation.tool || !operation.description) throw new Error(`Confirmed plan '${planId}' has an invalid operation at step ${index + 1}.`)
    if (!operation.parameters || Object.keys(operation.parameters).length === 0) {
      throw new Error(`Confirmed plan '${planId}' step ${index + 1} must declare exact parameters before automatic execution.`)
    }
    return {
      index,
      tool: operation.tool,
      description: operation.description,
      status: 'pending' as const,
      attempts: 0,
      declaredParameters: structuredClone(operation.parameters),
      artifacts: []
    }
  })
  const now = new Date().toISOString()
  return {
    version: 1,
    runId,
    planId,
    planSha256,
    planPath,
    status: 'pending',
    currentStepIndex: 0,
    steps,
    artifactBindings: {},
    startedAt: now,
    updatedAt: now
  }
}

async function runPlan(
  state: DatasetPlanExecutionState,
  statePath: string,
  workspaceRoot: string,
  service: DatasetApiService,
  processing: DatasetProcessingService
) {
  state.status = 'running'
  state.completedAt = undefined
  for (const step of state.steps) {
    if (step.status === 'succeeded') continue
    state.currentStepIndex = step.index
    step.status = 'running'
    step.attempts += 1
    step.error = undefined
    step.startedAt = new Date().toISOString()
    const resolved = resolveParameters(step.declaredParameters, state.artifactBindings)
    step.resolvedParameters = resolved
    await persistState(statePath, state)
    try {
      const result = await dispatch(step.tool, {
        ...resolved,
        workspaceRoot,
        planId: state.planId
      }, service, processing)
      step.artifacts = collectArtifacts(result)
      step.counts = collectCounts(result)
      bindStepArtifacts(state, step, result)
      step.status = 'succeeded'
      step.completedAt = new Date().toISOString()
      await persistState(statePath, state)
    } catch (error) {
      step.status = 'failed'
      step.error = error instanceof Error ? error.message : String(error)
      step.completedAt = new Date().toISOString()
      state.status = 'failed'
      await persistState(statePath, state)
      return executionResult(state, statePath, false)
    }
  }
  state.status = 'succeeded'
  state.currentStepIndex = null
  state.completedAt = new Date().toISOString()
  await persistState(statePath, state)
  return executionResult(state, statePath, false)
}

async function dispatch(
  tool: string,
  input: Record<string, unknown>,
  service: DatasetApiService,
  processing: DatasetProcessingService
): Promise<unknown> {
  switch (tool) {
    case 'dataset_api_metadata':
      await processing.authorizePlan({
        workspaceRoot: input.workspaceRoot as string,
        planId: input.planId as string,
        operation: tool,
        parameters: input
      })
      return service.metadata(input as never)
    case 'dataset_api_raw_data':
      await processing.authorizePlan({
        workspaceRoot: input.workspaceRoot as string,
        planId: input.planId as string,
        operation: tool,
        parameters: input
      })
      return service.rawData(input as never)
    case 'dataset_profile': return processing.profile(input as never)
    case 'dataset_filter': return processing.filter(input as never)
    case 'dataset_select_columns': return processing.selectColumns(input as never)
    case 'dataset_transform': return processing.transform(input as never)
    case 'dataset_deduplicate': return processing.deduplicate(input as never)
    case 'dataset_id_map': return processing.mapIds(input as never)
    case 'dataset_id_map_provider': return processing.providerIdMapping(input as never)
    case 'dataset_join': return processing.join(input as never)
    case 'dataset_structure_profile': return processing.structureProfile(input as never)
    case 'dataset_structure_validate': return processing.structureValidate(input as never)
    case 'dataset_graph_organize': return processing.organizeGraph(input as never)
    case 'dataset_materialize': return processing.materialize(input as never)
    case 'dataset_validate': return processing.validate(input as never)
    case 'dataset_publish': return processing.publish(input as never)
    default: throw new Error(`Confirmed plan contains unsupported operation '${tool}'.`)
  }
}

function resolveParameters(
  parameters: Record<string, unknown>,
  bindings: Record<string, ArtifactReference>
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(parameters).map(([key, value]) => [
    key,
    ARTIFACT_PARAMETER_KEYS.has(key) ? resolveArtifactValue(value, bindings) : structuredClone(value)
  ]))
}

function resolveArtifactValue(value: unknown, bindings: Record<string, ArtifactReference>): unknown {
  if (Array.isArray(value)) return value.map((entry) => resolveArtifactValue(entry, bindings))
  if (typeof value !== 'string') return structuredClone(value)
  const binding = bindings[value] ?? bindings[basename(value)] ?? bindings[logicalName(value)]
  return binding?.path ?? value
}

function bindStepArtifacts(state: DatasetPlanExecutionState, step: ExecutionStep, result: unknown): void {
  for (const artifact of step.artifacts) {
    for (const alias of [artifact.key, artifact.path, basename(artifact.path), logicalName(artifact.path)]) {
      state.artifactBindings[alias] = artifact
    }
  }
  const outputFileName = step.declaredParameters.outputFileName
  if (typeof outputFileName === 'string' && step.artifacts.length > 0) {
    const primary = primaryArtifact(result) ?? step.artifacts[0]
    state.artifactBindings[outputFileName] = primary
    state.artifactBindings[basename(outputFileName)] = primary
  }
}

function collectArtifacts(value: unknown, key = 'result', seen = new Set<string>()): ArtifactReference[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((entry, index) => collectArtifacts(entry, `${key}.${index}`, seen))
  const record = value as Record<string, unknown>
  const artifacts: ArtifactReference[] = []
  if (typeof record.path === 'string' && typeof record.sha256 === 'string' && !seen.has(record.path)) {
    const artifactPath = key === 'publication' && typeof record.manifestPath === 'string'
      ? record.manifestPath
      : record.path
    seen.add(artifactPath)
    artifacts.push({ path: artifactPath, sha256: record.sha256, key })
  }
  for (const [childKey, child] of Object.entries(record)) {
    artifacts.push(...collectArtifacts(child, key === 'result' ? childKey : `${key}.${childKey}`, seen))
  }
  return artifacts
}

function primaryArtifact(result: unknown): ArtifactReference | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined
  const record = result as Record<string, unknown>
  for (const key of ['artifact', 'graphArtifact']) {
    const candidate = record[key]
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const artifact = candidate as Record<string, unknown>
      if (typeof artifact.path === 'string' && typeof artifact.sha256 === 'string') {
        return { path: artifact.path, sha256: artifact.sha256, key }
      }
    }
  }
  return undefined
}

function collectCounts(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const recordSamples = Array.isArray(record.recordSamples)
    ? structuredClone(record.recordSamples.slice(0, 3))
    : undefined
  const counts = record.counts
  if (counts && typeof counts === 'object' && !Array.isArray(counts)) {
    return { ...(counts as Record<string, unknown>), ...(recordSamples ? { recordSamples } : {}) }
  }
  const profile = record.profile
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    const records = (profile as Record<string, unknown>).records
    if (typeof records === 'number') return { records }
  }
  const validation = record.validation
  if (validation && typeof validation === 'object' && !Array.isArray(validation)) {
    const report = validation as Record<string, unknown>
    return Object.fromEntries(['valid', 'records', 'errorCount', 'warningCount']
      .flatMap((key) => report[key] === undefined ? [] : [[key, report[key]]]))
  }
  return undefined
}

async function repairCheckpoint(state: DatasetPlanExecutionState): Promise<void> {
  let resetFrom = state.steps.findIndex((step) => step.status !== 'succeeded')
  if (resetFrom < 0) resetFrom = state.steps.length
  for (const step of state.steps.slice(0, resetFrom)) {
    const valid = await artifactsAreValid(step.artifacts)
    if (!valid) {
      resetFrom = step.index
      break
    }
  }
  if (resetFrom >= state.steps.length) return
  for (const step of state.steps.slice(resetFrom)) {
    step.status = 'pending'
    step.error = undefined
    step.resolvedParameters = undefined
    step.startedAt = undefined
    step.completedAt = undefined
    step.artifacts = []
    step.counts = undefined
  }
  state.artifactBindings = {}
  for (const step of state.steps.slice(0, resetFrom)) bindStepArtifacts(state, step, undefined)
  state.status = 'pending'
  state.currentStepIndex = resetFrom
  state.completedAt = undefined
}

async function artifactsAreValid(artifacts: ArtifactReference[]): Promise<boolean> {
  for (const artifact of artifacts) {
    try {
      const file = await readFile(artifact.path)
      if (sha256(file) !== artifact.sha256) return false
    } catch {
      return false
    }
  }
  return true
}

async function executionResult(state: DatasetPlanExecutionState, statePath: string, reused: boolean) {
  const stateBytes = Buffer.from(`${JSON.stringify(state, null, 2)}\n`)
  const reportBytes = Buffer.from(renderExecutionReport(state))
  const reportPath = statePath.replace(/\.json$/i, '.md')
  await writeAtomic(reportPath, reportBytes)
  return {
    execution: {
      runId: state.runId,
      planId: state.planId,
      status: state.status,
      currentStepIndex: state.currentStepIndex,
      completedSteps: state.steps.filter((step) => step.status === 'succeeded').length,
      failedSteps: state.steps.filter((step) => step.status === 'failed').length,
      totalSteps: state.steps.length,
      resumable: state.status === 'failed',
      reused,
      steps: state.steps.map((step) => ({
        index: step.index,
        tool: step.tool,
        description: step.description,
        status: step.status,
        attempts: step.attempts,
        error: step.error,
        counts: step.counts,
        artifacts: compactReceiptArtifacts(step.artifacts)
      }))
    },
    artifact: {
      path: statePath,
      sha256: sha256(stateBytes),
      bytes: stateBytes.byteLength,
      format: 'report'
    },
    reportArtifact: {
      path: reportPath,
      sha256: sha256(reportBytes),
      bytes: reportBytes.byteLength,
      format: 'report'
    }
  }
}

function renderExecutionReport(state: DatasetPlanExecutionState): string {
  const succeeded = state.steps.filter((step) => step.status === 'succeeded').length
  const failed = state.steps.filter((step) => step.status === 'failed').length
  const lines = [
    '# Dataset Pipeline Execution Report',
    '',
    '> Generated from the immutable execution checkpoint. This report records observed execution evidence; the sibling JSON file remains the resumable machine state.',
    '',
    '## Run Summary',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Plan | \`${escapeMarkdownCode(state.planId)}\` |`,
    `| Run | \`${escapeMarkdownCode(state.runId)}\` |`,
    `| Status | **${state.status}** |`,
    `| Steps | ${succeeded} succeeded / ${failed} failed / ${state.steps.length} total |`,
    `| Started | ${escapeMarkdownCell(state.startedAt)} |`,
    `| Completed | ${escapeMarkdownCell(state.completedAt ?? 'not completed')} |`,
    '',
    '## Executed Steps',
    '',
    '| Step | Capability | Status | Attempts | Observed counts | Evidence artifacts |',
    '| ---: | --- | --- | ---: | --- | --- |'
  ]
  for (const step of state.steps) {
    const counts = step.counts ? JSON.stringify(step.counts) : '—'
    const artifacts = step.artifacts.length > 0
      ? step.artifacts.map((artifact) => `\`${escapeMarkdownCode(artifact.path)}\` (\`${artifact.sha256.slice(0, 12)}…\`)`).join('<br>')
      : '—'
    lines.push(`| ${step.index + 1} | \`${escapeMarkdownCode(step.tool)}\` | ${step.status} | ${step.attempts} | ${escapeMarkdownCell(counts)} | ${artifacts} |`)
  }
  const failedSteps = state.steps.filter((step) => step.error)
  if (failedSteps.length > 0) {
    lines.push('', '## Failures', '')
    for (const step of failedSteps) lines.push(`- Step ${step.index + 1} \`${escapeMarkdownCode(step.tool)}\`: ${step.error}`)
  }
  lines.push(
    '',
    '## Verification',
    '',
    `- Immutable plan SHA-256: \`${state.planSha256}\``,
    `- Resumable checkpoint: \`${escapeMarkdownCode(statePathForReport(state))}\``,
    '- Artifact hashes above are the values captured when each step completed.',
    ''
  )
  return `${lines.join('\n')}\n`
}

function statePathForReport(state: DatasetPlanExecutionState): string {
  return join(dirname(state.planPath), '..', 'runs', `${state.runId}.json`)
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function escapeMarkdownCode(value: string): string {
  return value.replace(/`/g, '\\`')
}

async function writeAtomic(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, bytes, { flag: 'wx' })
  try {
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function compactReceiptArtifacts(artifacts: ArtifactReference[]): ArtifactReference[] {
  const primary = artifacts.filter((artifact) => (
    artifact.key === 'artifact' ||
    artifact.key === 'graphArtifact' ||
    artifact.key === 'publication'
  ))
  return primary.length > 0 ? primary : artifacts.slice(0, 1)
}

function executionRunId(planId: string, planSha256: string): string {
  return `run-${sha256(Buffer.from(`${planId}:${planSha256}`)).slice(0, 16)}`
}

function runStatePath(workspaceRoot: string, runId: string): string {
  return join(workspaceRoot, '.sciforge', 'datasets', 'runs', `${runId}.json`)
}

async function readState(path: string): Promise<DatasetPlanExecutionState | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as DatasetPlanExecutionState
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function persistState(path: string, state: DatasetPlanExecutionState): Promise<void> {
  state.updatedAt = new Date().toISOString()
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' })
  try {
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function verifyStateIdentity(state: DatasetPlanExecutionState, planId: string, planSha256: string): void {
  if (state.version !== 1 || state.planId !== planId || state.planSha256 !== planSha256) {
    throw new Error(`Checkpoint identity does not match immutable plan '${planId}'. Create and confirm a revised plan.`)
  }
}

async function withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
  if (activeRuns.has(runId)) throw new Error(`Dataset plan run '${runId}' is already executing.`)
  activeRuns.add(runId)
  try {
    return await operation()
  } finally {
    activeRuns.delete(runId)
  }
}

function logicalName(path: string): string {
  return basename(path)
    .replace(/^(?:[a-f0-9]{12,16}-)+/u, '')
    .replace(/-[a-f0-9]{12,16}(?=\.[^.]+$|$)/u, '')
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

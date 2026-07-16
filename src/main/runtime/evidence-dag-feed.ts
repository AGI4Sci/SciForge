import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  AgentRuntimeId,
  AgentRuntimeItem,
  AgentRuntimeThreadDetail
} from '../../shared/agent-runtime-contract'
import {
  DEFAULT_EVIDENCE_DAG_TIMEOUT_MS,
  EVIDENCE_DAG_TIMEOUT_MS_ENV,
  evidenceDagApiKeyFromEnv,
  evidenceDagServiceUrlFromEnv,
  evidenceDagThreadId
} from '../../../packages/workers/evidence-dag/desktop/contract'
import {
  projectDagApiKeyFromEnv,
  projectDagServiceUrlFromEnv
} from '../../../packages/workers/project-dag/desktop/contract'

export type EngineTraceItem = Record<string, unknown> & { id: string }

export type DagUpdateReason =
  | 'turn_committed'
  | 'manual_immediate'
  | 'schema_upgrade'
  | 'corruption_recovery'
  | 'reinterpretation'
  | 'artifact_changed'
  | 'decision_recorded'
  | 'goal_changed'
  | 'recovery'

export type DagUpdatePriority = 'background' | 'normal' | 'high' | 'immediate'

export type EvidenceSnapshot = {
  threadId: string
  version: number
  digest: string
  inputWatermark: string
  schemaVersion: string
  extractorVersion: string
  verifierVersion: string
  artifactDigests: string[]
  createdAt: string
  status: 'committed'
}

export type EvidenceDagProjectContext = {
  projectKey?: string
  workspaceRoot?: string
  projectRoot?: string
  project?: string
  includedSessions?: string[]
  excludedSessions?: string[]
  isolatedSessions?: string[]
  autonomyMode?: 'autonomous' | 'checkpointed' | 'supervised'
  updateReason?: 'manual_immediate'
}

export type EnqueueEvidenceDagUpdateInput = {
  runtimeId: AgentRuntimeId | string
  threadId: string
  items: readonly AgentRuntimeItem[]
  targetWatermark?: string
  reason: DagUpdateReason
  priority?: DagUpdatePriority
  rebuild?: boolean
  rebuildRationale?: string
  projectContext?: EvidenceDagProjectContext
  coordinateProject?: boolean
}

export type EvidenceDagQueueStatus = {
  state: 'fresh' | 'dirty' | 'queued' | 'updating' | 'failed' | 'paused' | 'degraded'
  pendingCount: number
  phase?: QueueJobPhase
  attempts?: number
  updatedAt?: string
  jobId?: string
  desiredWatermark?: string
  committedWatermark?: string
  snapshot?: EvidenceSnapshot
  lastError?: string
  nextAttemptAt?: string
}

export type EnqueueEvidenceDagUpdateResult = EvidenceDagQueueStatus & {
  jobId: string
  coalesced: boolean
}

export type EnsureEvidenceDagFreshInput = EnqueueEvidenceDagUpdateInput & {
  timeoutMs?: number
}

export type EnsureProjectFreshInput = {
  sessions: Array<Omit<EnqueueEvidenceDagUpdateInput, 'reason' | 'priority' | 'projectContext'>>
  projectContext: EvidenceDagProjectContext & { includedSessions: string[] }
  timeoutMs?: number
}

type QueueJobStatus = 'queued' | 'running' | 'retrying' | 'succeeded'
type QueueJobPhase = 'evidence' | 'project'

type EvidenceQueueJob = {
  id: string
  runtimeId: string
  threadId: string
  engineThreadId: string
  trace: EngineTraceItem[]
  targetWatermark: string
  reason: DagUpdateReason
  priority: DagUpdatePriority
  rebuild: boolean
  rebuildRationale?: string
  projectContext?: EvidenceDagProjectContext
  coordinateProject: boolean
  phase: QueueJobPhase
  status: QueueJobStatus
  attempts: number
  createdAt: string
  updatedAt: string
  nextAttemptAt?: string
  lastError?: string
  snapshot?: EvidenceSnapshot
}

type QueueFile = {
  version: 1
  jobs: EvidenceQueueJob[]
  recoveryWarning?: string
}

function projectCoordinationSessions(job: EvidenceQueueJob): string[] {
  return job.projectContext?.updateReason === 'manual_immediate'
    ? job.projectContext.includedSessions ?? [job.engineThreadId]
    : [job.engineThreadId]
}

export type EvidenceDagQueueCoordinatorOptions = {
  storagePath: string
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  ensureEvidenceDagReady?: () => Promise<void>
  ensureProjectDagReady?: () => Promise<void>
  /** Dynamic app-level feature gate. Disabled queues remain on disk but do no work. */
  isEnabled?: () => boolean | Promise<boolean>
  resolveProjectContext?: (input: {
    runtimeId: string
    threadId: string
    engineThreadId: string
  }) => Promise<EvidenceDagProjectContext | undefined>
  now?: () => Date
  retryBaseMs?: number
  retryMaxMs?: number
  maxAttempts?: number
  maxConcurrency?: number
  canRunBackground?: () => boolean
  activityPollMs?: number
}

const PRIORITY_WEIGHT: Record<DagUpdatePriority, number> = {
  background: 0,
  normal: 1,
  high: 2,
  immediate: 3
}
const DEFAULT_RETRY_BASE_MS = 1_000
const DEFAULT_RETRY_MAX_MS = 5 * 60_000
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_MAX_CONCURRENCY = 2
const DEFAULT_ACTIVITY_POLL_MS = 500
const SUCCEEDED_JOB_HISTORY_LIMIT = 50
// Keep each extraction prompt small enough to produce a provisional graph
// quickly. The HTTP service permits ~1 MiB, but approaching that ceiling makes
// model latency and timeout risk much worse for historical backfills.
// One /updates call performs extraction plus per-edge verification before it
// returns headers. Keep historical backfill batches comfortably below Node's
// default ~300s response-header timeout so each batch can commit independently.
const EVIDENCE_TRACE_BATCH_BYTES = 48 * 1024
const EVIDENCE_TRACE_BATCH_ITEMS = 64
const EVIDENCE_MESSAGE_CONTENT_LIMIT = 12_000
const EVIDENCE_TOOL_CONTENT_LIMIT = 8_000

class MissingEvidenceDagProjectContextError extends Error {
  constructor() {
    super('Evidence DAG update requires workspaceRoot and projectKey; retry after the thread is attached to a workspace.')
    this.name = 'MissingEvidenceDagProjectContextError'
  }
}

function completeProjectContext(
  context: EvidenceDagProjectContext | undefined
): EvidenceDagProjectContext | undefined {
  if (!context) return undefined
  const projectKey = context.projectKey?.trim()
  const workspaceRoot = context.workspaceRoot?.trim()
  if (!projectKey || !workspaceRoot) return undefined
  return {
    ...context,
    projectKey,
    workspaceRoot,
    ...(context.projectRoot?.trim() ? { projectRoot: context.projectRoot.trim() } : {}),
    ...(context.project?.trim() ? { project: context.project.trim() } : {})
  }
}

type EvidenceTraceReference = {
  kind: 'url' | 'doi' | 'citation' | 'file'
  value: string
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`\])}]+/gi
const DOI_PATTERN = /\b10\.\d{4,9}\/[\w.()/:+-]+/gi
const MARKDOWN_TARGET_PATTERN = /\]\(([^)]+)\)/g
const QUOTED_PATH_PATTERN = /[`'"]((?:\.{0,2}\/|\/)?[^`'"\s]+\/[^`'"\s]+)[`'"]/g
const REFERENCE_LIMIT = 64

function sortedJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('cyclic value')
    seen.add(value)
    const result = value.map((item) => sortedJsonValue(item, seen))
    seen.delete(value)
    return result
  }
  const record = objectRecord(value)
  if (!record) return value
  if (seen.has(record)) throw new TypeError('cyclic value')
  seen.add(record)
  const result = Object.fromEntries(Object.keys(record).sort().flatMap((key) => {
    const item = record[key]
    return item === undefined ? [] : [[key, sortedJsonValue(item, seen)]]
  }))
  seen.delete(record)
  return result
}

function canonicalOutput(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.stringify(sortedJsonValue(JSON.parse(trimmed)))
      } catch {
        return trimmed
      }
    }
    return trimmed
  }
  if (value == null) return ''
  try {
    return JSON.stringify(sortedJsonValue(value))
  } catch {
    return String(value)
  }
}

function firstContent(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const content = canonicalOutput(record[key])
    if (content) return content
  }
  return ''
}

function evidenceTraceTransportItem(item: EngineTraceItem): EngineTraceItem {
  const content = typeof item.content === 'string' ? item.content : ''
  const limit = item.type === 'tool_result' ? EVIDENCE_TOOL_CONTENT_LIMIT : EVIDENCE_MESSAGE_CONTENT_LIMIT
  if (content.length <= limit) return item
  return {
    ...item,
    content: `${content.slice(0, limit)} … [bounded for Evidence DAG extraction; source references preserved]`
  }
}

export function evidenceTraceBatches(trace: readonly EngineTraceItem[]): EngineTraceItem[][] {
  if (trace.length === 0) return [[]]
  const batches: EngineTraceItem[][] = []
  let batch: EngineTraceItem[] = []
  let batchBytes = 2
  for (const raw of trace) {
    const item = evidenceTraceTransportItem(raw)
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1
    if (batch.length > 0 && (
      batch.length >= EVIDENCE_TRACE_BATCH_ITEMS ||
      batchBytes + itemBytes > EVIDENCE_TRACE_BATCH_BYTES
    )) {
      batches.push(batch)
      batch = []
      batchBytes = 2
    }
    batch.push(item)
    batchBytes += itemBytes
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

function evidenceBatchWatermark(targetWatermark: string, index: number, batchCount: number): string {
  return index === batchCount - 1
    ? targetWatermark
    : `${targetWatermark}:batch:${index + 1}/${batchCount}`
}

function recordMeta(record: Record<string, unknown>): Record<string, unknown> {
  return objectRecord(record.meta) ?? {}
}

function toolName(record: Record<string, unknown>): string {
  const meta = recordMeta(record)
  return nonEmptyString(record.toolName) ?? nonEmptyString(record.tool_name) ??
    nonEmptyString(record.name) ?? nonEmptyString(meta.toolName) ??
    nonEmptyString(meta.tool_name) ?? nonEmptyString(meta.name) ??
    nonEmptyString(record.toolKind) ?? 'tool'
}

function toolCallId(record: Record<string, unknown>): string | undefined {
  const meta = recordMeta(record)
  return nonEmptyString(record.callId) ?? nonEmptyString(record.call_id) ??
    nonEmptyString(meta.callId) ?? nonEmptyString(meta.call_id)
}

function normalizedReferenceValue(value: string): string {
  return value.trim().replace(/^[<([{]+/, '').replace(/[>\])},.;:]+$/, '')
}

function evidenceTraceReferences(...values: unknown[]): EvidenceTraceReference[] {
  const references = new Map<string, EvidenceTraceReference>()
  const add = (kind: EvidenceTraceReference['kind'], raw: string): void => {
    if (references.size >= REFERENCE_LIMIT) return
    const value = normalizedReferenceValue(raw)
    if (!value) return
    references.set(`${kind}\u0000${value}`, { kind, value })
  }
  const scanText = (text: string): void => {
    for (const match of text.matchAll(URL_PATTERN)) add('url', match[0])
    for (const match of text.matchAll(DOI_PATTERN)) add('doi', match[0])
    for (const match of text.matchAll(MARKDOWN_TARGET_PATTERN)) {
      const target = match[1]?.trim()
      if (!target) continue
      if (/^https?:\/\//i.test(target)) add('url', target)
      else if (/^(?:\.{0,2}\/|\/)?[^\s]+(?:\/[^\s]+|\.[A-Za-z0-9]{1,16})$/.test(target)) add('file', target)
    }
    for (const match of text.matchAll(QUOTED_PATH_PATTERN)) {
      if (match[1]) add('file', match[1])
    }
  }
  const walk = (value: unknown, key = '', depth = 0): void => {
    if (depth > 6 || references.size >= REFERENCE_LIMIT || value == null) return
    if (typeof value === 'string') {
      const normalizedKey = key.replace(/[_-]/g, '').toLowerCase()
      if (['url', 'uri', 'href', 'sourceurl'].includes(normalizedKey)) add('url', value)
      else if (normalizedKey === 'doi') add('doi', value.replace(/^doi:/i, ''))
      else if (normalizedKey === 'citation' || normalizedKey === 'cite') add('citation', value)
      else if (
        normalizedKey === 'path' || normalizedKey === 'filepath' ||
        normalizedKey === 'relativepath' || normalizedKey === 'fulloutputpath'
      ) add('file', value)
      scanText(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1)
      return
    }
    const record = objectRecord(value)
    if (!record) return
    for (const [childKey, child] of Object.entries(record)) walk(child, childKey, depth + 1)
  }
  for (const value of values) walk(value)
  return [...references.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value))
}

function contentWithUnrepresentedReferences(
  content: string,
  references: readonly EvidenceTraceReference[]
): string {
  const missing = references.filter((reference) => !content.includes(reference.value))
  return missing.length
    ? `${content}\nVISIBLE_SOURCE_REFERENCES ${JSON.stringify(missing)}`
    : content
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numericWatermark(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function mergedWatermark(current: string, incoming: string): string {
  const currentNumber = numericWatermark(current)
  const incomingNumber = numericWatermark(incoming)
  if (currentNumber !== undefined && incomingNumber !== undefined) {
    return incomingNumber > currentNumber ? incoming : current
  }
  return incoming
}

function watermarkCovers(committed: string, target: string): boolean {
  const committedNumber = numericWatermark(committed)
  const targetNumber = numericWatermark(target)
  return committedNumber !== undefined && targetNumber !== undefined
    ? committedNumber >= targetNumber
    : committed === target
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function canonicalSnapshot(value: unknown): EvidenceSnapshot {
  const record = objectRecord(value)
  const artifactDigests = Array.isArray(record?.artifactDigests)
    ? record.artifactDigests.filter((digest): digest is string => typeof digest === 'string' && Boolean(digest.trim()))
    : []
  const threadId = nonEmptyString(record?.threadId)
  const digest = nonEmptyString(record?.digest)
  const inputWatermark = nonEmptyString(record?.inputWatermark)
  const schemaVersion = nonEmptyString(record?.schemaVersion)
  const extractorVersion = nonEmptyString(record?.extractorVersion)
  const verifierVersion = nonEmptyString(record?.verifierVersion)
  const createdAt = nonEmptyString(record?.createdAt)
  const version = record?.version
  if (
    !threadId || !digest || !inputWatermark || !schemaVersion || !extractorVersion ||
    !verifierVersion || !createdAt || typeof version !== 'number' || !Number.isInteger(version) ||
    version < 1 || record?.status !== 'committed'
  ) {
    throw new Error('Evidence DAG update did not return a canonical committed snapshot.')
  }
  return {
    threadId,
    version,
    digest,
    inputWatermark,
    schemaVersion,
    extractorVersion,
    verifierVersion,
    artifactDigests,
    createdAt,
    status: 'committed'
  }
}

async function requestServiceData(
  serviceUrl: string,
  apiKey: string,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${apiKey}`)
    if (init.body) headers.set('content-type', 'application/json')
    const response = await fetchImpl(`${serviceUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal
    })
    const body = await response.json().catch(() => null) as {
      ok?: boolean
      data?: unknown
      error?: { message?: unknown }
    } | null
    if (!response.ok || body?.ok !== true) {
      const message = nonEmptyString(body?.error?.message) ?? `DAG service returned HTTP ${response.status}`
      throw new Error(message)
    }
    return body.data
  } finally {
    clearTimeout(timer)
  }
}

export function isEvidenceDagFeedEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(evidenceDagServiceUrlFromEnv(env) && evidenceDagApiKeyFromEnv(env))
}

export function isEvidenceDagAutoFeedEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.SCIFORGE_EVIDENCE_DAG_AUTO_FEED?.trim().toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'no' && value !== 'off'
}

/**
 * Convert either the neutral AgentRuntime contract or a read-only raw Runtime
 * thread response into the one canonical Evidence trace shape. Raw support is
 * intentionally kept here so diagnostics and the desktop auto/manual lanes do
 * not grow a second trace policy. Calls are excluded; their completed result,
 * keyed by callId, is the evidence-bearing record.
 */
export function toEvidenceDagTraceItems(items: readonly unknown[]): EngineTraceItem[] {
  const out: EngineTraceItem[] = []
  const positions = new Map<string, number>()
  const add = (item: EngineTraceItem): void => {
    const position = positions.get(item.id)
    if (position === undefined) {
      positions.set(item.id, out.length)
      out.push(item)
    } else {
      out[position] = item
    }
  }
  for (const value of items) {
    const item = objectRecord(value)
    if (!item) continue
    const kind = nonEmptyString(item.kind)
    const itemId = nonEmptyString(item.id)
    if (!kind || !itemId) continue
    const createdAt = nonEmptyString(item.createdAt)
    const meta = recordMeta(item)

    if (kind === 'user_message') {
      const content = firstContent(item, ['text', 'content', 'detail', 'summary'])
      if (!content) continue
      const sourceRefs = evidenceTraceReferences(content, meta)
      add({
        id: itemId,
        type: 'message',
        role: 'user',
        content: contentWithUnrepresentedReferences(content, sourceRefs),
        ...(sourceRefs.length ? { source_refs: sourceRefs } : {}),
        ...(createdAt ? { created_at: createdAt } : {})
      })
      continue
    }

    if (
      kind === 'assistant_message' || kind === 'assistant_text' ||
      kind === 'reasoning' || kind === 'assistant_reasoning'
    ) {
      const content = firstContent(item, ['text', 'content', 'detail', 'summary'])
      if (!content) continue
      const sourceRefs = evidenceTraceReferences(content, meta)
      add({
        id: itemId,
        type: 'message',
        role: 'assistant',
        content: contentWithUnrepresentedReferences(content, sourceRefs),
        ...(sourceRefs.length ? { source_refs: sourceRefs } : {}),
        ...(createdAt ? { created_at: createdAt } : {})
      })
      continue
    }

    if (kind !== 'tool' && kind !== 'tool_result' && kind !== 'function_result' && kind !== 'tool_output') {
      continue
    }
    const status = nonEmptyString(item.status)
    if ((status !== 'success' && status !== 'completed') || item.isError === true) continue
    const content = firstContent(item, ['output', 'content', 'detail', 'text', 'summary'])
    if (!content) continue
    const callId = toolCallId(item)
    const sourceItemId = nonEmptyString(meta.sourceItemId) ?? itemId
    const id = callId ? `tool_${callId}` : itemId
    const sourceRefs = evidenceTraceReferences(item.output, item.content, item.detail, item.text, meta)
    add({
      id,
      type: 'tool_result',
      tool_name: toolName(item),
      content: contentWithUnrepresentedReferences(content, sourceRefs),
      ...(callId ? { call_id: callId } : {}),
      ...(sourceItemId !== id ? { source_item_id: sourceItemId } : {}),
      ...(sourceRefs.length ? { source_refs: sourceRefs } : {}),
      ...(createdAt ? { created_at: createdAt } : {})
    })
  }
  return out
}

export function completedTurnItems(
  detail: AgentRuntimeThreadDetail,
  turnId: string
): AgentRuntimeItem[] {
  const turn = detail.turns?.find((candidate) => candidate.id === turnId)
  if (turn?.items?.length) return turn.items
  return (detail.items ?? []).filter((item) => item.turnId === turnId)
}

export function evidenceDagQueuePath(userDataDir: string): string {
  return join(userDataDir, 'evidence-dag', 'desktop-update-queue.json')
}

export class EvidenceDagUpdateQueue {
  private jobs: EvidenceQueueJob[] = []
  private loaded = false
  private draining = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private serial: Promise<void> = Promise.resolve()
  private recoveryWarning: string | undefined

  constructor(private readonly options: EvidenceDagQueueCoordinatorOptions) {}

  async start(): Promise<void> {
    if (!await this.isEnabled()) return
    await this.exclusive(async () => {
      await this.loadUnlocked()
    })
    await this.recoverMissingProjectContexts()
    this.schedule(0)
  }

  pause(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private async recoverMissingProjectContexts(): Promise<void> {
    const legacyJobs = await this.exclusive(async () => this.jobs
      .filter((job) => job.status !== 'succeeded' && !completeProjectContext(job.projectContext))
      .map((job) => structuredClone(job)))
    for (const legacyJob of legacyJobs) {
      let resolved: EvidenceDagProjectContext | undefined
      try {
        resolved = completeProjectContext(await this.options.resolveProjectContext?.({
          runtimeId: legacyJob.runtimeId,
          threadId: legacyJob.threadId,
          engineThreadId: legacyJob.engineThreadId
        }))
      } catch {
        resolved = undefined
      }
      await this.exclusive(async () => {
        const current = this.jobs.find((job) => job.id === legacyJob.id)
        if (!current || current.status === 'succeeded' || completeProjectContext(current.projectContext)) return
        if (resolved) {
          current.projectContext = resolved
          current.coordinateProject = true
          if (current.status === 'queued') {
            current.attempts = 0
            current.nextAttemptAt = undefined
            current.lastError = undefined
          } else if (!current.nextAttemptAt) {
            // Repair terminal legacy jobs without waking every historical
            // backfill at startup. An explicit update is the recovery boundary.
            current.lastError = 'Project context recovered; retry this Evidence DAG update manually.'
          }
        } else {
          current.status = 'retrying'
          current.nextAttemptAt = undefined
          current.lastError = new MissingEvidenceDagProjectContextError().message
        }
        current.updatedAt = this.now().toISOString()
        await this.persistUnlocked()
      })
    }
  }

  async enqueue(input: EnqueueEvidenceDagUpdateInput): Promise<EnqueueEvidenceDagUpdateResult> {
    this.assertEnabled(await this.isEnabled())
    const trace = toEvidenceDagTraceItems(input.items)
    if (trace.length === 0 && input.reason !== 'artifact_changed') {
      throw new Error('Evidence DAG update has no visible trace items.')
    }
    const runtimeId = input.runtimeId.trim()
    const threadId = input.threadId.trim()
    if (!runtimeId || !threadId) throw new Error('Evidence DAG update requires runtimeId and threadId.')
    const projectContext = completeProjectContext(input.projectContext)
    if (!projectContext) throw new MissingEvidenceDagProjectContextError()
    const engineThreadId = evidenceDagThreadId(runtimeId, threadId)
    const targetWatermark = input.targetWatermark?.trim() || trace[trace.length - 1]?.id
    if (!targetWatermark) throw new Error('Evidence DAG update requires a target watermark.')
    const now = this.now().toISOString()
    const result = await this.exclusive(async () => {
      await this.loadUnlocked()
      const existing = this.jobs.find((job) =>
        job.engineThreadId === engineThreadId && job.phase === 'evidence' &&
        (job.status === 'queued' || job.status === 'retrying') && job.rebuild === Boolean(input.rebuild)
      )
      if (existing) {
        const existingWatermark = numericWatermark(existing.targetWatermark)
        const incomingWatermark = numericWatermark(targetWatermark)
        const ordered = existingWatermark !== undefined && incomingWatermark !== undefined && incomingWatermark < existingWatermark
          ? [...trace, ...existing.trace]
          : [...existing.trace, ...trace]
        const byId = new Map(ordered.map((item) => [item.id, item]))
        existing.trace = [...byId.values()]
        existing.targetWatermark = mergedWatermark(existing.targetWatermark, targetWatermark)
        existing.reason = input.reason
        if (PRIORITY_WEIGHT[input.priority ?? 'normal'] > PRIORITY_WEIGHT[existing.priority]) {
          existing.priority = input.priority ?? 'normal'
        }
        const wasRetrying = existing.status === 'retrying'
        existing.projectContext = projectContext
        existing.coordinateProject = existing.coordinateProject ||
          (input.coordinateProject ?? true)
        existing.rebuildRationale = input.rebuildRationale ?? existing.rebuildRationale
        existing.status = 'queued'
        if (wasRetrying && (input.reason === 'manual_immediate' || Boolean(input.rebuild))) {
          // An explicit user action is the recovery boundary for an open
          // circuit, including a retry whose backoff timer has not fired yet.
          // Without resetting the counter, a coalesced job can immediately
          // reopen the circuit after its repaired project context is submitted.
          existing.attempts = 0
        }
        existing.nextAttemptAt = undefined
        existing.lastError = undefined
        existing.updatedAt = now
        await this.persistUnlocked()
        return { job: existing, coalesced: true }
      }
      const job: EvidenceQueueJob = {
        id: randomUUID(),
        runtimeId,
        threadId,
        engineThreadId,
        trace,
        targetWatermark,
        reason: input.reason,
        priority: input.priority ?? 'normal',
        rebuild: Boolean(input.rebuild),
        rebuildRationale: input.rebuildRationale,
        projectContext,
        coordinateProject: input.coordinateProject ?? true,
        phase: 'evidence',
        status: 'queued',
        attempts: 0,
        createdAt: now,
        updatedAt: now
      }
      this.jobs.push(job)
      await this.persistUnlocked()
      return { job, coalesced: false }
    })
    this.schedule(0)
    return {
      ...this.statusForJob(result.job),
      jobId: result.job.id,
      coalesced: result.coalesced
    }
  }

  async status(runtimeId: string, threadId: string): Promise<EvidenceDagQueueStatus> {
    if (!await this.isEnabled()) {
      return {
        state: 'paused',
        pendingCount: 0,
        lastError: 'Evidence DAG is disabled in Settings.'
      }
    }
    return this.exclusive(async () => {
      await this.loadUnlocked()
      const engineThreadId = evidenceDagThreadId(runtimeId, threadId)
      const jobs = this.jobs.filter((job) => job.engineThreadId === engineThreadId)
      const active = jobs
        .filter((job) => job.status !== 'succeeded')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      if (active) return this.statusForJob(active)
      const latest = jobs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      return latest
        ? this.statusForJob(latest)
        : this.recoveryWarning
          ? { state: 'degraded', pendingCount: 0, lastError: this.recoveryWarning }
          : { state: 'fresh', pendingCount: 0 }
    })
  }

  async acknowledgeSnapshot(snapshot: EvidenceSnapshot): Promise<number> {
    return this.exclusive(async () => {
      await this.loadUnlocked()
      const now = this.now().toISOString()
      let acknowledged = 0
      for (const job of this.jobs) {
        if (job.engineThreadId !== snapshot.threadId ||
            (job.status !== 'queued' && job.status !== 'retrying') ||
            !watermarkCovers(snapshot.inputWatermark, job.targetWatermark)) continue
        job.snapshot = snapshot
        job.status = 'succeeded'
        job.lastError = undefined
        job.nextAttemptAt = undefined
        job.updatedAt = now
        acknowledged += 1
      }
      if (acknowledged > 0) {
        const succeeded = this.jobs
          .filter((job) => job.status === 'succeeded')
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        const keep = new Set(succeeded.slice(0, SUCCEEDED_JOB_HISTORY_LIMIT).map((job) => job.id))
        this.jobs = this.jobs.filter((job) => job.status !== 'succeeded' || keep.has(job.id))
        await this.persistUnlocked()
      }
      return acknowledged
    })
  }

  async retry(runtimeId: string, threadId: string): Promise<EvidenceDagQueueStatus> {
    this.assertEnabled(await this.isEnabled())
    const status = await this.exclusive(async () => {
      await this.loadUnlocked()
      const engineThreadId = evidenceDagThreadId(runtimeId, threadId)
      const job = this.jobs
        .filter((candidate) => candidate.engineThreadId === engineThreadId && candidate.status === 'retrying')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      if (!job) return { state: 'fresh', pendingCount: 0 } satisfies EvidenceDagQueueStatus
      job.status = 'queued'
      job.attempts = 0
      job.nextAttemptAt = undefined
      job.updatedAt = this.now().toISOString()
      await this.persistUnlocked()
      return this.statusForJob(job)
    })
    this.schedule(0)
    return status
  }

  async prioritize(runtimeId: string, threadId: string): Promise<EvidenceDagQueueStatus> {
    this.assertEnabled(await this.isEnabled())
    const status = await this.exclusive(async () => {
      await this.loadUnlocked()
      const engineThreadId = evidenceDagThreadId(runtimeId, threadId)
      const job = this.jobs
        .filter((candidate) => candidate.engineThreadId === engineThreadId && candidate.status !== 'succeeded')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      if (!job) return { state: 'fresh', pendingCount: 0 } satisfies EvidenceDagQueueStatus
      if (PRIORITY_WEIGHT[job.priority] < PRIORITY_WEIGHT.high) job.priority = 'high'
      job.updatedAt = this.now().toISOString()
      await this.persistUnlocked()
      return this.statusForJob(job)
    })
    this.schedule(0)
    return status
  }

  async waitForJob(jobId: string, timeoutMs = DEFAULT_EVIDENCE_DAG_TIMEOUT_MS): Promise<EvidenceSnapshot> {
    return this.waitFor(jobId, timeoutMs, true)
  }

  async waitForSnapshot(jobId: string, timeoutMs = DEFAULT_EVIDENCE_DAG_TIMEOUT_MS): Promise<EvidenceSnapshot> {
    return this.waitFor(jobId, timeoutMs, false)
  }

  private async waitFor(jobId: string, timeoutMs: number, requireProjectCommit: boolean): Promise<EvidenceSnapshot> {
    const startedAt = Date.now()
    while (true) {
      const job = await this.exclusive(async () => {
        await this.loadUnlocked()
        const current = this.jobs.find((candidate) => candidate.id === jobId)
        return current ? structuredClone(current) : undefined
      })
      if (!job) throw new Error(`Durable DAG job ${jobId} is no longer available.`)
      if (job.snapshot && (!requireProjectCommit || job.status === 'succeeded')) return job.snapshot
      if (job.status === 'retrying' && !job.nextAttemptAt) {
        throw new Error(job.lastError ?? 'Automatic Evidence DAG retry limit reached.')
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for durable DAG job ${jobId}; it remains queued in the background.`)
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 100)
        timer.unref?.()
      })
    }
  }

  private statusForJob(job: EvidenceQueueJob): EvidenceDagQueueStatus {
    const pendingCount = this.jobs.filter((candidate) =>
      candidate.engineThreadId === job.engineThreadId && candidate.status !== 'succeeded'
    ).length
    const state = job.status === 'succeeded'
      ? 'fresh'
      : job.status === 'running'
        ? 'updating'
        : job.status === 'retrying'
          ? 'failed'
          : 'queued'
    return {
      state: this.recoveryWarning && state === 'fresh' ? 'degraded' : state,
      pendingCount,
      phase: job.phase,
      attempts: job.attempts,
      updatedAt: job.updatedAt,
      jobId: job.id,
      desiredWatermark: job.targetWatermark,
      ...(job.snapshot ? {
        committedWatermark: job.snapshot.inputWatermark,
        snapshot: job.snapshot
      } : {}),
      ...(job.lastError || this.recoveryWarning ? { lastError: job.lastError ?? this.recoveryWarning } : {}),
      ...(job.nextAttemptAt ? { nextAttemptAt: job.nextAttemptAt } : {})
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    if (!await this.isEnabled()) return
    this.draining = true
    try {
      const concurrency = Math.max(1, Math.floor(this.options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY))
      await Promise.all(Array.from({ length: concurrency }, () => this.drainWorker()))
    } finally {
      this.draining = false
      if (await this.isEnabled()) {
        await this.scheduleNextRetry()
        if (await this.hasRunnableWorkBlockedByActivity()) {
          this.schedule(this.options.activityPollMs ?? DEFAULT_ACTIVITY_POLL_MS)
        }
      }
    }
  }

  private async drainWorker(): Promise<void> {
    while (true) {
      if (!await this.isEnabled()) return
      const job = await this.takeNextJob()
      if (!job) return
      try {
        const preparedJob = await this.withRequiredProjectContext(job)
        if (preparedJob.phase === 'evidence') {
          const snapshot = await this.submitEvidence(preparedJob)
          await this.exclusive(async () => {
            const current = this.jobs.find((candidate) => candidate.id === preparedJob.id)
            if (!current) return
            current.snapshot = snapshot
            current.phase = current.coordinateProject ? 'project' : 'evidence'
            current.status = current.coordinateProject ? 'queued' : 'succeeded'
            current.lastError = undefined
            current.nextAttemptAt = undefined
            current.updatedAt = this.now().toISOString()
            await this.persistUnlocked()
          })
        } else {
          await this.submitProjectSnapshot(preparedJob)
          await this.markSucceeded(preparedJob.id)
        }
      } catch (error) {
        await this.markRetry(job.id, error)
      }
    }
  }

  private async withRequiredProjectContext(job: EvidenceQueueJob): Promise<EvidenceQueueJob> {
    const existing = completeProjectContext(job.projectContext)
    if (existing) return { ...job, projectContext: existing }
    const resolved = completeProjectContext(await this.options.resolveProjectContext?.({
      runtimeId: job.runtimeId,
      threadId: job.threadId,
      engineThreadId: job.engineThreadId
    }))
    if (!resolved) throw new MissingEvidenceDagProjectContextError()
    return this.exclusive(async () => {
      const current = this.jobs.find((candidate) => candidate.id === job.id)
      if (!current) throw new Error(`Durable DAG job ${job.id} is no longer available.`)
      current.projectContext = resolved
      current.coordinateProject = true
      current.updatedAt = this.now().toISOString()
      await this.persistUnlocked()
      return structuredClone(current)
    })
  }

  private async takeNextJob(): Promise<EvidenceQueueJob | null> {
    return this.exclusive(async () => {
      await this.loadUnlocked()
      if (this.options.canRunBackground?.() === false) return null
      const nowMs = this.now().getTime()
      const runningThreads = new Set(this.jobs
        .filter((candidate) => candidate.status === 'running')
        .map((candidate) => candidate.engineThreadId))
      const job = this.jobs
        .filter((candidate) =>
          !runningThreads.has(candidate.engineThreadId) &&
          (candidate.status === 'queued' ||
          (candidate.status === 'retrying' && Date.parse(candidate.nextAttemptAt ?? '') <= nowMs)) &&
          this.projectDependenciesReady(candidate)
        )
        .sort((left, right) => {
          const priorityDelta = PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority]
          // A repeatedly failing job must not monopolize the single drain slot. Give
          // newly queued work one attempt before returning to due retries at the same
          // priority; otherwise an old immediate job can starve every newer update.
          const retryDelta = Number(left.status === 'retrying') - Number(right.status === 'retrying')
          const phaseDelta = Number(left.phase === 'project') - Number(right.phase === 'project')
          return priorityDelta || retryDelta || phaseDelta || left.createdAt.localeCompare(right.createdAt)
        })[0]
      if (!job) return null
      job.status = 'running'
      job.attempts += 1
      job.updatedAt = this.now().toISOString()
      await this.persistUnlocked()
      return structuredClone(job)
    })
  }

  private projectDependenciesReady(job: EvidenceQueueJob): boolean {
    if (job.phase !== 'project') return true
    const included = new Set(projectCoordinationSessions(job))
    return !this.jobs.some((candidate) =>
      candidate.id !== job.id && candidate.phase === 'evidence' &&
      candidate.status !== 'succeeded' && included.has(candidate.engineThreadId)
    )
  }

  private async hasRunnableWorkBlockedByActivity(): Promise<boolean> {
    if (this.options.canRunBackground?.() !== false) return false
    return this.exclusive(async () => {
      await this.loadUnlocked()
      return this.jobs.some((job) => job.status === 'queued' || job.status === 'retrying')
    })
  }

  private async submitEvidence(job: EvidenceQueueJob): Promise<EvidenceSnapshot> {
    await this.options.ensureEvidenceDagReady?.()
    const env = this.options.env ?? process.env
    const serviceUrl = evidenceDagServiceUrlFromEnv(env)
    const apiKey = evidenceDagApiKeyFromEnv(env)
    if (!serviceUrl || !apiKey) throw new Error('Evidence DAG service is not configured.')
    const batches = evidenceTraceBatches(job.trace)
    let snapshot: EvidenceSnapshot | undefined
    let startIndex = 0
    if (job.reason === 'recovery') {
      const status = objectRecord(await requestServiceData(
        serviceUrl,
        apiKey,
        `/updates/status?threadId=${encodeURIComponent(job.engineThreadId)}`,
        { method: 'GET', cache: 'no-store' },
        this.fetchImpl(),
        this.timeoutMs(env)
      ).catch(() => undefined))
      const committed = objectRecord(status?.snapshot)
      if (committed) {
        try {
          const candidate = canonicalSnapshot(committed)
          const committedBatchIndex = batches.findIndex((_, index) => (
            candidate.inputWatermark === evidenceBatchWatermark(job.targetWatermark, index, batches.length)
          ))
          if (committedBatchIndex >= 0) {
            snapshot = candidate
            startIndex = committedBatchIndex + 1
          }
        } catch {
          // A missing or older snapshot simply falls back to replaying from batch one.
        }
      }
    }
    for (let index = startIndex; index < batches.length; index += 1) {
      const trace = batches[index]!
      const data = objectRecord(await requestServiceData(
        serviceUrl,
        apiKey,
        '/updates',
        {
          method: 'POST',
          body: JSON.stringify({
          threadId: job.engineThreadId,
          targetWatermark: evidenceBatchWatermark(job.targetWatermark, index, batches.length),
          reason: job.reason,
          priority: job.priority,
          trace,
          ...(job.projectContext?.projectKey ? { projectKey: job.projectContext.projectKey } : {}),
          ...(job.projectContext?.workspaceRoot ? { workspaceRoot: job.projectContext.workspaceRoot } : {}),
          ...(job.projectContext?.projectRoot ? { projectRoot: job.projectContext.projectRoot } : {}),
          ...(job.rebuild ? { rebuild: true } : {}),
          ...(job.rebuildRationale ? { rebuildRationale: job.rebuildRationale } : {})
          })
        },
        this.fetchImpl(),
        this.timeoutMs(env)
      ))
      snapshot = canonicalSnapshot(data?.snapshot)
    }
    if (!snapshot) throw new Error('Evidence DAG update produced no committed snapshot.')
    return snapshot
  }

  private async submitProjectSnapshot(job: EvidenceQueueJob): Promise<void> {
    if (!job.snapshot) throw new Error('Project compile coordination requires a committed Evidence snapshot.')
    if (!job.projectContext || (
      !job.projectContext.projectKey?.trim() &&
      !job.projectContext.workspaceRoot?.trim() &&
      !job.projectContext.projectRoot?.trim() &&
      !job.projectContext.project?.trim()
    )) {
      return
    }
    await this.options.ensureProjectDagReady?.()
    const env = this.options.env ?? process.env
    const serviceUrl = projectDagServiceUrlFromEnv(env)
    const apiKey = projectDagApiKeyFromEnv(env)
    if (!serviceUrl || !apiKey) throw new Error('Project DAG service is not configured.')
    const evidenceServiceUrl = evidenceDagServiceUrlFromEnv(env)
    const evidenceApiKey = evidenceDagApiKeyFromEnv(env)
    if (!evidenceServiceUrl || !evidenceApiKey) throw new Error('Evidence DAG service is not configured.')
    const includedSessions = projectCoordinationSessions(job)
    const evidenceSnapshots = await Promise.all(includedSessions.map(async (threadId) => {
      if (threadId === job.snapshot?.threadId) return job.snapshot
      const status = objectRecord(await requestServiceData(
        evidenceServiceUrl,
        evidenceApiKey,
        `/updates/status?threadId=${encodeURIComponent(threadId)}`,
        { method: 'GET', cache: 'no-store' },
        this.fetchImpl(),
        this.timeoutMs(env)
      ))
      return canonicalSnapshot(status?.snapshot)
    }))
    await requestServiceData(
      serviceUrl,
      apiKey,
      '/updates',
      {
        method: 'POST',
        body: JSON.stringify({
          ...(job.projectContext.projectKey ? { projectKey: job.projectContext.projectKey } : {}),
          ...(job.projectContext.workspaceRoot ? { workspaceRoot: job.projectContext.workspaceRoot } : {}),
          ...(job.projectContext.projectRoot ? { projectRoot: job.projectContext.projectRoot } : {}),
          ...(job.projectContext.project ? { project: job.projectContext.project } : {}),
          ...(job.projectContext.autonomyMode ? { autonomyMode: job.projectContext.autonomyMode } : {}),
          reason: job.projectContext.updateReason ?? 'evidence_snapshot_committed',
          priority: PRIORITY_WEIGHT[job.priority],
          evidenceVector: evidenceSnapshots.map((snapshot) => ({
            threadId: snapshot.threadId,
            digest: snapshot.digest
          })),
          evidenceSnapshots,
          capturedScope: {
            includedSessions,
            excludedSessions: job.projectContext.excludedSessions ?? [],
            isolatedSessions: job.projectContext.isolatedSessions ?? []
          }
        })
      },
      this.fetchImpl(),
      this.timeoutMs(env)
    )
    await this.waitForProjectSnapshot(serviceUrl, apiKey, evidenceSnapshots, job.projectContext, env)
  }

  private async waitForProjectSnapshot(
    serviceUrl: string,
    apiKey: string,
    evidenceSnapshots: EvidenceSnapshot[],
    projectContext: EvidenceDagProjectContext,
    env: Record<string, string | undefined>
  ): Promise<void> {
    const expected = new Map(evidenceSnapshots.map((snapshot) => [snapshot.threadId, snapshot.digest]))
    const deadline = Date.now() + this.timeoutMs(env)
    const query = new URLSearchParams()
    if (projectContext.projectKey) query.set('projectKey', projectContext.projectKey)
    if (projectContext.workspaceRoot) query.set('workspaceRoot', projectContext.workspaceRoot)
    if (projectContext.projectRoot) query.set('projectRoot', projectContext.projectRoot)
    if (projectContext.project) query.set('project', projectContext.project)
    const statusPath = `/updates/status${query.size ? `?${query.toString()}` : ''}`
    while (true) {
      const status = objectRecord(await requestServiceData(
        serviceUrl,
        apiKey,
        statusPath,
        { method: 'GET', cache: 'no-store' },
        this.fetchImpl(),
        this.timeoutMs(env)
      )) ?? {}
      const committed = objectRecord(status.committedSnapshot)
      const vector = Array.isArray(committed?.evidenceVector) ? committed.evidenceVector : []
      const actual = new Map(vector.flatMap((entry) => {
        const record = objectRecord(entry)
        const threadId = nonEmptyString(record?.threadId)
        const digest = nonEmptyString(record?.digest)
        return threadId && digest ? [[threadId, digest] as const] : []
      }))
      const matches = actual.size === expected.size && [...expected].every(([threadId, digest]) => actual.get(threadId) === digest)
      const active = status.state === 'updating' || status.state === 'pending' ||
        (typeof status.pending === 'number' && status.pending > 0) ||
        (typeof status.pendingCount === 'number' && status.pendingCount > 0)
      if (matches && !active) return
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the Project DAG committed snapshot; the durable worker job remains active.')
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 250)
        timer.unref?.()
      })
    }
  }

  private async markSucceeded(jobId: string): Promise<void> {
    await this.exclusive(async () => {
      const job = this.jobs.find((candidate) => candidate.id === jobId)
      if (!job) return
      job.status = 'succeeded'
      job.lastError = undefined
      job.nextAttemptAt = undefined
      job.updatedAt = this.now().toISOString()
      const succeeded = this.jobs
        .filter((candidate) => candidate.status === 'succeeded')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      const keep = new Set(succeeded.slice(0, SUCCEEDED_JOB_HISTORY_LIMIT).map((candidate) => candidate.id))
      this.jobs = this.jobs.filter((candidate) => candidate.status !== 'succeeded' || keep.has(candidate.id))
      await this.persistUnlocked()
    })
  }

  private async markRetry(jobId: string, error: unknown): Promise<void> {
    await this.exclusive(async () => {
      const job = this.jobs.find((candidate) => candidate.id === jobId)
      if (!job) return
      const base = this.options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
      const cap = this.options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS
      const maxAttempts = Math.max(1, Math.floor(this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS))
      const delay = Math.min(cap, base * 2 ** Math.max(0, job.attempts - 1))
      job.status = 'retrying'
      job.lastError = errorMessage(error)
      job.nextAttemptAt = error instanceof MissingEvidenceDagProjectContextError || job.attempts >= maxAttempts
        ? undefined
        : new Date(this.now().getTime() + delay).toISOString()
      job.updatedAt = this.now().toISOString()
      await this.persistUnlocked()
    })
  }

  private async scheduleNextRetry(): Promise<void> {
    const delay = await this.exclusive(async () => {
      const next = this.jobs
        .filter((job) => job.status === 'retrying' && job.nextAttemptAt)
        .map((job) => Date.parse(job.nextAttemptAt as string) - this.now().getTime())
        .filter(Number.isFinite)
        .sort((left, right) => left - right)[0]
      return next === undefined ? undefined : Math.max(0, next)
    })
    if (delay !== undefined) this.schedule(delay)
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.drain()
    }, delayMs)
    this.timer.unref?.()
  }

  private async loadUnlocked(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = JSON.parse(await readFile(this.options.storagePath, 'utf8')) as QueueFile
      if (parsed.version !== 1 || !Array.isArray(parsed.jobs)) throw new Error('unsupported queue file')
      this.recoveryWarning = nonEmptyString(parsed.recoveryWarning)
      this.jobs = parsed.jobs.map((storedJob) => {
        const maxAttempts = Math.max(1, Math.floor(this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS))
        const job = {
          ...storedJob,
          coordinateProject: storedJob.coordinateProject ?? Boolean(storedJob.projectContext)
        }
        if (job.status !== 'succeeded' && job.attempts >= maxAttempts) {
          return {
            ...job,
            status: 'retrying' as const,
            lastError: job.lastError ?? 'Automatic retry limit reached; retry manually after checking the DAG service.',
            nextAttemptAt: undefined,
            updatedAt: this.now().toISOString()
          }
        }
        return job.status === 'running'
          ? {
            ...job,
            status: 'queued' as const,
            reason: 'recovery' as const,
            lastError: 'Interrupted by application shutdown; queued for recovery.',
            nextAttemptAt: undefined,
            updatedAt: this.now().toISOString()
          }
          : job
      })
      await this.persistUnlocked()
    } catch (error) {
      const code = objectRecord(error)?.code
      if (code !== 'ENOENT') {
        const corruptPath = `${this.options.storagePath}.corrupt-${this.now().toISOString().replace(/[:.]/g, '-')}`
        await rename(this.options.storagePath, corruptPath).catch(() => undefined)
        this.jobs = []
        this.recoveryWarning = `Durable DAG queue was corrupt and preserved at ${corruptPath}: ${errorMessage(error)}`
        await this.persistUnlocked()
      }
    }
  }

  private async persistUnlocked(): Promise<void> {
    await mkdir(dirname(this.options.storagePath), { recursive: true })
    const temp = `${this.options.storagePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify({
      version: 1,
      jobs: this.jobs,
      ...(this.recoveryWarning ? { recoveryWarning: this.recoveryWarning } : {})
    } satisfies QueueFile, null, 2)}\n`, 'utf8')
    await rename(temp, this.options.storagePath)
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation, operation)
    this.serial = result.then(() => undefined, () => undefined)
    return result
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  private fetchImpl(): typeof fetch {
    const implementation = this.options.fetchImpl ?? globalThis.fetch
    if (typeof implementation !== 'function') throw new Error('DAG fetch API is unavailable.')
    return implementation
  }

  private timeoutMs(env: Record<string, string | undefined>): number {
    const configured = Number(env[EVIDENCE_DAG_TIMEOUT_MS_ENV] ?? DEFAULT_EVIDENCE_DAG_TIMEOUT_MS)
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_EVIDENCE_DAG_TIMEOUT_MS
  }

  private async isEnabled(): Promise<boolean> {
    return (await this.options.isEnabled?.()) !== false
  }

  private assertEnabled(enabled: boolean): asserts enabled {
    if (!enabled) throw new Error('Evidence DAG is disabled in Settings.')
  }
}

let defaultQueue: EvidenceDagUpdateQueue | undefined

export function configureEvidenceDagUpdateQueue(options: EvidenceDagQueueCoordinatorOptions): EvidenceDagUpdateQueue {
  defaultQueue = new EvidenceDagUpdateQueue(options)
  void defaultQueue.start()
  return defaultQueue
}

export async function syncEvidenceDagUpdateQueue(enabled: boolean): Promise<void> {
  if (!defaultQueue) return
  if (enabled) await defaultQueue.start()
  else defaultQueue.pause()
}

function configuredQueue(): EvidenceDagUpdateQueue {
  if (!defaultQueue) {
    throw new Error('Evidence DAG durable update queue is not configured.')
  }
  return defaultQueue
}

export function enqueueEvidenceDagUpdate(
  input: EnqueueEvidenceDagUpdateInput
): Promise<EnqueueEvidenceDagUpdateResult> {
  return configuredQueue().enqueue(input)
}

export function evidenceDagQueueStatus(
  runtimeId: AgentRuntimeId | string,
  threadId: string
): Promise<EvidenceDagQueueStatus> {
  return configuredQueue().status(runtimeId, threadId)
}

export function retryEvidenceDagUpdate(
  runtimeId: AgentRuntimeId | string,
  threadId: string
): Promise<EvidenceDagQueueStatus> {
  return configuredQueue().retry(runtimeId, threadId)
}

export function prioritizeEvidenceDagUpdate(
  runtimeId: AgentRuntimeId | string,
  threadId: string
): Promise<EvidenceDagQueueStatus> {
  return configuredQueue().prioritize(runtimeId, threadId)
}

export function acknowledgeEvidenceDagSnapshot(snapshot: EvidenceSnapshot): Promise<number> {
  return configuredQueue().acknowledgeSnapshot(snapshot)
}

export async function ensureEvidenceDagFresh(
  input: EnsureEvidenceDagFreshInput
): Promise<{ snapshot: EvidenceSnapshot; jobId: string }> {
  const queued = await configuredQueue().enqueue({
    ...input
  })
  const snapshot = await configuredQueue().waitForSnapshot(queued.jobId, input.timeoutMs)
  return { snapshot, jobId: queued.jobId }
}

export async function ensureProjectFresh(
  input: EnsureProjectFreshInput
): Promise<{ snapshots: EvidenceSnapshot[]; coordinatorJobId: string }> {
  const enqueued = await enqueueProjectFresh(input)
  const snapshots = await Promise.all(enqueued.jobs.map((job) =>
    configuredQueue().waitForJob(job.jobId, input.timeoutMs)))
  return { snapshots, coordinatorJobId: enqueued.coordinatorJobId }
}

export async function enqueueProjectFresh(
  input: EnsureProjectFreshInput
): Promise<{ jobs: EnqueueEvidenceDagUpdateResult[]; coordinatorJobId: string }> {
  if (input.sessions.length === 0) throw new Error('Project update requires at least one included session.')
  const jobs = await Promise.all(input.sessions.map((session, index) => configuredQueue().enqueue({
    ...session,
    reason: 'manual_immediate',
    priority: 'immediate',
    projectContext: {
      ...input.projectContext,
      updateReason: input.projectContext.updateReason ?? 'manual_immediate'
    },
    coordinateProject: index === 0
  })))
  return { jobs, coordinatorJobId: jobs[0]!.jobId }
}

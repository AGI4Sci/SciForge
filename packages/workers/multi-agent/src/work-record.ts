import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

/** The durable contract for a user task spanning one or more provider turns. */
export const WORK_RECORD_VERSION = 1
export const DEFAULT_WORK_CONTINUATION_LIMIT = 3

export const WorkDeliveryState = z.enum([
  'working',
  'waiting_for_children',
  'verifying',
  'needs_continuation',
  'needs_attention',
  'delivered',
  'blocked',
  'failed'
])
export type WorkDeliveryState = z.infer<typeof WorkDeliveryState>

export const WorkContinuationStatus = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled'])
export type WorkContinuationStatus = z.infer<typeof WorkContinuationStatus>

export const WorkContinuationRecord = z.object({
  idempotencyKey: z.string().min(1),
  attempt: z.number().int().positive(),
  status: WorkContinuationStatus,
  reason: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
}).strict()
export type WorkContinuationRecord = z.infer<typeof WorkContinuationRecord>

export const WorkTurnDiagnostic = z.object({
  turnId: z.string().min(1),
  terminalState: z.enum(['completed', 'failed', 'cancelled', 'aborted']),
  recordedAt: z.string().min(1),
  provider: z.object({
    source: z.string().min(1),
    finishReason: z.string().optional(),
    stopReason: z.string().optional(),
    terminalReason: z.string().optional(),
    providerStatus: z.string().optional(),
    providerTurnCount: z.number().int().nonnegative().optional(),
    durationMs: z.number().nonnegative().optional(),
    apiDurationMs: z.number().nonnegative().optional(),
    usage: z.object({
      inputTokens: z.number().nonnegative().optional(),
      outputTokens: z.number().nonnegative().optional(),
      cacheReadTokens: z.number().nonnegative().optional(),
      cacheWriteTokens: z.number().nonnegative().optional(),
      totalTokens: z.number().nonnegative().optional(),
      costUsd: z.number().nonnegative().optional()
    }).strict().optional()
  }).strict()
}).strict()
export type WorkTurnDiagnostic = z.infer<typeof WorkTurnDiagnostic>

export const WORK_TURN_DIAGNOSTIC_LIMIT = 20

export const WorkRecord = z.object({
  version: z.literal(WORK_RECORD_VERSION).default(WORK_RECORD_VERSION),
  workId: z.string().min(1),
  runtimeId: z.string().min(1),
  threadId: z.string().min(1),
  objective: z.string().min(1).optional(),
  currentTurnId: z.string().min(1).optional(),
  childIds: z.array(z.string().min(1)).default([]),
  deliveryState: WorkDeliveryState.default('working'),
  continuationAttempts: z.number().int().nonnegative().default(0),
  maxContinuationAttempts: z.number().int().positive().default(DEFAULT_WORK_CONTINUATION_LIMIT),
  continuations: z.array(WorkContinuationRecord).default([]),
  turnDiagnostics: z.array(WorkTurnDiagnostic).max(WORK_TURN_DIAGNOSTIC_LIMIT).default([]),
  evidence: z.array(z.unknown()).default([]),
  error: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
}).strict()
export type WorkRecord = z.infer<typeof WorkRecord>

export function appendWorkTurnDiagnostic(
  diagnostics: WorkTurnDiagnostic[],
  diagnostic: WorkTurnDiagnostic
): WorkTurnDiagnostic[] {
  const withoutDuplicate = diagnostics.filter((item) => item.turnId !== diagnostic.turnId)
  return [...withoutDuplicate, WorkTurnDiagnostic.parse(diagnostic)].slice(-WORK_TURN_DIAGNOSTIC_LIMIT)
}

export type WorkRecordStore = {
  upsert(record: WorkRecord): Promise<void>
  get(workId: string): Promise<WorkRecord | null>
  list(options?: { runtimeId?: string; threadId?: string; deliveryState?: WorkDeliveryState }): Promise<WorkRecord[]>
  enqueueContinuation(input: {
    workId: string
    idempotencyKey: string
    reason?: string
    now?: string
  }): Promise<{ record: WorkRecord; continuation: WorkContinuationRecord; created: boolean } | null>
  markContinuationRunning(workId: string, idempotencyKey: string, input?: { turnId?: string; now?: string }): Promise<WorkRecord | null>
  settleContinuation(workId: string, idempotencyKey: string, input: {
    status: Extract<WorkContinuationStatus, 'completed' | 'failed' | 'cancelled'>
    deliveryState: WorkDeliveryState
    currentTurnId?: string
    error?: string
    now?: string
  }): Promise<WorkRecord | null>
  recoverIncomplete(options?: { now?: string }): Promise<WorkRecord[]>
}

const terminalDeliveryStates = new Set<WorkDeliveryState>(['delivered', 'blocked', 'failed', 'needs_attention'])
const activeContinuationStatuses = new Set<WorkContinuationStatus>(['queued', 'running'])

function normalizeRecord(record: WorkRecord): WorkRecord {
  return WorkRecord.parse(record)
}

function nowIso(value?: string): string {
  return value ?? new Date().toISOString()
}

function activeContinuation(record: WorkRecord): WorkContinuationRecord | undefined {
  return record.continuations.find((item) => activeContinuationStatuses.has(item.status))
}

function enqueueRecord(record: WorkRecord, input: { idempotencyKey: string; reason?: string; now?: string }): {
  record: WorkRecord
  continuation: WorkContinuationRecord
  created: boolean
} | null {
  if (terminalDeliveryStates.has(record.deliveryState)) return null
  const same = record.continuations.find((item) => item.idempotencyKey === input.idempotencyKey)
  if (same) return { record, continuation: same, created: false }
  const active = activeContinuation(record)
  if (active) return { record, continuation: active, created: false }
  if (record.continuationAttempts >= record.maxContinuationAttempts) return null
  const timestamp = nowIso(input.now)
  const continuation = WorkContinuationRecord.parse({
    idempotencyKey: input.idempotencyKey,
    attempt: record.continuationAttempts + 1,
    status: 'queued',
    ...(input.reason ? { reason: input.reason } : {}),
    createdAt: timestamp,
    updatedAt: timestamp
  })
  const next = WorkRecord.parse({
    ...record,
    continuationAttempts: continuation.attempt,
    deliveryState: 'verifying',
    continuations: [...record.continuations, continuation],
    updatedAt: timestamp
  })
  return { record: next, continuation, created: true }
}

export class InMemoryWorkRecordStore implements WorkRecordStore {
  private readonly records = new Map<string, WorkRecord>()
  private readonly locks = new Map<string, Promise<void>>()

  async upsert(record: WorkRecord): Promise<void> {
    await this.withLock(record.workId, async () => {
      this.records.set(record.workId, normalizeRecord(record))
    })
  }

  async get(workId: string): Promise<WorkRecord | null> {
    return this.records.get(workId) ?? null
  }

  async list(options: { runtimeId?: string; threadId?: string; deliveryState?: WorkDeliveryState } = {}): Promise<WorkRecord[]> {
    return [...this.records.values()]
      .filter((record) => !options.runtimeId || record.runtimeId === options.runtimeId)
      .filter((record) => !options.threadId || record.threadId === options.threadId)
      .filter((record) => !options.deliveryState || record.deliveryState === options.deliveryState)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  }

  async enqueueContinuation(input: Parameters<WorkRecordStore['enqueueContinuation']>[0]) {
    return this.withLock(input.workId, async () => {
      const existing = this.records.get(input.workId)
      if (!existing) return null
      const queued = enqueueRecord(existing, input)
      if (!queued) return null
      if (queued.created) this.records.set(input.workId, queued.record)
      return queued
    })
  }

  async markContinuationRunning(workId: string, idempotencyKey: string, input: { turnId?: string; now?: string } = {}) {
    return this.withLock(workId, async () => this.markRunning(workId, idempotencyKey, input))
  }

  async settleContinuation(workId: string, idempotencyKey: string, input: Parameters<WorkRecordStore['settleContinuation']>[2]) {
    return this.withLock(workId, async () => this.settle(workId, idempotencyKey, input))
  }

  async recoverIncomplete(options: { now?: string } = {}): Promise<WorkRecord[]> {
    const timestamp = nowIso(options.now)
    const recovered: WorkRecord[] = []
    for (const record of await this.list()) {
      const pending = activeContinuation(record)
      // A work record can be marked needs_attention by the provider terminal
      // event after its continuation was already started. Treat that specific
      // shape as interrupted recovery work so restart can requeue it; genuine
      // attention states without an active continuation remain user-owned.
      const interruptedAttention = record.deliveryState === 'needs_attention' &&
        pending?.status === 'running'
      if ((terminalDeliveryStates.has(record.deliveryState) && !interruptedAttention) ||
        record.continuationAttempts >= record.maxContinuationAttempts) continue
      if (!pending || pending.status !== 'running') {
        recovered.push(record)
        continue
      }
      const next = WorkRecord.parse({
        ...record,
        continuations: record.continuations.map((item) => item.idempotencyKey === pending.idempotencyKey
          ? { ...item, status: 'queued', updatedAt: timestamp }
          : item),
        updatedAt: timestamp
      })
      this.records.set(record.workId, next)
      recovered.push(next)
    }
    return recovered
  }

  private async withLock<T>(workId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(workId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    this.locks.set(workId, gate)
    await previous
    try { return await operation() } finally {
      release()
      if (this.locks.get(workId) === gate) this.locks.delete(workId)
    }
  }

  private markRunning(workId: string, idempotencyKey: string, input: { turnId?: string; now?: string }): WorkRecord | null {
    const record = this.records.get(workId)
    if (!record) return null
    const continuation = record.continuations.find((item) => item.idempotencyKey === idempotencyKey)
    if (!continuation) return null
    // A caller may claim a queued continuation before dispatch to make
    // explicit resume idempotent. Allow that same claim to fill in the
    // provider turn ID once dispatch acknowledges it, while rejecting a
    // competing turn ID.
    if (continuation.status === 'running') {
      if (!input.turnId || continuation.turnId === input.turnId) return record
      if (continuation.turnId) return null
    } else if (continuation.status !== 'queued') return null
    const timestamp = nowIso(input.now)
    const next = WorkRecord.parse({
      ...record,
      currentTurnId: input.turnId ?? record.currentTurnId,
      continuations: record.continuations.map((item) => item.idempotencyKey === idempotencyKey
        ? { ...item, status: 'running', ...(input.turnId ? { turnId: input.turnId } : {}), updatedAt: timestamp }
        : item),
      updatedAt: timestamp
    })
    this.records.set(workId, next)
    return next
  }

  private settle(workId: string, idempotencyKey: string, input: Parameters<WorkRecordStore['settleContinuation']>[2]): WorkRecord | null {
    const record = this.records.get(workId)
    if (!record) return null
    const continuation = record.continuations.find((item) => item.idempotencyKey === idempotencyKey)
    if (!continuation) return null
    if (continuation.status === input.status && record.deliveryState === input.deliveryState) return record
    const timestamp = nowIso(input.now)
    const next = WorkRecord.parse({
      ...record,
      ...(input.currentTurnId ? { currentTurnId: input.currentTurnId } : {}),
      deliveryState: input.deliveryState,
      ...(input.error ? { error: input.error } : {}),
      continuations: record.continuations.map((item) => item.idempotencyKey === idempotencyKey
        ? { ...item, status: input.status, ...(input.error ? { error: input.error } : {}), updatedAt: timestamp }
        : item),
      updatedAt: timestamp
    })
    this.records.set(workId, next)
    return next
  }
}

export class FileWorkRecordStore implements WorkRecordStore {
  private readonly locks = new Map<string, Promise<void>>()
  constructor(private readonly rootDir: string) {}

  async upsert(record: WorkRecord): Promise<void> {
    const parsed = normalizeRecord(record)
    await this.withLock(parsed.workId, async () => this.write(parsed))
  }

  async get(workId: string): Promise<WorkRecord | null> {
    const text = await readFile(this.path(workId), 'utf8').catch(() => null)
    if (!text) return null
    try { return WorkRecord.parse(JSON.parse(text)) } catch { return null }
  }

  async list(options: { runtimeId?: string; threadId?: string; deliveryState?: WorkDeliveryState } = {}): Promise<WorkRecord[]> {
    await mkdir(this.rootDir, { recursive: true })
    const names = await readdir(this.rootDir).catch(() => [])
    const records: WorkRecord[] = []
    for (const name of names.filter((item) => item.endsWith('.json'))) {
      const text = await readFile(join(this.rootDir, name), 'utf8').catch(() => null)
      if (!text) continue
      try { records.push(WorkRecord.parse(JSON.parse(text))) } catch { /* Ignore corrupt work records. */ }
    }
    return records
      .filter((record) => !options.runtimeId || record.runtimeId === options.runtimeId)
      .filter((record) => !options.threadId || record.threadId === options.threadId)
      .filter((record) => !options.deliveryState || record.deliveryState === options.deliveryState)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  }

  async enqueueContinuation(input: Parameters<WorkRecordStore['enqueueContinuation']>[0]) {
    return this.withLock(input.workId, async () => {
      const existing = await this.get(input.workId)
      if (!existing) return null
      const queued = enqueueRecord(existing, input)
      if (!queued) return null
      if (queued.created) await this.write(queued.record)
      return queued
    })
  }

  async markContinuationRunning(workId: string, idempotencyKey: string, input: { turnId?: string; now?: string } = {}) {
    return this.withLock(workId, async () => {
      const next = await this.markRunning(await this.get(workId), workId, idempotencyKey, input)
      if (next) await this.write(next)
      return next
    })
  }

  async settleContinuation(workId: string, idempotencyKey: string, input: Parameters<WorkRecordStore['settleContinuation']>[2]) {
    return this.withLock(workId, async () => {
      const next = await this.settle(await this.get(workId), workId, idempotencyKey, input)
      if (next) await this.write(next)
      return next
    })
  }

  async recoverIncomplete(options: { now?: string } = {}): Promise<WorkRecord[]> {
    const records = await this.list()
    const memory = new InMemoryWorkRecordStore()
    for (const record of records) await memory.upsert(record)
    const recovered = await memory.recoverIncomplete(options)
    for (const record of recovered) {
      const prior = records.find((item) => item.workId === record.workId)
      if (JSON.stringify(prior) !== JSON.stringify(record)) await this.upsert(record)
    }
    return recovered
  }

  private async write(record: WorkRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    const target = this.path(record.workId)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private path(workId: string): string { return join(this.rootDir, `${encodeURIComponent(workId)}.json`) }

  private async withLock<T>(workId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(workId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    this.locks.set(workId, gate)
    await previous
    try { return await operation() } finally {
      release()
      if (this.locks.get(workId) === gate) this.locks.delete(workId)
    }
  }

  private async markRunning(record: WorkRecord | null, workId: string, key: string, input: { turnId?: string; now?: string }): Promise<WorkRecord | null> {
    if (!record) return null
    const memory = new InMemoryWorkRecordStore()
    return memoryMarkRunning(memory, record, workId, key, input)
  }

  private async settle(record: WorkRecord | null, workId: string, key: string, input: Parameters<WorkRecordStore['settleContinuation']>[2]): Promise<WorkRecord | null> {
    if (!record) return null
    const memory = new InMemoryWorkRecordStore()
    return memorySettle(memory, record, workId, key, input)
  }
}

// Keep the pure transition logic shared by the file-backed implementation without
// exposing mutable internals of either store.
async function memoryMarkRunning(store: InMemoryWorkRecordStore, record: WorkRecord, workId: string, key: string, input: { turnId?: string; now?: string }) {
  await store.upsert(record)
  return store.markContinuationRunning(workId, key, input)
}
async function memorySettle(store: InMemoryWorkRecordStore, record: WorkRecord, workId: string, key: string, input: Parameters<WorkRecordStore['settleContinuation']>[2]) {
  await store.upsert(record)
  return store.settleContinuation(workId, key, input)
}

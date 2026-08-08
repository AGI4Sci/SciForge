import { createHash, randomBytes } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  unlink
} from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { DomainTurnArtifactEvent } from '@sciforge/domain-sdk/host'

const OUTBOX_VERSION = 1
const MAX_PENDING_TURNS = 1_000
const MAX_DELIVERED_RECEIPTS = 10_000

export type TurnArtifactIntent = Readonly<{
  runtimeId: string
  threadId: string
  turnId: string
  sequence?: number
  workspaceRoot?: string
  occurredAt: string
}>

type TurnArtifactRecordBase = Readonly<{
  key: string
  intent: TurnArtifactIntent
  attempts: number
  createdAt: string
  updatedAt: string
  nextAttemptAt?: string
  error?: string
}>

export type PendingTurnArtifactMaterialization = TurnArtifactRecordBase & Readonly<{
  stage: 'pending_materialization'
}>

export type PendingTurnArtifactFanout = TurnArtifactRecordBase & Readonly<{
  stage: 'pending_fanout'
  event: DomainTurnArtifactEvent
}>

export type TurnArtifactOutboxRecord =
  | PendingTurnArtifactMaterialization
  | PendingTurnArtifactFanout

type PersistedOutbox = Readonly<{
  version: typeof OUTBOX_VERSION
  records: readonly TurnArtifactOutboxRecord[]
  receipts: readonly TurnArtifactDeliveryReceipt[]
}>

type TurnArtifactDeliveryReceipt = Readonly<{
  key: string
  intent: TurnArtifactIntent
  deliveredAt: string
}>

/** Host-owned, owner-only durable state for completed Agent turn handoff. */
export class TurnArtifactOutbox {
  readonly path: string
  #records = new Map<string, TurnArtifactOutboxRecord>()
  #receipts = new Map<string, TurnArtifactDeliveryReceipt>()
  #loaded = false
  #mutation: Promise<void> = Promise.resolve()

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'agent-runtime', 'turn-artifacts', 'outbox.json')
  }

  async load(): Promise<void> {
    if (this.#loaded) return
    await this.#mutate(async () => {
      if (this.#loaded) return
      let value: unknown
      try {
        value = JSON.parse(await readFile(this.path, 'utf8'))
        await chmod(dirname(this.path), 0o700)
        await chmod(this.path, 0o600)
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
        value = { version: OUTBOX_VERSION, records: [], receipts: [] }
      }
      const parsed = parseOutbox(value)
      this.#records = new Map(parsed.records.map((record) => [record.key, record]))
      this.#receipts = new Map(parsed.receipts.map((receipt) => [receipt.key, receipt]))
      this.#loaded = true
    })
  }

  async enqueueIntent(input: TurnArtifactIntent): Promise<TurnArtifactOutboxRecord | undefined> {
    const intent = parseIntent(input)
    const key = turnArtifactIntentKey(intent)
    await this.load()
    await this.#mutate(async () => {
      const existing = this.#records.get(key)
      if (existing) {
        assertSameIntent(existing.intent, intent, key)
        return
      }
      const delivered = this.#receipts.get(key)
      if (delivered) {
        assertSameIntent(delivered.intent, intent, key)
        return
      }
      if (this.#records.size >= MAX_PENDING_TURNS) {
        throw new Error('Completed turn artifact outbox is full.')
      }
      const now = new Date().toISOString()
      const record: PendingTurnArtifactMaterialization = Object.freeze({
        key,
        intent,
        stage: 'pending_materialization',
        attempts: 0,
        createdAt: now,
        updatedAt: now
      })
      this.#records.set(key, record)
      try {
        await this.#persist()
      } catch (error) {
        this.#records.delete(key)
        throw error
      }
    })
    return this.#records.get(key)
  }

  record(key: string): TurnArtifactOutboxRecord | undefined {
    return this.#records.get(key)
  }

  all(): readonly TurnArtifactOutboxRecord[] {
    return [...this.#records.values()]
  }

  wasDelivered(key: string): boolean {
    return this.#receipts.has(key)
  }

  ready(now = Date.now()): readonly TurnArtifactOutboxRecord[] {
    return [...this.#records.values()]
      .filter((record) => (
        record.nextAttemptAt === undefined || Date.parse(record.nextAttemptAt) <= now
      ))
      .sort(compareRecords)
  }

  nextAttemptAt(): number | null {
    const values = [...this.#records.values()]
      .map((record) => record.nextAttemptAt ? Date.parse(record.nextAttemptAt) : Date.now())
      .filter(Number.isFinite)
    return values.length > 0 ? Math.min(...values) : null
  }

  async markMaterialized(
    key: string,
    value: DomainTurnArtifactEvent
  ): Promise<PendingTurnArtifactFanout> {
    await this.load()
    let materialized: PendingTurnArtifactFanout | undefined
    await this.#mutate(async () => {
      const current = this.#records.get(key)
      if (!current) throw new Error(`Completed turn artifact intent ${key} is missing.`)
      if (current.stage === 'pending_fanout') {
        materialized = current
        return
      }
      // The lifecycle event can be emitted before the runtime adapter has an
      // authoritative workspace.  The materializer reads the completed thread
      // from the owning runtime, so it is the only place allowed to fill that
      // previously absent field.  Persist the binding together with the
      // immutable event; a pre-bound intent still requires an exact match.
      const materializedIntent = bindMaterializedWorkspace(value, current.intent)
      const event = parseTurnArtifactEvent(value, materializedIntent)
      const updated: PendingTurnArtifactFanout = Object.freeze({
        key: current.key,
        intent: materializedIntent,
        stage: 'pending_fanout',
        event,
        attempts: 0,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString()
      })
      this.#records.set(key, updated)
      try {
        await this.#persist()
      } catch (error) {
        this.#records.set(key, current)
        throw error
      }
      materialized = updated
    })
    return materialized!
  }

  async markFailed(key: string, error: unknown, retryAfterMs: number): Promise<void> {
    await this.load()
    await this.#mutate(async () => {
      const current = this.#records.get(key)
      if (!current) return
      const now = Date.now()
      const updated = Object.freeze({
        ...current,
        attempts: current.attempts + 1,
        updatedAt: new Date(now).toISOString(),
        nextAttemptAt: new Date(now + Math.max(0, retryAfterMs)).toISOString(),
        error: errorMessage(error).slice(0, 4_000)
      }) as TurnArtifactOutboxRecord
      this.#records.set(key, updated)
      try {
        await this.#persist()
      } catch (persistError) {
        this.#records.set(key, current)
        throw persistError
      }
    })
  }

  async markDelivered(key: string): Promise<void> {
    await this.load()
    await this.#mutate(async () => {
      const current = this.#records.get(key)
      if (!current) return
      const receiptsBefore = new Map(this.#receipts)
      const receipt = Object.freeze({
        key,
        intent: current.intent,
        deliveredAt: new Date().toISOString()
      })
      this.#records.delete(key)
      this.#receipts.set(key, receipt)
      this.#pruneReceipts()
      try {
        await this.#persist()
      } catch (error) {
        this.#records.set(key, current)
        this.#receipts = receiptsBefore
        throw error
      }
    })
  }

  async #persist(): Promise<void> {
    const payload: PersistedOutbox = {
      version: OUTBOX_VERSION,
      records: [...this.#records.values()].sort(compareRecords),
      receipts: [...this.#receipts.values()].sort((left, right) => (
        left.deliveredAt.localeCompare(right.deliveredAt) || left.key.localeCompare(right.key)
      ))
    }
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    let renamed = false
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, this.path)
      renamed = true
      await syncDirectory(directory)
    } finally {
      if (!renamed) await unlink(temporary).catch(() => undefined)
    }
  }

  async #mutate(operation: () => Promise<void>): Promise<void> {
    const pending = this.#mutation.then(operation, operation)
    this.#mutation = pending.catch(() => undefined)
    await pending
  }

  #pruneReceipts(): void {
    const overflow = this.#receipts.size - MAX_DELIVERED_RECEIPTS
    if (overflow <= 0) return
    const oldest = [...this.#receipts.values()]
      .sort((left, right) => (
        left.deliveredAt.localeCompare(right.deliveredAt) || left.key.localeCompare(right.key)
      ))
      .slice(0, overflow)
    for (const receipt of oldest) this.#receipts.delete(receipt.key)
  }
}

export function turnArtifactIntentKey(intent: Pick<
  TurnArtifactIntent,
  'runtimeId' | 'threadId' | 'turnId'
>): string {
  const identity = [intent.runtimeId, intent.threadId, intent.turnId].join('\u0000')
  return `turn-artifact:${createHash('sha256').update(identity).digest('hex')}`
}

function parseOutbox(value: unknown): PersistedOutbox {
  if (
    !isRecord(value) ||
    value.version !== OUTBOX_VERSION ||
    !Array.isArray(value.records) ||
    !Array.isArray(value.receipts)
  ) {
    throw new Error('Completed turn artifact outbox has an unsupported schema.')
  }
  if (value.records.length > MAX_PENDING_TURNS) {
    throw new Error('Completed turn artifact outbox exceeds its bounded capacity.')
  }
  const records = value.records.map(parseRecord)
  if (new Set(records.map((record) => record.key)).size !== records.length) {
    throw new Error('Completed turn artifact outbox contains duplicate intent keys.')
  }
  if (value.receipts.length > MAX_DELIVERED_RECEIPTS) {
    throw new Error('Completed turn artifact outbox exceeds its receipt capacity.')
  }
  const receipts = value.receipts.map(parseReceipt)
  const receiptKeys = new Set(receipts.map((receipt) => receipt.key))
  if (receiptKeys.size !== receipts.length) {
    throw new Error('Completed turn artifact outbox contains duplicate delivery receipts.')
  }
  if (records.some((record) => receiptKeys.has(record.key))) {
    throw new Error('Completed turn artifact outbox contains pending and delivered duplicates.')
  }
  return { version: OUTBOX_VERSION, records, receipts }
}

function parseReceipt(value: unknown): TurnArtifactDeliveryReceipt {
  if (!isRecord(value)) throw new Error('Completed turn artifact receipt must be an object.')
  const intent = parseIntent(value.intent)
  const key = turnArtifactIntentKey(intent)
  if (value.key !== key) throw new Error('Completed turn artifact receipt has an invalid key.')
  return Object.freeze({
    key,
    intent,
    deliveredAt: timestamp(value.deliveredAt, 'deliveredAt')
  })
}

function parseRecord(value: unknown): TurnArtifactOutboxRecord {
  if (!isRecord(value)) throw new Error('Completed turn artifact record must be an object.')
  const intent = parseIntent(value.intent)
  const expectedKey = turnArtifactIntentKey(intent)
  if (value.key !== expectedKey) {
    throw new Error('Completed turn artifact record has an invalid intent key.')
  }
  const stage = value.stage
  if (stage !== 'pending_materialization' && stage !== 'pending_fanout') {
    throw new Error('Completed turn artifact record has an invalid stage.')
  }
  const attempts = value.attempts
  if (!Number.isInteger(attempts) || Number(attempts) < 0) {
    throw new Error('Completed turn artifact attempts must be a non-negative integer.')
  }
  const createdAt = timestamp(value.createdAt, 'createdAt')
  const updatedAt = timestamp(value.updatedAt, 'updatedAt')
  const nextAttemptAt = value.nextAttemptAt === undefined
    ? undefined
    : timestamp(value.nextAttemptAt, 'nextAttemptAt')
  const base = {
    key: expectedKey,
    intent,
    stage,
    attempts: Number(attempts),
    createdAt,
    updatedAt,
    ...(nextAttemptAt ? { nextAttemptAt } : {}),
    ...(typeof value.error === 'string' ? { error: value.error.slice(0, 4_000) } : {})
  }
  return stage === 'pending_materialization'
    ? Object.freeze(base as PendingTurnArtifactMaterialization)
    : Object.freeze({
        ...base,
        stage,
        event: parseTurnArtifactEvent(value.event, intent)
      } as PendingTurnArtifactFanout)
}

function parseIntent(value: unknown): TurnArtifactIntent {
  if (!isRecord(value)) throw new Error('Completed turn artifact intent must be an object.')
  const runtimeId = required(value.runtimeId, 'runtimeId')
  const threadId = required(value.threadId, 'threadId')
  const turnId = required(value.turnId, 'turnId')
  const occurredAt = timestamp(value.occurredAt, 'occurredAt')
  const sequence = value.sequence
  if (sequence !== undefined && (!Number.isSafeInteger(sequence) || Number(sequence) < 0)) {
    throw new Error('Completed turn artifact sequence must be a non-negative safe integer.')
  }
  const workspaceRoot = value.workspaceRoot === undefined
    ? undefined
    : required(value.workspaceRoot, 'workspaceRoot', 16_384)
  return Object.freeze({
    runtimeId,
    threadId,
    turnId,
    ...(sequence === undefined ? {} : { sequence: Number(sequence) }),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    occurredAt
  })
}

function parseTurnArtifactEvent(
  value: unknown,
  intent: TurnArtifactIntent
): DomainTurnArtifactEvent {
  if (!isRecord(value) || value.contractVersion !== 1 || value.kind !== 'turn-completed') {
    throw new Error('Materialized turn artifact event has an invalid contract.')
  }
  if (
    value.runtimeId !== intent.runtimeId ||
    value.threadId !== intent.threadId ||
    value.turnId !== intent.turnId
  ) {
    throw new Error('Materialized turn artifact event does not match its durable intent.')
  }
  const targetWatermark = required(value.targetWatermark, 'targetWatermark')
  const occurredAt = timestamp(value.occurredAt, 'occurredAt')
  const sequence = value.sequence
  if (sequence !== undefined && (!Number.isSafeInteger(sequence) || Number(sequence) < 0)) {
    throw new Error('Materialized turn artifact event has an invalid sequence.')
  }
  const workspaceRoot = value.workspaceRoot === undefined
    ? undefined
    : required(value.workspaceRoot, 'workspaceRoot', 16_384)
  const expectedTargetWatermark = String(intent.sequence ?? intent.turnId)
  if (
    sequence !== intent.sequence ||
    workspaceRoot !== intent.workspaceRoot ||
    occurredAt !== intent.occurredAt ||
    targetWatermark !== expectedTargetWatermark
  ) {
    throw new Error('Materialized turn artifact event envelope does not match its durable intent.')
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length > 100_000) {
    throw new Error('Materialized turn artifact event has invalid artifacts.')
  }
  const durable = jsonClone({
    contractVersion: 1 as const,
    kind: 'turn-completed' as const,
    runtimeId: intent.runtimeId,
    threadId: intent.threadId,
    turnId: intent.turnId,
    targetWatermark,
    ...(sequence === undefined ? {} : { sequence: Number(sequence) }),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    occurredAt,
    artifacts: value.artifacts
  })
  return deepFreeze(durable) as DomainTurnArtifactEvent
}

function bindMaterializedWorkspace(
  value: unknown,
  intent: TurnArtifactIntent
): TurnArtifactIntent {
  if (intent.workspaceRoot !== undefined || !isRecord(value) || value.workspaceRoot === undefined) {
    return intent
  }
  return Object.freeze({
    ...intent,
    workspaceRoot: required(value.workspaceRoot, 'workspaceRoot', 16_384)
  })
}

function assertSameIntent(
  left: TurnArtifactIntent,
  right: TurnArtifactIntent,
  key: string
): void {
  if (
    left.runtimeId !== right.runtimeId ||
    left.threadId !== right.threadId ||
    left.turnId !== right.turnId ||
    left.sequence !== right.sequence ||
    left.workspaceRoot !== right.workspaceRoot ||
    left.occurredAt !== right.occurredAt
  ) {
    throw new Error(`Completed turn artifact intent key collision: ${key}`)
  }
}

function compareRecords(left: TurnArtifactOutboxRecord, right: TurnArtifactOutboxRecord): number {
  return left.createdAt.localeCompare(right.createdAt) || left.key.localeCompare(right.key)
}

async function syncDirectory(directory: string): Promise<void> {
  let handle
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch (error) {
    const code = errorCode(error)
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EPERM' && code !== 'EISDIR') {
      throw error
    }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function jsonClone<T>(value: T): T {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Turn artifact payload is not JSON serializable.')
  return JSON.parse(serialized) as T
}

function deepFreeze(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function required(value: unknown, field: string, max = 4_096): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`Completed turn artifact ${field} must be a non-empty bounded string.`)
  }
  return value.trim()
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Completed turn artifact ${field} must be a timestamp.`)
  }
  return new Date(value).toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

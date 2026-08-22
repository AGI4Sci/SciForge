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
import { evidenceDagWatermarkCoversValue } from '@sciforge/domain-evidence-dag/contract'
import {
  projectDagDurableReceiptSchema,
  type ProjectDagDurableReceipt
} from './contract.js'

const OUTBOX_VERSION = 3
const MAX_RECORDS = 1_000
const MAX_ERROR_LENGTH = 4_000

const OUTBOX_KEYS = new Set(['version', 'records'])
const RECORD_KEYS = new Set([
  'id',
  'workspaceRoot',
  'runtimeId',
  'threadId',
  'targetWatermark',
  'sourceKind',
  'producerModuleId',
  'executionId',
  'hostAcceptanceSequence',
  'hostWorkspaceBinding',
  'state',
  'attempts',
  'createdAt',
  'updatedAt',
  'nextAttemptAt',
  'error',
  'receipt'
])

export type ProjectDagHandoffState =
  | 'pending'
  | 'retry_scheduled'
  | 'accepted'
  | 'failed'

export type ProjectDagHandoffRecord = Readonly<{
  id: string
  workspaceRoot: string
  runtimeId: string
  threadId: string
  targetWatermark: string
  sourceKind: 'agent-thread' | 'package-execution'
  producerModuleId?: string
  executionId?: string
  hostAcceptanceSequence?: number
  hostWorkspaceBinding?: 'capability-caller'
  state: ProjectDagHandoffState
  attempts: number
  createdAt: string
  updatedAt: string
  nextAttemptAt?: string
  error?: string
  receipt?: ProjectDagDurableReceipt
}>

type PersistedOutbox = Readonly<{
  version: typeof OUTBOX_VERSION
  records: readonly ProjectDagHandoffRecord[]
}>

type ProjectDagHandoffIdentity = Readonly<{
  workspaceRoot: string
  runtimeId: string
  threadId: string
  targetWatermark: string
  sourceKind: 'agent-thread' | 'package-execution'
  producerModuleId?: string
  executionId?: string
  hostAcceptanceSequence?: number
  hostWorkspaceBinding?: 'capability-caller'
}>

export class ProjectDagHandoffOutbox {
  readonly path: string
  #records = new Map<string, ProjectDagHandoffRecord>()
  #loaded = false
  #mutation: Promise<void> = Promise.resolve()

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'project-dag', 'turn-handoff-outbox.json')
  }

  async load(): Promise<void> {
    if (this.#loaded) return
    await this.#mutate(async () => {
      if (this.#loaded) return
      let parsed: unknown
      try {
        parsed = JSON.parse(await readFile(this.path, 'utf8'))
        await chmod(dirname(this.path), 0o700)
        await chmod(this.path, 0o600)
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
        parsed = { version: OUTBOX_VERSION, records: [] }
      }
      const legacyVersion = legacyOutboxVersion(parsed)
      if (legacyVersion !== null) {
        // Older records have no Host-minted workspace binding. They cannot be
        // replayed safely, but must not prevent Project DAG from starting.
        await rename(
          this.path,
          `${this.path}.legacy-v${legacyVersion}.${Date.now()}.` +
            `${randomBytes(6).toString('hex')}.json`
        )
        parsed = { version: OUTBOX_VERSION, records: [] }
      }
      const value = parseOutbox(parsed)
      this.#records = new Map(value.records.map((record) => [record.id, record]))
      if (legacyVersion !== null) await this.#persist()
      this.#loaded = true
    })
  }

  async enqueue(input: {
    workspaceRoot: string
    runtimeId: string
    threadId: string
    targetWatermark: string
    sourceKind: 'agent-thread' | 'package-execution'
    producerModuleId?: string
    executionId?: string
    hostAcceptanceSequence?: number
    hostWorkspaceBinding?: 'capability-caller'
  }): Promise<ProjectDagHandoffRecord> {
    const identity = normalizeIdentity(input)
    const id = handoffId(identity)
    await this.load()
    let result: ProjectDagHandoffRecord | undefined
    await this.#mutate(async () => {
      const existing = this.#records.get(id)
      if (existing) {
        assertSameIdentity(existing, identity)
        result = existing
        return
      }
      if (this.active().length >= MAX_RECORDS) {
        throw new Error('Project DAG handoff outbox is full.')
      }
      const now = new Date().toISOString()
      result = Object.freeze({
        id,
        ...identity,
        state: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now
      })
      const recordsBefore = new Map(this.#records)
      this.#records.set(id, result)
      this.#pruneTerminalReceipts()
      try {
        await this.#persist()
      } catch (error) {
        this.#records = recordsBefore
        throw error
      }
    })
    return result!
  }

  async markAcceptedBatch(
    ids: readonly string[],
    receipt: ProjectDagDurableReceipt
  ): Promise<void> {
    const parsedReceipt = deepFreeze(projectDagDurableReceiptSchema.parse(receipt))
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) return
    await this.load()
    await this.#mutate(async () => {
      const selected = uniqueIds
        .map((id) => this.#records.get(id))
        .filter((record): record is ProjectDagHandoffRecord =>
          record !== undefined && !isTerminal(record)
        )
      const anchor = selected[0]
      if (anchor && selected.some((record) => !sameAuthoritativeLane(record, anchor))) {
        throw new Error('Project DAG handoff batch spans multiple authoritative lanes.')
      }
      const recordsBefore = new Map(this.#records)
      const updatedAt = new Date().toISOString()
      let changed = false
      for (const id of uniqueIds) {
        const current = this.#records.get(id)
        if (!current || isTerminal(current)) continue
        this.#records.set(id, Object.freeze({
          ...current,
          state: 'accepted',
          receipt: parsedReceipt,
          updatedAt,
          nextAttemptAt: undefined,
          error: undefined
        }))
        changed = true
      }
      if (!changed) return
      try {
        await this.#persist()
      } catch (error) {
        this.#records = recordsBefore
        throw error
      }
    })
  }

  async markRetry(id: string, error: string, retryAfterMs: number): Promise<void> {
    const message = normalizeError(error)
    const delay = nonnegativeDelay(retryAfterMs)
    await this.#replace(id, (current) => {
      const attempts = incrementAttempts(current.attempts)
      return {
        ...current,
        state: 'retry_scheduled',
        attempts,
        updatedAt: new Date().toISOString(),
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
        error: message
      }
    })
  }

  async markFailed(id: string, error: string): Promise<void> {
    const message = normalizeError(error)
    await this.#replace(id, (current) => ({
      ...current,
      state: 'failed',
      attempts: incrementAttempts(current.attempts),
      updatedAt: new Date().toISOString(),
      nextAttemptAt: undefined,
      error: message
    }))
  }

  ready(now = Date.now()): readonly ProjectDagHandoffRecord[] {
    return [...this.#records.values()]
      .filter((record) =>
        record.state === 'pending' ||
        (
          record.state === 'retry_scheduled' &&
          Date.parse(record.nextAttemptAt ?? '') <= now
        )
      )
      .sort((left, right) =>
        readyAt(left) - readyAt(right) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
      )
  }

  active(): readonly ProjectDagHandoffRecord[] {
    return [...this.#records.values()].filter((record) =>
      record.state === 'pending' || record.state === 'retry_scheduled'
    )
  }

  activeInLaneCoveredBy(
    anchor: ProjectDagHandoffRecord,
    committedWatermark: string
  ): readonly ProjectDagHandoffRecord[] {
    return this.active()
      .filter((record) =>
        sameAuthoritativeLane(record, anchor) &&
        evidenceDagWatermarkCoversValue(committedWatermark, record.targetWatermark)
      )
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      )
  }

  all(): readonly ProjectDagHandoffRecord[] {
    return [...this.#records.values()]
  }

  async #replace(
    id: string,
    update: (record: ProjectDagHandoffRecord) => ProjectDagHandoffRecord
  ): Promise<void> {
    await this.load()
    await this.#mutate(async () => {
      const current = this.#records.get(id)
      if (!current || current.state === 'accepted' || current.state === 'failed') return
      this.#records.set(id, Object.freeze(update(current)))
      try {
        await this.#persist()
      } catch (error) {
        this.#records.set(id, current)
        throw error
      }
    })
  }

  async #persist(): Promise<void> {
    const records = [...this.#records.values()]
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      )
    if (records.length > MAX_RECORDS) {
      throw new Error('Project DAG handoff outbox exceeds its bounded capacity.')
    }
    const payload: PersistedOutbox = {
      version: OUTBOX_VERSION,
      records
    }
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const temporaryPath = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    let temporaryHandle: Awaited<ReturnType<typeof open>> | undefined
    let renamed = false
    try {
      temporaryHandle = await open(temporaryPath, 'wx', 0o600)
      await temporaryHandle.chmod(0o600)
      await temporaryHandle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      await temporaryHandle.sync()
      await temporaryHandle.close()
      temporaryHandle = undefined
      await rename(temporaryPath, this.path)
      renamed = true
      await syncDirectory(directory)
    } finally {
      await temporaryHandle?.close().catch(() => undefined)
      if (!renamed) await unlink(temporaryPath).catch(() => undefined)
    }
  }

  async #mutate(operation: () => Promise<void>): Promise<void> {
    const pending = this.#mutation.then(operation, operation)
    this.#mutation = pending.catch(() => undefined)
    await pending
  }

  #pruneTerminalReceipts(): void {
    const overflow = this.#records.size - MAX_RECORDS
    if (overflow <= 0) return
    const oldestTerminal = [...this.#records.values()]
      .filter(isTerminal)
      .sort((left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id)
      )
      .slice(0, overflow)
    for (const record of oldestTerminal) this.#records.delete(record.id)
  }
}

function sameAuthoritativeLane(
  left: ProjectDagHandoffRecord,
  right: ProjectDagHandoffRecord
): boolean {
  return left.workspaceRoot === right.workspaceRoot &&
    left.runtimeId === right.runtimeId &&
    left.threadId === right.threadId &&
    left.sourceKind === right.sourceKind &&
    left.producerModuleId === right.producerModuleId &&
    left.executionId === right.executionId &&
    left.hostAcceptanceSequence === right.hostAcceptanceSequence &&
    left.hostWorkspaceBinding === right.hostWorkspaceBinding
}

function readyAt(record: ProjectDagHandoffRecord): number {
  if (record.state === 'pending') return 0
  const parsed = Date.parse(record.nextAttemptAt ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function handoffId(input: {
  workspaceRoot: string
  runtimeId: string
  threadId: string
  targetWatermark: string
  sourceKind: 'agent-thread' | 'package-execution'
  producerModuleId?: string
  executionId?: string
  hostAcceptanceSequence?: number
  hostWorkspaceBinding?: 'capability-caller'
}): string {
  const value = [
    input.workspaceRoot,
    input.runtimeId,
    input.threadId,
    input.targetWatermark,
    input.sourceKind,
    input.producerModuleId ?? '',
    input.executionId ?? '',
    input.hostAcceptanceSequence?.toString() ?? '',
    input.hostWorkspaceBinding ?? ''
  ].join('\u0000')
  return `project-handoff:${createHash('sha256').update(value).digest('hex')}`
}

function parseOutbox(value: unknown): PersistedOutbox {
  if (!isRecord(value) || value.version !== OUTBOX_VERSION || !Array.isArray(value.records)) {
    throw new Error('Project DAG handoff outbox has an unsupported schema.')
  }
  assertExactKeys(value, OUTBOX_KEYS, 'Project DAG handoff outbox')
  if (value.records.length > MAX_RECORDS) {
    throw new Error('Project DAG handoff outbox exceeds its bounded capacity.')
  }
  const records = value.records.map(parseRecord)
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error('Project DAG handoff outbox contains duplicate record ids.')
  }
  return { version: OUTBOX_VERSION, records }
}

function legacyOutboxVersion(value: unknown): 1 | 2 | null {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) return null
  return value.version
}

function parseRecord(value: unknown): ProjectDagHandoffRecord {
  if (!isRecord(value)) throw new Error('Project DAG handoff record must be an object.')
  assertExactKeys(value, RECORD_KEYS, 'Project DAG handoff record')
  const state = value.state
  if (
    state !== 'pending' &&
    state !== 'retry_scheduled' &&
    state !== 'accepted' &&
    state !== 'failed'
  ) {
    throw new Error('Project DAG handoff record has an invalid state.')
  }
  const receipt = value.receipt === undefined
    ? undefined
    : deepFreeze(projectDagDurableReceiptSchema.parse(value.receipt))
  const identity = persistedIdentity(value)
  const id = persistedRequired(value.id, 'id', 512)
  if (id !== handoffId(identity)) {
    throw new Error('Project DAG handoff record has an invalid identity id.')
  }
  const attempts = nonnegativeInteger(value.attempts)
  const createdAt = timestamp(value.createdAt, 'createdAt')
  const updatedAt = timestamp(value.updatedAt, 'updatedAt')
  const nextAttemptAt = value.nextAttemptAt === undefined
    ? undefined
    : timestamp(value.nextAttemptAt, 'nextAttemptAt')
  const error = value.error === undefined
    ? undefined
    : persistedError(value.error)
  assertStateFields(state, { attempts, nextAttemptAt, error, receipt })
  return Object.freeze({
    id,
    ...identity,
    state,
    attempts,
    createdAt,
    updatedAt,
    ...(nextAttemptAt ? { nextAttemptAt } : {}),
    ...(error ? { error } : {}),
    ...(receipt ? { receipt } : {})
  })
}

function normalizeIdentity(value: ProjectDagHandoffIdentity): ProjectDagHandoffIdentity {
  const identity = {
    workspaceRoot: required(value.workspaceRoot, 'workspaceRoot', 16_384),
    runtimeId: required(value.runtimeId, 'runtimeId', 512),
    threadId: required(value.threadId, 'threadId', 512),
    targetWatermark: required(value.targetWatermark, 'targetWatermark', 512),
    sourceKind: sourceKind(value.sourceKind),
    ...(value.producerModuleId === undefined
      ? {}
      : { producerModuleId: required(value.producerModuleId, 'producerModuleId', 512) }),
    ...(value.executionId === undefined
      ? {}
      : { executionId: required(value.executionId, 'executionId', 512) }),
    ...(value.hostAcceptanceSequence === undefined
      ? {}
      : { hostAcceptanceSequence: positiveInteger(
          value.hostAcceptanceSequence,
          'hostAcceptanceSequence'
        ) }),
    ...(value.hostWorkspaceBinding === undefined
      ? {}
      : { hostWorkspaceBinding: workspaceBinding(value.hostWorkspaceBinding) })
  }
  assertIdentityFields(identity)
  return Object.freeze(identity)
}

function persistedIdentity(value: Record<string, unknown>): ProjectDagHandoffIdentity {
  const identity = {
    workspaceRoot: persistedRequired(value.workspaceRoot, 'workspaceRoot', 16_384),
    runtimeId: persistedRequired(value.runtimeId, 'runtimeId', 512),
    threadId: persistedRequired(value.threadId, 'threadId', 512),
    targetWatermark: persistedRequired(value.targetWatermark, 'targetWatermark', 512),
    sourceKind: sourceKind(value.sourceKind),
    ...(value.producerModuleId === undefined
      ? {}
      : { producerModuleId: persistedRequired(value.producerModuleId, 'producerModuleId', 512) }),
    ...(value.executionId === undefined
      ? {}
      : { executionId: persistedRequired(value.executionId, 'executionId', 512) }),
    ...(value.hostAcceptanceSequence === undefined
      ? {}
      : { hostAcceptanceSequence: positiveInteger(
          value.hostAcceptanceSequence,
          'hostAcceptanceSequence'
        ) }),
    ...(value.hostWorkspaceBinding === undefined
      ? {}
      : { hostWorkspaceBinding: workspaceBinding(value.hostWorkspaceBinding) })
  }
  assertIdentityFields(identity)
  return Object.freeze(identity)
}

function sourceKind(value: unknown): ProjectDagHandoffIdentity['sourceKind'] {
  if (value === 'agent-thread' || value === 'package-execution') return value
  throw new Error('Project DAG handoff sourceKind is invalid.')
}

function workspaceBinding(value: unknown): 'capability-caller' {
  if (value === 'capability-caller') return value
  throw new Error('Project DAG handoff hostWorkspaceBinding is invalid.')
}

function assertIdentityFields(value: ProjectDagHandoffIdentity): void {
  if (value.sourceKind === 'agent-thread') {
    if (
      value.producerModuleId !== undefined ||
      value.executionId !== undefined ||
      value.hostAcceptanceSequence !== undefined ||
      value.hostWorkspaceBinding !== undefined
    ) {
      throw new Error('Agent-thread Project DAG handoff has package execution fields.')
    }
    return
  }
  if (
    !value.producerModuleId ||
    !value.executionId ||
    value.hostAcceptanceSequence === undefined ||
    value.hostWorkspaceBinding !== 'capability-caller'
  ) {
    throw new Error(
      'Package-execution Project DAG handoff requires a Host-bound producer identity.'
    )
  }
}

function required(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Project DAG handoff ${field} is required.`)
  }
  const normalized = value.trim()
  if (normalized.length > maxLength) {
    throw new Error(`Project DAG handoff ${field} is too long.`)
  }
  return normalized
}

function persistedRequired(value: unknown, field: string, maxLength: number): string {
  const normalized = required(value, field, maxLength)
  if (normalized !== value) {
    throw new Error(`Project DAG handoff ${field} is not normalized.`)
  }
  return normalized
}

function nonnegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Project DAG handoff attempts must be a non-negative safe integer.')
  }
  return value
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Project DAG handoff ${field} must be a positive safe integer.`)
  }
  return value
}

function timestamp(value: unknown, field: string): string {
  const parsed = persistedRequired(value, field, 64)
  let normalized: string
  try {
    normalized = new Date(parsed).toISOString()
  } catch {
    throw new Error(`Project DAG handoff ${field} must be a valid timestamp.`)
  }
  if (normalized !== parsed) {
    throw new Error(`Project DAG handoff ${field} must be a normalized timestamp.`)
  }
  return parsed
}

function normalizeError(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Project DAG handoff error is required.')
  }
  return value.trim().slice(0, MAX_ERROR_LENGTH)
}

function persistedError(value: unknown): string {
  const normalized = normalizeError(value)
  if (normalized !== value) {
    throw new Error('Project DAG handoff error is not normalized.')
  }
  return normalized
}

function nonnegativeDelay(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Project DAG handoff retry delay must be a non-negative finite number.')
  }
  return value
}

function incrementAttempts(value: number): number {
  if (value >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Project DAG handoff attempts exceed the safe integer range.')
  }
  return value + 1
}

function assertStateFields(
  state: ProjectDagHandoffState,
  value: Pick<ProjectDagHandoffRecord, 'attempts' | 'nextAttemptAt' | 'error' | 'receipt'>
): void {
  if (state === 'pending') {
    if (value.attempts !== 0 || value.nextAttemptAt || value.error || value.receipt) {
      throw new Error('Pending Project DAG handoff record has incompatible state fields.')
    }
    return
  }
  if (state === 'retry_scheduled') {
    if (value.attempts < 1 || !value.nextAttemptAt || !value.error || value.receipt) {
      throw new Error('Retry Project DAG handoff record has incompatible state fields.')
    }
    return
  }
  if (state === 'accepted') {
    if (!value.receipt || value.nextAttemptAt || value.error) {
      throw new Error('Accepted Project DAG handoff record has incompatible state fields.')
    }
    return
  }
  if (value.attempts < 1 || value.nextAttemptAt || !value.error || value.receipt) {
    throw new Error('Failed Project DAG handoff record has incompatible state fields.')
  }
}

function assertSameIdentity(
  record: ProjectDagHandoffRecord,
  identity: ProjectDagHandoffIdentity
): void {
  if (
    record.workspaceRoot !== identity.workspaceRoot ||
    record.runtimeId !== identity.runtimeId ||
    record.threadId !== identity.threadId ||
    record.targetWatermark !== identity.targetWatermark
  ) {
    throw new Error(`Project DAG handoff id collision: ${record.id}`)
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) throw new Error(`${label} contains unsupported field ${unexpected}.`)
}

function isTerminal(record: ProjectDagHandoffRecord): boolean {
  return record.state === 'accepted' || record.state === 'failed'
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  projectDagDurableReceiptSchema,
  type ProjectDagDurableReceipt
} from './contract.js'

const OUTBOX_VERSION = 1
const MAX_RECORDS = 1_000

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
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
        parsed = { version: OUTBOX_VERSION, records: [] }
      }
      const value = parseOutbox(parsed)
      this.#records = new Map(value.records.map((record) => [record.id, record]))
      this.#loaded = true
    })
  }

  async enqueue(input: {
    workspaceRoot: string
    runtimeId: string
    threadId: string
    targetWatermark: string
  }): Promise<ProjectDagHandoffRecord> {
    await this.load()
    let result: ProjectDagHandoffRecord | undefined
    await this.#mutate(async () => {
      const id = handoffId(input)
      const existing = this.#records.get(id)
      if (existing) {
        result = existing
        return
      }
      const now = new Date().toISOString()
      result = Object.freeze({
        id,
        workspaceRoot: required(input.workspaceRoot, 'workspaceRoot'),
        runtimeId: required(input.runtimeId, 'runtimeId'),
        threadId: required(input.threadId, 'threadId'),
        targetWatermark: required(input.targetWatermark, 'targetWatermark'),
        state: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now
      })
      this.#records.set(id, result)
      await this.#persist()
    })
    return result!
  }

  async markAccepted(
    id: string,
    receipt: ProjectDagDurableReceipt
  ): Promise<void> {
    await this.#replace(id, (current) => ({
      ...current,
      state: 'accepted',
      receipt: projectDagDurableReceiptSchema.parse(receipt),
      updatedAt: new Date().toISOString(),
      nextAttemptAt: undefined,
      error: undefined
    }))
  }

  async markRetry(id: string, error: string, retryAfterMs: number): Promise<void> {
    await this.#replace(id, (current) => {
      const attempts = current.attempts + 1
      return {
        ...current,
        state: 'retry_scheduled',
        attempts,
        updatedAt: new Date().toISOString(),
        nextAttemptAt: new Date(Date.now() + Math.max(0, retryAfterMs)).toISOString(),
        error: error.slice(0, 4_000)
      }
    })
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.#replace(id, (current) => ({
      ...current,
      state: 'failed',
      attempts: current.attempts + 1,
      updatedAt: new Date().toISOString(),
      nextAttemptAt: undefined,
      error: error.slice(0, 4_000)
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
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      )
  }

  active(): readonly ProjectDagHandoffRecord[] {
    return [...this.#records.values()].filter((record) =>
      record.state === 'pending' || record.state === 'retry_scheduled'
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
      await this.#persist()
    })
  }

  async #persist(): Promise<void> {
    const records = [...this.#records.values()]
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      )
    const terminal = records.filter((record) =>
      record.state === 'accepted' || record.state === 'failed'
    )
    const keepTerminal = new Set(
      terminal.slice(Math.max(0, terminal.length - Math.floor(MAX_RECORDS / 2)))
        .map(({ id }) => id)
    )
    const compacted = records.filter((record) =>
      record.state === 'pending' ||
      record.state === 'retry_scheduled' ||
      keepTerminal.has(record.id)
    ).slice(-MAX_RECORDS)
    this.#records = new Map(compacted.map((record) => [record.id, record]))
    const payload: PersistedOutbox = {
      version: OUTBOX_VERSION,
      records: compacted
    }
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.path)
  }

  async #mutate(operation: () => Promise<void>): Promise<void> {
    const pending = this.#mutation.then(operation, operation)
    this.#mutation = pending.catch(() => undefined)
    await pending
  }
}

export function evidenceWatermarkCovers(
  committedWatermark: string,
  targetWatermark: string
): boolean {
  const committed = committedWatermark.trim()
  const target = targetWatermark.trim()
  if (!committed || !target) return false
  if (committed === target || committed.startsWith(`${target}:`)) return true
  const committedSequence = leadingSequence(committed)
  const targetSequence = leadingSequence(target)
  return committedSequence !== null &&
    targetSequence !== null &&
    committedSequence >= targetSequence
}

function leadingSequence(value: string): number | null {
  const match = /^(\d+)(?:$|:)/u.exec(value)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isSafeInteger(parsed) ? parsed : null
}

function handoffId(input: {
  workspaceRoot: string
  runtimeId: string
  threadId: string
  targetWatermark: string
}): string {
  const value = [
    required(input.workspaceRoot, 'workspaceRoot'),
    required(input.runtimeId, 'runtimeId'),
    required(input.threadId, 'threadId'),
    required(input.targetWatermark, 'targetWatermark')
  ].join('\u0000')
  return `project-handoff:${createHash('sha256').update(value).digest('hex')}`
}

function parseOutbox(value: unknown): PersistedOutbox {
  if (!isRecord(value) || value.version !== OUTBOX_VERSION || !Array.isArray(value.records)) {
    throw new Error('Project DAG handoff outbox has an unsupported schema.')
  }
  const records = value.records.map(parseRecord)
  return { version: OUTBOX_VERSION, records }
}

function parseRecord(value: unknown): ProjectDagHandoffRecord {
  if (!isRecord(value)) throw new Error('Project DAG handoff record must be an object.')
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
    : projectDagDurableReceiptSchema.parse(value.receipt)
  if (state === 'accepted' && !receipt) {
    throw new Error('Accepted Project DAG handoff record is missing its receipt.')
  }
  return Object.freeze({
    id: required(value.id, 'id'),
    workspaceRoot: required(value.workspaceRoot, 'workspaceRoot'),
    runtimeId: required(value.runtimeId, 'runtimeId'),
    threadId: required(value.threadId, 'threadId'),
    targetWatermark: required(value.targetWatermark, 'targetWatermark'),
    state,
    attempts: nonnegativeInteger(value.attempts),
    createdAt: required(value.createdAt, 'createdAt'),
    updatedAt: required(value.updatedAt, 'updatedAt'),
    ...(typeof value.nextAttemptAt === 'string'
      ? { nextAttemptAt: value.nextAttemptAt }
      : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    ...(receipt ? { receipt } : {})
  })
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Project DAG handoff ${field} is required.`)
  }
  return value.trim()
}

function nonnegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('Project DAG handoff attempts must be a non-negative integer.')
  }
  return value
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

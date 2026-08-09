import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

import type { WorkspaceHostPayload } from '@sciforge/domain-sdk/workspace-host'

import { toolArtifactContent } from './runtime-payload-boundary.js'

const EVENT_STORE_SCHEMA_VERSION = 1
const EVENT_LOG_DIRECTORY = 'runtime-events'
const SUMMARY_SUFFIX = '.summary.json'
const EVENT_SUFFIX = '.events.jsonl'
const NOFOLLOW = constants.O_NOFOLLOW ?? 0
const PAGE_MAX_RECORDS = 256
const PAGE_MAX_SOURCE_BYTES = 256 * 1024

export type StoredRuntimeEvent = {
  kind: string
  runtimeId: 'codex'
  threadId: string
  turnId?: string
  itemId?: string
  seq: number
  createdAt: string
  [key: string]: WorkspaceHostPayload | undefined
}

export type StoredThreadEventSummary = Readonly<{
  threadId: string
  latestSeq: number
  latestTurnId?: string
  latestTurnStatus?: string
  hasUserMessage: boolean
  updatedAt?: string
}>

type MutableThreadEventSummary = {
  threadId: string
  latestSeq: number
  latestTurnId?: string
  latestTurnStatus?: string
  hasUserMessage: boolean
  updatedAt?: string
}

/**
 * Package-owned append-only event history for the remote Codex runtime.
 *
 * Event logs are never truncated. Reads serialize only the requested replay
 * delta, page, or latest artifact; summaries keep status/list queries O(1).
 */
export class RuntimeEventStore {
  readonly #directory: string
  readonly #summaries = new Map<string, MutableThreadEventSummary>()
  readonly #dirtySummaries = new Set<string>()
  #writeTail: Promise<void> = Promise.resolve()

  private constructor(stateDirectory: string) {
    this.#directory = join(stateDirectory, EVENT_LOG_DIRECTORY)
  }

  static async create(stateDirectory: string): Promise<RuntimeEventStore> {
    const store = new RuntimeEventStore(stateDirectory)
    await mkdir(store.#directory, { recursive: true, mode: 0o700 })
    await store.#loadSummaries()
    return store
  }

  append(
    threadId: string,
    input: Record<string, unknown>,
    createdAt: string
  ): StoredRuntimeEvent {
    const summary = this.#summaries.get(threadId) ?? emptySummary(threadId)
    const event = asStoredRuntimeEvent({
      ...input,
      runtimeId: 'codex',
      threadId,
      seq: summary.latestSeq + 1,
      createdAt: stringValue(input.createdAt) || createdAt
    })
    applyEventToSummary(summary, event)
    this.#summaries.set(threadId, summary)
    this.#dirtySummaries.add(threadId)
    const line = `${JSON.stringify(event)}\n`
    const path = this.#eventPath(threadId)
    this.#writeTail = this.#writeTail.then(async () => {
      const handle = await open(
        path,
        constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | NOFOLLOW,
        0o600
      )
      try {
        await handle.writeFile(line, 'utf8')
      } finally {
        await handle.close()
      }
    })
    return event
  }

  async summary(threadId: string): Promise<StoredThreadEventSummary | undefined> {
    await this.flush()
    return cloneSummary(this.#summaries.get(threadId))
  }

  async summaries(): Promise<StoredThreadEventSummary[]> {
    await this.flush()
    return [...this.#summaries.values()].map((summary) => cloneSummary(summary)!)
  }

  async readSince(threadId: string, sinceSeq: number): Promise<StoredRuntimeEvent[]> {
    await this.flush()
    const events: StoredRuntimeEvent[] = []
    try {
      if (sinceSeq > 0) {
        await readLinesReverse(this.#eventPath(threadId), (line) => {
          const event = parseEvent(line, threadId)
          if (!event) return
          if (event.seq <= sinceSeq) return false
          events.push(event)
        })
      } else {
        await readLines(this.#eventPath(threadId), (line) => {
          const event = parseEvent(line, threadId)
          if (event) events.push(event)
        })
      }
    } catch (error) {
      if (nodeErrorCode(error) !== 'ENOENT') throw error
    }
    if (sinceSeq > 0) events.sort((left, right) => left.seq - right.seq)
    return events
  }

  async readPage(
    threadId: string,
    cursor: string,
    limit: number
  ): Promise<{ events: StoredRuntimeEvent[]; nextCursor: string | null }> {
    await this.flush()
    const endOffset = decodePageCursor(cursor)
    const selectedKeys = new Set<string>()
    const events: StoredRuntimeEvent[] = []
    let selectedSourceBytes = 0
    let oldestSelectedOffset: number | null = null
    let hasOlderEvents = false
    try {
      await readLinesReverse(
        this.#eventPath(threadId),
        (line, startOffset) => {
          const sourceBytes = Buffer.byteLength(line, 'utf8') + 1
          if (events.length > 0 && (
            events.length >= PAGE_MAX_RECORDS ||
            selectedSourceBytes + sourceBytes > PAGE_MAX_SOURCE_BYTES
          )) {
            hasOlderEvents = true
            return false
          }
          const event = parseEvent(line, threadId)
          if (!event) return
          const turnId = stringValue(event.turnId) || stringValue(record(event.item).turnId)
          // The page contract returns turns. Thread-scoped lifecycle/status
          // events stay in replay and summaries and must not consume a turn slot.
          if (!turnId) return
          const key = `turn:${turnId}`
          if (!selectedKeys.has(key)) {
            if (selectedKeys.size >= limit) {
              hasOlderEvents = true
              return false
            }
            selectedKeys.add(key)
          }
          events.push(event)
          selectedSourceBytes += sourceBytes
          oldestSelectedOffset = startOffset
        },
        endOffset
      )
    } catch (error) {
      if (nodeErrorCode(error) !== 'ENOENT') throw error
    }
    events.sort((left, right) => left.seq - right.seq)
    return {
      events,
      nextCursor: hasOlderEvents && oldestSelectedOffset !== null
        ? encodePageCursor(oldestSelectedOffset)
        : null
    }
  }

  async readLatestToolArtifact(
    threadId: string,
    itemId: string
  ): Promise<string | undefined> {
    await this.flush()
    let detail: string | undefined
    try {
      await readLinesReverse(this.#eventPath(threadId), (line) => {
        const event = parseEvent(line, threadId)
        const item = record(event?.item)
        const candidate = stringValue(item.id) === itemId
          ? item
          : stringValue(event?.itemId) === itemId
            ? event
            : undefined
        if (!candidate) return
        detail = toolArtifactContent(candidate)
        if (detail === undefined && typeof candidate.detail === 'string') {
          detail = candidate.detail
        }
        if (detail === undefined) return
        return false
      })
    } catch (error) {
      if (nodeErrorCode(error) !== 'ENOENT') throw error
    }
    return detail
  }

  async delete(threadId: string): Promise<void> {
    await this.flush()
    this.#summaries.delete(threadId)
    this.#dirtySummaries.delete(threadId)
    await Promise.all([
      rm(this.#eventPath(threadId), { force: true }),
      rm(this.#summaryPath(threadId), { force: true })
    ])
  }

  async flush(): Promise<void> {
    await this.#writeTail
    while (this.#dirtySummaries.size > 0) {
      const snapshots = [...this.#dirtySummaries]
        .map((threadId) => cloneSummary(this.#summaries.get(threadId)))
        .filter((summary): summary is StoredThreadEventSummary => summary !== undefined)
      for (const snapshot of snapshots) {
        await this.#writeSummary(snapshot)
        if (this.#summaries.get(snapshot.threadId)?.latestSeq === snapshot.latestSeq) {
          this.#dirtySummaries.delete(snapshot.threadId)
        }
      }
      await this.#writeTail
    }
  }

  async #loadSummaries(): Promise<void> {
    const entries = await readdir(this.#directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(SUMMARY_SUFFIX)) continue
      const path = join(this.#directory, entry.name)
      let decoded: unknown
      try {
        decoded = JSON.parse(await readFile(path, 'utf8'))
      } catch (error) {
        throw new Error('Remote Codex event summary is unreadable.', { cause: error })
      }
      const summary = persistedSummary(decoded)
      if (entry.name !== this.#summaryFileName(summary.threadId)) {
        throw new Error('Remote Codex event summary does not match its storage key.')
      }
      if (this.#summaries.has(summary.threadId)) {
        throw new Error('Remote Codex event summaries contain duplicate thread IDs.')
      }
      this.#summaries.set(summary.threadId, summary)
      await this.#repairSummaryFromLogTail(summary)
    }
    const knownKeys = new Set(
      [...this.#summaries.keys()].map((threadId) => threadStorageKey(threadId))
    )
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(EVENT_SUFFIX)) continue
      const key = entry.name.slice(0, -EVENT_SUFFIX.length)
      if (knownKeys.has(key)) continue
      await this.#rebuildMissingSummary(join(this.#directory, entry.name), key)
    }
  }

  async #repairSummaryFromLogTail(summary: MutableThreadEventSummary): Promise<void> {
    const newer: StoredRuntimeEvent[] = []
    let latestSequenceOnDisk = 0
    try {
      await readLinesReverse(this.#eventPath(summary.threadId), (line) => {
        const event = parseEvent(line, summary.threadId)
        if (!event) return
        latestSequenceOnDisk ||= event.seq
        if (event.seq <= summary.latestSeq) return false
        newer.push(event)
      })
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT' && summary.latestSeq === 0) return
      throw error
    }
    if (latestSequenceOnDisk < summary.latestSeq) {
      throw new Error('Remote Codex event summary is ahead of its event log.')
    }
    newer.sort((left, right) => left.seq - right.seq)
    for (const event of newer) {
      if (event.seq !== summary.latestSeq + 1) {
        throw new Error('Remote Codex event log contains a sequence gap.')
      }
      applyEventToSummary(summary, event)
    }
    if (newer.length > 0) this.#dirtySummaries.add(summary.threadId)
  }

  async #rebuildMissingSummary(path: string, storageKey: string): Promise<void> {
    let summary: MutableThreadEventSummary | undefined
    await readLines(path, (line) => {
      let decoded: unknown
      try {
        decoded = JSON.parse(line)
      } catch {
        throw new Error('Remote Codex event log contains invalid JSON.')
      }
      const threadId = stringValue(record(decoded).threadId)
      if (!threadId || threadStorageKey(threadId) !== storageKey) {
        throw new Error('Remote Codex event log does not match its storage key.')
      }
      summary ??= emptySummary(threadId)
      const event = parseEvent(line, threadId)
      if (!event || event.seq !== summary.latestSeq + 1) {
        throw new Error('Remote Codex event log contains a sequence gap.')
      }
      applyEventToSummary(summary, event)
    })
    if (!summary) return
    this.#summaries.set(summary.threadId, summary)
    this.#dirtySummaries.add(summary.threadId)
  }

  async #writeSummary(summary: StoredThreadEventSummary): Promise<void> {
    const target = this.#summaryPath(summary.threadId)
    const temporary = `${target}.${randomUUID()}.tmp`
    const value = {
      schemaVersion: EVENT_STORE_SCHEMA_VERSION,
      ...summary
    }
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      })
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  #eventPath(threadId: string): string {
    return join(this.#directory, `${threadStorageKey(threadId)}${EVENT_SUFFIX}`)
  }

  #summaryPath(threadId: string): string {
    return join(this.#directory, this.#summaryFileName(threadId))
  }

  #summaryFileName(threadId: string): string {
    return `${threadStorageKey(threadId)}${SUMMARY_SUFFIX}`
  }
}

function emptySummary(threadId: string): MutableThreadEventSummary {
  return {
    threadId,
    latestSeq: 0,
    hasUserMessage: false
  }
}

function cloneSummary(
  summary: MutableThreadEventSummary | undefined
): StoredThreadEventSummary | undefined {
  return summary ? { ...summary } : undefined
}

function applyEventToSummary(
  summary: MutableThreadEventSummary,
  event: StoredRuntimeEvent
): void {
  summary.latestSeq = event.seq
  summary.updatedAt = event.createdAt
  if (event.kind === 'user_message') summary.hasUserMessage = true
  const turnId = stringValue(event.turnId)
  if (turnId) {
    if (summary.latestTurnId !== turnId) summary.latestTurnStatus = 'running'
    summary.latestTurnId = turnId
  }
  if (event.kind !== 'turn_lifecycle' || !turnId) return
  summary.latestTurnStatus = normalizedTurnStatus(stringValue(event.state))
}

function normalizedTurnStatus(state: string): string {
  if (state === 'completed' || state === 'success') return 'completed'
  if (state === 'failed' || state === 'error') return 'failed'
  if (
    state === 'aborted' ||
    state === 'cancelled' ||
    state === 'canceled' ||
    state === 'interrupted'
  ) return 'aborted'
  if (state === 'queued') return 'queued'
  return 'running'
}

function persistedSummary(value: unknown): MutableThreadEventSummary {
  const summary = record(value)
  const threadId = stringValue(summary.threadId)
  const latestSeq = numberValue(summary.latestSeq)
  if (
    summary.schemaVersion !== EVENT_STORE_SCHEMA_VERSION ||
    !threadId ||
    !Number.isSafeInteger(latestSeq) ||
    latestSeq < 0 ||
    typeof summary.hasUserMessage !== 'boolean'
  ) {
    throw new Error('Remote Codex event summary is incompatible.')
  }
  return {
    threadId,
    latestSeq,
    hasUserMessage: summary.hasUserMessage,
    ...(stringValue(summary.latestTurnId)
      ? { latestTurnId: stringValue(summary.latestTurnId) }
      : {}),
    ...(stringValue(summary.latestTurnStatus)
      ? { latestTurnStatus: stringValue(summary.latestTurnStatus) }
      : {}),
    ...(stringValue(summary.updatedAt) ? { updatedAt: stringValue(summary.updatedAt) } : {})
  }
}

function parseEvent(line: string, threadId: string): StoredRuntimeEvent | null {
  if (!line.trim()) return null
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new Error('Remote Codex event log contains invalid JSON.')
  }
  const event = record(value)
  if (
    event.runtimeId !== 'codex' ||
    event.threadId !== threadId ||
    !stringValue(event.kind) ||
    !Number.isSafeInteger(event.seq) ||
    numberValue(event.seq) <= 0 ||
    !stringValue(event.createdAt)
  ) {
    throw new Error('Remote Codex event log contains an invalid event.')
  }
  return asStoredRuntimeEvent(event)
}

function asStoredRuntimeEvent(value: Record<string, unknown>): StoredRuntimeEvent {
  return value as StoredRuntimeEvent
}

async function readLinesReverse(
  path: string,
  visitor: (
    line: string,
    startOffset: number
  ) => boolean | void | Promise<boolean | void>,
  endOffset?: number
): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | NOFOLLOW)
  try {
    const fileSize = (await handle.stat()).size
    const requestedEnd = endOffset ?? fileSize
    if (!Number.isSafeInteger(requestedEnd) || requestedEnd < 0 || requestedEnd > fileSize) {
      throw new Error('Invalid thread history cursor.')
    }
    const chunkSize = 64 * 1024
    let position = requestedEnd
    let carry = Buffer.alloc(0)
    while (position > 0) {
      const start = Math.max(0, position - chunkSize)
      const chunk = Buffer.allocUnsafe(position - start)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, start)
      if (bytesRead !== chunk.length) throw new Error('Could not read the event-log range.')
      const data = carry.length > 0
        ? Buffer.concat([chunk, carry], chunk.length + carry.length)
        : chunk
      let lineEnd = data.length
      for (let index = data.length - 1; index >= 0; index -= 1) {
        if (data[index] !== 0x0a) continue
        const lineStart = index + 1
        const rawLine = data.subarray(
          lineStart,
          lineEnd > lineStart && data[lineEnd - 1] === 0x0d ? lineEnd - 1 : lineEnd
        )
        lineEnd = index
        if (rawLine.length === 0) continue
        if (await visitor(rawLine.toString('utf8'), start + lineStart) === false) return
      }
      carry = Buffer.from(data.subarray(0, lineEnd))
      position = start
    }
    if (carry.length > 0) {
      const rawLine = carry[carry.length - 1] === 0x0d
        ? carry.subarray(0, carry.length - 1)
        : carry
      if (rawLine.length > 0) await visitor(rawLine.toString('utf8'), 0)
    }
  } finally {
    await handle.close()
  }
}

async function readLines(
  path: string,
  visitor: (line: string) => void | Promise<void>
): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | NOFOLLOW)
  try {
    const lines = createInterface({
      input: handle.createReadStream({ encoding: 'utf8', autoClose: false }),
      crlfDelay: Infinity
    })
    for await (const line of lines) {
      if (line.trim()) await visitor(line)
    }
  } finally {
    await handle.close()
  }
}

function encodePageCursor(endOffset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, endOffset }), 'utf8').toString('base64url')
}

function decodePageCursor(cursor: string): number | undefined {
  if (!cursor) return undefined
  try {
    const value = record(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    const endOffset = numberValue(value.endOffset)
    if (value.v !== 1 || !Number.isSafeInteger(endOffset) || endOffset < 0) throw new Error()
    return endOffset
  } catch {
    throw new Error('Invalid thread history cursor.')
  }
}

function threadStorageKey(threadId: string): string {
  return createHash('sha256').update(threadId).digest('hex')
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

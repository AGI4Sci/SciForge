import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import {
  MultiAgentChildRunRecord,
  MultiAgentChildRunPage,
  MultiAgentUsage,
  type MultiAgentChildStatus,
  type MultiAgentChildRunPage as MultiAgentChildRunPageType,
  type MultiAgentStoreDiagnostics,
  type MultiAgentTranscriptPage
} from './contract.js'

export type ListChildRunsOptions = {
  parentThreadId?: string
  parentTurnId?: string
  status?: MultiAgentChildStatus
  limit?: number
  offset?: number
}

export type ListChildRunsPageOptions = Omit<ListChildRunsOptions, 'offset' | 'limit'> & {
  cursor?: string
  limit?: number
}

export const MULTI_AGENT_RECENT_HISTORY_LIMIT = 200
export const MULTI_AGENT_HISTORY_PAGE_LIMIT = 100

export type ReadChildTranscriptOptions = {
  offset?: number
  limit?: number
}

export interface MultiAgentStore {
  upsert(record: MultiAgentChildRunRecord): Promise<void>
  delete(parentThreadId: string, childId: string): Promise<boolean>
  list(options?: ListChildRunsOptions): Promise<MultiAgentChildRunRecord[]>
  listPage(options?: ListChildRunsPageOptions): Promise<MultiAgentChildRunPageType>
  get(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null>
  findByRequest(
    parentThreadId: string,
    parentTurnId: string,
    requestId: string
  ): Promise<MultiAgentChildRunRecord | null>
  findByThreadId(threadId: string): Promise<MultiAgentChildRunRecord | null>
  readTranscript(
    parentThreadId: string,
    childId: string,
    options?: ReadChildTranscriptOptions
  ): Promise<MultiAgentTranscriptPage | null>
  diagnostics(): Promise<MultiAgentStoreDiagnostics>
}

type StoreScan = {
  records: MultiAgentChildRunRecord[]
  diagnostics: MultiAgentStoreDiagnostics
}

export class FileMultiAgentStore implements MultiAgentStore {
  private readonly pendingWrites = new Map<string, Promise<void>>()
  private readonly activeCache = new Map<string, MultiAgentChildRunRecord>()
  private readonly terminalCache = new Map<string, MultiAgentChildRunRecord>()
  private cacheReady = false
  private cacheWarmup: Promise<void> | null = null
  private cachedDiagnostics: MultiAgentStoreDiagnostics | null = null
  private scans = 0

  constructor(private readonly rootDir: string) {}

  async upsert(record: MultiAgentChildRunRecord): Promise<void> {
    const parsed = MultiAgentChildRunRecord.parse(record)
    const existing = this.cacheReady ? await this.readRecord(parsed.id) : null
    const previous = this.pendingWrites.get(parsed.id) ?? Promise.resolve()
    const write = previous.catch(() => undefined).then(() => this.writeRecord(parsed))
    this.pendingWrites.set(parsed.id, write)
    try {
      await write
      if (this.cacheWarmup) await this.cacheWarmup
      if (this.cacheReady) this.noteCachedRecord(parsed, existing)
    } finally {
      if (this.pendingWrites.get(parsed.id) === write) this.pendingWrites.delete(parsed.id)
    }
  }

  async delete(parentThreadId: string, childId: string): Promise<boolean> {
    const existing = await this.get(parentThreadId, childId)
    if (!existing) return false
    await (this.pendingWrites.get(childId) ?? Promise.resolve()).catch(() => undefined)
    await rm(this.recordPath(childId), { force: true })
    if (this.cacheReady) {
      this.activeCache.delete(childId)
      this.terminalCache.delete(childId)
      if (this.cachedDiagnostics) this.cachedDiagnostics.records = Math.max(0, this.cachedDiagnostics.records - 1)
      if (this.cachedDiagnostics) updateDiagnosticsSummary(this.cachedDiagnostics, existing, null)
    }
    return true
  }

  private async writeRecord(record: MultiAgentChildRunRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    const target = this.recordPath(record.id)
    const tmp = join(this.rootDir, `.${recordFileName(record.id)}.${randomUUID()}.tmp`)
    try {
      await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
      await renameWithRetry(tmp, target)
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async list(options: ListChildRunsOptions = {}): Promise<MultiAgentChildRunRecord[]> {
    const scan = await this.scan()
    this.replaceCache(scan)
    return filterRecords(scan.records, options)
  }

  async listPage(options: ListChildRunsPageOptions = {}): Promise<MultiAgentChildRunPageType> {
    await this.ensureCache()
    return pageCachedRecords(this.activeCache.values(), this.terminalCache.values(), {
      ...options,
      historyTruncated: this.cachedDiagnostics!.records > this.activeCache.size + this.terminalCache.size
    })
  }

  async get(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null> {
    const text = await readFile(this.recordPath(childId), 'utf8').catch(() => null)
    if (text) {
      try {
        const record = MultiAgentChildRunRecord.parse(JSON.parse(text))
        return record.parentThreadId === parentThreadId ? record : null
      } catch {
        return null
      }
    }
    const records = await this.list({ parentThreadId })
    return records.find((record) => record.id === childId) ?? null
  }

  async findByRequest(
    parentThreadId: string,
    parentTurnId: string,
    requestId: string
  ): Promise<MultiAgentChildRunRecord | null> {
    await this.ensureCache()
    for (const record of [...this.activeCache.values(), ...this.terminalCache.values()]) {
      if (
        record.parentThreadId === parentThreadId &&
        record.parentTurnId === parentTurnId &&
        record.requestId === requestId
      ) return record
    }
    const records = await this.list({ parentThreadId, parentTurnId })
    return records.find((record) => record.requestId === requestId) ?? null
  }

  async findByThreadId(threadId: string): Promise<MultiAgentChildRunRecord | null> {
    await this.ensureCache()
    for (const record of [...this.activeCache.values(), ...this.terminalCache.values()]) {
      if (record.threadRef?.threadId === threadId) return record
    }
    const records = await this.list()
    return records.find((record) => record.threadRef?.threadId === threadId) ?? null
  }

  async readTranscript(
    parentThreadId: string,
    childId: string,
    options: ReadChildTranscriptOptions = {}
  ): Promise<MultiAgentTranscriptPage | null> {
    const record = await this.get(parentThreadId, childId)
    if (!record) return null
    const offset = Math.max(0, options.offset ?? 0)
    const limit = Math.max(1, options.limit ?? 100)
    return {
      childId,
      parentThreadId,
      offset,
      limit,
      total: record.transcript.length,
      entries: record.transcript.slice(offset, offset + limit)
    }
  }

  async diagnostics(): Promise<MultiAgentStoreDiagnostics> {
    await this.ensureCache()
    return { ...this.cachedDiagnostics!, issues: [...this.cachedDiagnostics!.issues], scans: this.scans }
  }

  private async readRecord(childId: string): Promise<MultiAgentChildRunRecord | null> {
    const text = await readFile(this.recordPath(childId), 'utf8').catch(() => null)
    if (!text) return null
    try {
      return MultiAgentChildRunRecord.parse(JSON.parse(text))
    } catch {
      return null
    }
  }

  private async ensureCache(): Promise<void> {
    if (this.cacheReady) return
    this.cacheWarmup ??= this.scan().then((scan) => this.replaceCache(scan))
    await this.cacheWarmup
  }

  private replaceCache(scan: StoreScan): void {
    this.activeCache.clear()
    this.terminalCache.clear()
    for (const record of scan.records) this.noteCachedRecord(record)
    this.cachedDiagnostics = { ...scan.diagnostics, scans: this.scans }
    this.cacheReady = true
  }

  private noteCachedRecord(record: MultiAgentChildRunRecord, existing: MultiAgentChildRunRecord | null = null): void {
    existing ??= this.activeCache.get(record.id) ?? this.terminalCache.get(record.id) ?? null
    this.activeCache.delete(record.id)
    this.terminalCache.delete(record.id)
    if (isTerminalStatus(record.status)) this.terminalCache.set(record.id, record)
    else this.activeCache.set(record.id, record)
    trimTerminalCache(this.terminalCache)
    if (this.cachedDiagnostics) {
      if (!existing) this.cachedDiagnostics.records += 1
      updateDiagnosticsSummary(this.cachedDiagnostics, existing, record)
    }
  }

  private recordPath(childId: string): string {
    return join(this.rootDir, recordFileName(childId))
  }

  private async scan(): Promise<StoreScan> {
    this.scans += 1
    await mkdir(this.rootDir, { recursive: true })
    const entries = await readdir(this.rootDir).catch(() => [])
    const records: MultiAgentChildRunRecord[] = []
    const issues: MultiAgentStoreDiagnostics['issues'] = []
    for (const entry of entries.filter((name) => name.endsWith('.json')).sort()) {
      const file = join(this.rootDir, entry)
      try {
        const text = await readFile(file, 'utf8')
        records.push(MultiAgentChildRunRecord.parse(JSON.parse(text)))
      } catch (error) {
        issues.push({
          code: 'store_read_failed',
          file,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
    records.sort(compareRecords)
    return {
      records,
      diagnostics: {
        rootDir: this.rootDir,
        records: records.length,
        invalidRecords: issues.length,
        issues,
        scans: this.scans,
        statusCounts: countRecordStatuses(records),
        usage: sumRecordUsage(records)
      }
    }
  }
}

export class InMemoryMultiAgentStore implements MultiAgentStore {
  private readonly records = new Map<string, MultiAgentChildRunRecord>()
  private scans = 0

  async upsert(record: MultiAgentChildRunRecord): Promise<void> {
    const parsed = MultiAgentChildRunRecord.parse(record)
    this.records.set(parsed.id, parsed)
  }

  async delete(parentThreadId: string, childId: string): Promise<boolean> {
    const existing = this.records.get(childId)
    if (!existing || existing.parentThreadId !== parentThreadId) return false
    return this.records.delete(childId)
  }

  async list(options: ListChildRunsOptions = {}): Promise<MultiAgentChildRunRecord[]> {
    this.scans += 1
    return filterRecords([...this.records.values()].sort(compareRecords), options)
  }

  async listPage(options: ListChildRunsPageOptions = {}): Promise<MultiAgentChildRunPageType> {
    const active: MultiAgentChildRunRecord[] = []
    const terminal: MultiAgentChildRunRecord[] = []
    for (const record of this.records.values()) (isTerminalStatus(record.status) ? terminal : active).push(record)
    terminal.sort(compareRecordsNewest)
    return pageCachedRecords(active, terminal.slice(0, MULTI_AGENT_RECENT_HISTORY_LIMIT), {
      ...options,
      historyTruncated: terminal.length > MULTI_AGENT_RECENT_HISTORY_LIMIT
    })
  }

  async get(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null> {
    const record = this.records.get(childId)
    return record?.parentThreadId === parentThreadId ? record : null
  }

  async findByRequest(
    parentThreadId: string,
    parentTurnId: string,
    requestId: string
  ): Promise<MultiAgentChildRunRecord | null> {
    const records = await this.list({ parentThreadId, parentTurnId })
    return records.find((record) => record.requestId === requestId) ?? null
  }

  async findByThreadId(threadId: string): Promise<MultiAgentChildRunRecord | null> {
    for (const record of this.records.values()) {
      if (record.threadRef?.threadId === threadId) return record
    }
    return null
  }

  async readTranscript(
    parentThreadId: string,
    childId: string,
    options: ReadChildTranscriptOptions = {}
  ): Promise<MultiAgentTranscriptPage | null> {
    const record = await this.get(parentThreadId, childId)
    if (!record) return null
    const offset = Math.max(0, options.offset ?? 0)
    const limit = Math.max(1, options.limit ?? 100)
    return {
      childId,
      parentThreadId,
      offset,
      limit,
      total: record.transcript.length,
      entries: record.transcript.slice(offset, offset + limit)
    }
  }

  async diagnostics(): Promise<MultiAgentStoreDiagnostics> {
    return {
      records: this.records.size,
      invalidRecords: 0,
      issues: [],
      scans: this.scans,
      statusCounts: countRecordStatuses(this.records.values()),
      usage: sumRecordUsage(this.records.values())
    }
  }
}

function filterRecords(
  records: readonly MultiAgentChildRunRecord[],
  options: ListChildRunsOptions
): MultiAgentChildRunRecord[] {
  const offset = Math.max(0, options.offset ?? 0)
  const limit = options.limit === undefined ? undefined : Math.max(0, options.limit)
  const filtered = records
    .filter((record) => !options.parentThreadId || record.parentThreadId === options.parentThreadId)
    .filter((record) => !options.parentTurnId || record.parentTurnId === options.parentTurnId)
    .filter((record) => !options.status || record.status === options.status)
  return limit === undefined ? filtered.slice(offset) : filtered.slice(offset, offset + limit)
}

function compareRecords(a: MultiAgentChildRunRecord, b: MultiAgentChildRunRecord): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

function compareRecordsNewest(a: MultiAgentChildRunRecord, b: MultiAgentChildRunRecord): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)
}

function pageCachedRecords(
  activeRecords: Iterable<MultiAgentChildRunRecord>,
  terminalRecords: Iterable<MultiAgentChildRunRecord>,
  options: ListChildRunsPageOptions & { historyTruncated?: boolean }
): MultiAgentChildRunPageType {
  const limit = Math.min(MULTI_AGENT_HISTORY_PAGE_LIMIT, Math.max(1, Math.floor(options.limit ?? 40)))
  const cursor = decodeHistoryCursor(options.cursor)
  const matches = (record: MultiAgentChildRunRecord) =>
    (!options.parentThreadId || record.parentThreadId === options.parentThreadId) &&
    (!options.parentTurnId || record.parentTurnId === options.parentTurnId) &&
    (!options.status || record.status === options.status)
  const active = [...activeRecords].filter(matches).sort(compareRecordsNewest)
  const terminal = [...terminalRecords]
    .filter(matches)
    .sort(compareRecordsNewest)
    .filter((record) => !cursor || compareRecordWithCursor(record, cursor) > 0)
  const page = terminal.slice(0, limit)
  const hasMore = terminal.length > page.length
  return MultiAgentChildRunPage.parse({
    records: [...active, ...page],
    nextCursor: hasMore && page.length > 0 ? encodeHistoryCursor(page.at(-1)!) : null,
    historyTruncated: options.historyTruncated === true || hasMore
  })
}

function trimTerminalCache(cache: Map<string, MultiAgentChildRunRecord>): void {
  if (cache.size <= MULTI_AGENT_RECENT_HISTORY_LIMIT) return
  const keep = [...cache.values()].sort(compareRecordsNewest).slice(0, MULTI_AGENT_RECENT_HISTORY_LIMIT)
  cache.clear()
  for (const record of keep) cache.set(record.id, record)
}

function isTerminalStatus(status: MultiAgentChildStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted'
}

type HistoryCursor = { updatedAt: string; id: string }

function encodeHistoryCursor(record: MultiAgentChildRunRecord): string {
  return Buffer.from(JSON.stringify({ v: 1, updatedAt: record.updatedAt, id: record.id }), 'utf8').toString('base64url')
}

function decodeHistoryCursor(value: string | undefined): HistoryCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (parsed.v !== 1 || typeof parsed.updatedAt !== 'string' || typeof parsed.id !== 'string') throw new Error()
    return { updatedAt: parsed.updatedAt, id: parsed.id }
  } catch {
    throw new Error('Invalid multi-agent child history cursor.')
  }
}

function compareRecordWithCursor(record: MultiAgentChildRunRecord, cursor: HistoryCursor): number {
  return cursor.updatedAt.localeCompare(record.updatedAt) || cursor.id.localeCompare(record.id)
}

function countRecordStatuses(records: Iterable<MultiAgentChildRunRecord>): Record<MultiAgentChildStatus, number> {
  const counts = { queued: 0, running: 0, completed: 0, failed: 0, aborted: 0 }
  for (const record of records) counts[record.status] += 1
  return counts
}

function sumRecordUsage(records: Iterable<MultiAgentChildRunRecord>) {
  const usage = MultiAgentUsage.parse({})
  for (const record of records) addUsage(usage, record.usage, 1)
  return MultiAgentUsage.parse(usage)
}

function updateDiagnosticsSummary(
  diagnostics: MultiAgentStoreDiagnostics,
  previous: MultiAgentChildRunRecord | null,
  next: MultiAgentChildRunRecord | null
): void {
  if (previous) {
    diagnostics.statusCounts[previous.status] = Math.max(0, diagnostics.statusCounts[previous.status] - 1)
    addUsage(diagnostics.usage, previous.usage, -1)
  }
  if (next) {
    diagnostics.statusCounts[next.status] += 1
    addUsage(diagnostics.usage, next.usage, 1)
  }
  diagnostics.usage = MultiAgentUsage.parse(diagnostics.usage)
}

function addUsage(
  target: MultiAgentStoreDiagnostics['usage'],
  value: MultiAgentChildRunRecord['usage'],
  direction: 1 | -1
): void {
  for (const key of [
    'promptTokens', 'completionTokens', 'totalTokens', 'cachedTokens', 'cacheHitTokens', 'cacheMissTokens',
    'turns', 'costUsd', 'costCny', 'cacheSavingsUsd', 'cacheSavingsCny', 'tokenEconomySavingsTokens',
    'tokenEconomySavingsUsd', 'tokenEconomySavingsCny'
  ] as const) {
    const amount = value[key]
    if (amount === undefined) continue
    const next = Math.max(0, (target[key] ?? 0) + direction * amount)
    target[key] = next
  }
  target.cacheHitRate = target.cacheHitTokens !== undefined && target.cachedTokens
    ? target.cacheHitTokens / target.cachedTokens
    : undefined
}

function recordFileName(childId: string): string {
  return `${Buffer.from(childId, 'utf8').toString('base64url')}.json`
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(source, target)
      return
    } catch (error) {
      lastError = error
      if (!isTransientRenameError(error) || attempt === 5) throw error
      await delay(25 * 2 ** attempt)
    }
  }
  throw lastError
}

function isTransientRenameError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'ENOTEMPTY'
}

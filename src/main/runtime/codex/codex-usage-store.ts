import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import type {
  AgentRuntimeUsageGroupBy,
  AgentRuntimeUsage,
  AgentRuntimeUsageResponse
} from '../../../shared/agent-runtime-contract'
import { AppDataJsonlStore, atomicWriteAppDataText } from '../../services/app-data-store'

const NOFOLLOW = constants.O_NOFOLLOW ?? 0
const COMPACTION_MIN_JOURNAL_ROWS = 256
const COMPACTION_MIN_REDUNDANCY_RATIO = 2

export type CodexUsageRecord = {
  version: 1
  threadId: string
  turnId: string
  createdAt: string
  updatedAt: string
  model: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  totalTokens: number
  modelContextWindow: number | null
}

export type CodexUsageStoreOptions = {
  rootDir: string
  now?: () => Date
}

type CodexUsageSummaryQuery = {
  groupBy: AgentRuntimeUsageGroupBy
  from?: string
  to?: string
  timezone?: string
  threadId?: string
}

export type CodexUsageRecordInput = {
  threadId: string
  turnId?: string
  createdAt?: string
  model?: string
  usage: AgentRuntimeUsage
}

type ThreadTitle = {
  guiThreadId: string
  title: string
}

type UsageCounters = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  totalTokens: number
  costUsd: number
  costCny: number | null
  cacheSavingsUsd: number
  cacheSavingsCny: number | null
  tokenEconomySavingsTokens: number
  tokenEconomySavingsUsd: number
  tokenEconomySavingsCny: number | null
  turns: number
  threadCount: number
  cacheHitRate: number | null
}

export class CodexUsageStore {
  private readonly rootDir: string
  private readonly jsonlStore: AppDataJsonlStore
  private readonly now: () => Date
  private readonly recordsByTurn = new Map<string, CodexUsageRecord>()
  private loadPromise: Promise<void> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()
  private sortedRecordsCache: CodexUsageRecord[] | null = null

  constructor(options: CodexUsageStoreOptions) {
    this.rootDir = options.rootDir
    this.jsonlStore = new AppDataJsonlStore({
      rootDir: options.rootDir,
      segments: ['usage', 'codex-usage.jsonl']
    })
    this.now = options.now ?? (() => new Date())
  }

  async record(input: CodexUsageRecordInput): Promise<CodexUsageRecord | null> {
    const record = normalizeRecordInput(input, this.now)
    if (!record) return null
    return this.enqueueMutation(async () => {
      await this.ensureLoaded()
      const key = usageRecordKey(record)
      const current = this.recordsByTurn.get(key)
      const preferred = preferredRecord(current, record)
      if (preferred === current || (current && equivalentRecord(current, preferred))) return current

      await this.jsonlStore.appendJson([preferred])
      this.recordsByTurn.set(key, preferred)
      this.sortedRecordsCache = null
      return preferred
    })
  }

  async threadUsage(threadId: string): Promise<AgentRuntimeUsage | undefined> {
    const records = (await this.records()).filter((record) => record.threadId === threadId)
    if (records.length === 0) return undefined
    return usageFromCounters(sumRecords(records))
  }

  async summary(
    query: CodexUsageSummaryQuery,
    options: { threads?: ThreadTitle[] } = {}
  ): Promise<Extract<AgentRuntimeUsageResponse, { supported: true }>> {
    const records = await this.records()
    const timezone = validTimezone(query.timezone)
    const bounds = usageBounds(records, query, timezone)
    const scoped = records.filter((record) => recordInScope(record, query, bounds, timezone))
    const titleByThread = new Map((options.threads ?? []).map((thread) => [thread.guiThreadId, thread.title]))
    const days = dayBuckets(scoped, bounds, timezone)

    return {
      supported: true,
      groupBy: query.groupBy,
      from: bounds.from,
      to: bounds.to,
      timezone,
      buckets: bucketsForGroup(scoped, query.groupBy, bounds, timezone, titleByThread),
      ...(query.groupBy === 'model' ? { days } : {}),
      totals: totalsBucket(scoped, bounds, timezone)
    }
  }

  private async records(): Promise<CodexUsageRecord[]> {
    await this.mutationQueue
    await this.ensureLoaded()
    await this.mutationQueue
    if (!this.sortedRecordsCache) {
      this.sortedRecordsCache = [...this.recordsByTurn.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }
    return this.sortedRecordsCache
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadRecords().catch((error) => {
        this.loadPromise = null
        throw error
      })
    }
    await this.loadPromise
  }

  private async loadRecords(): Promise<void> {
    let handle
    try {
      const path = await this.jsonlStore.path()
      handle = await open(path, constants.O_RDONLY | NOFOLLOW)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    const input = handle.createReadStream({ encoding: 'utf8', autoClose: false })
    const lines = createInterface({ input, crlfDelay: Infinity })
    let recordRows = 0
    try {
      for await (const line of lines) {
        const record = parseRecord(line)
        if (!record) continue
        recordRows += 1
        const key = usageRecordKey(record)
        this.recordsByTurn.set(key, preferredRecord(this.recordsByTurn.get(key), record))
      }
    } finally {
      lines.close()
      input.destroy()
      await handle.close()
    }
    this.scheduleCompaction(recordRows)
  }

  private scheduleCompaction(recordRows: number): void {
    const uniqueRecords = this.recordsByTurn.size
    if (recordRows < COMPACTION_MIN_JOURNAL_ROWS ||
        uniqueRecords === 0 ||
        recordRows <= uniqueRecords * COMPACTION_MIN_REDUNDANCY_RATIO) return

    const timer = setTimeout(() => {
      void this.enqueueMutation(async () => {
        const records = this.sortedRecordsCache ?? [...this.recordsByTurn.values()]
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        const content = records.length > 0
          ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
          : ''
        await atomicWriteAppDataText(
          this.rootDir,
          ['usage', 'codex-usage.jsonl'],
          content
        )
      }).catch(() => {
        // Compaction is opportunistic. The append-only journal remains authoritative on failure.
      })
    }, 0)
    timer.unref()
  }

  private enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(task, task)
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }

}

function normalizeRecordInput(
  input: CodexUsageRecordInput,
  now: () => Date
): CodexUsageRecord | null {
  const threadId = input.threadId.trim()
  const turnId = input.turnId?.trim() ?? ''
  if (!threadId || !turnId) return null
  const usage = input.usage
  const inputTokens = safeInteger(usage.inputTokens)
  const outputTokens = safeInteger(usage.outputTokens)
  const reasoningTokens = safeInteger(usage.reasoningTokens)
  const cachedTokens = safeInteger(usage.cacheReadTokens)
  const cacheMissTokens = usage.cacheWriteTokens === undefined
    ? Math.max(0, inputTokens - cachedTokens)
    : safeInteger(usage.cacheWriteTokens)
  const totalTokens = safeInteger(usage.totalTokens) || inputTokens + outputTokens + reasoningTokens
  const createdAt = validIso(input.createdAt) ?? now().toISOString()
  return {
    version: 1,
    threadId,
    turnId,
    createdAt,
    updatedAt: now().toISOString(),
    model: input.model?.trim() || 'unknown',
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    cacheMissTokens,
    totalTokens,
    modelContextWindow: nullableInteger(usage.modelContextWindow)
  }
}

function parseRecord(line: string): CodexUsageRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const threadId = stringValue(record.threadId)
  const turnId = stringValue(record.turnId)
  if (!threadId || !turnId) return null
  return {
    version: 1,
    threadId,
    turnId,
    createdAt: validIso(stringValue(record.createdAt)) ?? new Date(0).toISOString(),
    updatedAt: validIso(stringValue(record.updatedAt)) ?? validIso(stringValue(record.createdAt)) ?? new Date(0).toISOString(),
    model: stringValue(record.model) || 'unknown',
    inputTokens: safeInteger(record.inputTokens),
    outputTokens: safeInteger(record.outputTokens),
    reasoningTokens: safeInteger(record.reasoningTokens),
    cachedTokens: safeInteger(record.cachedTokens),
    cacheMissTokens: safeInteger(record.cacheMissTokens),
    totalTokens: safeInteger(record.totalTokens),
    modelContextWindow: nullableInteger(record.modelContextWindow)
  }
}

function bucketsForGroup(
  records: CodexUsageRecord[],
  groupBy: AgentRuntimeUsageGroupBy,
  bounds: UsageBounds,
  timezone: string,
  titleByThread: Map<string, string>
): Array<Record<string, unknown>> {
  if (groupBy === 'day') return dayBuckets(records, bounds, timezone)
  if (groupBy === 'model') return groupedBuckets(records, (record) => record.model || 'unknown')
    .map(([model, grouped]) => ({ model, ...countersForRecords(grouped) }))
    .sort((a, b) => numberField(b.totalTokens) - numberField(a.totalTokens) || String(a.model).localeCompare(String(b.model)))

  return groupedBuckets(records, (record) => record.threadId)
    .map(([threadId, grouped]) => ({
      threadId,
      ...(titleByThread.get(threadId) ? { title: titleByThread.get(threadId) } : {}),
      ...countersForRecords(grouped)
    }))
    .sort((a, b) => numberField(b.totalTokens) - numberField(a.totalTokens) || String(a.threadId).localeCompare(String(b.threadId)))
}

function dayBuckets(
  records: CodexUsageRecord[],
  bounds: UsageBounds,
  timezone: string
): Array<Record<string, unknown>> {
  if (!bounds.from || !bounds.to) return []
  const grouped = groupedBuckets(records, (record) => dateInTimezone(record.createdAt, timezone))
  const byDate = new Map(grouped)
  return dateRange(bounds.from, bounds.to).map((date) => ({
    date,
    ...countersForRecords(byDate.get(date) ?? [])
  }))
}

function totalsBucket(records: CodexUsageRecord[], bounds: UsageBounds, timezone: string): Record<string, unknown> {
  const counters = countersForRecords(records)
  const activeDays = new Set(
    records
      .map((record) => dateInTimezone(record.createdAt, timezone))
  ).size
  return {
    ...counters,
    days: bounds.from && bounds.to ? dateRange(bounds.from, bounds.to).length : 0,
    activeDays
  }
}

function countersForRecords(records: CodexUsageRecord[]): UsageCounters {
  const summed = sumRecords(records)
  return {
    inputTokens: summed.inputTokens,
    outputTokens: summed.outputTokens,
    reasoningTokens: summed.reasoningTokens,
    cachedTokens: summed.cachedTokens,
    cacheMissTokens: summed.cacheMissTokens,
    totalTokens: summed.totalTokens,
    costUsd: 0,
    costCny: null,
    cacheSavingsUsd: 0,
    cacheSavingsCny: null,
    tokenEconomySavingsTokens: 0,
    tokenEconomySavingsUsd: 0,
    tokenEconomySavingsCny: null,
    turns: records.length,
    threadCount: new Set(records.map((record) => record.threadId)).size,
    cacheHitRate: cacheHitRate(summed)
  }
}

function sumRecords(records: CodexUsageRecord[]): Pick<
  CodexUsageRecord,
  'inputTokens' | 'outputTokens' | 'reasoningTokens' | 'cachedTokens' | 'cacheMissTokens' | 'totalTokens'
> {
  return records.reduce(
    (sum, record) => ({
      inputTokens: sum.inputTokens + record.inputTokens,
      outputTokens: sum.outputTokens + record.outputTokens,
      reasoningTokens: sum.reasoningTokens + record.reasoningTokens,
      cachedTokens: sum.cachedTokens + record.cachedTokens,
      cacheMissTokens: sum.cacheMissTokens + record.cacheMissTokens,
      totalTokens: sum.totalTokens + record.totalTokens
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheMissTokens: 0,
      totalTokens: 0
    }
  )
}

function usageFromCounters(counters: ReturnType<typeof sumRecords>): AgentRuntimeUsage {
  return {
    inputTokens: counters.inputTokens,
    outputTokens: counters.outputTokens,
    reasoningTokens: counters.reasoningTokens,
    totalTokens: counters.totalTokens,
    cacheReadTokens: counters.cachedTokens,
    cacheWriteTokens: counters.cacheMissTokens,
    costUsd: 0
  }
}

type UsageBounds = {
  from: string
  to: string
}

function usageBounds(records: CodexUsageRecord[], query: CodexUsageSummaryQuery, timezone: string): UsageBounds {
  const dates = records.map((record) => dateInTimezone(record.createdAt, timezone)).filter(Boolean)
  const sorted = [...dates].sort()
  return {
    from: query.from || sorted[0] || '',
    to: query.to || sorted.at(-1) || query.from || ''
  }
}

function recordInScope(
  record: CodexUsageRecord,
  query: CodexUsageSummaryQuery,
  bounds: UsageBounds,
  timezone: string
): boolean {
  if (query.threadId && record.threadId !== query.threadId) return false
  const date = dateInTimezone(record.createdAt, timezone)
  return (!bounds.from || date >= bounds.from) && (!bounds.to || date <= bounds.to)
}

function groupedBuckets<T>(
  records: T[],
  keyFor: (record: T) => string
): Array<[string, T[]]> {
  const buckets = new Map<string, T[]>()
  for (const record of records) {
    const key = keyFor(record)
    const list = buckets.get(key)
    if (list) list.push(record)
    else buckets.set(key, [record])
  }
  return [...buckets.entries()]
}

function cacheHitRate(counters: Pick<CodexUsageRecord, 'cachedTokens' | 'cacheMissTokens'>): number | null {
  const total = counters.cachedTokens + counters.cacheMissTokens
  return total > 0 ? counters.cachedTokens / total : null
}

function preferredRecord(current: CodexUsageRecord | undefined, next: CodexUsageRecord): CodexUsageRecord {
  if (!current) return next
  const currentHasTokens = recordTokenValue(current) > 0
  const nextHasTokens = recordTokenValue(next) > 0
  if (currentHasTokens && !nextHasTokens) return current
  return next
}

function usageRecordKey(record: Pick<CodexUsageRecord, 'threadId' | 'turnId'>): string {
  return `${record.threadId}\u0000${record.turnId}`
}

function equivalentRecord(current: CodexUsageRecord, next: CodexUsageRecord): boolean {
  return current.threadId === next.threadId &&
    current.turnId === next.turnId &&
    current.model === next.model &&
    current.inputTokens === next.inputTokens &&
    current.outputTokens === next.outputTokens &&
    current.reasoningTokens === next.reasoningTokens &&
    current.cachedTokens === next.cachedTokens &&
    current.cacheMissTokens === next.cacheMissTokens &&
    current.totalTokens === next.totalTokens &&
    current.modelContextWindow === next.modelContextWindow
}

function recordTokenValue(record: CodexUsageRecord): number {
  return record.inputTokens +
    record.outputTokens +
    record.reasoningTokens +
    record.cachedTokens +
    record.cacheMissTokens +
    record.totalTokens
}

function dateRange(from: string, to: string): string[] {
  if (!from || !to || from > to) return []
  const dates: string[] = []
  let cursor = from
  for (let guard = 0; cursor <= to && guard < 2000; guard += 1) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return dates
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function dateInTimezone(iso: string, timezone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = formatterForTimezone(timezone).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10)
}

function formatterForTimezone(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  }
}

function validTimezone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
    return value
  } catch {
    return 'UTC'
  }
}

function validIso(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function safeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function nullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

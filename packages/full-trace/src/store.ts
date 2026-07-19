import {
  constants,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  chmod,
  unlink
} from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { createHash, randomUUID } from 'node:crypto'
import {
  TRACE_EXPORT_FORMAT,
  TRACE_SCHEMA_VERSION,
  assertTraceEventInput,
  createEventId,
  isTraceEvent,
  type TraceClearResult,
  type TraceEvent,
  type TraceEventInput,
  type TraceEventKind,
  type TraceExportManifest,
  type TraceExportOptions,
  type TraceExportResult,
  type TraceJsonValue,
  type TraceReadQuery,
  type TraceReadResult,
  type TraceRetentionResult,
  type TraceSummary,
  type TraceSummaryQuery
} from './schema.js'
import {
  sanitizeTraceText,
  sanitizeTraceTextChunks,
  sanitizeTraceValue,
  type TraceSanitizationOptions
} from './redaction.js'

const DEFAULT_RETENTION_DAYS = 30
const TRACE_DIRECTORY_NAME = 'full-traces'
const SEGMENT_PATTERN = /^(\d{4}-\d{2}-\d{2})\.ndjson$/
const RETENTION_MARKER_NAME = '.retention.json'
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600

export type LocalTraceStoreOptions = {
  /** Application user-data directory. Traces are placed in its full-traces child. */
  userDataDirectory?: string
  /** Direct storage location for tests and non-Electron hosts. */
  storageDirectory?: string
  retentionDays?: number
  now?: () => Date
  /** Known credentials to remove even when an upstream echoes them without a label. */
  sensitiveValues?: readonly string[] | (() => readonly string[])
}

export type TracePruneOptions = {
  force?: boolean
}

type ParsedEvents = {
  events: TraceEvent[]
  corruptLines: number
}

type MutableSummary = {
  traceId: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  sources: Set<string>
  model?: string
  startedAt: string
  endedAt: string
  completed: boolean
  requestIds: Set<string>
  eventCount: number
  agentEventCount: number
  errorCount: number
  preview?: string
  error?: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    hasValue: boolean
  }
}

/**
 * Append-only, daily-segmented local trace store. Normal capture only appends;
 * rewriting/deletion is limited to explicit clear and retention maintenance.
 */
export class LocalTraceStore {
  readonly directory: string
  readonly retentionDays: number

  private readonly now: () => Date
  private readonly getSensitiveValues: () => readonly string[]
  private initialization?: Promise<void>
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(options: LocalTraceStoreOptions) {
    if ((options.userDataDirectory === undefined) === (options.storageDirectory === undefined)) {
      throw new Error('Provide exactly one of userDataDirectory or storageDirectory')
    }
    const baseDirectory = options.storageDirectory ?? options.userDataDirectory
    if (!baseDirectory || !path.isAbsolute(baseDirectory)) {
      throw new Error('Trace storage requires an absolute directory')
    }
    this.directory = options.storageDirectory
      ? path.resolve(options.storageDirectory)
      : path.join(path.resolve(baseDirectory), TRACE_DIRECTORY_NAME)
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS
    if (!Number.isInteger(this.retentionDays) || this.retentionDays <= 0) {
      throw new Error('retentionDays must be a positive integer')
    }
    this.now = options.now ?? (() => new Date())
    const sensitiveValues = options.sensitiveValues
    this.getSensitiveValues = typeof sensitiveValues === 'function'
      ? sensitiveValues
      : () => sensitiveValues ?? []
  }

  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initializeOnce().catch((error: unknown) => {
        this.initialization = undefined
        throw error
      })
    }
    return this.initialization
  }

  async append<Kind extends TraceEventKind>(input: TraceEventInput<Kind>): Promise<TraceEvent> {
    await this.initialize()
    return this.enqueue(async () => {
      const event = this.normalizeEvent(input)
      await this.appendEvents([event])
      return event
    })
  }

  async appendMany(inputs: readonly TraceEventInput[]): Promise<TraceEvent[]> {
    await this.initialize()
    if (inputs.length === 0) return []
    return this.enqueue(async () => {
      const events = inputs.map((input) => this.normalizeEvent(input))
      await this.appendEvents(events)
      return events
    })
  }

  /** Applies the store's current exact-secret policy to one ordered text stream. */
  sanitizeTextChunks(chunks: readonly string[]): string[] {
    return sanitizeTraceTextChunks(chunks, this.sanitizationOptions())
  }

  async read(query: TraceReadQuery = {}): Promise<TraceReadResult> {
    await this.initialize()
    validateReadQuery(query)
    return this.enqueue(async () => this.readInternal(query))
  }

  async summaries(query: TraceSummaryQuery = {}): Promise<TraceSummary[]> {
    const { limit, order = 'desc', ...readQuery } = query
    const { events } = await this.read({ ...readQuery, order: 'asc' })
    const summaries = deriveSummaries(events)
    summaries.sort((left, right) => (
      order === 'asc'
        ? left.startedAt.localeCompare(right.startedAt)
        : right.startedAt.localeCompare(left.startedAt)
    ))
    return limit === undefined ? summaries : summaries.slice(0, validateLimit(limit))
  }

  async export(options: TraceExportOptions): Promise<TraceExportResult> {
    await this.initialize()
    const destination = path.resolve(options.destination)
    if (!path.isAbsolute(options.destination)) {
      throw new Error('Trace export destination must be absolute')
    }
    if (isPathInside(this.directory, destination)) {
      throw new Error('Trace exports must be written outside the trace store')
    }
    const exportedAt = this.now().toISOString()
    const result = await this.read({
      traceIds: options.traceIds,
      from: options.from,
      to: options.to,
      order: 'asc'
    })
    const traceCount = new Set(result.events.map((event) => event.traceId)).size
    const manifest: TraceExportManifest = {
      format: TRACE_EXPORT_FORMAT,
      schemaVersion: TRACE_SCHEMA_VERSION,
      exportedAt,
      eventCount: result.events.length,
      traceCount
    }
    await writeExclusiveExport(destination, manifest, result.events, this.sanitizationOptions())
    return {
      destination,
      exportedAt,
      eventCount: result.events.length,
      traceCount
    }
  }

  async clear(): Promise<TraceClearResult> {
    await this.initialize()
    return this.enqueue(async () => {
      const segmentFiles = await this.segmentFiles()
      let deletedEvents = 0
      for (const file of segmentFiles) {
        deletedEvents += await countNonEmptyLines(file)
        await unlink(file)
      }
      return { deletedFiles: segmentFiles.length, deletedEvents }
    })
  }

  async pruneExpired(options: TracePruneOptions = {}): Promise<TraceRetentionResult> {
    await this.initialize()
    return this.enqueue(async () => this.pruneExpiredInternal(options.force ?? false))
  }

  private async initializeOnce(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: DIRECTORY_MODE })
    const info = await lstat(this.directory)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('Trace storage path must be a real directory, not a symbolic link')
    }
    await chmod(this.directory, DIRECTORY_MODE)
    await this.pruneExpiredInternal(false)
  }

  private normalizeEvent<Kind extends TraceEventKind>(input: TraceEventInput<Kind>): TraceEvent {
    assertTraceEventInput(input as TraceEventInput)
    const recordedAt = this.now().toISOString()
    const sanitization = this.sanitizationOptions()
    return {
      schemaVersion: TRACE_SCHEMA_VERSION,
      eventId: sanitizeTraceIdentifier(input.eventId ?? createEventId(), sanitization),
      traceId: sanitizeTraceIdentifier(input.traceId, sanitization),
      source: sanitizeTraceIdentifier(input.source, sanitization),
      kind: input.kind,
      timestamp: input.timestamp ?? recordedAt,
      recordedAt,
      ...(input.runtimeId ? { runtimeId: sanitizeTraceIdentifier(input.runtimeId, sanitization) } : {}),
      ...(input.threadId ? { threadId: sanitizeTraceIdentifier(input.threadId, sanitization) } : {}),
      ...(input.turnId ? { turnId: sanitizeTraceIdentifier(input.turnId, sanitization) } : {}),
      ...(input.requestId ? { requestId: sanitizeTraceIdentifier(input.requestId, sanitization) } : {}),
      ...(input.parentRequestId ? { parentRequestId: sanitizeTraceIdentifier(input.parentRequestId, sanitization) } : {}),
      payload: sanitizeTraceValue(input.payload, sanitization)
    }
  }

  private async appendEvents(events: readonly TraceEvent[]): Promise<void> {
    const bySegment = new Map<string, TraceEvent[]>()
    for (const event of events) {
      const segment = segmentPath(this.directory, event.recordedAt)
      const grouped = bySegment.get(segment) ?? []
      grouped.push(event)
      bySegment.set(segment, grouped)
    }
    for (const [segment, grouped] of bySegment) {
      await assertSafeSegmentTarget(segment)
      const handle = await open(
        segment,
        constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | noFollowFlag(),
        FILE_MODE
      )
      try {
        await handle.chmod(FILE_MODE)
        await handle.writeFile(grouped.map((event) => `${JSON.stringify(event)}\n`).join(''), 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
  }

  private async readInternal(query: TraceReadQuery): Promise<TraceReadResult> {
    const traceIds = query.traceIds ? new Set(query.traceIds) : undefined
    const kinds = query.kinds ? new Set(query.kinds) : undefined
    const from = query.from ? Date.parse(query.from) : undefined
    const to = query.to ? Date.parse(query.to) : undefined
    const parsed = await this.readAllSegments()
    let events = parsed.events.filter((event) => {
      const timestamp = Date.parse(event.timestamp)
      return (!traceIds || traceIds.has(event.traceId)) &&
        (!query.runtimeId || event.runtimeId === query.runtimeId) &&
        (!query.threadId || event.threadId === query.threadId) &&
        (!query.turnId || event.turnId === query.turnId) &&
        (!query.requestId || event.requestId === query.requestId) &&
        (!kinds || kinds.has(event.kind)) &&
        (from === undefined || timestamp >= from) &&
        (to === undefined || timestamp <= to)
    })
    events.sort(compareEvents)
    if (query.order === 'desc') events.reverse()
    const total = events.length
    if (query.limit !== undefined) events = events.slice(0, query.limit)
    return { events, total, corruptLines: parsed.corruptLines }
  }

  private async readAllSegments(): Promise<ParsedEvents> {
    const events: TraceEvent[] = []
    let corruptLines = 0
    for (const file of await this.segmentFiles()) {
      const parsed = await readSegment(file, this.sanitizationOptions())
      events.push(...parsed.events)
      corruptLines += parsed.corruptLines
    }
    return { events, corruptLines }
  }

  private async segmentFiles(): Promise<string[]> {
    const entries = await readdir(this.directory, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      if (!SEGMENT_PATTERN.test(entry.name)) continue
      const file = path.join(this.directory, entry.name)
      const info = await lstat(file)
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error(`Unsafe trace segment: ${entry.name}`)
      }
      files.push(file)
    }
    return files.sort()
  }

  private async pruneExpiredInternal(force: boolean): Promise<TraceRetentionResult> {
    const now = this.now()
    const cutoff = new Date(now.getTime() - this.retentionDays * MILLISECONDS_PER_DAY)
    const today = now.toISOString().slice(0, 10)
    if (!force && await retentionRanToday(this.directory, today)) {
      return { ran: false, cutoff: cutoff.toISOString(), deletedFiles: 0, deletedEvents: 0 }
    }

    let deletedFiles = 0
    let deletedEvents = 0
    for (const file of await this.segmentFiles()) {
      const name = path.basename(file)
      const match = SEGMENT_PATTERN.exec(name)
      if (!match) continue
      const segmentStart = Date.parse(`${match[1]}T00:00:00.000Z`)
      const segmentEnd = segmentStart + MILLISECONDS_PER_DAY
      if (segmentEnd <= cutoff.getTime()) {
        deletedEvents += await countNonEmptyLines(file)
        await unlink(file)
        deletedFiles += 1
        continue
      }
      if (segmentStart < cutoff.getTime()) {
        const parsed = await readSegment(file, this.sanitizationOptions())
        const retained = parsed.events.filter((event) => Date.parse(event.recordedAt) >= cutoff.getTime())
        const removed = parsed.events.length - retained.length + parsed.corruptLines
        if (removed > 0) {
          deletedEvents += removed
          if (retained.length === 0) {
            await unlink(file)
            deletedFiles += 1
          } else {
            await replaceSegment(file, retained)
          }
        }
      }
    }
    await writeOwnerOnlyJson(path.join(this.directory, RETENTION_MARKER_NAME), { lastRunDate: today })
    return { ran: true, cutoff: cutoff.toISOString(), deletedFiles, deletedEvents }
  }

  private sanitizationOptions(): TraceSanitizationOptions {
    return { sensitiveValues: this.getSensitiveValues() }
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }
}

export function deriveSummaries(events: readonly TraceEvent[]): TraceSummary[] {
  const grouped = new Map<string, MutableSummary>()
  for (const event of [...events].sort(compareEvents)) {
    let summary = grouped.get(event.traceId)
    if (!summary) {
      summary = {
        traceId: event.traceId,
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        turnId: event.turnId,
        sources: new Set(),
        startedAt: event.timestamp,
        endedAt: event.timestamp,
        completed: false,
        requestIds: new Set(),
        eventCount: 0,
        agentEventCount: 0,
        errorCount: 0,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, hasValue: false }
      }
      grouped.set(event.traceId, summary)
    }
    summary.runtimeId ??= event.runtimeId
    summary.threadId ??= event.threadId
    summary.turnId ??= event.turnId
    summary.sources.add(event.source)
    summary.startedAt = earlier(summary.startedAt, event.timestamp)
    summary.endedAt = later(summary.endedAt, event.timestamp)
    summary.eventCount += 1

    const payload = asRecord(event.payload)
    if (event.kind === 'model_request') {
      summary.requestIds.add(event.requestId ?? event.eventId)
      summary.model ??= stringValue(payload?.model) ?? stringValue(asRecord(payload?.body)?.model)
      summary.preview ??= previewValue(payload?.body)
    } else if (event.kind === 'model_response_end') {
      summary.completed = true
    } else if (event.kind === 'agent_event') {
      summary.agentEventCount += 1
    } else if (event.kind === 'error') {
      summary.errorCount += 1
      summary.error = stringValue(payload?.message) ?? summary.error ?? 'Trace error'
    } else if (event.kind === 'usage') {
      addUsage(summary, payload)
    } else if (event.kind === 'lifecycle') {
      const phase = stringValue(payload?.phase)?.toLowerCase()
      if (phase && /^(completed|complete|ended|finished|stopped|cancelled)$/.test(phase)) {
        summary.completed = true
      }
    }
  }

  return [...grouped.values()].map((summary) => ({
    traceId: summary.traceId,
    ...(summary.runtimeId ? { runtimeId: summary.runtimeId } : {}),
    ...(summary.threadId ? { threadId: summary.threadId } : {}),
    ...(summary.turnId ? { turnId: summary.turnId } : {}),
    sources: [...summary.sources].sort(),
    ...(summary.model ? { model: summary.model } : {}),
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    durationMs: Math.max(0, Date.parse(summary.endedAt) - Date.parse(summary.startedAt)),
    status: summary.errorCount > 0 ? 'error' : summary.completed ? 'completed' : 'active',
    requestCount: summary.requestIds.size,
    eventCount: summary.eventCount,
    agentEventCount: summary.agentEventCount,
    errorCount: summary.errorCount,
    ...(summary.preview ? { preview: summary.preview } : {}),
    ...(summary.error ? { error: summary.error } : {}),
    ...(summary.usage.hasValue ? {
      usage: {
        inputTokens: summary.usage.inputTokens,
        outputTokens: summary.usage.outputTokens,
        totalTokens: summary.usage.totalTokens
      }
    } : {})
  }))
}

function sanitizeTraceIdentifier(value: string, options: TraceSanitizationOptions): string {
  if (sanitizeTraceText(value, options) === value) return value
  return `redacted_sha256_${createHash('sha256').update(value).digest('hex')}`
}

function sanitizeStoredEvent(
  event: TraceEvent,
  options: TraceSanitizationOptions
): TraceEvent {
  return {
    ...event,
    eventId: sanitizeTraceIdentifier(event.eventId, options),
    traceId: sanitizeTraceIdentifier(event.traceId, options),
    source: sanitizeTraceIdentifier(event.source, options),
    ...(event.runtimeId
      ? { runtimeId: sanitizeTraceIdentifier(event.runtimeId, options) }
      : {}),
    ...(event.threadId
      ? { threadId: sanitizeTraceIdentifier(event.threadId, options) }
      : {}),
    ...(event.turnId
      ? { turnId: sanitizeTraceIdentifier(event.turnId, options) }
      : {}),
    ...(event.requestId
      ? { requestId: sanitizeTraceIdentifier(event.requestId, options) }
      : {}),
    ...(event.parentRequestId
      ? { parentRequestId: sanitizeTraceIdentifier(event.parentRequestId, options) }
      : {}),
    payload: sanitizeTraceValue(event.payload, options)
  }
}

async function readSegment(file: string, sanitization: TraceSanitizationOptions): Promise<ParsedEvents> {
  const events: TraceEvent[] = []
  let corruptLines = 0
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (!isTraceEvent(value)) {
        corruptLines += 1
        continue
      }
      events.push(sanitizeStoredEvent(value, sanitization))
    } catch {
      corruptLines += 1
    }
  }
  return { events, corruptLines }
}

async function writeExclusiveExport(
  destination: string,
  manifest: TraceExportManifest,
  events: readonly TraceEvent[],
  sanitization: TraceSanitizationOptions
): Promise<void> {
  const parent = path.dirname(destination)
  await mkdir(parent, { recursive: true })
  const temporary = path.join(parent, `.${path.basename(destination)}.${randomUUID()}.tmp`)
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
    FILE_MODE
  )
  try {
    await handle.chmod(FILE_MODE)
    await handle.writeFile(`${JSON.stringify({ recordType: 'manifest', ...manifest })}\n`, 'utf8')
    for (const event of events) {
      await handle.writeFile(`${JSON.stringify(sanitizeStoredEvent(event, sanitization))}\n`, 'utf8')
    }
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await copyFile(temporary, destination, constants.COPYFILE_EXCL)
    await chmod(destination, FILE_MODE)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

async function replaceSegment(file: string, events: readonly TraceEvent[]): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
    FILE_MODE
  )
  try {
    await handle.chmod(FILE_MODE)
    await handle.writeFile(events.map((event) => `${JSON.stringify(event)}\n`).join(''), 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, file)
    await chmod(file, FILE_MODE)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

async function writeOwnerOnlyJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
    FILE_MODE
  )
  try {
    await handle.chmod(FILE_MODE)
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, file)
    await chmod(file, FILE_MODE)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

async function retentionRanToday(directory: string, today: string): Promise<boolean> {
  const file = path.join(directory, RETENTION_MARKER_NAME)
  try {
    const info = await lstat(file)
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Unsafe trace retention marker')
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    return asRecord(parsed)?.lastRunDate === today
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

async function assertSafeSegmentTarget(file: string): Promise<void> {
  try {
    const info = await lstat(file)
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Unsafe trace segment target')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }
}

async function countNonEmptyLines(file: string): Promise<number> {
  let count = 0
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.trim()) count += 1
  }
  return count
}

function segmentPath(directory: string, recordedAt: string): string {
  return path.join(directory, `${recordedAt.slice(0, 10)}.ndjson`)
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
}

function validateReadQuery(query: TraceReadQuery): void {
  if (query.limit !== undefined) validateLimit(query.limit)
  for (const [name, value] of [['from', query.from], ['to', query.to]] as const) {
    if (value !== undefined && !Number.isFinite(Date.parse(value))) {
      throw new Error(`${name} must be a valid ISO-8601 date`)
    }
  }
}

function validateLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit must be a positive integer')
  return limit
}

function compareEvents(left: TraceEvent, right: TraceEvent): number {
  return left.timestamp.localeCompare(right.timestamp) ||
    left.recordedAt.localeCompare(right.recordedAt) ||
    left.eventId.localeCompare(right.eventId)
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function earlier(left: string, right: string): string {
  return left.localeCompare(right) <= 0 ? left : right
}

function later(left: string, right: string): string {
  return left.localeCompare(right) >= 0 ? left : right
}

function previewValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const compact = text.replaceAll(/\s+/g, ' ').trim()
  if (!compact) return undefined
  return compact.length <= 240 ? compact : `${compact.slice(0, 237)}...`
}

function addUsage(summary: MutableSummary, payload: Record<string, unknown> | undefined): void {
  if (!payload) return
  const inputTokens = numericValue(payload.inputTokens ?? payload.input_tokens)
  const outputTokens = numericValue(payload.outputTokens ?? payload.output_tokens)
  const totalTokens = numericValue(payload.totalTokens ?? payload.total_tokens)
  if (inputTokens !== undefined) {
    summary.usage.inputTokens += inputTokens
    summary.usage.hasValue = true
  }
  if (outputTokens !== undefined) {
    summary.usage.outputTokens += outputTokens
    summary.usage.hasValue = true
  }
  if (totalTokens !== undefined) {
    summary.usage.totalTokens += totalTokens
    summary.usage.hasValue = true
  } else if (inputTokens !== undefined || outputTokens !== undefined) {
    summary.usage.totalTokens += (inputTokens ?? 0) + (outputTokens ?? 0)
  }
}

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

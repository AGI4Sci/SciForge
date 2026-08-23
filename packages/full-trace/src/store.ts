import {
  constants,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rmdir,
  chmod,
  stat,
  unlink,
  type FileHandle
} from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { createHash, randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import {
  TRACE_EXPORT_FORMAT,
  TRACE_SCHEMA_VERSION,
  assertTraceEventInput,
  createEventId,
  isTraceEvent,
  type TraceClearResult,
  type TraceCorrelation,
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
  type TraceSummaryQuery,
  type TraceRequestSummary,
  type TraceRequestSummaryQuery,
  type TraceRequestSummaryScope
} from './schema.js'
import {
  sanitizeTraceText,
  sanitizeTraceTextChunks,
  sanitizeTraceValue,
  sensitiveTraceValuesFromHeaders,
  type TraceSanitizationOptions
} from './redaction.js'

const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_MAX_SEGMENT_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
const RESPONSE_PREVIEW_BYTES = 2 * 1024
const TRACE_DIRECTORY_NAME = 'full-traces'
const SEGMENT_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:\.(\d{6}))?\.ndjson$/
const RETENTION_MARKER_NAME = '.retention.json'
const MUTATION_LOCK_NAME = '.writer.lock'
const MUTATION_LOCK_OWNER_NAME = 'owner.json'
const MUTATION_LOCK_WAIT_MS = 30_000
const MUTATION_LOCK_RETRY_MS = 25
const INCOMPLETE_LOCK_STALE_MS = 30_000
const MUTATION_LOCK_HEARTBEAT_MS = 2_000
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const MAX_EVENT_ID_LOOKUP = 10_000
const MAX_STORED_MATCHES_PER_EVENT_ID = 2
const MAX_SUMMARY_AGGREGATE_GROUPS = 10_000
const MAX_EXPORT_SORT_ENTRIES = 100_000
const PREVIEW_LENGTH = 240
const PREVIEW_SOURCE_LENGTH = 1_024
const EXPORT_COPY_BUFFER_SIZE = 64 * 1_024
const TRACE_SCAN_BUFFER_SIZE = 64 * 1_024

export type LocalTraceStoreOptions = {
  /** Application user-data directory. Traces are placed in its full-traces child. */
  userDataDirectory?: string
  /** Direct storage location for tests and non-Electron hosts. */
  storageDirectory?: string
  retentionDays?: number
  /** Maximum size of each newly-written segment before rolling to an indexed segment. */
  maxSegmentBytes?: number
  /** Capacity for every recognized trace segment in the store. */
  maxTotalBytes?: number
  now?: () => Date
  /** Known credentials to remove even when an upstream echoes them without a label. */
  sensitiveValues?: readonly string[] | (() => readonly string[])
}

export type TracePruneOptions = {
  force?: boolean
}

type TraceScanResult = {
  total: number
  corruptLines: number
}

type TraceScanVisitor = (event: TraceEvent) => void | Promise<void>

type TraceSegmentSnapshot = {
  file: string
  handle: FileHandle
  size: number
}

type TraceSpoolIndexEntry = {
  timestamp: string
  recordedAt: string
  eventId: string
  offset: number
  byteLength: number
}

type MutableSummary = {
  traceId: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  sources: Set<string>
  model?: string
  modelStartedAt?: string
  startedAt: string
  endedAt: string
  completed: boolean
  failed: boolean
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

type MutableRequestSummary = {
  requestId: string
  parentRequestId?: string
  traceId: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  sources: Set<string>
  model?: string
  protocol?: string
  retry?: number
  startedAt: string
  endedAt: string
  completed: boolean
  failed: boolean
  eventCount: number
  errorCount: number
  preview?: string
  error?: string
  usage?: TraceSummary['usage']
  responseUsage?: TraceSummary['usage']
  usageEventSeen: boolean
  hasModelRequest: boolean
}

/**
 * Append-only, daily-segmented local trace store. Normal capture only appends;
 * rewriting/deletion is limited to explicit clear and retention maintenance.
 */
export class LocalTraceStore {
  readonly directory: string
  readonly retentionDays: number
  readonly maxSegmentBytes: number
  readonly maxTotalBytes: number

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
    this.maxSegmentBytes = positiveIntegerOption(
      options.maxSegmentBytes,
      DEFAULT_MAX_SEGMENT_BYTES,
      'maxSegmentBytes'
    )
    this.maxTotalBytes = positiveIntegerOption(
      options.maxTotalBytes,
      DEFAULT_MAX_TOTAL_BYTES,
      'maxTotalBytes'
    )
    if (this.maxTotalBytes < this.maxSegmentBytes) {
      throw new Error('maxTotalBytes must be greater than or equal to maxSegmentBytes')
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
      const event = compactResponseChunkEvent(this.normalizeEvent(
        input,
        this.sanitizationOptionsForInputs([input])
      ))
      return (await this.appendEvents([event]))[0] ?? event
    })
  }

  async appendMany(inputs: readonly TraceEventInput[]): Promise<TraceEvent[]> {
    await this.initialize()
    if (inputs.length === 0) return []
    return this.enqueue(async () => {
      const sanitization = this.sanitizationOptionsForInputs(inputs)
      const events = compactResponseChunkRuns(
        sanitizeTraceInputChunkRuns(inputs, sanitization)
          .map((input) => ({ event: this.normalizeEvent(input, sanitization), aggregate: !input.eventId }))
      )
      return this.appendEvents(events)
    })
  }

  /** Applies the store's current exact-secret policy to one ordered text stream. */
  sanitizeTextChunks(chunks: readonly string[]): string[] {
    return sanitizeTraceTextChunks(chunks, this.sanitizationOptions())
  }

  async read(query: TraceReadQuery = {}): Promise<TraceReadResult> {
    await this.initialize()
    validateReadQuery(query)
    return this.enqueue(async () => this.withReadSnapshot(
      async (snapshot) => this.readInternal(query, snapshot)
    ))
  }

  async summaries(query: TraceSummaryQuery = {}): Promise<TraceSummary[]> {
    await this.initialize()
    validateReadQuery(query)
    return this.enqueue(async () => this.withReadSnapshot(async (snapshot) => {
      const accumulator = new TraceSummaryAccumulator(MAX_SUMMARY_AGGREGATE_GROUPS)
      await this.scan(query, (event) => accumulator.add(event), snapshot)
      return orderAndLimitSummaries(accumulator.summaries(), query)
    }))
  }

  /** Derives request-level cards from the same durable events as summaries(). */
  async requestSummaries(query: TraceRequestSummaryQuery = {}): Promise<TraceRequestSummary[]> {
    await this.initialize()
    validateReadQuery(query)
    return this.enqueue(async () => this.withReadSnapshot(async (snapshot) => {
      const accumulator = new TraceSummaryAccumulator(MAX_SUMMARY_AGGREGATE_GROUPS)
      await this.scan(query, (event) => accumulator.add(event), snapshot)
      return orderAndLimitSummaries(
        accumulator.requestSummaries(query.scope ?? 'all'),
        query
      )
    }))
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
    const query: TraceReadQuery = {
      traceIds: options.traceIds,
      from: options.from,
      to: options.to
    }
    validateReadQuery(query)
    return this.enqueue(async () => this.withReadSnapshot(async (snapshot) => {
      const exportedAt = this.now().toISOString()
      const traceIds = new Set<string>()
      let eventCount = 0
      await writeExclusiveExport(destination, async (writeEvent) => {
        const scanned = await this.scan(query, async (event) => {
          traceIds.add(event.traceId)
          await writeEvent(event)
        }, snapshot)
        eventCount = scanned.total
        return {
          format: TRACE_EXPORT_FORMAT,
          schemaVersion: TRACE_SCHEMA_VERSION,
          exportedAt,
          eventCount,
          traceCount: traceIds.size
        }
      })
      return {
        destination,
        exportedAt,
        eventCount,
        traceCount: traceIds.size
      }
    }))
  }

  async clear(): Promise<TraceClearResult> {
    await this.initialize()
    return this.enqueue(async () => this.withMutationLock(async () => {
      const segmentFiles = await this.segmentFiles()
      let deletedEvents = 0
      for (const file of segmentFiles) {
        deletedEvents += await countNonEmptyLines(file)
        await unlink(file)
      }
      return { deletedFiles: segmentFiles.length, deletedEvents }
    }))
  }

  async pruneExpired(options: TracePruneOptions = {}): Promise<TraceRetentionResult> {
    await this.initialize()
    return this.enqueue(async () => this.withMutationLock(
      async () => this.pruneExpiredInternal(options.force ?? false)
    ))
  }

  private async initializeOnce(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: DIRECTORY_MODE })
    const info = await lstat(this.directory)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('Trace storage path must be a real directory, not a symbolic link')
    }
    await chmod(this.directory, DIRECTORY_MODE)
    await this.withMutationLock(async () => this.pruneExpiredInternal(false))
  }

  private normalizeEvent<Kind extends TraceEventKind>(
    input: TraceEventInput<Kind>,
    sanitization: TraceSanitizationOptions = this.sanitizationOptions()
  ): TraceEvent {
    assertTraceEventInput(input as TraceEventInput)
    const recordedAt = this.now().toISOString()
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

  private async appendEvents(events: readonly TraceEvent[]): Promise<TraceEvent[]> {
    return this.withMutationLock(async () => {
      const executionEventIds = [...new Set(events
        .filter((event) => event.kind === 'execution_event')
        .map((event) => event.eventId))]
      const known = new Map<string, TraceEvent>()
      if (executionEventIds.length > 0) {
        for (const event of (await this.readInternal({ eventIds: executionEventIds })).events) {
          known.set(event.eventId, event)
        }
      }
      const durable: TraceEvent[] = []
      const resolved: TraceEvent[] = []
      for (const event of events) {
        if (event.kind !== 'execution_event') {
          durable.push(event)
          resolved.push(event)
          continue
        }
        const existing = known.get(event.eventId)
        if (existing) {
          if (!sameLogicalTraceEvent(existing, event)) {
            throw new Error(`Trace eventId collision: ${event.eventId}`)
          }
          resolved.push(existing)
          continue
        }
        known.set(event.eventId, event)
        durable.push(event)
        resolved.push(event)
      }
      await this.appendEventsLocked(durable)
      return resolved
    })
  }

  private async appendEventsLocked(events: readonly TraceEvent[]): Promise<void> {
    const byDate = new Map<string, TraceEvent[]>()
    for (const event of events) {
      const date = event.recordedAt.slice(0, 10)
      const grouped = byDate.get(date) ?? []
      grouped.push(event)
      byDate.set(date, grouped)
    }
    const writes = [...byDate].flatMap(([date, grouped]) => (
      serializeEventBatches(grouped, this.maxSegmentBytes).map((batch) => ({
        date,
        batch,
        byteLength: Buffer.byteLength(batch)
      }))
    ))
    await this.pruneCapacityForIncoming(
      writes.reduce((total, write) => total + write.byteLength, 0)
    )
    for (const { date, batch, byteLength } of writes) {
        const segment = await this.writableSegment(date, byteLength)
        await assertSafeSegmentTarget(segment)
        const handle = await open(
          segment,
          constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | noFollowFlag(),
          FILE_MODE
        )
        try {
          await handle.chmod(FILE_MODE)
          await handle.writeFile(batch, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await syncDirectory(path.dirname(segment))
    }
  }

  private async writableSegment(date: string, incomingBytes: number): Promise<string> {
    const candidates = (await this.segmentFiles())
      .filter((file) => indexedSegment(file) && path.basename(file).startsWith(`${date}.`))
    const latest = candidates.at(-1)
    if (latest && await canAppendToSegment(latest, incomingBytes, this.maxSegmentBytes)) return latest
    const latestIndex = latest
      ? Number(SEGMENT_PATTERN.exec(path.basename(latest))?.[2] ?? 0)
      : 0
    return path.join(this.directory, `${date}.${String(latestIndex + 1).padStart(6, '0')}.ndjson`)
  }

  private async readInternal(
    query: TraceReadQuery,
    snapshot?: readonly TraceSegmentSnapshot[]
  ): Promise<TraceReadResult> {
    const events: TraceEvent[] = []
    const order = query.order ?? 'asc'
    const result = await this.scan(query, (event) => {
      retainOrderedEvent(events, event, order, query.limit)
    }, snapshot)
    events.sort(order === 'desc' ? compareEventsDescending : compareEvents)
    return { events, total: result.total, corruptLines: result.corruptLines }
  }

  private async scan(
    query: TraceReadQuery,
    visit: TraceScanVisitor,
    snapshot?: readonly TraceSegmentSnapshot[]
  ): Promise<TraceScanResult> {
    const eventIds = query.eventIds ? new Set(query.eventIds) : undefined
    const matches = createTraceMatcher(query, eventIds)
    const eventIdMatches = query.eventIds ? new Map<string, number>() : undefined
    let total = 0
    let corruptLines = 0
    for (const segment of snapshot ?? await this.segmentFiles()) {
      corruptLines += await scanSegment(segment, this.sanitizationOptions(), async (event) => {
        if (eventIds?.has(event.eventId) && eventIdMatches) {
          const count = (eventIdMatches.get(event.eventId) ?? 0) + 1
          if (count > MAX_STORED_MATCHES_PER_EVENT_ID) {
            throw new Error(`Trace eventId has too many durable records: ${event.eventId}`)
          }
          eventIdMatches.set(event.eventId, count)
        }
        if (!matches(event)) return
        total += 1
        await visit(event)
      })
    }
    return { total, corruptLines }
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
      const capacity = await this.pruneCapacityInternal()
      return { ran: capacity.deletedFiles > 0, cutoff: cutoff.toISOString(), ...capacity }
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
        const compacted = await compactSegment(
          file,
          this.sanitizationOptions(),
          (event) => Date.parse(event.recordedAt) >= cutoff.getTime()
        )
        deletedEvents += compacted.removedEvents
        if (compacted.deletedFile) deletedFiles += 1
      }
    }
    const capacity = await this.pruneCapacityInternal()
    deletedFiles += capacity.deletedFiles
    deletedEvents += capacity.deletedEvents
    await writeOwnerOnlyJson(path.join(this.directory, RETENTION_MARKER_NAME), { lastRunDate: today })
    return { ran: true, cutoff: cutoff.toISOString(), deletedFiles, deletedEvents }
  }

  private async pruneCapacityInternal(): Promise<TraceClearResult> {
    return this.pruneCapacityForIncoming(0)
  }

  private async pruneCapacityForIncoming(
    incomingBytes: number
  ): Promise<TraceClearResult> {
    if (incomingBytes > this.maxTotalBytes) {
      const error = new Error('Trace event exceeds the managed storage capacity') as NodeJS.ErrnoException
      error.code = 'TRACE_CAPACITY_EXCEEDED'
      throw error
    }
    const entries = await Promise.all((await this.segmentFiles()).map(async (file) => ({
      file,
      bytes: (await stat(file)).size
    })))
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0)
    let deletedFiles = 0
    let deletedEvents = 0
    // All mutation paths share one cross-process lease, so even the current-day
    // segments are closed and safe to rotate while capacity maintenance runs.
    for (const entry of entries) {
      if (total + incomingBytes <= this.maxTotalBytes) break
      // Pre-policy daily files can be many gigabytes. Capacity recovery must
      // not rescan one in full before unlinking it or startup remains blocked
      // on the same oversized history this policy is meant to reclaim.
      if (indexedSegment(entry.file)) {
        deletedEvents += await countNonEmptyLines(entry.file)
      }
      await unlink(entry.file)
      total -= entry.bytes
      deletedFiles += 1
    }
    if (total + incomingBytes > this.maxTotalBytes) {
      const error = new Error('Trace store cannot reserve managed storage capacity') as NodeJS.ErrnoException
      error.code = 'TRACE_CAPACITY_EXCEEDED'
      throw error
    }
    return { deletedFiles, deletedEvents }
  }

  private sanitizationOptions(): TraceSanitizationOptions {
    return { sensitiveValues: this.getSensitiveValues() }
  }

  private sanitizationOptionsForInputs(inputs: readonly TraceEventInput[]): TraceSanitizationOptions {
    const sensitiveValues = new Set(this.getSensitiveValues())
    for (const input of inputs) {
      if (input.kind !== 'model_request') continue
      const headers = asRecord(input.payload)?.headers
      if (!headers) continue
      for (const value of sensitiveTraceValuesFromHeaders(headers as Record<string, unknown>)) {
        sensitiveValues.add(value)
      }
    }
    return { sensitiveValues: [...sensitiveValues] }
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async withMutationLock<Result>(operation: () => Promise<Result>): Promise<Result> {
    const release = await acquireTraceMutationLock(this.directory)
    try {
      return await operation()
    } finally {
      await release()
    }
  }

  private async withReadSnapshot<Result>(
    operation: (snapshot: readonly TraceSegmentSnapshot[]) => Promise<Result>
  ): Promise<Result> {
    const snapshot = await this.withMutationLock(async () => {
      const opened: TraceSegmentSnapshot[] = []
      try {
        for (const file of await this.segmentFiles()) {
          const handle = await open(file, constants.O_RDONLY | noFollowFlag())
          try {
            const info = await handle.stat()
            if (!info.isFile()) throw new Error(`Unsafe trace segment: ${path.basename(file)}`)
            opened.push({ file, handle, size: info.size })
          } catch (error) {
            await handle.close()
            throw error
          }
        }
        return opened
      } catch (error) {
        await Promise.all(opened.map(async ({ handle }) => handle.close().catch(() => undefined)))
        throw error
      }
    })
    try {
      return await operation(snapshot)
    } finally {
      await Promise.all(snapshot.map(async ({ handle }) => handle.close()))
    }
  }
}

type TraceMutationLockOwner = {
  pid: number
  createdAt: string
  heartbeatAt: string
  token: string
}

type TraceFileIdentity = {
  dev: number
  ino: number
}

async function acquireTraceMutationLock(
  directory: string
): Promise<() => Promise<void>> {
  const lockDirectory = path.join(directory, MUTATION_LOCK_NAME)
  const ownerFile = path.join(lockDirectory, MUTATION_LOCK_OWNER_NAME)
  const deadline = Date.now() + MUTATION_LOCK_WAIT_MS

  while (true) {
    let acquiredIdentity: TraceFileIdentity
    try {
      await mkdir(lockDirectory, { mode: DIRECTORY_MODE })
      acquiredIdentity = fileIdentity(await lstat(lockDirectory))
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error
      if (await reclaimStaleTraceMutationLock(lockDirectory)) continue
      if (Date.now() >= deadline) {
        const timeout = new Error('Timed out waiting for the trace mutation lock') as NodeJS.ErrnoException
        timeout.code = 'TRACE_LOCK_TIMEOUT'
        throw timeout
      }
      await delay(MUTATION_LOCK_RETRY_MS)
      continue
    }

    const token = randomUUID()
    const createdAt = new Date().toISOString()
    let ownerHandle: FileHandle | undefined
    try {
      if (!await pathHasIdentity(lockDirectory, acquiredIdentity)) continue
      ownerHandle = await open(
        ownerFile,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
        FILE_MODE
      )
      await writeTraceMutationLockOwner(ownerHandle, {
        pid: process.pid,
        createdAt,
        heartbeatAt: createdAt,
        token
      })
      if (!await pathHasIdentity(lockDirectory, acquiredIdentity)) {
        await ownerHandle.close()
        await unlinkOwnedTraceMutationLockOwner(ownerFile, token)
        continue
      }
    } catch (error) {
      await ownerHandle?.close().catch(() => undefined)
      await removeTraceMutationLockIfOwned(lockDirectory, acquiredIdentity, token)
      throw error
    }

    let heartbeatTask = Promise.resolve()
    let heartbeatFailure: Error | undefined
    const heartbeat = setInterval(() => {
      heartbeatTask = heartbeatTask
        .then(async () => {
          if (heartbeatFailure) return
          const now = new Date()
          await ownerHandle!.utimes(now, now)
        })
        .catch((error: unknown) => {
          heartbeatFailure = error instanceof Error ? error : new Error(String(error))
        })
    }, MUTATION_LOCK_HEARTBEAT_MS)
    heartbeat.unref()
    let released = false
    return async () => {
      if (released) return
      released = true
      clearInterval(heartbeat)
      await heartbeatTask
      await ownerHandle?.close()
      await removeTraceMutationLockIfOwned(lockDirectory, acquiredIdentity, token)
      if (heartbeatFailure) throw heartbeatFailure
    }
  }
}

async function reclaimStaleTraceMutationLock(lockDirectory: string): Promise<boolean> {
  let info
  try {
    info = await lstat(lockDirectory)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return true
    throw error
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('Trace mutation lock path must be a real directory')
  }
  const ownerFile = path.join(lockDirectory, MUTATION_LOCK_OWNER_NAME)
  const owner = await readTraceMutationLockOwner(ownerFile)
  const ownerInfo = owner ? await lstat(ownerFile).catch(() => undefined) : undefined
  // Never reclaim a lease from a live process. A stale heartbeat can mean the
  // owner is paused inside a filesystem operation; reclaiming it would permit
  // the old owner to resume without fencing and create split-brain writers.
  // Waiters time out explicitly instead. Dead-process and incomplete leases
  // remain safely reclaimable.
  if (owner && processExists(owner.pid)) return false
  if (owner && ownerInfo && Date.now() - ownerInfo.mtimeMs < INCOMPLETE_LOCK_STALE_MS) return false
  if (!owner && Date.now() - info.mtimeMs < INCOMPLETE_LOCK_STALE_MS) return false

  const staleDirectory = `${lockDirectory}.stale.${randomUUID()}`
  try {
    await rename(lockDirectory, staleDirectory)
  } catch (error) {
    if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'EEXIST')) return true
    throw error
  }
  await removeTraceMutationLock(staleDirectory)
  return true
}

async function readTraceMutationLockOwner(
  ownerFile: string
): Promise<TraceMutationLockOwner | undefined> {
  try {
    const parsed = JSON.parse(await readFile(ownerFile, 'utf8')) as Partial<TraceMutationLockOwner>
    if (
      typeof parsed.pid === 'number' &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.createdAt === 'string' &&
      Number.isFinite(Date.parse(parsed.createdAt)) &&
      typeof parsed.heartbeatAt === 'string' &&
      Number.isFinite(Date.parse(parsed.heartbeatAt)) &&
      typeof parsed.token === 'string' &&
      parsed.token.length > 0
    ) {
      return {
        pid: parsed.pid,
        createdAt: parsed.createdAt,
        heartbeatAt: parsed.heartbeatAt,
        token: parsed.token
      }
    }
    return undefined
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

async function writeTraceMutationLockOwner(
  handle: FileHandle,
  owner: TraceMutationLockOwner
): Promise<void> {
  const serialized = Buffer.from(`${JSON.stringify(owner)}\n`, 'utf8')
  const { bytesWritten } = await handle.write(serialized, 0, serialized.byteLength, 0)
  if (bytesWritten !== serialized.byteLength) {
    throw new Error('Trace mutation lock owner write was incomplete')
  }
  await handle.truncate(serialized.byteLength)
  await handle.sync()
}

function fileIdentity(info: { dev: number; ino: number }): TraceFileIdentity {
  return { dev: info.dev, ino: info.ino }
}

async function pathHasIdentity(file: string, expected: TraceFileIdentity): Promise<boolean> {
  try {
    const actual = await lstat(file)
    return actual.dev === expected.dev && actual.ino === expected.ino
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

async function unlinkOwnedTraceMutationLockOwner(ownerFile: string, token: string): Promise<void> {
  const owner = await readTraceMutationLockOwner(ownerFile)
  if (owner?.token !== token) return
  try {
    await unlink(ownerFile)
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }
}

async function removeTraceMutationLockIfOwned(
  lockDirectory: string,
  expected: TraceFileIdentity,
  token: string
): Promise<void> {
  if (!await pathHasIdentity(lockDirectory, expected)) return
  const ownerFile = path.join(lockDirectory, MUTATION_LOCK_OWNER_NAME)
  const owner = await readTraceMutationLockOwner(ownerFile)
  if (owner && owner.token !== token) return
  await removeTraceMutationLock(lockDirectory)
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isNodeError(error) && error.code === 'EPERM'
  }
}

async function removeTraceMutationLock(lockDirectory: string): Promise<void> {
  try {
    await unlink(path.join(lockDirectory, MUTATION_LOCK_OWNER_NAME))
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }
  try {
    await rmdir(lockDirectory)
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function sameLogicalTraceEvent(left: TraceEvent, right: TraceEvent): boolean {
  const { recordedAt: _leftRecordedAt, ...leftLogical } = left
  const { recordedAt: _rightRecordedAt, ...rightLogical } = right
  return JSON.stringify(leftLogical) === JSON.stringify(rightLogical)
}

export function deriveRequestSummaries(
  events: readonly TraceEvent[],
  scope: TraceRequestSummaryScope = 'all'
): TraceRequestSummary[] {
  const accumulator = new TraceSummaryAccumulator()
  for (const event of [...events].sort(compareEvents)) accumulator.add(event)
  return accumulator.requestSummaries(scope)
}

export function deriveSummaries(events: readonly TraceEvent[]): TraceSummary[] {
  const accumulator = new TraceSummaryAccumulator()
  for (const event of [...events].sort(compareEvents)) accumulator.add(event)
  return accumulator.summaries()
}

class TraceSummaryAccumulator {
  private readonly requests = new Map<string, MutableRequestSummary>()
  private readonly traces = new Map<string, MutableSummary>()

  constructor(private readonly maxGroups = Number.POSITIVE_INFINITY) {}

  add(event: TraceEvent): void {
    this.addRequestEvent(event)
    this.addTraceEvent(event)
  }

  requestSummaries(scope: TraceRequestSummaryScope): TraceRequestSummary[] {
    const modelRequests = [...this.requests.entries()].filter(([, summary]) => summary.hasModelRequest)
    const modelRequestKeys = new Set(modelRequests.map(([key]) => key))
    const childCounts = new Map<string, number>()
    for (const [, summary] of modelRequests) {
      if (summary.parentRequestId) {
        const parentKey = requestKey(summary.traceId, summary.parentRequestId)
        if (modelRequestKeys.has(parentKey)) {
          childCounts.set(parentKey, (childCounts.get(parentKey) ?? 0) + 1)
        }
      }
    }
    return modelRequests
      .map(([, summary]) => summary)
      .filter((summary) => (
        scope === 'all' ||
        !summary.parentRequestId ||
        !modelRequestKeys.has(requestKey(summary.traceId, summary.parentRequestId))
      ))
      .map<TraceRequestSummary>((summary) => ({
        requestId: summary.requestId,
        ...(summary.parentRequestId ? { parentRequestId: summary.parentRequestId } : {}),
        traceId: summary.traceId,
        ...(summary.runtimeId ? { runtimeId: summary.runtimeId } : {}),
        ...(summary.threadId ? { threadId: summary.threadId } : {}),
        ...(summary.turnId ? { turnId: summary.turnId } : {}),
        sources: [...summary.sources].sort(),
        ...(summary.model ? { model: summary.model } : {}),
        ...(summary.protocol ? { protocol: summary.protocol } : {}),
        ...(summary.retry !== undefined ? { retry: summary.retry } : {}),
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
        durationMs: Math.max(0, Date.parse(summary.endedAt) - Date.parse(summary.startedAt)),
        status: summary.failed ? 'error' : summary.completed ? 'completed' : 'active',
        eventCount: summary.eventCount,
        childRequestCount: childCounts.get(requestKey(summary.traceId, summary.requestId)) ?? 0,
        errorCount: summary.errorCount,
        ...(summary.preview ? { preview: summary.preview } : {}),
        ...(summary.error ? { error: summary.error } : {}),
        ...((summary.usageEventSeen ? summary.usage : summary.responseUsage)
          ? { usage: summary.usageEventSeen ? summary.usage : summary.responseUsage }
          : {})
      }))
  }

  summaries(): TraceSummary[] {
    const requestSummaries = this.requestSummaries('all')
    const requestsByKey = new Map(
      requestSummaries.map((summary) => [requestKey(summary.traceId, summary.requestId), summary])
    )
    const rootRequestsByTrace = new Map<string, TraceRequestSummary[]>()
    for (const request of requestSummaries) {
      if (!isRootRequest(request, requestsByKey)) continue
      const grouped = rootRequestsByTrace.get(request.traceId) ?? []
      grouped.push(request)
      rootRequestsByTrace.set(request.traceId, grouped)
    }
    const unmodeledRequestsByTrace = new Map<string, MutableRequestSummary[]>()
    for (const request of this.requests.values()) {
      if (request.hasModelRequest || request.parentRequestId) continue
      const grouped = unmodeledRequestsByTrace.get(request.traceId) ?? []
      grouped.push(request)
      unmodeledRequestsByTrace.set(request.traceId, grouped)
    }
    return [...this.traces.values()].map((summary) => {
      let completed = summary.completed
      let failed = summary.failed
      let errorCount = summary.errorCount
      let error = summary.error
      let model = summary.model
      let preview = summary.preview
      let modelStartedAt = summary.modelStartedAt
      const requestIds = new Set(summary.requestIds)
      const usage = { ...summary.usage }
      const usageTarget: MutableSummary = { ...summary, usage }

      for (const request of rootRequestsByTrace.get(summary.traceId) ?? []) {
        requestIds.add(request.requestId)
        if (!modelStartedAt || request.startedAt.localeCompare(modelStartedAt) < 0) {
          modelStartedAt = request.startedAt
          model = request.model
          preview = request.preview
        }
        if (request.status === 'completed') completed = true
        if (request.status === 'error') {
          failed = true
          error ??= request.error
        }
        errorCount += request.errorCount
        addUsageValues(usageTarget, request.usage)
      }

      // Request-correlated events without a model_request were historically
      // treated as root events only when they had no parent correlation.
      for (const request of unmodeledRequestsByTrace.get(summary.traceId) ?? []) {
        if (request.completed) completed = true
        if (request.failed) {
          failed = true
          errorCount += request.errorCount
          error ??= request.error
        }
        addUsageValues(
          usageTarget,
          request.usageEventSeen ? request.usage : request.responseUsage
        )
      }

      return {
        traceId: summary.traceId,
        ...(summary.runtimeId ? { runtimeId: summary.runtimeId } : {}),
        ...(summary.threadId ? { threadId: summary.threadId } : {}),
        ...(summary.turnId ? { turnId: summary.turnId } : {}),
        sources: [...summary.sources].sort(),
        ...(model ? { model } : {}),
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
        durationMs: Math.max(0, Date.parse(summary.endedAt) - Date.parse(summary.startedAt)),
        status: errorCount > 0 || failed ? 'error' : completed ? 'completed' : 'active',
        requestCount: requestIds.size,
        eventCount: summary.eventCount,
        agentEventCount: summary.agentEventCount,
        errorCount,
        ...(preview ? { preview } : {}),
        ...(error ? { error } : {}),
        ...(usage.hasValue ? {
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens
          }
        } : {})
      }
    })
  }

  private addRequestEvent(event: TraceEvent): void {
    const requestId = event.requestId
    if (!requestId) return
    const payload = asRecord(event.payload)
    const key = requestKey(event.traceId, requestId)
    let summary = this.requests.get(key)
    if (!summary) {
      this.assertGroupCapacity()
      summary = {
        requestId,
        parentRequestId: event.parentRequestId,
        traceId: event.traceId,
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        turnId: event.turnId,
        sources: new Set(),
        startedAt: event.timestamp,
        endedAt: event.timestamp,
        completed: false,
        failed: false,
        eventCount: 0,
        errorCount: 0,
        usageEventSeen: false,
        hasModelRequest: false
      }
      this.requests.set(key, summary)
    }
    summary.parentRequestId ??= event.parentRequestId
    summary.runtimeId ??= event.runtimeId
    summary.threadId ??= event.threadId
    summary.turnId ??= event.turnId
    summary.sources.add(event.source)
    summary.startedAt = earlier(summary.startedAt, event.timestamp)
    summary.endedAt = later(summary.endedAt, event.timestamp)
    summary.eventCount += 1

    if (event.kind === 'model_request') {
      summary.hasModelRequest = true
      summary.model ??= stringValue(payload?.model) ?? stringValue(asRecord(payload?.body)?.model)
      summary.protocol ??= stringValue(payload?.protocol)
      summary.retry ??= numericValue(payload?.retry)
      summary.preview ??= previewValue(payload?.body)
      return
    }
    if (event.kind === 'model_response_end') {
      const status = numericValue(payload?.status)
      if (status === undefined || (status >= 200 && status < 300)) {
        summary.completed = true
      } else {
        summary.failed = true
      }
      summary.responseUsage = mergeUsage(
        summary.responseUsage,
        usageFromPayload(payload?.usage)
      )
      return
    }
    if (event.kind === 'error') {
      summary.errorCount += 1
      summary.failed = true
      summary.error = stringValue(payload?.message) ?? summary.error ?? 'Trace error'
      return
    }
    if (event.kind === 'usage') {
      const usage = usageFromPayload(payload)
      if (usage) {
        summary.usageEventSeen = true
        summary.usage = mergeUsage(summary.usage, usage)
      }
    }
  }

  private addTraceEvent(event: TraceEvent): void {
    let summary = this.traces.get(event.traceId)
    if (!summary) {
      this.assertGroupCapacity()
      summary = {
        traceId: event.traceId,
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        turnId: event.turnId,
        sources: new Set(),
        startedAt: event.timestamp,
        endedAt: event.timestamp,
        completed: false,
        failed: false,
        requestIds: new Set(),
        eventCount: 0,
        agentEventCount: 0,
        errorCount: 0,
        modelStartedAt: undefined,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, hasValue: false }
      }
      this.traces.set(event.traceId, summary)
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
      if (!event.requestId && !event.parentRequestId) {
        summary.requestIds.add(event.requestId ?? event.eventId)
        if (!summary.modelStartedAt || event.timestamp.localeCompare(summary.modelStartedAt) < 0) {
          summary.modelStartedAt = event.timestamp
          summary.model = stringValue(payload?.model) ?? stringValue(asRecord(payload?.body)?.model)
          summary.preview = previewValue(payload?.body)
        }
      }
    } else if (event.kind === 'model_response_end') {
      if (!event.requestId && !event.parentRequestId) {
        const status = numericValue(payload?.status)
        if (status === undefined || (status >= 200 && status < 300)) summary.completed = true
        else summary.failed = true
      }
    } else if (event.kind === 'agent_event') {
      summary.agentEventCount += 1
      const agentPayload = asRecord(payload?.event)
      const eventKind = stringValue(payload?.eventKind)?.toLowerCase()
      if (eventKind === 'lifecycle') {
        applyLifecycleState(summary, agentPayload)
      } else if (eventKind === 'error') {
        summary.failed = true
        summary.error ??= stringValue(agentPayload?.message) ?? 'Agent error'
      }
    } else if (event.kind === 'execution_event') {
      const phase = stringValue(payload?.phase)?.toLowerCase()
      const execution = asRecord(payload?.event)
      summary.preview ??= [
        stringValue(asRecord(payload?.producer)?.moduleId),
        stringValue(payload?.runId)
      ].filter(Boolean).join(' · ') || undefined
      if (phase === 'run_completed') summary.completed = true
      if (phase === 'run_failed') {
        summary.failed = true
        summary.error ??= stringValue(asRecord(execution?.payload)?.message) ?? 'Domain execution failed'
      }
    } else if (event.kind === 'error') {
      if (!event.requestId && !event.parentRequestId) {
        summary.errorCount += 1
        summary.failed = true
        summary.error = stringValue(payload?.message) ?? summary.error ?? 'Trace error'
      }
    } else if (event.kind === 'usage') {
      // Request-scoped usage is folded in once below. Uncorrelated usage still
      // belongs to the trajectory and is retained here.
      if (!event.requestId && !event.parentRequestId) {
        addUsage(summary, payload)
      }
    } else if (event.kind === 'lifecycle') {
      const phase = stringValue(payload?.phase)?.toLowerCase()
      applyLifecyclePhase(summary, phase)
    }
  }

  private assertGroupCapacity(): void {
    if (this.requests.size + this.traces.size < this.maxGroups) return
    const error = new Error(
      'Trace summary query exceeds the safe aggregation limit; narrow it by time, thread, turn, or trace id.'
    ) as NodeJS.ErrnoException
    error.code = 'TRACE_SUMMARY_CAPACITY_EXCEEDED'
    throw error
  }
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

type CompactableEvent = { event: TraceEvent; aggregate: boolean }

function sanitizeTraceInputChunkRuns(
  inputs: readonly TraceEventInput[],
  sanitization: TraceSanitizationOptions
): TraceEventInput[] {
  const sanitized = [...inputs]
  for (let index = 0; index < inputs.length;) {
    const current = inputs[index]
    if (!current || current.kind !== 'model_response_chunk') {
      index += 1
      continue
    }
    const run: TraceEventInput<'model_response_chunk'>[] = [
      current as TraceEventInput<'model_response_chunk'>
    ]
    let cursor = index + 1
    while (cursor < inputs.length) {
      const candidate = inputs[cursor]
      if (
        !candidate ||
        candidate.kind !== 'model_response_chunk' ||
        responseStreamKey(candidate) !== responseStreamKey(current)
      ) break
      run.push(candidate as TraceEventInput<'model_response_chunk'>)
      cursor += 1
    }
    const bodies = run.map((event) => event.payload.body)
    if (bodies.every((body): body is string => typeof body === 'string')) {
      const sanitizedBodies = sanitizeTraceTextChunks(bodies, sanitization)
      run.forEach((event, offset) => {
        sanitized[index + offset] = {
          ...event,
          payload: { ...event.payload, body: sanitizedBodies[offset] ?? '' }
        }
      })
    } else if (bodies.every((body): body is Uint8Array => body instanceof Uint8Array)) {
      const complete = Buffer.concat(bodies.map((body) => Buffer.from(body)))
      const sanitizedComplete = sanitizeTraceValue(complete, sanitization)
      if (isRedactedBinaryValue(sanitizedComplete)) {
        run.forEach((event, offset) => {
          sanitized[index + offset] = {
            ...event,
            payload: { ...event.payload, body: sanitizedComplete }
          }
        })
      }
    }
    index = cursor
  }
  return sanitized
}

function compactResponseChunkRuns(entries: readonly CompactableEvent[]): TraceEvent[] {
  const compacted: TraceEvent[] = []
  for (let index = 0; index < entries.length;) {
    const current = entries[index]
    if (!current || current.event.kind !== 'model_response_chunk' || !current.aggregate) {
      if (current) compacted.push(compactResponseChunkEvent(current.event))
      index += 1
      continue
    }
    const run: TraceEvent[] = [current.event]
    let cursor = index + 1
    while (cursor < entries.length) {
      const candidate = entries[cursor]
      if (
        !candidate ||
        !candidate.aggregate ||
        candidate.event.kind !== 'model_response_chunk' ||
        responseStreamKey(candidate.event) !== responseStreamKey(current.event)
      ) break
      run.push(candidate.event)
      cursor += 1
    }
    compacted.push(compactResponseChunkEvent(run[0] as TraceEvent, run))
    index = cursor
  }
  return compacted
}

function compactResponseChunkEvent(event: TraceEvent, run: readonly TraceEvent[] = [event]): TraceEvent {
  if (event.kind !== 'model_response_chunk') return event
  const digest = createHash('sha256')
  const previewParts: Buffer[] = []
  let previewBytes = 0
  let bodyBytes = 0
  let sourceBytes = 0
  for (const chunk of run) {
    const payload = asRecord(chunk.payload)
    const serialized = traceChunkBody(payload?.body)
    const bytes = Buffer.from(serialized, 'utf8')
    digest.update(bytes)
    bodyBytes += bytes.byteLength
    const declaredBytes = numericValue(payload?.byteLength)
    sourceBytes += declaredBytes !== undefined && declaredBytes >= 0 ? declaredBytes : bytes.byteLength
    if (previewBytes < RESPONSE_PREVIEW_BYTES) {
      const part = bytes.subarray(0, RESPONSE_PREVIEW_BYTES - previewBytes)
      previewParts.push(part)
      previewBytes += part.byteLength
    }
  }
  const firstPayload = asRecord(event.payload) ?? {}
  const { body: _body, byteLength: _byteLength, index: firstIndex, ...metadata } = firstPayload
  const preview = Buffer.concat(previewParts).toString('utf8')
  return {
    ...event,
    payload: {
      ...metadata,
      index: numericValue(firstIndex) ?? 0,
      body: preview,
      capture: {
        mode: 'bounded',
        chunkCount: run.length,
        sourceByteLength: sourceBytes,
        capturedBodyByteLength: bodyBytes,
        previewByteLength: Buffer.byteLength(preview),
        truncated: bodyBytes > RESPONSE_PREVIEW_BYTES,
        sha256: digest.digest('hex'),
        ...(run.length > 1 ? {
          firstTimestamp: run[0]?.timestamp ?? event.timestamp,
          lastTimestamp: run.at(-1)?.timestamp ?? event.timestamp
        } : {})
      }
    }
  }
}

function traceChunkBody(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  return JSON.stringify(value)
}

function responseStreamKey(event: TraceCorrelation & { source: string }): string {
  return JSON.stringify([
    event.traceId,
    event.source,
    event.runtimeId,
    event.threadId,
    event.turnId,
    event.requestId,
    event.parentRequestId
  ])
}

function isRedactedBinaryValue(value: unknown): boolean {
  const record = asRecord(value)
  return record?.encoding === 'base64' && record.data === '[REDACTED]'
}

async function scanSegment(
  segment: string | TraceSegmentSnapshot,
  sanitization: TraceSanitizationOptions,
  visit: TraceScanVisitor
): Promise<number> {
  if (typeof segment !== 'string' && segment.size === 0) return 0
  let ownedHandle: FileHandle | undefined
  let handle: FileHandle
  if (typeof segment === 'string') {
    ownedHandle = await open(segment, constants.O_RDONLY | noFollowFlag())
    handle = ownedHandle
  } else {
    handle = segment.handle
  }
  try {
    const size = typeof segment === 'string' ? (await handle.stat()).size : segment.size
    return await scanSegmentHandle(handle, size, sanitization, visit)
  } finally {
    await ownedHandle?.close()
  }
}

async function scanSegmentHandle(
  handle: FileHandle,
  size: number,
  sanitization: TraceSanitizationOptions,
  visit: TraceScanVisitor
): Promise<number> {
  const buffer = Buffer.allocUnsafe(TRACE_SCAN_BUFFER_SIZE)
  const decoder = new StringDecoder('utf8')
  let position = 0
  let pending = ''
  let corruptLines = 0
  const consumeLine = async (source: string): Promise<void> => {
    const line = source.endsWith('\r') ? source.slice(0, -1) : source
    if (!line.trim()) return
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      corruptLines += 1
      return
    }
    if (!isTraceEvent(value)) {
      corruptLines += 1
      return
    }
    await visit(sanitizeStoredEvent(value, sanitization))
  }

  while (position < size) {
    const requested = Math.min(buffer.byteLength, size - position)
    const { bytesRead } = await handle.read(buffer, 0, requested, position)
    if (bytesRead === 0) break
    position += bytesRead
    pending += decoder.write(buffer.subarray(0, bytesRead))
    let newline = pending.indexOf('\n')
    while (newline >= 0) {
      await consumeLine(pending.slice(0, newline))
      pending = pending.slice(newline + 1)
      newline = pending.indexOf('\n')
    }
  }
  pending += decoder.end()
  if (pending) await consumeLine(pending)
  return corruptLines
}

async function compactSegment(
  file: string,
  sanitization: TraceSanitizationOptions,
  retain: (event: TraceEvent) => boolean
): Promise<{ removedEvents: number; deletedFile: boolean }> {
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
    FILE_MODE
  )
  let validEvents = 0
  let retainedEvents = 0
  let corruptLines = 0
  try {
    try {
      await handle.chmod(FILE_MODE)
      corruptLines = await scanSegment(file, sanitization, async (event) => {
        validEvents += 1
        if (!retain(event)) return
        retainedEvents += 1
        await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8')
      })
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }

  const removedEvents = validEvents - retainedEvents + corruptLines
  try {
    if (removedEvents === 0) return { removedEvents: 0, deletedFile: false }
    if (retainedEvents === 0) {
      await unlink(file)
      return { removedEvents, deletedFile: true }
    }
    await rename(temporary, file)
    await chmod(file, FILE_MODE)
    await syncDirectory(path.dirname(file))
    return { removedEvents, deletedFile: false }
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

async function writeExclusiveExport(
  destination: string,
  produce: (writeEvent: TraceScanVisitor) => Promise<TraceExportManifest>
): Promise<void> {
  const parent = path.dirname(destination)
  await mkdir(parent, { recursive: true })
  const nonce = randomUUID()
  const spool = path.join(parent, `.${path.basename(destination)}.${nonce}.events.tmp`)
  const temporary = path.join(parent, `.${path.basename(destination)}.${nonce}.tmp`)
  const spoolHandle = await open(
    spool,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
    FILE_MODE
  )
  let manifest: TraceExportManifest
  const index: TraceSpoolIndexEntry[] = []
  let spoolOffset = 0
  try {
    try {
      await spoolHandle.chmod(FILE_MODE)
      manifest = await produce(async (event) => {
        if (index.length >= MAX_EXPORT_SORT_ENTRIES) {
          const error = new Error(
            'Trace export exceeds the safe in-memory sort limit; export fewer trace ids.'
          ) as NodeJS.ErrnoException
          error.code = 'TRACE_EXPORT_CAPACITY_EXCEEDED'
          throw error
        }
        const serialized = `${JSON.stringify(event)}\n`
        const byteLength = Buffer.byteLength(serialized)
        index.push({
          timestamp: event.timestamp,
          recordedAt: event.recordedAt,
          eventId: event.eventId,
          offset: spoolOffset,
          byteLength
        })
        await spoolHandle.writeFile(serialized, 'utf8')
        spoolOffset += byteLength
      })
      await spoolHandle.sync()
    } finally {
      await spoolHandle.close()
    }
  } catch (error) {
    await unlink(spool).catch(() => undefined)
    throw error
  }

  try {
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
      FILE_MODE
    )
    try {
      await handle.chmod(FILE_MODE)
      await handle.writeFile(`${JSON.stringify({ recordType: 'manifest', ...manifest })}\n`, 'utf8')
      index.sort(compareSpoolIndexEntries)
      const spoolReadHandle = await open(spool, constants.O_RDONLY | noFollowFlag())
      try {
        const buffer = Buffer.allocUnsafe(EXPORT_COPY_BUFFER_SIZE)
        for (const entry of index) {
          await copySpoolRange(spoolReadHandle, handle, entry, buffer)
        }
      } finally {
        await spoolReadHandle.close()
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
    await copyFile(temporary, destination, constants.COPYFILE_EXCL)
    await chmod(destination, FILE_MODE)
  } finally {
    await unlink(temporary).catch(() => undefined)
    await unlink(spool).catch(() => undefined)
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
    await syncDirectory(path.dirname(file))
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
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

async function canAppendToSegment(
  file: string,
  incomingBytes: number,
  maxSegmentBytes: number
): Promise<boolean> {
  try {
    const info = await lstat(file)
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Unsafe trace segment target')
    return info.size + incomingBytes <= maxSegmentBytes
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return true
    throw error
  }
}

function indexedSegment(file: string): boolean {
  return SEGMENT_PATTERN.exec(path.basename(file))?.[2] !== undefined
}

function positiveIntegerOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return resolved
}

function serializeEventBatches(events: readonly TraceEvent[], maxBytes: number): string[] {
  const batches: string[] = []
  let lines: string[] = []
  let bytes = 0
  for (const event of events) {
    const line = `${JSON.stringify(event)}\n`
    const lineBytes = Buffer.byteLength(line)
    if (lineBytes > maxBytes) {
      const error = new Error('Trace event exceeds the maximum segment size') as NodeJS.ErrnoException
      error.code = 'TRACE_SEGMENT_EVENT_TOO_LARGE'
      throw error
    }
    if (lines.length > 0 && bytes + lineBytes > maxBytes) {
      batches.push(lines.join(''))
      lines = []
      bytes = 0
    }
    lines.push(line)
    bytes += lineBytes
  }
  if (lines.length > 0) batches.push(lines.join(''))
  return batches
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
}

function validateReadQuery(query: TraceReadQuery): void {
  if (query.limit !== undefined) validateLimit(query.limit)
  if (query.eventIds !== undefined) {
    if (
      query.eventIds.length > MAX_EVENT_ID_LOOKUP ||
      new Set(query.eventIds).size !== query.eventIds.length ||
      query.eventIds.some((eventId) => (
        typeof eventId !== 'string' || !eventId.trim() || eventId.length > 512
      ))
    ) {
      throw new Error(
        `eventIds must contain at most ${MAX_EVENT_ID_LOOKUP} unique bounded identifiers`
      )
    }
  }
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

function createTraceMatcher(
  query: TraceReadQuery,
  eventIds: ReadonlySet<string> | undefined
): (event: TraceEvent) => boolean {
  const traceIds = query.traceIds ? new Set(query.traceIds) : undefined
  const kinds = query.kinds ? new Set(query.kinds) : undefined
  const from = query.from ? Date.parse(query.from) : undefined
  const to = query.to ? Date.parse(query.to) : undefined
  return (event) => {
    const timestamp = Date.parse(event.timestamp)
    return (!eventIds || eventIds.has(event.eventId)) &&
      (!traceIds || traceIds.has(event.traceId)) &&
      (!query.runtimeId || event.runtimeId === query.runtimeId) &&
      (!query.threadId || event.threadId === query.threadId) &&
      (!query.turnId || event.turnId === query.turnId) &&
      (!query.requestId || event.requestId === query.requestId) &&
      (!query.parentRequestId || event.parentRequestId === query.parentRequestId) &&
      (!kinds || kinds.has(event.kind)) &&
      (from === undefined || timestamp >= from) &&
      (to === undefined || timestamp <= to)
  }
}

function retainOrderedEvent(
  retained: TraceEvent[],
  event: TraceEvent,
  order: 'asc' | 'desc',
  limit: number | undefined
): void {
  if (limit === undefined) {
    retained.push(event)
    return
  }
  const compare = order === 'desc' ? compareEventsDescending : compareEvents
  if (retained.length < limit) {
    retained.push(event)
    retained.sort(compare)
    return
  }
  const last = retained[retained.length - 1]
  if (last && compare(event, last) < 0) {
    retained[retained.length - 1] = event
    retained.sort(compare)
  }
}

function orderAndLimitSummaries<Summary extends { startedAt: string }>(
  summaries: Summary[],
  query: { order?: 'asc' | 'desc'; limit?: number }
): Summary[] {
  const order = query.order ?? 'desc'
  summaries.sort((left, right) => (
    order === 'asc'
      ? left.startedAt.localeCompare(right.startedAt)
      : right.startedAt.localeCompare(left.startedAt)
  ))
  return query.limit === undefined ? summaries : summaries.slice(0, validateLimit(query.limit))
}

function compareEvents(left: TraceEvent, right: TraceEvent): number {
  return left.timestamp.localeCompare(right.timestamp) ||
    left.recordedAt.localeCompare(right.recordedAt) ||
    left.eventId.localeCompare(right.eventId)
}

function compareEventsDescending(left: TraceEvent, right: TraceEvent): number {
  return compareEvents(right, left)
}

function compareSpoolIndexEntries(left: TraceSpoolIndexEntry, right: TraceSpoolIndexEntry): number {
  return left.timestamp.localeCompare(right.timestamp) ||
    left.recordedAt.localeCompare(right.recordedAt) ||
    left.eventId.localeCompare(right.eventId)
}

async function copySpoolRange(
  source: FileHandle,
  destination: FileHandle,
  entry: TraceSpoolIndexEntry,
  buffer: Buffer
): Promise<void> {
  let position = entry.offset
  let remaining = entry.byteLength
  while (remaining > 0) {
    const length = Math.min(buffer.byteLength, remaining)
    const { bytesRead } = await source.read(buffer, 0, length, position)
    if (bytesRead === 0) throw new Error('Unexpected end of trace export spool')
    await destination.writeFile(buffer.subarray(0, bytesRead))
    position += bytesRead
    remaining -= bytesRead
  }
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

function requestKey(traceId: string, requestId: string): string {
  return `${traceId.length}:${traceId}${requestId.length}:${requestId}`
}

function isRootRequest(
  summary: Pick<TraceRequestSummary, 'traceId' | 'parentRequestId'>,
  requestsByKey: ReadonlyMap<string, TraceRequestSummary>
): boolean {
  return !summary.parentRequestId || !requestsByKey.has(requestKey(summary.traceId, summary.parentRequestId))
}

function previewValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return compactPreview(value, false)
  const serialized = jsonPrefix(value, PREVIEW_SOURCE_LENGTH)
  return compactPreview(serialized.text, serialized.truncated)
}

function compactPreview(text: string, sourceTruncated: boolean): string | undefined {
  let compact = ''
  let pendingSpace = false
  let truncated = sourceTruncated
  for (const character of text) {
    if (/\s/.test(character)) {
      pendingSpace = compact.length > 0
      continue
    }
    if (pendingSpace) compact += ' '
    compact += character
    pendingSpace = false
    if (compact.length > PREVIEW_LENGTH) {
      truncated = true
      break
    }
  }
  if (!compact) return undefined
  return truncated || compact.length > PREVIEW_LENGTH
    ? `${compact.slice(0, PREVIEW_LENGTH - 3)}...`
    : compact
}

function jsonPrefix(value: unknown, limit: number): { text: string; truncated: boolean } {
  const chunks: string[] = []
  let length = 0
  let truncated = false
  const append = (text: string): boolean => {
    if (length >= limit) {
      truncated = true
      return false
    }
    const remaining = limit - length
    chunks.push(text.slice(0, remaining))
    length += Math.min(text.length, remaining)
    if (text.length > remaining) truncated = true
    return !truncated
  }
  const appendString = (text: string): void => {
    if (!append('"')) return
    for (const character of text) {
      const encoded = JSON.stringify(character).slice(1, -1)
      if (!append(encoded)) return
    }
    append('"')
  }
  const appendValue = (current: unknown): void => {
    if (truncated) return
    if (current === null) {
      append('null')
      return
    }
    if (typeof current === 'string') {
      appendString(current)
      return
    }
    if (typeof current === 'number' || typeof current === 'boolean') {
      append(JSON.stringify(current))
      return
    }
    if (Array.isArray(current)) {
      if (!append('[')) return
      for (let index = 0; index < current.length; index += 1) {
        if (index > 0 && !append(',')) return
        appendValue(current[index])
        if (truncated) return
      }
      append(']')
      return
    }
    const record = asRecord(current)
    if (record) {
      if (!append('{')) return
      let index = 0
      for (const key in record) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) continue
        if (index > 0 && !append(',')) return
        appendString(key)
        if (!append(':')) return
        appendValue(record[key])
        if (truncated) return
        index += 1
      }
      append('}')
      return
    }
    append('null')
  }
  appendValue(value)
  return { text: chunks.join(''), truncated }
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

function addUsageValues(summary: MutableSummary, usage: TraceSummary['usage']): void {
  if (!usage) return
  const inputTokens = numericValue(usage.inputTokens)
  const outputTokens = numericValue(usage.outputTokens)
  const totalTokens = numericValue(usage.totalTokens)
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

function usageFromPayload(value: unknown): TraceSummary['usage'] | undefined {
  const payload = asRecord(value)
  if (!payload) return undefined
  const inputTokens = numericValue(payload.inputTokens ?? payload.input_tokens)
  const outputTokens = numericValue(payload.outputTokens ?? payload.output_tokens)
  const totalTokens = numericValue(payload.totalTokens ?? payload.total_tokens)
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined
      ? { totalTokens }
      : { totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0) })
  }
}

function mergeUsage(
  left: TraceSummary['usage'],
  right: TraceSummary['usage']
): TraceSummary['usage'] | undefined {
  if (!left) return right ? { ...right } : undefined
  if (!right) return { ...left }
  return {
    ...((left.inputTokens !== undefined || right.inputTokens !== undefined)
      ? { inputTokens: (left.inputTokens ?? 0) + (right.inputTokens ?? 0) }
      : {}),
    ...((left.outputTokens !== undefined || right.outputTokens !== undefined)
      ? { outputTokens: (left.outputTokens ?? 0) + (right.outputTokens ?? 0) }
      : {}),
    ...((left.totalTokens !== undefined || right.totalTokens !== undefined)
      ? { totalTokens: (left.totalTokens ?? 0) + (right.totalTokens ?? 0) }
      : {})
  }
}

function applyLifecycleState(summary: MutableSummary, event: Record<string, unknown> | undefined): void {
  if (!event) return
  const phase = stringValue(event.phase) ?? stringValue(event.state)
  applyLifecyclePhase(summary, phase?.toLowerCase())
  const message = stringValue(event.message)
  if (message && summary.failed) summary.error ??= message
}

function applyLifecyclePhase(summary: MutableSummary, phase: string | undefined): void {
  if (!phase) return
  if (/^(completed|complete|ended|finished|stopped|cancelled|canceled|success|succeeded)$/.test(phase)) {
    summary.completed = true
    return
  }
  if (/^(error|failed|failure|aborted)$/.test(phase)) {
    summary.failed = true
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

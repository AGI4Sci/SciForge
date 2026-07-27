import { createHash, randomUUID } from 'node:crypto'

export const TRACE_SCHEMA_VERSION = 'sciforge.trace.v1' as const
export const TRACE_EXPORT_FORMAT = 'sciforge.full-trace.jsonl.v1' as const
export const TRACE_CORRELATION_HEADERS = {
  traceId: 'x-sciforge-trace-id',
  runtimeId: 'x-sciforge-runtime-id',
  threadId: 'x-sciforge-thread-id',
  turnId: 'x-sciforge-turn-id',
  requestId: 'x-sciforge-request-id',
  parentRequestId: 'x-sciforge-parent-request-id'
} as const

export type TraceEventKind =
  | 'model_request'
  | 'model_response_headers'
  | 'model_response_chunk'
  | 'model_response_end'
  | 'agent_event'
  | 'usage'
  | 'error'
  | 'lifecycle'

export type AgentTraceEventKind =
  | 'lifecycle'
  | 'assistant'
  | 'reasoning'
  | 'tool'
  | 'approval'
  | 'usage'
  | 'error'

export type TraceJsonPrimitive = string | number | boolean | null
export type TraceJsonValue =
  | TraceJsonPrimitive
  | TraceJsonValue[]
  | { [key: string]: TraceJsonValue }

export type TraceUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
  [key: string]: unknown
}

export type ModelRequestTracePayload = {
  model?: string
  protocol?: string
  method?: string
  path?: string
  headers?: unknown
  body?: unknown
  retry?: number
  [key: string]: unknown
}

export type ModelResponseHeadersTracePayload = {
  status: number
  headers?: unknown
  [key: string]: unknown
}

export type ModelResponseChunkTracePayload = {
  index: number
  body: unknown
  [key: string]: unknown
}

export type ModelResponseEndTracePayload = {
  status?: number
  durationMs?: number
  retryCount?: number
  stopReason?: string
  usage?: TraceUsage
  [key: string]: unknown
}

export type AgentTracePayload = {
  eventKind: AgentTraceEventKind
  event: unknown
  [key: string]: unknown
}

export type ErrorTracePayload = {
  message: string
  name?: string
  code?: string
  stage?: string
  retryable?: boolean
  [key: string]: unknown
}

export type LifecycleTracePayload = {
  phase: string
  detail?: unknown
  [key: string]: unknown
}

export type TracePayloadByKind = {
  model_request: ModelRequestTracePayload
  model_response_headers: ModelResponseHeadersTracePayload
  model_response_chunk: ModelResponseChunkTracePayload
  model_response_end: ModelResponseEndTracePayload
  agent_event: AgentTracePayload
  usage: TraceUsage
  error: ErrorTracePayload
  lifecycle: LifecycleTracePayload
}

export type TraceCorrelation = {
  traceId: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  requestId?: string
  parentRequestId?: string
}

export type TraceEventInput<Kind extends TraceEventKind = TraceEventKind> = TraceCorrelation & {
  schemaVersion?: typeof TRACE_SCHEMA_VERSION
  eventId?: string
  source: string
  kind: Kind
  timestamp?: string
  payload: TracePayloadByKind[Kind]
}

export type TraceEvent = TraceCorrelation & {
  schemaVersion: typeof TRACE_SCHEMA_VERSION
  eventId: string
  source: string
  kind: TraceEventKind
  timestamp: string
  recordedAt: string
  payload: TraceJsonValue
}

export type TraceReadQuery = {
  traceIds?: readonly string[]
  runtimeId?: string
  threadId?: string
  turnId?: string
  requestId?: string
  parentRequestId?: string
  kinds?: readonly TraceEventKind[]
  from?: string
  to?: string
  order?: 'asc' | 'desc'
  limit?: number
}

export type TraceReadResult = {
  events: TraceEvent[]
  total: number
  corruptLines: number
}

export type TraceSummaryStatus = 'active' | 'completed' | 'error'

export type TraceSummaryUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export type TraceSummary = {
  traceId: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  sources: string[]
  model?: string
  startedAt: string
  endedAt: string
  durationMs: number
  status: TraceSummaryStatus
  requestCount: number
  eventCount: number
  agentEventCount: number
  errorCount: number
  preview?: string
  error?: string
  usage?: TraceSummaryUsage
}

export type TraceSummaryQuery = Omit<TraceReadQuery, 'kinds' | 'requestId'>

/** A single model request or a nested upstream attempt within a trace. */
export type TraceRequestSummary = {
  requestId: string
  parentRequestId?: string
  traceId: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  sources: string[]
  model?: string
  protocol?: string
  retry?: number
  startedAt: string
  endedAt: string
  durationMs: number
  status: TraceSummaryStatus
  eventCount: number
  childRequestCount: number
  errorCount: number
  preview?: string
  error?: string
  usage?: TraceSummaryUsage
}

export type TraceRequestSummaryScope = 'roots' | 'all'

export type TraceRequestSummaryQuery = Omit<TraceReadQuery, 'kinds' | 'requestId' | 'parentRequestId'> & {
  scope?: TraceRequestSummaryScope
}

export type TraceExportOptions = {
  destination: string
  traceIds?: readonly string[]
  from?: string
  to?: string
}

export type TraceExportResult = {
  destination: string
  exportedAt: string
  eventCount: number
  traceCount: number
}

export type TraceClearResult = {
  deletedFiles: number
  deletedEvents: number
}

export type TraceRetentionResult = TraceClearResult & {
  ran: boolean
  cutoff: string
}

export type TraceExportManifest = {
  format: typeof TRACE_EXPORT_FORMAT
  schemaVersion: typeof TRACE_SCHEMA_VERSION
  exportedAt: string
  eventCount: number
  traceCount: number
}

export function createTraceId(): string {
  return `trace_${randomUUID().replaceAll('-', '')}`
}

export function createRequestId(): string {
  return `request_${randomUUID().replaceAll('-', '')}`
}

export function createEventId(): string {
  return `event_${randomUUID().replaceAll('-', '')}`
}

export function traceCorrelationHeaders(correlation: TraceCorrelation): Record<string, string> {
  return Object.fromEntries(
    (Object.entries(TRACE_CORRELATION_HEADERS) as Array<
      [keyof TraceCorrelation, typeof TRACE_CORRELATION_HEADERS[keyof TraceCorrelation]]
    >).flatMap(([key, header]) => {
      const value = correlation[key]
      return value ? [[header, value]] : []
    })
  )
}

export function traceCorrelationFromHeaders(
  headers: { get(name: string): string | null } | Record<string, string | string[] | undefined>
): Partial<TraceCorrelation> {
  const result: Partial<TraceCorrelation> = {}
  for (const [key, header] of Object.entries(TRACE_CORRELATION_HEADERS) as Array<
    [keyof TraceCorrelation, string]
  >) {
    let raw: string | string[] | null | undefined
    if (typeof headers.get === 'function') {
      raw = headers.get(header)
    } else {
      const headerRecord = headers as Record<string, string | string[] | undefined>
      raw = headerRecord[header] ?? headerRecord[header.toLowerCase()]
    }
    const value = Array.isArray(raw) ? raw[0] : raw
    if (value?.trim()) result[key] = value
  }
  return result
}

/**
 * Derives the shared Agent-turn trace identifier used by every producer when
 * no trace identifier has already been propagated with the request.
 */
export function deriveTraceId(input: {
  runtimeId: string
  threadId: string
  turnId?: string
}): string {
  assertNonEmpty('runtimeId', input.runtimeId)
  assertNonEmpty('threadId', input.threadId)
  if (input.turnId !== undefined) assertNonEmpty('turnId', input.turnId)
  const canonical = [input.runtimeId, input.threadId, input.turnId ?? '']
    .map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`)
    .join('|')
  return `trace_${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`
}

export function isTraceEventKind(value: unknown): value is TraceEventKind {
  return value === 'model_request' ||
    value === 'model_response_headers' ||
    value === 'model_response_chunk' ||
    value === 'model_response_end' ||
    value === 'agent_event' ||
    value === 'usage' ||
    value === 'error' ||
    value === 'lifecycle'
}

export function isTraceEvent(value: unknown): value is TraceEvent {
  if (!isRecord(value)) return false
  return value.schemaVersion === TRACE_SCHEMA_VERSION &&
    typeof value.eventId === 'string' && value.eventId.length > 0 &&
    typeof value.traceId === 'string' && value.traceId.length > 0 &&
    typeof value.source === 'string' && value.source.length > 0 &&
    isTraceEventKind(value.kind) &&
    isIsoDate(value.timestamp) &&
    isIsoDate(value.recordedAt) &&
    optionalStringsAreValid(value) &&
    payloadIsValid(value.kind, value.payload)
}

export function assertTraceEventInput(input: TraceEventInput): void {
  if (input.schemaVersion !== undefined && input.schemaVersion !== TRACE_SCHEMA_VERSION) {
    throw new Error(`Unsupported trace schema version: ${input.schemaVersion}`)
  }
  assertNonEmpty('traceId', input.traceId)
  assertNonEmpty('source', input.source)
  for (const key of [
    'eventId',
    'runtimeId',
    'threadId',
    'turnId',
    'requestId',
    'parentRequestId'
  ] as const) {
    const value = input[key]
    if (value !== undefined) assertNonEmpty(key, value)
  }
  if (!isTraceEventKind(input.kind)) throw new Error(`Unsupported trace event kind: ${String(input.kind)}`)
  if (input.timestamp !== undefined && !isIsoDate(input.timestamp)) {
    throw new Error('Trace timestamp must be a valid ISO-8601 date')
  }
  if (!payloadIsValid(input.kind, input.payload)) {
    throw new Error(`Invalid payload for trace event kind: ${input.kind}`)
  }
  if (input.kind === 'agent_event') {
    const payload = input.payload as AgentTracePayload
    if (!isAgentTraceEventKind(payload.eventKind)) {
      throw new Error(`Unsupported Agent trace event kind: ${String(payload.eventKind)}`)
    }
  }
}

function payloadIsValid(kind: TraceEventKind, value: unknown): boolean {
  if (!isRecord(value)) return false
  if (kind === 'model_response_headers') {
    return typeof value.status === 'number' && Number.isInteger(value.status) &&
      value.status >= 100 && value.status <= 599
  }
  if (kind === 'model_response_chunk') {
    return typeof value.index === 'number' && Number.isInteger(value.index) && value.index >= 0 &&
      Object.hasOwn(value, 'body')
  }
  if (kind === 'agent_event') return isAgentTraceEventKind(value.eventKind) && Object.hasOwn(value, 'event')
  if (kind === 'error') return typeof value.message === 'string'
  if (kind === 'lifecycle') return typeof value.phase === 'string' && value.phase.length > 0
  return true
}

function optionalStringsAreValid(value: Record<string, unknown>): boolean {
  for (const key of ['runtimeId', 'threadId', 'turnId', 'requestId', 'parentRequestId'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length === 0)) return false
  }
  return true
}

function isAgentTraceEventKind(value: unknown): value is AgentTraceEventKind {
  return value === 'lifecycle' ||
    value === 'assistant' ||
    value === 'reasoning' ||
    value === 'tool' ||
    value === 'approval' ||
    value === 'usage' ||
    value === 'error'
}

function assertNonEmpty(name: string, value: string): void {
  if (value.trim().length === 0) throw new Error(`${name} must be a non-empty string`)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

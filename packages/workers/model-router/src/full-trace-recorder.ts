import type { IncomingHttpHeaders, ServerResponse } from 'node:http'
import {
  createRequestId,
  sanitizeTraceHeaders,
  sanitizeTraceText,
  sanitizeTraceTextChunks,
  sanitizeTraceValue,
  sensitiveTraceValuesFromHeaders,
  type TraceEvent,
  type TraceCorrelation,
  type TraceEventInput
} from '@sciforge/full-trace'

import {
  completeModelRouterTraceCorrelation,
  createModelRouterTraceCorrelationRegistry,
  type ModelRouterTraceCorrelationRegistry
} from './trace-correlation.js'
import type {
  UpstreamTraceAttemptObserver,
  UpstreamTraceAttemptStart
} from './upstream-drivers.js'

export type ModelRouterTraceSink = {
  appendMany(inputs: readonly TraceEventInput[]): Promise<TraceEvent[]>
}

export type ModelRouterFullTraceRecorderOptions = {
  sink: ModelRouterTraceSink
  correlationRegistry?: ModelRouterTraceCorrelationRegistry
  sensitiveValues?: readonly string[] | (() => readonly string[])
  now?: () => Date
  log?: (message: string) => void
}

export type ModelRouterTraceSessionStart = {
  method: string
  path: string
  headers: IncomingHttpHeaders
}

type CapturedChunk = {
  body: string
  timestamp: string
}

type CapturedError = {
  message: string
  name?: string
  code?: string
  timestamp: string
}

export class ModelRouterFullTraceRecorder {
  private readonly registry: ModelRouterTraceCorrelationRegistry
  private readonly getSensitiveValues: () => readonly string[]
  private readonly now: () => Date
  private readonly pending = new Set<Promise<void>>()

  constructor(private readonly options: ModelRouterFullTraceRecorderOptions) {
    this.registry = options.correlationRegistry ?? createModelRouterTraceCorrelationRegistry()
    const sensitiveValues = options.sensitiveValues
    this.getSensitiveValues = typeof sensitiveValues === 'function'
      ? sensitiveValues
      : () => sensitiveValues ?? []
    this.now = options.now ?? (() => new Date())
  }

  start(input: ModelRouterTraceSessionStart): ModelRouterTraceSession {
    return new ModelRouterTraceSession(this, input, this.now)
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending])
  }

  extractCorrelation(input: ModelRouterTraceSessionStart, body?: unknown) {
    return this.registry.extract({
      headers: input.headers as Record<string, string | string[] | undefined>,
      body
    })
  }

  sensitiveValuesFor(headers: IncomingHttpHeaders): readonly string[] {
    return [
      ...this.getSensitiveValues(),
      ...sensitiveTraceValuesFromHeaders(headers as Record<string, unknown>)
    ]
  }

  commit(events: readonly TraceEventInput[]): void {
    let task: Promise<void>
    task = this.options.sink.appendMany(events).then(
      () => undefined,
      (error: unknown) => {
        this.options.log?.(`full trace write failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    ).finally(() => this.pending.delete(task))
    this.pending.add(task)
  }
}

export class ModelRouterTraceSession {
  private readonly startedAt: string
  private requestBody: unknown = null
  private parsedRequestBody: unknown
  private responseHeadersAt?: string
  private responseHeaders: Record<string, unknown> = {}
  private responseStatus = 500
  private readonly chunks: CapturedChunk[] = []
  private capturedError?: CapturedError
  private finished = false
  private resolvedCorrelation?: TraceCorrelation

  constructor(
    private readonly owner: ModelRouterFullTraceRecorder,
    private readonly input: ModelRouterTraceSessionStart,
    private readonly now: () => Date
  ) {
    this.startedAt = now().toISOString()
  }

  recordRequestBody(body: unknown, parsedBody?: unknown): void {
    this.requestBody = body
    this.parsedRequestBody = parsedBody
    this.resolvedCorrelation = undefined
  }

  correlation(): TraceCorrelation {
    if (this.resolvedCorrelation) return this.resolvedCorrelation
    const extracted = {
      ...this.owner.extractCorrelation(this.input),
      ...this.owner.extractCorrelation(this.input, this.parsedRequestBody)
    }
    this.resolvedCorrelation = completeModelRouterTraceCorrelation(extracted)
    return this.resolvedCorrelation
  }

  startUpstreamAttempt(input: UpstreamTraceAttemptStart): UpstreamTraceAttemptObserver {
    return new ModelRouterUpstreamTraceAttempt(
      this.owner,
      this.correlation(),
      input,
      this.now,
      [
        ...this.owner.sensitiveValuesFor(this.input.headers),
        ...sensitiveTraceValuesFromHeaders(input.headers)
      ]
    )
  }

  recordError(error: unknown): void {
    const record = asRecord(error)
    this.capturedError = {
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error ? { name: error.name } : {}),
      ...(typeof record?.code === 'string' ? { code: record.code } : {}),
      timestamp: this.now().toISOString()
    }
  }

  attach(response: ServerResponse): void {
    const originalWrite = response.write.bind(response)
    const originalEnd = response.end.bind(response)
    response.write = ((chunk: unknown, ...args: unknown[]) => {
      this.recordChunk(chunk, encodingFromArgs(args))
      return Reflect.apply(originalWrite, response, [chunk, ...args]) as boolean
    }) as ServerResponse['write']
    response.end = ((chunk?: unknown, ...args: unknown[]) => {
      if (chunk !== undefined && chunk !== null) this.recordChunk(chunk, encodingFromArgs(args))
      return Reflect.apply(originalEnd, response, [chunk, ...args]) as ServerResponse
    }) as ServerResponse['end']
    response.once('finish', () => {
      this.responseStatus = response.statusCode
      this.responseHeaders = response.getHeaders()
      this.responseHeadersAt ??= this.now().toISOString()
      this.finish()
    })
    response.once('close', () => {
      if (this.finished || response.writableFinished) return
      this.recordError(new Error('Client connection closed before the model response completed.'))
      this.responseStatus = response.statusCode || 499
      this.responseHeaders = response.getHeaders()
      this.finish()
    })
  }

  private recordChunk(chunk: unknown, encoding?: BufferEncoding): void {
    this.responseHeadersAt ??= this.now().toISOString()
    this.chunks.push({ body: chunkText(chunk, encoding), timestamp: this.now().toISOString() })
  }

  private finish(): void {
    if (this.finished) return
    this.finished = true
    const endedAt = this.now().toISOString()
    const sensitiveValues = this.owner.sensitiveValuesFor(this.input.headers)
    const sanitization = { sensitiveValues }
    const correlation = this.correlation()
    const base = {
      ...correlation,
      source: 'model-router'
    }
    const sanitizedChunks = sanitizeTraceTextChunks(
      this.chunks.map((chunk) => chunk.body),
      sanitization
    )
    const events: TraceEventInput[] = [{
      ...base,
      kind: 'model_request',
      timestamp: this.startedAt,
      payload: {
        method: this.input.method,
        path: sanitizeTraceText(this.input.path, sanitization),
        headers: sanitizeTraceHeaders(this.input.headers as Record<string, unknown>, sanitization),
        body: sanitizeTraceValue(this.requestBody, sanitization),
        ...(modelFromBody(this.parsedRequestBody) ? { model: modelFromBody(this.parsedRequestBody) } : {})
      }
    }, {
      ...base,
      kind: 'model_response_headers',
      timestamp: this.responseHeadersAt ?? endedAt,
      payload: {
        status: this.responseStatus,
        headers: sanitizeTraceHeaders(this.responseHeaders, sanitization)
      }
    }]
    sanitizedChunks.forEach((body, index) => {
      events.push({
        ...base,
        kind: 'model_response_chunk',
        timestamp: this.chunks[index]?.timestamp ?? endedAt,
        payload: { index, body }
      })
    })
    if (this.capturedError) {
      events.push({
        ...base,
        kind: 'error',
        timestamp: this.capturedError.timestamp,
        payload: {
          stage: 'model-router',
          message: sanitizeTraceText(this.capturedError.message, sanitization),
          ...(this.capturedError.name ? { name: this.capturedError.name } : {}),
          ...(this.capturedError.code ? { code: this.capturedError.code } : {})
        }
      })
    }
    const usage = extractUsage(this.chunks.map((chunk) => chunk.body).join(''))
    if (usage) events.push({ ...base, kind: 'usage', timestamp: endedAt, payload: usage })
    events.push({
      ...base,
      kind: 'model_response_end',
      timestamp: endedAt,
      payload: {
        status: this.responseStatus,
        durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(this.startedAt)),
        ...(usage ? { usage } : {})
      }
    })
    this.owner.commit(events)
  }
}

class ModelRouterUpstreamTraceAttempt implements UpstreamTraceAttemptObserver {
  private readonly startedAt: string
  private readonly requestId = createRequestId()
  private responseStatus?: number
  private responseHeadersAt?: string
  private responseHeadersValue: Record<string, string> = {}
  private readonly chunks: Array<{ index: number; body: Uint8Array; timestamp: string }> = []
  private capturedError?: CapturedError
  private finished = false

  constructor(
    private readonly owner: ModelRouterFullTraceRecorder,
    private readonly parent: TraceCorrelation,
    private readonly input: UpstreamTraceAttemptStart,
    private readonly now: () => Date,
    private readonly sensitiveValues: readonly string[]
  ) {
    this.startedAt = now().toISOString()
  }

  responseHeaders(status: number, headers: Record<string, string>): void {
    this.responseStatus = status
    this.responseHeadersValue = headers
    this.responseHeadersAt = this.now().toISOString()
  }

  responseChunk(index: number, chunk: Uint8Array): void {
    this.chunks.push({
      index,
      body: Uint8Array.from(chunk),
      timestamp: this.now().toISOString()
    })
  }

  error(error: unknown): void {
    const record = asRecord(error)
    this.capturedError = {
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error ? { name: error.name } : {}),
      ...(typeof record?.code === 'string' ? { code: record.code } : {}),
      timestamp: this.now().toISOString()
    }
  }

  end(result: { status?: number; durationMs: number }): void {
    if (this.finished) return
    this.finished = true
    const endedAt = this.now().toISOString()
    this.responseStatus ??= result.status
    const sanitization = { sensitiveValues: this.sensitiveValues }
    const base = {
      traceId: this.parent.traceId,
      ...(this.parent.runtimeId ? { runtimeId: this.parent.runtimeId } : {}),
      ...(this.parent.threadId ? { threadId: this.parent.threadId } : {}),
      ...(this.parent.turnId ? { turnId: this.parent.turnId } : {}),
      requestId: this.requestId,
      parentRequestId: this.parent.requestId,
      source: 'model-router'
    }
    const events: TraceEventInput[] = [{
      ...base,
      kind: 'model_request',
      timestamp: this.startedAt,
      payload: {
        protocol: this.input.protocol,
        phase: this.input.phase,
        method: this.input.method,
        path: sanitizeTraceText(this.input.url, sanitization),
        headers: sanitizeTraceHeaders(this.input.headers, sanitization),
        body: sanitizeTraceValue(this.input.body, sanitization),
        ...(modelFromBody(this.input.body) ? { model: modelFromBody(this.input.body) } : {}),
        retry: this.input.retry ?? 0,
        upstream: true
      }
    }]
    if (this.responseStatus !== undefined) {
      events.push({
        ...base,
        kind: 'model_response_headers',
        timestamp: this.responseHeadersAt ?? endedAt,
        payload: {
          status: this.responseStatus,
          headers: sanitizeTraceHeaders(this.responseHeadersValue, sanitization),
          protocol: this.input.protocol,
          upstream: true
        }
      })
    }
    const completeBody = Buffer.concat(this.chunks.map((chunk) => Buffer.from(chunk.body)))
    const completeSanitized = sanitizeTraceValue(completeBody, sanitization)
    const redactAllChunks = isRedactedBinaryValue(completeSanitized)
    for (const chunk of this.chunks) {
      events.push({
        ...base,
        kind: 'model_response_chunk',
        timestamp: chunk.timestamp,
        payload: {
          index: chunk.index,
          body: redactAllChunks ? completeSanitized : sanitizeTraceValue(chunk.body, sanitization),
          protocol: this.input.protocol,
          upstream: true
        }
      })
    }
    if (this.capturedError) {
      events.push({
        ...base,
        kind: 'error',
        timestamp: this.capturedError.timestamp,
        payload: {
          stage: 'model-router-upstream',
          protocol: this.input.protocol,
          upstream: true,
          message: sanitizeTraceText(this.capturedError.message, sanitization),
          ...(this.capturedError.name ? { name: this.capturedError.name } : {}),
          ...(this.capturedError.code ? { code: this.capturedError.code } : {})
        }
      })
    }
    const usage = extractUsage(completeBody.toString('utf8'))
    if (usage) events.push({ ...base, kind: 'usage', timestamp: endedAt, payload: usage })
    events.push({
      ...base,
      kind: 'model_response_end',
      timestamp: endedAt,
      payload: {
        ...(this.responseStatus !== undefined ? { status: this.responseStatus } : {}),
        durationMs: Math.max(0, result.durationMs),
        protocol: this.input.protocol,
        upstream: true,
        ...(usage ? { usage } : {})
      }
    })
    this.owner.commit(events)
  }
}

function extractUsage(body: string): Record<string, number> | undefined {
  const candidates: unknown[] = []
  try {
    candidates.push(JSON.parse(body))
  } catch {
    for (const line of body.split('\n')) {
      if (!line.startsWith('data:')) continue
      const value = line.slice(5).trim()
      if (!value || value === '[DONE]') continue
      try {
        candidates.push(JSON.parse(value))
      } catch {
        // Ignore non-JSON stream frames; the complete raw frame remains traced.
      }
    }
  }
  for (const candidate of candidates.reverse()) {
    const usage = findUsage(candidate)
    if (usage) return usage
  }
  return undefined
}

function findUsage(value: unknown, depth = 0): Record<string, number> | undefined {
  if (depth > 12 || !value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const entry of value) {
      const usage = findUsage(entry, depth + 1)
      if (usage) return usage
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  const source = asRecord(record.usage) ?? record
  const inputTokens = numeric(source.inputTokens ?? source.input_tokens ?? source.prompt_tokens)
  const outputTokens = numeric(source.outputTokens ?? source.output_tokens ?? source.completion_tokens)
  const totalTokens = numeric(source.totalTokens ?? source.total_tokens) ?? (
    inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined
  )
  if (inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined) {
    return {
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(totalTokens !== undefined ? { totalTokens } : {})
    }
  }
  for (const nested of Object.values(record)) {
    const usage = findUsage(nested, depth + 1)
    if (usage) return usage
  }
  return undefined
}

function modelFromBody(body: unknown): string | undefined {
  const model = asRecord(body)?.model
  return typeof model === 'string' && model.trim() ? model : undefined
}

function isRedactedBinaryValue(value: unknown): boolean {
  const record = asRecord(value)
  return record?.encoding === 'base64' && record.data === '[REDACTED]'
}

function chunkText(chunk: unknown, encoding?: BufferEncoding): string {
  if (typeof chunk === 'string') return chunk
  if (Buffer.isBuffer(chunk)) return chunk.toString(encoding ?? 'utf8')
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString(encoding ?? 'utf8')
  return String(chunk)
}

function encodingFromArgs(args: readonly unknown[]): BufferEncoding | undefined {
  return typeof args[0] === 'string' ? args[0] as BufferEncoding : undefined
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

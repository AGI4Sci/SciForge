import {
  createRequestId,
  createTraceId,
  deriveTraceId,
  traceCorrelationFromHeaders,
  type TraceCorrelation
} from '@sciforge/full-trace'

import { codexTurnMetadataCorrelationExtractor } from './trace-correlation/codex.js'

export type ModelRouterTraceCorrelationInput = {
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

export type ModelRouterTraceCorrelationExtractor = {
  id: string
  extract(input: ModelRouterTraceCorrelationInput): Partial<TraceCorrelation>
}

/** Provider-neutral registry; vendor envelope knowledge stays in extractor modules. */
export class ModelRouterTraceCorrelationRegistry {
  constructor(private readonly extractors: readonly ModelRouterTraceCorrelationExtractor[]) {}

  extract(input: ModelRouterTraceCorrelationInput): Partial<TraceCorrelation> {
    const result: Partial<TraceCorrelation> = {}
    for (const extractor of this.extractors) {
      const extracted = extractor.extract(input)
      for (const key of correlationKeys) {
        const value = normalizedId(extracted[key])
        if (result[key] === undefined && value !== undefined) result[key] = value
      }
    }
    return result
  }
}

export function createModelRouterTraceCorrelationRegistry(): ModelRouterTraceCorrelationRegistry {
  return new ModelRouterTraceCorrelationRegistry([
    traceHeaderCorrelationExtractor,
    codexTurnMetadataCorrelationExtractor,
    standardMetadataCorrelationExtractor
  ])
}

export function completeModelRouterTraceCorrelation(
  partial: Partial<TraceCorrelation>
): TraceCorrelation {
  const traceId = partial.traceId ?? (
    partial.runtimeId && partial.threadId
      ? deriveTraceId({
          runtimeId: partial.runtimeId,
          threadId: partial.threadId,
          ...(partial.turnId ? { turnId: partial.turnId } : {})
        })
      : createTraceId()
  )
  return {
    traceId,
    requestId: partial.requestId ?? createRequestId(),
    ...(partial.runtimeId ? { runtimeId: partial.runtimeId } : {}),
    ...(partial.threadId ? { threadId: partial.threadId } : {}),
    ...(partial.turnId ? { turnId: partial.turnId } : {}),
    ...(partial.parentRequestId ? { parentRequestId: partial.parentRequestId } : {})
  }
}

const traceHeaderCorrelationExtractor: ModelRouterTraceCorrelationExtractor = {
  id: 'sciforge-headers',
  extract: ({ headers }) => traceCorrelationFromHeaders(headers)
}

const standardMetadataCorrelationExtractor: ModelRouterTraceCorrelationExtractor = {
  id: 'sciforge-metadata',
  extract: ({ body }) => {
    const request = asRecord(body)
    const metadata = asRecord(request?.metadata)
    const clientMetadata = asRecord(request?.client_metadata)
    const nested = parseRecord(metadata?.sciforge_trace) ??
      parseRecord(metadata?.sciforgeTrace) ??
      parseRecord(clientMetadata?.['x-sciforge-trace']) ??
      metadata
    return correlationFromRecord(nested)
  }
}

export function correlationFromRecord(record: Record<string, unknown> | undefined): Partial<TraceCorrelation> {
  if (!record) return {}
  return compactCorrelation({
    traceId: firstString(record.traceId, record.trace_id),
    runtimeId: firstString(record.runtimeId, record.runtime_id, record.sciforge_runtime_id),
    threadId: firstString(record.threadId, record.thread_id, record.gui_thread_id),
    turnId: firstString(record.turnId, record.turn_id, record.gui_turn_id),
    requestId: firstString(record.requestId, record.request_id),
    parentRequestId: firstString(record.parentRequestId, record.parent_request_id)
  })
}

export function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      return undefined
    }
  }
  return asRecord(value)
}

function compactCorrelation(input: Partial<TraceCorrelation>): Partial<TraceCorrelation> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [keyof TraceCorrelation, string] => Boolean(entry[1]))
  )
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = normalizedId(value)
    if (normalized) return normalized
  }
  return undefined
}

function normalizedId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 512 ? trimmed : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

const correlationKeys: ReadonlyArray<keyof TraceCorrelation> = [
  'traceId',
  'runtimeId',
  'threadId',
  'turnId',
  'requestId',
  'parentRequestId'
]

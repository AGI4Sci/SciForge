import type { ModelRouterTraceCorrelationExtractor } from '../trace-correlation.js'
import { correlationFromRecord, parseRecord } from '../trace-correlation.js'
import { deriveTraceId } from '@sciforge/full-trace'

/** Codex-specific envelope parser kept outside the Model Router core. */
export const codexTurnMetadataCorrelationExtractor: ModelRouterTraceCorrelationExtractor = {
  id: 'codex-turn-metadata',
  extract: ({ body }) => {
    const request = asRecord(body)
    const clientMetadata = asRecord(request?.client_metadata)
    const metadata = parseRecord(clientMetadata?.['x-codex-turn-metadata'])
    if (!metadata) return {}
    const correlation = correlationFromRecord({
      runtime_id: metadata.runtime_id,
      thread_id: metadata.gui_thread_id,
      turn_id: metadata.turn_id
    })
    return correlation.runtimeId && correlation.threadId
      ? {
          ...correlation,
          traceId: deriveTraceId({
            runtimeId: correlation.runtimeId,
            threadId: correlation.threadId,
            ...(correlation.turnId ? { turnId: correlation.turnId } : {})
          })
        }
      : correlation
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

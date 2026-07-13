import { z } from 'zod'
import { encodeSseEvent } from '../sse.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import type { EventBus } from '../../ports/event-bus.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import { ERRORS } from './runtime-error.js'

const HEARTBEAT_INTERVAL_MS = 15_000

const SyntheticErrorEvent = z.object({
  kind: z.literal('error'),
  turnId: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
  message: z.string().min(1),
  code: z.string().min(1).optional(),
  details: z.unknown().optional(),
  severity: z.enum(['info', 'warning', 'error']).optional()
})

/** Persist a bearer-authenticated Host verdict into the normal replay log. */
export async function recordSyntheticErrorEvent(input: {
  request: Request
  threadId: string
  events: RuntimeEventRecorder
  threadExists: () => Promise<boolean>
}): Promise<JsonResponse | Response> {
  if (!await input.threadExists()) return ERRORS.notFound(`thread not found: ${input.threadId}`)
  const body = await readJsonBody(input.request)
  if (!body.ok) return body.response
  const parsed = SyntheticErrorEvent.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid synthetic event body', parsed.error.issues)
  const event = await input.events.record({
    ...parsed.data,
    threadId: input.threadId
  })
  return jsonResponse(event, 201)
}

/**
 * Build an SSE response for `GET /v1/threads/{id}/events`.
 *
 * The handler subscribes to live updates first, replays persisted
 * events with `seq` greater than `since_seq`, then flushes queued live
 * events with `seq` de-duplication. The stream closes when the request's `AbortSignal`
 * fires (the client disconnects) or the server stops publishing.
 */
export function buildEventStreamResponse(input: {
  request: Request
  threadId: string
  eventBus: EventBus
  sessionStore: SessionStore
  allocateSeq: (threadId: string) => number
}): Response {
  const url = new URL(input.request.url)
  const sinceSeqFromQuery = Number(url.searchParams.get('since_seq') ?? '0') || 0
  const sinceSeqFromHeader = Number(input.request.headers.get('Last-Event-ID') ?? '0') || 0
  const sinceSeq = sinceSeqFromQuery || sinceSeqFromHeader
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let closed = false
  let lastSentSeq = sinceSeq
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe?.()
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = undefined
        }
        try {
          controller.close()
        } catch {
          // Already closed; ignore.
        }
      }
      const sendEvent = (event: RuntimeEvent): void => {
        if (event.seq <= sinceSeq || event.seq <= lastSentSeq) return
        controller.enqueue(encoder.encode(encodeSseEvent(event)))
        if (event.kind !== 'heartbeat') lastSentSeq = event.seq
      }
      input.request.signal.addEventListener('abort', close)
      try {
        const queuedLiveEvents: RuntimeEvent[] = []
        let replaying = true
        unsubscribe = input.eventBus.subscribe(input.threadId, (event: RuntimeEvent) => {
          if (closed) return
          if (replaying) {
            queuedLiveEvents.push(event)
            return
          }
          try {
            sendEvent(event)
          } catch {
            close()
          }
        })
        const backlog = await input.sessionStore.loadEventsSince(input.threadId, sinceSeq)
        for (const event of backlog) {
          if (closed) return
          sendEvent(event)
        }
        replaying = false
        for (const event of queuedLiveEvents) {
          if (closed) return
          sendEvent(event)
        }
        heartbeatTimer = setInterval(() => {
          if (closed) return
          try {
            controller.enqueue(
              encoder.encode(
                encodeSseEvent({
                  kind: 'heartbeat',
                  seq: lastSentSeq,
                  timestamp: new Date().toISOString(),
                  threadId: input.threadId
                })
              )
            )
          } catch {
            close()
          }
        }, HEARTBEAT_INTERVAL_MS)
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({
              message: error instanceof Error ? error.message : String(error)
            })}\n\n`
          )
        )
        close()
      }
    },
    cancel() {
      closed = true
      unsubscribe?.()
      if (heartbeatTimer) clearInterval(heartbeatTimer)
    }
  })
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  })
}

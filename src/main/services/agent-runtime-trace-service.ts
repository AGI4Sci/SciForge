import {
  deriveTraceId,
  type TraceEvent,
  type TraceEventInput
} from '@sciforge/full-trace'
import type {
  AgentRuntimeEvent,
  AgentRuntimeId
} from '../../shared/agent-runtime-contract'
import { logWarn } from '../logger'

type AgentTraceEventKind = TraceEventInput<'agent_event'>['payload']['eventKind']

export type AgentRuntimeTraceSink = {
  append(input: TraceEventInput<'agent_event'>): Promise<TraceEvent>
  appendMany(inputs: readonly TraceEventInput<'agent_event'>[]): Promise<TraceEvent[]>
  sanitizeTextChunks(chunks: readonly string[]): string[]
}

// Per-turn delta buffers exist only until flushTurn; without bounds a turn
// whose flush is missed (or whose stream stalls) accumulates deltas forever.
// 4_096 entries matches the per-turn model-delta identity bound used by the
// Codex runtime; 4 MiB matches the renderer thread-page delivery boundary.
export const AGENT_TRACE_TURN_BUFFER_MAX_EVENTS = 4_096
export const AGENT_TRACE_TURN_BUFFER_MAX_BYTES = 4 * 1024 * 1024
// A turn that saw no deltas for this long was abandoned on an exceptional
// path; its buffer is evicted so the map cannot leak per-turn memory.
export const AGENT_TRACE_STALE_TURN_MS = 30 * 60_000

type BufferedTurn = {
  runtimeId: AgentRuntimeId
  threadId: string
  turnId: string
  events: ObservedAgentEvent[]
  bufferedBytes: number
  truncated: boolean
  lastObservedAtMs: number
}

type ObservedAgentEvent = {
  event: AgentRuntimeEvent
  timestamp: string
}

/**
 * Adapts the runtime-neutral event stream to the durable full-trace contract.
 * Secret filtering and persistence remain the store's responsibility so every
 * producer follows the same capture chain.
 */
export class AgentRuntimeTraceRecorder {
  private readonly turns = new Map<string, BufferedTurn>()
  private lastObservedAtMs = 0

  constructor(private readonly sink: AgentRuntimeTraceSink) {}

  async observeEvent(ownerRuntimeId: AgentRuntimeId, event: AgentRuntimeEvent): Promise<void> {
    const runtimeId = event.runtimeId ?? ownerRuntimeId
    const observed = {
      event,
      timestamp: this.nextObservedTimestamp()
    }
    if (
      !event.turnId ||
      (event.kind !== 'assistant_delta' && event.kind !== 'reasoning_delta')
    ) {
      await this.sink.append(this.traceInput(runtimeId, observed))
      return
    }
    this.evictStaleTurns()
    const key = turnKey(runtimeId, event.threadId, event.turnId)
    const turn = this.turns.get(key) ?? {
      runtimeId,
      threadId: event.threadId,
      turnId: event.turnId,
      events: [],
      bufferedBytes: 0,
      truncated: false,
      lastObservedAtMs: 0
    }
    turn.lastObservedAtMs = Date.now()
    const eventBytes = Buffer.byteLength(event.text, 'utf8')
    if (
      !turn.truncated &&
      turn.events.length < AGENT_TRACE_TURN_BUFFER_MAX_EVENTS &&
      turn.bufferedBytes + eventBytes <= AGENT_TRACE_TURN_BUFFER_MAX_BYTES
    ) {
      turn.events.push(observed)
      turn.bufferedBytes += eventBytes
    } else if (!turn.truncated) {
      turn.truncated = true
      logWarn('agent-runtime-trace', 'Truncated a turn trace buffer that exceeded its bound; later deltas of the turn will not be recorded.', {
        runtimeId,
        threadId: event.threadId,
        turnId: event.turnId,
        bufferedEvents: turn.events.length,
        bufferedBytes: turn.bufferedBytes
      })
    }
    this.turns.set(key, turn)
  }

  async flushTurn(runtimeId: AgentRuntimeId, threadId: string, turnId: string): Promise<void> {
    const key = turnKey(runtimeId, threadId, turnId)
    const turn = this.turns.get(key)
    if (!turn) return
    try {
      const events = sanitizeOrderedDeltas(turn.events, this.sink.sanitizeTextChunks.bind(this.sink))
      await this.sink.appendMany(events.map((event) => this.traceInput(turn.runtimeId, event)))
      if (turn.truncated) {
        await this.sink.append(this.traceInput(turn.runtimeId, {
          timestamp: this.nextObservedTimestamp(),
          event: {
            kind: 'error',
            runtimeId: turn.runtimeId,
            threadId: turn.threadId,
            turnId: turn.turnId,
            recoverable: true,
            severity: 'warning',
            code: 'agent_trace_turn_truncated',
            message: 'Turn trace capture was truncated after the buffered deltas exceeded their bound.'
          }
        }))
      }
    } finally {
      this.turns.delete(key)
    }
  }

  private evictStaleTurns(): void {
    const now = Date.now()
    let evicted = 0
    for (const [key, turn] of this.turns) {
      if (now - turn.lastObservedAtMs <= AGENT_TRACE_STALE_TURN_MS) continue
      this.turns.delete(key)
      evicted += 1
    }
    if (evicted > 0) {
      logWarn('agent-runtime-trace', 'Evicted stale turn trace buffers that were never flushed.', { evicted })
    }
  }

  private traceInput(
    runtimeId: AgentRuntimeId,
    observed: ObservedAgentEvent
  ): TraceEventInput<'agent_event'> {
    const { event, timestamp } = observed
    return {
      traceId: deriveTraceId({
        runtimeId,
        threadId: event.threadId,
        ...(event.turnId ? { turnId: event.turnId } : {})
      }),
      source: 'agent-runtime',
      kind: 'agent_event',
      runtimeId,
      threadId: event.threadId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      timestamp,
      payload: {
        eventKind: normalizeAgentTraceEventKind(event),
        event
      }
    }
  }

  private nextObservedTimestamp(): string {
    this.lastObservedAtMs = Math.max(Date.now(), this.lastObservedAtMs + 1)
    return new Date(this.lastObservedAtMs).toISOString()
  }
}

function turnKey(runtimeId: AgentRuntimeId, threadId: string, turnId: string): string {
  return `${runtimeId}\0${threadId}\0${turnId}`
}

function sanitizeOrderedDeltas(
  events: readonly ObservedAgentEvent[],
  sanitizeChunks: (chunks: readonly string[]) => string[]
): ObservedAgentEvent[] {
  const indexes: number[] = []
  for (const [index, { event }] of events.entries()) {
    if (event.kind !== 'assistant_delta' && event.kind !== 'reasoning_delta') continue
    indexes.push(index)
  }
  const sanitized = [...events]
  const chunks = indexes.map((index) => {
    const event = events[index]?.event
    return event?.kind === 'assistant_delta' || event?.kind === 'reasoning_delta'
      ? event.text
      : ''
  })
  const cleanChunks = sanitizeChunks(chunks)
  for (const [chunkIndex, eventIndex] of indexes.entries()) {
    const observed = events[eventIndex]
    const event = observed?.event
    if (!event || (event.kind !== 'assistant_delta' && event.kind !== 'reasoning_delta')) continue
    sanitized[eventIndex] = {
      ...observed,
      event: { ...event, text: cleanChunks[chunkIndex] ?? '' }
    }
  }
  return sanitized
}

export function normalizeAgentTraceEventKind(event: AgentRuntimeEvent): AgentTraceEventKind {
  switch (event.kind) {
    case 'assistant_delta':
      return 'assistant'
    case 'reasoning_delta':
      return 'reasoning'
    case 'tool_event':
      return 'tool'
    case 'item_snapshot':
      if (event.item.kind === 'tool') return 'tool'
      if (event.item.kind === 'reasoning') return 'reasoning'
      if (event.item.kind === 'assistant_message') return 'assistant'
      return 'lifecycle'
    case 'approval_requested':
    case 'approval_resolved':
    case 'user_input_requested':
    case 'user_input_resolved':
      return 'approval'
    case 'usage':
      return 'usage'
    case 'error':
      return 'error'
    default:
      return 'lifecycle'
  }
}

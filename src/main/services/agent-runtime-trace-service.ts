import {
  deriveTraceId,
  type TraceEvent,
  type TraceEventInput
} from '@sciforge/full-trace'
import type {
  AgentRuntimeEvent,
  AgentRuntimeId
} from '../../shared/agent-runtime-contract'

type AgentTraceEventKind = TraceEventInput<'agent_event'>['payload']['eventKind']

export type AgentRuntimeTraceSink = {
  append(input: TraceEventInput<'agent_event'>): Promise<TraceEvent>
  appendMany(inputs: readonly TraceEventInput<'agent_event'>[]): Promise<TraceEvent[]>
  sanitizeTextChunks(chunks: readonly string[]): string[]
}

type BufferedTurn = {
  runtimeId: AgentRuntimeId
  threadId: string
  turnId: string
  events: ObservedAgentEvent[]
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
    const key = turnKey(runtimeId, event.threadId, event.turnId)
    const turn = this.turns.get(key) ?? {
      runtimeId,
      threadId: event.threadId,
      turnId: event.turnId,
      events: []
    }
    turn.events.push(observed)
    this.turns.set(key, turn)
  }

  async flushTurn(runtimeId: AgentRuntimeId, threadId: string, turnId: string): Promise<void> {
    const key = turnKey(runtimeId, threadId, turnId)
    const turn = this.turns.get(key)
    if (!turn) return
    try {
      const events = sanitizeOrderedDeltas(turn.events, this.sink.sanitizeTextChunks.bind(this.sink))
      await this.sink.appendMany(events.map((event) => this.traceInput(turn.runtimeId, event)))
    } finally {
      this.turns.delete(key)
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

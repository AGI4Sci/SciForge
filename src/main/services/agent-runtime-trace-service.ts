import { createHash } from 'node:crypto'
import {
  deriveTraceId,
  SCIENTIFIC_TRACE_SOURCE,
  ScientificTraceCollector,
  type TraceEvent,
  type ScientificTraceEventInput,
  type TraceEventInput
} from '@sciforge/full-trace'
import type {
  AgentRuntimeEvent,
  AgentRuntimeCompletionReceipt,
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
  private readonly scientificCollector: ScientificTraceCollector
  private readonly observedScientificTraceIds = new Set<string>()
  private lastObservedAtMs = 0

  constructor(private readonly sink: AgentRuntimeTraceSink) {
    this.scientificCollector = new ScientificTraceCollector(sink)
  }

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
      await this.appendObservedEvent(runtimeId, observed)
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
      await this.recordScientificEvents(turn.runtimeId, events)
    } finally {
      this.turns.delete(key)
    }
  }

  private async appendObservedEvent(runtimeId: AgentRuntimeId, observed: ObservedAgentEvent): Promise<void> {
    await this.sink.append(this.traceInput(runtimeId, observed))
    await this.recordScientificEvents(runtimeId, [observed])
  }

  private async recordScientificEvents(
    runtimeId: AgentRuntimeId,
    observedEvents: readonly ObservedAgentEvent[]
  ): Promise<void> {
    const inputs = observedEvents.flatMap((observed) => this.scientificTraceInputs(runtimeId, observed))
    if (!inputs.length) return
    await this.scientificCollector.collectMany(inputs).catch(() => undefined)
  }

  private scientificTraceInputs(
    runtimeId: AgentRuntimeId,
    observed: ObservedAgentEvent
  ): ScientificTraceEventInput[] {
    const { event, timestamp } = observed
    const traceId = deriveTraceId({
      runtimeId,
      threadId: event.threadId,
      ...(event.turnId ? { turnId: event.turnId } : {})
    })
    const source = scientificTraceSource(runtimeId, event)
    const traceStartedEventId = scientificTraceStartedEventId(traceId)
    const inputs: ScientificTraceEventInput[] = []

    switch (event.kind) {
      case 'user_message':
        inputs.push({
          traceId,
          eventId: scientificEventId(runtimeId, event, 'user-input'),
          type: 'USER_INPUT',
          timestamp,
          actor: { type: 'human' },
          source,
          payload: {
            text: event.displayText ?? event.text,
            itemId: event.itemId
          },
          links: { inputs: [event.itemId] }
        })
        break
      case 'tool_event':
        inputs.push(scientificToolEventInput(runtimeId, event, traceId, traceStartedEventId, source, timestamp))
        inputs.push(...scientificArtifactAndEvidenceInputs(runtimeId, event, traceId, source, timestamp))
        if (event.status === 'error') {
          inputs.push({
            traceId,
            eventId: scientificEventId(runtimeId, event, 'tool-error'),
            parentEventId: traceStartedEventId,
            type: 'ERROR_RECORDED',
            timestamp,
            actor: { type: 'tool', id: event.toolName ?? event.itemId },
            source,
            payload: {
              message: event.detail ?? event.summary ?? event.errorCode ?? 'Tool execution failed.',
              errorCode: event.errorCode,
              toolName: event.toolName,
              itemId: event.itemId,
              status: event.status
            }
          })
        }
        break
      case 'approval_requested':
        inputs.push({
          traceId,
          eventId: scientificEventId(runtimeId, event, 'human-review-requested'),
          parentEventId: traceStartedEventId,
          type: 'HUMAN_REVIEW_REQUESTED',
          timestamp,
          actor: { type: 'system', id: 'approval-workflow' },
          source,
          payload: {
            approvalId: event.approvalId,
            summary: event.summary,
            toolName: event.toolName,
            meta: event.meta
          },
          links: { reviews: [event.approvalId] }
        })
        break
      case 'approval_resolved':
        inputs.push({
          traceId,
          eventId: scientificEventId(runtimeId, event, 'human-review-recorded'),
          parentEventId: traceStartedEventId,
          type: 'HUMAN_REVIEW_RECORDED',
          timestamp,
          actor: { type: 'human' },
          source,
          payload: {
            approvalId: event.approvalId,
            decision: event.decision,
            reason: event.message ?? `Approval resolved with decision: ${event.decision}.`
          },
          links: { reviews: [event.approvalId] }
        })
        break
      case 'error':
        inputs.push({
          traceId,
          eventId: scientificEventId(runtimeId, event, 'runtime-error'),
          parentEventId: traceStartedEventId,
          type: 'ERROR_RECORDED',
          timestamp,
          actor: { type: 'system', id: 'agent-runtime' },
          source,
          payload: {
            message: event.message,
            code: event.code,
            detail: event.detail,
            recoverable: event.recoverable,
            severity: event.severity
          }
        })
        break
      case 'usage':
        inputs.push({
          traceId,
          eventId: scientificEventId(runtimeId, event, 'resource-usage'),
          parentEventId: traceStartedEventId,
          type: 'RESOURCE_USAGE_RECORDED',
          timestamp,
          actor: { type: 'system', id: 'agent-runtime' },
          source,
          payload: {
            usage: event.usage
          }
        })
        break
      default:
        break
    }
    if (inputs.length > 0 && !this.observedScientificTraceIds.has(traceId)) {
      this.observedScientificTraceIds.add(traceId)
      inputs.unshift({
        traceId,
        eventId: traceStartedEventId,
        type: 'TRACE_STARTED',
        timestamp,
        actor: { type: 'system', id: 'agent-runtime-trace-recorder' },
        source,
        payload: {
          runtimeId,
          threadId: event.threadId,
          ...(event.turnId ? { turnId: event.turnId } : {})
        }
      })
    }
    return inputs
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

type ObservedToolEvent = Extract<AgentRuntimeEvent, { kind: 'tool_event' }>

function scientificTraceSource(
  runtimeId: AgentRuntimeId,
  event: AgentRuntimeEvent
): ScientificTraceEventInput['source'] {
  return {
    module: 'agent-runtime',
    provider: runtimeId,
    runtimeId,
    threadId: event.threadId,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.kind === 'user_input_requested' || event.kind === 'user_input_resolved'
      ? { requestId: event.requestId }
      : {}),
    ...(event.kind === 'tool_event' && event.callId ? { requestId: event.callId } : {})
  }
}

function scientificToolEventInput(
  runtimeId: AgentRuntimeId,
  event: ObservedToolEvent,
  traceId: string,
  parentEventId: string,
  source: ScientificTraceEventInput['source'],
  timestamp: string
): ScientificTraceEventInput {
  const type = event.toolKind === 'command_execution'
    ? 'COMMAND_EXECUTION'
    : event.status === 'running'
      ? 'TOOL_CALL_REQUESTED'
      : 'TOOL_CALL_COMPLETED'
  return {
    traceId,
    eventId: scientificEventId(runtimeId, event, 'tool-event'),
    parentEventId,
    type,
    timestamp,
    actor: { type: 'tool', id: event.toolName ?? event.itemId },
    source,
    payload: {
      itemId: event.itemId,
      callId: event.callId,
      toolName: event.toolName,
      toolKind: event.toolKind,
      status: event.status,
      phase: event.phase,
      effects: event.effects,
      factSource: event.factSource,
      evidenceStrength: event.evidenceStrength,
      attempt: event.attempt,
      resultDigest: event.resultDigest,
      errorCode: event.errorCode,
      summary: event.summary,
      detail: event.detail,
      filePath: event.filePath,
      meta: event.meta
    },
    links: { relatedEvents: [event.itemId] }
  }
}

function scientificArtifactAndEvidenceInputs(
  runtimeId: AgentRuntimeId,
  event: ObservedToolEvent,
  traceId: string,
  source: ScientificTraceEventInput['source'],
  timestamp: string
): ScientificTraceEventInput[] {
  const parentEventId = scientificEventId(runtimeId, event, 'tool-event')
  const inputs: ScientificTraceEventInput[] = []
  if (event.status === 'success' && event.toolKind === 'file_change' && event.filePath) {
    inputs.push({
      traceId,
      eventId: scientificEventId(runtimeId, event, 'file-artifact'),
      parentEventId,
      type: 'ARTIFACT_CREATED',
      timestamp,
      actor: { type: 'tool', id: event.toolName ?? event.itemId },
      source,
      payload: {
        artifactId: event.filePath,
        path: event.filePath,
        toolName: event.toolName,
        itemId: event.itemId,
        noHashReason: 'agent runtime file_change event did not include a content hash'
      },
      links: { artifacts: [event.filePath] }
    })
  }

  for (const receipt of event.completionReceipts ?? []) {
    if (receipt.kind === 'visual.capture') {
      inputs.push(scientificArtifactInputFromReceipt(runtimeId, event, receipt, traceId, parentEventId, source, timestamp))
    } else {
      inputs.push(scientificEvidenceInputFromReceipt(runtimeId, event, receipt, traceId, parentEventId, source, timestamp))
    }
  }
  return inputs
}

function scientificArtifactInputFromReceipt(
  runtimeId: AgentRuntimeId,
  event: ObservedToolEvent,
  receipt: AgentRuntimeCompletionReceipt,
  traceId: string,
  parentEventId: string,
  source: ScientificTraceEventInput['source'],
  timestamp: string
): ScientificTraceEventInput {
  const artifactRefs = artifactRefsFromReceipt(receipt)
  return {
    traceId,
    eventId: scientificEventId(runtimeId, event, `artifact-receipt:${receipt.receiptId}`),
    parentEventId,
    type: 'ARTIFACT_CREATED',
    timestamp,
    actor: { type: 'tool', id: receipt.issuer },
    source,
    payload: {
      artifactId: receipt.subjectRef,
      storageRef: receipt.subjectRef,
      receiptId: receipt.receiptId,
      receiptKind: receipt.kind,
      issuer: receipt.issuer,
      callId: receipt.callId,
      attestation: receipt.attestation,
      ...(receipt.sha256 ? { sha256: receipt.sha256 } : {
        noHashReason: 'completion receipt did not include a content hash'
      })
    },
    links: {
      artifacts: artifactRefs.length ? artifactRefs : [receipt.subjectRef],
      evidence: [receipt.receiptId],
      relatedEvents: [event.itemId]
    }
  }
}

function scientificEvidenceInputFromReceipt(
  runtimeId: AgentRuntimeId,
  event: ObservedToolEvent,
  receipt: AgentRuntimeCompletionReceipt,
  traceId: string,
  parentEventId: string,
  source: ScientificTraceEventInput['source'],
  timestamp: string
): ScientificTraceEventInput {
  const artifactRefs = artifactRefsFromReceipt(receipt)
  return {
    traceId,
    eventId: scientificEventId(runtimeId, event, `evidence-receipt:${receipt.receiptId}`),
    parentEventId,
    type: 'EVIDENCE_ATTACHED',
    timestamp,
    actor: { type: 'system', id: receipt.issuer },
    source,
    payload: {
      evidenceId: receipt.receiptId,
      evidenceType: receipt.kind,
      target: receipt.subjectRef,
      issuer: receipt.issuer,
      callId: receipt.callId,
      attestation: receipt.attestation,
      sha256: receipt.sha256
    },
    links: {
      evidence: [receipt.receiptId],
      ...(artifactRefs.length ? { artifacts: artifactRefs } : {}),
      relatedEvents: [event.itemId]
    }
  }
}

function artifactRefsFromReceipt(receipt: AgentRuntimeCompletionReceipt): string[] {
  return [...new Set([
    receipt.subjectRef,
    ...(receipt.relatedRefs ?? [])
  ].filter(isArtifactRef))]
}

function isArtifactRef(value: string): boolean {
  return value.startsWith('artifact_') || value.startsWith('artifact://')
}

function scientificTraceStartedEventId(traceId: string): string {
  return `scientific-trace-start-${stableHash(traceId).slice(0, 32)}`
}

function scientificEventId(runtimeId: AgentRuntimeId, event: AgentRuntimeEvent, suffix: string): string {
  return `scientific-event-${stableHash({
    runtimeId,
    suffix,
    kind: event.kind,
    threadId: event.threadId,
    turnId: event.turnId,
    itemId: event.itemId,
    seq: event.seq,
    createdAt: event.createdAt,
    event
  }).slice(0, 32)}`
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
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

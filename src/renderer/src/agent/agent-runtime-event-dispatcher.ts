import type {
  AgentRuntimeEvent,
  AgentRuntimeInputQuestion,
  AgentRuntimeItem,
  AgentRuntimePhase,
  AgentRuntimeToolKind,
  AgentRuntimeUsage,
  ReasoningSource,
  ReasoningVisibility
} from '@shared/agent-runtime-contract'
import { performanceMonitor } from '../lib/performance-monitor'
import { isAgentRuntimeTerminalTurnState } from '@shared/agent-runtime-contract'
import type {
  ApprovalRequestPayload,
  CompactionEventPayload,
  ReviewEventPayload,
  RuntimeDisclosureMetadata,
  RuntimeStatusEventPayload,
  ThreadDeltaEvent,
  ThreadEventSink,
  ThreadGoal,
  ThreadTodoList,
  ThreadTodoSource,
  ThreadUsageSnapshot,
  ToolEventPayload,
  UserInputAnswer,
  UserInputQuestion
} from './types'
import { extractScientificObjectMetadata } from '@shared/scientific-objects'
import { preserveMessageMetadata } from './runtime-message-metadata'

type ApprovalStatus = 'pending' | 'allowed' | 'denied' | 'error'

export const AGENT_RUNTIME_EVENT_REPLAY_FILTER = '__agentRuntimeEventReplayFilter' as const
export const AGENT_RUNTIME_DELTA_HANDLES_SEQ = '__agentRuntimeDeltaHandlesSeq' as const
export type AgentRuntimeEventReplayFilter = (event: AgentRuntimeEvent) => boolean

type ReplayAwareThreadEventSink = ThreadEventSink & {
  [AGENT_RUNTIME_EVENT_REPLAY_FILTER]?: AgentRuntimeEventReplayFilter
  [AGENT_RUNTIME_DELTA_HANDLES_SEQ]?: boolean
}

function shouldDispatchAgentRuntimeEvent(event: AgentRuntimeEvent, sink: ThreadEventSink): boolean {
  return (sink as ReplayAwareThreadEventSink)[AGENT_RUNTIME_EVENT_REPLAY_FILTER]?.(event) ?? true
}

export const AGENT_RUNTIME_DELTA_BATCH_WINDOW_MS = 50

export type AgentRuntimeDeltaBatchClock = {
  setTimeout: (handler: () => void, timeoutMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export type AgentRuntimeDeltaBatching = {
  /** Sink to dispatch into; deltas are accumulated, everything else passes through after a flush. */
  sink: ThreadEventSink
  /** Delivers accumulated deltas immediately. */
  flush: () => void
  /** Cancels the pending window and delivers any remaining deltas. */
  dispose: () => void
}

const THREAD_EVENT_SINK_METHODS = new Set<keyof ThreadEventSink>([
  'onSeq',
  'onDeltas',
  'onAssistantMessage',
  'onUserMessage',
  'onTool',
  'onCompaction',
  'onReview',
  'onApproval',
  'onUserInput',
  'onUserInputStatus',
  'onRuntimeStatus',
  'onRuntimeError',
  'onThreadLifecycle',
  'onTurnLifecycle',
  'onWorkLifecycle',
  'onChild',
  'onGoal',
  'onTodos',
  'onTurnComplete',
  'onError',
  'onUsage'
])

/**
 * Wraps a sink so consecutive deltas within `windowMs` accumulate into a single
 * `onDeltas` call. Any non-delta sink method (except the `onSeq` cursor, which
 * is order-insensitive) flushes pending deltas first, so the observable event
 * order is unchanged. `windowMs: 0` delivers synchronously.
 */
export function batchThreadEventSinkDeltas(
  sink: ThreadEventSink,
  options: { windowMs?: number; clock?: AgentRuntimeDeltaBatchClock } = {}
): AgentRuntimeDeltaBatching {
  const windowMs = options.windowMs ?? AGENT_RUNTIME_DELTA_BATCH_WINDOW_MS
  const clock: AgentRuntimeDeltaBatchClock = options.clock ?? {
    setTimeout: (handler, timeoutMs) => globalThis.setTimeout(handler, timeoutMs),
    clearTimeout: (handle) =>
      globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0])
  }
  let pending: ThreadDeltaEvent[] = []
  let timer: unknown = null

  const cancelTimer = (): void => {
    if (timer === null) return
    clock.clearTimeout(timer)
    timer = null
  }
  const flush = (): void => {
    cancelTimer()
    if (pending.length === 0) return
    const deltas = pending
    pending = []
    sink.onDeltas(deltas)
  }
  const onDeltas = (deltas: ThreadDeltaEvent[]): void => {
    if (deltas.length === 0) return
    if (windowMs <= 0) {
      sink.onDeltas(deltas)
      return
    }
    pending.push(...deltas)
    if (timer === null) {
      timer = clock.setTimeout(() => {
        timer = null
        flush()
      }, windowMs)
    }
  }
  const batched = new Proxy(sink, {
    get(target, property, receiver) {
      if (property === 'onDeltas') return onDeltas
      const value = Reflect.get(target, property, receiver) as unknown
      // Only sink callbacks flush-and-forward; marker hooks such as the replay
      // filter or the delta-seq flag must pass through untouched, or reading
      // them per delta event would defeat the batching window.
      if (typeof property !== 'string' || !THREAD_EVENT_SINK_METHODS.has(property as keyof ThreadEventSink)) {
        return value
      }
      if (typeof value !== 'function') return value
      return (...args: unknown[]): unknown => {
        if (property !== 'onSeq') flush()
        return Reflect.apply(value, target, args)
      }
    }
  })
  return { sink: batched, flush, dispose: flush }
}

function eventAdvancesSeq(event: AgentRuntimeEvent): event is AgentRuntimeEvent & { seq: number } {
  return event.kind !== 'heartbeat' && typeof event.seq === 'number'
}

const REASONING_VISIBILITIES: readonly ReasoningVisibility[] = [
  'none',
  'summary',
  'trace',
  'full_runtime_text'
]

const REASONING_SOURCES: readonly ReasoningSource[] = [
  'model',
  'runtime_summary',
  'backend_redacted',
  'unknown'
]

function reasoningVisibilityFromValue(value: unknown): ReasoningVisibility | undefined {
  return typeof value === 'string' && REASONING_VISIBILITIES.includes(value as ReasoningVisibility)
    ? value as ReasoningVisibility
    : undefined
}

function reasoningSourceFromValue(value: unknown): ReasoningSource | undefined {
  return typeof value === 'string' && REASONING_SOURCES.includes(value as ReasoningSource)
    ? value as ReasoningSource
    : undefined
}

function reasoningDisclosureMeta(input: {
  visibility?: unknown
  source?: unknown
  meta?: Record<string, unknown>
}): RuntimeDisclosureMetadata | undefined {
  const meta = input.meta
  const visibility =
    reasoningVisibilityFromValue(input.visibility) ??
    reasoningVisibilityFromValue(meta?.visibility) ??
    reasoningVisibilityFromValue(meta?.reasoningVisibility) ??
    reasoningVisibilityFromValue(meta?.reasoning_visibility)
  const source =
    reasoningSourceFromValue(input.source) ??
    reasoningSourceFromValue(meta?.source) ??
    reasoningSourceFromValue(meta?.reasoningSource) ??
    reasoningSourceFromValue(meta?.reasoning_source)
  if (!visibility && !source) return undefined
  return {
    reasoning: {
      ...(visibility ? { visibility } : {}),
      ...(source ? { source } : {})
    }
  }
}

function runtimeDisclosureMetaFromRecord(
  meta: Record<string, unknown> | undefined,
  preserveMessageFacts = false
): ApprovalRequestPayload['meta'] | undefined {
  if (!meta) return undefined
  const next: NonNullable<ApprovalRequestPayload['meta']> = {}
  const displayText = meta.displayText
  if (typeof displayText === 'string') next.displayText = displayText
  if (typeof meta.source === 'string') next.source = meta.source
  if (typeof meta.sourceLabel === 'string') next.sourceLabel = meta.sourceLabel
  if (Array.isArray(meta.attachmentIds)) {
    const attachmentIds = meta.attachmentIds.filter((item): item is string => typeof item === 'string')
    if (attachmentIds.length > 0) next.attachmentIds = attachmentIds
  }
  if (Array.isArray(meta.attachments)) {
    next.attachments = meta.attachments.filter(
      (item): item is NonNullable<typeof next.attachments>[number] =>
        typeof item === 'object' && item !== null
    )
  }
  const generatedFiles = Array.isArray(meta.generatedFiles)
    ? meta.generatedFiles
    : Array.isArray(meta.generatedImages)
      ? meta.generatedImages
      : Array.isArray(meta.images)
        ? meta.images
        : undefined
  if (generatedFiles) {
    next.generatedFiles = generatedFiles.filter(
      (item): item is NonNullable<typeof next.generatedFiles>[number] =>
        typeof item === 'object' && item !== null
    )
  }
  if (Array.isArray(meta.activeSkillIds)) {
    const activeSkillIds = meta.activeSkillIds.filter((item): item is string => typeof item === 'string')
    if (activeSkillIds.length > 0) next.activeSkillIds = activeSkillIds
  }
  if (Array.isArray(meta.injectedMemoryIds)) {
    const injectedMemoryIds = meta.injectedMemoryIds.filter((item): item is string => typeof item === 'string')
    if (injectedMemoryIds.length > 0) next.injectedMemoryIds = injectedMemoryIds
  }
  if (typeof meta.skillInjectionBytes === 'number') {
    next.skillInjectionBytes = meta.skillInjectionBytes
  }
  const approvalSource = meta.approval && typeof meta.approval === 'object' && !Array.isArray(meta.approval)
    ? meta.approval as Record<string, unknown>
    : meta
  const approvalKeys = [
    'detail', 'command', 'cwd', 'workingDirectory', 'workspaceRoot',
    'arguments', 'args', 'input', 'effect', 'risk', 'reason', 'context',
    'childId', 'childThreadId', 'childTurnId', 'parentThreadId', 'parentTurnId',
    'parentPermissionLevel', 'decisionSource', 'approvalOwner'
  ] as const
  const approval: Record<string, unknown> = {}
  for (const key of approvalKeys) {
    const value = approvalSource[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      approval[key] = typeof value === 'string' ? value.slice(0, 16_000) : value
    } else {
      try {
        const encoded = JSON.stringify(value)
        if (encoded && encoded.length <= 16_000) approval[key] = value
      } catch {
        // Ignore non-serializable provider metadata.
      }
    }
  }
  if (approvalSource !== meta && typeof meta.approvalDetail === 'string') {
    approval.detail = meta.approvalDetail.slice(0, 16_000)
  }
  if (Object.keys(approval).length > 0) {
    next.approval = approval
  }
  const scientific = extractScientificObjectMetadata(meta)
  if (scientific.scientificObjects.length) next.scientificObjects = scientific.scientificObjects
  if (scientific.comparisons.length) next.scientificObjectComparisons = scientific.comparisons
  if (scientific.workspaceObservations.length) next.workspaceObservations = scientific.workspaceObservations
  return preserveMessageFacts ? preserveMessageMetadata(meta, next) : Object.keys(next).length > 0 ? next : undefined
}

export function agentRuntimeEventBelongsToThread(
  payloadThreadId: string | undefined,
  threadId: string
): boolean {
  const payload = payloadThreadId?.trim() ?? ''
  const bound = threadId.trim()
  return !payload || payload === bound
}

function stableEventKey(event: Pick<AgentRuntimeEvent, 'turnId' | 'threadId' | 'itemId' | 'seq'>): string {
  return event.itemId ?? event.turnId ?? event.threadId ?? String(event.seq ?? 'event')
}

function timestamp(value: string | undefined): string {
  return value ?? new Date().toISOString()
}

function runtimeStatusMessage(phase: AgentRuntimePhase | undefined, message: string | undefined): string {
  return message?.trim() || `Runtime status: ${phase ?? 'runtime_status'}`
}

function runtimeStatusFromEvent(event: Extract<AgentRuntimeEvent, { kind: 'runtime_status' }>): RuntimeStatusEventPayload {
  const phaseKey = event.phase ?? 'runtime_status'
  return {
    kind: 'tool_catalog_changed',
    itemId: event.itemId ?? `runtime_status_${stableEventKey(event)}_${phaseKey}`,
    turnId: event.turnId,
    createdAt: event.createdAt,
    ...(event.phase ? { phase: event.phase } : {}),
    message: runtimeStatusMessage(event.phase, event.message)
  }
}

function handoffStatusFromEvent(event: Extract<AgentRuntimeEvent, { kind: 'handoff_event' }>): RuntimeStatusEventPayload {
  return {
    kind: 'runtime_handoff',
    itemId: event.itemId ?? `runtime_handoff_${stableEventKey(event)}`,
    turnId: event.turnId,
    createdAt: event.createdAt,
    message: event.message,
    sourceRuntimeId: event.sourceRuntimeId,
    sourceThreadId: event.sourceThreadId,
    targetRuntimeId: event.targetRuntimeId,
    targetThreadId: event.targetThreadId
  }
}

function toolKind(kind: AgentRuntimeToolKind | undefined): ToolEventPayload['toolKind'] | undefined {
  return kind
}

function toolEventFromRuntime(
  event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>
): ToolEventPayload {
  return {
    itemId: event.itemId,
    summary: event.summary?.trim() || 'Tool',
    status: event.status,
    toolKind: toolKind(event.toolKind),
    detail: event.detail,
    detailArtifact: event.detailArtifact,
    outputStatus: event.outputStatus,
    filePath: event.filePath,
    meta: event.meta
  }
}

function normalizeUserInputQuestion(question: AgentRuntimeInputQuestion): UserInputQuestion {
  return {
    header: question.header?.trim() || 'Input',
    id: question.id?.trim() || 'input',
    question: question.question?.trim() || 'Input requested',
    options: (question.options ?? []).map((option) => ({
      label: option.label,
      description: option.description ?? ''
    }))
  }
}

function userInputAnswers(
  answers: Extract<AgentRuntimeEvent, { kind: 'user_input_resolved' }>['answers']
): UserInputAnswer[] | undefined {
  if (!answers) return undefined
  return answers.map((answer) => ({
    id: answer.id,
    label: answer.label ?? answer.value,
    value: answer.value
  }))
}

function compactionFromEvent(
  event: Extract<AgentRuntimeEvent, { kind: 'compaction_event' }>
): CompactionEventPayload {
  return {
    itemId: event.itemId ?? `compaction_${stableEventKey(event)}`,
    summary: event.summary,
    status: event.status,
    detail: event.detail,
    auto: event.auto,
    messagesBefore: event.messagesBefore,
    messagesAfter: event.messagesAfter,
    replacedTokens: event.replacedTokens,
    sourceDigest: event.sourceDigest,
    digestMarker: event.digestMarker,
    sourceItemIds: event.sourceItemIds,
    createdAt: event.createdAt
  }
}

function reviewFromEvent(event: Extract<AgentRuntimeEvent, { kind: 'review_event' }>): ReviewEventPayload {
  return {
    itemId: event.itemId ?? `review_${stableEventKey(event)}`,
    createdAt: event.createdAt,
    title: event.title,
    status: event.status,
    reviewText: event.reviewText,
    output: event.output as ReviewEventPayload['output']
  }
}

function goalFromEvent(event: Extract<AgentRuntimeEvent, { kind: 'goal_event' }>): ThreadGoal | null {
  if (event.cleared) return null
  const now = timestamp(event.createdAt)
  return {
    threadId: event.threadId,
    objective: event.objective ?? '',
    status: event.status ?? 'active',
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: now,
    updatedAt: now
  }
}

function todosFromEvent(event: Extract<AgentRuntimeEvent, { kind: 'todo_event' }>): ThreadTodoList | null {
  if (event.cleared) return null
  const now = timestamp(event.createdAt)
  return {
    threadId: event.threadId,
    updatedAt: now,
    items: event.items.map((item) => ({
      id: item.id,
      content: item.content,
      status: item.status,
      ...(item.source ? { source: item.source as ThreadTodoSource } : {}),
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || now
    }))
  }
}

function usageFromRuntime(usage: AgentRuntimeUsage): ThreadUsageSnapshot {
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const cachedTokens = usage.cacheReadTokens ?? 0
  const cacheMissTokens = usage.cacheWriteTokens ?? 0
  const cacheTotal = cachedTokens + cacheMissTokens
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: usage.reasoningTokens ?? 0,
    cachedTokens,
    cacheMissTokens,
    cacheHitRate: cacheTotal > 0 ? cachedTokens / cacheTotal : null,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens + (usage.reasoningTokens ?? 0),
    costUsd: usage.costUsd ?? 0,
    costCny: null,
    cacheSavingsUsd: 0,
    cacheSavingsCny: null,
    tokenEconomySavingsTokens: 0,
    tokenEconomySavingsUsd: 0,
    tokenEconomySavingsCny: null,
    turns: 0
  }
}

function dispatchItemSnapshot(event: Extract<AgentRuntimeEvent, { kind: 'item_snapshot' }>, sink: ThreadEventSink): void {
  const item = event.item
  switch (item.kind) {
    case 'user_message':
      {
        const meta = runtimeDisclosureMetaFromRecord(item.meta, true)
        sink.onUserMessage({
          itemId: item.id,
          createdAt: item.createdAt,
          text: item.text ?? '',
          ...(meta ? { meta } : {})
        })
      }
      return
    case 'assistant_message':
      if (item.text) {
        const meta = runtimeDisclosureMetaFromRecord(item.meta, true)
        if (sink.onAssistantMessage) {
          sink.onAssistantMessage({
            itemId: item.id,
            turnId: event.turnId,
            createdAt: item.createdAt ?? event.createdAt,
            text: item.text,
            ...(meta ? { meta } : {})
          })
        } else {
          sink.onDeltas([{ kind: 'agent_message', itemId: item.id, text: item.text, seq: event.seq }])
        }
      }
      return
    case 'reasoning':
      if (item.text) {
        const meta = reasoningDisclosureMeta({ meta: item.meta })
        sink.onDeltas([{
          kind: 'agent_reasoning',
          itemId: item.id,
          text: item.text,
          seq: event.seq,
          ...(meta ? { meta } : {})
        }])
      }
      return
    case 'tool':
      sink.onTool(toolEventFromItem(item))
      return
    case 'compaction':
      sink.onCompaction(compactionFromItem(item))
      return
    case 'review':
      sink.onReview?.(reviewFromItem(item))
      return
    case 'approval':
      sink.onApproval(approvalFromItem(item))
      return
    case 'user_input':
      sink.onUserInput(userInputFromItem(item))
      return
    case 'system':
      if (item.status === 'error' || item.status === 'failed') {
        sink.onRuntimeError?.({
          itemId: item.id,
          createdAt: item.createdAt,
          message: item.text ?? item.summary ?? 'Runtime error',
          severity: 'error'
        })
      }
      return
  }
}

function toolEventFromItem(item: AgentRuntimeItem): ToolEventPayload {
  return {
    itemId: item.id,
    summary: item.summary?.trim() || item.text?.trim() || 'Tool',
    status: item.status === 'error' || item.status === 'failed' || item.status === 'aborted'
      ? 'error'
      : item.status === 'running' || item.status === 'pending'
        ? 'running'
        : 'success',
    toolKind: toolKind(item.toolKind),
    detail: item.detail,
    detailArtifact: item.detailArtifact,
    outputStatus: item.outputStatus,
    meta: item.meta
  }
}

function compactionFromItem(item: AgentRuntimeItem): CompactionEventPayload {
  return {
    itemId: item.id,
    createdAt: item.createdAt,
    summary: item.summary?.trim() || item.text?.trim() || 'Context compacted',
    status: item.status === 'error' || item.status === 'failed' || item.status === 'aborted'
      ? 'error'
      : item.status === 'running' || item.status === 'pending'
        ? 'running'
        : 'success',
    detail: item.detail
  }
}

function reviewFromItem(item: AgentRuntimeItem): ReviewEventPayload {
  return {
    itemId: item.id,
    createdAt: item.createdAt,
    title: item.summary?.trim() || 'Review',
    status: item.status === 'error' || item.status === 'failed' || item.status === 'aborted'
      ? 'error'
      : item.status === 'running' || item.status === 'pending'
        ? 'running'
        : 'success',
    reviewText: item.text,
    output: item.meta?.output as ReviewEventPayload['output']
  }
}

function approvalFromItem(item: AgentRuntimeItem): ApprovalRequestPayload {
  const approvalId = requestIdMeta(item.meta, 'codexRequestId') ?? stringMeta(item.meta, 'approvalId') ?? item.id
  const meta = runtimeDisclosureMetaFromRecord(item.meta)
  return {
    approvalId,
    summary: item.summary?.trim() || item.text?.trim() || 'Approval required',
    toolName: stringMeta(item.meta, 'toolName'),
    status: approvalStatusFromItem(item),
    ...(meta ? { meta } : {})
  }
}

function userInputFromItem(item: AgentRuntimeItem): {
  itemId: string
  requestId: string
  questions: UserInputQuestion[]
} {
  const requestId = stringMeta(item.meta, 'requestId') ?? item.id
  const questions = questionsMeta(item.meta)
  return {
    itemId: item.id,
    requestId,
    questions: questions.length > 0
      ? questions
      : [
          {
            header: 'Input',
            id: requestId,
            question: item.summary?.trim() || item.text?.trim() || 'Input requested',
            options: []
          }
        ]
  }
}

function stringMeta(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requestIdMeta(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function questionsMeta(meta: Record<string, unknown> | undefined): UserInputQuestion[] {
  const rawQuestions = meta?.questions
  if (!Array.isArray(rawQuestions)) return []
  return rawQuestions.map(normalizeMetaQuestion).filter((question): question is UserInputQuestion => question != null)
}

function normalizeMetaQuestion(raw: unknown): UserInputQuestion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const id = stringMeta(record, 'id')
  const question = stringMeta(record, 'question')
  if (!id || !question) return null
  return {
    id,
    header: stringMeta(record, 'header') ?? 'Input',
    question,
    options: Array.isArray(record.options)
      ? record.options.map(normalizeMetaOption).filter((option): option is UserInputQuestion['options'][number] => option != null)
      : []
  }
}

function normalizeMetaOption(raw: unknown): UserInputQuestion['options'][number] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const label = stringMeta(record, 'label')
  if (!label) return null
  return {
    label,
    description: stringMeta(record, 'description') ?? ''
  }
}

function approvalStatusFromItem(item: AgentRuntimeItem): ApprovalStatus {
  if (item.status === 'error' || item.status === 'failed' || item.status === 'aborted') return 'error'
  if (item.status === 'success' || item.status === 'completed') return 'allowed'
  return 'pending'
}

export function dispatchAgentRuntimeEvent(event: AgentRuntimeEvent, sink: ThreadEventSink): void {
  if (!shouldDispatchAgentRuntimeEvent(event, sink)) return
  performanceMonitor.count('runtime.event')
  performanceMonitor.count(`runtime.event.${event.kind}`)
  const deltaHandlesSeq =
    (event.kind === 'assistant_delta' || event.kind === 'reasoning_delta') &&
    (sink as ReplayAwareThreadEventSink)[AGENT_RUNTIME_DELTA_HANDLES_SEQ] === true
  if (eventAdvancesSeq(event) && !deltaHandlesSeq) sink.onSeq(event.seq)

  switch (event.kind) {
    case 'thread_lifecycle':
      sink.onThreadLifecycle?.({
        threadId: event.threadId,
        state: event.state,
        createdAt: event.createdAt
      })
      return
    case 'heartbeat':
      return
    case 'turn_lifecycle':
      if (sink.onTurnLifecycle) {
        sink.onTurnLifecycle({
          threadId: event.threadId,
          turnId: event.turnId,
          state: event.state,
          message: event.message,
          createdAt: event.createdAt
        })
        return
      }
      if (event.state === 'completed') sink.onTurnComplete()
      if (event.state !== 'completed' && isAgentRuntimeTerminalTurnState(event.state)) {
        sink.onError(new Error(`turn ${event.state}`))
        sink.onTurnComplete()
      }
      return
    case 'work_lifecycle':
      sink.onWorkLifecycle?.({
        threadId: event.threadId,
        workId: event.workId,
        state: event.state,
        ...(event.pendingChildren !== undefined ? { pendingChildren: event.pendingChildren } : {}),
        ...(event.reason !== undefined ? { reason: event.reason } : {}),
        createdAt: event.createdAt
      })
      return
    case 'runtime_status':
      sink.onRuntimeStatus?.(runtimeStatusFromEvent(event))
      return
    case 'user_message': {
      const meta = runtimeDisclosureMetaFromRecord({
        ...(event.meta ?? {}),
        ...(event.displayText !== undefined ? { displayText: event.displayText } : {})
      }, true)
      sink.onUserMessage({
        itemId: event.itemId,
        turnId: event.turnId,
        createdAt: event.createdAt,
        text: event.text,
        ...(meta ? { meta } : {})
      })
      return
    }
    case 'assistant_delta':
      sink.onDeltas([{ kind: 'agent_message', itemId: event.itemId, text: event.text, seq: event.seq }])
      return
    case 'reasoning_delta': {
      if (event.visibility === 'none') return
      const meta = reasoningDisclosureMeta({
        visibility: event.visibility,
        source: event.source
      })
      sink.onDeltas([{
        kind: 'agent_reasoning',
        itemId: event.itemId,
        text: event.text,
        seq: event.seq,
        ...(meta ? { meta } : {})
      }])
      return
    }
    case 'item_snapshot':
      dispatchItemSnapshot(event, sink)
      return
    case 'tool_event':
      sink.onTool(toolEventFromRuntime(event))
      return
    case 'approval_requested':
      {
        const meta = runtimeDisclosureMetaFromRecord(event.meta)
        const payload: ApprovalRequestPayload = {
          approvalId: event.approvalId,
          summary: event.summary,
          toolName: event.toolName,
          status: 'pending',
          ...(meta ? { meta } : {})
        }
        sink.onApproval(payload)
      }
      return
    case 'approval_resolved': {
      const payload: ApprovalRequestPayload = {
        approvalId: event.approvalId,
        summary: event.message?.trim() || `Approval ${event.decision}`,
        status: event.decision,
        ...(event.decision === 'error' && event.message ? { errorMessage: event.message } : {})
      }
      sink.onApproval(payload)
      return
    }
    case 'user_input_requested':
      sink.onUserInput({
        itemId: event.itemId ?? event.requestId,
        requestId: event.requestId,
        questions: event.questions.map(normalizeUserInputQuestion)
      })
      return
    case 'user_input_resolved':
      sink.onUserInputStatus({
        itemId: event.itemId ?? event.requestId,
        status: event.status,
        answers: userInputAnswers(event.answers),
        errorMessage: event.status === 'error' ? event.message : undefined
      })
      return
    case 'compaction_event':
      sink.onCompaction(compactionFromEvent(event))
      return
    case 'handoff_event':
      sink.onRuntimeStatus?.(handoffStatusFromEvent(event))
      return
    case 'review_event':
      sink.onReview?.(reviewFromEvent(event))
      return
    case 'goal_event':
      sink.onGoal({
        threadId: event.threadId,
        goal: goalFromEvent(event),
        cleared: event.cleared,
        createdAt: event.createdAt
      })
      return
    case 'todo_event':
      sink.onTodos?.({
        threadId: event.threadId,
        todos: todosFromEvent(event),
        cleared: event.cleared,
        createdAt: event.createdAt
      })
      return
    case 'child_event':
      sink.onChild?.({
        threadId: event.threadId,
        turnId: event.turnId,
        seq: event.seq,
        createdAt: event.createdAt,
        child: event.child,
        message: event.message
      })
      return
    case 'usage':
      sink.onUsage?.(usageFromRuntime(event.usage))
      return
    case 'error':
      sink.onRuntimeError?.({
        itemId: event.itemId ?? `runtime_error_${stableEventKey(event)}`,
        createdAt: event.createdAt,
        message: event.message,
        code: event.code,
        details: event.detail,
        severity: event.severity
      })
      return
    default: {
      const neverEvent: never = event
      return neverEvent
    }
  }
}

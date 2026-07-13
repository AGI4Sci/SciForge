import { randomUUID } from 'node:crypto'
import type {
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeItem,
  AgentRuntimeModelAuditModelRouterSummary,
  AgentRuntimeModelAuditRequestBodySummary,
  AgentRuntimeModelAuditRequestSummary,
  AgentRuntimeModelAuditRecord,
  AgentRuntimeModelAuditToolCall,
  AgentRuntimeTurnStartInput
} from '../../shared/agent-runtime-contract'

const DEFAULT_CAPACITY = 50
const MAX_TEXT_CHARS = 60_000
const MAX_FIELD_CHARS = 4_000
const SECRET_KEY_PATTERN = /(?:authorization|api[-_ ]?key|cookie|token|secret|password|credential)/i
const ABSOLUTE_PATH_PATTERN = /(?:[A-Za-z]:\\|\/(?:Users|home|Applications|Volumes|tmp|var|private)\/)[^\s"'`<>)]*/g
const INLINE_SECRET_PATTERNS: RegExp[] = [
  /\bAuthorization\s*[:=]\s*(?:(?:Bearer|Basic)\s+)?[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;&]+)/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/gi
]

export type ModelRequestAuditStartInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  model?: string
  provider?: string
  modelRouterUrl?: string
  providerAlias?: 'model-router'
  modelAlias?: string
  modelRouter?: {
    requestUrl: string
    endpointRoute: 'responses'
  }
  turnId?: string
  request: AgentRuntimeTurnStartInput
}

export class ModelRequestAuditRecorder {
  private readonly records: AgentRuntimeModelAuditRecord[] = []
  private readonly activeByKey = new Map<string, string>()

  constructor(private readonly capacity = DEFAULT_CAPACITY) {}

  start(input: ModelRequestAuditStartInput): string {
    const id = `audit_${Date.now()}_${randomUUID()}`
    const record: AgentRuntimeModelAuditRecord = {
      id,
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.modelRouterUrl ? { modelRouterUrl: redactString(input.modelRouterUrl) } : {}),
      ...(input.providerAlias ? { providerAlias: input.providerAlias } : {}),
      ...(input.modelAlias ? { modelAlias: input.modelAlias } : {}),
      ...(input.modelRouter ? { modelRouter: summarizeModelRouter(input.modelRouter, input.modelAlias ?? input.model ?? '', input.request) } : {}),
      startedAt: new Date().toISOString(),
      request: summarizeRequest(input.request),
      streamOutput: {
        text: '',
        reasoning: '',
        toolCalls: []
      }
    }
    this.records.unshift(record)
    this.trim()
    if (input.turnId) this.activeByKey.set(turnKey(input.runtimeId, input.threadId, input.turnId), id)
    return id
  }

  attachTurn(recordId: string, runtimeId: AgentRuntimeId, threadId: string, turnId: string): void {
    const record = this.records.find((item) => item.id === recordId)
    if (!record) return
    record.turnId = turnId
    this.activeByKey.set(turnKey(runtimeId, threadId, turnId), recordId)
  }

  fail(recordId: string, error: unknown): void {
    const record = this.records.find((item) => item.id === recordId)
    if (!record) return
    record.streamOutput.error = redactString(error instanceof Error ? error.message : String(error))
    this.finish(record, 'error')
  }

  observeEvent(event: AgentRuntimeEvent): void {
    const runtimeId = event.runtimeId
    const turnId = event.turnId
    if (!runtimeId || !turnId) return
    const record = this.recordFor(runtimeId, event.threadId, turnId)
    if (!record) return

    switch (event.kind) {
      case 'assistant_delta':
        record.streamOutput.text = appendText(record.streamOutput.text, event.text)
        return
      case 'reasoning_delta':
        record.streamOutput.reasoning = appendText(record.streamOutput.reasoning, event.text)
        return
      case 'tool_event':
        {
          const meta = event.meta
        record.streamOutput.toolCalls = mergeToolCall(record.streamOutput.toolCalls, {
          callId: event.callId ?? stringMeta(meta, 'callId') ?? event.itemId,
          toolName: event.toolName ?? stringMeta(meta, 'toolName') ?? event.summary ?? 'tool',
          status: event.status,
          arguments: redactValue(meta?.arguments ?? meta),
          ...(meta?.output !== undefined || meta?.result !== undefined
            ? { result: redactValue(meta.output ?? meta.result) }
            : {}),
          ...(event.phase ?? stringMeta(meta, 'phase')
            ? { phase: (event.phase ?? stringMeta(meta, 'phase')) as AgentRuntimeModelAuditToolCall['phase'] }
            : {}),
          ...(event.factSource ?? stringMeta(meta, 'factSource')
            ? { factSource: (event.factSource ?? stringMeta(meta, 'factSource')) as AgentRuntimeModelAuditToolCall['factSource'] }
            : {}),
          ...(event.evidenceStrength ?? stringMeta(meta, 'evidenceStrength')
            ? { evidenceStrength: (event.evidenceStrength ?? stringMeta(meta, 'evidenceStrength')) as AgentRuntimeModelAuditToolCall['evidenceStrength'] }
            : {}),
          ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
          ...(event.resultDigest ? { resultDigest: event.resultDigest } : {}),
          ...(event.errorCode ? { errorCode: event.errorCode } : {})
        })
        return
        }
      case 'item_snapshot':
        if (event.item.kind === 'tool') {
          record.streamOutput.toolCalls = mergeToolCall(record.streamOutput.toolCalls, toolCallFromItem(event.item))
        }
        return
      case 'runtime_status': {
        const stopReason = stringMeta(event.metadata, 'stopReason') ?? stringMeta(event.metadata, 'finishReason')
        if (stopReason) record.streamOutput.stopReason = redactString(stopReason)
        return
      }
      case 'usage':
        record.streamOutput.usage = event.usage
        return
      case 'turn_lifecycle':
        if (event.state === 'completed') this.finish(record, 'completed')
        if (event.state === 'failed' || event.state === 'aborted') {
          record.streamOutput.error = redactString(event.message ?? event.state)
          this.finish(record, event.state)
        }
        return
      case 'error':
        record.streamOutput.error = redactString(event.message)
        this.finish(record, 'error')
        return
      default:
        return
    }
  }

  snapshot(input?: {
    runtimeId?: AgentRuntimeId
    threadId?: string
    limit?: number
  }): AgentRuntimeModelAuditRecord[] {
    const limit = Math.max(1, Math.min(input?.limit ?? this.capacity, this.capacity))
    return this.records
      .filter((record) => !input?.runtimeId || record.runtimeId === input.runtimeId)
      .filter((record) => !input?.threadId || record.threadId === input.threadId)
      .slice(0, limit)
      .map((record) => structuredClone(record))
  }

  clear(): boolean {
    this.records.length = 0
    this.activeByKey.clear()
    return true
  }

  private recordFor(runtimeId: AgentRuntimeId, threadId: string, turnId: string): AgentRuntimeModelAuditRecord | null {
    const id = this.activeByKey.get(turnKey(runtimeId, threadId, turnId))
    return this.records.find((record) => record.id === id) ?? null
  }

  private finish(record: AgentRuntimeModelAuditRecord, stopReason: string): void {
    if (!record.finishedAt) {
      record.finishedAt = new Date().toISOString()
      record.durationMs = Math.max(0, Date.parse(record.finishedAt) - Date.parse(record.startedAt))
    }
    record.streamOutput.stopReason = record.streamOutput.stopReason ?? stopReason
    if (record.turnId) this.activeByKey.delete(turnKey(record.runtimeId, record.threadId, record.turnId))
  }

  private trim(): void {
    while (this.records.length > this.capacity) {
      const removed = this.records.pop()
      if (removed?.turnId) this.activeByKey.delete(turnKey(removed.runtimeId, removed.threadId, removed.turnId))
    }
  }
}

function turnKey(runtimeId: AgentRuntimeId, threadId: string, turnId: string): string {
  return `${runtimeId}:${threadId}:${turnId}`
}

function appendText(current: string, next: string): string {
  return `${current}${redactString(next)}`.slice(-MAX_TEXT_CHARS)
}

function summarizeModelRouter(
  modelRouter: NonNullable<ModelRequestAuditStartInput['modelRouter']>,
  modelAlias: string,
  request: AgentRuntimeTurnStartInput
): AgentRuntimeModelAuditModelRouterSummary {
  return {
    providerAlias: 'model-router',
    modelAlias: redactString(modelAlias),
    requestUrl: redactString(modelRouter.requestUrl),
    endpointRoute: modelRouter.endpointRoute,
    requestBodySummary: summarizeModelRouterRequestBody(request)
  }
}

function summarizeRequest(request: AgentRuntimeTurnStartInput): AgentRuntimeModelAuditRequestSummary {
  const summary = {
    text: summarizePrompt(request.text),
    displayText: summarizePrompt(request.displayText),
    workspace: request.workspace,
    metadata: request.metadata,
    mode: request.mode,
    model: request.model,
    reasoningEffort: request.reasoningEffort,
    attachmentIds: request.attachmentIds,
    fileReferences: request.fileReferences?.map((reference) => ({
      relativePath: reference.relativePath,
      name: reference.name,
      kind: reference.kind,
      mimeType: reference.mimeType,
      delivery: reference.delivery,
      modelRouterObject: reference.modelRouterObject
    }))
  }
  return redactValue({
    ...summary,
    bodySummary: summarizeRequestBody(request, summary)
  }) as AgentRuntimeModelAuditRequestSummary
}

function summarizeModelRouterRequestBody(request: AgentRuntimeTurnStartInput): AgentRuntimeModelAuditModelRouterSummary['requestBodySummary'] {
  const fileReferences = request.fileReferences ?? []
  const metadataKeys = [
    request.runtimeId ? 'runtimeId' : '',
    request.threadId ? 'threadId' : '',
    request.metadata ? 'metadata' : '',
    request.workspace ? 'workspace' : '',
    request.mode ? 'mode' : '',
    request.reasoningEffort ? 'reasoningEffort' : '',
    request.governanceProfile ? 'governanceProfile' : '',
    request.guiPlan ? 'guiPlan' : '',
    request.attachmentIds?.length ? 'attachmentIds' : '',
    fileReferences.length ? 'fileReferences' : ''
  ].filter(Boolean).sort()
  const bodyShape = {
    model: request.model ? '[alias]' : undefined,
    input: request.text ? '[text]' : undefined,
    metadata: metadataKeys.length ? Object.fromEntries(metadataKeys.map((key) => [key, true])) : undefined
  }
  return {
    schema: 'model-router.responses.runtime',
    keys: Object.entries(bodyShape)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)
      .sort(),
    inputTextChars: request.text.length,
    ...(request.displayText ? { displayTextChars: request.displayText.length } : {}),
    metadataKeys,
    attachmentCount: request.attachmentIds?.length ?? 0,
    fileReferenceCount: fileReferences.length,
    inlineContextReferenceCount: fileReferences.filter((reference) => reference.delivery !== 'model_router_object').length,
    modelRouterObjectReferenceCount: fileReferences.filter((reference) => {
      return reference.delivery === 'model_router_object' || reference.modelRouterObject === true
    }).length,
    hasGuiPlan: Boolean(request.guiPlan),
    estimatedJsonChars: JSON.stringify(bodyShape).length
  }
}

function summarizeRequestBody(
  request: AgentRuntimeTurnStartInput,
  redactedSummary: Omit<AgentRuntimeModelAuditRequestSummary, 'bodySummary'>
): AgentRuntimeModelAuditRequestBodySummary {
  const fileReferences = request.fileReferences ?? []
  return {
    schema: 'agent-runtime.turnStart',
    keys: Object.entries(request)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)
      .sort(),
    textChars: request.text.length,
    ...(request.displayText ? { displayTextChars: request.displayText.length } : {}),
    attachmentCount: request.attachmentIds?.length ?? 0,
    fileReferenceCount: fileReferences.length,
    inlineContextReferenceCount: fileReferences.filter((reference) => reference.delivery !== 'model_router_object').length,
    modelRouterObjectReferenceCount: fileReferences.filter((reference) => {
      return reference.delivery === 'model_router_object' || reference.modelRouterObject === true
    }).length,
    hasGuiPlan: Boolean(request.guiPlan),
    estimatedJsonChars: JSON.stringify(redactedSummary).length
  }
}

function toolCallFromItem(item: AgentRuntimeItem): AgentRuntimeModelAuditToolCall {
  const meta = item.meta
  return {
    callId: stringMeta(meta, 'callId') ?? item.id,
    toolName: stringMeta(meta, 'toolName') ?? item.summary ?? 'tool',
    status: auditToolStatus(item.status),
    arguments: redactValue(meta?.arguments ?? meta),
    ...(meta?.output !== undefined || meta?.result !== undefined
      ? { result: redactValue(meta.output ?? meta.result) }
      : {}),
    ...(stringMeta(meta, 'phase')
      ? { phase: stringMeta(meta, 'phase') as AgentRuntimeModelAuditToolCall['phase'] }
      : {}),
    ...(stringMeta(meta, 'factSource')
      ? { factSource: stringMeta(meta, 'factSource') as AgentRuntimeModelAuditToolCall['factSource'] }
      : {}),
    ...(stringMeta(meta, 'evidenceStrength')
      ? { evidenceStrength: stringMeta(meta, 'evidenceStrength') as AgentRuntimeModelAuditToolCall['evidenceStrength'] }
      : {}),
    ...(typeof meta?.attempt === 'number' ? { attempt: meta.attempt } : {}),
    ...(stringMeta(meta, 'resultDigest') ? { resultDigest: stringMeta(meta, 'resultDigest') } : {}),
    ...(stringMeta(meta, 'errorCode') ? { errorCode: stringMeta(meta, 'errorCode') } : {})
  }
}

function auditToolStatus(status: AgentRuntimeItem['status']): AgentRuntimeModelAuditToolCall['status'] {
  if (status === 'success' || status === 'completed') return 'success'
  if (status === 'error' || status === 'failed' || status === 'aborted') return 'error'
  if (status === 'running' || status === 'pending') return 'running'
  return undefined
}

function mergeToolCall(
  calls: AgentRuntimeModelAuditToolCall[],
  next: AgentRuntimeModelAuditToolCall
): AgentRuntimeModelAuditToolCall[] {
  const index = calls.findIndex((call) => call.callId && call.callId === next.callId)
  if (index === -1) return [...calls, next].slice(-100)
  const merged = [...calls]
  const current = merged[index]
  const nextName = next.toolName === 'tool' ? undefined : next.toolName
  const keepCurrentTerminal = isTerminalAuditPhase(current.phase) && !isTerminalAuditPhase(next.phase)
  merged[index] = {
    ...current,
    ...next,
    toolName: nextName ?? current.toolName,
    arguments: current.arguments ?? next.arguments,
    ...(keepCurrentTerminal
      ? { status: current.status, phase: current.phase, factSource: current.factSource, evidenceStrength: current.evidenceStrength }
      : {})
  }
  return merged
}

function isTerminalAuditPhase(phase: AgentRuntimeModelAuditToolCall['phase']): boolean {
  return phase === 'succeeded' || phase === 'failed' || phase === 'cancelled' || phase === 'unresolved'
}

function stringMeta(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function summarizePrompt(value: string | undefined): string | undefined {
  if (!value) return undefined
  return redactString(value.length > MAX_FIELD_CHARS ? `${value.slice(0, MAX_FIELD_CHARS)}...[truncated]` : value)
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.slice(0, 100).map(redactValue)
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redactValue(raw)
  }
  return output
}

function redactString(value: string): string {
  const hiddenSecrets = INLINE_SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, '[redacted]'),
    value
  )
  const hiddenPaths = hiddenSecrets.replace(ABSOLUTE_PATH_PATTERN, '[path]')
  return hiddenPaths.length > MAX_TEXT_CHARS
    ? `${hiddenPaths.slice(0, MAX_TEXT_CHARS)}...[truncated]`
    : hiddenPaths
}

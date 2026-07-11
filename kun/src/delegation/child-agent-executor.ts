import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { TurnItem } from '../contracts/items.js'
import type { ApprovalPolicy, SandboxMode } from '../contracts/policy.js'
import type { RuntimeTuningConfig } from '../config/kun-config.js'
import { redactSecrets, redactSecretText } from '../config/secret-redaction.js'
import { AgentLoop } from '../loop/agent-loop.js'
import type { ContextCompactionConfig, ModelConfig } from '../loop/model-context-profile.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import type { TokenEconomyConfig } from '../loop/token-economy.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ModelClient } from '../ports/model-client.js'
import { RandomIdGenerator } from '../ports/id-generator.js'
import type { ToolHost } from '../ports/tool-host.js'
import type { SkillRuntime } from '../skills/skill-runtime.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ThreadService } from '../services/thread-service.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import type { ChildRunExecutor, ChildRunTranscriptEntry } from '@sciforge/multi-agent'

export type ChildAgentExecutorOptions = {
  model: ModelClient
  toolHost: ToolHost
  prefix: ImmutablePrefix
  defaultModel: string
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  tokenEconomy?: TokenEconomyConfig
  runtime?: RuntimeTuningConfig
  nowIso?: () => string
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
  skillRuntime?: SkillRuntime
  memoryStore?: MemoryStore
}

export const DEFAULT_CHILD_MAX_TURN_MODEL_STEPS = 512

export function resolveChildMaxTurnModelSteps(runtime: RuntimeTuningConfig | undefined): number {
  const configured = runtime?.maxTurnModelSteps
  return Math.max(
    typeof configured === 'number' && Number.isFinite(configured) ? Math.trunc(configured) : 0,
    DEFAULT_CHILD_MAX_TURN_MODEL_STEPS
  )
}

function childToolStormOptions(
  runtime: RuntimeTuningConfig | undefined,
  maxToolCalls: number | undefined
): (NonNullable<RuntimeTuningConfig['toolStorm']> & { maxToolCallsPerTurn?: number }) | undefined {
  if (!runtime?.toolStorm && maxToolCalls === undefined) return undefined
  return {
    ...(runtime?.toolStorm ?? {}),
    ...(maxToolCalls !== undefined ? { maxToolCallsPerTurn: maxToolCalls } : {})
  }
}

export function createChildAgentExecutor(options: ChildAgentExecutorOptions): ChildRunExecutor {
  return async (input) => {
    const nowIso = options.nowIso ?? (() => new Date().toISOString())
    const eventBus = new InMemoryEventBus()
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const usage = new UsageService()
    const ids = new RandomIdGenerator()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const compactor = new ContextCompactor({
      contextCompaction: options.contextCompaction,
      models: options.models
    })
    const toolStorm = childToolStormOptions(options.runtime, input.maxToolCalls)
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor,
      ids,
      nowIso
    })
    const threads = new ThreadService({
      threadStore,
      sessionStore,
      events,
      ids,
      nowIso
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new InMemoryApprovalGate(),
      userInputGate: new InMemoryUserInputGate(),
      model: options.model,
      toolHost: options.toolHost,
      usage,
      events,
      turns,
      inflight,
      steering,
      compactor,
      prefix: options.prefix,
      ids,
      nowIso,
      ...(options.modelCapabilities ? { modelCapabilities: options.modelCapabilities } : {}),
      ...(options.skillRuntime ? { skillRuntime: options.skillRuntime } : {}),
      ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
      ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
      ...(options.tokenEconomy ? { tokenEconomy: options.tokenEconomy } : {}),
      maxTurnModelSteps: resolveChildMaxTurnModelSteps(options.runtime),
      ...(toolStorm ? { toolStorm } : {}),
      ...(options.runtime?.toolBudget ? { toolBudget: options.runtime.toolBudget } : {}),
      ...(options.runtime?.parallelism ? { parallelism: options.runtime.parallelism } : {}),
      ...(options.runtime?.toolArgumentRepair ? { toolArgumentRepair: options.runtime.toolArgumentRepair } : {})
    })

    const model = input.model?.trim() || options.defaultModel
    const thread = await threads.create({
      title: childThreadTitle(input.childId, input.label),
      workspace: input.workspace?.trim() || '~',
      model,
      mode: 'agent',
      approvalPolicy: options.approvalPolicy ?? 'auto',
      ...(options.sandboxMode ? { sandboxMode: options.sandboxMode } : {})
    }, {
      id: input.childId,
      title: childThreadTitle(input.childId, input.label)
    })
    const started = await turns.startTurn({
      threadId: thread.id,
      request: {
        prompt: input.prompt,
        model,
        mode: 'agent',
        ...(input.allowedToolNames ? { allowedToolNames: [...input.allowedToolNames] } : {}),
        ...(input.strictAllowedToolNames !== undefined ? { strictAllowedToolNames: input.strictAllowedToolNames } : {}),
        ...(input.bashCommandPolicy ? { bashCommandPolicy: input.bashCommandPolicy } : {}),
        ...(input.filePathPolicy ? { filePathPolicy: input.filePathPolicy } : {})
      }
    })
    let parentAbortHandler: (() => void) | undefined
    if (input.signal) {
      const abortChildTurn = () => {
        void turns.interruptTurn({
          threadId: thread.id,
          turnId: started.turnId,
          discard: false
        }).catch(() => undefined)
      }
      if (input.signal.aborted) {
        abortChildTurn()
      } else {
        parentAbortHandler = abortChildTurn
        input.signal.addEventListener('abort', parentAbortHandler, { once: true })
      }
    }
    const seenTranscriptEntries = new Map<string, string>()
    let appendTranscriptChain = Promise.resolve()
    const appendChildTranscript = (entry: ChildRunTranscriptEntry) => {
      const fingerprint = JSON.stringify(entry)
      if (seenTranscriptEntries.get(entry.id) === fingerprint) return
      seenTranscriptEntries.set(entry.id, fingerprint)
      appendTranscriptChain = appendTranscriptChain
        .catch(() => undefined)
        .then(() => input.appendTranscript(entry))
    }
    const unsubscribe = eventBus.subscribe(thread.id, (event) => {
      const entry = transcriptEntryFromRuntimeEvent(event, started.turnId)
      if (!entry) return
      appendChildTranscript(entry)
    })
    let status: 'completed' | 'failed' | 'aborted'
    try {
      status = await loop.runTurn(thread.id, started.turnId)
    } finally {
      if (input.signal && parentAbortHandler) input.signal.removeEventListener('abort', parentAbortHandler)
      unsubscribe()
      await appendTranscriptChain.catch(() => undefined)
    }
    const childEvents = await sessionStore.loadEventsSince(thread.id, 0)
    const items = await sessionStore.loadItems(thread.id)
    const transcript = transcriptEntriesForChild(items, started.turnId)
    const summary = summarizeChildTurn(items, started.turnId, status)
    const threadUsage = usage.forThread(thread.id)
    const runtimeError = childEvents
      .filter((event) => event.kind === 'error' && event.turnId === started.turnId)
      .find((event) => event.kind === 'error' && event.severity !== 'warning' && event.severity !== 'info')
    const recoveredToolLoopFailure = isRecoverableToolLoopFailure({
      status,
      runtimeError,
      transcript
    })
    const internalMarkupFallbackSummary = summarizeCollectedToolResultsFallback({
      status,
      runtimeError,
      items,
      turnId: started.turnId,
      prompt: input.prompt
    })
    const recoveredInternalToolCallMarkupFailure = internalMarkupFallbackSummary.length > 0
    const effectiveSummary = internalMarkupFallbackSummary || summary
    if (runtimeError?.kind === 'error' && !recoveredToolLoopFailure && !recoveredInternalToolCallMarkupFailure) {
      throw childAgentFailure(runtimeError.message, transcript, threadUsage)
    }
    if (status !== 'completed' && !recoveredToolLoopFailure && !recoveredInternalToolCallMarkupFailure) {
      throw childAgentFailure(effectiveSummary || `child agent ${status}`, transcript, threadUsage)
    }
    if (isBlockedChildFinalText(effectiveSummary)) {
      throw childAgentFailure(
        effectiveSummary || 'child agent reported a blocker',
        transcript,
        threadUsage
      )
    }
    if (isPrematureChildClarification(effectiveSummary)) {
      throw childAgentFailure(
        'child agent stopped for clarification instead of completing the delegated task',
        transcript,
        threadUsage
      )
    }
    return {
      summary: effectiveSummary,
      usage: threadUsage,
      transcript
    }
  }
}

function childAgentFailure(
  message: string,
  transcript: ChildRunTranscriptEntry[],
  usage: ReturnType<UsageService['forThread']>
): Error {
  return Object.assign(new Error(message), {
    multiAgentTranscript: transcript,
    multiAgentUsage: usage
  })
}

function childThreadTitle(childId: string, label?: string): string {
  const suffix = label?.trim() || childId
  return `Child agent: ${suffix}`
}

function summarizeChildTurn(
  items: readonly TurnItem[],
  turnId: string,
  status: 'completed' | 'failed' | 'aborted'
): string {
  const turnItems = items.filter((item) => item.turnId === turnId)
  const assistantText = turnItems
    .filter((item): item is Extract<TurnItem, { kind: 'assistant_text' }> => item.kind === 'assistant_text')
    .map((item) => redactSecretText(item.text).trim())
    .filter((text) => !isInternalToolCallMarkup(text))
    .filter(Boolean)
    .join('\n\n')
    .trim()
  if (assistantText) return assistantText
  const errors = turnItems
    .filter((item): item is Extract<TurnItem, { kind: 'error' }> => item.kind === 'error')
    .map((item) => redactSecretText(item.message).trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  if (errors) return errors
  return status === 'completed'
    ? 'Child agent completed without a text response.'
    : `Child agent ${status}.`
}

function isRecoverableToolLoopFailure(input: {
  status: 'completed' | 'failed' | 'aborted'
  runtimeError: RuntimeEvent | undefined
  transcript: readonly ChildRunTranscriptEntry[]
}): boolean {
  if (input.status !== 'failed') return false
  if (input.runtimeError?.kind !== 'error') return false
  if (input.runtimeError.code !== 'tool_loop_recovery_exhausted') return false
  return input.transcript.some((entry) =>
    entry.kind === 'assistant_message' &&
    isUsefulChildFinalText(entry.text)
  )
}

type ToolResultDigest = {
  toolName: string
  title?: string
  url?: string
  text?: string
}

function summarizeCollectedToolResultsFallback(input: {
  status: 'completed' | 'failed' | 'aborted'
  runtimeError: RuntimeEvent | undefined
  items: readonly TurnItem[]
  turnId: string
  prompt: string
}): string {
  if (input.status !== 'failed') return ''
  if (input.runtimeError?.kind !== 'error') return ''
  if (input.runtimeError.code !== 'internal_tool_call_markup_recovery_exhausted') return ''

  const digests = usefulToolResultDigests(input.items, input.turnId)
  if (digests.length === 0) return ''

  const chinese = hasHanText(input.prompt)
  const sources = digests.slice(0, 10)
  const notes = digests.filter((digest) => digest.text).slice(0, 8)
  const omitted = digests.length - sources.length
  if (chinese) {
    return [
      '已收集到以下资料，供后续汇总使用：',
      '',
      '主要来源：',
      ...sources.map((source) => `- ${formatDigestSource(source)}`),
      ...(omitted > 0 ? [`- 另外还有 ${omitted} 条工具结果未展开。`] : []),
      ...(notes.length > 0
        ? ['', '摘录：', ...notes.map((note) => `- ${formatDigestNote(note)}`)]
        : [])
    ].join('\n')
  }

  return [
    'Collected research notes from available sources:',
    '',
    'Sources reviewed:',
    ...sources.map((source) => `- ${formatDigestSource(source)}`),
    ...(omitted > 0 ? [`- ${omitted} more tool result(s) omitted.`] : []),
    ...(notes.length > 0
      ? ['', 'Extracted notes:', ...notes.map((note) => `- ${formatDigestNote(note)}`)]
      : [])
  ].join('\n')
}

function usefulToolResultDigests(items: readonly TurnItem[], turnId: string): ToolResultDigest[] {
  const seen = new Set<string>()
  const digests: ToolResultDigest[] = []
  for (const item of items) {
    if (item.turnId !== turnId || item.kind !== 'tool_result' || item.isError) continue
    const digest = toolResultDigest(item.toolName, item.output)
    const key = [digest.toolName, digest.url, digest.title, digest.text].filter(Boolean).join('\n')
    if (!key || seen.has(key)) continue
    seen.add(key)
    digests.push(digest)
  }
  return digests
}

function toolResultDigest(toolName: string, output: unknown): ToolResultDigest {
  const record = output && typeof output === 'object'
    ? redactSecrets(output) as Record<string, unknown>
    : undefined
  const title = pickFirstString(record, ['title', 'name'])
  const source = firstSource(record)
  const url = pickFirstString(record, ['finalUrl', 'url']) || source?.url
  const text = pickFirstString(record, ['summary', 'description', 'snippet', 'text', 'content'])
  return {
    toolName,
    ...(title || source?.title ? { title: title || source?.title } : {}),
    ...(url ? { url } : {}),
    ...(text ? { text: compactText(text, 360) } : {})
  }
}

function firstSource(record: Record<string, unknown> | undefined): { title?: string; url?: string } | undefined {
  const sources = record?.sources
  if (!Array.isArray(sources)) return undefined
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    const raw = source as Record<string, unknown>
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined
    const url = typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : undefined
    if (title || url) return { ...(title ? { title } : {}), ...(url ? { url } : {}) }
  }
  return undefined
}

function pickFirstString(record: Record<string, unknown> | undefined, fields: readonly string[]): string | undefined {
  if (!record) return undefined
  for (const field of fields) {
    const entry = record[field]
    if (typeof entry === 'string' && entry.trim()) return entry.trim()
  }
  return undefined
}

function formatDigestSource(digest: ToolResultDigest): string {
  const label = digest.title || digest.url || digest.toolName
  if (digest.url && digest.title) return `${label} (${digest.url})`
  if (digest.url && !digest.title) return `${digest.toolName}: ${digest.url}`
  return `${digest.toolName}: ${label}`
}

function formatDigestNote(digest: ToolResultDigest): string {
  const label = digest.title || digest.url || digest.toolName
  return `${label}: ${digest.text ?? ''}`.trim()
}

function hasHanText(text: string | undefined): boolean {
  return /[\u3400-\u9fff]/.test(text ?? '')
}

function isUsefulChildFinalText(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? ''
  if (trimmed.length < 40) return false
  if (/^```json\s*\{\s*"type"\s*:\s*"final_answer"\s*,\s*"content"\s*:\s*""/i.test(trimmed)) return false
  if (/^(done|completed|finished|ok|okay|cannot continue|i'?m stuck)\.?$/i.test(trimmed)) return false
  if (/^Tool loop recovery failed:/i.test(trimmed)) return false
  return true
}

export function isBlockedChildFinalText(text: string | undefined): boolean {
  const normalized = normalizedChildFinalText(text)
  if (!/^CHILD_AGENT_BLOCKED\b/i.test(normalized)) return false
  return !hasSelfCorrectedBlocker(normalized)
}

function normalizedChildFinalText(text: string | undefined): string {
  return (text?.trim() ?? '')
    .replace(/^(?:[#>*_\-\s`])+/g, '')
    .replace(/^(?:\*\*)?CHILD_AGENT_BLOCKED(?:\*\*)?/i, 'CHILD_AGENT_BLOCKED')
}

function hasSelfCorrectedBlocker(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  if (!/\b(?:actually|not blocked|no longer blocked|completed after all|successfully completed|误判|已完成)\b/i.test(firstLine)) {
    return false
  }
  if (!/\b(?:deliverable|verified|completed|complete|created|written|wrote|successfully|输出|完成|已写入|已生成)\b/i.test(text)) {
    return false
  }
  return /(?:^|\s)(?:outputs\/|reports\/|tables\/|figures\/|scripts\/|\/[^\s`'")]+\/[^\s`'")]+)\S*/m.test(text)
}

export function isPrematureChildClarification(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? ''
  if (trimmed.length < 20) return false
  if (isBlockedChildFinalText(trimmed)) return false

  const asksForNextInstruction = [
    /\bwhat would you like me to\b/i,
    /\bhow would you like me to\b/i,
    /\bwould you like me to\b/i,
    /\bdo you want me to\b/i,
    /\bshould i\b.{0,80}\b(?:edit|write|continue|proceed|revise|add|check)\b/i,
    /\bplease let me know\b.{0,120}\b(?:next|how to proceed|what to do|which option)\b/i,
    /请问.{0,40}(?:需要|希望).{0,20}我.{0,20}(?:做|修改|补充|继续|检查|润色)/,
    /请告诉我.{0,40}(?:想要|需要|希望).{0,20}我.{0,20}(?:做|修改|补充|继续|检查|润色)/,
    /你.{0,20}(?:需要|希望).{0,20}我.{0,20}(?:做|修改|补充|继续|检查|润色)/,
    /需要我.{0,30}(?:做什么|继续|修改|补充|润色|检查)/,
    /我可以.{0,40}(?:润色|修改|补充|检查|继续|添加)/
  ]
  if (!asksForNextInstruction.some((pattern) => pattern.test(trimmed))) return false

  return /[?？]/.test(trimmed) || /(?:例如|for example|options include)/i.test(trimmed)
}

function stringifySummary(value: unknown): string {
  if (typeof value === 'string') return redactSecretText(value).trim()
  if (value == null) return ''
  try {
    return redactSecretText(JSON.stringify(redactSecrets(value)))
  } catch {
    return redactSecretText(String(value))
  }
}

function transcriptEntriesForChild(
  items: readonly TurnItem[],
  turnId: string
): ChildRunTranscriptEntry[] {
  return items
    .filter((item) => item.turnId === turnId)
    .map((item) => transcriptEntryFromItem(item))
    .filter((entry): entry is ChildRunTranscriptEntry => entry != null)
}

function transcriptEntryFromRuntimeEvent(
  event: RuntimeEvent,
  turnId: string
): ChildRunTranscriptEntry | null {
  if (event.turnId !== turnId) return null
  switch (event.kind) {
    case 'item_created':
    case 'item_updated':
    case 'item_completed':
    case 'tool_call_started':
    case 'tool_call_finished':
      return transcriptEntryFromItem(event.item)
    default:
      return null
  }
}

function transcriptEntryFromItem(item: TurnItem): ChildRunTranscriptEntry | null {
  const base = {
    id: item.id,
    createdAt: item.createdAt,
    ...(item.status ? { status: item.status } : {})
  }
  switch (item.kind) {
    case 'user_message':
      return {
        ...base,
        kind: 'user_message',
        text: redactSecretText(item.displayText?.trim() || item.text)
      }
    case 'assistant_text':
      if (isInternalToolCallMarkup(item.text)) return null
      return {
        ...base,
        kind: 'assistant_message',
        text: redactSecretText(item.text)
      }
    case 'assistant_reasoning':
      return {
        ...base,
        kind: 'reasoning',
        text: redactSecretText(item.text)
      }
    case 'tool_call':
      return {
        ...base,
        kind: 'tool',
        summary: item.summary ?? toolCallSummary(item.toolName, item.arguments),
        metadata: {
          phase: 'call',
          toolName: item.toolName,
          callId: item.callId,
          toolKind: item.toolKind,
          ...toolPayloadMetadata(item.arguments)
        }
      }
    case 'tool_result':
      return {
        ...base,
        kind: 'tool',
        summary: toolResultSummary(item.toolName, item.output, item.isError),
        ...(item.isError ? { text: summarizeToolPayload(item.output, 320) } : {}),
        metadata: {
          phase: 'result',
          toolName: item.toolName,
          callId: item.callId,
          toolKind: item.toolKind,
          isError: item.isError,
          ...toolPayloadMetadata(item.output)
        }
      }
    case 'approval':
      return {
        ...base,
        kind: 'event',
        summary: redactSecretText(item.summary),
        text: redactSecretText(item.summary),
        metadata: {
          approvalId: item.approvalId,
          toolName: item.toolName
        }
      }
    case 'user_input':
      return {
        ...base,
        kind: 'event',
        text: redactSecretText(item.prompt),
        metadata: {
          inputId: item.inputId,
          questions: redactSecrets(item.questions)
        }
      }
    case 'compaction':
      return {
        ...base,
        kind: 'system',
        text: redactSecretText(item.summary),
        metadata: {
          replacedTokens: item.replacedTokens,
          pinnedConstraints: item.pinnedConstraints.map(redactSecretText)
        }
      }
    case 'review':
      return {
        ...base,
        kind: 'assistant_message',
        summary: redactSecretText(item.title),
        text: item.reviewText ? redactSecretText(item.reviewText) : stringifySummary(item.output)
      }
    case 'error':
      return {
        ...base,
        kind: 'event',
        text: redactSecretText(item.message),
        status: item.status,
        metadata: {
          ...(item.code ? { code: item.code } : {}),
          ...(item.severity ? { severity: item.severity } : {}),
          ...(item.details !== undefined ? { details: redactSecrets(item.details) } : {})
        }
      }
    default:
      return null
  }
}

function isInternalToolCallMarkup(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? ''
  if (!trimmed) return false
  return /DSML/i.test(trimmed) && /tool_calls/i.test(trimmed) && /invoke\s+name=/i.test(trimmed)
}

function toolCallSummary(toolName: string, args: unknown): string {
  const payload = summarizeToolPayload(args, 140)
  return payload ? `${toolName}: ${payload}` : `${toolName}: call`
}

function toolResultSummary(toolName: string, output: unknown, isError: boolean): string {
  const payload = summarizeToolPayload(output, 140)
  const suffix = payload ? `: ${payload}` : isError ? ' failed' : ': result'
  return isError && payload ? `${toolName} failed: ${payload}` : `${toolName}${suffix}`
}

function summarizeToolPayload(value: unknown, maxLength: number): string {
  const extracted = extractToolPayloadSummary(value)
  const text = extracted || stringifySummary(value)
  return compactText(text, maxLength)
}

function extractToolPayloadSummary(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const record = redactSecrets(value) as Record<string, unknown>
  const fields = ['url', 'finalUrl', 'title', 'query', 'path', 'file_path', 'pattern', 'command', 'error']
  const parts = fields
    .map((field) => {
      const entry = record[field]
      return typeof entry === 'string' && entry.trim() ? entry.trim() : ''
    })
    .filter(Boolean)
  if (parts.length > 0) return parts.join(' · ')

  const nestedResult = record.result
  if (nestedResult && typeof nestedResult === 'object') {
    const nested = nestedResult as Record<string, unknown>
    const content = nested.content
    if (Array.isArray(content)) {
      const firstText = content
        .map((entry) => entry && typeof entry === 'object' ? (entry as Record<string, unknown>).text : undefined)
        .find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      if (firstText) return firstText.trim()
    }
  }

  const original = record.original
  if (original && typeof original === 'object') return extractToolPayloadSummary(original)
  return ''
}

function toolPayloadMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  const record = redactSecrets(value) as Record<string, unknown>
  const metadata: Record<string, unknown> = {}
  for (const key of ['url', 'finalUrl', 'title', 'query', 'path', 'file_path', 'pattern', 'command']) {
    const entry = record[key]
    if (typeof entry === 'string' && entry.trim()) metadata[key] = entry.trim()
  }
  const sources = record.sources
  if (Array.isArray(sources)) {
    const compactSources = sources
      .map((source) => {
        if (!source || typeof source !== 'object') return null
        const raw = source as Record<string, unknown>
        const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined
        const url = typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : undefined
        return title || url ? { ...(title ? { title } : {}), ...(url ? { url } : {}) } : null
      })
      .filter((source): source is { title?: string; url?: string } => source !== null)
    if (compactSources.length > 0) metadata.sources = compactSources
  }
  return metadata
}

function compactText(text: string, maxLength: number): string {
  const compact = redactSecretText(text).replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`
}

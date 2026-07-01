import { getActiveAgentRuntime, type AgentRuntimeId } from '@shared/app-settings'
import type {
  AgentRuntimeAuxiliaryOperation,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeHandoffStartResult,
  AgentRuntimeItem,
  AgentRuntimeListThreadChildrenResponse,
  AgentRuntimeMemoryRecord,
  AgentRuntimeReadChildTranscriptInput,
  AgentRuntimeReadChildTranscriptResponse,
  AgentRuntimeThreadRelation,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeUsage
} from '@shared/agent-runtime-contract'
import {
  createDefaultAgentRuntimeCapabilities,
  isAgentRuntimeActiveTurnState,
  isAgentRuntimeTerminalTurnState,
  normalizeAgentRuntimeTurnState
} from '@shared/agent-runtime-contract'
import { runtimeErrorToError } from '@shared/runtime-error'
import { agentRuntimeClient } from './agent-runtime-client'
import {
  agentRuntimeEventBelongsToThread,
  dispatchAgentRuntimeEvent
} from './agent-runtime-event-dispatcher'
import { rendererRuntimeClient } from './runtime-client'
import type {
  AgentProvider,
  ChatBlock,
  CompactionBlock,
  NormalizedThread,
  ReviewBlock,
  RuntimeDisclosureMetadata,
  ThreadEventSink,
  ThreadUsageSnapshot,
  ToolBlock,
  UserInputAnswer,
  UserInputQuestion
} from './types'
import type { LocalRuntimeMemoryRecordJson } from './local-runtime-contract'
import { getDisplayThreadTitle } from '../lib/thread-title'

type LegacyCapabilities = ReturnType<AgentProvider['getCapabilities']>
type SendUserMessageOptions = NonNullable<Parameters<AgentProvider['sendUserMessage']>[2]>
type InteractionRequestRef = {
  threadId: string
  runtimeId: AgentRuntimeId
  requestId?: string
}

function defaultCapabilities(runtimeId: AgentRuntimeId = 'sciforge'): AgentRuntimeCapabilities {
  return createDefaultAgentRuntimeCapabilities({
    runtimeId,
    transport: runtimeId === 'sciforge'
      ? 'http_sse'
      : runtimeId === 'claude'
        ? 'cli_process'
        : 'jsonrpc_stdio'
  })
}

function legacyCapabilities(capabilities: AgentRuntimeCapabilities): LegacyCapabilities {
  return {
    interrupt: capabilities.controls.interrupt,
    stream: capabilities.events.live,
    approvals: capabilities.controls.approval === 'sync' || capabilities.controls.approval === 'async',
    attachFiles: capabilities.storage.attachments.available,
    review: capabilities.controls.review === true,
    compact: capabilities.controls.compact === 'native' || capabilities.controls.compact === 'noop',
    fork: capabilities.controls.fork === true,
    steer: capabilities.controls.steer === true,
    goals: capabilities.controls.goals === true,
    todos: capabilities.controls.todos === true,
    skills: capabilities.tools.skills.available === true,
    checkpoints: capabilities.storage.checkpoints?.available === true,
    sideConversations: capabilities.controls.fork === true
  }
}

function turnOptionsForRuntime(runtimeId: AgentRuntimeId, options: SendUserMessageOptions): SendUserMessageOptions {
  if (runtimeId !== 'claude') return options
  const { model: _model, ...rest } = options
  return rest
}

function unresolvedInteraction(feature: string, requestId: string): Error {
  return runtimeErrorToError({
    code: 'capability_unavailable',
    message: `Agent runtime provider cannot resolve ${feature} without a neutral thread mapping.`,
    details: { feature, requestId }
  })
}

function unresolvedThreadRuntime(threadId: string): Error {
  return runtimeErrorToError({
    code: 'capability_unavailable',
    message: `Agent runtime provider cannot route thread-bound operation without a known thread runtime: ${threadId}.`,
    details: { feature: 'thread_runtime', threadId }
  })
}

function normalizeThread(thread: AgentRuntimeThread): NormalizedThread {
  const normalized = {
    id: thread.id,
    runtimeId: thread.runtimeId,
    title: thread.title,
    updatedAt: thread.updatedAt,
    model: thread.model ?? '',
    mode: thread.mode ?? '',
    workspace: thread.workspace,
    status: thread.status,
    archived: thread.archived,
    preview: thread.preview,
    latestTurnId: thread.latestTurnId,
    latestTurnStatus: thread.latestTurnStatus,
    relation: thread.relation,
    parentThreadId: thread.parentThreadId,
    forkedFromThreadId: thread.forkedFromThreadId,
    forkedFromTitle: thread.forkedFromTitle,
    forkedAt: thread.forkedAt,
    forkedFromMessageCount: thread.forkedFromMessageCount,
    forkedFromTurnCount: thread.forkedFromTurnCount,
    goal: thread.goal ?? null,
    todos: thread.todos ?? null
  }
  return {
    ...normalized,
    title: getDisplayThreadTitle(normalized)
  }
}

function disclosureMeta(meta: Record<string, unknown> | undefined): RuntimeDisclosureMetadata | undefined {
  if (!meta) return undefined
  const next: RuntimeDisclosureMetadata = {}
  if (typeof meta.displayText === 'string') next.displayText = meta.displayText
  if (typeof meta.source === 'string') next.source = meta.source
  if (typeof meta.sourceLabel === 'string') next.sourceLabel = meta.sourceLabel
  if (Array.isArray(meta.attachmentIds)) {
    const attachmentIds = meta.attachmentIds.filter((value): value is string => typeof value === 'string')
    if (attachmentIds.length) next.attachmentIds = attachmentIds
  }
  if (Array.isArray(meta.attachments)) {
    next.attachments = meta.attachments.filter(
      (value): value is NonNullable<RuntimeDisclosureMetadata['attachments']>[number] =>
        typeof value === 'object' && value !== null
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
      (value): value is NonNullable<RuntimeDisclosureMetadata['generatedFiles']>[number] =>
        typeof value === 'object' && value !== null
    )
  }
  if (Array.isArray(meta.activeSkillIds)) {
    const activeSkillIds = meta.activeSkillIds.filter((value): value is string => typeof value === 'string')
    if (activeSkillIds.length) next.activeSkillIds = activeSkillIds
  }
  if (Array.isArray(meta.injectedMemoryIds)) {
    const injectedMemoryIds = meta.injectedMemoryIds.filter((value): value is string => typeof value === 'string')
    if (injectedMemoryIds.length) next.injectedMemoryIds = injectedMemoryIds
  }
  if (typeof meta.skillInjectionBytes === 'number') next.skillInjectionBytes = meta.skillInjectionBytes
  return Object.keys(next).length ? next : undefined
}

function visibleStatus(status: AgentRuntimeItem['status']): 'running' | 'success' | 'error' {
  if (status === 'error' || status === 'failed' || status === 'aborted') return 'error'
  if (status === 'running' || status === 'pending') return 'running'
  return 'success'
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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function questionsMeta(meta: Record<string, unknown> | undefined): UserInputQuestion[] {
  const rawQuestions = meta?.questions
  if (!Array.isArray(rawQuestions)) return []
  return rawQuestions.map(normalizeMetaQuestion).filter((question): question is UserInputQuestion => question != null)
}

function normalizeMetaQuestion(raw: unknown): UserInputQuestion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const id = stringValue(record.id)
  const question = stringValue(record.question)
  if (!id || !question) return null
  return {
    id,
    header: stringValue(record.header) || 'Input',
    question,
    options: Array.isArray(record.options)
      ? record.options.map(normalizeMetaOption).filter((option): option is UserInputQuestion['options'][number] => option != null)
      : []
  }
}

function normalizeMetaOption(raw: unknown): UserInputQuestion['options'][number] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const label = stringValue(record.label)
  if (!label) return null
  return {
    label,
    description: stringValue(record.description) || ''
  }
}

function toolBlock(item: AgentRuntimeItem): ToolBlock {
  return {
    kind: 'tool',
    id: item.id,
    createdAt: item.createdAt,
    summary: item.summary?.trim() || item.text?.trim() || 'Tool',
    status: visibleStatus(item.status),
    toolKind: item.toolKind,
    detail: item.detail,
    meta: item.meta
  }
}

function compactionBlock(item: AgentRuntimeItem): CompactionBlock {
  return {
    kind: 'compaction',
    id: item.id,
    createdAt: item.createdAt,
    summary: item.summary?.trim() || item.text?.trim() || 'Context compacted',
    status: visibleStatus(item.status),
    detail: item.detail
  }
}

function reviewBlock(item: AgentRuntimeItem): ReviewBlock {
  return {
    kind: 'review',
    id: item.id,
    createdAt: item.createdAt,
    title: item.summary?.trim() || 'Review',
    status: visibleStatus(item.status),
    reviewText: item.text,
    output: item.meta?.output as ReviewBlock['output']
  }
}

function blockFromItem(item: AgentRuntimeItem): ChatBlock | null {
  const kind = item.kind
  switch (kind) {
    case 'user_message':
      return {
        kind: 'user',
        id: item.id,
        createdAt: item.createdAt,
        text: item.text ?? '',
        meta: disclosureMeta(item.meta)
      }
    case 'assistant_message':
      {
        const meta = disclosureMeta(item.meta)
        return {
          kind: 'assistant',
          id: item.id,
          createdAt: item.createdAt,
          text: item.text ?? '',
          ...(meta ? { meta } : {})
        }
      }
    case 'reasoning':
      return { kind: 'reasoning', id: item.id, createdAt: item.createdAt, text: item.text ?? '' }
    case 'tool':
      return toolBlock(item)
    case 'compaction':
      return compactionBlock(item)
    case 'review':
      return reviewBlock(item)
    case 'system':
      return {
        kind: 'system',
        id: item.id,
        createdAt: item.createdAt,
        text: item.text ?? item.summary ?? '',
        detail: item.detail,
        severity: visibleStatus(item.status) === 'error' ? 'error' : 'info'
      }
    case 'approval':
      return {
        kind: 'approval',
        id: item.id,
        createdAt: item.createdAt,
        approvalId: stringMeta(item.meta, 'approvalId') ?? item.id,
        summary: item.summary?.trim() || item.text?.trim() || 'Approval required',
        toolName: stringMeta(item.meta, 'toolName'),
        status: visibleStatus(item.status) === 'error'
          ? 'error'
          : visibleStatus(item.status) === 'success'
            ? 'allowed'
            : 'pending',
        meta: disclosureMeta(item.meta)
      }
    case 'user_input':
      {
        const requestId =
          requestIdMeta(item.meta, 'codexRequestId') ??
          stringMeta(item.meta, 'requestId') ??
          item.id
        const questions = questionsMeta(item.meta)
        return {
          kind: 'user_input',
          id: item.id,
          createdAt: item.createdAt,
          requestId,
          questions: questions.length > 0
            ? questions
            : [{
                id: stringMeta(item.meta, 'questionId') ?? item.id,
                header: 'Input',
                question: item.summary?.trim() || item.text?.trim() || 'Input requested',
                options: []
              }],
          status: visibleStatus(item.status) === 'error'
            ? 'error'
            : visibleStatus(item.status) === 'success'
              ? 'submitted'
              : 'pending'
        }
      }
    default: {
      const neverKind: never = kind
      return neverKind
    }
  }
}

function detailItems(detail: AgentRuntimeThreadDetail): AgentRuntimeItem[] {
  if (detail.items?.length) return detail.items
  return detail.turns?.flatMap((turn) => turn.items ?? []) ?? []
}

type DetailTurn = NonNullable<AgentRuntimeThreadDetail['turns']>[number]

function latestTurnFromDetail(detail: AgentRuntimeThreadDetail): DetailTurn | undefined {
  if (!detail.turns?.length) return undefined
  const latestTurnId = detail.latestTurnId?.trim()
  if (latestTurnId) {
    const exactTurn = detail.turns.find((turn) => turn.id === latestTurnId)
    if (exactTurn) return exactTurn
  }
  return detail.turns.at(-1)
}

type TerminalSnapshotOutcome = 'success' | 'error'

function normalizedStatus(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function statusLooksRunning(value: string): boolean {
  return isAgentRuntimeActiveTurnState(value)
}

function statusLooksError(value: string): boolean {
  const normalized = normalizeAgentRuntimeTurnState(value)
  return normalized === 'failed' || normalized === 'aborted' || normalized === 'cancelled'
}

function statusLooksSuccess(value: string): boolean {
  const normalized = normalizeAgentRuntimeTurnState(value)
  return normalized === 'completed' || normalized === 'idle' || value === 'ready'
}

function terminalSnapshotOutcome(
  threadStatus: string | undefined,
  turnStatus: string | undefined
): TerminalSnapshotOutcome | null {
  const normalizedThreadStatus = normalizedStatus(threadStatus)
  const normalizedTurnStatus = normalizedStatus(turnStatus)
  if (statusLooksRunning(normalizedThreadStatus) || statusLooksRunning(normalizedTurnStatus)) return null
  if (statusLooksError(normalizedThreadStatus) || statusLooksError(normalizedTurnStatus)) return 'error'
  if (
    isAgentRuntimeTerminalTurnState(normalizedTurnStatus) ||
    isAgentRuntimeTerminalTurnState(normalizedThreadStatus) ||
    statusLooksSuccess(normalizedTurnStatus) ||
    statusLooksSuccess(normalizedThreadStatus)
  ) return 'success'
  return null
}

function toolIdentity(block: ToolBlock): string | null {
  const callId =
    stringMeta(block.meta, 'callId') ??
    stringMeta(block.meta, 'toolCallId') ??
    stringMeta(block.meta, 'call_id') ??
    stringMeta(block.meta, 'tool_call_id')
  return callId ? `call:${callId}` : null
}

function removeSupersededRunningToolBlocks(blocks: ChatBlock[]): ChatBlock[] {
  const completedToolIdentities = new Set<string>()
  let changed = false
  const reversed: ChatBlock[] = []
  for (let idx = blocks.length - 1; idx >= 0; idx -= 1) {
    const block = blocks[idx]
    if (block.kind !== 'tool') {
      reversed.push(block)
      continue
    }
    const identity = toolIdentity(block)
    if (!identity) {
      reversed.push(block)
      continue
    }
    if (block.status === 'running') {
      if (completedToolIdentities.has(identity)) {
        changed = true
        continue
      }
      reversed.push(block)
      continue
    }
    completedToolIdentities.add(identity)
    reversed.push(block)
  }
  return changed ? reversed.reverse() : blocks
}

function mergeRepeatedToolBlocks(blocks: ChatBlock[]): ChatBlock[] {
  let changed = false
  const merged: ChatBlock[] = []
  const toolIndexes = new Map<string, number>()
  for (const block of blocks) {
    if (block.kind !== 'tool') {
      merged.push(block)
      continue
    }
    const existingIndex = toolIndexes.get(block.id)
    if (existingIndex === undefined) {
      toolIndexes.set(block.id, merged.length)
      merged.push(block)
      continue
    }
    const existing = merged[existingIndex]
    if (!existing || existing.kind !== 'tool') {
      merged.push(block)
      continue
    }
    changed = true
    merged[existingIndex] = {
      ...existing,
      ...block,
      createdAt: existing.createdAt ?? block.createdAt,
      summary: block.summary || existing.summary,
      detail: block.detail ?? existing.detail,
      meta: {
        ...(existing.meta ?? {}),
        ...(block.meta ?? {})
      }
    }
  }
  return changed ? merged : blocks
}

function mergeRepeatedUserInputBlocks(blocks: ChatBlock[]): ChatBlock[] {
  let changed = false
  const merged: ChatBlock[] = []
  const inputIndexes = new Map<string, number>()
  for (const block of blocks) {
    if (block.kind !== 'user_input') {
      merged.push(block)
      continue
    }
    const key = block.requestId.trim() || block.id
    const existingIndex = inputIndexes.get(key)
    if (existingIndex === undefined) {
      inputIndexes.set(key, merged.length)
      merged.push(block)
      continue
    }
    const existing = merged[existingIndex]
    if (!existing || existing.kind !== 'user_input') {
      merged.push(block)
      continue
    }
    changed = true
    merged[existingIndex] = {
      ...existing,
      ...block,
      createdAt: existing.createdAt ?? block.createdAt,
      questions: block.questions.length > 0 ? block.questions : existing.questions,
      answers: block.answers ?? existing.answers,
      errorMessage: block.errorMessage ?? existing.errorMessage
    }
  }
  return changed ? merged : blocks
}

function settleTerminalSnapshotBlocks(blocks: ChatBlock[], outcome: TerminalSnapshotOutcome | null): ChatBlock[] {
  if (!outcome) return blocks
  let changed = false
  const dedupedBlocks = removeSupersededRunningToolBlocks(blocks)
  if (dedupedBlocks !== blocks) changed = true
  const nextBlocks = dedupedBlocks.map((block): ChatBlock => {
    if (block.kind === 'tool' && block.status === 'running') {
      changed = true
      return { ...block, status: outcome }
    }
    if (block.kind === 'compaction' && block.status === 'running') {
      changed = true
      return { ...block, status: outcome }
    }
    if (block.kind === 'review' && block.status === 'running') {
      changed = true
      return { ...block, status: outcome }
    }
    if (block.kind === 'approval' && block.status === 'pending') {
      changed = true
      return { ...block, status: 'error' }
    }
    if (block.kind === 'user_input' && block.status === 'pending') {
      changed = true
      return { ...block, status: 'cancelled' }
    }
    return block
  })
  return changed ? nextBlocks : blocks
}

function usageFromRuntime(usage: AgentRuntimeUsage | undefined): ThreadUsageSnapshot | undefined {
  if (!usage) return undefined
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
    turns: detailTurnCount(usage)
  }
}

function normalizeSharedMemoryRecord(value: unknown): LocalRuntimeMemoryRecordJson {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const updatedAt = stringValue(record.updatedAt) || new Date().toISOString()
  return {
    id: stringValue(record.id),
    content: stringValue(record.content) || stringValue(record.text),
    scope: normalizeMemoryScope(record.scope),
    ...(stringValue(record.workspace) ? { workspace: stringValue(record.workspace) } : {}),
    ...(stringValue(record.project) ? { project: stringValue(record.project) } : {}),
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    ...(typeof record.confidence === 'number' ? { confidence: record.confidence } : {}),
    createdAt: stringValue(record.createdAt) || updatedAt,
    updatedAt,
    ...(stringValue(record.disabledAt)
      ? { disabledAt: stringValue(record.disabledAt) }
      : record.disabled === true
        ? { disabledAt: updatedAt }
        : {}),
    ...(stringValue(record.deletedAt)
      ? { deletedAt: stringValue(record.deletedAt) }
      : record.deleted === true
        ? { deletedAt: updatedAt }
        : {})
  }
}

function normalizeMemoryScope(value: unknown): LocalRuntimeMemoryRecordJson['scope'] {
  return value === 'workspace' || value === 'project' || value === 'user' ? value : 'user'
}

function detailTurnCount(_usage: AgentRuntimeUsage): number {
  return 0
}

export class AgentRuntimeProvider implements AgentProvider {
  readonly displayName = 'Agent Runtime'
  private capabilitiesCache: AgentRuntimeCapabilities = defaultCapabilities()
  private readonly threadRuntimes = new Map<string, AgentRuntimeId>()
  private readonly approvalThreads = new Map<string, InteractionRequestRef>()
  private readonly userInputThreads = new Map<string, InteractionRequestRef>()

  get id(): AgentRuntimeId {
    return this.capabilitiesCache.runtimeId
  }

  getCapabilities(): LegacyCapabilities {
    return legacyCapabilities(this.capabilitiesCache)
  }

  async refreshCapabilities(): Promise<AgentRuntimeCapabilities> {
    const runtimeId = await this.activeRuntimeId()
    const capabilities = await agentRuntimeClient.capabilities(runtimeId)
    this.capabilitiesCache = capabilities
    return capabilities
  }

  async connect(): Promise<void> {
    const runtimeId = await this.activeRuntimeId()
    await agentRuntimeClient.connect(runtimeId)
    try {
      this.capabilitiesCache = await agentRuntimeClient.capabilities(runtimeId)
    } catch {
      this.capabilitiesCache = defaultCapabilities(runtimeId)
    }
  }

  async listThreads(options: Parameters<AgentProvider['listThreads']>[0] = {}): Promise<NormalizedThread[]> {
    const threads = await agentRuntimeClient.listThreads(options)
    return threads.map((thread) => this.normalizeRememberedThread(thread))
  }

  async createThread(input: Parameters<AgentProvider['createThread']>[0]): Promise<NormalizedThread> {
    const runtimeId = await this.activeRuntimeId()
    return this.normalizeRememberedThread(await agentRuntimeClient.startThread({ runtimeId, ...input }))
  }

  async getThreadDetail(threadId: string): ReturnType<AgentProvider['getThreadDetail']> {
    const runtimeId = await this.runtimeIdForThread(threadId)
    const detail = await agentRuntimeClient.readThread({ runtimeId, threadId })
    const items = detailItems(detail)
    this.rememberThreadRuntime(detail.id, detail.runtimeId)
    this.rememberInteractionRequests(detail.id, detail.runtimeId, items)
    const latestTurn = latestTurnFromDetail(detail)
    const rawBlocks = mergeRepeatedUserInputBlocks(mergeRepeatedToolBlocks(items.flatMap((item) => {
      const block = blockFromItem(item)
      return block ? [block] : []
    })))
    return {
      blocks: settleTerminalSnapshotBlocks(
        rawBlocks,
        terminalSnapshotOutcome(detail.status, latestTurn?.status)
      ),
      latestSeq: detail.latestSeq,
      threadStatus: detail.status ?? latestTurn?.status,
      latestTurnId: detail.latestTurnId ?? latestTurn?.id,
      latestUserMessageId: [...items].reverse().find((item) => item.kind === 'user_message')?.id,
      usage: usageFromRuntime(detail.usage),
      goal: detail.goal ?? null,
      todos: detail.todos ?? null
    }
  }

  async sendUserMessage(
    threadId: string,
    text: string,
    options: Parameters<AgentProvider['sendUserMessage']>[2] = {}
  ): ReturnType<AgentProvider['sendUserMessage']> {
    const { title, ...turnOptions } = options
    const runtimeId = await this.runtimeIdForThread(threadId)
    const activeRuntimeId = await this.activeRuntimeId()
    if (activeRuntimeId !== runtimeId) {
      const result = await this.auxiliary<AgentRuntimeHandoffStartResult>('startRuntimeHandoff', {
        sourceRuntimeId: runtimeId,
        sourceThreadId: threadId,
        targetRuntimeId: activeRuntimeId,
        targetThreadId: threadId,
        text,
        ...(title ? { title } : {}),
        ...turnOptionsForRuntime(activeRuntimeId, turnOptions)
      }, runtimeId)
      const targetThread = this.normalizeRememberedThread(result.targetThread)
      return {
        ...result.turn,
        threadId: targetThread.id || result.turn.threadId || threadId
      }
    }
    return agentRuntimeClient.startTurn({ runtimeId, threadId, text, ...turnOptionsForRuntime(runtimeId, turnOptions) })
  }

  reviewThread(
    threadId: string,
    target: Parameters<NonNullable<AgentProvider['reviewThread']>>[1],
    options?: Parameters<NonNullable<AgentProvider['reviewThread']>>[2]
  ): ReturnType<NonNullable<AgentProvider['reviewThread']>> {
    return this.threadAuxiliary(threadId, 'reviewThread', { target, model: options?.model })
  }

  async steerUserMessage(threadId: string, turnId: string, text: string): Promise<void> {
    const runtimeId = await this.runtimeIdForThread(threadId)
    await agentRuntimeClient.steerTurn({ runtimeId, threadId, turnId, text })
  }

  async interruptTurn(threadId: string, turnId: string, options?: { discard?: boolean }): Promise<void> {
    const runtimeId = await this.runtimeIdForThread(threadId)
    await agentRuntimeClient.interruptTurn({
      runtimeId,
      threadId,
      turnId,
      ...(options?.discard === undefined
        ? runtimeId === 'claude' ? { discard: true } : {}
        : { discard: options.discard })
    })
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    const runtimeId = await this.runtimeIdForThread(threadId)
    await agentRuntimeClient.renameThread({ runtimeId, threadId, title })
  }

  async deleteThread(threadId: string): Promise<void> {
    const runtimeId = await this.runtimeIdForThread(threadId)
    await agentRuntimeClient.deleteThread({ runtimeId, threadId })
    this.threadRuntimes.delete(threadId)
  }

  getRuntimeInfo(): ReturnType<NonNullable<AgentProvider['getRuntimeInfo']>> {
    return this.auxiliary('getRuntimeInfo')
  }

  getToolDiagnostics(): ReturnType<NonNullable<AgentProvider['getToolDiagnostics']>> {
    return this.auxiliary('getToolDiagnostics')
  }

  listSkills(): ReturnType<NonNullable<AgentProvider['listSkills']>> {
    return this.auxiliary('listSkills')
  }

  async uploadAttachment(
    input: Parameters<NonNullable<AgentProvider['uploadAttachment']>>[0]
  ): ReturnType<NonNullable<AgentProvider['uploadAttachment']>> {
    const runtimeId = input.threadId ? await this.runtimeIdForThread(input.threadId) : undefined
    return this.auxiliary('uploadAttachment', input, runtimeId)
  }

  async getAttachmentContent(
    attachmentId: string,
    options?: Parameters<NonNullable<AgentProvider['getAttachmentContent']>>[1]
  ): ReturnType<NonNullable<AgentProvider['getAttachmentContent']>> {
    const runtimeId = options?.threadId ? await this.runtimeIdForThread(options.threadId) : undefined
    return this.auxiliary('getAttachmentContent', { attachmentId, options }, runtimeId)
  }

  runCodeNavigation(
    input: Parameters<NonNullable<AgentProvider['runCodeNavigation']>>[0]
  ): ReturnType<NonNullable<AgentProvider['runCodeNavigation']>> {
    return this.auxiliary('runCodeNavigation', input)
  }

  async listModelAuditRecords(
    options?: Parameters<NonNullable<AgentProvider['listModelAuditRecords']>>[0]
  ): ReturnType<NonNullable<AgentProvider['listModelAuditRecords']>> {
    const { runtimeId, threadId, ...payload } = options ?? {}
    const selectedRuntimeId = runtimeId ?? (threadId ? await this.runtimeIdForThread(threadId) : undefined)
    return this.auxiliary('listModelAuditRecords', {
      ...payload,
      ...(threadId ? { threadId } : {}),
      ...(selectedRuntimeId ? { runtimeId: selectedRuntimeId } : {})
    }, selectedRuntimeId)
  }

  clearModelAuditRecords(): ReturnType<NonNullable<AgentProvider['clearModelAuditRecords']>> {
    return this.auxiliary('clearModelAuditRecords')
  }

  getContextState(threadId: string): ReturnType<NonNullable<AgentProvider['getContextState']>> {
    return this.threadAuxiliary(threadId, 'getContextState')
  }

  async listGitCheckpoints(
    options?: Parameters<NonNullable<AgentProvider['listGitCheckpoints']>>[0]
  ): ReturnType<NonNullable<AgentProvider['listGitCheckpoints']>> {
    const { runtimeId, threadId, ...payload } = options ?? {}
    const selectedRuntimeId = runtimeId ?? (threadId ? await this.runtimeIdForThread(threadId) : undefined)
    return this.auxiliary('listGitCheckpoints', {
      ...payload,
      ...(threadId ? { threadId } : {}),
      ...(selectedRuntimeId ? { runtimeId: selectedRuntimeId } : {})
    }, selectedRuntimeId)
  }

  async createGitCheckpoint(
    input: Parameters<NonNullable<AgentProvider['createGitCheckpoint']>>[0]
  ): ReturnType<NonNullable<AgentProvider['createGitCheckpoint']>> {
    const runtimeId = await this.runtimeIdForThread(input.threadId)
    return this.auxiliary('createGitCheckpoint', input, runtimeId)
  }

  previewGitCheckpoint(
    checkpointId: string
  ): ReturnType<NonNullable<AgentProvider['previewGitCheckpoint']>> {
    return this.auxiliary('previewGitCheckpoint', { checkpointId })
  }

  restoreGitCheckpoint(
    checkpointId: string,
    options?: Parameters<NonNullable<AgentProvider['restoreGitCheckpoint']>>[1]
  ): ReturnType<NonNullable<AgentProvider['restoreGitCheckpoint']>> {
    return this.auxiliary('restoreGitCheckpoint', { checkpointId, force: options?.force === true })
  }

  async createMemory(
    input: Parameters<NonNullable<AgentProvider['createMemory']>>[0]
  ): ReturnType<NonNullable<AgentProvider['createMemory']>> {
    const record = await this.auxiliary<AgentRuntimeMemoryRecord>('createMemory', {
      ...input,
      text: input.content
    })
    return normalizeSharedMemoryRecord(record)
  }

  listMemories(
    options?: Parameters<NonNullable<AgentProvider['listMemories']>>[0]
  ): Promise<LocalRuntimeMemoryRecordJson[]> {
    return this.auxiliary<unknown[]>('listMemories', { options })
      .then((records) => records.map(normalizeSharedMemoryRecord))
  }

  async updateMemory(
    memoryId: string,
    patch: Parameters<NonNullable<AgentProvider['updateMemory']>>[1]
  ): ReturnType<NonNullable<AgentProvider['updateMemory']>> {
    const { content, ...rest } = patch
    const record = await this.auxiliary<AgentRuntimeMemoryRecord>('updateMemory', {
      memoryId,
      patch: {
        ...rest,
        ...(content !== undefined ? { text: content } : {})
      }
    })
    return normalizeSharedMemoryRecord(record)
  }

  async deleteMemory(memoryId: string): ReturnType<NonNullable<AgentProvider['deleteMemory']>> {
    return normalizeSharedMemoryRecord(await this.auxiliary('deleteMemory', { memoryId }))
  }

  listWorkspaceReferences(
    input: Parameters<NonNullable<AgentProvider['listWorkspaceReferences']>>[0]
  ): ReturnType<NonNullable<AgentProvider['listWorkspaceReferences']>> {
    return this.auxiliary('listWorkspaceReferences', input)
  }

  previewWorkspaceReference(
    input: Parameters<NonNullable<AgentProvider['previewWorkspaceReference']>>[0]
  ): ReturnType<NonNullable<AgentProvider['previewWorkspaceReference']>> {
    return this.auxiliary('previewWorkspaceReference', input)
  }

  async updateThreadWorkspace(threadId: string, workspace: string): Promise<void> {
    await this.threadAuxiliary(threadId, 'updateThreadWorkspace', { workspace })
  }

  async archiveThread(threadId: string, archived: boolean): Promise<void> {
    await this.threadAuxiliary(threadId, 'archiveThread', { archived })
  }

  async compactThread(threadId: string, reason?: string): Promise<void> {
    const runtimeId = await this.runtimeIdForThread(threadId)
    await agentRuntimeClient.compactThread({ runtimeId, threadId, reason })
  }

  getThreadGoal(threadId: string): ReturnType<NonNullable<AgentProvider['getThreadGoal']>> {
    return this.threadAuxiliary(threadId, 'getThreadGoal')
  }

  setThreadGoal(
    threadId: string,
    patch: Parameters<NonNullable<AgentProvider['setThreadGoal']>>[1]
  ): ReturnType<NonNullable<AgentProvider['setThreadGoal']>> {
    return this.threadAuxiliary(threadId, 'setThreadGoal', { patch })
  }

  clearThreadGoal(threadId: string): ReturnType<NonNullable<AgentProvider['clearThreadGoal']>> {
    return this.threadAuxiliary(threadId, 'clearThreadGoal')
  }

  getThreadTodos(threadId: string): ReturnType<NonNullable<AgentProvider['getThreadTodos']>> {
    return this.threadAuxiliary(threadId, 'getThreadTodos')
  }

  setThreadTodos(
    threadId: string,
    todos: Parameters<NonNullable<AgentProvider['setThreadTodos']>>[1]
  ): ReturnType<NonNullable<AgentProvider['setThreadTodos']>> {
    return this.threadAuxiliary(threadId, 'setThreadTodos', { todos })
  }

  clearThreadTodos(threadId: string): ReturnType<NonNullable<AgentProvider['clearThreadTodos']>> {
    return this.threadAuxiliary(threadId, 'clearThreadTodos')
  }

  async listThreadChildren(
    threadId: string,
    options: Parameters<NonNullable<AgentProvider['listThreadChildren']>>[1] = {}
  ): Promise<AgentRuntimeListThreadChildrenResponse> {
    return this.threadAuxiliary(threadId, 'listThreadChildren', options)
  }

  async readChildTranscript(
    input: AgentRuntimeReadChildTranscriptInput
  ): Promise<AgentRuntimeReadChildTranscriptResponse> {
    const runtimeId = input.runtimeId ?? await this.runtimeIdForThread(input.parentThreadId)
    return this.auxiliary('readChildTranscript', input as unknown as Record<string, unknown>, runtimeId)
  }

  async forkThread(
    threadId: string,
    options: { relation?: AgentRuntimeThreadRelation; title?: string } = {}
  ): Promise<NormalizedThread> {
    const runtimeId = await this.runtimeIdForThread(threadId)
    return this.normalizeRememberedThread(await agentRuntimeClient.forkThread({ runtimeId, threadId, ...options }))
  }

  async resumeSession(
    sessionId: string,
    options: { model?: string; mode?: string; maxResumeCount?: number } = {}
  ): Promise<{ threadId: string; sessionId: string }> {
    const runtimeId = await this.activeRuntimeId()
    return agentRuntimeClient.resumeSession({ runtimeId, sessionId, ...options })
  }

  async updateThreadRelation(threadId: string, relation: AgentRuntimeThreadRelation): Promise<void> {
    const runtimeId = await this.runtimeIdForThread(threadId)
    await agentRuntimeClient.updateThreadRelation({ runtimeId, threadId, relation })
  }

  async submitApprovalDecision(
    approvalId: string,
    decision: 'allow' | 'deny',
    _remember?: boolean
  ): Promise<void> {
    const request = this.approvalThreads.get(approvalId)
    if (!request) throw unresolvedInteraction('approval', approvalId)
    await agentRuntimeClient.resolveApproval({
      runtimeId: request.runtimeId,
      threadId: request.threadId,
      approvalId: request.requestId ?? approvalId,
      decision: decision === 'allow' ? 'allowed' : 'denied'
    })
  }

  async submitUserInputResponse(requestId: string, answers: UserInputAnswer[]): Promise<void> {
    const request = this.userInputThreads.get(requestId)
    if (!request) throw unresolvedInteraction('user input', requestId)
    const runtimeRequestId = request.requestId ?? requestId
    await agentRuntimeClient.resolveUserInput({
      runtimeId: request.runtimeId,
      threadId: request.threadId,
      requestId: runtimeRequestId,
      answers: answers.map((answer) => ({
        id: answer.id,
        label: answer.label,
        value: answer.value
      }))
    })
  }

  async cancelUserInput(requestId: string): Promise<void> {
    const request = this.userInputThreads.get(requestId)
    if (!request) throw unresolvedInteraction('user input', requestId)
    await this.auxiliary(
      'cancelUserInput',
      { threadId: request.threadId, requestId: request.requestId ?? requestId },
      request.runtimeId
    )
  }

  async subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void> {
    try {
      const runtimeId = await this.runtimeIdForThread(threadId)
      await agentRuntimeClient.subscribeEvents(threadId, sinceSeq, (event) => {
        if (!agentRuntimeEventBelongsToThread(event.threadId, threadId)) return
        this.rememberInteractionEvent(threadId, event, runtimeId)
        dispatchAgentRuntimeEvent(event, sink)
      }, signal, runtimeId)
    } catch (error) {
      sink.onError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private async activeRuntimeId(): Promise<AgentRuntimeId> {
    return getActiveAgentRuntime(await rendererRuntimeClient.getSettings())
  }

  private async runtimeIdForThread(threadId: string): Promise<AgentRuntimeId> {
    const runtimeId = this.threadRuntimes.get(threadId)
    if (runtimeId) return runtimeId
    throw unresolvedThreadRuntime(threadId)
  }

  rememberThreadRuntime(threadId: string, runtimeId: AgentRuntimeId | undefined): void {
    if (runtimeId) this.threadRuntimes.set(threadId, runtimeId)
  }

  private normalizeRememberedThread(thread: AgentRuntimeThread): NormalizedThread {
    this.rememberThreadRuntime(thread.id, thread.runtimeId)
    return normalizeThread(thread)
  }

  private async auxiliary<T>(
    operation: AgentRuntimeAuxiliaryOperation,
    payload: Record<string, unknown> = {},
    runtimeId?: AgentRuntimeId
  ): Promise<T> {
    const selectedRuntimeId = runtimeId ?? await this.activeRuntimeId()
    return agentRuntimeClient.auxiliary<T>({ runtimeId: selectedRuntimeId, operation, payload })
  }

  private async threadAuxiliary<T>(
    threadId: string,
    operation: AgentRuntimeAuxiliaryOperation,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    const runtimeId = await this.runtimeIdForThread(threadId)
    return this.auxiliary<T>(operation, { threadId, ...payload }, runtimeId)
  }

  private rememberInteractionRequests(threadId: string, runtimeId: AgentRuntimeId, items: AgentRuntimeItem[]): void {
    for (const item of items) {
      if (item.kind === 'approval') {
        const requestId =
          requestIdMeta(item.meta, 'codexRequestId') ??
          stringMeta(item.meta, 'approvalId') ??
          item.id
        const ref = { threadId, runtimeId, requestId }
        this.rememberInteractionAliases(this.approvalThreads, ref, [
          item.id,
          stringMeta(item.meta, 'approvalId'),
          requestId
        ])
      }
      if (item.kind === 'user_input') {
        const requestId =
          requestIdMeta(item.meta, 'codexRequestId') ??
          stringMeta(item.meta, 'requestId') ??
          item.id
        const ref = { threadId, runtimeId, requestId }
        this.rememberInteractionAliases(this.userInputThreads, ref, [
          item.id,
          stringMeta(item.meta, 'requestId'),
          requestId
        ])
      }
    }
  }

  private rememberInteractionAliases(
    target: Map<string, InteractionRequestRef>,
    ref: InteractionRequestRef,
    aliases: Array<string | undefined>
  ): void {
    for (const alias of aliases) {
      if (alias) target.set(alias, ref)
    }
  }

  private rememberInteractionEvent(threadId: string, event: AgentRuntimeEvent, fallbackRuntimeId: AgentRuntimeId): void {
    const runtimeId = event.runtimeId ?? fallbackRuntimeId
    switch (event.kind) {
      case 'approval_requested':
        this.rememberInteractionAliases(this.approvalThreads, {
          threadId,
          runtimeId,
          requestId: requestIdMeta(event.meta, 'codexRequestId') ?? event.approvalId
        }, [
          event.itemId,
          event.approvalId,
          requestIdMeta(event.meta, 'codexRequestId')
        ])
        return
      case 'user_input_requested':
        this.rememberInteractionAliases(this.userInputThreads, {
          threadId,
          runtimeId,
          requestId: event.requestId
        }, [
          event.itemId,
          event.requestId
        ])
        return
      case 'item_snapshot':
        this.rememberInteractionRequests(threadId, runtimeId, [event.item])
        return
      default:
        return
    }
  }
}

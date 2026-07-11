import type {
  AgentProvider,
  ChatBlock,
  CompactionBlock,
  NormalizedThread,
  ThreadCreateInput,
  ThreadEventSink,
  ToolBlock,
  ToolEventPayload
} from '../agent/types'
import { DEFAULT_LOCAL_RUNTIME_MODEL, type AgentRuntimeId } from '@shared/app-settings'
import type { ChatState, SideConversation, SidePanelState } from './chat-store-types'
import {
  rememberProviderThreadRuntime,
  threadSnapshotLooksRunning,
  upsertUserBlock
} from './chat-store-runtime-helpers'
import { providerSupportsCapability } from './chat-store-provider-capabilities'
import { getRuntimeErrorCode } from '../lib/format-runtime-error'
import { parseSteerCommand } from '../lib/steer-command'

type SideContext = {
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
  get: () => ChatState
  getProvider: () => AgentProvider
  /** i18n reference (kept loose; the host already imports the default). */
  t: (key: string) => string
  formatRuntimeError: (error: unknown) => string
  shouldOpenSettingsForError: (error: unknown) => boolean
}

type ActiveSideAbort = {
  sideId: string
  abort: AbortController
}

const sideAbortControllers = new Map<string, AbortController>()
const sideQueueDraining = new Set<string>()

function compactTitlePrefix(value: string): string {
  return Array.from(value.trim()).slice(0, 5).join('')
}

function defaultSideTitle(parentTitle: string, parentThreadId: string): string {
  const trimmed = parentTitle.trim()
  if (trimmed) return `${compactTitlePrefix(trimmed)} · side`
  return `${parentThreadId.slice(0, 8)} · side`
}

function defaultSideModel(state: ChatState, parentThreadId: string): string {
  const parent = state.threads.find((thread) => thread.id === parentThreadId)
  if (parent?.model) return parent.model
  if (state.composerModel) return state.composerModel
  return DEFAULT_LOCAL_RUNTIME_MODEL
}

function defaultStandaloneSideModel(state: ChatState): string {
  if (state.composerModel) return state.composerModel
  return DEFAULT_LOCAL_RUNTIME_MODEL
}

function sideConversationIsRegular(side: SideConversation): boolean {
  return (side.source ?? 'side') === 'side'
}

function sideThreadCreateMetadata(source: SideConversation['source']): Pick<
  ThreadCreateInput,
  'relation' | 'threadSource' | 'sidebarVisibility'
> {
  if (source === 'pdf_annotation') {
    return {
      relation: 'side',
      threadSource: 'pdf_annotation',
      sidebarVisibility: 'hidden'
    }
  }
  return { relation: 'side' }
}

function removeThreadFromMainLists(threadId: string, state: ChatState): Partial<ChatState> {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return {}
  const nextThreads = state.threads.filter((thread) => thread.id !== normalizedThreadId)
  const nextWatch = { ...state.watchTurnCompletion }
  const nextUnread = { ...state.unreadThreadIds }
  delete nextWatch[normalizedThreadId]
  delete nextUnread[normalizedThreadId]
  return {
    ...(nextThreads.length !== state.threads.length ? { threads: nextThreads } : {}),
    ...(normalizedThreadId in state.watchTurnCompletion ? { watchTurnCompletion: nextWatch } : {}),
    ...(normalizedThreadId in state.unreadThreadIds ? { unreadThreadIds: nextUnread } : {})
  }
}

function rememberSideThreadRuntime(
  provider: AgentProvider,
  sideId: string,
  side: Pick<SideConversation, 'runtimeId'> | null | undefined
): void {
  provider.rememberThreadRuntime?.(sideId, side?.runtimeId)
}

function normalizeRuntimeOwner(value: unknown): AgentRuntimeId | undefined {
  return value === 'sciforge' || value === 'codex' || value === 'claude' ? value : undefined
}

function runtimeOwnerFromThreadDetail(
  detail: Awaited<ReturnType<AgentProvider['getThreadDetail']>>
): AgentRuntimeId | undefined {
  return normalizeRuntimeOwner((detail as { runtimeId?: unknown }).runtimeId)
}

function sideReasoningEffortRequestValue(value: string): string | undefined {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'low') return 'off'
  if (normalized === 'medium' || normalized === 'high' || normalized === 'max') return normalized
  return undefined
}

function patchSide(
  state: ChatState,
  sideId: string,
  patch: (side: SideConversation) => SideConversation
): Partial<ChatState> {
  const current = state.sideConversations[sideId]
  if (!current) return {}
  return { sideConversations: { ...state.sideConversations, [sideId]: patch(current) } }
}

function setSidePanel(panel: SidePanelState, patch: Partial<SidePanelState>): SidePanelState {
  return { ...panel, ...patch }
}

function flushSideLiveBlocks(side: SideConversation): { side: SideConversation; blocks: ChatBlock[] } {
  let nextBlocks = side.blocks
  let nextLiveReasoning = side.liveReasoning
  let nextLiveAssistant = side.liveAssistant
  if (nextLiveReasoning) {
    const id = `live_reasoning_${side.lastSeq || Date.now()}`
    nextBlocks = [
      ...nextBlocks,
      { kind: 'reasoning', id, createdAt: new Date().toISOString(), text: nextLiveReasoning }
    ]
    nextLiveReasoning = ''
  }
  if (nextLiveAssistant) {
    const id = `live_assistant_${side.lastSeq || Date.now()}`
    nextBlocks = [
      ...nextBlocks,
      { kind: 'assistant', id, createdAt: new Date().toISOString(), text: nextLiveAssistant }
    ]
    nextLiveAssistant = ''
  }
  if (nextBlocks === side.blocks) return { side, blocks: nextBlocks }
  return {
    side: { ...side, blocks: nextBlocks, liveReasoning: nextLiveReasoning, liveAssistant: nextLiveAssistant },
    blocks: nextBlocks
  }
}

function buildSideSink(sideId: string, ctx: SideContext): ThreadEventSink {
  return {
    onSeq: (seq) => {
      ctx.set((s) => patchSide(s, sideId, (side) => ({ ...side, lastSeq: Math.max(side.lastSeq, seq) })))
    },
    onUserMessage: (ev) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const flushed = flushSideLiveBlocks(side)
          const blocks = upsertUserBlock(flushed.blocks, ev)
          return {
            ...flushed.side,
            blocks,
            busy: true,
            turnId: ev.turnId ?? side.turnId,
            userItemId: ev.itemId
          }
        })
      )
    },
    onDeltas: (deltas) => {
      if (deltas.length === 0) return
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const seqs = deltas
            .map((delta) => delta.seq)
            .filter((value): value is number => typeof value === 'number')
          const lastSeq = seqs.length > 0 ? Math.max(side.lastSeq, ...seqs) : side.lastSeq
          let liveReasoning = side.liveReasoning
          let liveAssistant = side.liveAssistant
          for (const delta of deltas) {
            if (delta.kind === 'agent_reasoning') liveReasoning += delta.text
            else liveAssistant += delta.text
          }
          return {
            ...side,
            lastSeq,
            liveReasoning,
            liveAssistant,
            busy: true
          }
        })
      )
    },
    onTool: (ev: ToolEventPayload) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const flushed = flushSideLiveBlocks(side)
          const idx = flushed.blocks.findIndex((b) => b.kind === 'tool' && b.id === ev.itemId)
          let blocks: ChatBlock[]
          if (idx >= 0) {
            const cur = flushed.blocks[idx]
            if (cur.kind !== 'tool') return flushed.side
            const next: ToolBlock = {
              ...cur,
              summary: ev.summary || cur.summary,
              status: ev.status,
              toolKind: ev.toolKind ?? cur.toolKind,
              detail: ev.detail ?? cur.detail,
              filePath: ev.filePath ?? cur.filePath,
              meta: ev.meta ?? cur.meta
            }
            blocks = [...flushed.blocks]
            blocks[idx] = next
          } else {
            const block: ToolBlock = {
              kind: 'tool',
              id: ev.itemId,
              createdAt: new Date().toISOString(),
              summary: ev.summary,
              status: ev.status,
              toolKind: ev.toolKind,
              detail: ev.detail,
              filePath: ev.filePath,
              meta: ev.meta
            }
            blocks = [...flushed.blocks, block]
          }
          return { ...flushed.side, blocks, busy: true }
        })
      )
    },
    onCompaction: (ev) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const flushed = flushSideLiveBlocks(side)
          const block: CompactionBlock = {
            kind: 'compaction',
            id: ev.itemId,
            createdAt: ev.createdAt ?? new Date().toISOString(),
            summary: ev.summary,
            status: ev.status,
            detail: ev.detail,
            auto: ev.auto
          }
          return { ...flushed.side, blocks: [...flushed.blocks, block] }
        })
      )
    },
    onApproval: (req) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const status = req.status ?? 'pending'
          const idx = side.blocks.findIndex((block) =>
            block.kind === 'approval' && block.approvalId === req.approvalId
          )
          if (idx >= 0) {
            const current = side.blocks[idx]
            if (current.kind !== 'approval') return side
            const blocks = [...side.blocks]
            blocks[idx] = {
              ...current,
              summary: req.summary || current.summary,
              toolName: req.toolName ?? current.toolName,
              status,
              errorMessage: req.errorMessage ?? current.errorMessage,
              meta: req.meta ?? current.meta
            }
            return { ...side, blocks }
          }
          return {
            ...side,
            blocks: [
              ...side.blocks,
              {
                kind: 'approval',
                id: `appr_${Date.now()}`,
                createdAt: new Date().toISOString(),
                approvalId: req.approvalId,
                summary: req.summary,
                toolName: req.toolName,
                status,
                ...(req.errorMessage ? { errorMessage: req.errorMessage } : {}),
                ...(req.meta ? { meta: req.meta } : {})
              }
            ]
          }
        })
      )
    },
    onUserInput: (req) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => ({
          ...side,
          blocks: [
            ...side.blocks,
            {
              kind: 'user_input',
              id: `ui_${Date.now()}`,
              createdAt: new Date().toISOString(),
              requestId: req.requestId,
              questions: req.questions,
              status: 'pending'
            }
          ]
        }))
      )
    },
    onUserInputStatus: (ev) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => ({
          ...side,
          blocks: side.blocks.map((block) =>
            block.kind === 'user_input' && block.requestId === ev.itemId
              ? { ...block, status: ev.status }
              : block
          )
        }))
      )
    },
    onGoal: () => {
      // Side conversations do not render goal chips yet.
    },
    onTodos: () => {
      // Side conversations do not render runtime todo chips yet.
    },
    onTurnComplete: () => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const flushed = flushSideLiveBlocks(side)
          return { ...flushed.side, busy: false, turnId: null }
        })
      )
      void drainNextSideMessage(sideId, ctx)
    },
    onError: (err) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => ({
          ...side,
          busy: false,
          error: ctx.formatRuntimeError(err)
        }))
      )
    },
    onUsage: (usage) => {
      // Side usage is reported only to keep lastSeq cursors consistent;
      // a per-thread usage counter can be wired here in the future.
      void usage
    }
  }
}

async function drainNextSideMessage(sideId: string, ctx: SideContext): Promise<void> {
  if (sideQueueDraining.has(sideId)) return
  const side = ctx.get().sideConversations[sideId]
  const queued = side?.queuedMessages?.[0]
  if (!side || side.busy || !queued) return

  sideQueueDraining.add(sideId)
  // Claim the idle slot before awaiting the runtime so duplicate completion
  // events cannot start the same queued message twice.
  ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, busy: true, error: null })))
  const provider = ctx.getProvider()
  try {
    rememberSideThreadRuntime(provider, sideId, side)
    const { turnId } = await provider.sendUserMessage(sideId, queued.text, {
      model: queued.model,
      ...(queued.reasoningEffort ? { reasoningEffort: queued.reasoningEffort } : {}),
      ...(queued.attachmentIds?.length ? { attachmentIds: queued.attachmentIds } : {}),
      ...(queued.fileReferences?.length ? { fileReferences: queued.fileReferences } : {}),
      ...(queued.displayText ? { displayText: queued.displayText } : {})
    })
    ctx.set((s) =>
      patchSide(s, sideId, (cur) => ({
        ...cur,
        queuedMessages: (cur.queuedMessages ?? []).filter((message) => message.id !== queued.id),
        busy: true,
        turnId,
        error: null
      }))
    )
    startSideSubscription(sideId, side.lastSeq, ctx)
  } catch (error) {
    const code = getRuntimeErrorCode(error)
    ctx.set((s) =>
      patchSide(s, sideId, (cur) => ({
        ...cur,
        busy: code === 'turn_in_progress',
        error: ctx.formatRuntimeError(error)
      }))
    )
    if (code === 'turn_in_progress') startSideSubscription(sideId, side.lastSeq, ctx)
  } finally {
    sideQueueDraining.delete(sideId)
  }
}

function teardownSideSubscription(sideId: string): void {
  const ac = sideAbortControllers.get(sideId)
  if (ac) {
    ac.abort()
    sideAbortControllers.delete(sideId)
  }
}

function handleSideSubscriptionFailure(
  sideId: string,
  ac: AbortController,
  ctx: SideContext,
  error: unknown
): void {
  if (ac.signal.aborted || sideAbortControllers.get(sideId) !== ac) return
  sideAbortControllers.delete(sideId)
  const message = ctx.formatRuntimeError(error)
  if (typeof window !== 'undefined' && typeof window.sciforge?.logError === 'function') {
    void window.sciforge.logError('side-conversation', 'Side conversation subscription failed', {
      message,
      sideId
    }).catch(() => undefined)
  }
  ctx.set((s) =>
    patchSide(s, sideId, (side) => ({
      ...side,
      busy: false,
      turnId: null,
      error: message
    }))
  )
}

function startSideSubscription(sideId: string, sinceSeq: number, ctx: SideContext): void {
  teardownSideSubscription(sideId)
  const ac = new AbortController()
  sideAbortControllers.set(sideId, ac)
  const sink = buildSideSink(sideId, ctx)
  const provider = ctx.getProvider()
  rememberSideThreadRuntime(provider, sideId, ctx.get().sideConversations[sideId])
  try {
    void provider.subscribeThreadEvents(sideId, sinceSeq, sink, ac.signal)
      .catch((error) => handleSideSubscriptionFailure(sideId, ac, ctx, error))
  } catch (error) {
    handleSideSubscriptionFailure(sideId, ac, ctx, error)
  }
}

export function createSideActions(ctx: SideContext): Pick<
  ChatState,
  | 'spawnSideConversation'
  | 'attachSideConversation'
  | 'openSideConversationDraft'
  | 'sendSideMessage'
  | 'removeSideQueuedMessage'
  | 'interruptSide'
  | 'setSideInput'
  | 'setSideModel'
  | 'setSideReasoningEffort'
  | 'selectSideConversation'
  | 'setSidePanelOpen'
  | 'closeSideConversation'
  | 'discardSideConversation'
  | 'promoteSideConversation'
> {
  const actions: Pick<
    ChatState,
    | 'spawnSideConversation'
    | 'attachSideConversation'
    | 'openSideConversationDraft'
    | 'sendSideMessage'
    | 'removeSideQueuedMessage'
    | 'interruptSide'
    | 'setSideInput'
    | 'setSideModel'
    | 'setSideReasoningEffort'
    | 'selectSideConversation'
    | 'setSidePanelOpen'
    | 'closeSideConversation'
    | 'discardSideConversation'
    | 'promoteSideConversation'
  > = {
    attachSideConversation: async (input) => {
      const threadId = input.threadId.trim()
      const parentThreadId = input.parentThreadId.trim()
      if (!threadId || !parentThreadId) return null
      const state = ctx.get()
      if (state.runtimeConnection !== 'ready') {
        ctx.set({ error: ctx.t('common:runtimeActionNeedsConnection') })
        return null
      }

      const existing = state.sideConversations[threadId]
      if (existing) {
        ctx.set((s) => ({
          sideConversations: {
            ...s.sideConversations,
            [threadId]: {
              ...existing,
              parentThreadId,
              ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
              ...(input.title?.trim() ? { title: input.title.trim() } : {}),
              ...(input.model?.trim() ? { model: input.model.trim() } : {}),
              source: input.source ?? existing.source ?? 'side'
            }
          },
          ...(input.openPanel
            ? { sidePanel: setSidePanel(s.sidePanel, { open: true, activeSideId: threadId }) }
            : {})
        }))
        startSideSubscription(threadId, existing.lastSeq, ctx)
        return threadId
      }

      const provider = ctx.getProvider()
      if (input.runtimeId) provider.rememberThreadRuntime?.(threadId, input.runtimeId)
      let detail: Awaited<ReturnType<AgentProvider['getThreadDetail']>>
      try {
        detail = await provider.getThreadDetail(threadId)
      } catch (e) {
        ctx.set({ error: ctx.formatRuntimeError(e) })
        return null
      }

      const runtimeId = input.runtimeId ?? runtimeOwnerFromThreadDetail(detail)
      if (runtimeId) provider.rememberThreadRuntime?.(threadId, runtimeId)
      const title = input.title?.trim() || threadId.slice(0, 8)
      const now = new Date().toISOString()
      const side: SideConversation = {
        threadId,
        ...(runtimeId ? { runtimeId } : {}),
        parentThreadId,
        source: input.source ?? 'side',
        title,
        createdAt: now,
        inheritedAt: now,
        blocks: detail.blocks,
        liveReasoning: '',
        liveAssistant: '',
        lastSeq: detail.latestSeq,
        input: '',
        queuedMessages: [],
        model: input.model?.trim() || defaultSideModel(state, parentThreadId),
        reasoningEffort: 'max',
        busy: threadSnapshotLooksRunning(detail.blocks, detail.threadStatus),
        turnId: detail.latestTurnId ?? null,
        userItemId: detail.latestUserMessageId ?? null,
        error: null
      }

      ctx.set((s) => ({
        sideConversations: { ...s.sideConversations, [threadId]: side },
        ...(input.openPanel
          ? { sidePanel: setSidePanel(s.sidePanel, { open: true, activeSideId: threadId }) }
          : {})
      }))
      startSideSubscription(threadId, detail.latestSeq, ctx)
      return threadId
    },

    spawnSideConversation: async (seedText, options) => {
      const state = ctx.get()
      const parentId = state.activeThreadId
      const standalone = options?.standalone === true
      if (!parentId && !standalone) {
        ctx.set({ error: ctx.t('common:sideConversationNeedsActiveThread') })
        return null
      }
      const provider = ctx.getProvider()
      if (state.runtimeConnection !== 'ready') {
        if (!standalone) {
          ctx.set({ error: ctx.t('common:runtimeActionNeedsConnection') })
          return null
        }
        try {
          ctx.set({ runtimeConnection: 'checking' })
          await provider.connect()
          ctx.set({ runtimeConnection: 'ready', error: null, runtimeErrorDetail: null })
        } catch (e) {
          ctx.set({
            runtimeConnection: 'offline',
            error: ctx.formatRuntimeError(e),
            ...(ctx.shouldOpenSettingsForError(e)
              ? { route: 'settings' as const, settingsSection: 'agents' as const }
              : {})
          })
          return null
        }
      }
      const connectedState = ctx.get()
      const connectedParentId = connectedState.activeThreadId
      const canForkSide =
        !standalone &&
        Boolean(connectedParentId) &&
        typeof provider.forkThread === 'function' &&
        providerSupportsCapability(provider, 'fork') &&
        providerSupportsCapability(provider, 'sideConversations')
      if (!canForkSide && !options?.allowStandalone) {
        ctx.set({ error: ctx.t('common:runtimeFeatureUnsupported') })
        return null
      }
      const parentThread = connectedParentId
        ? connectedState.threads.find((thread) => thread.id === connectedParentId)
        : null
      const title = options?.title?.trim() || defaultSideTitle(parentThread?.title ?? '', connectedParentId ?? 'standalone')
      const source = options?.source ?? 'side'
      const openPanel = options?.openPanel ?? true
      const createMetadata = sideThreadCreateMetadata(source)
      let sideThread: NormalizedThread
      try {
        if (canForkSide && connectedParentId) {
          rememberProviderThreadRuntime(provider, connectedParentId, connectedState.threads)
          sideThread = await provider.forkThread!(connectedParentId, { relation: 'side', title })
        } else {
          sideThread = await provider.createThread({
            title,
            mode: parentThread?.mode,
            workspace: parentThread?.workspace ?? connectedState.workspaceRoot,
            ...createMetadata
          })
          if (typeof provider.updateThreadRelation === 'function') {
            try {
              await provider.updateThreadRelation(sideThread.id, 'side')
            } catch {
              // Some runtimes can create ad-hoc threads but cannot persist
              // the side relation; the local side map still keeps it hidden.
            }
          }
        }
        provider.rememberThreadRuntime?.(sideThread.id, sideThread.runtimeId)
      } catch (e) {
        ctx.set({
          error: ctx.formatRuntimeError(e),
          ...(ctx.shouldOpenSettingsForError(e)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
        return null
      }
      const now = new Date().toISOString()
      const side: SideConversation = {
        threadId: sideThread.id,
        ...(sideThread.runtimeId ? { runtimeId: sideThread.runtimeId } : {}),
        parentThreadId: connectedParentId ?? sideThread.id,
        source,
        title: sideThread.title ?? title,
        createdAt: now,
        inheritedAt: now,
        blocks: [],
        liveReasoning: '',
        liveAssistant: '',
        lastSeq: 0,
        input: '',
        queuedMessages: [],
        model: connectedParentId
          ? defaultSideModel(connectedState, connectedParentId)
          : defaultStandaloneSideModel(connectedState),
        reasoningEffort: 'max',
        busy: false,
        turnId: null,
        userItemId: null,
        error: null
      }
      ctx.set((s) => ({
        sideConversations: { ...s.sideConversations, [sideThread.id]: side },
        ...removeThreadFromMainLists(sideThread.id, s),
        ...(openPanel
          ? { sidePanel: setSidePanel(s.sidePanel, { open: true, activeSideId: sideThread.id }) }
          : {})
      }))
      // Start a dedicated SSE subscription for this side thread. The
      // main `activeThreadId` and main subscription are untouched.
      startSideSubscription(sideThread.id, 0, ctx)
      if (seedText && seedText.trim()) {
        // Call the side action directly through the closure we are
        // currently building so store-level `state.sendSideMessage`
        // shims (e.g. test harnesses) cannot swallow the seed send.
        const started = await actions.sendSideMessage(sideThread.id, seedText.trim())
        if (!started) return sideThread.id
      }
      return sideThread.id
    },

    openSideConversationDraft: () => {
      ctx.set((s) => ({
        sidePanel: setSidePanel(s.sidePanel, { open: true, activeSideId: null })
      }))
    },

    sendSideMessage: async (sideId, text, overrides) => {
      const state = ctx.get()
      const side = state.sideConversations[sideId]
      if (!side) return false
      const trimmed = text.trim()
      const attachmentIds = overrides?.attachmentIds?.filter((id) => id.trim().length > 0)
      const fileReferences = overrides?.fileReferences?.filter((reference) => reference.path.trim().length > 0)
      if (!trimmed && !attachmentIds?.length && !fileReferences?.length) return false
      const steerCommandText = parseSteerCommand(trimmed)
      const explicitSteerText = steerCommandText !== false ? steerCommandText.trim() : null
      const messageText = explicitSteerText ?? (trimmed || (
        attachmentIds?.length && fileReferences?.length
          ? ctx.t('common:composerFileAndImageOnlyPrompt')
          : attachmentIds?.length
            ? ctx.t('common:composerImageOnlyPrompt')
            : ctx.t('common:composerFileOnlyPrompt')
      ))
      if (!messageText) {
        ctx.set((s) => patchSide(s, sideId, (cur) => ({
          ...cur,
          error: ctx.t('common:steerCommandRequiresMessage')
        })))
        return false
      }
      const provider = ctx.getProvider()
      const reasoningEffort = sideReasoningEffortRequestValue(side.reasoningEffort)

      if (side.busy) {
        const prefersSteer = side.source === 'child_agent' || explicitSteerText !== null
        const canSteer =
          prefersSteer &&
          Boolean(side.turnId) &&
          typeof provider.steerUserMessage === 'function' &&
          providerSupportsCapability(provider, 'steer') &&
          !attachmentIds?.length &&
          !fileReferences?.length
        if (canSteer && side.turnId && provider.steerUserMessage) {
          try {
            rememberSideThreadRuntime(provider, sideId, side)
            await provider.steerUserMessage(sideId, side.turnId, messageText)
            ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, input: '', error: null })))
            return true
          } catch (error) {
            const code = getRuntimeErrorCode(error)
            if (code === 'turn_not_running') {
              ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, busy: false, turnId: null })))
            } else if (code !== 'capability_unavailable') {
              ctx.set((s) => patchSide(s, sideId, (cur) => ({
                ...cur,
                error: ctx.formatRuntimeError(error)
              })))
              return false
            }
          }
        }

        if (ctx.get().sideConversations[sideId]?.busy) {
          ctx.set((s) => patchSide(s, sideId, (cur) => ({
            ...cur,
            input: '',
            queuedMessages: [
              ...(cur.queuedMessages ?? []),
              {
                id: `side-q-${Date.now()}-${cur.queuedMessages?.length ?? 0}`,
                text: messageText,
                model: cur.model,
                ...(reasoningEffort ? { reasoningEffort } : {}),
                ...(attachmentIds?.length ? { attachmentIds } : {}),
                ...(fileReferences?.length ? { fileReferences } : {}),
                ...(overrides?.displayText ? { displayText: overrides.displayText } : {})
              }
            ],
            error: null
          })))
          return true
        }
      }

      try {
        rememberSideThreadRuntime(provider, sideId, side)
        const { turnId } = await provider.sendUserMessage(sideId, messageText, {
          model: side.model,
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(attachmentIds?.length ? { attachmentIds } : {}),
          ...(fileReferences?.length ? { fileReferences } : {}),
          ...(overrides?.displayText ? { displayText: overrides.displayText } : {})
        })
        ctx.set((s) =>
          patchSide(s, sideId, (cur) => ({
            ...cur,
            input: '',
            busy: true,
            turnId,
            error: null
          }))
        )
        // Re-attach the subscription from the last seen seq so we don't
        // miss items emitted between the previous reconnect and the new
        // turn creation.
        startSideSubscription(sideId, side.lastSeq, ctx)
        return true
      } catch (e) {
        if (getRuntimeErrorCode(e) === 'turn_in_progress') {
          ctx.set((s) =>
            patchSide(s, sideId, (cur) => ({
              ...cur,
              input: '',
              busy: true,
              queuedMessages: [
                ...(cur.queuedMessages ?? []),
                {
                  id: `side-q-${Date.now()}-${cur.queuedMessages?.length ?? 0}`,
                  text: messageText,
                  model: cur.model,
                  ...(reasoningEffort ? { reasoningEffort } : {}),
                  ...(attachmentIds?.length ? { attachmentIds } : {}),
                  ...(fileReferences?.length ? { fileReferences } : {}),
                  ...(overrides?.displayText ? { displayText: overrides.displayText } : {})
                }
              ],
              error: null
            }))
          )
          startSideSubscription(sideId, side.lastSeq, ctx)
          return true
        }
        ctx.set((s) =>
          patchSide(s, sideId, (cur) => ({
            ...cur,
            error: ctx.formatRuntimeError(e)
          }))
        )
        return false
      }
    },

    removeSideQueuedMessage: (sideId, messageId) => {
      ctx.set((s) => patchSide(s, sideId, (side) => ({
        ...side,
        queuedMessages: (side.queuedMessages ?? []).filter((message) => message.id !== messageId)
      })))
    },

    interruptSide: async (sideId) => {
      const state = ctx.get()
      const side = state.sideConversations[sideId]
      if (!side || !side.turnId) return
      const provider = ctx.getProvider()
      try {
        rememberSideThreadRuntime(provider, sideId, side)
        await provider.interruptTurn(sideId, side.turnId)
        ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, busy: false })))
      } catch (e) {
        if (getRuntimeErrorCode(e) === 'turn_not_running') {
          ctx.set((s) =>
            patchSide(s, sideId, (cur) => ({
              ...cur,
              busy: false,
              turnId: null,
              error: null
            }))
          )
          return
        }
        ctx.set((s) =>
          patchSide(s, sideId, (cur) => ({
            ...cur,
            error: ctx.formatRuntimeError(e)
          }))
        )
      }
    },

    setSideInput: (sideId, text) => {
      ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, input: text })))
    },

    setSideModel: (sideId, model) => {
      ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, model })))
    },

    setSideReasoningEffort: (sideId, effort) => {
      ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, reasoningEffort: effort })))
    },

    selectSideConversation: (sideId) => {
      ctx.set((s) => {
        if (!s.sideConversations[sideId]) return {}
        return { sidePanel: setSidePanel(s.sidePanel, { activeSideId: sideId, open: true }) }
      })
    },

    setSidePanelOpen: (open) => {
      ctx.set((s) => ({ sidePanel: setSidePanel(s.sidePanel, { open }) }))
    },

    closeSideConversation: async (sideId) => {
      const state = ctx.get()
      const closingSide = state.sideConversations[sideId] ?? null
      teardownSideSubscription(sideId)
      ctx.set((s) => {
        const next = { ...s.sideConversations }
        delete next[sideId]
        const nextActiveId =
          s.sidePanel.activeSideId === sideId && closingSide
            ? Object.values(next).find((side) =>
              side.parentThreadId === closingSide.parentThreadId && sideConversationIsRegular(side)
            )?.threadId ?? null
            : s.sidePanel.activeSideId
        const nextPanel: SidePanelState = {
          open: nextActiveId ? s.sidePanel.open : false,
          activeSideId: nextActiveId
        }
        return { sideConversations: next, sidePanel: nextPanel }
      })
    },

    discardSideConversation: async (sideId) => {
      const state = ctx.get()
      const side = state.sideConversations[sideId]
      teardownSideSubscription(sideId)
      ctx.set((s) => {
        const next = { ...s.sideConversations }
        delete next[sideId]
        const nextActiveId =
          s.sidePanel.activeSideId === sideId && side
            ? Object.values(next).find((candidate) =>
              candidate.parentThreadId === side.parentThreadId && sideConversationIsRegular(candidate)
            )?.threadId ?? null
            : s.sidePanel.activeSideId
        const nextPanel: SidePanelState = {
          open: nextActiveId ? s.sidePanel.open : false,
          activeSideId: nextActiveId
        }
        return { sideConversations: next, sidePanel: nextPanel }
      })
      if (side) {
        const provider = ctx.getProvider()
        try {
          rememberSideThreadRuntime(provider, sideId, side)
          await provider.deleteThread(sideId)
        } catch (e) {
          ctx.set({
            error: ctx.formatRuntimeError(e),
            ...(ctx.shouldOpenSettingsForError(e)
              ? { route: 'settings' as const, settingsSection: 'agents' as const }
              : {})
          })
        }
      }
    },

    promoteSideConversation: async (sideId) => {
      const state = ctx.get()
      const side = state.sideConversations[sideId]
      if (!side) return
      const provider = ctx.getProvider()
      if (typeof provider.updateThreadRelation !== 'function') {
        ctx.set({ error: ctx.t('common:runtimeFeatureUnsupported') })
        return
      }
      try {
        rememberSideThreadRuntime(provider, sideId, side)
        await provider.updateThreadRelation(sideId, 'primary')
      } catch (e) {
        ctx.set({ error: ctx.formatRuntimeError(e) })
        return
      }
      try {
        await ctx.get().refreshThreads()
      } catch (e) {
        ctx.set({ error: ctx.formatRuntimeError(e) })
      }
      // Closing is a structural teardown; call directly so a stubbed
      // `state.closeSideConversation` (e.g. in tests) cannot swallow it.
      await actions.closeSideConversation(sideId)
    }
  }
  return actions
}

/**
 * Internal helper: tear down all side subscriptions. Used by the
 * `boot`/`unmount` path to avoid dangling SSE streams on app shutdown.
 */
export function teardownAllSideSubscriptions(): void {
  for (const ac of sideAbortControllers.values()) ac.abort()
  sideAbortControllers.clear()
  sideQueueDraining.clear()
}

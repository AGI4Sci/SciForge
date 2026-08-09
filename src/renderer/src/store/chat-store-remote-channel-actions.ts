import {
  REMOTE_CHANNEL_MANAGED_INSTRUCTIONS_HEADING,
  type AgentRuntimeId,
  type RemoteChannelAgentProfileV1,
  type RemoteChannelV1,
  type RemoteChannelPlatformCredentialV1,
  type RemoteChannelProvider,
  type RemoteChannelImSettingsV1,
  type RemoteChannelModel
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { NormalizedThread } from '../agent/types'
import { remoteChannelThreadTitleLooksManaged, remoteChannelThreadIdsFromChannels } from './chat-store-helpers'

type RemoteChannelAgentProviderLike = {
  id?: AgentRuntimeId
  rememberThreadRuntime?: (threadId: string, runtimeId?: AgentRuntimeId) => void
  createThread: (input: { workspace: string; title: string; mode: 'agent' | 'plan' }) => Promise<NormalizedThread>
  getThreadStatus: (threadId: string) => Promise<unknown>
  deleteThread: (threadId: string) => Promise<void>
}

type CreateRemoteChannelActionsOptions = {
  set: ChatStoreSet
  get: ChatStoreGet
  i18n: { t: (key: string, options?: Record<string, unknown>) => string }
  getProvider: () => RemoteChannelAgentProviderLike
  newRemoteChannel: (
    provider: RemoteChannelProvider,
    agentProfile?: Partial<RemoteChannelAgentProfileV1>,
    platformCredential?: RemoteChannelPlatformCredentialV1
  ) => RemoteChannelV1
  normalizeRemoteChannelComposerModel: (raw: string) => string
  activeRemoteChannel: (state: Pick<ChatState, 'remoteChannels' | 'activeRemoteChannelId'>) => RemoteChannelV1 | null
  normalizeWorkspaceRoot: (workspaceRoot?: string | null) => string
  formatRuntimeError: (error: unknown) => string
  shouldOpenSettingsForError: (error: unknown) => boolean
  clearedThreadSelection: () => Pick<
    ChatState,
    | 'activeThreadId'
    | 'blocks'
    | 'liveReasoning'
    | 'liveReasoningMeta'
    | 'liveAssistant'
    | 'busy'
    | 'lastSeq'
    | 'currentTurnId'
    | 'currentTurnUserId'
  >
  sseAbortRef: { current: AbortController | null }
  clearBusyWatchdog: () => void
}

function remoteChannelThreadPlaceholder(
  channel: RemoteChannelV1,
  threadId: string,
  workspaceRoot: string,
  runtimeId: AgentRuntimeId
): NormalizedThread {
  return {
    id: threadId,
    runtimeId,
    title: remoteChannelThreadTitle(channel),
    updatedAt: channel.updatedAt,
    model: channel.model,
    mode: 'agent',
    workspace: workspaceRoot
  }
}

export function remoteChannelThreadIdForProvider(
  channel: RemoteChannelV1,
  conversation: RemoteChannelV1['conversations'][number] | null | undefined,
  runtimeId: AgentRuntimeId
): string {
  const mapped =
    conversation?.agentThreadIds?.[runtimeId]?.trim() ||
    channel.agentThreadIds?.[runtimeId]?.trim() ||
    ''
  if (mapped) return mapped
  return ''
}

function normalizeLiveAgentRuntimeId(value: unknown): AgentRuntimeId {
  return value === 'claude' ? 'claude' : 'codex'
}

function historicalAgentRuntimeId(value: unknown): AgentRuntimeId {
  if (value === 'claude' || value === 'sciforge') return value
  return 'codex'
}

function runtimeIdForProvider(provider: RemoteChannelAgentProviderLike, settings: { activeAgentRuntime?: AgentRuntimeId }): AgentRuntimeId {
  return normalizeLiveAgentRuntimeId(provider.id ?? settings.activeAgentRuntime)
}

function runtimeIdForRemoteChannel(
  channel: RemoteChannelV1,
  provider: RemoteChannelAgentProviderLike,
  settings: { activeAgentRuntime?: AgentRuntimeId }
): AgentRuntimeId {
  return normalizeLiveAgentRuntimeId(channel.runtimeId ?? runtimeIdForProvider(provider, settings))
}

function runtimeIdForRemoteChannelConversation(
  channel: RemoteChannelV1,
  conversation: RemoteChannelV1['conversations'][number] | null | undefined,
  provider: RemoteChannelAgentProviderLike,
  settings: { activeAgentRuntime?: AgentRuntimeId }
): AgentRuntimeId {
  return normalizeLiveAgentRuntimeId(conversation?.runtimeId ?? channel.runtimeId ?? runtimeIdForProvider(provider, settings))
}

function withAgentThreadId(
  current: Partial<Record<AgentRuntimeId, string>> | undefined,
  runtimeId: AgentRuntimeId,
  threadId: string
): Partial<Record<AgentRuntimeId, string>> {
  const next: Partial<Record<AgentRuntimeId, string>> = { ...(current ?? {}) }
  const trimmed = threadId.trim()
  if (trimmed) next[runtimeId] = trimmed
  else delete next[runtimeId]
  return next
}

function remoteChannelThreadTitle(channel: RemoteChannelV1): string {
  return `[Remote channel:${channel.label}]`
}

function titleMatchesRemoteChannel(thread: Pick<NormalizedThread, 'title'>, channel: RemoteChannelV1): boolean {
  const title = thread.title.trim()
  return title.startsWith(remoteChannelThreadTitle(channel))
}

function updatedAtMs(thread: Pick<NormalizedThread, 'updatedAt'>): number {
  const value = Date.parse(thread.updatedAt)
  return Number.isFinite(value) ? value : 0
}

export function findRecoverableRemoteChannelThread(
  threads: NormalizedThread[],
  channels: RemoteChannelV1[],
  channel: RemoteChannelV1,
  runtimeId: AgentRuntimeId
): NormalizedThread | null {
  const normalizedRuntimeId = normalizeLiveAgentRuntimeId(runtimeId)
  const knownThreadIds = remoteChannelThreadIdsFromChannels(channels)
  const candidates = threads
    .filter((thread) => thread.archived !== true)
    .filter((thread) => historicalAgentRuntimeId(thread.runtimeId) === normalizedRuntimeId)
    .filter((thread) => !knownThreadIds.has(thread.id))
    .filter((thread) => remoteChannelThreadTitleLooksManaged(thread.title))
    .sort((a, b) => updatedAtMs(b) - updatedAtMs(a))
  return (
    candidates.find((thread) => thread.title.trim().startsWith(REMOTE_CHANNEL_MANAGED_INSTRUCTIONS_HEADING)) ??
    candidates.find((thread) => titleMatchesRemoteChannel(thread, channel)) ??
    null
  )
}

export function resolveRemoteChannelThreadId(input: {
  configuredThreadId: string
  recoveredThreadId?: string | null
  configuredThreadExists: boolean
  configuredThreadHasUserMessages: boolean
}): string {
  const configured = input.configuredThreadId.trim()
  const recovered = input.recoveredThreadId?.trim() ?? ''
  if (!configured) return recovered
  if (!input.configuredThreadExists) return recovered
  if (recovered && !input.configuredThreadHasUserMessages) return recovered
  return configured
}

async function threadExists(provider: RemoteChannelAgentProviderLike, threadId: string): Promise<boolean> {
  try {
    await provider.getThreadStatus(threadId)
    return true
  } catch {
    return false
  }
}

function threadHasUserMessages(threads: NormalizedThread[], threadId: string): boolean {
  return threads.find((thread) => thread.id === threadId)?.hasUserMessage !== false
}

function rememberRemoteChannelThreadRuntime(
  provider: RemoteChannelAgentProviderLike,
  threadId: string | null | undefined,
  runtimeId: AgentRuntimeId
): void {
  const normalizedThreadId = threadId?.trim()
  if (!normalizedThreadId) return
  provider.rememberThreadRuntime?.(normalizedThreadId, runtimeId)
}

export function channelWithRemoteThreadMapping(
  channel: RemoteChannelV1,
  threadId: string,
  now: string,
  conversationId: string | undefined,
  runtimeId: AgentRuntimeId
): RemoteChannelV1 {
  const normalizedRuntimeId = normalizeLiveAgentRuntimeId(runtimeId)
  const channelThreadId = threadId.trim()
  const next: RemoteChannelV1 = {
    ...channel,
    runtimeId: normalizedRuntimeId,
    agentThreadIds: withAgentThreadId(channel.agentThreadIds, normalizedRuntimeId, channelThreadId),
    updatedAt: now
  }
  if (!conversationId) return next
  return {
    ...next,
    conversations: channel.conversations.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            runtimeId: normalizedRuntimeId,
            agentThreadIds: withAgentThreadId(conversation.agentThreadIds, normalizedRuntimeId, channelThreadId),
            updatedAt: now
          }
        : conversation
    )
  }
}

export function createRemoteChannelActions(options: CreateRemoteChannelActionsOptions): Pick<
  ChatState,
  | 'appendLocalRemoteChannelTurn'
  | 'refreshRemoteChannels'
  | 'addRemoteChannel'
  | 'selectRemoteChannel'
  | 'selectRemoteChannelConversation'
  | 'deleteRemoteChannel'
  | 'resetRemoteChannelSession'
  | 'setRemoteChannelModel'
> {
  const {
    set,
    get,
    i18n,
    getProvider,
    newRemoteChannel,
    normalizeRemoteChannelComposerModel,
    activeRemoteChannel,
    normalizeWorkspaceRoot,
    formatRuntimeError,
    shouldOpenSettingsForError,
    clearedThreadSelection,
    sseAbortRef,
    clearBusyWatchdog
  } = options

  return {
    appendLocalRemoteChannelTurn: (userText, replyText) =>
      set((state) => {
        const now = Date.now()
        return {
          blocks: [
            ...state.blocks,
            {
              kind: 'user',
              id: `local-user-${now}`,
              createdAt: new Date(now).toISOString(),
              text: userText
            },
            {
              kind: 'assistant',
              id: `local-assistant-${now}`,
              createdAt: new Date(now + 1).toISOString(),
              text: replyText
            }
          ],
          liveReasoning: '',
          liveAssistant: '',
          error: null
        }
      }),

    refreshRemoteChannels: async () => {
      if (typeof window.sciforge === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings()
      const channels = settings.remoteChannel.channels
      const current = get().activeRemoteChannelId
      const activeId = current && channels.some((channel) => channel.id === current && channel.enabled)
        ? current
        : channels.find((channel) => channel.enabled)?.id ?? ''
      set({ remoteChannels: channels, activeRemoteChannelId: activeId })
    },

    addRemoteChannel: async (provider, agentProfile, platformCredential, optionsArg) => {
      if (typeof window.sciforge === 'undefined') return
      const preserveRoute = optionsArg?.preserveRoute === true
      const settings = await rendererRuntimeClient.getSettings()
      const targetChannelId = optionsArg?.channelId?.trim() ?? ''
      const existing = targetChannelId
        ? settings.remoteChannel.channels.find((channel) => channel.id === targetChannelId)
        : null
      if (existing) {
        const now = new Date().toISOString()
        const profileName = agentProfile?.name?.trim() ?? ''
        const updatedChannel: RemoteChannelV1 = {
          ...existing,
          label: profileName || existing.label,
          model: optionsArg?.model ?? existing.model,
          workspaceRoot: optionsArg?.workspaceRoot?.trim() ?? existing.workspaceRoot,
          enabled: optionsArg?.enabled ?? existing.enabled,
          agentProfile: {
            name: profileName,
            description: agentProfile?.description?.trim() ?? '',
            identity: agentProfile?.identity ?? '',
            personality: agentProfile?.personality ?? '',
            userContext: agentProfile?.userContext ?? '',
            replyRules: agentProfile?.replyRules ?? ''
          },
          platformCredential: platformCredential ?? existing.platformCredential,
          updatedAt: now
        }
        const channels = settings.remoteChannel.channels.map((channel) =>
          channel.id === existing.id ? updatedChannel : channel
        )
        const saved = await rendererRuntimeClient.setSettings({
          remoteChannel: {
            enabled: true,
            im: {
              enabled: true,
              provider,
              ...(optionsArg?.im ?? {})
            },
            channels
          }
        })
        set({
          remoteChannels: saved.remoteChannel.channels,
          activeRemoteChannelId: existing.id,
          ...(preserveRoute
            ? {}
            : { route: 'chat' as const, remoteGuardChannelId: null, connectPhonePanelOpen: true })
        })
        if (!preserveRoute) await get().selectRemoteChannel(existing.id)
        return
      }
      const duplicateProvider = settings.remoteChannel.channels.find((channel) => channel.provider === provider)
      if (duplicateProvider) {
        const providerLabel =
          provider === 'discord'
            ? 'Discord'
            : provider === 'zulip'
              ? 'Zulip'
              : provider === 'weixin'
                ? 'WeChat'
                : 'Feishu / Lark'
        throw new Error(i18n.t('common:connectPhoneProviderAlreadyConnected', { provider: providerLabel }))
      }

      const channel = newRemoteChannel(provider, agentProfile, platformCredential)
      const runtimeId = normalizeLiveAgentRuntimeId(settings.activeAgentRuntime)
      const nextChannel: RemoteChannelV1 = {
        ...channel,
        runtimeId,
        agentThreadIds: channel.agentThreadIds ?? {},
        model: optionsArg?.model ?? channel.model,
        workspaceRoot: optionsArg?.workspaceRoot?.trim() || settings.workspaceRoot || channel.workspaceRoot,
        enabled: optionsArg?.enabled ?? channel.enabled
      }
      const channels = [...settings.remoteChannel.channels, nextChannel]
      const saved = await rendererRuntimeClient.setSettings({
        remoteChannel: {
          enabled: true,
          im: {
            enabled: true,
            provider,
            ...(optionsArg?.im ?? {})
          },
          channels
        }
      })
      set({
        remoteChannels: saved.remoteChannel.channels,
        activeRemoteChannelId: nextChannel.id,
        ...(preserveRoute
          ? {}
          : { route: 'chat' as const, remoteGuardChannelId: null, connectPhonePanelOpen: true })
      })
      if (!preserveRoute) await get().selectRemoteChannel(nextChannel.id)
    },

    selectRemoteChannel: async (channelId) => {
      if (get().runtimeConnection !== 'ready') {
        set({ activeRemoteChannelId: channelId, error: i18n.t('common:runtimeActionNeedsConnection') })
        return
      }
      if (typeof window.sciforge === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings()
      const channels = settings.remoteChannel.channels
      const channel = channels.find((item) => item.id === channelId)
      if (!channel) {
        set({ remoteChannels: channels, activeRemoteChannelId: '', remoteGuardChannelId: null })
        return
      }
      set({
        remoteChannels: channels,
        activeRemoteChannelId: channel.id,
        remoteGuardChannelId: null,
        composerModel: channel.model
      })
      const provider = getProvider()
      const latestConversation =
        [...channel.conversations]
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null
      const runtimeId = runtimeIdForRemoteChannelConversation(channel, latestConversation, provider, settings)
      const desiredWorkspaceRoot = normalizeWorkspaceRoot(
        latestConversation?.workspaceRoot
        || channel.workspaceRoot
        || settings.remoteChannel.im.workspaceRoot
        || settings.workspaceRoot
      )
      let threadId = remoteChannelThreadIdForProvider(channel, latestConversation, runtimeId)
      const recoveredThread = findRecoverableRemoteChannelThread(get().threads, channels, channel, runtimeId)
      rememberRemoteChannelThreadRuntime(provider, threadId, runtimeId)
      const configuredThreadExists = threadId ? await threadExists(provider, threadId) : false
      const configuredThreadHasUserMessages =
        threadId && configuredThreadExists ? threadHasUserMessages(get().threads, threadId) : false
      const configuredThreadId = threadId
      threadId = resolveRemoteChannelThreadId({
        configuredThreadId,
        recoveredThreadId: recoveredThread?.id ?? '',
        configuredThreadExists,
        configuredThreadHasUserMessages
      })
      let createdThread: NormalizedThread | null = null
      if (!threadId) {
        if (!latestConversation) {
          if (configuredThreadId) {
            const now = new Date().toISOString()
            const nextChannels = channels.map((item) =>
              item.id === channel.id
                ? channelWithRemoteThreadMapping(item, '', now, undefined, runtimeId)
                : item
            )
            const saved = await rendererRuntimeClient.setSettings({ remoteChannel: { channels: nextChannels } })
            set({ remoteChannels: saved.remoteChannel.channels })
          }
          set({
            route: 'chat',
            remoteGuardChannelId: null,
            activeRemoteChannelId: channel.id,
            composerModel: channel.model,
            error: null
          })
          return
        }
        try {
          const thread = await provider.createThread({
            workspace: desiredWorkspaceRoot,
            title: remoteChannelThreadTitle(channel),
            mode: 'agent'
          })
          threadId = thread.id
          createdThread = thread
        } catch (error) {
          set({
            error: formatRuntimeError(error),
            ...(shouldOpenSettingsForError(error)
              ? { route: 'settings' as const, settingsSection: 'agents' as const }
              : {})
          })
          return
        }
      }
      if (
        !remoteChannelThreadIdForProvider(channel, null, runtimeId) ||
        (latestConversation && !remoteChannelThreadIdForProvider(channel, latestConversation, runtimeId)) ||
        threadId !== configuredThreadId
      ) {
        const now = new Date().toISOString()
        const nextChannels = channels.map((item) =>
          item.id === channel.id
            ? channelWithRemoteThreadMapping(item, threadId, now, latestConversation?.id, runtimeId)
            : item
        )
        const saved = await rendererRuntimeClient.setSettings({ remoteChannel: { channels: nextChannels } })
        set({ remoteChannels: saved.remoteChannel.channels })
      }
      const placeholder = remoteChannelThreadPlaceholder(channel, threadId, desiredWorkspaceRoot, runtimeId)
      set((state) => ({
        threads: state.threads.some((thread) => thread.id === threadId)
          ? state.threads
          : [createdThread ?? recoveredThread ?? placeholder, ...state.threads]
      }))
      await get().selectThread(threadId)
      set({ route: 'chat', activeRemoteChannelId: channel.id, remoteGuardChannelId: null })
    },

    selectRemoteChannelConversation: async (channelId, threadId) => {
      if (get().runtimeConnection !== 'ready') {
        set({ activeRemoteChannelId: channelId, error: i18n.t('common:runtimeActionNeedsConnection') })
        return
      }
      if (typeof window.sciforge === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings()
      const channels = settings.remoteChannel.channels
      const channel = channels.find((item) => item.id === channelId)
      if (!channel) {
        set({ remoteChannels: channels, activeRemoteChannelId: '' })
        return
      }
      const provider = getProvider()
      const requestedThreadId = threadId.trim()
      const conversation = channel.conversations.find((item) => {
        const itemRuntimeId = runtimeIdForRemoteChannelConversation(channel, item, provider, settings)
        return remoteChannelThreadIdForProvider(channel, item, itemRuntimeId) === requestedThreadId
      })
      if (!conversation) {
        await get().selectRemoteChannel(channelId)
        return
      }
      set({
        route: 'chat',
        remoteGuardChannelId: null,
        remoteChannels: channels,
        activeRemoteChannelId: channel.id,
        composerModel: channel.model
      })
      const runtimeId = runtimeIdForRemoteChannelConversation(channel, conversation, provider, settings)
      const workspaceRoot = normalizeWorkspaceRoot(
        conversation.workspaceRoot ||
        channel.workspaceRoot ||
        settings.remoteChannel.im.workspaceRoot ||
        settings.workspaceRoot
      )
      let targetThreadId = remoteChannelThreadIdForProvider(channel, conversation, runtimeId)
      const configuredThreadId = targetThreadId
      rememberRemoteChannelThreadRuntime(provider, targetThreadId, runtimeId)
      const configuredThreadExists = targetThreadId ? await threadExists(provider, targetThreadId) : false
      if (!configuredThreadExists) {
        targetThreadId = ''
      }
      if (!targetThreadId) {
        try {
          const thread = await provider.createThread({
            workspace: workspaceRoot,
            title: remoteChannelThreadTitle(channel),
            mode: 'agent'
          })
          targetThreadId = thread.id
          set((state) => ({
            threads: state.threads.some((item) => item.id === thread.id)
              ? state.threads
              : [thread, ...state.threads]
          }))
        } catch (error) {
          set({
            error: formatRuntimeError(error),
            ...(shouldOpenSettingsForError(error)
              ? { route: 'settings' as const, settingsSection: 'agents' as const }
              : {})
          })
          return
        }
      }
      const placeholder = remoteChannelThreadPlaceholder(channel, targetThreadId, workspaceRoot, runtimeId)
      set((state) => ({
        threads: state.threads.some((thread) => thread.id === targetThreadId)
          ? state.threads
          : [placeholder, ...state.threads]
      }))
      if (!remoteChannelThreadIdForProvider(channel, conversation, runtimeId) || targetThreadId !== configuredThreadId) {
        const now = new Date().toISOString()
        const nextChannels = channels.map((item) =>
          item.id === channel.id
            ? channelWithRemoteThreadMapping(item, targetThreadId, now, conversation.id, runtimeId)
            : item
        )
        const saved = await rendererRuntimeClient.setSettings({ remoteChannel: { channels: nextChannels } })
        set({ remoteChannels: saved.remoteChannel.channels })
      }
      await get().selectThread(targetThreadId)
      set({ route: 'chat', activeRemoteChannelId: channel.id, remoteGuardChannelId: null })
    },

    deleteRemoteChannel: async (channelId) => {
      if (typeof window.sciforge === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings()
      const channel = settings.remoteChannel.channels.find((item) => item.id === channelId)
      const channels = settings.remoteChannel.channels.filter((item) => item.id !== channelId)
      const saved = await rendererRuntimeClient.setSettings({ remoteChannel: { channels } })
      const nextChannel = saved.remoteChannel.channels.find((item) => item.enabled) ?? null
      set({
        remoteChannels: saved.remoteChannel.channels,
        activeRemoteChannelId: nextChannel?.id ?? '',
        remoteGuardChannelId: get().remoteGuardChannelId === channelId ? null : get().remoteGuardChannelId
      })
      if (channel && get().runtimeConnection === 'ready') {
        const provider = getProvider()
        const runtimeId = runtimeIdForRemoteChannel(channel, provider, settings)
        const mappedThreadId = remoteChannelThreadIdForProvider(channel, null, runtimeId)
        if (mappedThreadId) {
          rememberRemoteChannelThreadRuntime(provider, mappedThreadId, runtimeId)
          await provider.deleteThread(mappedThreadId).catch(() => undefined)
        }
      }
      if (nextChannel) {
        await get().selectRemoteChannel(nextChannel.id)
      } else {
        set({ route: 'chat' })
      }
    },

    resetRemoteChannelSession: async (channelId) => {
      if (get().runtimeConnection !== 'ready') {
        set({ error: i18n.t('common:runtimeActionNeedsConnection') })
        return
      }
      if (typeof window.sciforge === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings()
      const channel = settings.remoteChannel.channels.find((item) => item.id === channelId)
      if (!channel) return
      const provider = getProvider()
      const runtimeId = runtimeIdForRemoteChannel(channel, provider, settings)
      const oldThreadId = remoteChannelThreadIdForProvider(channel, null, runtimeId)
      try {
        const thread = await provider.createThread({
          workspace: normalizeWorkspaceRoot(
            channel.workspaceRoot || settings.remoteChannel.im.workspaceRoot || settings.workspaceRoot
          ),
          title: remoteChannelThreadTitle(channel),
          mode: 'agent'
        })
        const now = new Date().toISOString()
        const channels = settings.remoteChannel.channels.map((item) =>
          item.id === channel.id
            ? {
                ...channelWithRemoteThreadMapping(item, thread.id, now, undefined, runtimeId),
                conversations: item.conversations.map((conversation) =>
                  channelWithRemoteThreadMapping(
                    { ...item, conversations: [conversation] },
                    thread.id,
                    now,
                    conversation.id,
                    runtimeId
                  ).conversations[0] ?? conversation
                )
              }
            : item
        )
        const saved = await rendererRuntimeClient.setSettings({ remoteChannel: { channels } })
        set((state) => ({
          route: 'chat',
          activeRemoteChannelId: channel.id,
          remoteGuardChannelId: null,
          remoteChannels: saved.remoteChannel.channels,
          threads: state.threads.some((item) => item.id === thread.id)
            ? state.threads
            : [thread, ...state.threads]
        }))
        await get().selectThread(thread.id)
        if (oldThreadId && oldThreadId !== thread.id) {
          rememberRemoteChannelThreadRuntime(provider, oldThreadId, runtimeId)
          await provider.deleteThread(oldThreadId).catch(() => undefined)
          await get().refreshThreads()
        }
        set({ error: i18n.t('common:remoteChannelSessionCleared') })
      } catch (error) {
        set({
          error: formatRuntimeError(error),
          ...(shouldOpenSettingsForError(error)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
    },

    setRemoteChannelModel: async (channelId, model) => {
      if (typeof window.sciforge === 'undefined') return
      const normalized = normalizeRemoteChannelComposerModel(model)
      const settings = await rendererRuntimeClient.getSettings()
      const now = new Date().toISOString()
      const channels = settings.remoteChannel.channels.map((channel) =>
        channel.id === channelId ? { ...channel, model: normalized, updatedAt: now } : channel
      )
      const saved = await rendererRuntimeClient.setSettings({ remoteChannel: { channels } })
      set({
        remoteChannels: saved.remoteChannel.channels,
        composerModel: normalized,
        error: i18n.t('common:remoteChannelModelChanged', { model: normalized })
      })
    }
  }
}

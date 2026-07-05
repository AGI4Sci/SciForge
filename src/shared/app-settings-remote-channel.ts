import {
  DEFAULT_REMOTE_CHANNEL_MODEL,
  DEFAULT_WEIXIN_BRIDGE_RPC_URL,
  type RemoteChannelV1,
  type RemoteChannelConversationV1,
  type RemoteChannelRecentMessageV1,
  type RemoteChannelImSettingsV1,
  type RemoteChannelProvider,
  type ConnectPhoneSettingsPatchV1,
  type ConnectPhoneSettingsV1,
  type RemoteChannelSettingsPatchV1,
  type RemoteChannelSettingsV1
} from './app-settings-types'
import {
  normalizeRemoteChannelAgentProfile,
  normalizeRemoteChannelLastFailure,
  normalizeRemoteChannelConversation,
  normalizeRemoteChannelPlatformCredential,
  normalizeRemoteChannelRemoteSession,
  normalizeAgentThreadIds,
  normalizeSettingsRuntimeId
} from './app-settings-prompts'
import {
  compactStrings,
  normalizeBoolean,
  normalizeRemoteChannelGuardMode,
  normalizeRemoteChannelModel,
  normalizeImProvider,
  normalizePathSegment,
  normalizePositiveInteger,
  normalizeRunMode
} from './app-settings-normalizers'

function defaultRemoteChannelLabel(provider: RemoteChannelProvider): string {
  if (provider === 'zulip') return 'zulip bot'
  if (provider === 'discord') return 'discord bot'
  return provider === 'weixin' ? 'weixin agent' : 'feishu agent'
}

function normalizeLegacyDefaultRemoteChannelName(provider: RemoteChannelProvider, value: string): string {
  const trimmed = value.trim()
  const lower = trimmed.toLowerCase()
  if (provider === 'weixin') {
    return lower === 'weixin agent' || lower === 'wechat agent' || lower === 'wechat'
      ? 'weixin agent'
      : trimmed
  }
  if (provider === 'discord') {
    return lower === 'discord' || lower === 'discord agent' || lower === 'discord bot'
      ? 'discord bot'
      : trimmed
  }
  if (provider === 'zulip') {
    return lower === 'zulip' || lower === 'zulip agent' || lower === 'zulip bot'
      ? 'zulip bot'
      : trimmed
  }
  if (lower === 'feishu agent' || lower === 'feishu / lark') return 'feishu agent'
  if (lower === 'lark agent') return 'lark agent'
  return trimmed
}

function normalizeRemoteChannelLabel(provider: RemoteChannelProvider, value: string): string {
  const normalized = normalizeLegacyDefaultRemoteChannelName(provider, value)
  return normalized || defaultRemoteChannelLabel(provider)
}

function normalizeIsoDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback
}

function normalizeRemoteChannelRecentMessage(input: unknown, fallbackProvider: RemoteChannelProvider): RemoteChannelRecentMessageV1 | null {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const messageId = typeof raw.messageId === 'string' ? raw.messageId.trim() : ''
  const channelId = typeof raw.channelId === 'string' ? raw.channelId.trim() : ''
  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim() : ''
  if (!messageId || !channelId || !chatId) return null
  const now = new Date().toISOString()
  return {
    provider: normalizeImProvider(raw.provider ?? fallbackProvider),
    channelId,
    chatId,
    remoteThreadId: typeof raw.remoteThreadId === 'string' ? raw.remoteThreadId.trim() : '',
    messageId,
    ...(typeof raw.senderName === 'string' && raw.senderName.trim()
      ? { senderName: raw.senderName.trim().slice(0, 512) }
      : {}),
    ...(typeof raw.text === 'string' && raw.text.trim()
      ? { text: raw.text.trim().slice(0, 2_000) }
      : {}),
    receivedAt: normalizeIsoDate(raw.receivedAt, now)
  }
}

export function defaultRemoteChannelSettings(): RemoteChannelSettingsV1 {
  return {
    enabled: false,
    skills: {
      defaultNames: [],
      extraDirs: [],
      promptPrefix: ''
    },
    im: {
      enabled: false,
      provider: 'feishu',
      port: 8787,
      path: '/remote-channel/webhook',
      secret: '',
      workspaceRoot: '',
      model: DEFAULT_REMOTE_CHANNEL_MODEL,
      mode: 'agent',
      responseTimeoutMs: 120_000
    },
    channels: []
  }
}

export function defaultConnectPhoneSettings(): ConnectPhoneSettingsV1 {
  return {
    weixinBridgeUrl: DEFAULT_WEIXIN_BRIDGE_RPC_URL
  }
}

export function normalizeRemoteChannelSettings(input: RemoteChannelSettingsPatchV1 | undefined): RemoteChannelSettingsV1 {
  const defaults = defaultRemoteChannelSettings()
  const source = input ?? {}
  const skills = source.skills ?? defaults.skills
  const im = source.im ?? defaults.im
  const rawChannels = Array.isArray(source.channels)
    ? source.channels.filter((channel) => {
        const raw = channel as Partial<RemoteChannelV1>
        return (
          raw.provider === undefined ||
          raw.provider === null ||
          raw.provider === 'feishu' ||
          raw.provider === 'weixin' ||
          raw.provider === 'discord' ||
          raw.provider === 'zulip'
        )
      })
    : []
  const now = new Date().toISOString()
  return {
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    skills: {
      defaultNames: compactStrings(skills.defaultNames),
      extraDirs: compactStrings(skills.extraDirs),
      promptPrefix: typeof skills.promptPrefix === 'string' ? skills.promptPrefix : ''
    },
    im: {
      enabled: normalizeBoolean(im.enabled, defaults.im.enabled),
      provider: normalizeImProvider(im.provider),
      port: normalizePositiveInteger(im.port, defaults.im.port, 1024, 65_535),
      path: normalizePathSegment(im.path),
      secret: typeof im.secret === 'string' ? im.secret.trim() : '',
      workspaceRoot: typeof im.workspaceRoot === 'string' ? im.workspaceRoot.trim() : '',
      model: typeof im.model === 'string' && im.model.trim() ? im.model.trim() : DEFAULT_REMOTE_CHANNEL_MODEL,
      mode: normalizeRunMode(im.mode),
      responseTimeoutMs: normalizePositiveInteger(im.responseTimeoutMs, defaults.im.responseTimeoutMs, 5_000, 600_000)
    },
    channels: rawChannels
      .map((channel, index): RemoteChannelV1 => {
          const raw = channel as Record<string, unknown>
          const provider = normalizeImProvider(raw.provider as RemoteChannelProvider)
          const agentThreadIds = normalizeAgentThreadIds(raw.agentThreadIds)
          const agentProfile = normalizeRemoteChannelAgentProfile(raw.agentProfile)
          const label = normalizeRemoteChannelLabel(provider, typeof raw.label === 'string' ? raw.label : '')
          const profileName = normalizeLegacyDefaultRemoteChannelName(provider, agentProfile.name)
          return {
            id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `im-${index + 1}`,
            provider,
            label,
            enabled: normalizeBoolean(raw.enabled, true),
            guardMode: normalizeRemoteChannelGuardMode(raw.guardMode),
            model: normalizeRemoteChannelModel(raw.model),
            runtimeId: normalizeSettingsRuntimeId(raw.runtimeId),
            agentThreadIds,
            workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot.trim() : '',
            agentProfile: {
              ...agentProfile,
              name: profileName || label
            },
            platformCredential: normalizeRemoteChannelPlatformCredential(raw.platformCredential),
            remoteSession: normalizeRemoteChannelRemoteSession(raw.remoteSession),
            conversations: Array.isArray(raw.conversations)
              ? raw.conversations
                  .map((conversation) => normalizeRemoteChannelConversation(conversation, provider))
                  .filter((conversation): conversation is RemoteChannelConversationV1 => conversation != null)
              : [],
            recentMessages: Array.isArray(raw.recentMessages)
              ? raw.recentMessages
                  .map((message) => normalizeRemoteChannelRecentMessage(message, provider))
                  .filter((message): message is RemoteChannelRecentMessageV1 => message != null)
                  .slice(-2_000)
              : [],
            lastFailure: normalizeRemoteChannelLastFailure(raw.lastFailure, provider),
            createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : now,
            updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : now
          }
        })
  }
}

export function normalizeConnectPhoneSettings(
  input: ConnectPhoneSettingsPatchV1 | undefined
): ConnectPhoneSettingsV1 {
  const defaults = defaultConnectPhoneSettings()
  const weixinBridgeUrl = typeof input?.weixinBridgeUrl === 'string' ? input.weixinBridgeUrl.trim() : ''
  return {
    weixinBridgeUrl: weixinBridgeUrl || defaults.weixinBridgeUrl
  }
}

export function mergeRemoteChannelSettings(
  current: RemoteChannelSettingsV1,
  patch: RemoteChannelSettingsPatchV1 | undefined
): RemoteChannelSettingsV1 {
  if (!patch) return normalizeRemoteChannelSettings(current)
  return normalizeRemoteChannelSettings({
    ...current,
    ...patch,
    skills: {
      ...current.skills,
      ...(patch.skills ?? {})
    },
    im: {
      ...current.im,
      ...(patch.im ?? {})
    },
    channels: patch.channels ?? current.channels
  })
}

export function mergeConnectPhoneSettings(
  current: ConnectPhoneSettingsV1,
  patch: ConnectPhoneSettingsPatchV1 | undefined
): ConnectPhoneSettingsV1 {
  if (!patch) return normalizeConnectPhoneSettings(current)
  return normalizeConnectPhoneSettings({
    ...current,
    ...patch
  })
}

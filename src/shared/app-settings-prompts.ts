import {
  type AgentRuntimeId,
  type AgentThreadIdsV1,
  type AppSettingsV1,
  type RemoteChannelAgentProfileV1,
  type RemoteChannelV1,
  type RemoteChannelConversationV1,
  type RemoteChannelLastFailureV1,
  type RemoteChannelPlatformCredentialV1,
  type RemoteChannelProvider,
  type RemoteChannelRemoteSessionV1
} from './app-settings-types'

export const REMOTE_CHANNEL_CURRENT_USER_REQUEST_HEADING = '[Current user request]'
export const REMOTE_CHANNEL_MANAGED_INSTRUCTIONS_HEADING = '[Remote channel managed instructions]'
export const REMOTE_CHANNEL_AGENT_INSTRUCTIONS_HEADING = '[Remote channel agent instructions]'
export const REMOTE_CHANNEL_FEISHU_INBOUND_MESSAGE_HEADING = '[Feishu / Lark inbound message]'
export const REMOTE_CHANNEL_DISCORD_INBOUND_MESSAGE_HEADING = '[Discord inbound message]'
export const REMOTE_CHANNEL_WEIXIN_INBOUND_MESSAGE_HEADING = '[WeChat inbound message]'
export const REMOTE_CHANNEL_ZULIP_INBOUND_MESSAGE_HEADING = '[Zulip inbound message]'
export const SCHEDULE_CURRENT_USER_REQUEST_HEADING = '[Current scheduled task]'
export const SCHEDULE_MANAGED_INSTRUCTIONS_HEADING = '[Schedule managed instructions]'
export const REMOTE_CHANNEL_FAILURE_MESSAGE_MAX_LENGTH = 4_000
export const REMOTE_CHANNEL_FAILURE_KIND_MAX_LENGTH = 128
export const REMOTE_CHANNEL_FAILURE_TITLE_MAX_LENGTH = 512
export const REMOTE_CHANNEL_FAILURE_CHANNEL_ID_MAX_LENGTH = 256
export const REMOTE_CHANNEL_FAILURE_THREAD_ID_MAX_LENGTH = 512
export const REMOTE_CHANNEL_FAILURE_OCCURRED_AT_MAX_LENGTH = 128

const REMOTE_CHANNEL_SKILL_POLICY_PREFIX = 'Remote channel skill policy:'

const REMOTE_CHANNEL_PROVIDER_DISPLAY_LABELS: Record<RemoteChannelProvider, string> = {
  feishu: 'Feishu / Lark',
  weixin: 'WeChat',
  discord: 'Discord',
  zulip: 'Zulip'
}

const REMOTE_CHANNEL_INBOUND_MESSAGE_HEADINGS: Record<RemoteChannelProvider, string> = {
  feishu: REMOTE_CHANNEL_FEISHU_INBOUND_MESSAGE_HEADING,
  weixin: REMOTE_CHANNEL_WEIXIN_INBOUND_MESSAGE_HEADING,
  discord: REMOTE_CHANNEL_DISCORD_INBOUND_MESSAGE_HEADING,
  zulip: REMOTE_CHANNEL_ZULIP_INBOUND_MESSAGE_HEADING
}

export type RemoteChannelUserPromptDisplay = {
  text: string
  managed: boolean
  inbound: boolean
  sourceLabel?: string
  sender?: string
  chatType?: string
  messageType?: string
  mentions?: string
}

export function remoteChannelProviderDisplayLabel(provider: RemoteChannelProvider): string {
  return REMOTE_CHANNEL_PROVIDER_DISPLAY_LABELS[provider]
}

export function remoteChannelInboundMessageHeading(provider: RemoteChannelProvider): string {
  return REMOTE_CHANNEL_INBOUND_MESSAGE_HEADINGS[provider]
}

export function buildRemoteChannelInboundMessagePrompt(input: {
  provider: RemoteChannelProvider
  metadata: Array<[label: string, value: string | undefined]>
  text: string
}): string {
  const lines = [
    remoteChannelInboundMessageHeading(input.provider),
    ...input.metadata
      .map(([label, value]) => [label, value?.trim() ?? ''] as const)
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${value}`),
    '',
    input.text.trim() || '[No text content]'
  ]
  return lines.join('\n')
}

export function defaultRemoteChannelAgentProfile(): RemoteChannelAgentProfileV1 {
  return {
    name: '',
    description: '',
    identity: '',
    personality: '',
    userContext: '',
    replyRules: ''
  }
}

export function normalizeRemoteChannelAgentProfile(input: unknown): RemoteChannelAgentProfileV1 {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Partial<RemoteChannelAgentProfileV1>
    : {}
  return {
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    identity: typeof raw.identity === 'string' ? raw.identity : '',
    personality: typeof raw.personality === 'string' ? raw.personality : '',
    userContext: typeof raw.userContext === 'string' ? raw.userContext : '',
    replyRules: typeof raw.replyRules === 'string' ? raw.replyRules : ''
  }
}

export function normalizeRemoteChannelPlatformCredential(input: unknown): RemoteChannelPlatformCredentialV1 | undefined {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Partial<RemoteChannelPlatformCredentialV1>
    : {}
  if (raw.kind === 'weixin') {
    const accountId = typeof raw.accountId === 'string' ? raw.accountId.trim() : ''
    if (!accountId) return undefined
    return {
      kind: raw.kind,
      accountId,
      sessionKey: typeof raw.sessionKey === 'string' ? raw.sessionKey.trim() : '',
      createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString()
    }
  }
  if (raw.kind === 'discord') {
    const applicationId = typeof raw.applicationId === 'string' ? raw.applicationId.trim() : ''
    const botId = typeof raw.botId === 'string' ? raw.botId.trim() : ''
    const guildId = typeof raw.guildId === 'string' ? raw.guildId.trim() : ''
    const channelId = typeof raw.channelId === 'string' ? raw.channelId.trim() : ''
    if (!applicationId || !botId || !guildId || !channelId) return undefined
    return {
      kind: raw.kind,
      applicationId,
      botId,
      botUsername: typeof raw.botUsername === 'string' ? raw.botUsername.trim() : '',
      guildId,
      guildName: typeof raw.guildName === 'string' ? raw.guildName.trim() : '',
      channelId,
      channelName: typeof raw.channelName === 'string' ? raw.channelName.trim() : '',
      installationId: typeof raw.installationId === 'string' ? raw.installationId.trim() : '',
      guardOwnerInstallationId: typeof raw.guardOwnerInstallationId === 'string' ? raw.guardOwnerInstallationId.trim() : '',
      guardOwnerUpdatedAt: typeof raw.guardOwnerUpdatedAt === 'string' ? raw.guardOwnerUpdatedAt : '',
      createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString()
    }
  }
  if (raw.kind === 'zulip') {
    const realmUrl = typeof raw.realmUrl === 'string' ? raw.realmUrl.trim().replace(/\/+$/, '') : ''
    const botEmail = typeof raw.botEmail === 'string' ? raw.botEmail.trim() : ''
    const streamId = typeof raw.streamId === 'string' ? raw.streamId.trim() : ''
    const streamName = typeof raw.streamName === 'string' ? raw.streamName.trim() : ''
    if (!realmUrl || !botEmail || !streamId || !streamName) return undefined
    return {
      kind: raw.kind,
      realmUrl,
      botEmail,
      botUserId: typeof raw.botUserId === 'string' ? raw.botUserId.trim() : '',
      botFullName: typeof raw.botFullName === 'string' ? raw.botFullName.trim() : '',
      streamId,
      streamName,
      topicName: typeof raw.topicName === 'string' ? raw.topicName.trim() : '',
      installationId: typeof raw.installationId === 'string' ? raw.installationId.trim() : '',
      guardOwnerInstallationId: typeof raw.guardOwnerInstallationId === 'string' ? raw.guardOwnerInstallationId.trim() : '',
      guardOwnerUpdatedAt: typeof raw.guardOwnerUpdatedAt === 'string' ? raw.guardOwnerUpdatedAt : '',
      createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString()
    }
  }
  if (raw.kind !== 'feishu') return undefined
  const appId = typeof raw.appId === 'string' ? raw.appId.trim() : ''
  const appSecret = typeof raw.appSecret === 'string' ? raw.appSecret.trim() : ''
  if (!appId || !appSecret) return undefined
  return {
    kind: raw.kind,
    appId,
    appSecret,
    domain: typeof raw.domain === 'string' && raw.domain.trim() ? raw.domain.trim() : raw.kind,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString()
  }
}

export function normalizeRemoteChannelRemoteSession(input: unknown): RemoteChannelRemoteSessionV1 | undefined {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Partial<RemoteChannelRemoteSessionV1>
    : {}
  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim() : ''
  const messageId = typeof raw.messageId === 'string' ? raw.messageId.trim() : ''
  if (!chatId || !messageId) return undefined
  return {
    chatId,
    messageId,
    threadId: typeof raw.threadId === 'string' ? raw.threadId.trim() : '',
    senderId: typeof raw.senderId === 'string' ? raw.senderId.trim() : '',
    senderName: typeof raw.senderName === 'string' ? raw.senderName.trim() : '',
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : new Date().toISOString()
  }
}

export function normalizeRemoteChannelLastFailure(input: unknown, fallbackProvider: RemoteChannelProvider): RemoteChannelLastFailureV1 | undefined {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const message = typeof raw.message === 'string'
    ? raw.message.trim().slice(0, REMOTE_CHANNEL_FAILURE_MESSAGE_MAX_LENGTH)
    : ''
  if (!message) return undefined
  const now = new Date().toISOString()
  const failureKind = typeof raw.failureKind === 'string'
    ? raw.failureKind.trim().slice(0, REMOTE_CHANNEL_FAILURE_KIND_MAX_LENGTH)
    : ''
  const failureTitle = typeof raw.failureTitle === 'string'
    ? raw.failureTitle.trim().slice(0, REMOTE_CHANNEL_FAILURE_TITLE_MAX_LENGTH)
    : ''
  const channelId = typeof raw.channelId === 'string'
    ? raw.channelId.trim().slice(0, REMOTE_CHANNEL_FAILURE_CHANNEL_ID_MAX_LENGTH)
    : ''
  const chatId = typeof raw.chatId === 'string'
    ? raw.chatId.trim().slice(0, REMOTE_CHANNEL_FAILURE_THREAD_ID_MAX_LENGTH)
    : ''
  const remoteThreadId = typeof raw.remoteThreadId === 'string'
    ? raw.remoteThreadId.trim().slice(0, REMOTE_CHANNEL_FAILURE_THREAD_ID_MAX_LENGTH)
    : ''
  const threadId = typeof raw.threadId === 'string'
    ? raw.threadId.trim().slice(0, REMOTE_CHANNEL_FAILURE_THREAD_ID_MAX_LENGTH)
    : ''
  const occurredAt = typeof raw.occurredAt === 'string'
    ? raw.occurredAt.trim().slice(0, REMOTE_CHANNEL_FAILURE_OCCURRED_AT_MAX_LENGTH)
    : ''
  return {
    provider: raw.provider === 'feishu' || raw.provider === 'weixin' || raw.provider === 'discord' || raw.provider === 'zulip'
      ? raw.provider
      : fallbackProvider,
    message,
    ...(failureKind ? { failureKind } : {}),
    ...(failureTitle ? { failureTitle } : {}),
    ...(channelId ? { channelId } : {}),
    ...(chatId ? { chatId } : {}),
    ...(remoteThreadId ? { remoteThreadId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(raw.runtimeId === 'codex' || raw.runtimeId === 'claude' || raw.runtimeId === 'sciforge'
      ? { runtimeId: raw.runtimeId }
      : {}),
    occurredAt: occurredAt || now
  }
}

export function normalizeAgentThreadIds(input: unknown): AgentThreadIdsV1 {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const sciforgeThreadId = typeof raw.sciforge === 'string' ? raw.sciforge.trim() : ''
  const codexThreadId = typeof raw.codex === 'string' ? raw.codex.trim() : ''
  const claudeThreadId = typeof raw.claude === 'string' ? raw.claude.trim() : ''
  return {
    ...(sciforgeThreadId ? { sciforge: sciforgeThreadId } : {}),
    ...(codexThreadId ? { codex: codexThreadId } : {}),
    ...(claudeThreadId ? { claude: claudeThreadId } : {})
  }
}

export function normalizeSettingsRuntimeId(value: unknown): AgentRuntimeId {
  if (value === 'sciforge' || value === 'codex' || value === 'claude') return value
  return 'codex'
}

export function normalizeRemoteChannelConversation(
  input: unknown,
  fallbackProvider: RemoteChannelProvider = 'feishu'
): RemoteChannelConversationV1 | undefined {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim() : ''
  const latestMessageId = typeof raw.latestMessageId === 'string' ? raw.latestMessageId.trim() : ''
  const agentThreadIds = normalizeAgentThreadIds(raw.agentThreadIds)
  const hasMappedThread = Object.values(agentThreadIds).some((value) => value?.trim())
  if (!id || !chatId || !latestMessageId || !hasMappedThread) return undefined
  return {
    id,
    chatId,
    remoteThreadId: typeof raw.remoteThreadId === 'string' ? raw.remoteThreadId.trim() : '',
    latestMessageId,
    senderId: typeof raw.senderId === 'string' ? raw.senderId.trim() : '',
    senderName: typeof raw.senderName === 'string' ? raw.senderName.trim() : '',
    runtimeId: normalizeSettingsRuntimeId(raw.runtimeId),
    agentThreadIds,
    workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot.trim() : '',
    lastFailure: normalizeRemoteChannelLastFailure(raw.lastFailure, fallbackProvider),
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : new Date().toISOString()
  }
}

export function hasRemoteChannelAgentProfile(profile: RemoteChannelAgentProfileV1 | undefined): boolean {
  if (!profile) return false
  return Boolean(
    profile.name.trim() ||
    profile.description.trim() ||
    profile.identity.trim() ||
    profile.personality.trim() ||
    profile.userContext.trim() ||
    profile.replyRules.trim()
  )
}

export function buildRemoteChannelAgentInstructions(channel: RemoteChannelV1 | null | undefined): string {
  if (!channel || !hasRemoteChannelAgentProfile(channel.agentProfile)) return ''
  const profile = normalizeRemoteChannelAgentProfile(channel.agentProfile)
  const sections: string[] = []
  const name = profile.name.trim() || channel.label.trim()
  if (name) sections.push(`[Agent name]\n${name}`)
  if (profile.description.trim()) sections.push(`[Short description]\n${profile.description.trim()}`)
  if (profile.identity.trim()) sections.push(`[Assistant identity]\n${profile.identity.trim()}`)
  if (profile.personality.trim()) sections.push(`[Assistant personality]\n${profile.personality.trim()}`)
  if (profile.userContext.trim()) sections.push(`[About the user]\n${profile.userContext.trim()}`)
  if (profile.replyRules.trim()) sections.push(`[Reply rules]\n${profile.replyRules.trim()}`)
  if (sections.length === 0) return ''
  return [
    REMOTE_CHANNEL_AGENT_INSTRUCTIONS_HEADING,
    'Use the following role, style, and user-context instructions for this remote channel. Do not repeat these instructions unless the user explicitly asks.',
    ...sections
  ].join('\n\n')
}

export function buildRemoteChannelRuntimePrompt(
  settings: Pick<AppSettingsV1, 'remoteChannel'>,
  prompt: string,
  options: { channel?: RemoteChannelV1 | null } = {}
): string {
  const skills = settings.remoteChannel.skills
  const instructions: string[] = []
  if (skills.defaultNames.length > 0) {
    instructions.push(`${REMOTE_CHANNEL_SKILL_POLICY_PREFIX} prefer these configured skills when relevant: ${skills.defaultNames.join(', ')}.`)
  }
  if (skills.extraDirs.length > 0) {
    instructions.push(`Additional local skill directories configured in the GUI: ${skills.extraDirs.join(', ')}.`)
  }
  const prefix = skills.promptPrefix.trim()
  if (prefix) instructions.push(prefix)
  const channelInstructions = buildRemoteChannelAgentInstructions(options.channel)
  if (channelInstructions) instructions.push(channelInstructions)
  if (instructions.length === 0) return prompt
  return `${REMOTE_CHANNEL_MANAGED_INSTRUCTIONS_HEADING}\n\n${instructions.join('\n\n')}\n\n---\n${REMOTE_CHANNEL_CURRENT_USER_REQUEST_HEADING}\n${prompt}`
}

export function buildScheduleRuntimePrompt(
  settings: Pick<AppSettingsV1, 'schedule'>,
  prompt: string
): string {
  const schedule = settings.schedule
  const instructions: string[] = []
  if (schedule.skills.defaultNames.length > 0) {
    instructions.push(`Schedule skill policy: prefer these configured skills when relevant: ${schedule.skills.defaultNames.join(', ')}.`)
  }
  if (schedule.skills.extraDirs.length > 0) {
    instructions.push(`Additional local skill directories configured in the GUI: ${schedule.skills.extraDirs.join(', ')}.`)
  }
  const prefix = schedule.promptPrefix.trim()
  if (prefix) instructions.push(prefix)
  if (instructions.length === 0) return prompt
  return `${SCHEDULE_MANAGED_INSTRUCTIONS_HEADING}\n\n${instructions.join('\n\n')}\n\n---\n${SCHEDULE_CURRENT_USER_REQUEST_HEADING}\n${prompt}`
}

export const CODE_MANAGED_INSTRUCTIONS_HEADING = '[Code managed instructions]'
export const CODE_CURRENT_USER_REQUEST_HEADING = '[Current user request]'

export function buildCodeRuntimePrompt(
  settings: Pick<AppSettingsV1, 'codePromptPrefix'>,
  prompt: string
): string {
  const prefix = (settings.codePromptPrefix ?? '').trim()
  if (!prefix) return prompt
  return `${CODE_MANAGED_INSTRUCTIONS_HEADING}\n\n${prefix}\n\n---\n${CODE_CURRENT_USER_REQUEST_HEADING}\n${prompt}`
}

export function unwrapRemoteChannelRuntimePromptForDisplay(text: string): string {
  const markerIndex = text.lastIndexOf(REMOTE_CHANNEL_CURRENT_USER_REQUEST_HEADING)
  if (markerIndex < 0) return text
  const prefix = text.slice(0, markerIndex)
  const looksManaged =
    prefix.includes(REMOTE_CHANNEL_MANAGED_INSTRUCTIONS_HEADING) ||
    prefix.includes(REMOTE_CHANNEL_AGENT_INSTRUCTIONS_HEADING) ||
    prefix.includes(REMOTE_CHANNEL_SKILL_POLICY_PREFIX) ||
    prefix.includes('Additional local skill directories configured in the GUI:')
  if (!looksManaged) return text
  return text.slice(markerIndex + REMOTE_CHANNEL_CURRENT_USER_REQUEST_HEADING.length).trimStart()
}

export function unwrapRemoteChannelUserPromptForDisplay(text: string): string {
  return parseRemoteChannelUserPromptForDisplay(text).text
}

export function parseRemoteChannelUserPromptForDisplay(text: string): RemoteChannelUserPromptDisplay {
  const unwrapped = unwrapRemoteChannelRuntimePromptForDisplay(text)
  const managed = unwrapped !== text
  const inboundSource = remoteChannelInboundSourceForPrompt(unwrapped)
  if (!inboundSource) {
    return unwrapped
      ? { text: unwrapped, managed, inbound: false }
      : { text, managed: false, inbound: false }
  }
  const splitIndex = unwrapped.indexOf('\n\n')
  if (splitIndex < 0) {
    return {
      text: unwrapped,
      managed,
      inbound: false
    }
  }
  const metadata = parseRemoteChannelInboundMetadata(unwrapped.slice(0, splitIndex))
  const message = unwrapped.slice(splitIndex + 2).trim()
  return {
    text: message || unwrapped,
    managed,
    inbound: true,
    sourceLabel: inboundSource.sourceLabel,
    ...metadata
  }
}

function remoteChannelInboundSourceForPrompt(text: string): { provider: RemoteChannelProvider; sourceLabel: string } | null {
  for (const provider of Object.keys(REMOTE_CHANNEL_INBOUND_MESSAGE_HEADINGS) as RemoteChannelProvider[]) {
    if (text.startsWith(REMOTE_CHANNEL_INBOUND_MESSAGE_HEADINGS[provider])) {
      return { provider, sourceLabel: remoteChannelProviderDisplayLabel(provider) }
    }
  }
  return null
}

function parseRemoteChannelInboundMetadata(header: string): Partial<RemoteChannelUserPromptDisplay> {
  const out: Partial<RemoteChannelUserPromptDisplay> = {}
  for (const line of header.split('\n').slice(1)) {
    const index = line.indexOf(':')
    if (index < 0) continue
    const key = line.slice(0, index).trim().toLowerCase()
    const value = line.slice(index + 1).trim()
    if (!value) continue
    if (key === 'sender') out.sender = value
    if (key === 'chat type') out.chatType = value
    if (key === 'message type') out.messageType = value
    if (key === 'mentions') out.mentions = value
  }
  return out
}

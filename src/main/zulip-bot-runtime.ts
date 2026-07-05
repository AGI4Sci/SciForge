import { chmod, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from './atomic-write-file'
import type {
  AppSettingsV1,
  RemoteChannelAgentProfileV1,
  RemoteChannelModel,
  RemoteChannelV1,
  RemoteChannelZulipPlatformCredentialV1
} from '../shared/app-settings'
import { buildRemoteChannelInboundMessagePrompt } from '../shared/app-settings'
import type {
  ZulipBindChannelResult,
  ZulipBotChannelStatus,
  ZulipBotInfo,
  ZulipBotStatus,
  ZulipConfigureResult,
  ZulipGuardConflictStatus,
  ZulipGuardResult,
  ZulipStream,
  ZulipStreamListResult,
  ZulipTestSendResult,
  ZulipTopic,
  ZulipTopicListResult
} from '../shared/sciforge-api'
import type { JsonSettingsStore } from './settings-store'
import type {
  RemoteChannelIncomingImMessageInput,
  RemoteChannelIncomingImMessageResult
} from './remote-channel-runtime'
import { redactSecrets } from '../shared/secret-redaction'

const INTERNAL_REMOTE_CHANNEL_WORKSPACE_ROOT = '/.sciforge/remote-channel'
const ZULIP_EVENT_POLL_TIMEOUT_SECONDS = 60
const ZULIP_MESSAGE_FAILURE_REPLY = 'Sorry, I could not process that Zulip message.'

type ZulipFetch = (input: string, init?: RequestInit) => Promise<Response>

type ZulipSecretFile = {
  realmUrl: string
  botEmail: string
  apiKey?: string
  bot?: ZulipBotInfo
  updatedAt: string
}

type ZulipTokenSecretFile = ZulipSecretFile & {
  apiKey: string
  bot: ZulipBotInfo
}

type ZulipUserResponse = {
  user_id?: number | string
  email?: string
  full_name?: string
  is_bot?: boolean
}

type ZulipSubscriptionsResponse = {
  subscriptions?: Array<{
    stream_id?: number | string
    name?: string
  }>
}

type ZulipTopicsResponse = {
  topics?: Array<{
    name?: string
    max_id?: number
  }>
}

type ZulipSendMessageResponse = {
  id?: number | string
}

type ZulipRegisterResponse = {
  queue_id?: string
  last_event_id?: number
}

type ZulipEventResponse = {
  events?: ZulipEvent[]
}

type ZulipEvent = {
  id?: number
  type?: string
  message?: ZulipMessage
  op?: string
  code?: string
}

type ZulipMessage = {
  id?: number | string
  type?: string
  stream_id?: number | string
  display_recipient?: string | Array<{ id?: number | string; email?: string; full_name?: string }>
  subject?: string
  topic?: string
  content?: string
  raw_content?: string
  sender_id?: number | string
  sender_email?: string
  sender_full_name?: string
  is_me_message?: boolean
}

type ZulipRuntimeDeps = {
  store: JsonSettingsStore
  userDataPath: string
  handleIncomingMessage: (
    input: RemoteChannelIncomingImMessageInput
  ) => Promise<RemoteChannelIncomingImMessageResult>
  onSettingsChanged?: (settings: AppSettingsV1) => void
  logError: (category: string, message: string, detail?: unknown) => void
  fetch?: ZulipFetch
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeRealmUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('Enter your Zulip server URL, for example https://chat.sciforge.cn.')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Enter a valid Zulip server URL, for example https://chat.sciforge.cn.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Zulip server URL must start with https:// or http://.')
  }
  if (!url.hostname) throw new Error('Enter a valid Zulip server URL.')
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.href.replace(/\/+$/, '')
}

function normalizeBotEmail(raw: string): string {
  const email = raw.trim()
  if (!email || !email.includes('@')) throw new Error('Enter the Zulip bot email address.')
  return email
}

function normalizeApiKey(raw: string): string {
  const apiKey = raw.trim()
  if (!apiKey) throw new Error('Enter the Zulip bot API key.')
  return apiKey
}

function normalizeWorkspaceRoot(raw: string | null | undefined): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function isInternalRemoteChannelWorkspaceRoot(workspaceRoot: string): boolean {
  const normalized = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return (
    normalized === '~/.sciforge/remote-channel'
    || normalized.startsWith('~/.sciforge/remote-channel/')
    || normalized.endsWith(INTERNAL_REMOTE_CHANNEL_WORKSPACE_ROOT)
    || normalized.includes(`${INTERNAL_REMOTE_CHANNEL_WORKSPACE_ROOT}/`)
  )
}

function resolveZulipChannelWorkspaceRoot(
  requestedWorkspaceRoot: string | null | undefined,
  existingWorkspaceRoot: string | null | undefined,
  defaultWorkspaceRoot: string | null | undefined
): string {
  const requested = normalizeWorkspaceRoot(requestedWorkspaceRoot)
  if (requested && !isInternalRemoteChannelWorkspaceRoot(requested)) return requested
  const existing = normalizeWorkspaceRoot(existingWorkspaceRoot)
  if (existing && !isInternalRemoteChannelWorkspaceRoot(existing)) return existing
  const fallback = normalizeWorkspaceRoot(defaultWorkspaceRoot)
  return fallback || requested || existing
}

function streamIdString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' ? value.trim() : ''
}

function topicLabel(topicName: string): string {
  const trimmed = topicName.trim()
  return trimmed ? `#${trimmed}` : 'Zulip'
}

function zulipChannelLabel(streamName: string, topicName: string): string {
  const stream = streamName.trim() || 'Zulip'
  const topic = topicName.trim()
  return topic ? `${stream} · ${topicLabel(topic)}` : stream
}

function zulipChannelConfigId(botEmail: string, streamId: string, topicName: string): string {
  const safeBot = botEmail.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bot'
  const safeStream = streamId.trim().replace(/[^A-Za-z0-9._:-]+/g, '-')
  const safeTopic = topicName.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'all'
  return `zulip-${safeBot}-${safeStream}-${safeTopic}`
}

function defaultZulipAgentProfile(name: string): RemoteChannelV1['agentProfile'] {
  return {
    name: name.trim() || 'zulip bot',
    description: '',
    identity: '',
    personality: '',
    userContext: '',
    replyRules: ''
  }
}

function mergeZulipAgentProfile(
  current: RemoteChannelAgentProfileV1 | undefined,
  patch: Partial<RemoteChannelAgentProfileV1> | undefined,
  fallbackName: string
): RemoteChannelAgentProfileV1 {
  const base = current ?? defaultZulipAgentProfile(fallbackName)
  return {
    name: typeof patch?.name === 'string' ? patch.name.trim() : base.name,
    description: typeof patch?.description === 'string' ? patch.description : base.description,
    identity: typeof patch?.identity === 'string' ? patch.identity : base.identity,
    personality: typeof patch?.personality === 'string' ? patch.personality : base.personality,
    userContext: typeof patch?.userContext === 'string' ? patch.userContext : base.userContext,
    replyRules: typeof patch?.replyRules === 'string' ? patch.replyRules : base.replyRules
  }
}

function isChineseLocale(settings: AppSettingsV1): boolean {
  return settings.locale.toLowerCase().startsWith('zh')
}

function safeZulipFailureReply(
  result: Extract<RemoteChannelIncomingImMessageResult, { ok: false }>
): string {
  const failureKind = (result as { failureKind?: unknown }).failureKind
  if (failureKind === 'local_thread_deleted') return result.message.trim() || ZULIP_MESSAGE_FAILURE_REPLY
  return ZULIP_MESSAGE_FAILURE_REPLY
}

function buildBasicAuth(email: string, apiKey: string): string {
  return `Basic ${Buffer.from(`${email}:${apiKey}`).toString('base64')}`
}

async function readZulipError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '')
  if (!raw) return `${res.status} ${res.statusText}`.trim()
  try {
    const parsed = JSON.parse(raw) as { msg?: string; message?: string; code?: string; result?: string }
    return parsed.msg || parsed.message || raw
  } catch {
    return raw
  }
}

function zulipHttpErrorMessage(status: number, statusText: string, detail: string): string {
  const suffix = detail.trim() ? ` (${detail.trim()})` : ''
  if (status === 401 || status === 403) {
    return 'Zulip rejected this bot email or API key. Copy the API key from the bot profile, not your password.' + suffix
  }
  if (status === 404) {
    return 'Zulip API route was not found on this server. Check the server URL.' + suffix
  }
  if (status === 429) return 'Zulip rate-limited this request. Wait a moment, then try again.' + suffix
  if (status >= 500) return `Zulip server is temporarily unavailable (${status} ${statusText}). Try again later.`
  return `Zulip API request failed (${status} ${statusText}).${suffix}`.trim()
}

function zulipNetworkErrorMessage(error: unknown): string {
  const message = errorMessage(error)
  const lower = message.toLowerCase()
  if (lower.includes('aborted') || lower.includes('timeout')) {
    return 'Timed out connecting to Zulip. Check the server URL and network, then try again.'
  }
  if (lower.includes('fetch failed') || lower.includes('network')) {
    return 'Cannot reach Zulip. Check the server URL and network, then try again.'
  }
  return `Cannot reach Zulip: ${message}`
}

export class ZulipBotRuntime {
  private readonly deps: ZulipRuntimeDeps
  private readonly secretPath: string
  private pollAbort: AbortController | null = null
  private pollKey = ''
  private pollRunning = false
  private connected = false
  private syncVersion = 0

  constructor(deps: ZulipRuntimeDeps) {
    this.deps = deps
    this.secretPath = join(deps.userDataPath, 'zulip-bot.json')
  }

  async configure(input: { realmUrl: string; botEmail: string; apiKey: string }): Promise<ZulipConfigureResult> {
    try {
      const realmUrl = normalizeRealmUrl(input.realmUrl)
      const botEmail = normalizeBotEmail(input.botEmail)
      const apiKey = normalizeApiKey(input.apiKey)
      const bot = await this.fetchBotInfo({ realmUrl, botEmail, apiKey })
      await this.saveSecret({
        realmUrl,
        botEmail: bot.botEmail || botEmail,
        apiKey,
        bot,
        updatedAt: new Date().toISOString()
      })
      const settings = await this.deps.store.load()
      this.sync(settings)
      return { ok: true, status: await this.status(settings) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async status(settingsArg?: AppSettingsV1): Promise<ZulipBotStatus> {
    const [settings, secret] = await Promise.all([
      settingsArg ? Promise.resolve(settingsArg) : this.deps.store.load(),
      this.loadSecret()
    ])
    const channels = this.resolveZulipChannels(settings)
    const channelStatuses = channels.map((channel) => this.zulipChannelStatus(settings, channel))
    const primaryStatus =
      channelStatuses.find((channel) => channel.enabled && !channel.conflict) ??
      channelStatuses[0]
    const tokenConfigured = Boolean(secret?.apiKey && secret.bot)
    const conflict = channelStatuses.find((channel) => channel.conflict)?.conflict
    return {
      installationId: settings.installationId ?? '',
      realmUrl: secret?.realmUrl ?? '',
      botEmail: secret?.botEmail ?? '',
      tokenConfigured,
      configured: tokenConfigured,
      connected: this.connected,
      enabled: Boolean(
        settings.remoteChannel.enabled &&
        settings.remoteChannel.im.enabled &&
        channelStatuses.some((channel) => channel.enabled && !channel.conflict && !channel.accessError)
      ),
      ...(secret?.bot ? { bot: secret.bot } : {}),
      channels: channelStatuses,
      ...(conflict ? { conflict } : {}),
      ...(primaryStatus?.streamId ? { streamId: primaryStatus.streamId } : {}),
      ...(primaryStatus?.streamName ? { streamName: primaryStatus.streamName } : {}),
      ...(primaryStatus?.topicName ? { topicName: primaryStatus.topicName } : {})
    }
  }

  async listStreams(): Promise<ZulipStreamListResult> {
    try {
      const secret = await this.requireSecret()
      const raw = await this.zulipFetch<ZulipSubscriptionsResponse>(secret, '/api/v1/users/me/subscriptions')
      const streams = (raw.subscriptions ?? [])
        .map((stream) => ({
          id: streamIdString(stream.stream_id),
          name: stream.name?.trim() ?? ''
        }))
        .filter((stream): stream is ZulipStream => Boolean(stream.id && stream.name))
        .sort((a, b) => a.name.localeCompare(b.name))
      return { ok: true, streams }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async listTopics(streamId: string): Promise<ZulipTopicListResult> {
    try {
      const secret = await this.requireSecret()
      const raw = await this.zulipFetch<ZulipTopicsResponse>(
        secret,
        `/api/v1/users/me/${encodeURIComponent(streamId.trim())}/topics`
      )
      const topics = (raw.topics ?? [])
        .map((topic) => ({
          name: topic.name?.trim() ?? '',
          ...(typeof topic.max_id === 'number' ? { maxId: topic.max_id } : {})
        }))
        .filter((topic): topic is ZulipTopic => Boolean(topic.name))
        .sort((a, b) => a.name.localeCompare(b.name))
      return { ok: true, topics }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async bindChannel(input: {
    channelConfigId?: string
    streamId: string
    streamName?: string
    topicName?: string
    enabled?: boolean
    workspaceRoot?: string
    model?: string
    runtimeId?: AppSettingsV1['activeAgentRuntime']
    agentProfile?: Partial<RemoteChannelAgentProfileV1>
  }): Promise<ZulipBindChannelResult> {
    try {
      const secret = await this.requireSecret()
      const settings = await this.deps.store.load()
      const now = new Date().toISOString()
      const streamId = input.streamId.trim()
      if (!streamId) throw new Error('Choose a Zulip stream first.')
      const streamsResult = await this.listStreams()
      const knownStream = streamsResult.ok ? streamsResult.streams.find((stream) => stream.id === streamId) : undefined
      const streamName = input.streamName?.trim() || knownStream?.name || streamId
      const topicName = input.topicName?.trim() || ''
      const label = zulipChannelLabel(streamName, topicName)
      const channelConfigId = input.channelConfigId?.trim() ||
        zulipChannelConfigId(secret.botEmail, streamId, topicName)
      const existing = this.resolveZulipChannel(settings, channelConfigId) ??
        this.resolveZulipChannelByRemote(settings, { realmUrl: secret.realmUrl, botEmail: secret.botEmail, streamId, topicName })
      const existingCredential = existing?.platformCredential?.kind === 'zulip'
        ? existing.platformCredential
        : undefined
      const installationId = settings.installationId ?? ''
      const ownerPatch = input.enabled === false
        ? {
            guardOwnerInstallationId: existingCredential?.guardOwnerInstallationId ?? '',
            guardOwnerUpdatedAt: existingCredential?.guardOwnerUpdatedAt ?? ''
          }
        : {
            guardOwnerInstallationId: installationId,
            guardOwnerUpdatedAt: now
          }
      const credential: RemoteChannelZulipPlatformCredentialV1 = {
        kind: 'zulip',
        realmUrl: secret.realmUrl,
        botEmail: secret.botEmail,
        botUserId: secret.bot.botUserId,
        botFullName: secret.bot.botFullName,
        streamId,
        streamName,
        topicName,
        installationId,
        ...ownerPatch,
        createdAt: existingCredential?.createdAt || now
      }
      const agentProfile = mergeZulipAgentProfile(
        existing?.agentProfile,
        input.agentProfile,
        existing?.agentProfile.name || 'zulip bot'
      )
      const workspaceRoot = resolveZulipChannelWorkspaceRoot(
        input.workspaceRoot,
        existing?.workspaceRoot,
        settings.workspaceRoot
      )
      const channel: RemoteChannelV1 = existing
        ? {
            ...existing,
            id: existing.id || channelConfigId,
            provider: 'zulip',
            label,
            enabled: input.enabled ?? true,
            guardMode: 'all_messages',
            model: (input.model?.trim() || existing.model || settings.remoteChannel.im.model || 'auto') as RemoteChannelModel,
            runtimeId: input.runtimeId ?? existing.runtimeId ?? settings.activeAgentRuntime,
            workspaceRoot,
            agentProfile: {
              ...agentProfile,
              name: agentProfile.name.trim() || existing.agentProfile.name || label
            },
            platformCredential: credential,
            updatedAt: now
          }
        : {
            id: channelConfigId,
            provider: 'zulip',
            label,
            enabled: input.enabled ?? true,
            guardMode: 'all_messages',
            model: (input.model?.trim() || settings.remoteChannel.im.model || 'auto') as RemoteChannelModel,
            runtimeId: input.runtimeId ?? settings.activeAgentRuntime,
            agentThreadIds: {},
            workspaceRoot,
            agentProfile: {
              ...agentProfile,
              name: agentProfile.name.trim() || label
            },
            platformCredential: credential,
            conversations: [],
            recentMessages: [],
            createdAt: now,
            updatedAt: now
          }
      const saved = await this.deps.store.patch({
        remoteChannel: {
          enabled: true,
          im: {
            enabled: true,
            provider: 'zulip'
          },
          channels: [
            ...settings.remoteChannel.channels.filter((item) => item.id !== (existing?.id || channel.id)),
            channel
          ]
        }
      })
      this.deps.onSettingsChanged?.(saved)
      this.sync(saved)
      return { ok: true, status: await this.status(saved), channelConfigId: channel.id }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async testSend(
    channelId: string,
    text?: string,
    options: { channelConfigId?: string; topicName?: string } = {}
  ): Promise<ZulipTestSendResult> {
    try {
      const result = await this.sendChannelMessage({
        channelId,
        topicName: options.topicName,
        channelConfigId: options.channelConfigId,
        text: text?.trim() || 'SciForge Zulip bot is connected.'
      })
      return result
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async setGuard(
    enabled: boolean,
    options: { channelConfigId?: string; forceTakeover?: boolean } = {}
  ): Promise<ZulipGuardResult> {
    try {
      const settings = await this.deps.store.load()
      const channel = this.resolveZulipChannel(settings, options.channelConfigId)
      if (!channel) return { ok: false, message: 'Bind a Zulip stream first.' }
      if (enabled) await this.requireSecret()
      const conflict = enabled ? this.zulipChannelConflict(settings, channel) : undefined
      if (conflict && !options.forceTakeover) {
        return {
          ok: false,
          message: conflict.message,
          status: await this.status(settings),
          conflict
        }
      }
      const now = new Date().toISOString()
      const installationId = settings.installationId ?? ''
      const saved = await this.deps.store.patch({
        remoteChannel: {
          enabled: enabled ? true : settings.remoteChannel.enabled,
          im: {
            enabled: enabled ? true : settings.remoteChannel.im.enabled,
            provider: 'zulip'
          },
          channels: settings.remoteChannel.channels.map((item) =>
            item.id === channel.id
              ? {
                  ...item,
                  enabled,
                  guardMode: enabled ? 'all_messages' : item.guardMode,
                  platformCredential: item.platformCredential?.kind === 'zulip'
                    ? {
                        ...item.platformCredential,
                        installationId: item.platformCredential.installationId || installationId,
                        ...(enabled
                          ? {
                              guardOwnerInstallationId: installationId,
                              guardOwnerUpdatedAt: now
                            }
                          : {})
                      }
                    : item.platformCredential,
                  updatedAt: now
                }
              : item
          )
        }
      })
      this.deps.onSettingsChanged?.(saved)
      this.sync(saved)
      return { ok: true, status: await this.status(saved) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async sendChannelMessage(options: {
    channelId: string
    text: string
    topicName?: string
    channelConfigId?: string
  }): Promise<ZulipTestSendResult> {
    const secret = await this.requireSecret()
    const settings = await this.deps.store.load()
    const channel = options.channelConfigId
      ? this.resolveZulipChannel(settings, options.channelConfigId)
      : this.resolveZulipChannelByStream(settings, options.channelId)
    const credential = channel?.platformCredential?.kind === 'zulip'
      ? channel.platformCredential
      : undefined
    const streamId = options.channelId.trim() || credential?.streamId.trim() || ''
    if (!streamId) throw new Error('No target Zulip stream is available.')
    const topicName = options.topicName?.trim() || credential?.topicName.trim() || 'sciforge'
    const sent = await this.zulipFetch<ZulipSendMessageResponse>(secret, '/api/v1/messages', {
      method: 'POST',
      body: new URLSearchParams({
        type: 'stream',
        to: streamId,
        topic: topicName,
        content: options.text.trim() || 'Completed.'
      })
    })
    return { ok: true, messageId: streamIdString(sent.id) }
  }

  sync(settings: AppSettingsV1): void {
    const channels = this.resolveRunnableZulipChannels(settings)
    if (!settings.remoteChannel.enabled || !settings.remoteChannel.im.enabled || channels.length === 0) {
      this.disconnect()
      return
    }
    const version = ++this.syncVersion
    void this.syncPollingForChannels(channels, version).catch((error) => {
      this.deps.logError('remote-channel-zulip', 'Failed to sync Zulip bot runtime.', {
        message: errorMessage(error),
        channelIds: channels.map((channel) => channel.id)
      })
      this.connected = false
    })
  }

  stop(): void {
    this.disconnect()
  }

  private async syncPollingForChannels(channels: RemoteChannelV1[], version: number): Promise<void> {
    const secret = await this.loadSecret()
    if (!secret?.apiKey || !secret.bot) {
      this.disconnect()
      return
    }
    const tokenSecret: ZulipTokenSecretFile = {
      ...secret,
      apiKey: secret.apiKey,
      bot: secret.bot
    }
    const channelKey = channels
      .map((channel) => {
        const credential = channel.platformCredential?.kind === 'zulip'
          ? channel.platformCredential
          : undefined
        return `${channel.id}|${credential?.streamId ?? ''}|${credential?.topicName ?? ''}`
      })
      .sort()
      .join(';')
    const key = `${tokenSecret.realmUrl}|${tokenSecret.botEmail}|${channelKey}`
    if (this.pollRunning && this.pollKey === key) return
    this.disconnect()
    if (version !== this.syncVersion) return
    this.pollKey = key
    this.pollAbort = new AbortController()
    this.pollRunning = true
    this.connected = false
    void this.pollEvents(tokenSecret, this.pollAbort.signal).finally(() => {
      if (this.pollKey === key) {
        this.pollRunning = false
        this.connected = false
      }
    })
  }

  private disconnect(): void {
    if (this.pollAbort) {
      this.pollAbort.abort()
      this.pollAbort = null
    }
    this.pollKey = ''
    this.pollRunning = false
    this.connected = false
  }

  private async pollEvents(secret: ZulipTokenSecretFile, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let queueId = ''
      let lastEventId = -1
      try {
        const registered = await this.zulipFetch<ZulipRegisterResponse>(secret, '/api/v1/register', {
          method: 'POST',
          body: new URLSearchParams({
            event_types: JSON.stringify(['message']),
            apply_markdown: 'false',
            client_gravatar: 'false',
            all_public_streams: 'false'
          }),
          signal
        })
        queueId = registered.queue_id?.trim() ?? ''
        lastEventId = typeof registered.last_event_id === 'number' ? registered.last_event_id : -1
        if (!queueId) throw new Error('Zulip did not return an event queue id.')
        this.connected = true
        while (!signal.aborted) {
          const events = await this.zulipFetch<ZulipEventResponse>(
            secret,
            `/api/v1/events?${new URLSearchParams({
              queue_id: queueId,
              last_event_id: String(lastEventId),
              dont_block: 'false',
              timeout: String(ZULIP_EVENT_POLL_TIMEOUT_SECONDS)
            })}`,
            { signal: AbortSignal.any([signal, AbortSignal.timeout((ZULIP_EVENT_POLL_TIMEOUT_SECONDS + 15) * 1000)]) }
          )
          for (const event of events.events ?? []) {
            if (typeof event.id === 'number') lastEventId = Math.max(lastEventId, event.id)
            if (event.type === 'message' && event.message) {
              this.enqueueZulipMessage(event.message)
            }
          }
        }
      } catch (error) {
        if (signal.aborted) return
        this.connected = false
        this.deps.logError('remote-channel-zulip', 'Zulip event poll failed; retrying.', {
          message: errorMessage(error),
          queueId
        })
        await new Promise((resolve) => setTimeout(resolve, 2_500))
      } finally {
        if (queueId) {
          await this.deleteQueue(secret, queueId).catch(() => undefined)
        }
      }
    }
  }

  private enqueueZulipMessage(message: ZulipMessage): void {
    void this.handleZulipMessage(message).catch((error) => {
      this.deps.logError('remote-channel-zulip', 'Failed to handle Zulip message.', {
        message: errorMessage(error),
        messageId: message.id,
        streamId: message.stream_id
      })
    })
  }

  private async handleZulipMessage(message: ZulipMessage): Promise<void> {
    const settings = await this.deps.store.load()
    const channel = this.resolveZulipChannelForMessage(settings, message)
    const credential = channel?.platformCredential?.kind === 'zulip'
      ? channel.platformCredential
      : undefined
    if (!channel?.enabled || !credential) return
    const messageId = streamIdString(message.id)
    const streamId = streamIdString(message.stream_id)
    if (!messageId || streamId !== credential.streamId) return
    const senderEmail = message.sender_email?.trim() ?? ''
    const senderId = streamIdString(message.sender_id) || senderEmail || messageId
    if (message.is_me_message || senderEmail.toLowerCase() === credential.botEmail.toLowerCase()) return
    const text = (message.raw_content ?? message.content ?? '').trim()
    if (!text) return
    const topicName = (message.topic ?? message.subject ?? credential.topicName).trim()
    const sender = message.sender_full_name?.trim() || senderEmail || senderId
    const mentionedBot = text.toLowerCase().includes(credential.botEmail.toLowerCase()) ||
      (credential.botFullName ? text.toLowerCase().includes(credential.botFullName.toLowerCase()) : false)
    const runtimePrompt = buildRemoteChannelInboundMessagePrompt({
      provider: 'zulip',
      metadata: [
        ['Realm', credential.realmUrl],
        ['Stream', credential.streamName || credential.streamId],
        ['Topic', topicName],
        ['Sender', sender]
      ],
      text
    })

    let result: RemoteChannelIncomingImMessageResult
    try {
      result = await this.deps.handleIncomingMessage({
        provider: 'zulip',
        channelId: channel.id,
        text,
        runtimePrompt,
        sender,
        chatType: 'group',
        mentionedBot,
        mentionAll: /@(?:\*\*all\*\*|all\b|everyone\b)/i.test(text),
        remoteSession: {
          chatId: credential.streamId,
          messageId,
          threadId: topicName,
          senderId,
          senderName: sender
        }
      })
    } catch (error) {
      this.deps.logError('remote-channel-zulip', 'Failed to process Zulip message through remote-channel runtime.', redactSecrets({
        message: errorMessage(error),
        messageId,
        streamId: credential.streamId,
        topicName,
        channelConfigId: channel.id,
        senderId
      }))
      await this.sendChannelMessage({
        channelId: credential.streamId,
        topicName,
        text: ZULIP_MESSAGE_FAILURE_REPLY,
        channelConfigId: channel.id
      })
      return
    }
    if (result.ok && 'ignored' in result && result.ignored) return
    if (!result.ok) {
      this.deps.logError('remote-channel-zulip', 'Remote-channel runtime returned a failure for Zulip message.', redactSecrets({
        message: result.message,
        result,
        messageId,
        streamId: credential.streamId,
        topicName,
        channelConfigId: channel.id,
        senderId
      }))
    }
    const reply = result.ok
      ? (result.reply ?? result.message ?? '').trim() || 'Completed.'
      : safeZulipFailureReply(result)
    await this.sendChannelMessage({
      channelId: credential.streamId,
      topicName,
      text: reply,
      channelConfigId: channel.id
    })
  }

  private resolveZulipChannels(settings: AppSettingsV1): RemoteChannelV1[] {
    return settings.remoteChannel.channels.filter((channel) =>
      channel.provider === 'zulip' && channel.platformCredential?.kind === 'zulip'
    )
  }

  private resolveRunnableZulipChannels(settings: AppSettingsV1): RemoteChannelV1[] {
    return this.resolveZulipChannels(settings).filter((channel) =>
      channel.enabled && !this.zulipChannelConflict(settings, channel)
    )
  }

  private resolveZulipChannel(
    settings: AppSettingsV1,
    channelConfigId?: string
  ): RemoteChannelV1 | undefined {
    const channels = this.resolveZulipChannels(settings)
    const id = channelConfigId?.trim()
    if (id) return channels.find((channel) => channel.id === id)
    return channels.find((channel) => channel.enabled) ?? channels[0]
  }

  private resolveZulipChannelByRemote(
    settings: AppSettingsV1,
    target: { realmUrl: string; botEmail: string; streamId: string; topicName: string }
  ): RemoteChannelV1 | undefined {
    return this.resolveZulipChannels(settings).find((channel) => {
      const credential = channel.platformCredential?.kind === 'zulip'
        ? channel.platformCredential
        : undefined
      return (
        credential?.realmUrl === target.realmUrl.trim().replace(/\/+$/, '') &&
        credential.botEmail.toLowerCase() === target.botEmail.trim().toLowerCase() &&
        credential.streamId === target.streamId.trim() &&
        credential.topicName === target.topicName.trim()
      )
    })
  }

  private resolveZulipChannelByStream(settings: AppSettingsV1, streamId: string): RemoteChannelV1 | undefined {
    const targetStreamId = streamId.trim()
    return this.resolveZulipChannels(settings).find((channel) => {
      const credential = channel.platformCredential?.kind === 'zulip'
        ? channel.platformCredential
        : undefined
      return credential?.streamId === targetStreamId
    })
  }

  private resolveZulipChannelForMessage(settings: AppSettingsV1, message: ZulipMessage): RemoteChannelV1 | undefined {
    const streamId = streamIdString(message.stream_id)
    const topicName = (message.topic ?? message.subject ?? '').trim()
    if (!streamId) return undefined
    return this.resolveRunnableZulipChannels(settings).find((channel) => {
      const credential = channel.platformCredential?.kind === 'zulip'
        ? channel.platformCredential
        : undefined
      if (credential?.streamId !== streamId) return false
      return !credential.topicName || credential.topicName === topicName
    })
  }

  private zulipChannelStatus(
    settings: AppSettingsV1,
    channel: RemoteChannelV1
  ): ZulipBotChannelStatus {
    const credential = channel.platformCredential?.kind === 'zulip'
      ? channel.platformCredential
      : undefined
    const conflict = this.zulipChannelConflict(settings, channel)
    const accessError = credential ? '' : (
      isChineseLocale(settings)
        ? 'Zulip 频道绑定缺少凭据。请重新绑定。'
        : 'This Zulip binding is missing its credential. Rebind the stream.'
    )
    return {
      channelConfigId: channel.id,
      streamId: credential?.streamId ?? '',
      streamName: credential?.streamName ?? '',
      topicName: credential?.topicName ?? '',
      label: channel.label,
      enabled: channel.enabled,
      connected: Boolean(channel.enabled && !conflict && !accessError && this.connected),
      ...(conflict ? { conflict } : {}),
      ...(accessError ? { accessError } : {}),
      ...(credential?.guardOwnerInstallationId ? { guardOwnerInstallationId: credential.guardOwnerInstallationId } : {}),
      ...(credential?.guardOwnerUpdatedAt ? { guardOwnerUpdatedAt: credential.guardOwnerUpdatedAt } : {}),
      workspaceRoot: channel.workspaceRoot,
      model: channel.model,
      runtimeId: channel.runtimeId,
      agentName: channel.agentProfile.name.trim() || channel.label
    }
  }

  private zulipChannelConflict(
    settings: AppSettingsV1,
    channel: RemoteChannelV1
  ): ZulipGuardConflictStatus | undefined {
    if (!channel.enabled) return undefined
    const credential = channel.platformCredential?.kind === 'zulip'
      ? channel.platformCredential
      : undefined
    if (!credential) return undefined
    const ownerInstallationId = (
      credential.guardOwnerInstallationId ||
      credential.installationId ||
      ''
    ).trim()
    const currentInstallationId = (settings.installationId ?? '').trim()
    if (!ownerInstallationId || !currentInstallationId || ownerInstallationId === currentInstallationId) {
      return undefined
    }
    return {
      channelConfigId: channel.id,
      streamId: credential.streamId,
      streamName: credential.streamName,
      topicName: credential.topicName,
      ownerInstallationId,
      currentInstallationId,
      takeoverAvailable: true,
      message: 'This Zulip stream/topic is being guarded by another SciForge installation.'
    }
  }

  private async fetchBotInfo(secret: Pick<ZulipTokenSecretFile, 'realmUrl' | 'botEmail' | 'apiKey'>): Promise<ZulipBotInfo> {
    const user = await this.zulipFetch<ZulipUserResponse>(secret, '/api/v1/users/me')
    const botUserId = streamIdString(user.user_id)
    const botEmail = user.email?.trim() || secret.botEmail
    if (!botUserId || !botEmail) throw new Error('Zulip API key did not return a valid bot identity.')
    return {
      realmUrl: secret.realmUrl,
      botEmail,
      botUserId,
      botFullName: user.full_name?.trim() || botEmail
    }
  }

  private async zulipFetch<T>(
    secret: Pick<ZulipTokenSecretFile, 'realmUrl' | 'botEmail' | 'apiKey'>,
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', buildBasicAuth(secret.botEmail, secret.apiKey))
    headers.set('Accept', 'application/json')
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/x-www-form-urlencoded')
    }
    let res: Response
    try {
      const url = `${secret.realmUrl}${path}`
      res = await (this.deps.fetch ?? fetch)(url, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(20_000)
      })
    } catch (error) {
      throw new Error(zulipNetworkErrorMessage(error))
    }
    if (!res.ok) {
      throw new Error(zulipHttpErrorMessage(res.status, res.statusText, await readZulipError(res)))
    }
    if (res.status === 204) return undefined as T
    return await res.json() as T
  }

  private async deleteQueue(secret: ZulipTokenSecretFile, queueId: string): Promise<void> {
    await this.zulipFetch<void>(
      secret,
      `/api/v1/events?${new URLSearchParams({ queue_id: queueId })}`,
      { method: 'DELETE', signal: AbortSignal.timeout(5_000) }
    )
  }

  private async requireSecret(): Promise<ZulipTokenSecretFile> {
    const secret = await this.loadSecret()
    if (!secret?.apiKey || !secret.bot) {
      throw new Error('Configure a Zulip bot API key first.')
    }
    return secret as ZulipTokenSecretFile
  }

  private async loadSecret(): Promise<ZulipSecretFile | null> {
    try {
      const raw = await readFile(this.secretPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<ZulipSecretFile>
      const realmUrl = typeof parsed.realmUrl === 'string' ? parsed.realmUrl.trim().replace(/\/+$/, '') : ''
      const botEmail = typeof parsed.botEmail === 'string' ? parsed.botEmail.trim() : ''
      const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : ''
      const bot = parsed.bot && typeof parsed.bot === 'object'
        ? {
            realmUrl: typeof parsed.bot.realmUrl === 'string' ? parsed.bot.realmUrl.trim().replace(/\/+$/, '') : realmUrl,
            botEmail: typeof parsed.bot.botEmail === 'string' ? parsed.bot.botEmail.trim() : botEmail,
            botUserId: typeof parsed.bot.botUserId === 'string' ? parsed.bot.botUserId.trim() : '',
            botFullName: typeof parsed.bot.botFullName === 'string' ? parsed.bot.botFullName.trim() : ''
          }
        : undefined
      if (!realmUrl && !botEmail && !apiKey && !bot?.botUserId) return null
      return {
        realmUrl,
        botEmail,
        ...(apiKey ? { apiKey } : {}),
        ...(bot?.botUserId && bot.botEmail ? { bot } : {}),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      this.deps.logError('remote-channel-zulip', 'Failed to read Zulip bot secret file.', {
        message: errorMessage(error),
        path: this.secretPath
      })
      return null
    }
  }

  private async saveSecret(secret: ZulipSecretFile): Promise<void> {
    await mkdir(dirname(this.secretPath), { recursive: true })
    await atomicWriteFile(this.secretPath, JSON.stringify(secret, null, 2))
    await chmod(this.secretPath, 0o600).catch(() => undefined)
  }
}

export function createZulipBotRuntime(deps: ZulipRuntimeDeps): ZulipBotRuntime {
  return new ZulipBotRuntime(deps)
}

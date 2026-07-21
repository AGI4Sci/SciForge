import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { URL } from 'node:url'
import {
  createLarkChannel,
  Domain,
  LoggerLevel,
  type LarkChannel,
  type NormalizedMessage,
  type SendInput,
  type SendOptions,
  type SendResult
} from '@larksuiteoapi/node-sdk'
import type {
  AgentRuntimeId,
  AppSettingsV1,
  RemoteChannelGeneratedFileV1,
  RemoteChannelFeishuPlatformCredentialV1,
  RemoteChannelV1,
  RemoteChannelConversationV1,
  RemoteChannelLastFailureV1,
  RemoteChannelRecentMessageV1,
  RemoteChannelProvider,
  RemoteChannelRemoteSessionV1,
  RemoteChannelRunResult,
  RemoteChannelRunMode,
  RemoteChannelRuntimeStatus
} from '../shared/app-settings'
import {
  DEFAULT_REMOTE_CHANNEL_MODEL,
  buildRemoteChannelRuntimePrompt,
  normalizeAgentRuntimeId,
  parseRemoteChannelUserPromptForDisplay,
  resolveRuntimeModelRouterSettings
} from '../shared/app-settings'
import { APP_WEBHOOK_SECRET_HEADER } from '../shared/app-brand'
import type { AgentRuntimeThread } from '../shared/agent-runtime-contract'
import { parseRemoteChannelCommand } from '../shared/remote-channel-commands'
import { redactSecrets, redactSecretText } from '../shared/secret-redaction'
import {
  asString,
  buildFeishuPrompt,
  buildRemoteChannelAttachmentFallbackText,
  remoteChannelFailureError,
  remoteChannelFailureFromError,
  remoteChannelFailureResult,
  remoteChannelAttachmentFromGeneratedFile,
  remoteChannelConversationKey,
  extractIncomingChannelId,
  extractIncomingChatType,
  extractIncomingMentionFlags,
  extractIncomingProvider,
  extractIncomingPrompt,
  extractIncomingRemoteSession,
  extractSenderLabel,
  feishuSenderLabel,
  formatFeishuMirrorText,
  getRemoteChannelProviderCapabilities,
  hasPendingDesktopApproval,
  isRunningStatus,
  latestThreadSummaryText,
  latestGeneratedFiles,
  latestAssistantText,
  nestedRecord,
  normalizeTaskModel,
  parseJsonObject,
  prepareRemoteChannelReplyText,
  providerSendFailureMessage,
  readRequestBody,
  remoteConversationQueueKey,
  remoteMessageDedupeKey,
  replyTextForGeneratedFiles,
  runRemoteChannelProviderRetry,
  sanitizeOutboundAttachmentFileName,
  sanitizePathSegment,
  shouldDirectSendExistingGeneratedFilesForPrompt,
  splitRemoteChannelReplyText,
  sleep,
  webhookUrl,
  writeJson,
  type RemoteChannelRuntimeDeps,
  type IncomingImChatType,
  type RunPromptOptions,
  type ThreadDetailJson
} from './remote-channel-runtime-helpers'

const MAX_RECENT_REMOTE_MESSAGE_IDS = 2_000
const MAX_RECENT_REMOTE_MESSAGE_TEXT_LENGTH = 500
const RECENT_REMOTE_MESSAGE_TTL_MS = 24 * 60 * 60_000
const ATTACH_CURRENT_ACTIVE_TTL_MS = 10 * 60_000
const AGENT_RUNTIME_INTERRUPT_TIMEOUT_MS = 5_000
const UNSUPPORTED_AGENT_RUNTIME_HOST_MESSAGE =
  'unsupported_runtime_request: AgentRuntimeHost is required for remote channel runtime requests.'

type FeishuRemoteChannel = RemoteChannelV1 & {
  platformCredential: RemoteChannelFeishuPlatformCredentialV1
}

function isCompletedStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'success'
}

function isFailedStatus(status: string | undefined): boolean {
  return status === 'failed' || status === 'aborted' || status === 'error' || status === 'cancelled'
}

export type RemoteChannelIncomingImMessageInput = {
  provider: RemoteChannelProvider
  channelId?: string
  text: string
  sender: string
  runtimePrompt?: string
  chatType?: IncomingImChatType
  mentionedBot?: boolean
  mentionAll?: boolean
  remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
}

export type RemoteChannelIncomingImMessageResult =
  | (Extract<RemoteChannelRunResult, { ok: true }> & { reply?: string; createdTaskId?: string })
  | { ok: true; reply: string; message?: string; createdTaskId?: string }
  | { ok: true; ignored: true; message: string; reply?: string }
  | { ok: false; message: string }

function imRemoteQueuedNoticeText(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? 'queued/running：前一条消息还在处理中，这条消息已排队并按顺序执行。'
    : 'queued/running: a previous message in this remote conversation was still running, so this message waited its turn.'
}

function withRemoteQueuedNotice(
  settings: AppSettingsV1,
  result: RemoteChannelIncomingImMessageResult
): RemoteChannelIncomingImMessageResult {
  if (!result.ok || ('ignored' in result && result.ignored)) return result
  const notice = imRemoteQueuedNoticeText(settings)
  const reply = 'reply' in result ? result.reply?.trim() ?? '' : ''
  const message = 'message' in result ? result.message?.trim() ?? '' : ''
  return {
    ...result,
    message: message ? `${notice}\n\n${message}` : notice,
    reply: reply ? `${notice}\n\n${reply}` : notice
  }
}

function hasFeishuPlatformCredential(channel: RemoteChannelV1): channel is FeishuRemoteChannel {
  return channel.platformCredential?.kind === 'feishu' &&
    !!channel.platformCredential.appId.trim() &&
    !!channel.platformCredential.appSecret.trim()
}

function isMissingThreadError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return message.includes('thread') && message.includes('not found')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type RemoteFailureLike = {
  ok: false
  message: string
  failureKind?: string
  failureTitle?: string
  details?: unknown
}

function remoteFailureTitle(failure: RemoteFailureLike): string {
  return failure.failureTitle?.trim() || ''
}

function clippedRemoteFailureText(value: string | undefined, maxLength: number): string {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function remoteFailureRecord(input: {
  provider: RemoteChannelProvider
  channelId?: string
  remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'threadId'>
  threadId?: string
  runtimeId?: AgentRuntimeId
  failure: RemoteFailureLike
}): RemoteChannelLastFailureV1 {
  const title = clippedRemoteFailureText(remoteFailureTitle(input.failure), 512)
  const rawMessage = clippedRemoteFailureText(input.failure.message, 4_000)
  const message = rawMessage || title || 'Remote run failed.'
  const failureKind = clippedRemoteFailureText(input.failure.failureKind, 128)
  const channelId = clippedRemoteFailureText(input.channelId, 256)
  const chatId = clippedRemoteFailureText(input.remoteSession?.chatId, 512)
  const remoteThreadId = clippedRemoteFailureText(input.remoteSession?.threadId, 512)
  const threadId = clippedRemoteFailureText(input.threadId, 512)
  return {
    provider: input.provider,
    message,
    ...(failureKind ? { failureKind } : {}),
    ...(title ? { failureTitle: title } : {}),
    ...(channelId ? { channelId } : {}),
    ...(chatId ? { chatId } : {}),
    ...(remoteThreadId ? { remoteThreadId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
    occurredAt: new Date().toISOString()
  }
}

function safeWebhookFailureBody(failure: RemoteFailureLike): { ok: false; message: string; failureKind?: string } {
  const title = remoteFailureTitle(failure)
  if (failure.failureKind === 'local_thread_deleted') {
    return {
      ok: false,
      message: failure.message,
      failureKind: failure.failureKind
    }
  }
  return {
    ok: false,
    message: title || 'Internal server error.',
    ...(failure.failureKind ? { failureKind: failure.failureKind } : {})
  }
}

function safeImFailureText(settings: AppSettingsV1, failure: RemoteFailureLike): string {
  if (failure.failureKind === 'local_thread_deleted') return failure.message
  const title = remoteFailureTitle(failure)
  if (title) return title
  return isChineseLocale(settings)
    ? '抱歉，我现在无法处理这条消息。'
    : 'Sorry, I could not process your message right now.'
}

function isChineseLocale(settings: AppSettingsV1): boolean {
  return settings.locale.toLowerCase().startsWith('zh')
}

function currentImModel(settings: AppSettingsV1, channel?: RemoteChannelV1): string {
  return channel?.model?.trim() || settings.remoteChannel.im.model.trim() || DEFAULT_REMOTE_CHANNEL_MODEL
}

function effectiveImRuntimeModel(
  settings: AppSettingsV1,
  requestedModel: string
): string {
  const trimmed = requestedModel.trim()
  if (trimmed && trimmed.toLowerCase() !== DEFAULT_REMOTE_CHANNEL_MODEL) return trimmed
  return resolveRuntimeModelRouterSettings(settings).model.trim() || trimmed || DEFAULT_REMOTE_CHANNEL_MODEL
}

function currentImMode(settings: AppSettingsV1): RemoteChannelRunMode {
  return settings.remoteChannel.im.mode === 'plan' ? 'plan' : 'agent'
}

function channelGuardMode(channel?: RemoteChannelV1): NonNullable<RemoteChannelV1['guardMode']> {
  return channel?.guardMode === 'all_messages' || channel?.guardMode === 'off'
    ? channel.guardMode
    : 'only_mention'
}

function compactRecentRemoteMessageText(text: string | undefined): string {
  const normalized = text?.replace(/\s+/g, ' ').trim() ?? ''
  if (normalized.length <= MAX_RECENT_REMOTE_MESSAGE_TEXT_LENGTH) return normalized
  return `${normalized.slice(0, MAX_RECENT_REMOTE_MESSAGE_TEXT_LENGTH - 3)}...`
}

function remoteConversationThreadId(
  _provider: RemoteChannelProvider,
  chatType: IncomingImChatType | undefined,
  rawThreadId: string | undefined
): string {
  if (chatType !== 'group') return ''
  return rawThreadId?.trim() ?? ''
}

function normalizeIncomingRemoteSession<T extends Pick<RemoteChannelRemoteSessionV1, 'threadId'>>(
  provider: RemoteChannelProvider,
  chatType: IncomingImChatType | undefined,
  session: T
): T {
  return {
    ...session,
    threadId: remoteConversationThreadId(provider, chatType, session.threadId)
  }
}

function shouldReplyInFeishuThread(message: Pick<NormalizedMessage, 'chatType' | 'threadId'>): boolean {
  return message.chatType === 'group' && Boolean(message.threadId?.trim())
}

function shortThreadId(threadId: string): string {
  return threadId.length > 12 ? `${threadId.slice(0, 8)}...${threadId.slice(-4)}` : threadId
}

function remoteChannelRuntimeId(
  settings: AppSettingsV1,
  channel?: RemoteChannelV1,
  conversation?: RemoteChannelConversationV1
): AgentRuntimeId {
  return normalizeAgentRuntimeId(conversation?.runtimeId ?? channel?.runtimeId ?? settings.activeAgentRuntime)
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

function remoteChannelThreadIdForRuntime(
  channel: RemoteChannelV1 | undefined,
  conversation: RemoteChannelConversationV1 | undefined,
  runtimeId: AgentRuntimeId
): string {
  const mapped =
    conversation?.agentThreadIds?.[runtimeId]?.trim() ||
    channel?.agentThreadIds?.[runtimeId]?.trim() ||
    ''
  return mapped
}

function remoteChannelConversationThreadIdForRuntime(
  conversation: RemoteChannelConversationV1 | undefined,
  runtimeId: AgentRuntimeId
): string {
  const mapped = conversation?.agentThreadIds?.[runtimeId]?.trim() || ''
  return mapped
}

function incomingThreadIdForRuntime(
  channel: RemoteChannelV1 | undefined,
  conversation: RemoteChannelConversationV1 | undefined,
  runtimeId: AgentRuntimeId,
  hasRemoteSession: boolean
): string {
  return hasRemoteSession
    ? remoteChannelConversationThreadIdForRuntime(conversation, runtimeId)
    : remoteChannelThreadIdForRuntime(channel, conversation, runtimeId)
}

function withRemoteChannelThreadMapping<T extends RemoteChannelV1 | RemoteChannelConversationV1>(
  item: T,
  runtimeId: AgentRuntimeId,
  threadId: string
): T {
  const trimmed = threadId.trim()
  return {
    ...item,
    runtimeId,
    agentThreadIds: withAgentThreadId(item.agentThreadIds, runtimeId, trimmed)
  }
}

function imCommandHelpText(settings: AppSettingsV1): string {
  if (isChineseLocale(settings)) {
    return [
      '远程通道命令：',
      '- `/help`：显示所有命令、参数、示例和注意事项。',
      '- `/where`：查看当前远端会话绑定的 provider、channel、项目、thread、model、mode、队列状态。',
      '- `/projects`：列出最近/可用项目，返回编号、名称、路径摘要和当前选中项。',
      '- `/use project <编号或名称>`：切换当前远端会话的项目。',
      '- `/threads`：列出当前项目最近会话，返回编号、标题、更新时间、运行状态和当前选中项。',
      '- `/use thread <编号或名称>`：切换当前远端会话绑定的本地 thread。',
      '- `/new <标题>`：在当前项目新建本地 thread，并切换当前远端会话到它。',
      '- `/attach current`：显式接管当前桌面 thread；不会持续跟随桌面焦点。',
      '- `/jobs`：查看当前远端会话相关 running、queued、failed、done 状态。',
      '- `/model`：查看当前 IM 连接模型。模型切换只能在 GUI 或 runtime 设置中完成。',
      '- `/mode`：查看当前 IM 运行模式。模式切换只能在 GUI 或 runtime 设置中完成。',
      '- `/summary`：查看当前远端会话摘要。',
      '- `/detach`：解除当前远端会话绑定。',
      '',
      '普通消息会发给当前绑定的本地会话；命令会查看或改变远端绑定/状态。',
      '同一个远端会话内消息会排队处理，不会并发打乱。',
      '示例：`/attach current`，`/new 修复 Discord 绑定`。'
    ].join('\n')
  }
  return [
    'Remote channel commands:',
    '- `/help`: show every command, parameter, example, and note.',
    '- `/where`: show the current remote provider, channel, project, thread, model, mode, and queue state.',
    '- `/projects`: list recent/available projects with numbers, names, path summaries, and the current selection.',
    '- `/use project <number or name>`: switch this remote conversation to a project.',
    '- `/threads`: list recent local threads for the current project with number, title, updated time, status, and current marker.',
    '- `/use thread <number or name>`: switch this remote conversation to a local thread.',
    '- `/new <title>`: create a local thread in the current project and bind this remote conversation to it.',
    '- `/attach current`: explicitly attach to the current desktop thread; it will not keep following desktop focus.',
    '- `/jobs`: show running, queued, failed, and done work for this remote conversation.',
    '- `/model`: show this IM connection model. Model changes must be made in GUI or runtime settings.',
    '- `/mode`: show the IM run mode. Mode changes must be made in GUI or runtime settings.',
    '- `/summary`: show the current remote conversation summary.',
    '- `/detach`: detach the current remote conversation binding.',
    '',
    'Ordinary messages go to the currently bound local thread; commands inspect or change remote binding/state.',
    'Messages in the same remote conversation are queued in order and will not run concurrently out of order.',
    'Examples: `/attach current`, `/new Fix Discord binding`.'
  ].join('\n')
}

function imFirstConnectHelpText(settings: AppSettingsV1): string {
  const help = imCommandHelpText(settings)
  return isChineseLocale(settings)
    ? `已连接到本地项目。你可以直接发送消息远程指导当前项目。\n\n${help}`
    : `Connected to the local project. Send a message here to guide the desktop project remotely.\n\n${help}`
}

function withFirstConnectHelp(settings: AppSettingsV1, firstConnect: boolean, reply: string): string {
  const trimmed = reply.trim()
  if (!firstConnect) return trimmed
  const help = imFirstConnectHelpText(settings)
  return trimmed ? `${help}\n\n---\n\n${trimmed}` : help
}

function imModelCommandHint(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? '远程通道不支持通过 IM 修改模型；请使用 /model 查看当前模型，并在 GUI 或 runtime 设置里修改。'
    : 'Remote channels do not support changing the model from IM. Use /model to inspect the current model, and change it in GUI or runtime settings.'
}

function imModelCurrentText(settings: AppSettingsV1, model: string): string {
  return isChineseLocale(settings)
    ? `当前远程通道模型是 \`${model}\`。`
    : `Current remote channel model: \`${model}\`.`
}

function imModelChangeUnsupportedText(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? '远程通道不支持通过 IM 修改模型；请在 GUI 或 runtime 设置里修改。'
    : 'Remote channels do not support changing the model from IM. Change it in GUI or runtime settings.'
}

function imNewTopicText(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? '新话题已开启。下一条消息会创建新的本地会话。'
    : 'Started a new topic. The next message will create a fresh local conversation.'
}

function isBareNewCommand(text: string): boolean {
  return /^[/-](?:new|新会话|新话题)$/.test(text.trim().replace(/^／/, '/').toLowerCase())
}

function generatedRemoteThreadTitle(settings: AppSettingsV1, input: {
  sender?: string
  channel?: RemoteChannelV1
  remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'senderName' | 'chatId'>
}): string {
  const sender = input.remoteSession?.senderName?.trim() || input.sender?.trim() || input.remoteSession?.chatId?.trim() || ''
  const channel = input.channel?.label.trim() || input.channel?.provider || 'IM'
  if (isChineseLocale(settings)) {
    return sender ? `远端会话 - ${sender}` : `远端会话 - ${channel}`
  }
  return sender ? `Remote conversation - ${sender}` : `Remote conversation - ${channel}`
}

function imNewPrivateUnsupportedText(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? '`/new private` 已预留给群内个人私有 thread，当前版本暂不支持。'
    : '`/new private` is reserved for private per-person group threads and is not supported yet.'
}

function imModeCommandHint(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? '远程通道不支持通过 IM 修改运行模式；请使用 /mode 查看当前模式，并在 GUI 或 runtime 设置里修改。'
    : 'Remote channels do not support changing run mode from IM. Use /mode to inspect the current mode, and change it in GUI or runtime settings.'
}

function imModeCurrentText(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? `当前远程通道模式是 \`${currentImMode(settings)}\`。`
    : `Current remote channel mode: \`${currentImMode(settings)}\`.`
}

function imModeChangeUnsupportedText(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? '远程通道不支持通过 IM 修改运行模式；请在 GUI 或 runtime 设置里修改。'
    : 'Remote channels do not support changing run mode from IM. Change it in GUI or runtime settings.'
}

function imDetachedText(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? '当前远端会话绑定已解除。下一条普通消息会创建新的本地会话。'
    : 'Detached the current remote conversation. The next normal message will create a fresh local conversation.'
}

function imNoThreadText(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? '当前远端会话还没有绑定本地 thread。'
    : 'No local thread is bound to the current remote conversation yet.'
}

function imGuardIgnoredMessage(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? '消息已被当前 channel guard mode 忽略。'
    : 'Ignored by the current channel guard mode.'
}

function imThreadListUnavailableText(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? '当前无法读取本地 thread 列表。请稍后重试，或发送 `/new <标题>` 新建本地 thread。'
    : 'The local thread list is unavailable right now. Try again later, or send `/new <title>` to create a local thread.'
}

function isThreadSelectorCommand(command: ReturnType<typeof parseRemoteChannelCommand>): boolean {
  return command?.kind === 'threads' || command?.kind === 'useThread'
}

function imEmptyIncomingMessageText(settings: AppSettingsV1, hasAttachmentHint: boolean): string {
  if (hasAttachmentHint) {
    return isChineseLocale(settings)
      ? '没有找到可发送给 runtime 的文本。当前暂不支持只有附件的远端消息，请补充文字说明后重试。'
      : 'No message text found. Attachments-only remote messages are not supported yet; send a short text description with the attachment.'
  }
  return isChineseLocale(settings)
    ? '没有找到消息文本。请发送一条文字消息。'
    : 'No message text found. Send a text message to continue.'
}

function imIncomingMessageTooLongText(
  settings: AppSettingsV1,
  provider: RemoteChannelProvider,
  actualLength: number,
  maxLength: number
): string {
  const label = getRemoteChannelProviderCapabilities(provider).label
  return isChineseLocale(settings)
    ? `消息太长，无法安全传入 ${label} runtime（${actualLength}/${maxLength} 字符）。请缩短后重试。`
    : `Message is too long to send to the ${label} runtime (${actualLength}/${maxLength} characters). Please shorten it and try again.`
}

function validateIncomingImText(
  settings: AppSettingsV1,
  provider: RemoteChannelProvider,
  rawText: string,
  options: { hasAttachmentHint?: boolean } = {}
): { ok: true; text: string } | { ok: false; message: string } {
  const text = rawText.trim()
  if (!text) {
    return {
      ok: false,
      message: imEmptyIncomingMessageText(settings, Boolean(options.hasAttachmentHint))
    }
  }
  const maxLength = getRemoteChannelProviderCapabilities(provider).maxMessageLength
  if (text.length > maxLength) {
    return {
      ok: false,
      message: imIncomingMessageTooLongText(settings, provider, text.length, maxLength)
    }
  }
  return { ok: true, text }
}

function hasAttachmentLikeValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return Boolean(value.trim())
  return typeof value === 'object' && value !== null
}

function payloadHasAttachmentHint(payload: Record<string, unknown>): boolean {
  const message = nestedRecord(payload.message)
  const event = nestedRecord(payload.event)
  const eventMessage = nestedRecord(event.message)
  const data = nestedRecord(payload.data)
  return [
    payload.attachments,
    payload.attachment,
    payload.files,
    payload.file,
    payload.images,
    payload.image,
    message.attachments,
    message.attachment,
    message.files,
    message.file,
    message.images,
    message.image,
    eventMessage.attachments,
    eventMessage.attachment,
    eventMessage.files,
    eventMessage.file,
    data.attachments,
    data.attachment,
    data.files,
    data.file,
    data.images,
    data.image
  ].some(hasAttachmentLikeValue)
}

type RemoteProjectCandidate = {
  workspaceRoot: string
  name: string
  pathSummary: string
  updatedAt: string
  current: boolean
}

function normalizeWorkspaceKey(workspaceRoot: string): string {
  return workspaceRoot.trim().replace(/[\\/]+$/, '').toLowerCase()
}

function workspacePathSummary(workspaceRoot: string): string {
  const normalized = workspaceRoot.trim().replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]+/).filter(Boolean)
  if (parts.length <= 2) return normalized
  return `.../${parts.slice(-2).join('/')}`
}

function workspaceName(workspaceRoot: string): string {
  const normalized = workspaceRoot.trim().replace(/[\\/]+$/, '')
  return basename(normalized) || normalized || '(workspace)'
}

function pushProjectRoot(
  map: Map<string, RemoteProjectCandidate>,
  workspaceRoot: string | undefined,
  updatedAt: string | undefined,
  currentWorkspaceRoot: string
): void {
  const root = workspaceRoot?.trim() ?? ''
  if (!root) return
  const key = normalizeWorkspaceKey(root)
  const existing = map.get(key)
  const nextUpdatedAt = updatedAt?.trim() || existing?.updatedAt || ''
  const current = normalizeWorkspaceKey(currentWorkspaceRoot) === key
  if (existing) {
    map.set(key, {
      ...existing,
      updatedAt: Date.parse(nextUpdatedAt) > Date.parse(existing.updatedAt) ? nextUpdatedAt : existing.updatedAt,
      current: existing.current || current
    })
    return
  }
  map.set(key, {
    workspaceRoot: root,
    name: workspaceName(root),
    pathSummary: workspacePathSummary(root),
    updatedAt: nextUpdatedAt,
    current
  })
}

function selectNumbered<T>(items: readonly T[], raw: string): T | null {
  if (!/^\d+$/.test(raw.trim())) return null
  const index = Number(raw.trim()) - 1
  return index >= 0 && index < items.length ? items[index] : null
}

function formatUpdatedAt(updatedAt: string): string {
  if (!updatedAt.trim()) return 'unknown'
  const parsed = Date.parse(updatedAt)
  if (!Number.isFinite(parsed)) return updatedAt
  return new Date(parsed).toISOString()
}

export class RemoteChannelRuntime {
  private readonly deps: RemoteChannelRuntimeDeps
  private server: Server | null = null
  private serverKey = ''
  private feishuChannels = new Map<string, LarkChannel>()
  private feishuChannelKeys = new Map<string, string>()
  private remoteMessageQueues = new Map<string, Promise<unknown>>()
  private recentRemoteMessageWriteQueue = Promise.resolve()
  private recentRemoteMessageIds = new Map<string, number>()
  private feishuSyncVersion = 0

  constructor(deps: RemoteChannelRuntimeDeps) {
    this.deps = deps
  }

  sync(settings: AppSettingsV1): void {
    this.syncWebhook(settings)
    void this.syncFeishuChannels(settings)
  }

  stop(): void {
    this.closeWebhook()
    void this.closeAllFeishuChannels()
  }

  async status(): Promise<RemoteChannelRuntimeStatus> {
    const settings = await this.deps.store.load()
    return {
      imServerRunning: this.server !== null && settings.remoteChannel.enabled && settings.remoteChannel.im.enabled,
      imUrl: webhookUrl(settings),
      runningTaskIds: []
    }
  }

  private logRemoteFailure(
    category: string,
    message: string,
    failure: RemoteFailureLike,
    context: Record<string, unknown> = {}
  ): void {
    this.deps.logError(category, message, redactSecrets({
      ...context,
      failure
    }))
  }

  private async rememberIncomingImFailure(
    input: {
      provider: RemoteChannelProvider
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
      threadId?: string
      runtimeId?: AgentRuntimeId
      failure: RemoteFailureLike
    }
  ): Promise<void> {
    if (!input.channel) return
    const currentSettings = await this.deps.store.load()
    const currentChannel = currentSettings.remoteChannel.channels.find((item) => item.id === input.channel?.id)
    if (!currentChannel) return
    const currentConversation = input.conversation
      ? currentChannel.conversations.find((item) => item.id === input.conversation?.id)
      : input.remoteSession
        ? this.findChannelConversation(currentChannel, input.remoteSession)
        : undefined
    const failure = remoteFailureRecord({
      provider: input.provider,
      channelId: currentChannel.id,
      remoteSession: input.remoteSession,
      threadId: input.threadId,
      runtimeId: input.runtimeId,
      failure: input.failure
    })
    await this.deps.store.patch({
      remoteChannel: {
        channels: currentSettings.remoteChannel.channels.map((item) => {
          if (item.id !== currentChannel.id) return item
          return {
            ...item,
            lastFailure: failure,
            conversations: currentConversation
              ? item.conversations.map((conversation) =>
                  conversation.id === currentConversation.id
                    ? { ...conversation, lastFailure: failure, updatedAt: failure.occurredAt }
                    : conversation
                )
              : item.conversations,
            updatedAt: failure.occurredAt
          }
        })
      }
    })
  }

  private async runPrompt(settings: AppSettingsV1, options: RunPromptOptions): Promise<RemoteChannelRunResult> {
    const workspace = options.workspaceRoot.trim() || settings.workspaceRoot
    const existingThreadId = options.threadId?.trim()
    const runtimeId = normalizeAgentRuntimeId(options.runtimeId)
    const requestedModel = normalizeTaskModel(options.model) ?? DEFAULT_REMOTE_CHANNEL_MODEL
    const model = effectiveImRuntimeModel(settings, requestedModel)
    return this.runAgentRuntimePrompt(settings, { ...options, model }, runtimeId, workspace, existingThreadId)
  }

  private async runAgentRuntimePrompt(
    _settings: AppSettingsV1,
    options: RunPromptOptions,
    runtimeId: AgentRuntimeId,
    workspace: string,
    existingThreadId?: string
  ): Promise<RemoteChannelRunResult> {
    const agentRuntime = this.deps.agentRuntime
    const model = normalizeTaskModel(options.model)
    const createThread = (): Promise<{ id: string }> =>
      agentRuntime.startThread({
        runtimeId,
        workspace,
        title: options.title.trim() || undefined,
        mode: options.mode,
        model
      })

    let thread: { id: string }
    try {
      thread = existingThreadId ? { id: existingThreadId } : await createThread()
    } catch (error) {
      return remoteChannelFailureFromError(error, 'Failed to create thread.')
    }
    const runtimePrompt = buildRemoteChannelRuntimePrompt(_settings, options.prompt, { channel: options.channel })
    const displayText = options.displayText?.trim() || parseRemoteChannelUserPromptForDisplay(options.prompt).text
    const startTurn = () => agentRuntime.startTurn({
      runtimeId,
      threadId: thread.id,
      text: runtimePrompt,
      workspace,
      mode: options.mode,
      model,
      governanceProfile: 'remote_guard',
      ...(displayText && displayText !== runtimePrompt ? { displayText } : {})
    })

    let turn: { threadId: string; turnId: string }
    let replacementPreviousThreadId: string | undefined
    try {
      turn = await startTurn()
    } catch (error) {
      if (!existingThreadId || !isMissingThreadError(error)) {
        return remoteChannelFailureFromError(error, 'Failed to start turn.')
      }
      this.deps.logError('remote-channel-runtime', 'Configured IM thread was missing; creating a replacement thread.', {
        threadId: existingThreadId,
        channelId: options.channel?.id,
        source: options.source,
        runtimeId
      })
      replacementPreviousThreadId = existingThreadId
      try {
        thread = await createThread()
        turn = await startTurn()
      } catch (replacementError) {
        return remoteChannelFailureFromError(replacementError, 'Failed to start turn.')
      }
    }

    const threadId = turn.threadId.trim() || thread.id
    const turnId = turn.turnId.trim()
    if (!turnId) {
      return remoteChannelFailureResult({
        message: 'Failed to start turn: missing turn id.',
        kind: 'runtime_offline'
      })
    }
    if (options.onTurnStarted) {
      await options.onTurnStarted({
        threadId,
        turnId,
        ...(replacementPreviousThreadId ? { previousThreadId: replacementPreviousThreadId } : {})
      })
    }
    if (!options.waitForResult) {
      return { ok: true, threadId, turnId, message: 'Started' }
    }

    let result: { text: string; files: RemoteChannelGeneratedFileV1[] }
    try {
      result = await this.waitForAgentRuntimeAssistantResult(
        threadId,
        turnId,
        options.responseTimeoutMs,
        workspace,
        runtimeId
      )
    } catch (error) {
      return remoteChannelFailureFromError(error, 'Failed to wait for agent response.')
    }
    return {
      ok: true,
      threadId,
      turnId,
      text: result.text,
      message: result.text || 'Completed',
      files: result.files
    }
  }

  private async waitForAgentRuntimeAssistantResult(
    threadId: string,
    turnId: string,
    timeoutMs: number,
    workspaceRoot: string,
    runtimeId: AgentRuntimeId
  ): Promise<{ text: string; files: RemoteChannelGeneratedFileV1[] }> {
    const agentRuntime = this.deps.agentRuntime
    const deadline = Date.now() + timeoutMs
    let lastText = ''
    let lastDetail: ThreadDetailJson | null = null
    while (Date.now() < deadline) {
      await sleep(1_500)
      const detail = await agentRuntime.readThread({ runtimeId, threadId }) as ThreadDetailJson
      lastDetail = detail
      lastText = latestAssistantText(detail, { turnId }) || lastText
      const targetTurn = Array.isArray(detail.turns)
        ? detail.turns.find((turn) => turn.id === turnId)
        : undefined
      if (!targetTurn) continue
      if (isRunningStatus(targetTurn.status)) {
        if (hasPendingDesktopApproval(detail, { turnId })) {
          throw remoteChannelFailureError(
            'waiting_desktop_approval',
            'Waiting for desktop approval before the remote channel can continue.',
            { threadId, turnId, runtimeId }
          )
        }
        continue
      }
      if (isFailedStatus(targetTurn.status)) {
        const error = targetTurn.error?.trim()
        throw new Error(error || `Agent turn ${targetTurn.status}.`)
      }
      if (isCompletedStatus(targetTurn.status)) {
        if (lastText) {
          return {
            text: lastText,
            files: latestGeneratedFiles(detail, { turnId, workspaceRoot })
          }
        }
        throw remoteChannelFailureError('empty_response', 'Agent completed without a reply.', {
          threadId,
          turnId,
          runtimeId
        })
      }
    }
    if (lastText && lastDetail) {
      return {
        text: lastText,
        files: latestGeneratedFiles(lastDetail, { turnId, workspaceRoot })
      }
    }
    await this.interruptTimedOutAgentRuntimeTurn(agentRuntime, runtimeId, threadId, turnId)
    throw remoteChannelFailureError('timeout', 'Timed out waiting for agent response.', {
      threadId,
      turnId,
      runtimeId
    })
  }

  private async interruptTimedOutAgentRuntimeTurn(
    agentRuntime: NonNullable<RemoteChannelRuntimeDeps['agentRuntime']>,
    runtimeId: AgentRuntimeId,
    threadId: string,
    turnId: string
  ): Promise<void> {
    if (!agentRuntime.interruptTurn) return
    let timedOut = false
    try {
      const interrupt = agentRuntime.interruptTurn({
        runtimeId,
        threadId,
        turnId,
        discard: true
      })
      void interrupt.catch((error) => {
        if (!timedOut) return
        this.deps.logError('remote-channel-runtime', 'Timed out agent turn interrupt later failed.', {
          runtimeId,
          threadId,
          turnId,
          message: errorMessage(error)
        })
      })
      await Promise.race([
        interrupt,
        sleep(AGENT_RUNTIME_INTERRUPT_TIMEOUT_MS).then(() => {
          timedOut = true
          throw new Error('Timed out interrupting agent turn.')
        })
      ])
    } catch (error) {
      this.deps.logError('remote-channel-runtime', 'Failed to interrupt timed out agent turn.', {
        runtimeId,
        threadId,
        turnId,
        message: errorMessage(error)
      })
    }
  }

  private resolveChannelWorkspaceRoot(settings: AppSettingsV1, channel?: RemoteChannelV1): string {
    return channel?.workspaceRoot.trim() || settings.remoteChannel.im.workspaceRoot.trim() || settings.workspaceRoot
  }

  private legacyEmptyBaseConversationWorkspaceRoot(
    session: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'threadId'>
  ): string {
    const key = sanitizePathSegment(session.threadId.trim() || session.chatId.trim(), 'conversation')
    return `/conversations/${key}`
  }

  private resolveConversationWorkspaceRoot(
    settings: AppSettingsV1,
    channel: RemoteChannelV1
  ): string {
    return this.resolveChannelWorkspaceRoot(settings, channel).trim()
  }

  private resolveIncomingWorkspaceRoot(
    settings: AppSettingsV1,
    channel: RemoteChannelV1 | undefined,
    conversation: RemoteChannelConversationV1 | undefined,
    remoteSession: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'threadId'> | undefined
  ): string {
    const storedConversationRoot = conversation?.workspaceRoot.trim() ?? ''
    if (storedConversationRoot && remoteSession) {
      const legacyEmptyBaseRoot = this.legacyEmptyBaseConversationWorkspaceRoot(remoteSession)
      const legacyChannelBaseRoot = `${this.resolveChannelWorkspaceRoot(settings, channel).replace(/\/+$/, '')}${legacyEmptyBaseRoot}`
      if (storedConversationRoot === legacyChannelBaseRoot) return this.resolveChannelWorkspaceRoot(settings, channel)
      if (storedConversationRoot !== legacyEmptyBaseRoot) return storedConversationRoot
    } else if (storedConversationRoot) {
      return storedConversationRoot
    }
    const conversationRoot = channel && remoteSession
      ? this.resolveConversationWorkspaceRoot(settings, channel)
      : ''
    return conversationRoot || this.resolveChannelWorkspaceRoot(settings, channel)
  }

  private shouldUseChannelThreadForIncoming(
    provider: RemoteChannelProvider,
    chatType?: IncomingImChatType,
    channel?: RemoteChannelV1,
    remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'threadId'>
  ): boolean {
    if (channel && remoteSession && this.findChannelConversation(channel, remoteSession)) {
      return false
    }
    return provider === 'discord' || provider === 'zulip' || chatType === 'group'
  }

  private shouldHandleIncomingByGuard(input: {
    channel?: RemoteChannelV1
    provider: RemoteChannelProvider
    chatType?: IncomingImChatType
    mentionedBot?: boolean
    mentionAll?: boolean
    isCommand: boolean
  }): boolean {
    if (input.isCommand) return true
    const guardMode = channelGuardMode(input.channel)
    if (guardMode === 'off') return false
    if (!this.shouldUseChannelThreadForIncoming(input.provider, input.chatType)) return true
    if (guardMode === 'all_messages') return true
    return Boolean(input.mentionedBot || input.mentionAll)
  }

  private incomingQueueText(
    settings: AppSettingsV1,
    channel: RemoteChannelV1 | undefined,
    remoteSession: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'threadId'> | undefined
  ): string {
    if (!channel || !remoteSession) {
      return isChineseLocale(settings) ? '空闲' : 'idle'
    }
    const prefix = `${channel.provider.trim()}::${channel.id.trim()}::${remoteSession.chatId.trim()}::`
    const queued = [...this.remoteMessageQueues.keys()].filter((key) => key.startsWith(prefix)).length
    if (queued <= 0) return isChineseLocale(settings) ? '空闲' : 'idle'
    return isChineseLocale(settings) ? `${queued} 条处理中 / 排队` : `${queued} queued/running`
  }

  private async resolveIncomingCommandContext(input: {
    settings: AppSettingsV1
    provider: RemoteChannelProvider
    chatType?: IncomingImChatType
    channel?: RemoteChannelV1
    conversation?: RemoteChannelConversationV1
    remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
  }): Promise<{
    settings: AppSettingsV1
    channel?: RemoteChannelV1
    conversation?: RemoteChannelConversationV1
    runtimeId: AgentRuntimeId
    threadId: string
    workspaceRoot: string
    sharedThread: boolean
  }> {
    const currentSettings = await this.deps.store.load()
    const currentChannel = input.channel
      ? currentSettings.remoteChannel.channels.find((item) => item.id === input.channel?.id) ?? input.channel
      : undefined
    const sharedThread = this.shouldUseChannelThreadForIncoming(
      input.provider,
      input.chatType,
      currentChannel,
      input.remoteSession
    )
    const currentConversation =
      currentChannel && input.remoteSession && !sharedThread
        ? this.findChannelConversation(currentChannel, input.remoteSession)
        : input.conversation
    const runtimeId = remoteChannelRuntimeId(currentSettings, currentChannel, currentConversation)
    const threadId = sharedThread
      ? remoteChannelThreadIdForRuntime(currentChannel, undefined, runtimeId)
      : incomingThreadIdForRuntime(currentChannel, currentConversation, runtimeId, Boolean(input.remoteSession))
    return {
      settings: currentSettings,
      channel: currentChannel,
      conversation: currentConversation,
      runtimeId,
      threadId,
      workspaceRoot: this.resolveIncomingWorkspaceRoot(
        currentSettings,
        currentChannel,
        currentConversation,
        input.remoteSession
      ),
      sharedThread
    }
  }

  private async readThreadDetailForRuntime(
    runtimeId: AgentRuntimeId,
    threadId: string
  ): Promise<ThreadDetailJson> {
    const agentRuntime = this.deps.agentRuntime
    return agentRuntime.readThread({ runtimeId, threadId }) as Promise<ThreadDetailJson>
  }

  private async incomingSummaryText(
    settings: AppSettingsV1,
    input: {
      provider: RemoteChannelProvider
      chatType?: IncomingImChatType
      sender?: string
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<string> {
    const context = await this.resolveIncomingCommandContext({ settings, ...input })
    if (!context.threadId) return imNoThreadText(settings)
    try {
      const detail = await this.readThreadDetailForRuntime(context.runtimeId, context.threadId)
      const summary = latestThreadSummaryText(detail)
      if (summary) {
        return isChineseLocale(settings)
          ? `当前摘要（${context.runtimeId}:${shortThreadId(context.threadId)}）：\n\n${summary}`
          : `Current summary (${context.runtimeId}:${shortThreadId(context.threadId)}):\n\n${summary}`
      }
      const latest = latestAssistantText(detail)
      if (latest) {
        return isChineseLocale(settings)
          ? `当前 thread 还没有保存摘要。最近一次助手回复：\n\n${latest}`
          : `No saved summary is available yet. Latest assistant reply:\n\n${latest}`
      }
      return isChineseLocale(settings)
        ? `当前 thread 还没有保存摘要（${context.runtimeId}:${shortThreadId(context.threadId)}）。`
        : `No saved summary is available yet (${context.runtimeId}:${shortThreadId(context.threadId)}).`
    } catch (error) {
      const message = errorMessage(error)
      this.deps.logError('remote-channel-runtime', 'Failed to read IM summary command context.', redactSecrets({
        message,
        runtimeId: context.runtimeId,
        threadId: context.threadId,
        channelId: context.channel?.id
      }))
      return isChineseLocale(settings)
        ? '读取当前摘要失败，请稍后重试。'
        : 'Could not read the current summary right now.'
    }
  }

  private async incomingStatusText(
    settings: AppSettingsV1,
    input: {
      provider: RemoteChannelProvider
      chatType?: IncomingImChatType
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<string> {
    const context = await this.resolveIncomingCommandContext({ settings, ...input })
    const channel = context.channel
    const thread = context.threadId
      ? `${context.runtimeId}:${shortThreadId(context.threadId)}`
      : (isChineseLocale(settings) ? '未绑定' : 'unbound')
    const queue = this.incomingQueueText(context.settings, channel, input.remoteSession)
    const server = this.server !== null && context.settings.remoteChannel.enabled && context.settings.remoteChannel.im.enabled
      ? (isChineseLocale(settings) ? '运行中' : 'running')
      : (isChineseLocale(settings) ? '未运行' : 'not running')
    if (isChineseLocale(settings)) {
      return [
        '远程通道状态：',
        `- Channel：${channel ? `${channel.label} (${channel.provider})` : input.provider}`,
        `- Guard：${channelGuardMode(channel)}`,
        `- Mode：${currentImMode(context.settings)}`,
        `- Model：${currentImModel(context.settings, channel)}`,
        `- Workspace：${context.workspaceRoot || '(未设置)'}`,
        `- Thread：${thread}${context.sharedThread ? '（群 / channel 共享）' : ''}`,
        `- Queue：${queue}`,
        `- Runtime：${server}`
      ].join('\n')
    }
    return [
      'Remote channel status:',
      `- Channel: ${channel ? `${channel.label} (${channel.provider})` : input.provider}`,
      `- Guard: ${channelGuardMode(channel)}`,
      `- Mode: ${currentImMode(context.settings)}`,
      `- Model: ${currentImModel(context.settings, channel)}`,
      `- Workspace: ${context.workspaceRoot || '(unset)'}`,
      `- Thread: ${thread}${context.sharedThread ? ' (shared by group/channel)' : ''}`,
      `- Queue: ${queue}`,
      `- Runtime: ${server}`
    ].join('\n')
  }

  private async incomingJobsText(
    settings: AppSettingsV1,
    input: {
      provider: RemoteChannelProvider
      chatType?: IncomingImChatType
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<string> {
    const context = await this.resolveIncomingCommandContext({ settings, ...input })
    const queue = this.incomingQueueText(context.settings, context.channel, input.remoteSession)
    if (!context.threadId) {
      return isChineseLocale(settings)
        ? `当前远端会话还没有绑定本地 thread。\n- Queue：${queue}`
        : `No local thread is bound to the current remote conversation yet.\n- Queue: ${queue}`
    }
    try {
      const detail = await this.readThreadDetailForRuntime(context.runtimeId, context.threadId)
      const turns = Array.isArray(detail.turns) ? detail.turns : []
      const running = turns.filter((turn) => isRunningStatus(turn.status)).length
      const failed = turns.filter((turn) => isFailedStatus(turn.status)).length
      const done = turns.filter((turn) => isCompletedStatus(turn.status)).length
      const latest = turns.at(-1)
      if (isChineseLocale(settings)) {
        return [
          `当前 jobs（${context.runtimeId}:${shortThreadId(context.threadId)}）：`,
          `- Running/queued：${running}`,
          `- Failed：${failed}`,
          `- Done：${done}`,
          `- Queue：${queue}`,
          `- Latest：${latest?.id ?? 'none'} ${latest?.status ?? ''}`.trim()
        ].join('\n')
      }
      return [
        `Current jobs (${context.runtimeId}:${shortThreadId(context.threadId)}):`,
        `- Running/queued: ${running}`,
        `- Failed: ${failed}`,
        `- Done: ${done}`,
        `- Queue: ${queue}`,
        `- Latest: ${latest?.id ?? 'none'} ${latest?.status ?? ''}`.trim()
      ].join('\n')
    } catch (error) {
      this.deps.logError('remote-channel-runtime', 'Failed to read IM jobs command context.', redactSecrets({
        message: errorMessage(error),
        runtimeId: context.runtimeId,
        threadId: context.threadId,
        channelId: context.channel?.id
      }))
      return isChineseLocale(settings)
        ? '读取当前 jobs 失败，请稍后重试。'
        : 'Could not read current jobs right now.'
    }
  }

  private findChannelConversation(
    channel: RemoteChannelV1,
    session: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'threadId'>
  ): RemoteChannelConversationV1 | undefined {
    const targetKey = remoteChannelConversationKey(session.chatId, session.threadId)
    return channel.conversations.find((conversation) =>
      remoteChannelConversationKey(conversation.chatId, conversation.remoteThreadId) === targetKey
    )
  }

  private async resetIncomingImThread(
    input: {
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<void> {
    if (!input.channel) return
    const currentSettings = await this.deps.store.load()
    const currentChannel = currentSettings.remoteChannel.channels.find((item) => item.id === input.channel?.id)
    if (!currentChannel) return
    const session = input.remoteSession
    const currentConversation = session
      ? this.findChannelConversation(currentChannel, session)
      : input.conversation
        ? currentChannel.conversations.find((item) => item.id === input.conversation?.id)
        : undefined
    const runtimeId = remoteChannelRuntimeId(currentSettings, currentChannel, currentConversation)
    const now = new Date().toISOString()
    await this.deps.store.patch({
      remoteChannel: {
        channels: currentSettings.remoteChannel.channels.map((item) => {
          if (item.id !== currentChannel.id) return item
          return {
            ...withRemoteChannelThreadMapping(item, runtimeId, ''),
            conversations: currentConversation
              ? item.conversations.map((conversation) =>
                  conversation.id === currentConversation.id
                    ? {
                        ...withRemoteChannelThreadMapping(conversation, runtimeId, ''),
                        latestMessageId: session?.messageId || conversation.latestMessageId,
                        senderId: session?.senderId || conversation.senderId,
                        senderName: session?.senderName || conversation.senderName,
                        updatedAt: now
                      }
                    : conversation
                )
              : item.conversations,
            updatedAt: now
          }
        })
      }
    })
  }

  private projectCandidates(
    settings: AppSettingsV1,
    context: {
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      workspaceRoot: string
    }
  ): RemoteProjectCandidate[] {
    const map = new Map<string, RemoteProjectCandidate>()
    const currentWorkspaceRoot = context.workspaceRoot || this.resolveChannelWorkspaceRoot(settings, context.channel)
    pushProjectRoot(map, currentWorkspaceRoot, context.conversation?.updatedAt ?? context.channel?.updatedAt, currentWorkspaceRoot)
    pushProjectRoot(map, settings.workspaceRoot, '', currentWorkspaceRoot)
    pushProjectRoot(map, settings.remoteChannel.im.workspaceRoot, '', currentWorkspaceRoot)
    for (const channel of settings.remoteChannel.channels) {
      pushProjectRoot(map, channel.workspaceRoot, channel.updatedAt, currentWorkspaceRoot)
      for (const conversation of channel.conversations) {
        pushProjectRoot(map, conversation.workspaceRoot || channel.workspaceRoot, conversation.updatedAt, currentWorkspaceRoot)
      }
    }
    for (const task of settings.schedule.tasks) {
      pushProjectRoot(map, task.workspaceRoot, task.updatedAt, currentWorkspaceRoot)
    }
    return [...map.values()].sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    })
  }

  private async incomingProjectsText(
    settings: AppSettingsV1,
    input: {
      provider: RemoteChannelProvider
      chatType?: IncomingImChatType
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<string> {
    const context = await this.resolveIncomingCommandContext({ settings, ...input })
    const projects = this.projectCandidates(context.settings, context)
    if (projects.length === 0) {
      return isChineseLocale(settings) ? '还没有可用项目。' : 'No projects are available yet.'
    }
    const lines = projects.slice(0, 20).map((project, index) => {
      const marker = project.current ? '*' : ' '
      return `${marker} ${index + 1}. ${project.name} - ${project.pathSummary} - ${formatUpdatedAt(project.updatedAt)}`
    })
    return [
      isChineseLocale(settings) ? '可用项目：' : 'Available projects:',
      ...lines
    ].join('\n')
  }

  private resolveProjectCandidate(
    projects: readonly RemoteProjectCandidate[],
    target: string
  ): { project?: RemoteProjectCandidate; ambiguous?: RemoteProjectCandidate[]; message?: string } {
    const numbered = selectNumbered(projects, target)
    if (numbered) return { project: numbered }
    const normalized = target.trim().toLowerCase()
    const matches = projects.filter((project) =>
      project.workspaceRoot.toLowerCase() === normalized ||
      project.name.toLowerCase() === normalized ||
      project.pathSummary.toLowerCase().endsWith(normalized)
    )
    if (matches.length === 1) return { project: matches[0] }
    if (matches.length > 1) return { ambiguous: matches }
    return { message: `Project not found: ${target.trim()}` }
  }

  private async useIncomingProject(
    settings: AppSettingsV1,
    input: {
      provider: RemoteChannelProvider
      chatType?: IncomingImChatType
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
      target: string
    }
  ): Promise<string> {
    const context = await this.resolveIncomingCommandContext({ settings, ...input })
    if (!context.channel) {
      return isChineseLocale(settings) ? '当前 IM 渠道不可用，无法切换项目。' : 'No IM channel is available to switch projects.'
    }
    const projects = this.projectCandidates(context.settings, context)
    const resolved = this.resolveProjectCandidate(projects, input.target)
    if (resolved.ambiguous) {
      const candidates = resolved.ambiguous.map((project) => `- ${project.name}: ${project.pathSummary}`).join('\n')
      return isChineseLocale(settings) ? `项目名称有歧义：\n${candidates}` : `Project name is ambiguous:\n${candidates}`
    }
    if (!resolved.project) {
      return isChineseLocale(settings)
        ? `${resolved.message ?? '项目不存在'}。请发送 /projects 查看候选。`
        : `${resolved.message ?? 'Project not found'}. Send /projects to see candidates.`
    }
    const now = new Date().toISOString()
    const project = resolved.project
    await this.deps.store.patch({
      remoteChannel: {
        channels: context.settings.remoteChannel.channels.map((item) => {
          if (item.id !== context.channel?.id) return item
          const nextChannel = context.sharedThread || !context.conversation
            ? withRemoteChannelThreadMapping(item, context.runtimeId, '')
            : item
          return {
            ...nextChannel,
            workspaceRoot: project.workspaceRoot,
            conversations: context.conversation && !context.sharedThread
              ? item.conversations.map((conversation) =>
                  conversation.id === context.conversation?.id
                    ? {
                        ...withRemoteChannelThreadMapping(conversation, context.runtimeId, ''),
                        workspaceRoot: project.workspaceRoot,
                        updatedAt: now
                      }
                    : conversation
                )
              : item.conversations,
            updatedAt: now
          }
        })
      }
    })
    return isChineseLocale(settings)
      ? `已切换项目到 ${project.name}（${project.pathSummary}）。请发送 /threads 选择会话，或 /new <标题> 新建。`
      : `Switched project to ${project.name} (${project.pathSummary}). Send /threads to choose a thread, or /new <title> to create one.`
  }

  private async listRuntimeThreads(
    settings: AppSettingsV1,
    runtimeId: AgentRuntimeId,
    workspaceRoot: string
  ): Promise<{ ok: true; threads: AgentRuntimeThread[] } | { ok: false; message: string }> {
    const listThreads = this.deps.agentRuntime.listThreads
    if (!listThreads) {
      this.deps.logError('remote-channel-runtime', 'Unable to list IM thread candidates because AgentRuntimeHost.listThreads is unavailable.', redactSecrets({
        runtimeId,
        workspaceRoot,
        message: UNSUPPORTED_AGENT_RUNTIME_HOST_MESSAGE
      }))
      return { ok: false, message: imThreadListUnavailableText(settings) }
    }
    try {
      return { ok: true, threads: await listThreads({ runtimeId, limit: 50, includeArchived: false }) }
    } catch (error) {
      this.deps.logError('remote-channel-runtime', 'Failed to list IM thread candidates.', redactSecrets({
        runtimeId,
        workspaceRoot,
        message: errorMessage(error)
      }))
      return { ok: false, message: imThreadListUnavailableText(settings) }
    }
  }

  private async incomingThreadsText(
    settings: AppSettingsV1,
    input: {
      provider: RemoteChannelProvider
      chatType?: IncomingImChatType
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<string> {
    const context = await this.resolveIncomingCommandContext({ settings, ...input })
    const listed = await this.listRuntimeThreads(settings, context.runtimeId, context.workspaceRoot)
    if (!listed.ok) return listed.message
    const threads = listed.threads
      .filter((thread) => thread.archived !== true)
      .filter((thread) => !context.workspaceRoot || !thread.workspace || normalizeWorkspaceKey(thread.workspace) === normalizeWorkspaceKey(context.workspaceRoot))
      .slice(0, 20)
    if (threads.length === 0) {
      return isChineseLocale(settings) ? '当前项目还没有可用 thread。' : 'No threads are available for the current project yet.'
    }
    const lines = threads.map((thread, index) => {
      const marker = thread.id === context.threadId ? '*' : ' '
      const status = thread.latestTurnStatus || thread.status || 'unknown'
      return `${marker} ${index + 1}. ${thread.title || thread.id} - ${status} - ${formatUpdatedAt(thread.updatedAt)}`
    })
    return [
      isChineseLocale(settings) ? '当前项目会话：' : 'Current project threads:',
      ...lines
    ].join('\n')
  }

  private resolveThreadCandidate(
    threads: readonly AgentRuntimeThread[],
    target: string
  ): { thread?: AgentRuntimeThread; ambiguous?: AgentRuntimeThread[]; message?: string } {
    const numbered = selectNumbered(threads, target)
    if (numbered) return { thread: numbered }
    const normalized = target.trim().toLowerCase()
    const exact = threads.filter((thread) => thread.title.trim().toLowerCase() === normalized || thread.id.toLowerCase() === normalized)
    if (exact.length === 1) return { thread: exact[0] }
    if (exact.length > 1) return { ambiguous: exact }
    const fuzzy = threads.filter((thread) => thread.title.trim().toLowerCase().includes(normalized))
    if (fuzzy.length === 1) return { thread: fuzzy[0] }
    if (fuzzy.length > 1) return { ambiguous: fuzzy }
    return { message: `Thread not found: ${target.trim()}` }
  }

  private async useIncomingThread(
    settings: AppSettingsV1,
    input: {
      provider: RemoteChannelProvider
      chatType?: IncomingImChatType
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
      target: string
    }
  ): Promise<string> {
    const context = await this.resolveIncomingCommandContext({ settings, ...input })
    if (!context.channel) {
      return isChineseLocale(settings) ? '当前 IM 渠道不可用，无法切换 thread。' : 'No IM channel is available to switch threads.'
    }
    const listed = await this.listRuntimeThreads(settings, context.runtimeId, context.workspaceRoot)
    if (!listed.ok) return listed.message
    const threads = listed.threads
      .filter((thread) => thread.archived !== true)
      .filter((thread) => !context.workspaceRoot || !thread.workspace || normalizeWorkspaceKey(thread.workspace) === normalizeWorkspaceKey(context.workspaceRoot))
      .slice(0, 50)
    const resolved = this.resolveThreadCandidate(threads, input.target)
    if (resolved.ambiguous) {
      const candidates = resolved.ambiguous.map((thread, index) => `- ${index + 1}. ${thread.title || thread.id} (${thread.id})`).join('\n')
      return isChineseLocale(settings) ? `会话名称有歧义：\n${candidates}` : `Thread name is ambiguous:\n${candidates}`
    }
    if (!resolved.thread) {
      return isChineseLocale(settings)
        ? `${resolved.message ?? '会话不存在'}。请发送 /threads 查看候选。`
        : `${resolved.message ?? 'Thread not found'}. Send /threads to see candidates.`
    }
    const thread = resolved.thread
    const runtimeId = normalizeAgentRuntimeId(thread.runtimeId || context.runtimeId)
    const workspaceRoot = thread.workspace?.trim() || context.workspaceRoot
    const now = new Date().toISOString()
    const session = input.remoteSession
    const nextConversation: RemoteChannelConversationV1 | null = context.conversation
      ? {
          ...withRemoteChannelThreadMapping(context.conversation, runtimeId, thread.id),
          ...(session
            ? {
                latestMessageId: session.messageId,
                senderId: session.senderId,
                senderName: session.senderName
              }
            : {}),
          workspaceRoot,
          updatedAt: now
        }
      : session
        ? withRemoteChannelThreadMapping({
            id: randomUUID(),
            chatId: session.chatId,
            remoteThreadId: session.threadId,
            latestMessageId: session.messageId,
            senderId: session.senderId,
            senderName: session.senderName,
            workspaceRoot,
            createdAt: now,
            updatedAt: now
          }, runtimeId, thread.id)
        : null
    await this.deps.store.patch({
      remoteChannel: {
        channels: context.settings.remoteChannel.channels.map((item) => {
          if (item.id !== context.channel?.id) return item
          const nextChannel = context.sharedThread || !context.conversation
            ? withRemoteChannelThreadMapping(item, runtimeId, thread.id)
            : item
          return {
            ...nextChannel,
            runtimeId,
            workspaceRoot,
            conversations: nextConversation
              ? context.conversation
                ? item.conversations.map((conversation) =>
                    conversation.id === context.conversation?.id ? nextConversation : conversation
                  )
                : [...item.conversations, nextConversation]
              : item.conversations,
            updatedAt: now
          }
        })
      }
    })
    this.deps.notifyChannelActivity?.({ channelId: context.channel.id, threadId: thread.id, runtimeId })
    return isChineseLocale(settings)
      ? `已切换到 thread（${runtimeId}:${shortThreadId(thread.id)}）：${thread.title || thread.id}`
      : `Switched to thread (${runtimeId}:${shortThreadId(thread.id)}): ${thread.title || thread.id}`
  }

  private async detachIncomingImBinding(
    settings: AppSettingsV1,
    input: {
      provider: RemoteChannelProvider
      chatType?: IncomingImChatType
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<string> {
    const context = await this.resolveIncomingCommandContext({ settings, ...input })
    if (!context.channel) {
      return isChineseLocale(settings)
        ? '当前 IM 渠道不可用，无法解除绑定。'
        : 'No IM channel is available to detach.'
    }
    if (!context.threadId) return imNoThreadText(settings)
    const now = new Date().toISOString()
    await this.deps.store.patch({
      remoteChannel: {
        channels: context.settings.remoteChannel.channels.map((item) => {
          if (item.id !== context.channel?.id) return item
          const shouldClearChannel = context.sharedThread || !context.conversation
          const nextChannel = shouldClearChannel
            ? withRemoteChannelThreadMapping(item, context.runtimeId, '')
            : item
          return {
            ...nextChannel,
            conversations: context.conversation && !context.sharedThread
              ? item.conversations.map((conversation) =>
                  conversation.id === context.conversation?.id
                    ? {
                        ...withRemoteChannelThreadMapping(conversation, context.runtimeId, ''),
                        updatedAt: now
                      }
                    : conversation
                )
              : item.conversations,
            updatedAt: now
          }
        })
      }
    })
    return imDetachedText(settings)
  }

  private async createIncomingImThread(
    settings: AppSettingsV1,
    input: {
      provider: RemoteChannelProvider
      chatType?: IncomingImChatType
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
      title: string
    }
  ): Promise<string> {
    const currentSettings = await this.deps.store.load()
    const currentChannel = input.channel
      ? currentSettings.remoteChannel.channels.find((item) => item.id === input.channel?.id) ?? input.channel
      : undefined
    if (!currentChannel) {
      return isChineseLocale(settings)
        ? '当前 IM 渠道不可用，无法新建本地 thread。'
        : 'No IM channel is available to create a local thread.'
    }
    const session = input.remoteSession
    const currentConversation = session
      ? this.findChannelConversation(currentChannel, session) ?? input.conversation
      : input.conversation
        ? currentChannel.conversations.find((item) => item.id === input.conversation?.id)
        : undefined
    const runtimeId = remoteChannelRuntimeId(currentSettings, currentChannel, currentConversation)
    const workspaceRoot = this.resolveIncomingWorkspaceRoot(
      currentSettings,
      currentChannel,
      currentConversation,
      session
    )
    const title = input.title.trim() || (isChineseLocale(settings) ? '远端新会话' : 'Remote conversation')
    let threadId = ''
    try {
      const agentRuntime = this.deps.agentRuntime
      const thread = await agentRuntime.startThread({
        runtimeId,
        workspace: workspaceRoot,
        title,
        mode: currentSettings.remoteChannel.im.mode,
        model: normalizeTaskModel(currentImModel(currentSettings, currentChannel))
      })
      threadId = thread.id.trim()
    } catch (error) {
      const failure = remoteChannelFailureFromError(error, 'Failed to create thread.')
      await this.rememberIncomingImFailure({
        provider: input.provider,
        channel: currentChannel,
        conversation: currentConversation,
        remoteSession: session,
        runtimeId,
        failure
      })
      return failure.message
    }
    if (!threadId) {
      await this.rememberIncomingImFailure({
        provider: input.provider,
        channel: currentChannel,
        conversation: currentConversation,
        remoteSession: session,
        runtimeId,
        failure: { ok: false, message: 'Failed to create a local thread: runtime did not return a thread id.' }
      })
      return isChineseLocale(settings)
        ? '新建本地 thread 失败：runtime 没有返回 thread id。'
        : 'Failed to create a local thread: runtime did not return a thread id.'
    }

    const now = new Date().toISOString()
    const nextConversation: RemoteChannelConversationV1 | null = currentConversation
      ? {
          ...withRemoteChannelThreadMapping(currentConversation, runtimeId, threadId),
          ...(session
            ? {
                latestMessageId: session.messageId,
                senderId: session.senderId,
                senderName: session.senderName
              }
            : {}),
          workspaceRoot,
          updatedAt: now
        }
      : session
        ? withRemoteChannelThreadMapping({
            id: randomUUID(),
            chatId: session.chatId,
            remoteThreadId: session.threadId,
            latestMessageId: session.messageId,
            senderId: session.senderId,
            senderName: session.senderName,
            workspaceRoot,
            createdAt: now,
            updatedAt: now
          }, runtimeId, threadId)
        : null
    await this.deps.store.patch({
      remoteChannel: {
        channels: currentSettings.remoteChannel.channels.map((item) => {
          if (item.id !== currentChannel.id) return item
          return {
            ...withRemoteChannelThreadMapping(item, runtimeId, threadId),
            conversations: nextConversation
              ? currentConversation
                ? item.conversations.map((conversation) =>
                    conversation.id === currentConversation.id ? nextConversation : conversation
                  )
                : [...item.conversations, nextConversation]
              : item.conversations,
            updatedAt: now
          }
        })
      }
    })
    this.deps.notifyChannelActivity?.({ channelId: currentChannel.id, threadId, runtimeId })
    return isChineseLocale(settings)
      ? `已新建并绑定本地 thread（${runtimeId}:${shortThreadId(threadId)}）：${title}`
      : `Created and bound a local thread (${runtimeId}:${shortThreadId(threadId)}): ${title}`
  }

  private async attachIncomingImToActiveThread(
    settings: AppSettingsV1,
    input: {
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<string> {
    if (!input.channel) {
      return isChineseLocale(settings)
        ? '当前 IM 渠道不可用，无法绑定到电脑端会话。'
        : 'No IM channel is available to attach to the active desktop conversation.'
    }
    const active = this.deps.getActiveThreadContext?.()
    const activeThreadId = active?.threadId.trim() ?? ''
    if (!activeThreadId) {
      return isChineseLocale(settings)
        ? '还没有可绑定的电脑端当前会话。请先在本地打开一个会话，再发送 /attach current。'
        : 'There is no active desktop conversation to attach. Open a local conversation first, then send /attach current.'
    }
    const activeUpdatedAt = active?.updatedAt ? Date.parse(active.updatedAt) : Number.NaN
    if (Number.isFinite(activeUpdatedAt) && Date.now() - activeUpdatedAt > ATTACH_CURRENT_ACTIVE_TTL_MS) {
      return isChineseLocale(settings)
        ? '电脑端当前会话已经超过 10 分钟没有活跃，无法接管。请先在桌面端重新打开或操作该会话，再发送 /attach current。'
        : 'The active desktop conversation has been idle for more than 10 minutes, so it cannot be attached. Reopen or use that desktop conversation, then send /attach current again.'
    }
    const currentSettings = await this.deps.store.load()
    const currentChannel = currentSettings.remoteChannel.channels.find((item) => item.id === input.channel?.id)
    if (!currentChannel) {
      return isChineseLocale(settings)
        ? '当前 IM 渠道不可用，无法绑定到电脑端会话。'
        : 'No IM channel is available to attach to the active desktop conversation.'
    }
    const runtimeId = normalizeAgentRuntimeId(active?.runtimeId ?? currentSettings.activeAgentRuntime)
    const session = input.remoteSession
    const existingConversation = session
      ? this.findChannelConversation(currentChannel, session)
      : input.conversation
        ? currentChannel.conversations.find((item) => item.id === input.conversation?.id)
        : undefined
    const now = new Date().toISOString()
    const workspaceRoot = active?.workspaceRoot?.trim() ||
      (session ? this.resolveIncomingWorkspaceRoot(currentSettings, currentChannel, existingConversation, session) : '') ||
      existingConversation?.workspaceRoot.trim() ||
      this.resolveChannelWorkspaceRoot(currentSettings, currentChannel)
    const nextConversation: RemoteChannelConversationV1 | null = existingConversation
      ? {
          ...withRemoteChannelThreadMapping(existingConversation, runtimeId, activeThreadId),
          ...(session
            ? {
                latestMessageId: session.messageId,
                senderId: session.senderId,
                senderName: session.senderName
              }
            : {}),
          workspaceRoot,
          updatedAt: now
        }
      : session
        ? withRemoteChannelThreadMapping({
            id: randomUUID(),
            chatId: session.chatId,
            remoteThreadId: session.threadId,
            latestMessageId: session.messageId,
            senderId: session.senderId,
            senderName: session.senderName,
            workspaceRoot,
            createdAt: now,
            updatedAt: now
          }, runtimeId, activeThreadId)
        : null
    await this.deps.store.patch({
      remoteChannel: {
        channels: currentSettings.remoteChannel.channels.map((item) => {
          if (item.id !== currentChannel.id) return item
          return {
            ...withRemoteChannelThreadMapping(item, runtimeId, activeThreadId),
            conversations: nextConversation
              ? existingConversation
                ? item.conversations.map((conversation) =>
                    conversation.id === existingConversation.id ? nextConversation : conversation
                  )
                : [...item.conversations, nextConversation]
              : item.conversations,
            updatedAt: now
          }
        })
      }
    })
    this.deps.notifyChannelActivity?.({ channelId: currentChannel.id, threadId: activeThreadId, runtimeId })
    return isChineseLocale(settings)
      ? `已绑定到电脑端当前会话（${runtimeId}:${shortThreadId(activeThreadId)}）。之后这个 IM 会话里的消息会继续进入同一个本地进程。`
      : `Attached to the active desktop conversation (${runtimeId}:${shortThreadId(activeThreadId)}). Future messages in this IM conversation will continue in that local process.`
  }

  private async handleIncomingImCommand(
    settings: AppSettingsV1,
    input: {
      text: string
      provider: RemoteChannelProvider
      chatType?: IncomingImChatType
      sender?: string
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<string | null> {
    const command = parseRemoteChannelCommand(input.text)
    if (!command) return null
    if (command.kind === 'help') return imCommandHelpText(settings)
    if (command.kind === 'newPrivate') return imNewPrivateUnsupportedText(settings)
    if (command.kind === 'showModel') return imModelCurrentText(settings, currentImModel(settings, input.channel))
    if (command.kind === 'invalidModel') return imModelCommandHint(settings)
    if (command.kind === 'model') {
      return imModelChangeUnsupportedText(settings)
    }
    if (command.kind === 'showMode') return imModeCurrentText(settings)
    if (command.kind === 'invalidMode') return imModeCommandHint(settings)
    if (command.kind === 'mode') {
      return imModeChangeUnsupportedText(settings)
    }
    if (command.kind === 'summary') {
      return this.incomingSummaryText(settings, {
        provider: input.provider,
        chatType: input.chatType,
        channel: input.channel,
        conversation: input.conversation,
        remoteSession: input.remoteSession
      })
    }
    if (command.kind === 'status') {
      return this.incomingStatusText(settings, {
        provider: input.provider,
        chatType: input.chatType,
        channel: input.channel,
        conversation: input.conversation,
        remoteSession: input.remoteSession
      })
    }
    if (command.kind === 'detach') {
      return this.detachIncomingImBinding(settings, {
        provider: input.provider,
        chatType: input.chatType,
        channel: input.channel,
        conversation: input.conversation,
        remoteSession: input.remoteSession
      })
    }
    if (command.kind === 'jobs') {
      return this.incomingJobsText(settings, {
        provider: input.provider,
        chatType: input.chatType,
        channel: input.channel,
        conversation: input.conversation,
        remoteSession: input.remoteSession
      })
    }
    if (command.kind === 'projects') {
      return this.incomingProjectsText(settings, {
        provider: input.provider,
        chatType: input.chatType,
        channel: input.channel,
        conversation: input.conversation,
        remoteSession: input.remoteSession
      })
    }
    if (command.kind === 'threads') {
      return this.incomingThreadsText(settings, {
        provider: input.provider,
        chatType: input.chatType,
        channel: input.channel,
        conversation: input.conversation,
        remoteSession: input.remoteSession
      })
    }
    if (command.kind === 'useProject') {
      return this.useIncomingProject(settings, {
        provider: input.provider,
        chatType: input.chatType,
        channel: input.channel,
        conversation: input.conversation,
        remoteSession: input.remoteSession,
        target: command.target
      })
    }
    if (command.kind === 'useThread') {
      return this.useIncomingThread(settings, {
        provider: input.provider,
        chatType: input.chatType,
        channel: input.channel,
        conversation: input.conversation,
        remoteSession: input.remoteSession,
        target: command.target
      })
    }
    if (command.kind === 'newThread') {
      return this.createIncomingImThread(settings, {
        provider: input.provider,
        chatType: input.chatType,
        channel: input.channel,
        conversation: input.conversation,
        remoteSession: input.remoteSession,
        title: command.title
      })
    }
    if (command.kind === 'attachCurrent') {
      return this.attachIncomingImToActiveThread(settings, {
        channel: input.channel,
        conversation: input.conversation,
        remoteSession: input.remoteSession
      })
    }
    if (command.kind === 'clear') {
      if (isBareNewCommand(input.text)) {
        return this.createIncomingImThread(settings, {
          provider: input.provider,
          chatType: input.chatType,
          channel: input.channel,
          conversation: input.conversation,
          remoteSession: input.remoteSession,
          title: generatedRemoteThreadTitle(settings, {
            sender: input.sender,
            channel: input.channel,
            remoteSession: input.remoteSession
          })
        })
      }
      await this.resetIncomingImThread({
        channel: input.channel,
        conversation: input.conversation,
        remoteSession: input.remoteSession
      })
      return imNewTopicText(settings)
    }
    return null
  }

  private async processIncomingImPrompt(
    settings: AppSettingsV1,
    input: {
      prompt: string
      displayText?: string
      sender: string
      provider: RemoteChannelProvider
      chatType?: IncomingImChatType
      sharedThread?: boolean
      channel?: RemoteChannelV1
      conversation?: RemoteChannelConversationV1
      remoteSession?: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<RemoteChannelRunResult> {
    const { channel, conversation, prompt, provider, remoteSession, sender } = input
    const runtimeId = remoteChannelRuntimeId(settings, channel, conversation)
    const sharedThread = input.sharedThread ?? this.shouldUseChannelThreadForIncoming(
      provider,
      input.chatType,
      channel,
      remoteSession
    )
    const initialThreadId = sharedThread
      ? remoteChannelThreadIdForRuntime(channel, undefined, runtimeId)
      : incomingThreadIdForRuntime(channel, conversation, runtimeId, Boolean(remoteSession))
    const run = () => this.runPrompt(settings, {
      prompt,
      title: channel ? `[Remote channel:${channel.label}] ${sender}` : `[Remote channel:${provider}] ${sender}`,
      workspaceRoot: this.resolveIncomingWorkspaceRoot(settings, channel, conversation, remoteSession),
      model: channel?.model ?? settings.remoteChannel.im.model,
      mode: settings.remoteChannel.im.mode,
      displayText: input.displayText,
      waitForResult: true,
      responseTimeoutMs: settings.remoteChannel.im.responseTimeoutMs,
      source: 'im',
      runtimeId,
      threadId: initialThreadId || undefined,
      channel,
      onTurnStarted: async ({ threadId, previousThreadId }) => {
        if (!channel) return
        const currentSettings = await this.deps.store.load()
        const currentChannel = currentSettings.remoteChannel.channels.find((item) => item.id === channel.id)
        if (!currentChannel) return
        const now = new Date().toISOString()
        if (remoteSession && sharedThread) {
          await this.deps.store.patch({
            remoteChannel: {
              channels: currentSettings.remoteChannel.channels.map((item) =>
                item.id === currentChannel.id
                  ? {
                      ...withRemoteChannelThreadMapping(item, runtimeId, threadId),
                      remoteSession: {
                        ...remoteSession,
                        updatedAt: now
                      },
                      updatedAt: now
                    }
                  : item
              )
            }
          })
        } else if (remoteSession) {
          const existingConversation =
            this.findChannelConversation(currentChannel, remoteSession) ??
            conversation ??
            this.findChannelConversation(channel, remoteSession)
          const nextConversation: RemoteChannelConversationV1 = existingConversation
            ? {
                ...withRemoteChannelThreadMapping(existingConversation, runtimeId, threadId),
                latestMessageId: remoteSession.messageId,
                senderId: remoteSession.senderId,
                senderName: remoteSession.senderName,
                workspaceRoot: this.resolveIncomingWorkspaceRoot(currentSettings, currentChannel, existingConversation, remoteSession),
                updatedAt: now
              }
            : withRemoteChannelThreadMapping({
                id: randomUUID(),
                chatId: remoteSession.chatId,
                remoteThreadId: remoteSession.threadId,
                latestMessageId: remoteSession.messageId,
                senderId: remoteSession.senderId,
                senderName: remoteSession.senderName,
                workspaceRoot: this.resolveConversationWorkspaceRoot(currentSettings, currentChannel),
                createdAt: now,
                updatedAt: now
              }, runtimeId, threadId)
          await this.deps.store.patch({
            remoteChannel: {
              channels: currentSettings.remoteChannel.channels.map((item) =>
                item.id === currentChannel.id
                  ? {
                      ...withRemoteChannelThreadMapping(item, runtimeId, threadId),
                      conversations: existingConversation
                        ? item.conversations.map((entry) => entry.id === existingConversation.id ? nextConversation : entry)
                        : [...item.conversations, nextConversation],
                      updatedAt: now
                    }
                  : item
              )
            }
          })
        } else if (!initialThreadId) {
          await this.deps.store.patch({
            remoteChannel: {
              channels: currentSettings.remoteChannel.channels.map((item) =>
                item.id === currentChannel.id
                  ? { ...withRemoteChannelThreadMapping(item, runtimeId, threadId), updatedAt: now }
                  : item
              )
            }
          })
        }
        const replacedThreadId = previousThreadId?.trim() ||
          (initialThreadId && initialThreadId !== threadId ? initialThreadId : '')
        this.deps.notifyChannelActivity?.({
          channelId: channel.id,
          threadId,
          runtimeId,
          ...(replacedThreadId ? { previousThreadId: replacedThreadId } : {})
        })
      }
    })
    const result = await run()
    if (!result.ok) {
      await this.rememberIncomingImFailure({
        provider,
        channel,
        conversation,
        remoteSession,
        threadId: initialThreadId || undefined,
        runtimeId,
        failure: result
      })
    }
    return result
  }

  async handleIncomingImMessage(input: RemoteChannelIncomingImMessageInput): Promise<RemoteChannelIncomingImMessageResult> {
    const settings = await this.deps.store.load()
    if (!settings.remoteChannel.enabled || !settings.remoteChannel.im.enabled) {
      return { ok: false, message: 'Remote channel is disabled.' }
    }
    const incomingText = validateIncomingImText(settings, input.provider, input.text, {
      hasAttachmentHint: Boolean(input.runtimePrompt?.trim())
    })
    if (!incomingText.ok) return { ok: false, message: incomingText.message }
    const normalizedInput: RemoteChannelIncomingImMessageInput = input.remoteSession
      ? {
          ...input,
          text: incomingText.text,
          remoteSession: normalizeIncomingRemoteSession(input.provider, input.chatType, input.remoteSession)
        }
      : { ...input, text: incomingText.text }
    const text = incomingText.text
    const command = parseRemoteChannelCommand(text)
    const channel = normalizedInput.channelId
      ? settings.remoteChannel.channels.find(
          (item) => item.enabled && item.id === normalizedInput.channelId
        ) ?? settings.remoteChannel.channels.find(
          (item) => item.enabled && item.provider === normalizedInput.provider
        )
      : settings.remoteChannel.channels.find(
          (item) => item.enabled && item.provider === normalizedInput.provider
        )
    if (!this.shouldHandleIncomingByGuard({
      channel,
      provider: normalizedInput.provider,
      chatType: normalizedInput.chatType,
      mentionedBot: normalizedInput.mentionedBot,
      mentionAll: normalizedInput.mentionAll,
      isCommand: Boolean(command)
    })) {
      return { ok: true, ignored: true, message: imGuardIgnoredMessage(settings), reply: '' }
    }
    const remoteSession = normalizedInput.remoteSession
    if (!channel || !remoteSession) {
      return this.handleIncomingImMessageNow(normalizedInput)
    }
    const sharedThread = this.shouldUseChannelThreadForIncoming(
      normalizedInput.provider,
      normalizedInput.chatType,
      channel,
      remoteSession
    )
    const remoteThreadId = sharedThread ? '' : remoteSession.threadId
    if (!isThreadSelectorCommand(command)) {
      const remembered = await this.rememberRecentRemoteMessage({
        provider: normalizedInput.provider,
        channelId: channel.id,
        chatId: remoteSession.chatId,
        remoteThreadId,
        messageId: remoteSession.messageId,
        senderName: normalizedInput.sender,
        text
      })
      if (!remembered) {
        return { ok: true, ignored: true, message: 'Duplicate remote message ignored.', reply: '' }
      }
    }
    const queued = this.remoteMessageQueues.has(this.remoteQueueKey({
      provider: normalizedInput.provider,
      channelId: channel.id,
      chatId: remoteSession.chatId,
      remoteThreadId
    }))
    const result = await this.runInRemoteConversationQueue({
      provider: normalizedInput.provider,
      channelId: channel.id,
      chatId: remoteSession.chatId,
      remoteThreadId,
      task: () => this.handleIncomingImMessageNow(normalizedInput)
    })
    return queued ? withRemoteQueuedNotice(settings, result) : result
  }

  private async handleIncomingImMessageNow(input: RemoteChannelIncomingImMessageInput): Promise<RemoteChannelIncomingImMessageResult> {
    const settings = await this.deps.store.load()
    if (!settings.remoteChannel.enabled || !settings.remoteChannel.im.enabled) {
      return { ok: false, message: 'Remote channel is disabled.' }
    }
    const incomingText = validateIncomingImText(settings, input.provider, input.text, {
      hasAttachmentHint: Boolean(input.runtimePrompt?.trim())
    })
    if (!incomingText.ok) return { ok: false, message: incomingText.message }
    const text = incomingText.text
    const command = parseRemoteChannelCommand(text)
    const channel = input.channelId
      ? settings.remoteChannel.channels.find(
          (item) => item.enabled && item.id === input.channelId
        ) ?? settings.remoteChannel.channels.find(
          (item) => item.enabled && item.provider === input.provider
        )
      : settings.remoteChannel.channels.find(
          (item) => item.enabled && item.provider === input.provider
        )
    const remoteSession = input.remoteSession
    const sharedThread = this.shouldUseChannelThreadForIncoming(
      input.provider,
      input.chatType,
      channel,
      remoteSession
    )
    if (!this.shouldHandleIncomingByGuard({
      channel,
      provider: input.provider,
      chatType: input.chatType,
      mentionedBot: input.mentionedBot,
      mentionAll: input.mentionAll,
      isCommand: Boolean(command)
    })) {
      return { ok: true, ignored: true, message: imGuardIgnoredMessage(settings), reply: '' }
    }
    if (channel && remoteSession && !isThreadSelectorCommand(command)) {
      await this.rememberFeishuRemoteSession(settings, channel, remoteSession)
    }
    const conversation =
      channel && remoteSession && !sharedThread
        ? this.findChannelConversation(channel, {
            chatId: remoteSession.chatId,
            threadId: remoteSession.threadId
          })
        : undefined
    const firstRemoteConversation = Boolean(channel && remoteSession && !conversation && !sharedThread && !command)
    const commandReply = await this.handleIncomingImCommand(settings, {
      text,
      provider: input.provider,
      chatType: input.chatType,
      sender: input.sender,
      channel,
      conversation,
      remoteSession: remoteSession ?? undefined
    })
    if (commandReply !== null) {
      return { ok: true, reply: withFirstConnectHelp(settings, firstRemoteConversation, commandReply), message: commandReply }
    }
    const taskCreation = await this.deps.createScheduledTaskFromText?.(text, {
      workspaceRoot: this.resolveChannelWorkspaceRoot(settings, channel),
      modelHint: channel?.model ?? settings.remoteChannel.im.model,
      mode: settings.remoteChannel.im.mode
    }) ?? { kind: 'noop' as const }
    if (taskCreation.kind === 'created') {
      return {
        ok: true,
        createdTaskId: taskCreation.taskId,
        reply: withFirstConnectHelp(settings, firstRemoteConversation, taskCreation.confirmationText),
        message: taskCreation.confirmationText
      }
    }
    if (taskCreation.kind === 'error') {
      return { ok: false, message: taskCreation.message }
    }
    const result = await this.processIncomingImPrompt(settings, {
      prompt: input.runtimePrompt?.trim() || text,
      displayText: text,
      sender: input.sender.trim() || 'IM user',
      provider: input.provider,
      chatType: input.chatType,
      sharedThread,
      channel,
      conversation,
      remoteSession: remoteSession ?? undefined
    })
    if (!result.ok) return result
    const prepared = prepareRemoteChannelReplyText(
      input.provider,
      withFirstConnectHelp(settings, firstRemoteConversation, result.text ?? ''),
      {
        attachments: (result.files ?? []).map(remoteChannelAttachmentFromGeneratedFile)
      }
    )
    return {
      ...result,
      reply: prepared.textChunks.join('\n\n')
    }
  }

  private resolveFeishuChannels(settings: AppSettingsV1): FeishuRemoteChannel[] {
    if (!settings.remoteChannel.enabled) return []
    return settings.remoteChannel.channels.filter(
      (channel): channel is FeishuRemoteChannel =>
        channel.enabled &&
        channel.provider === 'feishu' &&
        hasFeishuPlatformCredential(channel)
    )
  }

  private buildFeishuRemoteSession(message: NormalizedMessage): RemoteChannelRemoteSessionV1 {
    return {
      chatId: message.chatId.trim(),
      messageId: message.messageId.trim(),
      threadId: remoteConversationThreadId('feishu', message.chatType, message.threadId),
      senderId: message.senderId.trim(),
      senderName: feishuSenderLabel(message),
      updatedAt: new Date().toISOString()
    }
  }

  private async rememberFeishuRemoteSession(
    settings: AppSettingsV1,
    channel: RemoteChannelV1,
    message:
      | NormalizedMessage
      | Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
  ): Promise<void> {
    const nextRemoteSession =
      'chatType' in message
        ? this.buildFeishuRemoteSession(message)
        : {
            ...message,
            updatedAt: new Date().toISOString()
          }
    const current = channel.remoteSession
    if (
      current?.chatId === nextRemoteSession.chatId &&
      current?.messageId === nextRemoteSession.messageId &&
      current?.threadId === nextRemoteSession.threadId &&
      current?.senderId === nextRemoteSession.senderId &&
      current?.senderName === nextRemoteSession.senderName
    ) {
      return
    }
    await this.deps.store.patch({
      remoteChannel: {
        channels: settings.remoteChannel.channels.map((item) =>
          item.id === channel.id
            ? {
                ...item,
                remoteSession: nextRemoteSession,
                updatedAt: nextRemoteSession.updatedAt
              }
            : item
        )
      }
    })
  }

  private async sendFeishuMessage(
    bridge: LarkChannel,
    to: string,
    input: SendInput,
    options: SendOptions,
    context: Record<string, unknown>
  ): Promise<SendResult> {
    try {
      return await bridge.send(to, input, options)
    } catch (error) {
      const initialMessage = errorMessage(error)
      if (!options.replyTo) {
        this.deps.logError('remote-channel-feishu', 'Failed to send Feishu / Lark message', {
          ...context,
          message: initialMessage,
          failureKind: 'provider_send_failed',
          to
        })
        throw remoteChannelFailureError(
          'provider_send_failed',
          providerSendFailureMessage('Feishu / Lark', initialMessage),
          { ...context, to }
        )
      }

      this.deps.logError('remote-channel-feishu', 'Failed to send Feishu / Lark reply; falling back to plain chat message.', {
        ...context,
        message: initialMessage,
        replyTo: options.replyTo,
        replyInThread: options.replyInThread,
        to
      })
      try {
        return await bridge.send(to, input, {
          ...options,
          replyTo: undefined,
          replyInThread: undefined
        })
      } catch (fallbackError) {
        const fallbackMessage = errorMessage(fallbackError)
        this.deps.logError('remote-channel-feishu', 'Failed to send Feishu / Lark fallback message', {
          ...context,
          initialMessage,
          message: fallbackMessage,
          failureKind: 'provider_send_failed',
          to
        })
        throw remoteChannelFailureError(
          'provider_send_failed',
          providerSendFailureMessage('Feishu / Lark', fallbackMessage),
          { ...context, initialMessage, to }
        )
      }
    }
  }

  private async sendFeishuMarkdownMessage(
    bridge: LarkChannel,
    to: string,
    markdown: string,
    options: SendOptions,
    context: Record<string, unknown>
  ): Promise<SendResult> {
    let result: SendResult | undefined
    const chunks = splitRemoteChannelReplyText('feishu', markdown)
    for (const [index, chunk] of chunks.entries()) {
      result = await this.sendFeishuMessage(
        bridge,
        to,
        { markdown: chunk },
        options,
        {
          ...context,
          chunkIndex: index,
          chunkCount: chunks.length
        }
      )
    }
    return result ?? { messageId: '' }
  }

  private async resolveFeishuGeneratedFiles(
    files: readonly RemoteChannelGeneratedFileV1[],
    workspaceRoot: string,
    context: Record<string, unknown>
  ): Promise<RemoteChannelGeneratedFileV1[]> {
    const root = workspaceRoot.trim()
    if (!root || files.length === 0) return []
    let realRoot = ''
    try {
      realRoot = await realpath(resolve(root))
    } catch (error) {
      this.deps.logError('remote-channel-feishu', 'Failed to resolve Feishu file workspace root', {
        ...context,
        workspaceRoot: root,
        message: errorMessage(error)
      })
      return []
    }

    const resolvedFiles: RemoteChannelGeneratedFileV1[] = []
    const seen = new Set<string>()
    for (const file of files) {
      try {
        const realFile = await realpath(resolve(file.path))
        const relativePath = relative(realRoot, realFile)
        if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
          this.deps.logError('remote-channel-feishu', 'Skipping generated file outside the Feishu workspace', {
            ...context,
            filePath: file.path,
            workspaceRoot: root
          })
          continue
        }
        if (seen.has(realFile)) continue
        const fileStat = await stat(realFile)
        if (!fileStat.isFile()) continue
        const maxBytes = getRemoteChannelProviderCapabilities('feishu').attachments.file.maxBytes
        if (fileStat.size > maxBytes) {
          this.deps.logError('remote-channel-feishu', 'Skipping generated file because it is too large for Feishu upload', {
            ...context,
            filePath: realFile,
            bytes: fileStat.size,
            maxBytes
          })
          continue
        }
        seen.add(realFile)
        resolvedFiles.push({
          ...file,
          path: realFile,
          fileName: sanitizeOutboundAttachmentFileName(file.fileName, basename(realFile))
        })
      } catch (error) {
        this.deps.logError('remote-channel-feishu', 'Skipping generated file that cannot be read for Feishu upload', {
          ...context,
          filePath: file.path,
          message: errorMessage(error)
        })
      }
    }
    return resolvedFiles
  }

  private async sendFeishuGeneratedFiles(
    bridge: LarkChannel,
    to: string,
    files: readonly RemoteChannelGeneratedFileV1[],
    options: SendOptions,
    context: Record<string, unknown>
  ): Promise<{ sent: RemoteChannelGeneratedFileV1[]; failed: Array<{ file: RemoteChannelGeneratedFileV1; message: string }> }> {
    const sent: RemoteChannelGeneratedFileV1[] = []
    const failed: Array<{ file: RemoteChannelGeneratedFileV1; message: string }> = []
    for (const file of files) {
      try {
        await this.sendFeishuMessage(
          bridge,
          to,
          { file: { source: file.path, fileName: file.fileName } },
          options,
          {
            ...context,
            purpose: 'agent-file',
            filePath: file.path,
            fileName: file.fileName
          }
        )
        sent.push(file)
      } catch (error) {
        const message = errorMessage(error)
        failed.push({ file, message })
        this.deps.logError('remote-channel-feishu', 'Failed to send Feishu / Lark file attachment', {
          ...context,
          filePath: file.path,
          fileName: file.fileName,
          message
        })
      }
    }
    return { sent, failed }
  }

  private async recentGeneratedFilesForThread(
    settings: AppSettingsV1,
    threadId: string,
    workspaceRoot: string,
    context: Record<string, unknown>,
    runtimeId: AgentRuntimeId = 'codex'
  ): Promise<RemoteChannelGeneratedFileV1[]> {
    const targetThreadId = threadId.trim()
    if (!targetThreadId) return []
    try {
      const agentRuntime = this.deps.agentRuntime
      const detail = await agentRuntime.readThread({ runtimeId, threadId: targetThreadId }) as ThreadDetailJson
      return latestGeneratedFiles(detail, {
        workspaceRoot,
        maxFiles: 3
      })
    } catch (error) {
      this.deps.logError('remote-channel-feishu', 'Failed to inspect runtime thread for recent generated files', {
        ...context,
        threadId: targetThreadId,
        message: errorMessage(error)
      })
      return []
    }
  }

  private findImChannelForThread(
    settings: AppSettingsV1,
    threadId: string
  ): { channel: RemoteChannelV1; conversation?: RemoteChannelConversationV1 } | null {
    const targetThreadId = threadId.trim()
    if (!targetThreadId) return null
    for (const channel of settings.remoteChannel.channels) {
      if (!channel.enabled) continue
      const conversation =
        [...channel.conversations]
          .filter((item) =>
            Object.values(item.agentThreadIds ?? {}).some((id) => id.trim() === targetThreadId)
          )
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
      if (conversation) return { channel, conversation }
      if (Object.values(channel.agentThreadIds ?? {}).some((id) => id.trim() === targetThreadId)) return { channel }
    }
    return null
  }

  private async mirrorThreadMessageToWeixin(
    channel: RemoteChannelV1,
    conversation: RemoteChannelConversationV1 | undefined,
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const credential = channel.platformCredential
    if (credential?.kind !== 'weixin' || !credential.accountId.trim()) {
      return { ok: false, message: 'No target WeChat account is available yet.' }
    }
    const to = conversation?.chatId.trim() || channel.remoteSession?.chatId.trim() || ''
    if (!to) return { ok: false, message: 'No target WeChat conversation is available yet.' }
    if (!this.deps.sendWeixinBridgeMessage) {
      return { ok: false, message: 'Built-in WeChat bridge is not initialized.' }
    }
    for (const [index, chunk] of splitRemoteChannelReplyText('weixin', text).entries()) {
      const result = await runRemoteChannelProviderRetry(
        'weixin',
        () => this.deps.sendWeixinBridgeMessage!({
          accountId: credential.accountId,
          to,
          text: chunk
        }),
        { shouldRetryResult: (item) => !item.ok }
      )
      if (!result.ok) {
        const failure = remoteChannelFailureResult({
          message: providerSendFailureMessage('WeChat', result.message),
          kind: 'provider_send_failed',
          details: { threadId, direction, channelId: channel.id, to, chunkIndex: index }
        })
        this.deps.logError('remote-channel-weixin', 'Failed to mirror remote channel message to WeChat', {
          message: failure.message,
          failureKind: failure.failureKind,
          threadId,
          direction,
          channelId: channel.id,
          to,
          chunkIndex: index
        })
        return failure
      }
    }
    return { ok: true }
  }

  private async mirrorThreadMessageToDiscord(
    channel: RemoteChannelV1,
    conversation: RemoteChannelConversationV1 | undefined,
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.deps.sendDiscordChannelMessage) {
      return { ok: false, message: 'Discord bot runtime is not initialized.' }
    }
    const to =
      conversation?.chatId.trim() ||
      channel.remoteSession?.chatId.trim() ||
      (channel.platformCredential?.kind === 'discord' ? channel.platformCredential.channelId.trim() : '')
    if (!to) return { ok: false, message: 'No target Discord channel is available yet.' }
    const prefix = direction === 'user' ? '**From SciForge**\n\n' : ''
    for (const [index, chunk] of splitRemoteChannelReplyText('discord', `${prefix}${text}`.trim()).entries()) {
      const result = await runRemoteChannelProviderRetry(
        'discord',
        () => this.deps.sendDiscordChannelMessage!({
          channelId: to,
          text: chunk
        }),
        { shouldRetryResult: (item) => !item.ok }
      )
      if (!result.ok) {
        const failure = remoteChannelFailureResult({
          message: providerSendFailureMessage('Discord', result.message),
          kind: 'provider_send_failed',
          details: { threadId, direction, channelId: channel.id, to, chunkIndex: index }
        })
        this.deps.logError('remote-channel-discord', 'Failed to mirror remote channel message to Discord', {
          message: failure.message,
          failureKind: failure.failureKind,
          threadId,
          direction,
          channelId: channel.id,
          to,
          chunkIndex: index
        })
        return failure
      }
    }
    return { ok: true }
  }

  private async mirrorThreadMessageToZulip(
    channel: RemoteChannelV1,
    conversation: RemoteChannelConversationV1 | undefined,
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.deps.sendZulipChannelMessage) {
      return { ok: false, message: 'Zulip bot runtime is not initialized.' }
    }
    const credential = channel.platformCredential?.kind === 'zulip'
      ? channel.platformCredential
      : undefined
    const to =
      conversation?.chatId.trim() ||
      channel.remoteSession?.chatId.trim() ||
      credential?.streamId.trim() ||
      ''
    if (!to) return { ok: false, message: 'No target Zulip stream is available yet.' }
    const topicName =
      conversation?.remoteThreadId.trim() ||
      channel.remoteSession?.threadId.trim() ||
      credential?.topicName.trim() ||
      ''
    const prefix = direction === 'user' ? '**From SciForge**\n\n' : ''
    for (const [index, chunk] of splitRemoteChannelReplyText('zulip', `${prefix}${text}`.trim()).entries()) {
      const result = await runRemoteChannelProviderRetry(
        'zulip',
        () => this.deps.sendZulipChannelMessage!({
          channelId: to,
          topicName,
          text: chunk
        }),
        { shouldRetryResult: (item) => !item.ok }
      )
      if (!result.ok) {
        const failure = remoteChannelFailureResult({
          message: providerSendFailureMessage('Zulip', result.message),
          kind: 'provider_send_failed',
          details: { threadId, direction, channelId: channel.id, to, topicName, chunkIndex: index }
        })
        this.deps.logError('remote-channel-zulip', 'Failed to mirror remote channel message to Zulip', {
          message: failure.message,
          failureKind: failure.failureKind,
          threadId,
          direction,
          channelId: channel.id,
          to,
          topicName,
          chunkIndex: index
        })
        return failure
      }
    }
    return { ok: true }
  }

  async mirrorThreadMessageToIm(
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, message: 'Message is empty.' }
    const settings = await this.deps.store.load()
    const target = this.findImChannelForThread(settings, threadId)
    if (!target) return { ok: false, message: 'Channel not found.' }
    if (target.channel.provider === 'weixin') {
      return this.mirrorThreadMessageToWeixin(
        target.channel,
        target.conversation,
        threadId,
        trimmed,
        direction
      )
    }
    if (target.channel.provider === 'discord') {
      return this.mirrorThreadMessageToDiscord(
        target.channel,
        target.conversation,
        threadId,
        trimmed,
        direction
      )
    }
    if (target.channel.provider === 'zulip') {
      return this.mirrorThreadMessageToZulip(
        target.channel,
        target.conversation,
        threadId,
        trimmed,
        direction
      )
    }
    if (target.channel.provider !== 'feishu') return { ok: false, message: 'Unsupported IM provider.' }
    const channel = target.channel
    const conversation =
      target.conversation ??
      [...channel.conversations]
        .filter((item) =>
          Object.values(item.agentThreadIds ?? {}).some((id) => id.trim() === threadId.trim())
        )
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
    if (!conversation?.chatId.trim()) {
      return { ok: false, message: 'No target Feishu / Lark conversation is available yet.' }
    }
    const bridge = this.feishuChannels.get(channel.id)
    if (!bridge) {
      return { ok: false, message: 'Feishu / Lark bridge is not connected.' }
    }
    try {
      await this.sendFeishuMarkdownMessage(
        bridge,
        conversation.chatId,
        formatFeishuMirrorText(trimmed, direction).markdown,
        {},
        {
          purpose: 'mirror',
          threadId,
          direction,
          channelId: channel.id,
          chatId: conversation.chatId
        }
      )
      return { ok: true }
    } catch (error) {
      const failure = remoteChannelFailureFromError(
        error,
        providerSendFailureMessage('Feishu / Lark', errorMessage(error))
      )
      this.deps.logError('remote-channel-feishu', 'Failed to mirror remote channel message to Feishu / Lark', {
        message: failure.message,
        failureKind: failure.failureKind,
        threadId,
        direction
      })
      return failure
    }
  }

  private async handleFeishuMessage(channelId: string, message: NormalizedMessage): Promise<void> {
    const bridge = this.feishuChannels.get(channelId)
    const settings = await this.deps.store.load()
    const channel = settings.remoteChannel.channels.find((item) => item.id === channelId && item.enabled)
    if (!bridge || !channel) return
    if (bridge.botIdentity?.openId && message.senderId === bridge.botIdentity.openId) return
    const inboundCommand = parseRemoteChannelCommand(message.content)
    if (!this.shouldHandleIncomingByGuard({
      channel,
      provider: 'feishu',
      chatType: message.chatType,
      mentionedBot: message.mentionedBot,
      mentionAll: message.mentionAll,
      isCommand: Boolean(inboundCommand)
    })) return
    if (!isThreadSelectorCommand(inboundCommand)) {
      await this.rememberFeishuRemoteSession(settings, channel, message)
    }
    const remoteSession = this.buildFeishuRemoteSession(message)
    const sharedThread = this.shouldUseChannelThreadForIncoming('feishu', message.chatType, channel, remoteSession)
    const conversation = sharedThread
      ? undefined
      : this.findChannelConversation(channel, {
          chatId: remoteSession.chatId,
          threadId: remoteSession.threadId
        })
    const sender = feishuSenderLabel(message)
    const isFirstRemoteConversation = !sharedThread && !conversation
    const workspaceRoot = this.resolveIncomingWorkspaceRoot(settings, channel, conversation, remoteSession)
    const replyOptions = { replyTo: message.messageId, replyInThread: shouldReplyInFeishuThread(message) }

    if (isFirstRemoteConversation && !inboundCommand) {
      await this.sendFeishuMarkdownMessage(
        bridge,
        message.chatId,
        imFirstConnectHelpText(settings),
        replyOptions,
        {
          purpose: 'first-connect-help',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId
        }
      ).catch((error) => {
        this.deps.logError('remote-channel-feishu', 'Failed to send first-connect help reply', {
          message: errorMessage(error),
          chatId: message.chatId,
          inboundMessageId: message.messageId
        })
      })
    }

    const commandReply = await this.handleIncomingImCommand(settings, {
      text: message.content,
      provider: 'feishu',
      chatType: message.chatType,
      sender,
      channel,
      conversation,
      remoteSession
    })
    if (commandReply !== null) {
      await this.sendFeishuMarkdownMessage(
        bridge,
        message.chatId,
        commandReply,
        replyOptions,
        {
          purpose: 'im-command',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId
        }
      )
      return
    }

    const taskCreation = await this.deps.createScheduledTaskFromText?.(message.content, {
      workspaceRoot: this.resolveChannelWorkspaceRoot(settings, channel),
      modelHint: channel.model,
      mode: settings.remoteChannel.im.mode
    }) ?? { kind: 'noop' as const }
    if (taskCreation.kind === 'created') {
      await this.sendFeishuMarkdownMessage(
        bridge,
        message.chatId,
        taskCreation.confirmationText,
        { replyTo: message.messageId, replyInThread: shouldReplyInFeishuThread(message) },
        {
          purpose: 'schedule-created',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId
        }
      )
      return
    }
    if (taskCreation.kind === 'error') {
      this.deps.logError('remote-channel-feishu', 'Failed to create scheduled task from Feishu / Lark message', redactSecrets({
        message: taskCreation.message,
        channelId,
        chatId: message.chatId,
        inboundMessageId: message.messageId
      }))
      await this.sendFeishuMarkdownMessage(
        bridge,
        message.chatId,
        isChineseLocale(settings)
          ? '创建计划任务失败，请稍后重试。'
          : 'Failed to create the scheduled task right now.',
        { replyTo: message.messageId, replyInThread: shouldReplyInFeishuThread(message) },
        {
          purpose: 'schedule-error',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId
        }
      )
      return
    }
    if (!message.content.trim() && message.rawContentType !== 'text') {
      try {
        await this.sendFeishuMarkdownMessage(
          bridge,
          message.chatId,
          'Only text messages are supported right now.',
          { replyTo: message.messageId, replyInThread: shouldReplyInFeishuThread(message) },
          {
            purpose: 'unsupported-message',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId
          }
        )
      } catch (error) {
        this.deps.logError('remote-channel-feishu', 'Failed to send unsupported-message reply', {
          message: errorMessage(error),
          chatId: message.chatId
        })
      }
      return
    }

    if (shouldDirectSendExistingGeneratedFilesForPrompt(message.content)) {
      const runtimeId = remoteChannelRuntimeId(settings, channel, conversation)
      const existingThreadId = sharedThread
        ? remoteChannelThreadIdForRuntime(channel, undefined, runtimeId)
        : incomingThreadIdForRuntime(channel, conversation, runtimeId, true)
      const existingWorkspaceRoot = workspaceRoot
      const existingFiles = await this.resolveFeishuGeneratedFiles(
        await this.recentGeneratedFilesForThread(settings, existingThreadId, existingWorkspaceRoot, {
          purpose: 'direct-existing-file-lookup',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          threadId: existingThreadId
        }, runtimeId),
        existingWorkspaceRoot,
        {
          purpose: 'direct-existing-file-resolve',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          threadId: existingThreadId
        }
      )
      if (existingFiles.length > 0) {
        try {
          await this.sendFeishuMarkdownMessage(
            bridge,
            message.chatId,
            replyTextForGeneratedFiles('', existingFiles),
            replyOptions,
            {
              purpose: 'direct-existing-file-reply',
              channelId,
              chatId: message.chatId,
              inboundMessageId: message.messageId,
              threadId: existingThreadId
            }
          )
        } catch (error) {
          this.deps.logError('remote-channel-feishu', 'Failed to send direct file confirmation reply', {
            message: errorMessage(error),
            chatId: message.chatId,
            threadId: existingThreadId
          })
        }
        const delivery = await this.sendFeishuGeneratedFiles(
          bridge,
          message.chatId,
          existingFiles,
          replyOptions,
          {
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId,
            threadId: existingThreadId
          }
        )
        if (delivery.sent.length > 0) return
        const failure = delivery.failed[0]?.message || 'unknown upload error'
        await this.sendFeishuMarkdownMessage(
          bridge,
          message.chatId,
          buildRemoteChannelAttachmentFallbackText(
            'feishu',
            existingFiles.map(remoteChannelAttachmentFromGeneratedFile),
            { reason: failure }
          ),
          replyOptions,
          {
            purpose: 'direct-existing-file-failed',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId,
            threadId: existingThreadId
          }
        ).catch((error) => {
          this.deps.logError('remote-channel-feishu', 'Failed to send direct file failure reply', {
            message: errorMessage(error),
            chatId: message.chatId,
            threadId: existingThreadId
          })
        })
        return
      }
    }

    // Add a "in progress" emoji reaction on the user's inbound message
    // immediately so they see feedback before the agent run completes
    // (which can take seconds). The reaction is targeted at the user's
    // message id (not a new bot message) and is left in place after the
    // agent finishes as a "handled" marker.
    //
    // Emoji type selection: Feishu / Lark's `im.v1.messageReaction.create`
    // endpoint accepts a closed set of `emoji_type` strings; the SDK does
    // NOT validate them locally — invalid values are rejected by the API
    // with `code 231001 "reaction type is invalid"`. Empirically verified:
    //   - `'WORK'`  → REJECTED (production logs, code 231001) — never use
    //   - `'OnIt'`  → CONFIRMED VALID — renders as 🫡 (salute face,
    //                 internet-canonical "got it, doing it" signal;
    //                 best match for the user-requested "在做了")
    //   - `'SMILE'` → CONFIRMED VALID — fallback, renders as 🙂
    //
    // Failure is logged but NOT re-thrown — we never want a reaction
    // failure to drop the user's message or abort the agent run.
    try {
      await bridge.addReaction(message.messageId, 'OnIt')
    } catch (error) {
      this.deps.logError('remote-channel-feishu', 'Failed to add Feishu / Lark pending reaction; continuing with the agent run.', {
        message: errorMessage(error),
        chatId: message.chatId,
        messageId: message.messageId
      })
    }

    let result: RemoteChannelRunResult
    try {
      result = await this.processIncomingImPrompt(settings, {
          prompt: buildFeishuPrompt(message),
          sender,
          provider: 'feishu',
          chatType: message.chatType,
          sharedThread,
          channel,
          conversation,
          remoteSession
      })
    } catch (error) {
      this.deps.logError('remote-channel-feishu', 'Failed to handle Feishu inbound message', {
        message: errorMessage(error),
        chatId: message.chatId,
        senderId: message.senderId
      })
      try {
        await this.sendFeishuMarkdownMessage(
          bridge,
          message.chatId,
          'Sorry, I could not process your message right now.',
        { replyTo: message.messageId, replyInThread: shouldReplyInFeishuThread(message) },
          {
            purpose: 'processing-error',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId
          }
        )
      } catch {
        /* ignore secondary reply failures */
      }
      return
    }

    const filesToSend = result.ok
      ? await this.resolveFeishuGeneratedFiles(result.files ?? [], workspaceRoot, {
          purpose: 'agent-file-resolve',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          threadId: result.threadId,
          turnId: result.turnId
        })
      : []
    const replyText = result.ok
      ? replyTextForGeneratedFiles(result.text?.trim() || result.message?.trim() || 'Completed.', filesToSend)
      : safeImFailureText(settings, result)
    const resultThreadId = result.ok ? result.threadId : undefined
    const resultTurnId = result.ok ? result.turnId : undefined
    if (!result.ok) {
      this.logRemoteFailure('remote-channel-feishu', 'Feishu / Lark agent run failed before reply.', result, {
        channelId,
        chatId: message.chatId,
        inboundMessageId: message.messageId,
        senderId: message.senderId
      })
    }
    try {
      await this.sendFeishuMarkdownMessage(
        bridge,
        message.chatId,
        replyText,
        replyOptions,
        {
          purpose: 'agent-reply',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          runtimeOk: result.ok,
          threadId: resultThreadId,
          turnId: resultTurnId
        }
      )
    } catch (error) {
      const failure = remoteChannelFailureFromError(
        error,
        providerSendFailureMessage('Feishu / Lark', errorMessage(error))
      )
      this.deps.logError('remote-channel-feishu', 'Failed to send Feishu / Lark agent reply', {
        message: failure.message,
        failureKind: failure.failureKind,
        chatId: message.chatId,
        senderId: message.senderId,
        threadId: resultThreadId,
        turnId: resultTurnId
      })
    }
    if (filesToSend.length > 0) {
      const delivery = await this.sendFeishuGeneratedFiles(
        bridge,
        message.chatId,
        filesToSend,
        replyOptions,
        {
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          threadId: resultThreadId,
          turnId: resultTurnId
        }
      )
      if (delivery.sent.length === 0 && delivery.failed.length > 0) {
        await this.sendFeishuMarkdownMessage(
          bridge,
          message.chatId,
          buildRemoteChannelAttachmentFallbackText(
            'feishu',
            filesToSend.map(remoteChannelAttachmentFromGeneratedFile),
            { reason: delivery.failed[0]?.message || 'unknown upload error' }
          ),
          replyOptions,
          {
            purpose: 'agent-file-failed',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId,
            threadId: resultThreadId,
            turnId: resultTurnId
          }
        ).catch((error) => {
          this.deps.logError('remote-channel-feishu', 'Failed to send Feishu / Lark file failure reply', {
            message: errorMessage(error),
            chatId: message.chatId,
            senderId: message.senderId,
            threadId: resultThreadId,
            turnId: resultTurnId
          })
        })
      }
    }
  }

  private pruneRecentRemoteMessageIds(now = Date.now()): void {
    for (const [key, seenAt] of this.recentRemoteMessageIds) {
      if (now - seenAt > RECENT_REMOTE_MESSAGE_TTL_MS) {
        this.recentRemoteMessageIds.delete(key)
      }
    }
    while (this.recentRemoteMessageIds.size > MAX_RECENT_REMOTE_MESSAGE_IDS) {
      const oldest = this.recentRemoteMessageIds.keys().next().value
      if (!oldest) break
      this.recentRemoteMessageIds.delete(oldest)
    }
  }

  private recentRemoteMessageStillFresh(message: RemoteChannelRecentMessageV1, now = Date.now()): boolean {
    const seenAt = Date.parse(message.receivedAt)
    return Number.isFinite(seenAt) && now - seenAt <= RECENT_REMOTE_MESSAGE_TTL_MS
  }

  private compactRecentRemoteMessages(
    messages: readonly RemoteChannelRecentMessageV1[],
    now = Date.now()
  ): RemoteChannelRecentMessageV1[] {
    const fresh = messages.filter((message) => this.recentRemoteMessageStillFresh(message, now))
    return fresh.slice(-MAX_RECENT_REMOTE_MESSAGE_IDS)
  }

  private async rememberRecentRemoteMessage(
    input: {
      provider: RemoteChannelProvider
      channelId: string
      chatId: string
      remoteThreadId: string
      messageId: string
      senderName?: string
      text?: string
      sourceTimestampMs?: number
    }
  ): Promise<boolean> {
    const messageId = input.messageId.trim()
    const channelId = input.channelId.trim()
    const chatId = input.chatId.trim()
    if (!messageId || !channelId || !chatId) return true
    const now = Date.now()
    this.pruneRecentRemoteMessageIds(now)
    const key = remoteMessageDedupeKey({ ...input, messageId, channelId, chatId })
    if (this.recentRemoteMessageIds.has(key)) return false
    this.recentRemoteMessageIds.set(key, now)

    const write = this.recentRemoteMessageWriteQueue
      .catch(() => undefined)
      .then(async () => {
        const currentSettings = await this.deps.store.load()
        const currentChannel = currentSettings.remoteChannel.channels.find((channel) => channel.id === channelId)
        const currentRecentMessages = this.compactRecentRemoteMessages(currentChannel?.recentMessages ?? [], now)
        if (currentRecentMessages.some((message) => remoteMessageDedupeKey(message) === key)) {
          return false
        }

        const receivedAtMs = Number.isFinite(input.sourceTimestampMs)
          ? input.sourceTimestampMs as number
          : now
        const receivedAt = new Date(receivedAtMs).toISOString()
        const messageText = compactRecentRemoteMessageText(input.text)
        const nextMessage: RemoteChannelRecentMessageV1 = {
          provider: input.provider,
          channelId,
          chatId,
          remoteThreadId: input.remoteThreadId.trim(),
          messageId,
          ...(input.senderName?.trim() ? { senderName: input.senderName.trim().slice(0, 512) } : {}),
          ...(messageText ? { text: messageText } : {}),
          receivedAt
        }
        await this.deps.store.patch({
          remoteChannel: {
            channels: currentSettings.remoteChannel.channels.map((channel) =>
              channel.id === channelId
                ? {
                    ...channel,
                    recentMessages: this.compactRecentRemoteMessages([
                      ...currentRecentMessages,
                      nextMessage
                    ], now),
                    updatedAt: new Date(now).toISOString()
                  }
                : channel
            )
          }
        })
        return true
      })
    this.recentRemoteMessageWriteQueue = write.then(() => undefined, () => undefined)
    return write
  }

  private remoteQueueKey(input: {
    provider: RemoteChannelProvider
    channelId: string
    chatId: string
    remoteThreadId: string
  }): string {
    return remoteConversationQueueKey(input)
  }

  private runInRemoteConversationQueue<T>(input: {
    provider: RemoteChannelProvider
    channelId: string
    chatId: string
    remoteThreadId: string
    task: () => Promise<T>
  }): Promise<T> {
    const queueKey = this.remoteQueueKey(input)
    const previous = this.remoteMessageQueues.get(queueKey) ?? Promise.resolve()
    const queued = previous
      .catch(() => undefined)
      .then(input.task)
    this.remoteMessageQueues.set(queueKey, queued)
    void queued
      .finally(() => {
        if (this.remoteMessageQueues.get(queueKey) === queued) {
          this.remoteMessageQueues.delete(queueKey)
        }
      })
      .catch(() => undefined)
    return queued
  }

  private enqueueRemoteConversationMessage(input: {
    provider: RemoteChannelProvider
    channelId: string
    chatId: string
    remoteThreadId: string
    task: () => Promise<void>
    onQueued?: () => Promise<void> | void
    logCategory: string
    logContext: Record<string, unknown>
  }): void {
    const queueKey = this.remoteQueueKey(input)
    const previous = this.remoteMessageQueues.get(queueKey) ?? Promise.resolve()
    if (this.remoteMessageQueues.has(queueKey)) {
      void Promise.resolve(input.onQueued?.()).catch((error) => {
        this.deps.logError(input.logCategory, 'Failed to send queued acknowledgement.', {
          ...input.logContext,
          message: errorMessage(error)
        })
      })
    }
    const queued = previous
      .catch(() => undefined)
      .then(input.task)
      .catch((error) => {
        this.deps.logError(input.logCategory, 'Failed to process queued remote inbound message', {
          ...input.logContext,
          message: errorMessage(error)
        })
      })
      .finally(() => {
        if (this.remoteMessageQueues.get(queueKey) === queued) {
          this.remoteMessageQueues.delete(queueKey)
        }
      })
    this.remoteMessageQueues.set(queueKey, queued)
  }

  private async sendFeishuQueuedMessage(
    bridge: LarkChannel,
    channelId: string,
    message: NormalizedMessage
  ): Promise<void> {
    await this.sendFeishuMarkdownMessage(
      bridge,
      message.chatId,
      '已收到，前一条消息还在处理中，这条已排队。',
      { replyTo: message.messageId, replyInThread: shouldReplyInFeishuThread(message) },
      {
        purpose: 'queued-ack',
        channelId,
        chatId: message.chatId,
        inboundMessageId: message.messageId
      }
    )
  }

  private async enqueueFeishuMessage(channelId: string, message: NormalizedMessage): Promise<void> {
    const settings = await this.deps.store.load()
    const channel = settings.remoteChannel.channels.find((item) => item.id === channelId && item.enabled)
    const bridge = this.feishuChannels.get(channelId)
    if (bridge?.botIdentity?.openId && message.senderId === bridge.botIdentity.openId) return
    const inboundCommand = parseRemoteChannelCommand(message.content)
    if (channel && !this.shouldHandleIncomingByGuard({
      channel,
      provider: 'feishu',
      chatType: message.chatType,
      mentionedBot: message.mentionedBot,
      mentionAll: message.mentionAll,
      isCommand: Boolean(inboundCommand)
    })) return
    const remoteThreadId = remoteConversationThreadId('feishu', message.chatType, message.threadId)
    if (!isThreadSelectorCommand(inboundCommand)) {
      const remembered = await this.rememberRecentRemoteMessage({
        provider: 'feishu',
        channelId,
        chatId: message.chatId,
        remoteThreadId,
        messageId: message.messageId,
        senderName: feishuSenderLabel(message),
        text: message.content,
        sourceTimestampMs: message.createTime
      })
      if (!remembered) return
    }
    this.enqueueRemoteConversationMessage({
      provider: 'feishu',
      channelId,
      chatId: message.chatId,
      remoteThreadId,
      task: () => this.handleFeishuMessage(channelId, message),
      onQueued: bridge ? () => this.sendFeishuQueuedMessage(bridge, channelId, message) : undefined,
      logCategory: 'remote-channel-feishu',
      logContext: {
        channelId,
        chatId: message.chatId,
        inboundMessageId: message.messageId
      }
    })
  }

  private async syncFeishuChannels(settings: AppSettingsV1): Promise<void> {
    const version = ++this.feishuSyncVersion
    const targets = this.resolveFeishuChannels(settings)
    const targetMap = new Map(targets.map((channel) => [channel.id, channel]))

    await Promise.all(
      [...this.feishuChannels.keys()]
        .filter((channelId) => !targetMap.has(channelId))
        .map((channelId) => this.closeFeishuChannel(channelId))
    )
    if (version !== this.feishuSyncVersion) return

    for (const target of targets) {
      const appId = target.platformCredential!.appId.trim()
      const appSecret = target.platformCredential!.appSecret.trim()
      const domain = target.platformCredential!.domain.trim().toLowerCase() === 'lark' ? 'lark' : 'feishu'
      const allowedFileDirs = [
        this.resolveChannelWorkspaceRoot(settings, target),
        settings.remoteChannel.im.workspaceRoot,
        settings.workspaceRoot
      ]
        .map((entry) => entry.trim())
        .filter((entry, index, entries) => entry && entries.indexOf(entry) === index)
      const nextKey = `${target.id}|${appId}|${appSecret}|${domain}|${channelGuardMode(target)}|${allowedFileDirs.join('|')}`
      const currentKey = this.feishuChannelKeys.get(target.id)
      if (this.feishuChannels.has(target.id) && currentKey === nextKey) continue
      if (this.feishuChannels.has(target.id)) {
        await this.closeFeishuChannel(target.id)
        if (version !== this.feishuSyncVersion) return
      }

      try {
        const bridge = createLarkChannel({
          appId,
          appSecret,
          domain: domain === 'lark' ? Domain.Lark : Domain.Feishu,
          loggerLevel: LoggerLevel.warn,
          source: 'sciforge',
          transport: 'websocket',
          policy: {
            dmMode: 'open',
            requireMention: false,
            respondToMentionAll: true
          },
          ...(allowedFileDirs.length > 0
            ? { outbound: { allowedFileDirs } }
            : {})
        })
        bridge.on('message', (message) => {
          void this.enqueueFeishuMessage(target.id, message).catch((error) => {
            this.deps.logError('remote-channel-feishu', 'Failed to enqueue Feishu inbound message', {
              message: errorMessage(error),
              channelId: target.id,
              chatId: message.chatId,
              inboundMessageId: message.messageId
            })
          })
        })
        bridge.on('error', (error) => {
          this.deps.logError('remote-channel-feishu', 'Feishu channel error', {
            message: error.message,
            code: error.code,
            channelId: target.id
          })
        })
        bridge.on('reject', (event) => {
          this.deps.logError('remote-channel-feishu', 'Feishu message rejected by channel policy', {
            ...event,
            channelId: target.id
          })
        })
        bridge.on('reconnecting', () => {
          this.deps.logError('remote-channel-feishu', 'Feishu channel reconnecting', {
            channelId: target.id
          })
        })
        bridge.on('reconnected', () => {
          this.deps.logError('remote-channel-feishu', 'Feishu channel reconnected', {
            channelId: target.id
          })
        })
        // The Feishu / Lark App admin subscribes to `im.message.message_read_v1`
        // in the developer console. The high-level `bridge.on(...)` API has no
        // entry for read receipts in its `EventMap`, and the SDK's internal
        // `EventDispatcher` does not pre-register a handler either — so the
        // dispatcher emits a `no im.message.message_read_v1 handle` warn on
        // every receipt. Register an intentional no-op while read receipts
        // remain outside the product behavior boundary.
        const dispatcher = (bridge as unknown as {
          dispatcher?: {
            register(handles: Record<string, (raw: unknown) => Promise<void> | void>): void
          }
        }).dispatcher
        dispatcher?.register({
          'im.message.message_read_v1': () => undefined
        })
        await bridge.connect()
        if (version !== this.feishuSyncVersion) {
          await bridge.disconnect().catch(() => undefined)
          return
        }
        this.feishuChannels.set(target.id, bridge)
        this.feishuChannelKeys.set(target.id, nextKey)
      } catch (error) {
        this.deps.logError('remote-channel-feishu', 'Failed to start Feishu channel bridge', {
          message: error instanceof Error ? error.message : String(error),
          channelId: target.id
        })
      }
    }
  }

  private async closeFeishuChannel(channelId: string): Promise<void> {
    const bridge = this.feishuChannels.get(channelId)
    if (!bridge) return
    this.feishuChannels.delete(channelId)
    this.feishuChannelKeys.delete(channelId)
    await bridge.disconnect().catch((error) => {
      this.deps.logError('remote-channel-feishu', 'Failed to stop Feishu channel bridge', {
        message: error instanceof Error ? error.message : String(error),
        channelId
      })
    })
  }

  private async closeAllFeishuChannels(): Promise<void> {
    const ids = [...this.feishuChannels.keys()]
    await Promise.all(ids.map((channelId) => this.closeFeishuChannel(channelId)))
  }

  private syncWebhook(settings: AppSettingsV1): void {
    const im = settings.remoteChannel.im
    const key = `${im.port}|${im.path}`
    if (this.server && this.serverKey === key) return
    this.closeWebhook()

    const server = createServer((req, res) => {
      void this.handleWebhook(req, res)
    })
    server.on('error', (error) => {
      this.deps.logError('remote-channel-webhook', 'Remote channel webhook server failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      if (this.server === server) {
        this.closeWebhook()
      }
    })
    server.listen(im.port, '127.0.0.1')
    this.server = server
    this.serverKey = key
  }

  private closeWebhook(): void {
    if (!this.server) return
    const server = this.server
    this.server = null
    this.serverKey = ''
    server.close()
  }

  private async handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const settings = await this.deps.store.load()
      const im = settings.remoteChannel.im
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method !== 'POST' || url.pathname !== im.path) {
        writeJson(res, 404, { ok: false, message: 'Not found.' })
        return
      }
      if (!settings.remoteChannel.enabled || !im.enabled) {
        writeJson(res, 503, { ok: false, message: 'Remote channel webhook is disabled.' })
        return
      }
      if (im.secret) {
        const auth = req.headers.authorization ?? ''
        const secretHeader = req.headers[APP_WEBHOOK_SECRET_HEADER]
        const headerSecret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader
        if (auth !== `Bearer ${im.secret}` && headerSecret !== im.secret) {
          writeJson(res, 401, { ok: false, message: 'Unauthorized.' })
          return
        }
      }

      const body = await readRequestBody(req)
      const payload = parseJsonObject(body)
      if (!payload) {
        writeJson(res, 400, { ok: false, message: 'Expected a JSON object.' })
        return
      }
      const provider = extractIncomingProvider(payload, im.provider)
      const prompt = extractIncomingPrompt(payload)
      const incomingText = validateIncomingImText(settings, provider, prompt, {
        hasAttachmentHint: payloadHasAttachmentHint(payload)
      })
      if (!incomingText.ok) {
        writeJson(res, 400, { ok: false, message: incomingText.message })
        return
      }
      const sender = extractSenderLabel(payload)
      const incomingChannelId = extractIncomingChannelId(payload)
      const remoteSession = extractIncomingRemoteSession(payload)
      const mentionFlags = extractIncomingMentionFlags(payload)
      const result = await this.handleIncomingImMessage({
        provider,
        ...(incomingChannelId ? { channelId: incomingChannelId } : {}),
        text: incomingText.text,
        sender,
        chatType: extractIncomingChatType(payload),
        ...mentionFlags,
        ...(remoteSession ? { remoteSession } : {})
      })
      if (!result.ok) {
        this.logRemoteFailure('remote-channel-webhook', 'Remote channel webhook returned a structured failure.', result, {
          provider,
          channelId: incomingChannelId,
          sender
        })
      }
      writeJson(
        res,
        result.ok ? 200 : 500,
        result.ok && 'createdTaskId' in result
          ? {
              ok: true,
              createdTaskId: result.createdTaskId,
              reply: result.reply
            }
          : result.ok
            ? result
            : safeWebhookFailureBody(result)
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('remote-channel-webhook', 'Remote channel webhook request failed', {
        message: redactSecretText(message)
      })
      writeJson(res, 500, { ok: false, message: 'Internal server error.' })
    }
  }
}

export function createRemoteChannelRuntime(deps: RemoteChannelRuntimeDeps): RemoteChannelRuntime {
  return new RemoteChannelRuntime(deps)
}

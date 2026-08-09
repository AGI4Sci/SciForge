import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, isAbsolute, join } from 'node:path'
import type { NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type {
  AppSettingsV1,
  AgentRuntimeId,
  RemoteChannelGeneratedFileV1,
  RemoteChannelV1,
  RemoteChannelProvider,
  RemoteChannelRemoteSessionV1,
  RemoteChannelRunMode,
  ScheduleTaskFromTextResult
} from '../shared/app-settings'
import type {
  AgentRuntimeEvent,
  AgentRuntimeThread,
  AgentRuntimeThreadPage,
  AgentRuntimeThreadPageInput,
  AgentRuntimeThreadStatus,
  AgentRuntimeThreadStatusInput,
  AgentRuntimeThreadStartInput,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput
} from '../shared/agent-runtime-contract'
import { buildRemoteChannelInboundMessagePrompt } from '../shared/app-settings'
import type { JsonSettingsStore } from './settings-store'

export type RemoteChannelFailureKind =
  | 'runtime_offline'
  | 'model_missing'
  | 'timeout'
  | 'empty_response'
  | 'waiting_desktop_approval'
  | 'local_thread_deleted'
  | 'provider_send_failed'

export type RemoteChannelFailureResult = {
  ok: false
  message: string
  failureKind: RemoteChannelFailureKind
  failureTitle: string
  recoverable: boolean
  details?: unknown
}

type RemoteChannelFailureInput = {
  message: string
  code?: string
  status?: number
  details?: unknown
  kind?: RemoteChannelFailureKind
}

export type RemoteChannelActiveThreadContext = {
  threadId: string
  runtimeId?: AgentRuntimeId
  workspaceRoot?: string
  updatedAt?: string
}

export type RemoteChannelRuntimeDeps = {
  store: JsonSettingsStore
  agentRuntime: {
    listThreads?: (input?: { runtimeId?: AgentRuntimeId; limit?: number; includeArchived?: boolean }) => Promise<AgentRuntimeThread[]>
    startThread: (input: AgentRuntimeThreadStartInput) => Promise<AgentRuntimeThread>
    readThreadStatus: (input: AgentRuntimeThreadStatusInput) => Promise<AgentRuntimeThreadStatus>
    readThreadPage: (input: AgentRuntimeThreadPageInput) => Promise<AgentRuntimeThreadPage>
    subscribeEvents: (input: {
      runtimeId: AgentRuntimeId
      threadId: string
      sinceSeq?: number
      signal?: AbortSignal
    }) => AsyncIterable<AgentRuntimeEvent>
    startTurn: (input: AgentRuntimeTurnStartInput) => Promise<AgentRuntimeTurnHandle>
    interruptTurn?: (input: { runtimeId: AgentRuntimeId; threadId: string; turnId: string; discard?: boolean }) => Promise<void>
  }
  getActiveThreadContext?: () => RemoteChannelActiveThreadContext | null
  logError: (category: string, message: string, detail?: unknown) => void
  notifyChannelActivity?: (payload: {
    channelId: string
    threadId: string
    runtimeId?: AgentRuntimeId
    previousThreadId?: string
  }) => void
  sendWeixinBridgeMessage?: (options: {
    accountId: string
    to: string
    text: string
  }) => Promise<{ ok: true; messageId: string } | { ok: false; message: string }>
  sendDiscordChannelMessage?: (options: {
    channelId: string
    text: string
  }) => Promise<{ ok: true; messageId: string } | { ok: false; message: string }>
  sendZulipChannelMessage?: (options: {
    channelId: string
    text: string
    topicName?: string
  }) => Promise<{ ok: true; messageId: string } | { ok: false; message: string }>
  createScheduledTaskFromText?: (
    text: string,
    options?: { workspaceRoot?: string | null; modelHint?: string | null; mode?: RemoteChannelRunMode | null }
  ) => Promise<ScheduleTaskFromTextResult>
}

export type ThreadRecordJson = {
  id: string
  status?: string
}

export type TurnRecordJson = {
  id: string
  status?: string
  error?: string | null
  items?: TurnItemJson[]
}

export type TurnItemJson = {
  kind: string
  turnId?: string
  status?: string
  toolName?: string
  toolKind?: string
  output?: unknown
  isError?: boolean | null
  text?: string | null
  summary?: string
  detail?: string | null
}

export type ThreadDetailJson = {
  thread?: ThreadRecordJson
  id?: string
  status?: string
  turns?: TurnRecordJson[]
  items?: TurnItemJson[]
}

export type IncomingImChatType = 'p2p' | 'group'

export type RunPromptOptions = {
  prompt: string
  displayText?: string
  title: string
  workspaceRoot: string
  model: string
  mode: RemoteChannelRunMode
  waitForResult: boolean
  responseTimeoutMs: number
  source: 'task' | 'im'
  runtimeId?: AgentRuntimeId
  threadId?: string
  channel?: RemoteChannelV1
  onTurnStarted?: (payload: {
    threadId: string
    turnId: string
    previousThreadId?: string
  }) => Promise<void> | void
}

export const WEBHOOK_BODY_LIMIT_BYTES = 1_000_000

export type RemoteChannelAttachmentKind = 'file' | 'image' | 'link'

export type RemoteChannelAttachmentCapability = {
  supported: boolean
  maxCount: number
  maxBytes: number
}

export type RemoteChannelRetryStrategy = {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
}

export type RemoteChannelProviderCapabilities = {
  provider: RemoteChannelProvider
  label: string
  aliases: readonly string[]
  maxMessageLength: number
  markdown: {
    supported: boolean
    preserveCodeBlocks: boolean
  }
  attachments: Record<RemoteChannelAttachmentKind, RemoteChannelAttachmentCapability>
  retry: RemoteChannelRetryStrategy
}

export type RemoteChannelOutboundAttachment = {
  kind: RemoteChannelAttachmentKind
  name: string
  path?: string
  url?: string
  sizeBytes?: number
  summary?: string
}

export type RemoteChannelPreparedReply = {
  capability: RemoteChannelProviderCapabilities
  textChunks: string[]
  unsupportedAttachments: RemoteChannelOutboundAttachment[]
  fallbackText: string
}

export const REMOTE_CHANNEL_PROVIDER_CAPABILITIES: Record<RemoteChannelProvider, RemoteChannelProviderCapabilities> = {
  feishu: {
    provider: 'feishu',
    label: 'Feishu / Lark',
    aliases: ['feishu', 'lark'],
    maxMessageLength: 30_000,
    markdown: {
      supported: true,
      preserveCodeBlocks: true
    },
    attachments: {
      file: { supported: true, maxCount: 10, maxBytes: 50 * 1024 * 1024 },
      image: { supported: true, maxCount: 10, maxBytes: 20 * 1024 * 1024 },
      link: { supported: true, maxCount: 20, maxBytes: 0 }
    },
    retry: {
      maxAttempts: 2,
      initialDelayMs: 500,
      maxDelayMs: 2_000
    }
  },
  weixin: {
    provider: 'weixin',
    label: 'WeChat',
    aliases: ['weixin', 'wechat'],
    maxMessageLength: 2_000,
    markdown: {
      supported: false,
      preserveCodeBlocks: true
    },
    attachments: {
      file: { supported: true, maxCount: 3, maxBytes: 50 * 1024 * 1024 },
      image: { supported: true, maxCount: 3, maxBytes: 20 * 1024 * 1024 },
      link: { supported: true, maxCount: 20, maxBytes: 0 }
    },
    retry: {
      maxAttempts: 2,
      initialDelayMs: 500,
      maxDelayMs: 2_000
    }
  },
  discord: {
    provider: 'discord',
    label: 'Discord',
    aliases: ['discord'],
    maxMessageLength: 2_000,
    markdown: {
      supported: true,
      preserveCodeBlocks: true
    },
    attachments: {
      file: { supported: false, maxCount: 0, maxBytes: 0 },
      image: { supported: false, maxCount: 0, maxBytes: 0 },
      link: { supported: true, maxCount: 20, maxBytes: 0 }
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 750,
      maxDelayMs: 5_000
    }
  },
  zulip: {
    provider: 'zulip',
    label: 'Zulip',
    aliases: ['zulip'],
    maxMessageLength: 10_000,
    markdown: {
      supported: true,
      preserveCodeBlocks: true
    },
    attachments: {
      file: { supported: false, maxCount: 0, maxBytes: 0 },
      image: { supported: false, maxCount: 0, maxBytes: 0 },
      link: { supported: true, maxCount: 20, maxBytes: 0 }
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 750,
      maxDelayMs: 5_000
    }
  }
}

const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  '.apng',
  '.avif',
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp'
])

export function getRemoteChannelProviderCapabilities(provider: RemoteChannelProvider): RemoteChannelProviderCapabilities {
  return REMOTE_CHANNEL_PROVIDER_CAPABILITIES[provider]
}

function markdownFenceCloseFor(openFence: string): string {
  return openFence.trimStart().startsWith('~~~') ? '~~~' : '```'
}

function markdownFenceTransition(
  line: string,
  inFence: boolean,
  openFence: string
): { inFence: boolean; openFence: string } {
  const match = line.match(/^\s*(`{3,}|~{3,})(.*)$/)
  if (!match) return { inFence, openFence }
  const marker = match[1]
  if (!inFence) {
    return { inFence: true, openFence: line.trim() || marker }
  }
  if (marker[0] !== markdownFenceCloseFor(openFence)[0]) {
    return { inFence, openFence }
  }
  return { inFence: false, openFence }
}

function scanMarkdownFenceState(
  text: string,
  initialInFence: boolean,
  initialOpenFence: string
): { inFence: boolean; openFence: string } {
  let inFence = initialInFence
  let openFence = initialOpenFence
  for (const line of text.split('\n')) {
    const next = markdownFenceTransition(line, inFence, openFence)
    inFence = next.inFence
    openFence = next.openFence
  }
  return { inFence, openFence }
}

function splitTextAtReadableBoundaries(text: string, maxLength: number): string[] {
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1)
    const candidates = [
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      window.lastIndexOf(' ')
    ].filter((index) => index > Math.floor(maxLength * 0.45))
    const breakAt = candidates.length > 0 ? Math.max(...candidates) : maxLength
    const chunk = remaining.slice(0, breakAt).replace(/[ \t]+$/g, '').replace(/\n+$/g, '')
    if (chunk) chunks.push(chunk)
    remaining = remaining.slice(breakAt).replace(/^[ \t]+/g, '').replace(/^\n+/g, '')
  }
  if (remaining.trim()) chunks.push(remaining.trim())
  return chunks.length > 0 ? chunks : ['']
}

function rebalanceMarkdownCodeFences(chunks: readonly string[]): string[] {
  const result: string[] = []
  let inFence = false
  let openFence = '```'
  for (const chunk of chunks) {
    const prefix = inFence ? `${openFence}\n` : ''
    const scanned = scanMarkdownFenceState(chunk, inFence, openFence)
    let next = `${prefix}${chunk}`
    if (scanned.inFence) {
      next = `${next}\n${markdownFenceCloseFor(scanned.openFence)}`
    }
    result.push(next)
    inFence = scanned.inFence
    openFence = scanned.openFence
  }
  return result
}

export function splitRemoteChannelReplyText(
  provider: RemoteChannelProvider,
  text: string,
  options: { maxMessageLength?: number; fallback?: string } = {}
): string[] {
  const capability = getRemoteChannelProviderCapabilities(provider)
  const maxMessageLength = Math.max(20, Math.floor(options.maxMessageLength ?? capability.maxMessageLength))
  const fallback = options.fallback ?? '(empty reply)'
  const normalized = text.trim() || fallback
  if (normalized.length <= maxMessageLength) return [normalized]

  const hasCodeFence = /(^|\n)\s*(`{3,}|~{3,})/.test(normalized)
  const reserve = hasCodeFence
    ? Math.max(8, Math.min(256, Math.floor(maxMessageLength * 0.25)))
    : 0
  const chunkLimit = Math.max(1, maxMessageLength - reserve)
  const rawChunks = splitTextAtReadableBoundaries(normalized, chunkLimit)
  const chunks = hasCodeFence && capability.markdown.preserveCodeBlocks
    ? rebalanceMarkdownCodeFences(rawChunks)
    : rawChunks
  return chunks.flatMap((chunk) =>
    chunk.length <= maxMessageLength
      ? [chunk]
      : splitTextAtReadableBoundaries(chunk, maxMessageLength)
  )
}

export function remoteChannelAttachmentKindForFileName(fileName: string): 'file' | 'image' {
  const lower = fileName.trim().toLowerCase()
  const dotIndex = lower.lastIndexOf('.')
  const extension = dotIndex >= 0 ? lower.slice(dotIndex) : ''
  return IMAGE_ATTACHMENT_EXTENSIONS.has(extension) ? 'image' : 'file'
}

const MAX_OUTBOUND_ATTACHMENT_FILE_NAME_LENGTH = 255

function sanitizeOutboundAttachmentLeaf(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f || character === '"' || character === '/' || character === '\\'
      ? '_'
      : character
  }).join('').replace(/_+/gu, '_').trim()
}

export function sanitizeOutboundAttachmentFileName(fileName: string, fallback = 'attachment'): string {
  const leaf = fileName.trim().split(/[\\/]/).pop() ?? ''
  const sanitized = sanitizeOutboundAttachmentLeaf(leaf)
  const fallbackLeaf = sanitizeOutboundAttachmentLeaf(basename(fallback.trim()) || 'attachment') || 'attachment'
  const candidate = sanitized && sanitized.replace(/[._\s-]+/gu, '') ? sanitized : fallbackLeaf
  if (candidate.length <= MAX_OUTBOUND_ATTACHMENT_FILE_NAME_LENGTH) return candidate

  const dot = candidate.lastIndexOf('.')
  const extension = dot > 0 && candidate.length - dot <= 32 ? candidate.slice(dot) : ''
  return `${candidate.slice(0, MAX_OUTBOUND_ATTACHMENT_FILE_NAME_LENGTH - extension.length)}${extension}`
}

export function remoteChannelAttachmentFromGeneratedFile(file: RemoteChannelGeneratedFileV1): RemoteChannelOutboundAttachment {
  const name = file.fileName.trim() || basename(file.path)
  return {
    kind: remoteChannelAttachmentKindForFileName(name),
    name,
    path: file.path,
    summary: file.relativePath?.trim() || name
  }
}

export function supportedRemoteChannelImAttachments(
  provider: RemoteChannelProvider,
  attachments: readonly RemoteChannelOutboundAttachment[]
): RemoteChannelOutboundAttachment[] {
  const capability = getRemoteChannelProviderCapabilities(provider)
  const counts: Partial<Record<RemoteChannelAttachmentKind, number>> = {}
  return attachments.filter((attachment) => {
    const limit = capability.attachments[attachment.kind]
    if (!limit.supported) return false
    if (limit.maxBytes > 0 && (attachment.sizeBytes ?? 0) > limit.maxBytes) return false
    const nextCount = (counts[attachment.kind] ?? 0) + 1
    counts[attachment.kind] = nextCount
    return limit.maxCount <= 0 || nextCount <= limit.maxCount
  })
}

export function unsupportedRemoteChannelImAttachments(
  provider: RemoteChannelProvider,
  attachments: readonly RemoteChannelOutboundAttachment[]
): RemoteChannelOutboundAttachment[] {
  const supported = new Set(supportedRemoteChannelImAttachments(provider, attachments))
  return attachments.filter((attachment) => !supported.has(attachment))
}

function formatAttachmentSummary(attachment: RemoteChannelOutboundAttachment): string {
  if (attachment.kind === 'link' && attachment.url) return `${attachment.name}: ${attachment.url}`
  return attachment.summary?.trim() || attachment.name
}

export function buildRemoteChannelAttachmentFallbackText(
  provider: RemoteChannelProvider,
  attachments: readonly RemoteChannelOutboundAttachment[],
  options: { reason?: string } = {}
): string {
  const capability = getRemoteChannelProviderCapabilities(provider)
  const visible = attachments.slice(0, 5)
  const names = visible.map(formatAttachmentSummary).filter(Boolean)
  if (names.length === 0) return ''
  const more = attachments.length > visible.length ? `\n- 另有 ${attachments.length - visible.length} 个附件` : ''
  const reason = options.reason?.trim()
  const heading = reason
    ? `${capability.label} 附件投递失败：${reason}`
    : `${capability.label} 当前不能直接投递这些附件。`
  return [
    heading,
    ...names.map((name) => `- ${name}`),
    `${more ? more : ''}\n请到桌面查看完整结果。`
  ].join('\n').trim()
}

export function prepareRemoteChannelReplyText(
  provider: RemoteChannelProvider,
  text: string,
  options: {
    attachments?: readonly RemoteChannelOutboundAttachment[]
    maxMessageLength?: number
    fallback?: string
  } = {}
): RemoteChannelPreparedReply {
  const capability = getRemoteChannelProviderCapabilities(provider)
  const attachments = options.attachments ?? []
  const unsupportedAttachments = unsupportedRemoteChannelImAttachments(provider, attachments)
  const fallbackText = buildRemoteChannelAttachmentFallbackText(provider, unsupportedAttachments)
  const body = [text.trim(), fallbackText].filter(Boolean).join('\n\n')
  return {
    capability,
    textChunks: splitRemoteChannelReplyText(provider, body, {
      maxMessageLength: options.maxMessageLength,
      fallback: options.fallback
    }),
    unsupportedAttachments,
    fallbackText
  }
}

export function sanitizePathSegment(raw: string, fallback: string): string {
  const sanitized = raw
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || fallback
}

export function feishuSenderLabel(message: NormalizedMessage): string {
  return message.senderName?.trim() || message.senderId.trim() || 'feishu-user'
}

export function buildFeishuPrompt(message: NormalizedMessage): string {
  const content = message.content.trim()
  const sender = feishuSenderLabel(message)
  const metadata: Array<[string, string | undefined]> = [
    ['Chat type', message.chatType],
    ['Sender', sender]
  ]
  if (message.mentions.length > 0) {
    const mentionNames = message.mentions
      .map((mention) => mention.name?.trim() || mention.openId?.trim() || mention.userId?.trim() || '')
      .filter(Boolean)
    if (mentionNames.length > 0) {
      metadata.push(['Mentions', mentionNames.join(', ')])
    }
  }
  if (message.rawContentType !== 'text') {
    metadata.push(['Message type', message.rawContentType])
  }
  return buildRemoteChannelInboundMessagePrompt({
    provider: 'feishu',
    metadata,
    text: content
  })
}

export function formatFeishuMirrorText(text: string, direction: 'user' | 'assistant'): { markdown: string } {
  const trimmed = text.trim()
  if (direction === 'user') {
    return {
      markdown: `**From SciForge**\n\n> ${trimmed.replace(/\n/g, '\n> ')}`
    }
  }
  return { markdown: trimmed || '(empty reply)' }
}

export function remoteChannelConversationKey(chatId: string, remoteThreadId: string): string {
  return `${chatId.trim()}::${remoteThreadId.trim()}`
}

export function remoteConversationQueueKey(input: {
  provider: RemoteChannelProvider
  channelId: string
  chatId: string
  remoteThreadId: string
}): string {
  return [
    input.provider.trim(),
    input.channelId.trim(),
    input.chatId.trim(),
    input.remoteThreadId.trim()
  ].join('::')
}

export function remoteMessageDedupeKey(input: {
  provider: RemoteChannelProvider
  channelId: string
  chatId: string
  remoteThreadId: string
  messageId: string
}): string {
  return `${remoteConversationQueueKey(input)}::${input.messageId.trim()}`
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const REMOTE_CHANNEL_FAILURE_TITLES: Record<RemoteChannelFailureKind, string> = {
  runtime_offline: 'Runtime offline',
  model_missing: 'Model missing',
  timeout: 'Timed out',
  empty_response: 'Empty response',
  waiting_desktop_approval: 'Waiting for desktop approval',
  local_thread_deleted: 'Local thread deleted',
  provider_send_failed: 'Provider send failed'
}

const REMOTE_CHANNEL_FAILURE_RECOVERABLE: Record<RemoteChannelFailureKind, boolean> = {
  runtime_offline: true,
  model_missing: true,
  timeout: true,
  empty_response: true,
  waiting_desktop_approval: true,
  local_thread_deleted: true,
  provider_send_failed: true
}

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle))
}

function parsedRuntimeFailure(raw: string): {
  code?: string
  message?: string
  details?: unknown
} | null {
  const parsed = parseJsonObject(raw)
  if (!parsed) return null
  const error = nestedRecord(parsed.error)
  const code = asString(parsed.code) || asString(parsed.error) || asString(error.code)
  const message =
    asString(parsed.message) ||
    asString(error.message) ||
    (typeof parsed.error === 'string' ? parsed.error.trim() : '')
  return {
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...('details' in parsed ? { details: parsed.details } : {})
  }
}

export function classifyRemoteChannelFailure(input: {
  message?: string
  code?: string
  status?: number
  kind?: RemoteChannelFailureKind
}): RemoteChannelFailureKind {
  if (input.kind) return input.kind
  const code = (input.code ?? '').trim().toLowerCase()
  const message = (input.message ?? '').trim()
  const text = `${code} ${message}`.toLowerCase()

  if (code === 'provider_send_failed') return 'provider_send_failed'
  if (code === 'empty_response' || includesAny(text, ['completed without a reply', 'empty response'])) {
    return 'empty_response'
  }
  if (
    code === 'waiting_desktop_approval' ||
    code === 'approval_required' ||
    (text.includes('approval') && includesAny(text, ['waiting', 'pending', 'requested', 'required', 'desktop']))
  ) {
    return 'waiting_desktop_approval'
  }
  if (
    code === 'local_thread_deleted' ||
    ((input.status === 404 || includesAny(text, ['not found', 'deleted', 'missing'])) && text.includes('thread'))
  ) {
    return 'local_thread_deleted'
  }
  if (
    code === 'model_missing' ||
    code === 'missing_api_key' ||
    code === 'provider_unavailable' ||
    (
      includesAny(text, ['model', 'api key']) &&
      includesAny(text, ['missing', 'not found', 'not exist', 'unknown', 'unavailable', 'required', 'unsupported'])
    )
  ) {
    return 'model_missing'
  }
  if (code === 'timeout' || includesAny(text, ['timed out', 'timeout'])) return 'timeout'
  if (
    code === 'runtime_offline' ||
    code === 'fetch_failed' ||
    includesAny(text, ['offline', 'fetch failed', 'econnrefused', 'connection refused', 'not connected', 'app-server offline'])
  ) {
    return 'runtime_offline'
  }
  return 'runtime_offline'
}

export function remoteChannelFailureResult(input: RemoteChannelFailureInput): RemoteChannelFailureResult {
  const message = input.message.trim() || 'Remote channel runtime failed.'
  const failureKind = classifyRemoteChannelFailure({
    message,
    code: input.code,
    status: input.status,
    kind: input.kind
  })
  return {
    ok: false,
    message,
    failureKind,
    failureTitle: REMOTE_CHANNEL_FAILURE_TITLES[failureKind],
    recoverable: REMOTE_CHANNEL_FAILURE_RECOVERABLE[failureKind],
    ...(input.details !== undefined ? { details: input.details } : {})
  }
}

export function remoteChannelFailureFromError(error: unknown, fallback: string): RemoteChannelFailureResult {
  const raw = error instanceof Error ? error.message : String(error)
  const parsed = parsedRuntimeFailure(raw)
  return remoteChannelFailureResult({
    message: parsed?.message || raw.trim() || fallback,
    code: parsed?.code,
    details: parsed?.details
  })
}

export function remoteChannelFailureError(
  kind: RemoteChannelFailureKind,
  message: string,
  details?: unknown
): Error {
  return new Error(JSON.stringify({
    code: kind,
    message,
    ...(details !== undefined ? { details } : {})
  }))
}

export function providerSendFailureMessage(provider: string, message: string): string {
  const detail = message.trim()
  return detail
    ? `${provider} send failed: ${detail}`
    : `${provider} send failed.`
}

export function isRunningStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'in_progress' || status === 'started' || status === 'running'
}

export function latestAssistantText(
  detail: ThreadDetailJson,
  options: { turnId?: string } = {}
): string {
  const turnId = options.turnId?.trim()
  const items = turnId
    ? threadItems(detail).filter((item) => item.turnId === turnId)
    : threadItems(detail)
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind !== 'assistant_text' && item.kind !== 'agent_message' && item.kind !== 'assistant_message') continue
    const text = (item.text ?? item.detail ?? item.summary ?? '').trim()
    if (text) return text
  }
  return ''
}

export function latestThreadSummaryText(detail: ThreadDetailJson): string {
  const items = threadItems(detail)
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    const text = (item.summary ?? item.detail ?? item.text ?? '').trim()
    if (!text) continue
    if (item.kind === 'compaction_event' || item.kind === 'summary' || item.kind.includes('summary')) {
      return text
    }
  }
  return ''
}

function outputRecord(output: unknown): Record<string, unknown> | null {
  return typeof output === 'object' && output !== null && !Array.isArray(output)
    ? output as Record<string, unknown>
    : null
}

function generatedFileFromRecord(
  record: Record<string, unknown>,
  workspaceRoot: string
): RemoteChannelGeneratedFileV1 | null {
  const path = asString(record.path) || asString(record.absolutePath) || asString(record.absolute_path)
  const relativePath = asString(record.relativePath) || asString(record.relative_path)
  const resolvedPath = path || (workspaceRoot && relativePath ? join(workspaceRoot, relativePath) : '')
  if (!resolvedPath) return null
  return {
    path: resolvedPath,
    ...(relativePath ? { relativePath } : {}),
    fileName: asString(record.fileName) || asString(record.name) || basename(relativePath || resolvedPath)
  }
}

function generatedFilesFromToolResult(
  item: TurnItemJson,
  workspaceRoot: string
): RemoteChannelGeneratedFileV1[] {
  if ((item.kind !== 'tool_result' && item.kind !== 'tool') || item.isError === true) return []
  const output = outputRecord(item.output)
  if (!output) return []
  const meta = outputRecord((item as { meta?: unknown }).meta)
  if (item.toolKind === 'file_change') {
    const file = generatedFileFromRecord({
      ...output,
      path: asString(output.path) || asString(output.absolute_path) || asString(meta?.filePath),
      relative_path: asString(output.relative_path) || asString(meta?.relativePath)
    }, workspaceRoot)
    return file ? [file] : []
  }
  const toolName = item.toolName?.trim()
  if (
    (toolName === 'generate_image' ||
      toolName === 'generate_speech' ||
      toolName === 'generate_music' ||
      toolName === 'generate_video') &&
    Array.isArray(output.files)
  ) {
    return output.files
      .map((entry) => outputRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => generatedFileFromRecord(entry, workspaceRoot))
      .filter((file): file is RemoteChannelGeneratedFileV1 => file !== null)
  }
  return []
}

function threadItems(detail: ThreadDetailJson): TurnItemJson[] {
  const turns = Array.isArray(detail.turns) ? detail.turns : []
  const singleTurnId = turns.length === 1 ? turns[0].id : ''
  const topLevelItems = Array.isArray(detail.items)
    ? detail.items.map((item) => ({ ...item, turnId: item.turnId || singleTurnId || undefined }))
    : []
  const turnItems = turns.flatMap((turn) =>
    Array.isArray(turn.items)
      ? turn.items.map((item) => ({ ...item, turnId: item.turnId || turn.id }))
      : []
  )
  return [
    ...topLevelItems,
    ...turnItems
  ]
}

function isPathLikeDuplicate(left: RemoteChannelGeneratedFileV1, right: RemoteChannelGeneratedFileV1): boolean {
  if (left.path === right.path) return true
  if (left.relativePath && left.relativePath === right.relativePath) return true
  if (isAbsolute(left.path) && isAbsolute(right.path)) return left.path === right.path
  return false
}

function extractGeneratedFiles(
  items: readonly TurnItemJson[],
  workspaceRoot: string,
  maxFiles: number
): RemoteChannelGeneratedFileV1[] {
  const files: RemoteChannelGeneratedFileV1[] = []
  for (let index = items.length - 1; index >= 0; index -= 1) {
    for (const file of generatedFilesFromToolResult(items[index], workspaceRoot).reverse()) {
      if (files.some((existing) => isPathLikeDuplicate(existing, file))) continue
      files.push(file)
      if (files.length >= maxFiles) break
    }
    if (files.length >= maxFiles) break
  }
  return files.reverse()
}

export function latestGeneratedFiles(
  detail: ThreadDetailJson,
  options: { turnId?: string; workspaceRoot?: string; maxFiles?: number } = {}
): RemoteChannelGeneratedFileV1[] {
  const maxFiles = Math.max(1, Math.floor(options.maxFiles ?? 3))
  const workspaceRoot = options.workspaceRoot?.trim() ?? ''
  const items = threadItems(detail)
  const turnId = options.turnId?.trim()
  if (turnId) {
    return extractGeneratedFiles(
      items.filter((item) => item.turnId === turnId),
      workspaceRoot,
      maxFiles
    )
  }
  return extractGeneratedFiles(items, workspaceRoot, maxFiles)
}

export function hasPendingDesktopApproval(
  detail: ThreadDetailJson,
  options: { turnId?: string } = {}
): boolean {
  const turnId = options.turnId?.trim()
  return threadItems(detail).some((item) => {
    if (turnId && item.turnId && item.turnId !== turnId) return false
    if (item.kind !== 'approval') return false
    const status = item.status?.trim().toLowerCase() || 'pending'
    return !['success', 'completed', 'failed', 'aborted', 'error'].includes(status)
  })
}

export function shouldSendGeneratedFilesForPrompt(prompt: string): boolean {
  const text = prompt.trim()
  if (!text) return false
  return /发给我|发送给我|发一下|发来|发过来|传给我|传过来|上传|附件|以附件|发文件|文件发|文档发/i.test(text) ||
    /\b(send|attach|attachment|upload)\b/i.test(text) ||
    /给我(?:一个|一份)?.{0,24}(文档|文件|\.(?:md|txt|pdf|docx|xlsx|csv|pptx))/i.test(text) ||
    /(生成|画|绘制|做|制作|创建|出).{0,24}(图|图片|图像|照片|海报|插画|表情包|logo)/i.test(text) ||
    /(生成|做|制作|创建|配|出).{0,24}(语音|音频|朗读|旁白|配音|音乐|歌曲|视频|短片|影片)/i.test(text) ||
    /\b(generate|create|draw|make)\b.{0,40}\b(image|picture|photo|poster|illustration|meme|logo|speech|voice|audio|music|song|video)\b/i.test(text)
}

export function shouldDirectSendExistingGeneratedFilesForPrompt(prompt: string): boolean {
  const text = prompt.trim()
  if (!text) return false
  return /发给我|发送给我|发一下|发来|发过来|传给我|传过来|上传|附件|以附件|直接发|发文件|文件发|文档发/i.test(text) ||
    /\b(send|attach|attachment|upload)\b/i.test(text)
}

export function replyTextForGeneratedFiles(replyText: string, files: readonly RemoteChannelGeneratedFileV1[]): string {
  const trimmed = replyText.trim()
  if (files.length === 0) return trimmed
  const names = files.map((file) => file.fileName).join(', ')
  if (!trimmed || /(无法|不能|没办法).{0,20}(直接)?(通过)?(飞书|Lark|发送|发).{0,20}(文件|文档|附件)/i.test(trimmed)) {
    return `可以，我把 ${names} 作为附件发给你。`
  }
  return trimmed
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runRemoteChannelProviderRetry<T>(
  provider: RemoteChannelProvider,
  operation: (attempt: number) => Promise<T>,
  options: {
    shouldRetryResult?: (result: T) => boolean
    sleepMs?: (ms: number) => Promise<void>
  } = {}
): Promise<T> {
  const retry = getRemoteChannelProviderCapabilities(provider).retry
  let lastError: unknown
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    try {
      const result = await operation(attempt)
      if (!options.shouldRetryResult?.(result) || attempt === retry.maxAttempts) {
        return result
      }
    } catch (error) {
      lastError = error
      if (attempt === retry.maxAttempts) throw error
    }
    const delay = Math.min(
      retry.maxDelayMs,
      retry.initialDelayMs * (2 ** Math.max(0, attempt - 1))
    )
    await (options.sleepMs ?? sleep)(delay)
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'IM retry failed.'))
}

export function normalizeTaskModel(model: string): string | undefined {
  const trimmed = model.trim()
  return trimmed || undefined
}

export function webhookUrl(settings: AppSettingsV1): string {
  return `http://127.0.0.1:${settings.remoteChannel.im.port}${settings.remoteChannel.im.path}`
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function asRawString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function nestedRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function extractIncomingPrompt(payload: Record<string, unknown>): string {
  const candidates = [
    payload.text,
    payload.prompt,
    payload.message,
    nestedRecord(payload.message).text,
    nestedRecord(payload.event).text,
    nestedRecord(payload.data).text
  ]
  for (const candidate of candidates) {
    const text = asString(candidate)
    if (text) return text
  }
  return ''
}

export function extractSenderLabel(payload: Record<string, unknown>): string {
  const candidates = [
    payload.sender,
    payload.user,
    payload.from,
    payload.conversationId,
    nestedRecord(payload.message).sender,
    nestedRecord(payload.event).sender,
    nestedRecord(payload.data).sender
  ]
  for (const candidate of candidates) {
    const text = asString(candidate)
    if (text) return text
  }
  return 'webhook'
}

export function normalizeIncomingProvider(value: unknown, fallback: RemoteChannelProvider): RemoteChannelProvider {
  const raw = asString(value).toLowerCase()
  if (raw === 'weixin' || raw === 'wechat') return 'weixin'
  if (raw === 'discord') return 'discord'
  if (raw === 'zulip') return 'zulip'
  return raw === 'feishu' ? 'feishu' : fallback
}

export function extractIncomingProvider(
  payload: Record<string, unknown>,
  fallback: RemoteChannelProvider
): RemoteChannelProvider {
  const candidates = [
    payload.provider,
    payload.platform,
    payload.im,
    payload.source,
    nestedRecord(payload.message).provider,
    nestedRecord(payload.event).provider,
    nestedRecord(payload.data).provider
  ]
  for (const candidate of candidates) {
    const provider = normalizeIncomingProvider(candidate, fallback)
    if (provider !== fallback || asString(candidate).toLowerCase() === fallback) return provider
  }
  return fallback
}

export function extractIncomingChannelId(payload: Record<string, unknown>): string {
  const candidates = [
    payload.channelId,
    payload.channel_id,
    nestedRecord(payload.message).channelId,
    nestedRecord(payload.event).channelId,
    nestedRecord(payload.data).channelId
  ]
  for (const candidate of candidates) {
    const text = asString(candidate)
    if (text) return text
  }
  return ''
}

export function normalizeIncomingChatType(value: unknown): IncomingImChatType | undefined {
  const raw = asString(value).toLowerCase()
  if (raw === 'p2p' || raw === 'dm' || raw === 'direct' || raw === 'private') return 'p2p'
  if (raw === 'group' || raw === 'channel' || raw === 'guild' || raw === 'server') return 'group'
  return undefined
}

export function extractIncomingChatType(payload: Record<string, unknown>): IncomingImChatType | undefined {
  const message = nestedRecord(payload.message)
  const event = nestedRecord(payload.event)
  const data = nestedRecord(payload.data)
  const eventMessage = nestedRecord(event.message)
  const candidates = [
    payload.chatType,
    payload.chat_type,
    payload.conversationType,
    payload.conversation_type,
    message.chatType,
    message.chat_type,
    eventMessage.chat_type,
    eventMessage.chatType,
    data.chatType,
    data.chat_type
  ]
  for (const candidate of candidates) {
    const chatType = normalizeIncomingChatType(candidate)
    if (chatType) return chatType
  }
  return undefined
}

export function extractIncomingMentionFlags(payload: Record<string, unknown>): {
  mentionedBot?: boolean
  mentionAll?: boolean
} {
  const message = nestedRecord(payload.message)
  const event = nestedRecord(payload.event)
  const data = nestedRecord(payload.data)
  const eventMessage = nestedRecord(event.message)
  const boolValue = (value: unknown): boolean | undefined =>
    typeof value === 'boolean' ? value : undefined
  const mentionedBot =
    boolValue(payload.mentionedBot) ??
    boolValue(payload.mentioned_bot) ??
    boolValue(message.mentionedBot) ??
    boolValue(message.mentioned_bot) ??
    boolValue(eventMessage.mentioned_bot) ??
    boolValue(eventMessage.mentionedBot) ??
    boolValue(data.mentionedBot) ??
    boolValue(data.mentioned_bot)
  const mentionAll =
    boolValue(payload.mentionAll) ??
    boolValue(payload.mention_all) ??
    boolValue(message.mentionAll) ??
    boolValue(message.mention_all) ??
    boolValue(eventMessage.mention_all) ??
    boolValue(eventMessage.mentionAll) ??
    boolValue(data.mentionAll) ??
    boolValue(data.mention_all)
  return {
    ...(mentionedBot !== undefined ? { mentionedBot } : {}),
    ...(mentionAll !== undefined ? { mentionAll } : {})
  }
}

export function extractIncomingRemoteSession(
  payload: Record<string, unknown>
): Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'> | null {
  const message = nestedRecord(payload.message)
  const event = nestedRecord(payload.event)
  const eventMessage = nestedRecord(event.message)
  const header = nestedRecord(event.header)
  const sender = nestedRecord(payload.sender)
  const eventSender = nestedRecord(event.sender)

  const chatId = asString(
    payload.chatId ||
    payload.chat_id ||
    payload.open_chat_id ||
    message.chatId ||
    message.chat_id ||
    eventMessage.chat_id ||
    eventMessage.chatId
  )
  const messageId = asString(
    payload.messageId ||
    payload.message_id ||
    message.messageId ||
    message.message_id ||
    eventMessage.message_id ||
    eventMessage.messageId ||
    header.message_id
  )
  if (!chatId || !messageId) return null

  const threadId = asString(
    payload.threadId ||
    payload.thread_id ||
    message.threadId ||
    message.thread_id ||
    eventMessage.thread_id ||
    eventMessage.threadId
  )
  const senderId = asString(
    payload.senderId ||
    payload.sender_id ||
    sender.id ||
    sender.open_id ||
    sender.user_id ||
    eventSender.sender_id ||
    eventSender.open_id ||
    eventSender.user_id
  )
  const senderName = asString(
    payload.senderName ||
    payload.sender_name ||
    sender.name ||
    eventSender.sender_name ||
    eventSender.name
  )
  return { chatId, messageId, threadId, senderId, senderName }
}

export function buildConversationLabel(session: Pick<RemoteChannelRemoteSessionV1, 'chatId' | 'senderName'>): string {
  const sender = session.senderName.trim()
  if (sender) return sender
  const chatId = session.chatId.trim()
  return chatId.length > 12 ? chatId.slice(0, 12) : chatId
}

export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

export async function readRequestBody(req: IncomingMessage): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > WEBHOOK_BODY_LIMIT_BYTES) {
      throw new Error('Request body is too large.')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

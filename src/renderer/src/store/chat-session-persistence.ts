import type { AttachmentReference } from '../agent/types'
import type { AgentRuntimeFileReference } from '@shared/agent-runtime-contract'
import type { AgentRuntimeId } from '@shared/app-settings'
import { workspaceLocatorSchema } from '@sciforge/domain-sdk/workspace-host'
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import type { AppRoute, QueuedUserMessage } from './chat-store-types'

export const CHAT_SESSION_STORAGE_KEY = 'sciforge.chatSession.v1'
export const CHAT_SESSION_RECOVERY_STORAGE_KEY = 'sciforge.chatSession.recovery.v1'
const MAX_QUEUED_MESSAGES = 100
const MAX_MESSAGE_CHARS = 100_000
const MAX_SHORT_CHARS = 4_000
const MAX_PERSISTED_SESSION_CHARS = 2_000_000
const MAX_RECOVERY_SESSION_CHARS = 512_000

export type PersistedChatSession = {
  activeThreadId: string | null
  queuedMessages: QueuedUserMessage[]
  persistenceDegraded: boolean
}

export type ChatSessionPersistenceResult = {
  degraded: boolean
  persistedMessages: number
  droppedMessages: number
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function text(value: unknown, max = MAX_SHORT_CHARS): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized.slice(0, max) : undefined
}

function stringList(value: unknown, maxItems = 100): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value
    .map((item) => text(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems)
  return values.length ? [...new Set(values)] : undefined
}

function runtimeId(value: unknown): AgentRuntimeId | undefined {
  return value === 'sciforge' || value === 'codex' || value === 'claude' ? value : undefined
}

function appRoute(value: unknown): AppRoute | undefined {
  return value === 'chat' || value === 'settings' || value === 'plugins' ||
    value === 'schedule'
    ? value
    : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function attachment(value: unknown): AttachmentReference | null {
  const input = record(value)
  const id = text(input?.id)
  if (!input || !id) return null
  const output: AttachmentReference = { id }
  const name = text(input.name)
  const mimeType = text(input.mimeType)
  const path = text(input.path)
  const relativePath = text(input.relativePath)
  const absolutePath = text(input.absolutePath)
  const byteSize = finiteNumber(input.byteSize)
  const width = finiteNumber(input.width)
  const height = finiteNumber(input.height)
  if (name) output.name = name
  if (mimeType) output.mimeType = mimeType
  if (path) output.path = path
  if (relativePath) output.relativePath = relativePath
  if (absolutePath) output.absolutePath = absolutePath
  if (byteSize != null) output.byteSize = byteSize
  if (width != null) output.width = width
  if (height != null) output.height = height
  // previewUrl may be a large data URL or a blob URL owned by the old renderer.
  return output
}

function fileReference(value: unknown): AgentRuntimeFileReference | null {
  const input = record(value)
  const path = text(input?.path)
  const relativePath = text(input?.relativePath)
  const name = text(input?.name)
  if (!input || !path || !relativePath || !name) return null
  const kind = input.kind === 'file' || input.kind === 'directory' || input.kind === 'image' ||
    input.kind === 'pdf' || input.kind === 'text'
    ? input.kind
    : undefined
  const delivery = input.delivery === 'inline_context' || input.delivery === 'model_router_object'
    ? input.delivery
    : undefined
  const mimeType = text(input.mimeType)
  return {
    path,
    relativePath,
    name,
    ...(kind ? { kind } : {}),
    ...(delivery ? { delivery } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(input.modelRouterObject === true ? { modelRouterObject: true } : {})
  }
}

function sanitizeQueuedMessage(value: unknown, restored: boolean): QueuedUserMessage | null {
  const input = record(value)
  const id = text(input?.id)
  const messageText = text(input?.text, MAX_MESSAGE_CHARS)
  if (!input || !id || !messageText) return null
  const threadId = text(input.threadId)
  const targetThreadId = text(input.targetThreadId)
  const persistedRuntimeId = runtimeId(input.runtimeId)
  const displayText = text(input.displayText, MAX_MESSAGE_CHARS)
  const mode = text(input.mode)
  const sourceRoute = appRoute(input.sourceRoute)
  const workspaceRoot = text(input.workspaceRoot, MAX_MESSAGE_CHARS)
  const governanceProfile = input.governanceProfile === 'default' ||
    input.governanceProfile === 'write' || input.governanceProfile === 'remote_guard'
    ? input.governanceProfile
    : undefined
  const model = text(input.model)
  const modelLabel = text(input.modelLabel)
  const reasoningEffort = text(input.reasoningEffort)
  const workspaceLocatorResult = workspaceLocatorSchema.safeParse(input.workspaceLocator)
  const workspaceLocator = workspaceLocatorResult.success
    ? workspaceLocatorResult.data
    : undefined
  const attachmentIds = stringList(input.attachmentIds)
  const attachments = Array.isArray(input.attachments)
    ? input.attachments.map(attachment).filter((item): item is AttachmentReference => item != null)
    : []
  const fileReferences = Array.isArray(input.fileReferences)
    ? input.fileReferences.map(fileReference).filter((item): item is AgentRuntimeFileReference => item != null)
    : []
  const failure = record(input.sendFailure)
  const failureUserBlockId = text(failure?.userBlockId)
  const failureMessage = text(failure?.message, MAX_MESSAGE_CHARS)
  const failureAttemptedAt = finiteNumber(failure?.attemptedAt)
  const recoveryWarning = text(input.restoredAttachmentWarning, MAX_MESSAGE_CHARS)
  const delivery = record(input.deliveryAttempt)
  const deliveryStartedAt = finiteNumber(delivery?.startedAt)
  const deliveryUserBlockId = text(delivery?.userBlockId) ?? id
  const deliveryAttemptedText = text(delivery?.attemptedText, MAX_MESSAGE_CHARS) ?? displayText ?? messageText
  const deliveryAttemptedDisplayText = text(delivery?.attemptedDisplayText, MAX_MESSAGE_CHARS)
  const hasDurableAttachmentIds = Boolean(attachmentIds?.length)

  return {
    id,
    text: messageText,
    ...(threadId ? { threadId } : {}),
    ...(targetThreadId ? { targetThreadId } : {}),
    ...(persistedRuntimeId ? { runtimeId: persistedRuntimeId } : {}),
    ...(displayText ? { displayText } : {}),
    ...(mode ? { mode } : {}),
    ...(sourceRoute ? { sourceRoute } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(governanceProfile ? { governanceProfile } : {}),
    ...(model ? { model } : {}),
    ...(modelLabel ? { modelLabel } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(workspaceLocator ? { workspaceLocator } : {}),
    ...(attachmentIds?.length ? { attachmentIds } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(fileReferences.length ? { fileReferences } : {}),
    ...(failureUserBlockId && failureMessage
      ? {
          sendFailure: {
            userBlockId: failureUserBlockId,
            message: failureMessage,
            ...(failureAttemptedAt != null ? { attemptedAt: failureAttemptedAt } : {})
          }
        }
      : {}),
    ...(deliveryStartedAt != null && deliveryUserBlockId && deliveryAttemptedText
      ? {
          deliveryAttempt: {
            startedAt: deliveryStartedAt,
            userBlockId: deliveryUserBlockId,
            attemptedText: deliveryAttemptedText,
            ...(deliveryAttemptedDisplayText ? { attemptedDisplayText: deliveryAttemptedDisplayText } : {}),
            ...(delivery?.journalOnly === true ? { journalOnly: true } : {}),
            ...(restored ? { restored: true } : {})
          }
        }
      : {}),
    ...((recoveryWarning || (restored && hasDurableAttachmentIds))
      ? {
          restoredAttachmentWarning: recoveryWarning ??
            'This queued message contains attachments restored after an app restart. Confirm retry so expired attachment references fail visibly instead of being sent silently.'
        }
      : {})
    // guiPlan is intentionally not durable because it depends on transient UI state.
  }
}

export function normalizePersistedQueuedMessages(value: unknown, restored = true): QueuedUserMessage[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const seenIds = new Set<string>()
  const output: QueuedUserMessage[] = []
  for (const raw of value) {
    const message = sanitizeQueuedMessage(raw, restored)
    if (!message) continue
    const key = `${message.runtimeId ?? ''}\u0000${message.threadId ?? message.targetThreadId ?? ''}\u0000${message.id}`
    if (seen.has(key) || seenIds.has(message.id)) continue
    seen.add(key)
    seenIds.add(message.id)
    output.push(message)
    if (output.length >= MAX_QUEUED_MESSAGES) break
  }
  return output
}

export function readPersistedChatSession(): PersistedChatSession {
  const primary = readPersistedEnvelope(CHAT_SESSION_STORAGE_KEY, MAX_PERSISTED_SESSION_CHARS, false)
  if (primary) return primary
  const recovery = readPersistedEnvelope(
    CHAT_SESSION_RECOVERY_STORAGE_KEY,
    MAX_RECOVERY_SESSION_CHARS,
    true
  )
  return recovery ?? { activeThreadId: null, queuedMessages: [], persistenceDegraded: false }
}

function readPersistedEnvelope(
  key: string,
  maxChars: number,
  persistenceDegraded: boolean
): PersistedChatSession | null {
  try {
    const raw = readBrowserStorageItem(key)
    if (!raw) return null
    if (raw.length > maxChars) {
      removeBrowserStorageItem(key)
      return null
    }
    const parsed = record(JSON.parse(raw))
    if (!parsed || parsed.version !== 1) return null
    return {
      activeThreadId: text(parsed.activeThreadId) ?? null,
      queuedMessages: normalizePersistedQueuedMessages(parsed.queuedMessages, true),
      persistenceDegraded
    }
  } catch {
    return null
  }
}

/** Fail open from an invalid restored selection without discarding queued work. */
export function clearPersistedActiveThread(): void {
  const session = readPersistedChatSession()
  persistChatSession({ activeThreadId: null, queuedMessages: session.queuedMessages })
}

export function persistChatSession(
  session: Pick<PersistedChatSession, 'activeThreadId' | 'queuedMessages'>
): ChatSessionPersistenceResult {
  const payload = {
    version: 1,
    activeThreadId: text(session.activeThreadId) ?? null,
    queuedMessages: normalizePersistedQueuedMessages(session.queuedMessages, false)
  }
  const serialized = JSON.stringify(payload)
  if (serialized.length <= MAX_PERSISTED_SESSION_CHARS &&
    writeBrowserStorageItem(CHAT_SESSION_STORAGE_KEY, serialized)) {
    // The primary is authoritative. A stale recovery slot must never resurrect
    // an already delivered message.
    removeBrowserStorageItem(CHAT_SESSION_RECOVERY_STORAGE_KEY)
    return { degraded: false, persistedMessages: payload.queuedMessages.length, droppedMessages: 0 }
  }

  // Free the stale primary before writing a bounded recovery outbox. The
  // recovery payload preserves complete earliest entries (including immutable
  // delivery identity) instead of truncating instructions.
  removeBrowserStorageItem(CHAT_SESSION_STORAGE_KEY)
  removeBrowserStorageItem(CHAT_SESSION_RECOVERY_STORAGE_KEY)
  const recoveryMessages: QueuedUserMessage[] = []
  for (const message of payload.queuedMessages) {
    const candidate = JSON.stringify({
      version: 1,
      degraded: true,
      activeThreadId: payload.activeThreadId,
      queuedMessages: [...recoveryMessages, message]
    })
    if (candidate.length > MAX_RECOVERY_SESSION_CHARS) break
    recoveryMessages.push(message)
  }
  const recoveryPayload = JSON.stringify({
    version: 1,
    degraded: true,
    activeThreadId: payload.activeThreadId,
    queuedMessages: recoveryMessages
  })
  const recoveryWritten = writeBrowserStorageItem(CHAT_SESSION_RECOVERY_STORAGE_KEY, recoveryPayload)
  return {
    degraded: true,
    persistedMessages: recoveryWritten ? recoveryMessages.length : 0,
    droppedMessages: payload.queuedMessages.length - (recoveryWritten ? recoveryMessages.length : 0)
  }
}

import i18n from '../i18n'
import type { AttachmentReference } from '../agent/types'
import { AGENT_PERMISSION_LEVELS, type AgentPermissionLevel, type AgentRuntimeId } from '@shared/app-settings'
import { workspaceLocatorSchema } from '@sciforge/domain-sdk/workspace-host'
import {
  browserStorage,
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import type { AppRoute, ConversationRuntimeSettings, QueuedUserMessage } from './chat-store-types'
import { normalizeRuntimeFileReferences } from '../lib/runtime-file-references'

export const CHAT_SESSION_STORAGE_KEY = 'sciforge.chatSession.v1'
export const CHAT_SESSION_RECOVERY_STORAGE_KEY = 'sciforge.chatSession.recovery.v1'
const MAX_QUEUED_MESSAGES = 100
const MAX_MESSAGE_CHARS = 100_000
const MAX_SHORT_CHARS = 4_000
const MAX_PERSISTED_SESSION_CHARS = 2_000_000
const MAX_RECOVERY_SESSION_CHARS = 512_000
const MAX_CONVERSATION_SETTINGS = 500
const MAX_CONVERSATION_SETTING_CHARS = 128
const MAX_THREAD_ID_CHARS = 512
const LEGACY_WORKSPACE_FILE_CONTEXT_PREFIX =
  'The user referenced these workspace files. Use them as context for the request.'
const SAFE_FILE_REFERENCE_ONLY_PROMPT = 'Please use the referenced workspace file(s) as context.'

export type PersistedChatSession = {
  activeThreadId: string | null
  queuedMessages: QueuedUserMessage[]
  persistenceDegraded: boolean
  conversationSettingsByThread?: Record<string, ConversationRuntimeSettings>
  draftConversationSettings?: ConversationRuntimeSettings | null
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

function boundedText(value: unknown, max: number, allowEmpty = false): string | undefined {
  if (typeof value !== 'string' || value.length > max) return undefined
  const normalized = value.trim()
  return normalized || allowEmpty ? normalized : undefined
}

function conversationSettings(value: unknown): ConversationRuntimeSettings | null {
  const input = record(value)
  if (!input) return null
  const model = boundedText(input.model, MAX_CONVERSATION_SETTING_CHARS, true)
  const reasoningEffort = boundedText(input.reasoningEffort, MAX_CONVERSATION_SETTING_CHARS, true)
  const serviceTier = boundedText(input.serviceTier, MAX_CONVERSATION_SETTING_CHARS, true)
  if (model === undefined || reasoningEffort === undefined || serviceTier === undefined) return null
  return { model, reasoningEffort, serviceTier }
}

function conversationSettingsMap(value: unknown): Record<string, ConversationRuntimeSettings> | undefined {
  const input = record(value)
  if (!input) return undefined
  const output: Record<string, ConversationRuntimeSettings> = {}
  for (const [rawThreadId, rawSettings] of Object.entries(input)) {
    if (Object.keys(output).length >= MAX_CONVERSATION_SETTINGS) break
    const threadId = boundedText(rawThreadId, MAX_THREAD_ID_CHARS)
    const settings = conversationSettings(rawSettings)
    if (threadId && settings) output[threadId] = settings
  }
  return Object.keys(output).length ? output : undefined
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
  return value === 'codex' || value === 'claude' || value === 'dsh' ? value : undefined
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

function migrateLegacyWorkspaceFileContext(runtimeText: string, displayText?: string): string {
  return runtimeText.startsWith(LEGACY_WORKSPACE_FILE_CONTEXT_PREFIX)
    ? displayText ?? SAFE_FILE_REFERENCE_ONLY_PROMPT
    : runtimeText
}

function sanitizeQueuedMessage(value: unknown, restored: boolean): QueuedUserMessage | null {
  const input = record(value)
  const id = text(input?.id)
  const persistedMessageText = text(input?.text, MAX_MESSAGE_CHARS)
  if (!input || !id || !persistedMessageText) return null
  const threadId = text(input.threadId)
  const targetThreadId = text(input.targetThreadId)
  const persistedRuntimeId = runtimeId(input.runtimeId)
  const displayText = text(input.displayText, MAX_MESSAGE_CHARS)
  const messageText = migrateLegacyWorkspaceFileContext(persistedMessageText, displayText)
  const mode = text(input.mode)
  const sourceRoute = appRoute(input.sourceRoute)
  const workspaceRoot = text(input.workspaceRoot, MAX_MESSAGE_CHARS)
  const governanceProfile = input.governanceProfile === 'default' ||
    input.governanceProfile === 'write'
    ? input.governanceProfile
    : undefined
  const model = text(input.model)
  const modelLabel = text(input.modelLabel)
  const createdAt = text(input.createdAt)
  const reasoningEffort = text(input.reasoningEffort)
  const serviceTier = text(input.serviceTier)
  const permissionLevel = typeof input.permissionLevel === 'string' &&
    AGENT_PERMISSION_LEVELS.includes(input.permissionLevel as AgentPermissionLevel)
    ? input.permissionLevel as AgentPermissionLevel
    : undefined
  const workspaceLocatorResult = workspaceLocatorSchema.safeParse(input.workspaceLocator)
  const workspaceLocator = workspaceLocatorResult.success
    ? workspaceLocatorResult.data
    : undefined
  const attachmentIds = stringList(input.attachmentIds)
  const attachments = Array.isArray(input.attachments)
    ? input.attachments.map(attachment).filter((item): item is AttachmentReference => item != null)
    : []
  const fileReferences = normalizeRuntimeFileReferences(input.fileReferences)
  const failure = record(input.sendFailure)
  const failureUserBlockId = text(failure?.userBlockId)
  const failureMessage = text(failure?.message, MAX_MESSAGE_CHARS)
  const legacyDispositionWarning = failure?.kind === 'legacy-disposition-required'
  const failureAttemptedAt = finiteNumber(failure?.attemptedAt)
  const recoveryWarning = text(input.restoredAttachmentWarning, MAX_MESSAGE_CHARS)
  const delivery = record(input.deliveryAttempt)
  const deliveryStartedAt = finiteNumber(delivery?.startedAt)
  const deliveryUserBlockId = text(delivery?.userBlockId) ?? id
  const persistedDeliveryAttemptedText = text(delivery?.attemptedText, MAX_MESSAGE_CHARS)
  const deliveryAttemptedText = persistedDeliveryAttemptedText
    ? migrateLegacyWorkspaceFileContext(persistedDeliveryAttemptedText, displayText)
    : displayText ?? messageText
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
    ...(createdAt ? { createdAt } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(serviceTier ? { serviceTier } : {}),
    ...(permissionLevel ? { permissionLevel } : {}),
    ...(workspaceLocator ? { workspaceLocator } : {}),
    ...(attachmentIds?.length ? { attachmentIds } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(fileReferences.length ? { fileReferences } : {}),
    ...(failureUserBlockId && failureMessage
      ? {
          sendFailure: {
            userBlockId: failureUserBlockId,
            message: legacyDispositionWarning ? i18n.t('common:sessionInputLegacyDispositionRequired') : failureMessage,
            ...(legacyDispositionWarning ? { kind: 'legacy-disposition-required' as const } : {}),
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
    if (restored && !message.sendFailure) {
      message.sendFailure = { userBlockId: message.id, kind: 'legacy-disposition-required',
        message: i18n.t('common:sessionInputLegacyDispositionRequired') }
    }
    output.push(message)
    if (output.length >= MAX_QUEUED_MESSAGES) break
  }
  return output
}

/** Recovery checkpoint must never interpret unreadable/partial legacy storage as an empty queue. */
export function readLegacyInputRecovery(): Array<{ message: QueuedUserMessage; disposition: 'unconfirmed' | 'uncertain' }> {
  const storage = browserStorage()
  if (!storage) throw new Error('Session input storage is unavailable; recovery cannot certify an empty queue.')
  const primary = storage.getItem(CHAT_SESSION_STORAGE_KEY)
  const recovery = primary ?? storage.getItem(CHAT_SESSION_RECOVERY_STORAGE_KEY)
  if (recovery == null) return []
  if (recovery.length > MAX_PERSISTED_SESSION_CHARS) throw new Error('Saved Session input exceeds the recovery limit; explicit recovery is required.')
  const parsed = record(JSON.parse(recovery))
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.queuedMessages)) {
    throw new Error('Saved Session input is unreadable; recovery cannot certify an empty queue.')
  }
  if (parsed.queuedMessages.length > MAX_QUEUED_MESSAGES) throw new Error('Saved Session input exceeds the recovery item limit.')
  return parsed.queuedMessages.map((raw) => {
    const message = sanitizeQueuedMessage(raw, false)
    if (!message) throw new Error('Saved Session input is malformed; explicit disposition is required.')
    const uncertain = Boolean(message.deliveryAttempt || (message.sendFailure &&
      message.sendFailure.kind !== 'legacy-disposition-required'))
    return { message, disposition: uncertain ? 'uncertain' : 'unconfirmed' }
  })
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
      return null
    }
    const parsed = record(JSON.parse(raw))
    if (!parsed || parsed.version !== 1) return null
    const perThread = conversationSettingsMap(parsed.conversationSettingsByThread)
    const draft = conversationSettings(parsed.draftConversationSettings)
    return {
      activeThreadId: text(parsed.activeThreadId) ?? null,
      queuedMessages: normalizePersistedQueuedMessages(parsed.queuedMessages, true),
      persistenceDegraded,
      ...(perThread ? { conversationSettingsByThread: perThread } : {}),
      ...(parsed.draftConversationSettings === null
        ? { draftConversationSettings: null }
        : draft
          ? { draftConversationSettings: draft }
          : {})
    }
  } catch {
    return null
  }
}

/** Fail open from an invalid restored selection without discarding queued work. */
export function clearPersistedActiveThread(): void {
  const session = readPersistedChatSession()
  persistChatSession({
    activeThreadId: null,
    queuedMessages: session.queuedMessages,
    conversationSettingsByThread: session.conversationSettingsByThread,
    draftConversationSettings: session.draftConversationSettings
  })
}

export function persistChatSession(
  session: Pick<PersistedChatSession, 'activeThreadId' | 'queuedMessages'> &
    Partial<Pick<PersistedChatSession, 'conversationSettingsByThread' | 'draftConversationSettings'>>
): ChatSessionPersistenceResult {
  // A malformed old queue must not be overwritten by a new empty UI projection.
  try { readLegacyInputRecovery() } catch {
    return { degraded: true, persistedMessages: 0, droppedMessages: session.queuedMessages.length }
  }
  const perThread = conversationSettingsMap(session.conversationSettingsByThread)
  const draft = conversationSettings(session.draftConversationSettings)
  const payload = {
    version: 1,
    activeThreadId: text(session.activeThreadId) ?? null,
    // Admitted input is durable only in the Host ledger. The browser keeps
    // pre-upgrade private drafts solely until explicit user disposition.
    queuedMessages: normalizePersistedQueuedMessages(session.queuedMessages.filter((message) => !message.admissionReceipt && !message.hostManaged), false),
    ...(perThread ? { conversationSettingsByThread: perThread } : {}),
    ...(session.draftConversationSettings === null
      ? { draftConversationSettings: null }
      : draft
        ? { draftConversationSettings: draft }
        : {})
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
      queuedMessages: [...recoveryMessages, message],
      ...('conversationSettingsByThread' in payload
        ? { conversationSettingsByThread: payload.conversationSettingsByThread }
        : {}),
      ...('draftConversationSettings' in payload
        ? { draftConversationSettings: payload.draftConversationSettings }
        : {})
    })
    if (candidate.length > MAX_RECOVERY_SESSION_CHARS) break
    recoveryMessages.push(message)
  }
  const recoveryPayload = JSON.stringify({
    version: 1,
    degraded: true,
    activeThreadId: payload.activeThreadId,
    queuedMessages: recoveryMessages,
    ...('conversationSettingsByThread' in payload
      ? { conversationSettingsByThread: payload.conversationSettingsByThread }
      : {}),
    ...('draftConversationSettings' in payload
      ? { draftConversationSettings: payload.draftConversationSettings }
      : {})
  })
  const recoveryWritten = writeBrowserStorageItem(CHAT_SESSION_RECOVERY_STORAGE_KEY, recoveryPayload)
  return {
    degraded: true,
    persistedMessages: recoveryWritten ? recoveryMessages.length : 0,
    droppedMessages: payload.queuedMessages.length - (recoveryWritten ? recoveryMessages.length : 0)
  }
}

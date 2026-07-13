import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import {
  Archive,
  BarChart3,
  Check,
  CornerUpRight,
  FileEdit,
  FileText,
  Folder,
  GitFork,
  ImagePlus,
  Paperclip,
  ListTodo,
  Loader2,
  MessageCircleMore,
  Mic,
  Minimize2,
  PauseCircle,
  Pencil,
  Plus,
  PlayCircle,
  RotateCcw,
  SearchCode,
  Send,
  Sparkles,
  Square,
  Target,
  Trash2,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/sciforge-api'
import type { AgentRuntimeContextState } from '@shared/agent-runtime-contract'
import type { AgentProviderCapabilities, AttachmentReference, ReviewTarget } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import {
  isRemoteChannelThread as threadIsRemoteChannel,
  remoteChannelThreadIdsFromChannels
} from '../../store/chat-store-helpers'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import {
  composerFileReferenceKey,
  filterWorkspaceFileMentionSuggestions,
  formatComposerFileMentionToken,
  getFileMentionAtCursor,
  relativeWorkspacePath,
  removeComposerFileMentionToken,
  replaceFileMentionInInput,
  type ComposerFileMention,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import { loadWorkspaceFileIndex } from '../../lib/workspace-file-index'
import {
  COMPACT_COMMAND_ALIASES,
  getGoalPanelDraftObjective,
  getSlashQuery,
  parseBtwCommand,
  parseCompactCommand,
  parseGoalCommand,
  parseReviewCommand,
  parseSteerCommand,
  REVIEW_COMMAND_ALIASES,
  type SlashCommand,
  type SlashCommandId
} from './floating-composer-commands'
export { parseBtwCommand, parseCompactCommand, parseGoalCommand, parseReviewCommand, parseSteerCommand } from './floating-composer-commands'
import {
  formatCompactNumber,
  formatCost,
  formatPercent,
  useThreadUsageState
} from '../../hooks/use-thread-usage'
import { GitBranchPicker } from './GitBranchPicker'
import {
  FloatingComposerModelPicker,
  type ComposerReasoningEffort
} from './FloatingComposerModelPicker'
import {
  FloatingComposerQueuedMessages,
  type QueuedComposerMessage
} from './FloatingComposerQueuedMessages'
import { useComposerDraft } from './use-composer-draft'
import {
  composerDraftContextKey,
  mergeComposerInputHistory,
  readComposerDraft,
  readComposerInputHistory,
  rememberComposerInput,
  writeComposerDraft
} from './composer-input-memory'
import {
  SPEECH_TRANSCRIPTION_MAX_DURATION_MS,
  getModelRouterSettings,
  type AgentRuntimeId,
  type AppSettingsV1,
  type ModelRouterMemberProviderSettingsV1
} from '@shared/app-settings'
import {
  useSpeechToTextSettings,
  useVoiceDictation,
  type VoiceDictationIntent
} from './use-voice-dictation'
import type { ComposerChangedFile } from '../../lib/composer-change-summary'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import {
  composerReferenceFromWorkspaceReferenceDragData,
  hasWorkspaceReferenceDragData,
  type WorkspaceReferenceDragDataSource
} from '../../lib/workspace-reference-drag'

export type { ComposerFileReference } from '../../lib/composer-file-references'

export type ComposerCommentReference = {
  id: string
  label: string
  comment: string
}

type Props = {
  variant?: 'default' | 'compact'
  threadIdOverride?: string | null
  disableThreadManagementCommands?: boolean
  /** Use direct runtime steering, rather than continuation queueing, for sends while busy. */
  preferSteerWhileBusy?: boolean
  workspaceRootOverride?: string
  preferWorkspaceRootOverride?: boolean
  input: string
  setInput: (v: string) => void
  mode: 'plan' | 'agent'
  setMode: (m: 'plan' | 'agent') => void
  busy: boolean
  runtimeReady: boolean
  hasActiveThread: boolean
  composerModel: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  activeAgentRuntime?: AgentRuntimeId
  composerReasoningEffort?: string
  onComposerModelChange: (modelId: string) => void
  onActiveAgentRuntimeChange?: (runtimeId: AgentRuntimeId) => void
  onComposerReasoningEffortChange?: (effort: ComposerReasoningEffort) => void
  hideModelPicker?: boolean
  modelPickerMode?: 'select' | 'combobox'
  queuedMessages: QueuedComposerMessage[]
  queuedMessagesPersistenceDegraded?: boolean
  onRemoveQueuedMessage: (id: string) => void
  onEditQueuedMessage?: (id: string, text: string) => void
  onSteerQueuedMessage?: (id: string) => void
  onRetryQueuedMessage?: (id: string) => void
  attachments?: AttachmentReference[]
  attachmentUploadEnabled?: boolean
  attachmentUploadBusy?: boolean
  attachmentUploadError?: string | null
  fileReferenceEnabled?: boolean
  fileReferences?: ComposerFileReference[]
  commentReferences?: ComposerCommentReference[]
  webAccessAvailable?: boolean
  changedFiles?: ComposerChangedFile[]
  changedFileStats?: { added: number; removed: number } | null
  contextState?: AgentRuntimeContextState | null
  skillCommands?: Array<{
    id: string
    name: string
    description?: string
    root?: string
    scope?: 'project' | 'global'
    legacy?: boolean
    triggers?: {
      commands?: string[]
      fileTypes?: string[]
      promptPatterns?: string[]
    }
  }>
  runtimeCapabilities?: Pick<
    AgentProviderCapabilities,
    'compact' | 'fork' | 'goals' | 'review' | 'sideConversations' | 'skills' | 'steer'
  >
  sideConversationsEnabled?: boolean
  onPickAttachments?: (attachments: ComposerImageAttachmentInput[]) => void
  onPasteClipboardImage?: (options?: { silentNoImage?: boolean }) => void | Promise<void>
  onRemoveAttachment?: (id: string) => void
  onAddFileReference?: (reference: ComposerFileReference) => void
  onPreviewFileReference?: (reference: ComposerFileReference) => void
  onRemoveFileReference?: (relativePath: string, workspaceRoot?: string) => void
  onRemoveCommentReference?: (id: string) => void
  onSend: (intent?: ComposerSendIntent) => void
  onInterrupt: (options?: { discard?: boolean }) => void
  onPlanCommand?: () => void
  onReviewCommand?: (target: ReviewTarget) => void
  onOpenChanges?: () => void
  onReviewChanges?: () => void
  reviewChangesDisabled?: boolean
  /**
   * When set, the `/btw` slash command is offered. It is omitted from
   * side-conversation composers (non-goal: no nested `/btw`).
   */
  onBtwCommand?: (seedText?: string) => void
  /**
   * Hide the `/btw` slash entry (e.g. inside a side conversation).
   */
  hideBtwCommand?: boolean
}

type SkillCommand = NonNullable<Props['skillCommands']>[number]

const EMPTY_MODEL_GROUPS: ModelProviderModelGroup[] = []
const EMPTY_ATTACHMENTS: AttachmentReference[] = []
const EMPTY_FILE_REFERENCES: ComposerFileReference[] = []
const EMPTY_COMMENT_REFERENCES: ComposerCommentReference[] = []
const EMPTY_CHANGED_FILES: ComposerChangedFile[] = []
const EMPTY_SKILL_COMMANDS: SkillCommand[] = []

type ComposerTransferItem = {
  kind?: string
  type?: string
  getAsFile?: () => File | null
}

export type ComposerImageAttachmentInput = {
  file: File
  path?: string
}

export type ComposerSendIntent = {
  kind: 'image-generation'
}

export type ComposerImageTransferSource = {
  files?: ArrayLike<File> | null
  items?: ArrayLike<ComposerTransferItem> | null
}

export type ComposerClipboardImageSource = ComposerImageTransferSource & {
  getData?: (format: string) => string
}

export function composerWorkspaceReferenceDropFromTransfer(
  source: WorkspaceReferenceDragDataSource,
  options: {
    fileReferenceEnabled: boolean
    canAddFileReference: boolean
  }
): { reference: ComposerFileReference; mentionToken: string } | null {
  if (!options.fileReferenceEnabled || !options.canAddFileReference) return null
  const reference = composerReferenceFromWorkspaceReferenceDragData(source)
  if (!reference) return null
  return {
    reference,
    mentionToken: formatComposerFileMentionToken(reference.relativePath)
  }
}

function arrayLikeValues<T>(value: ArrayLike<T> | null | undefined): T[] {
  if (!value) return []
  const out: T[] = []
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (item) out.push(item)
  }
  return out
}

function isImageMimeType(value: string | undefined): boolean {
  return value?.toLowerCase().startsWith('image/') === true
}

function imageMimeTypeFromFileName(name: string | undefined): string | undefined {
  const lower = name?.toLowerCase() ?? ''
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.avif')) return 'image/avif'
  if (lower.endsWith('.heic')) return 'image/heic'
  if (lower.endsWith('.heif')) return 'image/heif'
  return undefined
}

function isPdfFile(file: File): boolean {
  return file.type.toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function comparablePath(path: string | undefined): string {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

function isProjectSkillRoot(skillRoot: string | undefined, workspaceRoot: string): boolean {
  const root = comparablePath(skillRoot)
  const workspace = comparablePath(workspaceRoot)
  return Boolean(root && workspace && (root === workspace || root.startsWith(`${workspace}/`)))
}

function isProjectSkill(skill: { root?: string; scope?: 'project' | 'global' }, workspaceRoot: string): boolean {
  return skill.scope === 'project' || (skill.scope !== 'global' && isProjectSkillRoot(skill.root, workspaceRoot))
}

function droppedPathInsideWorkspace(path: string, workspaceRoot: string): boolean {
  const filePath = comparablePath(path)
  const root = comparablePath(workspaceRoot)
  return Boolean(root && (filePath === root || filePath.startsWith(`${root}/`)))
}

function kindForDroppedPath(path: string, file: File): ComposerFileReference['kind'] {
  const lower = `${file.name || path}`.toLowerCase()
  if (isPdfFile(file) || lower.endsWith('.pdf')) return 'pdf'
  if (isImageMimeType(file.type) || Boolean(imageMimeTypeFromFileName(file.name))) return 'image'
  return 'file'
}

async function droppedWorkspaceReference(
  path: string,
  workspaceRoot: string,
  file: File
): Promise<ComposerFileReference | null> {
  if (!path || !workspaceRoot || !droppedPathInsideWorkspace(path, workspaceRoot)) return null
  const relativePath = relativeWorkspacePath(path, workspaceRoot)
  if (!relativePath) return null
  let kind = kindForDroppedPath(path, file)
  if (typeof window !== 'undefined' && typeof window.sciforge?.listWorkspaceDirectory === 'function') {
    const directory = await window.sciforge
      .listWorkspaceDirectory({ workspaceRoot, path: relativePath })
      .catch(() => ({ ok: false as const, message: '' }))
    if (directory.ok) kind = 'directory'
  }
  return {
    path: relativePath,
    relativePath,
    name: file.name || relativePath.split('/').filter(Boolean).pop() || relativePath,
    workspaceRoot,
    kind,
    ...(kind === 'image' ? { modelRouterObject: true } : {})
  }
}

function normalizedImageFile(file: File, mimeTypeHint?: string): File | null {
  const mimeType = isImageMimeType(file.type)
    ? file.type
    : isImageMimeType(mimeTypeHint)
      ? mimeTypeHint
      : imageMimeTypeFromFileName(file.name)
  if (!mimeType) return null
  if (file.type === mimeType) return file
  return new File([file], file.name || 'image', {
    type: mimeType,
    lastModified: file.lastModified
  })
}

export function imageFilesFromTransfer(source: ComposerImageTransferSource | null | undefined): File[] {
  if (!source) return []
  const files: File[] = []
  const seen = new Set<File>()
  const addFile = (file: File | null | undefined, mimeTypeHint?: string): void => {
    if (!file || seen.has(file)) return
    seen.add(file)
    const normalized = normalizedImageFile(file, mimeTypeHint)
    if (normalized) files.push(normalized)
  }

  for (const item of arrayLikeValues(source.items)) {
    if (item.kind && item.kind !== 'file') continue
    if (!isImageMimeType(item.type)) continue
    addFile(item.getAsFile?.(), item.type)
  }
  for (const file of arrayLikeValues(source.files)) {
    addFile(file)
  }
  return files
}

function pathForAttachmentFile(file: File): string | undefined {
  if (typeof window === 'undefined' || typeof window.sciforge?.getPathForFile !== 'function') return undefined
  try {
    const path = window.sciforge.getPathForFile(file)
    return path?.trim() || undefined
  } catch {
    return undefined
  }
}

export function imageAttachmentInputsFromTransfer(
  source: ComposerImageTransferSource | null | undefined
): ComposerImageAttachmentInput[] {
  if (!source) return []
  const inputs: ComposerImageAttachmentInput[] = []
  const seen = new Set<File>()
  const addFile = (file: File | null | undefined, mimeTypeHint?: string): void => {
    if (!file || seen.has(file)) return
    seen.add(file)
    const normalized = normalizedImageFile(file, mimeTypeHint)
    if (!normalized) return
    const path = pathForAttachmentFile(file)
    inputs.push({
      file: normalized,
      ...(path ? { path } : {})
    })
  }

  for (const item of arrayLikeValues(source.items)) {
    if (item.kind && item.kind !== 'file') continue
    if (!isImageMimeType(item.type)) continue
    addFile(item.getAsFile?.(), item.type)
  }
  for (const file of arrayLikeValues(source.files)) {
    addFile(file)
  }
  return inputs
}

export function attachmentInputsFromPickedFiles(files: File[]): ComposerImageAttachmentInput[] {
  return files.map((file) => {
    // Keep every explicitly-picked file: images are normalized; PDFs and explicit scientific
    // formats pass through as-is. The upload handler routes non-images by extension.
    const normalized = normalizedImageFile(file)
    const attachmentFile = normalized ?? file
    const path = pathForAttachmentFile(file)
    return {
      file: attachmentFile,
      ...(path ? { path } : {})
    }
  })
}

export function imageTransferHasImages(source: ComposerImageTransferSource | null | undefined): boolean {
  if (!source) return false
  if (arrayLikeValues(source.files).some((file) => normalizedImageFile(file) !== null)) return true
  return arrayLikeValues(source.items).some((item) =>
    (!item.kind || item.kind === 'file') && isImageMimeType(item.type)
  )
}

export function handleComposerImagePaste({
  canPickAttachment,
  clipboardData,
  preventDefault,
  onPickAttachments,
  onPasteClipboardImage
}: {
  canPickAttachment: boolean
  clipboardData: ComposerClipboardImageSource
  preventDefault: () => void
  onPickAttachments?: (attachments: ComposerImageAttachmentInput[]) => void
  onPasteClipboardImage?: (options?: { silentNoImage?: boolean }) => void | Promise<void>
}): boolean {
  if (!canPickAttachment || (!onPickAttachments && !onPasteClipboardImage)) return false
  const files = imageAttachmentInputsFromTransfer(clipboardData)
  const hasPlainText = Boolean(clipboardData.getData?.('text/plain'))
  const hasImageTransfer = imageTransferHasImages(clipboardData)
  if (files.length > 0) {
    preventDefault()
    onPickAttachments?.(files)
    return true
  }
  if (!onPasteClipboardImage) return false

  const shouldPreventDefault = !hasPlainText || hasImageTransfer
  if (shouldPreventDefault) preventDefault()
  void onPasteClipboardImage({ silentNoImage: !shouldPreventDefault })
  return shouldPreventDefault
}

export function composeInsertedTextAtSelection({
  currentValue,
  selectionStart,
  selectionEnd,
  text
}: {
  currentValue: string
  selectionStart: number
  selectionEnd: number
  text: string
}): { input: string; cursor: number } | null {
  if (!text) return null
  const boundedStart = Math.max(0, Math.min(selectionStart, currentValue.length))
  const boundedEnd = Math.max(boundedStart, Math.min(selectionEnd, currentValue.length))
  const before = currentValue.slice(0, boundedStart)
  const after = currentValue.slice(boundedEnd)
  const leadingPad = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const trailingPad = after.length > 0 && !/^\s/.test(after) ? ' ' : ''
  const insertion = `${leadingPad}${text}${trailingPad}`
  return {
    input: `${before}${insertion}${after}`,
    cursor: before.length + insertion.length - trailingPad.length
  }
}

export function formatGoalElapsedSeconds(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  if (value < 60) return `${value}s`
  const minutes = Math.floor(value / 60)
  const remainingSeconds = value % 60
  if (value < 3600) {
    return remainingSeconds === 0
      ? `${minutes}m`
      : `${minutes}m ${remainingSeconds}s`
  }
  const hours = Math.floor(value / 3600)
  const remainingMinutes = Math.floor((value % 3600) / 60)
  return remainingMinutes === 0
    ? `${hours}h`
    : `${hours}h ${remainingMinutes}m`
}

type CommonTranslate = (key: string, options?: Record<string, unknown>) => string

function formatContextNumber(value: number): string {
  return new Intl.NumberFormat().format(Math.max(0, Math.floor(value)))
}

export function formatThreadContextStateLabel(
  state: AgentRuntimeContextState,
  t: CommonTranslate
): string {
  const parts: string[] = []
  const hasContextSummary =
    (state.summarySource != null && state.summarySource !== 'none') ||
    Boolean(state.summary?.trim()) ||
    state.rawHistoryItems !== state.effectiveHistoryItems ||
    Boolean(state.triggerReason?.trim())
  if (hasContextSummary) {
    const hasCounts =
      Number.isFinite(state.rawHistoryItems) &&
      Number.isFinite(state.effectiveHistoryItems) &&
      (state.rawHistoryItems > 0 || state.effectiveHistoryItems > 0)
    const label = hasCounts
      ? t('compactionCompletedWithCounts', {
          before: formatContextNumber(state.rawHistoryItems),
          after: formatContextNumber(state.effectiveHistoryItems)
        })
      : t('compactionManualCompleted')
    parts.push(label)
    if (state.estimatedTokens != null && Number.isFinite(state.estimatedTokens) && state.estimatedTokens > 0) {
      parts.push(`${formatContextNumber(state.estimatedTokens)} tokens`)
    }
  }
  const resume = state.goalResume
  if (resume) {
    const status = t(`goalStatusShort.${resume.status ?? 'active'}`)
    const resumeParts = [`${t('goalActiveHeading')}: ${status}`]
    if (resume.resumeCount > 0) {
      resumeParts.push(`×${resume.resumeCount}`)
    }
    if (resume.lastFailureReason?.trim()) {
      resumeParts.push(resume.lastFailureReason.trim())
    }
    parts.push(resumeParts.join(' · '))
  }
  return parts.join(' · ')
}

function shouldShowThreadContextState(state: AgentRuntimeContextState): boolean {
  return Boolean(
    state.goalResume ||
    (state.summarySource != null && state.summarySource !== 'none') ||
    state.summary?.trim() ||
    state.rawHistoryItems !== state.effectiveHistoryItems ||
    state.triggerReason?.trim()
  )
}

export function isImageGenerationConfigured(
  settings: Pick<ModelRouterMemberProviderSettingsV1, 'apiKey' | 'baseUrl' | 'model'> | null | undefined
): boolean {
  return Boolean(settings?.apiKey.trim() && settings.baseUrl.trim() && settings.model.trim())
}

function useImageGenerationComposerSettings(): ModelRouterMemberProviderSettingsV1 | null {
  const [imageGeneration, setImageGeneration] = useState<ModelRouterMemberProviderSettingsV1 | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    const apply = (settings: AppSettingsV1): void => {
      if (!cancelled) setImageGeneration(getModelRouterSettings(settings).profiles.default.imageGenerator)
    }

    if (typeof window.sciforge?.getSettings === 'function') {
      void window.sciforge.getSettings().then(apply).catch(() => {
        if (!cancelled) setImageGeneration(null)
      })
    }

    const onSettingsChanged = (event: Event): void => {
      apply((event as CustomEvent<AppSettingsV1>).detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  return imageGeneration
}

export function runParsedGoalCommandForComposer({
  command,
  canOpenGoalPanel,
  setInput,
  setGoalPanelOpen,
  focusComposer,
  setActiveThreadGoal,
  setActiveThreadGoalStatus,
  clearActiveThreadGoal
}: {
  command: ReturnType<typeof parseGoalCommand>
  canOpenGoalPanel: boolean
  setInput: (value: string) => void
  setGoalPanelOpen: (open: boolean) => void
  focusComposer: () => void
  setActiveThreadGoal: (objective: string) => void | Promise<unknown>
  setActiveThreadGoalStatus: (status: 'active' | 'paused' | 'complete') => void | Promise<unknown>
  clearActiveThreadGoal: () => void | Promise<unknown>
}): boolean {
  if (command === false) return false
  if (!canOpenGoalPanel) return false
  setInput('')
  setGoalPanelOpen(false)
  if (command.action === 'menu') {
    setGoalPanelOpen(true)
    focusComposer()
    return true
  }
  if (command.action === 'set') {
    void setActiveThreadGoal(command.objective)
    return true
  }
  if (command.action === 'pause') {
    void setActiveThreadGoalStatus('paused')
    return true
  }
  if (command.action === 'resume') {
    void setActiveThreadGoalStatus('active')
    return true
  }
  if (command.action === 'clear') {
    void clearActiveThreadGoal()
    return true
  }
  if (command.action === 'complete') {
    void setActiveThreadGoalStatus('complete')
    return true
  }
  return true
}

export function FloatingComposer({
  variant = 'default',
  threadIdOverride,
  disableThreadManagementCommands = false,
  preferSteerWhileBusy = false,
  workspaceRootOverride,
  preferWorkspaceRootOverride = false,
  input,
  setInput,
  mode,
  setMode,
  busy,
  runtimeReady,
  hasActiveThread,
  composerModel,
  composerPickList,
  composerModelGroups = EMPTY_MODEL_GROUPS,
  activeAgentRuntime,
  composerReasoningEffort,
  onComposerModelChange,
  onActiveAgentRuntimeChange,
  onComposerReasoningEffortChange,
  hideModelPicker = false,
  modelPickerMode = 'select',
  queuedMessages,
  queuedMessagesPersistenceDegraded = false,
  onRemoveQueuedMessage,
  onEditQueuedMessage,
  onSteerQueuedMessage,
  onRetryQueuedMessage,
  attachments = EMPTY_ATTACHMENTS,
  attachmentUploadEnabled = false,
  attachmentUploadBusy = false,
  attachmentUploadError = null,
  fileReferenceEnabled = false,
  fileReferences = EMPTY_FILE_REFERENCES,
  commentReferences = EMPTY_COMMENT_REFERENCES,
  changedFiles = EMPTY_CHANGED_FILES,
  changedFileStats = null,
  contextState,
  skillCommands = EMPTY_SKILL_COMMANDS,
  runtimeCapabilities,
  sideConversationsEnabled,
  onPickAttachments,
  onPasteClipboardImage,
  onRemoveAttachment,
  onAddFileReference,
  onPreviewFileReference,
  onRemoveFileReference,
  onRemoveCommentReference,
  onSend,
  onInterrupt,
  onPlanCommand,
  onReviewCommand,
  onOpenChanges,
  onReviewChanges,
  reviewChangesDisabled = false,
  onBtwCommand,
  hideBtwCommand = false
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const route = useChatStore((s) => s.route)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const storeActiveThreadId = useChatStore((s) => s.activeThreadId)
  const storeBlocks = useChatStore((s) => s.blocks)
  const usageRefreshKey = useChatStore((s) => s.usageRefreshKey)
  const threads = useChatStore((s) => s.threads)
  const compactActiveThread = useChatStore((s) => s.compactActiveThread)
  const forkActiveThread = useChatStore((s) => s.forkActiveThread)
  const archiveThread = useChatStore((s) => s.archiveThread)
  const storeActiveThreadGoal = useChatStore((s) => s.activeThreadGoal)
  const storeActiveThreadContextState = useChatStore((s) => s.activeThreadContextState)
  const setActiveThreadGoal = useChatStore((s) => s.setActiveThreadGoal)
  const setActiveThreadGoalStatus = useChatStore((s) => s.setActiveThreadGoalStatus)
  const clearActiveThreadGoal = useChatStore((s) => s.clearActiveThreadGoal)
  const remoteChannels = useChatStore((s) => s.remoteChannels)
  const activeRemoteChannelId = useChatStore((s) => s.activeRemoteChannelId)
  const compact = variant === 'compact'
  const activeThreadId = threadIdOverride === undefined ? storeActiveThreadId : threadIdOverride
  const activeThreadGoal = disableThreadManagementCommands ? null : storeActiveThreadGoal
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const activeRemoteChannel = useMemo(
    () => remoteChannels.find((channel) => channel.id === activeRemoteChannelId) ?? null,
    [activeRemoteChannelId, remoteChannels]
  )
  const activeThreadWorkspace = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId)?.workspace
    : ''
  const activeThread = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId) ?? null
    : null
  const remoteChannelThreadIds = useMemo(
    () => remoteChannelThreadIdsFromChannels(remoteChannels),
    [remoteChannels]
  )
  const isActiveRemoteChannelThread = Boolean(
    activeThreadId &&
    (
      remoteChannelThreadIds.has(activeThreadId) ||
      (activeThread && threadIsRemoteChannel(activeThread, remoteChannels))
    )
  )
  const activeThreadArchived = activeThread?.archived === true
  const showThreadUsageFooter = !compact && route === 'chat' && Boolean(activeThreadId) && runtimeReady
  const threadUsageState = useThreadUsageState(
    activeThreadId,
    showThreadUsageFooter,
    `${activeThread?.updatedAt ?? ''}:${busy ? 'busy' : 'idle'}:${usageRefreshKey}`
  )
  const threadUsage = threadUsageState.usage
  const preferredWorkspaceRoot = preferWorkspaceRootOverride
    ? workspaceRootOverride || activeThreadWorkspace
    : activeThreadWorkspace || workspaceRootOverride
  const effectiveWorkspaceRoot = normalizeWorkspaceRoot(preferredWorkspaceRoot || workspaceRoot)
  const remoteChannelAgentName =
    activeRemoteChannel?.agentProfile.name.trim()
    || activeRemoteChannel?.label.trim()
    || t('remoteChannelEmptyHeroFallbackName')
  const remoteChannelHasInboundConversation = Boolean(
    activeThreadId ||
    Object.values(activeRemoteChannel?.agentThreadIds ?? {}).some((threadId) => threadId.trim()) ||
    activeRemoteChannel?.conversations.some((conversation) =>
      Object.values(conversation.agentThreadIds ?? {}).some((threadId) => threadId.trim())
    ) ||
    activeRemoteChannel?.conversations.length ||
    activeRemoteChannel?.remoteSession?.chatId?.trim()
  )

  const canEditComposer = isActiveRemoteChannelThread ? remoteChannelHasInboundConversation : true
  const canCompose = runtimeReady && (
    isActiveRemoteChannelThread
      ? remoteChannelHasInboundConversation
      : (hasActiveThread || !!effectiveWorkspaceRoot)
  )
  const canChangeModel = canCompose && !busy
  const canSend = canCompose && (
    input.trim().length > 0 ||
    (attachmentUploadEnabled && attachments.length > 0) ||
    (fileReferenceEnabled && fileReferences.length > 0) ||
    commentReferences.length > 0
  )
  const canOpenAttachmentPicker = canEditComposer && Boolean(onPickAttachments) && !attachmentUploadBusy
  const canPickAttachment = canOpenAttachmentPicker && attachmentUploadEnabled
  const imageGenerationSettings = useImageGenerationComposerSettings()
  const imageGenerationConfigured = isImageGenerationConfigured(imageGenerationSettings)
  const showImageGenerationMenuItem = !compact && route === 'chat' && !isActiveRemoteChannelThread
  const canCreateImageRequest = showImageGenerationMenuItem && canCompose
  const runtimeSupportsCompact = runtimeCapabilities?.compact !== false
  const runtimeSupportsFork = runtimeCapabilities?.fork !== false
  const runtimeSupportsGoals = runtimeCapabilities?.goals !== false
  const runtimeSupportsReview = runtimeCapabilities?.review !== false
  const runtimeSupportsSideConversations =
    sideConversationsEnabled ?? (
      runtimeSupportsFork &&
      runtimeCapabilities?.sideConversations !== false
    )
  const runtimeSupportsSkills = runtimeCapabilities?.skills !== false
  const runtimeSupportsSteer = runtimeCapabilities?.steer !== false
  const showIntentToolbar = !compact && route === 'chat'
  const showComposerMenuButton = showIntentToolbar
  const showAttachmentToolbarButton = Boolean(onPickAttachments)
  const canTogglePlanMode = canCompose && Boolean(onPlanCommand)
  const canOpenGoalPanel =
    !disableThreadManagementCommands && canCompose && !isActiveRemoteChannelThread && runtimeSupportsGoals
  const canRunReview = canCompose && !isActiveRemoteChannelThread && runtimeSupportsReview && Boolean(onReviewCommand)
  const canOpenComposerMenu = showComposerMenuButton && (
    showImageGenerationMenuItem ||
    canOpenAttachmentPicker ||
    canTogglePlanMode ||
    canOpenGoalPanel ||
    canRunReview
  )
  const showToolbarStartControls = showAttachmentToolbarButton || showComposerMenuButton
  const showChangeSummary =
    !compact &&
    route === 'chat' &&
    changedFiles.length > 0 &&
    (Boolean(onOpenChanges) || (runtimeSupportsReview && Boolean(onReviewChanges)))
  const effectiveChangedFileStats = changedFileStats ?? changedFiles.reduce(
    (stats, file) => ({
      added: stats.added + file.added,
      removed: stats.removed + file.removed
    }),
    { added: 0, removed: 0 }
  )
  const visibleChangedFiles = changedFiles.slice(0, 3)
  const hiddenChangedFileCount = Math.max(0, changedFiles.length - visibleChangedFiles.length)
  const stretchModelPicker =
    compact && modelPickerMode === 'combobox' && !showToolbarStartControls && !hideModelPicker
  const remembersComposerInput = !compact && !disableThreadManagementCommands
  const composerDraftKey = composerDraftContextKey({
    threadId: activeThreadId,
    workspaceRoot: effectiveWorkspaceRoot
  })
  const [rememberedInputHistory, setRememberedInputHistory] = useState(() => readComposerInputHistory())
  const activeThreadInputHistory = useMemo(
    () => storeBlocks.filter((block) => block.kind === 'user').map((block) => block.text),
    [storeBlocks]
  )
  const inputHistory = useMemo(
    () => remembersComposerInput
      // Thread blocks are a fallback for older or externally-created messages.
      // Persisted composer memory is appended last because it tracks the actual
      // send order across threads and must win recency when entries overlap.
      ? mergeComposerInputHistory(activeThreadInputHistory, rememberedInputHistory)
      : activeThreadInputHistory,
    [activeThreadInputHistory, rememberedInputHistory, remembersComposerInput]
  )
  const activeDraftKeyRef = useRef<string | null>(null)
  const skipDraftPersistenceRef = useRef(false)
  const [composerCursor, setComposerCursor] = useState(() => input.length)
  const [dismissedFileMentionKey, setDismissedFileMentionKey] = useState<string | null>(null)
  const draft = useComposerDraft({
    input,
    canCompose: canEditComposer,
    historyItems: inputHistory,
    setInput,
    onHistoryInput: (value) => {
      setComposerCursor(value.length)
      setDismissedFileMentionKey(null)
    }
  })
  const slashQuery = getSlashQuery(input)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [fileMentionSuggestions, setFileMentionSuggestions] = useState<ComposerFileReference[]>([])
  const [fileMentionLoading, setFileMentionLoading] = useState(false)
  const [selectedFileMentionIndex, setSelectedFileMentionIndex] = useState(0)
  const [composerMenuOpen, setComposerMenuOpen] = useState(false)
  const [imageGenerationMode, setImageGenerationMode] = useState(false)
  const [goalPanelOpen, setGoalPanelOpen] = useState(false)
  const [goalRuntimeNowMs, setGoalRuntimeNowMs] = useState(() => Date.now())
  const [voiceNowMs, setVoiceNowMs] = useState(() => Date.now())
  const [voiceLevel, setVoiceLevel] = useState(0)
  const composerRootRef = useRef<HTMLDivElement | null>(null)
  const composerMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const composerMenuPanelRef = useRef<HTMLDivElement | null>(null)
  const goalPanelRef = useRef<HTMLDivElement | null>(null)
  const goalRuntimeStartedAtRef = useRef<number | null>(null)
  const pendingVoiceSendInputRef = useRef<string | null>(null)
  const imageGenerationModeRef = useRef(false)
  const pendingImageGenerationSendRef = useRef(false)
  const speechToText = useSpeechToTextSettings()

  useEffect(() => {
    if (!remembersComposerInput) return
    const previousKey = activeDraftKeyRef.current
    if (previousKey === composerDraftKey) return
    if (previousKey) writeComposerDraft(previousKey, input)
    const restored = readComposerDraft(composerDraftKey)
    activeDraftKeyRef.current = composerDraftKey
    skipDraftPersistenceRef.current = true
    if (restored !== input) setInput(restored)
  }, [composerDraftKey, input, remembersComposerInput, setInput])

  useEffect(() => {
    if (!remembersComposerInput || activeDraftKeyRef.current !== composerDraftKey) return
    if (skipDraftPersistenceRef.current) {
      skipDraftPersistenceRef.current = false
      return
    }
    writeComposerDraft(composerDraftKey, input)
  }, [composerDraftKey, input, remembersComposerInput])

  useEffect(() => {
    imageGenerationModeRef.current = imageGenerationMode
  }, [imageGenerationMode])

  useEffect(() => {
    if (!pendingImageGenerationSendRef.current || input.trim().length > 0) return
    pendingImageGenerationSendRef.current = false
    imageGenerationModeRef.current = false
    setImageGenerationMode(false)
  }, [input])

  useEffect(() => {
    if (imageGenerationMode && !showImageGenerationMenuItem) {
      pendingImageGenerationSendRef.current = false
      imageGenerationModeRef.current = false
      setImageGenerationMode(false)
    }
  }, [imageGenerationMode, showImageGenerationMenuItem])

  const placeholder = !runtimeReady
    ? t('runtimeActionNeedsConnection')
    : !hasActiveThread && !effectiveWorkspaceRoot
      ? t('workspaceRequiredToCreateThread')
      : goalPanelOpen && !isActiveRemoteChannelThread
      ? t('goalComposerPlaceholder')
      : busy
        ? preferSteerWhileBusy && runtimeSupportsSteer
          ? t('composerSteerPlaceholder')
          : t('composerQueuePlaceholder')
        : imageGenerationMode
          ? t('composerImageGenerationPlaceholder')
          : isActiveRemoteChannelThread
            ? remoteChannelHasInboundConversation
              ? t('remoteChannelPlaceholder', { name: remoteChannelAgentName })
              : t('remoteChannelPlaceholderNeedsInbound')
            : mode === 'plan'
              ? t('composerPlanPlaceholder')
              : hasActiveThread
                ? t('placeholder')
                : t('composerStartsThread')
  const footerHint = !runtimeReady
    ? t('composerOfflineHint')
    : !hasActiveThread && !effectiveWorkspaceRoot
      ? t('composerWorkspaceHint')
      : isActiveRemoteChannelThread
          ? remoteChannelHasInboundConversation
            ? t('remoteChannelComposerHint')
            : t('remoteChannelComposerHintNeedsInbound')
          : t('composerSlashHint')
  const slashCommands = useMemo<SlashCommand[]>(() => {
    const threadActionDisabled = !runtimeReady || busy || !activeThreadId
    const steerActionDisabled = !runtimeReady || !busy || !activeThreadId || !runtimeSupportsSteer
    const goalActionDisabled = !canOpenGoalPanel
    const commands: SlashCommand[] = []
    if (onPlanCommand) {
      commands.push({
        id: 'plan',
        title: t('slashCommandPlanTitle'),
        description: t('slashCommandPlanDescription'),
        keywords: ['plan', 'planner', 'planning', '规划', '计划'],
        icon: <ListTodo className="h-4 w-4" strokeWidth={1.9} />
      })
    }

    if (!isActiveRemoteChannelThread) {
      const dynamicSkillCommands = runtimeSupportsSkills
        ? skillCommands
          .filter((skill) => skill.id.trim() && skill.name.trim())
          .sort((left, right) => {
            const leftProject = isProjectSkill(left, effectiveWorkspaceRoot)
            const rightProject = isProjectSkill(right, effectiveWorkspaceRoot)
            if (leftProject !== rightProject) return leftProject ? -1 : 1
            return left.name.localeCompare(right.name)
          })
          .slice(0, 40)
          .map<SlashCommand>((skill) => {
            const prompt = `/skill:${skill.id} `
            const scopeLabel = isProjectSkill(skill, effectiveWorkspaceRoot)
              ? t('slashSkillScopeProject')
              : t('slashSkillScopeGlobal')
            const triggers = [
              ...(skill.triggers?.commands ?? []),
              ...(skill.triggers?.fileTypes ?? []),
              ...(skill.triggers?.promptPatterns ?? [])
            ]
            return {
              id: `skill:${skill.id}`,
              kind: 'skill',
              title: skill.name,
              description: skill.description?.trim() || t('slashSkillDescriptionFallback'),
              keywords: [skill.id, skill.name, skill.root ?? '', scopeLabel, 'skill', '技能', ...triggers],
              icon: <Sparkles className="h-4 w-4" strokeWidth={1.9} />,
              badge: prompt.trim(),
              scopeLabel,
              skillPrompt: prompt,
              disabled: !runtimeReady
            }
          })
        : []
      commands.push(...dynamicSkillCommands)

      if (!disableThreadManagementCommands && runtimeSupportsGoals) {
        commands.push({
          id: 'goal',
          title: t('slashCommandGoalTitle'),
          description: t('slashCommandGoalDescription'),
          keywords: ['goal', 'objective', 'target', '目标', '任务'],
          icon: <Target className="h-4 w-4" strokeWidth={1.9} />,
          disabled: goalActionDisabled
        })
      }

      if (!disableThreadManagementCommands && onBtwCommand && !hideBtwCommand && runtimeSupportsSideConversations) {
        // `/btw` is available even while the main thread is busy — the
        // point of the command is to run a parallel aside next to a
        // running task.
        commands.push({
          id: 'btw',
          title: t('slashCommandBtwTitle'),
          description: t('slashCommandBtwDescription'),
          keywords: ['btw', 'by-the-way', 'aside', 'side', '顺便', '旁支'],
          icon: <MessageCircleMore className="h-4 w-4" strokeWidth={1.9} />,
          disabled: !runtimeReady || !activeThreadId
        })
      }

      if (!disableThreadManagementCommands && runtimeSupportsSteer) {
        commands.push({
          id: 'steer',
          title: t('slashCommandSteerTitle'),
          description: t('slashCommandSteerDescription'),
          keywords: ['steer', 'inject', 'guide', '引导', '注入'],
          icon: <CornerUpRight className="h-4 w-4" strokeWidth={1.9} />,
          badge: '/steer',
          disabled: steerActionDisabled
        })
      }

      if (!disableThreadManagementCommands && onReviewCommand && runtimeSupportsReview) {
        commands.push({
          id: 'review',
          title: t('slashCommandReviewTitle'),
          description: t('slashCommandReviewDescription'),
          keywords: REVIEW_COMMAND_ALIASES,
          icon: <SearchCode className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        })
      }

      if (!disableThreadManagementCommands && runtimeSupportsCompact) {
        commands.push({
          id: 'compact',
          title: t('slashCommandCompactTitle'),
          description: t('slashCommandCompactDescription'),
          keywords: COMPACT_COMMAND_ALIASES,
          icon: <Minimize2 className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        })
      }
      if (!disableThreadManagementCommands && runtimeSupportsFork) {
        commands.push({
          id: 'fork',
          title: t('slashCommandForkTitle'),
          description: t('slashCommandForkDescription'),
          keywords: ['fork', 'branch', 'copy', '分叉', '复制'],
          icon: <GitFork className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        })
      }

      if (disableThreadManagementCommands) {
        // Child-agent and embedded composers reuse the same input UI
        // without exposing commands that mutate the main selected thread.
      } else if (activeThreadArchived) {
        commands.push({
          id: 'restore',
          title: t('slashCommandRestoreTitle'),
          description: t('slashCommandRestoreDescription'),
          keywords: ['restore', 'unarchive', '恢复'],
          icon: <RotateCcw className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        })
      } else {
        commands.push({
          id: 'archive',
          title: t('slashCommandArchiveTitle'),
          description: t('slashCommandArchiveDescription'),
          keywords: ['archive', 'hide', '归档'],
          icon: <Archive className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        })
      }
    }

    return commands
  }, [
    activeThreadArchived,
    activeThreadId,
    busy,
    canOpenGoalPanel,
    disableThreadManagementCommands,
    effectiveWorkspaceRoot,
    hideBtwCommand,
    onBtwCommand,
    onPlanCommand,
    onReviewCommand,
    isActiveRemoteChannelThread,
    runtimeReady,
    runtimeSupportsCompact,
    runtimeSupportsFork,
    runtimeSupportsGoals,
    runtimeSupportsReview,
    runtimeSupportsSideConversations,
    runtimeSupportsSkills,
    runtimeSupportsSteer,
    skillCommands,
    t
  ])

  const filteredSlashCommands = useMemo(() => {
    if (slashQuery == null) return []
    if (!slashQuery) return slashCommands
    return slashCommands.filter((command) => {
      const haystack = [command.id, command.title, command.description, ...command.keywords]
      return haystack.some((part) => part.toLowerCase().includes(slashQuery))
    })
  }, [slashCommands, slashQuery])

  const highlightedSlashCommand =
    filteredSlashCommands.length > 0
      ? filteredSlashCommands[Math.min(selectedCommandIndex, filteredSlashCommands.length - 1)]
      : null
  const activeFileMention = useMemo<ComposerFileMention | null>(() => {
    if (!fileReferenceEnabled || slashQuery != null || !effectiveWorkspaceRoot) return null
    return getFileMentionAtCursor(input, composerCursor)
  }, [composerCursor, effectiveWorkspaceRoot, fileReferenceEnabled, input, slashQuery])
  const activeFileMentionKey = activeFileMention
    ? `${activeFileMention.start}:${activeFileMention.query}:${activeFileMention.quoted ? 'q' : 'p'}`
    : null
  const showFileMentionMenu =
    canCompose &&
    Boolean(activeFileMention) &&
    activeFileMentionKey !== dismissedFileMentionKey &&
    !composerMenuOpen &&
    !goalPanelOpen
  const highlightedFileMention =
    fileMentionSuggestions.length > 0
      ? fileMentionSuggestions[Math.min(selectedFileMentionIndex, fileMentionSuggestions.length - 1)]
      : null
  const parsedGoalCommand = parseGoalCommand(input)
  const parsedSteerCommand = parseSteerCommand(input)
  const goalPanelDraftObjective = getGoalPanelDraftObjective(input, goalPanelOpen)
  const canSetGoalPanelDraft =
    !isActiveRemoteChannelThread
    && runtimeReady
    && canOpenGoalPanel
    && goalPanelDraftObjective.length > 0
  const primaryActionLabel = highlightedSlashCommand
    ? t('slashCommandApply')
    : canSetGoalPanelDraft
      ? t('goalSetCurrentInput')
    : busy
      ? (preferSteerWhileBusy || parsedSteerCommand !== false) && runtimeSupportsSteer
        ? t('steerMessage')
        : t('queueContinuation')
      : imageGenerationMode
        ? t('composerMenuCreateImage')
      : t('send')
  const primaryActionDisabled = highlightedSlashCommand
    ? highlightedSlashCommand.disabled === true
    : canSetGoalPanelDraft
      ? false
    : !canSend
  const primaryActionLoading = !runtimeReady
  const goalRuntimeStartedAtMs = goalRuntimeStartedAtRef.current
  const liveGoalElapsedSeconds =
    busy && activeThreadGoal?.status === 'active' && goalRuntimeStartedAtMs != null
      ? Math.max(0, Math.floor((goalRuntimeNowMs - goalRuntimeStartedAtMs) / 1000))
      : 0
  const goalElapsedLabel = activeThreadGoal
    ? formatGoalElapsedSeconds((activeThreadGoal.timeUsedSeconds ?? 0) + liveGoalElapsedSeconds)
    : ''
  const goalBannerLabel = activeThreadGoal
    ? activeThreadGoal.status === 'active'
      ? t('goalActiveHeading')
      : t(`goalStatusShort.${activeThreadGoal.status}`)
    : ''
  const goalMenuChecked = activeThreadGoal?.status === 'active'
  const activeThreadContextState = contextState === undefined
    ? storeActiveThreadContextState
    : contextState
  const contextStateLabel = activeThreadContextState
    ? formatThreadContextStateLabel(activeThreadContextState, t)
    : ''
  const contextStateTitle = activeThreadContextState?.summary?.trim()
    ? `${contextStateLabel}\n\n${activeThreadContextState.summary.trim()}`
    : contextStateLabel
  const showContextStateBanner =
    !compact &&
    Boolean(activeThreadContextState && contextStateLabel && shouldShowThreadContextState(activeThreadContextState)) &&
    slashQuery == null &&
    !goalPanelOpen &&
    !composerMenuOpen

  useEffect(() => {
    setSelectedCommandIndex(0)
  }, [slashQuery])

  useEffect(() => {
    setSelectedFileMentionIndex(0)
  }, [activeFileMentionKey])

  useEffect(() => {
    if (slashQuery != null || goalPanelOpen) setComposerMenuOpen(false)
  }, [goalPanelOpen, slashQuery])

  useEffect(() => {
    if (!showFileMentionMenu || !activeFileMention || !effectiveWorkspaceRoot) {
      setFileMentionSuggestions((current) => (current.length === 0 ? current : []))
      setFileMentionLoading(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setFileMentionLoading(true)
      void loadWorkspaceFileIndex(effectiveWorkspaceRoot)
        .then((index) => {
          if (cancelled) return
          setFileMentionSuggestions(
            filterWorkspaceFileMentionSuggestions(index.files, activeFileMention.query, fileReferences)
          )
        })
        .catch(() => {
          if (!cancelled) setFileMentionSuggestions([])
        })
        .finally(() => {
          if (!cancelled) setFileMentionLoading(false)
        })
    }, 80)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeFileMention, effectiveWorkspaceRoot, fileReferences, showFileMentionMenu])

  useEffect(() => {
    if (!composerMenuOpen && !goalPanelOpen) return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (composerMenuButtonRef.current?.contains(target)) return
      if (composerMenuPanelRef.current?.contains(target)) return
      if (goalPanelRef.current?.contains(target)) return
      setComposerMenuOpen(false)
      setGoalPanelOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setComposerMenuOpen(false)
      setGoalPanelOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [composerMenuOpen, goalPanelOpen])

  useEffect(() => {
    const shouldTimeGoal = busy && activeThreadGoal?.status === 'active'
    if (!shouldTimeGoal) {
      goalRuntimeStartedAtRef.current = null
      setGoalRuntimeNowMs(Date.now())
      return
    }

    if (goalRuntimeStartedAtRef.current == null) {
      const startedAt = Date.now()
      goalRuntimeStartedAtRef.current = startedAt
      setGoalRuntimeNowMs(startedAt)
    }

    const interval = window.setInterval(() => {
      setGoalRuntimeNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(interval)
  }, [busy, activeThreadGoal?.createdAt, activeThreadGoal?.objective, activeThreadGoal?.status])

  const applySlashCommand = (commandId: SlashCommandId): void => {
    if (commandId.startsWith('skill:')) {
      if (!runtimeSupportsSkills) return
      const command = slashCommands.find((item) => item.id === commandId)
      if (command?.skillPrompt) {
        setInput(command.skillPrompt)
        draft.focusComposer()
      }
      return
    }
    if (commandId === 'plan') {
      setInput('')
      setMode('plan')
      onPlanCommand?.()
      draft.focusComposer()
      return
    }
    if (commandId === 'compact') {
      if (!runtimeSupportsCompact) return
      setInput('')
      void compactActiveThread()
      draft.focusComposer()
      return
    }
    if (commandId === 'goal') {
      if (!runtimeSupportsGoals) return
      setInput('')
      setGoalPanelOpen(true)
      draft.focusComposer()
      return
    }
    if (commandId === 'review' && onReviewCommand) {
      if (!runtimeSupportsReview) return
      setInput('')
      void onReviewCommand({ kind: 'uncommittedChanges' })
      draft.focusComposer()
      return
    }
    if (commandId === 'fork') {
      if (!runtimeSupportsFork) return
      setInput('')
      void forkActiveThread()
      draft.focusComposer()
      return
    }
    if (commandId === 'archive' && activeThreadId) {
      setInput('')
      void archiveThread(activeThreadId, true)
      draft.focusComposer()
      return
    }
    if (commandId === 'restore' && activeThreadId) {
      setInput('')
      void archiveThread(activeThreadId, false)
      draft.focusComposer()
      return
    }
    if (commandId === 'btw' && onBtwCommand) {
      if (!runtimeSupportsSideConversations) return
      // Empty aside — open a side conversation without a seed question.
      setInput('')
      void onBtwCommand()
      return
    }
    if (commandId === 'steer') {
      if (!runtimeSupportsSteer) return
      setInput('/steer ')
      draft.focusComposer()
      return
    }
  }

  const runGoalCommand = (command: ReturnType<typeof parseGoalCommand>): boolean => {
    return runParsedGoalCommandForComposer({
      command,
      canOpenGoalPanel,
      setInput,
      setGoalPanelOpen,
      focusComposer: draft.focusComposer,
      setActiveThreadGoal,
      setActiveThreadGoalStatus,
      clearActiveThreadGoal
    })
  }

  const setGoalFromComposerInput = (): boolean => {
    if (!canSetGoalPanelDraft) return false
    setInput('')
    setGoalPanelOpen(false)
    void setActiveThreadGoal(goalPanelDraftObjective)
    draft.focusComposer()
    return true
  }

  const handleComposerMenuButtonClick = (): void => {
    if (!canOpenComposerMenu) return
    setGoalPanelOpen(false)
    setComposerMenuOpen((open) => !open)
    draft.focusComposer()
  }

  const handleAttachmentMenuClick = (): void => {
    if (!canOpenAttachmentPicker || !onPickAttachments) return
    setComposerMenuOpen(false)
    fileInputRef.current?.click()
    draft.focusComposer()
  }

  const handleCreateImageMenuClick = (): void => {
    if (!canCreateImageRequest) return
    setComposerMenuOpen(false)
    setGoalPanelOpen(false)
    setMode('agent')
    imageGenerationModeRef.current = true
    setImageGenerationMode(true)
    draft.focusComposer()
  }

  const handlePlanToolbarClick = (): void => {
    if (!canTogglePlanMode) return
    setComposerMenuOpen(false)
    if (mode === 'plan') {
      setMode('agent')
    } else {
      setMode('plan')
      onPlanCommand?.()
    }
    draft.focusComposer()
  }

  const handleGoalMenuClick = (): void => {
    if (!canOpenGoalPanel) return
    setComposerMenuOpen(false)
    if (activeThreadGoal?.status === 'active') {
      void setActiveThreadGoalStatus('paused')
    } else if (activeThreadGoal) {
      void setActiveThreadGoalStatus('active')
    } else {
      setGoalPanelOpen(true)
    }
    draft.focusComposer()
  }

  const syncComposerCursor = (element = draft.textareaRef.current): void => {
    if (!element) return
    setComposerCursor(element.selectionStart ?? input.length)
  }

  const applyFileMention = (reference: ComposerFileReference | null): void => {
    if (!reference || !activeFileMention) return
    const next = replaceFileMentionInInput(input, activeFileMention, reference)
    setInput(next.input)
    onAddFileReference?.(reference)
    setDismissedFileMentionKey(null)
    window.requestAnimationFrame(() => {
      const textarea = draft.textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.cursor, next.cursor)
      setComposerCursor(next.cursor)
    })
  }

  const removeFileReference = (reference: ComposerFileReference): void => {
    onRemoveFileReference?.(reference.relativePath, reference.workspaceRoot)
    const relativePath = reference.relativePath
    const nextInput = removeComposerFileMentionToken(input, relativePath)
    if (nextInput !== input) {
      setInput(nextInput)
      window.requestAnimationFrame(() => syncComposerCursor())
    }
    draft.focusComposer()
  }

  const primaryActionRef = useRef<() => void>(() => undefined)
  primaryActionRef.current = (): void => {
    if (highlightedSlashCommand) {
      if (highlightedSlashCommand.disabled) return
      applySlashCommand(highlightedSlashCommand.id)
      return
    }
    if (!disableThreadManagementCommands && setGoalFromComposerInput()) {
      return
    }
    if (!disableThreadManagementCommands && runGoalCommand(parsedGoalCommand)) {
      return
    }
    const compactCommand = parseCompactCommand(input)
    if (!disableThreadManagementCommands && compactCommand) {
      const command = slashCommands.find((item) => item.id === 'compact')
      if (!command || command.disabled || !runtimeSupportsCompact) return
      setInput('')
      void compactActiveThread(compactCommand.reason)
      draft.focusComposer()
      return
    }
    if (!disableThreadManagementCommands && onReviewCommand && runtimeSupportsReview) {
      const reviewCommand = parseReviewCommand(input)
      if (reviewCommand !== false) {
        const command = slashCommands.find((item) => item.id === 'review')
        if (!command || command.disabled) return
        setInput('')
        void onReviewCommand(reviewCommand)
        draft.focusComposer()
        return
      }
    }
    // Send-time interception: `/btw <question>` is treated as a side
    // conversation spawn, mirroring the plan-mode interception.
    if (!disableThreadManagementCommands && onBtwCommand && !hideBtwCommand && runtimeSupportsSideConversations) {
      const parsed = parseBtwCommand(input)
      if (parsed !== false) {
        setInput('')
        void onBtwCommand(parsed ?? undefined)
        return
      }
    }
    const shouldUseImageGeneration = imageGenerationMode || imageGenerationModeRef.current
    const intent = shouldUseImageGeneration ? { kind: 'image-generation' as const } : undefined
    if (shouldUseImageGeneration) {
      pendingImageGenerationSendRef.current = true
    }
    if (remembersComposerInput && input.trim()) {
      setRememberedInputHistory(rememberComposerInput(input))
    }
    onSend(intent)
  }
  const handlePrimaryAction = useCallback((): void => {
    primaryActionRef.current()
  }, [])

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const sendByEnter =
      event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey
    const composing = draft.isComposingEvent(event)

    if (!composing && showFileMentionMenu) {
      if (event.key === 'ArrowDown' && fileMentionSuggestions.length > 0) {
        event.preventDefault()
        setSelectedFileMentionIndex((current) => (current + 1) % fileMentionSuggestions.length)
        return
      }
      if (event.key === 'ArrowUp' && fileMentionSuggestions.length > 0) {
        event.preventDefault()
        setSelectedFileMentionIndex((current) =>
          current === 0 ? fileMentionSuggestions.length - 1 : current - 1
        )
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && highlightedFileMention) {
        event.preventDefault()
        applyFileMention(highlightedFileMention)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissedFileMentionKey(activeFileMentionKey)
        setFileMentionSuggestions([])
        return
      }
    }

    if (!composing && slashQuery != null) {
      if (event.key === 'ArrowDown' && filteredSlashCommands.length > 0) {
        event.preventDefault()
        setSelectedCommandIndex((current) => (current + 1) % filteredSlashCommands.length)
        return
      }
      if (event.key === 'ArrowUp' && filteredSlashCommands.length > 0) {
        event.preventDefault()
        setSelectedCommandIndex((current) =>
          current === 0 ? filteredSlashCommands.length - 1 : current - 1
        )
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setInput('')
        return
      }
    }

    if (!composing && remembersComposerInput && draft.navigateHistory(event)) {
      event.preventDefault()
      return
    }

    if (!sendByEnter || composing) return

    event.preventDefault()
    handlePrimaryAction()
  }

  const handleComposerShellMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!canEditComposer) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest("button,input,textarea,select,a,summary,[role='button'],[contenteditable='true']")
    ) {
      return
    }
    event.preventDefault()
    draft.textareaRef.current?.focus()
  }

  useEffect(() => {
    if (compact || route !== 'chat' || !canEditComposer) return
    const active = document.activeElement
    const activeIsExternalEditor =
      active instanceof HTMLElement &&
      Boolean(active.closest("input,textarea,select,[contenteditable='true']")) &&
      !composerRootRef.current?.contains(active)
    if (activeIsExternalEditor) return

    const frame = window.requestAnimationFrame(() => {
      const current = document.activeElement
      const currentIsExternalEditor =
        current instanceof HTMLElement &&
        Boolean(current.closest("input,textarea,select,[contenteditable='true']")) &&
        !composerRootRef.current?.contains(current)
      if (!currentIsExternalEditor) {
        draft.textareaRef.current?.focus()
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeThreadId, canEditComposer, compact, route, runtimeReady, draft.textareaRef])

  const handleAttachmentInput = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = attachmentInputsFromPickedFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
    if (files.length === 0 || !onPickAttachments) return
    onPickAttachments(files)
  }

  const handleComposerPaste = (event: ReactClipboardEvent<HTMLElement>): void => {
    handleComposerImagePaste({
      canPickAttachment,
      clipboardData: event.clipboardData,
      preventDefault: () => event.preventDefault(),
      onPickAttachments,
      onPasteClipboardImage
    })
  }

  const handleComposerDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    const dataTransferTypes = Array.from(event.dataTransfer.types ?? [])
    const canAcceptImages = canPickAttachment && imageTransferHasImages(event.dataTransfer)
    const canAcceptWorkspaceReference =
      fileReferenceEnabled &&
      Boolean(onAddFileReference) &&
      hasWorkspaceReferenceDragData(event.dataTransfer)
    if (!dataTransferTypes.includes('Files') && !canAcceptImages && !canAcceptWorkspaceReference) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const insertTextAtComposerCursor = (text: string): { input: string; cursor: number } | null => {
    const textarea = draft.textareaRef.current
    const currentValue = input
    const selectionStart = textarea?.selectionStart ?? composerCursor ?? currentValue.length
    const selectionEnd = textarea?.selectionEnd ?? selectionStart
    const next = composeInsertedTextAtSelection({ currentValue, selectionStart, selectionEnd, text })
    if (!next) return null
    setInput(next.input)
    window.requestAnimationFrame(() => {
      const el = draft.textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.cursor, next.cursor)
      setComposerCursor(next.cursor)
    })
    return next
  }

  const handleVoiceDictationText = (text: string, intent: VoiceDictationIntent): void => {
    const next = insertTextAtComposerCursor(text)
    if (!next || intent !== 'send') return
    pendingVoiceSendInputRef.current = next.input
    if (next.input === input) {
      window.setTimeout(() => {
        if (pendingVoiceSendInputRef.current !== next.input) return
        pendingVoiceSendInputRef.current = null
        handlePrimaryAction()
      }, 0)
    }
  }

  const voiceDictation = useVoiceDictation({
    speechToText,
    onText: handleVoiceDictationText
  })
  const voiceDictationStatus = voiceDictation.status
  const getVoiceDictationLevel = voiceDictation.getLevel
  const voiceAvailable = route === 'chat' && speechToText !== null
  const showVoiceControl = route === 'chat' && (
    voiceAvailable ||
    voiceDictationStatus !== 'idle' ||
    Boolean(voiceDictation.error)
  )
  const voiceControlDisabled = voiceDictationStatus === 'transcribing' || (
    voiceDictationStatus !== 'recording' &&
    (!voiceAvailable || !canEditComposer || !canCompose)
  )
  const voiceElapsedSeconds = voiceDictationStatus === 'recording'
    ? Math.max(0, Math.floor((voiceNowMs - voiceDictation.startedAtMs) / 1000))
    : 0
  const voiceMaxSeconds = Math.floor(SPEECH_TRANSCRIPTION_MAX_DURATION_MS / 1000)
  const voiceStatusMessage = voiceDictationStatus === 'recording'
    ? t('composerVoiceRecording', { seconds: voiceElapsedSeconds, max: voiceMaxSeconds })
    : voiceDictationStatus === 'transcribing'
      ? voiceDictation.notice?.message ?? t('composerVoiceTranscribing')
      : voiceDictation.error
  const voiceButtonLabel = voiceDictationStatus === 'recording'
    ? t('composerVoiceStop')
    : voiceDictationStatus === 'transcribing'
      ? t('composerVoiceTranscribing')
      : t('composerVoiceStart')
  const voiceLevelBars = [0.42, 0.7, 0.5, 0.82, 0.56].map((base, index) =>
    Math.max(22, Math.min(100, (base + voiceLevel * (0.5 + index * 0.08)) * 100))
  )

  useEffect(() => {
    const pendingInput = pendingVoiceSendInputRef.current
    if (!pendingInput || input !== pendingInput) return
    pendingVoiceSendInputRef.current = null
    handlePrimaryAction()
  }, [handlePrimaryAction, input])

  useEffect(() => {
    if (voiceDictationStatus !== 'recording') {
      setVoiceLevel(0)
      setVoiceNowMs(Date.now())
      return
    }
    setVoiceNowMs(Date.now())
    const interval = window.setInterval(() => {
      setVoiceNowMs(Date.now())
      setVoiceLevel(getVoiceDictationLevel())
    }, 120)
    return () => window.clearInterval(interval)
  }, [getVoiceDictationLevel, voiceDictationStatus])

  const handleComposerDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const workspaceReferenceDrop = composerWorkspaceReferenceDropFromTransfer(event.dataTransfer, {
      fileReferenceEnabled,
      canAddFileReference: Boolean(onAddFileReference)
    })
    if (workspaceReferenceDrop) {
      event.preventDefault()
      onAddFileReference?.(workspaceReferenceDrop.reference)
      insertTextAtComposerCursor(workspaceReferenceDrop.mentionToken)
      draft.focusComposer()
      return
    }

    const imageFiles = canPickAttachment ? imageAttachmentInputsFromTransfer(event.dataTransfer) : []
    const rawFiles = Array.from(event.dataTransfer.files ?? [])
    const isImageLike = (file: File): boolean =>
      isImageMimeType(file.type) || Boolean(imageMimeTypeFromFileName(file.name))
    const pdfFiles = rawFiles.filter((file) => !isImageLike(file) && isPdfFile(file))
    const pathFiles = rawFiles.filter((file) => !isImageLike(file) && !isPdfFile(file))
    if (imageFiles.length === 0 && pdfFiles.length === 0 && pathFiles.length === 0) return
    event.preventDefault()
    if (imageFiles.length > 0 && onPickAttachments) {
      onPickAttachments(imageFiles)
    }
    if (pdfFiles.length > 0 && onPickAttachments) {
      onPickAttachments(attachmentInputsFromPickedFiles(pdfFiles))
    }
    if (pathFiles.length > 0) {
      const workspace = effectiveWorkspaceRoot
      const addDroppedFileReference = onAddFileReference
      const droppedPaths: Array<{ path: string; file: File }> = []
      for (const file of pathFiles) {
        try {
          const path = window.sciforge.getPathForFile(file)
          if (path) droppedPaths.push({ path, file })
        } catch {
          // ignore files we cannot resolve a filesystem path for
        }
      }
      void (async () => {
        const pathText: string[] = []
        const referenceTokens: string[] = []
        for (const { path, file } of droppedPaths) {
          const reference = workspace && addDroppedFileReference
            ? await droppedWorkspaceReference(path, workspace, file)
            : null
          if (reference && addDroppedFileReference) {
            addDroppedFileReference(reference)
            referenceTokens.push(formatComposerFileMentionToken(reference.relativePath))
          } else {
            pathText.push(path)
          }
        }
        const inserted = [...referenceTokens, ...pathText].join(' ')
        if (inserted) insertTextAtComposerCursor(inserted)
      })()
    }
    draft.focusComposer()
  }

  return (
    <div
      ref={composerRootRef}
      className={compact
        ? 'ds-floating-composer ds-no-drag pointer-events-auto w-full pb-0 pt-0'
        : 'ds-floating-composer ds-no-drag ds-chat-column-inset pointer-events-auto w-full max-w-4xl pb-3 pt-0'}
    >
      <FloatingComposerQueuedMessages
        messages={queuedMessages}
        persistenceDegraded={queuedMessagesPersistenceDegraded}
        onRemove={onRemoveQueuedMessage}
        onEdit={onEditQueuedMessage}
        onSteer={onSteerQueuedMessage}
        onRetry={onRetryQueuedMessage}
      />

      <div className="relative">
        {showContextStateBanner || (!compact && activeThreadGoal && slashQuery == null && !goalPanelOpen && !composerMenuOpen) ? (
          <div
            className={queuedMessages.length > 0
              ? 'mb-2 flex flex-col items-center gap-2'
              : 'pointer-events-none absolute inset-x-3 bottom-full z-20 mb-2 flex flex-col items-center gap-2'}
          >
            {showContextStateBanner ? (
              <div
                className="pointer-events-auto flex min-h-9 w-full max-w-[46rem] items-center gap-2 rounded-full border border-ds-border bg-ds-card/95 px-3 py-1.5 text-ds-muted shadow-[0_12px_34px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:bg-ds-card/90"
                title={contextStateTitle}
              >
                <Minimize2 className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-5">
                  {contextStateLabel}
                </span>
              </div>
            ) : null}
            {activeThreadGoal ? (
            <div className="pointer-events-auto flex min-h-11 w-full max-w-[46rem] items-center gap-2 rounded-full border border-ds-border bg-ds-card/95 px-3 py-1.5 text-ds-muted shadow-[0_12px_34px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:bg-ds-card/90">
              <Target className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] leading-5">
                <span className="shrink-0 font-semibold text-ds-ink">
                  {goalBannerLabel}
                </span>
                <span className="min-w-0 truncate text-ds-muted">
                  {activeThreadGoal.objective}
                </span>
                <span className="shrink-0 text-ds-faint">
                  · {goalElapsedLabel}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setGoalPanelOpen(true)
                    draft.focusComposer()
                  }}
                  className="ds-no-drag flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={t('goalActionEdit')}
                  title={t('goalActionEdit')}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void setActiveThreadGoalStatus(activeThreadGoal.status === 'active' ? 'paused' : 'active')
                  }}
                  className="ds-no-drag flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={activeThreadGoal.status === 'active' ? t('goalActionPause') : t('goalActionResume')}
                  title={activeThreadGoal.status === 'active' ? t('goalActionPause') : t('goalActionResume')}
                >
                  {activeThreadGoal.status === 'active' ? (
                    <PauseCircle className="h-3.5 w-3.5" strokeWidth={1.9} />
                  ) : (
                    <PlayCircle className="h-3.5 w-3.5" strokeWidth={1.9} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void clearActiveThreadGoal()
                  }}
                  className="ds-no-drag flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={t('goalActionClear')}
                  title={t('goalActionClear')}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
              </div>
            </div>
            ) : null}
          </div>
        ) : null}

        {composerMenuOpen && slashQuery == null ? (
          <div
            ref={composerMenuPanelRef}
            className="absolute bottom-12 left-1 z-40 w-48 overflow-hidden rounded-[18px] border border-ds-border bg-white py-1.5 text-[13px] text-ds-muted shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:bg-ds-card"
          >
            {showImageGenerationMenuItem ? (
              <>
                <button
                  type="button"
                  disabled={!canCreateImageRequest}
                  onClick={handleCreateImageMenuClick}
                  className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
                  title={imageGenerationConfigured ? t('composerMenuCreateImage') : t('composerMenuCreateImageDisabled')}
                >
                  <ImagePlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                  <span className="min-w-0 flex-1 truncate">{t('composerMenuCreateImage')}</span>
                </button>
                <div className="my-1 h-px bg-ds-border-muted/70" />
              </>
            ) : null}
            {showAttachmentToolbarButton ? (
              <>
                <button
                  type="button"
                  disabled={!canOpenAttachmentPicker || !onPickAttachments}
                  onClick={handleAttachmentMenuClick}
                  className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
                >
                  {attachmentUploadBusy ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.9} />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{t('composerAddAttachment')}</span>
                </button>
                <div className="my-1 h-px bg-ds-border-muted/70" />
              </>
            ) : null}
            <button
              type="button"
              disabled={!canTogglePlanMode}
              onClick={handlePlanToolbarClick}
              className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
            >
              <ListTodo className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
              <span className="min-w-0 flex-1 truncate">{t('composerMenuPlanMode')}</span>
              <span
                role="switch"
                aria-checked={mode === 'plan'}
                className={`relative h-5 w-9 shrink-0 rounded-full ring-1 transition ${
                  mode === 'plan'
                    ? 'bg-accent ring-accent/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]'
                    : 'bg-ds-border-muted ring-ds-border-muted'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ring-1 ring-black/5 transition ${
                    mode === 'plan' ? 'translate-x-[17px]' : 'translate-x-0.5'
                  } shadow-[0_1px_4px_rgba(15,23,42,0.28)]`}
                />
              </span>
            </button>
            {runtimeSupportsGoals ? (
              <button
                type="button"
                disabled={!canOpenGoalPanel}
                onClick={handleGoalMenuClick}
                className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
              >
                <Target className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate">{t('composerMenuPursueGoal')}</span>
                <span
                  role="switch"
                  aria-checked={goalMenuChecked}
                  className={`relative h-5 w-9 shrink-0 rounded-full ring-1 transition ${
                    goalMenuChecked
                      ? 'bg-accent ring-accent/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]'
                      : 'bg-ds-border-muted ring-ds-border-muted'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ring-1 ring-black/5 transition ${
                      goalMenuChecked ? 'translate-x-[17px]' : 'translate-x-0.5'
                    } shadow-[0_1px_4px_rgba(15,23,42,0.28)]`}
                  />
                </span>
              </button>
            ) : null}
          </div>
        ) : null}

        {slashQuery != null ? (
          <div className="ds-card-strong absolute bottom-full left-1/2 z-30 mb-2 w-[calc(100%_-_1rem)] max-w-[760px] -translate-x-1/2 overflow-hidden rounded-[16px] p-1.5 shadow-[0_18px_46px_rgba(15,23,42,0.14)]">
            <div className="flex h-7 items-center px-2.5 text-[11.5px] font-semibold text-ds-muted">
              {t('slashCommandMenuTitle')}
            </div>
            {filteredSlashCommands.length > 0 ? (
              <div className="flex max-h-[min(300px,calc(100vh-260px))] flex-col gap-0.5 overflow-y-auto pr-1">
                {filteredSlashCommands.map((command) => {
                  const active = highlightedSlashCommand?.id === command.id
                  return (
                    <button
                      key={command.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applySlashCommand(command.id)}
                      disabled={command.disabled}
                      className={`flex min-h-[52px] w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                        active && !command.disabled
                          ? 'bg-ds-hover text-ds-ink shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]'
                          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:hover:bg-transparent disabled:hover:text-ds-muted'
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] ${
                          active && !command.disabled ? 'bg-white text-accent shadow-sm dark:bg-ds-card' : 'bg-ds-hover text-ds-muted'
                        }`}
                      >
                        {command.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold leading-5 text-inherit">
                          {command.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] leading-4 text-ds-faint">
                          {command.description}
                        </span>
                      </span>
                      <span className="hidden min-w-[106px] shrink-0 flex-col items-end gap-1 sm:flex">
                        {command.scopeLabel ? (
                          <span className="text-[10.5px] font-semibold leading-none text-ds-muted">
                            {command.scopeLabel}
                          </span>
                        ) : null}
                        <span className="max-w-[150px] truncate rounded-full border border-ds-border-muted px-2 py-0.5 text-[10.5px] font-semibold leading-4 text-ds-faint">
                          {command.badge ?? `/${command.id}`}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-[12px] border border-dashed border-ds-border-muted px-3 py-3 text-[12px] text-ds-faint">
                {t('slashCommandEmpty')}
              </div>
            )}
          </div>
        ) : null}

        {showFileMentionMenu ? (
          <div className="ds-card-strong absolute bottom-full left-1/2 z-30 mb-2 w-[calc(100%_-_1rem)] max-w-[680px] -translate-x-1/2 overflow-hidden rounded-[16px] p-1.5 shadow-[0_18px_46px_rgba(15,23,42,0.14)]">
            <div className="flex h-7 items-center gap-2 px-2.5 text-[11.5px] font-semibold text-ds-muted">
              <FileText className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
              <span>{t('composerFileMentionMenuTitle')}</span>
              {fileMentionLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-ds-faint" strokeWidth={1.9} />
              ) : null}
            </div>
            {fileMentionSuggestions.length > 0 ? (
              <div className="flex max-h-[min(280px,calc(100vh-260px))] flex-col gap-0.5 overflow-y-auto pr-1">
                {fileMentionSuggestions.map((reference) => {
                  const active = highlightedFileMention?.relativePath === reference.relativePath
                  return (
                    <button
                      key={reference.relativePath}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFileMention(reference)}
                      className={`flex min-h-[46px] w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition ${
                        active
                          ? 'bg-ds-hover text-ds-ink shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]'
                          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] ${
                          active ? 'bg-white text-accent shadow-sm dark:bg-ds-card' : 'bg-ds-hover text-ds-muted'
                        }`}
                      >
                        {reference.kind === 'directory' ? (
                          <Folder className="h-4 w-4" strokeWidth={1.8} />
                        ) : (
                          <FileText className="h-4 w-4" strokeWidth={1.8} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold leading-5 text-inherit">
                          {reference.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] leading-4 text-ds-faint">
                          {reference.relativePath}
                        </span>
                      </span>
                      <span className="hidden max-w-[170px] shrink-0 truncate rounded-full border border-ds-border-muted px-2 py-0.5 text-[10.5px] font-semibold leading-4 text-ds-faint sm:block">
                        {formatComposerFileMentionToken(reference.relativePath)}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-[12px] border border-dashed border-ds-border-muted px-3 py-3 text-[12px] text-ds-faint">
                {fileMentionLoading ? t('composerFileMentionLoading') : t('composerFileMentionEmpty')}
              </div>
            )}
          </div>
        ) : null}

        {goalPanelOpen && slashQuery == null ? (
          <div
            ref={goalPanelRef}
            className="absolute inset-x-2 bottom-full z-30 mb-3 overflow-hidden rounded-[26px] border border-ds-border bg-ds-card/95 p-3 shadow-[0_18px_52px_rgba(15,23,42,0.14)] backdrop-blur-xl dark:bg-ds-card/90"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ds-border-muted text-ds-muted">
                <Target className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-[14px] font-semibold text-ds-ink">
                    {activeThreadGoal ? activeThreadGoal.objective : t('goalNoActiveTitle')}
                  </div>
                  {activeThreadGoal ? (
                    <span className="shrink-0 rounded-lg border border-ds-border-muted bg-ds-card px-2 py-0.5 text-[11px] font-semibold text-ds-muted">
                      {t(`goalStatusShort.${activeThreadGoal.status}`)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canSetGoalPanelDraft ? (
                    <button
                      type="button"
                      onClick={setGoalFromComposerInput}
                      className="rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover"
                    >
                      {t('goalSetCurrentInput')}
                    </button>
                  ) : null}
                  {activeThreadGoal?.status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalPanelOpen(false)
                        void setActiveThreadGoalStatus('paused')
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('goalActionPause')}
                      title={t('goalActionPause')}
                    >
                      <PauseCircle className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : activeThreadGoal ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalPanelOpen(false)
                        void setActiveThreadGoalStatus('active')
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('goalActionResume')}
                      title={t('goalActionResume')}
                    >
                      <PlayCircle className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : null}
                  {activeThreadGoal ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalPanelOpen(false)
                        void clearActiveThreadGoal()
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('goalActionClear')}
                      title={t('goalActionClear')}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGoalPanelOpen(false)}
                className="rounded-lg p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                aria-label={t('close')}
                title={t('close')}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        ) : null}

        <div
          className={`ds-composer-shell ds-chat-composer ds-frosted ds-no-drag flex flex-col gap-1 px-3 pb-2 pt-2 transition ${
            draft.focused ? 'ds-chat-composer-focus' : ''
          } ${compact ? 'rounded-[24px] px-3 py-2 shadow-none' : ''}`}
          onMouseDown={handleComposerShellMouseDown}
          onPaste={handleComposerPaste}
          onDragOver={handleComposerDragOver}
          onDrop={handleComposerDrop}
        >
          {showChangeSummary ? (
            <div className="ds-no-drag mb-1 rounded-2xl border border-ds-border-muted bg-ds-card/78 px-3 py-2 shadow-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ds-hover text-ds-muted">
                  <FileEdit className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] font-semibold text-ds-ink">
                    <span className="truncate">{t('composerChangedFilesTitle', { count: changedFiles.length })}</span>
                    <span className="font-mono text-[12px] text-ds-diff-added">
                      +{effectiveChangedFileStats.added}
                    </span>
                    <span className="font-mono text-[12px] text-ds-diff-removed">
                      -{effectiveChangedFileStats.removed}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ds-muted">
                    {visibleChangedFiles.map((file) => (
                      <span key={file.path} className="max-w-[220px] truncate" title={file.path}>
                        {file.path}
                      </span>
                    ))}
                    {hiddenChangedFileCount > 0 ? (
                      <span className="text-ds-faint">
                        {t('composerChangedFilesMore', { count: hiddenChangedFileCount })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {onOpenChanges ? (
                    <button
                      type="button"
                      onClick={onOpenChanges}
                      className="rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover"
                    >
                      {t('composerOpenChanges')}
                    </button>
                  ) : null}
                  {onReviewChanges && runtimeSupportsReview ? (
                    <button
                      type="button"
                      disabled={reviewChangesDisabled}
                      onClick={onReviewChanges}
                      className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <SearchCode className="h-3.5 w-3.5" strokeWidth={1.8} />
                      {t('composerReviewChanges')}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {imageGenerationMode ? (
            <div className="flex flex-wrap items-center gap-2 px-1 pb-0.5">
              <span className="ds-no-drag inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/10 px-2 text-[12px] font-semibold text-accent shadow-sm">
                <ImagePlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span className="truncate">{t('composerImageGenerationMode')}</span>
                <button
                  type="button"
                  onClick={() => {
                    pendingImageGenerationSendRef.current = false
                    imageGenerationModeRef.current = false
                    setImageGenerationMode(false)
                    draft.focusComposer()
                  }}
                  className="rounded-full p-0.5 text-accent/70 transition hover:bg-accent/15 hover:text-accent"
                  aria-label={t('composerImageGenerationExit')}
                  title={t('composerImageGenerationExit')}
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                </button>
              </span>
            </div>
          ) : null}
          <textarea
            ref={draft.textareaRef}
            data-visual-context-sensitive="true"
            rows={1}
            className={`ds-no-drag block w-full min-w-0 resize-none break-words bg-transparent px-1 py-2.5 text-[15px] leading-[1.45] text-ds-ink placeholder:text-ds-faint focus:outline-none [overflow-wrap:anywhere] ${
              canEditComposer ? '' : 'opacity-80'
            } ${compact ? 'text-[14px] py-2' : 'min-h-[40px]'}`}
            placeholder={placeholder}
            value={input}
            disabled={!canEditComposer}
            onChange={(e) => {
              draft.resetHistoryNavigation(e.target.value)
              if (remembersComposerInput) writeComposerDraft(composerDraftKey, e.target.value)
              setInput(e.target.value)
              setComposerCursor(e.target.selectionStart ?? e.target.value.length)
              setDismissedFileMentionKey(null)
            }}
            onSelect={(e) => syncComposerCursor(e.currentTarget)}
            onFocus={draft.onFocus}
            onBlur={draft.onBlur}
            onCompositionStart={draft.onCompositionStart}
            onCompositionEnd={draft.onCompositionEnd}
            onKeyDown={handleComposerKeyDown}
          />
          {commentReferences.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 px-1" data-composer-comment-references>
              {commentReferences.map((reference) => (
                <span
                  key={reference.id}
                  className="ds-no-drag inline-flex h-7 max-w-full items-center gap-1 rounded-lg border border-violet-500/25 bg-violet-500/10 px-1.5 text-[12px] font-medium text-violet-800 dark:text-violet-200"
                  title={reference.comment}
                >
                  <MessageCircleMore className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                  <span className="max-w-52 truncate">{reference.label}</span>
                  {onRemoveCommentReference ? (
                    <button
                      type="button"
                      onClick={() => onRemoveCommentReference(reference.id)}
                      className="rounded-full p-0.5 text-violet-700/65 transition hover:bg-violet-500/15 hover:text-violet-900 dark:text-violet-200/70 dark:hover:text-violet-100"
                      aria-label={t('composerRemoveCommentReference')}
                      title={t('composerRemoveCommentReference')}
                    >
                      <X className="h-3 w-3" strokeWidth={2} />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
          {fileReferences.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 px-1">
              {fileReferences.map((reference) => (
                <span
                  key={composerFileReferenceKey(reference)}
                  className="ds-no-drag inline-flex h-7 max-w-full items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-card/80 px-1.5 text-[12px] font-medium text-ds-muted"
                  title={reference.relativePath}
                >
                  {onPreviewFileReference ? (
                    <button
                      type="button"
                      onClick={() => onPreviewFileReference(reference)}
                      className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('composerOpenFileReference', { name: reference.relativePath })}
                      title={t('composerOpenFileReference', { name: reference.relativePath })}
                    >
                      {reference.kind === 'directory' ? (
                        <Folder className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                      ) : (
                        <FileText className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                      )}
                      <span className="max-w-52 truncate">{reference.relativePath}</span>
                    </button>
                  ) : (
                    <>
                      {reference.kind === 'directory' ? (
                        <Folder className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                      ) : (
                        <FileText className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                      )}
                      <span className="max-w-52 truncate">{reference.relativePath}</span>
                    </>
                  )}
                  {reference.kind === 'pdf' || reference.mimeType === 'application/pdf' ? (
                    <span className="rounded bg-ds-hover px-1 py-0.5 font-mono text-[10px] leading-none text-ds-faint">
                      PDF
                    </span>
                  ) : null}
                  {onRemoveFileReference ? (
                    <button
                      type="button"
                      onClick={() => removeFileReference(reference)}
                      className="rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('composerRemoveFileReference')}
                      title={t('composerRemoveFileReference')}
                    >
                      <X className="h-3 w-3" strokeWidth={2} />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
          {attachments.length > 0 || attachmentUploadError ? (
            <div className="flex flex-wrap items-center gap-2 px-1">
              {attachments.map((attachment) => (
                attachment.previewUrl ? (
                  <span
                    key={attachment.id}
                    className="ds-no-drag relative block h-20 w-20 overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm"
                    title={attachment.name || attachment.id}
                  >
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.name || attachment.id}
                      className="h-full w-full object-cover"
                    />
                    {onRemoveAttachment ? (
                      <button
                        type="button"
                        onClick={() => onRemoveAttachment(attachment.id)}
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-950 text-white shadow-sm transition hover:bg-zinc-800"
                        aria-label={t('composerRemoveAttachment')}
                        title={t('composerRemoveAttachment')}
                      >
                        <X className="h-3 w-3" strokeWidth={2.2} />
                      </button>
                    ) : null}
                  </span>
                ) : (
                  <span
                    key={attachment.id}
                    className="ds-no-drag inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card/80 px-2 text-[12px] font-medium text-ds-muted"
                    title={attachment.id}
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                    <span className="max-w-40 truncate">{attachment.name || attachment.id}</span>
                    {onRemoveAttachment ? (
                      <button
                        type="button"
                        onClick={() => onRemoveAttachment(attachment.id)}
                        className="rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                        aria-label={t('composerRemoveAttachment')}
                        title={t('composerRemoveAttachment')}
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    ) : null}
                  </span>
                )
              ))}
              {attachmentUploadError ? (
                <span className="min-w-0 break-words text-[12px] font-medium text-red-600 dark:text-red-300">
                  {attachmentUploadError}
                </span>
              ) : null}
            </div>
          ) : null}
          {showAttachmentToolbarButton ? (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf,.pdf,.fasta,.fa,.faa,.fna,.ffn,.frn,.fastq,.fq,.smi,.smiles,.mol,.mol2,.sdf,.mgf,.pdb,.cif,.gb,.gbk,.gff,.gff3,.gtf,.vcf,.bed,.nwk,.seq"
              multiple
              className="hidden"
              onChange={handleAttachmentInput}
            />
          ) : null}
          {showVoiceControl && voiceStatusMessage ? (
            <div
              role={voiceDictation.error ? 'alert' : 'status'}
              aria-live={voiceDictation.error ? 'assertive' : 'polite'}
              className={`ds-no-drag flex min-w-0 flex-wrap items-center gap-2 rounded-xl border px-2.5 py-2 text-[12.5px] font-medium leading-5 ${
                voiceDictation.error
                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-200'
                  : 'border-ds-border-muted bg-ds-card/76 text-ds-muted'
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  voiceDictation.error
                    ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200'
                    : voiceDictation.status === 'recording'
                      ? 'bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-500/25'
                      : 'bg-ds-hover text-ds-muted'
                }`}
              >
                {voiceDictation.status === 'transcribing' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                ) : (
                  <Mic className="h-3.5 w-3.5" strokeWidth={2} />
                )}
              </span>
              {voiceDictation.status === 'recording' ? (
                <span className="flex h-7 shrink-0 items-center gap-0.5" aria-hidden="true">
                  {voiceLevelBars.map((height, index) => (
                    <span
                      key={index}
                      className="w-1 rounded-full bg-red-500/70 transition-[height] duration-100 dark:bg-red-300/80"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </span>
              ) : null}
              <span className="min-w-[12rem] flex-1 break-words">
                {voiceStatusMessage}
              </span>
              {voiceDictation.status === 'recording' ? (
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => voiceDictation.stop('insert')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-2.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                    <span>{t('composerVoiceInsert')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => voiceDictation.stop('send')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-zinc-950 px-2.5 text-[12px] font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                  >
                    <Send className="h-3.5 w-3.5" strokeWidth={2} />
                    <span>{t('composerVoiceSend')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={voiceDictation.cancel}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                    aria-label={t('composerVoiceCancel')}
                    title={t('composerVoiceCancel')}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </span>
              ) : voiceDictation.error ? (
                <button
                  type="button"
                  onClick={voiceDictation.clearError}
                  className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-red-700 transition hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-500/15"
                  aria-label={t('composerVoiceDismiss')}
                  title={t('composerVoiceDismiss')}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              ) : null}
            </div>
          ) : null}
          <div
            className={`ds-composer-toolbar flex min-h-9 items-center gap-2 ${
              showToolbarStartControls ? 'justify-between' : 'justify-end'
            }`}
          >
            {showToolbarStartControls ? (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden">
                {showComposerMenuButton ? (
                  <>
                    <button
                      ref={composerMenuButtonRef}
                      type="button"
                      disabled={!canOpenComposerMenu}
                      onClick={handleComposerMenuButtonClick}
                      className={`ds-no-drag flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 ${
                        composerMenuOpen ? 'bg-ds-hover text-ds-ink' : ''
                      }`}
                      aria-label={t('composerMenuTitle')}
                      title={t('composerMenuTitle')}
                    >
                      <Plus className="h-5 w-5" strokeWidth={1.8} />
                    </button>
                    {mode === 'plan' ? (
                      <span
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ds-hover px-2.5 text-[13px] font-medium text-ds-muted"
                        title={t('slashCommandPlanTitle')}
                      >
                        <ListTodo className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span>{t('slashCommandPlanTitle')}</span>
                      </span>
                    ) : null}
                    {activeThreadGoal?.status === 'active' ? (
                      <span
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ds-hover px-2.5 text-[13px] font-medium text-ds-muted"
                        title={t('slashCommandGoalTitle')}
                      >
                        <Target className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span>{t('slashCommandGoalTitle')}</span>
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
            <div
              className={`flex min-w-0 items-center justify-end gap-1.5 ${
                stretchModelPicker ? 'flex-1' : 'shrink-0'
              }`}
            >
              {showVoiceControl ? (
                <button
                  type="button"
                  disabled={voiceControlDisabled}
                  onClick={() => {
                    if (voiceDictation.status === 'recording') {
                      voiceDictation.stop('insert')
                    } else if (voiceDictation.status === 'idle') {
                      voiceDictation.start()
                    }
                  }}
                  className={`ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 ${
                    voiceDictation.status === 'recording'
                      ? 'bg-red-50 text-red-600 ring-1 ring-red-200 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-500/25 dark:hover:bg-red-500/15'
                      : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:hover:bg-transparent disabled:hover:text-ds-muted'
                  }`}
                  aria-label={voiceButtonLabel}
                  title={voiceButtonLabel}
                >
                  {voiceDictation.status === 'transcribing' ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.1} />
                  ) : (
                    <Mic className="h-4 w-4" strokeWidth={2.1} />
                  )}
                </button>
              ) : null}
              {hideModelPicker ? null : (
                <FloatingComposerModelPicker
                  compact={compact}
                  mode={modelPickerMode}
                  composerModel={composerModel}
                  composerPickList={composerPickList}
                  composerModelGroups={composerModelGroups}
                  activeAgentRuntime={activeAgentRuntime}
                  composerReasoningEffort={composerReasoningEffort}
                  canChangeModel={canChangeModel}
                  stretch={stretchModelPicker}
                  onComposerModelChange={onComposerModelChange}
                  onActiveAgentRuntimeChange={onActiveAgentRuntimeChange}
                  onComposerReasoningEffortChange={onComposerReasoningEffortChange}
                />
              )}
              {busy ? (
                <button
                  type="button"
                  onClick={() => onInterrupt()}
                  className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white shadow-[0_10px_22px_rgba(15,23,42,0.22)] transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                  aria-label={t('interrupt')}
                  title={t('interrupt')}
                >
                  <Square className="h-3.5 w-3.5 fill-current" strokeWidth={2.4} />
                </button>
              ) : null}
              <button
                type="button"
                disabled={primaryActionDisabled}
                onClick={handlePrimaryAction}
                className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white shadow-[0_10px_22px_rgba(15,23,42,0.22)] transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-ds-card disabled:text-ds-faint disabled:shadow-none dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:disabled:bg-ds-card dark:disabled:text-ds-faint"
                aria-label={primaryActionLabel}
                title={primaryActionLabel}
              >
                {primaryActionLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
                ) : (
                  <Send className="h-4 w-4" strokeWidth={2.2} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      {compact ? null : (
        <div className="ds-composer-footer mt-1 flex min-h-7 flex-wrap items-center justify-between gap-x-2.5 gap-y-1.5 px-3">
          <div className="ds-composer-footer-left flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <GitBranchPicker workspaceRoot={effectiveWorkspaceRoot} />
            {showThreadUsageFooter ? (
              <div
                className="ds-composer-usage ds-no-drag inline-flex min-h-7 max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 overflow-visible rounded-lg border border-ds-border-muted bg-ds-card/72 px-2.5 py-0.5 text-[12.5px] font-medium leading-5 text-ds-muted shadow-sm"
                title={
                  threadUsage
                    ? t('sessionUsageDetailsTitle', {
                        tokens: formatCompactNumber(threadUsage.totalTokens),
                        cost: formatCost(threadUsage.costUsd, i18n.language, threadUsage.costCny),
                        saved: formatCost(
                          threadUsage.tokenEconomySavingsUsd,
                          i18n.language,
                          threadUsage.tokenEconomySavingsCny
                        ),
                        cache: formatPercent(threadUsage.cacheHitRate),
                        cached: formatCompactNumber(threadUsage.cachedTokens),
                        miss: formatCompactNumber(threadUsage.cacheMissTokens),
                        turns: threadUsage.turns
                      })
                    : t('sessionUsageUnavailable')
                }
              >
                <BarChart3 className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
                {threadUsage ? (
                  <>
                    <span className="ds-composer-usage-tokens shrink-0 truncate tabular-nums">
                      {t('sessionUsageTokens', {
                        tokens: formatCompactNumber(threadUsage.totalTokens)
                      })}
                    </span>
                    <span className="ds-composer-usage-cost-separator text-ds-faint">·</span>
                    <span className="ds-composer-usage-cost shrink-0 truncate tabular-nums">
                      {t('sessionUsageCost', {
                        cost: formatCost(threadUsage.costUsd, i18n.language, threadUsage.costCny)
                      })}
                    </span>
                    {threadUsage.tokenEconomySavingsTokens > 0 ? (
                      <>
                        <span className="ds-composer-usage-context-savings-separator text-ds-faint">·</span>
                        <span
                          className="ds-composer-usage-context-savings shrink-0 tabular-nums text-emerald-700 dark:text-emerald-300"
                          title={t('sessionUsageContextSavingsTitle', {
                            tokens: formatCompactNumber(threadUsage.tokenEconomySavingsTokens)
                          })}
                        >
                          {t('sessionUsageContextSavings', {
                            cost: formatCost(
                              threadUsage.tokenEconomySavingsUsd,
                              i18n.language,
                              threadUsage.tokenEconomySavingsCny
                            )
                          })}
                        </span>
                      </>
                    ) : null}
                    <span className="ds-composer-usage-cache-separator text-ds-faint">·</span>
                    <span className="ds-composer-usage-cache shrink-0 truncate tabular-nums">
                      {t('sessionUsageCache', {
                        cache: formatPercent(threadUsage.cacheHitRate)
                      })}
                    </span>
                    <span className="ds-composer-usage-turns-separator text-ds-faint">·</span>
                    <span className="ds-composer-usage-turns shrink-0 truncate tabular-nums">
                      {t('sessionUsageTurns', { turns: threadUsage.turns })}
                    </span>
                  </>
                ) : (
                  <span className="shrink-0 text-ds-faint">
                    {threadUsageState.loading
                      ? t('sessionUsageLoading')
                      : t('sessionUsageUnavailable')}
                  </span>
                )}
              </div>
            ) : null}
          </div>
          {footerHint ? (
            <div className="ds-composer-footer-hint min-w-0 flex-1 text-right text-[12.5px] font-medium text-ds-faint">
              <span className="block truncate">{footerHint}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

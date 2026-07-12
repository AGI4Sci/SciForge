import type { ReactElement } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ArrowLeft, ArrowRight, Bot, CircleAlert, Eye } from 'lucide-react'
import { parseRemoteChannelCommand } from '@shared/remote-channel-commands'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import { buildGuiPlanId, buildPlanRelativePath } from '@shared/gui-plan'
import { sddDraftTraceRelativePath } from '@shared/sdd'
import { buildSddTraceSnapshot } from '@shared/sdd-trace'
import { maybeBuildLongHorizonPrompt } from '@shared/long-horizon-prompt'
import {
  findKeyboardShortcutCommand,
  keyboardEventToShortcut,
  resolveKeyboardShortcutBindings,
  type KeyboardShortcutCommandId
} from '@shared/keyboard-shortcuts'
import type { DesktopCommand, SkillListItem } from '@shared/sciforge-api'
import type { AgentRuntimeId, RemoteChannelV1 } from '@shared/app-settings'
import type { ClipboardImageReadResult } from '@shared/workspace-file'
import type { AgentRuntimeChild, AgentRuntimeWorkspaceReference } from '@shared/agent-runtime-contract'
import type { AgentProviderCapabilities, AttachmentReference, ChatBlock, NormalizedThread } from '../agent/types'
import type { LocalRuntimeInfoJson, LocalRuntimeSkillJson } from '../agent/local-runtime-contract'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useChatStore } from '../store/chat-store'
import { selectFocusedAgentSurface } from '../store/chat-store-focus-actions'
import {
  remoteChannelThreadBindingsFromChannels,
  deriveRemoteChannelThreadStatusKind,
  isRemoteChannelThread
} from '../store/chat-store-helpers'
import { hasPendingRuntimeWork } from '../store/chat-store-runtime-helpers'
import {
  extractLatestTurnAutoOpenDevPreviewUrls,
  extractLatestTurnDevPreviewUrls
} from '../lib/dev-preview-detection'
import { Sidebar } from './chat/Sidebar'
import { WorkbenchTopBar, type RightPanelMode } from './chat/WorkbenchTopBar'
import { ActiveRemoteBindingDetails } from './chat/RemoteBindingDetailsPill'
import { MessageTimeline } from './chat/MessageTimeline'
import type { TimelineVisualReviewArtifact } from './chat/message-timeline-media'
import {
  FloatingComposer,
  type ComposerCommentReference,
  type ComposerImageAttachmentInput,
  type ComposerFileReference,
  type ComposerSendIntent
} from './chat/FloatingComposer'
import {
  composerReasoningEffortRequestValue,
  type ComposerReasoningEffort
} from './chat/FloatingComposerModelPicker'
import { SideConversationPanel } from './chat/SideConversationPanel'
import {
  ChildAgentsPanel,
  filterDirectChildAgents,
  useThreadChildren
} from './chat/ChildAgentsPanel'
import { AgentFocusNavigation } from './chat/AgentFocusNavigation'
import { FocusedAgentWorkbench } from './chat/FocusedAgentWorkbench'
import { useChildAgentAttention } from './chat/use-child-agent-attention'
import type { FileTreeInitialDirectory } from './chat/ChatFileTreePanel'
import {
  RemoteGuardDetailView,
  remoteGuardChannelTitle,
  remoteGuardProviderLabel
} from './chat/RemoteGuardDetailView'
import { ThreadTargetSelector } from './chat/ThreadTargetSelector'
import { SessionHeader } from './SessionHeader'
import { SddAssistantPanel } from './sdd/SddAssistantPanel'
import { SddDraftEditorView } from './sdd/SddDraftEditorView'
import { SidebarTitlebarToggleButton } from './sidebar/SidebarPrimitives'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { buildSddDraftId, forgetRememberedSddDraft, useSddDraftStore } from '../sdd/sdd-draft-store'
import type { SddDraft, SddDraftSaveStatus } from '../sdd/sdd-draft-store'
import { saveActiveSddDraftToDisk } from '../sdd/sdd-draft-actions'
import { restoreSddDraft } from '../sdd/sdd-draft-restore'
import { composeSddAssistantPrompt } from '../sdd/sdd-assistant-prompt'
import { collectSddDraftImages, withAttachmentIds, type SddDraftImageReference } from '../sdd/sdd-draft-images'
import { buildSddDraftToPlanPrompt } from '../sdd/sdd-plan-prompt'
import {
  isEmptySddAssistantThreadCandidate,
  isSddAssistantThread,
  markSddAssistantThread,
  releaseSddAssistantThread,
  sddAssistantThreadIdForDraft,
  sddDraftRefForThreadId
} from '../sdd/sdd-thread-registry'
import { parseGuiPlanCommand } from '../plan/plan-command'
import { DevPreviewLaunchCard } from './DevPreviewLaunchCard'
import { RuntimeBanner } from './RuntimeBanner'
import {
  CODE_PANEL_PREFERRED,
  projectDagReturnSelection,
  readStoredRightPanelContext,
  useWorkbenchLayout
} from './workbench-layout'
import { useWorkbenchPlanController } from './workbench-plan-controller'
import { PROJECT_DAG_SETUP_EVENT } from './project-dag/project-dag-panel-state'
import { prepareImageAttachmentUpload } from '../lib/image-attachment-upload'
import { isChatAttachmentUploadEnabled } from '../lib/attachment-upload-availability'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { buildImageGenerationWorkflowPrompt } from '../lib/image-generation-chat'
import { useKeyboardShortcutSettings } from '../lib/keyboard-shortcut-settings'
import {
  isPluginInstalled,
  PAPER_RADAR_EXTENSION_ID
} from '../lib/plugin-install-state'
import { providerSupportsCapability } from '../store/chat-store-provider-capabilities'
import { collectComposerChangeSummary } from '../lib/composer-change-summary'
import {
  WORKSPACE_FILE_PREVIEW_EVENT,
  type WorkspaceFilePreviewDetail
} from '../lib/workspace-file-preview'
import {
  createRemoteChannelTaskFromTextApi,
  mirrorRemoteChannelMessageApi,
  updateRemoteChannelActiveThreadContextApi
} from '../lib/remote-channel-api'
import { isUnsupportedLocalRemoteChannelCommand } from '../lib/remote-channel-local-commands'
import {
  buildComposerFileContextPrompt,
  composerFileReferenceKey,
  mergeComposerFileReferences,
  relativeWorkspacePath,
} from '../lib/composer-file-references'
import { readComposerFileContextEntries as readComposerFileContextEntriesFromReferences } from '../lib/composer-file-context'
import { buildWorkspaceReferenceGroups } from '../lib/workspace-reference-groups'
import {
  registerVisibleContextComponent,
  registerVisibleContextSensitiveElements,
  registerVisibleContextVisualTarget,
  setVisibleContextShell
} from '../lib/visible-context'
import {
  buildAnchoredCommentContextPrompt,
  type AnchoredCommentPromptReference
} from '../lib/anchored-comment-chat'
import {
  ANCHORED_COMMENTS_ADD_TO_CONVERSATION_EVENT,
  AnchoredCommentsLayer,
  anchoredCommentStore,
  type AnchoredCommentsAddToConversationDetail
} from './anchored-comments'

const ChangeInspector = lazy(() =>
  import('./ChangeInspector').then((module) => ({ default: module.ChangeInspector }))
)
const DevBrowserPanel = lazy(() =>
  import('./DevBrowserPanel').then((module) => ({ default: module.DevBrowserPanel }))
)
const EvidenceDagPanel = lazy(() =>
  import('./evidence/EvidenceDagPanel').then((module) => ({ default: module.EvidenceDagPanel }))
)
const ProjectDagPanel = lazy(() =>
  import('./project-dag/ProjectDagPanel').then((module) => ({ default: module.ProjectDagPanel }))
)
const GitCheckpointPanel = lazy(() =>
  import('./GitCheckpointPanel').then((module) => ({ default: module.GitCheckpointPanel }))
)
const ChatFileTreePanel = lazy(() =>
  import('./chat/ChatFileTreePanel').then((module) => ({ default: module.ChatFileTreePanel }))
)
const PluginMarketplaceView = lazy(() =>
  import('./PluginMarketplaceView').then((module) => ({ default: module.PluginMarketplaceView }))
)
const WorkspaceFilePreviewPanelBridge = lazy(() =>
  import('./WorkspaceFilePreviewPanelBridge').then((module) => ({
    default: module.WorkspaceFilePreviewPanelBridge
  }))
)
const PlanPanel = lazy(() =>
  import('./plan/PlanPanel').then((module) => ({ default: module.PlanPanel }))
)
const TodoPanel = lazy(() =>
  import('./todo/TodoPanel').then((module) => ({ default: module.TodoPanel }))
)
const ScheduleTasksView = lazy(() =>
  import('./schedule/ScheduleTasksView').then((module) => ({ default: module.ScheduleTasksView }))
)
const WorkflowView = lazy(() =>
  import('./workflow/WorkflowView').then((module) => ({ default: module.WorkflowView }))
)
const WorkflowRunPanel = lazy(() =>
  import('./workflow/WorkflowRunPanel').then((module) => ({ default: module.WorkflowRunPanel }))
)
const PaperRadarPanel = lazy(() =>
  import('./paper/PaperRadarPanel').then((module) => ({ default: module.PaperRadarPanel }))
)
const TerminalPanel = lazy(() =>
  import('./terminal/TerminalPanel').then((module) => ({ default: module.TerminalPanel }))
)
const VisualReviewPanel = lazy(() =>
  import('./visual-review/VisualReviewPanel').then((module) => ({ default: module.VisualReviewPanel }))
)

function rightPanelVisibleContextTitle(mode: Exclude<RightPanelMode, null>): string {
  switch (mode) {
    case 'file':
      return 'File preview'
    case 'browser':
      return 'Dev browser'
    case 'child-agents':
      return 'Child agents'
    case 'changes':
      return 'Changes'
    case 'todo':
      return 'Todos'
    case 'paper':
      return 'Paper radar'
    case 'evidence':
      return 'Evidence graph'
    case 'project-dag':
      return 'Project DAG'
    case 'checkpoints':
      return 'Git checkpoints'
    case 'visual-review':
      return 'Visual review'
    case 'plan':
      return 'Plan'
    case 'sdd-ai':
      return 'SDD assistant'
    default:
      return String(mode)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function visualDocumentIdForArtifact(contextId: string, path: string): string {
  const normalized = `${contextId}:${path.replace(/\\/g, '/')}`
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  const name = path.replace(/\\/g, '/').split('/').pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'visual'
  return `visual-${contextId.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48)}-${name.slice(0, 48)}-${(hash >>> 0).toString(16)}`
}

type PendingSddPlanTarget = {
  planId: string
  relativePath: string
  workspaceRoot: string
}

const COMPOSER_FILE_CONTEXT_MAX_CHARS_PER_FILE = 60_000
const COMPOSER_FILE_CONTEXT_MAX_TOTAL_CHARS = 180_000
const COMPOSER_DIRECTORY_CONTEXT_MAX_FILES = 40
const PDF_ATTACHMENT_MAX_BYTES = 64 * 1024 * 1024
const SCIENTIFIC_ATTACHMENT_MAX_BYTES = 256 * 1024
const SCIENTIFIC_ATTACHMENT_EXTENSIONS =
  /\.(?:fasta|fa|faa|fna|ffn|frn|fastq|fq|smi|smiles|mol|mol2|sdf|mgf|pdb|cif|gb|gbk|gff|gff3|gtf|vcf|bed|nwk|seq)$/i

type AttachedComposerComment = ComposerCommentReference & AnchoredCommentPromptReference
const DESKTOP_SHORTCUT_COMMANDS: Partial<Record<KeyboardShortcutCommandId, DesktopCommand>> = {
  quit: 'quit',
  undo: 'undo',
  redo: 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  'select-all': 'selectAll',
  reload: 'reload',
  'zoom-in': 'zoomIn',
  'zoom-out': 'zoomOut',
  'reset-zoom': 'resetZoom',
  'toggle-devtools': 'toggleDevTools',
  close: 'close',
  minimize: 'minimize',
  'toggle-maximize': 'toggleMaximize'
}

function fileNameFromPath(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).pop() || 'file'
}

function isPickedPdfAttachment(input: ComposerImageAttachmentInput): boolean {
  return input.file.type.toLowerCase() === 'application/pdf' || input.file.name.toLowerCase().endsWith('.pdf')
}

function isPickedImageAttachment(input: ComposerImageAttachmentInput): boolean {
  return input.file.type.toLowerCase().startsWith('image/')
}

function isPickedScientificAttachment(input: ComposerImageAttachmentInput): boolean {
  return SCIENTIFIC_ATTACHMENT_EXTENSIONS.test(input.file.name || pathForPickedAttachment(input))
}

function normalizeAttachmentPathForCompare(path: string): string {
  return path.trim().replaceAll('\\', '/').replace(/\/+$/g, '').toLowerCase()
}

function attachmentPathInsideWorkspace(path: string, workspaceRoot: string): boolean {
  const filePath = normalizeAttachmentPathForCompare(path)
  const root = normalizeAttachmentPathForCompare(workspaceRoot)
  return Boolean(root && (filePath === root || filePath.startsWith(`${root}/`)))
}

function pathForPickedAttachment(input: ComposerImageAttachmentInput): string {
  if (input.path?.trim()) return input.path.trim()
  if (typeof window === 'undefined' || typeof window.sciforge?.getPathForFile !== 'function') return ''
  try {
    return window.sciforge.getPathForFile(input.file)?.trim() || ''
  } catch {
    return ''
  }
}

function pickedWorkspaceFileReference(
  input: ComposerImageAttachmentInput,
  workspaceRoot: string
): ComposerFileReference | null {
  const path = pathForPickedAttachment(input)
  if (!path || !attachmentPathInsideWorkspace(path, workspaceRoot)) return null
  const relativePath = relativeWorkspacePath(path, workspaceRoot)
  const isPdf = isPickedPdfAttachment(input)
  return {
    path: relativePath,
    relativePath,
    name: input.file.name || fileNameFromPath(path),
    workspaceRoot,
    ...(isPdf
      ? {
          kind: 'pdf' as const,
          mimeType: 'application/pdf',
          modelRouterObject: true
        }
      : {})
  }
}

function safeUploadSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized.slice(0, 80) || fallback
}

function safeUploadFileName(input: ComposerImageAttachmentInput, fallback: string): string {
  const name = input.file.name || fileNameFromPath(pathForPickedAttachment(input))
  const safe = name.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? fallback
  return safeUploadSegment(safe, fallback).replace(/^\.+/g, '') || fallback
}

function safeScientificUploadFileName(input: ComposerImageAttachmentInput): string {
  return safeUploadFileName(input, 'scientific-data')
}

function scientificAttachmentMimeType(input: ComposerImageAttachmentInput): string {
  const browserType = input.file.type.trim()
  if (browserType && !browserType.startsWith('image/')) return browserType
  return 'text/plain'
}

function uploadRelativePath(input: ComposerImageAttachmentInput, threadId: string | null, fallbackName: string): string {
  const owner = safeUploadSegment(threadId ?? 'draft', 'draft')
  const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '').slice(0, 15)
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  const name = safeUploadFileName(input, fallbackName)
  return `.sciforge/uploads/${owner}/${stamp}-${random}-${name}`
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

async function copyPdfAttachmentToWorkspace(
  input: ComposerImageAttachmentInput,
  workspaceRoot: string,
  threadId: string | null
): Promise<ComposerFileReference> {
  if (typeof window === 'undefined' || typeof window.sciforge?.writeWorkspaceFile !== 'function') {
    throw new Error('Workspace file writing is unavailable.')
  }
  if (input.file.size > PDF_ATTACHMENT_MAX_BYTES) {
    throw new Error(`PDF attachment is larger than ${PDF_ATTACHMENT_MAX_BYTES} bytes.`)
  }
  const relativePath = uploadRelativePath(input, threadId, 'document.pdf')
  const contentBase64 = arrayBufferToBase64(await input.file.arrayBuffer())
  const result = await window.sciforge.writeWorkspaceFile({
    workspaceRoot,
    path: relativePath,
    contentBase64
  })
  if (!result.ok) throw new Error(result.message)
  return {
    path: relativePath,
    relativePath,
    name: safeUploadFileName(input, 'document.pdf'),
    workspaceRoot,
    kind: 'pdf',
    mimeType: 'application/pdf',
    modelRouterObject: true
  }
}

async function copyScientificAttachmentToWorkspace(
  input: ComposerImageAttachmentInput,
  workspaceRoot: string,
  threadId: string | null
): Promise<ComposerFileReference> {
  if (typeof window === 'undefined' || typeof window.sciforge?.writeWorkspaceFile !== 'function') {
    throw new Error('Workspace file writing is unavailable.')
  }
  if (input.file.size > SCIENTIFIC_ATTACHMENT_MAX_BYTES) {
    throw new Error(`Scientific attachment is larger than ${SCIENTIFIC_ATTACHMENT_MAX_BYTES} bytes.`)
  }
  const content = await input.file.text()
  if (content.includes('\0')) {
    throw new Error('Scientific attachment looks binary and cannot be copied as text.')
  }
  const encodedBytes = new TextEncoder().encode(content).byteLength
  if (encodedBytes > SCIENTIFIC_ATTACHMENT_MAX_BYTES) {
    throw new Error(`Scientific attachment is larger than ${SCIENTIFIC_ATTACHMENT_MAX_BYTES} bytes.`)
  }
  const name = safeScientificUploadFileName(input)
  const relativePath = uploadRelativePath(input, threadId, 'scientific-data')
  const result = await window.sciforge.writeWorkspaceFile({
    workspaceRoot,
    path: relativePath,
    content
  })
  if (!result.ok) throw new Error(result.message)
  return {
    path: relativePath,
    relativePath,
    name,
    workspaceRoot,
    mimeType: scientificAttachmentMimeType(input),
    modelRouterObject: true
  }
}

function sddDraftPlanRelativePath(draft: SddDraft): string {
  const parts = draft.relativePath.replaceAll('\\', '/').split('/').filter(Boolean)
  const draftFolder = parts.at(-2)?.trim() || draft.id.split(':').pop()?.trim() || `draft-${Date.now()}`
  return buildPlanRelativePath(`sdd-${draftFolder}`)
}

function sddDraftSourceRequest(markdown: string, fallbackPath: string): string {
  const firstMeaningfulLine = markdown
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean)
  return (firstMeaningfulLine || fallbackPath).slice(0, 160)
}

function sddPlanMatchesPendingTarget(
  plan: { id: string; workspaceRoot: string; relativePath: string } | null,
  target: PendingSddPlanTarget | null
): boolean {
  if (!plan || !target) return false
  if (plan.id === target.planId) return true
  return buildGuiPlanId(plan.workspaceRoot, plan.relativePath) === target.planId
}

function mergeSkillCommands(
  runtimeSkills: LocalRuntimeSkillJson[],
  localSkills: SkillListItem[]
): LocalRuntimeSkillJson[] {
  const merged = new Map<string, LocalRuntimeSkillJson>()
  for (const skill of localSkills) {
    merged.set(skill.id, {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      root: skill.root,
      legacy: skill.legacy,
      scope: skill.scope
    })
  }
  for (const skill of runtimeSkills) {
    const existing = merged.get(skill.id)
    merged.set(skill.id, existing ? {
      ...skill,
      ...existing,
      triggers: skill.triggers ?? existing.triggers,
      allowedTools: skill.allowedTools ?? existing.allowedTools
    } : skill)
  }
  return [...merged.values()]
}

function RemoteGuardSessionHeader({
  channel
}: {
  channel: RemoteChannelV1
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-accent/20 bg-accent/10 text-accent">
        <Bot className="h-4 w-4" strokeWidth={1.85} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[14.5px] font-semibold leading-5 text-ds-ink">
          {remoteGuardChannelTitle(channel)}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] leading-4 text-ds-faint">
          {remoteGuardProviderLabel(channel.provider)}
        </div>
      </div>
    </div>
  )
}

function sddAssistantContextFromBlocks(blocks: ChatBlock[], maxMessages = 10): string {
  const messages: string[] = []
  for (const block of blocks) {
    if (block.kind !== 'user' && block.kind !== 'assistant') continue
    if (block.kind === 'user' && block.meta?.displayText) continue
    const text = block.text.trim()
    if (!text) continue
    messages.push(`${block.kind === 'user' ? 'User' : 'Requirement AI'}:\n${text}`)
  }
  return messages.slice(-maxMessages).join('\n\n').slice(0, 12_000)
}

function base64ImageToFile(image: SddDraftImageReference): File {
  return base64ToFile(image.dataBase64, fileNameFromPath(image.relativePath), image.mimeType)
}

function clipboardImageToFile(image: Extract<ClipboardImageReadResult, { ok: true }>): File {
  return base64ToFile(image.dataBase64, image.name, image.mimeType)
}

function base64ToFile(dataBase64: string, name: string, mimeType: string): File {
  const binary = atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new File([bytes], name || 'image', { type: mimeType })
}

export function Workbench(): ReactElement {
  const { t } = useTranslation('common')
  const {
    threads,
    threadSearch,
    showArchivedThreads,
    activeThreadId,
    focusedAgentThreadId,
    focusedAgentRuntimeId,
    agentFocusLineage,
    agentFocusHistory,
    agentFocusHistoryIndex,
    selectThread,
    focusAgentThread,
    focusAgentBack,
    focusAgentForward,
    focusAgentParent,
    createThread,
    blocks,
    liveReasoning,
    liveAssistant,
    error,
    runtimeErrorDetail,
    busy,
    route,
    pluginHostRoute,
    connectPhonePanelOpen,
    workspaceRoot,
    runtimeConnection,
    activeAgentRuntime,
    setRoute,
    openSettings,
    openPlugins,
    openConnectPhone,
    setConnectPhonePanelOpen,
    openSchedule,
    openWorkflow,
    chooseWorkspace,
    remoteChannels,
    activeRemoteChannelId,
    remoteGuardChannelId,
    remoteTargetId,
    selectRemoteChannel,
    resetRemoteChannelSession,
    setRemoteChannelModel,
    appendLocalRemoteChannelTurn,
    setError,
    sendMessage,
    reviewActiveThread,
    queuedMessages,
    chatSessionPersistenceDegraded,
    activeThreadTodos,
    watchTurnCompletion,
    unreadThreadIds,
    removeQueuedMessage,
    updateQueuedMessage,
    steerQueuedMessage,
    retryQueuedMessage,
    interrupt,
    probeRuntime,
    composerModel,
    composerPickList,
    composerModelGroups,
    setComposerModel,
    setActiveAgentRuntime,
    setThreadSearch,
    setShowArchivedThreads,
    renameThread,
    archiveThread,
    deleteThread,
    spawnSideConversation,
    sendSideMessage,
    attachSideConversation,
    openSideConversationDraft,
    selectSideConversation,
    setSidePanelOpen,
    childRefreshKey,
    sideConversations,
    sidePanel,
    codeWorkspaceRoots
  } = useChatStore(
    useShallow((s) => ({
      threads: s.threads,
      threadSearch: s.threadSearch,
      showArchivedThreads: s.showArchivedThreads,
      activeThreadId: s.activeThreadId,
      focusedAgentThreadId: s.focusedAgentThreadId,
      focusedAgentRuntimeId: s.focusedAgentRuntimeId,
      agentFocusLineage: s.agentFocusLineage,
      agentFocusHistory: s.agentFocusHistory,
      agentFocusHistoryIndex: s.agentFocusHistoryIndex,
      selectThread: s.selectThread,
      focusAgentThread: s.focusAgentThread,
      focusAgentBack: s.focusAgentBack,
      focusAgentForward: s.focusAgentForward,
      focusAgentParent: s.focusAgentParent,
      createThread: s.createThread,
      blocks: s.blocks,
      liveReasoning: s.liveReasoning,
      liveAssistant: s.liveAssistant,
      error: s.error,
      runtimeErrorDetail: s.runtimeErrorDetail,
      busy: s.busy,
      route: s.route,
      pluginHostRoute: s.pluginHostRoute,
      connectPhonePanelOpen: s.connectPhonePanelOpen,
      workspaceRoot: s.workspaceRoot,
      runtimeConnection: s.runtimeConnection,
      activeAgentRuntime: s.activeAgentRuntime,
      setRoute: s.setRoute,
      openSettings: s.openSettings,
      openPlugins: s.openPlugins,
      openConnectPhone: s.openConnectPhone,
      setConnectPhonePanelOpen: s.setConnectPhonePanelOpen,
      openSchedule: s.openSchedule,
      openWorkflow: s.openWorkflow,
      chooseWorkspace: s.chooseWorkspace,
      remoteChannels: s.remoteChannels,
      activeRemoteChannelId: s.activeRemoteChannelId,
      remoteGuardChannelId: s.remoteGuardChannelId,
      remoteTargetId: s.remoteTargetId,
      selectRemoteChannel: s.selectRemoteChannel,
      resetRemoteChannelSession: s.resetRemoteChannelSession,
      setRemoteChannelModel: s.setRemoteChannelModel,
      appendLocalRemoteChannelTurn: s.appendLocalRemoteChannelTurn,
      setError: s.setError,
      sendMessage: s.sendMessage,
      reviewActiveThread: s.reviewActiveThread,
      queuedMessages: s.queuedMessages,
      chatSessionPersistenceDegraded: s.chatSessionPersistenceDegraded,
      activeThreadTodos: s.activeThreadTodos,
      watchTurnCompletion: s.watchTurnCompletion,
      unreadThreadIds: s.unreadThreadIds,
      removeQueuedMessage: s.removeQueuedMessage,
      updateQueuedMessage: s.updateQueuedMessage,
      steerQueuedMessage: s.steerQueuedMessage,
      retryQueuedMessage: s.retryQueuedMessage,
      interrupt: s.interrupt,
      probeRuntime: s.probeRuntime,
      composerModel: s.composerModel,
      composerPickList: s.composerPickList,
      composerModelGroups: s.composerModelGroups,
      setComposerModel: s.setComposerModel,
      setActiveAgentRuntime: s.setActiveAgentRuntime,
      setThreadSearch: s.setThreadSearch,
      setShowArchivedThreads: s.setShowArchivedThreads,
      renameThread: s.renameThread,
      archiveThread: s.archiveThread,
      deleteThread: s.deleteThread,
      spawnSideConversation: s.spawnSideConversation,
      sendSideMessage: s.sendSideMessage,
      attachSideConversation: s.attachSideConversation,
      openSideConversationDraft: s.openSideConversationDraft,
      selectSideConversation: s.selectSideConversation,
      setSidePanelOpen: s.setSidePanelOpen,
      childRefreshKey: s.childRefreshKey,
      sideConversations: s.sideConversations,
      sidePanel: s.sidePanel,
      codeWorkspaceRoots: s.codeWorkspaceRoots
    }))
  )
  const focusedAgentSurface = useChatStore(useShallow(selectFocusedAgentSurface))
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'plan' | 'agent'>('agent')
  const [composerReasoningEffort, setComposerReasoningEffort] =
    useState<ComposerReasoningEffort>('max')
  const [assistantReasoningEffort, setAssistantReasoningEffort] =
    useState<ComposerReasoningEffort>('medium')
  const [runtimeInfo, setRuntimeInfo] = useState<LocalRuntimeInfoJson | null>(null)
  const [runtimeSkills, setRuntimeSkills] = useState<LocalRuntimeSkillJson[]>([])
  const [composerAttachments, setComposerAttachments] = useState<AttachmentReference[]>([])
  const [composerFileReferences, setComposerFileReferences] = useState<ComposerFileReference[]>([])
  const [composerCommentReferences, setComposerCommentReferences] = useState<AttachedComposerComment[]>([])
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false)
  const [attachmentUploadError, setAttachmentUploadError] = useState<string | null>(null)
  const [runtimeLogPath, setRuntimeLogPath] = useState('')
  const [visualCaptureActive, setVisualCaptureActive] = useState(false)
  useEffect(() => {
    const subscribe = window.sciforge?.visibleContext?.onCaptureStateChanged
    if (typeof subscribe !== 'function') return undefined
    let hideTimer: number | null = null
    const unsubscribe = subscribe((active) => {
      if (hideTimer !== null) window.clearTimeout(hideTimer)
      if (active) {
        setVisualCaptureActive(true)
        return
      }
      hideTimer = window.setTimeout(() => {
        hideTimer = null
        setVisualCaptureActive(false)
      }, 800)
    })
    return () => {
      if (hideTimer !== null) window.clearTimeout(hideTimer)
      unsubscribe()
    }
  }, [])
  useEffect(() => {
    const onAddComments = (event: Event): void => {
      const detail = (event as CustomEvent<AnchoredCommentsAddToConversationDetail>).detail
      if (!detail?.threadIds?.length) return
      const selectedIds = new Set(detail.threadIds)
      const additions: AttachedComposerComment[] = anchoredCommentStore.getState().threads
        .filter((thread) => selectedIds.has(thread.id))
        .map((thread) => ({
          id: thread.id,
          label: thread.target.label,
          comment: thread.comment,
          createdAt: thread.createdAt,
          route: thread.target.route,
          anchor: {
            kind: thread.target.resourceId ? 'research' : thread.target.componentId ? 'ui' : 'visual',
            ...(thread.target.resourceType ? { resourceType: thread.target.resourceType } : {}),
            ...(thread.target.resourceId ? { resourceId: thread.target.resourceId } : {}),
            ...(thread.target.componentId ? { componentId: thread.target.componentId } : {}),
            ...(thread.target.elementId ? { elementId: thread.target.elementId } : {}),
            ...(thread.target.selection ? { selection: thread.target.selection } : {}),
            bounds: thread.target.bounds,
            domFingerprint: thread.target.domFingerprint
          }
        }))
      setComposerCommentReferences((current) => {
        const byId = new Map(current.map((reference) => [reference.id, reference]))
        for (const addition of additions) byId.set(addition.id, addition)
        return [...byId.values()]
      })
    }
    window.addEventListener(ANCHORED_COMMENTS_ADD_TO_CONVERSATION_EVENT, onAddComments)
    return () => window.removeEventListener(ANCHORED_COMMENTS_ADD_TO_CONVERSATION_EVENT, onAddComments)
  }, [])
  const removeComposerCommentReference = useCallback((id: string): void => {
    setComposerCommentReferences((current) => current.filter((reference) => reference.id !== id))
  }, [])
  const annotationQuestionBridge = useMemo(() => ({
    sideConversations,
    spawnSideConversation,
    sendSideMessage
  }), [sendSideMessage, sideConversations, spawnSideConversation])
  const assistantModel = useWriteWorkspaceStore((s) => s.assistantModel)
  const setAssistantModel = useWriteWorkspaceStore((s) => s.setAssistantModel)
  const activeSddDraft = useSddDraftStore((s) => s.activeDraft)
  const sddDraftOperationStatus = useSddDraftStore((s) => s.operationStatus)
  const assistantPickList = useMemo(() => {
    const ordered = new Set<string>()
    for (const id of DEFAULT_COMPOSER_MODEL_IDS) {
      const normalized = id.trim()
      if (normalized) ordered.add(normalized)
    }
    for (const id of composerPickList) {
      const normalized = id.trim()
      if (normalized) ordered.add(normalized)
    }
    const current = assistantModel.trim()
    if (current) ordered.add(current)
    return [...ordered]
  }, [assistantModel, composerPickList])
  const stageInsetClass = 'ds-stage-inset'
  const paperRadarEnabled = import.meta.env.DEV && isPluginInstalled('extension', PAPER_RADAR_EXTENSION_ID)
  const keyboardShortcuts = useKeyboardShortcutSettings()
  const keyboardShortcutBindings = useMemo(
    () => resolveKeyboardShortcutBindings(keyboardShortcuts),
    [keyboardShortcuts]
  )

  const prevThreadId = useRef<string | null>(null)
  const inputRef = useRef('')
  const sddUpgradeInFlightRef = useRef(false)
  const sddUpgradeTargetRef = useRef<PendingSddPlanTarget | null>(null)
  const timelineBlocks = blocks
  const timelineLiveReasoning = liveReasoning
  const timelineLiveAssistant = liveAssistant
  const devPreviewBlocks = useMemo<ChatBlock[]>(() => {
    const liveText = timelineLiveAssistant.trim()
    if (!liveText) return timelineBlocks
    return [
      ...timelineBlocks,
      {
        kind: 'assistant',
        id: '__live-assistant-dev-preview',
        text: timelineLiveAssistant
      }
    ]
  }, [timelineBlocks, timelineLiveAssistant])
  const detectedDevPreviewUrls = useMemo(
    () => extractLatestTurnDevPreviewUrls(devPreviewBlocks),
    [devPreviewBlocks]
  )
  const autoOpenDevPreviewUrls = useMemo(
    () => extractLatestTurnAutoOpenDevPreviewUrls(devPreviewBlocks),
    [devPreviewBlocks]
  )
  const activeRemoteChannel = useMemo(
    () => remoteChannels.find((channel) => channel.id === activeRemoteChannelId) ?? null,
    [activeRemoteChannelId, remoteChannels]
  )
  const remoteGuardChannel = useMemo(
    () => remoteGuardChannelId
      ? remoteChannels.find((channel) => channel.id === remoteGuardChannelId) ?? null
      : null,
    [remoteGuardChannelId, remoteChannels]
  )
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads]
  )
  const focusedThreadId = focusedAgentSurface?.threadId ?? activeThreadId
  const focusedRuntimeId = focusedAgentSurface?.runtimeId ?? focusedAgentRuntimeId ?? activeThread?.runtimeId
  const focusedSide = focusedAgentSurface?.source === 'side' && focusedThreadId
    ? sideConversations[focusedThreadId] ?? null
    : null
  const focusedChild = useMemo<AgentRuntimeChild | null>(() => {
    if (!focusedSide || !focusedThreadId) return null
    return {
      id: focusedThreadId,
      runtimeId: focusedSide.runtimeId ?? focusedRuntimeId ?? activeAgentRuntime,
      parentThreadId: focusedSide.parentThreadId,
      kind: 'thread',
      status: focusedSide.error ? 'failed' : focusedSide.busy ? 'running' : 'completed',
      name: focusedSide.title,
      openAsThreadRef: {
        runtimeId: focusedSide.runtimeId ?? focusedRuntimeId ?? activeAgentRuntime,
        threadId: focusedThreadId,
        relation: 'side',
        title: focusedSide.title
      }
    }
  }, [activeAgentRuntime, focusedRuntimeId, focusedSide, focusedThreadId])
  const focusedPanelThread = useMemo<NormalizedThread | null>(() => {
    if (!focusedSide || !focusedThreadId) return activeThread
    return {
      id: focusedThreadId,
      title: focusedSide.title,
      updatedAt: focusedSide.createdAt,
      model: focusedSide.model,
      mode: 'agent',
      status: focusedSide.busy ? 'running' : 'idle',
      runtimeId: focusedSide.runtimeId ?? focusedRuntimeId,
      relation: 'side',
      parentThreadId: focusedSide.parentThreadId,
      workspace: activeThread?.workspace
    }
  }, [activeThread, focusedRuntimeId, focusedSide, focusedThreadId])
  const childAgentAttention = useChildAgentAttention({
    rootThreadId: activeThreadId,
    rootLabel: activeThread?.title,
    runtimeId: activeThread?.runtimeId,
    runtimeReady: runtimeConnection === 'ready',
    childRefreshKey,
    unreadThreadIds
  })
  const remoteThreadBindings = useMemo(
    () => remoteChannelThreadBindingsFromChannels(remoteChannels),
    [remoteChannels]
  )
  const queuedThreadIds = useMemo(
    () => new Set(queuedMessages
      .filter((message) => !message.deliveryAttempt?.journalOnly || message.deliveryAttempt.restored || message.sendFailure)
      .map((message) => message.threadId?.trim() ?? '')
      .filter(Boolean)),
    [queuedMessages]
  )
  const activeQueuedMessages = useMemo(
    () => activeThreadId
      ? queuedMessages.filter(
          (message) =>
            (!message.threadId || message.threadId === activeThreadId) &&
            (!message.runtimeId || !activeThread?.runtimeId || message.runtimeId === activeThread.runtimeId) &&
            (!message.deliveryAttempt?.journalOnly || message.deliveryAttempt.restored || Boolean(message.sendFailure))
        )
      : [],
    [activeThread?.runtimeId, activeThreadId, queuedMessages]
  )
  const activeRemoteBinding = activeThreadId
    ? remoteThreadBindings.get(activeThreadId) ?? null
    : null
  const activeThreadIsRemoteChannel = Boolean(
    activeRemoteBinding ||
    (activeThread && isRemoteChannelThread(activeThread, remoteChannels))
  )
  const selectedRemoteTargetId =
    route === 'chat' && !activeThreadIsRemoteChannel ? remoteTargetId?.trim() ?? '' : ''
  const activeRemoteComposerChannel = activeRemoteBinding
    ? remoteChannels.find((channel) => channel.id === activeRemoteBinding.channelId) ?? activeRemoteChannel
    : activeRemoteChannel
  const activeRemoteComposerChannelId = activeRemoteComposerChannel?.id ?? activeRemoteChannelId
  const activeRemoteStatusKind = activeThreadId
    ? deriveRemoteChannelThreadStatusKind({
        binding: activeRemoteBinding,
        running: busy || watchTurnCompletion[activeThreadId] === true,
        queued: queuedThreadIds.has(activeThreadId),
        status: activeThread?.status,
        latestTurnStatus: activeThread?.latestTurnStatus
      })
    : null
  const activeRemoteUnread =
    activeThreadId ? unreadThreadIds[activeThreadId] === true : false
  const activeSkillWorkspace = useMemo(
    () => activeThread?.workspace || workspaceRoot || '',
    [activeThread, workspaceRoot]
  )
  const activeWorkspaceReferenceRoot = useMemo(
    () => normalizeWorkspaceRoot(
      activeSkillWorkspace || workspaceRoot
    ),
    [activeSkillWorkspace, workspaceRoot]
  )
  const workspaceReferenceGroups = useMemo(
    () => buildWorkspaceReferenceGroups({
      activeThreadWorkspace: activeThread?.workspace,
      workspaceRoot,
      codeWorkspaceRoots
    }),
    [activeThread?.workspace, codeWorkspaceRoots, workspaceRoot]
  )
  const [fileTreeWorkspaceOverride, setFileTreeWorkspaceOverride] = useState<string | null>(null)
  const fileTreeWorkspaceRoot = fileTreeWorkspaceOverride || activeWorkspaceReferenceRoot || workspaceRoot
  const fileTreeWorkspaceGroups = useMemo(
    () =>
      fileTreeWorkspaceOverride
        ? [{
            id: `workspace:${fileTreeWorkspaceOverride}`,
            label: t('rightPanelFiles'),
            workspaceRoot: fileTreeWorkspaceOverride,
            kind: 'worktree' as const
          }]
        : workspaceReferenceGroups,
    [fileTreeWorkspaceOverride, t, workspaceReferenceGroups]
  )
  useEffect(() => {
    const updateRemoteChannelActiveThreadContext = typeof window !== 'undefined'
      ? updateRemoteChannelActiveThreadContextApi(window.sciforge)
      : undefined
    if (typeof updateRemoteChannelActiveThreadContext !== 'function') return
    if (!activeThreadId || (activeThread && isRemoteChannelThread(activeThread, remoteChannels))) {
      void updateRemoteChannelActiveThreadContext(null).catch(() => undefined)
      return
    }
    void updateRemoteChannelActiveThreadContext({
      threadId: activeThreadId,
      runtimeId: activeThread?.runtimeId,
      workspaceRoot: activeThread?.workspace || workspaceRoot || undefined
    }).catch(() => undefined)
  }, [activeThread, activeThreadId, remoteChannels, route, workspaceRoot])
  const composerChangeSummary = useMemo(
    () => collectComposerChangeSummary(timelineBlocks, activeSkillWorkspace),
    [activeSkillWorkspace, timelineBlocks]
  )
  const latestDevPreviewUrl = detectedDevPreviewUrls[0] ?? null
  const latestAutoOpenDevPreviewUrl = autoOpenDevPreviewUrls[0] ?? null
  const currentSideConversations = useMemo(
    () =>
      Object.values(sideConversations)
        .filter((side) => side.parentThreadId === activeThreadId)
        .filter((side) => (side.source ?? 'side') === 'side')
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [activeThreadId, sideConversations]
  )
  const currentSideRunningCount = currentSideConversations.reduce(
    (count, side) => count + (side.busy ? 1 : 0),
    0
  )
  const threadChildrenState = useThreadChildren({
    activeThreadId: focusedThreadId,
    activeRuntimeId: focusedRuntimeId,
    childRefreshKey,
    runtimeReady: runtimeConnection === 'ready',
    busy: focusedAgentSurface?.busy ?? busy
  })
  const visibleThreadChildren = useMemo(
    () => filterDirectChildAgents(
      threadChildrenState.children,
      focusedThreadId,
      focusedRuntimeId
    ),
    [focusedRuntimeId, focusedThreadId, threadChildrenState.children]
  )
  const childAgentCount = visibleThreadChildren.length
  const childAgentRunningCount = visibleThreadChildren.reduce(
    (count, child) => count + (child.status === 'running' || child.status === 'queued' ? 1 : 0),
    0
  )
  const focusNavigationLineage = useMemo(
    () => agentFocusLineage.map((node) => {
      const side = sideConversations[node.threadId]
      return {
        threadId: node.threadId,
        label: node.title?.trim() || side?.title || node.threadId,
        ...(side
          ? { status: side.error ? 'failed' as const : side.busy ? 'running' as const : 'completed' as const }
          : {})
      }
    }),
    [agentFocusLineage, sideConversations]
  )
  const activeVisualDocumentId = activeThreadId ? `visual-${activeThreadId}` : 'visual-default'
  const [visualReviewRequest, setVisualReviewRequest] = useState<{
    documentId: string
    refreshKey: number
    workspaceRoot?: string
    restored?: boolean
  } | null>(() => {
    const restored = readStoredRightPanelContext()
    return restored?.mode === 'visual-review' && restored.visualDocumentId
      ? {
          documentId: restored.visualDocumentId,
          refreshKey: 0,
          restored: true,
          ...(restored.workspaceRoot ? { workspaceRoot: restored.workspaceRoot } : {})
        }
      : null
  })
  const {
    beginLeftResize,
    beginRightResize,
    beginTerminalResize,
    discardRightPanelResource,
    canNavigateRightPanelBack,
    canNavigateRightPanelForward,
    filePreviewReturnContext,
    filePreviewTarget,
    leftSidebarCollapsed,
    leftSidebarWidth,
    navigateRightPanelBack,
    navigateRightPanelForward,
    openDevPreview,
    rightPanelMode,
    rightPanelVisible,
    rightSidebarWidth,
    setFilePreviewTarget,
    setFilePreviewReturnContext,
    setRightPanelMode,
    setRightSidebarWidth,
    shellRef,
    terminalHeight,
    terminalOpen,
    toggleLeftSidebar,
    toggleRightPanelMode,
    toggleTerminal,
  } = useWorkbenchLayout({
    activeThreadId,
    latestAutoOpenDevPreviewUrl,
    latestDevPreviewUrl,
    route,
    workspaceRoot,
    contextValidationReady: runtimeConnection === 'ready',
    visualDocumentId: visualReviewRequest?.documentId ?? activeVisualDocumentId
  })
  const restoredFilePreviewTargetRef = useRef(filePreviewTarget)
  useEffect(() => {
    const target = restoredFilePreviewTargetRef.current
    if (runtimeConnection !== 'ready' || !target) return
    restoredFilePreviewTargetRef.current = null
    const targetWorkspaceRoot = target.workspaceRoot || workspaceRoot
    if (!targetWorkspaceRoot || typeof window.sciforge?.readWorkspaceFile !== 'function') {
      discardRightPanelResource('file', target.path)
      return
    }
    let cancelled = false
    void window.sciforge.readWorkspaceFile({
      path: target.path,
      workspaceRoot: targetWorkspaceRoot
    }).then((result) => {
      if (cancelled || result.ok) return
      discardRightPanelResource('file', target.path)
    }).catch(() => {
      if (cancelled) return
      discardRightPanelResource('file', target.path)
    })
    return () => {
      cancelled = true
    }
  }, [discardRightPanelResource, runtimeConnection, workspaceRoot])

  useEffect(() => {
    if (runtimeConnection !== 'ready' || !visualReviewRequest?.restored) return
    if (rightPanelMode !== 'visual-review') {
      setVisualReviewRequest(null)
      return
    }
    const targetWorkspaceRoot = visualReviewRequest.workspaceRoot || workspaceRoot
    if (!targetWorkspaceRoot || typeof window.sciforge?.openVisualDocument !== 'function') {
      setVisualReviewRequest(null)
      discardRightPanelResource('visual-review', visualReviewRequest.documentId)
      return
    }
    let cancelled = false
    void window.sciforge.openVisualDocument({
      workspaceRoot: targetWorkspaceRoot,
      documentId: visualReviewRequest.documentId,
      createIfMissing: false
    }).then(() => {
      if (cancelled) return
      setVisualReviewRequest((current) => current
        ? { ...current, restored: false }
        : null)
    }).catch(() => {
      if (cancelled) return
      setVisualReviewRequest(null)
      discardRightPanelResource('visual-review', visualReviewRequest.documentId)
    })
    return () => {
      cancelled = true
    }
  }, [discardRightPanelResource, rightPanelMode, runtimeConnection, visualReviewRequest, workspaceRoot])
  const [childPanelFocusRequest, setChildPanelFocusRequest] = useState<{
    childId: string | null
    key: number
  }>({ childId: null, key: 0 })

  const openChildInFocus = useCallback(async (child: AgentRuntimeChild): Promise<boolean> => {
    const threadId = child.openAsThreadRef?.threadId?.trim()
    if (!threadId) return false
    const parentThreadId = child.parentThreadId?.trim() || focusedThreadId || activeThreadId
    if (!parentThreadId) return false
    if (!useChatStore.getState().sideConversations[threadId]) {
      await attachSideConversation({
        threadId,
        parentThreadId,
        runtimeId: child.openAsThreadRef?.runtimeId ?? child.runtimeId,
        title: child.name?.trim() || child.label?.trim() || child.id,
        model: focusedAgentSurface?.model || activeThread?.model || composerModel,
        source: 'child_agent'
      })
    }
    return focusAgentThread({
      threadId,
      parentThreadId,
      runtimeId: child.openAsThreadRef?.runtimeId ?? child.runtimeId,
      title: child.name?.trim() || child.label?.trim() || child.id
    })
  }, [
    activeThread?.model,
    activeThreadId,
    attachSideConversation,
    composerModel,
    focusAgentThread,
    focusedAgentSurface?.model,
    focusedThreadId
  ])

  const openPrimaryChildAttention = useCallback(async (): Promise<void> => {
    const target = childAgentAttention.summary.primaryTarget
    if (!target) {
      setRightPanelMode('child-agents')
      return
    }
    const lineage = target.path.map((node, index) => ({
      threadId: node.threadId,
      parentThreadId: index > 0 ? target.path[index - 1]?.threadId ?? null : null,
      ...(index === target.path.length - 1 ? { runtimeId: target.runtimeId } : {}),
      title: node.label
    }))
    if (target.threadId) {
      if (!useChatStore.getState().sideConversations[target.threadId]) {
        await attachSideConversation({
          threadId: target.threadId,
          parentThreadId: target.parentThreadId,
          runtimeId: target.runtimeId,
          title: target.label,
          model: activeThread?.model || composerModel,
          source: 'child_agent'
        })
      }
      focusAgentThread({
        threadId: target.threadId,
        parentThreadId: target.parentThreadId,
        runtimeId: target.runtimeId,
        title: target.label,
        lineage
      })
    } else {
      const parent = target.path[target.path.length - 1]
      if (parent) {
        focusAgentThread({ threadId: parent.threadId, title: parent.label, lineage })
      }
    }
    setChildPanelFocusRequest({ childId: target.threadId ? null : target.childId, key: Date.now() })
    setRightPanelMode('child-agents')
  }, [
    activeThread?.model,
    attachSideConversation,
    childAgentAttention.summary.primaryTarget,
    composerModel,
    focusAgentThread,
    setRightPanelMode
  ])
  const [projectDagReturnTarget, setProjectDagReturnTarget] = useState<{
    claimId?: string
    nodeId?: string
  } | null>(null)
  const [evidenceDagReturnNode, setEvidenceDagReturnNode] = useState<{
    nodeId: string
    threadId: string
  } | null>(null)
  useEffect(() => {
    setEvidenceDagReturnNode((current) =>
      current && current.threadId !== activeThreadId ? null : current
    )
  }, [activeThreadId])
  const [fileTreeInitialDirectory, setFileTreeInitialDirectory] = useState<FileTreeInitialDirectory | null>(null)
  const {
    activeGuiPlan,
    buildGuiPlan,
    handleGuiPlanCommand,
    openGuiPlanPanel,
    replanChangedRequirements,
    sendPlanTurn,
    verifyGuiPlan
  } = useWorkbenchPlanController({
    blocks,
    busy,
    mode,
    route,
    sendMessage,
    setError,
    setMode,
    setRightPanelMode,
    setRightSidebarWidth,
    t,
    workspaceRoot,
    onPlanBuildStarted: async (plan) => {
      const threadId = plan.threadId?.trim() || useChatStore.getState().activeThreadId
      if (!threadId || !releaseSddAssistantThread(threadId)) return
      await useChatStore.getState().refreshThreads()
    }
  })
  useEffect(() => {
    setVisibleContextShell({
      activeThreadId,
      route,
      workspaceRoot
    })
  }, [activeThreadId, route, workspaceRoot])

  useEffect(() => {
    const componentId = 'app.window'
    const unregisterComponent = registerVisibleContextComponent({
      id: componentId,
      region: 'window',
      component: 'sciforge-window',
      title: 'SciForge',
      visible: true,
      priority: 1,
      updatedAt: new Date().toISOString(),
      summary: 'The active SciForge application window.'
    })
    const unregisterTarget = registerVisibleContextVisualTarget({
      componentId,
      target: {
        id: 'window.current',
        kind: 'window',
        contentType: 'ui',
        active: true
      }
    })
    const unregisterSensitiveElements = registerVisibleContextSensitiveElements({
      componentId,
      root: document.documentElement
    })
    return () => {
      unregisterSensitiveElements()
      unregisterTarget()
      unregisterComponent()
    }
  }, [])

  useEffect(() => {
    if (!rightPanelMode) return undefined
    const targetWorkspaceRoot = filePreviewTarget?.workspaceRoot || workspaceRoot
    return registerVisibleContextComponent({
      id: 'right-sidebar',
      region: 'right-sidebar',
      component: 'right-panel',
      title: rightPanelVisibleContextTitle(rightPanelMode),
      visible: true,
      priority: 10,
      updatedAt: new Date().toISOString(),
      summary: `Right sidebar is showing the ${rightPanelVisibleContextTitle(rightPanelMode)} panel.`,
      resources: rightPanelMode === 'file' && filePreviewTarget?.path
        ? [{
            kind: 'workspaceFile',
            role: 'selected-file-preview-target',
            title: filePreviewTarget.path.split(/[/\\]/).filter(Boolean).pop() ?? filePreviewTarget.path,
            accessHint: 'Use gui_workspace_preview/read with workspaceRoot and relativePath when available.',
            workspaceRoot: targetWorkspaceRoot,
            path: filePreviewTarget.path
          }]
        : undefined,
      state: {
        mode: rightPanelMode,
        width: rightSidebarWidth,
        filePreviewPath: filePreviewTarget?.path ?? null,
        filePreviewWorkspaceRoot: rightPanelMode === 'file' ? targetWorkspaceRoot : null
      }
    })
  }, [filePreviewTarget?.path, filePreviewTarget?.workspaceRoot, rightPanelMode, rightSidebarWidth, workspaceRoot])

  useEffect(() => {
    const runDesktopShortcut = (command: DesktopCommand): void => {
      if (typeof window.sciforge?.runDesktopCommand !== 'function') return
      void window.sciforge.runDesktopCommand(command)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return
      const commandId = findKeyboardShortcutCommand(
        keyboardShortcutBindings,
        keyboardEventToShortcut(event)
      )
      if (!commandId) return
      event.preventDefault()

      if (commandId === 'toggle-plan-mode') {
        if (mode === 'plan') {
          setMode('agent')
        } else {
          setMode('plan')
          void handleGuiPlanCommand()
        }
        return
      }
      if (commandId === 'new-chat') {
        void createThread({ forceNew: true })
        return
      }
      if (commandId === 'choose-workspace') {
        void chooseWorkspace()
        return
      }
      if (commandId === 'toggle-terminal') {
        toggleTerminal()
        return
      }
      if (commandId === 'settings') {
        openSettings()
        return
      }

      const desktopCommand = DESKTOP_SHORTCUT_COMMANDS[commandId]
      if (desktopCommand) runDesktopShortcut(desktopCommand)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    chooseWorkspace,
    createThread,
    handleGuiPlanCommand,
    keyboardShortcutBindings,
    mode,
    openSettings,
    setMode,
    toggleTerminal
  ])
  const showDevPreviewCard =
    route === 'chat' &&
    latestDevPreviewUrl !== null

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.sciforge?.getLogPath !== 'function') return
    let cancelled = false
    void window.sciforge
      .getLogPath()
      .then((path) => {
        if (!cancelled) setRuntimeLogPath(path)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const previousThreadId = prevThreadId.current
    prevThreadId.current = activeThreadId
    if (previousThreadId !== null && previousThreadId !== activeThreadId && sidePanel.open) {
      setSidePanelOpen(false)
    }
  }, [activeThreadId, setSidePanelOpen, sidePanel.open])

  const openSideChat = (): void => {
    const latestSide = currentSideConversations.at(-1)
    if (latestSide) {
      selectSideConversation(latestSide.threadId)
      return
    }
    openSideConversationDraft()
  }

  const codeThreads = useMemo(
    () => threads.filter((thread) =>
      !isRemoteChannelThread(thread, remoteChannels) &&
      !isSddAssistantThread(thread) &&
      !isEmptySddAssistantThreadCandidate(thread)
    ),
    [remoteChannels, threads]
  )

  const mirrorRemoteChannelCommand = async (userText: string, replyText: string): Promise<void> => {
    const mirrorRemoteChannelMessage = mirrorRemoteChannelMessageApi(window.sciforge)
    if (!activeThreadId || typeof mirrorRemoteChannelMessage !== 'function') return
    const userResult = await mirrorRemoteChannelMessage(
      activeThreadId,
      userText,
      'user'
    )
    if (!userResult.ok) return
    await mirrorRemoteChannelMessage(
      activeThreadId,
      replyText,
      'assistant'
    )
  }

  const remoteChannelHelpText = (): string =>
    [
      t('remoteChannelHelpTitle'),
      '',
      `- \`/help\`: ${t('remoteChannelHelpCommandHelp')}`,
      `- \`/new\`: ${t('remoteChannelHelpCommandNew')}`,
      `- \`/model\`: ${t('remoteChannelHelpCommandModelShow')}`,
      `- \`/mode\`: ${t('remoteChannelHelpCommandModeShow')}`
    ].join('\n')

  useEffect(() => {
    inputRef.current = input
  }, [input])

  useEffect(() => {
    if (rightPanelMode === 'plan' && !activeGuiPlan) {
      setRightPanelMode(null)
    }
  }, [activeGuiPlan, rightPanelMode, setRightPanelMode])

  useEffect(() => {
    if (rightPanelMode === 'paper' && !paperRadarEnabled) {
      setRightPanelMode(null)
    }
  }, [paperRadarEnabled, rightPanelMode, setRightPanelMode])

  useEffect(() => {
    const openProjectDagPanel = (): void => {
      setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
      setRightPanelMode('project-dag')
    }
    window.addEventListener(PROJECT_DAG_SETUP_EVENT, openProjectDagPanel)
    return () => window.removeEventListener(PROJECT_DAG_SETUP_EVENT, openProjectDagPanel)
  }, [setRightPanelMode, setRightSidebarWidth])

  const activeTodoItemCount = activeThreadTodos?.items.length ?? 0
  const activeTodoAutoOpenKey = activeThreadId && activeTodoItemCount > 0
    ? `${activeThreadId}:${activeThreadTodos?.updatedAt ?? ''}:${activeTodoItemCount}`
    : ''
  const autoOpenedTodoKeyRef = useRef('')

  useEffect(() => {
    if (activeTodoItemCount === 0) {
      autoOpenedTodoKeyRef.current = ''
      if (rightPanelMode === 'todo') setRightPanelMode(null)
      return
    }
    if (route !== 'chat') return
    if (rightPanelMode === 'todo') {
      autoOpenedTodoKeyRef.current = activeTodoAutoOpenKey
      return
    }
    if (rightPanelMode !== null) return
    if (autoOpenedTodoKeyRef.current === activeTodoAutoOpenKey) return
    autoOpenedTodoKeyRef.current = activeTodoAutoOpenKey
    setRightSidebarWidth((width) => Math.max(width, 360))
    setRightPanelMode('todo')
  }, [
    activeTodoAutoOpenKey,
    activeTodoItemCount,
    rightPanelMode,
    route,
    setRightPanelMode,
    setRightSidebarWidth
  ])

  useEffect(() => {
    if (
      !activeGuiPlan ||
      !sddUpgradeInFlightRef.current ||
      !sddPlanMatchesPendingTarget(activeGuiPlan, sddUpgradeTargetRef.current)
    ) {
      return
    }
    sddUpgradeInFlightRef.current = false
    sddUpgradeTargetRef.current = null
    useSddDraftStore.getState().setOperationStatus('idle')
    const completedDraft = useSddDraftStore.getState().activeDraft
    if (completedDraft) forgetRememberedSddDraft(completedDraft)
    useSddDraftStore.getState().clearActiveDraft()
  }, [activeGuiPlan])

  useEffect(() => {
    if (
      busy ||
      !sddUpgradeInFlightRef.current ||
      sddDraftOperationStatus !== 'upgrading' ||
      sddPlanMatchesPendingTarget(activeGuiPlan, sddUpgradeTargetRef.current)
    ) {
      return
    }
    const timeout = window.setTimeout(() => {
      if (!sddUpgradeInFlightRef.current) return
      if (useSddDraftStore.getState().operationStatus !== 'upgrading') return
      sddUpgradeInFlightRef.current = false
      sddUpgradeTargetRef.current = null
      useSddDraftStore.getState().setOperationStatus('error', t('planToolResultMissing'))
    }, 800)
    return () => window.clearTimeout(timeout)
  }, [activeGuiPlan, busy, sddDraftOperationStatus, t])

  useEffect(() => {
    let cancelled = false
    const runtimeReady = runtimeConnection === 'ready'
    if (!runtimeReady) setRuntimeInfo(null)
    const provider = getProvider()
    const localSkillsTask = typeof window !== 'undefined' && typeof window.sciforge?.listSkills === 'function'
      ? window.sciforge.listSkills(activeSkillWorkspace || undefined)
      : Promise.resolve({ ok: true as const, skills: [], validationErrors: [] })
    void Promise.allSettled([
      runtimeReady && provider.getRuntimeInfo ? provider.getRuntimeInfo() : Promise.resolve(null),
      runtimeReady && provider.listSkills ? provider.listSkills() : Promise.resolve([]),
      localSkillsTask
    ])
      .then(([runtimeResult, skillsResult, localSkillsResult]) => {
        if (cancelled) return
        setRuntimeInfo(runtimeResult.status === 'fulfilled' ? runtimeResult.value : null)
        const runtimeSkillList = skillsResult.status === 'fulfilled' ? skillsResult.value : []
        const localSkillList =
          localSkillsResult.status === 'fulfilled' && localSkillsResult.value.ok
            ? localSkillsResult.value.skills
            : []
        setRuntimeSkills(mergeSkillCommands(runtimeSkillList, localSkillList))
      })
      .catch(() => {
        if (!cancelled) {
          if (!runtimeReady) setRuntimeInfo(null)
          setRuntimeSkills([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeSkillWorkspace, runtimeConnection])

  const attachmentUploadEnabled = isChatAttachmentUploadEnabled({
    runtimeConnection,
    route,
    mode,
    attachmentStoreAvailable: runtimeInfo?.capabilities.attachments.available
  })
  const webAccessAvailable =
    runtimeInfo?.capabilities.web.fetch.available === true ||
    runtimeInfo?.capabilities.web.search.available === true
  const runtimeProvider = getProvider()
  const runtimeCapabilities: AgentProviderCapabilities | undefined =
    runtimeConnection === 'ready' ? runtimeProvider.getCapabilities() : undefined
  const sideConversationsSupported =
    runtimeConnection === 'ready' &&
    typeof runtimeProvider.forkThread === 'function' &&
    providerSupportsCapability(runtimeProvider, 'fork') &&
    providerSupportsCapability(runtimeProvider, 'sideConversations')

  const clearComposerAttachments = (): void => {
    setComposerAttachments([])
  }

  const clearComposerFileReferences = (): void => {
    setComposerFileReferences([])
  }

  const addComposerFileReference = (reference: ComposerFileReference): void => {
    const normalizedReference = reference.workspaceRoot
      ? reference
      : {
          ...reference,
          workspaceRoot: activeWorkspaceReferenceRoot || workspaceRoot
        }
    setComposerFileReferences((current) => mergeComposerFileReferences(current, normalizedReference))
  }

  const previewWorkspaceReference = (reference: AgentRuntimeWorkspaceReference): void => {
    if (reference.kind === 'directory') return
    setFilePreviewReturnContext(null)
    setFilePreviewTarget({
      path: reference.relativePath,
      workspaceRoot: reference.workspaceRoot || activeWorkspaceReferenceRoot || workspaceRoot
    })
    setRightPanelMode('file')
  }

  const previewComposerFileReference = (reference: ComposerFileReference): void => {
    if (reference.kind === 'directory') return
    const path = reference.relativePath || reference.path
    if (!path) return
    setFilePreviewReturnContext(null)
    setFilePreviewTarget({
      path,
      workspaceRoot: reference.workspaceRoot || activeWorkspaceReferenceRoot || workspaceRoot
    })
    setRightPanelMode('file')
  }

  const openFileTreeDirectory = useCallback((target: { workspaceRoot: string; path: string }): void => {
    const nextWorkspaceRoot = normalizeWorkspaceRoot(
      target.workspaceRoot || activeWorkspaceReferenceRoot || workspaceRoot
    )
    const nextPath = relativeWorkspacePath(target.path, nextWorkspaceRoot)
    const hasKnownWorkspaceGroup = workspaceReferenceGroups.some(
      (group) => normalizeWorkspaceRoot(group.workspaceRoot) === nextWorkspaceRoot
    )
    setFileTreeWorkspaceOverride(hasKnownWorkspaceGroup ? null : nextWorkspaceRoot)
    setFileTreeInitialDirectory((current) => ({
      workspaceRoot: nextWorkspaceRoot,
      path: nextPath,
      nonce: (current?.nonce ?? 0) + 1
    }))
    setFilePreviewReturnContext(null)
    setFilePreviewTarget(null)
    setRightPanelMode('file')
  }, [
    activeWorkspaceReferenceRoot,
    setFilePreviewReturnContext,
    setFilePreviewTarget,
    setRightPanelMode,
    workspaceReferenceGroups,
    workspaceRoot
  ])

  useEffect(() => {
    const onPreviewWorkspaceDirectory = (event: Event): void => {
      const detail = (event as CustomEvent<WorkspaceFilePreviewDetail>).detail
      if (detail?.kind !== 'directory' || !detail.path) return
      openFileTreeDirectory({
        workspaceRoot: detail.workspaceRoot || activeWorkspaceReferenceRoot || workspaceRoot,
        path: detail.path
      })
    }

    window.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreviewWorkspaceDirectory)
    return () => window.removeEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreviewWorkspaceDirectory)
  }, [activeWorkspaceReferenceRoot, openFileTreeDirectory, workspaceRoot])

  const toggleTopBarRightPanelMode = (mode: Exclude<RightPanelMode, null>): void => {
    if (mode === 'file') setFileTreeWorkspaceOverride(null)
    if (mode === 'evidence' || mode === 'project-dag') setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
    toggleRightPanelMode(mode)
  }

  const removeComposerFileReference = (relativePath: string, referenceWorkspaceRoot?: string): void => {
    const key = composerFileReferenceKey({
      relativePath,
      workspaceRoot: referenceWorkspaceRoot
    })
    setComposerFileReferences((current) =>
      current.filter((reference) => composerFileReferenceKey(reference) !== key)
    )
  }

  useEffect(() => {
    if (route !== 'chat') setComposerFileReferences([])
  }, [route])

  useEffect(() => {
    setComposerFileReferences([])
  }, [activeSddDraft?.id, activeThreadId, activeWorkspaceReferenceRoot])

  const handlePickAttachments = async (inputs: ComposerImageAttachmentInput[]): Promise<void> => {
    if (!inputs.length) return
    const workspace = normalizeWorkspaceRoot(
      threads.find((thread) => thread.id === activeThreadId)?.workspace ||
      workspaceRoot
    )
    const pdfInputs = inputs.filter(isPickedPdfAttachment)
    const scientificInputs = inputs.filter((input) => !isPickedPdfAttachment(input) && isPickedScientificAttachment(input))
    const imageInputs = inputs.filter((input) =>
      !isPickedPdfAttachment(input) &&
      !isPickedScientificAttachment(input) &&
      isPickedImageAttachment(input)
    )
    const unsupportedInputs = inputs.filter((input) =>
      !isPickedPdfAttachment(input) &&
      !isPickedScientificAttachment(input) &&
      !isPickedImageAttachment(input)
    )
    const pdfReferences: ComposerFileReference[] = []
    const failedPdfNames: string[] = []
    for (const input of pdfInputs) {
      const reference = workspace ? pickedWorkspaceFileReference(input, workspace) : null
      if (reference) {
        pdfReferences.push(reference)
      } else if (workspace) {
        try {
          pdfReferences.push(await copyPdfAttachmentToWorkspace(input, workspace, activeThreadId))
        } catch {
          failedPdfNames.push(input.file.name || fileNameFromPath(pathForPickedAttachment(input)))
        }
      } else {
        failedPdfNames.push(input.file.name || fileNameFromPath(pathForPickedAttachment(input)))
      }
    }
    if (pdfReferences.length > 0) {
      setComposerFileReferences((current) => {
        let next = current
        for (const reference of pdfReferences) {
          next = mergeComposerFileReferences(next, reference)
        }
        return next
      })
      previewComposerFileReference(pdfReferences[0])
    }
    if (failedPdfNames.length > 0) {
      setAttachmentUploadError(t('composerPdfImportFailed', {
        name: failedPdfNames[0],
        count: failedPdfNames.length
      }))
    } else if (pdfReferences.length > 0) {
      setAttachmentUploadError(null)
    }
    if (unsupportedInputs.length > 0) {
      setAttachmentUploadError(t('composerAttachmentUnavailable'))
    }
    if (scientificInputs.length > 0) {
      if (route !== 'chat') {
        setAttachmentUploadError(t('composerAttachmentUnavailable'))
        return
      }
      if (!workspace) {
        setAttachmentUploadError(t('workspaceRequiredToCreateThread'))
        return
      }
      try {
        const scientificReferences: ComposerFileReference[] = []
        for (const input of scientificInputs) {
          scientificReferences.push(await copyScientificAttachmentToWorkspace(input, workspace, activeThreadId))
        }
        setComposerFileReferences((current) => {
          let next = current
          for (const reference of scientificReferences) {
            next = mergeComposerFileReferences(next, reference)
          }
          return next
        })
        if (failedPdfNames.length === 0 && unsupportedInputs.length === 0) setAttachmentUploadError(null)
      } catch (error) {
        setAttachmentUploadError(error instanceof Error ? error.message : String(error))
        return
      }
    }
    if (imageInputs.length === 0) return
    if (!attachmentUploadEnabled) {
      setAttachmentUploadError(t('composerAttachmentUnavailable'))
      return
    }
    const provider = getProvider()
    if (typeof provider.uploadAttachment !== 'function') {
      setAttachmentUploadError(t('composerAttachmentUnavailable'))
      return
    }
    setAttachmentUploadBusy(true)
    if (failedPdfNames.length === 0) setAttachmentUploadError(null)
    try {
      const attachmentCapabilities = runtimeInfo?.capabilities.attachments
      if (!attachmentCapabilities) {
        setAttachmentUploadError(t('composerAttachmentUnavailable'))
        return
      }
      const uploaded: AttachmentReference[] = []
      for (const input of imageInputs) {
        const file = input.file
        if (file.type.startsWith('image/')) {
          // Image: translated to text by the configured vision translator in Model Router.
          const prepared = await prepareImageAttachmentUpload(file, attachmentCapabilities)
          const attachment = await provider.uploadAttachment({
            name: file.name || 'image',
            mimeType: prepared.mimeType,
            dataBase64: prepared.dataBase64,
            textFallback: prepared.textFallback,
            ...(input.path ? { localFilePath: input.path } : {}),
            ...(activeThreadId ? { threadId: activeThreadId } : {}),
            ...(workspace ? { workspace } : {})
          })
          uploaded.push({
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            width: attachment.width,
            height: attachment.height,
            byteSize: attachment.byteSize,
            previewUrl: `data:${prepared.mimeType};base64,${prepared.dataBase64}`,
            ...(input.path ? { path: input.path } : {}),
            ...(attachment.localFilePath ? { absolutePath: attachment.localFilePath } : {})
          })
          continue
        }
      }
      if (uploaded.length > 0) {
        setComposerAttachments((current) => {
          const byId = new Map(current.map((attachment) => [attachment.id, attachment]))
          for (const attachment of uploaded) {
            byId.set(attachment.id, attachment)
          }
          return [...byId.values()]
        })
      }
    } catch (error) {
      setAttachmentUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setAttachmentUploadBusy(false)
    }
  }

  const removeComposerAttachment = (id: string): void => {
    setComposerAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  const handlePasteClipboardImage = async (options: { silentNoImage?: boolean } = {}): Promise<void> => {
    if (!attachmentUploadEnabled) return
    if (typeof window.sciforge?.readClipboardImage !== 'function') {
      setAttachmentUploadError(t('composerAttachmentUnavailable'))
      return
    }
    const image = await window.sciforge.readClipboardImage()
    if (!image.ok) {
      if (options.silentNoImage) return
      setAttachmentUploadError(image.message)
      return
    }
    await handlePickAttachments([{ file: clipboardImageToFile(image) }])
  }

  const createSddAssistantThreadForDraft = async (draft: SddDraft): Promise<string | null> => {
    const normalizedWorkspace = normalizeWorkspaceRoot(draft.workspaceRoot)
    if (!normalizedWorkspace) {
      setError(t('workspaceRequiredToCreateThread'))
      return null
    }
    if (runtimeConnection !== 'ready') {
      setError(t('runtimeActionNeedsConnection'))
      return null
    }
    try {
      const provider = getProvider()
      const thread = await provider.createThread({
        workspace: normalizedWorkspace,
        title: t('sddAssistant'),
        mode: 'agent'
      })
      const normalizedThread = {
        ...thread,
        workspace: normalizeWorkspaceRoot(thread.workspace) || normalizedWorkspace
      }
      markSddAssistantThread(draft, normalizedThread.id)
      useChatStore.setState((state) => ({
        activeThreadId: normalizedThread.id,
        threads: state.threads.some((item) => item.id === normalizedThread.id)
          ? state.threads
          : [normalizedThread, ...state.threads]
      }))
      setRoute('chat')
      await selectThread(normalizedThread.id)
      void useChatStore.getState().refreshThreads()
      return normalizedThread.id
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return null
    }
  }

  const ensureSddAssistantThreadForDraft = async (draft: SddDraft): Promise<string | null> => {
    const registeredThreadId = sddAssistantThreadIdForDraft(draft)
    if (registeredThreadId) {
      setRoute('chat')
      if (useChatStore.getState().activeThreadId !== registeredThreadId) {
        await selectThread(registeredThreadId)
      }
      if (useChatStore.getState().activeThreadId === registeredThreadId) {
        return registeredThreadId
      }
    }
    return createSddAssistantThreadForDraft(draft)
  }

  const openSddRequirementDraft = async (
    draft: SddDraft,
    content: string,
    options: {
      lastSavedContent?: string
      saveStatus?: SddDraftSaveStatus
      openAssistant?: boolean
    } = {}
  ): Promise<boolean> => {
    useSddDraftStore.getState().setActiveDraft(draft, content, {
      lastSavedContent: options.lastSavedContent,
      saveStatus: options.saveStatus
    })
    setInput('')
    setMode('agent')
    setRoute('chat')
    if (options.openAssistant ?? runtimeConnection === 'ready') {
      setRightSidebarWidth((width) => Math.max(width, 420))
      const sddThreadId = await ensureSddAssistantThreadForDraft(draft)
      if (sddThreadId) {
        setRightPanelMode('sdd-ai')
      } else {
        setRightPanelMode(null)
      }
    } else {
      setRightPanelMode(null)
    }
    return true
  }

  const dismissActiveSddDraft = (options: { closeAssistant?: boolean } = {}): void => {
    const draft = useSddDraftStore.getState().activeDraft
    if (draft) {
      void saveActiveSddDraftToDisk()
      useSddDraftStore.getState().clearActiveDraft()
    }
    if (options.closeAssistant && rightPanelMode === 'sdd-ai') setRightPanelMode(null)
  }

  const toggleSddAssistantPanel = async (): Promise<void> => {
    if (rightPanelMode === 'sdd-ai') {
      setRightPanelMode(null)
      return
    }
    const draft = useSddDraftStore.getState().activeDraft
    if (!draft) return
    setRightSidebarWidth((width) => Math.max(width, 420))
    const threadId = await ensureSddAssistantThreadForDraft(draft)
    if (!threadId) return
    setRightPanelMode('sdd-ai')
  }

  const sddDraftFromRegisteredThread = (threadId: string): SddDraft | null => {
    const ref = sddDraftRefForThreadId(threadId)
    if (!ref) return null
    const timestamp = new Date(0).toISOString()
    return {
      id: buildSddDraftId(ref.workspaceRoot, ref.relativePath),
      workspaceRoot: ref.workspaceRoot,
      relativePath: ref.relativePath,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  }

  const openSddRequirementDraftFromSidebarThread = async (
    threadId: string,
    thread: typeof activeThread | null
  ): Promise<boolean> => {
    const shouldTryRestore =
      isSddAssistantThread(thread ?? { id: threadId }) ||
      isEmptySddAssistantThreadCandidate(thread ?? { id: threadId })
    if (!shouldTryRestore) return false
    const draft = sddDraftFromRegisteredThread(threadId)
    if (!draft) return false
    const current = useSddDraftStore.getState().activeDraft
    if (current && current.id !== draft.id) {
      await saveActiveSddDraftToDisk()
    }
    const restored = await restoreSddDraft({
      draft,
      readWorkspaceFile: window.sciforge.readWorkspaceFile
    })
    if (restored.kind !== 'restored') {
      if (restored.kind === 'unreadable') setError(restored.message)
      return false
    }
    await openSddRequirementDraft(restored.draft, restored.content, {
      lastSavedContent: restored.lastSavedContent,
      saveStatus: restored.saveStatus,
      openAssistant: true
    })
    return true
  }

  const sendSddAssistantPrompt = async (
    value: string,
    references: readonly ComposerFileReference[] = []
  ): Promise<void> => {
    const v = value.trim()
    const draft = useSddDraftStore.getState().activeDraft
    const fileReferences = [...references]
    if ((!v && fileReferences.length === 0) || !draft) return
    const threadId = await ensureSddAssistantThreadForDraft(draft)
    if (!threadId) return
    const snapshot = useSddDraftStore.getState()
    void saveActiveSddDraftToDisk()
    const messageText = v || t('composerFileOnlyPrompt')
    let prompt = composeSddAssistantPrompt({
      userPrompt: messageText,
      draftMarkdown: snapshot.content,
      draftRelativePath: draft.relativePath,
      workspaceRoot: draft.workspaceRoot
    })
    if (fileReferences.length > 0) {
      try {
        const fileContext = await readComposerFileContextEntries(fileReferences, draft.workspaceRoot)
        prompt = buildComposerFileContextPrompt(prompt, fileContext)
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
        return
      }
    }
    setInput('')
    const model = assistantModel.trim()
    const reasoningEffort = composerReasoningEffortRequestValue(assistantReasoningEffort)
    const sent = await sendMessage(prompt, mode === 'plan' ? 'plan' : 'agent', {
      displayText: v || t('composerFileOnlyDisplay', { count: fileReferences.length }),
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(fileReferences.length ? { fileReferences } : {})
    })
    if (sent) {
      if (fileReferences.length > 0) clearComposerFileReferences()
    } else {
      setInput(v)
    }
  }

  const uploadSddImagesAsAttachments = async (
    images: SddDraftImageReference[],
    threadId: string,
    workspace: string
  ): Promise<{ images: SddDraftImageReference[]; attachmentIds: string[] }> => {
    const provider = getProvider()
    const attachmentCapabilities = runtimeInfo?.capabilities.attachments
    if (!attachmentCapabilities || typeof provider.uploadAttachment !== 'function') {
      throw new Error(t('composerAttachmentUnavailable'))
    }
    const attachmentIds: string[] = []
    for (const image of images) {
      const file = base64ImageToFile(image)
      const prepared = await prepareImageAttachmentUpload(file, attachmentCapabilities)
      const attachment = await provider.uploadAttachment({
        name: fileNameFromPath(image.relativePath),
        mimeType: prepared.mimeType,
        dataBase64: prepared.dataBase64,
        textFallback: prepared.textFallback,
        threadId,
        workspace
      })
      attachmentIds.push(attachment.id)
    }
    return { images: withAttachmentIds(images, attachmentIds), attachmentIds }
  }

  const handleSddNextStep = async (): Promise<void> => {
    const snapshot = useSddDraftStore.getState()
    const draft = snapshot.activeDraft
    if (!draft) return
    if (sddUpgradeInFlightRef.current || snapshot.operationStatus === 'upgrading') return
    if (!snapshot.content.trim()) {
      useSddDraftStore.getState().setOperationStatus('error', t('sddEmptyDraftError'))
      return
    }
    const chatSnapshot = useChatStore.getState()
    if (chatSnapshot.busy || chatSnapshot.blocks.some(hasPendingRuntimeWork)) {
      setError(t('composerQueuePlaceholder'))
      return
    }
    if (chatSnapshot.runtimeConnection !== 'ready') {
      setError(t('runtimeActionNeedsConnection'))
      return
    }
    sddUpgradeInFlightRef.current = true
    useSddDraftStore.getState().setOperationStatus('upgrading')
    const saved = await saveActiveSddDraftToDisk()
    if (!saved) {
      sddUpgradeInFlightRef.current = false
      useSddDraftStore.getState().setOperationStatus('error', useSddDraftStore.getState().error)
      return
    }

    const threadId = await ensureSddAssistantThreadForDraft(draft)
    if (!threadId) {
      sddUpgradeInFlightRef.current = false
      useSddDraftStore.getState().setOperationStatus('idle')
      return
    }

    const collected = await collectSddDraftImages({
      markdown: useSddDraftStore.getState().content,
      draftRelativePath: draft.relativePath,
      workspaceRoot: draft.workspaceRoot
    })
    if (collected.errors.length > 0) {
      sddUpgradeInFlightRef.current = false
      useSddDraftStore.getState().setOperationStatus('error', collected.errors.join('\n'))
      return
    }

    const supportsImageAttachments =
      collected.images.length > 0 &&
      runtimeInfo?.capabilities.model.inputModalities.includes('image') === true &&
      runtimeInfo.capabilities.attachments.available === true &&
      typeof getProvider().uploadAttachment === 'function'

    let imagesForPrompt = collected.images
    let attachmentIds: string[] = []
    let imageMode: 'attachments' | 'base64' | 'none' =
      collected.images.length === 0 ? 'none' : 'base64'

    if (supportsImageAttachments) {
      try {
        const uploaded = await uploadSddImagesAsAttachments(collected.images, threadId, draft.workspaceRoot)
        imagesForPrompt = uploaded.images
        attachmentIds = uploaded.attachmentIds
        imageMode = 'attachments'
      } catch (error) {
        sddUpgradeInFlightRef.current = false
        useSddDraftStore.getState().setOperationStatus(
          'error',
          error instanceof Error ? error.message : String(error)
        )
        return
      }
    }

    const latestDraftContent = useSddDraftStore.getState().content
    const planRelativePath = sddDraftPlanRelativePath(draft)
    const planId = buildGuiPlanId(draft.workspaceRoot, planRelativePath)
    const sourceRequest = sddDraftSourceRequest(latestDraftContent, draft.relativePath)
    const assistantContext = sddAssistantContextFromBlocks(blocks)
    const prompt = buildSddDraftToPlanPrompt({
      draftMarkdown: latestDraftContent,
      draftRelativePath: draft.relativePath,
      planRelativePath,
      assistantContext,
      workspaceRoot: draft.workspaceRoot,
      images: imagesForPrompt,
      imageMode
    })
    sddUpgradeTargetRef.current = {
      planId,
      relativePath: planRelativePath,
      workspaceRoot: draft.workspaceRoot
    }
    setMode('plan')
    const sent = await sendPlanTurn(prompt, {
      displayText: t('sddGeneratePlanAction'),
      workspaceRoot: draft.workspaceRoot,
      guiPlan: {
        operation: 'draft',
        workspaceRoot: draft.workspaceRoot,
        relativePath: planRelativePath,
        planId,
        sourceRequest
      },
      ...(attachmentIds.length ? { attachmentIds } : {})
    })
    if (!sent) {
      sddUpgradeInFlightRef.current = false
      sddUpgradeTargetRef.current = null
      useSddDraftStore.getState().setOperationStatus('idle')
      return
    }
    const tracePath = sddDraftTraceRelativePath(draft.relativePath)
    if (tracePath) {
      await window.sciforge
        .writeWorkspaceFile({
          workspaceRoot: draft.workspaceRoot,
          path: tracePath,
          content: JSON.stringify(
            buildSddTraceSnapshot(latestDraftContent, planRelativePath),
            null,
            2
          )
        })
        .catch(() => undefined)
    }
  }

  const readComposerFileContextEntries = async (
    references: readonly ComposerFileReference[],
    workspace: string
  ) => readComposerFileContextEntriesFromReferences(references, workspace, {
    listWorkspaceReferences: async (input) => {
      const provider = getProvider()
      if (!provider.listWorkspaceReferences) return { ok: false, message: t('workspaceReferenceUnavailable') }
      return provider.listWorkspaceReferences(input)
    },
    readWorkspaceFile: (input) => window.sciforge.readWorkspaceFile(input)
  }, {
    maxCharsPerFile: COMPOSER_FILE_CONTEXT_MAX_CHARS_PER_FILE,
    maxTotalChars: COMPOSER_FILE_CONTEXT_MAX_TOTAL_CHARS,
    maxDirectoryFiles: COMPOSER_DIRECTORY_CONTEXT_MAX_FILES
  })

  const handleSend = (intent?: ComposerSendIntent): void => {
    void handleSendAsync(intent)
  }

  const handleSendAsync = async (intent?: ComposerSendIntent): Promise<void> => {
    const v = input.trim()
    const attachments = route === 'chat' ? composerAttachments : []
    const attachmentIds = attachments.map((attachment) => attachment.id)
    const fileReferences = route === 'chat' ? composerFileReferences : []
    const commentReferences = route === 'chat' && !activeThreadIsRemoteChannel
      ? composerCommentReferences
      : []
    const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
    const isImageGenerationIntent = intent?.kind === 'image-generation'
    if (!v && attachmentIds.length === 0 && fileReferences.length === 0 && commentReferences.length === 0) return
    const emptyPrompt =
      fileReferences.length > 0 && attachmentIds.length > 0
        ? t('composerFileAndImageOnlyPrompt')
        : fileReferences.length > 0
          ? t('composerFileOnlyPrompt')
          : t('composerImageOnlyPrompt')
    const emptyDisplayText = v
      ? undefined
      : commentReferences.length > 0
        ? t('composerCommentOnlyDisplay', { count: commentReferences.length })
      : fileReferences.length > 0 && attachmentIds.length > 0
        ? t('composerFileAndImageOnlyDisplay', { count: fileReferences.length })
        : fileReferences.length > 0
          ? t('composerFileOnlyDisplay', { count: fileReferences.length })
          : t('composerImageOnlyDisplay')
    const messageText = v || (commentReferences.length > 0 ? t('composerCommentOnlyPrompt') : emptyPrompt)
    const shouldUsePlanPrompt =
      mode === 'plan' &&
      route === 'chat' &&
      !isImageGenerationIntent &&
      !activeSddDraft &&
      !activeThreadIsRemoteChannel
    const prepareChatMessage = async (): Promise<{ text: string; displayText?: string } | null> => {
      const userVisibleText = v || emptyDisplayText
      const runtimeMessageText = isImageGenerationIntent
        ? buildImageGenerationWorkflowPrompt(messageText, {
            workspaceRoot: normalizeWorkspaceRoot(activeThread?.workspace || workspaceRoot) || undefined,
            ...(activeThreadId ? { threadId: activeThreadId } : {})
          })
        : messageText
      const preparedRuntimeMessageText = maybeBuildLongHorizonPrompt({
        enabled: shouldUsePlanPrompt,
        userPrompt: runtimeMessageText,
        mode,
        workspaceRoot: normalizeWorkspaceRoot(activeThread?.workspace || workspaceRoot) || undefined,
        attachments: attachments.map((attachment) => ({
          name: attachment.name || attachment.id,
          kind: attachment.mimeType
        })),
        fileReferences: fileReferences.map((reference) => ({
          relativePath: reference.relativePath,
          path: reference.path,
          kind: reference.kind
        }))
      }).text
      if (fileReferences.length === 0) {
        return {
          text: buildAnchoredCommentContextPrompt(preparedRuntimeMessageText, commentReferences),
          ...(userVisibleText ? { displayText: userVisibleText } : {})
        }
      }
      const workspace = normalizeWorkspaceRoot(
        threads.find((thread) => thread.id === activeThreadId)?.workspace || workspaceRoot
      )
      if (!workspace) {
        setError(t('workspaceRequiredToCreateThread'))
        return null
      }
      try {
        const fileContext = await readComposerFileContextEntries(fileReferences, workspace)
        return {
          text: buildAnchoredCommentContextPrompt(
            buildComposerFileContextPrompt(preparedRuntimeMessageText, fileContext),
            commentReferences
          ),
          ...(userVisibleText ? { displayText: userVisibleText } : {})
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
        return null
      }
    }

    if (activeSddDraft && rightPanelMode === 'sdd-ai') {
      void sendSddAssistantPrompt(v, fileReferences)
      return
    }
    const planCommand = parseGuiPlanCommand(v)
    if (planCommand) {
      setInput('')
      void handleGuiPlanCommand(planCommand.kind === 'create' ? planCommand.request : undefined)
      return
    }
    if (activeThreadIsRemoteChannel) {
      const command = parseRemoteChannelCommand(v)
      if (command?.kind === 'clear') {
        if (!activeRemoteComposerChannelId) {
          setError(t('remoteChannelNoActiveIm'))
          return
        }
        setInput('')
        void (async () => {
          await resetRemoteChannelSession(activeRemoteComposerChannelId)
          const replyText = t('remoteChannelNewSessionStarted')
          appendLocalRemoteChannelTurn(v, replyText)
          await mirrorRemoteChannelCommand(v, replyText)
        })()
        return
      }
      if (command?.kind === 'help') {
        setInput('')
        const replyText = remoteChannelHelpText()
        appendLocalRemoteChannelTurn(v, replyText)
        void mirrorRemoteChannelCommand(v, replyText)
        return
      }
      if (command?.kind === 'model') {
        setInput('')
        const replyText = t('remoteChannelModelChangeUnsupported')
        appendLocalRemoteChannelTurn(v, replyText)
        void mirrorRemoteChannelCommand(v, replyText)
        return
      }
      if (command?.kind === 'showModel') {
        if (!activeRemoteComposerChannelId) {
          setError(t('remoteChannelNoActiveIm'))
          return
        }
        setInput('')
        const replyText = t('remoteChannelModelCurrent', {
          model: activeRemoteComposerChannel?.model ?? 'auto'
        })
        appendLocalRemoteChannelTurn(v, replyText)
        void mirrorRemoteChannelCommand(v, replyText)
        return
      }
      if (command?.kind === 'invalidModel') {
        setInput('')
        const replyText = t('remoteChannelModelChangeUnsupported')
        appendLocalRemoteChannelTurn(v, replyText)
        void mirrorRemoteChannelCommand(v, replyText)
        return
      }
      if (command?.kind === 'showMode') {
        setInput('')
        const replyText = t('remoteChannelModeCurrent', { mode })
        appendLocalRemoteChannelTurn(v, replyText)
        void mirrorRemoteChannelCommand(v, replyText)
        return
      }
      if (command?.kind === 'mode' || command?.kind === 'invalidMode') {
        setInput('')
        const replyText = t('remoteChannelModeChangeUnsupported')
        appendLocalRemoteChannelTurn(v, replyText)
        void mirrorRemoteChannelCommand(v, replyText)
        return
      }
      if (isUnsupportedLocalRemoteChannelCommand(command)) {
        setInput('')
        const replyText = t('remoteChannelCommandUnsupported')
        appendLocalRemoteChannelTurn(v, replyText)
        void mirrorRemoteChannelCommand(v, replyText)
        return
      }
      if (!activeRemoteComposerChannelId) {
        setError(t('remoteChannelNoActiveIm'))
        return
      }
      setInput('')
      void (async () => {
        const createRemoteChannelTaskFromText = createRemoteChannelTaskFromTextApi(window.sciforge)
        const taskResult = typeof createRemoteChannelTaskFromText === 'function'
          ? await createRemoteChannelTaskFromText(v, {
              channelId: activeRemoteComposerChannelId,
              modelHint: activeRemoteComposerChannel?.model,
              mode
            })
          : { kind: 'noop' as const }
        if (taskResult.kind === 'created') {
          appendLocalRemoteChannelTurn(v, taskResult.confirmationText)
          await mirrorRemoteChannelCommand(v, taskResult.confirmationText)
          return
        }
        if (taskResult.kind === 'error') {
          appendLocalRemoteChannelTurn(v, `Failed to create scheduled task: ${taskResult.message}`)
          return
        }
        if (!activeThreadId) {
          await selectRemoteChannel(activeRemoteComposerChannelId)
          await useChatStore.getState().sendMessage(v, mode === 'plan' ? 'plan' : 'agent', {
            ...(reasoningEffort ? { reasoningEffort } : {})
          })
          return
        }
        await sendMessage(v, mode === 'plan' ? 'plan' : 'agent', {
          ...(reasoningEffort ? { reasoningEffort } : {})
        })
      })()
      return
    }
    if (!isImageGenerationIntent && route === 'chat' && mode === 'plan') {
      const prepared = await prepareChatMessage()
      if (!prepared) return
      setInput('')
      clearComposerAttachments()
      clearComposerFileReferences()
      setComposerCommentReferences([])
      void sendPlanTurn(prepared.text, {
        ...(prepared.displayText ? { displayText: prepared.displayText } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(selectedRemoteTargetId ? { remoteTargetId: selectedRemoteTargetId } : {}),
        ...(attachmentIds.length ? { attachmentIds, attachments } : {}),
        ...(fileReferences.length ? { fileReferences } : {})
      })
      return
    }
    const prepared = await prepareChatMessage()
    if (!prepared) return
    setInput('')
    clearComposerAttachments()
    clearComposerFileReferences()
    setComposerCommentReferences([])
    void sendMessage(prepared.text, isImageGenerationIntent ? 'agent' : mode === 'plan' ? 'plan' : 'agent', {
      ...(prepared.displayText ? { displayText: prepared.displayText } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(selectedRemoteTargetId ? { remoteTargetId: selectedRemoteTargetId } : {}),
      ...(attachmentIds.length ? { attachmentIds, attachments } : {}),
      ...(fileReferences.length ? { fileReferences } : {})
    })
  }

  const sendVisualReviewRequest = async (text: string): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed) return
    const displayText = '请根据图片批注生成候选修改版，完成后让我对比确认。'
    setRoute('chat')
    setMode('agent')
    const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
    const sent = await sendMessage(trimmed, 'agent', {
      displayText,
      ...(reasoningEffort ? { reasoningEffort } : {})
    })
    if (!sent) setInput(displayText)
  }

  const openImageArtifactInVisualReview = async (artifact: TimelineVisualReviewArtifact): Promise<void> => {
    const root = artifact.workspaceRoot || activeThread?.workspace || workspaceRoot
    const sourcePath = [
      artifact.outputPath,
      artifact.sourcePath,
      artifact.previewPath,
      artifact.renderedPagePath,
      artifact.svgPath
    ].find((path) => path?.trim() && /\.(?:png|jpe?g|webp|svg)(?:[?#].*)?$/i.test(path))
    if (!root?.trim() || !sourcePath?.trim()) {
      setError(t('visualReviewArtifactUnavailable'))
      return
    }

    const contextId = artifact.threadId || activeThreadId || 'default'
    const documentId = artifact.visualDocumentId || visualDocumentIdForArtifact(contextId, sourcePath)
    try {
      const opened = await window.sciforge.openVisualDocument({ workspaceRoot: root, documentId })
      if (!opened.document.artifact) {
        const kind = artifact.artifactKind === 'scientific_plot'
          ? 'scientific_plot'
          : artifact.artifactKind === 'generated_image'
            ? 'generated_image'
            : artifact.artifactKind === 'edited_image'
              ? 'edited_image'
              : artifact.artifactKind === 'ppt_slide' || artifact.artifactKind === 'ppt_export'
                ? 'presentation_slide'
                : 'image'
        await window.sciforge.insertVisualDocumentArtifact({
          workspaceRoot: root,
          documentId,
          kind,
          sourcePath,
          ...(artifact.artifactManifestPath || artifact.manifestPath
            ? { manifestPath: artifact.artifactManifestPath || artifact.manifestPath }
            : {}),
          ...(artifact.title ? { title: artifact.title } : {}),
          ...(artifact.caption ? { caption: artifact.caption } : {})
        })
      }
      setVisualReviewRequest({ documentId, refreshKey: Date.now(), workspaceRoot: root })
      setRightSidebarWidth((width) => Math.max(width, 760))
      setRightPanelMode('visual-review')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  const openThread = (id: string, runtimeId?: AgentRuntimeId): void => {
    void (async () => {
      const thread = threads.find((item) => item.id === id) ?? null
      if (await openSddRequirementDraftFromSidebarThread(id, thread)) {
        setConnectPhonePanelOpen(false)
        return
      }
      if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
      setConnectPhonePanelOpen(false)
      setRoute('chat')
      getProvider().rememberThreadRuntime?.(id, runtimeId)
      await selectThread(id)
    })()
  }

  const startNewChat = (): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhonePanelOpen(false)
    setRoute('chat')
    void createThread({ forceNew: true })
  }

  const startNewChatInWorkspace = (workspaceRoot: string): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhonePanelOpen(false)
    setRoute('chat')
    void createThread({ workspaceRoot, forceNew: true })
  }

  const openPluginsView = (): void => {
    setConnectPhonePanelOpen(false)
    openPlugins('chat')
  }

  const openScheduleView = (): void => {
    setConnectPhonePanelOpen(false)
    openSchedule()
  }

  const openWorkflowView = (): void => {
    setConnectPhonePanelOpen(false)
    openWorkflow()
  }

  const toggleConnectPhone = (): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    if (connectPhonePanelOpen) {
      setConnectPhonePanelOpen(false)
    } else {
      openConnectPhone()
    }
  }

  const sidebarView: 'chat' | 'schedule' | 'workflow' =
    route === 'schedule'
        ? 'schedule'
      : route === 'workflow'
        ? 'workflow'
        : 'chat'

  const closeRightPanel = (): void => {
    if (rightPanelMode === 'file') {
      setRightPanelMode(null)
      setFilePreviewTarget(null)
      setFilePreviewReturnContext(null)
      return
    }
    setRightPanelMode(null)
    setFilePreviewTarget(null)
    setFilePreviewReturnContext(null)
  }

  const closeFilePreview = (): void => {
    if (filePreviewReturnContext?.kind === 'project-dag') {
      setProjectDagReturnTarget(projectDagReturnSelection(filePreviewReturnContext))
      setFilePreviewTarget(null)
      setFilePreviewReturnContext(null)
      setRightPanelMode('project-dag')
      return
    }
    if (filePreviewReturnContext?.kind === 'evidence-dag') {
      const returnThreadId = filePreviewReturnContext.threadId.trim()
      const returnNodeId = filePreviewReturnContext.nodeId.trim()
      setEvidenceDagReturnNode(
        returnThreadId && returnNodeId && returnThreadId === activeThreadId
          ? { threadId: returnThreadId, nodeId: returnNodeId }
          : null
      )
      setFilePreviewTarget(null)
      setFilePreviewReturnContext(null)
      setRightPanelMode(returnThreadId === activeThreadId ? 'evidence' : null)
      return
    }
    setFilePreviewTarget(null)
  }

  const renderRuntimeBanner = (message: string, detail?: string | null): ReactElement => (
    <RuntimeBanner
      message={message}
      detail={detail}
      logPath={runtimeLogPath || null}
      runtimeReady={runtimeConnection === 'ready'}
      stageInsetClass={stageInsetClass}
      t={t}
      onOpenLogDir={
        typeof window !== 'undefined' && typeof window.sciforge?.openLogDir === 'function'
          ? () => window.sciforge.openLogDir()
          : undefined
      }
      onOpenSettings={() => openSettings('agents')}
      onRetryConnection={() => void probeRuntime('user')}
    />
  )

  const renderRightPanel = (): ReactElement | null => {
    if (!rightPanelVisible) return null
    return (
      <>
        <div
          role="separator"
          aria-orientation="vertical"
          className="ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize"
          onPointerDown={beginRightResize}
        />
        <div className="flex h-full min-h-0 shrink-0 flex-col bg-ds-sidebar" style={{ width: rightSidebarWidth }}>
          <div
            className="ds-no-drag flex h-9 shrink-0 items-center gap-1 border-b border-ds-border bg-ds-sidebar px-2"
            data-right-panel-history-navigation
          >
            <button
              type="button"
              onClick={navigateRightPanelBack}
              disabled={!canNavigateRightPanelBack}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-default disabled:opacity-30"
              aria-label={t('rightPanelBack')}
              title={t('rightPanelBack')}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={navigateRightPanelForward}
              disabled={!canNavigateRightPanelForward}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-default disabled:opacity-30"
              aria-label={t('rightPanelForward')}
              title={t('rightPanelForward')}
            >
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="ml-1 min-w-0 truncate text-[11.5px] font-medium text-ds-faint">
              {rightPanelMode ? rightPanelVisibleContextTitle(rightPanelMode) : ''}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
            {rightPanelMode === 'file' ? (
              <div className="relative h-full max-h-full w-full overflow-hidden">
                <ChatFileTreePanel
                  workspaceRoot={fileTreeWorkspaceRoot}
                  workspaceGroups={fileTreeWorkspaceGroups}
                  selectedPath={filePreviewTarget?.path}
                  initialDirectory={fileTreeInitialDirectory}
                  selectedReferences={composerFileReferences}
                  className={`h-full max-h-full w-full ${filePreviewTarget ? 'hidden' : ''}`}
                  onPreviewFile={previewWorkspaceReference}
                  onAddReference={addComposerFileReference}
                  onCollapse={closeRightPanel}
                />
                {filePreviewTarget ? (
                  <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
                    <div className="flex h-full min-h-0 flex-col">
                      {filePreviewReturnContext?.kind === 'project-dag' ||
                      filePreviewReturnContext?.kind === 'evidence-dag' ? (
                        <div className="shrink-0 border-b border-ds-border bg-ds-sidebar px-2 py-1.5">
                          <button
                            type="button"
                            className="inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                            onClick={closeFilePreview}
                          >
                            <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{t('workspacePreviewReturnToReview', {
                              label: filePreviewReturnContext.label || (
                                filePreviewReturnContext.kind === 'evidence-dag'
                                  ? t('rightPanelEvidenceDag')
                                  : t('projectDagPanelTitle')
                              )
                            })}</span>
                          </button>
                        </div>
                      ) : null}
                      <div className="min-h-0 flex-1">
                        <WorkspaceFilePreviewPanelBridge
                          target={filePreviewTarget}
                          workspaceRoot={filePreviewTarget.workspaceRoot || fileTreeWorkspaceRoot}
                          className="h-full max-h-full w-full"
                          annotationQuestionBridge={annotationQuestionBridge}
                          onClose={closeFilePreview}
                          onOpenDirectory={openFileTreeDirectory}
                        />
                      </div>
                    </div>
                  </Suspense>
                ) : null}
              </div>
            ) : rightPanelMode === 'sdd-ai' && activeSddDraft ? (
              <SddAssistantPanel
                draft={activeSddDraft}
                input={input}
                setInput={setInput}
                mode={mode}
                setMode={setMode}
                busy={busy}
                runtimeConnection={runtimeConnection}
                activeThreadId={activeThreadId}
                blocks={blocks}
                liveReasoning={liveReasoning}
                liveAssistant={liveAssistant}
                composerModel={assistantModel}
                composerPickList={assistantPickList}
                composerModelGroups={composerModelGroups}
                composerReasoningEffort={assistantReasoningEffort}
                setComposerModel={setAssistantModel}
                setComposerReasoningEffort={setAssistantReasoningEffort}
                queuedMessages={activeQueuedMessages}
                removeQueuedMessage={removeQueuedMessage}
                updateQueuedMessage={updateQueuedMessage}
                steerQueuedMessage={steerQueuedMessage}
                retryQueuedMessage={retryQueuedMessage}
                fileReferenceEnabled={Boolean(normalizeWorkspaceRoot(activeSddDraft.workspaceRoot))}
                fileReferences={composerFileReferences}
                onAddFileReference={addComposerFileReference}
                onPreviewFileReference={previewComposerFileReference}
                onRemoveFileReference={removeComposerFileReference}
                onSend={handleSend}
                onInterrupt={(options) => void interrupt(options)}
                runtimeCapabilities={runtimeCapabilities}
                onRetryConnection={() => void probeRuntime('user')}
                onOpenSettings={() => openSettings('agents')}
                onNewConversation={() => {
                  setInput('')
                  void createSddAssistantThreadForDraft(activeSddDraft)
                }}
                onCollapse={closeRightPanel}
                className="h-full max-h-full w-full"
              />
            ) : rightPanelMode === 'changes' ? (
              <ChangeInspector
                blocks={blocks}
                className="h-full max-h-full w-full flex-col"
                onCollapse={closeRightPanel}
              />
            ) : rightPanelMode === 'child-agents' ? (
              <ChildAgentsPanel
                activeThreadId={focusedThreadId}
                activeThread={focusedPanelThread}
                children={visibleThreadChildren}
                loading={threadChildrenState.loading}
                error={threadChildrenState.error}
                focusChildId={childPanelFocusRequest.childId}
                focusChildRequestKey={childPanelFocusRequest.key}
                onOpenChildInFocus={(child) => { void openChildInFocus(child) }}
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
              />
            ) : rightPanelMode === 'todo' ? (
              <TodoPanel
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
                onOpenPlan={openGuiPlanPanel}
              />
            ) : rightPanelMode === 'paper' && paperRadarEnabled ? (
              <PaperRadarPanel
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
              />
            ) : rightPanelMode === 'evidence' ? (
              <EvidenceDagPanel
                activeThreadId={activeThreadId}
                runtimeId={activeThread?.runtimeId}
                initialNodeId={
                  evidenceDagReturnNode?.threadId === activeThreadId
                    ? evidenceDagReturnNode.nodeId
                    : undefined
                }
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
                onInitialNodeConsumed={() => setEvidenceDagReturnNode(null)}
              />
            ) : rightPanelMode === 'project-dag' ? (
              <ProjectDagPanel
                workspaceRoot={activeThread?.workspace || workspaceRoot}
                initialClaimId={projectDagReturnTarget?.claimId}
                initialNodeId={projectDagReturnTarget?.nodeId}
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
                onInitialClaimConsumed={() => setProjectDagReturnTarget((current) =>
                  current?.nodeId ? { nodeId: current.nodeId } : null
                )}
                onInitialNodeConsumed={() => setProjectDagReturnTarget((current) =>
                  current?.claimId ? { claimId: current.claimId } : null
                )}
              />
            ) : rightPanelMode === 'browser' ? (
              <DevBrowserPanel
                blocks={devPreviewBlocks}
                preferredUrl={latestDevPreviewUrl}
                className="h-full max-h-full w-full flex-col"
                onCollapse={closeRightPanel}
              />
            ) : rightPanelMode === 'checkpoints' ? (
              <GitCheckpointPanel
                threadId={activeThreadId}
                runtimeId={activeThread?.runtimeId}
                workspaceRoot={activeThread?.workspace || workspaceRoot}
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
                onRestored={() => useChatStore.getState().refreshThreads()}
              />
            ) : rightPanelMode === 'visual-review' ? (
              <VisualReviewPanel
                workspaceRoot={visualReviewRequest?.workspaceRoot || activeThread?.workspace || workspaceRoot}
                documentId={visualReviewRequest?.documentId || activeVisualDocumentId}
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
                onSendReviewRequest={(text) => {
                  void sendVisualReviewRequest(text)
                }}
                refreshKey={visualReviewRequest?.refreshKey}
                onAccepted={() => {
                  void sendMessage(
                    '我已在人类审改页面接受候选图片。请重新编译所有引用该图片的文档，并检查最终输出中的裁切、重叠、标签可读性和引用是否正确。',
                    'agent',
                    { displayText: '已接受图片，请重新编译并检查最终文档。' }
                  )
                }}
              />
            ) : rightPanelMode === 'plan' ? (
              <PlanPanel
                workspaceRoot={workspaceRoot}
                activeThreadId={activeThreadId}
                runtimeReady={runtimeConnection === 'ready'}
                busy={busy}
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
                onBuildPlan={() => void buildGuiPlan()}
                onVerifyPlan={() => void verifyGuiPlan()}
                onReplanChanged={(changedIds) => void replanChangedRequirements(changedIds)}
              />
            ) : null}
            </Suspense>
          </div>
        </div>
      </>
    )
  }

  return (
    <div
      ref={shellRef}
      className="ds-workbench-shell ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main"
    >
      {visualCaptureActive ? (
        <div
          className="pointer-events-none fixed left-1/2 top-3 z-[200] flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent/25 bg-ds-card/95 px-3 py-1.5 text-[11.5px] font-semibold text-ds-ink shadow-lg backdrop-blur-xl"
          role="status"
          aria-live="polite"
        >
          <Eye className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          {t('visualContextCaptureActive')}
        </div>
      ) : null}
      <AnchoredCommentsLayer route={route} workspaceKey={workspaceRoot || 'global'} />
      {!leftSidebarCollapsed ? (
        <>
          <div className="min-h-0 shrink-0" style={{ width: leftSidebarWidth }}>
            <Sidebar
              threads={codeThreads}
              activeThreadId={activeThreadId}
              activeView={sidebarView}
              connectPhoneSidebarOpen={connectPhonePanelOpen}
              pluginsActive={route === 'plugins'}
              runtimeReady={runtimeConnection === 'ready'}
              threadSearch={threadSearch}
              showArchivedThreads={showArchivedThreads}
              onThreadSearchChange={setThreadSearch}
              onShowArchivedThreadsChange={setShowArchivedThreads}
              onSelectThread={openThread}
              onRenameThread={renameThread}
              onArchiveThread={(id) => archiveThread(id, true)}
              onDeleteThread={deleteThread}
              onRestoreThread={(id) => archiveThread(id, false)}
              onNewChat={startNewChat}
              onNewChatInWorkspace={startNewChatInWorkspace}
              onOpenSettings={(section) => openSettings(section)}
              onOpenPlugins={openPluginsView}
              onToggleConnectPhone={toggleConnectPhone}
              onScheduleOpen={openScheduleView}
              onWorkflowOpen={openWorkflowView}
              onToggleSidebar={toggleLeftSidebar}
            />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            className="ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize"
            onPointerDown={beginLeftResize}
          />
        </>
      ) : null}

      <main
        className={`ds-drag ds-stage-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
          route === 'plugins' ? 'px-0' : ''
        }`}
      >
        {route === 'plugins' ? (
          <>
            <div className="ds-no-drag shrink-0 px-4 pt-4">
              <SidebarTitlebarToggleButton
                onClick={toggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
            </div>
            <Suspense fallback={<div className="h-full bg-ds-main" />}>
              <PluginMarketplaceView />
            </Suspense>
          </>
        ) : route === 'schedule' ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <ScheduleTasksView
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={toggleLeftSidebar}
              onOpenThread={openThread}
            />
          </Suspense>
        ) : route === 'workflow' ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <WorkflowView
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={toggleLeftSidebar}
              onOpenThread={openThread}
            />
          </Suspense>
        ) : (
          <>
        {error && !(runtimeConnection !== 'ready' && !activeThreadId) ? renderRuntimeBanner(error, runtimeErrorDetail) : null}

        <div className="flex min-h-0 flex-1">
          <div className={`flex min-h-0 min-w-0 flex-1 ${activeSddDraft ? '' : stageInsetClass}`}>
          {activeSddDraft ? (
            <SddDraftEditorView
              leftSidebarCollapsed={leftSidebarCollapsed}
              assistantOpen={rightPanelMode === 'sdd-ai'}
              onToggleLeftSidebar={toggleLeftSidebar}
              onToggleAssistant={() => void toggleSddAssistantPanel()}
              onNext={() => void handleSddNextStep()}
              onClose={() => dismissActiveSddDraft({ closeAssistant: true })}
              nextDisabled={busy || runtimeConnection !== 'ready' || sddDraftOperationStatus === 'upgrading'}
            />
          ) : (
            <section className="ds-chat-stage ds-drag flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="chat-topbar ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full shrink-0 items-stretch overflow-visible rounded-[24px]">
              <div className="chat-topbar-grid grid w-full min-w-0 items-start gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
                <div
                  className={`chat-topbar-session flex min-w-0 items-center gap-2.5 ${
                    leftSidebarCollapsed ? 'ds-window-controls-safe-inset' : ''
                  }`}
                >
                  {leftSidebarCollapsed ? (
                    <SidebarTitlebarToggleButton
                      onClick={toggleLeftSidebar}
                      title={t('sidebarExpand')}
                      ariaLabel={t('sidebarExpand')}
                    />
                  ) : null}
                  {remoteGuardChannel ? (
                    <RemoteGuardSessionHeader channel={remoteGuardChannel} />
                  ) : (
                    <SessionHeader compact className="min-w-0 flex-1" />
                  )}
                  {!remoteGuardChannel && activeRemoteBinding && activeRemoteStatusKind ? (
                    <ActiveRemoteBindingDetails
                      binding={activeRemoteBinding}
                      statusKind={activeRemoteStatusKind}
                      unread={activeRemoteUnread}
                      t={t}
                    />
                  ) : null}
                </div>
                <div className="chat-topbar-actions flex min-w-0 flex-wrap items-center justify-end gap-2 self-start">
                  {!remoteGuardChannel ? <ThreadTargetSelector /> : null}
                  {(focusedAgentSurface?.busy ?? busy) ? (
                    <span className="inline-flex shrink-0 rounded-full bg-amber-500/16 px-2.5 py-1 text-[11.5px] font-semibold text-amber-950 dark:text-amber-100">
                      {t('running')}
                    </span>
                  ) : null}
                  <WorkbenchTopBar
                    rightPanelMode={rightPanelMode}
                    onToggleRightPanelMode={toggleTopBarRightPanelMode}
                    workspaceRoot={activeWorkspaceReferenceRoot}
                    planPanelEnabled={Boolean(activeGuiPlan)}
                    paperRadarEnabled={paperRadarEnabled}
                    terminalOpen={terminalOpen}
                    onToggleTerminal={toggleTerminal}
                    sideChatCount={currentSideConversations.length}
                    sideChatRunningCount={currentSideRunningCount}
                    sideChatOpen={sidePanel.open}
                    childAgentCount={childAgentCount}
                    childAgentRunningCount={Math.max(
                      childAgentRunningCount,
                      childAgentAttention.summary.counts.running
                    )}
                    childAgentAttentionCount={
                      childAgentAttention.summary.counts.waitingUserInput +
                      childAgentAttention.summary.counts.waitingApproval
                    }
                    childAgentsOpen={rightPanelMode === 'child-agents'}
                    sideChatEnabled={Boolean(activeThreadId) && sideConversationsSupported}
                    onOpenChildAgents={() => toggleTopBarRightPanelMode('child-agents')}
                    onOpenSideChat={
                      activeThreadId && sideConversationsSupported ? openSideChat : undefined
                    }
                  />
                </div>
              </div>
            </header>
            {!remoteGuardChannel && (focusNavigationLineage.length > 1 || agentFocusHistory.length > 1) ? (
              <AgentFocusNavigation
                lineage={focusNavigationLineage}
                canGoBack={agentFocusHistoryIndex > 0}
                canGoForward={
                  agentFocusHistoryIndex >= 0 &&
                  agentFocusHistoryIndex < agentFocusHistory.length - 1
                }
                onBack={() => { focusAgentBack() }}
                onForward={() => { focusAgentForward() }}
                onUp={() => { focusAgentParent() }}
                onNavigateTo={(threadId, index) => {
                  const node = agentFocusLineage[index]
                  focusAgentThread({
                    threadId,
                    parentThreadId: node?.parentThreadId,
                    runtimeId: node?.runtimeId,
                    title: node?.title,
                    lineage: agentFocusLineage.slice(0, index + 1)
                  })
                }}
              />
            ) : null}
            {!remoteGuardChannel && (
              childAgentAttention.summary.counts.waitingUserInput +
              childAgentAttention.summary.counts.waitingApproval
            ) > 0 ? (
              <button
                type="button"
                onClick={() => { void openPrimaryChildAttention() }}
                className="ds-no-drag mx-3 mt-1 flex shrink-0 items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-left text-[12px] font-medium text-amber-950 transition hover:bg-amber-500/15 dark:text-amber-100"
              >
                <CircleAlert className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  {t('sidebarChildrenNeedsAttention', {
                    count:
                      childAgentAttention.summary.counts.waitingUserInput +
                      childAgentAttention.summary.counts.waitingApproval
                  })}
                </span>
                <span className="shrink-0 text-[11px] font-semibold underline-offset-2 hover:underline">
                  {t('sidebarChildrenLocateAttention')}
                </span>
              </button>
            ) : null}
            {remoteGuardChannel ? (
              <RemoteGuardDetailView
                channel={remoteGuardChannel}
                onOpenThread={openThread}
                onOpenSettings={openConnectPhone}
                t={t}
              />
            ) : (
              <>
                <FocusedAgentWorkbench
                  child={focusedChild}
                  side={focusedSide}
                  workspaceRoot={activeSkillWorkspace || workspaceRoot}
                  runtimeConnection={runtimeConnection}
                  composerPickList={composerPickList}
                  composerModelGroups={composerModelGroups}
                  activeAgentRuntime={focusedRuntimeId ?? activeAgentRuntime}
                  runtimeCapabilities={runtimeCapabilities}
                />
                {!focusedChild ? (
                  <>
                <MessageTimeline
                  blocks={timelineBlocks}
                  liveReasoning={timelineLiveReasoning}
                  live={timelineLiveAssistant}
                  activeThreadId={activeThreadId}
                  runtimeConnection={runtimeConnection}
                  runtimeError={error}
                  onRetryConnection={() => void probeRuntime('user')}
                  onOpenSettings={() => openSettings('agents')}
                  autoScrollEnabled={route === 'chat' && Boolean(activeThreadId)}
                  onSelectSuggestion={(text) => setInput(text)}
                  planActionsBusy={busy}
                  onBuildPlan={() => void buildGuiPlan()}
                  onOpenPlan={openGuiPlanPanel}
                  onOpenImageArtifactInVisualReview={openImageArtifactInVisualReview}
                  devPreviewCard={
                    showDevPreviewCard ? (
                      <DevPreviewLaunchCard
                        url={latestDevPreviewUrl}
                        opened={rightPanelMode === 'browser'}
                        onOpen={openDevPreview}
                      />
                    ) : null
                  }
                />
                <div className="ds-no-drag flex shrink-0 justify-center px-2 pb-3 pt-0 sm:px-4 md:px-6 lg:px-8">
                  <FloatingComposer
                    input={input}
                    setInput={setInput}
                    mode={mode}
                    setMode={setMode}
                    busy={busy}
                    runtimeReady={runtimeConnection === 'ready'}
                    hasActiveThread={Boolean(activeThreadId)}
                    composerModel={
                      activeThreadIsRemoteChannel
                        ? activeRemoteComposerChannel?.model ?? 'auto'
                        : composerModel
                    }
                    composerPickList={composerPickList}
                    composerModelGroups={composerModelGroups}
                    activeAgentRuntime={activeAgentRuntime}
                    composerReasoningEffort={
                      route === 'chat' ? composerReasoningEffort : undefined
                    }
                    onComposerModelChange={(modelId) => {
                      if (activeThreadIsRemoteChannel && activeRemoteComposerChannelId) {
                        void setRemoteChannelModel(activeRemoteComposerChannelId, modelId)
                        return
                      }
                      setComposerModel(modelId)
                    }}
                    onActiveAgentRuntimeChange={(runtimeId) => {
                      void setActiveAgentRuntime(runtimeId)
                    }}
                    onComposerReasoningEffortChange={
                      route === 'chat' ? setComposerReasoningEffort : undefined
                    }
                    onSend={handleSend}
                    attachments={composerAttachments}
                    attachmentUploadEnabled={attachmentUploadEnabled}
                    attachmentUploadBusy={attachmentUploadBusy}
                    attachmentUploadError={attachmentUploadError}
                    fileReferenceEnabled={route === 'chat' && !activeSddDraft && !activeThreadIsRemoteChannel}
                    fileReferences={composerFileReferences}
                    commentReferences={activeThreadIsRemoteChannel ? [] : composerCommentReferences}
                    webAccessAvailable={webAccessAvailable}
                    changedFiles={composerChangeSummary?.files}
                    changedFileStats={composerChangeSummary}
                    skillCommands={runtimeSkills}
                    runtimeCapabilities={runtimeCapabilities}
                    sideConversationsEnabled={sideConversationsSupported}
                    onPickAttachments={(files) => void handlePickAttachments(files)}
                    onPasteClipboardImage={(options) => void handlePasteClipboardImage(options)}
                    onRemoveAttachment={removeComposerAttachment}
                    onAddFileReference={addComposerFileReference}
                    onPreviewFileReference={previewComposerFileReference}
                    onRemoveFileReference={removeComposerFileReference}
                    onRemoveCommentReference={removeComposerCommentReference}
                    queuedMessages={activeQueuedMessages}
                    queuedMessagesPersistenceDegraded={chatSessionPersistenceDegraded}
                    onRemoveQueuedMessage={removeQueuedMessage}
                    onEditQueuedMessage={(id, text) => void updateQueuedMessage(id, text)}
                    onSteerQueuedMessage={(id) => void steerQueuedMessage(id)}
                    onRetryQueuedMessage={(id) => void retryQueuedMessage(id)}
                    onInterrupt={(options) => void interrupt(options)}
                    onPlanCommand={() => void handleGuiPlanCommand()}
                    onReviewCommand={(target) => void reviewActiveThread(target)}
                    onOpenChanges={() => setRightPanelMode('changes')}
                    onReviewChanges={() => void reviewActiveThread({ kind: 'uncommittedChanges' })}
                    reviewChangesDisabled={busy || runtimeConnection !== 'ready' || runtimeCapabilities?.review === false}
                    onBtwCommand={(seedText) => {
                      if (seedText?.trim()) {
                        void spawnSideConversation(seedText)
                        return
                      }
                      openSideConversationDraft()
                    }}
                  />
                </div>
                  </>
                ) : null}
                {terminalOpen ? (
                  <div className="ds-no-drag flex w-full shrink-0 flex-col px-0 pb-0">
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      className="relative z-20 h-1 shrink-0 cursor-row-resize bg-transparent transition hover:bg-ds-border-muted"
                      onPointerDown={beginTerminalResize}
                    />
                    <Suspense fallback={<div className="ds-surface-strong h-full w-full" />}>
                      <TerminalPanel
                        workspaceRoot={activeSkillWorkspace || workspaceRoot}
                        height={terminalHeight}
                        className="w-full"
                        onCollapse={toggleTerminal}
                      />
                    </Suspense>
                  </div>
                ) : null}
              </>
            )}
          </section>
          )}
          </div>

          {route === 'chat' && !activeSddDraft ? (
            <SideConversationPanel rightOffset={rightPanelVisible ? rightSidebarWidth + 24 : 24} />
          ) : null}

          {renderRightPanel()}
        </div>

          </>
        )}
      </main>
      {route === 'chat' ? (
        <Suspense fallback={null}>
          <WorkflowRunPanel enabled />
        </Suspense>
      ) : null}
    </div>
  )
}

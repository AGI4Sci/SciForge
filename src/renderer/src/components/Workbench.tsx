import type { ReactElement, SetStateAction } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ArrowLeft, ArrowRight, Bot, CircleAlert, Eye } from 'lucide-react'
import type {
  DomainWorkbenchOpenRightPanelInput,
  DomainWorkbenchOpenSurfaceInput,
  DomainWorkbenchToggleGlobalOverlayInput
} from '@sciforge/domain-sdk/host'
import { parseRemoteChannelCommand } from '@shared/remote-channel-commands'
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
import type { VisibleContextComponentSnapshot } from '@shared/visible-context'
import type { AgentRuntimeChild, AgentRuntimeWorkspaceReference } from '@shared/agent-runtime-contract'
import type {
  AgentProviderCapabilities,
  AttachmentReference,
  ChatBlock,
  NormalizedThread
} from '../agent/types'
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
import { Sidebar } from './chat/Sidebar'
import { WorkbenchTopBar, type RightPanelMode } from './chat/WorkbenchTopBar'
import { ActiveRemoteBindingDetails } from './chat/RemoteBindingDetailsPill'
import { MessageTimeline } from './chat/MessageTimeline'
import {
  FloatingComposer,
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
  SessionChildAgentsPanel,
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
import { RemoteWorkspaceSelector } from './chat/RemoteWorkspaceSelector'
import { SessionHeader } from './SessionHeader'
import {
  SessionSddAssistantPanel,
  type SddAssistantSendRequest
} from './sdd/SessionSddAssistantPanel'
import { SddDraftEditorView } from './sdd/SddDraftEditorView'
import { SidebarTitlebarToggleButton } from './sidebar/SidebarPrimitives'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import {
  buildSddDraftId,
  forgetRememberedSddDraft,
  selectSddDraftSession,
  useSddDraftStore
} from '../sdd/sdd-draft-store'
import type { SddDraft, SddDraftSaveStatus } from '../sdd/sdd-draft-store'
import { saveSddDraftToDisk } from '../sdd/sdd-draft-actions'
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
import { RuntimeBanner } from './RuntimeBanner'
import {
  CODE_PANEL_PREFERRED,
  useWorkbenchLayout
} from './workbench-layout'
import {
  SESSION_RIGHT_PANEL_DEFAULT_WIDTH,
  type SessionRightPanelWorkspace
} from './session-right-panel-workspaces'
import { draftSessionRightPanelId } from '../lib/session-right-panel-owner'
import { SessionRightPanelStack } from './SessionRightPanelStack'
import { useWorkbenchPlanController } from './workbench-plan-controller'
import { prepareImageAttachmentUpload } from '../lib/image-attachment-upload'
import { isChatAttachmentUploadEnabled } from '../lib/attachment-upload-availability'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { buildImageGenerationWorkflowPrompt } from '../lib/image-generation-chat'
import { useKeyboardShortcutSettings } from '../lib/keyboard-shortcut-settings'
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
import { withActiveWorkspaceLocator } from '../remote-workspace/placement'
import {
  buildWorkspaceReferenceGroups,
  type WorkspaceReferenceGroup
} from '../lib/workspace-reference-groups'
import {
  registerVisibleContextComponent,
  registerVisibleContextSensitiveElements,
  registerVisibleContextVisualTarget,
  setVisibleContextShell
} from '../lib/visible-context'
import {
  subscribeSessionRightPanelDisposals,
  subscribeSessionRightPanelRekeys
} from '../lib/session-right-panel-lifecycle'
import { installedRendererContributions } from '../domain-modules/installed-renderer-contributions'
import {
  DOMAIN_WORKBENCH_OPEN_BOTTOM_PANEL_EVENT,
  DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT,
  DOMAIN_WORKBENCH_TOGGLE_GLOBAL_OVERLAY_EVENT,
  setDomainWorkbenchMessageSender
} from '../domain-modules/domain-renderer-navigation'

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
function rightPanelVisibleContextTitle(mode: Exclude<RightPanelMode, null>): string {
  const registeredTitle = installedRendererContributions.rightPanels.resolve(mode)?.contribution.title
  if (registeredTitle) return registeredTitle
  switch (mode) {
    case 'file':
      return 'File preview'
    case 'child-agents':
      return 'Child agents'
    case 'todo':
      return 'Todos'
    case 'plan':
      return 'Plan'
    case 'sdd-ai':
      return 'SDD assistant'
    default:
      return String(mode)
  }
}

const CORE_RIGHT_PANEL_RESOURCE_KINDS: Partial<Record<Exclude<RightPanelMode, null>, string>> = {
  file: 'workspace-files',
  'child-agents': 'child-agents',
  todo: 'session-todos',
  plan: 'gui-plan',
  'sdd-ai': 'sdd-assistant'
}

function rightPanelVisibleContextResourceKind(mode: Exclude<RightPanelMode, null>): string {
  return installedRendererContributions.rightPanels.resolve(mode)?.contribution.resourceKind ??
    CORE_RIGHT_PANEL_RESOURCE_KINDS[mode] ?? mode
}

export type RightPanelVisibleContextInput = {
  mode: Exclude<RightPanelMode, null>
  sessionId: string
  width: number
  workspaceRoot?: string
  filePreviewTarget?: { path: string; workspaceRoot?: string } | null
  childAgentCount?: number
  childAgentRunningCount?: number
  planId?: string | null
  sddDraftId?: string | null
  updatedAt?: string
}

/**
 * Builds the single, mode-independent directory entry for the visible right panel.
 * Mode-specific panels may publish richer observations, but this component always
 * identifies which session owns the panel and which resource is currently selected.
 */
export function buildRightPanelVisibleContextComponent(
  input: RightPanelVisibleContextInput
): VisibleContextComponentSnapshot {
  const title = rightPanelVisibleContextTitle(input.mode)
  const workspaceRoot = input.filePreviewTarget?.workspaceRoot || input.workspaceRoot || undefined
  const baseResource = {
    kind: rightPanelVisibleContextResourceKind(input.mode),
    title,
    summary: `${title} state owned by session ${input.sessionId}.`,
    sessionId: input.sessionId,
    ...(workspaceRoot ? { workspaceRoot } : {})
  }
  let currentResource: Record<string, unknown> = baseResource
  switch (input.mode) {
    case 'file':
      if (input.filePreviewTarget?.path) {
        const fileTitle = fileNameFromPath(input.filePreviewTarget.path)
        currentResource = {
          ...baseResource,
          kind: 'workspace-file-preview',
          title: fileTitle,
          summary: `Canonical workspace preview for ${fileTitle}.`,
          path: input.filePreviewTarget.path,
          canonicalComponentId: 'right-sidebar.file-preview'
        }
      }
      break
    case 'child-agents':
      currentResource = {
        ...baseResource,
        count: input.childAgentCount ?? 0,
        runningCount: input.childAgentRunningCount ?? 0
      }
      break
    case 'plan':
      currentResource = { ...baseResource, planId: input.planId || null }
      break
    case 'sdd-ai':
      currentResource = { ...baseResource, draftId: input.sddDraftId || null }
      break
  }

  return {
    id: 'right-sidebar',
    region: 'right-sidebar',
    component: 'right-panel',
    title,
    visible: true,
    priority: 10,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    summary: `Right sidebar for session ${input.sessionId} is showing the ${title} panel.`,
    state: {
      mode: input.mode,
      sessionId: input.sessionId,
      width: input.width,
      currentResource
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
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

type SessionRightPanelRenderer = (
  workspace: SessionRightPanelWorkspace,
  active: boolean
) => ReactElement | null

type SessionRightPanelRenderSnapshot = {
  thread: NormalizedThread | null
  blocks: ChatBlock[]
  workspaceRoot: string
  workspaceReferenceGroups: WorkspaceReferenceGroup[]
  composerFileReferences: ComposerFileReference[]
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
    threadBlocksById,
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
    modelAccessMode,
    setRoute,
    openSettings,
    openPlugins,
    openConnectPhone,
    setConnectPhonePanelOpen,
    openSchedule,
    chooseWorkspace,
    remoteChannels,
    activeRemoteChannelId,
    remoteGuardChannelId,
    workspaceLocator,
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
      threadBlocksById: s.threadBlocksById,
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
      modelAccessMode: s.modelAccessMode,
      setRoute: s.setRoute,
      openSettings: s.openSettings,
      openPlugins: s.openPlugins,
      openConnectPhone: s.openConnectPhone,
      setConnectPhonePanelOpen: s.setConnectPhonePanelOpen,
      openSchedule: s.openSchedule,
      chooseWorkspace: s.chooseWorkspace,
      remoteChannels: s.remoteChannels,
      activeRemoteChannelId: s.activeRemoteChannelId,
      remoteGuardChannelId: s.remoteGuardChannelId,
      workspaceLocator: s.workspaceLocator,
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
    useState<ComposerReasoningEffort>('medium')
  const [runtimeInfo, setRuntimeInfo] = useState<LocalRuntimeInfoJson | null>(null)
  const [runtimeSkills, setRuntimeSkills] = useState<LocalRuntimeSkillJson[]>([])
  const [composerAttachments, setComposerAttachments] = useState<AttachmentReference[]>([])
  const rightPanelOwnerId = activeThreadId ?? draftSessionRightPanelId(workspaceRoot)
  const [composerFileReferencesBySession, setComposerFileReferencesBySession] = useState<
    Record<string, ComposerFileReference[]>
  >({})
  const composerFileReferences = rightPanelOwnerId
    ? composerFileReferencesBySession[rightPanelOwnerId] ?? []
    : []
  const setComposerFileReferences = useCallback((
    value: SetStateAction<ComposerFileReference[]>
  ): void => {
    const ownerSessionId = rightPanelOwnerId
    if (!ownerSessionId) return
    setComposerFileReferencesBySession((current) => {
      const ownerReferences = current[ownerSessionId] ?? []
      const nextReferences = typeof value === 'function' ? value(ownerReferences) : value
      if (nextReferences === ownerReferences) return current
      return { ...current, [ownerSessionId]: nextReferences }
    })
  }, [rightPanelOwnerId])
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
  const annotationQuestionBridge = useMemo(() => ({
    sideConversations,
    spawnSideConversation,
    sendSideMessage
  }), [sendSideMessage, sideConversations, spawnSideConversation])
  const activeSddSession = useSddDraftStore((state) =>
    selectSddDraftSession(state, activeThreadId)
  )
  const activeSddDraft = activeSddSession?.draft ?? null
  const sddDraftOperationStatus = activeSddSession?.operationStatus ?? 'idle'
  const stageInsetClass = 'ds-stage-inset'
  const installedRightPanels = installedRendererContributions.rightPanels.list()
  const installedToolbarActions = installedRendererContributions.toolbarActions.list()
  const keyboardShortcuts = useKeyboardShortcutSettings()
  const keyboardShortcutBindings = useMemo(
    () => resolveKeyboardShortcutBindings(keyboardShortcuts),
    [keyboardShortcuts]
  )

  const prevThreadId = useRef<string | null>(null)
  const inputRef = useRef('')
  const composerReferenceContextBySessionRef = useRef(new Map<string, string>())
  const sddUpgradeTargetsRef = useRef<Record<string, PendingSddPlanTarget>>({})
  const timelineBlocks = blocks
  const timelineLiveReasoning = liveReasoning
  const timelineLiveAssistant = liveAssistant
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
  const selectedWorkspaceLocator =
    route === 'chat' && !activeThreadIsRemoteChannel ? workspaceLocator ?? undefined : undefined
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
  const {
    beginBottomPanelResize,
    beginLeftResize,
    beginRightResize,
    bottomPanelActivation,
    bottomPanelContributionId,
    bottomPanelHeight,
    closeBottomPanel,
    discardRightPanelResource,
    canNavigateRightPanelBack,
    canNavigateRightPanelForward,
    filePreviewReturnContext,
    filePreviewTarget,
    leftSidebarCollapsed,
    leftSidebarWidth,
    navigateRightPanelBack,
    navigateRightPanelForward,
    rightPanelMode,
    rightPanelWorkspaces,
    rightPanelVisible,
    rightSidebarWidth,
    setFilePreviewTarget,
    setFilePreviewReturnContext,
    setRightPanelMode,
    setRightSidebarWidth,
    setRightSidebarWidthForSession,
    shellRef,
    openBottomPanelForSession,
    toggleLeftSidebar,
    toggleRightPanelMode,
    updateRightPanelWorkspace,
  } = useWorkbenchLayout({
    activeSessionId: rightPanelOwnerId
  })
  const activeBottomPanel = installedRendererContributions.bottomPanels.resolve(
    bottomPanelContributionId
  )
  const [globalOverlay, setGlobalOverlay] =
    useState<DomainWorkbenchToggleGlobalOverlayInput | null>(null)
  const activeGlobalOverlay = installedRendererContributions.globalOverlays.resolve(
    globalOverlay?.contributionId
  )
  const toolbarCommandInvocation = {
    ...(rightPanelOwnerId ? { sessionId: rightPanelOwnerId } : {}),
    ...(activeThread?.runtimeId ? { runtimeId: activeThread.runtimeId } : {}),
    ...(activeWorkspaceReferenceRoot
      ? { workspaceRoot: activeWorkspaceReferenceRoot }
      : {}),
    ...(activeGlobalOverlay
      ? {
          activeSurface: {
            kind: 'global-overlay' as const,
            contributionId: activeGlobalOverlay.id
          }
        }
      : activeBottomPanel
      ? {
          activeSurface: {
            kind: 'bottom-panel' as const,
            contributionId: activeBottomPanel.id
          }
        }
      : installedRendererContributions.rightPanels.resolve(rightPanelMode)
        ? {
            activeSurface: {
              kind: 'right-panel' as const,
              contributionId:
                installedRendererContributions.rightPanels.resolve(rightPanelMode)!.id
            }
          }
        : {})
  }
  const sessionRightPanelSnapshotsRef = useRef(new Map<string, SessionRightPanelRenderSnapshot>())
  const setFileTreeWorkspaceOverride = useCallback((value: string | null): void => {
    if (rightPanelOwnerId) updateRightPanelWorkspace(rightPanelOwnerId, { fileTreeWorkspaceOverride: value })
  }, [rightPanelOwnerId, updateRightPanelWorkspace])
  const setChildPanelFocusRequest = useCallback((request: { childId: string | null; key: number }): void => {
    if (activeThreadId) updateRightPanelWorkspace(activeThreadId, { childPanelFocusRequest: request })
  }, [activeThreadId, updateRightPanelWorkspace])

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
    setChildPanelFocusRequest,
    setRightPanelMode
  ])
  const setFileTreeInitialDirectory = useCallback((
    value: SetStateAction<FileTreeInitialDirectory | null>
  ): void => {
    if (!rightPanelOwnerId) return
    const current = rightPanelWorkspaces.find((workspace) => workspace.sessionId === rightPanelOwnerId)
      ?.fileTreeInitialDirectory ?? null
    updateRightPanelWorkspace(rightPanelOwnerId, {
      fileTreeInitialDirectory: typeof value === 'function' ? value(current) : value
    })
  }, [rightPanelOwnerId, rightPanelWorkspaces, updateRightPanelWorkspace])
  const {
    activeGuiPlan,
    buildGuiPlan,
    handleGuiPlanCommand,
    openGuiPlanPanel,
    replanChangedRequirements,
    sendPlanTurn,
    verifyGuiPlan
  } = useWorkbenchPlanController({
    ownerSessionId: activeThreadId,
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
    if (!rightPanelMode || !rightPanelOwnerId) return undefined
    return registerVisibleContextComponent(buildRightPanelVisibleContextComponent({
      mode: rightPanelMode,
      sessionId: rightPanelOwnerId,
      width: rightSidebarWidth,
      workspaceRoot,
      filePreviewTarget: rightPanelMode === 'file' ? filePreviewTarget : null,
      childAgentCount,
      childAgentRunningCount,
      planId: activeGuiPlan?.id,
      sddDraftId: activeSddDraft?.id
    }))
  }, [
    activeGuiPlan?.id,
    activeSddDraft?.id,
    childAgentCount,
    childAgentRunningCount,
    filePreviewTarget,
    rightPanelMode,
    rightPanelOwnerId,
    rightPanelWorkspaces,
    rightSidebarWidth,
    workspaceRoot
  ])

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
    setMode
  ])
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
    const openDomainRightPanel = (event: Event): void => {
      const detail = (event as CustomEvent<DomainWorkbenchOpenRightPanelInput>).detail
      const sessionId = detail?.sessionId?.trim()
      const contributionId = detail?.contributionId?.trim()
      if (!sessionId || !contributionId) return
      if (detail.activation && detail.activation.contributionId !== contributionId) return
      const registered = installedRendererContributions.rightPanels.resolve(contributionId)
      if (!registered) return
      setRightSidebarWidthForSession(
        sessionId,
        (width) => Math.max(width, CODE_PANEL_PREFERRED)
      )
      updateRightPanelWorkspace(sessionId, {
        mode: registered.id,
        panelActivation: detail.activation ?? null
      })
    }
    window.addEventListener(DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT, openDomainRightPanel)
    return () => window.removeEventListener(
      DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT,
      openDomainRightPanel
    )
  }, [setRightSidebarWidthForSession, updateRightPanelWorkspace])

  useEffect(() => {
    const openDomainBottomPanel = (event: Event): void => {
      const detail = (event as CustomEvent<DomainWorkbenchOpenSurfaceInput>).detail
      const sessionId = detail?.sessionId?.trim()
      const contributionId = detail?.contributionId?.trim()
      if (!sessionId || !contributionId) return
      if (!installedRendererContributions.bottomPanels.resolve(contributionId)) return
      openBottomPanelForSession(sessionId, contributionId, detail.activation)
    }
    window.addEventListener(
      DOMAIN_WORKBENCH_OPEN_BOTTOM_PANEL_EVENT,
      openDomainBottomPanel
    )
    return () => window.removeEventListener(
      DOMAIN_WORKBENCH_OPEN_BOTTOM_PANEL_EVENT,
      openDomainBottomPanel
    )
  }, [openBottomPanelForSession])

  useEffect(() => {
    const toggleDomainGlobalOverlay = (event: Event): void => {
      const detail = (event as CustomEvent<DomainWorkbenchToggleGlobalOverlayInput>).detail
      const contributionId = detail?.contributionId?.trim()
      if (!contributionId) return
      if (!installedRendererContributions.globalOverlays.resolve(contributionId)) return
      setGlobalOverlay((current) => {
        if (detail.open === false) {
          return current?.contributionId === contributionId ? null : current
        }
        if (detail.open !== true && current?.contributionId === contributionId) {
          return null
        }
        return {
          contributionId,
          ...(detail.sessionId?.trim() ? { sessionId: detail.sessionId.trim() } : {}),
          ...(detail.activation ? { activation: detail.activation } : {}),
          open: true
        }
      })
    }
    window.addEventListener(
      DOMAIN_WORKBENCH_TOGGLE_GLOBAL_OVERLAY_EVENT,
      toggleDomainGlobalOverlay
    )
    return () => window.removeEventListener(
      DOMAIN_WORKBENCH_TOGGLE_GLOBAL_OVERLAY_EVENT,
      toggleDomainGlobalOverlay
    )
  }, [])

  useEffect(() => setDomainWorkbenchMessageSender(async (request) => {
    try {
      const sent = await sendMessage(request.text, 'agent', {
        targetThreadId: request.sessionId,
        ...(request.displayText ? { displayText: request.displayText } : {})
      })
      return sent
        ? { ok: true }
        : {
            ok: false,
            error: {
              code: 'message-not-sent',
              message: 'The message could not be sent to the requested session.'
            }
          }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'message-failed',
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }), [sendMessage])

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
    if (!activeThreadId) return
    const pendingTarget = sddUpgradeTargetsRef.current[activeThreadId] ?? null
    if (
      !activeGuiPlan ||
      !pendingTarget ||
      !sddPlanMatchesPendingTarget(activeGuiPlan, pendingTarget)
    ) {
      return
    }
    delete sddUpgradeTargetsRef.current[activeThreadId]
    const completedSession = selectSddDraftSession(useSddDraftStore.getState(), activeThreadId)
    const completedDraft = completedSession?.draft ?? null
    if (completedDraft) forgetRememberedSddDraft(completedDraft)
    useSddDraftStore.getState().removeSession(activeThreadId)
  }, [activeGuiPlan, activeThreadId])

  useEffect(() => {
    if (!activeThreadId) return
    const pendingTarget = sddUpgradeTargetsRef.current[activeThreadId] ?? null
    if (
      busy ||
      !pendingTarget ||
      sddDraftOperationStatus !== 'upgrading' ||
      sddPlanMatchesPendingTarget(activeGuiPlan, pendingTarget)
    ) {
      return
    }
    const timeout = window.setTimeout(() => {
      if (!sddUpgradeTargetsRef.current[activeThreadId]) return
      const session = selectSddDraftSession(useSddDraftStore.getState(), activeThreadId)
      if (session?.operationStatus !== 'upgrading') return
      delete sddUpgradeTargetsRef.current[activeThreadId]
      useSddDraftStore.getState().setSessionOperationStatus(
        activeThreadId,
        'error',
        t('planToolResultMissing')
      )
    }, 800)
    return () => window.clearTimeout(timeout)
  }, [activeGuiPlan, activeThreadId, busy, sddDraftOperationStatus, t])

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
    setFileTreeInitialDirectory,
    setFileTreeWorkspaceOverride,
    setRightPanelMode,
    workspaceReferenceGroups,
    workspaceRoot
  ])

  useEffect(() => {
    const onPreviewWorkspaceFile = (event: Event): void => {
      const detail = (event as CustomEvent<WorkspaceFilePreviewDetail>).detail
      if (!detail?.path) return
      const ownerSessionId = detail.sessionId?.trim() || rightPanelOwnerId
      if (!ownerSessionId) return
      const ownerThread = threads.find((thread) => thread.id === ownerSessionId)
      const ownerWorkspaceRoot = normalizeWorkspaceRoot(
        detail.workspaceRoot || ownerThread?.workspace || workspaceRoot
      )
      if (detail.kind === 'directory') {
        updateRightPanelWorkspace(ownerSessionId, {
          fileTreeWorkspaceOverride: ownerWorkspaceRoot || null,
          fileTreeInitialDirectory: {
            workspaceRoot: ownerWorkspaceRoot,
            path: relativeWorkspacePath(detail.path, ownerWorkspaceRoot),
            nonce: Date.now()
          },
          filePreviewReturnContext: null,
          filePreviewTarget: null,
          width: Math.max(
            rightPanelWorkspaces.find((candidate) => candidate.sessionId === ownerSessionId)?.width ?? SESSION_RIGHT_PANEL_DEFAULT_WIDTH,
            CODE_PANEL_PREFERRED
          ),
          mode: 'file'
        })
        return
      }
      const {
        sessionId: _sessionId,
        kind: _kind,
        returnTo: _returnTo,
        ...fileTarget
      } = detail
      updateRightPanelWorkspace(ownerSessionId, {
        filePreviewTarget: {
          ...fileTarget,
          workspaceRoot: ownerWorkspaceRoot
        },
        filePreviewReturnContext: detail.returnTo ?? null,
        width: Math.max(
          rightPanelWorkspaces.find((candidate) => candidate.sessionId === ownerSessionId)?.width ?? SESSION_RIGHT_PANEL_DEFAULT_WIDTH,
          CODE_PANEL_PREFERRED
        ),
        mode: 'file'
      })
    }

    window.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreviewWorkspaceFile)
    return () => window.removeEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreviewWorkspaceFile)
  }, [rightPanelOwnerId, rightPanelWorkspaces, threads, updateRightPanelWorkspace, workspaceRoot])

  const toggleTopBarRightPanelMode = (mode: Exclude<RightPanelMode, null>): void => {
    if (mode === 'file') setFileTreeWorkspaceOverride(null)
    if (installedRendererContributions.rightPanels.resolve(mode)) {
      setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
    }
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
  }, [route, setComposerFileReferences])

  useEffect(() => {
    if (!activeThreadId) return
    const contextKey = `${activeSddDraft?.id ?? '-'}|${activeWorkspaceReferenceRoot}`
    const previousContextKey = composerReferenceContextBySessionRef.current.get(activeThreadId)
    composerReferenceContextBySessionRef.current.set(activeThreadId, contextKey)
    if (previousContextKey && previousContextKey !== contextKey) setComposerFileReferences([])
  }, [activeSddDraft?.id, activeThreadId, activeWorkspaceReferenceRoot, setComposerFileReferences])

  useEffect(() => subscribeSessionRightPanelDisposals((sessionId) => {
    composerReferenceContextBySessionRef.current.delete(sessionId)
    setComposerFileReferencesBySession((current) => {
      if (!current[sessionId]) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }), [])

  useEffect(() => subscribeSessionRightPanelRekeys((previousSessionId, nextSessionId) => {
    const previousContext = composerReferenceContextBySessionRef.current.get(previousSessionId)
    composerReferenceContextBySessionRef.current.delete(previousSessionId)
    if (previousContext && !composerReferenceContextBySessionRef.current.has(nextSessionId)) {
      composerReferenceContextBySessionRef.current.set(nextSessionId, previousContext)
    }
    setComposerFileReferencesBySession((current) => {
      const previousReferences = current[previousSessionId]
      if (!previousReferences) return current
      const next = { ...current }
      delete next[previousSessionId]
      if (!next[nextSessionId]) next[nextSessionId] = previousReferences
      return next
    })
  }), [])

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
    const initiatingSessionId = useChatStore.getState().activeThreadId
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
        ...(workspaceLocator?.path === normalizedWorkspace ? { workspaceLocator } : {}),
        title: t('sddAssistant'),
        mode: 'agent'
      })
      const normalizedThread = {
        ...thread,
        workspace: normalizeWorkspaceRoot(thread.workspace) || normalizedWorkspace
      }
      markSddAssistantThread(draft, normalizedThread.id)
      useChatStore.setState((state) => ({
        ...(state.activeThreadId === initiatingSessionId
          ? { activeThreadId: normalizedThread.id }
          : {}),
        threads: state.threads.some((item) => item.id === normalizedThread.id)
          ? state.threads
          : [normalizedThread, ...state.threads]
      }))
      if (useChatStore.getState().activeThreadId === normalizedThread.id) {
        setRoute('chat')
        await selectThread(normalizedThread.id)
      }
      void useChatStore.getState().refreshThreads()
      return normalizedThread.id
    } catch (error) {
      if (useChatStore.getState().activeThreadId === initiatingSessionId) {
        setError(error instanceof Error ? error.message : String(error))
      }
      return null
    }
  }

  const ensureSddAssistantThreadForDraft = async (draft: SddDraft): Promise<string | null> => {
    const registeredThreadId = sddAssistantThreadIdForDraft(draft)
    if (registeredThreadId) {
      const initiatingSessionId = useChatStore.getState().activeThreadId
      if (initiatingSessionId !== registeredThreadId) {
        await selectThread(registeredThreadId)
      }
      if (useChatStore.getState().activeThreadId === registeredThreadId) setRoute('chat')
      return registeredThreadId
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
    setRoute('chat')
    let ownerSessionId = useChatStore.getState().activeThreadId
    if (options.openAssistant ?? runtimeConnection === 'ready') {
      const sddThreadId = await ensureSddAssistantThreadForDraft(draft)
      if (sddThreadId) {
        ownerSessionId = sddThreadId
        useSddDraftStore.getState().setSessionDraft(ownerSessionId, draft, content, {
          lastSavedContent: options.lastSavedContent,
          saveStatus: options.saveStatus
        })
        const workspaceWidth = rightPanelWorkspaces.find(
          (workspace) => workspace.sessionId === ownerSessionId
        )?.width ?? 420
        updateRightPanelWorkspace(ownerSessionId, {
          mode: 'sdd-ai',
          width: Math.max(workspaceWidth, 420)
        })
      } else {
        return false
      }
    } else {
      if (!ownerSessionId) return false
      useSddDraftStore.getState().setSessionDraft(ownerSessionId, draft, content, {
        lastSavedContent: options.lastSavedContent,
        saveStatus: options.saveStatus
      })
      setRightPanelMode(null)
    }
    return true
  }

  const dismissSddDraft = (
    ownerSessionId: string,
    options: { closeAssistant?: boolean } = {}
  ): void => {
    const session = selectSddDraftSession(useSddDraftStore.getState(), ownerSessionId)
    if (session) void saveSddDraftToDisk(ownerSessionId)
    useSddDraftStore.getState().removeSession(ownerSessionId)
    delete sddUpgradeTargetsRef.current[ownerSessionId]
    if (options.closeAssistant && rightPanelMode === 'sdd-ai') setRightPanelMode(null)
  }

  const toggleSddAssistantPanel = async (): Promise<void> => {
    if (rightPanelMode === 'sdd-ai') {
      setRightPanelMode(null)
      return
    }
    if (!activeThreadId) return
    const session = selectSddDraftSession(useSddDraftStore.getState(), activeThreadId)
    if (!session) return
    setRightSidebarWidth((width) => Math.max(width, 420))
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
    const current = selectSddDraftSession(useSddDraftStore.getState(), threadId)
    if (current) await saveSddDraftToDisk(threadId)
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
    request: SddAssistantSendRequest
  ): Promise<boolean> => {
    const v = request.value.trim()
    const fileReferences = [...request.fileReferences]
    if (!v && fileReferences.length === 0) return false
    const session = selectSddDraftSession(useSddDraftStore.getState(), request.ownerSessionId)
    if (session?.draft.id !== request.draft.id) return false
    void saveSddDraftToDisk(request.ownerSessionId)
    const messageText = v || t('composerFileOnlyPrompt')
    let prompt = composeSddAssistantPrompt({
      userPrompt: messageText,
      draftMarkdown: request.draftContent,
      draftRelativePath: request.draft.relativePath,
      workspaceRoot: request.draft.workspaceRoot
    })
    if (fileReferences.length > 0) {
      try {
        const fileContext = await readComposerFileContextEntries(
          fileReferences,
          request.draft.workspaceRoot
        )
        prompt = buildComposerFileContextPrompt(prompt, fileContext)
      } catch (error) {
        if (useChatStore.getState().activeThreadId === request.ownerSessionId) {
          setError(error instanceof Error ? error.message : String(error))
        }
        return false
      }
    }
    return sendSideMessage(request.ownerSessionId, prompt, {
      mode: request.mode,
      displayText: v || t('composerFileOnlyDisplay', { count: fileReferences.length }),
      ...(fileReferences.length ? { fileReferences } : {})
    })
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
    const ownerSessionId = activeThreadId
    if (!ownerSessionId) return
    const snapshot = selectSddDraftSession(useSddDraftStore.getState(), ownerSessionId)
    if (!snapshot) return
    const draft = snapshot.draft
    if (
      sddUpgradeTargetsRef.current[ownerSessionId] ||
      snapshot.operationStatus === 'upgrading'
    ) return
    if (!snapshot.content.trim()) {
      useSddDraftStore.getState().setSessionOperationStatus(
        ownerSessionId,
        'error',
        t('sddEmptyDraftError')
      )
      return
    }
    const chatSnapshot = useChatStore.getState()
    const assistantSession = chatSnapshot.sideConversations[ownerSessionId]
    if (
      assistantSession?.busy ||
      (assistantSession?.blocks ?? chatSnapshot.blocks).some(hasPendingRuntimeWork)
    ) {
      setError(t('composerQueuePlaceholder'))
      return
    }
    if (chatSnapshot.runtimeConnection !== 'ready') {
      setError(t('runtimeActionNeedsConnection'))
      return
    }
    useSddDraftStore.getState().setSessionOperationStatus(ownerSessionId, 'upgrading')
    const saved = await saveSddDraftToDisk(ownerSessionId)
    if (!saved) {
      const latest = selectSddDraftSession(useSddDraftStore.getState(), ownerSessionId)
      useSddDraftStore.getState().setSessionOperationStatus(
        ownerSessionId,
        'error',
        latest?.error
      )
      return
    }

    const latestAfterSave = selectSddDraftSession(useSddDraftStore.getState(), ownerSessionId)
    if (latestAfterSave?.draft.id !== draft.id) {
      return
    }

    const collected = await collectSddDraftImages({
      markdown: latestAfterSave.content,
      draftRelativePath: draft.relativePath,
      workspaceRoot: draft.workspaceRoot
    })
    if (collected.errors.length > 0) {
      useSddDraftStore.getState().setSessionOperationStatus(
        ownerSessionId,
        'error',
        collected.errors.join('\n')
      )
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
        const uploaded = await uploadSddImagesAsAttachments(
          collected.images,
          ownerSessionId,
          draft.workspaceRoot
        )
        imagesForPrompt = uploaded.images
        attachmentIds = uploaded.attachmentIds
        imageMode = 'attachments'
      } catch (error) {
        useSddDraftStore.getState().setSessionOperationStatus(
          ownerSessionId,
          'error',
          error instanceof Error ? error.message : String(error)
        )
        return
      }
    }

    const latestSession = selectSddDraftSession(useSddDraftStore.getState(), ownerSessionId)
    if (latestSession?.draft.id !== draft.id) return
    const latestDraftContent = latestSession.content
    const planRelativePath = sddDraftPlanRelativePath(draft)
    const planId = buildGuiPlanId(draft.workspaceRoot, planRelativePath)
    const sourceRequest = sddDraftSourceRequest(latestDraftContent, draft.relativePath)
    const assistantContext = sddAssistantContextFromBlocks(
      useChatStore.getState().sideConversations[ownerSessionId]?.blocks ?? blocks
    )
    const prompt = buildSddDraftToPlanPrompt({
      draftMarkdown: latestDraftContent,
      draftRelativePath: draft.relativePath,
      planRelativePath,
      assistantContext,
      workspaceRoot: draft.workspaceRoot,
      images: imagesForPrompt,
      imageMode
    })
    sddUpgradeTargetsRef.current[ownerSessionId] = {
      planId,
      relativePath: planRelativePath,
      workspaceRoot: draft.workspaceRoot
    }
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
      delete sddUpgradeTargetsRef.current[ownerSessionId]
      useSddDraftStore.getState().setSessionOperationStatus(ownerSessionId, 'idle')
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
      return provider.listWorkspaceReferences(withActiveWorkspaceLocator(input))
    },
    readWorkspaceFile: (input) =>
      window.sciforge.readWorkspaceFile(withActiveWorkspaceLocator(input))
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
    const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
    const isImageGenerationIntent = intent?.kind === 'image-generation'
    if (!v && attachmentIds.length === 0 && fileReferences.length === 0) return
    const emptyPrompt =
      fileReferences.length > 0 && attachmentIds.length > 0
        ? t('composerFileAndImageOnlyPrompt')
        : fileReferences.length > 0
          ? t('composerFileOnlyPrompt')
          : t('composerImageOnlyPrompt')
    const emptyDisplayText = v
      ? undefined
      : fileReferences.length > 0 && attachmentIds.length > 0
        ? t('composerFileAndImageOnlyDisplay', { count: fileReferences.length })
        : fileReferences.length > 0
          ? t('composerFileOnlyDisplay', { count: fileReferences.length })
          : t('composerImageOnlyDisplay')
    const messageText = v || emptyPrompt
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
      const contextController = new AbortController()
      let contributedContext = ''
      try {
        const results = await Promise.all(
          installedRendererContributions.composerContexts.list().map(
            ({ contribution }) => contribution.provide({
              ...(activeThreadId ? { sessionId: activeThreadId } : {}),
              ...(activeThread?.runtimeId ? { runtimeId: activeThread.runtimeId } : {}),
              ...(activeWorkspaceReferenceRoot
                ? { workspaceRoot: activeWorkspaceReferenceRoot }
                : {}),
              draftText: v,
              signal: contextController.signal
            })
          )
        )
        contributedContext = results.flatMap(({ items }) => items)
          .map(({ content }) => content.trim())
          .filter(Boolean)
          .join('\n\n')
      } catch (error) {
        contextController.abort()
        setError(error instanceof Error ? error.message : String(error))
        return null
      }
      const withContributedContext = (text: string): string =>
        contributedContext ? `${text}\n\n${contributedContext}` : text
      if (fileReferences.length === 0) {
        return {
          text: withContributedContext(preparedRuntimeMessageText),
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
          text: withContributedContext(
            buildComposerFileContextPrompt(preparedRuntimeMessageText, fileContext)
          ),
          ...(userVisibleText ? { displayText: userVisibleText } : {})
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
        return null
      }
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
      void sendPlanTurn(prepared.text, {
        ...(prepared.displayText ? { displayText: prepared.displayText } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(selectedWorkspaceLocator ? { workspaceLocator: selectedWorkspaceLocator } : {}),
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
    void sendMessage(prepared.text, isImageGenerationIntent ? 'agent' : mode === 'plan' ? 'plan' : 'agent', {
      ...(prepared.displayText ? { displayText: prepared.displayText } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(selectedWorkspaceLocator ? { workspaceLocator: selectedWorkspaceLocator } : {}),
      ...(attachmentIds.length ? { attachmentIds, attachments } : {}),
      ...(fileReferences.length ? { fileReferences } : {})
    })
  }

  const openThread = (id: string, runtimeId?: AgentRuntimeId): void => {
    void (async () => {
      const thread = threads.find((item) => item.id === id) ?? null
      if (await openSddRequirementDraftFromSidebarThread(id, thread)) {
        setConnectPhonePanelOpen(false)
        return
      }
      setConnectPhonePanelOpen(false)
      setRoute('chat')
      getProvider().rememberThreadRuntime?.(id, runtimeId)
      await selectThread(id)
    })()
  }

  const startNewChat = (): void => {
    setConnectPhonePanelOpen(false)
    setRoute('chat')
    void createThread({ forceNew: true })
  }

  const startNewChatInWorkspace = (workspaceRoot: string): void => {
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

  const toggleConnectPhone = (): void => {
    if (connectPhonePanelOpen) {
      setConnectPhonePanelOpen(false)
    } else {
      openConnectPhone()
    }
  }

  const sidebarView: 'chat' | 'schedule' = route === 'schedule' ? 'schedule' : 'chat'

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

  const createSessionRightPanelRenderer = (
    snapshot: SessionRightPanelRenderSnapshot
  ): SessionRightPanelRenderer => (
    workspace,
    active
  ) => {
    const ownerSessionId = workspace.sessionId
    const workspaceMode = workspace.mode
    const installedRightPanel = installedRightPanels.find(
      ({ id }) => id === workspaceMode
    )?.contribution
    const ownerFilePreviewTarget = workspace.filePreviewTarget
    const ownerFilePreviewReturnContext = workspace.filePreviewReturnContext
    const ownerThread = threads.find((thread) => thread.id === ownerSessionId) ?? snapshot.thread
    const ownerWorkspaceRoot = ownerThread?.workspace || snapshot.workspaceRoot
    const ownerStatus = ownerThread?.status?.toLowerCase()
    const ownerBusy = active
      ? busy
      : ownerStatus === 'running' ||
        ownerStatus === 'streaming' ||
        ownerStatus === 'busy' ||
        ownerStatus === 'queued'
    const closeOwnerRightPanel = (): void => {
      updateRightPanelWorkspace(ownerSessionId, {
        mode: null,
        filePreviewTarget: null,
        filePreviewReturnContext: null
      })
    }
    const closeOwnerFilePreview = (): void => {
      if (ownerFilePreviewReturnContext?.kind === 'domain-right-panel') {
        const registered = installedRightPanels.find(
          ({ id }) => id === ownerFilePreviewReturnContext.contributionId
        )
        updateRightPanelWorkspace(ownerSessionId, {
          filePreviewTarget: null,
          filePreviewReturnContext: null,
          mode: registered?.id ?? null,
          panelActivation: registered ? ownerFilePreviewReturnContext.activation ?? null : null
        })
        return
      }
      updateRightPanelWorkspace(ownerSessionId, { filePreviewTarget: null })
    }
    const previewOwnerWorkspaceReference = (reference: AgentRuntimeWorkspaceReference): void => {
      if (reference.kind === 'directory') return
      updateRightPanelWorkspace(ownerSessionId, {
        filePreviewReturnContext: null,
        filePreviewTarget: {
          path: reference.relativePath,
          workspaceRoot: reference.workspaceRoot || ownerWorkspaceRoot
        },
        mode: 'file'
      })
    }
    const openOwnerFileTreeDirectory = (target: { workspaceRoot: string; path: string }): void => {
      const nextWorkspaceRoot = normalizeWorkspaceRoot(target.workspaceRoot || ownerWorkspaceRoot)
      updateRightPanelWorkspace(ownerSessionId, {
        fileTreeWorkspaceOverride: nextWorkspaceRoot || null,
        fileTreeInitialDirectory: {
          workspaceRoot: nextWorkspaceRoot,
          path: relativeWorkspacePath(target.path, nextWorkspaceRoot),
          nonce: Date.now()
        },
        filePreviewReturnContext: null,
        filePreviewTarget: null,
        mode: 'file'
      })
    }
    const ownerFileTreeWorkspaceRoot = workspace.fileTreeWorkspaceOverride || ownerWorkspaceRoot
    const ownerFileTreeWorkspaceGroups = workspace.fileTreeWorkspaceOverride
      ? [{
          id: `workspace:${workspace.fileTreeWorkspaceOverride}`,
          label: t('rightPanelFiles'),
          workspaceRoot: workspace.fileTreeWorkspaceOverride,
          kind: 'worktree' as const
        }]
      : snapshot.workspaceReferenceGroups
    return (
        <div className="flex h-full min-h-0 flex-col bg-ds-sidebar">
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
              {workspaceMode ? t(rightPanelVisibleContextTitle(workspaceMode)) : ''}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
            {workspaceMode === 'file' ? (
              <div className="relative h-full max-h-full w-full overflow-hidden">
                <ChatFileTreePanel
                  workspaceRoot={ownerFileTreeWorkspaceRoot}
                  workspaceGroups={ownerFileTreeWorkspaceGroups}
                  selectedPath={ownerFilePreviewTarget?.path}
                  initialDirectory={workspace.fileTreeInitialDirectory}
                  selectedReferences={snapshot.composerFileReferences}
                  className={`h-full max-h-full w-full ${ownerFilePreviewTarget ? 'hidden' : ''}`}
                  onPreviewFile={previewOwnerWorkspaceReference}
                  onAddReference={addComposerFileReference}
                  onCollapse={closeOwnerRightPanel}
                />
                {ownerFilePreviewTarget ? (
                  <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
                    <div className="flex h-full min-h-0 flex-col">
                      {ownerFilePreviewReturnContext?.kind === 'domain-right-panel' ? (
                        <div className="shrink-0 border-b border-ds-border bg-ds-sidebar px-2 py-1.5">
                          <button
                            type="button"
                            className="inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                            onClick={closeOwnerFilePreview}
                          >
                            <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{t('workspacePreviewReturnToReview', {
                              label: ownerFilePreviewReturnContext.label ||
                                installedRightPanels.find(
                                  ({ id }) => id === ownerFilePreviewReturnContext.contributionId
                                )?.contribution.title ||
                                t('rightPanelFiles')
                            })}</span>
                          </button>
                        </div>
                      ) : null}
                      <div className="min-h-0 flex-1">
                        <WorkspaceFilePreviewPanelBridge
                          target={ownerFilePreviewTarget}
                          workspaceRoot={ownerFilePreviewTarget.workspaceRoot || ownerFileTreeWorkspaceRoot}
                          sessionId={ownerSessionId}
                          active={active}
                          className="h-full max-h-full w-full"
                          annotationQuestionBridge={annotationQuestionBridge}
                          onClose={closeOwnerFilePreview}
                          onOpenDirectory={openOwnerFileTreeDirectory}
                          onOpenFile={(nextTarget) => {
                            updateRightPanelWorkspace(ownerSessionId, {
                              filePreviewTarget: nextTarget,
                              mode: 'file'
                            })
                          }}
                        />
                      </div>
                    </div>
                  </Suspense>
                ) : null}
              </div>
            ) : workspaceMode === 'sdd-ai' ? (
              <SessionSddAssistantPanel
                ownerSessionId={ownerSessionId}
                title={t('sddAssistant')}
                runtimeId={ownerThread?.runtimeId}
                runtimeCapabilities={runtimeCapabilities}
                onSend={sendSddAssistantPrompt}
                onPreviewFileReference={(_sessionId, reference) => {
                  previewOwnerWorkspaceReference({
                    workspaceRoot: reference.workspaceRoot || ownerWorkspaceRoot,
                    relativePath: reference.relativePath,
                    name: reference.name,
                    kind: reference.kind ?? 'file',
                    ...(reference.mimeType ? { mimeType: reference.mimeType } : {})
                  })
                }}
                onNewConversation={(sessionId, draft) => {
                  const current = selectSddDraftSession(useSddDraftStore.getState(), sessionId)
                  if (!current || current.draft.id !== draft.id) return
                  void createSddAssistantThreadForDraft(draft).then((newSessionId) => {
                    if (!newSessionId) return
                    useSddDraftStore.getState().setSessionDraft(
                      newSessionId,
                      draft,
                      current.content,
                      {
                        lastSavedContent: current.lastSavedContent,
                        saveStatus: current.saveStatus
                      }
                    )
                    updateRightPanelWorkspace(newSessionId, { mode: 'sdd-ai', width: 420 })
                  })
                }}
                onCollapse={closeOwnerRightPanel}
                className="h-full max-h-full w-full"
              />
            ) : workspaceMode === 'child-agents' ? (
              <SessionChildAgentsPanel
                sessionId={ownerSessionId}
                thread={ownerThread ?? null}
                busy={ownerBusy}
                focusChildId={workspace.childPanelFocusRequest.childId}
                focusChildRequestKey={workspace.childPanelFocusRequest.key}
                onOpenChildInFocus={(child) => { void openChildInFocus(child) }}
                className="h-full max-h-full w-full"
                onCollapse={closeOwnerRightPanel}
              />
            ) : workspaceMode === 'todo' ? (
              <TodoPanel
                threadId={ownerSessionId}
                className="h-full max-h-full w-full"
                onCollapse={closeOwnerRightPanel}
                onOpenPlan={openGuiPlanPanel}
              />
            ) : installedRightPanel ? (
              installedRightPanel.render({
                active,
                className: 'h-full max-h-full w-full',
                onCollapse: closeOwnerRightPanel,
                session: {
                  id: ownerSessionId,
                  ...(ownerThread?.runtimeId ? { runtimeId: ownerThread.runtimeId } : {}),
                  ...(ownerWorkspaceRoot ? { workspaceRoot: ownerWorkspaceRoot } : {})
                },
                ...(workspace.panelActivation?.contributionId === installedRightPanel.id
                  ? { activation: workspace.panelActivation }
                  : {})
              })
            ) : workspaceMode === 'plan' ? (
              <PlanPanel
                workspaceRoot={ownerWorkspaceRoot}
                ownerSessionId={ownerSessionId}
                runtimeReady={runtimeConnection === 'ready'}
                busy={ownerBusy}
                className="h-full max-h-full w-full"
                onCollapse={closeOwnerRightPanel}
                onBuildPlan={() => void buildGuiPlan()}
                onVerifyPlan={() => void verifyGuiPlan()}
                onReplanChanged={(changedIds) => void replanChangedRequirements(changedIds)}
              />
            ) : null}
            </Suspense>
          </div>
        </div>
    )
  }

  const sessionRightPanelRenderers = new Map<string, SessionRightPanelRenderer>()
  for (const workspace of rightPanelWorkspaces) {
    const active = workspace.sessionId === rightPanelOwnerId
    const previousSnapshot = sessionRightPanelSnapshotsRef.current.get(workspace.instanceKey)
    const liveThread = threads.find((thread) => thread.id === workspace.sessionId) ?? null
    const ownerBlocks = active
      ? blocks
      : threadBlocksById[workspace.sessionId] ?? previousSnapshot?.blocks ?? []
    const snapshot: SessionRightPanelRenderSnapshot = {
      thread: liveThread ?? (active ? activeThread : previousSnapshot?.thread ?? null),
      blocks: ownerBlocks,
      workspaceRoot: active
        ? workspaceRoot
        : liveThread?.workspace || previousSnapshot?.workspaceRoot || '',
      workspaceReferenceGroups: active
        ? workspaceReferenceGroups
        : previousSnapshot?.workspaceReferenceGroups ?? [],
      composerFileReferences: active
        ? composerFileReferences
        : previousSnapshot?.composerFileReferences ?? []
    }
    sessionRightPanelSnapshotsRef.current.set(workspace.instanceKey, snapshot)
    sessionRightPanelRenderers.set(
      workspace.instanceKey,
      createSessionRightPanelRenderer(snapshot)
    )
  }
  const residentInstanceKeys = new Set(rightPanelWorkspaces.map((workspace) => workspace.instanceKey))
  for (const instanceKey of sessionRightPanelSnapshotsRef.current.keys()) {
    if (!residentInstanceKeys.has(instanceKey)) {
      sessionRightPanelSnapshotsRef.current.delete(instanceKey)
    }
  }

  const renderRightPanel = (): ReactElement | null => {
    const hasResidentPanel = rightPanelWorkspaces.some((workspace) => workspace.mode !== null)
    if (!hasResidentPanel) return null
    return (
      <>
        {rightPanelVisible ? (
          <div
            role="separator"
            aria-orientation="vertical"
            className="ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize"
            onPointerDown={beginRightResize}
          />
        ) : null}
        <div
          className={rightPanelVisible
            ? 'h-full min-h-0 shrink-0 bg-ds-sidebar'
            : 'pointer-events-none fixed h-0 w-0 overflow-hidden invisible'}
          style={rightPanelVisible ? { width: rightSidebarWidth } : undefined}
          aria-hidden={!rightPanelVisible}
        >
          <SessionRightPanelStack
            activeSessionId={rightPanelVisible ? rightPanelOwnerId : null}
            workspaces={rightPanelWorkspaces}
            renderWorkspace={(workspace, active) =>
              sessionRightPanelRenderers.get(workspace.instanceKey)?.(workspace, active) ?? null
            }
          />
        </div>
      </>
    )
  }

  return (
    <div
      ref={shellRef}
      className="ds-workbench-shell flex h-full min-h-0 w-full min-w-0 bg-ds-main"
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
      {activeGlobalOverlay && (globalOverlay?.sessionId || rightPanelOwnerId) ? (
        activeGlobalOverlay.contribution.render({
          active: true,
          className: 'fixed inset-0',
          session: {
            id: globalOverlay?.sessionId || rightPanelOwnerId!,
            ...(activeThread?.runtimeId ? { runtimeId: activeThread.runtimeId } : {}),
            ...(activeWorkspaceReferenceRoot
              ? { workspaceRoot: activeWorkspaceReferenceRoot }
              : {})
          },
          ...(globalOverlay?.activation
            ? { activation: globalOverlay.activation }
            : {}),
          onClose: () => setGlobalOverlay(null)
        })
      ) : null}
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
        className={`ds-stage-surface relative flex min-h-0 min-w-0 flex-1 flex-col ${
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
        ) : (
          <>
        {error && !(runtimeConnection !== 'ready' && !activeThreadId) ? renderRuntimeBanner(error, runtimeErrorDetail) : null}

        <div className="flex min-h-0 flex-1">
          <div className={`flex min-h-0 min-w-0 flex-1 ${activeSddDraft ? '' : stageInsetClass}`}>
          {activeSddDraft ? (
            <SddDraftEditorView
              ownerSessionId={activeSddSession!.ownerSessionId}
              leftSidebarCollapsed={leftSidebarCollapsed}
              assistantOpen={rightPanelMode === 'sdd-ai'}
              onToggleLeftSidebar={toggleLeftSidebar}
              onToggleAssistant={() => void toggleSddAssistantPanel()}
              onNext={() => void handleSddNextStep()}
              onClose={() => {
                if (activeThreadId) dismissSddDraft(activeThreadId, { closeAssistant: true })
              }}
              nextDisabled={busy || runtimeConnection !== 'ready' || sddDraftOperationStatus === 'upgrading'}
            />
          ) : (
            <section className="ds-chat-stage flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="chat-topbar ds-topbar-surface ds-drag relative z-10 mt-3 flex min-h-[46px] w-full shrink-0 items-stretch overflow-visible rounded-[24px]">
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
                  {!remoteGuardChannel ? <RemoteWorkspaceSelector /> : null}
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
                    toolbarActions={installedToolbarActions}
                    toolbarCommandInvocation={toolbarCommandInvocation}
                    onExecuteToolbarCommand={(commandId) => {
                      void installedRendererContributions.commands.execute(
                        commandId,
                        toolbarCommandInvocation
                      )
                    }}
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
                    runtimeLocked={modelAccessMode === 'coding-plan'}
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
                    queuedMessages={activeQueuedMessages}
                    queuedMessagesPersistenceDegraded={chatSessionPersistenceDegraded}
                    onRemoveQueuedMessage={removeQueuedMessage}
                    onEditQueuedMessage={(id, text) => void updateQueuedMessage(id, text)}
                    onSteerQueuedMessage={(id) => void steerQueuedMessage(id)}
                    onRetryQueuedMessage={(id) => void retryQueuedMessage(id)}
                    onInterrupt={(options) => void interrupt(options)}
                    onPlanCommand={() => void handleGuiPlanCommand()}
                    onReviewCommand={(target) => void reviewActiveThread(target)}
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
                {activeBottomPanel && rightPanelOwnerId ? (
                  <div className="ds-no-drag flex w-full shrink-0 flex-col px-0 pb-0">
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      className="relative z-20 h-1 shrink-0 cursor-row-resize bg-transparent transition hover:bg-ds-border-muted"
                      onPointerDown={beginBottomPanelResize}
                    />
                    <Suspense fallback={<div className="ds-surface-strong h-full w-full" />}>
                      {activeBottomPanel.contribution.render({
                        active: true,
                        activation: bottomPanelActivation,
                        className: 'w-full',
                        height: bottomPanelHeight,
                        onCollapse: closeBottomPanel,
                        session: {
                          id: rightPanelOwnerId,
                          ...(activeThread?.runtimeId
                            ? { runtimeId: activeThread.runtimeId }
                            : {}),
                          ...(activeWorkspaceReferenceRoot
                            ? { workspaceRoot: activeWorkspaceReferenceRoot }
                            : {})
                        }
                      })}
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
    </div>
  )
}

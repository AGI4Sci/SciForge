import type { ReactElement } from 'react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Bot } from 'lucide-react'
import { parseClawCommand } from '@shared/claw-commands'
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
import type { AgentRuntimeId, ClawImChannelV1 } from '@shared/app-settings'
import type { ClipboardImageReadResult } from '@shared/workspace-file'
import type { AgentRuntimeWorkspaceReference } from '@shared/agent-runtime-contract'
import type { AgentProviderCapabilities, AttachmentReference, ChatBlock } from '../agent/types'
import type { LocalRuntimeInfoJson, LocalRuntimeSkillJson } from '../agent/local-runtime-contract'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useChatStore } from '../store/chat-store'
import {
  clawThreadRemoteBindingsFromChannels,
  deriveClawThreadRemoteStatusKind,
  isClawThread
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
import type { TimelineImageCanvasArtifact } from './chat/message-timeline-media'
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
import { ChildAgentsPanel, useThreadChildren } from './chat/ChildAgentsPanel'
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
import { buildSddDraftId, createSddDraft, forgetRememberedSddDraft, useSddDraftStore } from '../sdd/sdd-draft-store'
import type { SddDraft, SddDraftSaveStatus } from '../sdd/sdd-draft-store'
import { saveActiveSddDraftToDisk } from '../sdd/sdd-draft-actions'
import { restoreRememberedSddDraft, restoreSddDraft } from '../sdd/sdd-draft-restore'
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
import { CODE_PANEL_PREFERRED, useWorkbenchLayout } from './workbench-layout'
import { useWorkbenchPlanController } from './workbench-plan-controller'
import { prepareImageAttachmentUpload } from '../lib/image-attachment-upload'
import { isChatAttachmentUploadEnabled } from '../lib/attachment-upload-availability'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import {
  buildImageGenerationDisplayText,
  buildImageGenerationWorkflowPrompt
} from '../lib/image-generation-chat'
import { useKeyboardShortcutSettings } from '../lib/keyboard-shortcut-settings'
import {
  isPluginInstalled,
  PAPER_RADAR_EXTENSION_ID
} from '../lib/plugin-install-state'
import { providerSupportsCapability } from '../store/chat-store-provider-capabilities'
import { collectComposerChangeSummary } from '../lib/composer-change-summary'
import {
  createRemoteChannelTaskFromTextApi,
  mirrorRemoteChannelMessageApi,
  updateRemoteChannelActiveThreadContextApi
} from '../lib/remote-channel-api'
import {
  buildComposerFileContextPrompt,
  composerFileReferenceKey,
  mergeComposerFileReferences,
  relativeWorkspacePath,
} from '../lib/composer-file-references'
import { readComposerFileContextEntries as readComposerFileContextEntriesFromReferences } from '../lib/composer-file-context'
import { buildWorkspaceReferenceGroups } from '../lib/workspace-reference-groups'
import type { FigureStylePanelPage } from './figure-style/figure-style-panel-state'

const ChangeInspector = lazy(() =>
  import('./ChangeInspector').then((module) => ({ default: module.ChangeInspector }))
)
const DevBrowserPanel = lazy(() =>
  import('./DevBrowserPanel').then((module) => ({ default: module.DevBrowserPanel }))
)
const EvidenceDagPanel = lazy(() =>
  import('./evidence/EvidenceDagPanel').then((module) => ({ default: module.EvidenceDagPanel }))
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
const WorkspaceFilePreviewPanel = lazy(() =>
  import('./WorkspaceFilePreviewPanel').then((module) => ({
    default: module.WorkspaceFilePreviewPanel
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
const FigureStylePanel = lazy(() =>
  import('./figure-style/FigureStylePanel').then((module) => ({ default: module.FigureStylePanel }))
)

const CANVAS_DISPLAY_IMAGE_PATH_RE = /\.(?:png|jpe?g|webp|svg)(?:[?#].*)?$/i
const PPTX_PATH_RE = /\.pptx(?:[?#].*)?$/i

function isCanvasDisplayImagePath(value: string | undefined): boolean {
  return Boolean(value?.trim() && CANVAS_DISPLAY_IMAGE_PATH_RE.test(value.trim()))
}

function isPptxPath(value: string | undefined): boolean {
  return Boolean(value?.trim() && PPTX_PATH_RE.test(value.trim()))
}

function normalizeCanvasArtifactPath(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized.replace(/\\/g, '/').replace(/\/+$/g, '') : null
}

function snapshotContainsCanvasArtifact(
  snapshot: unknown,
  candidates: string[],
  options?: { requireDisplayPreview?: boolean }
): boolean {
  const wanted = new Set(candidates.map(normalizeCanvasArtifactPath).filter((value): value is string => Boolean(value)))
  if (wanted.size === 0 || !snapshot || typeof snapshot !== 'object') return false
  const store = (snapshot as { store?: unknown }).store
  if (!store || typeof store !== 'object') return false
  for (const record of Object.values(store as Record<string, unknown>)) {
    if (!record || typeof record !== 'object') continue
    const meta = (record as { meta?: unknown }).meta
    if (!meta || typeof meta !== 'object') continue
    const artifact = (meta as { sciforgeArtifact?: unknown }).sciforgeArtifact
    if (!artifact || typeof artifact !== 'object') continue
    for (const key of ['outputPath', 'sourcePath', 'previewPath', 'renderedPagePath', 'manifestPath', 'svgPath', 'pptxPath']) {
      const normalized = normalizeCanvasArtifactPath((artifact as Record<string, unknown>)[key] as string | undefined)
      if (!normalized || !wanted.has(normalized)) continue
      if (!options?.requireDisplayPreview) return true
      const artifactRecord = artifact as Record<string, unknown>
      const previewCandidates = [
        artifactRecord.previewPath as string | undefined,
        artifactRecord.renderedPagePath as string | undefined,
        artifactRecord.svgPath as string | undefined,
        artifactRecord.outputPath as string | undefined,
        artifactRecord.sourcePath as string | undefined
      ]
      const hasDisplayPreview = previewCandidates.some((path) => {
        if (!normalizeCanvasArtifactPath(path)) return false
        return artifactRecord.artifactKind === 'ppt_export' ? isCanvasDisplayImagePath(path) : true
      })
      if (hasDisplayPreview && (meta as { sciforgeCanvasPlaceholder?: unknown }).sciforgeCanvasPlaceholder !== true) return true
    }
  }
  return false
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
  channel: ClawImChannelV1
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
    selectThread,
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
    clawChannels,
    activeClawChannelId,
    activeRemoteChannelId,
    remoteTargetId,
    selectClawChannel,
    resetClawChannelSession,
    setClawChannelModel,
    appendLocalClawTurn,
    setError,
    sendMessage,
    reviewActiveThread,
    queuedMessages,
    watchTurnCompletion,
    unreadThreadIds,
    removeQueuedMessage,
    steerQueuedMessage,
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
      selectThread: s.selectThread,
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
      clawChannels: s.clawChannels,
      activeClawChannelId: s.activeClawChannelId,
      activeRemoteChannelId: s.activeRemoteChannelId,
      remoteTargetId: s.remoteTargetId,
      selectClawChannel: s.selectClawChannel,
      resetClawChannelSession: s.resetClawChannelSession,
      setClawChannelModel: s.setClawChannelModel,
      appendLocalClawTurn: s.appendLocalClawTurn,
      setError: s.setError,
      sendMessage: s.sendMessage,
      reviewActiveThread: s.reviewActiveThread,
      queuedMessages: s.queuedMessages,
      watchTurnCompletion: s.watchTurnCompletion,
      unreadThreadIds: s.unreadThreadIds,
      removeQueuedMessage: s.removeQueuedMessage,
      steerQueuedMessage: s.steerQueuedMessage,
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
      openSideConversationDraft: s.openSideConversationDraft,
      selectSideConversation: s.selectSideConversation,
      setSidePanelOpen: s.setSidePanelOpen,
      childRefreshKey: s.childRefreshKey,
      sideConversations: s.sideConversations,
      sidePanel: s.sidePanel,
      codeWorkspaceRoots: s.codeWorkspaceRoots
    }))
  )
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
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false)
  const [attachmentUploadError, setAttachmentUploadError] = useState<string | null>(null)
  const [runtimeLogPath, setRuntimeLogPath] = useState('')
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
  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? null,
    [activeClawChannelId, clawChannels]
  )
  const activeRemoteChannel = useMemo(
    () => activeRemoteChannelId
      ? clawChannels.find((channel) => channel.id === activeRemoteChannelId) ?? null
      : null,
    [activeRemoteChannelId, clawChannels]
  )
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads]
  )
  const remoteThreadBindings = useMemo(
    () => clawThreadRemoteBindingsFromChannels(clawChannels),
    [clawChannels]
  )
  const queuedThreadIds = useMemo(
    () => new Set(queuedMessages.map((message) => message.threadId?.trim() ?? '').filter(Boolean)),
    [queuedMessages]
  )
  const activeRemoteBinding = activeThreadId
    ? remoteThreadBindings.get(activeThreadId) ?? null
    : null
  const activeThreadIsRemoteChannel = Boolean(
    activeRemoteBinding ||
    (activeThread && isClawThread(activeThread, clawChannels))
  )
  const selectedRemoteTargetId =
    route === 'chat' && !activeThreadIsRemoteChannel ? remoteTargetId?.trim() ?? '' : ''
  const activeRemoteComposerChannel = activeRemoteBinding
    ? clawChannels.find((channel) => channel.id === activeRemoteBinding.channelId) ?? activeClawChannel
    : activeClawChannel
  const activeRemoteComposerChannelId = activeRemoteComposerChannel?.id ?? activeClawChannelId
  const activeRemoteStatusKind = activeThreadId
    ? deriveClawThreadRemoteStatusKind({
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
    if (!activeThreadId || (activeThread && isClawThread(activeThread, clawChannels))) {
      void updateRemoteChannelActiveThreadContext(null).catch(() => undefined)
      return
    }
    void updateRemoteChannelActiveThreadContext({
      threadId: activeThreadId,
      runtimeId: activeThread?.runtimeId,
      workspaceRoot: activeThread?.workspace || workspaceRoot || undefined
    }).catch(() => undefined)
  }, [activeThread, activeThreadId, clawChannels, route, workspaceRoot])
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
    activeThreadId,
    activeRuntimeId: activeThread?.runtimeId,
    childRefreshKey,
    runtimeReady: runtimeConnection === 'ready',
    busy
  })
  const childAgentCount = threadChildrenState.children.length
  const childAgentRunningCount = threadChildrenState.children.reduce(
    (count, child) => count + (child.status === 'running' || child.status === 'queued' ? 1 : 0),
    0
  )
  const {
    beginLeftResize,
    beginRightResize,
    beginTerminalResize,
    filePreviewTarget,
    leftSidebarCollapsed,
    leftSidebarWidth,
    openDevPreview,
    rightPanelMode,
    rightPanelVisible,
    rightSidebarWidth,
    setFilePreviewTarget,
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
    workspaceRoot
  })
  const [fileTreeInitialDirectory, setFileTreeInitialDirectory] = useState<FileTreeInitialDirectory | null>(null)
  const [figureStylePanelRequest, setFigureStylePanelRequest] = useState<{
    page: FigureStylePanelPage
    refreshKey: number
    canvasId?: string
    workspaceRoot?: string
    focusShapeId?: string
  } | null>(null)
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
  const activeSciforgeCanvasId = activeThreadId ? `thread-${activeThreadId}` : undefined

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
      !isClawThread(thread, clawChannels) &&
      !isSddAssistantThread(thread) &&
      !isEmptySddAssistantThreadCandidate(thread)
    ),
    [clawChannels, threads]
  )

  const mirrorClawCommand = async (userText: string, replyText: string): Promise<void> => {
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

  const clawHelpText = (): string =>
    [
      t('clawHelpTitle'),
      '',
      `- \`/help\`: ${t('clawHelpCommandHelp')}`,
      `- \`/new\`: ${t('clawHelpCommandNew')}`,
      `- \`/model auto\`: ${t('clawHelpCommandModelAuto')}`,
      `- \`/model pro\`: ${t('clawHelpCommandModelPro')}`,
      `- \`/model flash\`: ${t('clawHelpCommandModelFlash')}`,
      `- \`/model\`: ${t('clawHelpCommandModelShow')}`
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
    setFilePreviewTarget({
      path,
      workspaceRoot: reference.workspaceRoot || activeWorkspaceReferenceRoot || workspaceRoot
    })
    setRightPanelMode('file')
  }

  const openFileTreeDirectory = (target: { workspaceRoot: string; path: string }): void => {
    const nextWorkspaceRoot = normalizeWorkspaceRoot(
      target.workspaceRoot || activeWorkspaceReferenceRoot || workspaceRoot
    )
    const hasKnownWorkspaceGroup = workspaceReferenceGroups.some(
      (group) => normalizeWorkspaceRoot(group.workspaceRoot) === nextWorkspaceRoot
    )
    setFileTreeWorkspaceOverride(hasKnownWorkspaceGroup ? null : nextWorkspaceRoot)
    setFileTreeInitialDirectory((current) => ({
      workspaceRoot: nextWorkspaceRoot,
      path: target.path,
      nonce: (current?.nonce ?? 0) + 1
    }))
    setFilePreviewTarget(null)
    setRightPanelMode('file')
  }

  const toggleTopBarRightPanelMode = (mode: Exclude<RightPanelMode, null>): void => {
    if (mode === 'file') setFileTreeWorkspaceOverride(null)
    if (mode === 'evidence') setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
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
          // Image: translated to text by the vision model (Qwen) in the model router.
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

  const startNewSddRequirement = async (): Promise<void> => {
    const activeCodeWorkspace = activeThreadId
      ? normalizeWorkspaceRoot(codeThreads.find((thread) => thread.id === activeThreadId)?.workspace ?? '')
      : ''
    let targetWorkspace = activeCodeWorkspace || normalizeWorkspaceRoot(workspaceRoot)
    if (!targetWorkspace) {
      const picked = await chooseWorkspace({ selectThreadAfter: false })
      targetWorkspace = normalizeWorkspaceRoot(picked ?? useChatStore.getState().workspaceRoot)
    }
    if (!targetWorkspace) {
      setError(t('workspaceRequiredToCreateThread'))
      return
    }
    const restored = await restoreRememberedSddDraft({
      workspaceRoot: targetWorkspace,
      readWorkspaceFile: window.sciforge.readWorkspaceFile
    })
    if (restored.kind === 'restored') {
      await openSddRequirementDraft(restored.draft, restored.content, {
        lastSavedContent: restored.lastSavedContent,
        saveStatus: restored.saveStatus
      })
      return
    }

    const draftUuid = globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}`
    const draft = createSddDraft({ id: draftUuid, workspaceRoot: targetWorkspace })
    const initialContent = [
      `# ${t('sddUntitledRequirement')}`,
      '',
      `## ${t('sddTemplateBackground')}`,
      '',
      `## ${t('sddTemplateGoal')}`,
      '',
      `## ${t('sddTemplateAcceptance')}`,
      ''
    ].join('\n')
    const result = await window.sciforge.createWorkspaceFile({
      workspaceRoot: targetWorkspace,
      path: draft.relativePath,
      content: initialContent
    })
    if (!result.ok) {
      setError(result.message)
      return
    }
    const activeDraft = { ...draft, absolutePath: result.path }
    await openSddRequirementDraft(activeDraft, initialContent)
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
      const userVisibleText = isImageGenerationIntent
        ? buildImageGenerationDisplayText(v || emptyDisplayText || messageText)
        : v || emptyDisplayText
      const runtimeMessageText = isImageGenerationIntent
        ? buildImageGenerationWorkflowPrompt(messageText, {
            workspaceRoot: normalizeWorkspaceRoot(activeThread?.workspace || workspaceRoot) || undefined,
            ...(activeSciforgeCanvasId ? { canvasId: activeSciforgeCanvasId } : {}),
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
          text: preparedRuntimeMessageText,
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
          text: buildComposerFileContextPrompt(preparedRuntimeMessageText, fileContext),
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
      const command = parseClawCommand(v)
      if (command?.kind === 'clear') {
        if (!activeRemoteComposerChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        void (async () => {
          await resetClawChannelSession(activeRemoteComposerChannelId)
          const replyText = t('clawNewSessionStarted')
          appendLocalClawTurn(v, replyText)
          await mirrorClawCommand(v, replyText)
        })()
        return
      }
      if (command?.kind === 'help') {
        setInput('')
        const replyText = clawHelpText()
        appendLocalClawTurn(v, replyText)
        void mirrorClawCommand(v, replyText)
        return
      }
      if (command?.kind === 'model') {
        if (!activeRemoteComposerChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        void (async () => {
          await setClawChannelModel(activeRemoteComposerChannelId, command.model)
          const replyText = t('clawModelChanged', { model: command.model })
          appendLocalClawTurn(v, replyText)
          await mirrorClawCommand(v, replyText)
        })()
        return
      }
      if (command?.kind === 'showModel') {
        if (!activeRemoteComposerChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        const replyText = t('clawModelCurrent', {
          model: activeRemoteComposerChannel?.model ?? 'auto'
        })
        appendLocalClawTurn(v, replyText)
        void mirrorClawCommand(v, replyText)
        return
      }
      if (command?.kind === 'invalidModel') {
        setError(t('clawModelCommandHint'))
        return
      }
      if (!activeRemoteComposerChannelId) {
        setError(t('clawNoActiveIm'))
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
          appendLocalClawTurn(v, taskResult.confirmationText)
          await mirrorClawCommand(v, taskResult.confirmationText)
          return
        }
        if (taskResult.kind === 'error') {
          appendLocalClawTurn(v, `Failed to create scheduled task: ${taskResult.message}`)
          return
        }
        if (!activeThreadId) {
          await selectClawChannel(activeRemoteComposerChannelId)
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
    void sendMessage(prepared.text, isImageGenerationIntent ? 'agent' : mode === 'plan' ? 'plan' : 'agent', {
      ...(prepared.displayText ? { displayText: prepared.displayText } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(selectedRemoteTargetId ? { remoteTargetId: selectedRemoteTargetId } : {}),
      ...(attachmentIds.length ? { attachmentIds, attachments } : {}),
      ...(fileReferences.length ? { fileReferences } : {})
    })
  }

  const sendCanvasReviewRequest = async (text: string): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed) return
    setRoute('chat')
    setMode('agent')
    const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
    const sent = await sendMessage(trimmed, 'agent', {
      displayText: trimmed,
      ...(reasoningEffort ? { reasoningEffort } : {})
    })
    if (!sent) setInput(trimmed)
  }

  const openImageArtifactInCanvas = async (artifact: TimelineImageCanvasArtifact): Promise<void> => {
    const root = artifact.workspaceRoot || activeThread?.workspace || workspaceRoot
    const canvasId = activeSciforgeCanvasId || artifact.canvasId
    const sourcePath = artifact.outputPath || artifact.sourcePath || artifact.previewPath || artifact.renderedPagePath || artifact.svgPath || artifact.pptxPath
    if (!root?.trim() || !canvasId || !sourcePath?.trim()) {
      setError(t('canvasArtifactReviewUnavailable'))
      return
    }

    try {
      const opened = await window.sciforge.openSciforgeCanvas({ workspaceRoot: root, canvasId })
      if (!opened.ok) {
        setError(opened.message)
        return
      }
      const candidates = [
        artifact.outputPath,
        artifact.sourcePath,
        artifact.previewPath,
        artifact.renderedPagePath,
        artifact.manifestPath,
        artifact.artifactManifestPath,
        artifact.svgPath,
        artifact.pptxPath
      ]
        .filter((value): value is string => Boolean(value?.trim()))
      let focusShapeId: string | undefined
      if (!snapshotContainsCanvasArtifact(opened.snapshot, candidates, {
        requireDisplayPreview: artifact.artifactKind === 'ppt_export'
      })) {
        const outputPath = artifact.artifactKind === 'ppt_export' && !isCanvasDisplayImagePath(artifact.outputPath)
          ? undefined
          : artifact.outputPath
        const sourceDisplayPath = artifact.artifactKind === 'ppt_export' && !isCanvasDisplayImagePath(artifact.sourcePath)
          ? undefined
          : artifact.sourcePath
        const pptxPath = artifact.pptxPath ||
          (artifact.artifactKind === 'ppt_export'
            ? [artifact.outputPath, artifact.sourcePath, sourcePath].find(isPptxPath)
            : undefined)
        const result = await window.sciforge.insertSciforgeCanvasArtifact({
          workspaceRoot: root,
          canvasId,
          artifactKind: artifact.artifactKind,
          ...(outputPath ? { outputPath } : {}),
          ...(artifact.artifactKind !== 'ppt_export' && !outputPath ? { outputPath: sourcePath } : {}),
          ...(sourceDisplayPath ? { sourcePath: sourceDisplayPath } : {}),
          ...(artifact.previewPath ? { previewPath: artifact.previewPath } : {}),
          ...(artifact.renderedPagePath ? { renderedPagePath: artifact.renderedPagePath } : {}),
          ...(artifact.artifactManifestPath || artifact.manifestPath ? { manifestPath: artifact.artifactManifestPath || artifact.manifestPath } : {}),
          ...(artifact.projectPath ? { projectPath: artifact.projectPath } : {}),
          ...(artifact.svgPath ? { svgPath: artifact.svgPath } : {}),
          ...(pptxPath ? { pptxPath } : {}),
          ...(artifact.slideIndex !== undefined ? { slideIndex: artifact.slideIndex } : {}),
          ...(artifact.title ? { title: artifact.title } : {}),
          ...(artifact.caption ? { caption: artifact.caption } : {}),
          sourceTool: artifact.sourceTool || (artifact.artifactKind === 'ppt_export' || artifact.artifactKind === 'ppt_slide' ? 'ppt_master' : 'image_generation'),
          placement: 'below',
          margin: 56
        })
        if (!result.ok) {
          setError(result.message)
          return
        }
        focusShapeId = result.shapeId
      }
      setFigureStylePanelRequest({ page: 'canvas', refreshKey: Date.now(), canvasId, workspaceRoot: root, focusShapeId })
      setRightSidebarWidth((width) => Math.max(width, 560))
      setRightPanelMode('figure-style')
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
      return
    }
    setRightPanelMode(null)
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
        <div className="h-full min-h-0 shrink-0" style={{ width: rightSidebarWidth }}>
          <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
            {rightPanelMode === 'file' && filePreviewTarget ? (
              <WorkspaceFilePreviewPanel
                target={filePreviewTarget}
                workspaceRoot={filePreviewTarget.workspaceRoot || fileTreeWorkspaceRoot}
                className="h-full max-h-full w-full"
                onClose={() => setFilePreviewTarget(null)}
                onOpenDirectory={openFileTreeDirectory}
              />
            ) : rightPanelMode === 'file' ? (
              <ChatFileTreePanel
                workspaceRoot={fileTreeWorkspaceRoot}
                workspaceGroups={fileTreeWorkspaceGroups}
                selectedPath={filePreviewTarget?.path}
                initialDirectory={fileTreeInitialDirectory}
                selectedReferences={composerFileReferences}
                className="h-full max-h-full w-full"
                onPreviewFile={previewWorkspaceReference}
                onAddReference={addComposerFileReference}
                onCollapse={closeRightPanel}
              />
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
                queuedMessages={queuedMessages}
                removeQueuedMessage={removeQueuedMessage}
                steerQueuedMessage={steerQueuedMessage}
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
                activeThreadId={activeThreadId}
                activeThread={activeThread}
                children={threadChildrenState.children}
                loading={threadChildrenState.loading}
                error={threadChildrenState.error}
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
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
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
            ) : rightPanelMode === 'figure-style' ? (
              <FigureStylePanel
                workspaceRoot={figureStylePanelRequest?.workspaceRoot || activeThread?.workspace || workspaceRoot}
                canvasId={figureStylePanelRequest?.canvasId || activeSciforgeCanvasId}
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
                onCanvasReviewRequest={(text) => {
                  void sendCanvasReviewRequest(text)
                }}
                preferredPage={figureStylePanelRequest?.page}
                canvasRefreshKey={figureStylePanelRequest?.refreshKey}
                canvasFocusShapeId={figureStylePanelRequest?.focusShapeId}
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
      </>
    )
  }

  return (
    <div
      ref={shellRef}
      className="ds-workbench-shell ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main"
    >
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
              onNewRequirement={() => void startNewSddRequirement()}
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
                  {activeRemoteChannel ? (
                    <RemoteGuardSessionHeader channel={activeRemoteChannel} />
                  ) : (
                    <SessionHeader compact className="min-w-0 flex-1" />
                  )}
                  {!activeRemoteChannel && activeRemoteBinding && activeRemoteStatusKind ? (
                    <ActiveRemoteBindingDetails
                      binding={activeRemoteBinding}
                      statusKind={activeRemoteStatusKind}
                      unread={activeRemoteUnread}
                      t={t}
                    />
                  ) : null}
                </div>
                <div className="chat-topbar-actions flex min-w-0 flex-wrap items-center justify-end gap-2 self-start">
                  {!activeRemoteChannel ? <ThreadTargetSelector /> : null}
                  {busy ? (
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
                    childAgentRunningCount={childAgentRunningCount}
                    childAgentsOpen={rightPanelMode === 'child-agents'}
                    sideChatEnabled={
                      Boolean(activeThreadId) && sideConversationsSupported
                    }
                    onOpenChildAgents={() => toggleTopBarRightPanelMode('child-agents')}
                    onOpenSideChat={openSideChat}
                  />
                </div>
              </div>
            </header>
            {activeRemoteChannel ? (
              <RemoteGuardDetailView
                channel={activeRemoteChannel}
                onOpenThread={openThread}
                onOpenSettings={openConnectPhone}
                t={t}
              />
            ) : (
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
                  onOpenImageArtifactInCanvas={openImageArtifactInCanvas}
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
                        void setClawChannelModel(activeRemoteComposerChannelId, modelId)
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
                    queuedMessages={queuedMessages}
                    onRemoveQueuedMessage={removeQueuedMessage}
                    onSteerQueuedMessage={(id) => void steerQueuedMessage(id)}
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

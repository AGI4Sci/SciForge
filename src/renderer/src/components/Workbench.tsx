import type { ReactElement } from 'react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Bot } from 'lucide-react'
import { parseClawCommand } from '@shared/claw-commands'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import { buildGuiPlanId, buildPlanRelativePath, GUI_PLAN_LEGACY_RELATIVE_DIR } from '@shared/gui-plan'
import { sddDraftTraceRelativePath } from '@shared/sdd'
import { buildSddTraceSnapshot } from '@shared/sdd-trace'
import {
  findKeyboardShortcutCommand,
  keyboardEventToShortcut,
  resolveKeyboardShortcutBindings,
  type KeyboardShortcutCommandId
} from '@shared/keyboard-shortcuts'
import type { DesktopCommand, SkillListItem } from '@shared/ds-gui-api'
import type { AgentRuntimeId, ClawImChannelV1 } from '@shared/app-settings'
import type { ClipboardImageReadResult } from '@shared/workspace-file'
import type { AgentProviderCapabilities, AttachmentReference, ChatBlock } from '../agent/types'
import type { CoreRuntimeInfoJson, CoreRuntimeSkillJson } from '../agent/kun-contract'
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
import {
  FloatingComposer,
  type ComposerImageAttachmentInput,
  type ComposerFileReference
} from './chat/FloatingComposer'
import {
  composerReasoningEffortRequestValue,
  type ComposerReasoningEffort
} from './chat/FloatingComposerModelPicker'
import { SideConversationPanel } from './chat/SideConversationPanel'
import {
  RemoteGuardDetailView,
  remoteGuardChannelTitle,
  remoteGuardProviderLabel
} from './chat/RemoteGuardDetailView'
import { SessionHeader } from './SessionHeader'
import { WriteWorkspaceView } from './write/WriteWorkspaceView'
import { WriteAssistantPanel } from './write/WriteAssistantPanel'
import { WriteSidebar } from './write/WriteSidebar'
import { SddAssistantPanel } from './sdd/SddAssistantPanel'
import { SddDraftEditorView } from './sdd/SddDraftEditorView'
import { SidebarTitlebarToggleButton } from './sidebar/SidebarPrimitives'
import { prepareWriteAssistantPrompt, writeAssistantRuntimePayload } from '../write/write-assistant-message'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { isWriteThreadId } from '../write/write-thread-registry'
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
import { useWorkbenchLayout } from './workbench-layout'
import { useWorkbenchPlanController } from './workbench-plan-controller'
import { prepareImageAttachmentUpload } from '../lib/image-attachment-upload'
import { isChatAttachmentUploadEnabled } from '../lib/attachment-upload-availability'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { useKeyboardShortcutSettings } from '../lib/keyboard-shortcut-settings'
import { collectComposerChangeSummary } from '../lib/composer-change-summary'
import {
  buildComposerFileContextPrompt,
  mergeComposerFileReferences,
  relativeWorkspacePath,
  type ComposerFileContextEntry
} from '../lib/composer-file-references'

const ChangeInspector = lazy(() =>
  import('./ChangeInspector').then((module) => ({ default: module.ChangeInspector }))
)
const DevBrowserPanel = lazy(() =>
  import('./DevBrowserPanel').then((module) => ({ default: module.DevBrowserPanel }))
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
const PaperRadarPanel = lazy(() =>
  import('./paper/PaperRadarPanel').then((module) => ({ default: module.PaperRadarPanel }))
)

type PendingSddPlanTarget = {
  planId: string
  relativePath: string
  workspaceRoot: string
}

const COMPOSER_FILE_CONTEXT_MAX_CHARS_PER_FILE = 60_000
const COMPOSER_FILE_CONTEXT_MAX_TOTAL_CHARS = 180_000
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
  if (typeof window === 'undefined' || typeof window.dsGui?.getPathForFile !== 'function') return ''
  try {
    return window.dsGui.getPathForFile(input.file)?.trim() || ''
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
  return {
    path,
    relativePath,
    name: input.file.name || fileNameFromPath(path)
  }
}

function safeScientificUploadSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized.slice(0, 80) || fallback
}

function safeScientificUploadFileName(input: ComposerImageAttachmentInput): string {
  const name = input.file.name || fileNameFromPath(pathForPickedAttachment(input))
  const safe = name.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? 'scientific-data'
  return safeScientificUploadSegment(safe, 'scientific-data').replace(/^\.+/g, '') || 'scientific-data'
}

function scientificAttachmentMimeType(input: ComposerImageAttachmentInput): string {
  const browserType = input.file.type.trim()
  if (browserType && !browserType.startsWith('image/')) return browserType
  return 'text/plain'
}

async function copyScientificAttachmentToWorkspace(
  input: ComposerImageAttachmentInput,
  workspaceRoot: string,
  threadId: string | null
): Promise<ComposerFileReference> {
  if (typeof window === 'undefined' || typeof window.dsGui?.writeWorkspaceFile !== 'function') {
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
  const owner = safeScientificUploadSegment(threadId ?? 'draft', 'draft')
  const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '').slice(0, 15)
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  const name = safeScientificUploadFileName(input)
  const relativePath = `.sciforge/uploads/${owner}/${stamp}-${random}-${name}`
  const result = await window.dsGui.writeWorkspaceFile({
    workspaceRoot,
    path: relativePath,
    content
  })
  if (!result.ok) throw new Error(result.message)
  return {
    path: result.path,
    relativePath: result.path,
    name,
    mimeType: scientificAttachmentMimeType(input),
    modelRouterObject: true
  }
}

function clipComposerFileContext(
  content: string,
  remainingChars: number,
  sourceTruncated: boolean
): { content: string; truncated: boolean; consumed: number } {
  const limit = Math.max(0, Math.min(COMPOSER_FILE_CONTEXT_MAX_CHARS_PER_FILE, remainingChars))
  const clipped = content.slice(0, limit)
  return {
    content: clipped,
    truncated: sourceTruncated || clipped.length < content.length,
    consumed: clipped.length
  }
}

function sddDraftPlanRelativePath(draft: SddDraft): string {
  const parts = draft.relativePath.replaceAll('\\', '/').split('/').filter(Boolean)
  const draftFolder = parts.at(-2)?.trim() || draft.id.split(':').pop()?.trim() || `draft-${Date.now()}`
  if (parts[0] === '.kunsdd' && parts[1] === 'draft') {
    return `${GUI_PLAN_LEGACY_RELATIVE_DIR}/sdd-${draftFolder}.md`
  }
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
  runtimeSkills: CoreRuntimeSkillJson[],
  localSkills: SkillListItem[]
): CoreRuntimeSkillJson[] {
  const merged = new Map<string, CoreRuntimeSkillJson>()
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
    workspaceRoot,
    runtimeConnection,
    setRoute,
    openCode,
    openWrite,
    ensureWriteThreadForWorkspace,
    createWriteThread,
    openSettings,
    openPlugins,
    openSchedule,
    chooseWorkspace,
    clawChannels,
    activeClawChannelId,
    activeRemoteChannelId,
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
    interrupt,
    probeRuntime,
    composerModel,
    composerPickList,
    composerModelGroups,
    setComposerModel,
    setThreadSearch,
    setShowArchivedThreads,
    renameThread,
    archiveThread,
    deleteThread,
    spawnSideConversation,
    openSideConversationDraft,
    selectSideConversation,
    setSidePanelOpen,
    sideConversations,
    sidePanel
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
      workspaceRoot: s.workspaceRoot,
      runtimeConnection: s.runtimeConnection,
      setRoute: s.setRoute,
      openCode: s.openCode,
      openWrite: s.openWrite,
      ensureWriteThreadForWorkspace: s.ensureWriteThreadForWorkspace,
      createWriteThread: s.createWriteThread,
      openSettings: s.openSettings,
      openPlugins: s.openPlugins,
      openSchedule: s.openSchedule,
      chooseWorkspace: s.chooseWorkspace,
      clawChannels: s.clawChannels,
      activeClawChannelId: s.activeClawChannelId,
      activeRemoteChannelId: s.activeRemoteChannelId,
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
      interrupt: s.interrupt,
      probeRuntime: s.probeRuntime,
      composerModel: s.composerModel,
      composerPickList: s.composerPickList,
      composerModelGroups: s.composerModelGroups,
      setComposerModel: s.setComposerModel,
      setThreadSearch: s.setThreadSearch,
      setShowArchivedThreads: s.setShowArchivedThreads,
      renameThread: s.renameThread,
      archiveThread: s.archiveThread,
      deleteThread: s.deleteThread,
      spawnSideConversation: s.spawnSideConversation,
      openSideConversationDraft: s.openSideConversationDraft,
      selectSideConversation: s.selectSideConversation,
      setSidePanelOpen: s.setSidePanelOpen,
      sideConversations: s.sideConversations,
      sidePanel: s.sidePanel
    }))
  )
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'plan' | 'agent'>('agent')
  const [composerReasoningEffort, setComposerReasoningEffort] =
    useState<ComposerReasoningEffort>('max')
  const [assistantReasoningEffort, setAssistantReasoningEffort] =
    useState<ComposerReasoningEffort>('medium')
  const [runtimeInfo, setRuntimeInfo] = useState<CoreRuntimeInfoJson | null>(null)
  const [runtimeSkills, setRuntimeSkills] = useState<CoreRuntimeSkillJson[]>([])
  const [composerAttachments, setComposerAttachments] = useState<AttachmentReference[]>([])
  const [composerFileReferences, setComposerFileReferences] = useState<ComposerFileReference[]>([])
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false)
  const [attachmentUploadError, setAttachmentUploadError] = useState<string | null>(null)
  const [connectPhoneSidebarOpen, setConnectPhoneSidebarOpen] = useState(false)
  const [runtimeLogPath, setRuntimeLogPath] = useState('')
  const writeAssistantOpen = useWriteWorkspaceStore((s) => s.assistantOpen)
  const setWriteAssistantOpen = useWriteWorkspaceStore((s) => s.setAssistantOpen)
  const writeAssistantModel = useWriteWorkspaceStore((s) => s.assistantModel)
  const setWriteAssistantModel = useWriteWorkspaceStore((s) => s.setAssistantModel)
  const activeSddDraft = useSddDraftStore((s) => s.activeDraft)
  const sddDraftOperationStatus = useSddDraftStore((s) => s.operationStatus)
  const writeAssistantPickList = useMemo(() => {
    const ordered = new Set<string>()
    for (const id of DEFAULT_COMPOSER_MODEL_IDS) {
      const normalized = id.trim()
      if (normalized) ordered.add(normalized)
    }
    for (const id of composerPickList) {
      const normalized = id.trim()
      if (normalized) ordered.add(normalized)
    }
    const current = writeAssistantModel.trim()
    if (current) ordered.add(current)
    return [...ordered]
  }, [composerPickList, writeAssistantModel])
  const stageInsetClass = 'ds-stage-inset'
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
  useEffect(() => {
    if (route === 'claw') setRoute('chat')
  }, [route, setRoute])
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
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.dsGui?.updateClawActiveThreadContext !== 'function') return
    if (!activeThreadId || route === 'claw' || (activeThread && isClawThread(activeThread, clawChannels))) {
      void window.dsGui.updateClawActiveThreadContext(null).catch(() => undefined)
      return
    }
    void window.dsGui.updateClawActiveThreadContext({
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
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [activeThreadId, sideConversations]
  )
  const currentSideRunningCount = currentSideConversations.reduce(
    (count, side) => count + (side.busy ? 1 : 0),
    0
  )
  const {
    beginLeftResize,
    beginRightResize,
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
    toggleLeftSidebar,
    toggleRightPanelMode,
  } = useWorkbenchLayout({
    activeThreadId,
    latestAutoOpenDevPreviewUrl,
    latestDevPreviewUrl,
    route,
    workspaceRoot,
    writeAssistantOpen
  })
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
    const runDesktopShortcut = (command: DesktopCommand): void => {
      if (typeof window.dsGui?.runDesktopCommand !== 'function') return
      void window.dsGui.runDesktopCommand(command)
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
        void createThread()
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
  const showDevPreviewCard =
    route === 'chat' &&
    latestDevPreviewUrl !== null

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.dsGui?.getLogPath !== 'function') return
    let cancelled = false
    void window.dsGui
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
      !isWriteThreadId(thread.id) &&
      !isClawThread(thread, clawChannels) &&
      !isSddAssistantThread(thread) &&
      !isEmptySddAssistantThreadCandidate(thread)
    ),
    [clawChannels, threads]
  )

  const mirrorClawCommand = async (userText: string, replyText: string): Promise<void> => {
    if (!activeThreadId || typeof window.dsGui?.mirrorClawChannelMessage !== 'function') return
    const userResult = await window.dsGui.mirrorClawChannelMessage(
      activeThreadId,
      userText,
      'user'
    )
    if (!userResult.ok) return
    await window.dsGui.mirrorClawChannelMessage(
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
      `- \`/attach current\`: ${t('clawHelpCommandAttachCurrent')}`,
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
    const localSkillsTask = typeof window !== 'undefined' && typeof window.dsGui?.listSkills === 'function'
      ? window.dsGui.listSkills(activeSkillWorkspace || undefined)
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
  const runtimeCapabilities: AgentProviderCapabilities | undefined =
    runtimeConnection === 'ready' ? getProvider().getCapabilities() : undefined

  const clearComposerAttachments = (): void => {
    setComposerAttachments([])
  }

  const clearComposerFileReferences = (): void => {
    setComposerFileReferences([])
  }

  const addComposerFileReference = (reference: ComposerFileReference): void => {
    setComposerFileReferences((current) => mergeComposerFileReferences(current, reference))
  }

  const removeComposerFileReference = (relativePath: string): void => {
    const key = relativePath.trim().replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase()
    setComposerFileReferences((current) =>
      current.filter((reference) =>
        reference.relativePath.trim().replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase() !== key
      )
    )
  }

  useEffect(() => {
    if (route !== 'chat') setComposerFileReferences([])
  }, [route])

  const handlePickAttachments = async (inputs: ComposerImageAttachmentInput[]): Promise<void> => {
    if (!inputs.length) return
    const writeState = route === 'write' ? useWriteWorkspaceStore.getState() : null
    const workspace = normalizeWorkspaceRoot(
      (route === 'write' ? writeState?.workspaceRoot : null) ||
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
    const unresolvedPdfNames: string[] = []
    for (const input of pdfInputs) {
      const reference = workspace ? pickedWorkspaceFileReference(input, workspace) : null
      if (reference) {
        pdfReferences.push(reference)
      } else {
        unresolvedPdfNames.push(input.file.name || fileNameFromPath(pathForPickedAttachment(input)))
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
    }
    if (unresolvedPdfNames.length > 0) {
      setAttachmentUploadError(t('composerWorkspaceFilePathRequired', {
        name: unresolvedPdfNames[0],
        count: unresolvedPdfNames.length
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
        if (unresolvedPdfNames.length === 0 && unsupportedInputs.length === 0) setAttachmentUploadError(null)
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
    if (unresolvedPdfNames.length === 0) setAttachmentUploadError(null)
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
    if (typeof window.dsGui?.readClipboardImage !== 'function') {
      setAttachmentUploadError(t('composerAttachmentUnavailable'))
      return
    }
    const image = await window.dsGui.readClipboardImage()
    if (!image.ok) {
      if (options.silentNoImage) return
      setAttachmentUploadError(image.message)
      return
    }
    await handlePickAttachments([{ file: clipboardImageToFile(image) }])
  }

  const sendWritePrompt = (value: string): void => {
    const v = value.trim()
    const attachments = composerAttachments
    const attachmentIds = attachments.map((attachment) => attachment.id)
    if (!v && attachmentIds.length === 0) return
    if (attachmentIds.length > 0 && !attachmentUploadEnabled) {
      setAttachmentUploadError(t('composerAttachmentModelUnsupported'))
      return
    }
    const writeState = useWriteWorkspaceStore.getState()
    const writeWorkspaceRoot = writeState.workspaceRoot || workspaceRoot
    setInput('')
    void (async () => {
      const threadId = await ensureWriteThreadForWorkspace(writeWorkspaceRoot)
      if (!threadId) {
        setInput(v)
        return
      }
      const messageText = v || t('composerImageOnlyPrompt')
      const prepared = await prepareWriteAssistantPrompt(messageText, {
        workspaceRoot: writeState.workspaceRoot,
        fallbackWorkspaceRoot: workspaceRoot,
        activeFilePath: writeState.activeFilePath,
        quotedSelections: writeState.quotedSelections
      }, {
        retrieveWriteContext: window.dsGui?.retrieveWriteContext,
        logError: window.dsGui?.logError
      })
      const runtimePayload = writeAssistantRuntimePayload(prepared)
      const displayText = v ? runtimePayload.displayText : t('composerImageOnlyDisplay')
      const model = writeState.assistantModel.trim()
      const reasoningEffort = composerReasoningEffortRequestValue(assistantReasoningEffort)
      const sent = await sendMessage(runtimePayload.text, mode === 'plan' ? 'plan' : 'agent', {
        displayText,
        sourceRoute: 'write',
        targetThreadId: threadId,
        workspaceRoot: writeWorkspaceRoot,
        governanceProfile: 'write',
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(attachmentIds.length ? { attachmentIds, attachments } : {})
      })
      if (sent) {
        useWriteWorkspaceStore.getState().clearQuotedSelections()
        if (attachmentIds.length > 0) clearComposerAttachments()
      } else {
        setInput(v)
      }
    })()
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
      readWorkspaceFile: window.dsGui.readWorkspaceFile
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
    const result = await window.dsGui.createWorkspaceFile({
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
      readWorkspaceFile: window.dsGui.readWorkspaceFile
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

  const sendSddAssistantPrompt = async (value: string): Promise<void> => {
    const v = value.trim()
    const draft = useSddDraftStore.getState().activeDraft
    if (!v || !draft) return
    const threadId = await ensureSddAssistantThreadForDraft(draft)
    if (!threadId) return
    const snapshot = useSddDraftStore.getState()
    void saveActiveSddDraftToDisk()
    const prompt = composeSddAssistantPrompt({
      userPrompt: v,
      draftMarkdown: snapshot.content,
      draftRelativePath: draft.relativePath,
      workspaceRoot: draft.workspaceRoot
    })
    setInput('')
    const model = writeAssistantModel.trim()
    const reasoningEffort = composerReasoningEffortRequestValue(assistantReasoningEffort)
    const sent = await sendMessage(prompt, mode === 'plan' ? 'plan' : 'agent', {
      displayText: v,
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {})
    })
    if (!sent) setInput(v)
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
      await window.dsGui
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
    references: ComposerFileReference[],
    workspace: string
  ): Promise<ComposerFileContextEntry[]> => {
    const entries: ComposerFileContextEntry[] = []
    let remainingChars = COMPOSER_FILE_CONTEXT_MAX_TOTAL_CHARS
    for (const reference of references) {
      if (remainingChars <= 0) break
      if (reference.modelRouterObject) {
        const content = [
          `Scientific workspace file: ${reference.relativePath}`,
          'This file is attached as a structured model-router object reference. Let the model router inspect or translate it when supported.'
        ].join('\n')
        entries.push({
          relativePath: reference.relativePath,
          content
        })
        remainingChars -= content.length
        continue
      }
      const result = await window.dsGui.readWorkspaceFile({
        workspaceRoot: workspace,
        path: reference.relativePath || reference.path
      })
      if (!result.ok) {
        throw new Error(t('composerFileReadFailed', {
          path: reference.relativePath,
          message: result.message
        }))
      }
      if (result.kind === 'pdf') {
        const content = [
          `PDF document: ${reference.relativePath}`,
          'This file is available through the workspace PDF reader. Use selected PDF quotes when provided; otherwise ask for the relevant page or excerpt.'
        ].join('\n')
        entries.push({
          relativePath: reference.relativePath,
          content
        })
        remainingChars -= content.length
        continue
      }
      const clipped = clipComposerFileContext(result.content, remainingChars, result.truncated)
      remainingChars -= clipped.consumed
      entries.push({
        relativePath: reference.relativePath,
        content: clipped.content,
        ...(clipped.truncated ? { truncated: true } : {})
      })
    }
    return entries
  }

  const handleSend = (): void => {
    void handleSendAsync()
  }

  const handleSendAsync = async (): Promise<void> => {
    const v = input.trim()
    const attachments = route === 'chat' || route === 'write' ? composerAttachments : []
    const attachmentIds = attachments.map((attachment) => attachment.id)
    const fileReferences = route === 'chat' ? composerFileReferences : []
    const modelRouterFileReferences = fileReferences.filter((reference) => reference.modelRouterObject === true)
    const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
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
    const prepareChatMessage = async (): Promise<{ text: string; displayText?: string } | null> => {
      if (fileReferences.length === 0) {
        return {
          text: messageText,
          ...(emptyDisplayText ? { displayText: emptyDisplayText } : {})
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
        const displayText = v || emptyDisplayText
        return {
          text: buildComposerFileContextPrompt(messageText, fileContext),
          ...(displayText ? { displayText } : {})
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
        return null
      }
    }

    if (activeSddDraft && rightPanelMode === 'sdd-ai') {
      void sendSddAssistantPrompt(v)
      return
    }
    const planCommand = parseGuiPlanCommand(v)
    if (planCommand) {
      setInput('')
      void handleGuiPlanCommand(planCommand.kind === 'create' ? planCommand.request : undefined)
      return
    }
    if (route === 'chat' && mode === 'plan') {
      const prepared = await prepareChatMessage()
      if (!prepared) return
      setInput('')
      clearComposerAttachments()
      clearComposerFileReferences()
      void sendPlanTurn(prepared.text, {
        ...(prepared.displayText ? { displayText: prepared.displayText } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(attachmentIds.length ? { attachmentIds, attachments } : {}),
        ...(modelRouterFileReferences.length ? { fileReferences: modelRouterFileReferences } : {})
      })
      return
    }
    if (route === 'write') {
      sendWritePrompt(v)
      return
    }
    if (route === 'claw') {
      const command = parseClawCommand(v)
      if (command?.kind === 'clear') {
        if (!activeClawChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        void (async () => {
          await resetClawChannelSession(activeClawChannelId)
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
        if (!activeClawChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        void (async () => {
          await setClawChannelModel(activeClawChannelId, command.model)
          const replyText = t('clawModelChanged', { model: command.model })
          appendLocalClawTurn(v, replyText)
          await mirrorClawCommand(v, replyText)
        })()
        return
      }
      if (command?.kind === 'showModel') {
        if (!activeClawChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        const replyText = t('clawModelCurrent', {
          model: activeClawChannel?.model ?? 'auto'
        })
        appendLocalClawTurn(v, replyText)
        void mirrorClawCommand(v, replyText)
        return
      }
      if (command?.kind === 'invalidModel') {
        setError(t('clawModelCommandHint'))
        return
      }
      if (!activeClawChannelId) {
        setError(t('clawNoActiveIm'))
        return
      }
      setInput('')
      void (async () => {
        const taskResult = typeof window.dsGui?.createClawTaskFromText === 'function'
          ? await window.dsGui.createClawTaskFromText(v, {
              channelId: activeClawChannelId,
              modelHint: activeClawChannel?.model,
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
          await selectClawChannel(activeClawChannelId)
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
    const prepared = await prepareChatMessage()
    if (!prepared) return
    setInput('')
    clearComposerAttachments()
    clearComposerFileReferences()
    void sendMessage(prepared.text, mode === 'plan' ? 'plan' : 'agent', {
      ...(prepared.displayText ? { displayText: prepared.displayText } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(attachmentIds.length ? { attachmentIds, attachments } : {}),
      ...(modelRouterFileReferences.length ? { fileReferences: modelRouterFileReferences } : {})
    })
  }

  const openThread = (id: string, runtimeId?: AgentRuntimeId): void => {
    void (async () => {
      const thread = threads.find((item) => item.id === id) ?? null
      if (await openSddRequirementDraftFromSidebarThread(id, thread)) {
        setConnectPhoneSidebarOpen(false)
        return
      }
      if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
      setConnectPhoneSidebarOpen(false)
      setRoute('chat')
      getProvider().rememberThreadRuntime?.(id, runtimeId)
      await selectThread(id)
    })()
  }

  const startNewChat = (): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('chat')
    void createThread()
  }

  const startNewChatInWorkspace = (workspaceRoot: string): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('chat')
    void createThread({ workspaceRoot })
  }

  const openCodeMode = (): void => {
    setConnectPhoneSidebarOpen(false)
    void openCode()
  }

  const openWriteMode = (): void => {
    setConnectPhoneSidebarOpen(false)
    void openWrite()
  }

  const openPluginsView = (): void => {
    setConnectPhoneSidebarOpen(false)
    openPlugins('chat')
  }

  const openScheduleView = (): void => {
    setConnectPhoneSidebarOpen(false)
    openSchedule()
  }

  const toggleConnectPhone = (): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen((open) => !open)
  }

  const sidebarView: 'chat' | 'write' | 'claw' | 'schedule' =
    route === 'schedule'
        ? 'schedule'
      : route === 'write'
        ? 'write'
        : 'chat'

  const closeRightPanel = (): void => {
    if (route === 'write') {
      setWriteAssistantOpen(false)
      return
    }
    setRightPanelMode(null)
    setFilePreviewTarget(null)
  }

  const startNewWriteAssistantConversation = (): void => {
    const writeState = useWriteWorkspaceStore.getState()
    const writeWorkspaceRoot = writeState.workspaceRoot || workspaceRoot
    setInput('')
    writeState.clearQuotedSelections()
    void createWriteThread(writeWorkspaceRoot)
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
        typeof window !== 'undefined' && typeof window.dsGui?.openLogDir === 'function'
          ? () => window.dsGui.openLogDir()
          : undefined
      }
      onOpenSettings={() => openSettings('agents')}
      onRetryConnection={() => void probeRuntime('user')}
    />
  )

  const writeRuntimeBannerMessage = runtimeConnection !== 'ready'
    ? (error?.trim() || t('writeRuntimeUnavailable'))
    : null

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
            {route === 'write' && writeAssistantOpen ? (
              <WriteAssistantPanel
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
                composerModel={writeAssistantModel}
                composerPickList={writeAssistantPickList}
                composerModelGroups={composerModelGroups}
                composerReasoningEffort={assistantReasoningEffort}
                setComposerModel={setWriteAssistantModel}
                setComposerReasoningEffort={setAssistantReasoningEffort}
                queuedMessages={queuedMessages}
                removeQueuedMessage={removeQueuedMessage}
                attachments={composerAttachments}
                attachmentUploadEnabled={attachmentUploadEnabled}
                attachmentUploadBusy={attachmentUploadBusy}
                attachmentUploadError={attachmentUploadError}
                onPickAttachments={(files) => void handlePickAttachments(files)}
                onPasteClipboardImage={(options) => void handlePasteClipboardImage(options)}
                onRemoveAttachment={removeComposerAttachment}
                onSend={handleSend}
                onInterrupt={(options) => void interrupt(options)}
                runtimeCapabilities={runtimeCapabilities}
                onRetryConnection={() => void probeRuntime('user')}
                onOpenSettings={() => openSettings('agents')}
                onNewConversation={startNewWriteAssistantConversation}
                onCollapse={closeRightPanel}
                className="h-full max-h-full w-full"
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
                composerModel={writeAssistantModel}
                composerPickList={writeAssistantPickList}
                composerModelGroups={composerModelGroups}
                composerReasoningEffort={assistantReasoningEffort}
                setComposerModel={setWriteAssistantModel}
                setComposerReasoningEffort={setAssistantReasoningEffort}
                queuedMessages={queuedMessages}
                removeQueuedMessage={removeQueuedMessage}
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
            ) : rightPanelMode === 'todo' ? (
              <TodoPanel
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
                onOpenPlan={openGuiPlanPanel}
              />
            ) : rightPanelMode === 'paper' ? (
              <PaperRadarPanel
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
            ) : (
              <WorkspaceFilePreviewPanel
                target={filePreviewTarget}
                workspaceRoot={workspaceRoot}
                className="h-full max-h-full w-full"
                onClose={closeRightPanel}
              />
            )}
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
            {route === 'write' ? (
              <WriteSidebar
                activeView={sidebarView}
                connectPhoneSidebarOpen={connectPhoneSidebarOpen}
                onCodeOpen={openCodeMode}
                onWriteOpen={openWriteMode}
                onOpenSettings={(section) => openSettings(section)}
                onToggleConnectPhone={toggleConnectPhone}
                onToggleSidebar={toggleLeftSidebar}
              />
            ) : (
            <Sidebar
              threads={codeThreads}
              activeThreadId={activeThreadId}
              activeView={sidebarView}
              connectPhoneSidebarOpen={connectPhoneSidebarOpen}
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
              onCodeOpen={openCodeMode}
              onWriteOpen={openWriteMode}
              onScheduleOpen={openScheduleView}
              onToggleSidebar={toggleLeftSidebar}
            />
            )}
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
        ) : route === 'write' ? (
          <>
            {writeRuntimeBannerMessage ? renderRuntimeBanner(writeRuntimeBannerMessage, runtimeErrorDetail) : null}
            <div className="flex min-h-0 flex-1">
              <WriteWorkspaceView
                leftSidebarCollapsed={leftSidebarCollapsed}
                onToggleLeftSidebar={toggleLeftSidebar}
                input={input}
                setInput={setInput}
                onSubmitPrompt={sendWritePrompt}
              />
              {renderRightPanel()}
            </div>
          </>
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
                  {busy ? (
                    <span className="inline-flex shrink-0 rounded-full bg-amber-500/16 px-2.5 py-1 text-[11.5px] font-semibold text-amber-950 dark:text-amber-100">
                      {t('running')}
                    </span>
                  ) : null}
                  <WorkbenchTopBar
                    rightPanelMode={rightPanelMode}
                    onToggleRightPanelMode={toggleRightPanelMode}
                    planPanelEnabled={Boolean(activeGuiPlan)}
                    sideChatCount={currentSideConversations.length}
                    sideChatRunningCount={currentSideRunningCount}
                    sideChatOpen={sidePanel.open}
                    sideChatEnabled={
                      runtimeConnection === 'ready' &&
                      Boolean(activeThreadId) &&
                      runtimeCapabilities?.sideConversations !== false
                    }
                    onOpenSideChat={openSideChat}
                  />
                </div>
              </div>
            </header>
            {activeRemoteChannel ? (
              <RemoteGuardDetailView
                channel={activeRemoteChannel}
                onOpenThread={openThread}
                onOpenSettings={() => setConnectPhoneSidebarOpen(true)}
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
                      route === 'claw'
                        ? clawChannels.find((channel) => channel.id === activeClawChannelId)?.model ?? 'auto'
                        : composerModel
                    }
                    composerPickList={composerPickList}
                    composerModelGroups={composerModelGroups}
                    composerReasoningEffort={
                      route === 'chat' || route === 'claw' ? composerReasoningEffort : undefined
                    }
                    onComposerModelChange={(modelId) => {
                      if (route === 'claw' && activeClawChannelId) {
                        void setClawChannelModel(activeClawChannelId, modelId)
                        return
                      }
                      setComposerModel(modelId)
                    }}
                    onComposerReasoningEffortChange={
                      route === 'chat' || route === 'claw' ? setComposerReasoningEffort : undefined
                    }
                    onSend={handleSend}
                    attachments={composerAttachments}
                    attachmentUploadEnabled={attachmentUploadEnabled}
                    attachmentUploadBusy={attachmentUploadBusy}
                    attachmentUploadError={attachmentUploadError}
                    fileReferenceEnabled={route === 'chat' && !activeSddDraft}
                    fileReferences={composerFileReferences}
                    webAccessAvailable={webAccessAvailable}
                    changedFiles={composerChangeSummary?.files}
                    changedFileStats={composerChangeSummary}
                    skillCommands={runtimeSkills}
                    runtimeCapabilities={runtimeCapabilities}
                    onPickAttachments={(files) => void handlePickAttachments(files)}
                    onPasteClipboardImage={(options) => void handlePasteClipboardImage(options)}
                    onRemoveAttachment={removeComposerAttachment}
                    onAddFileReference={addComposerFileReference}
                    onRemoveFileReference={removeComposerFileReference}
                    queuedMessages={queuedMessages}
                    onRemoveQueuedMessage={removeQueuedMessage}
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

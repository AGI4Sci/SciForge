import type { ReactElement, SetStateAction } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ArrowLeft, CircleAlert, Eye } from 'lucide-react'
import type {
  DomainWorkbenchOpenRightPanelInput,
  DomainWorkbenchOpenSurfaceInput,
  DomainWorkbenchToggleGlobalOverlayInput
} from '@sciforge/domain-sdk/host'
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
import type { AgentRuntimeId } from '@shared/app-settings'
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
import { hasPendingRuntimeWork } from '../store/chat-store-runtime-helpers'
import { Sidebar } from './chat/Sidebar'
import {
  RIGHT_PANEL_MODES,
  WorkbenchTopBar,
  type RightPanelMode
} from './chat/WorkbenchTopBar'
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
  type SessionRightPanelPane,
  type SessionRightPanelPaneBinding,
  type SessionRightPanelPlacement,
  type SessionRightPanelWorkspace
} from './session-right-panel-workspaces'
import { draftSessionRightPanelId } from '../lib/session-right-panel-owner'
import { SessionRightPanelStack } from './SessionRightPanelStack'
import { forgetRightPanelContextStateForSurface } from './right-panel-context-state'
import {
  SessionRightPanelDock,
  type SessionRightPanelPaneRenderContext
} from './SessionRightPanelDock'
import { useWorkbenchPlanController } from './workbench-plan-controller'
import { prepareImageAttachmentUpload } from '../lib/image-attachment-upload'
import { isChatAttachmentUploadEnabled } from '../lib/attachment-upload-availability'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { buildImageGenerationWorkflowPrompt } from '../lib/image-generation-chat'
import { useKeyboardShortcutSettings } from '../lib/keyboard-shortcut-settings'
import { providerSupportsCapability } from '../store/chat-store-provider-capabilities'
import { collectComposerChangeSummary } from '../lib/composer-change-summary'
import { composerPickedAttachmentKind } from '../lib/composer-attachment-policy'
import { importComposerWorkspaceAttachment } from '../lib/composer-workspace-attachment'
import {
  WORKSPACE_FILE_PREVIEW_EVENT,
  type WorkspaceFilePreviewDetail
} from '../lib/workspace-file-preview'
import {
  composerFileReferenceKey,
  mergeComposerFileReferences,
  relativeWorkspacePath,
} from '../lib/composer-file-references'
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
import { workspacePreviewVisibleContextComponentId } from '../workspace-preview/visible-context-identity'
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
  surfaceId: string
  focused: boolean
  width: number
  workspaceRoot?: string
  filePreviewTarget?: { path: string; workspaceRoot?: string } | null
  childAgentCount?: number
  childAgentRunningCount?: number
  planId?: string | null
  sddDraftId?: string | null
  updatedAt?: string
}

export function rightPanelVisibleContextComponentId(input: {
  sessionId: string
  surfaceId: string
}): string {
  return `right-sidebar:session:${encodeURIComponent(input.sessionId)}:surface:${encodeURIComponent(input.surfaceId)}`
}

/**
 * Builds one mode-independent directory entry for a visible right-panel pane.
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
    summary: `${title} state owned by pane ${input.surfaceId} in session ${input.sessionId}.`,
    sessionId: input.sessionId,
    surfaceId: input.surfaceId,
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
          canonicalComponentId: workspacePreviewVisibleContextComponentId({
            sessionId: input.sessionId,
            surfaceId: input.surfaceId
          })
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
    id: rightPanelVisibleContextComponentId(input),
    region: 'right-sidebar',
    component: 'right-panel',
    title,
    visible: true,
    priority: 10,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    summary: `Right sidebar pane ${input.surfaceId} for session ${input.sessionId} is showing the ${title} panel.`,
    state: {
      mode: input.mode,
      sessionId: input.sessionId,
      surfaceId: input.surfaceId,
      focused: input.focused,
      width: input.width,
      currentResource
    }
  }
}

export type ResolvedRightPanelLaunchTarget =
  | Readonly<{ kind: 'exact'; paneId: string }>
  | Readonly<{ kind: 'placement'; placement: SessionRightPanelPlacement }>

/** Resolves every external right-panel launch through the same Host-owned policy. */
export function resolveRightPanelLaunchTarget(
  workspace: SessionRightPanelWorkspace | null | undefined,
  input: Readonly<{ placement?: string; surfaceId?: string }>
): ResolvedRightPanelLaunchTarget | null {
  const surfaceId = input.surfaceId?.trim() || null
  const placement = input.placement?.trim() || null
  if (surfaceId && placement) return null
  if (surfaceId) {
    return workspace?.panes.some((pane) => pane.paneId === surfaceId)
      ? { kind: 'exact', paneId: surfaceId }
      : null
  }
  if (placement && placement !== 'focused' && placement !== 'new') return null
  return {
    kind: 'placement',
    placement: placement === 'new' ? 'new' : 'focused'
  }
}

function RightPanelVisibleContextRegistration({
  active,
  mode,
  sessionId,
  surfaceId,
  focused,
  width,
  workspaceRoot,
  filePreviewTarget,
  childAgentCount,
  childAgentRunningCount,
  planId,
  sddDraftId,
  updatedAt
}: RightPanelVisibleContextInput & { active: boolean }): null {
  useEffect(() => {
    if (!active) return undefined
    return registerVisibleContextComponent(buildRightPanelVisibleContextComponent({
      mode,
      sessionId,
      surfaceId,
      focused,
      width,
      workspaceRoot,
      filePreviewTarget,
      childAgentCount,
      childAgentRunningCount,
      planId,
      sddDraftId,
      updatedAt
    }))
  }, [
    active,
    childAgentCount,
    childAgentRunningCount,
    filePreviewTarget,
    focused,
    mode,
    planId,
    sddDraftId,
    sessionId,
    surfaceId,
    updatedAt,
    width,
    workspaceRoot
  ])
  return null
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
  return composerPickedAttachmentKind(input.file) === 'pdf'
}

function isPickedImageAttachment(input: ComposerImageAttachmentInput): boolean {
  return composerPickedAttachmentKind(input.file) === 'image'
}

function isPickedScientificAttachment(input: ComposerImageAttachmentInput): boolean {
  return composerPickedAttachmentKind(input.file) === 'scientific'
}

function isPickedWebDocumentAttachment(input: ComposerImageAttachmentInput): boolean {
  return composerPickedAttachmentKind(input.file) === 'web-document'
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
  pane: SessionRightPanelPane,
  context: SessionRightPanelPaneRenderContext
) => ReactElement | null

type SessionRightPanelRenderSnapshot = {
  sessionId: string
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
    workspaceRoot,
    runtimeConnection,
    activeAgentRuntime,
    modelAccessMode,
    setRoute,
    openSettings,
    openPlugins,
    openSchedule,
    chooseWorkspace,
    workspaceLocator,
    setError,
    sendMessage,
    reviewActiveThread,
    queuedMessages,
    chatSessionPersistenceDegraded,
    activeThreadTodos,
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
      workspaceRoot: s.workspaceRoot,
      runtimeConnection: s.runtimeConnection,
      activeAgentRuntime: s.activeAgentRuntime,
      modelAccessMode: s.modelAccessMode,
      setRoute: s.setRoute,
      openSettings: s.openSettings,
      openPlugins: s.openPlugins,
      openSchedule: s.openSchedule,
      chooseWorkspace: s.chooseWorkspace,
      workspaceLocator: s.workspaceLocator,
      setError: s.setError,
      sendMessage: s.sendMessage,
      reviewActiveThread: s.reviewActiveThread,
      queuedMessages: s.queuedMessages,
      chatSessionPersistenceDegraded: s.chatSessionPersistenceDegraded,
      activeThreadTodos: s.activeThreadTodos,
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
  const selectedWorkspaceLocator =
    route === 'chat' ? workspaceLocator ?? undefined : undefined
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
    addRightPanelPaneForSession,
    beginBottomPanelResize,
    beginLeftResize,
    beginRightPanelPaneResize,
    bottomPanelActivation,
    bottomPanelContributionId,
    bottomPanelHeight,
    closeBottomPanel,
    closeRightPanelPaneForSession: closeRightPanelPaneStateForSession,
    focusedRightPanelMode,
    focusedRightPanelPane,
    focusRightPanelPaneForSession,
    leftSidebarCollapsed,
    leftSidebarWidth,
    navigateRightPanelPaneHistoryForSession,
    placeRightPanelPaneForSession,
    rebindRightPanelPaneForSession,
    rightPanelDockViewportWidth,
    rightPanelWorkspaces,
    rightPanelVisible,
    setRightPanelPaneWidthForSession,
    shellRef,
    openBottomPanelForSession,
    splitRightPanelPaneForSession,
    toggleLeftSidebar,
    updateRightPanelPaneForSession,
  } = useWorkbenchLayout({
    activeSessionId: rightPanelOwnerId
  })
  const closeRightPanelPaneForSession = useCallback((
    sessionId: string,
    paneId: string
  ): void => {
    const paneExists = rightPanelWorkspaces
      .find((workspace) => workspace.sessionId === sessionId)
      ?.panes.some((pane) => pane.paneId === paneId)
    if (!paneExists) return
    forgetRightPanelContextStateForSurface(sessionId, paneId)
    closeRightPanelPaneStateForSession(sessionId, paneId)
  }, [closeRightPanelPaneStateForSession, rightPanelWorkspaces])
  const pendingFocusedRightPanelWidthRef = useRef<number | null>(null)
  const setFocusedRightPanelMode = useCallback((
    value: SetStateAction<RightPanelMode>
  ): void => {
    if (!rightPanelOwnerId) return
    const mode = typeof value === 'function' ? value(focusedRightPanelMode) : value
    if (!mode) {
      if (focusedRightPanelPane) {
        closeRightPanelPaneForSession(rightPanelOwnerId, focusedRightPanelPane.paneId)
      }
      pendingFocusedRightPanelWidthRef.current = null
      return
    }
    const pendingWidth = pendingFocusedRightPanelWidthRef.current
    pendingFocusedRightPanelWidthRef.current = null
    placeRightPanelPaneForSession(
      rightPanelOwnerId,
      { mode },
      'focused',
      pendingWidth === null ? undefined : { width: pendingWidth }
    )
  }, [
    closeRightPanelPaneForSession,
    focusedRightPanelMode,
    focusedRightPanelPane,
    placeRightPanelPaneForSession,
    rightPanelOwnerId
  ])
  const setFocusedRightPanelPaneWidth = useCallback((
    value: SetStateAction<number>
  ): void => {
    if (!rightPanelOwnerId || !focusedRightPanelPane) {
      const fallback = pendingFocusedRightPanelWidthRef.current ?? SESSION_RIGHT_PANEL_DEFAULT_WIDTH
      pendingFocusedRightPanelWidthRef.current = typeof value === 'function' ? value(fallback) : value
      return
    }
    setRightPanelPaneWidthForSession(rightPanelOwnerId, focusedRightPanelPane.paneId, value)
  }, [focusedRightPanelPane, rightPanelOwnerId, setRightPanelPaneWidthForSession])
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
      : installedRendererContributions.rightPanels.resolve(focusedRightPanelMode)
        ? {
            activeSurface: {
              kind: 'right-panel' as const,
              contributionId:
                installedRendererContributions.rightPanels.resolve(focusedRightPanelMode)!.id
            }
          }
        : {})
  }
  const sessionRightPanelSnapshotsRef = useRef(new Map<string, SessionRightPanelRenderSnapshot>())

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
      setFocusedRightPanelMode('child-agents')
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
    if (activeThreadId) {
      placeRightPanelPaneForSession(activeThreadId, {
        mode: 'child-agents',
        childPanelFocusRequest: {
          childId: target.threadId ? null : target.childId,
          key: Date.now()
        }
      }, 'focused')
    }
  }, [
    activeThread?.model,
    attachSideConversation,
    childAgentAttention.summary.primaryTarget,
    composerModel,
    focusAgentThread,
    activeThreadId,
    placeRightPanelPaneForSession,
    setFocusedRightPanelMode
  ])
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
    openPlanRightPanel: () => {
      if (!activeThreadId) return
      placeRightPanelPaneForSession(
        activeThreadId,
        { mode: 'plan' },
        'focused',
        { width: CODE_PANEL_PREFERRED }
      )
    },
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
      !isSddAssistantThread(thread) &&
      !isEmptySddAssistantThreadCandidate(thread)
    ),
    [threads]
  )

  useEffect(() => {
    inputRef.current = input
  }, [input])

  useEffect(() => {
    if (activeGuiPlan || !rightPanelOwnerId) return
    const workspace = rightPanelWorkspaces.find(
      (candidate) => candidate.sessionId === rightPanelOwnerId
    )
    workspace?.panes
      .filter((pane) => pane.mode === 'plan')
      .forEach((pane) => closeRightPanelPaneForSession(rightPanelOwnerId, pane.paneId))
  }, [
    activeGuiPlan,
    closeRightPanelPaneForSession,
    rightPanelOwnerId,
    rightPanelWorkspaces
  ])

  useEffect(() => {
    const openDomainRightPanel = (event: Event): void => {
      const detail = (event as CustomEvent<DomainWorkbenchOpenRightPanelInput>).detail
      const sessionId = detail?.sessionId?.trim()
      const contributionId = detail?.contributionId?.trim()
      if (!sessionId || !contributionId) return
      if (detail.activation && detail.activation.contributionId !== contributionId) return
      const registered = installedRendererContributions.rightPanels.resolve(contributionId)
      if (!registered) return
      const workspace = rightPanelWorkspaces.find(
        (candidate) => candidate.sessionId === sessionId
      )
      const target = resolveRightPanelLaunchTarget(workspace, detail)
      if (!target) return
      const binding: SessionRightPanelPaneBinding = {
        mode: registered.id,
        panelActivation: detail.activation ?? null
      }
      if (target.kind === 'exact') {
        const pane = workspace?.panes.find((candidate) => candidate.paneId === target.paneId)
        if (!pane) return
        setRightPanelPaneWidthForSession(
          sessionId,
          pane.paneId,
          (width) => Math.max(width, CODE_PANEL_PREFERRED)
        )
        rebindRightPanelPaneForSession(sessionId, pane.paneId, binding)
        return
      }
      placeRightPanelPaneForSession(
        sessionId,
        binding,
        target.placement,
        { width: CODE_PANEL_PREFERRED }
      )
    }
    window.addEventListener(DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT, openDomainRightPanel)
    return () => window.removeEventListener(
      DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT,
      openDomainRightPanel
    )
  }, [
    placeRightPanelPaneForSession,
    rebindRightPanelPaneForSession,
    rightPanelWorkspaces,
    setRightPanelPaneWidthForSession
  ])

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
      if (rightPanelOwnerId) {
        rightPanelWorkspaces
          .find((workspace) => workspace.sessionId === rightPanelOwnerId)
          ?.panes.filter((pane) => pane.mode === 'todo')
          .forEach((pane) => closeRightPanelPaneForSession(rightPanelOwnerId, pane.paneId))
      }
      return
    }
    if (route !== 'chat') return
    if (focusedRightPanelMode === 'todo') {
      autoOpenedTodoKeyRef.current = activeTodoAutoOpenKey
      return
    }
    if (focusedRightPanelMode !== null) return
    if (autoOpenedTodoKeyRef.current === activeTodoAutoOpenKey) return
    autoOpenedTodoKeyRef.current = activeTodoAutoOpenKey
    setFocusedRightPanelPaneWidth((width) => Math.max(width, 360))
    setFocusedRightPanelMode('todo')
  }, [
    activeTodoAutoOpenKey,
    activeTodoItemCount,
    closeRightPanelPaneForSession,
    focusedRightPanelMode,
    rightPanelOwnerId,
    rightPanelWorkspaces,
    route,
    setFocusedRightPanelMode,
    setFocusedRightPanelPaneWidth
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
    const targetWorkspaceRoot = normalizeWorkspaceRoot(activeThread?.workspace || workspaceRoot)
    const referenceWorkspaceRoot = normalizeWorkspaceRoot(
      reference.workspaceRoot || activeWorkspaceReferenceRoot || workspaceRoot
    )
    if (
      targetWorkspaceRoot &&
      referenceWorkspaceRoot &&
      referenceWorkspaceRoot !== targetWorkspaceRoot
    ) {
      setAttachmentUploadError(t('composerReferenceWorkspaceMismatch'))
      return
    }
    const normalizedReference = {
      ...reference,
      workspaceRoot: referenceWorkspaceRoot
    }
    setAttachmentUploadError(null)
    setComposerFileReferences((current) => mergeComposerFileReferences(current, normalizedReference))
  }

  const previewWorkspaceReference = (reference: AgentRuntimeWorkspaceReference): void => {
    if (reference.kind === 'directory' || !rightPanelOwnerId) return
    placeRightPanelPaneForSession(rightPanelOwnerId, {
      mode: 'file',
      filePreviewReturnContext: null,
      filePreviewTarget: {
        path: reference.relativePath,
        workspaceRoot: reference.workspaceRoot || activeWorkspaceReferenceRoot || workspaceRoot
      }
    }, 'focused')
  }

  const previewComposerFileReference = (reference: ComposerFileReference): void => {
    if (reference.kind === 'directory') return
    const path = reference.relativePath || reference.path
    if (!path || !rightPanelOwnerId) return
    placeRightPanelPaneForSession(rightPanelOwnerId, {
      mode: 'file',
      filePreviewReturnContext: null,
      filePreviewTarget: {
        path,
        workspaceRoot: reference.workspaceRoot || activeWorkspaceReferenceRoot || workspaceRoot
      }
    }, 'focused')
  }

  const openFileTreeDirectory = useCallback((target: { workspaceRoot: string; path: string }): void => {
    const nextWorkspaceRoot = normalizeWorkspaceRoot(
      target.workspaceRoot || activeWorkspaceReferenceRoot || workspaceRoot
    )
    const nextPath = relativeWorkspacePath(target.path, nextWorkspaceRoot)
    const hasKnownWorkspaceGroup = workspaceReferenceGroups.some(
      (group) => normalizeWorkspaceRoot(group.workspaceRoot) === nextWorkspaceRoot
    )
    if (!rightPanelOwnerId) return
    placeRightPanelPaneForSession(rightPanelOwnerId, {
      mode: 'file',
      fileTreeWorkspaceOverride: hasKnownWorkspaceGroup ? null : nextWorkspaceRoot,
      fileTreeInitialDirectory: {
        workspaceRoot: nextWorkspaceRoot,
        path: nextPath,
        nonce: (focusedRightPanelPane?.fileTreeInitialDirectory?.nonce ?? 0) + 1
      },
      filePreviewReturnContext: null,
      filePreviewTarget: null
    }, 'focused')
  }, [
    activeWorkspaceReferenceRoot,
    focusedRightPanelPane?.fileTreeInitialDirectory?.nonce,
    placeRightPanelPaneForSession,
    rightPanelOwnerId,
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
      const ownerWorkspace = rightPanelWorkspaces.find(
        (candidate) => candidate.sessionId === ownerSessionId
      )
      const target = resolveRightPanelLaunchTarget(ownerWorkspace, detail)
      if (!target) return
      if (detail.kind === 'directory') {
        const binding: SessionRightPanelPaneBinding = {
          mode: 'file',
          fileTreeWorkspaceOverride: ownerWorkspaceRoot || null,
          fileTreeInitialDirectory: {
            workspaceRoot: ownerWorkspaceRoot,
            path: relativeWorkspacePath(detail.path, ownerWorkspaceRoot),
            nonce: Date.now()
          },
          filePreviewReturnContext: null,
          filePreviewTarget: null
        }
        if (target.kind === 'exact') {
          const exactPane = ownerWorkspace?.panes.find(
            (pane) => pane.paneId === target.paneId
          )
          if (!exactPane) return
          setRightPanelPaneWidthForSession(
            ownerSessionId,
            exactPane.paneId,
            (width) => Math.max(width, CODE_PANEL_PREFERRED)
          )
          rebindRightPanelPaneForSession(ownerSessionId, exactPane.paneId, binding)
          return
        }
        placeRightPanelPaneForSession(
          ownerSessionId,
          binding,
          target.placement,
          { width: CODE_PANEL_PREFERRED }
        )
        return
      }
      const {
        sessionId: _sessionId,
        kind: _kind,
        returnTo: _returnTo,
        placement: _placement,
        surfaceId: _surfaceId,
        ...fileTarget
      } = detail
      const binding: SessionRightPanelPaneBinding = {
        mode: 'file',
        filePreviewTarget: {
          ...fileTarget,
          workspaceRoot: ownerWorkspaceRoot
        },
        filePreviewReturnContext: detail.returnTo ?? null
      }
      if (target.kind === 'exact') {
        const exactPane = ownerWorkspace?.panes.find(
          (pane) => pane.paneId === target.paneId
        )
        if (!exactPane) return
        setRightPanelPaneWidthForSession(
          ownerSessionId,
          exactPane.paneId,
          (width) => Math.max(width, CODE_PANEL_PREFERRED)
        )
        rebindRightPanelPaneForSession(ownerSessionId, exactPane.paneId, binding)
        return
      }
      placeRightPanelPaneForSession(
        ownerSessionId,
        binding,
        target.placement,
        { width: CODE_PANEL_PREFERRED }
      )
    }

    window.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreviewWorkspaceFile)
    return () => window.removeEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreviewWorkspaceFile)
  }, [
    placeRightPanelPaneForSession,
    rebindRightPanelPaneForSession,
    rightPanelOwnerId,
    rightPanelWorkspaces,
    setRightPanelPaneWidthForSession,
    threads,
    workspaceRoot
  ])

  const toggleTopBarRightPanelMode = (mode: Exclude<RightPanelMode, null>): void => {
    if (!rightPanelOwnerId) return
    if (focusedRightPanelMode === mode && focusedRightPanelPane) {
      closeRightPanelPaneForSession(rightPanelOwnerId, focusedRightPanelPane.paneId)
      return
    }
    placeRightPanelPaneForSession(
      rightPanelOwnerId,
      {
        mode,
        ...(mode === 'file' ? { fileTreeWorkspaceOverride: null } : {})
      },
      'focused',
      installedRendererContributions.rightPanels.resolve(mode)
        ? { width: CODE_PANEL_PREFERRED }
        : undefined
    )
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
    const importWorkspaceAttachment = workspace
      ? (input: ComposerImageAttachmentInput) => importComposerWorkspaceAttachment(input, {
          workspaceRoot: workspace,
          threadId: activeThreadId,
          getPathForFile: window.sciforge.getPathForFile,
          writeWorkspaceFile: window.sciforge.writeWorkspaceFile
        })
      : null
    const pdfInputs = inputs.filter(isPickedPdfAttachment)
    const scientificInputs = inputs.filter((input) => !isPickedPdfAttachment(input) && isPickedScientificAttachment(input))
    const imageInputs = inputs.filter((input) =>
      !isPickedPdfAttachment(input) &&
      !isPickedScientificAttachment(input) &&
      isPickedImageAttachment(input)
    )
    const webDocumentInputs = inputs.filter((input) =>
      !isPickedPdfAttachment(input) &&
      !isPickedScientificAttachment(input) &&
      !isPickedImageAttachment(input) &&
      isPickedWebDocumentAttachment(input)
    )
    const unsupportedInputs = inputs.filter((input) =>
      !isPickedPdfAttachment(input) &&
      !isPickedScientificAttachment(input) &&
      !isPickedImageAttachment(input) &&
      !isPickedWebDocumentAttachment(input)
    )
    const importedReferences: ComposerFileReference[] = []
    const failedImportNames: string[] = []
    for (const input of pdfInputs) {
      if (importWorkspaceAttachment) {
        try {
          importedReferences.push(await importWorkspaceAttachment(input))
        } catch {
          failedImportNames.push(input.file.name || 'document.pdf')
        }
      } else {
        failedImportNames.push(input.file.name || 'document.pdf')
      }
    }
    for (const input of webDocumentInputs) {
      if (importWorkspaceAttachment) {
        try {
          importedReferences.push(await importWorkspaceAttachment(input))
        } catch {
          failedImportNames.push(input.file.name || 'web-document.html')
        }
      } else {
        failedImportNames.push(input.file.name || 'web-document.html')
      }
    }
    if (importedReferences.length > 0) {
      setComposerFileReferences((current) => {
        let next = current
        for (const reference of importedReferences) {
          next = mergeComposerFileReferences(next, reference)
        }
        return next
      })
      previewComposerFileReference(importedReferences[0])
    }
    if (failedImportNames.length > 0) {
      setAttachmentUploadError(t('composerFileImportFailed', {
        name: failedImportNames[0],
        count: failedImportNames.length
      }))
    } else if (importedReferences.length > 0) {
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
      if (!importWorkspaceAttachment) {
        setAttachmentUploadError(t('workspaceRequiredToCreateThread'))
        return
      }
      try {
        const scientificReferences: ComposerFileReference[] = []
        for (const input of scientificInputs) {
          scientificReferences.push(await importWorkspaceAttachment(input))
        }
        setComposerFileReferences((current) => {
          let next = current
          for (const reference of scientificReferences) {
            next = mergeComposerFileReferences(next, reference)
          }
          return next
        })
        if (failedImportNames.length === 0 && unsupportedInputs.length === 0) setAttachmentUploadError(null)
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
    if (failedImportNames.length === 0 && unsupportedInputs.length === 0) setAttachmentUploadError(null)
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
        placeRightPanelPaneForSession(
          ownerSessionId,
          { mode: 'sdd-ai' },
          'focused',
          { width: 420 }
        )
      } else {
        return false
      }
    } else {
      if (!ownerSessionId) return false
      useSddDraftStore.getState().setSessionDraft(ownerSessionId, draft, content, {
        lastSavedContent: options.lastSavedContent,
        saveStatus: options.saveStatus
      })
      setFocusedRightPanelMode(null)
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
    if (options.closeAssistant) {
      const workspace = rightPanelWorkspaces.find(
        (candidate) => candidate.sessionId === ownerSessionId
      )
      workspace?.panes
        .filter((pane) => pane.mode === 'sdd-ai')
        .forEach((pane) => closeRightPanelPaneForSession(ownerSessionId, pane.paneId))
    }
  }

  const toggleSddAssistantPanel = async (): Promise<void> => {
    if (focusedRightPanelMode === 'sdd-ai') {
      setFocusedRightPanelMode(null)
      return
    }
    if (!activeThreadId) return
    const session = selectSddDraftSession(useSddDraftStore.getState(), activeThreadId)
    if (!session) return
    setFocusedRightPanelPaneWidth((width) => Math.max(width, 420))
    setFocusedRightPanelMode('sdd-ai')
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
    const prompt = composeSddAssistantPrompt({
      userPrompt: messageText,
      draftMarkdown: request.draftContent,
      draftRelativePath: request.draft.relativePath,
      workspaceRoot: request.draft.workspaceRoot
    })
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

  const handleSend = (intent?: ComposerSendIntent): void => {
    void handleSendAsync(intent)
  }

  const handleSendAsync = async (intent?: ComposerSendIntent): Promise<void> => {
    const v = input.trim()
    const attachments = route === 'chat' ? composerAttachments : []
    const attachmentIds = attachments.map((attachment) => attachment.id)
    const fileReferences = route === 'chat' ? composerFileReferences : []
    const targetWorkspaceRoot = normalizeWorkspaceRoot(activeThread?.workspace || workspaceRoot)
    if (fileReferences.some((reference) => {
      const referenceWorkspaceRoot = normalizeWorkspaceRoot(reference.workspaceRoot)
      return targetWorkspaceRoot && referenceWorkspaceRoot && referenceWorkspaceRoot !== targetWorkspaceRoot
    })) {
      setAttachmentUploadError(t('composerReferenceWorkspaceMismatch'))
      return
    }
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
      !activeSddDraft
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
      return {
        text: withContributedContext(preparedRuntimeMessageText),
        ...(userVisibleText ? { displayText: userVisibleText } : {})
      }
    }

    const planCommand = parseGuiPlanCommand(v)
    if (planCommand) {
      setInput('')
      void handleGuiPlanCommand(planCommand.kind === 'create' ? planCommand.request : undefined)
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
        return
      }
      setRoute('chat')
      getProvider().rememberThreadRuntime?.(id, runtimeId)
      await selectThread(id)
    })()
  }

  const startNewChat = (): void => {
    setRoute('chat')
    void createThread({ forceNew: true })
  }

  const startNewChatInWorkspace = (workspaceRoot: string): void => {
    setRoute('chat')
    void createThread({ workspaceRoot, forceNew: true })
  }

  const openPluginsView = (): void => {
    openPlugins('chat')
  }

  const openScheduleView = (): void => {
    openSchedule()
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
    pane,
    { active, focused }
  ) => {
    const ownerSessionId = snapshot.sessionId
    const paneMode = pane.mode
    const installedRightPanel = installedRightPanels.find(
      ({ id }) => id === paneMode
    )?.contribution
    const ownerFilePreviewTarget = pane.filePreviewTarget
    const ownerFilePreviewReturnContext = pane.filePreviewReturnContext
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
      closeRightPanelPaneForSession(ownerSessionId, pane.paneId)
    }
    const closeOwnerFilePreview = (): void => {
      if (ownerFilePreviewReturnContext?.kind === 'domain-right-panel') {
        const registered = installedRightPanels.find(
          ({ id }) => id === ownerFilePreviewReturnContext.contributionId
        )
        if (!registered) {
          closeOwnerRightPanel()
          return
        }
        rebindRightPanelPaneForSession(ownerSessionId, pane.paneId, {
          mode: registered.id,
          panelActivation: ownerFilePreviewReturnContext.activation ?? null
        })
        return
      }
      updateRightPanelPaneForSession(ownerSessionId, pane.paneId, {
        filePreviewTarget: null,
        filePreviewReturnContext: null
      })
    }
    const previewOwnerWorkspaceReference = (reference: AgentRuntimeWorkspaceReference): void => {
      if (reference.kind === 'directory') return
      rebindRightPanelPaneForSession(ownerSessionId, pane.paneId, {
        mode: 'file',
        filePreviewReturnContext: null,
        filePreviewTarget: {
          path: reference.relativePath,
          workspaceRoot: reference.workspaceRoot || ownerWorkspaceRoot
        }
      })
    }
    const previewOwnerWorkspaceReferenceInNewPane = (
      reference: AgentRuntimeWorkspaceReference
    ): void => {
      if (reference.kind === 'directory') return
      addRightPanelPaneForSession(ownerSessionId, {
        mode: 'file',
        filePreviewReturnContext: null,
        filePreviewTarget: {
          path: reference.relativePath,
          workspaceRoot: reference.workspaceRoot || ownerWorkspaceRoot
        }
      }, {
        afterPaneId: pane.paneId,
        focus: true,
        width: Math.max(pane.width, CODE_PANEL_PREFERRED)
      })
    }
    const openOwnerFileTreeDirectory = (target: { workspaceRoot: string; path: string }): void => {
      const nextWorkspaceRoot = normalizeWorkspaceRoot(target.workspaceRoot || ownerWorkspaceRoot)
      rebindRightPanelPaneForSession(ownerSessionId, pane.paneId, {
        mode: 'file',
        fileTreeWorkspaceOverride: nextWorkspaceRoot || null,
        fileTreeInitialDirectory: {
          workspaceRoot: nextWorkspaceRoot,
          path: relativeWorkspacePath(target.path, nextWorkspaceRoot),
          nonce: Date.now()
        },
        filePreviewReturnContext: null,
        filePreviewTarget: null
      })
    }
    const ownerFileTreeWorkspaceRoot = pane.fileTreeWorkspaceOverride || ownerWorkspaceRoot
    const ownerFileTreeWorkspaceGroups = pane.fileTreeWorkspaceOverride
      ? [{
          id: `workspace:${pane.fileTreeWorkspaceOverride}`,
          label: t('rightPanelFiles'),
          workspaceRoot: pane.fileTreeWorkspaceOverride,
          kind: 'worktree' as const
        }]
      : snapshot.workspaceReferenceGroups
    return (
      <div className="flex h-full min-h-0 flex-col bg-ds-sidebar">
        <RightPanelVisibleContextRegistration
          active={active}
          mode={paneMode}
          sessionId={ownerSessionId}
          surfaceId={pane.paneId}
          focused={focused}
          width={pane.width}
          workspaceRoot={ownerWorkspaceRoot}
          filePreviewTarget={paneMode === 'file' ? ownerFilePreviewTarget : null}
          childAgentCount={childAgentCount}
          childAgentRunningCount={childAgentRunningCount}
          planId={activeGuiPlan?.id}
          sddDraftId={activeSddDraft?.id}
        />
        <div className="min-h-0 flex-1">
          <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
            {paneMode === 'file' ? (
              <div className="relative h-full max-h-full w-full overflow-hidden">
                <ChatFileTreePanel
                  workspaceRoot={ownerFileTreeWorkspaceRoot}
                  workspaceGroups={ownerFileTreeWorkspaceGroups}
                  selectedPath={ownerFilePreviewTarget?.path}
                  initialDirectory={pane.fileTreeInitialDirectory}
                  selectedReferences={snapshot.composerFileReferences}
                  className={`h-full max-h-full w-full ${ownerFilePreviewTarget ? 'hidden' : ''}`}
                  onPreviewFile={previewOwnerWorkspaceReference}
                  onPreviewFileInNewPane={previewOwnerWorkspaceReferenceInNewPane}
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
                          surfaceId={pane.paneId}
                          active={active}
                          className="h-full max-h-full w-full"
                          annotationQuestionBridge={annotationQuestionBridge}
                          onClose={closeOwnerFilePreview}
                          onOpenDirectory={openOwnerFileTreeDirectory}
                          onOpenFile={(nextTarget) => {
                            updateRightPanelPaneForSession(ownerSessionId, pane.paneId, {
                              filePreviewTarget: nextTarget
                            })
                          }}
                        />
                      </div>
                    </div>
                  </Suspense>
                ) : null}
              </div>
            ) : paneMode === 'sdd-ai' ? (
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
                    placeRightPanelPaneForSession(
                      newSessionId,
                      { mode: 'sdd-ai' },
                      'focused',
                      { width: 420 }
                    )
                  })
                }}
                onCollapse={closeOwnerRightPanel}
                className="h-full max-h-full w-full"
              />
            ) : paneMode === 'child-agents' ? (
              <SessionChildAgentsPanel
                sessionId={ownerSessionId}
                thread={ownerThread ?? null}
                busy={ownerBusy}
                focusChildId={pane.childPanelFocusRequest.childId}
                focusChildRequestKey={pane.childPanelFocusRequest.key}
                onOpenChildInFocus={(child) => { void openChildInFocus(child) }}
                className="h-full max-h-full w-full"
                onCollapse={closeOwnerRightPanel}
              />
            ) : paneMode === 'todo' ? (
              <TodoPanel
                threadId={ownerSessionId}
                className="h-full max-h-full w-full"
                onCollapse={closeOwnerRightPanel}
                onOpenPlan={() => {
                  setRightPanelPaneWidthForSession(
                    ownerSessionId,
                    pane.paneId,
                    (width) => Math.max(width, CODE_PANEL_PREFERRED)
                  )
                  rebindRightPanelPaneForSession(ownerSessionId, pane.paneId, { mode: 'plan' })
                }}
              />
            ) : installedRightPanel ? (
              installedRightPanel.render({
                active,
                focused,
                surfaceId: pane.paneId,
                className: 'h-full max-h-full w-full',
                onCollapse: closeOwnerRightPanel,
                session: {
                  id: ownerSessionId,
                  ...(ownerThread?.title ? { title: ownerThread.title } : {}),
                  ...(ownerThread?.runtimeId ? { runtimeId: ownerThread.runtimeId } : {}),
                  ...(ownerWorkspaceRoot ? { workspaceRoot: ownerWorkspaceRoot } : {})
                },
                ...(pane.panelActivation?.contributionId === installedRightPanel.id
                  ? { activation: pane.panelActivation }
                  : {})
              })
            ) : paneMode === 'plan' ? (
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
    const liveThread = threads.find((thread) => thread.id === workspace.sessionId) ?? null
    for (const pane of workspace.panes) {
      const previousSnapshot = sessionRightPanelSnapshotsRef.current.get(pane.instanceKey)
      const ownerBlocks = active
        ? blocks
        : threadBlocksById[workspace.sessionId] ?? previousSnapshot?.blocks ?? []
      const snapshot: SessionRightPanelRenderSnapshot = {
        sessionId: workspace.sessionId,
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
      sessionRightPanelSnapshotsRef.current.set(pane.instanceKey, snapshot)
      sessionRightPanelRenderers.set(
        pane.instanceKey,
        createSessionRightPanelRenderer(snapshot)
      )
    }
  }
  const residentInstanceKeys = new Set(
    rightPanelWorkspaces.flatMap((workspace) =>
      workspace.panes.map((pane) => pane.instanceKey)
    )
  )
  for (const instanceKey of sessionRightPanelSnapshotsRef.current.keys()) {
    if (!residentInstanceKeys.has(instanceKey)) {
      sessionRightPanelSnapshotsRef.current.delete(instanceKey)
    }
  }

  const rightPanelBindings = [
    ...RIGHT_PANEL_MODES.map((mode) => ({
      id: mode,
      label: t(rightPanelVisibleContextTitle(mode)),
      ...(mode === 'plan' && !activeGuiPlan ? { disabled: true } : {}),
      ...(mode === 'sdd-ai' && !activeSddDraft ? { disabled: true } : {})
    })),
    ...installedRightPanels.map(({ id, contribution }) => ({
      id,
      label: t(contribution.title)
    }))
  ]

  const renderRightPanel = (): ReactElement | null => {
    const hasResidentPanel = rightPanelWorkspaces.some((workspace) => workspace.panes.length > 0)
    if (!hasResidentPanel) return null
    return (
      <div
        className={rightPanelVisible
          ? 'h-full min-h-0 shrink-0 bg-ds-sidebar'
          : 'pointer-events-none fixed h-0 w-0 overflow-hidden invisible'}
        style={rightPanelVisible ? { width: rightPanelDockViewportWidth } : undefined}
        aria-hidden={!rightPanelVisible}
      >
        <SessionRightPanelStack
          activeSessionId={rightPanelVisible ? rightPanelOwnerId : null}
          workspaces={rightPanelWorkspaces}
          renderWorkspace={(workspace, active) => (
            <SessionRightPanelDock
              workspace={workspace}
              active={active}
              bindings={rightPanelBindings}
              labels={{
                dock: t('rightPanelDock'),
                pane: ({ index, bindingLabel, focused }) =>
                  t('rightPanelPane', {
                    index: index + 1,
                    label: bindingLabel,
                    focused: focused ? t('rightPanelPaneFocusedSuffix') : ''
                  }),
                back: t('rightPanelBack'),
                forward: t('rightPanelForward'),
                binding: t('rightPanelBinding'),
                split: t('rightPanelSplit'),
                splitAction: t('rightPanelNewPane'),
                close: t('close'),
                resize: t('rightPanelResize')
              }}
              onFocusPane={focusRightPanelPaneForSession}
              onNavigatePane={navigateRightPanelPaneHistoryForSession}
              onRebindPane={(sessionId, paneId, mode) => {
                rebindRightPanelPaneForSession(sessionId, paneId, { mode })
                if (installedRendererContributions.rightPanels.resolve(mode)) {
                  setRightPanelPaneWidthForSession(
                    sessionId,
                    paneId,
                    (width) => Math.max(width, CODE_PANEL_PREFERRED)
                  )
                }
              }}
              onSplitPane={splitRightPanelPaneForSession}
              onClosePane={closeRightPanelPaneForSession}
              onBeginResizePane={beginRightPanelPaneResize}
              renderPane={(pane, context) =>
                sessionRightPanelRenderers.get(pane.instanceKey)?.(pane, context) ?? null
              }
            />
          )}
        />
      </div>
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
            ...(activeThread?.title ? { title: activeThread.title } : {}),
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
              assistantOpen={focusedRightPanelMode === 'sdd-ai'}
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
                  <SessionHeader compact className="min-w-0 flex-1" />
                </div>
                <div className="chat-topbar-actions flex min-w-0 flex-wrap items-center justify-end gap-2 self-start">
                  <RemoteWorkspaceSelector />
                  {(focusedAgentSurface?.busy ?? busy) ? (
                    <span className="inline-flex shrink-0 rounded-full bg-amber-500/16 px-2.5 py-1 text-[11.5px] font-semibold text-amber-950 dark:text-amber-100">
                      {t('running')}
                    </span>
                  ) : null}
                  <WorkbenchTopBar
                    focusedRightPanelMode={focusedRightPanelMode}
                    onToggleFocusedRightPanelMode={toggleTopBarRightPanelMode}
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
                    childAgentsOpen={focusedRightPanelMode === 'child-agents'}
                    sideChatEnabled={Boolean(activeThreadId) && sideConversationsSupported}
                    onOpenChildAgents={() => toggleTopBarRightPanelMode('child-agents')}
                    onOpenSideChat={
                      activeThreadId && sideConversationsSupported ? openSideChat : undefined
                    }
                  />
                </div>
              </div>
            </header>
            {focusNavigationLineage.length > 1 || agentFocusHistory.length > 1 ? (
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
            {(
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
                    composerModel={composerModel}
                    composerPickList={composerPickList}
                    composerModelGroups={composerModelGroups}
                    activeAgentRuntime={activeAgentRuntime}
                    runtimeLocked={modelAccessMode === 'coding-plan'}
                    composerReasoningEffort={
                      route === 'chat' ? composerReasoningEffort : undefined
                    }
                    onComposerModelChange={setComposerModel}
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
                    fileReferenceEnabled={route === 'chat' && !activeSddDraft}
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
                          ...(activeThread?.title ? { title: activeThread.title } : {}),
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
          </section>
          )}
          </div>

          {route === 'chat' && !activeSddDraft ? (
            <SideConversationPanel
              rightOffset={rightPanelVisible ? rightPanelDockViewportWidth + 24 : 24}
            />
          ) : null}

          {renderRightPanel()}
        </div>

          </>
        )}
      </main>
    </div>
  )
}

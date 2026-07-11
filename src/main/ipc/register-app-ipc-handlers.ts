import { app, dialog, ipcMain, nativeImage, shell, type BrowserWindow, type NativeImage, type WebContents } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { mainPerformanceMonitor } from '../performance-monitor'
import {
  getImageGenerationSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ScheduleRunResult,
  type ScheduleRuntimeStatus,
  type ScheduleTaskFromTextResult,
  type WorkflowCodeCheckResult,
  type WorkflowNodeTestResult,
  type WorkflowRunResult,
  type WorkflowRuntimeStatus
} from '../../shared/app-settings'
import type {
  ConnectPhoneInstallPollResult,
  ConnectPhoneInstallQrResult,
  ConnectPhoneRuntimeStatus,
  DagPanelStatus,
  DesktopCommand,
  LocalDrawioUrlResult,
  ModelRouterConfigOpenResult,
  SystemNotificationResult,
  TurnCompleteNotificationPayload,
  UpstreamModelsResult,
  WorkspacePickResult
} from '../../shared/sciforge-api'
import type { WorkspaceFileWatchResult } from '../../shared/workspace-file'
import type { GuiUpdateDownloadResult, GuiUpdateInfo, GuiUpdateInstallResult, GuiUpdateState } from '../../shared/gui-update'
import {
  agentRuntimeConnectPayloadSchema,
  agentRuntimeAuxiliaryPayloadSchema,
  agentRuntimeApprovalResolvePayloadSchema,
  discordBindChannelPayloadSchema,
  discordConfigureClientPayloadSchema,
  discordConfigureProxyPayloadSchema,
  discordConfigureTokenPayloadSchema,
  discordGuildChannelsPayloadSchema,
  discordSetGuardPayloadSchema,
  discordTestSendPayloadSchema,
  zulipBindChannelPayloadSchema,
  zulipConfigurePayloadSchema,
  zulipSetGuardPayloadSchema,
  zulipStreamTopicsPayloadSchema,
  zulipTestSendPayloadSchema,
  agentRuntimeEventSubscribePayloadSchema,
  agentRuntimeListThreadsPayloadSchema,
  agentRuntimeReadThreadPayloadSchema,
  agentRuntimeReadThreadSidebarProbePayloadSchema,
  agentRuntimeSessionResumePayloadSchema,
  agentRuntimeStartThreadPayloadSchema,
  agentRuntimeStartTurnPayloadSchema,
  agentRuntimeThreadCompactPayloadSchema,
  agentRuntimeThreadDeletePayloadSchema,
  agentRuntimeThreadForkPayloadSchema,
  agentRuntimeThreadRelationPayloadSchema,
  agentRuntimeThreadRenamePayloadSchema,
  agentRuntimeTurnSteerPayloadSchema,
  agentRuntimeTurnTargetPayloadSchema,
  agentRuntimeUsagePayloadSchema,
  agentRuntimeUserInputResolvePayloadSchema,
  connectPhoneInstallPollPayloadSchema,
  connectPhoneInstallQrPayloadSchema,
  computerUsePermissionKindSchema,
  remoteChannelActiveThreadContextPayloadSchema,
  remoteChannelMirrorPayloadSchema,
  remoteChannelTaskFromTextPayloadSchema,
  runtimeConfigContentSchema,
  desktopCommandSchema,
  evidenceDagEvidencePreviewResolvePayloadSchema,
  evidenceDagUpdatePayloadSchema,
  evidenceDagViewPayloadSchema,
  projectDagGoalSavePayloadSchema,
  projectDagEvidencePreviewResolvePayloadSchema,
  projectDagUpdatePayloadSchema,
  projectDagViewPayloadSchema,
  defaultPathSchema,
  figureStyleEvaluatePayloadSchema,
  figureStyleExtractReferencePayloadSchema,
  figureStyleReviewPayloadSchema,
  figureStyleExtractPayloadSchema,
  figureStyleSaveSpecPayloadSchema,
  pptMasterMcpConfigPayloadSchema,
  sciforgeCanvasImportRecentArtifactsPayloadSchema,
  sciforgeCanvasInsertArtifactPayloadSchema,
  sciforgeCanvasMcpConfigPayloadSchema,
  sciforgeCanvasOpenPayloadSchema,
  sciforgeCanvasReviewPacketPayloadSchema,
  sciforgeCanvasSavePayloadSchema,
  sciforgeCanvasSelectionSavePayloadSchema,
  sciforgeCanvasSplitArtifactComponentsPayloadSchema,
  scientificPlottingPrepareReferencePayloadSchema,
  scientificPlottingMcpConfigPayloadSchema,
  scientificPlottingStatusPayloadSchema,
  scientificSkillsInstallPayloadSchema,
  scientificSkillsMcpConfigPayloadSchema,
  gitBranchPayloadSchema,
  guiUpdateChannelSchema,
  logErrorPayloadSchema,
  notificationPayloadSchema,
  openEditorPathPayloadSchema,
  paperRadarArxivSyncPayloadSchema,
  paperRadarBiorxivSyncPayloadSchema,
  paperRadarDigestPayloadSchema,
  paperRadarProfilePayloadSchema,
  paperRadarProfileSyncPayloadSchema,
  paperRadarRankPayloadSchema,
  paperRadarReviewPayloadSchema,
  paperRadarSearchPayloadSchema,
  researchCardArchivePayloadSchema,
  researchCardCreatePayloadSchema,
  researchCardListPayloadSchema,
  researchCardUpdatePayloadSchema,
  visibleContextCapturePreviewPayloadSchema,
  visibleContextPublishPayloadSchema,
  rootPathSchema,
  scheduleTaskFromTextPayloadSchema,
  shellOpenExternalUrlSchema,
  speechTranscriptionPayloadSchema,
  skillListPayloadSchema,
  skillSaveFilePayloadSchema,
  settingsPatchSchema,
  streamIdSchema,
  workspaceEntryCopyPayloadSchema,
  workspaceDirectoryCreatePayloadSchema,
  workspaceClipboardImageSavePayloadSchema,
  workspaceClipboardPastePayloadSchema,
  workspaceDirectoryTargetPayloadSchema,
  workspaceEntryDeletePayloadSchema,
  workspaceEntryImportPayloadSchema,
  workspaceEntryMovePayloadSchema,
  workspaceEntryRenamePayloadSchema,
  workspacePreviewApplyEditPayloadSchema,
  workspacePreviewDescribeAssetPayloadSchema,
  workspacePreviewExportPayloadSchema,
  workspacePreviewInvokeActionPayloadSchema,
  workspaceNativeFileDragPayloadSchema,
  workspacePreviewPrepareArtifactPayloadSchema,
  workspacePreviewListPluginsPayloadSchema,
  workspacePreviewObservePayloadSchema,
  workspacePreviewOpenPayloadSchema,
  workspacePreviewReadArtifactRangePayloadSchema,
  workspacePreviewReadRangePayloadSchema,
  workspacePreviewReleaseSessionPayloadSchema,
  workspaceFileCreatePayloadSchema,
  workspaceFileTargetPayloadSchema,
  workspaceFileWatchPayloadSchema,
  workspaceFileWritePayloadSchema,
  writeExportPayloadSchema,
  writeRichClipboardPayloadSchema,
  writeInlineCompletionPayloadSchema,
  writeRetrievalPayloadSchema,
  workflowCodeCheckPayloadSchema,
  workflowResolveApprovalPayloadSchema,
  workflowRunNodePayloadSchema,
  workflowTestNodePayloadSchema,
  workspaceRootSchema
} from './app-ipc-schemas'
import {
  emptyVisibleContextSnapshot,
  type VisibleContextSnapshot
} from '../../shared/visible-context'
import {
  buildScientificSkillsMcpConfigFragment,
  type ScientificSkillsMcpLaunchConfig
} from '../scientific-skills-mcp-config'
import {
  buildScientificPlottingMcpConfigFragment,
  type ScientificPlottingMcpLaunchConfig
} from '../scientific-plotting-mcp-config'
import {
  buildBgcDiscoveryMcpConfigFragment,
  type BgcDiscoveryMcpLaunchConfig
} from '../bgc-discovery-mcp-config'
import {
  buildImageGenerationMcpConfigFragment,
  type ImageGenerationMcpLaunchConfig
} from '../image-generation-mcp-config'
import {
  buildSciforgeCanvasMcpConfigFragment,
  type SciforgeCanvasMcpLaunchConfig
} from '../sciforge-canvas-mcp-config'
import {
  buildPptMasterMcpConfigFragment,
  type PptMasterMcpLaunchConfig
} from '../ppt-master-mcp-config'
import {
  getScientificPlottingStatus,
  prepareScientificPlottingReference
} from '../../../packages/workers/scientific-plotting/src/scientific-plotting-engine'
import {
  exportSciforgeCanvasReviewPacket,
  getSciforgeCanvasStatus,
  importRecentSciforgeCanvasArtifacts,
  insertSciforgeCanvasArtifact,
  openOrCreateSciforgeCanvas,
  saveSciforgeCanvasSelection,
  saveSciforgeCanvasSnapshot,
  splitSciforgeCanvasArtifactComponents
} from '../../../packages/workers/canvas/src/sciforge-canvas-engine'
import {
  buildScientificSkillsIndex,
  buildScientificSkillsStatusSummary
} from '../../../packages/workers/scientific-plotting/src/scientific-skills-index'
import {
  installScientificSkills,
  type ScientificSkillsInstallRequest,
  type ScientificSkillsInstallResult
} from '../../../packages/workers/scientific-plotting/src/scientific-skills-installer'
import {
  evaluateFigureStyleSimilarity,
  extractFigureStyle,
  reviewFigureStyleOutput
} from '../../../packages/workers/scientific-plotting/src/figure-style-extractor'
import type {
  FigureStyleExtractRequest,
  FigureStyleExtractReferenceRequest,
  FigureStyleExtractReferenceResult,
  FigureStyleExtractResult,
  FigureStyleReviewRequest,
  FigureStyleReviewResult,
  FigureStyleSaveSpecRequest,
  FigureStyleSaveSpecResult,
  FigureStyleSimilarityRequest,
  FigureStyleSimilarityResult
} from '../../shared/figure-style'
import {
  buildFigureStyleArtifactPath,
  serializeFigureStyleSpecPayload
} from '../../shared/figure-style-actions'
import type {
  ScientificPlottingPrepareReferenceRequest,
  ScientificPlottingPrepareReferenceResult,
  ScientificPlottingStatusResult
} from '../../shared/scientific-plotting'
import {
  EVIDENCE_DAG_API_KEY_ENV,
  EVIDENCE_DAG_SERVICE_URL_ENV,
  evidenceDagApiKeyFromEnv,
  evidenceDagServiceUrlFromEnv,
  evidenceDagThreadId,
  evidenceDagUiUrl
} from '../../../packages/workers/evidence-dag/desktop/contract'
import {
  DEFAULT_PROJECT_DAG_SERVICE_URL,
  projectDagApiKeyFromEnv,
  PROJECT_DAG_SERVICE_VERSION,
  projectDagServiceUrlFromEnv,
  projectDagUiUrl
} from '../../../packages/workers/project-dag/desktop/contract'
import type {
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeId,
  AgentRuntimeItem,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeThreadListInput,
  AgentRuntimeThreadReadInput,
  AgentRuntimeThreadSidebarProbe,
  AgentRuntimeThreadStartInput,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput,
  AgentRuntimeTurnSteerInput,
  AgentRuntimeTurnTargetInput,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from '../../shared/agent-runtime-contract'
import type {
  SpeechTranscriptionRequest,
  SpeechTranscriptionResult
} from '../../shared/speech-to-text'
import {
  evaluateEvidenceDagHighImpactGate,
  type EvidenceDagGateMetadata
} from '../../shared/evidence-dag-gate'
import type { PaperRadarApiResult } from '../../shared/paper-radar'
import type { ResearchCardService } from '../services/research-card-service'
import type {
  AgentRuntimeApprovalResolveInput,
  AgentRuntimeEventSubscribeInput,
  AgentRuntimeSessionResumeHandle,
  AgentRuntimeSessionResumeInput,
  AgentRuntimeThreadCompactInput,
  AgentRuntimeThreadDeleteInput,
  AgentRuntimeThreadForkInput,
  AgentRuntimeThreadRelationInput,
  AgentRuntimeThreadRenameInput,
  AgentRuntimeUserInputResolveInput
} from '../runtime/agent-runtime/adapter'
import type { JsonSettingsStore } from '../settings-store'
import type { RemoteChannelRuntime } from '../remote-channel-runtime'
import type { DiscordBotRuntime } from '../discord-bot-runtime'
import type { ZulipBotRuntime } from '../zulip-bot-runtime'
import type { ScheduleRuntime } from '../schedule-runtime'
import type { PaperRadarWorkerService } from '../services/paper-radar-worker-service'
import { resolveEvidenceDagEvidencePreview } from '../services/evidence-dag-evidence-preview'
import { resolveProjectDagEvidencePreview } from '../services/project-dag-evidence-preview'
import { checkWorkflowCode, type WorkflowRuntime } from '../workflow-runtime'
import { createAndSwitchGitBranch, getGitBranches, switchGitBranch } from '../services/git-service'
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  copyWorkspaceEntry,
  deleteWorkspaceEntry,
  expandHomePath,
  importWorkspaceEntries,
  listEditorsResult,
  listWorkspaceDirectory,
  normalizeSkillFolderName,
  openEditorPath,
  openPathWithShell,
  pasteWorkspaceClipboard,
  readClipboardImage,
  readWorkspaceImage,
  readWorkspaceFile,
  moveWorkspaceEntry,
  renameWorkspaceEntry,
  resolveWorkspaceFile,
  saveWorkspaceClipboardImage,
  writeWorkspaceFile
} from '../services/workspace-service'
import {
  clearWriteInlineCompletionDebugEntries,
  listWriteInlineCompletionDebugEntries,
  requestWriteInlineCompletion
} from '../services/write-inline-completion-service'
import { retrieveWriteContext } from '../services/write-retrieval-service'
import { requestSpeechTranscription } from '../services/speech-to-text-service'
import {
  getComputerUsePermissions,
  requestComputerUsePermission
} from '../services/computer-use-permissions'
import { readComputerUseRuntimeStatus } from '../services/computer-use-status'
import { copyWriteDocumentAsRichText, exportWriteDocument } from '../services/write-export-service'
import { listGuiSkills } from '../services/skill-service'
import { WorkspacePreviewHost } from '../services/workspace-preview'
import {
  acknowledgeEvidenceDagSnapshot,
  enqueueProjectFresh,
  ensureEvidenceDagFresh,
  evidenceDagQueueStatus,
  type EvidenceDagQueueStatus,
  type EvidenceSnapshot
} from '../runtime/evidence-dag-feed'
import type { TerminalPtyBridge } from '../terminal/terminal-pty-ipc'

type GuiUpdaterModule = typeof import('../gui-updater')

type WorkspaceFileWatchRecord = {
  watcher: FSWatcher
  sender: AppBridgeSender
  path: string
  workspaceRoot: string
  kind: 'legacy-file' | 'workspace-preview'
  changeChannel: 'file:workspace-changed' | 'workspacePreview:changed'
  timer: ReturnType<typeof setTimeout> | null
}

type AgentRuntimeEventStreamRecord = {
  controller: AbortController
  sender: AppBridgeSender
  onSenderDestroyed: () => void
}

type WorkspacePreviewSenderSessionRecord = {
  sender: AppBridgeSender
  sessionIds: Set<string>
  onSenderDestroyed: () => void
}

export type AppBridgeSender = {
  id: number
  isDestroyed: () => boolean
  send: (channel: string, ...args: unknown[]) => void
  once: (event: 'destroyed', listener: () => void) => unknown
  removeListener: (event: 'destroyed', listener: () => void) => unknown
}

type AppBridgeInvokeEvent = {
  sender: AppBridgeSender
}

type AppBridgeInvokeHandler = (
  event: AppBridgeInvokeEvent,
  payload?: unknown
) => Promise<unknown> | unknown

export type AppBridgeDispatcher = {
  invoke: (channel: string, payload: unknown, sender: AppBridgeSender) => Promise<unknown>
}

type RegisterAppIpcHandlersOptions = {
  store: JsonSettingsStore
  getMainWindow: () => BrowserWindow | null
  applySettingsPatch: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  agentRuntime?: {
    connect: (runtimeId?: AgentRuntimeId) => Promise<void>
    capabilities: (runtimeId?: AgentRuntimeId) => Promise<AgentRuntimeCapabilities>
    listThreads: (input?: AgentRuntimeThreadListInput) => Promise<AgentRuntimeThread[]>
    startThread: (input: AgentRuntimeThreadStartInput) => Promise<AgentRuntimeThread>
    readThread: (input: AgentRuntimeThreadReadInput) => Promise<AgentRuntimeThreadDetail>
    readThreadSidebarProbe: (input: AgentRuntimeThreadReadInput) => Promise<AgentRuntimeThreadSidebarProbe>
    startTurn: (input: AgentRuntimeTurnStartInput) => Promise<AgentRuntimeTurnHandle>
    interruptTurn: (input: AgentRuntimeTurnTargetInput) => Promise<void>
    steerTurn: (input: AgentRuntimeTurnSteerInput) => Promise<void>
    renameThread: (input: AgentRuntimeThreadRenameInput) => Promise<void>
    deleteThread: (input: AgentRuntimeThreadDeleteInput) => Promise<void>
    compactThread: (input: AgentRuntimeThreadCompactInput) => Promise<void>
    forkThread: (input: AgentRuntimeThreadForkInput) => Promise<AgentRuntimeThread>
    resumeSession: (input: AgentRuntimeSessionResumeInput) => Promise<AgentRuntimeSessionResumeHandle>
    updateThreadRelation: (input: AgentRuntimeThreadRelationInput) => Promise<void>
    usage: (input: AgentRuntimeUsageQuery) => Promise<AgentRuntimeUsageResponse>
    auxiliary: (input: AgentRuntimeAuxiliaryInput) => Promise<unknown>
    subscribeEvents: (input: AgentRuntimeEventSubscribeInput) => AsyncIterable<unknown>
    resolveApproval: (input: AgentRuntimeApprovalResolveInput) => Promise<void>
    resolveUserInput: (input: AgentRuntimeUserInputResolveInput) => Promise<void>
  }
  fetchUpstreamModels: () => Promise<UpstreamModelsResult>
  getRemoteChannelRuntime: () => RemoteChannelRuntime | null
  getDiscordBotRuntime?: () => DiscordBotRuntime | null
  getZulipBotRuntime?: () => ZulipBotRuntime | null
  visibleContext?: {
    publish: (snapshot: VisibleContextSnapshot) => Promise<VisibleContextSnapshot>
    get: () => Promise<VisibleContextSnapshot>
    readCapturePreview: (path: string) => Promise<{
      ok: true
      path: string
      dataUrl: string
      mimeType: 'image/png'
      size: number
    } | { ok: false; message: string }>
  }
  setRemoteChannelActiveThreadContext?: (payload: {
    threadId: string
    runtimeId?: AgentRuntimeId
    workspaceRoot?: string
  } | null) => void
  getScheduleRuntime: () => ScheduleRuntime | null
  getWorkflowRuntime?: () => WorkflowRuntime | null
  startFeishuInstallQrcode: (isLark: boolean) => Promise<ConnectPhoneInstallQrResult>
  pollFeishuInstall: (deviceCode: string) => Promise<ConnectPhoneInstallPollResult>
  startWeixinInstallQrcode: (weixinBridgeUrl?: string) => Promise<ConnectPhoneInstallQrResult>
  pollWeixinInstall: (deviceCode: string, weixinBridgeUrl?: string) => Promise<ConnectPhoneInstallPollResult>
  resolveRuntimeConfigPath: () => string
  openModelRouterConfigFile: (settings: AppSettingsV1) => Promise<ModelRouterConfigOpenResult>
  getPaperRadarService?: () => PaperRadarWorkerService | null
  researchCards?: ResearchCardService
  onRuntimeMcpConfigWritten?: (path: string, content: string) => Promise<void> | void
  showTurnCompleteNotification: (
    payload: TurnCompleteNotificationPayload
  ) => Promise<SystemNotificationResult>
  getAppVersion: () => string
  readGuiUpdateState: () => Promise<GuiUpdateState>
  loadGuiUpdaterModule: () => Promise<GuiUpdaterModule>
  resolveLogDirectory: () => string
  terminalPtyBridge?: TerminalPtyBridge
  workspacePreviewHost?: Pick<WorkspacePreviewHost,
    | 'listPlugins'
    | 'open'
    | 'observe'
    | 'describeAsset'
    | 'readRange'
    | 'prepareArtifact'
    | 'readArtifactRange'
    | 'applyEdit'
    | 'exportPreview'
    | 'invokeAction'
    | 'releaseSession'
    | 'prepareWatch'
    | 'createWatchSnapshot'
  >
  getMainPerformanceSnapshot?: () => unknown
  getScientificSkillsMcpLaunchConfig?: () => ScientificSkillsMcpLaunchConfig
  getScientificPlottingMcpLaunchConfig?: () => ScientificPlottingMcpLaunchConfig
  getBgcDiscoveryMcpLaunchConfig?: () => BgcDiscoveryMcpLaunchConfig
  getImageGenerationMcpLaunchConfig?: () => ImageGenerationMcpLaunchConfig
  getSciforgeCanvasMcpLaunchConfig?: () => SciforgeCanvasMcpLaunchConfig
  getPptMasterMcpLaunchConfig?: () => PptMasterMcpLaunchConfig
  getLocalDrawioUrl?: () => Promise<LocalDrawioUrlResult> | LocalDrawioUrlResult
  installScientificSkills?: (request: ScientificSkillsInstallRequest) => Promise<ScientificSkillsInstallResult>
  getScientificPlottingStatus?: () => Promise<ScientificPlottingStatusResult>
  prepareScientificPlottingReference?: (
    request: ScientificPlottingPrepareReferenceRequest
  ) => Promise<ScientificPlottingPrepareReferenceResult>
  getSciforgeCanvasStatus?: typeof getSciforgeCanvasStatus
  openOrCreateSciforgeCanvas?: typeof openOrCreateSciforgeCanvas
  saveSciforgeCanvasSnapshot?: typeof saveSciforgeCanvasSnapshot
  saveSciforgeCanvasSelection?: typeof saveSciforgeCanvasSelection
  insertSciforgeCanvasArtifact?: typeof insertSciforgeCanvasArtifact
  importRecentSciforgeCanvasArtifacts?: typeof importRecentSciforgeCanvasArtifacts
  splitSciforgeCanvasArtifactComponents?: typeof splitSciforgeCanvasArtifactComponents
  exportSciforgeCanvasReviewPacket?: typeof exportSciforgeCanvasReviewPacket
  extractFigureStyle?: (request: FigureStyleExtractRequest) => Promise<FigureStyleExtractResult>
  evaluateFigureStyle?: (request: FigureStyleSimilarityRequest) => Promise<FigureStyleSimilarityResult>
  reviewFigureStyle?: (request: FigureStyleReviewRequest) => Promise<FigureStyleReviewResult>
  extractFigureStyleReference?: (
    request: FigureStyleExtractReferenceRequest
  ) => Promise<FigureStyleExtractReferenceResult>
  saveFigureStyleSpec?: (request: FigureStyleSaveSpecRequest) => Promise<FigureStyleSaveSpecResult>
  logError: (category: string, message: string, detail?: unknown) => void
  ensureEvidenceDagReady?: () => Promise<void>
  ensureProjectDagReady?: () => Promise<void>
  transcribeSpeech?: (
    settings: AppSettingsV1,
    request: SpeechTranscriptionRequest
  ) => Promise<SpeechTranscriptionResult>
}

function parseIpcPayload<T>(channel: string, schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new Error(`Invalid payload for ${channel}: ${issue?.message ?? 'Bad request.'}`)
}

function inferFigureStyleReferenceSourceType(
  sourcePath: string,
  explicit?: FigureStyleExtractReferenceRequest['sourceType']
): 'image' | 'pdf' {
  if (explicit) return explicit
  return sourcePath.trim().toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'
}

function workspaceRelativePathForIpc(path: string, workspaceRoot: string): string | null {
  const trimmedPath = path.trim()
  if (!trimmedPath) return null
  if (!isAbsolute(trimmedPath) && !/^[A-Za-z]:[\\/]/.test(trimmedPath)) {
    return trimmedPath.replace(/\\/g, '/')
  }
  const relativePath = relative(workspaceRoot, trimmedPath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return null
  return relativePath.replace(/\\/g, '/')
}

const EVIDENCE_DAG_VIEW_HEALTH_TIMEOUT_MS = 1500

function evidenceDagViewConfig(env: Record<string, string | undefined>): {
  serviceUrl: string
  apiKey: string
} {
  const serviceUrl = evidenceDagServiceUrlFromEnv(env)
  const apiKey = evidenceDagApiKeyFromEnv(env)
  if (!serviceUrl || !apiKey) {
    throw new Error(
      `Evidence DAG is not ready. The app starts it from Model Router settings; check Model Router status or set ${EVIDENCE_DAG_SERVICE_URL_ENV} and ${EVIDENCE_DAG_API_KEY_ENV} for a manual sidecar.`
    )
  }
  return { serviceUrl, apiKey }
}

async function assertEvidenceDagServiceReachable(
  serviceUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch | undefined = globalThis.fetch
): Promise<void> {
  if (typeof fetchImpl !== 'function') return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EVIDENCE_DAG_VIEW_HEALTH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(`${serviceUrl}/version`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`version returned HTTP ${response.status}`)
    }
    const body = await response.json().catch(() => null) as { data?: { service?: unknown } } | null
    if (body?.data?.service !== 'evidence-dag-engine') {
      throw new Error('unexpected Evidence DAG service response')
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Evidence DAG service is not reachable at ${serviceUrl}: ${detail}`)
  } finally {
    clearTimeout(timer)
  }
}

async function requestEvidenceDagJson(
  serviceUrl: string,
  apiKey: string,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch | undefined = globalThis.fetch,
  timeoutMs?: number
): Promise<unknown> {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Evidence DAG fetch API is unavailable.')
  }
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${apiKey}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const controller = timeoutMs ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined
  let response: Response
  try {
    response = await fetchImpl(`${serviceUrl}${path}`, {
      ...init,
      headers,
      ...(controller ? { signal: controller.signal } : {})
    })
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(`Evidence DAG request timed out after ${timeoutMs} ms.`)
    }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
  const body = await response.json().catch(() => null) as {
    ok?: boolean
    data?: unknown
    error?: { message?: unknown }
  } | null
  if (!response.ok || body?.ok !== true) {
    const message = typeof body?.error?.message === 'string'
      ? body.error.message
      : `Evidence DAG returned HTTP ${response.status}`
    throw new Error(message)
  }
  return body.data
}

function evidenceDagBackfillItems(detail: AgentRuntimeThreadDetail): AgentRuntimeItem[] {
  if (detail.items?.length) return [...detail.items]
  return (detail.turns ?? []).flatMap((turn) => turn.items ?? [])
}

async function evidenceDagThreadUpdateSource(
  input: { runtimeId: AgentRuntimeId; threadId: string },
  agentRuntime?: RegisterAppIpcHandlersOptions['agentRuntime']
): Promise<{ detail: AgentRuntimeThreadDetail; items: AgentRuntimeItem[] }> {
  if (!agentRuntime) {
    throw new Error('Agent runtime is required to build the current thread Evidence DAG.')
  }
  const detail = await agentRuntime.readThread({
    runtimeId: input.runtimeId,
    threadId: input.threadId
  })
  const items = evidenceDagBackfillItems(detail)
  return { detail, items }
}

function projectDagWorkspaceScopeKey(value: string | undefined): string {
  const normalized = (value ?? '').trim().replace(/[\\/]+$/, '').replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function projectDagSessionScopeForWorkspace(
  input: { workspaceRoot?: string; projectRoot?: string; sessions?: string[] },
  agentRuntime?: RegisterAppIpcHandlersOptions['agentRuntime']
): Promise<string[] | undefined> {
  if (input.sessions) return [...new Set(input.sessions.map((session) => session.trim()).filter(Boolean))].sort()
  const workspaceRoot = input.projectRoot?.trim() || input.workspaceRoot?.trim()
  if (!workspaceRoot) return undefined
  if (!agentRuntime) {
    throw new Error('Project DAG requires agent runtime session scope for the current project.')
  }
  const wanted = projectDagWorkspaceScopeKey(workspaceRoot)
  if (!wanted) return undefined
  const threads = await agentRuntime.listThreads({
    limit: 1_000,
    includeArchived: false,
    includeSide: true
  })
  const scoped = threads
    .filter((thread) => projectDagWorkspaceScopeKey(thread.workspace) === wanted)
    .map((thread) => evidenceDagThreadId(thread.runtimeId, thread.id))
  return [...new Set(scoped)].sort()
}

async function projectDagRuntimeThreadsForScope(
  input: {
    workspaceRoot?: string
    projectRoot?: string
    sessions?: string[]
    scope?: 'all' | string[]
    excludedSessions?: string[]
    isolatedSessions?: string[]
  },
  agentRuntime?: RegisterAppIpcHandlersOptions['agentRuntime']
): Promise<AgentRuntimeThread[]> {
  if (!agentRuntime) throw new Error('Project DAG requires agent runtime sessions for the current project.')
  const sessionScope = await projectDagSessionScopeForWorkspace(input, agentRuntime)
  const requested = input.scope === 'all'
    ? sessionScope
    : Array.isArray(input.scope)
      ? input.scope
      : sessionScope
  const wanted = requested ? new Set(requested) : undefined
  const threads = await agentRuntime.listThreads({ limit: 1_000, includeArchived: false, includeSide: true })
  return threads.filter((thread) => !wanted || wanted.has(evidenceDagThreadId(thread.runtimeId, thread.id)))
}

type WriteExportIpcPayload = z.infer<typeof writeExportPayloadSchema>

type EvidenceDagAuditForGate = {
  riskDigest?: unknown
  auditCompletedAt?: string
  auditUnavailableReason?: string
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function optionalStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function finiteNumberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  return Array.isArray(value)
    ? [...new Set(value
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .map((item) => item.trim()))].sort()
    : []
}

function snapshotDigest(value: unknown): string | undefined {
  const record = objectRecord(value)
  return record ? optionalStringField(record, 'digest') : undefined
}

function dagFreshness(value: unknown): DagPanelStatus['freshness'] | undefined {
  if (value === 'fresh' || value === 'dirty' || value === 'queued' || value === 'updating' ||
      value === 'failed' || value === 'paused' || value === 'degraded') return value
  if (value === 'running') return 'updating'
  if (value === 'pending') return 'queued'
  if (value === 'error' || value === 'update_failed') return 'failed'
  if (value === 'empty') return 'dirty'
  return undefined
}

function dagPanelStatus(value: unknown, local?: EvidenceDagQueueStatus): DagPanelStatus {
  const record = objectRecord(value) ?? {}
  const snapshot = objectRecord(record.snapshot ?? record.committedSnapshot)
  const workerPending = finiteNumberField(record, 'pending') ?? finiteNumberField(record, 'pendingCount') ?? 0
  const localFreshness = local
    ? dagFreshness(local.state)
    : undefined
  const freshness = localFreshness && localFreshness !== 'fresh'
    ? localFreshness
    : dagFreshness(record.state) ?? dagFreshness(record.status) ?? dagFreshness(record.freshness) ??
      (workerPending > 0 ? 'queued' : 'fresh')
  const latestSnapshotDigest = snapshotDigest(snapshot)
  const auditTargetDigest = optionalStringField(record, 'auditTargetDigest')
  const latestJob = Array.isArray(record.jobs)
    ? objectRecord(record.jobs.find((job) => Boolean(objectRecord(job)?.last_error)))
    : null
  const lastError = local?.lastError ?? optionalStringField(record, 'error') ??
    (latestJob ? optionalStringField(latestJob, 'last_error') : undefined)
  const autonomy = objectRecord(record.autonomy)
  const autonomyMode = record.autonomyMode ?? autonomy?.autonomyMode ?? autonomy?.autonomy_mode
  const evidenceVector = Array.isArray(snapshot?.evidenceVector) ? snapshot.evidenceVector : []
  const includedSessions = evidenceVector.flatMap((entry) => {
    const item = objectRecord(entry)
    const threadId = item ? optionalStringField(item, 'threadId') : undefined
    return threadId ? [threadId] : []
  })
  const excludedSessions = snapshot ? stringArrayField(snapshot, 'excludedSessions') : []
  const isolatedSessions = snapshot ? stringArrayField(snapshot, 'isolatedSessions') : []
  return {
    freshness,
    pendingCount: Math.max(workerPending, local?.pendingCount ?? 0),
    ...(latestSnapshotDigest ? { latestSnapshotDigest, viewedSnapshotDigest: latestSnapshotDigest } : {}),
    ...(local?.desiredWatermark || optionalStringField(record, 'desiredWatermark') ? {
      desiredWatermark: local?.desiredWatermark ?? optionalStringField(record, 'desiredWatermark')
    } : {}),
    ...(local?.committedWatermark || optionalStringField(snapshot ?? {}, 'inputWatermark') ? {
      committedWatermark: local?.committedWatermark ?? optionalStringField(snapshot ?? {}, 'inputWatermark')
    } : {}),
    ...(auditTargetDigest ? { auditTargetDigest } : {}),
    ...(typeof record.auditStale === 'boolean' ? { auditStale: record.auditStale } : {}),
    ...(finiteNumberField(record, 'attentionCount') !== undefined ? {
      attentionCount: finiteNumberField(record, 'attentionCount')
    } : {}),
    ...(finiteNumberField(record, 'missingArtifactCount') !== undefined ? {
      missingArtifactCount: finiteNumberField(record, 'missingArtifactCount')
    } : {}),
    ...(autonomyMode === 'autonomous' || autonomyMode === 'checkpointed' || autonomyMode === 'supervised'
      ? { autonomyMode }
      : {}),
    ...(lastError ? { lastError } : {}),
    ...(optionalStringField(record, 'degradedReason') ? {
      degradedReason: optionalStringField(record, 'degradedReason')
    } : {}),
    ...(local?.nextAttemptAt ? { nextAttemptAt: local.nextAttemptAt } : {}),
    ...((includedSessions.length || excludedSessions.length || isolatedSessions.length) ? {
      scope: { includedSessions, excludedSessions, isolatedSessions }
    } : {})
  }
}

function projectDagPanelStatus(
  value: unknown,
  evidenceStatuses: EvidenceDagQueueStatus[] = [],
  sessionCount = evidenceStatuses.length
): DagPanelStatus {
  const status = dagPanelStatus(value)
  const activeEvidence = evidenceStatuses.filter((item) =>
    item.state === 'queued' || item.state === 'updating' || item.state === 'failed' || item.pendingCount > 0)
  const degradedEvidence = evidenceStatuses.find((item) => item.state === 'degraded')
  const totalItems = Math.max(sessionCount, evidenceStatuses.length)
  if (activeEvidence.length > 0) {
    const failed = activeEvidence.find((item) => item.state === 'failed' || item.state === 'degraded')
    const updating = activeEvidence.some((item) => item.state === 'updating')
    const projectPhase = activeEvidence.some((item) => item.phase === 'project')
    const completedItems = evidenceStatuses.filter((item) =>
      item.state === 'fresh' || item.phase === 'project').length
    const updatedAt = activeEvidence
      .map((item) => item.updatedAt)
      .filter((item): item is string => Boolean(item))
      .sort()
      .at(-1)
    return {
      ...status,
      freshness: failed ? 'failed' : updating ? 'updating' : 'queued',
      pendingCount: Math.max(status.pendingCount, activeEvidence.length),
      ...(failed?.lastError ? { lastError: failed.lastError } : {}),
      ...(failed?.nextAttemptAt ? { nextAttemptAt: failed.nextAttemptAt } : {}),
      progress: {
        stage: failed ? 'retrying' : projectPhase ? 'project' : 'evidence',
        completedItems,
        totalItems,
        ...(updatedAt ? { updatedAt } : {}),
        ...(failed?.attempts ? { attempt: failed.attempts } : {})
      }
    }
  }

  const record = objectRecord(value) ?? {}
  const jobs = Array.isArray(record.jobs) ? record.jobs.map(objectRecord).filter(Boolean) : []
  const activeJob = jobs.find((job) => {
    const jobStatus = optionalStringField(job!, 'status')
    return jobStatus === 'queued' || jobStatus === 'running' ||
      jobStatus === 'failed' || jobStatus === 'interrupted'
  })
  if (!activeJob) {
    return degradedEvidence
      ? {
          ...status,
          freshness: status.freshness === 'fresh' ? 'degraded' : status.freshness,
          ...(degradedEvidence.lastError ? {
            lastError: degradedEvidence.lastError,
            degradedReason: degradedEvidence.lastError
          } : {})
        }
      : status
  }
  const jobStatus = optionalStringField(activeJob, 'status')
  const attempts = finiteNumberField(activeJob, 'attempts')
  const updatedAt = optionalStringField(activeJob, 'updated_at') ?? optionalStringField(activeJob, 'updatedAt')
  return {
    ...status,
    progress: {
      stage: jobStatus === 'failed' || jobStatus === 'interrupted'
        ? 'retrying'
        : jobStatus === 'running'
          ? 'compile'
          : 'project',
      completedItems: totalItems,
      totalItems,
      ...(updatedAt ? { updatedAt } : {}),
      ...(attempts ? { attempt: attempts } : {})
    }
  }
}

function projectDagCommittedSessions(value: unknown): string[] {
  const record = objectRecord(value)
  const snapshots = [
    objectRecord(record?.committedSnapshot ?? record?.snapshot),
    objectRecord(record?.previousCommittedSnapshot)
  ].filter((snapshot): snapshot is Record<string, unknown> => Boolean(snapshot))
  const included = snapshots.flatMap((snapshot) =>
    Array.isArray(snapshot.evidenceVector) ? snapshot.evidenceVector.flatMap((entry) => {
        const item = objectRecord(entry)
        const threadId = item ? optionalStringField(item, 'threadId') : undefined
        return threadId ? [threadId] : []
      }) : [])
  return [...new Set([
    ...included,
    ...snapshots.flatMap((snapshot) => stringArrayField(snapshot, 'excludedSessions')),
    ...snapshots.flatMap((snapshot) => stringArrayField(snapshot, 'isolatedSessions'))
  ])].sort()
}

function projectDagCommittedEvidenceDigests(value: unknown): Map<string, string> {
  const record = objectRecord(value)
  const snapshots = [
    objectRecord(record?.previousCommittedSnapshot),
    objectRecord(record?.committedSnapshot ?? record?.snapshot)
  ].filter((snapshot): snapshot is Record<string, unknown> => Boolean(snapshot))
  const evidenceVector = snapshots.flatMap((snapshot) =>
    Array.isArray(snapshot.evidenceVector) ? snapshot.evidenceVector : [])
  return new Map(evidenceVector.flatMap((entry) => {
    const item = objectRecord(entry)
    const threadId = item ? optionalStringField(item, 'threadId') : undefined
    const digest = item ? optionalStringField(item, 'digest') : undefined
    return threadId && digest ? [[threadId, digest] as const] : []
  }))
}

function reusableEvidenceSnapshot(
  workerStatus: unknown,
  expectedThreadId: string,
  threadUpdatedAt?: string,
  desiredWatermark?: string,
  committedDigest?: string
): EvidenceSnapshot | undefined {
  const status = objectRecord(workerStatus)
  const snapshot = objectRecord(status?.snapshot)
  if (!snapshot || optionalStringField(snapshot, 'threadId') !== expectedThreadId ||
      optionalStringField(snapshot, 'status') !== 'committed') return undefined
  const createdAt = optionalStringField(snapshot, 'createdAt')
  if (!createdAt) return undefined
  const version = finiteNumberField(snapshot, 'version')
  const digest = optionalStringField(snapshot, 'digest')
  const inputWatermark = optionalStringField(snapshot, 'inputWatermark')
  const schemaVersion = optionalStringField(snapshot, 'schemaVersion')
  const extractorVersion = optionalStringField(snapshot, 'extractorVersion')
  const verifierVersion = optionalStringField(snapshot, 'verifierVersion')
  if (version === undefined || !digest || !inputWatermark || !schemaVersion ||
      !extractorVersion || !verifierVersion) return undefined
  const snapshotTime = Date.parse(createdAt)
  const threadTime = threadUpdatedAt ? Date.parse(threadUpdatedAt) : Number.NaN
  const coversQueuedTarget = desiredWatermark === inputWatermark
  const matchesCommittedProject = committedDigest === digest
  if (!coversQueuedTarget && !matchesCommittedProject && (
    !Number.isFinite(snapshotTime) || !Number.isFinite(threadTime) || snapshotTime < threadTime
  )) return undefined
  return {
    threadId: expectedThreadId,
    version,
    digest,
    inputWatermark,
    schemaVersion,
    extractorVersion,
    verifierVersion,
    artifactDigests: stringArrayField(snapshot, 'artifactDigests'),
    createdAt,
    status: 'committed'
  }
}

function projectDagStatusQuery(input: {
  workspaceRoot?: string
  projectRoot?: string
  project?: string
}): string {
  const query = new URLSearchParams()
  if (input.workspaceRoot) query.set('workspaceRoot', input.workspaceRoot)
  if (input.projectRoot) query.set('projectRoot', input.projectRoot)
  if (input.project) query.set('project', input.project)
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

function evidenceDagAuditRunForGate(audit: unknown): EvidenceDagAuditForGate {
  const record = objectRecord(audit)
  if (!record) {
    return { auditUnavailableReason: 'Evidence DAG audit response was empty.' }
  }
  const riskDigest = record.risk_digest ?? record.riskDigest
  if (!riskDigest) {
    return { auditUnavailableReason: 'Evidence DAG audit response did not include risk_digest.' }
  }
  return {
    riskDigest,
    auditCompletedAt:
      optionalStringField(record, 'completed_at') ??
      optionalStringField(record, 'completedAt')
  }
}

async function collectWriteExportEvidenceDagAudit(
  input: WriteExportIpcPayload,
  options: {
    agentRuntime?: RegisterAppIpcHandlersOptions['agentRuntime']
    ensureEvidenceDagReady?: RegisterAppIpcHandlersOptions['ensureEvidenceDagReady']
  }
): Promise<EvidenceDagAuditForGate> {
  const runtimeId = input.runtimeId
  const threadId = input.threadId?.trim()
  if (!runtimeId || !threadId) {
    return { auditUnavailableReason: 'write:export did not include runtimeId and threadId.' }
  }
  if (!options.agentRuntime) {
    return { auditUnavailableReason: 'Agent runtime is required to build the current thread Evidence DAG.' }
  }

  try {
    await options.ensureEvidenceDagReady?.()
    const config = evidenceDagViewConfig(process.env)
    await assertEvidenceDagServiceReachable(config.serviceUrl, config.apiKey)
    const detail = await options.agentRuntime.readThread({ runtimeId, threadId })
    const includedSessions = input.workspaceRoot
      ? await projectDagSessionScopeForWorkspace({ workspaceRoot: input.workspaceRoot }, options.agentRuntime)
      : undefined
    const ensured = await ensureEvidenceDagFresh({
      runtimeId,
      threadId,
      items: evidenceDagBackfillItems(detail),
      targetWatermark: String(detail.latestSeq),
      reason: 'manual_immediate',
      priority: 'immediate',
      projectContext: input.workspaceRoot ? {
        projectKey: input.workspaceRoot,
        workspaceRoot: input.workspaceRoot,
        projectRoot: input.workspaceRoot,
        includedSessions
      } : undefined
    })
    const audit = await requestEvidenceDagJson(
      config.serviceUrl,
      config.apiKey,
      '/audits',
      {
        method: 'POST',
        body: JSON.stringify({
          threadId: ensured.snapshot.threadId,
          targetDigest: ensured.snapshot.digest,
          level: 'L0',
          trigger: 'manual',
          threshold: 0.7
        })
      }
    )
    return evidenceDagAuditRunForGate(audit)
  } catch (error) {
    return {
      auditUnavailableReason: error instanceof Error ? error.message : String(error)
    }
  }
}

function withWriteExportEvidenceDagContext(
  metadata: EvidenceDagGateMetadata,
  input: WriteExportIpcPayload
): EvidenceDagGateMetadata & { runtimeId?: AgentRuntimeId; threadId?: string } {
  return {
    ...metadata,
    ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {})
  }
}

function writeExportServicePayload(input: WriteExportIpcPayload) {
  return {
    path: input.path,
    workspaceRoot: input.workspaceRoot,
    format: input.format,
    content: input.content
  }
}

const PROJECT_DAG_VIEW_HEALTH_TIMEOUT_MS = 1500

function projectDagViewConfig(env: Record<string, string | undefined>): {
  serviceUrl: string
  apiKey: string
} {
  const serviceUrl = projectDagServiceUrlFromEnv(env) || DEFAULT_PROJECT_DAG_SERVICE_URL
  const apiKey = projectDagApiKeyFromEnv(env)
  if (!apiKey) {
    throw new Error(
      'Project DAG is not ready. The app starts it from Model Router settings; check Model Router status.'
    )
  }
  return { serviceUrl, apiKey }
}

async function requestProjectDagJson(
  serviceUrl: string,
  apiKey: string,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch | undefined = globalThis.fetch
): Promise<unknown> {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Project DAG fetch API is unavailable.')
  }
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${apiKey}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetchImpl(`${serviceUrl}${path}`, {
    ...init,
    headers
  })
  const body = await response.json().catch(() => null) as {
    ok?: boolean
    data?: unknown
    error?: { message?: unknown }
  } | null
  if (!response.ok || body?.ok !== true) {
    const message = typeof body?.error?.message === 'string'
      ? body.error.message
      : `Project DAG returned HTTP ${response.status}`
    throw new Error(message)
  }
  return body.data
}

async function assertProjectDagServiceReachable(
  serviceUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch | undefined = globalThis.fetch
): Promise<void> {
  if (typeof fetchImpl !== 'function') return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROJECT_DAG_VIEW_HEALTH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(`${serviceUrl}/version`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`version returned HTTP ${response.status}`)
    }
    const body = await response.json().catch(() => null) as {
      data?: { service?: unknown; version?: unknown }
    } | null
    if (body?.data?.service !== 'project-dag-engine') {
      throw new Error('unexpected Project DAG service response')
    }
    if (body.data.version !== PROJECT_DAG_SERVICE_VERSION) {
      throw new Error(
        `stale Project DAG ${String(body.data.version ?? 'unknown')} ` +
        `(requires ${PROJECT_DAG_SERVICE_VERSION}); restart SciForge`
      )
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Project DAG service is not reachable at ${serviceUrl}: ${detail}`)
  } finally {
    clearTimeout(timer)
  }
}

function validateMcpConfigContent(content: string): void {
  const trimmed = content.trim()
  if (!trimmed) return
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`MCP config must be JSON: ${message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP config must be a JSON object.')
  }
}

function runDesktopCommand(
  command: DesktopCommand,
  sender: AppBridgeSender,
  getMainWindow: () => BrowserWindow | null
): void {
  const mainWindow = getMainWindow()
  const contents = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : sender as WebContents

  switch (command) {
    case 'undo':
      contents.undo()
      return
    case 'redo':
      contents.redo()
      return
    case 'cut':
      contents.cut()
      return
    case 'copy':
      contents.copy()
      return
    case 'paste':
      contents.paste()
      return
    case 'selectAll':
      contents.selectAll()
      return
    case 'reload':
      contents.reload()
      return
    case 'zoomIn':
      contents.setZoomLevel(contents.getZoomLevel() + 1)
      return
    case 'zoomOut':
      contents.setZoomLevel(contents.getZoomLevel() - 1)
      return
    case 'resetZoom':
      contents.setZoomLevel(0)
      return
    case 'toggleDevTools':
      contents.toggleDevTools()
      return
    case 'minimize':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
      return
    case 'toggleMaximize':
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
      return
    case 'close':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
      return
    case 'quit':
      app.quit()
      return
  }
}

type NativeFileDragSender = AppBridgeSender & {
  startDrag: (item: { file: string; icon: NativeImage }) => void
}

function isNativeFileDragSender(sender: AppBridgeSender): sender is NativeFileDragSender {
  return typeof (sender as { startDrag?: unknown }).startDrag === 'function'
}

const COMPONENT_SEGMENTATION_RUNNER_ENV = 'SCIFORGE_COMPONENT_SEGMENTATION_RUNNER'
const COMPONENT_SEGMENTATION_MODEL_ENV = 'SCIFORGE_COMPONENT_SEGMENTATION_MODEL_PATH'
const FASTSAM_RUNNER_ENV = 'SCIFORGE_FASTSAM_RUNNER'
const FASTSAM_MODEL_ENV = 'SCIFORGE_FASTSAM_MODEL_PATH'

function syncComponentSegmentationEnvFromSettings(settings: AppSettingsV1): void {
  const imageGeneration = getImageGenerationSettings(settings)
  const runner = imageGeneration.componentSegmentationRunnerPath.trim()
  const model = imageGeneration.componentSegmentationModelPath.trim()
  setOptionalProcessEnv(COMPONENT_SEGMENTATION_RUNNER_ENV, runner)
  setOptionalProcessEnv(COMPONENT_SEGMENTATION_MODEL_ENV, model)
  setOptionalProcessEnv(FASTSAM_RUNNER_ENV, runner)
  setOptionalProcessEnv(FASTSAM_MODEL_ENV, model)
}

function setOptionalProcessEnv(name: string, value: string): void {
  if (value) process.env[name] = value
  else delete process.env[name]
}

export function registerAppIpcHandlers(options: RegisterAppIpcHandlersOptions): AppBridgeDispatcher {
  const {
    store,
    getMainWindow,
    applySettingsPatch,
    agentRuntime,
    fetchUpstreamModels,
    getRemoteChannelRuntime,
    getDiscordBotRuntime,
    getZulipBotRuntime,
    visibleContext,
    getScheduleRuntime,
    getWorkflowRuntime = () => null,
    startFeishuInstallQrcode,
    pollFeishuInstall,
    startWeixinInstallQrcode,
    pollWeixinInstall,
    resolveRuntimeConfigPath,
    openModelRouterConfigFile,
    onRuntimeMcpConfigWritten,
    showTurnCompleteNotification,
    getAppVersion,
    readGuiUpdateState,
    loadGuiUpdaterModule,
    resolveLogDirectory,
    terminalPtyBridge,
    workspacePreviewHost: providedWorkspacePreviewHost,
    getMainPerformanceSnapshot,
    getScientificSkillsMcpLaunchConfig,
    getScientificPlottingMcpLaunchConfig,
    getBgcDiscoveryMcpLaunchConfig,
    getImageGenerationMcpLaunchConfig,
    getSciforgeCanvasMcpLaunchConfig,
    getPptMasterMcpLaunchConfig,
    getLocalDrawioUrl,
    installScientificSkills: installScientificSkillsHandler = installScientificSkills,
    getScientificPlottingStatus: getScientificPlottingStatusHandler = getScientificPlottingStatus,
    prepareScientificPlottingReference: prepareScientificPlottingReferenceHandler = prepareScientificPlottingReference,
    getSciforgeCanvasStatus: getSciforgeCanvasStatusHandler = getSciforgeCanvasStatus,
    openOrCreateSciforgeCanvas: openOrCreateSciforgeCanvasHandler = openOrCreateSciforgeCanvas,
    saveSciforgeCanvasSnapshot: saveSciforgeCanvasSnapshotHandler = saveSciforgeCanvasSnapshot,
    saveSciforgeCanvasSelection: saveSciforgeCanvasSelectionHandler = saveSciforgeCanvasSelection,
    insertSciforgeCanvasArtifact: insertSciforgeCanvasArtifactHandler = insertSciforgeCanvasArtifact,
    importRecentSciforgeCanvasArtifacts: importRecentSciforgeCanvasArtifactsHandler = importRecentSciforgeCanvasArtifacts,
    splitSciforgeCanvasArtifactComponents: splitSciforgeCanvasArtifactComponentsHandler = splitSciforgeCanvasArtifactComponents,
    exportSciforgeCanvasReviewPacket: exportSciforgeCanvasReviewPacketHandler = exportSciforgeCanvasReviewPacket,
    extractFigureStyle: extractFigureStyleHandler = extractFigureStyle,
    evaluateFigureStyle: evaluateFigureStyleHandler = evaluateFigureStyleSimilarity,
    reviewFigureStyle: reviewFigureStyleHandler = reviewFigureStyleOutput,
    extractFigureStyleReference: extractFigureStyleReferenceOverride,
    saveFigureStyleSpec: saveFigureStyleSpecOverride,
    logError,
    ensureEvidenceDagReady,
    ensureProjectDagReady,
    transcribeSpeech = requestSpeechTranscription
  } = options
  const workspacePreviewHost = providedWorkspacePreviewHost ?? new WorkspacePreviewHost({
    loadSettings: () => store.load()
  })
  const workspaceFileWatchers = new Map<string, WorkspaceFileWatchRecord>()
  const agentRuntimeEventStreams = new Map<string, AgentRuntimeEventStreamRecord>()
  const workspacePreviewSenderSessions = new Map<number, WorkspacePreviewSenderSessionRecord>()
  const workspacePreviewSessionOwnerIds = new Map<string, number>()
  const invokeHandlers = new Map<string, AppBridgeInvokeHandler>()

  const handleInvoke = (channel: string, handler: AppBridgeInvokeHandler): void => {
    invokeHandlers.set(channel, handler)
    ipcMain.handle(channel, async (event, payload: unknown) => {
      const startedAt = mainPerformanceMonitor.now()
      mainPerformanceMonitor.count('main.ipc.invoke')
      mainPerformanceMonitor.count(`main.ipc.invoke.${channel}`)
      try {
        return await handler({ sender: event.sender }, payload)
      } finally {
        mainPerformanceMonitor.sample('main.ipc.invoke.duration', mainPerformanceMonitor.now() - startedAt, {
          channel
        })
      }
    })
  }

  const invoke = async (channel: string, payload: unknown, sender: AppBridgeSender): Promise<unknown> => {
    const startedAt = mainPerformanceMonitor.now()
    mainPerformanceMonitor.count('main.devBridge.invoke')
    mainPerformanceMonitor.count(`main.devBridge.invoke.${channel}`)
    const handler = invokeHandlers.get(channel)
    try {
      if (!handler) throw new Error(`Unknown app bridge channel: ${channel}`)
      return await handler({ sender }, payload)
    } finally {
      mainPerformanceMonitor.sample('main.devBridge.invoke.duration', mainPerformanceMonitor.now() - startedAt, {
        channel
      })
    }
  }

  const defaultExtractFigureStyleReference = async (
    request: FigureStyleExtractReferenceRequest
  ): Promise<FigureStyleExtractReferenceResult> => {
    const sourceType = inferFigureStyleReferenceSourceType(request.sourcePath, request.sourceType)
    if (sourceType === 'pdf') {
      const preparedReference = await prepareScientificPlottingReferenceHandler({
        workspaceRoot: request.workspaceRoot,
        sourcePath: request.sourcePath,
        sourceType: 'pdf',
        ...(request.page ? { page: request.page } : {}),
        ...(request.cropBox ? { cropBox: request.cropBox } : {}),
        ...(request.figureId?.trim() ? { figureId: request.figureId.trim() } : {}),
        ...(request.outputDir?.trim() ? { outputDir: request.outputDir.trim() } : {}),
        ...(request.dpi ? { dpi: request.dpi } : {}),
        extractStyle: true
      })
      if (!preparedReference.ok) {
        return {
          ok: false,
          message: preparedReference.message,
          sourceType,
          preparedReference
        }
      }

      const sourcePath = workspaceRelativePathForIpc(preparedReference.croppedImagePath, request.workspaceRoot)
      if (!sourcePath) {
        return {
          ok: false,
          message: 'Prepared figure style reference path is outside the workspace.',
          sourceType,
          preparedReference
        }
      }
      const extraction = await extractFigureStyleHandler({
        workspaceRoot: request.workspaceRoot,
        sourcePath,
        sourceType: 'image',
        ...(request.figureId?.trim() ? { figureId: request.figureId.trim() } : {}),
        ...(request.notes?.trim() ? { notes: request.notes.trim() } : {})
      })
      if (!extraction.ok) {
        return {
          ok: false,
          message: extraction.message,
          sourcePath,
          sourceType: 'image',
          preparedReference,
          extraction
        }
      }
      return {
        ok: true,
        sourcePath,
        sourceType: 'image',
        preparedReference,
        extraction
      }
    }

    const extraction = await extractFigureStyleHandler({
      workspaceRoot: request.workspaceRoot,
      sourcePath: request.sourcePath,
      sourceType: 'image',
      ...(request.figureId?.trim() ? { figureId: request.figureId.trim() } : {}),
      ...(request.notes?.trim() ? { notes: request.notes.trim() } : {})
    })
    if (!extraction.ok) {
      return {
        ok: false,
        message: extraction.message,
        sourcePath: request.sourcePath,
        sourceType: 'image',
        extraction
      }
    }
    return {
      ok: true,
      sourcePath: request.sourcePath,
      sourceType: 'image',
      extraction
    }
  }

  const extractFigureStyleReferenceHandler =
    extractFigureStyleReferenceOverride ?? defaultExtractFigureStyleReference

  const defaultSaveFigureStyleSpec = async (
    request: FigureStyleSaveSpecRequest
  ): Promise<FigureStyleSaveSpecResult> => {
    const path = request.path?.trim() || buildFigureStyleArtifactPath(request.spec)
    return writeWorkspaceFile({
      workspaceRoot: request.workspaceRoot,
      path,
      content: serializeFigureStyleSpecPayload(request)
    })
  }

  const saveFigureStyleSpecHandler = saveFigureStyleSpecOverride ?? defaultSaveFigureStyleSpec

  const disposeWorkspaceFileWatch = (watchId: string): boolean => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return false
    if (record.timer) clearTimeout(record.timer)
    try {
      record.watcher.close()
    } catch (error) {
      logError('workspace-watch', 'Failed to close workspace file watcher', {
        watchId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    workspaceFileWatchers.delete(watchId)
    return true
  }

  const cleanupAgentRuntimeEventStreamRecord = (streamId: string, record: AgentRuntimeEventStreamRecord): void => {
    if (agentRuntimeEventStreams.get(streamId) !== record) return
    record.sender.removeListener('destroyed', record.onSenderDestroyed)
    agentRuntimeEventStreams.delete(streamId)
  }

  const disposeAgentRuntimeEventStream = (streamId: string, sender?: AppBridgeSender): boolean => {
    const record = agentRuntimeEventStreams.get(streamId)
    if (!record) return false
    if (sender && record.sender.id !== sender.id) return false
    record.controller.abort()
    cleanupAgentRuntimeEventStreamRecord(streamId, record)
    return true
  }

  const disposeAgentRuntimeEventStreamsForSender = (sender: AppBridgeSender): void => {
    for (const [streamId, record] of agentRuntimeEventStreams) {
      if (record.sender.id === sender.id) {
        disposeAgentRuntimeEventStream(streamId, sender)
      }
    }
  }

  const disposeWorkspaceFileWatchesForSender = (sender: AppBridgeSender): void => {
    for (const [watchId, record] of workspaceFileWatchers) {
      if (record.sender.id === sender.id) {
        disposeWorkspaceFileWatch(watchId)
      }
    }
  }

  const cleanupWorkspacePreviewSenderSessionRecord = (
    senderId: number,
    record: WorkspacePreviewSenderSessionRecord
  ): void => {
    if (workspacePreviewSenderSessions.get(senderId) !== record) return
    record.sender.removeListener('destroyed', record.onSenderDestroyed)
    workspacePreviewSenderSessions.delete(senderId)
  }

  const cleanupWorkspacePreviewSessionOwnership = (sessionId: string): void => {
    const senderId = workspacePreviewSessionOwnerIds.get(sessionId)
    if (senderId === undefined) return
    workspacePreviewSessionOwnerIds.delete(sessionId)
    const record = workspacePreviewSenderSessions.get(senderId)
    if (!record) return
    record.sessionIds.delete(sessionId)
    if (record.sessionIds.size === 0) {
      cleanupWorkspacePreviewSenderSessionRecord(senderId, record)
    }
  }

  const releaseWorkspacePreviewSession = (sessionId: string): boolean => {
    const released = workspacePreviewHost.releaseSession(sessionId)
    if (released) cleanupWorkspacePreviewSessionOwnership(sessionId)
    return released
  }

  const disposeWorkspacePreviewSessionsForSender = (sender: AppBridgeSender): void => {
    const record = workspacePreviewSenderSessions.get(sender.id)
    if (!record) return
    for (const sessionId of [...record.sessionIds]) {
      workspacePreviewHost.releaseSession(sessionId)
      workspacePreviewSessionOwnerIds.delete(sessionId)
    }
    record.sessionIds.clear()
    cleanupWorkspacePreviewSenderSessionRecord(sender.id, record)
  }

  const trackWorkspacePreviewSessionForSender = (sender: AppBridgeSender, sessionId: string): void => {
    cleanupWorkspacePreviewSessionOwnership(sessionId)
    if (sender.isDestroyed()) {
      workspacePreviewHost.releaseSession(sessionId)
      return
    }
    let record = workspacePreviewSenderSessions.get(sender.id)
    if (!record) {
      const onSenderDestroyed = () => disposeWorkspacePreviewSessionsForSender(sender)
      record = {
        sender,
        sessionIds: new Set<string>(),
        onSenderDestroyed
      }
      workspacePreviewSenderSessions.set(sender.id, record)
      sender.once('destroyed', onSenderDestroyed)
    }
    record.sessionIds.add(sessionId)
    workspacePreviewSessionOwnerIds.set(sessionId, sender.id)
  }

  const emitWorkspaceFileChange = async (watchId: string): Promise<void> => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return
    const changedAt = new Date().toISOString()
    try {
      if (record.kind === 'workspace-preview') {
        const result = await workspacePreviewHost.createWatchSnapshot({
          path: record.path,
          workspaceRoot: record.workspaceRoot
        })
        const latest = workspaceFileWatchers.get(watchId)
        if (!latest || latest.sender.isDestroyed()) return
        if (result.ok) {
          latest.sender.send(latest.changeChannel, {
            ok: true,
            watchId,
            workspaceRoot: result.workspaceRoot,
            path: result.path,
            content: result.content,
            size: result.size,
            truncated: result.truncated,
            mtimeMs: result.mtimeMs,
            changedAt
          })
          return
        }
        latest.sender.send(latest.changeChannel, {
          ok: false,
          watchId,
          workspaceRoot: latest.workspaceRoot,
          path: latest.path,
          message: result.message,
          changedAt
        })
        return
      }

      const result = await readWorkspaceFile({
        path: record.path,
        workspaceRoot: record.workspaceRoot
      })
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest || latest.sender.isDestroyed()) return
      if (result.ok) {
        latest.sender.send(latest.changeChannel, {
          ok: true,
          watchId,
          workspaceRoot: latest.workspaceRoot,
          path: result.path,
          content: result.content,
          size: result.size,
          truncated: result.truncated,
          changedAt
        })
        return
      }
      latest.sender.send(latest.changeChannel, {
        ok: false,
        watchId,
        workspaceRoot: latest.workspaceRoot,
        path: latest.path,
        message: result.message,
        changedAt
      })
    } catch (error) {
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest || latest.sender.isDestroyed()) return
      latest.sender.send(latest.changeChannel, {
        ok: false,
        watchId,
        workspaceRoot: latest.workspaceRoot,
        path: latest.path,
        message: error instanceof Error ? error.message : String(error),
        changedAt
      })
    }
  }

  const scheduleWorkspaceFileChange = (watchId: string): void => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return
    if (record.timer) clearTimeout(record.timer)
    record.timer = setTimeout(() => {
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest) return
      latest.timer = null
      void emitWorkspaceFileChange(watchId)
    }, 90)
  }

  handleInvoke('settings:get', async () => store.load())
  handleInvoke('settings:set', async (_, partial: unknown) =>
    applySettingsPatch(
      parseIpcPayload('settings:set', settingsPatchSchema, partial) as AppSettingsPatch
    )
  )
  handleInvoke('terminal:create', async (event, payload: unknown) =>
    terminalPtyBridge?.create(event.sender, payload) ?? {
      ok: false as const,
      message: 'The terminal backend is not available.'
    }
  )
  handleInvoke('terminal:write', async (event, payload: unknown) =>
    terminalPtyBridge?.write(event.sender, payload) ?? false
  )
  handleInvoke('terminal:resize', async (event, payload: unknown) =>
    terminalPtyBridge?.resize(event.sender, payload) ?? false
  )
  handleInvoke('terminal:dispose', async (event, payload: unknown) =>
    terminalPtyBridge?.dispose(event.sender, payload) ?? false
  )
  handleInvoke('computer-use:permissions', async () => getComputerUsePermissions())
  handleInvoke('computer-use:request-permission', async (_, kind: unknown) =>
    requestComputerUsePermission(
      parseIpcPayload(
        'computer-use:request-permission',
        computerUsePermissionKindSchema,
        kind
      )
    )
  )
  handleInvoke('computer-use:status', async () => {
    const settings = await store.load()
    const statusPath = join(app.getPath('userData'), 'computer-use', 'status.json')
    return {
      settings: settings.computerUse,
      permissions: await getComputerUsePermissions(),
      runtime: await readComputerUseRuntimeStatus(statusPath)
    }
  })
  handleInvoke('performance:snapshot', async () => {
    const mainSnapshot = getMainPerformanceSnapshot?.() ?? null
    const win = getMainWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return { ok: false, message: 'Main window is not available.', mainSnapshot }
    }
    const snapshot = await win.webContents.executeJavaScript(
      'window.__SCIFORGE_PERF__?.snapshot?.() ?? null',
      true
    ) as unknown
    return snapshot
      ? { ok: true, snapshot, mainSnapshot }
      : { ok: false, message: 'Renderer performance monitor is not available.', mainSnapshot }
  })

  const requirePaperRadarService = (): PaperRadarWorkerService => {
    const service = options.getPaperRadarService?.()
    if (!service) {
      throw new Error('Paper Radar is not available in this build.')
    }
    return service
  }

  const requireResearchCardService = (): ResearchCardService => {
    if (!options.researchCards) {
      throw new Error('Research card service is not initialized.')
    }
    return options.researchCards
  }

  handleInvoke('researchCards:list', async (_, payload: unknown) =>
    requireResearchCardService().list(
      parseIpcPayload('researchCards:list', researchCardListPayloadSchema, payload ?? {})
    )
  )
  handleInvoke('researchCards:create', async (_, payload: unknown) =>
    requireResearchCardService().create(
      parseIpcPayload('researchCards:create', researchCardCreatePayloadSchema, payload)
    )
  )
  handleInvoke('researchCards:update', async (_, payload: unknown) =>
    requireResearchCardService().update(
      parseIpcPayload('researchCards:update', researchCardUpdatePayloadSchema, payload)
    )
  )
  handleInvoke('researchCards:archive', async (_, payload: unknown) =>
    requireResearchCardService().archive(
      parseIpcPayload('researchCards:archive', researchCardArchivePayloadSchema, payload)
    )
  )

  const paperRadarRequest = async <T>(request: () => Promise<PaperRadarApiResult<T>>): Promise<PaperRadarApiResult<T>> => {
    try {
      return await request()
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  handleInvoke('paperRadar:status', async () => {
    try {
      return await requirePaperRadarService().status()
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
  handleInvoke('paperRadar:sync-arxiv', async (_, payload: unknown) => {
    const input = parseIpcPayload('paperRadar:sync-arxiv', paperRadarArxivSyncPayloadSchema, payload ?? {})
    return paperRadarRequest(() => requirePaperRadarService().syncArxiv(input))
  })
  handleInvoke('paperRadar:sync-biorxiv', async (_, payload: unknown) => {
    const input = parseIpcPayload('paperRadar:sync-biorxiv', paperRadarBiorxivSyncPayloadSchema, payload ?? {})
    return paperRadarRequest(() => requirePaperRadarService().syncBiorxiv(input))
  })
  handleInvoke('paperRadar:sync-profile', async (_, payload: unknown) => {
    const input = parseIpcPayload('paperRadar:sync-profile', paperRadarProfileSyncPayloadSchema, payload ?? {})
    return paperRadarRequest(() => requirePaperRadarService().syncProfile(input))
  })
  handleInvoke('paperRadar:profiles:list', async () =>
    paperRadarRequest(() => requirePaperRadarService().listProfiles())
  )
  handleInvoke('paperRadar:profiles:save', async (_, payload: unknown) => {
    const input = parseIpcPayload('paperRadar:profiles:save', paperRadarProfilePayloadSchema, payload ?? {})
    return paperRadarRequest(() => requirePaperRadarService().saveProfile(input))
  })
  handleInvoke('paperRadar:review', async (_, payload: unknown) => {
    const input = parseIpcPayload('paperRadar:review', paperRadarReviewPayloadSchema, payload ?? {})
    return paperRadarRequest(() => requirePaperRadarService().review(input))
  })
  handleInvoke('paperRadar:search', async (_, payload: unknown) => {
    const input = parseIpcPayload('paperRadar:search', paperRadarSearchPayloadSchema, payload ?? {})
    return paperRadarRequest(() => requirePaperRadarService().search(input))
  })
  handleInvoke('paperRadar:rank', async (_, payload: unknown) => {
    const input = parseIpcPayload('paperRadar:rank', paperRadarRankPayloadSchema, payload ?? {})
    return paperRadarRequest(() => requirePaperRadarService().rank(input))
  })
  handleInvoke('paperRadar:digest', async (_, payload: unknown) => {
    const input = parseIpcPayload('paperRadar:digest', paperRadarDigestPayloadSchema, payload ?? {})
    return paperRadarRequest(() => requirePaperRadarService().digest(input))
  })

  handleInvoke('visibleContext:publish', async (_, payload: unknown) => {
    const snapshot = parseIpcPayload('visibleContext:publish', visibleContextPublishPayloadSchema, payload)
    if (!visibleContext) return snapshot
    return visibleContext.publish(snapshot)
  })
  handleInvoke('visibleContext:get', async () => {
    if (!visibleContext) return emptyVisibleContextSnapshot()
    return visibleContext.get()
  })
  handleInvoke('visibleContext:capture:preview', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'visibleContext:capture:preview',
      visibleContextCapturePreviewPayloadSchema,
      payload
    )
    if (!visibleContext) return { ok: false, message: 'Visible capture previews are unavailable.' }
    return visibleContext.readCapturePreview(request.path)
  })

  const requireAgentRuntime = (): NonNullable<RegisterAppIpcHandlersOptions['agentRuntime']> => {
    if (!agentRuntime) {
      throw new Error('AgentRuntimeHost is not initialized.')
    }
    return agentRuntime
  }

  const requireDiscordBotRuntime = (): DiscordBotRuntime => {
    const runtime = getDiscordBotRuntime?.()
    if (!runtime) {
      throw new Error('Discord bot runtime is not initialized.')
    }
    return runtime
  }

  const requireZulipBotRuntime = (): ZulipBotRuntime => {
    const runtime = getZulipBotRuntime?.()
    if (!runtime) {
      throw new Error('Zulip bot runtime is not initialized.')
    }
    return runtime
  }

  handleInvoke('agentRuntime:connect', async (_, payload: unknown) => {
    const request = parseIpcPayload('agentRuntime:connect', agentRuntimeConnectPayloadSchema, payload ?? {})
    return requireAgentRuntime().connect(request.runtimeId)
  })
  handleInvoke('agentRuntime:capabilities', async (_, payload: unknown) => {
    const request = parseIpcPayload('agentRuntime:capabilities', agentRuntimeConnectPayloadSchema, payload ?? {})
    return requireAgentRuntime().capabilities(request.runtimeId)
  })
  handleInvoke('agentRuntime:listThreads', async (_, payload: unknown) =>
    requireAgentRuntime().listThreads(
      parseIpcPayload('agentRuntime:listThreads', agentRuntimeListThreadsPayloadSchema, payload ?? {})
    )
  )
  handleInvoke('agentRuntime:startThread', async (_, payload: unknown) =>
    requireAgentRuntime().startThread(
      parseIpcPayload('agentRuntime:startThread', agentRuntimeStartThreadPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:readThread', async (_, payload: unknown) =>
    requireAgentRuntime().readThread(
      parseIpcPayload('agentRuntime:readThread', agentRuntimeReadThreadPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:readThreadSidebarProbe', async (_, payload: unknown) =>
    requireAgentRuntime().readThreadSidebarProbe(
      parseIpcPayload(
        'agentRuntime:readThreadSidebarProbe',
        agentRuntimeReadThreadSidebarProbePayloadSchema,
        payload
      )
    )
  )
  handleInvoke('agentRuntime:startTurn', async (_, payload: unknown) =>
    requireAgentRuntime().startTurn(
      parseIpcPayload('agentRuntime:startTurn', agentRuntimeStartTurnPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:interruptTurn', async (_, payload: unknown) =>
    requireAgentRuntime().interruptTurn(
      parseIpcPayload('agentRuntime:interruptTurn', agentRuntimeTurnTargetPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:steerTurn', async (_, payload: unknown) =>
    requireAgentRuntime().steerTurn(
      parseIpcPayload('agentRuntime:steerTurn', agentRuntimeTurnSteerPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:renameThread', async (_, payload: unknown) =>
    requireAgentRuntime().renameThread(
      parseIpcPayload('agentRuntime:renameThread', agentRuntimeThreadRenamePayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:deleteThread', async (_, payload: unknown) =>
    requireAgentRuntime().deleteThread(
      parseIpcPayload('agentRuntime:deleteThread', agentRuntimeThreadDeletePayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:compactThread', async (_, payload: unknown) =>
    requireAgentRuntime().compactThread(
      parseIpcPayload('agentRuntime:compactThread', agentRuntimeThreadCompactPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:forkThread', async (_, payload: unknown) =>
    requireAgentRuntime().forkThread(
      parseIpcPayload('agentRuntime:forkThread', agentRuntimeThreadForkPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:resumeSession', async (_, payload: unknown) =>
    requireAgentRuntime().resumeSession(
      parseIpcPayload('agentRuntime:resumeSession', agentRuntimeSessionResumePayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:updateThreadRelation', async (_, payload: unknown) =>
    requireAgentRuntime().updateThreadRelation(
      parseIpcPayload('agentRuntime:updateThreadRelation', agentRuntimeThreadRelationPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:usage', async (_, payload: unknown) =>
    requireAgentRuntime().usage(
      parseIpcPayload('agentRuntime:usage', agentRuntimeUsagePayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:auxiliary', async (_, payload: unknown) =>
    requireAgentRuntime().auxiliary(
      parseIpcPayload('agentRuntime:auxiliary', agentRuntimeAuxiliaryPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:stopEvents', async (event, payload: unknown) =>
    disposeAgentRuntimeEventStream(streamIdSchema.parse(payload), event.sender)
  )
  handleInvoke('agentRuntime:subscribeEvents', async (event, payload: unknown) => {
    const request = parseIpcPayload('agentRuntime:subscribeEvents', agentRuntimeEventSubscribePayloadSchema, payload)
    const requestedId = request.streamId?.trim() ?? ''
    const streamId = requestedId || randomUUID()
    const sender = event.sender
    const active = agentRuntimeEventStreams.get(streamId)
    if (active && active.sender.id !== sender.id) {
      throw new Error(`Agent runtime event stream "${streamId}" is already active for another sender.`)
    }
    disposeAgentRuntimeEventStream(streamId, sender)

    const controller = new AbortController()
    const onSenderDestroyed = () => disposeAgentRuntimeEventStreamsForSender(sender)
    const record = { controller, sender, onSenderDestroyed }
    agentRuntimeEventStreams.set(streamId, record)
    sender.once('destroyed', onSenderDestroyed)

    void (async () => {
      try {
        for await (const runtimeEvent of requireAgentRuntime().subscribeEvents({
          ...request,
          streamId,
          signal: controller.signal
        })) {
          if (controller.signal.aborted || sender.isDestroyed()) return
          sender.send('agentRuntime:event', { streamId, event: runtimeEvent })
        }
        if (!controller.signal.aborted && !sender.isDestroyed()) {
          sender.send('agentRuntime:end', { streamId })
        }
      } catch (error) {
        if (!controller.signal.aborted && !sender.isDestroyed()) {
          sender.send('agentRuntime:error', {
            streamId,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      } finally {
        cleanupAgentRuntimeEventStreamRecord(streamId, record)
      }
    })()

    await Promise.resolve()
    return { streamId }
  })
  handleInvoke('agentRuntime:resolveApproval', async (_, payload: unknown) =>
    requireAgentRuntime().resolveApproval(
      parseIpcPayload('agentRuntime:resolveApproval', agentRuntimeApprovalResolvePayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:resolveUserInput', async (_, payload: unknown) =>
    requireAgentRuntime().resolveUserInput(
      parseIpcPayload('agentRuntime:resolveUserInput', agentRuntimeUserInputResolvePayloadSchema, payload)
    )
  )

  handleInvoke('upstream:models', async () => fetchUpstreamModels())

  handleInvoke('connectPhone:status', async (): Promise<ConnectPhoneRuntimeStatus> =>
    getRemoteChannelRuntime()?.status() ?? {
      imServerRunning: false,
      imUrl: '',
      runningTaskIds: []
    }
  )

  handleInvoke('schedule:status', async (): Promise<ScheduleRuntimeStatus> =>
    getScheduleRuntime()?.status() ?? {
      internalServerRunning: false,
      internalUrl: '',
      runningTaskIds: [],
      powerSaveBlockerActive: false
    }
  )

  handleInvoke('schedule:task:run', async (_, taskId: unknown): Promise<ScheduleRunResult> => {
    const normalizedTaskId = parseIpcPayload('schedule:task:run', streamIdSchema, taskId)
    const scheduleRuntime = getScheduleRuntime()
    if (!scheduleRuntime) return { ok: false, message: 'Schedule runtime is not initialized.' }
    return scheduleRuntime.runTask(normalizedTaskId)
  })

  handleInvoke('workflow:status', async (): Promise<WorkflowRuntimeStatus> =>
    getWorkflowRuntime()?.status() ?? {
      runningWorkflowIds: [],
      nodeStatus: {},
      nodeResults: {},
      powerSaveBlockerActive: false,
      pendingApprovals: []
    }
  )

  handleInvoke('workflow:run', async (_, payload: unknown): Promise<WorkflowRunResult> => {
    const request = parseIpcPayload(
      'workflow:run',
      z.object({
        workflowId: streamIdSchema,
        input: z.unknown().optional()
      }).strict(),
      payload
    )
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.runWorkflow(request.workflowId, request.input)
  })

  handleInvoke('workflow:stop', async (_, workflowId: unknown): Promise<WorkflowRunResult> => {
    const normalizedWorkflowId = parseIpcPayload('workflow:stop', streamIdSchema, workflowId)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.stopWorkflow(normalizedWorkflowId)
  })

  handleInvoke('workflow:node:run', async (_, payload: unknown): Promise<WorkflowRunResult> => {
    const request = parseIpcPayload('workflow:node:run', workflowRunNodePayloadSchema, payload)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.runSingleNode(request.workflowId, request.nodeId)
  })

  handleInvoke('workflow:node:test', async (_, payload: unknown): Promise<WorkflowNodeTestResult> => {
    const request = parseIpcPayload('workflow:node:test', workflowTestNodePayloadSchema, payload)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.testNode(request.workflowId, request.nodeId, request.mockJson)
  })

  handleInvoke('workflow:approval:resolve', async (_, payload: unknown): Promise<{ ok: boolean }> => {
    const request = parseIpcPayload('workflow:approval:resolve', workflowResolveApprovalPayloadSchema, payload)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false }
    return { ok: workflowRuntime.resolveApproval(request.token, request.decision) }
  })

  handleInvoke('workflow:code:check', async (_, payload: unknown): Promise<WorkflowCodeCheckResult> => {
    const request = parseIpcPayload('workflow:code:check', workflowCodeCheckPayloadSchema, payload)
    return checkWorkflowCode(request.language, request.code)
  })

  handleInvoke(
    'remoteChannel:active-thread-context',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'remoteChannel:active-thread-context',
        remoteChannelActiveThreadContextPayloadSchema,
        payload
      )
      options.setRemoteChannelActiveThreadContext?.(request)
    }
  )

  handleInvoke(
    'remoteChannel:message:mirror',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('remoteChannel:message:mirror', remoteChannelMirrorPayloadSchema, payload)
      const remoteChannelRuntime = getRemoteChannelRuntime()
      if (!remoteChannelRuntime) return { ok: false as const, message: 'Remote channel runtime is not initialized.' }
      return remoteChannelRuntime.mirrorThreadMessageToIm(
        request.threadId,
        request.text,
        request.direction
      )
    }
  )

  handleInvoke(
    'remoteChannel:task:create-from-text',
    async (_, payload: unknown): Promise<ScheduleTaskFromTextResult> => {
      const request = parseIpcPayload(
        'remoteChannel:task:create-from-text',
        remoteChannelTaskFromTextPayloadSchema,
        payload
      )
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { kind: 'error', message: 'Schedule runtime is not initialized.' }
      const settings = await store.load()
      const channel = request.channelId
        ? settings.remoteChannel.channels.find((item) => item.id === request.channelId)
        : undefined
      return scheduleRuntime.createScheduledTaskFromText(request.text, {
        workspaceRoot: channel?.workspaceRoot || settings.schedule.defaultWorkspaceRoot || settings.workspaceRoot,
        modelHint: request.modelHint,
        mode: request.mode
      })
    }
  )

  handleInvoke(
    'schedule:task:create-from-text',
    async (_, payload: unknown): Promise<ScheduleTaskFromTextResult> => {
      const request = parseIpcPayload(
        'schedule:task:create-from-text',
        scheduleTaskFromTextPayloadSchema,
        payload
      )
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { kind: 'error', message: 'Schedule runtime is not initialized.' }
      return scheduleRuntime.createScheduledTaskFromText(request.text, {
        workspaceRoot: request.workspaceRoot,
        modelHint: request.modelHint,
        mode: request.mode
      })
    }
  )

  handleInvoke(
    'connectPhone:install:qrcode',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'connectPhone:install:qrcode',
        connectPhoneInstallQrPayloadSchema,
        payload
      )
      if (request.provider === 'weixin') {
        const settings = await store.load()
        return startWeixinInstallQrcode(settings.connectPhone.weixinBridgeUrl)
      }
      return startFeishuInstallQrcode(request.isLark === true)
    }
  )

  handleInvoke(
    'connectPhone:install:poll',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'connectPhone:install:poll',
        connectPhoneInstallPollPayloadSchema,
        payload
      )
      if (request.provider === 'weixin') {
        const settings = await store.load()
        return pollWeixinInstall(request.deviceCode, settings.connectPhone.weixinBridgeUrl)
      }
      return pollFeishuInstall(request.deviceCode)
    }
  )

  handleInvoke('discord:status', async () =>
    requireDiscordBotRuntime().status()
  )

  handleInvoke('discord:configure-client', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:configure-client',
      discordConfigureClientPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().configureClientId(request.clientId)
  })

  handleInvoke('discord:configure-token', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:configure-token',
      discordConfigureTokenPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().configureToken(request.token, request.clientId)
  })

  handleInvoke('discord:configure-proxy', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:configure-proxy',
      discordConfigureProxyPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().configureProxy(request.proxyUrl)
  })

  handleInvoke('discord:guilds', async () =>
    requireDiscordBotRuntime().listGuilds()
  )

  handleInvoke('discord:channels', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:channels',
      discordGuildChannelsPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().listChannels(request.guildId)
  })

  handleInvoke('discord:bind-channel', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:bind-channel',
      discordBindChannelPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().bindChannel(request)
  })

  handleInvoke('discord:test-send', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:test-send',
      discordTestSendPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().testSend(request.channelId, request.text, request.channelConfigId)
  })

  handleInvoke('discord:set-guard', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:set-guard',
      discordSetGuardPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().setGuard(request.enabled, {
      channelConfigId: request.channelConfigId,
      forceTakeover: request.forceTakeover
    })
  })

  handleInvoke('zulip:status', async () =>
    requireZulipBotRuntime().status()
  )

  handleInvoke('zulip:configure', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'zulip:configure',
      zulipConfigurePayloadSchema,
      payload
    )
    return requireZulipBotRuntime().configure(request)
  })

  handleInvoke('zulip:streams', async () =>
    requireZulipBotRuntime().listStreams()
  )

  handleInvoke('zulip:topics', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'zulip:topics',
      zulipStreamTopicsPayloadSchema,
      payload
    )
    return requireZulipBotRuntime().listTopics(request.streamId)
  })

  handleInvoke('zulip:bind-channel', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'zulip:bind-channel',
      zulipBindChannelPayloadSchema,
      payload
    )
    return requireZulipBotRuntime().bindChannel(request)
  })

  handleInvoke('zulip:test-send', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'zulip:test-send',
      zulipTestSendPayloadSchema,
      payload
    )
    return requireZulipBotRuntime().testSend(request.channelId, request.text, {
      channelConfigId: request.channelConfigId,
      topicName: request.topicName
    })
  })

  handleInvoke('zulip:set-guard', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'zulip:set-guard',
      zulipSetGuardPayloadSchema,
      payload
    )
    return requireZulipBotRuntime().setGuard(request.enabled, {
      channelConfigId: request.channelConfigId,
      forceTakeover: request.forceTakeover
    })
  })

  handleInvoke('workspace:pick-directory', async (_, defaultPath: unknown): Promise<WorkspacePickResult> => {
    const normalizedDefaultPath = parseIpcPayload(
      'workspace:pick-directory',
      z.object({ defaultPath: defaultPathSchema }).strict(),
      { defaultPath }
    ).defaultPath
    const options: Electron.OpenDialogOptions = {
      title: 'Select working directory',
      defaultPath: normalizedDefaultPath,
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return {
      canceled: result.canceled,
      path: result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })

  handleInvoke('workspace:pick-file', async (_, defaultPath: unknown): Promise<WorkspacePickResult> => {
    const normalizedDefaultPath = parseIpcPayload(
      'workspace:pick-file',
      z.object({ defaultPath: defaultPathSchema }).strict(),
      { defaultPath }
    ).defaultPath
    const options: Electron.OpenDialogOptions = {
      title: 'Select reference figure',
      defaultPath: normalizedDefaultPath,
      properties: ['openFile', 'dontAddToRecent'],
      filters: [
        { name: 'Figures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'pdf'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return {
      canceled: result.canceled,
      path: result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })

  handleInvoke(
    'skill:save-file',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('skill:save-file', skillSaveFilePayloadSchema, payload)
      try {
        const rootPath = expandHomePath(request.rootPath)
        if (!rootPath) {
          return { ok: false as const, message: 'Skill directory is required.' }
        }
        const skillName = normalizeSkillFolderName(request.skillName)
        const skillDir = join(rootPath, skillName)
        const filePath = join(skillDir, 'SKILL.md')
        await mkdir(skillDir, { recursive: true })
        await writeFile(filePath, request.content, 'utf8')
        return { ok: true as const, path: filePath }
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  handleInvoke('skill:list', async (_, payload: unknown) => {
    const request = parseIpcPayload('skill:list', skillListPayloadSchema, payload)
    const settings = await store.load()
    return listGuiSkills(settings, request.workspaceRoot)
  })

  handleInvoke('mcp:scientific-skills-config', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'mcp:scientific-skills-config',
      scientificSkillsMcpConfigPayloadSchema,
      payload
    )
    try {
      const launch = getScientificSkillsMcpLaunchConfig?.() ?? {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
      return {
        ok: true as const,
        config: buildScientificSkillsMcpConfigFragment(launch, request.workspaceRoot)
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('mcp:scientific-skills-status', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'mcp:scientific-skills-status',
      scientificSkillsMcpConfigPayloadSchema,
      payload
    )
    try {
      const summary = buildScientificSkillsStatusSummary(
        await buildScientificSkillsIndex({ workspaceRoot: request.workspaceRoot })
      )
      return {
        ok: true as const,
        ...summary
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('mcp:scientific-plotting-config', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'mcp:scientific-plotting-config',
      scientificPlottingMcpConfigPayloadSchema,
      payload
    )
    try {
      const launch = getScientificPlottingMcpLaunchConfig?.() ?? {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
      return {
        ok: true as const,
        config: buildScientificPlottingMcpConfigFragment(launch, request.workspaceRoot)
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('mcp:bgc-discovery-config', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'mcp:bgc-discovery-config',
      scientificPlottingMcpConfigPayloadSchema,
      payload
    )
    try {
      const launch = getBgcDiscoveryMcpLaunchConfig?.() ?? {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
      return {
        ok: true as const,
        config: buildBgcDiscoveryMcpConfigFragment(launch, request.workspaceRoot)
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('mcp:image-generation-config', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'mcp:image-generation-config',
      scientificPlottingMcpConfigPayloadSchema,
      payload
    )
    try {
      const launch = getImageGenerationMcpLaunchConfig?.() ?? {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
      const settings = await store.load()
      return {
        ok: true as const,
        config: buildImageGenerationMcpConfigFragment(
          launch,
          request.workspaceRoot,
          settings
        )
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('mcp:sciforge-canvas-config', async (_, payload: unknown) => {
    try {
      const request = parseIpcPayload(
        'mcp:sciforge-canvas-config',
        sciforgeCanvasMcpConfigPayloadSchema,
        payload
      )
      const launch = getSciforgeCanvasMcpLaunchConfig?.() ?? {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
      return {
        ok: true as const,
        config: buildSciforgeCanvasMcpConfigFragment(launch, request.workspaceRoot)
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('sciforge-canvas:status', async (_, payload: unknown) => {
    try {
      const request = parseIpcPayload(
        'sciforge-canvas:status',
        sciforgeCanvasMcpConfigPayloadSchema,
        payload
      )
      return getSciforgeCanvasStatusHandler(request.workspaceRoot)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('drawio:local-url', async () => {
    if (!getLocalDrawioUrl) {
      return {
        ok: false,
        message: 'Local draw.io server is not available.',
        checkedPaths: []
      } satisfies LocalDrawioUrlResult
    }
    return getLocalDrawioUrl()
  })

  handleInvoke('sciforge-canvas:open', async (_, payload: unknown) => {
    try {
      const request = parseIpcPayload(
        'sciforge-canvas:open',
        sciforgeCanvasOpenPayloadSchema,
        payload
      )
      return openOrCreateSciforgeCanvasHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        status: 'invalid_request' as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('sciforge-canvas:save', async (_, payload: unknown) => {
    try {
      const request = parseIpcPayload(
        'sciforge-canvas:save',
        sciforgeCanvasSavePayloadSchema,
        payload
      )
      return saveSciforgeCanvasSnapshotHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        status: 'invalid_request' as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('sciforge-canvas:save-selection', async (_, payload: unknown) => {
    try {
      const request = parseIpcPayload(
        'sciforge-canvas:save-selection',
        sciforgeCanvasSelectionSavePayloadSchema,
        payload
      )
      return saveSciforgeCanvasSelectionHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        status: 'invalid_request' as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('sciforge-canvas:insert-artifact', async (_, payload: unknown) => {
    try {
      const request = parseIpcPayload(
        'sciforge-canvas:insert-artifact',
        sciforgeCanvasInsertArtifactPayloadSchema,
        payload
      )
      return insertSciforgeCanvasArtifactHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        status: 'invalid_request' as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('sciforge-canvas:import-recent-artifacts', async (_, payload: unknown) => {
    try {
      const request = parseIpcPayload(
        'sciforge-canvas:import-recent-artifacts',
        sciforgeCanvasImportRecentArtifactsPayloadSchema,
        payload
      )
      return importRecentSciforgeCanvasArtifactsHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        status: 'invalid_request' as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('sciforge-canvas:split-artifact-components', async (_, payload: unknown) => {
    try {
      const request = parseIpcPayload(
        'sciforge-canvas:split-artifact-components',
        sciforgeCanvasSplitArtifactComponentsPayloadSchema,
        payload
      )
      syncComponentSegmentationEnvFromSettings(await store.load())
      return splitSciforgeCanvasArtifactComponentsHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        status: 'invalid_request' as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('sciforge-canvas:export-review-packet', async (_, payload: unknown) => {
    try {
      const request = parseIpcPayload(
        'sciforge-canvas:export-review-packet',
        sciforgeCanvasReviewPacketPayloadSchema,
        payload
      )
      return exportSciforgeCanvasReviewPacketHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        status: 'invalid_request' as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('scientific-plotting:status', async (_, payload: unknown) => {
    parseIpcPayload(
      'scientific-plotting:status',
      scientificPlottingStatusPayloadSchema,
      payload
    )
    try {
      return getScientificPlottingStatusHandler()
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('scientific-plotting:prepare-reference', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'scientific-plotting:prepare-reference',
      scientificPlottingPrepareReferencePayloadSchema,
      payload
    )
    try {
      return prepareScientificPlottingReferenceHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        status: 'invalid_request' as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('scientific-skills:install', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'scientific-skills:install',
      scientificSkillsInstallPayloadSchema,
      payload
    )
    try {
      return installScientificSkillsHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        status: 'unexpected_error' as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('figure-style:extract', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'figure-style:extract',
      figureStyleExtractPayloadSchema,
      payload
    )
    try {
      return extractFigureStyleHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('figure-style:extract-reference', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'figure-style:extract-reference',
      figureStyleExtractReferencePayloadSchema,
      payload
    ) as FigureStyleExtractReferenceRequest
    try {
      return extractFigureStyleReferenceHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('figure-style:save-spec', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'figure-style:save-spec',
      figureStyleSaveSpecPayloadSchema,
      payload
    ) as FigureStyleSaveSpecRequest
    try {
      return saveFigureStyleSpecHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('figure-style:evaluate', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'figure-style:evaluate',
      figureStyleEvaluatePayloadSchema,
      payload
    )
    try {
      return evaluateFigureStyleHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('figure-style:review', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'figure-style:review',
      figureStyleReviewPayloadSchema,
      payload
    )
    try {
      return reviewFigureStyleHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('mcp:ppt-master-config', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'mcp:ppt-master-config',
      pptMasterMcpConfigPayloadSchema,
      payload
    )
    try {
      const launch = getPptMasterMcpLaunchConfig?.() ?? {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
      return {
        ok: true as const,
        config: buildPptMasterMcpConfigFragment(launch, request.workspaceRoot)
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('skill:open-root', async (_, rootPath: unknown) => {
    const normalizedRootPath = parseIpcPayload('skill:open-root', rootPathSchema, rootPath)
    try {
      const target = expandHomePath(normalizedRootPath)
      if (!target) {
        return { ok: false as const, message: 'Skill directory is required.' }
      }
      await mkdir(target, { recursive: true })
      return openPathWithShell(target)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('runtimeConfig:read', async () => {
    const path = resolveRuntimeConfigPath()
    try {
      const content = await readFile(path, 'utf8')
      return { path, content, exists: true as const }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { path, content: '', exists: false as const }
      }
      throw error
    }
  })

  handleInvoke('runtimeConfig:write', async (_, content: unknown) => {
    const validatedContent = parseIpcPayload(
      'runtimeConfig:write',
      runtimeConfigContentSchema,
      content
    )
    const path = resolveRuntimeConfigPath()
    validateMcpConfigContent(validatedContent)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, validatedContent, 'utf8')
    try {
      await onRuntimeMcpConfigWritten?.(path, validatedContent)
    } catch (error: unknown) {
      logError('mcp-config', 'Failed to apply MCP config change after write', {
        path,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    return { ok: true as const, path }
  })

  handleInvoke('runtimeConfig:open-dir', async () => {
    try {
      const path = resolveRuntimeConfigPath()
      const dirPath = dirname(path)
      await mkdir(dirPath, { recursive: true })
      return openPathWithShell(dirPath)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('modelRouter:config:open', async () => {
    const settings = await store.load()
    return openModelRouterConfigFile(settings)
  })

  handleInvoke('git:branches', async (_, workspaceRoot: unknown) =>
    getGitBranches(parseIpcPayload('git:branches', workspaceRootSchema, workspaceRoot))
  )
  handleInvoke(
    'git:switch-branch',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('git:switch-branch', gitBranchPayloadSchema, payload)
      return switchGitBranch(request.workspaceRoot, request.branch)
    }
  )
  handleInvoke(
    'git:create-and-switch-branch',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'git:create-and-switch-branch',
        gitBranchPayloadSchema,
        payload
      )
      return createAndSwitchGitBranch(request.workspaceRoot, request.branch)
    }
  )

  handleInvoke('editor:list', async () => listEditorsResult())
  handleInvoke('editor:open-path', async (_, payload: unknown) =>
    openEditorPath(parseIpcPayload('editor:open-path', openEditorPathPayloadSchema, payload))
  )

  handleInvoke('file:resolve-workspace', async (_, payload: unknown) =>
    resolveWorkspaceFile(
      parseIpcPayload('file:resolve-workspace', workspaceFileTargetPayloadSchema, payload)
    )
  )
  handleInvoke('file:start-workspace-native-drag', async (event, payload: unknown) => {
    const request = parseIpcPayload(
      'file:start-workspace-native-drag',
      workspaceNativeFileDragPayloadSchema,
      payload
    )
    const resolved = await resolveWorkspaceFile(request)
    if (!resolved.ok) return resolved
    if (!isNativeFileDragSender(event.sender)) {
      return { ok: false, message: 'Native file dragging is not available in this environment.' }
    }
    const icon = await app.getFileIcon(resolved.path).catch(() => nativeImage.createEmpty())
    event.sender.startDrag({ file: resolved.path, icon })
    return {
      ok: true,
      path: resolved.path,
      startedAt: new Date().toISOString()
    }
  })
  handleInvoke('file:list-workspace-directory', async (_, payload: unknown) =>
    listWorkspaceDirectory(
      parseIpcPayload('file:list-workspace-directory', workspaceDirectoryTargetPayloadSchema, payload)
    )
  )
  handleInvoke('file:read-workspace', async (_, payload: unknown) =>
    readWorkspaceFile(
      parseIpcPayload('file:read-workspace', workspaceFileTargetPayloadSchema, payload)
    )
  )
  handleInvoke('file:read-workspace-image', async (_, payload: unknown) =>
    readWorkspaceImage(
      parseIpcPayload('file:read-workspace-image', workspaceFileTargetPayloadSchema, payload)
    )
  )
  handleInvoke('workspacePreview:listPlugins', async (_, payload: unknown) => {
    parseIpcPayload('workspacePreview:listPlugins', workspacePreviewListPluginsPayloadSchema, payload ?? {})
    return workspacePreviewHost.listPlugins()
  })
  handleInvoke('workspacePreview:open', async (event, payload: unknown) => {
    const result = await workspacePreviewHost.open(
      parseIpcPayload('workspacePreview:open', workspacePreviewOpenPayloadSchema, payload)
    )
    if (result.ok) trackWorkspacePreviewSessionForSender(event.sender, result.session.id)
    return result
  })
  handleInvoke('workspacePreview:observe', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'workspacePreview:observe',
      workspacePreviewObservePayloadSchema,
      payload
    )
    return workspacePreviewHost.observe(request.sessionId)
  })
  handleInvoke('workspacePreview:releaseSession', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'workspacePreview:releaseSession',
      workspacePreviewReleaseSessionPayloadSchema,
      payload
    )
    return releaseWorkspacePreviewSession(request.sessionId)
  })
  handleInvoke('workspacePreview:describeAsset', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'workspacePreview:describeAsset',
      workspacePreviewDescribeAssetPayloadSchema,
      payload
    )
    return workspacePreviewHost.describeAsset(request.sessionId)
  })
  handleInvoke('workspacePreview:readRange', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'workspacePreview:readRange',
      workspacePreviewReadRangePayloadSchema,
      payload
    )
    return workspacePreviewHost.readRange(request.sessionId, request.range)
  })
  handleInvoke('workspacePreview:prepareArtifact', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'workspacePreview:prepareArtifact',
      workspacePreviewPrepareArtifactPayloadSchema,
      payload
    )
    return workspacePreviewHost.prepareArtifact(request.sessionId, request.request)
  })
  handleInvoke('workspacePreview:readArtifactRange', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'workspacePreview:readArtifactRange',
      workspacePreviewReadArtifactRangePayloadSchema,
      payload
    )
    return workspacePreviewHost.readArtifactRange(request.sessionId, request.request)
  })
  handleInvoke('workspacePreview:applyEdit', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'workspacePreview:applyEdit',
      workspacePreviewApplyEditPayloadSchema,
      payload
    )
    return workspacePreviewHost.applyEdit(request.sessionId, request.operation)
  })
  handleInvoke('workspacePreview:export', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'workspacePreview:export',
      workspacePreviewExportPayloadSchema,
      payload
    )
    return workspacePreviewHost.exportPreview(request.sessionId, request.target)
  })
  handleInvoke('workspacePreview:invokeAction', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'workspacePreview:invokeAction',
      workspacePreviewInvokeActionPayloadSchema,
      payload
    )
    return workspacePreviewHost.invokeAction(request.sessionId, request.action)
  })
  handleInvoke('file:write-workspace', async (_, payload: unknown) =>
    writeWorkspaceFile(
      parseIpcPayload('file:write-workspace', workspaceFileWritePayloadSchema, payload)
    )
  )
  handleInvoke('file:create-workspace', async (_, payload: unknown) =>
    createWorkspaceFile(
      parseIpcPayload('file:create-workspace', workspaceFileCreatePayloadSchema, payload)
    )
  )
  handleInvoke('file:create-workspace-directory', async (_, payload: unknown) =>
    createWorkspaceDirectory(
      parseIpcPayload('file:create-workspace-directory', workspaceDirectoryCreatePayloadSchema, payload)
    )
  )
  handleInvoke('file:save-workspace-clipboard-image', async (_, payload: unknown) =>
    saveWorkspaceClipboardImage(
      parseIpcPayload(
        'file:save-workspace-clipboard-image',
        workspaceClipboardImageSavePayloadSchema,
        payload
      )
    )
  )
  handleInvoke('clipboard:read-image', async () => readClipboardImage())
  handleInvoke('clipboard:paste-workspace', async (_, payload: unknown) =>
    pasteWorkspaceClipboard(
      parseIpcPayload('clipboard:paste-workspace', workspaceClipboardPastePayloadSchema, payload)
    )
  )
  handleInvoke('file:rename-workspace-entry', async (_, payload: unknown) =>
    renameWorkspaceEntry(
      parseIpcPayload('file:rename-workspace-entry', workspaceEntryRenamePayloadSchema, payload)
    )
  )
  handleInvoke('file:copy-workspace-entry', async (_, payload: unknown) =>
    copyWorkspaceEntry(
      parseIpcPayload('file:copy-workspace-entry', workspaceEntryCopyPayloadSchema, payload)
    )
  )
  handleInvoke('file:import-workspace-entries', async (_, payload: unknown) =>
    importWorkspaceEntries(
      parseIpcPayload('file:import-workspace-entries', workspaceEntryImportPayloadSchema, payload)
    )
  )
  handleInvoke('file:move-workspace-entry', async (_, payload: unknown) =>
    moveWorkspaceEntry(
      parseIpcPayload('file:move-workspace-entry', workspaceEntryMovePayloadSchema, payload)
    )
  )
  handleInvoke('file:delete-workspace-entry', async (_, payload: unknown) =>
    deleteWorkspaceEntry(
      parseIpcPayload('file:delete-workspace-entry', workspaceEntryDeletePayloadSchema, payload)
    )
  )
  const startWorkspaceFileWatch = async (
    event: AppBridgeInvokeEvent,
    payload: unknown,
    channel: 'file:watch-workspace' | 'workspacePreview:watch',
    changeChannel: 'file:workspace-changed' | 'workspacePreview:changed',
    kind: WorkspaceFileWatchRecord['kind']
  ): Promise<WorkspaceFileWatchResult> => {
    const request = parseIpcPayload(channel, workspaceFileWatchPayloadSchema, payload)
    let watchedPath: string
    let watchWorkspaceRoot = request.workspaceRoot
    let initialContent: string
    let initialSize: number
    let initialTruncated: boolean
    let initialMtimeMs: number | undefined
    let startedAt = new Date().toISOString()
    if (kind === 'workspace-preview') {
      const initial = await workspacePreviewHost.prepareWatch(request, startedAt)
      if (!initial.ok) return initial
      watchedPath = initial.path
      watchWorkspaceRoot = initial.workspaceRoot
      initialContent = initial.content
      initialSize = initial.size
      initialTruncated = initial.truncated
      initialMtimeMs = initial.mtimeMs
      startedAt = initial.startedAt
    } else {
      const initial = await readWorkspaceFile(request)
      if (initial.ok) {
        watchedPath = initial.path
        initialContent = initial.content
        initialSize = initial.size
        initialTruncated = initial.truncated
        initialMtimeMs = 'mtimeMs' in initial ? initial.mtimeMs : undefined
      } else {
        const initialImage = await readWorkspaceImage(request)
        if (!initialImage.ok) return initial
        watchedPath = initialImage.path
        initialContent = ''
        initialSize = initialImage.size
        initialTruncated = false
      }
    }

    const watchId = randomUUID()
    try {
      const watcher = watch(watchedPath, { persistent: false }, () => {
        scheduleWorkspaceFileChange(watchId)
      })
      workspaceFileWatchers.set(watchId, {
        watcher,
        sender: event.sender,
        path: watchedPath,
        workspaceRoot: watchWorkspaceRoot,
        kind,
        changeChannel,
        timer: null
      })
      event.sender.once('destroyed', () => disposeWorkspaceFileWatchesForSender(event.sender))
      return {
        ok: true as const,
        watchId,
        path: watchedPath,
        content: initialContent,
        size: initialSize,
        truncated: initialTruncated,
        ...(initialMtimeMs !== undefined ? { mtimeMs: initialMtimeMs } : {}),
        startedAt
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
  handleInvoke('file:watch-workspace', async (event, payload: unknown) =>
    startWorkspaceFileWatch(event, payload, 'file:watch-workspace', 'file:workspace-changed', 'legacy-file')
  )
  handleInvoke('file:unwatch-workspace', async (_, watchId: unknown) =>
    disposeWorkspaceFileWatch(parseIpcPayload('file:unwatch-workspace', streamIdSchema, watchId))
  )
  handleInvoke('workspacePreview:watch', async (event, payload: unknown) =>
    startWorkspaceFileWatch(event, payload, 'workspacePreview:watch', 'workspacePreview:changed', 'workspace-preview')
  )
  handleInvoke('workspacePreview:unwatch', async (_, watchId: unknown) =>
    disposeWorkspaceFileWatch(parseIpcPayload('workspacePreview:unwatch', streamIdSchema, watchId))
  )
  handleInvoke('write:export', async (_, payload: unknown) => {
    const input = parseIpcPayload('write:export', writeExportPayloadSchema, payload)
    const audit = await collectWriteExportEvidenceDagAudit(input, {
      agentRuntime,
      ensureEvidenceDagReady
    })
    const gate = evaluateEvidenceDagHighImpactGate({
      action: 'write:export',
      riskDigest: audit.riskDigest,
      auditCompletedAt: audit.auditCompletedAt,
      auditUnavailableReason: audit.auditUnavailableReason,
      overrideConfirmed: input.evidenceDagGateOverride === true,
      requireFreshAudit: true
    })
    if (!gate.allowed) {
      throw new Error(gate.message)
    }
    const result = await exportWriteDocument(writeExportServicePayload(input), { parentWindow: getMainWindow() })
    return {
      ...result,
      evidenceDagGate: withWriteExportEvidenceDagContext(gate.metadata, input)
    }
  })
  handleInvoke('write:copy-rich-text', async (_, payload: unknown) =>
    copyWriteDocumentAsRichText(
      parseIpcPayload('write:copy-rich-text', writeRichClipboardPayloadSchema, payload)
    )
  )
  handleInvoke('write:inline-completion', async (_, payload: unknown) =>
    requestWriteInlineCompletion(
      await store.load(),
      parseIpcPayload('write:inline-completion', writeInlineCompletionPayloadSchema, payload)
    )
  )
  handleInvoke('write:retrieve-context', async (_, payload: unknown) => {
    try {
      const context = await retrieveWriteContext(
        parseIpcPayload('write:retrieve-context', writeRetrievalPayloadSchema, payload)
      )
      return { ok: true as const, context }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
  handleInvoke('speech:transcribe', async (_, payload: unknown) =>
    transcribeSpeech(
      await store.load(),
      parseIpcPayload('speech:transcribe', speechTranscriptionPayloadSchema, payload)
    )
  )
  handleInvoke('write:inline-completion-debug:list', async () => listWriteInlineCompletionDebugEntries())
  handleInvoke('write:inline-completion-debug:clear', async () => {
    clearWriteInlineCompletionDebugEntries()
    return true
  })
  handleInvoke('desktop:command', async (event, command: unknown) => {
    runDesktopCommand(
      parseIpcPayload('desktop:command', desktopCommandSchema, command),
      event.sender,
      getMainWindow
    )
  })
  handleInvoke('shell:open-external', async (_, url: unknown) => {
    const validatedUrl = parseIpcPayload('shell:open-external', shellOpenExternalUrlSchema, url)
    await shell.openExternal(validatedUrl)
  })
  handleInvoke('evidenceDag:view', async (_, payload: unknown) => {
    const input = parseIpcPayload('evidenceDag:view', evidenceDagViewPayloadSchema, payload)
    await ensureEvidenceDagReady?.()
    const config = evidenceDagViewConfig(process.env)
    const threadId = input.threadId?.trim()
    const engineThreadId = threadId && input.runtimeId
      ? evidenceDagThreadId(input.runtimeId, threadId)
      : undefined
    const [workerStatus, localStatus] = await Promise.all([
      engineThreadId
        ? requestEvidenceDagJson(
            config.serviceUrl,
            config.apiKey,
            `/updates/status?threadId=${encodeURIComponent(engineThreadId)}`,
            { method: 'GET', cache: 'no-store' },
            globalThis.fetch,
            3_000
          )
        : Promise.resolve({ status: 'fresh', pendingCount: 0 }),
      threadId && input.runtimeId
        ? Promise.resolve().then(() => evidenceDagQueueStatus(input.runtimeId!, threadId)).catch(() => undefined)
        : Promise.resolve(undefined)
    ])
    return {
      url: evidenceDagUiUrl({
        runtimeId: input.runtimeId,
        threadId,
        serviceUrl: config.serviceUrl,
        apiKey: config.apiKey
      }),
      ...(threadId ? { threadId } : {}),
      status: dagPanelStatus(workerStatus, localStatus)
    }
  })
  handleInvoke('evidenceDag:update', async (_, payload: unknown) => {
    const input = parseIpcPayload('evidenceDag:update', evidenceDagUpdatePayloadSchema, payload)
    const { detail, items } = await evidenceDagThreadUpdateSource(input, agentRuntime)
    const workspaceRoot = detail.workspace?.trim()
    const includedSessions = workspaceRoot
      ? await projectDagSessionScopeForWorkspace({ workspaceRoot }, agentRuntime)
      : undefined
    const ensured = await ensureEvidenceDagFresh({
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      items,
      targetWatermark: String(detail.latestSeq),
      reason: input.operation === 'rebuild' ? input.rebuildKind! : 'manual_immediate',
      priority: 'immediate',
      rebuild: input.operation === 'rebuild',
      rebuildRationale: input.rebuildRationale,
      projectContext: workspaceRoot ? {
        projectKey: workspaceRoot,
        workspaceRoot,
        projectRoot: workspaceRoot,
        includedSessions
      } : undefined
    })
    const config = evidenceDagViewConfig(process.env)
    return {
      url: evidenceDagUiUrl({
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        serviceUrl: config.serviceUrl,
        apiKey: config.apiKey
      }),
      threadId: input.threadId,
      itemCount: items.length,
      jobId: ensured.jobId,
      status: dagPanelStatus({
        status: 'fresh',
        snapshot: ensured.snapshot,
        desiredWatermark: ensured.snapshot.inputWatermark,
        pendingCount: 0
      })
    }
  })
  handleInvoke('evidenceDag:resolve-evidence-preview', async (_, payload: unknown) => {
    const input = parseIpcPayload(
      'evidenceDag:resolve-evidence-preview',
      evidenceDagEvidencePreviewResolvePayloadSchema,
      payload
    )
    if (!agentRuntime) {
      return {
        ok: false as const,
        code: 'file_unavailable' as const,
        message: 'Agent runtime is required to resolve Evidence DAG workspace evidence.'
      }
    }
    const detail = await agentRuntime.readThread({
      runtimeId: input.runtimeId,
      threadId: input.threadId
    })
    const workspaceRoot = detail.workspace?.trim()
    if (!workspaceRoot) {
      return {
        ok: false as const,
        code: 'file_unavailable' as const,
        message: 'The Evidence DAG thread has no trusted workspace root.'
      }
    }
    await ensureEvidenceDagReady?.()
    const config = evidenceDagViewConfig(process.env)
    const engineThreadId = evidenceDagThreadId(input.runtimeId, input.threadId)
    const query = new URLSearchParams({
      snapshotDigest: input.snapshotDigest,
      sourceAssertionId: input.sourceAssertionId,
      artifactVersionId: input.artifactVersionId,
      sourceAnchorId: input.sourceAnchorId
    })
    const snapshotEvidence = await requestEvidenceDagJson(
      config.serviceUrl,
      config.apiKey,
      `/threads/${encodeURIComponent(engineThreadId)}/evidence-preview?${query.toString()}`,
      { method: 'GET', cache: 'no-store' },
      globalThis.fetch,
      3_000
    )
    return resolveEvidenceDagEvidencePreview(input, {
      engineThreadId,
      workspaceRoot,
      snapshotEvidence,
      resolveWorkspaceFile
    })
  })
  handleInvoke('projectDag:view', async (_, payload: unknown) => {
    const input = parseIpcPayload('projectDag:view', projectDagViewPayloadSchema, payload)
    await ensureProjectDagReady?.()
    const { serviceUrl, apiKey } = projectDagViewConfig(process.env)
    await assertProjectDagServiceReachable(serviceUrl, apiKey)
    const canResolveRuntimeScope = Boolean(
      agentRuntime && (input.workspaceRoot || input.projectRoot || input.sessions?.length)
    )
    const scopedThreads = canResolveRuntimeScope
      ? await projectDagRuntimeThreadsForScope({ ...input, scope: 'all' }, agentRuntime)
      : []
    const sessionScope = scopedThreads.length > 0
      ? scopedThreads.map((thread) => evidenceDagThreadId(thread.runtimeId, thread.id)).sort()
      : await projectDagSessionScopeForWorkspace(input, agentRuntime)
    const [workerStatus, goalsValue, scopedEvidenceStatuses] = await Promise.all([
      requestProjectDagJson(
        serviceUrl,
        apiKey,
        `/updates/status${projectDagStatusQuery(input)}`,
        { method: 'GET', cache: 'no-store' }
      ),
      requestProjectDagJson(
        serviceUrl,
        apiKey,
        `/goals${projectDagStatusQuery(input)}`,
        { method: 'GET', cache: 'no-store' }
      ),
      Promise.all(scopedThreads.map(async (thread) => ({
        engineThreadId: evidenceDagThreadId(thread.runtimeId, thread.id),
        status: await Promise.resolve(evidenceDagQueueStatus(thread.runtimeId, thread.id)).catch((error) => ({
          state: 'degraded' as const,
          pendingCount: 0,
          lastError: error instanceof Error ? error.message : String(error)
        }))
      })))
    ])
    const committedSessions = projectDagCommittedSessions(workerStatus)
    const visibleSessionScope = committedSessions.length > 0 ? committedSessions : sessionScope
    const visibleSessionSet = visibleSessionScope ? new Set(visibleSessionScope) : undefined
    const evidenceStatuses = scopedEvidenceStatuses
      .filter((item) => !visibleSessionSet || visibleSessionSet.has(item.engineThreadId))
      .map((item) => item.status)
    const rootGoal = Array.isArray(goalsValue) ? objectRecord(goalsValue[0]) : null
    const rootGoalId = rootGoal ? optionalStringField(rootGoal, 'id') : undefined
    const rootGoalTitle = rootGoal ? optionalStringField(rootGoal, 'title') : undefined
    return {
      url: projectDagUiUrl({
        serviceUrl,
        apiKey,
        view: input.view === 'attention' ? 'home' : input.view ?? 'graph',
        embed: true,
        workspaceRoot: input.workspaceRoot,
        projectRoot: input.projectRoot,
        project: input.project,
        sessionIds: visibleSessionScope
      }),
      status: projectDagPanelStatus(workerStatus, evidenceStatuses, visibleSessionScope?.length ?? 0),
      ...(rootGoalId && rootGoalTitle ? {
        goal: {
          id: rootGoalId,
          title: rootGoalTitle,
          ...(optionalStringField(rootGoal as Record<string, unknown>, 'description') ? {
            description: optionalStringField(rootGoal as Record<string, unknown>, 'description')
          } : {}),
          ...(typeof rootGoal?.version === 'number' ? { version: rootGoal.version } : {})
        }
      } : {})
    }
  })
  handleInvoke('projectDag:resolve-evidence-preview', async (_, payload: unknown) => {
    const input = parseIpcPayload(
      'projectDag:resolve-evidence-preview',
      projectDagEvidencePreviewResolvePayloadSchema,
      payload
    )
    await ensureProjectDagReady?.()
    const { serviceUrl, apiKey } = projectDagViewConfig(process.env)
    await assertProjectDagServiceReachable(serviceUrl, apiKey)
    const query = new URLSearchParams(projectDagStatusQuery(input).slice(1))
    query.set('snapshot', input.snapshotDigest)
    const claimDetail = await requestProjectDagJson(
      serviceUrl,
      apiKey,
      `/claims/${encodeURIComponent(input.claimId)}?${query.toString()}`,
      { method: 'GET', cache: 'no-store' }
    )
    return resolveProjectDagEvidencePreview(input, {
      claimDetail,
      resolveWorkspaceFile
    })
  })
  handleInvoke('projectDag:update', async (_, payload: unknown) => {
    const input = parseIpcPayload('projectDag:update', projectDagUpdatePayloadSchema, payload)
    await ensureProjectDagReady?.()
    const { serviceUrl, apiKey } = projectDagViewConfig(process.env)
    await assertProjectDagServiceReachable(serviceUrl, apiKey)
    const initialWorkerStatus = await requestProjectDagJson(
      serviceUrl,
      apiKey,
      `/updates/status${projectDagStatusQuery(input)}`,
      { method: 'GET', cache: 'no-store' }
    )
    const committedSessions = projectDagCommittedSessions(initialWorkerStatus)
    const committedDigests = projectDagCommittedEvidenceDigests(initialWorkerStatus)
    const requestedSessions = Array.isArray(input.scope)
      ? [...new Set([...input.scope, ...committedSessions])].sort()
      : input.scope === 'all' && committedSessions.length > 0
        ? committedSessions
        : undefined
    const scopedThreads = await projectDagRuntimeThreadsForScope(
      requestedSessions ? { ...input, scope: requestedSessions } : input,
      agentRuntime
    )
    const availableThreads = new Map(scopedThreads.map((thread) => [
      evidenceDagThreadId(thread.runtimeId, thread.id),
      thread
    ]))
    const scopedIds = new Set(requestedSessions ?? [...availableThreads.keys()])
    const excludedSessions = [...new Set(input.excludedSessions ?? [])].sort()
    const isolatedSessions = [...new Set(input.isolatedSessions ?? [])].sort()
    const overlap = excludedSessions.filter((session) => isolatedSessions.includes(session))
    if (overlap.length > 0) {
      throw new Error(`Project sessions cannot be both excluded and isolated: ${overlap.join(', ')}`)
    }
    const outsideScope = [...excludedSessions, ...isolatedSessions]
      .filter((session) => !scopedIds.has(session))
    if (outsideScope.length > 0) {
      throw new Error(`Project session dispositions are outside the captured workspace scope: ${outsideScope.join(', ')}`)
    }
    const unavailable = new Set([...excludedSessions, ...isolatedSessions])
    const includedSessions = [...scopedIds].filter((session) => !unavailable.has(session)).sort()
    if (includedSessions.length === 0) {
      throw new Error('Project DAG update captured no included runtime sessions.')
    }
    await ensureEvidenceDagReady?.()
    const evidenceConfig = evidenceDagViewConfig(process.env)
    const evidenceStates = await Promise.all(includedSessions.map(async (engineThreadId) => {
      const thread = availableThreads.get(engineThreadId)
      const separator = engineThreadId.indexOf(':')
      const runtimeId = separator > 0 ? engineThreadId.slice(0, separator) : ''
      const threadId = separator > 0 ? engineThreadId.slice(separator + 1) : engineThreadId
      const localStatus: EvidenceDagQueueStatus = runtimeId
        ? await Promise.resolve(evidenceDagQueueStatus(runtimeId, threadId))
            .catch(() => ({ state: 'dirty' as const, pendingCount: 0 }))
        : { state: 'dirty', pendingCount: 0 }
      const workerStatus = await requestEvidenceDagJson(
        evidenceConfig.serviceUrl,
        evidenceConfig.apiKey,
        `/updates/status?threadId=${encodeURIComponent(engineThreadId)}`,
        { method: 'GET', cache: 'no-store' },
        globalThis.fetch,
        3_000
      ).catch(() => undefined)
      return {
        engineThreadId,
        thread,
        localStatus,
        snapshot: localStatus.state === 'fresh' || localStatus.desiredWatermark ||
          committedDigests.has(engineThreadId)
          ? reusableEvidenceSnapshot(
              workerStatus,
              engineThreadId,
              thread?.updatedAt,
              localStatus.desiredWatermark,
              committedDigests.get(engineThreadId)
            )
          : undefined
      }
    }))
    const staleEvidence = evidenceStates.filter((item) => !item.snapshot)
    const projectContext = {
      projectKey: input.workspaceRoot ?? input.projectRoot ?? input.project,
      workspaceRoot: input.workspaceRoot,
      projectRoot: input.projectRoot,
      project: input.project,
      includedSessions,
      excludedSessions,
      isolatedSessions,
      updateReason: 'manual_immediate' as const,
      autonomyMode: input.autonomyMode
    }
    let jobId: string | undefined
    let evidenceStatuses: EvidenceDagQueueStatus[]
    if (staleEvidence.length > 0) {
      if (!agentRuntime) throw new Error('Project DAG requires agent runtime sessions for the current project.')
      const sources = await Promise.all(staleEvidence.map(async ({ thread, engineThreadId }) => {
        if (!thread) {
          throw new Error(
            `Project session ${engineThreadId} is unavailable and has no reusable committed Evidence snapshot.`
          )
        }
        const detail = await agentRuntime.readThread({ runtimeId: thread.runtimeId, threadId: thread.id })
        return {
          runtimeId: thread.runtimeId,
          threadId: thread.id,
          items: evidenceDagBackfillItems(detail),
          targetWatermark: String(detail.latestSeq)
        }
      }))
      const enqueued = await enqueueProjectFresh({ sessions: sources, projectContext })
      jobId = enqueued.coordinatorJobId
      evidenceStatuses = [
        ...evidenceStates.filter((item) => item.snapshot).map(() => ({
          state: 'fresh' as const,
          pendingCount: 0
        })),
        ...enqueued.jobs
      ]
    } else {
      const evidenceSnapshots = evidenceStates.map((item) => item.snapshot!)
      const projectJob = objectRecord(await requestProjectDagJson(
        serviceUrl,
        apiKey,
        '/updates',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(projectContext.projectKey ? { projectKey: projectContext.projectKey } : {}),
            ...(projectContext.workspaceRoot ? { workspaceRoot: projectContext.workspaceRoot } : {}),
            ...(projectContext.projectRoot ? { projectRoot: projectContext.projectRoot } : {}),
            ...(projectContext.project ? { project: projectContext.project } : {}),
            ...(projectContext.autonomyMode ? { autonomyMode: projectContext.autonomyMode } : {}),
            reason: projectContext.updateReason,
            priority: 3,
            evidenceVector: evidenceSnapshots.map((snapshot) => ({
              threadId: snapshot.threadId,
              digest: snapshot.digest
            })),
            evidenceSnapshots,
            capturedScope: { includedSessions, excludedSessions, isolatedSessions }
          })
        }
      ))
      jobId = projectJob ? optionalStringField(projectJob, 'id') : undefined
      await Promise.all(evidenceSnapshots.map((snapshot) => acknowledgeEvidenceDagSnapshot(snapshot)))
      evidenceStatuses = evidenceSnapshots.map(() => ({ state: 'fresh' as const, pendingCount: 0 }))
    }
    const workerStatus = await requestProjectDagJson(
      serviceUrl,
      apiKey,
      `/updates/status${projectDagStatusQuery(input)}`,
      { method: 'GET', cache: 'no-store' }
    )
    const url = projectDagUiUrl({
      serviceUrl,
      apiKey,
      view: 'graph',
      embed: true,
      workspaceRoot: input.workspaceRoot,
      projectRoot: input.projectRoot,
      project: input.project,
      sessionIds: includedSessions
    })
    const panelStatus = projectDagPanelStatus(workerStatus, evidenceStatuses, includedSessions.length)
    return {
      url,
      ...(jobId ? { jobId } : {}),
      status: {
        ...panelStatus,
        autonomyMode: input.autonomyMode ?? panelStatus.autonomyMode,
        scope: { includedSessions, excludedSessions, isolatedSessions }
      }
    }
  })
  handleInvoke('projectDag:save-goal', async (_, payload: unknown) => {
    const input = parseIpcPayload('projectDag:save-goal', projectDagGoalSavePayloadSchema, payload)
    await ensureProjectDagReady?.()
    const { serviceUrl, apiKey } = projectDagViewConfig(process.env)
    await assertProjectDagServiceReachable(serviceUrl, apiKey)
    const goal = objectRecord(await requestProjectDagJson(
      serviceUrl,
      apiKey,
      input.rootGoalId ? `/goals/${encodeURIComponent(input.rootGoalId)}/update` : '/goals',
      {
        method: 'POST',
        body: JSON.stringify({
          title: input.title,
          description: input.description ?? '',
          actorType: 'human',
          actorId: 'sciforge-desktop:user',
          ...(input.rootGoalId ? { reframe: false } : {}),
          ...(input.workspaceRoot ?? input.projectRoot ?? input.project ? {
            projectKey: input.workspaceRoot ?? input.projectRoot ?? input.project
          } : {})
        })
      }
    )) ?? {}
    const workerStatus = await requestProjectDagJson(
      serviceUrl,
      apiKey,
      `/updates/status${projectDagStatusQuery(input)}`,
      { method: 'GET', cache: 'no-store' }
    )
    const goalId = optionalStringField(goal, 'root_id') ?? optionalStringField(goal, 'rootId') ??
      input.rootGoalId ?? optionalStringField(goal, 'id')
    if (!goalId) throw new Error('Project DAG goal command did not return a goal id.')
    return {
      goalId,
      ...(typeof goal.version === 'number' ? { version: goal.version } : {}),
      status: projectDagPanelStatus(workerStatus)
    }
  })
  handleInvoke('notification:turn-complete', async (_, payload: unknown) =>
    showTurnCompleteNotification(
      parseIpcPayload('notification:turn-complete', notificationPayloadSchema, payload)
    )
  )
  handleInvoke('app:version', async () => getAppVersion())
  handleInvoke('gui:update-state', async () => readGuiUpdateState())
  handleInvoke('gui:update-check', async (_, channel: unknown): Promise<GuiUpdateInfo> => {
    const module = await loadGuiUpdaterModule()
    return module.checkGuiUpdate(
      parseIpcPayload(
        'gui:update-check',
        z.object({ channel: guiUpdateChannelSchema }).strict(),
        { channel }
      ).channel
    )
  })
  handleInvoke('gui:update-download', async (_, channel: unknown): Promise<GuiUpdateDownloadResult> => {
    const module = await loadGuiUpdaterModule()
    return module.downloadGuiUpdate(
      parseIpcPayload(
        'gui:update-download',
        z.object({ channel: guiUpdateChannelSchema }).strict(),
        { channel }
      ).channel
    )
  })
  handleInvoke('gui:update-install', async (): Promise<GuiUpdateInstallResult> => {
    const module = await loadGuiUpdaterModule()
    return module.installGuiUpdate()
  })

  handleInvoke('log:error', async (_, payload: unknown) => {
    const request = parseIpcPayload('log:error', logErrorPayloadSchema, payload)
    logError(request.category, request.message, request.detail)
  })
  handleInvoke('log:get-path', async () => resolveLogDirectory())
  handleInvoke('log:open-dir', async () => {
    const dir = resolveLogDirectory()
    try {
      await mkdir(dir, { recursive: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message }
    }
    const error = await shell.openPath(dir)
    if (error) return { ok: false, message: error }
    return { ok: true }
  })

  return { invoke }
}

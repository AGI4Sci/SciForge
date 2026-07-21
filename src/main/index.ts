import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerSaveBlocker, protocol, session, shell, Tray, webContents, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  JsonSettingsStore,
  devServerHintUrl
} from './settings-store'
import sciforgeLogoPng from '../asset/img/sciforge.png?url'
import sciforgeTrayPng from '../asset/img/sciforge_tray.png?url'
import { createAppIcon, pickTrayIcon } from './app-icon'
import { configureLinuxWaylandImeSwitches } from './app-command-line'
import { APP_PRODUCT_NAME, configureAppIdentity } from './app-identity'
import {
  applyCodexRuntimePatch,
  applyClaudeRuntimePatch,
  agentRuntimeSettingsEnvelope,
  getModelAccessSettings,
  isEvidenceDagEnabled,
  mergeConnectPhoneSettings,
  mergeRemoteChannelSettings,
  mergeRemoteExecutorSettings,
  mergeAgentCapabilitySettings,
  mergeComputerUseSettings,
  mergeModelRouterSettings,
  mergeScheduleSettings,
  mergeWorkflowSettings,
  mergeSpeechToTextSettings,
  mergeWriteSettings,
  normalizeAppSettings,
  normalizeAppBehaviorSettings,
  normalizeKeyboardShortcuts,
  resolveRuntimeModelRouterSettings,
  modelAccessRuntimePolicyChanged,
  resolveModelAccessRuntimePolicy,
  type AgentRuntimeId,
  type AppBehaviorConfigV1,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../shared/app-settings'
import type { GuiUpdateState } from '../shared/gui-update'
import { DEV_PREVIEW_NAVIGATE_CHANNEL, isAllowedDevPreviewUrl } from '../shared/dev-preview-url'
import { fetchUpstreamModelIds } from './upstream-models'
import { decideDevPreviewPopup } from './dev-preview-popup-policy'
import {
  codingPlanCredentialStateForAdapter,
  getModelAccessStatus
} from './model-access-status'
import { synchronizeModelAccessSidecar } from './model-access-sidecars'
import { stopModelAccessGatewaySidecar } from './model-access-gateway-sidecar'
import { PLAN_GATEWAY_BASE_URL } from './plan-gateway-config'
import {
  stopDisallowedAgentRuntimes
} from './model-access-runtime-lifecycle'
import {
  ensureEvidenceDagSidecar,
  stopEvidenceDagSidecar
} from '../../packages/workers/evidence-dag/desktop/sidecar'
import {
  ensureProjectDagSidecar,
  stopProjectDagSidecar
} from '../../packages/workers/project-dag/desktop/sidecar'
import {
  paperRadarDbPath,
  paperRadarProfilesPath
} from './paper-radar-paths'
import { createAgentRuntimeHost } from './runtime/agent-runtime/host'
import {
  createRuntimeMcpToolGateway,
  type RuntimeMcpToolGateway
} from './runtime/agent-runtime/runtime-mcp-tool-gateway'
import type { RuntimeToolDefinition } from './runtime/agent-runtime/runtime-tool-contract'
import { createRuntimeCapabilityBroker } from './runtime/agent-runtime/runtime-capability-broker'
import {
  configureEvidenceDagUpdateQueue,
  evidenceDagQueuePath,
  syncEvidenceDagUpdateQueue
} from './runtime/evidence-dag-feed'
import { EvidenceArtifactLifecycle } from './runtime/evidence-artifact-lifecycle'
import { createCodexAgentRuntimeAdapter } from './runtime/codex/codex-agent-runtime-adapter'
import {
  ClaudeCodeRuntimeService,
  createClaudeCodeAgentRuntimeAdapter
} from './runtime/claude-code'
import { LspCodeNavigationService } from './services/lsp-code-navigation-service'
import { LocalTraceStore } from '@sciforge/full-trace'
import { AgentRuntimeTraceRecorder } from './services/agent-runtime-trace-service'
import { CurrentTraceSensitiveSettings } from './trace-sensitive-settings'
import { RuntimeContextStateService } from './services/runtime-context-state-service'
import { RuntimeContextLedgerService } from './services/runtime-context-ledger-service'
import { GitCheckpointService } from './services/git-checkpoint-service'
import { SharedMemoryService } from './services/shared-memory-service'
import { RuntimeGoalService } from './services/runtime-goal-service'
import { ResearchCardService } from './services/research-card-service'
import { WorkspaceReferenceService } from './services/workspace-reference-service'
import {
  VisibleContextService,
  visibleContextSnapshotPath,
  type CapturedVisualPage,
  type SurfaceCaptureProvider,
  type SurfaceCaptureRequest,
  type SurfaceCaptureResult
} from './services/visible-context-service'
import type { VisibleContextBounds } from '../shared/visible-context'
import { artifactInspectOutputSchema } from '../shared/surface-inspection'
import { createModelRouterVisualInspector } from '../../packages/workers/workspace-intel/src/visual-inspection'
import { createWorkspaceIntelService } from '../../packages/workers/workspace-intel/src/service'
import { AnchoredCommentService } from './services/anchored-comment-service'
import { AnchoredCommentScreenshotService } from './services/anchored-comment-screenshot-service'
import { AnchoredCommentFeedbackService } from './services/anchored-comment-feedback-service'
import {
  FeedbackGatewayClient,
  configuredFeedbackGatewayToken,
  configuredFeedbackGatewayUrl
} from './services/feedback-gateway-client'
import { workspaceHtmlPreviewService } from './services/workspace-html-preview-service'
import {
  createPaperRadarWorkerService,
  type PaperRadarWorkerService
} from './services/paper-radar-worker-service'
import { configureLogger, logError, logWarn, pruneOnStartup } from './logger'
import { createRemoteChannelRuntime, type RemoteChannelRuntime } from './remote-channel-runtime'
import { createDiscordBotRuntime, type DiscordBotRuntime } from './discord-bot-runtime'
import { createZulipBotRuntime, type ZulipBotRuntime } from './zulip-bot-runtime'
import { createScheduleRuntime, type ScheduleRuntime } from './schedule-runtime'
import { createWorkflowRuntime, type WorkflowRuntime } from './workflow-runtime'
import {
  syncScheduleMcpConfig,
  type ScheduleMcpLaunchConfig
} from './schedule-mcp-config'
import type { ResearchSearchMcpLaunchConfig } from './research-search-mcp-config'
import type { WorkflowMcpLaunchConfig } from './workflow-mcp-config'
import type { WorkspaceIntelMcpLaunchConfig } from './workspace-intel-mcp-config'
import type { PaperRadarMcpLaunchConfig } from './paper-radar-mcp-config'
import type { WriteAssistMcpLaunchConfig } from './write-assist-mcp-config'
import type { RuntimeInspectorMcpLaunchConfig } from './runtime-inspector-mcp-config'
import type { ScientificSkillsMcpLaunchConfig } from './scientific-skills-mcp-config'
import type { ScientificPlottingMcpLaunchConfig } from './scientific-plotting-mcp-config'
import type { BgcDiscoveryMcpLaunchConfig } from './bgc-discovery-mcp-config'
import {
  type ImageGenerationMcpLaunchConfig
} from './image-generation-mcp-config'
import type { PptMasterMcpLaunchConfig } from './ppt-master-mcp-config'
import type { VisualDocumentMcpLaunchConfig } from './visual-document-mcp-config'
import {
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  isComputerUseMcpConfigured,
  type ComputerUseMcpLaunchConfig
} from './computer-use-mcp-config'
import { buildManagedGuiMcpServers } from './gui-mcp-registry'
import { migrateLegacyKunGlobalConfig } from './legacy-kun-global-config-migration'
import { registerAppIpcHandlers } from './ipc/register-app-ipc-handlers'
import { registerAnchoredCommentIpc } from './ipc/register-anchored-comment-ipc'
import { registerTerminalPtyIpc } from './terminal/terminal-pty-ipc'
import { WorkspacePreviewHost } from './services/workspace-preview'
import { BiologyRoomService } from './services/biology-room-service'
import { CapabilityBroker } from './capabilities/broker'
import { createAppCapabilityRegistry } from './capabilities/app-registry'
import { registerCapabilityIpc } from './capabilities/ipc'
import {
  createCapabilityAgentToolSurface,
  capabilityAgentCallerId,
  type CapabilityAgentToolSurface
} from './capabilities/agent-tools'
import {
  installCapabilityResourceContentProtocol,
  registerCapabilityResourceContentScheme
} from './workspace-preview-asset-protocol'
import {
  startDevBrowserBridgeServer,
  type DevBrowserBridgeServer
} from './dev-browser-bridge'
import {
  configureManagedWeixinBridgeUrlResolver,
  pollFeishuInstall,
  pollWeixinInstall,
  startFeishuInstallQrcode,
  startWeixinInstallQrcode
} from './claw-platform-install'
import {
  CodexRuntimeService,
  type CodexRuntimeEventSink
} from './runtime/codex'
import {
  configureWeixinBridgeRuntimeContextProvider,
  ensureWeixinBridgeRpcUrl,
  sendWeixinBridgeMessage,
  stopWeixinBridgeRuntime
} from './weixin-bridge-runtime'
import { webhookUrl } from './remote-channel-runtime-helpers'
import { APP_USER_MODEL_ID } from '../shared/app-brand'
import { mainPerformanceMonitor } from './performance-monitor'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HIDDEN_START_ARG = '--hidden'
const startupTraceEnabled = process.env.SCIFORGE_STARTUP_TRACE === '1'
const startupTraceStart = Date.now()

function traceStartup(label: string, detail?: unknown): void {
  if (!startupTraceEnabled) return
  const elapsed = String(Date.now() - startupTraceStart).padStart(6, ' ')
  if (detail === undefined) {
    console.info(`[startup +${elapsed}ms] ${label}`)
  } else {
    console.info(`[startup +${elapsed}ms] ${label}`, detail)
  }
}

function shouldStartWeixinBridgeRuntime(settings: AppSettingsV1): boolean {
  return settings.remoteChannel.enabled &&
    settings.remoteChannel.im.enabled &&
    settings.remoteChannel.channels.some((channel) => channel.enabled && channel.provider === 'weixin')
}

function syncWeixinBridgeRuntime(settings: AppSettingsV1): void {
  if (!shouldStartWeixinBridgeRuntime(settings)) return
  void ensureWeixinBridgeRpcUrl().catch((error) => {
    logWarn('weixin-bridge', 'Failed to start managed WeChat bridge.', {
      message: error instanceof Error ? error.message : String(error)
    })
  })
}

function resolveLogDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

async function synchronizeSelectedModelAccessSidecar(
  settings: AppSettingsV1,
  failureMessage: string
): Promise<void> {
  await synchronizeModelAccessSidecar(settings, {
    userDataDir: app.getPath('userData'),
    appRoot: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    resolveProxy: (url) => session.defaultSession.resolveProxy(url),
    logModelRouter: (message) => logWarn('model-router', message),
    logPlanGateway: (message) => logWarn('plan-gateway', message)
  }).catch((error) => {
    const source = getModelAccessSettings(settings)?.mode === 'coding-plan'
      ? 'plan-gateway'
      : 'model-router'
    logWarn(source, failureMessage, {
      message: error instanceof Error ? error.message : String(error)
    })
  })
}

function resolvePreloadPath(): string {
  const cjsPath = join(__dirname, '../preload/index.cjs')
  if (existsSync(cjsPath)) return cjsPath
  return join(__dirname, '../preload/index.mjs')
}

function getScheduleMcpLaunchConfig(): ScheduleMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function getResearchSearchMcpLaunchConfig(): ResearchSearchMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function getWorkflowMcpLaunchConfig(): WorkflowMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function getWorkspaceIntelMcpLaunchConfig(): WorkspaceIntelMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    visibleContextPath: visibleContextSnapshotPath(app.getPath('userData'))
  }
}

function getPaperRadarMcpLaunchConfig(): PaperRadarMcpLaunchConfig {
  const userDataDir = app.getPath('userData')
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    dbPath: paperRadarDbPath(userDataDir),
    profilesPath: paperRadarProfilesPath(userDataDir)
  }
}

function getWriteAssistMcpLaunchConfig(): WriteAssistMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function getRuntimeInspectorMcpLaunchConfig(): RuntimeInspectorMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    checkpointDataDir: app.getPath('userData')
  }
}

function getScientificSkillsMcpLaunchConfig(): ScientificSkillsMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function getScientificPlottingMcpLaunchConfig(): ScientificPlottingMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function getBgcDiscoveryMcpLaunchConfig(): BgcDiscoveryMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function getImageGenerationMcpLaunchConfig(): ImageGenerationMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function getPptMasterMcpLaunchConfig(): PptMasterMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    homeDir: app.getPath('home')
  }
}

function getVisualDocumentMcpLaunchConfig(): VisualDocumentMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function getComputerUseMcpLaunchConfig(): ComputerUseMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function managedGuiMcpServers(settings: AppSettingsV1) {
  return buildManagedGuiMcpServers({
    settings,
    scheduleMcp: { settings, launch: getScheduleMcpLaunchConfig() },
    researchMcp: { launch: getResearchSearchMcpLaunchConfig() },
    workflowMcp: { settings, launch: getWorkflowMcpLaunchConfig() },
    workspaceIntelMcp: { settings, launch: getWorkspaceIntelMcpLaunchConfig() },
    paperRadarMcp: { launch: getPaperRadarMcpLaunchConfig() },
    writeAssistMcp: { settings, launch: getWriteAssistMcpLaunchConfig() },
    runtimeInspectorMcp: { settings, launch: getRuntimeInspectorMcpLaunchConfig() },
    scientificSkillsMcp: { settings, launch: getScientificSkillsMcpLaunchConfig() },
    scientificPlottingMcp: { settings, launch: getScientificPlottingMcpLaunchConfig() },
    bgcDiscoveryMcp: { settings, launch: getBgcDiscoveryMcpLaunchConfig() },
    imageGenerationMcp: { settings, launch: getImageGenerationMcpLaunchConfig() },
    pptMasterMcp: { settings, launch: getPptMasterMcpLaunchConfig() },
    visualDocumentMcp: { settings, launch: getVisualDocumentMcpLaunchConfig() },
    computerUseMcp: { settings, launch: getComputerUseMcpLaunchConfig() }
  })
}

async function runtimeMayUseManagedTool(
  runtimeId: string,
  tool: RuntimeToolDefinition
): Promise<boolean> {
  if (tool.providerId !== GUI_COMPUTER_USE_MCP_SERVER_NAME) return true
  if (runtimeId !== 'codex' && runtimeId !== 'claude') return false
  return isComputerUseMcpConfigured(await store.load(), runtimeId)
}

traceStartup('main module evaluated')

// 在最早的阶段把 app 名称、AppUserModelId 都设好。
// Windows 任务栏 / 系统托盘 / 通知中心看到的应用名都来自这里;
// 设得太晚的话 BrowserWindow title、托盘、IPC 启动时拿到的还是旧的。
// 抽到 app-identity.ts 是为了让测试可以直接 import,不被 main 的
// whenReady 副作用污染。
configureAppIdentity()
configureLinuxWaylandImeSwitches()
registerCapabilityResourceContentScheme(protocol)

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

let mainWindow: BrowserWindow | null = null
let store: JsonSettingsStore
let logDir = ''
let remoteChannelRuntime: RemoteChannelRuntime | null = null
let discordBotRuntime: DiscordBotRuntime | null = null
let zulipBotRuntime: ZulipBotRuntime | null = null
let scheduleRuntime: ScheduleRuntime | null = null
let workflowRuntime: WorkflowRuntime | null = null
let codexRuntime: CodexRuntimeService | null = null
let capabilityAgentTools: CapabilityAgentToolSurface | null = null
let runtimeMcpToolGateway: RuntimeMcpToolGateway | null = null
let claudeCodeRuntime: ClaudeCodeRuntimeService | null = null
let codeNavigationService: LspCodeNavigationService | null = null
let paperRadarWorkerService: PaperRadarWorkerService | null = null
let evidenceArtifactLifecycle: EvidenceArtifactLifecycle | null = null
let managedRuntimesStoppedForQuit = false
let managedRuntimesStopPromise: Promise<void> | null = null
let appBehavior: AppBehaviorConfigV1 = normalizeAppBehaviorSettings()
let tray: Tray | null = null
let isQuitting = false
let devBrowserBridgeServer: DevBrowserBridgeServer | null = null
let codexRuntimePrewarmTimer: ReturnType<typeof setTimeout> | null = null
let codexRuntimePrewarmPromise: Promise<void> | null = null
let remoteChannelActiveThreadContext: {
  threadId: string
  runtimeId?: AgentRuntimeId
  workspaceRoot?: string
  updatedAt: string
} | null = null

async function captureMainWindowPage(bounds?: VisibleContextBounds): Promise<CapturedVisualPage> {
  const window = mainWindow
  if (!window || window.isDestroyed()) throw new Error('SciForge window is unavailable.')
  return captureBrowserWindowPage(window, bounds)
}

async function captureVisibleContextSurface(
  request: SurfaceCaptureRequest
): Promise<SurfaceCaptureResult> {
  const surface = parseVisibleContextSurfaceId(request.windowId)
  if (surface?.kind === 'electron') {
    const contents = webContents.fromId(surface.numericId)
    const window = contents ? BrowserWindow.fromWebContents(contents) : null
    if (!contents || contents.isDestroyed() || !window || window.isDestroyed()) {
      return surfaceCaptureUnavailable(
        'capture_surface_unavailable',
        `Visible surface ${request.windowId} is no longer available.`,
        true
      )
    }
    return {
      ok: true,
      page: await captureBrowserWindowPage(window, request.bounds, contents)
    }
  }

  if (surface?.kind === 'browser') {
    if (!devBrowserBridgeServer?.hasClient(surface.numericId)) {
      return surfaceCaptureUnavailable(
        'capture_surface_unavailable',
        `Browser surface ${request.windowId} is no longer connected.`,
        true
      )
    }
    // The development bridge transports semantic IPC and SSE events, but has no
    // attested browser pixel source. Renderer-supplied image bytes would not be a
    // trusted capture of the surface bound to this snapshot token.
    return surfaceCaptureUnavailable(
      'surface_capture_unsupported',
      `Browser surface ${request.windowId} does not provide trusted pixel capture.`,
      false
    )
  }

  return surfaceCaptureUnavailable(
    'surface_capture_unsupported',
    `Visible surface ${request.windowId} uses an unsupported surface identity.`,
    false
  )
}

type VisibleContextSurfaceId = {
  kind: 'electron' | 'browser'
  numericId: number
}

function parseVisibleContextSurfaceId(windowId: string): VisibleContextSurfaceId | null {
  const match = /^(electron|browser):(\d+)$/u.exec(windowId)
  if (!match) return null
  const numericId = Number(match[2])
  if (!Number.isSafeInteger(numericId) || numericId < 1) return null
  return { kind: match[1] as VisibleContextSurfaceId['kind'], numericId }
}

const visibleContextSurfaceCaptureProvider: SurfaceCaptureProvider = {
  capture: captureVisibleContextSurface
}

function surfaceCaptureUnavailable(
  code: 'surface_capture_unsupported' | 'capture_surface_unavailable',
  message: string,
  retryable: boolean
): SurfaceCaptureResult {
  return { ok: false, reason: { code, message, retryable } }
}

async function captureBrowserWindowPage(
  window: BrowserWindow,
  bounds?: VisibleContextBounds,
  captureContents: WebContents = window.webContents
): Promise<CapturedVisualPage> {
  const [viewportWidth, viewportHeight] = window.getContentSize()
  const clippedBounds = bounds ? clipCaptureBounds(bounds, viewportWidth, viewportHeight) : undefined
  const image = await captureContents.capturePage(clippedBounds)
  const imageSize = image.getSize()
  const cssWidth = clippedBounds?.width ?? Math.max(1, viewportWidth)
  return {
    png: image.toPNG(),
    width: imageSize.width,
    height: imageSize.height,
    scaleFactor: Math.max(0.01, imageSize.width / cssWidth),
    ...(clippedBounds ? { bounds: clippedBounds } : {})
  }
}

function clipCaptureBounds(
  bounds: VisibleContextBounds,
  viewportWidth: number,
  viewportHeight: number
): VisibleContextBounds {
  const x = Math.max(0, Math.floor(bounds.x))
  const y = Math.max(0, Math.floor(bounds.y))
  const right = Math.min(viewportWidth, Math.ceil(bounds.x + bounds.width))
  const bottom = Math.min(viewportHeight, Math.ceil(bounds.y + bounds.height))
  if (right <= x || bottom <= y) {
    throw new Error('Visual target is outside the SciForge window viewport.')
  }
  return { x, y, width: right - x, height: bottom - y }
}

function emitVisibleContextRendererEvent(
  channel: string,
  payload: unknown,
  windowId: string
): void {
  const surface = parseVisibleContextSurfaceId(windowId)
  if (surface?.kind === 'electron') {
    const contents = webContents.fromId(surface.numericId)
    if (contents && !contents.isDestroyed()) contents.send(channel, payload)
    return
  }
  if (surface?.kind === 'browser') {
    devBrowserBridgeServer?.sendTo(surface.numericId, channel, payload)
  }
}

type GuiUpdaterModule = typeof import('./gui-updater')

let guiUpdaterModulePromise: Promise<GuiUpdaterModule> | null = null
let guiUpdaterInitialized = false

function emitRemoteChannelActivity(payload: {
  channelId: string
  threadId: string
  runtimeId?: AgentRuntimeId
  previousThreadId?: string
}): void {
  const startedAt = mainPerformanceMonitor.now()
  mainPerformanceMonitor.count('main.remoteChannel.activity')
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('remoteChannel:activity', payload)
  }
  devBrowserBridgeServer?.send('remoteChannel:activity', payload)
  mainPerformanceMonitor.sample('main.remoteChannel.activity.send', mainPerformanceMonitor.now() - startedAt)
}

const codexRuntimeEventSink: CodexRuntimeEventSink = {
  send(channel, payload) {
    const startedAt = mainPerformanceMonitor.now()
    const eventKind = codexRuntimeEventKind(payload)
    mainPerformanceMonitor.count('main.codex.sink')
    mainPerformanceMonitor.count(`main.codex.sink.${channel}`)
    if (eventKind) mainPerformanceMonitor.count(`main.codex.sink.event.${eventKind}`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload)
    }
    devBrowserBridgeServer?.send(channel, payload)
    mainPerformanceMonitor.sample('main.codex.sink.send', mainPerformanceMonitor.now() - startedAt, {
      channel,
      eventKind
    })
  }
}

function emitSettingsChanged(settings: AppSettingsV1): void {
  const startedAt = mainPerformanceMonitor.now()
  mainPerformanceMonitor.count('main.settings.changed')
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('settings:changed', settings)
  }
  devBrowserBridgeServer?.send('settings:changed', settings)
  mainPerformanceMonitor.sample('main.settings.changed.send', mainPerformanceMonitor.now() - startedAt)
}

function codexRuntimeEventKind(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const event = (payload as { event?: unknown }).event
  if (!event || typeof event !== 'object' || Array.isArray(event)) return undefined
  const kind = (event as { kind?: unknown }).kind
  return typeof kind === 'string' && kind.trim() ? kind.trim() : undefined
}

function getCodexRuntime(): CodexRuntimeService {
  if (codexRuntime) return codexRuntime
  if (!capabilityAgentTools) {
    throw new Error('Capability agent tools must be registered before the Codex runtime starts.')
  }
  const codexStorageRoot = join(app.getPath('userData'), 'codex-runtime')
  codexRuntime = new CodexRuntimeService({
    settings: async () => store.load(),
    sink: codexRuntimeEventSink,
    appVersion: app.getVersion(),
    storageRoot: codexStorageRoot,
    managedCodexHome: app.isPackaged
      ? join(app.getPath('userData'), 'runtime-codex', 'codex-home')
      : join(process.cwd(), '.codex-runtime', 'codex-home'),
    standardCodexAuthPath: join(homedir(), '.codex', 'auth.json'),
    planGateway: { baseUrl: PLAN_GATEWAY_BASE_URL },
    capabilityAgentTools
  })
  return codexRuntime
}

function getClaudeCodeRuntime(): ClaudeCodeRuntimeService {
  if (claudeCodeRuntime) return claudeCodeRuntime
  if (!capabilityAgentTools) {
    throw new Error('Capability agent tools must be registered before the Claude runtime starts.')
  }
  claudeCodeRuntime = new ClaudeCodeRuntimeService({
    settings: async () => store.load(),
    storageRoot: join(app.getPath('userData'), 'claude-code-runtime'),
    managedConfigDir: app.isPackaged
      ? join(app.getPath('userData'), 'runtime-claude-code', 'config')
      : join(process.cwd(), '.claude-code-runtime', 'config'),
    agentTools: capabilityAgentTools
  })
  return claudeCodeRuntime
}

function getPaperRadarWorkerService(): PaperRadarWorkerService {
  if (!paperRadarWorkerService) {
    paperRadarWorkerService = createPaperRadarWorkerService({
      userDataDir: app.getPath('userData')
    })
  }
  return paperRadarWorkerService
}

function scheduleCodexRuntimePrewarm(settings: AppSettingsV1, reason: 'startup' | 'settings-switch'): void {
  if (!resolveModelAccessRuntimePolicy(settings).codex) return
  if (codexRuntimePrewarmTimer) {
    clearTimeout(codexRuntimePrewarmTimer)
    codexRuntimePrewarmTimer = null
  }
  codexRuntimePrewarmTimer = setTimeout(() => {
    codexRuntimePrewarmTimer = null
    const runtime = getCodexRuntime()
    if (codexRuntimePrewarmPromise) return
    const task = runtime.synchronizeModelAccess()
      .then(async () => {
        if (runtime.isClientWarm()) return
        const result = await runtime.connect()
        if (!result.ok) {
          logWarn('codex-runtime', 'Failed to prewarm Codex app-server.', {
            reason,
            message: result.message,
            code: result.code
          })
        }
      })
      .catch((error) => {
        logWarn('codex-runtime', 'Failed to prewarm Codex app-server.', {
          reason,
          message: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        if (codexRuntimePrewarmPromise === task) {
          codexRuntimePrewarmPromise = null
        }
      })
    codexRuntimePrewarmPromise = task
  }, reason === 'startup' ? 1500 : 100)
}

function cancelCodexRuntimePrewarm(): void {
  if (!codexRuntimePrewarmTimer) return
  clearTimeout(codexRuntimePrewarmTimer)
  codexRuntimePrewarmTimer = null
}

async function reconcileSelectedAgentRuntime(settings: AppSettingsV1): Promise<void> {
  await stopDisallowedAgentRuntimes(settings, {
    stopClaude: async () => {
      await claudeCodeRuntime?.stop()
    },
    stopCodex: async () => {
      cancelCodexRuntimePrewarm()
      await codexRuntime?.stop()
    }
  })
}

async function stopManagedRuntimesForQuit(): Promise<void> {
  if (managedRuntimesStoppedForQuit) return
  await stopManagedRuntimes()
  managedRuntimesStoppedForQuit = true
}

async function stopManagedRuntimes(): Promise<void> {
  if (!managedRuntimesStopPromise) {
    managedRuntimesStopPromise = (async () => {
      cancelCodexRuntimePrewarm()
      workflowRuntime?.stop()
      scheduleRuntime?.stop()
      discordBotRuntime?.stop()
      zulipBotRuntime?.stop()
      remoteChannelRuntime?.stop()
      codeNavigationService?.shutdown()
      evidenceArtifactLifecycle?.stop()
      evidenceArtifactLifecycle = null
      paperRadarWorkerService?.close()
      paperRadarWorkerService = null
      await stopEvidenceDagSidecar()
      await stopProjectDagSidecar()
      stopWeixinBridgeRuntime()
      await claudeCodeRuntime?.stop()
      await codexRuntime?.stop()
      await runtimeMcpToolGateway?.close('service_shutdown')
      runtimeMcpToolGateway = null
      // Drain model clients before terminating the shared access sidecar so an
      // active request can finish and its tail trace can be persisted.
      await stopModelAccessGatewaySidecar({
        userDataDir: app.getPath('userData'),
        log: (message) => logWarn('model-access-gateway', message)
      })
    })().finally(() => {
      managedRuntimesStopPromise = null
    })
  }
  return managedRuntimesStopPromise
}

async function loadGuiUpdaterModule(): Promise<GuiUpdaterModule> {
  if (!guiUpdaterModulePromise) {
    guiUpdaterModulePromise = import('./gui-updater')
      .then((module) => {
        if (!guiUpdaterInitialized) {
          module.initializeGuiUpdater(
            () => mainWindow,
            async () => (await store.load()).guiUpdate.channel,
            stopManagedRuntimesForQuit
          )
          guiUpdaterInitialized = true
        }
        return module
      })
      .catch((error) => {
        guiUpdaterModulePromise = null
        throw error
      })
  }
  return guiUpdaterModulePromise
}

async function readGuiUpdateState(): Promise<GuiUpdateState> {
  if (!guiUpdaterModulePromise) return { status: 'idle' }
  try {
    const module = await loadGuiUpdaterModule()
    return module.getGuiUpdateState()
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      code: 'unknown'
    }
  }
}


function installDevPreviewWebviewGuards(): void {
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const src = typeof params.src === 'string' ? params.src : ''
      if (!isAllowedDevPreviewUrl(src)) {
        event.preventDefault()
        return
      }

      delete webPreferences.preload
      delete (webPreferences as { preloadURL?: string }).preloadURL
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      webPreferences.allowRunningInsecureContent = false
    })

    contents.on('will-navigate', (event, navigationUrl) => {
      if (contents.getType() !== 'webview') return
      if (!isAllowedDevPreviewUrl(navigationUrl)) event.preventDefault()
    })

    contents.setWindowOpenHandler(({ url }) => {
      const decision = decideDevPreviewPopup(url, { fromWebview: contents.getType() === 'webview' })
      if (decision.action === 'navigate-preview') {
        try {
          const hostContents = contents.hostWebContents
          if (!hostContents.isDestroyed()) {
            hostContents.send(DEV_PREVIEW_NAVIGATE_CHANNEL, {
              url: decision.url,
              webContentsId: contents.id
            })
          }
        } catch {
          /* host webContents may be unavailable while the guest is being torn down */
        }
        return { action: 'deny' }
      }
      if (decision.action === 'open-external') {
        void shell.openExternal(decision.url).catch(() => undefined)
      }
      return { action: 'deny' }
    })
  })
}


const appIcon = createAppIcon(sciforgeLogoPng)
const trayIcon = createAppIcon(sciforgeTrayPng)
traceStartup('app icon loaded', { source: sciforgeLogoPng.startsWith('data:') ? 'data-url' : 'path' })
const gotSingleInstanceLock = app.requestSingleInstanceLock()
traceStartup('single instance lock checked', {
  gotSingleInstanceLock
})

function trayLabels(locale: AppSettingsV1['locale']): { show: string; quit: string; tooltip: string } {
  if (locale === 'zh') {
    return {
      show: `显示 ${APP_PRODUCT_NAME}`,
      quit: '退出',
      tooltip: APP_PRODUCT_NAME
    }
  }
  return {
    show: `Show ${APP_PRODUCT_NAME}`,
    quit: 'Quit',
    tooltip: APP_PRODUCT_NAME
  }
}

function shouldStartHidden(settings: AppSettingsV1): boolean {
  return (
    process.platform === 'win32' &&
    settings.appBehavior.openAtLogin &&
    settings.appBehavior.startMinimized &&
    process.argv.includes(HIDDEN_START_ARG)
  )
}

function syncLoginItemSettings(settings: AppSettingsV1): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return
  const behavior = settings.appBehavior
  if (process.platform === 'darwin' && !app.isPackaged && !behavior.openAtLogin) return
  try {
    app.setLoginItemSettings({
      openAtLogin: behavior.openAtLogin,
      args:
        process.platform === 'win32' && behavior.openAtLogin && behavior.startMinimized
          ? [HIDDEN_START_ARG]
          : []
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[sciforge] failed to update login item settings:', error)
    logWarn('desktop-behavior', 'Failed to update login item settings.', { message })
  }
}

function revealMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function syncTray(settings: AppSettingsV1): void {
  appBehavior = settings.appBehavior
  if (!appBehavior.closeToTray) {
    if (tray) {
      tray.destroy()
      tray = null
    }
    return
  }

  if (!tray) {
    // Tray 优先用专门的托盘图(在 16x16/24x24 任务栏尺寸下更清晰的剪影);
    // 托盘图加载失败时回退到主应用图,这样不会看到 electron 默认占位。
    const traySource = pickTrayIcon(trayIcon, appIcon)
    tray = new Tray(traySource.isEmpty() ? nativeImage.createEmpty() : traySource)
    tray.on('click', revealMainWindow)
    tray.on('double-click', revealMainWindow)
  }

  const labels = trayLabels(settings.locale)
  tray.setToolTip(labels.tooltip)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: labels.show, click: revealMainWindow },
      { type: 'separator' },
      {
        label: labels.quit,
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

function normalizeNotificationText(raw: string | undefined, fallback: string, maxLength: number): string {
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

type TurnCompleteNotificationPayload = {
  threadId?: string
  title?: string
  body?: string
}

async function showTurnCompleteNotification(
  payload: TurnCompleteNotificationPayload
): Promise<{ ok: true; shown: boolean; reason?: string } | { ok: false; message: string }> {
  const settings = await store.load()
  if (!settings.notifications.turnComplete) {
    return { ok: true, shown: false, reason: 'disabled' }
  }
  if (!Notification.isSupported()) {
    return { ok: true, shown: false, reason: 'unsupported' }
  }

  const title = normalizeNotificationText(payload.title, APP_PRODUCT_NAME, 80)
  const body = normalizeNotificationText(payload.body, 'Conversation complete.', 180)

  try {
    const notification = new Notification({
      title,
      body,
      icon: appIcon.isEmpty() ? undefined : appIcon
    })
    notification.on('click', () => {
      revealMainWindow()
    })
    notification.show()
    return { ok: true, shown: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError('notification', 'Failed to show turn completion notification', {
      message,
      threadId: payload.threadId
    })
    return { ok: false, message }
  }
}

function createWindow(options: { suppressInitialShow?: boolean } = {}): void {
  traceStartup('createWindow:start')
  const preloadPath = resolvePreloadPath()
  const usesDesktopTitleBar = process.platform === 'win32' || process.platform === 'linux'
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    icon: appIcon.isEmpty() ? undefined : appIcon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : usesDesktopTitleBar ? 'hidden' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 31, y: 22 } : undefined,
    autoHideMenuBar: usesDesktopTitleBar,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true
    }
  })
  if (usesDesktopTitleBar) {
    mainWindow.setMenu(null)
    mainWindow.setMenuBarVisibility(false)
  }
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[sciforge] failed to load preload ${preloadPath}:`, error)
    logError('preload', 'Failed to load preload script', { preloadPath, message })
  })
  const showWindow = (): void => {
    if (options.suppressInitialShow) return
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return
    mainWindow.show()
  }
  mainWindow.on('close', (event) => {
    if (isQuitting || !appBehavior.closeToTray) return
    event.preventDefault()
    mainWindow?.hide()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  const devUrl = devServerHintUrl()
  traceStartup('createWindow:load', { devUrl: devUrl ?? 'file' })
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow.once('ready-to-show', () => {
    traceStartup('window:ready-to-show')
    showWindow()
  })
  mainWindow.webContents.once('did-finish-load', () => {
    traceStartup('window:did-finish-load')
    showWindow()
  })
  setTimeout(() => {
    traceStartup('window:fallback-show-timeout')
    showWindow()
  }, 1500)
}

app.whenReady().then(async () => {
  traceStartup('app.whenReady:start')
  if (!gotSingleInstanceLock) {
    // electron-vite has already launched Electron by this point. Exiting here
    // ensures its supervisor tears down the renderer instead of leaving a
    // headless, port-owning development instance behind.
    app.quit()
    return
  }

  traceStartup('install webview guards:start')
  installDevPreviewWebviewGuards()
  traceStartup('install webview guards:done')

  if (process.platform === 'darwin' && !appIcon.isEmpty()) {
    app.dock.setIcon(appIcon)
  }

  store = new JsonSettingsStore(app.getPath('userData'))
  traceStartup('settings load:start')
  const initial = await store.load()
  traceStartup('settings load:done')
  appBehavior = initial.appBehavior
  syncLoginItemSettings(initial)
  syncTray(initial)
  const legacyKunMigration = await migrateLegacyKunGlobalConfig({ homeDir: app.getPath('home') })
  for (const entry of legacyKunMigration.entries) {
    if (entry.status === 'error') {
      console.error('[legacy-kun-migration] failed to move legacy global config:', entry)
    }
  }
  await syncScheduleMcpConfig(initial, getScheduleMcpLaunchConfig()).catch((error) => {
    console.error('[schedule-mcp] failed to sync config on startup:', error)
  })
  logDir = resolveLogDirectory()
  configureLogger({
    dir: logDir,
    enabled: initial.log.enabled,
    retentionDays: initial.log.retentionDays
  })
  traceStartup('logger configured')
  const traceSensitiveSettings = new CurrentTraceSensitiveSettings(initial)
  const fullTraceStore = new LocalTraceStore({
    userDataDirectory: app.getPath('userData'),
    sensitiveValues: traceSensitiveSettings.values
  })
  await fullTraceStore.initialize()
  const agentTraceRecorder = new AgentRuntimeTraceRecorder(fullTraceStore)
  traceStartup('full trace store initialized')
  await synchronizeSelectedModelAccessSidecar(
    initial,
    'Failed to start the selected model access service.'
  )
  if (isEvidenceDagEnabled(initial)) {
    void ensureEvidenceDagSidecar(initial, {
      userDataDir: app.getPath('userData'),
      appRoot: app.getAppPath(),
      log: (message) => logWarn('evidence-dag', message)
    }).catch((error) => {
      logWarn('evidence-dag', 'Failed to auto-start Evidence DAG.', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }
  codeNavigationService = new LspCodeNavigationService()
  const contextStateService = new RuntimeContextStateService()
  const contextLedgerService = new RuntimeContextLedgerService(app.getPath('userData'))
  const gitCheckpointService = new GitCheckpointService(app.getPath('userData'))
  const sharedMemoryService = new SharedMemoryService(app.getPath('userData'))
  const runtimeGoalService = new RuntimeGoalService(app.getPath('userData'))
  const researchCardService = new ResearchCardService(app.getPath('userData'))
  const workspaceReferenceService = new WorkspaceReferenceService()
  const workspacePreviewHost = new WorkspacePreviewHost({
    loadSettings: () => store.load()
  })
  const biologyRoomService = new BiologyRoomService()
  const resolveVisualInspector = async () => {
    const router = resolveRuntimeModelRouterSettings(await store.load())
    if (!router.baseUrl || !router.apiKey || !router.model) return undefined
    return createModelRouterVisualInspector({
      baseUrl: router.baseUrl,
      apiKey: router.apiKey,
      model: router.model
    })
  }
  const visibleContextService = new VisibleContextService(app.getPath('userData'), {
    surfaceCaptureProvider: visibleContextSurfaceCaptureProvider,
    visualInspector: resolveVisualInspector,
    requestSurfaceRefresh: (windowId) => {
      emitVisibleContextRendererEvent('visibleContext:refresh-requested', undefined, windowId)
    },
    onCaptureState: (windowId, active) => {
      emitVisibleContextRendererEvent('visibleContext:capture-state', active, windowId)
    }
  })
  const capabilityBroker = new CapabilityBroker(createAppCapabilityRegistry({
    workspacePreviewHost,
    biologyRoomService,
    visibleContextService,
    inspectArtifacts: async (workspaceRoot, input) => {
      if (!workspaceRoot.trim()) throw new Error('Artifact inspection requires a workspace.')
      const service = createWorkspaceIntelService({
        workspaceRoot,
        visualInspector: await resolveVisualInspector()
      })
      const result = await service.inspectWorkspaceImages({ ...input, workspaceRoot })
      if (!result.ok) throw new Error(result.error.message)
      return artifactInspectOutputSchema.parse({
        artifacts: result.artifacts.map((artifact) => ({
          id: artifact.id,
          artifactRef: `artifact_${randomBytes(18).toString('base64url')}`,
          mimeType: artifact.mimeType,
          size: artifact.size,
          sha256: artifact.sha256
        })),
        evidence: result.evidence
      })
    }
  }))
  runtimeMcpToolGateway = createRuntimeMcpToolGateway({
    servers: managedGuiMcpServers(initial)
  })
  const runtimeCapabilityBroker = createRuntimeCapabilityBroker({
    broker: capabilityBroker,
    managedTools: runtimeMcpToolGateway,
    isToolAvailable: (context, tool) => runtimeMayUseManagedTool(context.runtimeId, tool)
  })
  capabilityAgentTools = createCapabilityAgentToolSurface({
    broker: runtimeCapabilityBroker,
    resolveCaller: (context) => ({
      audience: 'agent',
      callerId: capabilityAgentCallerId(context),
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {})
    })
  })
  const capabilityIpcRegistration = registerCapabilityIpc({ broker: capabilityBroker })
  const anchoredCommentService = new AnchoredCommentService(app.getPath('userData'))
  const agentRuntimeHost = createAgentRuntimeHost({
    settings: async () => store.load(),
    capabilityAvailability: ({ capabilityId, audience }) => {
      const definition = capabilityBroker.registry.get(capabilityId)
      return Boolean(definition?.descriptor.audiences.includes(audience))
    },
    adapters: [
      createCodexAgentRuntimeAdapter(getCodexRuntime()),
      createClaudeCodeAgentRuntimeAdapter(getClaudeCodeRuntime())
    ],
    services: {
      codeNavigation: codeNavigationService,
      trace: agentTraceRecorder,
      contextState: contextStateService,
      contextLedger: contextLedgerService,
      gitCheckpoints: gitCheckpointService,
      memory: sharedMemoryService,
      workspaceReferences: workspaceReferenceService,
      visibleContext: visibleContextService,
      goals: runtimeGoalService
    }
  })
  configureEvidenceDagUpdateQueue({
    storagePath: evidenceDagQueuePath(app.getPath('userData')),
    isEnabled: async () => isEvidenceDagEnabled(await store.load()),
    // Evidence extraction performs several LLM-backed verification passes.
    // Serializing jobs avoids a startup recovery stampede against one Model Router.
    maxConcurrency: 1,
    maxAttempts: 5,
    canRunBackground: () => !agentRuntimeHost.hasActiveTurns(),
    resolveProjectContext: async ({ runtimeId, threadId }) => {
      if (runtimeId !== 'codex' && runtimeId !== 'claude') return undefined
      const detailWorkspace = await agentRuntimeHost.readThread({
        runtimeId,
        threadId
      }).then((detail) => detail.workspace?.trim()).catch(() => undefined)
      const workspaceRoot = detailWorkspace || await agentRuntimeHost.listThreads({
        runtimeId,
        limit: 1_000,
        includeArchived: true,
        includeSide: true
      }).then((threads) => threads.find((thread) => thread.id === threadId)?.workspace?.trim())
        .catch(() => undefined)
      if (!workspaceRoot) return undefined
      return {
        projectKey: workspaceRoot,
        workspaceRoot,
        projectRoot: workspaceRoot,
        includedSessions: [`${runtimeId}:${threadId}`]
      }
    },
    ensureEvidenceDagReady: async () => {
      const settings = await store.load()
      await ensureEvidenceDagSidecar(settings, {
        userDataDir: app.getPath('userData'),
        appRoot: app.getAppPath(),
        log: (message) => logWarn('evidence-dag', message)
      })
    },
    ensureProjectDagReady: async () => {
      const settings = await store.load()
      await ensureProjectDagSidecar(settings, {
        userDataDir: app.getPath('userData'),
        appRoot: app.getAppPath(),
        log: (message) => logWarn('project-dag', message)
      })
    }
  })
  evidenceArtifactLifecycle = new EvidenceArtifactLifecycle({
    threads: agentRuntimeHost,
    ensureEvidenceDagReady: async () => {
      const settings = await store.load()
      await ensureEvidenceDagSidecar(settings, {
        userDataDir: app.getPath('userData'),
        appRoot: app.getAppPath(),
        log: (message) => logWarn('evidence-dag', message)
      })
    },
    log: (message, details) => logWarn('evidence-artifact', message, details)
  })
  if (isEvidenceDagEnabled(initial)) {
    void evidenceArtifactLifecycle.start().catch((error) => {
      logWarn('evidence-artifact', 'Failed to start Artifact lifecycle monitoring.', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }
  workflowRuntime = createWorkflowRuntime({
    store,
    agentRuntime: agentRuntimeHost,
    logError,
    powerSaveBlocker
  })
  workflowRuntime.sync(initial)
  scheduleRuntime = createScheduleRuntime({
    store,
    agentRuntime: agentRuntimeHost,
    logError,
    powerSaveBlocker
  }, {
    runWorkflow: (workflowId, input) => {
      if (!workflowRuntime) return Promise.resolve({ ok: false as const, message: 'Workflow runtime is not initialized.' })
      return workflowRuntime.runWorkflow(workflowId, input)
    },
    status: () => workflowRuntime?.status() ?? Promise.resolve({
      runningWorkflowIds: [],
      nodeStatus: {},
      nodeResults: {},
      powerSaveBlockerActive: false,
      pendingApprovals: []
    })
  })
  scheduleRuntime.sync(initial)
  discordBotRuntime = createDiscordBotRuntime({
    store,
    userDataPath: app.getPath('userData'),
    handleIncomingMessage: async (input) => {
      if (!remoteChannelRuntime) return { ok: false, message: 'Remote channel runtime is not initialized.' }
      return remoteChannelRuntime.handleIncomingImMessage(input)
    },
    onSettingsChanged: (settings) => {
      scheduleRuntime?.sync(settings)
      workflowRuntime?.sync(settings)
      remoteChannelRuntime?.sync(settings)
      discordBotRuntime?.sync(settings)
      syncWeixinBridgeRuntime(settings)
    },
    logError
  })
  zulipBotRuntime = createZulipBotRuntime({
    store,
    userDataPath: app.getPath('userData'),
    handleIncomingMessage: async (input) => {
      if (!remoteChannelRuntime) return { ok: false, message: 'Remote channel runtime is not initialized.' }
      return remoteChannelRuntime.handleIncomingImMessage(input)
    },
    onSettingsChanged: (settings) => {
      scheduleRuntime?.sync(settings)
      workflowRuntime?.sync(settings)
      remoteChannelRuntime?.sync(settings)
      discordBotRuntime?.sync(settings)
      zulipBotRuntime?.sync(settings)
      syncWeixinBridgeRuntime(settings)
    },
    logError
  })
  remoteChannelRuntime = createRemoteChannelRuntime({
    store,
    agentRuntime: agentRuntimeHost,
    getActiveThreadContext: () => remoteChannelActiveThreadContext,
    logError,
    notifyChannelActivity: emitRemoteChannelActivity,
    sendWeixinBridgeMessage,
    sendDiscordChannelMessage: (options) =>
      discordBotRuntime?.sendChannelMessage(options) ??
      Promise.resolve({ ok: false, message: 'Discord bot runtime is not initialized.' }),
    sendZulipChannelMessage: (options) =>
      zulipBotRuntime?.sendChannelMessage(options) ??
      Promise.resolve({ ok: false, message: 'Zulip bot runtime is not initialized.' }),
    createScheduledTaskFromText: (text, options) =>
      scheduleRuntime?.createScheduledTaskFromText(text, options) ?? Promise.resolve({ kind: 'noop' })
  })
  remoteChannelRuntime.sync(initial)
  discordBotRuntime.sync(initial)
  zulipBotRuntime.sync(initial)
  configureWeixinBridgeRuntimeContextProvider(async () => {
    const settings = await store.load()
    const channel = settings.remoteChannel.channels.find((item) => item.enabled && item.provider === 'weixin')
    return {
      webhookUrl: webhookUrl(settings),
      webhookSecret: settings.remoteChannel.im.secret,
      channelId: channel?.id ?? ''
    }
  })
  configureManagedWeixinBridgeUrlResolver(ensureWeixinBridgeRpcUrl)
  syncWeixinBridgeRuntime(initial)

  traceStartup('ipc registration:start')
  const terminalPtyBridge = registerTerminalPtyIpc({
    ipcMain,
    getMainWindow: () => mainWindow,
    logError
  })
  let feedbackGatewayClient: FeedbackGatewayClient | null = null
  try {
    const gatewayUrl = configuredFeedbackGatewayUrl()
    feedbackGatewayClient = gatewayUrl
      ? new FeedbackGatewayClient({
          baseUrl: gatewayUrl,
          authToken: configuredFeedbackGatewayToken() ?? undefined
        })
      : null
  } catch (error) {
    logWarn('anchored-comments', 'Ignoring invalid feedback gateway configuration.', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
  const anchoredCommentScreenshotService = new AnchoredCommentScreenshotService({
    captureWindow: async () => {
      const captured = await captureMainWindowPage()
      const window = mainWindow
      if (!window || window.isDestroyed()) throw new Error('SciForge window is unavailable.')
      const [width, height] = window.getContentSize()
      return {
        png: captured.png,
        viewport: {
          width: Math.max(1, width),
          height: Math.max(1, height),
          scaleFactor: captured.scaleFactor
        }
      }
    },
    assetWriter: anchoredCommentService,
    getAppVersion: () => app.getVersion()
  })
  const anchoredCommentFeedbackService = new AnchoredCommentFeedbackService({
    comments: anchoredCommentService,
    gateway: feedbackGatewayClient
  })
  registerAnchoredCommentIpc({
    ipcMain,
    getMainWindow: () => mainWindow,
    comments: anchoredCommentService,
    screenshots: anchoredCommentScreenshotService,
    feedback: anchoredCommentFeedbackService
  })
  const applySettingsPatch = async (partial: AppSettingsPatch): Promise<AppSettingsV1> => {
    const prev = await store.load()
    const {
      agents: agentsPatch,
      modelRouter: modelRouterPatch,
      agentCapabilities: agentCapabilitiesPatch,
      computerUse: computerUsePatch,
      speechToText: speechToTextPatch,
      connectPhone: connectPhonePatch,
      remoteExecutor: remoteExecutorPatch,
      ...restPatch
    } = partial
    const next = normalizeAppSettings({
      ...applyClaudeRuntimePatch(
        applyCodexRuntimePatch(prev, agentsPatch?.codex),
        agentsPatch?.claude
      ),
      ...restPatch,
      modelRouter: mergeModelRouterSettings(prev.modelRouter, modelRouterPatch),
      agentCapabilities: mergeAgentCapabilitySettings(prev.agentCapabilities, agentCapabilitiesPatch),
      computerUse: mergeComputerUseSettings(prev.computerUse, computerUsePatch),
      log: { ...prev.log, ...(partial.log ?? {}) },
      notifications: { ...prev.notifications, ...(partial.notifications ?? {}) },
      appBehavior: normalizeAppBehaviorSettings({
        ...prev.appBehavior,
        ...(partial.appBehavior ?? {})
      }),
      keyboardShortcuts: normalizeKeyboardShortcuts({
        bindings: {
          ...prev.keyboardShortcuts.bindings,
          ...(partial.keyboardShortcuts?.bindings ?? {})
        }
      }),
      write: mergeWriteSettings(prev.write, partial.write),
      speechToText: mergeSpeechToTextSettings(prev.speechToText, speechToTextPatch),
      remoteChannel: mergeRemoteChannelSettings(prev.remoteChannel, partial.remoteChannel),
      connectPhone: mergeConnectPhoneSettings(prev.connectPhone, connectPhonePatch),
      schedule: mergeScheduleSettings(prev.schedule, partial.schedule),
      workflow: mergeWorkflowSettings(prev.workflow, partial.workflow),
      remoteExecutor: mergeRemoteExecutorSettings(prev.remoteExecutor, remoteExecutorPatch),
      guiUpdate: { ...prev.guiUpdate, ...(partial.guiUpdate ?? {}) }
    } as AppSettingsV1)
    if (prev.log.enabled !== next.log.enabled || prev.log.retentionDays !== next.log.retentionDays) {
      configureLogger({ enabled: next.log.enabled, retentionDays: next.log.retentionDays })
    }
    const saved = await store.patch(partial)
    traceSensitiveSettings.update(saved)
    await runtimeMcpToolGateway?.sync(managedGuiMcpServers(saved))
    emitSettingsChanged(saved)
    await syncScheduleMcpConfig(saved, getScheduleMcpLaunchConfig()).catch((error) => {
      console.error('[schedule-mcp] failed to sync config after settings change:', error)
    })
    if (prev.guiUpdate.channel !== saved.guiUpdate.channel && guiUpdaterModulePromise) {
      void guiUpdaterModulePromise.then((module) => module.setGuiUpdateChannel(saved.guiUpdate.channel))
    }
    const runtimePolicyChanged = modelAccessRuntimePolicyChanged(prev, saved)
    if (runtimePolicyChanged) {
      await reconcileSelectedAgentRuntime(saved)
    }
    if (isEvidenceDagEnabled(prev) !== isEvidenceDagEnabled(saved)) {
      await syncEvidenceDagUpdateQueue(isEvidenceDagEnabled(saved))
      if (isEvidenceDagEnabled(saved)) {
        void evidenceArtifactLifecycle?.start().catch((error) => {
          logWarn('evidence-artifact', 'Failed to start Artifact lifecycle monitoring.', {
            message: error instanceof Error ? error.message : String(error)
          })
        })
      } else {
        evidenceArtifactLifecycle?.stop()
      }
    }
    if (partial.modelRouter || partial.modelAccess) {
      await synchronizeSelectedModelAccessSidecar(
        saved,
        'Failed to switch the selected model access service after settings change.'
      )
    }
    if (
      resolveModelAccessRuntimePolicy(saved).codex &&
      (runtimePolicyChanged || Boolean(partial.modelRouter))
    ) {
      await getCodexRuntime().synchronizeModelAccess()
    }
    scheduleCodexRuntimePrewarm(saved, 'settings-switch')
    if (partial.evidenceDag && !isEvidenceDagEnabled(saved)) {
      await Promise.all([
        stopEvidenceDagSidecar(),
        stopProjectDagSidecar()
      ])
    } else if (isEvidenceDagEnabled(saved) && (partial.modelRouter || partial.evidenceDag)) {
      void ensureEvidenceDagSidecar(saved, {
        userDataDir: app.getPath('userData'),
        appRoot: app.getAppPath(),
        log: (message) => logWarn('evidence-dag', message)
      }).catch((error) => {
        logWarn('evidence-dag', 'Failed to synchronize Evidence DAG after settings change.', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
    scheduleRuntime?.sync(saved)
    workflowRuntime?.sync(saved)
    remoteChannelRuntime?.sync(saved)
    discordBotRuntime?.sync(saved)
    zulipBotRuntime?.sync(saved)
    syncWeixinBridgeRuntime(saved)
    syncLoginItemSettings(saved)
    syncTray(saved)
    return saved
  }

  const fetchModels = async () => {
    const settings = await store.load()
    return fetchUpstreamModelIds(settings)
  }

  installCapabilityResourceContentProtocol(protocol, {
    describe: (access) => capabilityBroker.describeResourceContent({
      audience: 'ui',
      callerId: 'electron:resource-content',
      ...(access.workspaceId ? { workspaceId: access.workspaceId } : {})
    }, access.resource),
    readRange: (access, range) => capabilityBroker.readResourceContentRange({
      audience: 'ui',
      callerId: 'electron:resource-content',
      ...(access.workspaceId ? { workspaceId: access.workspaceId } : {})
    }, access.resource, range)
  })

  const readModelAccessStatus = (settings: AppSettingsV1) => getModelAccessStatus(settings, {
    getCodingPlanCredentialStateImpl: async (_current, adapterId) =>
      codingPlanCredentialStateForAdapter(
        adapterId,
        (input) => agentRuntimeHost.auxiliary(input)
      )
  })

  const appBridgeDispatcher = registerAppIpcHandlers({
    store,
    getMainWindow: () => mainWindow,
    applySettingsPatch,
    getModelAccessStatus: readModelAccessStatus,
    traces: fullTraceStore,
    agentRuntime: agentRuntimeHost,
    fetchUpstreamModels: fetchModels,
    getRemoteChannelRuntime: () => remoteChannelRuntime,
    getDiscordBotRuntime: () => discordBotRuntime,
    getZulipBotRuntime: () => zulipBotRuntime,
    visibleContext: visibleContextService,
    setRemoteChannelActiveThreadContext: (payload) => {
      remoteChannelActiveThreadContext = payload
        ? {
            ...payload,
            updatedAt: new Date().toISOString()
          }
        : null
    },
    getScheduleRuntime: () => scheduleRuntime,
    getWorkflowRuntime: () => workflowRuntime,
    startFeishuInstallQrcode,
    pollFeishuInstall,
    startWeixinInstallQrcode,
    pollWeixinInstall,
    getPaperRadarService: () => getPaperRadarWorkerService(),
    researchCards: researchCardService,
    showTurnCompleteNotification,
    getAppVersion: () => app.getVersion(),
    readGuiUpdateState,
    loadGuiUpdaterModule,
    resolveLogDirectory,
    terminalPtyBridge,
    getMainPerformanceSnapshot: () => mainPerformanceMonitor.snapshot(),
    logError,
    ensureEvidenceDagReady: async () => {
      const settings = await store.load()
      await ensureEvidenceDagSidecar(settings, {
        userDataDir: app.getPath('userData'),
        appRoot: app.getAppPath(),
        log: (message) => logWarn('evidence-dag', message)
      })
    },
    // Lazy: the Project DAG sidecar starts on first use (export button), not at
    // boot — it is only needed when the user compiles the project graph.
    ensureProjectDagReady: async () => {
      const settings = await store.load()
      await ensureProjectDagSidecar(settings, {
        userDataDir: app.getPath('userData'),
        appRoot: app.getAppPath(),
        log: (message) => logWarn('project-dag', message)
      })
    },
    getScientificSkillsMcpLaunchConfig,
    getScientificPlottingMcpLaunchConfig,
    getBgcDiscoveryMcpLaunchConfig,
    getImageGenerationMcpLaunchConfig,
    getPptMasterMcpLaunchConfig
  })

  if (!app.isPackaged && process.env.SCIFORGE_DEV_BROWSER_BRIDGE !== '0') {
    void startDevBrowserBridgeServer({
      dispatcher: {
        invoke: (channel, payload, sender) => (
          capabilityIpcRegistration.handles(channel)
            ? capabilityIpcRegistration.invoke(channel, payload, sender)
            : appBridgeDispatcher.invoke(channel, payload, sender)
        )
      },
      resourceContent: capabilityIpcRegistration.resourceContent,
      allowAllChannels: true,
      instanceId: process.env.SCIFORGE_DEV_INSTANCE_ID
    }).then((server) => {
      devBrowserBridgeServer = server
      console.info(`[sciforge dev] browser bridge listening at ${server.url}`)
      console.info('[sciforge dev] browser bridge accepts localhost renderer origins')
    }).catch((error) => {
      console.warn('[sciforge dev] failed to start browser bridge:', error)
    })
  }

  void loadGuiUpdaterModule().catch((error) => {
    console.warn('[sciforge updater] failed to initialize on startup:', error)
  })

  traceStartup('ipc registration:done')

  createWindow({ suppressInitialShow: shouldStartHidden(initial) })
  traceStartup('createWindow:returned')
  scheduleCodexRuntimePrewarm(initial, 'startup')

  void pruneOnStartup().catch((err) => {
    console.warn('[sciforge] prune logs:', err)
  })

  app.on('second-instance', () => {
    revealMainWindow()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else revealMainWindow()
  })
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[sciforge] startup failed:', error)
  dialog.showErrorBox(`${APP_PRODUCT_NAME} failed to start`, message)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void stopManagedRuntimes().catch((error) => {
      console.warn('[sciforge] failed to stop managed runtimes:', error)
    })
    app.quit()
  }
})

app.on('will-quit', () => {
  const server = devBrowserBridgeServer
  devBrowserBridgeServer = null
  void server?.close().catch((error) => {
    console.warn('[sciforge dev] failed to stop browser bridge:', error)
  })
  void workspaceHtmlPreviewService.close().catch((error) => {
    console.warn('[sciforge] failed to stop HTML preview server:', error)
  })
})

app.on('before-quit', (event) => {
  isQuitting = true
  if (managedRuntimesStoppedForQuit) return
  event.preventDefault()
  void stopManagedRuntimesForQuit()
    .catch((error) => {
      console.warn('[sciforge] failed to stop managed runtimes:', error)
      managedRuntimesStoppedForQuit = true
    })
    .finally(() => {
      app.quit()
    })
})

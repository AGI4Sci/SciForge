import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerSaveBlocker,
  protocol,
  safeStorage,
  session,
  shell,
  Tray,
  webContents,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JsonSettingsStore, devServerHintUrl } from './settings-store'
import sciforgeLogoPng from '../asset/img/sciforge.png?url'
import sciforgeTrayPng from '../asset/img/sciforge_tray.png?url'
import { createAppIcon, pickTrayIcon } from './app-icon'
import { configureLinuxWaylandImeSwitches } from './app-command-line'
import { APP_PRODUCT_NAME, configureAppIdentity } from './app-identity'
import {
  applyCodexRuntimePatch,
  applyClaudeRuntimePatch,
  agentRuntimeSettingsEnvelope,
  getActiveAgentRuntime,
  getModelAccessSettings,
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
  type AppBehaviorConfigV1,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../shared/app-settings'
import type { GuiUpdateState } from '../shared/gui-update'
import { installedDomainPackages } from '../shared/installed-domain-packages'
import { fetchUpstreamModelIds } from './upstream-models'
import { isTrustedRendererUrl } from './renderer-trust'
import { codingPlanCredentialStateForAdapter, getModelAccessStatus } from './model-access-status'
import { synchronizeModelAccessSidecar } from './model-access-sidecars'
import { stopModelAccessGatewaySidecar } from './model-access-gateway-sidecar'
import { PLAN_GATEWAY_BASE_URL } from './plan-gateway-config'
import { stopDisallowedAgentRuntimes } from './model-access-runtime-lifecycle'
import { createAgentRuntimeHost, type AgentRuntimeHost } from './runtime/agent-runtime/host'
import {
  composeAgentRuntimeToolSurfaces,
  createDeferredAgentRuntimeToolSurface,
  type AgentRuntimeToolSurface
} from './runtime/agent-runtime/agent-tool-surface'
import {
  createRuntimeMcpToolGateway,
  type RuntimeMcpToolGateway
} from './runtime/agent-runtime/runtime-mcp-tool-gateway'
import type { RuntimeToolDefinition } from './runtime/agent-runtime/runtime-tool-contract'
import { createRuntimeCapabilityBroker } from './runtime/agent-runtime/runtime-capability-broker'
import { createCodexAgentRuntimeAdapter } from './runtime/codex/codex-agent-runtime-adapter'
import {
  createPlacementAwareAgentRuntimeAdapter,
  createWorkspaceHostCodexAgentRuntimeAdapter
} from './runtime/agent-runtime/workspace-host-agent-runtime-adapter'
import { ClaudeCodeRuntimeService, createClaudeCodeAgentRuntimeAdapter } from './runtime/claude-code'
import { LspCodeNavigationService } from './services/lsp-code-navigation-service'
import { LocalTraceStore, sanitizeTraceTextChunks } from '@sciforge/full-trace'
import { WorkspaceEgressService } from '@sciforge/workspace-egress'
import {
  VISUAL_SOURCE_CONTRACT_VERSION,
  defineVisualSourceProvider,
  renderVisualSource
} from '@sciforge/domain-sdk/visual-source'
import { AgentRuntimeTraceRecorder } from './services/agent-runtime-trace-service'
import { DomainExecutionEventOutbox } from './services/domain-execution-event-outbox'
import { DomainExecutionEventService } from './services/domain-execution-event-service'
import { TurnArtifactHandoffService } from './services/turn-artifact-handoff-service'
import { TurnArtifactOutbox } from './services/turn-artifact-outbox'
import { CurrentTraceSensitiveSettings } from './trace-sensitive-settings'
import { RuntimeContextStateService } from './services/runtime-context-state-service'
import { RuntimeContextLedgerService } from './services/runtime-context-ledger-service'
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
import { RegisteredTargetVisualCaptureService } from './services/registered-target-visual-capture-service'
import type { VisibleContextBounds } from '../shared/visible-context'
import { createModelRouterVisualInspector } from '../../packages/workers/workspace-intel/src/visual-inspection'
import { AgentVisualRuntime } from './runtime/agent-runtime/agent-visual-runtime'
import { workspaceHtmlPreviewService } from './services/workspace-html-preview-service'
import { configureLogger, logError, logInfo, logWarn, pruneOnStartup } from './logger'
import { WorkspaceHostProviderRegistry } from './modules/workspace-host-contributions'
import { WorkspaceHostSessionManager } from './workspace-host/session-manager'
import { createApplicationWorkspaceModelAccessProvider } from './workspace-host/model-access'
import { RemoteWorkspaceController } from './workspace-host/controller'
import {
  resolveApplicationWorkspaceHostArtifact,
  resolveApplicationWorkspaceHostArtifactBaseDirectory
} from './workspace-host/artifact-resolver'
import { createScheduleRuntime, type ScheduleRuntime } from './schedule-runtime'
import { syncScheduleMcpConfig, type ScheduleMcpLaunchConfig } from './schedule-mcp-config'
import type { ResearchSearchMcpLaunchConfig } from './research-search-mcp-config'
import type { WorkspaceIntelMcpLaunchConfig } from './workspace-intel-mcp-config'
import type { WriteAssistMcpLaunchConfig } from './write-assist-mcp-config'
import type { RuntimeInspectorMcpLaunchConfig } from './runtime-inspector-mcp-config'
import type { ScientificSkillsMcpLaunchConfig } from './scientific-skills-mcp-config'
import type { ScientificPlottingMcpLaunchConfig } from './scientific-plotting-mcp-config'
import type { BgcDiscoveryMcpLaunchConfig } from './bgc-discovery-mcp-config'
import { type ImageGenerationMcpLaunchConfig } from './image-generation-mcp-config'
import type { PptMasterMcpLaunchConfig } from './ppt-master-mcp-config'
import { buildManagedGuiMcpServers } from './gui-mcp-registry'
import type { ManagedGuiMcpLaunchConfig } from './managed-gui-mcp-config'
import { migrateLegacyKunGlobalConfig } from './legacy-kun-global-config-migration'
import { registerAppIpcHandlers } from './ipc/register-app-ipc-handlers'
import { ControlledProcessService } from './processes/controlled-process-service'
import { VersionControlWorkspaceService } from './services/version-control-workspace-service'
import { VersionControlPlacementFacade } from './services/version-control-placement-facade'
import { WorkspacePlacementRouter } from './services/workspace-placement-router'
import { WorkspacePreviewHost, WorkspacePreviewPlacementRouter } from './services/workspace-preview'
import { CapabilityBroker } from './capabilities/broker'
import { WORKSPACE_PREVIEW_RESOURCE_KIND, type AppCapabilityDependencies } from './capabilities/app-registry'
import { registerCapabilityIpc } from './capabilities/ipc'
import { HostPrincipalContext } from './principal-context'
import {
  samePrincipalContextSnapshot,
  samePrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import { DomainFileTransferError } from '@sciforge/domain-sdk/file-transfer'
import { HostFileTransferService } from './modules/file-transfer'
import { HostExternalNavigationService } from './modules/external-navigation'
import {
  createPortableResourceReferenceService,
  type PortableResourceReferenceService
} from './modules/portable-resource-references'
import { createDomainExtensionsApi, loadOfficialExtensionKeyring, SignedExtensionStore } from './extensions'
import {
  DomainModuleCatalog,
  activateMainRuntimeContributions,
  createApplicationCapabilityRegistry,
  createApplicationDomainCatalog,
  createMainActionGuardEvaluator,
  createMainSystemCapabilityInvokerFactory,
  listMainArtifactConsumers,
  listMainExtensionContributions,
  listMainMcpTrustedInvocationMetadataContributions,
  listMainRuntimeMcpServerContributions,
  listMainVisualSourceContributions,
  listMainWorkspacePreviewPluginContributions,
  type ActivatedMainRuntimeContributions
} from './modules'
import type { AgentRuntimeThreadListInput, AgentRuntimeThreadStatusInput } from '../shared/agent-runtime-contract'
import {
  createCapabilityAgentToolSurface,
  capabilityAgentCallerId,
  CapabilityAgentToolError,
  type CapabilityAgentToolSurface
} from './capabilities/agent-tools'
import { installElectronDomainNativeVisualSmoke } from './electron-domain-smoke'
import { installProviderCredentialAcceptance } from './provider-credential-acceptance'
import { VisualSourceRegistry } from './runtime/agent-runtime/visual-source-registry'
import {
  installCapabilityResourceContentProtocol,
  registerCapabilityResourceContentScheme
} from './workspace-preview-asset-protocol'
import { startDevBrowserBridgeServer, type DevBrowserBridgeServer } from './dev-browser-bridge'
import { CodexRuntimeService } from './runtime/codex'
import { APP_USER_MODEL_ID } from '../shared/app-brand'
import { mainPerformanceMonitor } from './performance-monitor'
import {
  createDomainPackageStorageFactory,
  createPlatformPackageEncryption
} from './domain-package-storage'
import { ManagedSecretRedactionRegistry } from './managed-secret-redaction'
import {
  projectDomainAgentTurnMessages,
  subscribeDomainAgentTranscriptMessages
} from './domain-agent-transcript'
import {
  createDomainAgentExecutionHost,
  resolveDomainAgentRuntimeReadiness
} from './domain-agent-execution'

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

function resolveLogDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

async function synchronizeSelectedModelAccessSidecar(settings: AppSettingsV1, failureMessage: string): Promise<void> {
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
    const source = getModelAccessSettings(settings)?.mode === 'coding-plan' ? 'plan-gateway' : 'model-router'
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

function getManagedGuiMcpLaunchConfig(): ManagedGuiMcpLaunchConfig {
  const nodeExecPath = app.isPackaged
    ? undefined
    : [process.env.npm_node_execpath, process.env.NODE]
        .map((candidate) => candidate?.trim())
        .find((candidate): candidate is string =>
          Boolean(candidate && isAbsolute(candidate) && existsSync(candidate))
        )
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    ...(nodeExecPath ? { nodeExecPath } : {})
  }
}

function getScheduleMcpLaunchConfig(): ScheduleMcpLaunchConfig {
  return getManagedGuiMcpLaunchConfig()
}

function getResearchSearchMcpLaunchConfig(): ResearchSearchMcpLaunchConfig {
  return getManagedGuiMcpLaunchConfig()
}

function getWorkspaceIntelMcpLaunchConfig(): WorkspaceIntelMcpLaunchConfig {
  return {
    ...getManagedGuiMcpLaunchConfig(),
    visibleContextPath: visibleContextSnapshotPath(app.getPath('userData'))
  }
}

function getWriteAssistMcpLaunchConfig(): WriteAssistMcpLaunchConfig {
  return getManagedGuiMcpLaunchConfig()
}

function getRuntimeInspectorMcpLaunchConfig(): RuntimeInspectorMcpLaunchConfig {
  return getManagedGuiMcpLaunchConfig()
}

function getScientificSkillsMcpLaunchConfig(): ScientificSkillsMcpLaunchConfig {
  return getManagedGuiMcpLaunchConfig()
}

function getScientificPlottingMcpLaunchConfig(): ScientificPlottingMcpLaunchConfig {
  return getManagedGuiMcpLaunchConfig()
}

function getBgcDiscoveryMcpLaunchConfig(): BgcDiscoveryMcpLaunchConfig {
  return getManagedGuiMcpLaunchConfig()
}

function getImageGenerationMcpLaunchConfig(): ImageGenerationMcpLaunchConfig {
  return getManagedGuiMcpLaunchConfig()
}

function getPptMasterMcpLaunchConfig(): PptMasterMcpLaunchConfig {
  return {
    ...getManagedGuiMcpLaunchConfig(),
    homeDir: app.getPath('home')
  }
}

function managedGuiMcpServers(settings: AppSettingsV1) {
  const builtIn = buildManagedGuiMcpServers({
    settings,
    scheduleMcp: { settings, launch: getScheduleMcpLaunchConfig() },
    researchMcp: { launch: getResearchSearchMcpLaunchConfig() },
    workspaceIntelMcp: { settings, launch: getWorkspaceIntelMcpLaunchConfig() },
    writeAssistMcp: { settings, launch: getWriteAssistMcpLaunchConfig() },
    runtimeInspectorMcp: {
      settings,
      launch: getRuntimeInspectorMcpLaunchConfig()
    },
    scientificSkillsMcp: {
      settings,
      launch: getScientificSkillsMcpLaunchConfig()
    },
    scientificPlottingMcp: {
      settings,
      launch: getScientificPlottingMcpLaunchConfig()
    },
    bgcDiscoveryMcp: { settings, launch: getBgcDiscoveryMcpLaunchConfig() },
    imageGenerationMcp: {
      settings,
      launch: getImageGenerationMcpLaunchConfig()
    },
    pptMasterMcp: { settings, launch: getPptMasterMcpLaunchConfig() }
  })
  const contributed = domainModuleCatalog
    ? listMainRuntimeMcpServerContributions(domainModuleCatalog)
      .map((contribution) => {
        const config = contribution.value.createConfig(settings)
        return config
          ? {
              ...config,
              packageName: contribution.packageName,
              args: config.args ? [...config.args] : undefined,
              env: config.env ? { ...config.env } : undefined,
              enabledTools: config.enabledTools ? [...config.enabledTools] : undefined
            }
          : null
      })
      .filter((config): config is NonNullable<typeof config> => config !== null)
    : []
  const combined = [...builtIn, ...contributed]
  const ids = new Set<string>()
  for (const server of combined) {
    if (ids.has(server.id)) throw new Error(`Duplicate managed MCP server id: ${server.id}`)
    ids.add(server.id)
  }
  return combined
}

async function runtimeMayUseManagedTool(runtimeId: string, tool: RuntimeToolDefinition): Promise<boolean> {
  const contribution = domainModuleCatalog
    ? listMainRuntimeMcpServerContributions(domainModuleCatalog)
      .find((candidate) => candidate.value.serverId === tool.providerId)
    : undefined
  return contribution?.value.isRuntimeEnabled
    ? contribution.value.isRuntimeEnabled(await store.load(), runtimeId)
    : true
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
let scheduleRuntime: ScheduleRuntime | null = null
let codexRuntime: CodexRuntimeService | null = null
let capabilityAgentTools: CapabilityAgentToolSurface | null = null
let agentRuntimeTools: AgentRuntimeToolSurface | null = null
let agentRuntimeHostForShutdown: AgentRuntimeHost | null = null
let domainExecutionEventsForShutdown: DomainExecutionEventService | null = null
let turnArtifactHandoffForShutdown: TurnArtifactHandoffService | null = null
let runtimeMcpToolGateway: RuntimeMcpToolGateway | null = null
let claudeCodeRuntime: ClaudeCodeRuntimeService | null = null
let codeNavigationService: LspCodeNavigationService | null = null
let domainModuleCatalog: DomainModuleCatalog | null = null
let mainRuntimeContributions: ActivatedMainRuntimeContributions | null = null
let hostFileTransfersForShutdown: HostFileTransferService | null = null
let hostExternalNavigationForShutdown: HostExternalNavigationService | null = null
let portableResourceReferencesForShutdown: PortableResourceReferenceService | null = null
let portablePrincipalSubscriptionForShutdown: (() => void) | null = null
let workspaceHostSessionManagerForShutdown: WorkspaceHostSessionManager | null = null
let workspaceEgressServiceForShutdown: WorkspaceEgressService | null = null
let managedRuntimesStoppedForQuit = false
let managedRuntimesStopPromise: Promise<void> | null = null
let appBehavior: AppBehaviorConfigV1 = normalizeAppBehaviorSettings()
let tray: Tray | null = null
let isQuitting = false
let devBrowserBridgeServer: DevBrowserBridgeServer | null = null
let codexRuntimePrewarmTimer: ReturnType<typeof setTimeout> | null = null
let codexRuntimePrewarmPromise: Promise<void> | null = null

async function captureMainWindowPage(bounds?: VisibleContextBounds): Promise<CapturedVisualPage> {
  const window = mainWindow
  if (!window || window.isDestroyed()) throw new Error('SciForge window is unavailable.')
  return captureBrowserWindowPage(window, bounds)
}

async function captureVisibleContextSurface(request: SurfaceCaptureRequest): Promise<SurfaceCaptureResult> {
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
    const bridge = devBrowserBridgeServer
    if (!bridge?.hasClient(surface.numericId)) {
      return surfaceCaptureUnavailable(
        'capture_surface_unavailable',
        `Browser surface ${request.windowId} is no longer connected.`,
        true
      )
    }
    try {
      return {
        ok: true,
        page: await bridge.captureSurface(surface.numericId, {
          revision: request.revision,
          ...(request.bounds ? { bounds: request.bounds } : {})
        })
      }
    } catch (error) {
      return surfaceCaptureUnavailable(
        'capture_surface_unavailable',
        error instanceof Error ? error.message : `Browser surface ${request.windowId} pixel capture failed.`,
        true
      )
    }
  }

  return surfaceCaptureUnavailable(
    'capture_surface_unsupported',
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
  code: 'capture_surface_unsupported' | 'capture_surface_unavailable',
  message: string,
  retryable: boolean
): SurfaceCaptureResult {
  return {
    ok: false,
    reason: {
      code,
      message,
      failureClass: code === 'capture_surface_unsupported' ? 'capability_unavailable' : 'upstream_unavailable',
      retryable,
      recovery:
        code === 'capture_surface_unsupported'
          ? {
              action: 'stop',
              instruction: 'Stop visual inspection because this surface has no trusted pixel-capture provider.'
            }
          : {
              action: 'retry_visual_inspection',
              instruction: 'Retry visual inspection after the visible surface reconnects.'
            },
      providerStage: 'surface_capture'
    }
  }
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

function emitVisibleContextRendererEvent(channel: string, payload: unknown, windowId: string): void {
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

function emitSettingsChanged(settings: AppSettingsV1): void {
  const startedAt = mainPerformanceMonitor.now()
  mainPerformanceMonitor.count('main.settings.changed')
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('settings:changed', settings)
  }
  devBrowserBridgeServer?.send('settings:changed', settings)
  mainPerformanceMonitor.sample('main.settings.changed.send', mainPerformanceMonitor.now() - startedAt)
}

function getCodexRuntime(): CodexRuntimeService {
  if (codexRuntime) return codexRuntime
  if (!agentRuntimeTools) {
    throw new Error('AgentRuntime tools must be registered before the Codex runtime starts.')
  }
  const codexStorageRoot = join(app.getPath('userData'), 'codex-runtime')
  codexRuntime = new CodexRuntimeService({
    settings: async () => store.load(),
    appVersion: app.getVersion(),
    storageRoot: codexStorageRoot,
    managedCodexHome: app.isPackaged
      ? join(app.getPath('userData'), 'runtime-codex', 'codex-home')
      : join(process.cwd(), '.codex-runtime', 'codex-home'),
    standardCodexAuthPath: join(homedir(), '.codex', 'auth.json'),
    planGateway: { baseUrl: PLAN_GATEWAY_BASE_URL },
    preToolUseHookLaunch: getManagedGuiMcpLaunchConfig(),
    capabilityAgentTools: agentRuntimeTools
  })
  return codexRuntime
}

function getClaudeCodeRuntime(): ClaudeCodeRuntimeService {
  if (claudeCodeRuntime) return claudeCodeRuntime
  if (!agentRuntimeTools) {
    throw new Error('AgentRuntime tools must be registered before the Claude runtime starts.')
  }
  claudeCodeRuntime = new ClaudeCodeRuntimeService({
    settings: async () => store.load(),
    storageRoot: join(app.getPath('userData'), 'claude-code-runtime'),
    managedConfigDir: app.isPackaged
      ? join(app.getPath('userData'), 'runtime-claude-code', 'config')
      : join(process.cwd(), '.claude-code-runtime', 'config'),
    agentTools: agentRuntimeTools
  })
  return claudeCodeRuntime
}

function scheduleCodexRuntimePrewarm(settings: AppSettingsV1, reason: 'startup' | 'settings-switch'): void {
  if (!resolveModelAccessRuntimePolicy(settings).codex) return
  if (codexRuntimePrewarmTimer) {
    clearTimeout(codexRuntimePrewarmTimer)
    codexRuntimePrewarmTimer = null
  }
  codexRuntimePrewarmTimer = setTimeout(
    () => {
      codexRuntimePrewarmTimer = null
      const runtime = getCodexRuntime()
      if (codexRuntimePrewarmPromise) return
      const task = runtime
        .synchronizeModelAccess()
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
    },
    reason === 'startup' ? 1500 : 100
  )
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
      scheduleRuntime?.stop()
      // Stop every producer before closing the durable execution/turn sinks.
      // Otherwise a disposer or a final runtime event can be accepted after
      // retry timers are gone and remain invisible until the next launch.
      agentRuntimeHostForShutdown?.dispose()
      agentRuntimeHostForShutdown = null
      await claudeCodeRuntime?.stop()
      await codexRuntime?.stop()
      portablePrincipalSubscriptionForShutdown?.()
      portablePrincipalSubscriptionForShutdown = null
      const portableReferences = portableResourceReferencesForShutdown
      portableResourceReferencesForShutdown = null
      await portableReferences?.dispose().catch((error) => {
        logWarn('portable-resources', 'Failed to retire portable resource references.', error)
      })
      // Portable registrations can delegate their disposal to the owning
      // provider runtime. Retire them while domain runtime contributions are
      // still alive, after all invocation producers have stopped.
      const runtimeContributions = mainRuntimeContributions
      mainRuntimeContributions = null
      await runtimeContributions?.dispose().catch((error) => {
        logWarn('domain-runtime', 'Failed to dispose domain runtime contributions.', error)
      })
      const fileTransfers = hostFileTransfersForShutdown
      hostFileTransfersForShutdown = null
      await fileTransfers?.dispose().catch((error) => {
        logWarn('file-transfer', 'Failed to dispose Host file-transfer grants.', error)
      })
      const externalNavigation = hostExternalNavigationForShutdown
      hostExternalNavigationForShutdown = null
      try {
        externalNavigation?.dispose()
      } catch (error) {
        logWarn('external-navigation', 'Failed to dispose Host external targets.', error)
      }
      const workspaceHostSessions = workspaceHostSessionManagerForShutdown
      workspaceHostSessionManagerForShutdown = null
      await workspaceHostSessions?.dispose().catch((error) => {
        logWarn('workspace-host', 'Failed to close Workspace Host sessions.', error)
      })
      await domainExecutionEventsForShutdown?.close()
      domainExecutionEventsForShutdown = null
      await turnArtifactHandoffForShutdown?.close()
      turnArtifactHandoffForShutdown = null
      const workspaceEgress = workspaceEgressServiceForShutdown
      workspaceEgressServiceForShutdown = null
      await workspaceEgress?.close().catch((error) => {
        logWarn('workspace-egress', 'Failed to close Workspace Host network leases.', error)
      })
      codeNavigationService?.shutdown()
      const catalog = domainModuleCatalog
      domainModuleCatalog = null
      catalog?.dispose()
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

const appIcon = createAppIcon(sciforgeLogoPng)
const trayIcon = createAppIcon(sciforgeTrayPng)
traceStartup('app icon loaded', {
  source: sciforgeLogoPng.startsWith('data:') ? 'data-url' : 'path'
})
const gotSingleInstanceLock = app.requestSingleInstanceLock()
traceStartup('single instance lock checked', {
  gotSingleInstanceLock
})

function trayLabels(locale: AppSettingsV1['locale']): {
  show: string
  quit: string
  tooltip: string
} {
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
      args: process.platform === 'win32' && behavior.openAtLogin && behavior.startMinimized ? [HIDDEN_START_ARG] : []
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[sciforge] failed to update login item settings:', error)
    logWarn('desktop-behavior', 'Failed to update login item settings.', {
      message
    })
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
      sandbox: true
    }
  })
  if (usesDesktopTitleBar) {
    mainWindow.setMenu(null)
    mainWindow.setMenuBarVisibility(false)
  }
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[sciforge] failed to load preload ${preloadPath}:`, error)
    logError('preload', 'Failed to load preload script', {
      preloadPath,
      message
    })
  })
  const devUrl = devServerHintUrl()
  const rendererFile = join(__dirname, '../renderer/index.html')
  const trustedRendererUrl = devUrl ?? pathToFileURL(rendererFile).toString()
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isTrustedRendererUrl(navigationUrl, trustedRendererUrl)) event.preventDefault()
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
  traceStartup('createWindow:load', { devUrl: devUrl ?? 'file' })
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(rendererFile)
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

app
  .whenReady()
  .then(async () => {
    traceStartup('app.whenReady:start')
    if (!gotSingleInstanceLock) {
      // electron-vite has already launched Electron by this point. Exiting here
      // ensures its supervisor tears down the renderer instead of leaving a
      // headless, port-owning development instance behind.
      app.quit()
      return
    }

    if (process.platform === 'darwin' && !appIcon.isEmpty()) {
      app.dock?.setIcon(appIcon)
    }

    store = new JsonSettingsStore(app.getPath('userData'))
    traceStartup('settings load:start')
    const initial = await store.load()
    traceStartup('settings load:done')
    const hostDeviceId = initial.installationId?.trim()
    if (!hostDeviceId) {
      throw new Error('Application settings did not provide a stable Host installation identity.')
    }
    appBehavior = initial.appBehavior
    syncLoginItemSettings(initial)
    syncTray(initial)
    const legacyKunMigration = await migrateLegacyKunGlobalConfig({
      homeDir: app.getPath('home')
    })
    for (const entry of legacyKunMigration.entries) {
      if (entry.status === 'error') {
        console.error('[legacy-kun-migration] failed to move legacy global config:', entry)
      }
    }
    await syncScheduleMcpConfig(initial, getScheduleMcpLaunchConfig()).catch((error) => {
      console.error('[schedule-mcp] failed to sync config on startup:', error)
    })
    logDir = resolveLogDirectory()
    const traceSensitiveSettings = new CurrentTraceSensitiveSettings(initial)
    const managedSecretRedaction = new ManagedSecretRedactionRegistry()
    const currentSensitiveValues = () => [
      ...traceSensitiveSettings.values(),
      ...managedSecretRedaction.values()
    ]
    configureLogger({
      dir: logDir,
      enabled: initial.log.enabled,
      retentionDays: initial.log.retentionDays,
      sensitiveValues: currentSensitiveValues
    })
    traceStartup('logger configured')
    const fullTraceStore = new LocalTraceStore({
      userDataDirectory: app.getPath('userData'),
      sensitiveValues: currentSensitiveValues
    })
    await fullTraceStore.initialize()
    const agentTraceRecorder = new AgentRuntimeTraceRecorder(fullTraceStore)
    traceStartup('full trace store initialized')
    await synchronizeSelectedModelAccessSidecar(initial, 'Failed to start the selected model access service.')
    codeNavigationService = new LspCodeNavigationService()
    const contextStateService = new RuntimeContextStateService()
    const contextLedgerService = new RuntimeContextLedgerService(app.getPath('userData'))
    const sharedMemoryService = new SharedMemoryService(app.getPath('userData'))
    const runtimeGoalService = new RuntimeGoalService(app.getPath('userData'))
    const researchCardService = new ResearchCardService(app.getPath('userData'))
    const workspaceReferenceService = new WorkspaceReferenceService()
    let domainSystemCapabilityInvokers: ReturnType<
      typeof createMainSystemCapabilityInvokerFactory
    > | null = null
    let capabilityBrokerForVisibleContext: CapabilityBroker | null = null
    const visibleContextService = new VisibleContextService(app.getPath('userData'), {
      surfaceCaptureProvider: visibleContextSurfaceCaptureProvider,
      retainResourceRefs: ({ callerId, workspaceId, resourceRefs }) => {
        const broker = capabilityBrokerForVisibleContext
        if (!broker) throw new Error('Capability resources are not ready for task binding.')
        return broker.retainResourceRefs(
          {
            audience: 'agent',
            callerId,
            ...(workspaceId ? { workspaceId } : {})
          },
          resourceRefs
        )
      },
      requestSurfaceRefresh: (windowId) => {
        emitVisibleContextRendererEvent('visibleContext:refresh-requested', undefined, windowId)
      },
      onCaptureState: (windowId, active) => {
        emitVisibleContextRendererEvent('visibleContext:capture-state', active, windowId)
      }
    })
    const registeredTargetVisualCapture = new RegisteredTargetVisualCaptureService({
      resolveRegisteredTarget: (targetRef) => visibleContextService.resolveRegisteredTarget(targetRef),
      captureWindow: async (surface) => {
        const captured = await visibleContextSurfaceCaptureProvider.capture(surface)
        if (!captured.ok) throw new Error(captured.reason.message)
        return {
          png: captured.page.png,
          width: captured.page.width,
          height: captured.page.height,
          scaleFactor: captured.page.scaleFactor
        }
      }
    })
    let principalContextForDomainServices: HostPrincipalContext | null = null
    let capabilityBrokerForDomainServices: CapabilityBroker | null = null
    let portableResourceReferences: PortableResourceReferenceService | null = null
    const domainPackageStorage = createDomainPackageStorageFactory({
      userDataDir: app.getPath('userData'),
      encryption: createPlatformPackageEncryption({ safeStorage }),
      getDeviceId: () => hostDeviceId,
      currentPrincipal: () => principalContextForDomainServices?.current(),
      secretRedaction: managedSecretRedaction
    })
    const isPrincipalCurrentForDomainServices = (principal: Parameters<
      typeof samePrincipalSnapshot
    >[0]): boolean => samePrincipalSnapshot(
      principalContextForDomainServices?.current(),
      principal
    )
    const hostFileTransfers = new HostFileTransferService({
      isPrincipalCurrent: isPrincipalCurrentForDomainServices,
      reportCleanupError: (error) => {
        logWarn('file-transfer', 'Failed to clean up a Host file-transfer grant.', error)
      }
    })
    const hostExternalNavigation = new HostExternalNavigationService({
      isPrincipalCurrent: isPrincipalCurrentForDomainServices,
      openExternal: async (url) => {
        await shell.openExternal(url)
      }
    })
    hostFileTransfersForShutdown = hostFileTransfers
    hostExternalNavigationForShutdown = hostExternalNavigation
    const catalog = createApplicationDomainCatalog({
      getUserDataDir: () => app.getPath('userData'),
      getDeviceId: () => hostDeviceId,
      getAppVersion: () => app.getVersion(),
      getAppRoot: () => app.getAppPath(),
      getExecutablePath: () => process.execPath,
      isPackaged: () => app.isPackaged,
      textSanitizer: {
        sanitizeText: (value) => sanitizeTraceTextChunks([value], {
          sensitiveValues: currentSensitiveValues()
        })[0] ?? ''
      },
      openPath: async (targetPath) => {
        const error = await shell.openPath(targetPath)
        if (error) throw new Error(error)
      },
      resolveWorkspaceServerArtifact: () =>
        resolveApplicationWorkspaceHostArtifact({
          baseDirectory: resolveApplicationWorkspaceHostArtifactBaseDirectory({
            isPackaged: app.isPackaged,
            appPath: app.getAppPath(),
            resourcesPath: process.resourcesPath
          })
        }),
      capabilityInvokerFor: (owner) => {
        let scopedInvoker: ReturnType<
          ReturnType<typeof createMainSystemCapabilityInvokerFactory>['forDomain']
        > | null = null
        const getScopedInvoker = () => {
          if (!scopedInvoker) {
            if (!domainSystemCapabilityInvokers) {
              throw new Error('The Host capability broker is not ready.')
            }
            scopedInvoker = domainSystemCapabilityInvokers.forDomain(owner)
          }
          return scopedInvoker
        }
        return Object.freeze({
          invoke: (contract, input, options) =>
            getScopedInvoker().invoke(contract, input, options),
          createApprovedBatch: (plan) => getScopedInvoker().createApprovedBatch(plan)
        })
      },
      packageStorageFor: (owner) => domainPackageStorage.forOwner(owner),
      fileTransfersFor: (owner) => hostFileTransfers.forOwner(
        owner.moduleId,
        () => capabilityBrokerForDomainServices?.currentInvocation()
      ),
      externalNavigationFor: (owner) => hostExternalNavigation.forOwner(
        owner.moduleId,
        () => capabilityBrokerForDomainServices?.currentInvocation()
      ),
      portableResourcesFor: (owner) => Object.freeze({
        materialize: (reference, options) => {
          if (!portableResourceReferences) {
            throw new Error('Portable resource references are not ready.')
          }
          return portableResourceReferences.forOwner(owner).materialize(reference, options)
        },
        discard: (input) => {
          if (!portableResourceReferences) {
            throw new Error('Portable resource references are not ready.')
          }
          return portableResourceReferences.forOwner(owner).discard(input)
        },
        export: (input, options) => {
          if (!portableResourceReferences) {
            throw new Error('Portable resource references are not ready.')
          }
          return portableResourceReferences.forOwner(owner).export(input, options)
        }
      }),
      visualCapture: registeredTargetVisualCapture
    })
    const workspaceEgressService = new WorkspaceEgressService({
      routeResolver: {
        resolve: () => {
          throw new Error('General workspace egress routes must be resolved by their owning domain package.')
        }
      }
    })
    workspaceEgressServiceForShutdown = workspaceEgressService
    const workspaceModelAccess = createApplicationWorkspaceModelAccessProvider({
      loadSettings: () => store.load(),
      bridge: workspaceEgressService
    })
    const workspaceHostSessions = new WorkspaceHostSessionManager(new WorkspaceHostProviderRegistry(catalog), {
      workspaceModelAccess,
      log: ({ level, message, ...detail }) => {
        if (level === 'error') logError('workspace-host', message, detail)
        else if (level === 'warn') logWarn('workspace-host', message, detail)
        else if (level === 'info') logInfo('workspace-host', message)
      }
    })
    workspaceHostSessionManagerForShutdown = workspaceHostSessions
    const remoteWorkspaceController = new RemoteWorkspaceController(workspaceHostSessions)
    let officialExtensionKeys
    let extensionInstallationBlockedReason: string | undefined
    try {
      officialExtensionKeys = await loadOfficialExtensionKeyring({
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged,
        explicitPath: process.env.SCIFORGE_OFFICIAL_EXTENSION_KEYS_FILE
      })
      if (officialExtensionKeys.keys.length === 0) {
        extensionInstallationBlockedReason = 'No SciForge official extension signing keys are configured in this build.'
        logWarn('extensions', extensionInstallationBlockedReason)
      } else {
        logInfo('extensions', `Loaded ${officialExtensionKeys.keys.length} SciForge official extension signing key(s).`)
      }
    } catch (error) {
      extensionInstallationBlockedReason =
        error instanceof Error ? error.message : 'The SciForge official extension keyring is invalid.'
      officialExtensionKeys = { keys: [], sourcePath: null }
      logError('extensions', 'Official extension keyring initialization failed.', {
        message: extensionInstallationBlockedReason
      })
    }
    const signedExtensionStore = new SignedExtensionStore({
      userDataPath: app.getPath('userData'),
      hostApiVersion: catalog.hostApiVersion,
      trustedKeys: officialExtensionKeys.keys,
      reservedIdentities: {
        packageNames: catalog.listPackages().map((definition) => definition.packageName),
        moduleIds: catalog.listPackages().map((definition) => definition.module.id)
      }
    })
    const domainExtensionsApi = createDomainExtensionsApi({
      bundledDefinitions: catalog.listPackages(),
      store: signedExtensionStore,
      ...(extensionInstallationBlockedReason ? { installationBlockedReason: extensionInstallationBlockedReason } : {})
    })
    const actionGuardEvaluator = createMainActionGuardEvaluator(catalog)
    const localWorkspacePreviewHost = new WorkspacePreviewHost({
      domainPlugins: listMainWorkspacePreviewPluginContributions(catalog),
      loadSettings: () => store.load()
    })
    const workspacePreviewHost = new WorkspacePreviewPlacementRouter({
      local: localWorkspacePreviewHost,
      resolveWorkspaceHostSessionPort: (locator) => workspaceHostSessions.portFor(locator)
    })
    const resolveVisualInspector = async () => {
      const router = resolveRuntimeModelRouterSettings(await store.load())
      if (!router.baseUrl || !router.apiKey || !router.model) return undefined
      return createModelRouterVisualInspector({
        baseUrl: router.baseUrl,
        apiKey: router.apiKey,
        model: router.model
      })
    }
    const controlledProcessService = new ControlledProcessService({
      log: (message, detail) => logError('controlled-process', message, detail)
    })
    const workspacePlacement = new WorkspacePlacementRouter({
      sessionManager: workspaceHostSessions,
      localControlledProcesses: controlledProcessService
    })
    const versionControlWorkspaceService = new VersionControlWorkspaceService()
    const versionControlPlacement = new VersionControlPlacementFacade({
      local: versionControlWorkspaceService,
      workspacePlacement
    })
    app.once('will-quit', () => {
      void workspacePlacement.disposeAll()
    })
    const appCapabilityDependencies: AppCapabilityDependencies = {
      controlledProcessService: workspacePlacement,
      workspacePreviewHost,
      visibleContextService,
      versionControlWorkspaceService: versionControlPlacement
    }
    const principalContext = new HostPrincipalContext(catalog)
    principalContextForDomainServices = principalContext
    const capabilityBroker = new CapabilityBroker(
      createApplicationCapabilityRegistry(catalog, appCapabilityDependencies),
      { resolveCurrentPrincipalContext: () => principalContext.snapshot() }
    )
    installProviderCredentialAcceptance(
      domainPackageStorage,
      () => principalContext.current()
    )
    capabilityBrokerForDomainServices = capabilityBroker
    portableResourceReferences = createPortableResourceReferenceService(
      capabilityBroker,
      Object.freeze({ list: () => listMainExtensionContributions(catalog) }),
      () => principalContext.current(),
      {
        reportCleanupError: (error) => {
          logWarn('portable-resources', 'Failed to clean up a portable resource reference.', error)
        }
      }
    )
    portableResourceReferencesForShutdown = portableResourceReferences
    portablePrincipalSubscriptionForShutdown = principalContext.subscribe((snapshot) => {
      void portableResourceReferences?.revokeStalePrincipals(
        snapshot.principal ?? undefined
      ).catch((error) => {
        logWarn('portable-resources', 'Failed to retire stale Principal resources.', error)
      })
    }) ?? null
    capabilityBrokerForVisibleContext = capabilityBroker
    domainSystemCapabilityInvokers = createMainSystemCapabilityInvokerFactory(capabilityBroker)
    const visualSourceRegistry = new VisualSourceRegistry([
      {
        ownerId: 'sciforge.agent-runtime',
        provider: defineVisualSourceProvider({
          contract: {
            contractVersion: VISUAL_SOURCE_CONTRACT_VERSION,
            id: 'sciforge.core.surface-visual-source',
            resourceKinds: ['surface']
          },
          render: async (request) => {
            const targetRef = request.target?.kind === 'target-ref' ? request.target.targetRef : undefined
            if (request.target && !targetRef) {
              throw new Error('The current surface source accepts only an opaque target reference.')
            }
            const frame = await visibleContextService.captureFrame(request.resource.resourceId, {
              ...(targetRef ? { targetRef } : {})
            })
            return {
              bytes: new Uint8Array(await readFile(frame.path)),
              mimeType: frame.mimeType,
              width: frame.width,
              height: frame.height,
              sourceRevision: request.resource.semanticRevision,
              anchor: {
                kind: targetRef ? 'surface-target' : 'surface'
              }
            }
          }
        })
      },
      {
        ownerId: 'sciforge.workspace-preview',
        provider: defineVisualSourceProvider({
          contract: {
            contractVersion: VISUAL_SOURCE_CONTRACT_VERSION,
            id: 'sciforge.core.workspace-preview-visual-source',
            resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND]
          },
          render: (request) =>
            workspacePreviewHost.renderVisual(request.resource.resourceId, {
              ...(request.frameIndex ? { frameIndex: request.frameIndex } : {}),
              ...(request.target ? { target: request.target } : {}),
              ...(request.maxDimension ? { maxDimension: request.maxDimension } : {})
            })
        })
      },
      ...listMainVisualSourceContributions(catalog)
    ])
    domainModuleCatalog = catalog
    runtimeMcpToolGateway = createRuntimeMcpToolGateway({
      servers: managedGuiMcpServers(initial),
      trustedInvocationMetadata: listMainMcpTrustedInvocationMetadataContributions(catalog)
    })
    const agentRuntimeHostRef: { current: AgentRuntimeHost | null } = {
      current: null
    }
    const assertAgentPrincipalLease = (context: {
      runtimeId: string
      threadId?: string
      turnId?: string
    }): ReturnType<AgentRuntimeHost['principalForToolRequest']> => {
      if (!context.threadId || !context.turnId) {
        throw new CapabilityAgentToolError(
          'missing_invocation_context',
          'Agent capability requests require an exact runtime, thread, and turn identity.'
        )
      }
      const runtimeHost = agentRuntimeHostRef.current
      if (!runtimeHost) {
        throw new CapabilityAgentToolError(
          'principal_changed',
          'The Host cannot verify the Agent turn Principal lease.'
        )
      }
      let capturedPrincipal: ReturnType<AgentRuntimeHost['principalForToolRequest']>
      try {
        capturedPrincipal = runtimeHost.principalForToolRequest({
          runtimeId: context.runtimeId,
          threadId: context.threadId,
          turnId: context.turnId
        })
      } catch (error) {
        throw new CapabilityAgentToolError(
          'principal_changed',
          'The Agent turn Principal lease is unknown or no longer available.',
          { details: { reason: error instanceof Error ? error.message : String(error) } }
        )
      }
      if (!samePrincipalContextSnapshot(capturedPrincipal, principalContext.snapshot())) {
        throw new CapabilityAgentToolError(
          'principal_changed',
          'The current Principal no longer matches the Agent turn Principal lease.'
        )
      }
      return capturedPrincipal
    }
    const runtimeCapabilityBroker = createRuntimeCapabilityBroker({
      broker: capabilityBroker,
      managedTools: runtimeMcpToolGateway,
      assertPrincipalLease: (context) => { assertAgentPrincipalLease(context) },
      isToolAvailable: (context, tool) => runtimeMayUseManagedTool(context.runtimeId, tool)
    })
    const agentVisualRuntime = new AgentVisualRuntime({
      visibleContext: visibleContextService,
      visualInspector: resolveVisualInspector,
      frameDirectory: join(app.getPath('userData'), 'agent-visual', 'frames'),
      resolveResourceFrame: async ({ sourceRef, targetRef, frame, caller, signal }) => {
        const resource = capabilityBroker.describeResourceRef(caller, sourceRef)
        const provider = visualSourceRegistry.resolve(resource.resourceKind)
        if (!provider) {
          throw new Error(`No visual source provider owns resource kind ${resource.resourceKind}.`)
        }
        return renderVisualSource(
          provider,
          {
            resource: {
              resourceId: resource.resourceId,
              resourceKind: resource.resourceKind,
              ...(resource.workspaceId ? { workspaceId: resource.workspaceId } : {}),
              semanticRevision: resource.semanticRevision,
              ...(resource.layoutRevision ? { layoutRevision: resource.layoutRevision } : {})
            },
            ...(targetRef ? { target: { kind: 'target-ref', targetRef } } : {}),
            ...(frame ? { frameIndex: frame } : {})
          },
          { signal }
        )
      }
    })
    capabilityAgentTools = createCapabilityAgentToolSurface({
      broker: runtimeCapabilityBroker,
      visualRuntime: agentVisualRuntime,
      assertPrincipalLease: assertAgentPrincipalLease,
      resolveCaller: (context) => ({
        audience: 'agent',
        callerId: capabilityAgentCallerId(context),
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
        ...(context.workspaceLocator ? { workspaceLocator: context.workspaceLocator } : {})
      }),
      requestApproval: (request, options) =>
        agentRuntimeHostRef.current?.requestCapabilityApproval(request, options) ?? 'cancelled',
      cancelApprovalTurn: (identity, reason) =>
        agentRuntimeHostRef.current?.cancelCapabilityApprovalTurn(identity, reason) ?? 0
    })
    agentRuntimeTools = composeAgentRuntimeToolSurfaces([
      capabilityAgentTools,
      createDeferredAgentRuntimeToolSurface(() => agentRuntimeHostForShutdown?.subagentTools())
    ])
    const isTrustedMainRendererIpcSender = (event: IpcMainInvokeEvent): boolean => {
      const window = mainWindow
      if (!window || window.isDestroyed()) return false
      const contents = window.webContents
      const frame = event.senderFrame
      const expected = devServerHintUrl()
        ?? pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
      return event.sender === contents
        && frame === contents.mainFrame
        && isTrustedRendererUrl(frame?.url ?? '', expected)
    }
    const capabilityIpcRegistration = registerCapabilityIpc({
      broker: capabilityBroker,
      isTrustedIpcSender: isTrustedMainRendererIpcSender,
      onCallerDestroyed: (callerId) => {
        void workspacePlacement.disposeOwner(callerId)
        void hostFileTransfers.revokeCaller(callerId).catch((error) => {
          logWarn('file-transfer', 'Failed to revoke file-transfer grants for a closed renderer.', error)
        })
        hostExternalNavigation.revokeCaller(callerId)
      }
    })
    const artifactConsumers = listMainArtifactConsumers(catalog)
    const domainExecutionOutbox = new DomainExecutionEventOutbox(app.getPath('userData'), {
      resolveLegacyTerminalEvents: async (eventIds) => {
        const wanted = new Set(eventIds)
        const { events } = await fullTraceStore.read({
          eventIds,
          kinds: ['execution_event'],
          order: 'asc'
        })
        return events.flatMap((traceEvent) => {
          if (!wanted.has(traceEvent.eventId)) return []
          const payload = traceEvent.payload
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
          const event = (payload as Record<string, unknown>).event
          return event === undefined ? [] : [event]
        })
      }
    })
    const domainExecutionEvents = new DomainExecutionEventService({
      trace: fullTraceStore,
      consumers: artifactConsumers,
      outbox: domainExecutionOutbox,
      resolveCallerWorkspace: () => capabilityBroker.currentInvocation()?.caller.workspaceId,
      log: (level, message, detail) => {
        if (level === 'error') logError('domain-execution-events', message, detail)
        else logWarn('domain-execution-events', message, detail)
      }
    })
    domainExecutionEventsForShutdown = domainExecutionEvents
    const turnArtifactHandoff = new TurnArtifactHandoffService({
      outbox: new TurnArtifactOutbox(app.getPath('userData')),
      consumers: artifactConsumers,
      materialize: async (intent) => {
        const host = agentRuntimeHostRef.current
        if (!host) throw new Error('Agent runtime Host is unavailable for turn materialization.')
        return host.materializeCompletedTurnArtifact(intent)
      },
      log: (level, message, detail) => {
        if (level === 'error') logError('turn-artifact-handoff', message, detail)
        else logWarn('turn-artifact-handoff', message, detail)
      }
    })
    turnArtifactHandoffForShutdown = turnArtifactHandoff
    const agentRuntimeHost = createAgentRuntimeHost({
      settings: async () => store.load(),
      getPrincipalContext: () => principalContext.snapshot(),
      nativeVisualToolsAvailable: () => Boolean(capabilityAgentTools),
      subagentStoreRoot: join(app.getPath('userData'), 'agent-runtime', 'subagents'),
      turnArtifacts: turnArtifactHandoff,
      adapters: [
        createPlacementAwareAgentRuntimeAdapter(
          createCodexAgentRuntimeAdapter(getCodexRuntime()),
          createWorkspaceHostCodexAgentRuntimeAdapter((context) => {
            if (!context.workspaceHost) {
              throw new Error('Workspace Host Codex requires resolved placement metadata.')
            }
            return workspaceHostSessions.portFor(context.workspaceHost.locator)
          })
        ),
        createClaudeCodeAgentRuntimeAdapter(getClaudeCodeRuntime())
      ],
      services: {
        codeNavigation: codeNavigationService,
        trace: agentTraceRecorder,
        contextState: contextStateService,
        contextLedger: contextLedgerService,
        memory: sharedMemoryService,
        workspaceReferences: workspaceReferenceService,
        visibleContext: visibleContextService,
        goals: runtimeGoalService,
        workspaceHosts: workspaceHostSessions
      }
    })
    agentRuntimeHostRef.current = agentRuntimeHost
    agentRuntimeHostForShutdown = agentRuntimeHost
    installElectronDomainNativeVisualSmoke(
      capabilityAgentTools,
      (identity, operation) =>
        agentRuntimeHost.withHostToolRequestPrincipalLease(identity, operation)
    )
    mainRuntimeContributions = await activateMainRuntimeContributions(catalog, {
      userDataDir: app.getPath('userData'),
      appRoot: app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath(),
      environment: Object.freeze({ ...process.env }),
      agentThreads: {
        list: async (input = {}) => {
          const threads = await agentRuntimeHost.listThreads(input as AgentRuntimeThreadListInput)
          return Object.freeze(
            threads.map((thread) =>
              Object.freeze({
                id: thread.id,
                runtimeId: thread.runtimeId,
                ...(thread.workspace?.trim() ? { workspaceRoot: thread.workspace.trim() } : {}),
                ...(thread.archived === undefined ? {} : { archived: thread.archived })
              })
            )
          )
        },
        read: async (input) => {
          const detail = await agentRuntimeHost.readThreadSnapshot(input as AgentRuntimeThreadStatusInput)
          return Object.freeze({
            id: detail.id,
            runtimeId: detail.runtimeId,
            ...(detail.workspace?.trim() ? { workspaceRoot: detail.workspace.trim() } : {}),
            ...(detail.archived === undefined ? {} : { archived: detail.archived }),
            watermark: String(detail.latestSeq),
            turns: Object.freeze(
              (detail.turns ?? []).map((turn) =>
                Object.freeze({
                  id: turn.id,
                  status: turn.status,
                  ...(turn.completedAt ? { completedAt: turn.completedAt } : {}),
                  messages: projectDomainAgentTurnMessages(turn),
                  artifacts: Object.freeze([...(turn.items ?? [])])
                })
              )
            ),
            artifacts: Object.freeze(detail.turns.flatMap((turn) => turn.items ?? []))
          })
        },
        subscribeMessages: (input) =>
          subscribeDomainAgentTranscriptMessages(agentRuntimeHost, input),
        hasActiveTurns: () => agentRuntimeHost.hasActiveTurns()
      },
      turnEvents: {
        subscribe: (listener) => agentRuntimeHost.subscribeTurnLifecycle(listener),
        subscribeRequiredBeforeTurn: (listener) =>
          agentRuntimeHost.subscribeRequiredBeforeTurn(listener),
        readDurableTurnBoundarySnapshot: () =>
          agentRuntimeHost.readDurableTurnBoundarySnapshot()
      },
      agentExecution: createDomainAgentExecutionHost({
        runtime: agentRuntimeHost,
        defaultRuntimeId: async () => getActiveAgentRuntime(await store.load()),
        runtimeReadiness: async () => resolveDomainAgentRuntimeReadiness(await store.load())
      }),
      remoteCapabilityApprovals: {
        subscribe: (listener) => agentRuntimeHost.subscribeRemoteCapabilityApprovals(listener),
        decide: (input) => agentRuntimeHost.decideRemoteCapabilityApproval(input)
      },
      power: {
        acquire: async () => {
          const blockerId = powerSaveBlocker.start('prevent-app-suspension')
          let released = false
          return {
            release: () => {
              if (released) return
              released = true
              if (powerSaveBlocker.isStarted(blockerId)) {
                powerSaveBlocker.stop(blockerId)
              }
            }
          }
        }
      },
      capabilityInvokers: domainSystemCapabilityInvokers,
      modelAccess: {
        textReasoner: async () => {
          const settings = await store.load()
          if (getModelAccessSettings(settings)?.mode !== 'api') return null
          const reasoner = resolveRuntimeModelRouterSettings(settings)
          if (!reasoner.baseUrl.trim() || !reasoner.apiKey.trim() || !reasoner.model.trim()) {
            return null
          }
          return Object.freeze({
            baseUrl: reasoner.baseUrl.trim(),
            apiKey: reasoner.apiKey.trim(),
            model: reasoner.model.trim()
          })
        }
      },
      executionEvents: domainExecutionEvents,
      enablement: {
        isEnabled: (moduleId) => catalog.hasModule(moduleId),
        subscribe: () => () => undefined
      },
      log: (entry) => {
        if (entry.level === 'error') {
          logError('domain-runtime', entry.message, entry.detail)
        } else if (entry.level === 'warn') {
          logWarn('domain-runtime', entry.message, entry.detail)
        } else {
          logInfo('domain-runtime', entry.message)
        }
      }
    })
    void domainExecutionEvents.startDelivery().catch((error) => {
      logError('domain-execution-events', 'Durable execution event replay failed.', error)
    })
    void agentRuntimeHost.recoverCompletedTurnArtifacts().catch((error) => {
      logError('turn-artifact-handoff', 'Accepted turn artifact watcher recovery failed.', error)
    })
    void turnArtifactHandoff.replayPending().catch((error) => {
      logError('turn-artifact-handoff', 'Durable completed turn replay failed.', error)
    })
    scheduleRuntime = createScheduleRuntime({
      store,
      agentRuntime: agentRuntimeHost,
      logError,
      powerSaveBlocker
    })
    scheduleRuntime.sync(initial)

    traceStartup('ipc registration:start')
    const applySettingsPatch = async (partial: AppSettingsPatch): Promise<AppSettingsV1> => {
      const prev = await store.load()
      const {
        agents: agentsPatch,
        modelRouter: modelRouterPatch,
        agentCapabilities: agentCapabilitiesPatch,
        computerUse: computerUsePatch,
        speechToText: speechToTextPatch,
        ...restPatch
      } = partial
      const next = normalizeAppSettings({
        ...applyClaudeRuntimePatch(applyCodexRuntimePatch(prev, agentsPatch?.codex), agentsPatch?.claude),
        ...restPatch,
        modelRouter: mergeModelRouterSettings(prev.modelRouter, modelRouterPatch),
        agentCapabilities: mergeAgentCapabilitySettings(prev.agentCapabilities, agentCapabilitiesPatch),
        computerUse: mergeComputerUseSettings(prev.computerUse, computerUsePatch),
        log: { ...prev.log, ...(partial.log ?? {}) },
        notifications: {
          ...prev.notifications,
          ...(partial.notifications ?? {})
        },
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
        schedule: mergeScheduleSettings(prev.schedule, partial.schedule),
        workflow: mergeWorkflowSettings(prev.workflow, partial.workflow),
        guiUpdate: { ...prev.guiUpdate, ...(partial.guiUpdate ?? {}) }
      } as AppSettingsV1)
      if (prev.log.enabled !== next.log.enabled || prev.log.retentionDays !== next.log.retentionDays) {
        configureLogger({
          enabled: next.log.enabled,
          retentionDays: next.log.retentionDays
        })
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
      if (partial.modelRouter || partial.modelAccess) {
        await synchronizeSelectedModelAccessSidecar(
          saved,
          'Failed to switch the selected model access service after settings change.'
        )
      }
      if (resolveModelAccessRuntimePolicy(saved).codex && (runtimePolicyChanged || Boolean(partial.modelRouter))) {
        await getCodexRuntime().synchronizeModelAccess()
      }
      scheduleCodexRuntimePrewarm(saved, 'settings-switch')
      scheduleRuntime?.sync(saved)
      syncLoginItemSettings(saved)
      syncTray(saved)
      return saved
    }

    const fetchModels = async () => {
      const settings = await store.load()
      return fetchUpstreamModelIds(settings)
    }

    installCapabilityResourceContentProtocol(protocol, {
      describe: (access) =>
        capabilityBroker.describeResourceContent(
          {
            audience: 'ui',
            callerId: 'electron:resource-content',
            ...(access.workspaceId ? { workspaceId: access.workspaceId } : {})
          },
          access.resource
        ),
      readRange: (access, range) =>
        capabilityBroker.readResourceContentRange(
          {
            audience: 'ui',
            callerId: 'electron:resource-content',
            ...(access.workspaceId ? { workspaceId: access.workspaceId } : {})
          },
          access.resource,
          range
        )
    })

    const readModelAccessStatus = (settings: AppSettingsV1) =>
      getModelAccessStatus(settings, {
        getCodingPlanCredentialStateImpl: async (_current, adapterId) =>
          codingPlanCredentialStateForAdapter(adapterId, (input) => agentRuntimeHost.auxiliary(input))
      })

    const appBridgeDispatcher = registerAppIpcHandlers({
      store,
      actionGuardEvaluator,
      extensions: domainExtensionsApi,
      getMainWindow: () => mainWindow,
      isTrustedIpcSender: isTrustedMainRendererIpcSender,
      applySettingsPatch,
      getModelAccessStatus: readModelAccessStatus,
      traces: fullTraceStore,
      fileTransfers: {
        isInstalledRendererOwner: (ownerId) => installedDomainPackages.definitions.some(
          (definition) => definition.module.id === ownerId &&
            definition.entrypoints.some((entrypoint) => entrypoint.process === 'renderer')
        ),
        registerUpload: (input) => {
          const principal = principalContext.current()
          if (!principal) {
            throw new DomainFileTransferError(
              'principal_changed',
              'A current Principal is required to select an upload source.'
            )
          }
          return hostFileTransfers.registerUpload({
            ...input,
            caller: { callerId: input.callerId, principal }
          })
        },
        registerDownload: (input) => {
          const principal = principalContext.current()
          if (!principal) {
            throw new DomainFileTransferError(
              'principal_changed',
              'A current Principal is required to select a download destination.'
            )
          }
          return hostFileTransfers.registerDownload({
            ...input,
            caller: { callerId: input.callerId, principal }
          })
        },
        revokeCaller: (callerId) => hostFileTransfers.revokeCaller(callerId)
      },
      agentRuntime: agentRuntimeHost,
      remoteWorkspace: remoteWorkspaceController,
      workspacePlacement,
      fetchUpstreamModels: fetchModels,
      visibleContext: visibleContextService,
      getScheduleRuntime: () => scheduleRuntime,
      researchCards: researchCardService,
      showTurnCompleteNotification,
      getAppVersion: () => app.getVersion(),
      readGuiUpdateState,
      loadGuiUpdaterModule,
      resolveLogDirectory,
      getMainPerformanceSnapshot: () => mainPerformanceMonitor.snapshot(),
      logError,
      getScientificSkillsMcpLaunchConfig,
      getBgcDiscoveryMcpLaunchConfig,
      getImageGenerationMcpLaunchConfig,
      getPptMasterMcpLaunchConfig
    })

    const devBrowserBridgeInstanceId = process.env.SCIFORGE_DEV_INSTANCE_ID?.trim()
    if (
      !app.isPackaged &&
      process.env.SCIFORGE_DEV_BROWSER_BRIDGE !== '0' &&
      devBrowserBridgeInstanceId
    ) {
      void startDevBrowserBridgeServer({
        dispatcher: {
          invoke: (channel, payload, sender) =>
            capabilityIpcRegistration.handles(channel)
              ? capabilityIpcRegistration.invoke(channel, payload, sender)
              : appBridgeDispatcher.invoke(channel, payload, sender)
        },
        resolveCapabilityTags: (actionId) =>
          capabilityBroker.registry.get(actionId)?.descriptor.tags,
        resourceContent: capabilityIpcRegistration.resourceContent,
        instanceId: devBrowserBridgeInstanceId
      })
        .then((server) => {
          devBrowserBridgeServer = server
          console.info(`[sciforge dev] browser bridge listening at ${server.url}`)
          console.info('[sciforge dev] browser bridge accepts localhost renderer origins')
        })
        .catch((error) => {
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
  })
  .catch((error) => {
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

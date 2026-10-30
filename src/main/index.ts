import type { AgentRuntimeId } from '../shared/agent-runtime-contract'
import type { AgentRuntimeAdapter } from './runtime/agent-runtime/adapter'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
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
import { requestManagedRuntimeQuit } from './runtime/agent-runtime/managed-runtime-quit'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JsonSettingsStore, devServerHintUrl } from './settings-store'
import sciforgeLogoPng from '../asset/img/sciforge.png?url'
import sciforgeTrayPng from '../asset/img/sciforge_tray.png?url'
import { createAppIcon, pickTrayIcon, windowsTaskbarAppDetails } from './app-icon'
import { configureLinuxWaylandImeSwitches } from './app-command-line'
import { APP_PRODUCT_NAME, configureAppIdentity } from './app-identity'
import { resolveDevelopmentUserDataPath } from './development-user-data'
import {
  applyCodexRuntimePatch,
  applyClaudeRuntimePatch,
  applyDshRuntimePatch,
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
import { relocateModelRouterIfPortIsOccupied } from './model-router-port'
import { PLAN_GATEWAY_BASE_URL } from './plan-gateway-config'
import { stopDisallowedAgentRuntimes } from './model-access-runtime-lifecycle'
import { createAgentRuntimeHost, type AgentRuntimeHost } from './runtime/agent-runtime/host'
import { projectAgentRuntimeThreadSnapshot } from './runtime/agent-runtime/thread-wire-projection'
import { FileWorkRecordStore } from '@sciforge/multi-agent/work-record'
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
import { createCapabilityEvalFaultBroker } from './capability-eval/provider-fault-harness'
import {
  buildCapabilityEvalPreflightSnapshot,
  capabilityEvalInspectResponseSchema,
  capabilityEvalPrepareResponseSchema
} from './capability-eval/preflight'
import type {
  DomainCapabilityEvalFixture,
  DomainCapabilityEvalOracleResult,
  DomainCapabilityEvalObservedInvocation
} from '@sciforge/domain-sdk/capability-eval'
import { DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION } from '@sciforge/domain-sdk/capability-eval'
import { createProductionDshHostRuntimeAdapter } from './runtime/agent-runtime/dsh-agent-runtime-adapter'
import { createPiAgentRuntimeAdapter } from './runtime/pi/pi-agent-runtime-adapter'
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
import { captureBrowserWindowPage } from './services/native-window-visual-capture'
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
import type { WorkspacePreviewProviderRegistrationDisposable } from '../shared/workspace-preview'
import { CapabilityBroker } from './capabilities/broker'
import type { CapabilityRegistry } from './capabilities/registry'
import { WORKSPACE_PREVIEW_RESOURCE_KIND, type AppCapabilityDependencies } from './capabilities/app-registry'
import { capabilityUiCallerId, currentNativeCapabilityUiWebContentsId, registerCapabilityIpc, withNativeCapabilityUiInvocation } from './capabilities/ipc'
import { HostPrincipalContext } from './principal-context'
import {
  samePrincipalContextSnapshot,
  samePrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import { DomainFileTransferError } from '@sciforge/domain-sdk/file-transfer'
import { PluginLifecycleRegistry } from '@sciforge/plugin-sdk'
import { HostFileTransferService } from './modules/file-transfer'
import { HostExternalNavigationService } from './modules/external-navigation'
import {
  createPortableResourceReferenceService,
  type PortableResourceReferenceService
} from './modules/portable-resource-references'
import { createDomainExtensionsApi, createPluginInventoryService, loadOfficialExtensionKeyring, SignedExtensionStore } from './extensions'
import { DevelopmentExternalPluginService } from './extensions/development-external-plugins'
import { developmentPluginUiScheme, installDevelopmentPluginUiProtocol } from './extensions/development-plugin-ui-protocol'
import { loadDevelopmentPluginOptions } from './extensions/development-plugin-options'
import {
  policyContracts,
  readDshPluginPolicy,
  resolveDshPluginPolicyPath
} from './extensions/dsh-plugin-policy'
import {
  HOST_PROVIDED_PLUGIN_DEPENDENCIES,
  resolveDshRuntimeVersion,
  resolvePluginDependencyRoot,
  resolvePluginRuntimeEnv
} from './extensions/dsh-plugin-host-runtime'
import {
  createDshMarketSurface,
  resolveDshMarketSource
} from './extensions/dsh-plugin-market'
import {
  loadDshPublisherKeyring,
  resolveDshPublisherKeyringPath
} from './extensions/dsh-plugin-signature'
import { ensureDshAgentResolverModule } from './extensions/dsh-agent-resolver'
import { HOST_BUSINESS_INVOKE_TIMEOUT_MS } from './extensions/invocation-budgets'
import { createEvidenceModelReasoner } from './extensions/evidence-model-reasoner'
import { ModelReasoningService } from './model-reasoning/service'
import { createUpstreamReasoningDeclarationProvider } from './model-reasoning/upstream-declaration'
import { createUpstreamCatalogObserver } from './model-reasoning/upstream-catalog'
import {
  DomainModuleCatalog,
  activateMainRuntimeContributions,
  createApplicationCapabilityRegistry,
  createApplicationDomainCatalog,
  resolveExcludedPackageNames,
  createMainActionGuardEvaluator,
  createMainSystemCapabilityInvokerFactory,
  listMainCapabilityEvalContributions,
  listMainAgentRoutingContributions,
  listMainArtifactConsumers,
  listMainExtensionContributions,
  listMainMcpTrustedInvocationMetadataContributions,
  listMainRuntimeMcpServerContributions,
  listMainVisualSourceContributions,
  listMainWorkspacePreviewPluginContributions,
  createInstalledDomainHostServiceResolution,
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
  domainAgentExecutionFailure,
  resolveDomainAgentRuntimeReadiness
} from './domain-agent-execution'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HIDDEN_START_ARG = '--hidden'
const startupTraceEnabled = process.env.SCIFORGE_STARTUP_TRACE === '1'
const startupTraceStart = Date.now()

function developmentBridgePort(): number | undefined {
  const raw = process.env.SCIFORGE_DEV_BROWSER_BRIDGE_PORT?.trim()
  if (!raw) return undefined
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : undefined
}

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
    nodeExecPath: getManagedGuiMcpLaunchConfig().nodeExecPath,
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

// Development Electron processes can outlive the terminal that launched
// them. In that case inherited stdout/stderr pipes may close while an async
// error is being reported; Node otherwise turns the resulting EPIPE into an
// uncaught main-process exception and the desktop app shows a fatal dialog.
function ignoreClosedDiagnosticPipe(error: NodeJS.ErrnoException): void {
  if (error.code !== 'EPIPE') throw error
}
process.stdout.on('error', ignoreClosedDiagnosticPipe)
process.stderr.on('error', ignoreClosedDiagnosticPipe)

// 在最早的阶段把 app 名称、AppUserModelId 都设好。
// Windows 任务栏 / 系统托盘 / 通知中心看到的应用名都来自这里;
// 设得太晚的话 BrowserWindow title、托盘、IPC 启动时拿到的还是旧的。
// 抽到 app-identity.ts 是为了让测试可以直接 import,不被 main 的
// whenReady 副作用污染。
configureAppIdentity()
const developmentUserDataPath = resolveDevelopmentUserDataPath({
  isPackaged: app.isPackaged,
  appDataPath: app.getPath('appData'),
  workspaceId: process.env.SCIFORGE_DEV_WORKSPACE_ID,
  argv: process.argv
})
if (developmentUserDataPath) {
  mkdirSync(developmentUserDataPath, { recursive: true, mode: 0o700 })
  app.setPath('userData', developmentUserDataPath)
}
configureLinuxWaylandImeSwitches()
registerCapabilityResourceContentScheme({
  registerSchemesAsPrivileged: (schemes) => protocol.registerSchemesAsPrivileged([...schemes, developmentPluginUiScheme])
})

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

const RENDERER_RECOVERY_DELAY_MS = 250
const RENDERER_RECOVERY_WINDOW_MS = 10 * 60 * 1000
const RENDERER_RECOVERY_MAX_ATTEMPTS = 3

let mainWindow: BrowserWindow | null = null
let rendererRecoveryTimer: ReturnType<typeof setTimeout> | null = null
const rendererRecoveryAttempts: number[] = []
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
// The production DSH adapter is created during Host composition; policy
// changes retire its child through invalidateModelAccess (see
// model-access-runtime-lifecycle), and quit closes it through Host close.
let dshRuntimeAdapterForLifecycle: ReturnType<typeof createProductionDshHostRuntimeAdapter> | null = null
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
let managedRuntimesCaptureRecoveryPending = false
let managedRuntimesQuitPending = false
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
    if (!bridge) {
      return surfaceCaptureUnavailable(
        'capture_surface_unavailable',
        `Browser surface ${request.windowId} is no longer available.`,
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
    },
    stopDsh: async () => {
      // The production DSH engine owns its child process; retiring the model
      // access connection is the canonical stop for the pinned adapter.
      await dshRuntimeAdapterForLifecycle?.invalidateModelAccess()
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
    const attempt: Promise<void> = (async () => {
      cancelCodexRuntimePrewarm()
      scheduleRuntime?.stop()
      // Stop every producer before closing the durable execution/turn sinks.
      // Otherwise a disposer or a final runtime event can be accepted after
      // retry timers are gone and remain invisible until the next launch.
      const agentHost = agentRuntimeHostForShutdown
      const stopAgentProducers = async (): Promise<void> => {
        const results = await Promise.allSettled([claudeCodeRuntime?.stop(), codexRuntime?.stop()])
        const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (errors.length) throw new AggregateError(errors.map(({ reason }) => reason), 'Agent producers failed to stop.')
      }
      // close owns admission, producer stop, capture abort and accepted-write drain.
      // Keep owners reachable on failure so a failed shutdown cannot pretend it drained.
      if (agentHost) {
        try {
          if (managedRuntimesCaptureRecoveryPending) {
            await stopAgentProducers()
            await agentHost.retryEventCaptures()
            await agentHost.close()
          } else {
            await agentHost.close(stopAgentProducers)
          }
          managedRuntimesCaptureRecoveryPending = false
        } catch (error) {
          managedRuntimesCaptureRecoveryPending = true
          throw error
        }
      } else await stopAgentProducers()
      agentRuntimeHostForShutdown = null
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
    })()
    const trackedStop = attempt.then(
      (value) => {
        if (managedRuntimesStopPromise === trackedStop) managedRuntimesStopPromise = null
        return value
      },
      (error: unknown) => {
        if (managedRuntimesStopPromise === trackedStop) managedRuntimesStopPromise = null
        throw error
      }
    )
    managedRuntimesStopPromise = trackedStop
  }
  return managedRuntimesStopPromise!
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
    minWidth: 480,
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
  if (process.platform === 'win32') {
    // The BrowserWindow `icon` option is not sufficient for every Windows
    // taskbar shell path. Bind the taskbar button to the same AppUserModelId
    // and icon, while keeping the window visible in the taskbar explicitly.
    mainWindow.setSkipTaskbar(false)
    if (!appIcon.isEmpty()) mainWindow.setIcon(appIcon)
    try {
      mainWindow.setAppDetails(windowsTaskbarAppDetails(
        APP_USER_MODEL_ID,
        process.execPath,
        app.isPackaged
      ))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logWarn('desktop-icon', 'Failed to bind the Windows taskbar icon.', { message })
    }
  }
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
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logError('renderer', 'The SciForge renderer process exited unexpectedly.', {
      reason: details.reason,
      exitCode: details.exitCode
    })
    if (isQuitting || mainWindow?.isDestroyed()) return
    const now = Date.now()
    while (
      rendererRecoveryAttempts.length > 0 &&
      now - rendererRecoveryAttempts[0] > RENDERER_RECOVERY_WINDOW_MS
    ) {
      rendererRecoveryAttempts.shift()
    }
    if (rendererRecoveryAttempts.length >= RENDERER_RECOVERY_MAX_ATTEMPTS) {
      logError('renderer', 'Renderer recovery abandoned after repeated crashes; restart SciForge.', {
        attempts: rendererRecoveryAttempts.length,
        windowMinutes: RENDERER_RECOVERY_WINDOW_MS / 60000
      })
      return
    }
    rendererRecoveryAttempts.push(now)
    if (rendererRecoveryTimer) clearTimeout(rendererRecoveryTimer)
    rendererRecoveryTimer = setTimeout(() => {
      rendererRecoveryTimer = null
      const window = mainWindow
      if (!window || window.isDestroyed()) return
      const recoveryUrl = devServerHintUrl() ?? pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
      logInfo('renderer', 'Reloading the renderer after an unexpected process exit.')
      void window.loadURL(recoveryUrl).catch((error) => {
        logError('renderer', 'Renderer recovery failed.', error)
      })
    }, RENDERER_RECOVERY_DELAY_MS)
    rendererRecoveryTimer.unref?.()
  })
  mainWindow.webContents.on('unresponsive', () => {
    logWarn('renderer', 'The SciForge renderer became unresponsive.')
  })
  mainWindow.webContents.on('responsive', () => {
    logInfo('renderer', 'The SciForge renderer became responsive again.')
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
    if (rendererRecoveryTimer) clearTimeout(rendererRecoveryTimer)
    rendererRecoveryTimer = null
    rendererRecoveryAttempts.length = 0
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
    // Ensure Chromium exposes the host renderer's accessibility tree to
    // macOS AX clients (including desktop automation) from first paint.
    app.setAccessibilitySupportEnabled(true)
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
    let initial = await store.load()
    const relocatedModelRouterBaseUrl = await relocateModelRouterIfPortIsOccupied(initial)
    if (relocatedModelRouterBaseUrl) {
      initial = await store.patch({
        modelRouter: {
          baseUrl: relocatedModelRouterBaseUrl.baseUrl,
          portConflict: {
            configuredPort: relocatedModelRouterBaseUrl.configuredPort,
            activePort: relocatedModelRouterBaseUrl.activePort
          }
        }
      })
    } else if (initial.modelRouter?.portConflict) {
      initial = await store.patch({ modelRouter: { portConflict: undefined } })
    }
    traceStartup('settings load:done')
    const hostExecutionNodeId = initial.installationId?.trim()
    if (!hostExecutionNodeId) {
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
    if (relocatedModelRouterBaseUrl) {
      logWarn(
        'model-router',
        `Configured Model Router port ${relocatedModelRouterBaseUrl.configuredPort} was occupied; moved this instance to ${relocatedModelRouterBaseUrl.activePort}.`
      )
    }
    traceStartup('logger configured')
    const fullTraceStore = new LocalTraceStore({
      userDataDirectory: app.getPath('userData'),
      requestBodyCapture: 'bounded',
      sensitiveValues: currentSensitiveValues
    })
    await fullTraceStore.initialize()
    const agentTraceRecorder = new AgentRuntimeTraceRecorder(fullTraceStore)
    traceStartup('full trace store initialized')
    await synchronizeSelectedModelAccessSidecar(initial, 'Failed to start the selected model access service.')
    codeNavigationService = new LspCodeNavigationService()
    const contextStateService = new RuntimeContextStateService()
    const sharedMemoryService = new SharedMemoryService(app.getPath('userData'))
    const runtimeGoalService = new RuntimeGoalService(app.getPath('userData'))
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
      getExecutionNodeId: () => hostExecutionNodeId,
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
    const excludedDomainPackages = resolveExcludedPackageNames(
      (process.env.SCIFORGE_EXCLUDED_DOMAIN_PACKAGES ?? '')
        .split(',').map((name) => name.trim()).filter(Boolean)
    )
    if (excludedDomainPackages.length > 0) {
      logInfo('extensions', `Excluding static domain packages from this launch: ${excludedDomainPackages.join(', ')}`)
    }
    const catalog = createApplicationDomainCatalog({
      getUserDataDir: () => app.getPath('userData'),
      nativeUi: {
        currentWebContentsId: () => {
          const caller = capabilityBrokerForDomainServices?.currentInvocation()?.caller
          const nativeId = currentNativeCapabilityUiWebContentsId()
          if (nativeId === undefined || caller?.audience !== 'ui' || caller.callerId !== capabilityUiCallerId(nativeId)) return undefined
          const contents = webContents.fromId(nativeId)
          return contents && !contents.isDestroyed() && BrowserWindow.fromWebContents(contents)
            ? contents.id : undefined
        }
      },
      getDeviceId: () => hostExecutionNodeId,
      humanActions: {
        capture: (input) => {
          if (!capabilityBrokerForDomainServices) throw new Error('The Host capability broker is not ready.')
          return capabilityBrokerForDomainServices.captureHumanAction(input)
        },
        validate: (input) => {
          if (!capabilityBrokerForDomainServices) throw new Error('The Host capability broker is not ready.')
          return capabilityBrokerForDomainServices.validateHumanAction(input)
        }
      },
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
    }, {
      excludedPackageNames: excludedDomainPackages
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
    const pluginLifecycleRegistry = new PluginLifecycleRegistry()
    const agentRuntimeHostRef: { current: AgentRuntimeHost | null } = { current: null }
    let developmentPlugins: DevelopmentExternalPluginService | undefined
    const developmentPluginOptions = await loadDevelopmentPluginOptions({
      isPackaged: app.isPackaged,
      userDataPath: app.getPath('userData'),
      hostApiVersion: catalog.hostApiVersion,
      env: process.env
    })
    if (developmentPluginOptions === undefined && process.env.SCIFORGE_DEV_PLUGIN_ROOT?.trim()) {
      logWarn('extensions', 'A development plugin root was configured but is ignored in packaged builds.')
    }
    // Installed DSH plugins live in the release plugin root and are approved by
    // host policy. The development seam above stays a separate, dev-only entry:
    // when it is active the release root is not the loaded root, and installs
    // report that rather than writing plugins the host would never load.
    const installedPluginRoot = resolve(app.getPath('userData'), 'extensions', 'plugin-packages')
    const dshPluginPolicyPath = resolveDshPluginPolicyPath(app.getPath('userData'))
    const dshPluginPolicy = await readDshPluginPolicy(dshPluginPolicyPath)
    const dshRuntimeVersion = await resolveDshRuntimeVersion()
    const pluginDependencyRoot = resolvePluginDependencyRoot({
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
      env: process.env,
      // What THIS build can provide, not only what is already approved: a fresh
      // install must resolve its host-vendored addon on first activation, before
      // any approval exists. The installer separately refuses a plugin that asks
      // for anything outside this set.
      packages: [...HOST_PROVIDED_PLUGIN_DEPENDENCIES].sort()
    })
    const pluginRuntimeEnv = resolvePluginRuntimeEnv(process.env)
    // A plugin tool call needs a child-local ordinary Agent resolver; without one
    // the runner refuses the call, so an installed plugin would be uncallable.
    const dshAgentResolver = await ensureDshAgentResolverModule(app.getPath('userData'))
    // Publisher trust for the market: host configuration, read once at start-up.
    const dshPublisherKeyring = await loadDshPublisherKeyring(
      resolveDshPublisherKeyringPath(app.getPath('userData'), process.env)
    )
    if (developmentPluginOptions === undefined && dshRuntimeVersion === undefined) {
      logWarn(
        'extensions',
        'The official DSH runtime version could not be resolved; installed plugins cannot be authorized in this build.'
      )
    }
    const installedPluginOptions = Object.freeze({
      root: installedPluginRoot,
      userDataPath: app.getPath('userData'),
      hostApiVersion: catalog.hostApiVersion,
      adapterContracts: policyContracts(dshPluginPolicy),
      allowedPermissionIds: new Set<string>(),
      dshAgentResolver,
      ...(dshRuntimeVersion === undefined ? {} : { dshRuntimeVersion })
    })
    // Shared wiring for the installed-plugin service. The development seam below
    // keeps its own inline copy: `development-plugin-composition.test.ts` pins the
    // exact shape of that `if (developmentPluginOptions)` block, so it must not
    // start referencing new outer bindings.
    const installedHostServiceOptions = {
      userDataDir: app.getPath('userData'),
      environment: process.env,
      reasoner: createEvidenceModelReasoner(() => store.load(), () => undefined),
      threads: {
        read: async (scope: { runtimeId: string; threadId: string; workspaceRoot: string }) => {
          const host = agentRuntimeHostRef.current
          if (!host) throw new Error('Agent runtime Host is not ready for extension invocation.')
          const detail = await host.readThreadSnapshot({ runtimeId: scope.runtimeId as never, threadId: scope.threadId })
          return projectAgentRuntimeThreadSnapshot(detail, scope)
        },
        list: async (scope: { runtimeId: string; threadId: string; workspaceRoot: string }) => {
          const host = agentRuntimeHostRef.current
          if (!host) throw new Error('Agent runtime Host is not ready for extension invocation.')
          return (await host.listThreads({}))
            .filter((thread) => thread.runtimeId === scope.runtimeId && thread.id === scope.threadId)
            .map((thread) => ({ runtimeId: thread.runtimeId, threadId: thread.id, workspaceRoot: thread.workspace?.trim() ?? scope.workspaceRoot }))
        }
      },
      capabilities: {
        invoke: async (
          request: { actionId: string; input: unknown; invocationId?: string },
          context: { caller: unknown; ordinarySession?: unknown; originalContext?: Readonly<Record<string, unknown>>; signal: AbortSignal; assertCurrent(): void }
        ) => {
          context.assertCurrent()
          context.signal.throwIfAborted()
          const broker = capabilityBrokerForDomainServices
          if (!broker) throw new Error('The Host capability broker is not ready.')
          const result = await broker.invokeOrdinarySession(
            context.caller as Parameters<CapabilityBroker['invokeOrdinarySession']>[0],
            request as Parameters<CapabilityBroker['invokeOrdinarySession']>[1],
            context.ordinarySession as Parameters<CapabilityBroker['invokeOrdinarySession']>[2],
            { signal: context.signal, ...(context.originalContext ? { context: context.originalContext } : {}) }
          )
          context.assertCurrent()
          context.signal.throwIfAborted()
          return result.output
        }
      },
      logUnavailable: () => logWarn('domain-host-services', 'A bundled domain Host service is unavailable because its trusted runtime configuration is incomplete.')
    }

    if (developmentPluginOptions) {
      const requireAgentRuntimeHost = () => {
        const host = agentRuntimeHostRef.current
        if (!host) throw new Error('Agent runtime Host is not ready for extension invocation.')
        return host
      }
      const hostServiceResolution = createInstalledDomainHostServiceResolution({
        userDataDir: app.getPath('userData'),
        environment: process.env,
        reasoner: createEvidenceModelReasoner(() => store.load(), () => undefined),
        threads: {
          read: async (scope: { runtimeId: string; threadId: string; workspaceRoot: string }) => {
            const detail = await requireAgentRuntimeHost().readThreadSnapshot({ runtimeId: scope.runtimeId as never, threadId: scope.threadId })
            return projectAgentRuntimeThreadSnapshot(detail, scope)
          },
          list: async (scope: { runtimeId: string; threadId: string; workspaceRoot: string }) => (await requireAgentRuntimeHost().listThreads({})).filter((thread) => thread.runtimeId === scope.runtimeId && thread.id === scope.threadId).map((thread) => ({ runtimeId: thread.runtimeId, threadId: thread.id, workspaceRoot: thread.workspace?.trim() ?? scope.workspaceRoot }))
        },
        capabilities: {
          invoke: async (
            request: { actionId: string; input: unknown; invocationId?: string },
            context: { caller: unknown; ordinarySession?: unknown; originalContext?: Readonly<Record<string, unknown>>; signal: AbortSignal; assertCurrent(): void }
          ) => {
            context.assertCurrent()
            context.signal.throwIfAborted()
            const broker = capabilityBrokerForDomainServices
            if (!broker) throw new Error('The Host capability broker is not ready.')
            const result = await broker.invokeOrdinarySession(
              context.caller as Parameters<CapabilityBroker['invokeOrdinarySession']>[0],
              request as Parameters<CapabilityBroker['invokeOrdinarySession']>[1],
              context.ordinarySession as Parameters<CapabilityBroker['invokeOrdinarySession']>[2],
              { signal: context.signal, ...(context.originalContext ? { context: context.originalContext } : {}) }
            )
            context.assertCurrent()
            context.signal.throwIfAborted()
            return result.output
          }
        },
        logUnavailable: () => logWarn('domain-host-services', 'A bundled domain Host service is unavailable because its trusted runtime configuration is incomplete.')
      })
      developmentPlugins = new DevelopmentExternalPluginService({
        ...developmentPluginOptions,
        invokeTimeoutMs: HOST_BUSINESS_INVOKE_TIMEOUT_MS,
        resolveHostServiceProviders: hostServiceResolution.resolveHostServiceProviders,
        resolveHostServiceClients: hostServiceResolution.resolveHostServiceClients,
        hostServiceIds: hostServiceResolution.hostServiceIds,
      })
      const pluginUiService = developmentPlugins
      installDevelopmentPluginUiProtocol(protocol, {
        resolveAsset: (asset) => pluginUiService.rendererAssetPath(asset),
        fetchFile: (url, method) => net.fetch(url, { method })
      })
      logInfo('extensions', `Configured development plugins from ${developmentPluginOptions.root}.`)
      app.once('will-quit', () => {
        void developmentPlugins?.dispose()
      })
    }

    // Release composition: with the development seam inactive, installed market
    // plugins load from the release plugin root. A separate statement on purpose —
    // it is not part of the seam's `if` above, and it never shares a root with it.
    if (developmentPlugins === undefined && dshRuntimeVersion !== undefined) {
      const hostServiceResolution = createInstalledDomainHostServiceResolution(installedHostServiceOptions)
      developmentPlugins = new DevelopmentExternalPluginService({
        ...installedPluginOptions,
        invokeTimeoutMs: HOST_BUSINESS_INVOKE_TIMEOUT_MS,
        resolveHostServiceProviders: hostServiceResolution.resolveHostServiceProviders,
        resolveHostServiceClients: hostServiceResolution.resolveHostServiceClients,
        hostServiceIds: hostServiceResolution.hostServiceIds,
        ...(pluginDependencyRoot === undefined ? {} : { pluginRuntimeDeps: pluginDependencyRoot }),
        ...(pluginRuntimeEnv === undefined ? {} : { pluginRuntimeEnv })
      })
      logInfo(
        'extensions',
        `Installed DSH plugins load from ${installedPluginRoot}` +
        ` (${dshPluginPolicy.approved.length} approved, runtime ${dshRuntimeVersion}).`
      )
      app.once('will-quit', () => {
        void developmentPlugins?.dispose()
      })
    }
    // The market installs into the release plugin root, which is only the loaded
    // root when the development seam is inactive. Rather than offer an install
    // that a running host will not load, the market is absent in that case.
    // The Host capability registry is created later in composition than this surface,
    // so the market reads it through a holder instead of capturing it.
    const capabilityRegistryRef: { current: CapabilityRegistry | undefined } = { current: undefined }
    const dshMarket = developmentPluginOptions !== undefined || dshRuntimeVersion === undefined ||
      developmentPlugins === undefined
      ? undefined
      : createDshMarketSurface({
          source: resolveDshMarketSource({
            bundledIndexPath: resolve(process.resourcesPath, 'market', 'index.json'),
            env: process.env
          }),
          installDeps: {
            installedRoot: installedPluginRoot,
            stagingRoot: resolve(app.getPath('userData'), 'extensions', 'staging'),
            policyPath: dshPluginPolicyPath,
            dshRuntimeVersion,
            hostApiRange: '^1.0.0',
            hostProvidedDependencies: HOST_PROVIDED_PLUGIN_DEPENDENCIES,
            publisherKeyring: dshPublisherKeyring,
            service: developmentPlugins
          },
          listInstalled: async () =>
            (await developmentPlugins.list()).map((entry) => ({
              packageName: entry.packageName,
              version: entry.version,
              enabled: entry.enabled === true
            })),
          setEnabled: (packageName, enabled) => developmentPlugins.setEnabled(packageName, enabled),
          isCapabilityRegistered: (id) => capabilityRegistryRef.current?.get(id) !== undefined
        })
    const domainExtensionsApi = createDomainExtensionsApi({
      bundledDefinitions: catalog.listPackages(),
      store: signedExtensionStore,
      lifecycleRegistry: pluginLifecycleRegistry,
      ...(developmentPlugins ? { developmentPlugins } : {}),
      ...(extensionInstallationBlockedReason ? { installationBlockedReason: extensionInstallationBlockedReason } : {})
    })
    const pluginInventory = async (input: { pluginId: string; contributionId: string; generation: number; version: string }) => {
      const admission = developmentPlugins?.inventoryAdmission(input)
      const service = createPluginInventoryService(
        domainExtensionsApi,
        () => admission,
        (current) => (current.lease as { current?: boolean }).current === true
      )
      return Array.from(await service.list()) as Awaited<ReturnType<typeof domainExtensionsApi.list>>
    }
    const actionGuardEvaluator = createMainActionGuardEvaluator(catalog)
    const localWorkspacePreviewHost = new WorkspacePreviewHost({
      domainPlugins: listMainWorkspacePreviewPluginContributions(catalog),
      loadSettings: () => store.load()
    })
    if (developmentPlugins) {
      // Workspace-preview contribution channel (gap-1b): remote plugin slots
      // register into the live preview registries. Registration is
      // all-or-nothing per package; a slot id collision with a bundled domain
      // (or another plugin) fails closed here and marks the plugin's
      // contribution failed until the static handoff
      // (SCIFORGE_EXCLUDED_DOMAIN_PACKAGES) frees the slot.
      const previewPluginRegistrations = new Map<string, WorkspacePreviewProviderRegistrationDisposable[]>()
      developmentPlugins.setWorkspacePreviewSink({
        sync: (packageName, plugins) => {
          for (const disposable of previewPluginRegistrations.get(packageName) ?? []) disposable.dispose()
          previewPluginRegistrations.delete(packageName)
          if (!plugins?.length) return
          const registered: WorkspacePreviewProviderRegistrationDisposable[] = []
          try {
            for (const plugin of plugins) registered.push(localWorkspacePreviewHost.registerPlugin(plugin))
          } catch (error) {
            for (const disposable of registered) disposable.dispose()
            throw error
          }
          previewPluginRegistrations.set(packageName, registered)
        }
      })
    }
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
      extensionsApi: domainExtensionsApi,
      extensionCandidateApi: domainExtensionsApi,
      versionControlWorkspaceService: versionControlPlacement
    }
    const principalContext = new HostPrincipalContext(catalog)
    principalContextForDomainServices = principalContext
    const applicationCapabilityRegistry = createApplicationCapabilityRegistry(catalog, appCapabilityDependencies)
    capabilityRegistryRef.current = applicationCapabilityRegistry
    const capabilityBroker = new CapabilityBroker(
      applicationCapabilityRegistry,
      {
        resolveCurrentPrincipalContext: () => principalContext.snapshot(),
        resolveNativeUiWebContentsId: currentNativeCapabilityUiWebContentsId,
        reportHandlerError: ({ actionId, code, message }) => {
          logError('capability', `Capability handler failed for ${actionId}.`, { code, message })
        }
      }
    )
    // Market-installed plugins publish their capabilities through the Host
    // registry; the single attach call lives with the rest of the composition
    // below, so this path adds no second one.
    const preparedCapabilityEvalFixtures = new Map<string, readonly Readonly<{
      contributionId: string
      moduleId: string
      fixture: DomainCapabilityEvalFixture
    }>[]>([])
    const capabilityEvalRunKey = (caseId: string, runId: string): string => `${caseId}:${runId}`
    const capabilityEvalContributionsFor = (requiredActionIds: readonly string[]) => {
      const required = new Set(requiredActionIds)
      return listMainCapabilityEvalContributions(catalog).filter((contribution) =>
        contribution.actionIds.some((actionId) => required.has(actionId))
      )
    }
    const capabilityEvalPrepare = async (request: Parameters<NonNullable<
      Parameters<typeof registerAppIpcHandlers>[0]['capabilityEvalPrepare']
    >>[0]) => {
      assertCapabilityEvalIsolation(request.userDataDirectory)
      const context = {
        caseId: request.caseId,
        runId: request.runId,
        workspaceDirectory: request.workspaceDirectory,
        ...(request.userDataDirectory ? { userDataDirectory: request.userDataDirectory } : {}),
        ...(request.fixtureProfile ? { fixtureProfile: request.fixtureProfile } : {})
      }
      const prepared = [] as Array<Readonly<{
        contributionId: string
        moduleId: string
        fixture: DomainCapabilityEvalFixture
      }>>
      for (const contribution of capabilityEvalContributionsFor(request.requiredActionIds)) {
        if (!contribution.prepare) continue
        let fixture: DomainCapabilityEvalFixture | undefined
        try {
          fixture = await contribution.prepare(context)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(
            `Capability evaluation fixture preparation failed for ${contribution.contributionId}: ${message}`,
            { cause: error }
          )
        }
        if (!fixture) continue
        prepared.push(Object.freeze({
          contributionId: contribution.contributionId,
          moduleId: contribution.moduleId,
          fixture
        }))
      }
      const key = capabilityEvalRunKey(request.caseId, request.runId)
      preparedCapabilityEvalFixtures.set(key, Object.freeze(prepared))
      return capabilityEvalPrepareResponseSchema.parse({
        contractVersion: DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
        caseId: request.caseId,
        runId: request.runId,
        fixtures: prepared.map(({ contributionId, moduleId, fixture }) => ({
          fixtureId: `${moduleId}:${fixture.fixtureId}`,
          paths: fixture.paths,
          ...(fixture.metadata !== undefined ? { metadata: fixture.metadata } : {}),
          ...(fixture.visibleContext !== undefined ? { visibleContext: fixture.visibleContext } : {})
        })),
        message: prepared.length > 0
          ? `Prepared ${prepared.length} package-owned evaluation fixture${prepared.length === 1 ? '' : 's'}.`
          : 'No package-owned fixture was required for this case.'
      })
    }
    const capabilityEvalInspect = async (request: Parameters<NonNullable<
      Parameters<typeof registerAppIpcHandlers>[0]['capabilityEvalInspect']
    >>[0]) => {
      assertCapabilityEvalIsolation(request.userDataDirectory)
      const key = capabilityEvalRunKey(request.caseId, request.runId)
      const prepared = preparedCapabilityEvalFixtures.get(key) ?? []
      const context = {
        caseId: request.caseId,
        runId: request.runId,
        workspaceDirectory: request.workspaceDirectory,
        ...(request.userDataDirectory ? { userDataDirectory: request.userDataDirectory } : {}),
        ...(request.fixtureProfile ? { fixtureProfile: request.fixtureProfile } : {})
      }
      const invocations: readonly DomainCapabilityEvalObservedInvocation[] = request.invocations
      const results: Array<Readonly<{ contributionId: string; moduleId: string; result: DomainCapabilityEvalOracleResult }>> = []
      try {
        for (const contribution of capabilityEvalContributionsFor(request.requiredActionIds)) {
          if (!contribution.inspect) continue
          const preparedFixture = prepared.find((candidate) => candidate.contributionId === contribution.contributionId)?.fixture
          const result = await contribution.inspect({
            context,
            ...(preparedFixture ? { fixture: preparedFixture } : {}),
            invocations
          })
          if (result) {
            results.push({
              contributionId: contribution.contributionId,
              moduleId: contribution.moduleId,
              result
            })
          }
        }
      } finally {
        for (const { fixture } of prepared) {
          await fixture.cleanup?.()
        }
        preparedCapabilityEvalFixtures.delete(key)
      }
      const taskSuccessValues = results
        .map(({ result }) => result.taskSuccess)
        .filter((value): value is boolean => value !== undefined)
      const finalStates = results
        .filter(({ result }) => result.finalState !== undefined)
        .map(({ moduleId, result }) => ({ moduleId, finalState: result.finalState! }))
      const finalState = finalStates.length === 0
        ? undefined
        : finalStates.length === 1
          ? finalStates[0]!.finalState
          : Object.fromEntries(finalStates.map(({ moduleId, finalState: state }) => [moduleId, state]))
      const evidence = results.flatMap(({ moduleId, result }) =>
        result.evidence.map((item) => `[${moduleId}] ${item}`)
      )
      const unsupported = results.flatMap(({ moduleId, result }) =>
        (result.unsupported ?? []).map((item) => `[${moduleId}] ${item}`)
      )
      const verifiedActions = [...new Set(results.flatMap(({ result }) => result.verifiedActions))]
      const verifiedDimensions = [...new Set(results.flatMap(({ result }) => result.verifiedDimensions ?? []))]
      return capabilityEvalInspectResponseSchema.parse({
        contractVersion: DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
        caseId: request.caseId,
        runId: request.runId,
        ...(taskSuccessValues.length > 0 ? { taskSuccess: taskSuccessValues.every(Boolean) } : {}),
        ...(finalState !== undefined ? { finalState } : {}),
        evidence,
        verifiedActions,
        verifiedDimensions,
        unsupported,
        results: results.map(({ contributionId, moduleId, result }) => ({
          contributionId,
          moduleId,
          result
        })),
        message: results.length > 0
          ? `Inspected ${results.length} package-owned evaluation oracle${results.length === 1 ? '' : 's'}.`
          : 'No package-owned oracle was registered for this case.'
      })
    }
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
    const agentCapabilityBroker = createCapabilityEvalFaultBroker(capabilityBroker)
    const runtimeCapabilityBroker = createRuntimeCapabilityBroker({
      broker: agentCapabilityBroker,
      managedTools: runtimeMcpToolGateway,
      assertPrincipalLease: (context) => { assertAgentPrincipalLease(context) },
      assertOrdinarySessionAccess: (_caller, session, context) => {
        if (!context?.threadId ||
            context.runtimeId !== session.runtimeId ||
            context.threadId !== session.threadId) {
          throw new CapabilityAgentToolError(
            'invalid_invocation_context',
            'The requested Session is not the current Agent turn Session.'
          )
        }
        assertAgentPrincipalLease(context)
      },
      isToolAvailable: (context, tool) => runtimeMayUseManagedTool(context.runtimeId, tool)
    })
    const agentVisualRuntime = new AgentVisualRuntime({
      visibleContext: visibleContextService,
      visualInspector: resolveVisualInspector,
      frameDirectory: join(app.getPath('userData'), 'agent-visual', 'frames'),
      resolveResourceFrame: async ({ sourceRef, targetRef, frame, fullPage, caller, signal }) => {
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
            ...(targetRef ? { target: { kind: 'target-ref' as const, targetRef } } : {}),
            ...(frame ? { frameIndex: frame } : {}),
            ...(fullPage ? { fullPage: true } : {})
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
      createDeferredAgentRuntimeToolSurface(() => agentRuntimeHostForShutdown?.historyTools()),
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
      inspectTerminalState: async (intent) => {
        const host = agentRuntimeHostRef.current
        if (!host) throw new Error('Agent runtime Host is unavailable for turn inspection.')
        return host.inspectTurnArtifactTerminalState(intent)
      },
      log: (level, message, detail) => {
        if (level === 'error') logError('turn-artifact-handoff', message, detail)
        else logWarn('turn-artifact-handoff', message, detail)
      }
    })
    turnArtifactHandoffForShutdown = turnArtifactHandoff
    const dshRuntimeAdapter = createProductionDshHostRuntimeAdapter({
      userDataDirectory: app.getPath('userData'),
      resourcesDirectory: process.resourcesPath,
      toolSurface: agentRuntimeTools
    })
    dshRuntimeAdapterForLifecycle = dshRuntimeAdapter
    const runtimeAdapters = new Map<AgentRuntimeId, AgentRuntimeAdapter>([
      createPlacementAwareAgentRuntimeAdapter(
        createCodexAgentRuntimeAdapter(getCodexRuntime()),
        createWorkspaceHostCodexAgentRuntimeAdapter((context) => {
          if (!context.workspaceHost) {
            throw new Error('Workspace Host Codex requires resolved placement metadata.')
          }
          return workspaceHostSessions.portFor(context.workspaceHost.locator)
        })
      ),
      createClaudeCodeAgentRuntimeAdapter(getClaudeCodeRuntime()),
      dshRuntimeAdapter,
      createPiAgentRuntimeAdapter({
        storageRoot: join(app.getPath('userData'), 'pi-runtime'),
        toolSurface: agentRuntimeTools
      })
    ].map((adapter) => [adapter.id, adapter]))
    const contextLedgerService = new RuntimeContextLedgerService(app.getPath('userData'), runtimeAdapters)
    const agentRuntimeHost = createAgentRuntimeHost({
      settings: async () => store.load(),
      getPrincipalContext: () => principalContext.snapshot(),
      nativeVisualToolsAvailable: () => Boolean(capabilityAgentTools),
      agentRoutingContributions: listMainAgentRoutingContributions(catalog),
      subagentStoreRoot: join(app.getPath('userData'), 'agent-runtime', 'subagents'),
      eventCaptureSpillRoot: join(app.getPath('userData'), 'agent-runtime', 'event-capture-spill'),
      workStore: new FileWorkRecordStore(join(app.getPath('userData'), 'agent-runtime', 'work')),
      turnArtifacts: turnArtifactHandoff,
      adapters: runtimeAdapters,
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
    // Restoring enabled plugins can resolve Host services during activation.
    // Publish the Host before initialization, then publish contributions once.
    await developmentPlugins?.initialize()
    await developmentPlugins?.attachCapabilityRegistry(applicationCapabilityRegistry)
    void agentRuntimeHost.recoverIncompleteWork().catch((error) => {
      logWarn('agent-runtime-work-recovery', 'Failed to recover incomplete Agent work.', error)
    })
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
                  ...(turn.status === 'failed' || turn.status === 'cancelled'
                    ? { failure: domainAgentExecutionFailure(turn.status, turn.items ?? []) ?? undefined } : {}),
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
        subscribeRequiredAdmission: (listener) =>
          agentRuntimeHost.subscribeRequiredAdmission(listener),
        subscribeRequiredOutput: (listener) =>
          agentRuntimeHost.subscribeRequiredOutput(listener),
        subscribeHumanInput: (listener) =>
          agentRuntimeHost.subscribeHumanInput(listener),
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
        ...applyDshRuntimePatch(
          applyClaudeRuntimePatch(applyCodexRuntimePatch(prev, agentsPatch?.codex), agentsPatch?.claude),
          agentsPatch?.dsh
        ),
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
      // Retire the DSH-owned child before publishing a changed route/selection.
      // A later operation resolves fresh neutral router parameters and repins.
      if (partial.modelRouter || partial.modelAccess || partial.activeAgentRuntime) {
        await dshRuntimeAdapter.invalidateModelAccess()
      }
      const saved = await store.patch(partial)
      traceSensitiveSettings.update(saved)
      if (partial.agents?.codex || partial.agents?.claude) {
        await agentRuntimeHost.refreshLivePermissionPolicy().catch((error) => {
          logWarn('agent-runtime-permission', 'Failed to re-evaluate pending approvals after settings change.', error)
        })
      }
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

    const capabilityEvalEnabled = !app.isPackaged &&
      process.env.SCIFORGE_DEV_BROWSER_BRIDGE === '1' &&
      Boolean(process.env.SCIFORGE_DEV_INSTANCE_ID?.trim())
    const assertCapabilityEvalIsolation = (userDataDirectory: string | undefined): string => {
      const isolatedUserDataDirectory = realpathSync(app.getPath('userData'))
      const requestedUserDataDirectory = userDataDirectory
        ? realpathSync(userDataDirectory)
        : undefined
      if (!requestedUserDataDirectory || requestedUserDataDirectory !== isolatedUserDataDirectory) {
        throw new Error('Capability evaluation requires the isolated development user-data directory.')
      }
      return isolatedUserDataDirectory
    }
    const appBridgeDispatcher = registerAppIpcHandlers({
      store,
      actionGuardEvaluator,
      extensions: domainExtensionsApi,
      pluginInventory,
      ...(dshMarket ? { dshMarket } : {}),
      // Reasoning-level discovery: local declaration first, then a real
      // upstream catalog query (network, ~24h cache), then the vocabulary,
      // then unknown.
      modelReasoning: new ModelReasoningService({
        declarationProvider: createUpstreamReasoningDeclarationProvider({
          loadSettings: () => store.load()
        }),
        catalogObserver: createUpstreamCatalogObserver({
          loadSettings: () => store.load()
        })
      }),
      getMainWindow: () => mainWindow,
      isTrustedIpcSender: isTrustedMainRendererIpcSender,
      applySettingsPatch,
      getModelAccessStatus: readModelAccessStatus,
      ...(capabilityEvalEnabled ? {
        capabilityEvalPreflight: (request) => buildCapabilityEvalPreflightSnapshot({
          request,
          descriptors: capabilityBroker.registry.list(),
          contributions: listMainCapabilityEvalContributions(catalog)
        }),
        capabilityEvalPrepare,
        capabilityEvalInspect
      } : {}),
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
      invokeHumanSessionConfirmation: async (event, decision, source) => {
        const sender = webContents.fromId(event.sender.id)
        if (!sender || sender !== event.sender || sender.isDestroyed() || !BrowserWindow.fromWebContents(sender)) {
          throw new Error('Human Session confirmation requires a current native Desktop window.')
        }
        source.assertSessionCurrent()
        const controller = new AbortController()
        const abort = () => controller.abort()
        sender.once('destroyed', abort)
        const unsubscribe = principalContext.subscribe((snapshot) => {
          if (snapshot.identityVersion !== source.principalContext.identityVersion) abort()
        })
        try {
          await withNativeCapabilityUiInvocation(sender.id, async () => {
            source.assertSessionCurrent()
            await capabilityBroker.invokeHumanSessionConfirmation(
              { audience: 'ui', callerId: capabilityUiCallerId(sender.id) },
              decision,
              source,
              { signal: controller.signal }
            )
          })
        } finally {
          unsubscribe()
          sender.removeListener('destroyed', abort)
        }
      },
      remoteWorkspace: remoteWorkspaceController,
      workspacePlacement,
      fetchUpstreamModels: fetchModels,
      visibleContext: visibleContextService,
      getScheduleRuntime: () => scheduleRuntime,
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
        instanceId: devBrowserBridgeInstanceId,
        port: developmentBridgePort()
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

    mainPerformanceMonitor.startMemoryTelemetry()

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
  mainPerformanceMonitor.stopMemoryTelemetry()
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
  if (managedRuntimesQuitPending) return
  managedRuntimesQuitPending = true
  void requestManagedRuntimeQuit({
    stop: stopManagedRuntimesForQuit,
    quit: () => app.quit(),
    onFailure: (error) => {
      isQuitting = false
      logWarn('agent-runtime', 'Shutdown blocked: accepted event capture or Session drain failed.', error)
      console.warn('[sciforge] failed to stop managed runtimes:', error)
    }
  }).finally(() => {
    managedRuntimesQuitPending = false
  })
})

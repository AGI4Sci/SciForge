import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  defaultLocalRuntimeTokenEconomySettings,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  getModelRouterSettings,
  isModelRouterTextReasonerConfigured,
  isLocalRuntimeInsecure,
  normalizeAgentCapabilitySettings,
  normalizeRuntimeGuardSettings,
  type AgentCapabilitySettingsV1,
  resolveLocalRuntimeSettings,
  type ResolvedLocalRuntimeSettingsV1,
  type RuntimeGuardSettingsV1,
  type LocalRuntimeSettingsV1,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  buildLocalRuntimeServeArgs,
  resolveLocalRuntimeExecutable
} from './resolve-local-runtime-binary'
import {
  LocalRuntimeConfigSchema,
  LocalRuntimeServeConfigSchema,
  ModelConfigSchema,
  ContextCompactionConfigSchema,
  RuntimeTuningConfigSchema,
  AttachmentsCapabilityConfig,
  McpCapabilityConfig,
  McpServerConfig,
  MemoryCapabilityConfig,
  SkillsCapabilityConfig,
  SubagentsCapabilityConfig,
  WebCapabilityConfig
} from './local-runtime-package-contract'
import {
  GUI_SCHEDULE_INTERNAL_SECRET_ENV,
  resolveLocalRuntimeMcpJsonPath,
  type ScheduleMcpLaunchConfig
} from './schedule-mcp-config'
import { stripManagedGuiMcpServers } from './managed-gui-mcp-config'
import { internalSecretEnv } from './internal-http-secret'
import type { ResearchSearchMcpLaunchConfig } from './research-search-mcp-config'
import {
  GUI_WORKFLOW_INTERNAL_SECRET_ENV,
  type WorkflowMcpLaunchConfig
} from './workflow-mcp-config'
import type { WorkspaceIntelMcpLaunchConfig } from './workspace-intel-mcp-config'
import type { RemoteExecutorMcpLaunchConfig } from './remote-executor-mcp-config'
import type { PaperRadarMcpLaunchConfig } from './paper-radar-mcp-config'
import type { WriteAssistMcpLaunchConfig } from './write-assist-mcp-config'
import type { RuntimeInspectorMcpLaunchConfig } from './runtime-inspector-mcp-config'
import type { ScientificSkillsMcpLaunchConfig } from './scientific-skills-mcp-config'
import type { ScientificPlottingMcpLaunchConfig } from './scientific-plotting-mcp-config'
import type { BgcDiscoveryMcpLaunchConfig } from './bgc-discovery-mcp-config'
import type { ImageGenerationMcpLaunchConfig } from './image-generation-mcp-config'
import type { PptMasterMcpLaunchConfig } from './ppt-master-mcp-config'
import type { SciforgeCanvasMcpLaunchConfig } from './sciforge-canvas-mcp-config'
import type { ComputerUseMcpLaunchConfig } from './computer-use-mcp-config'
import {
  buildLocalRuntimeManagedGuiMcpServers,
  hasEnabledManagedGuiMcpServer,
  managedGuiMcpServerNames
} from './gui-mcp-registry'
import {
  paperRadarDbPath,
  paperRadarProfilesPath
} from './paper-radar-paths'
import { defaultLocalRuntimeDataDir } from './runtime/local-runtime-adapter'
import { isLocalRuntimeHealthResponseBody } from './local-runtime-health'
import { appendManagedLogLine } from './logger'
import { guiSkillRootsForRuntime, normalizeSkillRootPath } from './services/skill-service'
import { APP_MODEL_ROUTER_RUNTIME_API_KEY_ENV } from '../shared/app-brand'
import {
  DIRECT_PROVIDER_WORKER_ENV_PREFIXES,
  MODEL_ROUTER_PRIVATE_ENV_PREFIXES,
  SCI_MODALITY_SERVICE_ENV_PREFIXES,
  SCI_MODALITY_WORKER_PRIVATE_ENV_PREFIXES,
  UPSTREAM_PROVIDER_CONFIG_ENV_NAMES,
  UPSTREAM_PROVIDER_SECRET_ENV_NAMES,
  isPrefixedEnv,
  isUpstreamProviderConfigEnv
} from './upstream-provider-env'

let child: ChildProcess | null = null
let childLogCapture: LocalRuntimeChildLogCapture | null = null
let lastResolvedBinary: string | null = null
let localRuntimeStartPromise: Promise<void> | null = null
let childStderrTail = ''
const intentionalStops = new WeakSet<ChildProcess>()
const readyChildren = new WeakSet<ChildProcess>()
const COMPUTER_USE_SERVICE_ENV_NAMES = [
  'SCIFORGE_CUA_SERVICE_URL',
  'SCIFORGE_CUA_SERVICE_TOKEN',
  'SCIFORGE_CUA_SERVICE_TIMEOUT_MS',
  'CUA_SERVICE_TOKEN'
] as const

export type LocalRuntimeUnexpectedExitInfo = {
  code: number | null
  signal: NodeJS.Signals | null
  stderrTail: string
}

let onUnexpectedLocalRuntimeExit: ((info: LocalRuntimeUnexpectedExitInfo) => void) | null = null

export function setLocalRuntimeUnexpectedExitHandler(
  handler: ((info: LocalRuntimeUnexpectedExitInfo) => void) | null
): void {
  onUnexpectedLocalRuntimeExit = handler
}

const LOCAL_RUNTIME_READY_PREFIX = 'KUN_READY '
const LOCAL_RUNTIME_STARTUP_TIMEOUT_MS = 45_000
const LOCAL_RUNTIME_STARTUP_HEALTH_POLL_MS = 500
const LOCAL_RUNTIME_STARTUP_HEALTH_REQUEST_TIMEOUT_MS = 1_000
const DEFAULT_LOCAL_RUNTIME_MODEL_STREAM_IDLE_TIMEOUT_MS = 10 * 60_000
const LOCAL_RUNTIME_STOP_GRACE_MS = 5_000
const LOCAL_RUNTIME_STOP_FORCE_MS = 1_000
const STDERR_TAIL_MAX_CHARS = 32_768
const MAX_TCP_PORT = 65_535
// Temporary worker env must be injected only through explicit managed child config.
const LEGACY_DIRECT_WORKER_ENV_PREFIXES = [
  ...DIRECT_PROVIDER_WORKER_ENV_PREFIXES,
  ...MODEL_ROUTER_PRIVATE_ENV_PREFIXES,
  ...SCI_MODALITY_SERVICE_ENV_PREFIXES,
  ...SCI_MODALITY_WORKER_PRIVATE_ENV_PREFIXES
] as const
const LEGACY_MODEL_ROUTER_ENV_NAMES = [
  'KUN_MODEL_ROUTER_API_KEY',
  'KUN_MODEL_ROUTER_BASE_URL',
  'KUN_MODEL_ROUTER_MODEL',
  'MODEL_ROUTER_API_KEY',
  'MODEL_ROUTER_RUNTIME_API_KEY',
  'MODEL_ROUTER_BASE_URL',
  'MODEL_ROUTER_MODEL'
] as const
const DEFAULT_LOCAL_RUNTIME_MODEL_PROFILES: Record<string, Record<string, unknown>> = {
  'deepseek-v4-pro': {
    contextWindowTokens: 1_000_000,
    contextCompaction: {
      softThreshold: 980_000,
      hardThreshold: 990_000
    },
    // The local runtime always reaches the model through the local Model Router, which translates images via the
    // configured vision translator before the text reasoner. So the endpoint accepts image input even
    // though DeepSeek itself is text-only — declare it so the runtime sends image_url parts instead of
    // base64-dumping uploads as opaque text fallbacks.
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text', 'image_url']
  },
  'deepseek-v4-flash': {
    aliases: ['deepseek-chat', 'deepseek-reasoner', DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS],
    contextWindowTokens: 1_000_000,
    contextCompaction: {
      softThreshold: 980_000,
      hardThreshold: 990_000
    },
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text', 'image_url']
  }
}

type LocalRuntimeLogStream = 'stdout' | 'stderr' | 'lifecycle'
type LocalRuntimeChildLogCapture = {
  captureStdout: (chunk: Buffer | string) => void
  captureStderr: (chunk: Buffer | string) => void
  logLifecycle: (message: string) => void
  close: () => Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function appendTail(current: string, nextChunk: string, maxChars = STDERR_TAIL_MAX_CHARS): string {
  const combined = `${current}${nextChunk}`
  return combined.length > maxChars ? combined.slice(-maxChars) : combined
}

function formatLocalRuntimeLogLine(
  stream: LocalRuntimeLogStream,
  pid: number | undefined,
  message: string
): string {
  const stamp = new Date().toISOString()
  const pidLabel = typeof pid === 'number' ? `local-runtime pid=${pid}` : 'local-runtime'
  return `[${stamp}] [${stream.toUpperCase()}] [${pidLabel}] ${message}\n`
}

function normalizeCapturedChunk(chunk: Buffer | string): string {
  return String(chunk).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function createLocalRuntimeChildLogCapture(pid: number | undefined): LocalRuntimeChildLogCapture {
  let stdoutRemainder = ''
  let stderrRemainder = ''
  let closed = false
  let pending = Promise.resolve()

  const writeLine = (stream: LocalRuntimeLogStream, message: string): void => {
    pending = pending
      .then(() => appendManagedLogLine('sciforge-runtime', formatLocalRuntimeLogLine(stream, pid, message)))
      .catch(() => undefined)
  }

  const captureChunk = (
    stream: 'stdout' | 'stderr',
    chunk: Buffer | string
  ): void => {
    if (closed) return
    const text = normalizeCapturedChunk(chunk)
    const buffered = `${stream === 'stdout' ? stdoutRemainder : stderrRemainder}${text}`
    const parts = buffered.split('\n')
    const remainder = parts.pop() ?? ''
    if (stream === 'stdout') {
      stdoutRemainder = remainder
    } else {
      stderrRemainder = remainder
    }
    for (const part of parts) {
      writeLine(stream, part)
    }
  }

  return {
    captureStdout(chunk) {
      captureChunk('stdout', chunk)
    },
    captureStderr(chunk) {
      captureChunk('stderr', chunk)
    },
    logLifecycle(message) {
      if (closed) return
      writeLine('lifecycle', message)
    },
    async close() {
      if (closed) {
        await pending
        return
      }
      closed = true
      if (stdoutRemainder) {
        writeLine('stdout', stdoutRemainder)
        stdoutRemainder = ''
      }
      if (stderrRemainder) {
        writeLine('stderr', stderrRemainder)
        stderrRemainder = ''
      }
      await pending
    }
  }
}

function appRoot(): string {
  return app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
}

export function resolveLocalRuntimeDataDir(runtime: { dataDir: string }): string {
  const trimmed = runtime.dataDir?.trim()
  if (trimmed) return expandHomePath(trimmed)
  return defaultLocalRuntimeDataDir()
}

function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2).replace(/\\/g, '/'))
  }
  return path
}

export function isLocalRuntimeChildRunning(): boolean {
  return child !== null && child.exitCode === null && child.signalCode === null
}

export function startLocalRuntimeChild(settings: AppSettingsV1): Promise<void> {
  if (localRuntimeStartPromise) return localRuntimeStartPromise
  const runtime = resolveLocalRuntimeSettings(settings)
  if (isLocalRuntimeChildRunning()) return Promise.resolve()
  if (!runtime.autoStart) return Promise.resolve()
  let promise: Promise<void>
  promise = startLocalRuntimeChildOnce(settings, runtime).finally(() => {
    if (localRuntimeStartPromise === promise) localRuntimeStartPromise = null
  })
  localRuntimeStartPromise = promise
  return promise
}

async function startLocalRuntimeChildOnce(
  settings: AppSettingsV1,
  runtime: ResolvedLocalRuntimeSettingsV1
): Promise<void> {
  if (!isModelRouterTextReasonerConfigured(getModelRouterSettings(settings))) {
    throw new Error('Model Router text reasoner Base URL, API key, and model name are required before starting SciForge Runtime.')
  }
  if (!runtime.apiKey.trim()) {
    throw new Error('Model Router runtime API key is required before starting SciForge Runtime.')
  }
  if (childLogCapture) {
    await childLogCapture.close()
    childLogCapture = null
  }
  const root = appRoot()
  const resolution = resolveLocalRuntimeExecutable(root, runtime.binaryPath)
  if (resolution.command === process.execPath && !existsSync(resolution.args[0])) {
    throw new Error(
      `SciForge Runtime build is missing at ${resolution.args[0]}. Run \`npm run build:local-runtime\` before starting the GUI.`
    )
  }
  const dataDir = resolveLocalRuntimeDataDir(runtime)
  await syncGuiManagedLocalRuntimeConfig(dataDir, runtime, {
    agentCapabilities: settings.agentCapabilities,
    runtimeGuards: normalizeRuntimeGuardSettings(settings.runtimeGuards),
    scheduleMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    },
    researchMcp: {
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    },
    workflowMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    },
    workspaceIntelMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    },
    remoteExecutorMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    },
    paperRadarMcp: {
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged,
        dbPath: paperRadarDbPath(app.getPath('userData')),
        profilesPath: paperRadarProfilesPath(app.getPath('userData'))
      }
    },
    writeAssistMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    },
    runtimeInspectorMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged,
        checkpointDataDir: app.getPath('userData')
      }
    },
    scientificSkillsMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    },
    scientificPlottingMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    },
    bgcDiscoveryMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    },
    imageGenerationMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    },
    pptMasterMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged,
        homeDir: app.getPath('home')
      }
    },
    sciforgeCanvasMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    },
    computerUseMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    }
  })
  lastResolvedBinary = resolution.command === process.execPath
    ? resolution.args.join(' ')
    : resolution.command
  const args = buildLocalRuntimeServeArgs({
    resolution,
    host: '127.0.0.1',
    port: runtime.port,
    dataDir,
    modelRouterBaseUrl: runtime.baseUrl,
    model: runtime.model,
    approvalPolicy: runtime.approvalPolicy,
    sandboxMode: runtime.sandboxMode,
    tokenEconomyMode: runtime.tokenEconomyMode,
    insecure: isLocalRuntimeInsecure(runtime)
  })
  child = spawn(resolution.command, args, {
    env: {
      ...localRuntimeChildEnv(process.env),
      ELECTRON_RUN_AS_NODE: '1',
      KUN_RUNTIME_TOKEN: runtime.runtimeToken,
      [APP_MODEL_ROUTER_RUNTIME_API_KEY_ENV]: runtime.apiKey,
      SCIFORGE_MODEL_ROUTER_BASE_URL: runtime.baseUrl,
      SCIFORGE_MODEL_ROUTER_MODEL: runtime.model,
      ...runtimeSecretEnv(settings)
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
  const startedChild = child
  const startedLogCapture = createLocalRuntimeChildLogCapture(startedChild.pid)
  childLogCapture = startedLogCapture
  childStderrTail = ''
  startedLogCapture.logLifecycle(`spawned on port ${runtime.port} using data dir ${dataDir}`)
  startedChild.stdout?.on('data', startedLogCapture.captureStdout)
  startedChild.stderr?.on('data', (chunk: Buffer | string) => {
    childStderrTail = appendTail(childStderrTail, normalizeCapturedChunk(chunk))
    startedLogCapture.captureStderr(chunk)
  })
  child.on('exit', (code, signal) => {
    startedLogCapture.logLifecycle(
      signal
        ? `exited with signal ${signal}`
        : `exited with code ${code ?? 'unknown'}`
    )
    void startedLogCapture.close()
    if (child === startedChild) child = null
    if (readyChildren.has(startedChild) && !intentionalStops.has(startedChild)) {
      onUnexpectedLocalRuntimeExit?.({
        code: code ?? null,
        signal: signal ?? null,
        stderrTail: childStderrTail
      })
    }
  })
  child.on('error', (error) => {
    startedLogCapture.logLifecycle(
      `process error: ${error instanceof Error ? error.message : String(error)}`
    )
  })
  let readySource: LocalRuntimeStartupReadySource
  try {
    readySource = await waitForLocalRuntimeStartup(startedChild, runtime.port)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    startedLogCapture.logLifecycle(`startup failed before ready: ${message}`)
    if (child === startedChild) {
      await stopLocalRuntimeChildAndWait()
    }
    throw error
  }
  readyChildren.add(startedChild)
  startedLogCapture.logLifecycle(
    readySource === 'stdout'
      ? `ready marker received on port ${runtime.port}`
      : `health probe confirmed ready on port ${runtime.port}`
  )
}

function runtimeSecretEnv(settings: AppSettingsV1): NodeJS.ProcessEnv {
  return {
    ...internalSecretEnv(GUI_SCHEDULE_INTERNAL_SECRET_ENV, settings.schedule.internal.secret),
    ...internalSecretEnv(GUI_WORKFLOW_INTERNAL_SECRET_ENV, settings.workflow.webhookSecret)
  }
}

export async function syncGuiManagedLocalRuntimeConfig(
  dataDir: string,
  runtime: Pick<
    LocalRuntimeSettingsV1,
    'mcpSearch' | 'tokenEconomy' | 'storage' | 'contextCompaction' | 'runtimeTuning'
  >,
  options?: {
    agentCapabilities?: AgentCapabilitySettingsV1
    runtimeGuards?: RuntimeGuardSettingsV1
    scheduleMcp?: {
      settings: AppSettingsV1
      launch: ScheduleMcpLaunchConfig
    }
    researchMcp?: {
      launch: ResearchSearchMcpLaunchConfig
    }
    workflowMcp?: {
      settings: AppSettingsV1
      launch: WorkflowMcpLaunchConfig
    }
    workspaceIntelMcp?: {
      settings: AppSettingsV1
      launch: WorkspaceIntelMcpLaunchConfig
    }
    remoteExecutorMcp?: {
      settings?: AppSettingsV1
      launch: RemoteExecutorMcpLaunchConfig
      enabled?: boolean
    }
    paperRadarMcp?: {
      launch: PaperRadarMcpLaunchConfig
    }
    writeAssistMcp?: {
      settings: AppSettingsV1
      launch: WriteAssistMcpLaunchConfig
    }
    runtimeInspectorMcp?: {
      settings: AppSettingsV1
      launch: RuntimeInspectorMcpLaunchConfig
    }
    scientificSkillsMcp?: {
      settings: AppSettingsV1
      launch: ScientificSkillsMcpLaunchConfig
    }
    scientificPlottingMcp?: {
      settings: AppSettingsV1
      launch: ScientificPlottingMcpLaunchConfig
    }
    bgcDiscoveryMcp?: {
      settings: AppSettingsV1
      launch: BgcDiscoveryMcpLaunchConfig
    }
    imageGenerationMcp?: {
      settings: AppSettingsV1
      launch: ImageGenerationMcpLaunchConfig
    }
    pptMasterMcp?: {
      settings: AppSettingsV1
      launch: PptMasterMcpLaunchConfig
    }
    sciforgeCanvasMcp?: {
      settings: AppSettingsV1
      launch: SciforgeCanvasMcpLaunchConfig
    }
    computerUseMcp?: {
      settings: AppSettingsV1
      launch: ComputerUseMcpLaunchConfig
    }
    mcpConfigPath?: string
  }
): Promise<void> {
  const configPath = join(dataDir, 'config.json')
  const existing = sanitizeLocalRuntimeConfigSections(await readJsonObjectIfExists(configPath))
  const importedMcpServers = await readGuiManagedMcpServers(
    options?.mcpConfigPath ?? resolveLocalRuntimeMcpJsonPath()
  )
  const hasImportedEnabledMcpServer = Object.values(importedMcpServers).some(
    (server) => objectValue(server).enabled !== false
  )

  const serve = objectValue(existing?.serve)
  const providerSafeServe = stripLocalRuntimeServeProviderFields(serve)
  const existingTokenEconomy = objectValue(serve.tokenEconomy)
  const existingContextCompaction = objectValue(existing?.contextCompaction)
  const existingModels = objectValue(existing?.models)
  const existingRuntimeTuning = objectValue(existing?.runtime)
  const capabilities = objectValue(existing?.capabilities)
  const mcp = objectValue(capabilities.mcp)
  const mcpServers = stripManagedGuiMcpServers(objectValue(mcp.servers), managedGuiMcpServerNames())
  const search = objectValue(mcp.search)
  const attachments = objectValue(capabilities.attachments)
  const web = objectValue(capabilities.web)
  const skills = objectValue(capabilities.skills)
  const subagents = objectValue(capabilities.subagents)
  const agentCapabilities = normalizeAgentCapabilitySettings(options?.agentCapabilities)
  const storage = storageConfigForRuntime(runtime.storage)
  const mcpSearch = runtime.mcpSearch
  const skillCapability = await skillCapabilityConfigForRuntime(skills, options?.scheduleMcp?.settings)
  const managedMcpServers = buildLocalRuntimeManagedGuiMcpServers({
    scheduleMcp: options?.scheduleMcp,
    researchMcp: options?.researchMcp,
    workflowMcp: options?.workflowMcp,
    workspaceIntelMcp: options?.workspaceIntelMcp,
    remoteExecutorMcp: options?.remoteExecutorMcp,
    paperRadarMcp: options?.paperRadarMcp,
    writeAssistMcp: options?.writeAssistMcp,
    runtimeInspectorMcp: options?.runtimeInspectorMcp,
    scientificSkillsMcp: options?.scientificSkillsMcp,
    scientificPlottingMcp: options?.scientificPlottingMcp,
    bgcDiscoveryMcp: options?.bgcDiscoveryMcp,
    imageGenerationMcp: options?.imageGenerationMcp,
    pptMasterMcp: options?.pptMasterMcp,
    sciforgeCanvasMcp: options?.sciforgeCanvasMcp,
    computerUseMcp: options?.computerUseMcp
  })
  const hasEnabledManagedMcpServer = hasEnabledManagedGuiMcpServer(managedMcpServers)
  const next = {
    serve: {
      ...providerSafeServe,
      storage,
      tokenEconomy: tokenEconomyConfigForRuntime(runtime.tokenEconomy, existingTokenEconomy)
    },
    models: modelConfigForRuntime(existingModels),
    contextCompaction: contextCompactionConfigForRuntime(runtime.contextCompaction, existingContextCompaction),
    runtime: runtimeTuningConfigForRuntime(runtime.runtimeTuning, existingRuntimeTuning, options?.runtimeGuards),
    capabilities: {
      ...capabilities,
      attachments: {
        ...attachments,
        enabled: attachments.enabled === false ? false : true
      },
      web: {
        ...web,
        enabled: web.enabled === false ? false : true,
        fetchEnabled: web.fetchEnabled === false ? false : true
      },
      skills: skillCapability,
      subagents: {
        ...subagents,
        enabled: agentCapabilities.subagents.enabled,
        maxParallel: agentCapabilities.subagents.maxParallel,
        maxChildRuns: agentCapabilities.subagents.maxChildRuns
      },
      mcp: {
        ...mcp,
        ...(
          options?.scheduleMcp ||
          options?.researchMcp ||
          options?.workflowMcp ||
          options?.workspaceIntelMcp ||
          (options?.remoteExecutorMcp && options.remoteExecutorMcp.enabled !== false) ||
          options?.paperRadarMcp ||
          options?.writeAssistMcp ||
          options?.runtimeInspectorMcp ||
          options?.scientificSkillsMcp ||
          options?.scientificPlottingMcp ||
          options?.bgcDiscoveryMcp ||
          options?.imageGenerationMcp ||
          options?.pptMasterMcp ||
          options?.sciforgeCanvasMcp ||
          options?.computerUseMcp ||
          hasEnabledManagedMcpServer ||
          mcpSearch.enabled ||
          hasImportedEnabledMcpServer
          ? { enabled: mcp.enabled === false ? false : true }
          : {}
        ),
        servers: {
          ...importedMcpServers,
          ...mcpServers,
          ...managedMcpServers
        },
        search: {
          ...search,
          enabled: mcpSearch.enabled,
          mode: mcpSearch.mode,
          autoThresholdToolCount: mcpSearch.autoThresholdToolCount,
          topKDefault: mcpSearch.topKDefault,
          topKMax: mcpSearch.topKMax,
          minScore: mcpSearch.minScore
        }
      }
    }
  }
  const parsedNext = LocalRuntimeConfigSchema.safeParse(next)
  if (!parsedNext.success) {
    throw new Error(
      `Refusing to write invalid GUI-managed runtime config at ${configPath}: ${JSON.stringify(parsedNext.error.issues, null, 2)}`
    )
  }
  const nextText = `${JSON.stringify(next, null, 2)}\n`
  if (existing && nextText === `${JSON.stringify(existing, null, 2)}\n`) return
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, nextText, 'utf8')
}

function stripLocalRuntimeServeProviderFields(serve: Record<string, unknown>): Record<string, unknown> {
  const next = { ...serve }
  delete next.apiKey
  delete next.baseUrl
  delete next.endpointFormat
  delete next.model
  return next
}

async function skillCapabilityConfigForRuntime(
  existing: Record<string, unknown>,
  settings?: AppSettingsV1
): Promise<Record<string, unknown>> {
  const { legacySkillMd: _legacySkillMd, ...existingWithoutLegacy } = existing
  const roots = uniqueStrings([
    ...stringArrayValue(existing.roots).map(normalizeSkillRootPath),
    ...(await guiSkillRootsForRuntime(settings)).map((root) => root.path)
  ])
  return {
    ...existingWithoutLegacy,
    enabled: existing.enabled === false ? false : roots.length > 0 || existing.enabled === true,
    roots
  }
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

async function readGuiManagedMcpServers(path: string): Promise<Record<string, unknown>> {
  const parsed = await readJsonObjectIfExists(path)
  if (!parsed) return {}

  const rawServers = mcpServersFromGuiConfig(parsed)
  const managedNames = new Set(managedGuiMcpServerNames())
  const normalizedEntries = Object.entries(rawServers)
    .filter(([serverId]) => !managedNames.has(serverId))
    .map(([serverId, server]) => {
      const normalized = normalizeGuiManagedMcpServer(server)
      return normalized ? [serverId, normalized] as const : null
    })
    .filter((entry): entry is readonly [string, Record<string, unknown>] => entry !== null)

  return Object.fromEntries(normalizedEntries)
}

function mcpServersFromGuiConfig(config: Record<string, unknown>): Record<string, unknown> {
  const directServers = objectValue(config.servers)
  if (Object.keys(directServers).length > 0) return directServers

  const capabilities = objectValue(config.capabilities)
  const mcp = objectValue(capabilities.mcp)
  return objectValue(mcp.servers)
}

function normalizeGuiManagedMcpServer(server: unknown): Record<string, unknown> | null {
  const raw = objectValue(server)
  const command = scalarStringValue(raw.command)
  const url = scalarStringValue(raw.url)
  const args = stringArrayValue(raw.args)
  const headers = stringRecordValue(raw.headers)
  const env = stringRecordValue(raw.env)
  const transport = normalizeMcpTransport(raw.transport, command, url)
  if (!transport) return null

  const trustedWorkspaceRoots = stringArrayValue(raw.trustedWorkspaceRoots)
  const trustScope = normalizeMcpTrustScope(raw.trustScope, trustedWorkspaceRoots)
  if (trustScope === 'workspace' && trustedWorkspaceRoots.length === 0) return null

  const timeoutMs = positiveIntegerValue(raw.timeoutMs)
  const parsed = McpServerConfig.safeParse({
    enabled: raw.enabled === false || raw.disabled === true ? false : true,
    transport,
    ...(command ? { command } : {}),
    ...(args.length > 0 ? { args } : {}),
    ...(url ? { url } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    trustScope,
    ...(trustedWorkspaceRoots.length > 0 ? { trustedWorkspaceRoots } : {}),
    ...(timeoutMs ? { timeoutMs } : {})
  })

  return parsed.success ? objectValue(parsed.data) : null
}

function normalizeMcpTransport(
  value: unknown,
  command: string | undefined,
  url: string | undefined
): 'stdio' | 'streamable-http' | 'sse' | null {
  if (value === 'stdio' || value === 'streamable-http' || value === 'sse') return value
  if (command) return 'stdio'
  if (url) return 'streamable-http'
  return null
}

function normalizeMcpTrustScope(
  value: unknown,
  trustedWorkspaceRoots: string[]
): 'user' | 'workspace' {
  if (value === 'user' || value === 'workspace') return value
  return trustedWorkspaceRoots.length > 0 ? 'workspace' : 'user'
}

function scalarStringValue(value: unknown): string | undefined {
  return typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : undefined
}

function stringRecordValue(value: unknown): Record<string, string> {
  const record = objectValue(value)
  const next: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    const normalized = scalarStringValue(item)
    if (normalized !== undefined) next[key] = normalized
  }
  return next
}

function positiveIntegerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function modelConfigForRuntime(existing: Record<string, unknown>): Record<string, unknown> {
  const existingProfiles = objectValue(existing.profiles)
  const profiles: Record<string, unknown> = { ...DEFAULT_LOCAL_RUNTIME_MODEL_PROFILES }
  for (const [modelId, profile] of Object.entries(existingProfiles)) {
    const defaultProfile = objectValue(DEFAULT_LOCAL_RUNTIME_MODEL_PROFILES[modelId])
    const existingProfile = sanitizeModelProfileForRuntime(profile)
    profiles[modelId] = {
      ...defaultProfile,
      ...existingProfile,
      contextCompaction: {
        ...objectValue(defaultProfile.contextCompaction),
        ...objectValue(existingProfile.contextCompaction)
      }
    }
  }
  return {
    ...existing,
    profiles
  }
}

function sanitizeModelProfileForRuntime(value: unknown): Record<string, unknown> {
  const profile = { ...objectValue(value) }
  delete profile.softRatio
  delete profile.hardRatio
  delete profile.softThreshold
  delete profile.hardThreshold
  return profile
}

function tokenEconomyConfigForRuntime(
  tokenEconomy: Pick<LocalRuntimeSettingsV1, 'tokenEconomy'>['tokenEconomy'] | undefined,
  existing: Record<string, unknown>
): Record<string, unknown> {
  const defaults = defaultLocalRuntimeTokenEconomySettings()
  const normalized = {
    ...defaults,
    ...(tokenEconomy ?? {}),
    historyHygiene: {
      ...defaults.historyHygiene,
      ...(tokenEconomy?.historyHygiene ?? {})
    }
  }
  const existingHistoryHygiene = objectValue(existing.historyHygiene)
  return {
    ...existing,
    enabled: normalized.enabled,
    compressToolDescriptions: normalized.compressToolDescriptions,
    compressToolResults: normalized.compressToolResults,
    conciseResponses: normalized.conciseResponses,
    historyHygiene: {
      ...existingHistoryHygiene,
      maxToolResultLines: normalized.historyHygiene.maxToolResultLines,
      maxToolResultBytes: normalized.historyHygiene.maxToolResultBytes,
      maxToolResultTokens: normalized.historyHygiene.maxToolResultTokens,
      maxToolArgumentStringBytes: normalized.historyHygiene.maxToolArgumentStringBytes,
      maxToolArgumentStringTokens: normalized.historyHygiene.maxToolArgumentStringTokens,
      maxArrayItems: normalized.historyHygiene.maxArrayItems
    }
  }
}

function storageConfigForRuntime(
  storage: Pick<LocalRuntimeSettingsV1, 'storage'>['storage']
): Record<string, unknown> {
  const sqlitePath = storage.sqlitePath.trim()
  return {
    backend: storage.backend,
    ...(sqlitePath ? { sqlitePath } : {})
  }
}

function contextCompactionConfigForRuntime(
  contextCompaction: Pick<LocalRuntimeSettingsV1, 'contextCompaction'>['contextCompaction'],
  _existing: Record<string, unknown>
): Record<string, unknown> {
  return {
    defaultSoftThreshold: contextCompaction.defaultSoftThreshold,
    defaultHardThreshold: contextCompaction.defaultHardThreshold,
    summaryMode: contextCompaction.summaryMode,
    summaryTimeoutMs: contextCompaction.summaryTimeoutMs,
    summaryMaxTokens: contextCompaction.summaryMaxTokens,
    summaryInputMaxBytes: contextCompaction.summaryInputMaxBytes
  }
}

function runtimeTuningConfigForRuntime(
  runtimeTuning: Pick<LocalRuntimeSettingsV1, 'runtimeTuning'>['runtimeTuning'],
  existing: Record<string, unknown>,
  runtimeGuards?: RuntimeGuardSettingsV1
): Record<string, unknown> {
  const existingToolStorm = objectValue(existing.toolStorm)
  const existingToolArgumentRepair = objectValue(existing.toolArgumentRepair)
  const existingToolBudget = objectValue(existing.toolBudget)
  const existingToolBudgetProfiles = objectValue(existingToolBudget.profiles)
  const existingParallelism = objectValue(existing.parallelism)
  const existingModelStreamIdleTimeoutMs = positiveIntegerValue(existing.modelStreamIdleTimeoutMs)
  const toolStorm = normalizeRuntimeGuardSettings(runtimeGuards).toolStorm
  const toolBudget = runtimeTuning.toolBudget
  return {
    ...existing,
    modelStreamIdleTimeoutMs: existingModelStreamIdleTimeoutMs ?? DEFAULT_LOCAL_RUNTIME_MODEL_STREAM_IDLE_TIMEOUT_MS,
    toolStorm: {
      ...existingToolStorm,
      enabled: toolStorm.enabled,
      windowSize: toolStorm.windowSize,
      threshold: toolStorm.threshold
    },
    toolArgumentRepair: {
      ...existingToolArgumentRepair,
      maxStringBytes: runtimeTuning.toolArgumentRepair.maxStringBytes
    },
    toolBudget: {
      ...existingToolBudget,
      enabled: toolBudget.enabled,
      profiles: {
        ...existingToolBudgetProfiles,
        explanation: { ...toolBudget.profiles.explanation },
        review: { ...toolBudget.profiles.review },
        implementation: { ...toolBudget.profiles.implementation },
        long: { ...toolBudget.profiles.long }
      }
    },
    parallelism: {
      ...existingParallelism,
      localReadOnly: runtimeTuning.parallelism.localReadOnly,
      networkMcp: runtimeTuning.parallelism.networkMcp
    }
  }
}

function boundedPositiveInt(value: unknown, fallback: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(numberValue) || numberValue <= 0) return fallback
  return Math.min(numberValue, max)
}

async function readJsonObjectIfExists(path: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await readFile(path, 'utf8')
    const parsed = JSON.parse(text) as unknown
    return objectValue(parsed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (error instanceof SyntaxError) return null
    throw error
  }
}

type SafeParseSchema = {
  safeParse: (value: unknown) =>
    | { success: true; data: unknown }
    | { success: false }
}

function parseLocalRuntimeConfigSection(
  schema: SafeParseSchema,
  value: unknown
): Record<string, unknown> {
  const parsed = schema.safeParse(objectValue(value))
  return parsed.success ? objectValue(parsed.data) : {}
}

function sanitizeLocalRuntimeCapabilitiesConfig(value: unknown): Record<string, unknown> {
  const raw = objectValue(value)
  const next: Record<string, unknown> = {}
  if ('mcp' in raw) {
    const mcp = objectValue(raw.mcp)
    next.mcp = parseLocalRuntimeConfigSection(McpCapabilityConfig, {
      ...mcp,
      servers: stripManagedGuiMcpServers(objectValue(mcp.servers), managedGuiMcpServerNames())
    })
  }
  if ('web' in raw) next.web = parseLocalRuntimeConfigSection(WebCapabilityConfig, raw.web)
  if ('skills' in raw) next.skills = parseLocalRuntimeConfigSection(SkillsCapabilityConfig, raw.skills)
  if ('subagents' in raw) {
    next.subagents = parseLocalRuntimeConfigSection(SubagentsCapabilityConfig, raw.subagents)
  }
  if ('attachments' in raw) {
    next.attachments = parseLocalRuntimeConfigSection(AttachmentsCapabilityConfig, raw.attachments)
  }
  if ('memory' in raw) next.memory = parseLocalRuntimeConfigSection(MemoryCapabilityConfig, raw.memory)
  return next
}

function sanitizeLocalRuntimeModelConfig(value: unknown): Record<string, unknown> {
  const raw = objectValue(value)
  const profiles = objectValue(raw.profiles)
  const sanitizedProfiles: Record<string, unknown> = {}
  for (const [modelId, profile] of Object.entries(profiles)) {
    sanitizedProfiles[modelId] = sanitizeModelProfileForRuntime(profile)
  }
  return {
    ...raw,
    ...(Object.keys(sanitizedProfiles).length > 0 ? { profiles: sanitizedProfiles } : {})
  }
}

function sanitizeLocalRuntimeRuntimeConfig(value: unknown): Record<string, unknown> {
  const raw = objectValue(value)
  const next: Record<string, unknown> = {}
  const modelStreamIdleTimeoutMs = positiveIntegerValue(raw.modelStreamIdleTimeoutMs)
  const maxTurnModelSteps = positiveIntegerValue(raw.maxTurnModelSteps)
  if (modelStreamIdleTimeoutMs !== undefined) next.modelStreamIdleTimeoutMs = modelStreamIdleTimeoutMs
  if (maxTurnModelSteps !== undefined) next.maxTurnModelSteps = maxTurnModelSteps

  const rawToolStorm = objectValue(raw.toolStorm)
  const toolStorm: Record<string, unknown> = {}
  if (typeof rawToolStorm.enabled === 'boolean') toolStorm.enabled = rawToolStorm.enabled
  const windowSize = positiveIntegerValue(rawToolStorm.windowSize)
  const threshold = positiveIntegerValue(rawToolStorm.threshold)
  if (windowSize !== undefined) toolStorm.windowSize = windowSize
  if (threshold !== undefined) toolStorm.threshold = threshold
  if (Object.keys(toolStorm).length > 0) next.toolStorm = toolStorm

  const rawToolArgumentRepair = objectValue(raw.toolArgumentRepair)
  const maxStringBytes = positiveIntegerValue(rawToolArgumentRepair.maxStringBytes)
  if (maxStringBytes !== undefined) {
    next.toolArgumentRepair = { maxStringBytes }
  }

  const rawToolBudget = objectValue(raw.toolBudget)
  const toolBudget: Record<string, unknown> = {}
  if (typeof rawToolBudget.enabled === 'boolean') toolBudget.enabled = rawToolBudget.enabled
  const rawProfiles = objectValue(rawToolBudget.profiles)
  const profiles: Record<string, unknown> = {}
  for (const name of ['explanation', 'review', 'implementation', 'long'] as const) {
    const rawProfile = objectValue(rawProfiles[name])
    const profile: Record<string, unknown> = {}
    for (const key of ['softLimit', 'hardLimit', 'maxAutomaticPhases', 'totalLimit'] as const) {
      const normalized = positiveIntegerValue(rawProfile[key])
      if (normalized !== undefined) profile[key] = normalized
    }
    if (Object.keys(profile).length > 0) profiles[name] = profile
  }
  if (Object.keys(profiles).length > 0) toolBudget.profiles = profiles
  if (Object.keys(toolBudget).length > 0) next.toolBudget = toolBudget

  const rawParallelism = objectValue(raw.parallelism)
  const parallelism: Record<string, unknown> = {}
  const localReadOnly = positiveIntegerValue(rawParallelism.localReadOnly)
  const networkMcp = positiveIntegerValue(rawParallelism.networkMcp)
  if (localReadOnly !== undefined) parallelism.localReadOnly = localReadOnly
  if (networkMcp !== undefined) parallelism.networkMcp = networkMcp
  if (Object.keys(parallelism).length > 0) next.parallelism = parallelism

  const parsed = RuntimeTuningConfigSchema.safeParse(next)
  return parsed.success ? objectValue(parsed.data) : {}
}

function sanitizeLocalRuntimeConfigSections(
  existing: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!existing) return null
  const serve = stripLocalRuntimeServeProviderFields(objectValue(existing.serve))
  return {
    serve: parseLocalRuntimeConfigSection(LocalRuntimeServeConfigSchema, serve),
    models: parseLocalRuntimeConfigSection(
      ModelConfigSchema,
      sanitizeLocalRuntimeModelConfig(existing.models)
    ),
    contextCompaction: parseLocalRuntimeConfigSection(
      ContextCompactionConfigSchema,
      existing.contextCompaction
    ),
    runtime: sanitizeLocalRuntimeRuntimeConfig(existing.runtime),
    capabilities: sanitizeLocalRuntimeCapabilitiesConfig(existing.capabilities)
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function stopLocalRuntimeChildAndWait(): Promise<void> {
  if (!child) {
    if (childLogCapture) {
      const capture = childLogCapture
      childLogCapture = null
      await capture.close()
    }
    return
  }
  const stoppingChild = child
  intentionalStops.add(stoppingChild)
  const pid = child.pid
  const capture = childLogCapture
  if (stoppingChild.exitCode === null && stoppingChild.signalCode === null) {
    try {
      stoppingChild.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  const exited = await waitForChildExit(stoppingChild, LOCAL_RUNTIME_STOP_GRACE_MS)
  if (!exited) {
    try {
      if (pid) process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
    await waitForChildExit(stoppingChild, LOCAL_RUNTIME_STOP_FORCE_MS)
  }
  if (child === stoppingChild) child = null
  if (capture) {
    childLogCapture = null
    await capture.close()
  }
}

function waitForChildExit(process: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => settle(false), timeoutMs)
    const settle = (exited: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      process.removeListener('exit', onExit)
      process.removeListener('error', onError)
      resolve(exited)
    }
    const onExit = (): void => settle(true)
    const onError = (): void => settle(true)
    process.once('exit', onExit)
    process.once('error', onError)
  })
}

function localRuntimeChildEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...baseEnv }
  for (const name of UPSTREAM_PROVIDER_SECRET_ENV_NAMES) {
    delete env[name]
  }
  for (const name of UPSTREAM_PROVIDER_CONFIG_ENV_NAMES) {
    delete env[name]
  }
  for (const name of LEGACY_MODEL_ROUTER_ENV_NAMES) {
    delete env[name]
  }
  for (const name of COMPUTER_USE_SERVICE_ENV_NAMES) {
    delete env[name]
  }
  for (const key of Object.keys(env)) {
    if (isUpstreamProviderConfigEnv(key) || isLegacyDirectWorkerEnv(key)) delete env[key]
  }
  return env
}

function isLegacyDirectWorkerEnv(key: string): boolean {
  return isPrefixedEnv(key, LEGACY_DIRECT_WORKER_ENV_PREFIXES)
}

export async function reclaimLocalRuntimePort(
  port: number
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (port <= 0) return { ok: true }
  const available = await canBindTcpPort(port, '127.0.0.1')
  return available
    ? { ok: true }
    : { ok: false, message: `port ${port} is in use` }
}

export async function resolveAvailableLocalRuntimePort(
  preferredPort: number
): Promise<{ port: number; changed: boolean; message?: string }> {
  if (preferredPort > 0) {
    if (await canBindTcpPort(preferredPort, '127.0.0.1')) {
      return { port: preferredPort, changed: false }
    }
    for (let port = preferredPort + 1; port <= MAX_TCP_PORT; port += 1) {
      if (await canBindTcpPort(port, '127.0.0.1')) {
        return {
          port,
          changed: true,
          message: `port ${preferredPort} is in use`
        }
      }
    }
  }
  const port = await allocateTcpPort('127.0.0.1')
  return {
    port,
    changed: true,
    ...(preferredPort > 0 ? { message: `port ${preferredPort} is in use` } : {})
  }
}

function canBindTcpPort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const server = createServer()
    const settle = (available: boolean): void => {
      if (settled) return
      settled = true
      server.removeAllListeners('error')
      resolve(available)
    }
    server.unref()
    server.once('error', () => settle(false))
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => settle(true))
    })
  })
}

function allocateTcpPort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    const cleanup = (): void => {
      server.removeAllListeners('error')
      server.removeAllListeners('listening')
    }
    server.unref()
    server.once('error', (error) => {
      cleanup()
      reject(error)
    })
    server.listen({ port: 0, host, exclusive: true }, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        cleanup()
        if (error) reject(error)
        else if (port > 0) resolve(port)
        else reject(new Error('failed to allocate an available SciForge Runtime port'))
      })
    })
  })
}

type LocalRuntimeStartupReadySource = 'stdout' | 'health'

async function waitForLocalRuntimeStartup(
  startedChild: ChildProcess,
  port?: number
): Promise<LocalRuntimeStartupReadySource> {
  if (startedChild.exitCode !== null) {
    throw new Error(describeLocalRuntimeExit(startedChild.exitCode, null))
  }
  return new Promise<LocalRuntimeStartupReadySource>((resolve, reject) => {
    let settled = false
    let stdoutBuffer = ''
    let stderrTail = ''
    let healthProbeInFlight = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(describeLocalRuntimeStartupTimeout(stderrTail)))
    }, LOCAL_RUNTIME_STARTUP_TIMEOUT_MS)
    const healthTimer = port
      ? setInterval(() => {
          if (settled || healthProbeInFlight) return
          healthProbeInFlight = true
          void probeLocalRuntimeHealth(port)
            .then((healthy) => {
              if (healthy) settleReady('health')
            })
            .finally(() => {
              healthProbeInFlight = false
            })
        }, LOCAL_RUNTIME_STARTUP_HEALTH_POLL_MS)
      : null
    const cleanup = (): void => {
      clearTimeout(timer)
      if (healthTimer) clearInterval(healthTimer)
      startedChild.removeListener('exit', onExit)
      startedChild.removeListener('error', onError)
      startedChild.stdout?.removeListener('data', onStdout)
      startedChild.stderr?.removeListener('data', onStderr)
    }
    const tryParseReady = (): boolean => {
      const markerIndex = stdoutBuffer.indexOf(LOCAL_RUNTIME_READY_PREFIX)
      if (markerIndex < 0) return false
      const afterPrefix = stdoutBuffer.slice(markerIndex + LOCAL_RUNTIME_READY_PREFIX.length)
      const newlineIndex = afterPrefix.indexOf('\n')
      if (newlineIndex < 0) return false
      const jsonLine = afterPrefix.slice(0, newlineIndex).trim()
      if (!jsonLine) return false
      try {
        const parsed = JSON.parse(jsonLine) as { service?: string; mode?: string; port?: number }
        return parsed.service === 'kun' && parsed.mode === 'serve' && typeof parsed.port === 'number'
      } catch {
        return false
      }
    }
    const settleReady = (source: LocalRuntimeStartupReadySource): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(source)
    }
    const onStdout = (chunk: Buffer | string): void => {
      stdoutBuffer = appendTail(stdoutBuffer, String(chunk), STDERR_TAIL_MAX_CHARS * 2)
      if (tryParseReady()) settleReady('stdout')
    }
    const onStderr = (chunk: Buffer | string): void => {
      stderrTail = appendTail(stderrTail, String(chunk))
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(describeLocalRuntimeExit(code, signal, stderrTail)))
    }
    const onError = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    startedChild.stdout?.on('data', onStdout)
    startedChild.stderr?.on('data', onStderr)
    startedChild.once('exit', onExit)
    startedChild.once('error', onError)
  })
}

function describeLocalRuntimeExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderrTail = ''
): string {
  const suffix = stderrTail.trim() ? `\n${stderrTail.trim()}` : ''
  if (signal) return `SciForge Runtime exited during startup with signal ${signal}${suffix}`
  if (typeof code === 'number') return `SciForge Runtime exited during startup with code ${code}${suffix}`
  return `SciForge Runtime exited during startup${suffix}`
}

function describeLocalRuntimeStartupTimeout(stderrTail: string): string {
  const suffix = stderrTail.trim() ? `\n${stderrTail.trim()}` : ''
  return `SciForge Runtime did not become ready within ${LOCAL_RUNTIME_STARTUP_TIMEOUT_MS}ms (waiting for the runtime ready marker or /health)${suffix}`
}

async function probeLocalRuntimeHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(LOCAL_RUNTIME_STARTUP_HEALTH_REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) return false
    return isLocalRuntimeHealthResponseBody(await response.text())
  } catch {
    return false
  }
}

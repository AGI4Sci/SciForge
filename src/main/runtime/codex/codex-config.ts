import { constants } from 'node:fs'
import { access, chmod, copyFile, lstat, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import {
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  getCodexRuntimeSettings,
  getModelAccessSettings,
  getModelRouterSettings,
  isModelRouterTextReasonerConfigured,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import {
  GUI_SCHEDULE_INTERNAL_SECRET_ENV,
  type ScheduleMcpLaunchConfig
} from '../../schedule-mcp-config'
import type { ResearchSearchMcpLaunchConfig } from '../../research-search-mcp-config'
import {
  GUI_WORKFLOW_INTERNAL_SECRET_ENV,
  type WorkflowMcpLaunchConfig
} from '../../workflow-mcp-config'
import type { WorkspaceIntelMcpLaunchConfig } from '../../workspace-intel-mcp-config'
import type { PaperRadarMcpLaunchConfig } from '../../paper-radar-mcp-config'
import type { WriteAssistMcpLaunchConfig } from '../../write-assist-mcp-config'
import type { RuntimeInspectorMcpLaunchConfig } from '../../runtime-inspector-mcp-config'
import type { ScientificSkillsMcpLaunchConfig } from '../../scientific-skills-mcp-config'
import type { ScientificPlottingMcpLaunchConfig } from '../../scientific-plotting-mcp-config'
import type { BgcDiscoveryMcpLaunchConfig } from '../../bgc-discovery-mcp-config'
import type { ImageGenerationMcpLaunchConfig } from '../../image-generation-mcp-config'
import type { PptMasterMcpLaunchConfig } from '../../ppt-master-mcp-config'
import type { VisualDocumentMcpLaunchConfig } from '../../visual-document-mcp-config'
import { internalSecretEnv } from '../../internal-http-secret'
import {
  CODEX_PLAN_PROVIDER_ID,
  createCodexPlanRuntimeConfig
} from '../../../../packages/workers/plan-gateway/src/adapters/codex'
import {
  DIRECT_PROVIDER_WORKER_ENV_PREFIXES,
  MODEL_ROUTER_PRIVATE_ENV_PREFIXES,
  SCI_MODALITY_SERVICE_ENV_PREFIXES,
  SCI_MODALITY_WORKER_PRIVATE_ENV_PREFIXES,
  UPSTREAM_PROVIDER_SECRET_ENV_NAMES,
  isPrefixedEnv,
  isUpstreamProviderConfigEnv
} from '../../upstream-provider-env'

const RUNTIME_API_KEY_ENV = 'SCIFORGE_RUNTIME_API_KEY'
export const CODEX_PLAN_GATEWAY_PROVIDER_ID = CODEX_PLAN_PROVIDER_ID
const CODEX_MANAGED_DIRS = ['sessions', 'memories', 'logs'] as const
const LEGACY_DIRECT_WORKER_ENV_PREFIXES = [
  ...DIRECT_PROVIDER_WORKER_ENV_PREFIXES,
  ...MODEL_ROUTER_PRIVATE_ENV_PREFIXES,
  ...SCI_MODALITY_SERVICE_ENV_PREFIXES,
  ...SCI_MODALITY_WORKER_PRIVATE_ENV_PREFIXES
] as const

export type CodexAppServerLaunchConfig = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  codexHome: string
  accessMode: 'api' | 'coding-plan'
}

export type CodexPlanGatewayLaunchConfig = {
  baseUrl: string
}

export async function prepareCodexAppServerLaunch(options: {
  settings: AppSettingsV1
  workspace?: string
  env?: NodeJS.ProcessEnv
  managedCodexHome?: string
  standardCodexAuthPath?: string
  planGateway?: CodexPlanGatewayLaunchConfig
  scheduleMcpLaunch?: ScheduleMcpLaunchConfig
  researchMcpLaunch?: ResearchSearchMcpLaunchConfig
  workflowMcpLaunch?: WorkflowMcpLaunchConfig
  workspaceIntelMcpLaunch?: WorkspaceIntelMcpLaunchConfig
  paperRadarMcpLaunch?: PaperRadarMcpLaunchConfig
  writeAssistMcpLaunch?: WriteAssistMcpLaunchConfig
  runtimeInspectorMcpLaunch?: RuntimeInspectorMcpLaunchConfig
  scientificSkillsMcpLaunch?: ScientificSkillsMcpLaunchConfig
  scientificPlottingMcpLaunch?: ScientificPlottingMcpLaunchConfig
  bgcDiscoveryMcpLaunch?: BgcDiscoveryMcpLaunchConfig
  imageGenerationMcpLaunch?: ImageGenerationMcpLaunchConfig
  pptMasterMcpLaunch?: PptMasterMcpLaunchConfig
  visualDocumentMcpLaunch?: VisualDocumentMcpLaunchConfig
}): Promise<CodexAppServerLaunchConfig> {
  const runtime = getCodexRuntimeSettings(options.settings)
  const baseEnv = options.env ?? process.env
  const command = await resolveCodexCommand(runtime.command, { env: baseEnv })
  const codexHome = expandHome(options.managedCodexHome || runtime.codexHome)
  if (!codexHome) throw new Error('Codex CODEX_HOME is required.')
  const modelAccess = codexModelAccessConfig(options.settings, options.planGateway)
  const cwd = resolveCodexWorkspace(options.settings, options.workspace)
  if (!cwd) throw new Error('Codex workspace is required.')
  await prepareManagedCodexHome(codexHome, modelAccess, options.standardCodexAuthPath)
  return {
    command,
    args: ['app-server', '--listen', 'stdio://', ...codexAppServerExtraArgs(runtime.extraArgs)],
    cwd,
    env: prependCommandDirectoryToPath(codexRuntimeEnv(
      baseEnv,
      codexHome,
      modelAccess.mode === 'api' ? modelAccess.apiKey : undefined,
      {
        ...(options.scheduleMcpLaunch
          ? internalSecretEnv(GUI_SCHEDULE_INTERNAL_SECRET_ENV, options.settings.schedule.internal.secret)
          : {}),
        ...(options.workflowMcpLaunch
          ? internalSecretEnv(GUI_WORKFLOW_INTERNAL_SECRET_ENV, options.settings.workflow.webhookSecret)
          : {})
      }
    ), command),
    codexHome,
    accessMode: modelAccess.mode
  }
}

export async function resolveCodexCommand(
  raw: string,
  options: {
    env?: NodeJS.ProcessEnv
    homeDir?: string
    platform?: NodeJS.Platform
    isExecutable?: (path: string) => Promise<boolean>
  } = {}
): Promise<string> {
  const command = raw.trim()
  if (!command) throw new Error('Codex command is required.')
  const homeDir = options.homeDir ?? homedir()
  const expanded = expandHomeFrom(command, homeDir)
  if (isAbsolute(expanded) || expanded.includes('/') || expanded.includes('\\')) return expanded

  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const pathValue = env.PATH ?? env.Path ?? env.path ?? ''
  const searchDirs = pathValue
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (platform === 'darwin') {
    searchDirs.push(join(homeDir, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin')
  } else if (platform === 'win32') {
    // GUI apps launched from Explorer do not always inherit the same PATH as
    // an interactive shell. Cover the standard npm and standalone locations.
    const appData = options.env?.APPDATA ?? process.env.APPDATA
    const localAppData = options.env?.LOCALAPPDATA ?? process.env.LOCALAPPDATA
    if (appData) searchDirs.push(join(appData, 'npm'))
    if (localAppData) {
      searchDirs.push(join(localAppData, 'Programs'), join(localAppData, 'Microsoft', 'WinGet', 'Packages'))
    }
    searchDirs.push(join(homeDir, '.local', 'bin'), join(homeDir, '.cargo', 'bin'))
  } else {
    searchDirs.push(join(homeDir, '.local', 'bin'), '/usr/local/bin', '/usr/bin')
  }

  const isExecutable = options.isExecutable ?? ((path: string) => executableFileExists(path, platform))
  for (const directory of new Set(searchDirs)) {
    const names = platform === 'win32'
      ? [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
      : [command]
    for (const name of names) {
      const candidate = join(directory, name)
      if (await isExecutable(candidate)) return candidate
    }
  }
  if (platform === 'win32') {
    const packaged = await resolvePackagedWindowsCodex(command, env, homeDir, isExecutable)
    if (packaged) return packaged
  }
  return command
}

async function resolvePackagedWindowsCodex(
  command: string,
  env: NodeJS.ProcessEnv,
  homeDir: string,
  isExecutable: (path: string) => Promise<boolean>
): Promise<string | null> {
  if (!/^codex(?:\.exe)?$/i.test(command)) return null
  const programRoots = new Set([
    env.ProgramFiles,
    env.ProgramW6432,
    process.env.ProgramFiles,
    process.env.ProgramW6432
  ].filter((value): value is string => Boolean(value?.trim())))

  for (const programRoot of programRoots) {
    const windowsApps = join(programRoot, 'WindowsApps')
    let packages: string[]
    try {
      packages = (await readdir(windowsApps, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^OpenAI\.Codex_/i.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    } catch {
      continue
    }
    for (const packageName of packages) {
      const source = join(windowsApps, packageName, 'app', 'resources', 'codex.exe')
      if (!(await isExecutable(source))) continue
      return materializePackagedWindowsCodex(source, homeDir)
    }
  }
  return null
}

async function materializePackagedWindowsCodex(source: string, homeDir: string): Promise<string> {
  const runtimeDir = join(homeDir, '.sciforge', 'codex-runtime')
  const target = join(runtimeDir, 'codex.exe')
  await mkdir(runtimeDir, { recursive: true })
  try {
    const [sourceInfo, targetInfo] = await Promise.all([stat(source), stat(target)])
    if (sourceInfo.size === targetInfo.size && targetInfo.mtimeMs >= sourceInfo.mtimeMs) return target
  } catch {
    // Missing or stale target: refresh it below.
  }

  const temporary = join(runtimeDir, `codex-${process.pid}-${Date.now()}.tmp`)
  try {
    await copyFile(source, temporary)
    await rm(target, { force: true })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
  return target
}

function prependCommandDirectoryToPath(env: NodeJS.ProcessEnv, command: string): NodeJS.ProcessEnv {
  if (!isAbsolute(command)) return env
  const directory = dirname(command)
  const pathKey = env.PATH !== undefined ? 'PATH' : env.Path !== undefined ? 'Path' : 'PATH'
  const pathEntries = (env[pathKey] ?? '').split(delimiter).filter(Boolean)
  if (!pathEntries.includes(directory)) env[pathKey] = [directory, ...pathEntries].join(delimiter)
  return env
}

async function executableFileExists(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    // Windows does not expose POSIX executable bits; existence is sufficient.
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

function expandHomeFrom(raw: string, homeDir: string): string {
  if (raw === '~') return homeDir
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return join(homeDir, raw.slice(2))
  return raw
}

export function codexAppServerExtraArgs(args: readonly string[]): string[] {
  const filtered: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--profile-v2') continue
    if (arg === '--profile' || arg === '-p') {
      index += 1
      continue
    }
    if (arg.startsWith('--profile=')) continue
    filtered.push(arg)
  }
  return filtered
}

export function resolveCodexWorkspace(settings: AppSettingsV1, workspace?: string): string {
  return expandHome(workspace || settings.workspaceRoot || '~')
}

export function codexRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv,
  codexHome: string,
  runtimeApiKey?: string,
  localSecrets: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    CODEX_HOME: codexHome,
    ...localSecrets
  }
  delete env.CODEX_USER_HOME
  delete env.CODEX_CONFIG_HOME
  for (const key of UPSTREAM_PROVIDER_SECRET_ENV_NAMES) {
    delete env[key]
  }
  for (const key of Object.keys(env)) {
    if (isUpstreamProviderConfigEnv(key) || isLegacyDirectWorkerEnv(key)) {
      delete env[key]
    }
  }
  delete env[RUNTIME_API_KEY_ENV]
  if (runtimeApiKey !== undefined) {
    env[RUNTIME_API_KEY_ENV] = runtimeApiKey
  }
  env.NO_PROXY = appendNoProxyLoopbacks(env.NO_PROXY)
  env.no_proxy = appendNoProxyLoopbacks(env.no_proxy)
  return env
}

export function expandHome(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  return expandHomeFrom(value, homedir())
}

function appendNoProxyLoopbacks(value: string | undefined): string {
  const required = ['127.0.0.1', 'localhost', '::1']
  const parts = (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const existing = new Set(parts.map((part) => part.toLowerCase()))
  for (const entry of required) {
    if (!existing.has(entry.toLowerCase())) parts.push(entry)
  }
  return parts.join(',')
}

function isLegacyDirectWorkerEnv(key: string): boolean {
  return isPrefixedEnv(key, LEGACY_DIRECT_WORKER_ENV_PREFIXES)
}

async function prepareManagedCodexHome(
  codexHome: string,
  modelAccess: CodexModelAccessConfig,
  standardCodexAuthPath?: string
): Promise<void> {
  await mkdir(codexHome, { recursive: true })
  await assertManagedCodexHome(codexHome)
  await Promise.all(
    CODEX_MANAGED_DIRS.map((dir) => mkdir(join(codexHome, dir), { recursive: true }))
  )
  if (modelAccess.mode === 'coding-plan') {
    await importStandardCodexAuth(codexHome, standardCodexAuthPath)
    await assertManagedCodexAuth(codexHome)
  }
  await writeFile(
    join(codexHome, 'config.toml'),
    codexConfigToml(modelAccess),
    'utf8'
  )
}

async function importStandardCodexAuth(codexHome: string, source?: string): Promise<void> {
  if (!source) return
  const target = join(codexHome, 'auth.json')
  try {
    await lstat(target)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  let sourceInfo
  try {
    sourceInfo = await lstat(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) return

  const temporary = join(codexHome, `auth-${process.pid}-${Date.now()}.tmp`)
  try {
    await copyFile(source, temporary)
    if (process.platform !== 'win32') await chmod(temporary, 0o600)
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function assertManagedCodexHome(codexHome: string): Promise<void> {
  const info = await lstat(codexHome)
  if (info.isSymbolicLink()) {
    throw new Error('Codex managed CODEX_HOME must not be a symbolic link.')
  }
  if (!info.isDirectory()) {
    throw new Error('Codex managed CODEX_HOME must be a directory.')
  }
}

async function assertManagedCodexAuth(codexHome: string): Promise<void> {
  const authPath = join(codexHome, 'auth.json')
  let info
  try {
    info = await lstat(authPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (info.isSymbolicLink()) {
    throw new Error('Codex managed auth.json must not be a symbolic link.')
  }
  if (!info.isFile()) {
    throw new Error('Codex managed auth.json must be a regular file.')
  }
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    throw new Error('Codex managed auth.json must not be group or world accessible.')
  }
}

type CodexModelRouterConfig = {
  mode: 'api'
  baseUrl: string
  apiKey: string
}

type CodexPlanGatewayConfig = {
  mode: 'coding-plan'
  baseUrl: string
}

type CodexModelAccessConfig = CodexModelRouterConfig | CodexPlanGatewayConfig

function codexModelAccessConfig(
  settings: AppSettingsV1,
  planGateway: CodexPlanGatewayLaunchConfig | undefined
): CodexModelAccessConfig {
  const access = getModelAccessSettings(settings)
  if (!access) throw new Error('Codex model access setup is required.')
  if (access.mode === 'api') return codexModelRouterConfig(settings)
  if (access.planAdapterId !== 'codex') {
    throw new Error(`Codex runtime does not support coding plan adapter: ${access.planAdapterId || '(missing)'}.`)
  }
  const baseUrl = planGateway?.baseUrl.trim().replace(/\/+$/, '') ?? ''
  if (!baseUrl) throw new Error('Codex Plan Gateway base URL is required in coding-plan mode.')
  return { mode: 'coding-plan', baseUrl }
}

function codexModelRouterConfig(settings: AppSettingsV1): CodexModelRouterConfig {
  if (!isModelRouterTextReasonerConfigured(getModelRouterSettings(settings))) {
    throw new Error('Codex Model Router text reasoner Base URL, API key, and model name are required.')
  }
  const router = resolveRuntimeModelRouterSettings(settings)
  const baseUrl = router.baseUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('Codex Model Router base URL is required.')
  if (!baseUrl.endsWith('/v1')) {
    throw new Error('Codex Model Router base URL must end with /v1.')
  }
  if (!isLocalHttpUrl(baseUrl)) {
    throw new Error('Codex Model Router base URL must be local.')
  }
  if (!router.apiKey) throw new Error('Codex Model Router runtime API key is required.')
  if (
    (router.model || DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS) !==
    DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
  ) {
    throw new Error(`Codex Model Router model must be ${DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS}.`)
  }
  return {
    mode: 'api',
    baseUrl,
    apiKey: router.apiKey
  }
}

function codexConfigToml(modelAccess: CodexModelAccessConfig): string {
  if (modelAccess.mode === 'coding-plan') {
    return [
      'hide_agent_reasoning = false',
      'show_raw_agent_reasoning = true',
      'model_reasoning_summary = "detailed"',
      'model_supports_reasoning_summaries = true',
      '',
      createCodexPlanRuntimeConfig(modelAccess.baseUrl)
    ].join('\n')
  }
  return [
    `model = "${tomlString(DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS)}"`,
    `model_provider = "${tomlString(DEFAULT_MODEL_ROUTER_PROVIDER_ID)}"`,
    'hide_agent_reasoning = false',
    'show_raw_agent_reasoning = true',
    'model_reasoning_summary = "detailed"',
    'model_supports_reasoning_summaries = true',
    '',
    `[model_providers.${DEFAULT_MODEL_ROUTER_PROVIDER_ID}]`,
    'name = "SciForge Model Router"',
    `base_url = "${tomlString(modelAccess.baseUrl)}"`,
    `env_key = "${RUNTIME_API_KEY_ENV}"`,
    'wire_api = "responses"',
    ''
  ].join('\n')
}

function isLocalHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:') return false
    const host = parsed.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

function tomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

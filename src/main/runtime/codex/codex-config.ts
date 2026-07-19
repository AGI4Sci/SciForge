import { constants } from 'node:fs'
import { access, chmod, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import {
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  DEFAULT_CODEX_DATA_DIR,
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
  await prepareManagedCodexHome(codexHome, modelAccess, codexAuthSourceHomes(runtime.codexHome))
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
  const searchDirs = (env.PATH ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (platform === 'darwin') {
    searchDirs.push(join(homeDir, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin')
  } else if (platform !== 'win32') {
    searchDirs.push(join(homeDir, '.local', 'bin'), '/usr/local/bin', '/usr/bin')
  }

  const isExecutable = options.isExecutable ?? executableFileExists
  for (const directory of new Set(searchDirs)) {
    const candidate = join(directory, command)
    if (await isExecutable(candidate)) return candidate
  }
  return command
}

function prependCommandDirectoryToPath(env: NodeJS.ProcessEnv, command: string): NodeJS.ProcessEnv {
  if (!isAbsolute(command)) return env
  const directory = dirname(command)
  const pathEntries = (env.PATH ?? '').split(delimiter).filter(Boolean)
  if (!pathEntries.includes(directory)) env.PATH = [directory, ...pathEntries].join(delimiter)
  return env
}

async function executableFileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
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

export function codexAuthSourceHomes(raw: string, homeDir: string = homedir()): string[] {
  const value = raw.trim()
  const configured = expandHomeFrom(value, homeDir)
  if (value === DEFAULT_CODEX_DATA_DIR) {
    return [configured, join(homeDir, '.codex')]
  }
  return configured ? [configured] : []
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
  authSourceCodexHomes: readonly string[]
): Promise<void> {
  await mkdir(codexHome, { recursive: true })
  await Promise.all(
    CODEX_MANAGED_DIRS.map((dir) => mkdir(join(codexHome, dir), { recursive: true }))
  )
  if (modelAccess.mode === 'coding-plan') {
    await importExistingCodexAuth(codexHome, authSourceCodexHomes)
  }
  await writeFile(
    join(codexHome, 'config.toml'),
    codexConfigToml(modelAccess),
    'utf8'
  )
}

async function importExistingCodexAuth(
  managedCodexHome: string,
  sourceCodexHomes: readonly string[]
): Promise<void> {
  const destination = join(managedCodexHome, 'auth.json')
  for (const sourceCodexHome of sourceCodexHomes) {
    if (!sourceCodexHome || sourceCodexHome === managedCodexHome) continue
    try {
      await copyFile(join(sourceCodexHome, 'auth.json'), destination, constants.COPYFILE_EXCL)
      await chmod(destination, 0o600)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') continue
      if (code === 'EEXIST') return
      throw error
    }
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

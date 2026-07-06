import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  getCodexRuntimeSettings,
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
import type { ImageGenerationMcpLaunchConfig } from '../../image-generation-mcp-config'
import type { PptMasterMcpLaunchConfig } from '../../ppt-master-mcp-config'
import type { SciforgeCanvasMcpLaunchConfig } from '../../sciforge-canvas-mcp-config'
import { internalSecretEnv } from '../../internal-http-secret'
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
}

export async function prepareCodexAppServerLaunch(options: {
  settings: AppSettingsV1
  workspace?: string
  env?: NodeJS.ProcessEnv
  managedCodexHome?: string
  scheduleMcpLaunch?: ScheduleMcpLaunchConfig
  researchMcpLaunch?: ResearchSearchMcpLaunchConfig
  workflowMcpLaunch?: WorkflowMcpLaunchConfig
  workspaceIntelMcpLaunch?: WorkspaceIntelMcpLaunchConfig
  paperRadarMcpLaunch?: PaperRadarMcpLaunchConfig
  writeAssistMcpLaunch?: WriteAssistMcpLaunchConfig
  runtimeInspectorMcpLaunch?: RuntimeInspectorMcpLaunchConfig
  scientificSkillsMcpLaunch?: ScientificSkillsMcpLaunchConfig
  scientificPlottingMcpLaunch?: ScientificPlottingMcpLaunchConfig
  imageGenerationMcpLaunch?: ImageGenerationMcpLaunchConfig
  pptMasterMcpLaunch?: PptMasterMcpLaunchConfig
  sciforgeCanvasMcpLaunch?: SciforgeCanvasMcpLaunchConfig
}): Promise<CodexAppServerLaunchConfig> {
  const runtime = getCodexRuntimeSettings(options.settings)
  const command = runtime.command.trim()
  if (!command) throw new Error('Codex command is required.')
  const codexHome = expandHome(options.managedCodexHome || runtime.codexHome)
  if (!codexHome) throw new Error('Codex CODEX_HOME is required.')
  const modelRouter = codexModelRouterConfig(options.settings)
  const cwd = resolveCodexWorkspace(options.settings, options.workspace)
  if (!cwd) throw new Error('Codex workspace is required.')
  await prepareManagedCodexHome(codexHome, modelRouter)
  return {
    command,
    args: ['app-server', '--listen', 'stdio://', ...codexAppServerExtraArgs(runtime.extraArgs)],
    cwd,
    env: codexRuntimeEnv(
      options.env ?? process.env,
      codexHome,
      modelRouter.apiKey,
      {
        ...(options.scheduleMcpLaunch
          ? internalSecretEnv(GUI_SCHEDULE_INTERNAL_SECRET_ENV, options.settings.schedule.internal.secret)
          : {}),
        ...(options.workflowMcpLaunch
          ? internalSecretEnv(GUI_WORKFLOW_INTERNAL_SECRET_ENV, options.settings.workflow.webhookSecret)
          : {})
      }
    ),
    codexHome
  }
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
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
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
  modelRouter: CodexModelRouterConfig
): Promise<void> {
  await mkdir(codexHome, { recursive: true })
  await Promise.all(
    CODEX_MANAGED_DIRS.map((dir) => mkdir(join(codexHome, dir), { recursive: true }))
  )
  await writeFile(
    join(codexHome, 'config.toml'),
    codexConfigToml(modelRouter),
    'utf8'
  )
}

type CodexModelRouterConfig = {
  baseUrl: string
  apiKey: string
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
    baseUrl,
    apiKey: router.apiKey
  }
}

function codexConfigToml(modelRouter: CodexModelRouterConfig): string {
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
    `base_url = "${tomlString(modelRouter.baseUrl)}"`,
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

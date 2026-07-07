import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Options as ClaudeAgentSdkOptions } from '@anthropic-ai/claude-agent-sdk'
import {
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  getClaudeRuntimeSettings,
  getModelRouterSettings,
  isModelRouterTextReasonerConfigured,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1,
  type ApprovalPolicy,
  type SandboxMode
} from '../../../shared/app-settings'
import { buildClaudeCodeManagedGuiMcpServers } from '../../gui-mcp-registry'
import type { ComputerUseMcpLaunchConfig } from '../../computer-use-mcp-config'
import {
  DIRECT_PROVIDER_WORKER_ENV_PREFIXES,
  MODEL_ROUTER_PRIVATE_ENV_PREFIXES,
  SCI_MODALITY_SERVICE_ENV_PREFIXES,
  SCI_MODALITY_WORKER_PRIVATE_ENV_PREFIXES,
  UPSTREAM_PROVIDER_SECRET_ENV_NAMES,
  isPrefixedEnv,
  isUpstreamProviderConfigEnv
} from '../../upstream-provider-env'

const LEGACY_DIRECT_WORKER_ENV_PREFIXES = [
  ...DIRECT_PROVIDER_WORKER_ENV_PREFIXES,
  ...MODEL_ROUTER_PRIVATE_ENV_PREFIXES,
  ...SCI_MODALITY_SERVICE_ENV_PREFIXES,
  ...SCI_MODALITY_WORKER_PRIVATE_ENV_PREFIXES
] as const
export const DEFAULT_CLAUDE_CODE_CLI_MODEL = 'sonnet'

export type ClaudeCodeSdkLaunchConfig = {
  prompt: string
  sdkOptions: ClaudeAgentSdkOptions
  cwd: string
  env: NodeJS.ProcessEnv
  configDir: string
  model: string
  permissionMode: NonNullable<ClaudeAgentSdkOptions['permissionMode']>
  pathToClaudeCodeExecutable?: string
}

export async function prepareClaudeCodeSdkLaunch(options: {
  settings: AppSettingsV1
  text: string
  workspace?: string
  sessionId?: string
  reasoningEffort?: string
  env?: NodeJS.ProcessEnv
  managedConfigDir?: string
  computerUseMcpLaunch?: ComputerUseMcpLaunchConfig
}): Promise<ClaudeCodeSdkLaunchConfig> {
  const runtime = getClaudeRuntimeSettings(options.settings)
  const command = runtime.command.trim()
  if (!command) throw new Error('Claude Code command is required.')
  const configDir = expandHome(options.managedConfigDir || runtime.configDir)
  if (!configDir) throw new Error('Claude Code config directory is required.')
  const router = claudeModelRouterConfig(options.settings)
  const cwd = resolveClaudeWorkspace(options.settings, options.workspace)
  if (!cwd) throw new Error('Claude Code workspace is required.')
  await mkdir(configDir, { recursive: true })
  const permissionMode = claudePermissionMode(runtime)
  const cliModel = claudeCodeCliModel(runtime.model, router.model)
  const env = claudeCodeRuntimeEnv(options.env ?? process.env, {
    configDir,
    baseUrl: claudeCodeAnthropicBaseUrl(router.baseUrl),
    apiKey: router.apiKey,
    model: cliModel
  })
  const extraArgs = claudeCodeSdkExtraArgs(runtime.extraArgs)
  const pathToClaudeCodeExecutable = command === 'claude' ? undefined : command
  const mcpServers = claudeCodeMcpServers(options.settings, options.computerUseMcpLaunch)
  const reasoningOptions = claudeCodeReasoningOptions(options.reasoningEffort)
  const sdkOptions: ClaudeAgentSdkOptions = {
    cwd,
    env,
    model: cliModel,
    permissionMode,
    ...reasoningOptions,
    ...(permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
    ...(options.sessionId ? { resume: options.sessionId } : {}),
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
    ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
    ...(Object.keys(extraArgs).length > 0 ? { extraArgs } : {})
  }
  return {
    prompt: options.text,
    sdkOptions,
    cwd,
    env,
    configDir,
    model: cliModel,
    permissionMode,
    pathToClaudeCodeExecutable
  }
}

function claudeCodeMcpServers(
  settings: AppSettingsV1,
  computerUseMcpLaunch?: ComputerUseMcpLaunchConfig
): NonNullable<ClaudeAgentSdkOptions['mcpServers']> {
  return buildClaudeCodeManagedGuiMcpServers({
    settings,
    computerUseMcp: computerUseMcpLaunch
      ? { settings, launch: computerUseMcpLaunch }
      : undefined
  })
}

function claudeCodeReasoningOptions(
  reasoningEffort: string | undefined
): Pick<ClaudeAgentSdkOptions, 'thinking' | 'effort' | 'includePartialMessages'> {
  const normalized = normalizeClaudeReasoningEffort(reasoningEffort)
  if (!normalized) return {}
  if (normalized === 'off') {
    return {
      thinking: { type: 'disabled' }
    }
  }
  return {
    thinking: { type: 'adaptive', display: 'summarized' },
    effort: normalized,
    includePartialMessages: true
  }
}

function normalizeClaudeReasoningEffort(value: string | undefined): 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined {
  const normalized = value?.trim().toLowerCase()
  switch (normalized) {
    case 'off':
    case 'none':
    case 'disabled':
      return 'off'
    case 'minimal':
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'xhigh':
    case 'extra-high':
    case 'extra_high':
      return 'xhigh'
    case 'max':
      return 'max'
    default:
      return undefined
  }
}

export function resolveClaudeWorkspace(settings: AppSettingsV1, workspace?: string): string {
  return expandHome(workspace || settings.workspaceRoot || '~')
}

export function claudeCodeRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv,
  runtime: {
    configDir: string
    baseUrl: string
    apiKey: string
    model: string
  }
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  for (const key of UPSTREAM_PROVIDER_SECRET_ENV_NAMES) {
    delete env[key]
  }
  for (const key of Object.keys(env)) {
    if (isUpstreamProviderConfigEnv(key) || isLegacyDirectWorkerEnv(key)) {
      delete env[key]
    }
  }
  env.ANTHROPIC_BASE_URL = claudeCodeAnthropicBaseUrl(runtime.baseUrl)
  env.ANTHROPIC_API_KEY = runtime.apiKey
  env.ANTHROPIC_AUTH_TOKEN = runtime.apiKey
  env.ANTHROPIC_MODEL = runtime.model
  env.ANTHROPIC_SMALL_FAST_MODEL = runtime.model
  env.CLAUDE_CONFIG_DIR = runtime.configDir
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  env.NO_PROXY = appendNoProxyLoopbacks(env.NO_PROXY)
  env.no_proxy = appendNoProxyLoopbacks(env.no_proxy)
  return env
}

export function claudeCodeSdkExtraArgs(args: readonly string[]): NonNullable<ClaudeAgentSdkOptions['extraArgs']> {
  const controlledWithValue = new Set([
    '-p',
    '--print',
    '--output-format',
    '--input-format',
    '--cwd',
    '--model',
    '--permission-mode',
    '--resume',
    '--session-id',
    '--resume-session-at',
    '--settings',
    '--append-system-prompt',
    '--system-prompt'
  ])
  const controlledFlags = new Set([
    '--verbose',
    '--bare',
    '--continue',
    '--dangerously-skip-permissions',
    '--allow-dangerously-skip-permissions',
    '--no-session-persistence',
    '--fork-session',
    '--include-partial-messages',
    '--include-hook-events',
    '--session-mirror'
  ])
  const filtered: NonNullable<ClaudeAgentSdkOptions['extraArgs']> = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (controlledFlags.has(arg)) continue
    if (controlledWithValue.has(arg)) {
      index += 1
      continue
    }
    if ([...controlledFlags].some((flag) => arg.startsWith(`${flag}=`))) continue
    if ([...controlledWithValue].some((flag) => arg.startsWith(`${flag}=`))) continue
    const parsed = parseSdkExtraArg(arg, args[index + 1])
    if (!parsed) continue
    filtered[parsed.key] = parsed.value
    if (parsed.consumedNext) index += 1
  }
  return filtered
}

export function expandHome(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

export function claudeCodeCliModel(configuredModel: string | undefined, routerModel: string): string {
  const model = typeof configuredModel === 'string' ? configuredModel.trim() : ''
  if (model && model !== routerModel && isClaudeCodeCliModel(model)) return model
  return DEFAULT_CLAUDE_CODE_CLI_MODEL
}

export function claudeCodeAnthropicBaseUrl(routerBaseUrl: string): string {
  return routerBaseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
}

function claudeModelRouterConfig(settings: AppSettingsV1): {
  baseUrl: string
  apiKey: string
  model: string
} {
  if (!isModelRouterTextReasonerConfigured(getModelRouterSettings(settings))) {
    throw new Error('Claude Code Model Router text reasoner Base URL, API key, and model name are required.')
  }
  const router = resolveRuntimeModelRouterSettings(settings)
  const baseUrl = router.baseUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('Claude Code Model Router base URL is required.')
  if (!baseUrl.endsWith('/v1')) {
    throw new Error('Claude Code Model Router base URL must end with /v1.')
  }
  if (!isLocalHttpUrl(baseUrl)) {
    throw new Error('Claude Code Model Router base URL must be local.')
  }
  if (!router.apiKey) throw new Error('Claude Code Model Router runtime API key is required.')
  return {
    baseUrl,
    apiKey: router.apiKey,
    model: router.model || DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
  }
}

function claudePermissionMode(runtime: {
  sandboxMode: SandboxMode
  approvalPolicy: ApprovalPolicy
}): NonNullable<ClaudeAgentSdkOptions['permissionMode']> {
  if (runtime.sandboxMode === 'read-only') return 'plan'
  if (
    runtime.sandboxMode === 'danger-full-access' &&
    (runtime.approvalPolicy === 'never' || runtime.approvalPolicy === 'auto')
  ) {
    return 'bypassPermissions'
  }
  return 'acceptEdits'
}

function parseSdkExtraArg(
  arg: string,
  next: string | undefined
): { key: string; value: string | null; consumedNext: boolean } | null {
  if (!arg.startsWith('--') || arg.length <= 2) return null
  const raw = arg.slice(2)
  if (!raw) return null
  const equalsIndex = raw.indexOf('=')
  if (equalsIndex >= 0) {
    const key = raw.slice(0, equalsIndex).trim()
    if (!key) return null
    return { key, value: raw.slice(equalsIndex + 1), consumedNext: false }
  }
  const key = raw.trim()
  if (!key) return null
  if (next && !next.startsWith('-')) {
    return { key, value: next, consumedNext: true }
  }
  return { key, value: null, consumedNext: false }
}

function isClaudeCodeCliModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized === 'sonnet' ||
    normalized === 'opus' ||
    normalized === 'fable' ||
    normalized === 'haiku' ||
    normalized.startsWith('claude-')
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

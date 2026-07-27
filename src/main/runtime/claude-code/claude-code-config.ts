import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import type { Options as ClaudeAgentSdkOptions } from '@anthropic-ai/claude-agent-sdk'
import {
  deriveTraceId,
  traceCorrelationHeaders
} from '@sciforge/full-trace'
import {
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  getClaudeRuntimeSettings,
  getModelRouterSettings,
  isModelRouterTextReasonerConfigured,
  resolveModelAccessRuntimePolicy,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1,
  type ApprovalPolicy,
  type SandboxMode
} from '../../../shared/app-settings'
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

type ClaudeCodeExecutableResolutionOptions = {
  env?: NodeJS.ProcessEnv
  homeDir?: string
  platform?: NodeJS.Platform
  isExecutable?: (path: string) => Promise<boolean>
  readLoginShellPath?: (env: NodeJS.ProcessEnv) => Promise<string>
}

export async function prepareClaudeCodeSdkLaunch(options: {
  settings: AppSettingsV1
  text: string
  threadId: string
  turnId: string
  workspace?: string
  sessionId?: string
  reasoningEffort?: string
  env?: NodeJS.ProcessEnv
  managedConfigDir?: string
}): Promise<ClaudeCodeSdkLaunchConfig> {
  if (!resolveModelAccessRuntimePolicy(options.settings).claude) {
    throw new Error(
      'Claude Code requires API model access and must be the selected Agent runtime.'
    )
  }
  const runtime = getClaudeRuntimeSettings(options.settings)
  const command = runtime.command.trim()
  if (!command) throw new Error('Claude Code command is required.')
  const baseEnv = options.env ?? process.env
  const pathToClaudeCodeExecutable = await resolveClaudeCodeExecutable(command, {
    env: baseEnv
  })
  const configDir = expandHome(options.managedConfigDir || runtime.configDir)
  if (!configDir) throw new Error('Claude Code config directory is required.')
  const router = claudeModelRouterConfig(options.settings)
  const cwd = resolveClaudeWorkspace(options.settings, options.workspace)
  if (!cwd) throw new Error('Claude Code workspace is required.')
  await mkdir(configDir, { recursive: true })
  const permissionMode = claudePermissionMode(runtime)
  const cliModel = claudeCodeCliModel(runtime.model, router.model)
  const env = prependExecutableDirectoryToPath(claudeCodeRuntimeEnv(baseEnv, {
    configDir,
    baseUrl: claudeCodeAnthropicBaseUrl(router.baseUrl),
    apiKey: router.apiKey,
    model: cliModel,
    threadId: options.threadId,
    turnId: options.turnId
  }), pathToClaudeCodeExecutable)
  const extraArgs = claudeCodeSdkExtraArgs(runtime.extraArgs)
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

/**
 * Resolve an explicitly configured Claude Code executable.
 *
 * The literal default `claude` is intentionally reserved for the executable
 * bundled with `@anthropic-ai/claude-agent-sdk`. This keeps launches stable
 * when a GUI process happens to inherit a different PATH. Users who want an
 * external Claude Code installation can configure its absolute path, or a
 * distinct command name that can be found on PATH.
 */
export async function resolveClaudeCodeExecutable(
  raw: string,
  options: ClaudeCodeExecutableResolutionOptions = {}
): Promise<string | undefined> {
  const command = raw.trim()
  if (!command) throw new Error('Claude Code command is required.')
  if (command === 'claude') return undefined

  const homeDir = options.homeDir ?? homedir()
  const expanded = expandHomeFrom(command, homeDir)
  const platform = options.platform ?? process.platform
  const isExecutable = options.isExecutable ?? ((path: string) => executableFileExists(path, platform))
  if (isAbsolute(expanded) || hasPathSeparator(expanded)) {
    if (!isAbsolute(expanded)) {
      throw new Error('Claude Code executable path must be absolute (or start with ~/).')
    }
    if (!await isExecutable(expanded)) {
      throw new Error(`Claude Code executable is missing or not executable: ${expanded}`)
    }
    return expanded
  }

  const env = options.env ?? process.env
  const inheritedPathDirs = pathEntries(environmentPath(env).value, homeDir, platform)
  const inheritedExecutable = await findExecutableInDirs(
    command,
    inheritedPathDirs,
    platform,
    isExecutable
  )
  if (inheritedExecutable) return inheritedExecutable

  if (platform !== 'win32') {
    const readLoginShellPath = options.readLoginShellPath ?? defaultReadLoginShellPath
    const loginShellPath = await readLoginShellPath(env).catch(() => '')
    const loginShellExecutable = await findExecutableInDirs(
      command,
      pathEntries(loginShellPath, homeDir, platform),
      platform,
      isExecutable
    )
    if (loginShellExecutable) return loginShellExecutable
  }

  const commonExecutable = await findExecutableInDirs(
    command,
    commonClaudeCodeBinDirs(platform, env, homeDir),
    platform,
    isExecutable
  )
  if (commonExecutable) return commonExecutable

  throw new Error(
    `Claude Code executable "${command}" was not found. ` +
    'Use the default "claude" for the SDK-bundled executable, or configure an absolute path.'
  )
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
    threadId: string
    turnId: string
  }
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  delete env.ANTHROPIC_CUSTOM_HEADERS
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
  env.ANTHROPIC_CUSTOM_HEADERS = formatClaudeCodeTraceHeaders({
    runtimeId: 'claude',
    threadId: runtime.threadId,
    turnId: runtime.turnId
  })
  env.CLAUDE_CONFIG_DIR = runtime.configDir
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  env.NO_PROXY = appendNoProxyLoopbacks(env.NO_PROXY)
  env.no_proxy = appendNoProxyLoopbacks(env.no_proxy)
  return env
}

function formatClaudeCodeTraceHeaders(input: {
  runtimeId: string
  threadId: string
  turnId: string
}): string {
  for (const [name, value] of Object.entries(input)) {
    if (!value.trim() || /[\r\n]/.test(value)) {
      throw new Error(`Claude Code ${name} must be a non-empty single-line value.`)
    }
  }
  const correlation = {
    ...input,
    traceId: deriveTraceId(input)
  }
  return Object.entries(traceCorrelationHeaders(correlation))
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
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
  return expandHomeFrom(raw, homedir())
}

function expandHomeFrom(raw: string, homeDir: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (value === '~') return homeDir
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homeDir, value.slice(2))
  return value
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\')
}

function pathEntries(
  value: string,
  homeDir: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  return value
    .split(platform === 'win32' ? ';' : ':')
    .map((entry) => expandHomeFrom(entry, homeDir))
    .filter(Boolean)
}

function commonClaudeCodeBinDirs(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string
): string[] {
  const envDir = (value: string | undefined): string =>
    value?.trim() ? expandHomeFrom(value, homeDir) : ''
  if (platform === 'win32') {
    return [
      env.APPDATA ? join(env.APPDATA, 'npm') : '',
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'Claude') : '',
      join(homeDir, '.local', 'bin'),
      join(homeDir, '.claude', 'local')
    ].filter(Boolean)
  }
  const asdfHome = envDir(env.ASDF_DATA_DIR) || join(homeDir, '.asdf')
  const voltaHome = envDir(env.VOLTA_HOME) || join(homeDir, '.volta')
  const bunHome = envDir(env.BUN_INSTALL) || join(homeDir, '.bun')
  return [
    envDir(env.NVM_BIN),
    envDir(env.PNPM_HOME),
    join(homeDir, '.local', 'bin'),
    join(homeDir, '.claude', 'local'),
    join(asdfHome, 'shims'),
    join(voltaHome, 'bin'),
    join(homeDir, 'Library', 'pnpm'),
    join(homeDir, '.local', 'share', 'pnpm'),
    join(bunHome, 'bin'),
    join(homeDir, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin'
  ].filter(Boolean)
}

function executableNames(command: string, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return [command]
  if (/\.(?:exe|cmd|bat)$/i.test(command)) return [command]
  return [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
}

async function findExecutableInDirs(
  command: string,
  directories: readonly string[],
  platform: NodeJS.Platform,
  isExecutable: (path: string) => Promise<boolean>
): Promise<string | undefined> {
  for (const directory of new Set(directories)) {
    for (const name of executableNames(command, platform)) {
      const candidate = join(directory, name)
      if (await isExecutable(candidate)) return candidate
    }
  }
  return undefined
}

async function executableFileExists(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return false
    if (platform !== 'win32') await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function defaultReadLoginShellPath(env: NodeJS.ProcessEnv): Promise<string> {
  const shell = env.SHELL?.trim() || '/bin/sh'
  if (!isAbsolute(shell)) return Promise.resolve('')
  const marker = '__SCIFORGE_LOGIN_SHELL_PATH__'
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', `printf '\\n${marker}%s' "$PATH"`],
      { env, encoding: 'utf8', timeout: 3_000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve('')
        const markerIndex = stdout.lastIndexOf(marker)
        resolve(markerIndex < 0 ? '' : stdout.slice(markerIndex + marker.length).trim())
      }
    )
  })
}

function prependExecutableDirectoryToPath(
  env: NodeJS.ProcessEnv,
  executable: string | undefined
): NodeJS.ProcessEnv {
  if (!executable) return env
  const executableDir = dirname(executable)
  const { key: pathKey, value: currentPath } = environmentPath(env)
  const entries = pathEntries(currentPath, homedir())
  if (entries.includes(executableDir)) return env
  return {
    ...env,
    [pathKey]: [executableDir, currentPath].filter(Boolean).join(delimiter)
  }
}

function environmentPath(env: NodeJS.ProcessEnv): { key: string; value: string } {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === 'path') ?? 'PATH'
  return { key, value: env[key] ?? '' }
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
  if (runtime.sandboxMode === 'danger-full-access') {
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

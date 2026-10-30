import { execFile } from 'node:child_process'
import { chmod, copyFile, lstat, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve, win32 } from 'node:path'
import {
  executableFileExists,
  expandHomeFrom,
  findExecutableCommand,
  macOSCommandSearchDirectories,
  pathExists,
  readLoginShellPath,
  splitCommandSearchPath,
  unixCommandSearchDirectories,
  windowsCommandSearchDirectories
} from '../command-discovery'
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
import { atomicWriteFile } from '../../atomic-write-file'
import {
  codexPreToolUseHooksJson,
  createCodexPreToolUseHookDefinition,
  type CodexPreToolUseHookDefinition
} from './codex-pre-tool-use-hook'
import type { ManagedGuiMcpLaunchConfig } from '../../managed-gui-mcp-config'
import type {
  AgentRuntimeDiscoveryFailureCode,
  AgentRuntimeDiscoveryResult,
  AgentRuntimeDiscoverySource
} from '../../../shared/agent-runtime-contract'

const RUNTIME_API_KEY_ENV = 'SCIFORGE_RUNTIME_API_KEY'
const MINIMUM_CODEX_APP_SERVER_VERSION = [0, 141, 0] as const
export const CODEX_PLAN_GATEWAY_PROVIDER_ID = CODEX_PLAN_PROVIDER_ID
const CODEX_MANAGED_DIRS = ['sessions', 'memories', 'logs'] as const
const WINDOWS_CODEX_RUNTIME_COMPANIONS = [
  'codex-code-mode-host.exe',
  'codex-command-runner.exe',
  'codex-windows-sandbox-setup.exe'
] as const
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
  // True when `command` is the Windows command processor carrying an already
  // quoted `.cmd` launcher; the spawn site must then pass the argument verbatim.
  windowsVerbatimArguments: boolean
  preToolUseHook?: CodexPreToolUseHookDefinition
}

export type CodexPlanGatewayLaunchConfig = {
  baseUrl: string
}

type CodexRuntimeProbeCommandResult = Readonly<{
  exitCode: number
  stdout: string
  stderr: string
}>

type CodexCommandResolutionOptions = {
  env?: NodeJS.ProcessEnv
  homeDir?: string
  platform?: NodeJS.Platform
  isExecutable?: (path: string) => Promise<boolean>
  fileExists?: (path: string) => Promise<boolean>
  getLoginShellPath?: (env: NodeJS.ProcessEnv, homeDir: string) => Promise<string>
  systemApplicationsDir?: string
  runProbeCommand?: (
    command: string,
    args: readonly string[]
  ) => Promise<CodexRuntimeProbeCommandResult>
}

export async function prepareCodexAppServerLaunch(options: {
  settings: AppSettingsV1
  workspace?: string
  env?: NodeJS.ProcessEnv
  managedCodexHome?: string
  standardCodexAuthPath?: string
  planGateway?: CodexPlanGatewayLaunchConfig
  preToolUseHookLaunch?: ManagedGuiMcpLaunchConfig
  runtimeDiscovery: AgentRuntimeDiscoveryResult
}): Promise<CodexAppServerLaunchConfig> {
  const runtime = getCodexRuntimeSettings(options.settings)
  const baseEnv = options.env ?? process.env
  if (!options.runtimeDiscovery) throw new Error('runtime_discovery_required')
  if (!options.runtimeDiscovery.available || !options.runtimeDiscovery.executablePath) {
    throw codexRuntimeDiscoveryError(options.runtimeDiscovery)
  }
  const command = await resolveCodexCommand(options.runtimeDiscovery.executablePath, { env: baseEnv })
  const codexHome = expandHome(options.managedCodexHome || runtime.codexHome)
  if (!codexHome) throw new Error('Codex CODEX_HOME is required.')
  const modelAccess = codexModelAccessConfig(options.settings, options.planGateway)
  const cwd = resolveCodexWorkspace(options.settings, options.workspace)
  if (!cwd) throw new Error('Codex workspace is required.')
  const preToolUseHook = options.preToolUseHookLaunch
    ? createCodexPreToolUseHookDefinition({
        codexHome,
        launch: options.preToolUseHookLaunch
      })
    : undefined
  await prepareManagedCodexHome(
    codexHome,
    modelAccess,
    options.standardCodexAuthPath,
    preToolUseHook
  )
  return {
    command: codexAppServerLaunchCommand(command),
    args: codexAppServerLaunchArgs(command, runtime.extraArgs),
    cwd,
    env: prependCommandDirectoryToPath(codexRuntimeEnv(
      baseEnv,
      codexHome,
      modelAccess.mode === 'api' ? modelAccess.apiKey : undefined
    ), command),
    codexHome,
    accessMode: modelAccess.mode,
    windowsVerbatimArguments: /\.(?:cmd|bat)$/i.test(command),
    ...(preToolUseHook ? { preToolUseHook } : {})
  }
}

async function resolveCodexCommand(
  raw: string,
  options: CodexCommandResolutionOptions = {}
): Promise<string> {
  const resolution = await discoverCodexCommand(raw, options)
  if (resolution.failure) throw codexResolutionError(resolution.failure.code)
  return resolution.executablePath ?? raw.trim()
}

export async function probeCodexRuntime(
  raw: string,
  options: CodexCommandResolutionOptions = {}
): Promise<AgentRuntimeDiscoveryResult> {
  let resolution: CodexCommandResolution
  try {
    resolution = await discoverCodexCommand(raw, options)
  } catch (error) {
    return unavailableCodexRuntime(
      'runtime_probe_failed',
      error instanceof Error ? error.message : String(error)
    )
  }
  if (resolution.failure || !resolution.executablePath || !resolution.source) {
    return resolution.failure && resolution.executablePath && resolution.source
      ? unavailableResolvedCodexRuntime(resolution, resolution.failure.code, '')
      : unavailableCodexRuntime(resolution.failure?.code ?? 'runtime_not_found')
  }

  const runProbeCommand = options.runProbeCommand ?? runCodexProbeCommand
  let versionResult: CodexRuntimeProbeCommandResult
  try {
    versionResult = await runProbeCommand(resolution.executablePath, ['--version'])
  } catch (error) {
    return unavailableResolvedCodexRuntime(
      resolution,
      isArchitectureLaunchError(error)
        ? 'runtime_architecture_incompatible'
        : 'runtime_probe_failed',
      error instanceof Error ? error.message : String(error)
    )
  }
  const version = codexVersion(versionResult.stdout, versionResult.stderr)
  if (versionResult.exitCode !== 0 || !version || !isSupportedCodexVersion(version)) {
    return unavailableResolvedCodexRuntime(
      resolution,
      'runtime_version_unsupported',
      [versionResult.stdout, versionResult.stderr].filter(Boolean).join('\n'),
      version
    )
  }

  let appServerResult: CodexRuntimeProbeCommandResult
  try {
    appServerResult = await runProbeCommand(resolution.executablePath, ['app-server', '--help'])
  } catch (error) {
    return unavailableResolvedCodexRuntime(
      resolution,
      isArchitectureLaunchError(error)
        ? 'runtime_architecture_incompatible'
        : 'runtime_probe_failed',
      error instanceof Error ? error.message : String(error),
      version
    )
  }
  if (appServerResult.exitCode !== 0) {
    return unavailableResolvedCodexRuntime(
      resolution,
      'runtime_capability_unsupported',
      [appServerResult.stdout, appServerResult.stderr].filter(Boolean).join('\n'),
      version
    )
  }
  return Object.freeze({
    runtimeId: 'codex',
    available: true,
    executablePath: resolution.executablePath,
    source: resolution.source,
    version,
    protocol: { id: 'app-server', supported: true }
  })
}

type CodexCommandResolution = Readonly<{
  executablePath: string | null
  source: AgentRuntimeDiscoverySource | null
  failure?: Readonly<{
    code: 'runtime_not_found' | 'runtime_path_invalid' | 'runtime_not_executable'
  }>
}>

async function discoverCodexCommand(
  raw: string,
  options: CodexCommandResolutionOptions
): Promise<CodexCommandResolution> {
  const command = raw.trim()
  if (!command) {
    return unresolvedCodexCommand('runtime_path_invalid')
  }
  const homeDir = options.homeDir ?? homedir()
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const isExecutable = options.isExecutable ?? ((path: string) => executableFileExists(path, platform))
  const fileExists = options.fileExists ?? (options.isExecutable ? isExecutable : pathExists)
  const expanded = expandHomeFrom(command, homeDir)
  const pathIsAbsolute = platform === 'win32' ? win32.isAbsolute(expanded) : isAbsolute(expanded)
  if (pathIsAbsolute || expanded.includes('/') || expanded.includes('\\')) {
    if (!pathIsAbsolute) {
      return unresolvedCodexCommand('runtime_path_invalid')
    }
    if (!(await fileExists(expanded))) {
      return unresolvedCodexCommand('runtime_path_invalid', expanded, 'user-configured')
    }
    if (!(await isExecutable(expanded))) {
      return unresolvedCodexCommand('runtime_not_executable', expanded, 'user-configured')
    }
    return resolvedCodexCommand(expanded, 'user-configured')
  }

  const pathValue = env.PATH ?? env.Path ?? env.path ?? ''
  const searchDirs = splitCommandSearchPath(pathValue, platform)
  const inheritedPathMatch = await findExecutableCommand(command, searchDirs, platform, isExecutable)
  if (inheritedPathMatch) {
    if (platform === 'win32' && isPackagedWindowsCodexPath(inheritedPathMatch)) {
      return resolvedCodexCommand(
        await materializePackagedWindowsCodex(inheritedPathMatch, homeDir),
        'packaged-application'
      )
    }
    return resolvedCodexCommand(inheritedPathMatch, 'process-path')
  }

  if (platform === 'darwin') {
    const getLoginShellPath = options.getLoginShellPath ?? readLoginShellPath
    const loginShellPath = await getLoginShellPath(env, homeDir).catch(() => '')
    const loginShellMatch = await findExecutableCommand(
      command,
      splitCommandSearchPath(loginShellPath, platform),
      platform,
      isExecutable
    )
    if (loginShellMatch) return resolvedCodexCommand(loginShellMatch, 'login-shell-path')

    const fallbackMatch = await findExecutableCommand(
      command,
      await macOSCommandSearchDirectories(homeDir, env),
      platform,
      isExecutable
    )
    if (fallbackMatch) return resolvedCodexCommand(fallbackMatch, 'common-install-location')
    const chatGptMatch = await findExecutableCommand(
      'codex',
      macOSChatGptCodexDirectories(homeDir, options.systemApplicationsDir),
      platform,
      isExecutable
    )
    if (chatGptMatch) return resolvedCodexCommand(chatGptMatch, 'application-bundle')
  } else if (platform === 'win32') {
    // GUI apps launched from Explorer do not always inherit the same PATH as
    // an interactive shell. Cover the standard npm and standalone locations.
    searchDirs.push(...windowsCommandSearchDirectories(env, homeDir))
    const windowsPathMatch = await findExecutableCommand(command, searchDirs, platform, isExecutable)
    if (windowsPathMatch) return resolvedCodexCommand(windowsPathMatch, 'common-install-location')
  } else {
    searchDirs.push(...unixCommandSearchDirectories(homeDir))
    const unixPathMatch = await findExecutableCommand(command, searchDirs, platform, isExecutable)
    if (unixPathMatch) return resolvedCodexCommand(unixPathMatch, 'common-install-location')
  }

  if (platform === 'win32') {
    const packaged = await resolvePackagedWindowsCodex(command, env, homeDir, isExecutable)
    if (packaged) return resolvedCodexCommand(packaged, 'packaged-application')
  }
  return unresolvedCodexCommand('runtime_not_found')
}

function resolvedCodexCommand(
  executablePath: string,
  source: AgentRuntimeDiscoverySource
): CodexCommandResolution {
  return Object.freeze({ executablePath, source })
}

function unresolvedCodexCommand(
  code: 'runtime_not_found' | 'runtime_path_invalid' | 'runtime_not_executable',
  executablePath: string | null = null,
  source: AgentRuntimeDiscoverySource | null = null
): CodexCommandResolution {
  return Object.freeze({ executablePath, source, failure: { code } })
}

function unavailableCodexRuntime(
  code: AgentRuntimeDiscoveryFailureCode,
  technicalDetail = ''
): AgentRuntimeDiscoveryResult {
  return Object.freeze({
    runtimeId: 'codex',
    available: false,
    executablePath: null,
    source: null,
    version: null,
    protocol: null,
    failure: Object.freeze({
      code,
      ...(technicalDetail.trim() ? { technicalDetail: technicalDetail.trim() } : {})
    })
  })
}

function unavailableResolvedCodexRuntime(
  resolution: CodexCommandResolution,
  code: AgentRuntimeDiscoveryFailureCode,
  technicalDetail: string,
  version: string | null = null
): AgentRuntimeDiscoveryResult {
  return Object.freeze({
    runtimeId: 'codex',
    available: false,
    executablePath: resolution.executablePath,
    source: resolution.source,
    version,
    protocol: { id: 'app-server', supported: false },
    failure: Object.freeze({
      code,
      ...(technicalDetail.trim() ? { technicalDetail: technicalDetail.trim() } : {})
    })
  })
}

function codexVersion(stdout: string, stderr: string): string | null {
  return `${stdout}\n${stderr}`.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0] ?? null
}

function isSupportedCodexVersion(version: string): boolean {
  const current = version.split('-', 1)[0].split('.').map(Number)
  for (let index = 0; index < MINIMUM_CODEX_APP_SERVER_VERSION.length; index += 1) {
    if (current[index] !== MINIMUM_CODEX_APP_SERVER_VERSION[index]) {
      return current[index] > MINIMUM_CODEX_APP_SERVER_VERSION[index]
    }
  }
  return true
}

function isArchitectureLaunchError(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error
    ? String(error.code)
    : ''
  const message = error instanceof Error ? error.message : String(error)
  return code === 'EBADARCH' || code === 'ENOEXEC' || /bad cpu type|exec format/i.test(message)
}

function macOSChatGptCodexDirectories(
  homeDir: string,
  systemApplicationsDir = '/Applications'
): string[] {
  const applicationRoots = [
    join(systemApplicationsDir, 'ChatGPT.app', 'Contents', 'Resources'),
    join(homeDir, 'Applications', 'ChatGPT.app', 'Contents', 'Resources')
  ]

  // ChatGPT has shipped the CLI in both Resources/codex and the nested
  // codex-cli bundle. Keep discovery independent of the installed app
  // version so a machine-local absolute path is never required.
  return applicationRoots.flatMap((resources) => [
    resources,
    join(resources, 'codex-cli', 'bin'),
    join(resources, 'codex-cli', 'CodexCLI.app', 'Contents', 'MacOS')
  ])
}

export async function resolveCodexProbeInvocation(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform
): Promise<{ command: string; args: readonly string[]; shell: boolean; windowsVerbatimArguments: boolean }> {
  const requiresShell = platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)
  if (requiresShell) return {
    command: process.env.ComSpec || 'cmd.exe',
    args: windowsCommandProcessorArgs(command, args),
    shell: false,
    windowsVerbatimArguments: true
  }
  return {
    command,
    args,
    shell: false,
    windowsVerbatimArguments: false
  }
}

async function runCodexProbeCommand(
  command: string,
  args: readonly string[]
): Promise<CodexRuntimeProbeCommandResult> {
  const invocation = await resolveCodexProbeInvocation(command, args)
  return new Promise((resolve, reject) => {
    execFile(invocation.command, [...invocation.args], {
      encoding: 'utf8',
      shell: invocation.shell,
      timeout: 5_000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') {
        reject(error)
        return
      }
      resolve({
        exitCode: typeof error?.code === 'number' ? error.code : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? '')
      })
    })
  })
}

function codexRuntimeDiscoveryError(discovery: AgentRuntimeDiscoveryResult): Error {
  return codexResolutionError(discovery.failure?.code ?? 'runtime_not_found')
}

function codexResolutionError(code: AgentRuntimeDiscoveryFailureCode): Error {
  const output = new Error(code)
  output.name = code
  return output
}

function isPackagedWindowsCodexPath(path: string): boolean {
  const normalized = win32.normalize(path).toLowerCase()
  return /\\windowsapps\\openai\.codex_[^\\]+\\app\\resources\\codex\.exe$/i.test(normalized)
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
    env.ProgramW6432
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

  const sourceDirectory = dirname(source)
  const codeModeHost = join(sourceDirectory, WINDOWS_CODEX_RUNTIME_COMPANIONS[0])
  if (!(await executableFileExists(codeModeHost, 'win32'))) {
    throw new Error(
      `The packaged Codex runtime is missing ${WINDOWS_CODEX_RUNTIME_COMPANIONS[0]}.`
    )
  }

  await Promise.all(WINDOWS_CODEX_RUNTIME_COMPANIONS.map(async (name) => {
    const companionSource = join(sourceDirectory, name)
    if (await executableFileExists(companionSource, 'win32')) {
      await materializePackagedWindowsRuntimeFile(companionSource, join(runtimeDir, name))
    }
  }))
  await materializePackagedWindowsRuntimeFile(source, target)
  return target
}

async function materializePackagedWindowsRuntimeFile(
  source: string,
  target: string
): Promise<void> {
  try {
    const [sourceInfo, targetInfo] = await Promise.all([stat(source), stat(target)])
    if (sourceInfo.size === targetInfo.size && targetInfo.mtimeMs >= sourceInfo.mtimeMs) return
  } catch {
    // Missing or stale target: refresh it below.
  }

  const temporary = `${target}-${process.pid}-${Date.now()}.tmp`
  try {
    await copyFile(source, temporary)
    await rm(target, { force: true })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

function prependCommandDirectoryToPath(env: NodeJS.ProcessEnv, command: string): NodeJS.ProcessEnv {
  if (!isAbsolute(command)) return env
  const directory = dirname(command)
  const pathKey = env.PATH !== undefined ? 'PATH' : env.Path !== undefined ? 'Path' : 'PATH'
  const pathEntries = (env[pathKey] ?? '').split(delimiter).filter(Boolean)
  if (!pathEntries.includes(directory)) env[pathKey] = [directory, ...pathEntries].join(delimiter)
  return env
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

export function codexAppServerLaunchArgs(command: string, args: readonly string[]): string[] {
  const launchArgs = ['app-server', '--listen', 'stdio://', ...codexAppServerExtraArgs(args)]
  if (!/\.(?:cmd|bat)$/i.test(command)) return launchArgs
  return windowsCommandProcessorArgs(command, launchArgs)
}

function codexAppServerLaunchCommand(command: string): string {
  return /\.(?:cmd|bat)$/i.test(command) ? process.env.ComSpec || 'cmd.exe' : command
}

function windowsCommandProcessorArgs(command: string, args: readonly string[]): string[] {
  if (/[&|<>^%!"\r\n]/.test(command)) throw codexResolutionError('runtime_path_invalid')
  const safeArgs = args.map((arg) => {
    if (/[&|<>^%!"\r\n]/.test(arg)) throw codexResolutionError('runtime_start_failed')
    return `"${arg}"`
  })
  // `/s` changes cmd.exe's quote-stripping rules and breaks quoted .cmd shims.
  // Keep the normal `/c` parsing so npm-installed Codex launchers work on Windows.
  return ['/d', '/c', `""${command}" ${safeArgs.join(' ')}"`]
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
  standardCodexAuthPath?: string,
  preToolUseHook?: CodexPreToolUseHookDefinition
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
  const modelCatalogPath = modelAccess.mode === 'api'
    ? await prepareCodexModelCatalog(codexHome, modelAccess)
    : undefined
  await atomicWriteFile(
    join(codexHome, 'config.toml'),
    codexConfigToml(modelAccess, Boolean(preToolUseHook), modelCatalogPath)
  )
  if (preToolUseHook) {
    await atomicWriteFile(
      preToolUseHook.sourcePath,
      codexPreToolUseHooksJson(preToolUseHook)
    )
  } else {
    await rm(join(codexHome, 'hooks.json'), { force: true })
  }
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
  model: string
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
    apiKey: router.apiKey,
    model: router.model || DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
  }
}

async function prepareCodexModelCatalog(
  codexHome: string,
  access: CodexModelRouterConfig
): Promise<string> {
  try {
    const response = await fetch(`${access.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${access.apiKey}` },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error'
    })
    if (!response.ok) throw new Error(`Model Router catalog returned HTTP ${response.status}.`)
    const catalog: unknown = await response.json()
    const models = catalog !== null && typeof catalog === 'object' && 'models' in catalog
      ? catalog.models
      : undefined
    if (!Array.isArray(models) || models.length === 0 ||
      !models.every((model) => model !== null && typeof model === 'object' &&
        typeof model.slug === 'string' && model.slug.trim()) ||
      !models.some((model) => model.slug === access.model)) {
      throw new Error('Model Router catalog does not declare the configured model.')
    }
    // This is Codex's supported startup catalog, not its private models cache.
    // Preserve the publisher's metadata, including null defaults and empty levels.
    const path = resolve(codexHome, 'model-catalog.json')
    await atomicWriteFile(path, JSON.stringify({ models }))
    return path
  } catch (cause) {
    const error = new Error('Codex model catalog is unavailable. Check the Model Router and reconnect.', { cause })
    error.name = 'runtime_model_catalog_unavailable'
    throw error
  }
}

function codexConfigToml(
  modelAccess: CodexModelAccessConfig,
  hooksEnabled: boolean,
  modelCatalogPath?: string
): string {
  const hookConfig = hooksEnabled
    ? ['[features]', 'hooks = true', '']
    : []
  if (modelAccess.mode === 'coding-plan') {
    return [
      'hide_agent_reasoning = false',
      'show_raw_agent_reasoning = true',
      'model_reasoning_summary = "detailed"',
      'model_supports_reasoning_summaries = true',
      '',
      createCodexPlanRuntimeConfig(modelAccess.baseUrl),
      ...hookConfig
    ].join('\n')
  }
  if (!modelCatalogPath) throw new Error('Codex API mode requires a startup model catalog.')
  return [
    `model = "${tomlString(modelAccess.model)}"`,
    `model_provider = "${tomlString(DEFAULT_MODEL_ROUTER_PROVIDER_ID)}"`,
    `model_catalog_json = "${tomlString(modelCatalogPath)}"`,
    'hide_agent_reasoning = false',
    'show_raw_agent_reasoning = true',
    'model_reasoning_summary = "detailed"',
    '',
    `[model_providers.${DEFAULT_MODEL_ROUTER_PROVIDER_ID}]`,
    'name = "SciForge Model Router"',
    `base_url = "${tomlString(modelAccess.baseUrl)}"`,
    `env_key = "${RUNTIME_API_KEY_ENV}"`,
    'wire_api = "responses"',
    '',
    ...hookConfig
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

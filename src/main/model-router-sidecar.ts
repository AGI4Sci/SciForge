import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  getModelAccessSettings,
  getModelRouterSettings,
  isModelRouterTextReasonerConfigured,
  type AppSettingsV1,
  type ModelRouterMemberSettingsV1
} from '../shared/app-settings'
import {
  DIRECT_PROVIDER_WORKER_ENV_PREFIXES,
  MODEL_ROUTER_PRIVATE_ENV_PREFIXES,
  SCI_MODALITY_SERVICE_ENV_PREFIXES,
  SCI_MODALITY_WORKER_PRIVATE_ENV_PREFIXES,
  STANDALONE_MODEL_ROUTER_ENV_PREFIXES,
  UPSTREAM_PROVIDER_CONFIG_ENV_NAMES,
  UPSTREAM_PROVIDER_SECRET_ENV_NAMES,
  isPrefixedEnv,
  isUpstreamProviderConfigEnv
} from './upstream-provider-env'
import { resolveModelAccessSidecarProcessLaunch } from './model-access-sidecar-launch'

const ROUTER_RUNTIME_KEY_ENV = 'SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY'
const TEXT_REASONER_KEY_ENV = 'SCIFORGE_MODEL_ROUTER_TEXT_API_KEY'
const VISION_TRANSLATOR_KEY_ENV = 'SCIFORGE_MODEL_ROUTER_VISION_API_KEY'
const IMAGE_GENERATOR_KEY_ENV = 'SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY'
const SCIENTIFIC_TRANSLATOR_TOKEN_ENV = 'SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN'
const MODEL_ROUTER_INSTANCE_ID_ENV = 'SCIFORGE_MODEL_ROUTER_INSTANCE_ID'
const MODEL_ROUTER_USER_DATA_DIR_ENV = 'SCIFORGE_MODEL_ROUTER_USER_DATA_DIR'
const BLOCKED_INHERITED_WORKER_ENV_PREFIXES = [
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

let modelRouterChild: ChildProcess | null = null
let modelRouterLaunchSignature: string | null = null
let modelRouterStatePath: string | null = null

type ModelRouterMemberConfig = {
  baseUrl: string
  apiKeyEnv: string
  model: string
}

type ModelRouterScientificTranslatorConfig = {
  baseUrl: string
  tokenEnv: string
  model: string
}

type ModelRouterSidecarConfig = {
  defaultProfile: string
  publicModelAlias: string
  profiles: Record<string, {
    textReasoner: ModelRouterMemberConfig
    imageGenerator?: ModelRouterMemberConfig
    translators: {
      vision?: ModelRouterMemberConfig
      scientific?: ModelRouterScientificTranslatorConfig
    }
  }>
}

export type ModelRouterSidecarLaunch = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
  configPath: string
  config?: ModelRouterSidecarConfig
}

export type ModelRouterSidecarLaunchResult =
  | { ok: true; launch: ModelRouterSidecarLaunch }
  | { ok: false; reason: string }

export function buildModelRouterSidecarLaunch(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    appRoot?: string
    resourcesPath?: string
    execPath?: string
    isPackaged?: boolean
    env?: NodeJS.ProcessEnv
    npmCommand?: string
  }
): ModelRouterSidecarLaunchResult {
  const modelAccess = getModelAccessSettings(settings)
  if (!modelAccess) {
    return { ok: false, reason: 'Model access mode must be configured before starting Model Router.' }
  }
  if (modelAccess.mode !== 'api') {
    return { ok: false, reason: 'Model Router is unavailable while coding-plan access is selected.' }
  }
  const router = getModelRouterSettings(settings)
  if (!router.enabled) return { ok: false, reason: 'Model Router is disabled.' }
  if (!router.autoStart) return { ok: false, reason: 'Model Router auto-start is disabled.' }
  if (!router.baseUrl.trim()) return { ok: false, reason: 'Model Router base URL is required.' }
  if (!router.runtimeApiKey.trim()) return { ok: false, reason: 'Model Router runtime API key is required.' }
  if (!router.publicModelAlias.trim()) return { ok: false, reason: 'Model Router public model alias is required.' }

  const port = localPortFromRouterBaseUrl(router.baseUrl)
  if (!port) return { ok: false, reason: 'Model Router base URL must be a local http://127.0.0.1 or localhost URL with a port.' }

  const configPath = modelRouterConfigPath(options.userDataDir)
  const baseEnv = options.env ?? process.env
  const textReasoner = router.profiles.default.textReasoner
  if (!isModelRouterTextReasonerConfigured(router)) {
    return { ok: false, reason: 'Model Router text reasoner Base URL, API key, and model name are required.' }
  }
  const imageGenerator = router.profiles.default.imageGenerator
  const vision = router.profiles.default.translators.vision
  const scientific = router.profiles.default.translators.scientific
  const env: NodeJS.ProcessEnv = modelRouterSidecarEnv(baseEnv)
  env[MODEL_ROUTER_USER_DATA_DIR_ENV] = options.userDataDir
  env[ROUTER_RUNTIME_KEY_ENV] = router.runtimeApiKey
  env[TEXT_REASONER_KEY_ENV] = textReasoner.apiKey.trim()
  if (isModelRouterMemberConfigured(vision)) {
    env[VISION_TRANSLATOR_KEY_ENV] = vision.apiKey.trim()
  }
  if (isModelRouterMemberConfigured(imageGenerator)) {
    env[IMAGE_GENERATOR_KEY_ENV] = imageGenerator.apiKey.trim()
  }
  if (isModelRouterMemberConfigured(scientific)) {
    env[SCIENTIFIC_TRANSLATOR_TOKEN_ENV] = scientific.apiKey.trim()
  }

  const processLaunch = resolveModelAccessSidecarProcessLaunch('model-router', [
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--config',
    configPath,
    '--workspace-root',
    settings.workspaceRoot || join(options.userDataDir, 'model-router'),
    '--quiet'
  ], {
    appRoot: options.appRoot,
    resourcesPath: options.resourcesPath,
    execPath: options.execPath,
    isPackaged: options.isPackaged,
    npmCommand: options.npmCommand,
    env
  })
  return {
    ok: true,
    launch: {
      ...processLaunch,
      configPath,
      config: defaultModelRouterSidecarConfig(settings)
    }
  }
}

export function modelRouterConfigPath(userDataDir: string): string {
  return join(userDataDir, 'model-router', 'config.json')
}

function modelRouterSidecarEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  for (const name of UPSTREAM_PROVIDER_SECRET_ENV_NAMES) {
    delete env[name]
  }
  for (const name of UPSTREAM_PROVIDER_CONFIG_ENV_NAMES) {
    delete env[name]
  }
  for (const name of LEGACY_MODEL_ROUTER_ENV_NAMES) {
    delete env[name]
  }
  for (const key of Object.keys(env)) {
    if (
      isUpstreamProviderConfigEnv(key) ||
      isBlockedInheritedWorkerEnv(key) ||
      isBlockedStandaloneModelRouterEnv(key)
    ) {
      delete env[key]
    }
  }
  return env
}

function isBlockedInheritedWorkerEnv(key: string): boolean {
  return isPrefixedEnv(key, BLOCKED_INHERITED_WORKER_ENV_PREFIXES)
}

function isBlockedStandaloneModelRouterEnv(key: string): boolean {
  return isPrefixedEnv(key, STANDALONE_MODEL_ROUTER_ENV_PREFIXES)
}

export async function syncModelRouterConfigFileFromSettings(
  settings: AppSettingsV1,
  options: { userDataDir: string }
): Promise<{ path: string }> {
  const path = modelRouterConfigPath(options.userDataDir)
  await mkdir(join(options.userDataDir, 'model-router'), { recursive: true })
  const config = defaultModelRouterSidecarConfig(settings)
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8' })
  return { path }
}

export async function ensureModelRouterSidecar(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    appRoot?: string
    resourcesPath?: string
    execPath?: string
    isPackaged?: boolean
    env?: NodeJS.ProcessEnv
    spawnImpl?: typeof spawn
    log?: (message: string) => void
  }
): Promise<void> {
  const instanceId = randomUUID()
  const launchEnv = {
    ...(options.env ?? process.env),
    [MODEL_ROUTER_INSTANCE_ID_ENV]: instanceId
  }
  const launch = buildModelRouterSidecarLaunch(settings, {
    userDataDir: options.userDataDir,
    appRoot: options.appRoot,
    resourcesPath: options.resourcesPath,
    execPath: options.execPath,
    isPackaged: options.isPackaged,
    env: launchEnv
  })
  if (!launch.ok) {
    options.log?.(launch.reason)
    if (isModelRouterChildRunning()) {
      await stopModelRouterSidecar()
    }
    return
  }

  const signature = modelRouterManagedLaunchSignature(launch.launch)
  if (isModelRouterChildRunning()) {
    if (modelRouterLaunchSignature === signature) return
    options.log?.('Model Router sidecar launch settings changed; restarting sidecar.')
    await stopModelRouterSidecar()
  }

  await stopRecordedModelRouterSidecar(settings, options.userDataDir, options.log)

  const postStopLaunch = buildModelRouterSidecarLaunch(settings, {
    userDataDir: options.userDataDir,
    appRoot: options.appRoot,
    resourcesPath: options.resourcesPath,
    execPath: options.execPath,
    isPackaged: options.isPackaged,
    env: launchEnv
  })
  if (!postStopLaunch.ok) {
    options.log?.(postStopLaunch.reason)
    return
  }
  await syncModelRouterConfigFileFromSettings(settings, { userDataDir: options.userDataDir })
  const spawnImpl = options.spawnImpl ?? spawn
  options.log?.(`Starting Model Router sidecar from ${postStopLaunch.launch.cwd}.`)
  // On Windows the command is `npm.cmd`; Node >= 18.20 refuses to spawn a `.cmd`
  // without a shell (throws EINVAL). Use a shell on win32 and quote any args that
  // contain spaces/special chars so cmd.exe parses them correctly.
  const useShell = postStopLaunch.launch.command.toLowerCase().endsWith('.cmd')
  const spawnArgs = useShell
    ? postStopLaunch.launch.args.map(quoteWindowsShellArg)
    : postStopLaunch.launch.args
  modelRouterChild = spawnImpl(postStopLaunch.launch.command, spawnArgs, {
    cwd: postStopLaunch.launch.cwd,
    env: postStopLaunch.launch.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    shell: useShell
  })
  modelRouterLaunchSignature = modelRouterManagedLaunchSignature(postStopLaunch.launch)
  modelRouterStatePath = modelRouterSidecarStatePath(options.userDataDir)
  const child = modelRouterChild
  if (child.pid) {
    await writeFile(modelRouterStatePath, `${JSON.stringify({
      pid: child.pid,
      instanceId,
      signature: modelRouterLaunchSignature
    }, null, 2)}\n`, 'utf8')
  }
  attachModelRouterChildLogging(child, options.log)
  child.once('error', (error) => {
    options.log?.(`Model Router sidecar failed to start: ${error.message}`)
  })
  child.once('exit', (code, signal) => {
    if (modelRouterChild !== child) return
    modelRouterChild = null
    modelRouterLaunchSignature = null
    if (code !== 0 || signal) {
      options.log?.(`Model Router sidecar exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`)
    }
  })
}

function defaultModelRouterSidecarConfig(
  settings: AppSettingsV1
): ModelRouterSidecarConfig & { runtimeApiKeyEnv: string } {
  const router = getModelRouterSettings(settings)
  const textReasoner = router.profiles.default.textReasoner
  const vision = memberConfig(router.profiles.default.translators.vision, VISION_TRANSLATOR_KEY_ENV)
  const imageGenerator = memberConfig(router.profiles.default.imageGenerator, IMAGE_GENERATOR_KEY_ENV)
  const scientific = scientificTranslatorConfig(router.profiles.default.translators.scientific)
  return {
    defaultProfile: 'default',
    publicModelAlias: router.publicModelAlias,
    runtimeApiKeyEnv: ROUTER_RUNTIME_KEY_ENV,
    profiles: {
      default: {
        textReasoner: {
          baseUrl: textReasoner.baseUrl.trim(),
          apiKeyEnv: TEXT_REASONER_KEY_ENV,
          model: textReasoner.model.trim()
        },
        ...(imageGenerator ? { imageGenerator } : {}),
        translators: {
          ...(vision ? { vision } : {}),
          ...(scientific ? { scientific } : {})
        }
      }
    }
  }
}

export async function stopModelRouterSidecar(): Promise<void> {
  const child = modelRouterChild
  if (!child) return
  modelRouterChild = null
  modelRouterLaunchSignature = null
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
  if (modelRouterStatePath) {
    await rm(modelRouterStatePath, { force: true })
    modelRouterStatePath = null
  }
}

function modelRouterSidecarStatePath(userDataDir: string): string {
  return join(userDataDir, 'model-router', 'sidecar-state.json')
}

async function stopRecordedModelRouterSidecar(
  settings: AppSettingsV1,
  userDataDir: string,
  log?: (message: string) => void
): Promise<void> {
  const statePath = modelRouterSidecarStatePath(userDataDir)
  let state: { pid?: unknown; instanceId?: unknown }
  try {
    state = JSON.parse(await readFile(statePath, 'utf8')) as { pid?: unknown; instanceId?: unknown }
  } catch {
    return
  }
  const pid = typeof state.pid === 'number' && Number.isInteger(state.pid) && state.pid > 1 ? state.pid : 0
  const instanceId = typeof state.instanceId === 'string' ? state.instanceId.trim() : ''
  if (!pid || !instanceId) {
    await rm(statePath, { force: true })
    return
  }
  const router = getModelRouterSettings(settings)
  const healthUrl = router.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '') + '/health'
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_500) })
    const health = await response.json() as { instanceId?: unknown }
    if (health.instanceId !== instanceId) {
      await rm(statePath, { force: true })
      return
    }
    process.kill(pid, 'SIGTERM')
    log?.('Stopped a stale app-managed Model Router sidecar before launching the current runtime.')
  } catch {
    // A missing process or unreachable endpoint means the recorded sidecar is already gone.
  }
  await rm(statePath, { force: true })
}

function isModelRouterChildRunning(): boolean {
  return Boolean(modelRouterChild && modelRouterChild.exitCode === null && modelRouterChild.signalCode === null)
}

function modelRouterManagedLaunchSignature(launch: ModelRouterSidecarLaunch): string {
  return JSON.stringify({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    config: launch.config,
    userDataDir: launch.env[MODEL_ROUTER_USER_DATA_DIR_ENV] ?? '',
    runtimeApiKey: launch.env[ROUTER_RUNTIME_KEY_ENV] ?? '',
    textReasonerApiKey: launch.env[TEXT_REASONER_KEY_ENV] ?? '',
    visionTranslatorApiKey: launch.env[VISION_TRANSLATOR_KEY_ENV] ?? '',
    imageGeneratorApiKey: launch.env[IMAGE_GENERATOR_KEY_ENV] ?? '',
    scientificTranslatorToken: launch.env[SCIENTIFIC_TRANSLATOR_TOKEN_ENV] ?? ''
  })
}

function memberConfig(
  member: ModelRouterMemberSettingsV1,
  apiKeyEnv: string
): ModelRouterMemberConfig | null {
  if (!isModelRouterMemberConfigured(member)) return null
  return {
    baseUrl: member.baseUrl,
    apiKeyEnv,
    model: member.model
  }
}

function scientificTranslatorConfig(
  translator: ModelRouterMemberSettingsV1
): ModelRouterScientificTranslatorConfig | null {
  const baseUrl = translator.baseUrl.trim()
  const model = translator.model.trim()
  if (!isModelRouterMemberConfigured(translator)) return null
  return {
    baseUrl,
    tokenEnv: SCIENTIFIC_TRANSLATOR_TOKEN_ENV,
    model
  }
}

function isModelRouterMemberConfigured(member: ModelRouterMemberSettingsV1): boolean {
  return Boolean(member.baseUrl.trim() && member.apiKey.trim() && member.model.trim())
}

// When spawning through a Windows shell (cmd.exe), wrap args containing spaces or
// shell metacharacters in double quotes so they survive command-line parsing.
function quoteWindowsShellArg(arg: string): string {
  if (arg.length > 0 && !/[\s"&|<>^()]/.test(arg)) return arg
  return `"${arg.replace(/"/g, '\\"')}"`
}

function localPortFromRouterBaseUrl(baseUrl: string): number | null {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'http:' || (host !== '127.0.0.1' && host !== 'localhost')) return null
    const port = Number(url.port)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

function attachModelRouterChildLogging(
  child: ChildProcess,
  log: ((message: string) => void) | undefined
): void {
  if (!log) return
  child.stdout?.on('data', (chunk) => logModelRouterChildChunk('stdout', chunk, log))
  child.stderr?.on('data', (chunk) => logModelRouterChildChunk('stderr', chunk, log))
}

function logModelRouterChildChunk(
  stream: 'stdout' | 'stderr',
  chunk: unknown,
  log: (message: string) => void
): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return
  log(`Model Router sidecar ${stream}: ${normalized.slice(0, 1_000)}`)
}

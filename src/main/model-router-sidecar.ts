import { spawn, type ChildProcess } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_LOCAL_RUNTIME_MODEL,
  getImageGenerationSettings,
  getLocalRuntimeSettings,
  getModelProviderProfile,
  getModelRouterSettings,
  type AppSettingsV1,
  type ModelRouterMemberProviderSettingsV1
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
import { isModelRouterServiceHealthy } from './model-router-health'

const ROUTER_RUNTIME_KEY_ENV = 'SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY'
const TEXT_REASONER_KEY_ENV = 'SCIFORGE_MODEL_ROUTER_TEXT_API_KEY'
const VISION_TRANSLATOR_KEY_ENV = 'SCIFORGE_MODEL_ROUTER_VISION_API_KEY'
const IMAGE_GENERATOR_KEY_ENV = 'SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY'
const SCIENTIFIC_TRANSLATOR_TOKEN_ENV = 'SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN'
const BLOCKED_INHERITED_WORKER_ENV_PREFIXES = [
  ...DIRECT_PROVIDER_WORKER_ENV_PREFIXES,
  ...MODEL_ROUTER_PRIVATE_ENV_PREFIXES,
  ...SCI_MODALITY_SERVICE_ENV_PREFIXES,
  ...SCI_MODALITY_WORKER_PRIVATE_ENV_PREFIXES
] as const
const LEGACY_SCI_MODALITY_SERVICE_URL_ENV = 'SCIFORGE_SCIMODALITY_SERVICE_URL'
const LEGACY_SCI_MODALITY_SERVICE_TOKEN_ENV = 'SCIFORGE_SCIMODALITY_SERVICE_TOKEN'
const LEGACY_SCI_MODALITY_SERVICE_TIMEOUT_MS_ENV = 'SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS'
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

type ModelRouterProviderConfig = {
  provider: string
  baseUrl: string
  apiKeyEnv: string
  model: string
  maxSupplementRounds?: number
}

type ModelRouterScientificTranslatorConfig = {
  baseUrl: string
  tokenEnv: string
  timeoutMs?: number
}

type ModelRouterSidecarConfig = {
  defaultProfile: string
  publicModelAlias: string
  profiles: Record<string, {
    traceRoot: string
    textReasoner: ModelRouterProviderConfig
    imageGenerator?: ModelRouterProviderConfig
    translators: {
      vision?: ModelRouterProviderConfig
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
    env?: NodeJS.ProcessEnv
    npmCommand?: string
  }
): ModelRouterSidecarLaunchResult {
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
  const runtime = getLocalRuntimeSettings(settings)
  const provider = getModelProviderProfile(settings, runtime.providerId)
  const textReasoner = router.profiles.default.textReasoner
  const vision = router.profiles.default.translators.vision
  const env: NodeJS.ProcessEnv = modelRouterSidecarEnv(baseEnv)
  env[ROUTER_RUNTIME_KEY_ENV] = router.runtimeApiKey
  env[TEXT_REASONER_KEY_ENV] = textReasoner.apiKey.trim() || provider.apiKey.trim()
  if (vision.apiKey.trim()) {
    env[VISION_TRANSLATOR_KEY_ENV] = vision.apiKey.trim()
  }
  const imageGeneration = getImageGenerationSettings(settings)
  if (imageGeneration.enabled && imageGeneration.apiKey.trim()) {
    env[IMAGE_GENERATOR_KEY_ENV] = imageGeneration.apiKey.trim()
  }
  const scientificTranslatorToken = baseEnv[LEGACY_SCI_MODALITY_SERVICE_TOKEN_ENV]?.trim()
  if (scientificTranslatorToken) {
    env[SCIENTIFIC_TRANSLATOR_TOKEN_ENV] = scientificTranslatorToken
  }

  const npmCommand = options.npmCommand ?? (process.platform === 'win32' ? 'npm.cmd' : 'npm')
  return {
    ok: true,
    launch: {
      command: npmCommand,
      cwd: options.appRoot ?? process.cwd(),
      args: [
        '--workspace',
        '@sciforge/model-router',
        'run',
        'start',
        '--',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--config',
        configPath,
        '--workspace-root',
        settings.workspaceRoot || join(options.userDataDir, 'model-router'),
        '--quiet'
      ],
      env,
      configPath,
      config: defaultModelRouterSidecarConfig(settings, options.userDataDir, baseEnv)
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

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonRecordOrCreate(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key]
  if (isJsonRecord(value)) return value
  const next: Record<string, unknown> = {}
  parent[key] = next
  return next
}

export async function ensureModelRouterConfigFile(
  settings: AppSettingsV1,
  options: { userDataDir: string; env?: NodeJS.ProcessEnv }
): Promise<{ path: string; created: boolean }> {
  const path = modelRouterConfigPath(options.userDataDir)
  await mkdir(join(options.userDataDir, 'model-router'), { recursive: true })
  let created = false
  try {
    await access(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    created = true
  }
  if (created) {
    await writeManagedModelRouterConfigFile(settings, { userDataDir: options.userDataDir, env: options.env })
  }
  return { path, created }
}

export async function updateModelRouterConfigDefaultTextReasoner(
  settings: AppSettingsV1,
  options: { userDataDir: string; env?: NodeJS.ProcessEnv }
): Promise<{ path: string; updated: boolean }> {
  const path = modelRouterConfigPath(options.userDataDir)
  await mkdir(join(options.userDataDir, 'model-router'), { recursive: true })
  let raw = ''
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeManagedModelRouterConfigFile(settings, { userDataDir: options.userDataDir, env: options.env })
    return { path, updated: true }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { path, updated: false }
  }
  if (!isJsonRecord(parsed)) return { path, updated: false }

  const defaultTextReasoner = defaultModelRouterSidecarConfig(
    settings,
    options.userDataDir,
    options.env
  ).profiles.default.textReasoner
  const profiles = jsonRecordOrCreate(parsed, 'profiles')
  const defaultProfile = jsonRecordOrCreate(profiles, 'default')
  const textReasoner = jsonRecordOrCreate(defaultProfile, 'textReasoner')
  textReasoner.baseUrl = defaultTextReasoner.baseUrl
  textReasoner.model = defaultTextReasoner.model
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8' })
  return { path, updated: true }
}

export async function ensureModelRouterSidecar(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    appRoot?: string
    env?: NodeJS.ProcessEnv
    fetchImpl?: typeof fetch
    spawnImpl?: typeof spawn
    log?: (message: string) => void
  }
): Promise<void> {
  const launch = buildModelRouterSidecarLaunch(settings, {
    userDataDir: options.userDataDir,
    appRoot: options.appRoot,
    env: options.env
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

  if (await isModelRouterServiceHealthy(settings, { fetchImpl: options.fetchImpl })) {
    options.log?.(`Model Router is already healthy at ${getModelRouterSettings(settings).baseUrl}; reusing existing service.`)
    return
  }

  const postStopLaunch = buildModelRouterSidecarLaunch(settings, {
    userDataDir: options.userDataDir,
    appRoot: options.appRoot,
    env: options.env
  })
  if (!postStopLaunch.ok) {
    options.log?.(postStopLaunch.reason)
    return
  }
  await ensureModelRouterConfigFile(settings, { userDataDir: options.userDataDir, env: options.env })
  const spawnImpl = options.spawnImpl ?? spawn
  options.log?.(`Starting Model Router sidecar from ${postStopLaunch.launch.cwd}.`)
  // On Windows the command is `npm.cmd`; Node >= 18.20 refuses to spawn a `.cmd`
  // without a shell (throws EINVAL). Use a shell on win32 and quote any args that
  // contain spaces/special chars so cmd.exe parses them correctly.
  const useShell = process.platform === 'win32'
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
  const child = modelRouterChild
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
  settings: AppSettingsV1,
  userDataDir: string,
  env: NodeJS.ProcessEnv = process.env
): ModelRouterSidecarConfig & { runtimeApiKeyEnv: string } {
  const router = getModelRouterSettings(settings)
  const runtime = getLocalRuntimeSettings(settings)
  const provider = getModelProviderProfile(settings, runtime.providerId)
  const textReasoner = router.profiles.default.textReasoner
  const vision = providerConfig(router.profiles.default.translators.vision, VISION_TRANSLATOR_KEY_ENV)
  const imageGenerator = imageGeneratorConfig(settings)
  const scientific = scientificTranslatorConfigFromEnv(env)
  const configRoot = join(userDataDir, 'model-router')

  return {
    defaultProfile: 'default',
    publicModelAlias: router.publicModelAlias,
    runtimeApiKeyEnv: ROUTER_RUNTIME_KEY_ENV,
    profiles: {
      default: {
        traceRoot: join(configRoot, 'traces'),
        textReasoner: {
          provider: textReasoner.provider.trim() || provider.id || 'openai-compatible',
          baseUrl: textReasoner.baseUrl.trim() || provider.baseUrl.trim(),
          apiKeyEnv: TEXT_REASONER_KEY_ENV,
          model: textReasoner.model.trim() || runtime.model.trim() || DEFAULT_LOCAL_RUNTIME_MODEL
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
    runtimeApiKey: launch.env[ROUTER_RUNTIME_KEY_ENV] ?? '',
    textReasonerApiKey: launch.env[TEXT_REASONER_KEY_ENV] ?? '',
    visionTranslatorApiKey: launch.env[VISION_TRANSLATOR_KEY_ENV] ?? '',
    imageGeneratorApiKey: launch.env[IMAGE_GENERATOR_KEY_ENV] ?? '',
    scientificTranslatorToken: launch.env[SCIENTIFIC_TRANSLATOR_TOKEN_ENV] ?? ''
  })
}

async function writeManagedModelRouterConfigFile(
  settings: AppSettingsV1,
  options: { userDataDir: string; env?: NodeJS.ProcessEnv }
): Promise<{ path: string }> {
  const path = modelRouterConfigPath(options.userDataDir)
  await mkdir(join(options.userDataDir, 'model-router'), { recursive: true })
  const config = defaultModelRouterSidecarConfig(settings, options.userDataDir, options.env)
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8' })
  return { path }
}

function providerConfig(
  provider: ModelRouterMemberProviderSettingsV1,
  apiKeyEnv: string
): ModelRouterProviderConfig | null {
  if (!provider.provider.trim() || !provider.baseUrl.trim() || !provider.model.trim()) return null
  return {
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    apiKeyEnv,
    model: provider.model,
    ...(provider.maxSupplementRounds === undefined ? {} : { maxSupplementRounds: provider.maxSupplementRounds })
  }
}

function imageGeneratorConfig(settings: AppSettingsV1): ModelRouterProviderConfig | null {
  const imageGeneration = getImageGenerationSettings(settings)
  if (
    !imageGeneration.enabled ||
    !imageGeneration.provider.trim() ||
    !imageGeneration.baseUrl.trim() ||
    !imageGeneration.model.trim()
  ) {
    return null
  }
  return {
    provider: imageGeneration.provider,
    baseUrl: imageGeneration.baseUrl,
    apiKeyEnv: IMAGE_GENERATOR_KEY_ENV,
    model: imageGeneration.model
  }
}

function scientificTranslatorConfigFromEnv(env: NodeJS.ProcessEnv): ModelRouterScientificTranslatorConfig | null {
  const baseUrl = env[LEGACY_SCI_MODALITY_SERVICE_URL_ENV]?.trim() ?? ''
  if (!baseUrl) return null
  const timeoutMs = positiveNumberEnv(env[LEGACY_SCI_MODALITY_SERVICE_TIMEOUT_MS_ENV])
  return {
    baseUrl,
    tokenEnv: SCIENTIFIC_TRANSLATOR_TOKEN_ENV,
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  }
}

function positiveNumberEnv(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
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

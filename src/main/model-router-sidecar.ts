import { spawn, type ChildProcess } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  mergeModelRouterSettings,
  getModelRouterSettings,
  isModelRouterTextReasonerConfigured,
  type AppSettingsV1,
  type ModelRouterMemberProviderSettingsPatchV1,
  type ModelRouterSettingsPatchV1,
  type ModelRouterMemberProviderSettingsV1,
  type ModelRouterScientificTranslatorSettingsPatchV1,
  type ModelRouterScientificTranslatorSettingsV1
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
  model: string
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
  const textReasoner = router.profiles.default.textReasoner
  if (!isModelRouterTextReasonerConfigured(router)) {
    return { ok: false, reason: 'Model Router text reasoner Base URL, API key, and model name are required.' }
  }
  const imageGenerator = router.profiles.default.imageGenerator
  const vision = router.profiles.default.translators.vision
  const scientific = router.profiles.default.translators.scientific
  const env: NodeJS.ProcessEnv = modelRouterSidecarEnv(baseEnv)
  env[ROUTER_RUNTIME_KEY_ENV] = router.runtimeApiKey
  env[TEXT_REASONER_KEY_ENV] = textReasoner.apiKey.trim()
  if (vision.apiKey.trim()) {
    env[VISION_TRANSLATOR_KEY_ENV] = vision.apiKey.trim()
  }
  if (imageGenerator.apiKey.trim()) {
    env[IMAGE_GENERATOR_KEY_ENV] = imageGenerator.apiKey.trim()
  }
  if (scientific.apiKey.trim()) {
    env[SCIENTIFIC_TRANSLATOR_TOKEN_ENV] = scientific.apiKey.trim()
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
  await syncModelRouterConfigFileFromSettings(settings, { userDataDir: options.userDataDir, env: options.env })
  return { path, created }
}

export async function syncModelRouterSettingsFromConfigFile(
  settings: AppSettingsV1,
  options: { userDataDir: string }
): Promise<AppSettingsV1> {
  const patch = await modelRouterSettingsPatchFromConfigFile(options.userDataDir)
  if (!patch) return settings
  return {
    ...settings,
    modelRouter: mergeModelRouterSettings(settings.modelRouter, patch)
  }
}

export async function syncModelRouterConfigFileFromSettings(
  settings: AppSettingsV1,
  options: { userDataDir: string; env?: NodeJS.ProcessEnv }
): Promise<{ path: string }> {
  const path = modelRouterConfigPath(options.userDataDir)
  await mkdir(join(options.userDataDir, 'model-router'), { recursive: true })
  const config = defaultModelRouterSidecarConfig(settings, options.userDataDir, options.env)
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8' })
  return { path }
}

export async function ensureModelRouterSidecar(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    appRoot?: string
    env?: NodeJS.ProcessEnv
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

  const postStopLaunch = buildModelRouterSidecarLaunch(settings, {
    userDataDir: options.userDataDir,
    appRoot: options.appRoot,
    env: options.env
  })
  if (!postStopLaunch.ok) {
    options.log?.(postStopLaunch.reason)
    return
  }
  await syncModelRouterConfigFileFromSettings(settings, { userDataDir: options.userDataDir, env: options.env })
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
  const textReasoner = router.profiles.default.textReasoner
  const vision = providerConfig(router.profiles.default.translators.vision, VISION_TRANSLATOR_KEY_ENV)
  const imageGenerator = providerConfig(router.profiles.default.imageGenerator, IMAGE_GENERATOR_KEY_ENV)
  const scientific = scientificTranslatorConfig(router.profiles.default.translators.scientific)
  const configRoot = join(userDataDir, 'model-router')

  return {
    defaultProfile: 'default',
    publicModelAlias: router.publicModelAlias,
    runtimeApiKeyEnv: ROUTER_RUNTIME_KEY_ENV,
    profiles: {
      default: {
        traceRoot: join(configRoot, 'traces'),
        textReasoner: {
          provider: textReasoner.provider.trim() || 'openai-compatible',
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

function scientificTranslatorConfig(
  translator: ModelRouterScientificTranslatorSettingsV1
): ModelRouterScientificTranslatorConfig | null {
  const baseUrl = translator.baseUrl.trim()
  const model = translator.model.trim()
  if (!baseUrl || !model) return null
  return {
    baseUrl,
    tokenEnv: SCIENTIFIC_TRANSLATOR_TOKEN_ENV,
    model,
    ...(translator.timeoutMs === undefined ? {} : { timeoutMs: translator.timeoutMs })
  }
}

async function modelRouterSettingsPatchFromConfigFile(
  userDataDir: string
): Promise<ModelRouterSettingsPatchV1 | null> {
  const path = modelRouterConfigPath(userDataDir)
  let raw = ''
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) return null
  const defaultProfileId = stringValue(parsed.defaultProfile) || 'default'
  const profiles = isRecord(parsed.profiles) ? parsed.profiles : null
  const profile = profiles && isRecord(profiles[defaultProfileId])
    ? profiles[defaultProfileId]
    : profiles && isRecord(profiles.default)
      ? profiles.default
      : null
  if (!profile) return null

  const textReasoner = memberProviderPatchFromConfig(profile.textReasoner)
  const imageGenerator = memberProviderPatchFromConfig(profile.imageGenerator)
  const translators = isRecord(profile.translators) ? profile.translators : {}
  const vision = memberProviderPatchFromConfig(translators.vision)
  const scientific = scientificTranslatorPatchFromConfig(translators.scientific)

  return {
    ...(stringValue(parsed.publicModelAlias) ? { publicModelAlias: stringValue(parsed.publicModelAlias) } : {}),
    profiles: {
      default: {
        ...(textReasoner ? { textReasoner } : {}),
        ...(imageGenerator ? { imageGenerator } : {}),
        translators: {
          ...(vision ? { vision } : {}),
          ...(scientific ? { scientific } : {})
        }
      }
    }
  }
}

function memberProviderPatchFromConfig(value: unknown): ModelRouterMemberProviderSettingsPatchV1 | null {
  if (!isRecord(value)) return null
  return {
    ...(stringValue(value.provider) ? { provider: stringValue(value.provider) } : {}),
    ...(stringValue(value.baseUrl) ? { baseUrl: stringValue(value.baseUrl) } : {}),
    ...(stringValue(value.model) ? { model: stringValue(value.model) } : {}),
    ...(numberValue(value.maxSupplementRounds) === undefined ? {} : { maxSupplementRounds: numberValue(value.maxSupplementRounds) })
  }
}

function scientificTranslatorPatchFromConfig(
  value: unknown
): ModelRouterScientificTranslatorSettingsPatchV1 | null {
  if (!isRecord(value)) return null
  return {
    ...(stringValue(value.baseUrl) ? { baseUrl: stringValue(value.baseUrl) } : {}),
    ...(stringValue(value.model) ? { model: stringValue(value.model) } : {}),
    ...(numberValue(value.timeoutMs) === undefined ? {} : { timeoutMs: numberValue(value.timeoutMs) })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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

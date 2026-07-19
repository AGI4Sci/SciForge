import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
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
import {
  stopModelAccessGatewaySidecar,
  synchronizeModelAccessGatewaySidecar,
  type ModelAccessGatewayLaunchSpec
} from './model-access-gateway-sidecar'

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
  const spec = buildModelRouterGatewayLaunchSpec(settings, options)
  if (!spec.ok) {
    options.log?.(spec.reason)
    await synchronizeModelAccessGatewaySidecar(null, options)
    return
  }
  await synchronizeModelAccessGatewaySidecar(spec.spec, options)
}

type ModelRouterGatewayLaunchSpecResult =
  | { ok: true; spec: ModelAccessGatewayLaunchSpec }
  | { ok: false; reason: string }

export function buildModelRouterGatewayLaunchSpec(
  settings: AppSettingsV1,
  options: Parameters<typeof buildModelRouterSidecarLaunch>[1]
): ModelRouterGatewayLaunchSpecResult {
  const instanceId = randomUUID()
  const launchEnv = {
    ...(options.env ?? process.env),
    [MODEL_ROUTER_INSTANCE_ID_ENV]: instanceId
  }
  const result = buildModelRouterSidecarLaunch(settings, { ...options, env: launchEnv })
  if (!result.ok) return result
  const router = getModelRouterSettings(settings)
  const healthUrl = router.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '') + '/health'
  const signature = modelRouterManagedLaunchSignature(result.launch)
  return {
    ok: true,
    spec: {
      mode: 'model-router',
      ...result.launch,
      signature,
      instanceId,
      healthUrl,
      startMessage: `Starting Model Router sidecar from ${result.launch.cwd}.`,
      logLabel: 'Model Router',
      prepare: () => syncModelRouterConfigFileFromSettings(settings, { userDataDir: options.userDataDir }).then(() => undefined)
    }
  }
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

export async function stopModelRouterSidecar(options: {
  userDataDir?: string
  fetchImpl?: typeof fetch
  killProcessImpl?: typeof process.kill
  log?: (message: string) => void
} = {}): Promise<void> {
  await stopModelAccessGatewaySidecar(options)
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

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import {
  getModelRouterSettings,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1
} from '../../../../src/shared/app-settings'
import {
  DEFAULT_EVIDENCE_DAG_SERVICE_URL,
  EVIDENCE_DAG_API_KEY_ENV,
  EVIDENCE_DAG_SERVICE_URL_ENV,
  evidenceDagApiKeyFromEnv,
  evidenceDagServiceUrlFromEnv,
  normalizeEvidenceDagServiceUrl
} from './contract'

const MODEL_ROUTER_BASE_URL_ENV = 'EDAG_MODEL_ROUTER_BASE_URL'
const MODEL_ROUTER_API_KEY_ENV = 'EDAG_MODEL_ROUTER_API_KEY'
const MODEL_ROUTER_MODEL_ENV = 'EDAG_MODEL_ROUTER_MODEL'
const MODEL_ROUTER_TIMEOUT_S_ENV = 'EDAG_MODEL_ROUTER_TIMEOUT_S'
const MODEL_ROUTER_MAX_ATTEMPTS_ENV = 'EDAG_MODEL_ROUTER_MAX_ATTEMPTS'
// Evidence extraction and verification can legitimately take longer than an
// interactive chat response. Keep this aligned with ModelRouterLLM's default
// and below the desktop queue's 10-minute request budget.
const DEFAULT_MODEL_ROUTER_TIMEOUT_S = '180'
const DEFAULT_MODEL_ROUTER_MAX_ATTEMPTS = '1'
const DEFAULT_READY_TIMEOUT_MS = 45_000
const EVIDENCE_DAG_RUNTIME_TOKEN_BYTES = 32

let evidenceDagChild: ChildProcess | null = null
let evidenceDagLaunchSignature: string | null = null
let evidenceDagReadyPromise: Promise<void> | null = null
let generatedEvidenceDagRuntimeToken: string | null = null

export type EvidenceDagLaunch = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
  baseUrl: string
  storageDir: string
  runtimeToken: string
  modelRouterBaseUrl: string
  modelRouterModel: string
}

export type EvidenceDagLaunchResult =
  | { ok: true; launch: EvidenceDagLaunch }
  | { ok: false; reason: string }

export function evidenceDagRuntimeToken(env: NodeJS.ProcessEnv = process.env): string {
  const configured = evidenceDagApiKeyFromEnv(env)
  if (configured) return configured
  generatedEvidenceDagRuntimeToken ??= randomBytes(EVIDENCE_DAG_RUNTIME_TOKEN_BYTES).toString('base64url')
  return generatedEvidenceDagRuntimeToken
}

export function evidenceDagBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return evidenceDagServiceUrlFromEnv(env) || DEFAULT_EVIDENCE_DAG_SERVICE_URL
}

export function evidenceDagStorageDir(userDataDir: string): string {
  return join(userDataDir, 'evidence-dag', 'threads')
}

export function buildEvidenceDagLaunch(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    appRoot?: string
    env?: NodeJS.ProcessEnv
    npmCommand?: string
  }
): EvidenceDagLaunchResult {
  const routerSettings = getModelRouterSettings(settings)
  if (!routerSettings.enabled) return { ok: false, reason: 'Evidence DAG requires Model Router to be enabled.' }

  let router: ReturnType<typeof resolveRuntimeModelRouterSettings>
  try {
    router = resolveRuntimeModelRouterSettings(settings)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  if (!router.baseUrl.trim() || !router.apiKey.trim() || !router.model.trim()) {
    return { ok: false, reason: 'Evidence DAG requires Model Router URL, runtime API key, and public model alias.' }
  }

  const baseEnv = options.env ?? process.env
  const launchEnv = withoutLegacyLlmEnv(baseEnv)
  const baseUrl = normalizeEvidenceDagServiceUrl(baseEnv[EVIDENCE_DAG_SERVICE_URL_ENV]) || DEFAULT_EVIDENCE_DAG_SERVICE_URL
  const port = localPortFromBaseUrl(baseUrl) ?? 3897
  const runtimeToken = evidenceDagApiKeyFromEnv(baseEnv) || evidenceDagRuntimeTokenFromModelRouter(router.apiKey)
  const npmCommand = options.npmCommand ?? (process.platform === 'win32' ? 'cmd.exe' : 'npm')
  const npmArgsPrefix = options.npmCommand ? [] : process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : []
  const storageDir = baseEnv.EDAG_STORAGE_DIR || evidenceDagStorageDir(options.userDataDir)

  return {
    ok: true,
    launch: {
      command: npmCommand,
      cwd: options.appRoot ?? process.cwd(),
      args: [
        ...npmArgsPrefix,
        '--workspace',
        '@sciforge/evidence-dag',
        'run',
        'start'
      ],
      env: {
        ...launchEnv,
        EDAG_HOST: '127.0.0.1',
        EDAG_PORT: String(port),
        EDAG_STORAGE_DIR: storageDir,
        [EVIDENCE_DAG_API_KEY_ENV]: runtimeToken,
        [EVIDENCE_DAG_SERVICE_URL_ENV]: baseUrl,
        [MODEL_ROUTER_BASE_URL_ENV]: router.baseUrl,
        [MODEL_ROUTER_API_KEY_ENV]: router.apiKey,
        [MODEL_ROUTER_MODEL_ENV]: router.model,
        [MODEL_ROUTER_TIMEOUT_S_ENV]: baseEnv[MODEL_ROUTER_TIMEOUT_S_ENV] ?? DEFAULT_MODEL_ROUTER_TIMEOUT_S,
        [MODEL_ROUTER_MAX_ATTEMPTS_ENV]: baseEnv[MODEL_ROUTER_MAX_ATTEMPTS_ENV] ?? DEFAULT_MODEL_ROUTER_MAX_ATTEMPTS
      },
      baseUrl,
      storageDir,
      runtimeToken,
      modelRouterBaseUrl: router.baseUrl,
      modelRouterModel: router.model
    }
  }
}

function withoutLegacyLlmEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const {
    EDAG_LLM_BASE_URL: _legacyBaseUrl,
    EDAG_LLM_API_KEY: _legacyApiKey,
    EDAG_LLM_MODEL: _legacyModel,
    ...rest
  } = env
  return rest
}

export async function ensureEvidenceDagSidecar(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    appRoot?: string
    env?: NodeJS.ProcessEnv
    spawnImpl?: typeof spawn
    log?: (message: string) => void
  }
): Promise<void> {
  const baseEnv = options.env ?? process.env
  if (baseEnv.SCIFORGE_EVIDENCE_DAG_AUTO_START === '0') {
    options.log?.('Evidence DAG auto-start is disabled.')
    if (isEvidenceDagChildRunning()) await stopEvidenceDagSidecar()
    return
  }

  const result = buildEvidenceDagLaunch(settings, {
    userDataDir: options.userDataDir,
    appRoot: options.appRoot,
    env: baseEnv
  })
  if (!result.ok) {
    options.log?.(result.reason)
    if (isEvidenceDagChildRunning()) await stopEvidenceDagSidecar()
    return
  }
  const launch = result.launch
  applyEvidenceDagRuntimeEnv(launch)

  const signature = evidenceDagLaunchSignatureValue(launch)
  if (isEvidenceDagChildRunning()) {
    if (evidenceDagLaunchSignature === signature) {
      await (evidenceDagReadyPromise ?? waitForEvidenceDagHealth(launch.baseUrl, launch.runtimeToken, DEFAULT_READY_TIMEOUT_MS))
      return
    }
    options.log?.('Evidence DAG sidecar launch settings changed; restarting sidecar.')
    await stopEvidenceDagSidecar()
  } else {
    const health = await checkEvidenceDagHealth(launch.baseUrl, launch.runtimeToken).catch(() => null)
    if (isEvidenceDagServiceHealth(health)) return
  }

  const spawnImpl = options.spawnImpl ?? spawn
  options.log?.(`Starting Evidence DAG sidecar from ${launch.cwd}.`)
  evidenceDagChild = spawnImpl(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
  evidenceDagLaunchSignature = signature
  evidenceDagReadyPromise = waitForEvidenceDagHealth(launch.baseUrl, launch.runtimeToken, DEFAULT_READY_TIMEOUT_MS)
  const child = evidenceDagChild
  attachEvidenceDagChildLogging(child, options.log)
  child.once('error', (error) => {
    options.log?.(`Evidence DAG sidecar failed to start: ${error.message}`)
  })
  child.once('exit', (code, signal) => {
    if (evidenceDagChild !== child) return
    evidenceDagChild = null
    evidenceDagLaunchSignature = null
    evidenceDagReadyPromise = null
    if (code !== 0 || signal) {
      options.log?.(`Evidence DAG sidecar exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`)
    }
  })

  try {
    await evidenceDagReadyPromise
  } finally {
    if (evidenceDagChild === child) evidenceDagReadyPromise = null
  }
}

export async function stopEvidenceDagSidecar(): Promise<void> {
  const child = evidenceDagChild
  if (!child) return
  evidenceDagChild = null
  evidenceDagLaunchSignature = null
  evidenceDagReadyPromise = null
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32' && child.pid) {
    await killWindowsProcessTree(child.pid)
    return
  }
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

async function checkEvidenceDagHealth(baseUrl: string, runtimeToken: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}/version`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${runtimeToken}`
    },
    signal: AbortSignal.timeout(2_000)
  })
  if (!response.ok) throw new Error(`health returned HTTP ${response.status}`)
  return response.json()
}

function isEvidenceDagServiceHealth(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const body = value as { ok?: unknown; data?: { service?: unknown } }
  return body.ok === true && body.data?.service === 'evidence-dag-engine'
}

async function waitForEvidenceDagHealth(baseUrl: string, runtimeToken: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  let lastMessage = ''
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await checkEvidenceDagHealth(baseUrl, runtimeToken)
      if (isEvidenceDagServiceHealth(health)) return
      lastMessage = 'unexpected Evidence DAG health payload'
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error)
    }
    await delay(250)
  }
  throw new Error(lastMessage || `Evidence DAG did not become ready within ${Math.round(timeoutMs / 1000)} seconds.`)
}

function applyEvidenceDagRuntimeEnv(launch: EvidenceDagLaunch): void {
  process.env[EVIDENCE_DAG_SERVICE_URL_ENV] = launch.baseUrl
  process.env[EVIDENCE_DAG_API_KEY_ENV] = launch.runtimeToken
  process.env[MODEL_ROUTER_BASE_URL_ENV] = launch.modelRouterBaseUrl
  process.env[MODEL_ROUTER_MODEL_ENV] = launch.modelRouterModel
}

function localPortFromBaseUrl(baseUrl: string): number | null {
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isEvidenceDagChildRunning(): boolean {
  return Boolean(evidenceDagChild && evidenceDagChild.exitCode === null && evidenceDagChild.signalCode === null)
}

function evidenceDagLaunchSignatureValue(launch: EvidenceDagLaunch): string {
  return JSON.stringify({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    baseUrl: launch.baseUrl,
    storageDir: launch.storageDir,
    runtimeToken: runtimeTokenFingerprint(launch.runtimeToken),
    modelRouterBaseUrl: launch.modelRouterBaseUrl,
    modelRouterModel: launch.modelRouterModel
  })
}

function runtimeTokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('base64url').slice(0, 16)
}

function evidenceDagRuntimeTokenFromModelRouter(modelRouterApiKey: string): string {
  return `edag-${createHash('sha256').update(`sciforge-evidence-dag:${modelRouterApiKey}`).digest('base64url')}`
}

function attachEvidenceDagChildLogging(
  child: ChildProcess,
  log: ((message: string) => void) | undefined
): void {
  if (!log) return
  child.stdout?.on('data', (chunk) => logEvidenceDagChildChunk('stdout', chunk, log))
  child.stderr?.on('data', (chunk) => logEvidenceDagChildChunk('stderr', chunk, log))
}

function logEvidenceDagChildChunk(
  stream: 'stdout' | 'stderr',
  chunk: unknown,
  log: (message: string) => void
): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return
  log(`Evidence DAG sidecar ${stream}: ${normalized.slice(0, 1_000)}`)
}

async function killWindowsProcessTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true
    })
    killer.once('error', () => resolve())
    killer.once('exit', () => resolve())
  })
}

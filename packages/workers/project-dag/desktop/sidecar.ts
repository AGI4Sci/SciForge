import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  getModelRouterSettings,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1
} from '../../../../src/shared/app-settings'
import { evidenceDagStorageDir } from '../../evidence-dag/desktop/sidecar'
import {
  DEFAULT_PROJECT_DAG_SERVICE_URL,
  PROJECT_DAG_API_KEY_ENV,
  PROJECT_DAG_SERVICE_VERSION,
  PROJECT_DAG_SERVICE_URL_ENV,
  normalizeProjectDagServiceUrl,
  projectDagApiKeyFromEnv
} from './contract'

const MODEL_ROUTER_BASE_URL_ENV = 'EDAG_MODEL_ROUTER_BASE_URL'
const MODEL_ROUTER_API_KEY_ENV = 'EDAG_MODEL_ROUTER_API_KEY'
const MODEL_ROUTER_MODEL_ENV = 'EDAG_MODEL_ROUTER_MODEL'
const MODEL_ROUTER_TIMEOUT_S_ENV = 'EDAG_MODEL_ROUTER_TIMEOUT_S'
const MODEL_ROUTER_MAX_ATTEMPTS_ENV = 'EDAG_MODEL_ROUTER_MAX_ATTEMPTS'
const DEFAULT_MODEL_ROUTER_TIMEOUT_S = '45'
const DEFAULT_MODEL_ROUTER_MAX_ATTEMPTS = '3'
const DEFAULT_READY_TIMEOUT_MS = 45_000
const PROJECT_VIEW_DB_FILENAME = 'project-view.db'

let projectDagChild: ChildProcess | null = null
let projectDagLaunchSignature: string | null = null
let projectDagReadyPromise: Promise<void> | null = null
let projectDagEnsurePromise: Promise<void> | null = null

export type ProjectDagLaunch = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
  baseUrl: string
  sessionDir: string
  dbPath: string
  runtimeToken: string
  modelRouterBaseUrl: string
  modelRouterModel: string
}

export type ProjectDagLaunchResult =
  | { ok: true; launch: ProjectDagLaunch }
  | { ok: false; reason: string }

export function projectDagBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (
    normalizeProjectDagServiceUrl(env[PROJECT_DAG_SERVICE_URL_ENV]) ||
    DEFAULT_PROJECT_DAG_SERVICE_URL
  )
}

export function projectDagDataDir(userDataDir: string): string {
  return join(userDataDir, 'project-dag')
}

export function buildProjectDagLaunch(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    appRoot?: string
    env?: NodeJS.ProcessEnv
    npmCommand?: string
  }
): ProjectDagLaunchResult {
  const routerSettings = getModelRouterSettings(settings)
  if (!routerSettings.enabled) {
    return { ok: false, reason: 'Project DAG requires Model Router to be enabled.' }
  }

  let router: ReturnType<typeof resolveRuntimeModelRouterSettings>
  try {
    router = resolveRuntimeModelRouterSettings(settings)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  if (!router.baseUrl.trim() || !router.apiKey.trim() || !router.model.trim()) {
    return {
      ok: false,
      reason: 'Project DAG requires Model Router URL, runtime API key, and public model alias.'
    }
  }

  const baseEnv = options.env ?? process.env
  const runtimeEnv = { ...baseEnv }
  delete runtimeEnv.PDAG_SCHEDULE
  const baseUrl = projectDagBaseUrl(baseEnv)
  const port = localPortFromBaseUrl(baseUrl) ?? 3898
  const runtimeToken =
    projectDagApiKeyFromEnv(baseEnv) || projectDagRuntimeTokenFromModelRouter(router.apiKey)
  const npmCommand = options.npmCommand ?? (process.platform === 'win32' ? 'cmd.exe' : 'npm')
  const npmArgsPrefix = options.npmCommand
    ? []
    : process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm.cmd']
      : []
  // read-only input: the evidence-dag per-thread PROV-JSON store
  const sessionDir = baseEnv.PDAG_SESSION_DIR || evidenceDagStorageDir(options.userDataDir)
  const dbPath = baseEnv.PDAG_DB_PATH ||
    join(projectDagDataDir(options.userDataDir), PROJECT_VIEW_DB_FILENAME)

  return {
    ok: true,
    launch: {
      command: npmCommand,
      cwd: options.appRoot ?? process.cwd(),
      args: [...npmArgsPrefix, '--workspace', '@sciforge/project-dag', 'run', 'start'],
      env: {
        ...runtimeEnv,
        PDAG_HOST: '127.0.0.1',
        PDAG_PORT: String(port),
        PDAG_SESSION_DIR: sessionDir,
        PDAG_DB_PATH: dbPath,
        [PROJECT_DAG_API_KEY_ENV]: runtimeToken,
        [PROJECT_DAG_SERVICE_URL_ENV]: baseUrl,
        [MODEL_ROUTER_BASE_URL_ENV]: router.baseUrl,
        [MODEL_ROUTER_API_KEY_ENV]: router.apiKey,
        [MODEL_ROUTER_MODEL_ENV]: router.model,
        [MODEL_ROUTER_TIMEOUT_S_ENV]: baseEnv[MODEL_ROUTER_TIMEOUT_S_ENV] ?? DEFAULT_MODEL_ROUTER_TIMEOUT_S,
        [MODEL_ROUTER_MAX_ATTEMPTS_ENV]: baseEnv[MODEL_ROUTER_MAX_ATTEMPTS_ENV] ?? DEFAULT_MODEL_ROUTER_MAX_ATTEMPTS
      },
      baseUrl,
      sessionDir,
      dbPath,
      runtimeToken,
      modelRouterBaseUrl: router.baseUrl,
      modelRouterModel: router.model
    }
  }
}

export async function ensureProjectDagSidecar(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    appRoot?: string
    env?: NodeJS.ProcessEnv
    spawnImpl?: typeof spawn
    log?: (message: string) => void
  }
): Promise<void> {
  if (projectDagEnsurePromise) {
    await projectDagEnsurePromise
    return
  }

  const promise = ensureProjectDagSidecarOnce(settings, options)
  projectDagEnsurePromise = promise
  try {
    await promise
  } finally {
    if (projectDagEnsurePromise === promise) projectDagEnsurePromise = null
  }
}

async function ensureProjectDagSidecarOnce(
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
  if (baseEnv.SCIFORGE_PROJECT_DAG_AUTO_START === '0') {
    options.log?.('Project DAG auto-start is disabled.')
    if (isProjectDagChildRunning()) await stopProjectDagSidecar()
    return
  }

  const result = buildProjectDagLaunch(settings, {
    userDataDir: options.userDataDir,
    appRoot: options.appRoot,
    env: baseEnv
  })
  if (!result.ok) {
    options.log?.(result.reason)
    if (isProjectDagChildRunning()) await stopProjectDagSidecar()
    throw new Error(result.reason)
  }
  const launch = result.launch
  ensureProjectDagDirectories(launch)
  applyProjectDagRuntimeEnv(launch)

  const signature = projectDagLaunchSignatureValue(launch)
  if (isProjectDagChildRunning()) {
    if (projectDagLaunchSignature === signature) {
      await (projectDagReadyPromise ??
        waitForProjectDagHealth(launch.baseUrl, launch.runtimeToken, DEFAULT_READY_TIMEOUT_MS))
      return
    }
    options.log?.('Project DAG sidecar launch settings changed; restarting sidecar.')
    await stopProjectDagSidecar()
  } else {
    const health = await checkProjectDagHealth(launch.baseUrl, launch.runtimeToken).catch(() => null)
    if (isProjectDagServiceHealth(health)) return
    if (isProjectDagServiceResponse(health)) {
      throw new Error(
        `Project DAG ${String(health.data?.version ?? 'unknown')} is already running at ${launch.baseUrl}; ` +
        `SciForge requires ${PROJECT_DAG_SERVICE_VERSION}. Restart SciForge to replace the stale sidecar.`
      )
    }
  }

  const spawnImpl = options.spawnImpl ?? spawn
  options.log?.(`Starting Project DAG sidecar from ${launch.cwd}.`)
  projectDagChild = spawnImpl(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
  projectDagLaunchSignature = signature
  const child = projectDagChild
  projectDagReadyPromise = Promise.race([
    waitForProjectDagHealth(launch.baseUrl, launch.runtimeToken, DEFAULT_READY_TIMEOUT_MS),
    waitForProjectDagChildExit(child)
  ])
  attachProjectDagChildLogging(child, options.log)
  child.once('error', (error) => {
    options.log?.(`Project DAG sidecar failed to start: ${error.message}`)
  })
  child.once('exit', (code, signal) => {
    if (projectDagChild !== child) return
    projectDagChild = null
    projectDagLaunchSignature = null
    projectDagReadyPromise = null
    if (code !== 0 || signal) {
      options.log?.(
        `Project DAG sidecar exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`
      )
    }
  })

  try {
    await projectDagReadyPromise
  } finally {
    if (projectDagChild === child) projectDagReadyPromise = null
  }
}

export async function stopProjectDagSidecar(): Promise<void> {
  const child = projectDagChild
  if (!child) return
  projectDagChild = null
  projectDagLaunchSignature = null
  projectDagReadyPromise = null
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

async function checkProjectDagHealth(baseUrl: string, runtimeToken: string): Promise<unknown> {
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

function isProjectDagServiceHealth(value: unknown): boolean {
  return isProjectDagServiceResponse(value) &&
    value.data?.version === PROJECT_DAG_SERVICE_VERSION
}

function isProjectDagServiceResponse(value: unknown): value is {
  ok: true
  data: { service: 'project-dag-engine'; version?: unknown }
} {
  if (!value || typeof value !== 'object') return false
  const body = value as { ok?: unknown; data?: { service?: unknown; version?: unknown } }
  return body.ok === true && body.data?.service === 'project-dag-engine'
}

async function waitForProjectDagHealth(
  baseUrl: string,
  runtimeToken: string,
  timeoutMs: number
): Promise<void> {
  const startedAt = Date.now()
  let lastMessage = ''
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await checkProjectDagHealth(baseUrl, runtimeToken)
      if (isProjectDagServiceHealth(health)) return
      lastMessage = 'unexpected Project DAG health payload'
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error)
    }
    await delay(250)
  }
  throw new Error(
    lastMessage || `Project DAG did not become ready within ${Math.round(timeoutMs / 1000)} seconds.`
  )
}

function applyProjectDagRuntimeEnv(launch: ProjectDagLaunch): void {
  process.env[PROJECT_DAG_SERVICE_URL_ENV] = launch.baseUrl
  process.env[PROJECT_DAG_API_KEY_ENV] = launch.runtimeToken
}

function ensureProjectDagDirectories(launch: ProjectDagLaunch): void {
  mkdirSync(launch.sessionDir, { recursive: true })
  mkdirSync(dirname(launch.dbPath), { recursive: true })
}

function waitForProjectDagChildExit(child: ChildProcess): Promise<never> {
  return new Promise((_, reject) => {
    child.once('error', (error) => {
      reject(new Error(`Project DAG sidecar failed to start: ${error.message}`))
    })
    child.once('exit', (code, signal) => {
      reject(
        new Error(
          `Project DAG sidecar exited before becoming ready (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`
        )
      )
    })
  })
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

function isProjectDagChildRunning(): boolean {
  return Boolean(
    projectDagChild && projectDagChild.exitCode === null && projectDagChild.signalCode === null
  )
}

function projectDagLaunchSignatureValue(launch: ProjectDagLaunch): string {
  return JSON.stringify({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    baseUrl: launch.baseUrl,
    sessionDir: launch.sessionDir,
    dbPath: launch.dbPath,
    runtimeToken: runtimeTokenFingerprint(launch.runtimeToken),
    modelRouterBaseUrl: launch.modelRouterBaseUrl,
    modelRouterModel: launch.modelRouterModel
  })
}

function runtimeTokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('base64url').slice(0, 16)
}

function projectDagRuntimeTokenFromModelRouter(modelRouterApiKey: string): string {
  return `pdag-${createHash('sha256').update(`sciforge-project-dag:${modelRouterApiKey}`).digest('base64url')}`
}

function attachProjectDagChildLogging(
  child: ChildProcess,
  log: ((message: string) => void) | undefined
): void {
  if (!log) return
  child.stdout?.on('data', (chunk) => logProjectDagChildChunk('stdout', chunk, log))
  child.stderr?.on('data', (chunk) => logProjectDagChildChunk('stderr', chunk, log))
}

function logProjectDagChildChunk(
  stream: 'stdout' | 'stderr',
  chunk: unknown,
  log: (message: string) => void
): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return
  log(`Project DAG sidecar ${stream}: ${normalized.slice(0, 1_000)}`)
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

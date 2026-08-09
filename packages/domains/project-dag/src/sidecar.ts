import {
  spawn,
  type ChildProcess,
  type SpawnOptions
} from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { delimiter, dirname, join } from 'node:path'
import type {
  DomainMainRuntimeLifecycleContext,
  DomainMainRuntimeLogEntry,
  DomainMainTextReasoner
} from '@sciforge/domain-sdk/host'
import {
  DEFAULT_PROJECT_DAG_SERVICE_URL,
  PROJECT_DAG_API_KEY_ENV,
  PROJECT_DAG_SERVICE_URL_ENV,
  PROJECT_DAG_SERVICE_VERSION,
  normalizeProjectDagServiceUrl,
  projectDagApiKeyFromEnv,
  projectDagServiceUrlFromEnv
} from './contract.js'

const DEFAULT_READY_TIMEOUT_MS = 45_000
const DEFAULT_PROJECT_PORT = 3898
const PROJECT_VIEW_DB_FILENAME = 'project-view.db'
const PROJECT_DAG_AUTO_START_ENV = 'SCIFORGE_PROJECT_DAG_AUTO_START'
const PROJECT_DAG_PACKAGE_ROOT_ENV = 'SCIFORGE_PROJECT_DAG_PACKAGE_ROOT'
const EVIDENCE_DAG_PACKAGE_ROOT_ENV = 'SCIFORGE_EVIDENCE_DAG_PACKAGE_ROOT'
const PYTHON_COMMAND_ENV = 'SCIFORGE_PYTHON_COMMAND'
const TEXT_REASONER_ENV_NAMES = new Set([
  'EDAG_MODEL_ROUTER_BASE_URL',
  'EDAG_MODEL_ROUTER_API_KEY',
  'EDAG_MODEL_ROUTER_MODEL',
  'SCIFORGE_MODEL_ROUTER_BASE_URL',
  'SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY',
  'SCIFORGE_MODEL_ROUTER_TEXT_API_KEY',
  'KUN_MODEL_ROUTER_API_KEY',
  'KUN_MODEL_ROUTER_BASE_URL',
  'KUN_MODEL_ROUTER_MODEL',
  'MODEL_ROUTER_API_KEY',
  'MODEL_ROUTER_RUNTIME_API_KEY',
  'MODEL_ROUTER_BASE_URL',
  'MODEL_ROUTER_MODEL'
])

export type ProjectDagSidecarConfig = Readonly<{
  baseUrl: string
  runtimeToken: string
  command: string
  args: readonly string[]
  cwd: string
  env: Readonly<Record<string, string | undefined>>
  projectPackageRoot: string
  evidencePackageRoot: string
  sessionDir: string
  dbPath: string
  autoStart: boolean
}>

export type ProjectDagSidecarOptions = Readonly<{
  spawnImpl?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions
  ) => ChildProcess
  fetchImpl?: typeof fetch
  readyTimeoutMs?: number
  allocatePort?: () => Promise<number>
}>

export class ProjectDagSidecar {
  readonly #spawnImpl: NonNullable<ProjectDagSidecarOptions['spawnImpl']>
  readonly #fetchImpl: typeof fetch
  readonly #readyTimeoutMs: number
  readonly #allocatePort: () => Promise<number>
  #child: ChildProcess | null = null
  #ensurePromise: Promise<ProjectDagSidecarConfig> | null = null
  #config: ProjectDagSidecarConfig | null = null
  #managedBaseUrl: string | null = null
  readonly #generatedRuntimeToken = randomBytes(32).toString('base64url')

  constructor(options: ProjectDagSidecarOptions = {}) {
    this.#spawnImpl = options.spawnImpl ?? ((command, args, spawnOptions) =>
      spawn(command, [...args], spawnOptions))
    this.#fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.#readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    this.#allocatePort = options.allocatePort ?? allocateProjectDagLoopbackPort
  }

  get config(): ProjectDagSidecarConfig | null {
    return this.#config
  }

  async ensure(context: DomainMainRuntimeLifecycleContext): Promise<ProjectDagSidecarConfig> {
    if (this.#ensurePromise) return this.#ensurePromise
    const pending = this.#ensureOnce(context)
    this.#ensurePromise = pending
    try {
      return await pending
    } finally {
      if (this.#ensurePromise === pending) this.#ensurePromise = null
    }
  }

  async stop(): Promise<void> {
    const child = this.#child
    this.#child = null
    this.#config = null
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    if (process.platform === 'win32' && child.pid) {
      await new Promise<void>((resolve) => {
        const killer = this.#spawnImpl(
          'taskkill.exe',
          ['/pid', String(child.pid), '/t', '/f'],
          { stdio: 'ignore', windowsHide: true }
        )
        killer.once('error', () => resolve())
        killer.once('exit', () => resolve())
      })
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

  async #ensureOnce(
    context: DomainMainRuntimeLifecycleContext
  ): Promise<ProjectDagSidecarConfig> {
    let textReasoner: DomainMainTextReasoner
    try {
      textReasoner = await resolveProjectDagTextReasoner(context)
    } catch (error) {
      if (this.#childRunning()) await this.stop()
      throw error
    }
    const managedBaseUrl = await this.#managedServiceUrl(context)
    const config = projectDagSidecarConfig(
      context,
      textReasoner,
      this.#generatedRuntimeToken,
      managedBaseUrl
    )
    if (this.#config && sameLaunch(this.#config, config) && this.#childRunning()) {
      await waitForProjectDagHealth(
        config,
        this.#fetchImpl,
        this.#readyTimeoutMs
      )
      return config
    }
    if (this.#childRunning()) await this.stop()

    const health = await readProjectDagHealth(config, this.#fetchImpl).catch(() => null)
    if (health?.version === PROJECT_DAG_SERVICE_VERSION) {
      this.#config = config
      return config
    }
    if (health) {
      throw new Error(
        `Project DAG ${health.version ?? 'unknown'} is running at ${config.baseUrl}; ` +
        `version ${PROJECT_DAG_SERVICE_VERSION} is required.`
      )
    }
    if (!config.autoStart) {
      throw new Error(
        `Project DAG auto-start is disabled and no compatible service is reachable at ${config.baseUrl}.`
      )
    }
    if (!isLocalServiceUrl(config.baseUrl)) {
      throw new Error(
        `Project DAG auto-start only supports a loopback service URL; received ${config.baseUrl}.`
      )
    }

    await mkdir(config.sessionDir, { recursive: true })
    await mkdir(dirname(config.dbPath), { recursive: true })
    log(context, 'info', `Starting Project DAG sidecar from ${config.cwd}.`)
    const child = this.#spawnImpl(config.command, [...config.args], {
      cwd: config.cwd,
      env: { ...config.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    })
    this.#child = child
    this.#config = config
    attachChildLogging(child, context)
    child.once('error', (error) => {
      log(context, 'error', 'Project DAG sidecar failed to start.', error)
    })
    child.once('exit', (code, signal) => {
      if (this.#child !== child) return
      this.#child = null
      this.#config = null
      if (code !== 0 || signal) {
        log(context, 'warn', 'Project DAG sidecar exited unexpectedly.', {
          code,
          signal
        })
      }
    })
    try {
      await Promise.race([
        waitForProjectDagHealth(config, this.#fetchImpl, this.#readyTimeoutMs),
        waitForChildExit(child)
      ])
      return config
    } catch (error) {
      if (this.#child === child) await this.stop()
      throw error
    }
  }

  #childRunning(): boolean {
    return Boolean(
      this.#child &&
      this.#child.exitCode === null &&
      this.#child.signalCode === null
    )
  }

  async #managedServiceUrl(context: DomainMainRuntimeLifecycleContext): Promise<string | undefined> {
    if (projectDagServiceUrlFromEnv(context.environment)) return undefined
    if (this.#managedBaseUrl) return this.#managedBaseUrl
    const port = await this.#allocatePort()
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('Project DAG sidecar received an invalid allocated loopback port.')
    }
    this.#managedBaseUrl = `http://127.0.0.1:${port}`
    return this.#managedBaseUrl
  }
}

export function projectDagSidecarConfig(
  context: Pick<
    DomainMainRuntimeLifecycleContext,
    'appRoot' | 'environment' | 'userDataDir'
  >,
  textReasoner: DomainMainTextReasoner,
  generatedRuntimeToken = randomBytes(32).toString('base64url'),
  managedBaseUrl?: string
): ProjectDagSidecarConfig {
  const environment = context.environment
  const configuredUrl = projectDagServiceUrlFromEnv(environment)
  const baseUrl = configuredUrl || managedBaseUrl || DEFAULT_PROJECT_DAG_SERVICE_URL
  const port = localPortFromBaseUrl(baseUrl) ?? DEFAULT_PROJECT_PORT
  const runtimeToken = projectDagApiKeyFromEnv(environment) || generatedRuntimeToken
  const roots = projectDagPackageRoots(context.appRoot, environment)
  const pythonPath = [
    join(roots.project, 'python'),
    join(roots.evidence, 'python'),
    environment.PYTHONPATH?.trim()
  ].filter((value): value is string => Boolean(value)).join(delimiter)
  const command = environment[PYTHON_COMMAND_ENV]?.trim() ||
    (process.platform === 'win32' ? 'python.exe' : 'python3')
  const args = ['-m', 'project_dag.server']
  const sessionDir = environment.PDAG_SESSION_DIR?.trim() ||
    environment.EDAG_STORAGE_DIR?.trim() ||
    join(context.userDataDir, 'evidence-dag', 'threads')
  const dbPath = environment.PDAG_DB_PATH?.trim() ||
    join(context.userDataDir, 'project-dag', PROJECT_VIEW_DB_FILENAME)
  return Object.freeze({
    baseUrl,
    runtimeToken,
    command,
    args: Object.freeze(args),
    cwd: roots.project,
    projectPackageRoot: roots.project,
    evidencePackageRoot: roots.evidence,
    sessionDir,
    dbPath,
    autoStart: environment[PROJECT_DAG_AUTO_START_ENV] !== '0',
    env: Object.freeze({
      ...withoutTextReasonerEnvironment(environment),
      PDAG_HOST: '127.0.0.1',
      PDAG_PORT: String(port),
      PDAG_SESSION_DIR: sessionDir,
      PDAG_DB_PATH: dbPath,
      [PROJECT_DAG_API_KEY_ENV]: runtimeToken,
      [PROJECT_DAG_SERVICE_URL_ENV]: baseUrl,
      EDAG_MODEL_ROUTER_BASE_URL: textReasoner.baseUrl,
      EDAG_MODEL_ROUTER_API_KEY: textReasoner.apiKey,
      EDAG_MODEL_ROUTER_MODEL: textReasoner.model,
      PYTHONPATH: pythonPath
    })
  })
}

export async function allocateProjectDagLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a Project DAG loopback port.')))
        return
      }
      const port = address.port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

export function projectDagPackageRoots(
  appRoot: string,
  environment: Readonly<Record<string, string | undefined>>,
  pathExists: (path: string) => boolean = existsSync
): Readonly<{ project: string; evidence: string }> {
  return Object.freeze({
    project: packageRoot(
      environment[PROJECT_DAG_PACKAGE_ROOT_ENV],
      appRoot,
      'project-dag',
      '@sciforge/domain-project-dag',
      pathExists
    ),
    evidence: packageRoot(
      environment[EVIDENCE_DAG_PACKAGE_ROOT_ENV],
      appRoot,
      'evidence-dag',
      '@sciforge/domain-evidence-dag',
      pathExists
    )
  })
}

async function readProjectDagHealth(
  config: ProjectDagSidecarConfig,
  fetchImpl: typeof fetch
): Promise<{ version?: string }> {
  const response = await fetchImpl(`${config.baseUrl}/version`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.runtimeToken}`
    },
    signal: AbortSignal.timeout(2_000)
  })
  const body = await response.json() as unknown
  if (!response.ok || !isRecord(body) || body.ok !== true || !isRecord(body.data)) {
    throw new Error(`Project DAG health returned HTTP ${response.status}.`)
  }
  const service = stringValue(body.data.service)
  if (service !== 'project-dag-engine') {
    throw new Error('Unexpected Project DAG service identity.')
  }
  return { version: stringValue(body.data.version) }
}

async function waitForProjectDagHealth(
  config: ProjectDagSidecarConfig,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<void> {
  const startedAt = Date.now()
  let lastError = ''
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await readProjectDagHealth(config, fetchImpl)
      if (health.version === PROJECT_DAG_SERVICE_VERSION) return
      lastError = `Project DAG version ${health.version ?? 'unknown'} is not supported.`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    lastError || `Project DAG did not become ready within ${Math.round(timeoutMs / 1_000)} seconds.`
  )
}

function waitForChildExit(child: ChildProcess): Promise<never> {
  return new Promise((_, reject) => {
    child.once('error', (error) => reject(error))
    child.once('exit', (code, signal) => {
      reject(new Error(
        `Project DAG exited before becoming ready (code=${code ?? 'null'}, ` +
        `signal=${signal ?? 'null'}).`
      ))
    })
  })
}

function attachChildLogging(
  child: ChildProcess,
  context: DomainMainRuntimeLifecycleContext
): void {
  const write = (stream: 'stdout' | 'stderr', chunk: unknown) => {
    const value = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    const normalized = value.replace(/\s+/gu, ' ').trim()
    if (!normalized) return
    log(context, stream === 'stderr' ? 'warn' : 'debug',
      `Project DAG sidecar ${stream}: ${normalized.slice(0, 1_000)}`)
  }
  child.stdout?.on('data', (chunk) => write('stdout', chunk))
  child.stderr?.on('data', (chunk) => write('stderr', chunk))
}

function log(
  context: Pick<DomainMainRuntimeLifecycleContext, 'log'>,
  level: DomainMainRuntimeLogEntry['level'],
  message: string,
  detail?: unknown
): void {
  context.log({ level, message, ...(detail === undefined ? {} : { detail }) })
}

function localPortFromBaseUrl(baseUrl: string): number | null {
  try {
    const url = new URL(baseUrl)
    if (!isLoopbackHost(url.hostname) || url.protocol !== 'http:') return null
    const port = Number(url.port)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

function isLocalServiceUrl(baseUrl: string): boolean {
  try {
    const url = new URL(normalizeProjectDagServiceUrl(baseUrl))
    return url.protocol === 'http:' && isLoopbackHost(url.hostname)
  } catch {
    return false
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname.toLowerCase() === '127.0.0.1' ||
    hostname.toLowerCase() === 'localhost' ||
    hostname === '::1'
}

function sameLaunch(
  left: ProjectDagSidecarConfig,
  right: ProjectDagSidecarConfig
): boolean {
  return left.baseUrl === right.baseUrl &&
    left.runtimeToken === right.runtimeToken &&
    left.command === right.command &&
    left.args.length === right.args.length &&
    left.args.every((value, index) => value === right.args[index]) &&
    left.cwd === right.cwd &&
    left.projectPackageRoot === right.projectPackageRoot &&
    left.evidencePackageRoot === right.evidencePackageRoot &&
    left.sessionDir === right.sessionDir &&
    left.dbPath === right.dbPath &&
    left.autoStart === right.autoStart &&
    left.env.PYTHONPATH === right.env.PYTHONPATH &&
    left.env.EDAG_MODEL_ROUTER_BASE_URL === right.env.EDAG_MODEL_ROUTER_BASE_URL &&
    left.env.EDAG_MODEL_ROUTER_API_KEY === right.env.EDAG_MODEL_ROUTER_API_KEY &&
    left.env.EDAG_MODEL_ROUTER_MODEL === right.env.EDAG_MODEL_ROUTER_MODEL
}

async function resolveProjectDagTextReasoner(
  context: Pick<DomainMainRuntimeLifecycleContext, 'modelAccess'>
): Promise<DomainMainTextReasoner> {
  const configured = await context.modelAccess.textReasoner()
  if (!configured) {
    throw new Error('Project DAG requires configured text reasoning model access.')
  }
  const baseUrl = configured.baseUrl.trim().replace(/\/+$/u, '')
  const apiKey = configured.apiKey.trim()
  const model = configured.model.trim()
  if (!baseUrl || !apiKey || !model) {
    throw new Error('Project DAG received incomplete text reasoning model access.')
  }
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error('Project DAG received an invalid text reasoning base URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Project DAG text reasoning access requires an HTTP(S) base URL.')
  }
  return Object.freeze({ baseUrl, apiKey, model })
}

function withoutTextReasonerEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !TEXT_REASONER_ENV_NAMES.has(name))
  )
}

function packageRoot(
  configured: string | undefined,
  appRoot: string,
  directoryName: string,
  packageName: string,
  pathExists: (path: string) => boolean
): string {
  if (configured?.trim()) return configured.trim()
  const candidates = [
    join(appRoot, 'packages', 'domains', directoryName),
    join(appRoot, 'node_modules', ...packageName.split('/')),
    join(appRoot, 'domains', directoryName)
  ]
  return candidates.find(pathExists) ?? candidates[0]!
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

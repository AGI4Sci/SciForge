import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { evidenceDagStorageRoot } from '../storage.js'
import { ownedPythonLaunch } from '@sciforge/domain-sdk/host'
import type {
  DomainMainRuntimeLifecycleContext,
  DomainMainTextReasoner
} from '@sciforge/domain-sdk/host'
import {
  DEFAULT_EVIDENCE_DAG_SERVICE_URL,
  EVIDENCE_DAG_API_KEY_ENV,
  EVIDENCE_DAG_SERVICE_URL_ENV,
  isEvidenceDagServiceIdentity,
  normalizeBaseUrl,
  type EvidenceDagServiceEndpoint
} from './client.js'

const DEFAULT_READY_TIMEOUT_MS = 45_000

export type EvidenceDagSidecarPort = Readonly<{
  configure(context: DomainMainRuntimeLifecycleContext): void
  endpoint(): EvidenceDagServiceEndpoint
  ensureReady(): Promise<void>
  stop(): Promise<void>
}>

export class EvidenceDagSidecar implements EvidenceDagSidecarPort {
  private context: DomainMainRuntimeLifecycleContext | undefined
  private child: ChildProcess | undefined
  private activeReasoner: DomainMainTextReasoner | null | undefined
  private generation = 0
  private managedBaseUrl: string | undefined
  private ensureInFlight: Promise<void> | undefined
  private transition: Promise<void> = Promise.resolve()
  private readonly token = randomBytes(32).toString('base64url')

  constructor(private readonly options: Readonly<{
    fetchImpl?: typeof fetch
    spawnImpl?: (
      command: string,
      args: readonly string[],
      options: SpawnOptions
    ) => ChildProcess
    readyTimeoutMs?: number
    allocatePort?: () => Promise<number>
  }> = {}) {}

  configure(context: DomainMainRuntimeLifecycleContext): void {
    this.context = context
    this.generation++
  }

  endpoint(): EvidenceDagServiceEndpoint {
    const environment = this.context?.environment ?? {}
    const configuredBaseUrl = environment[EVIDENCE_DAG_SERVICE_URL_ENV]?.trim()
    return {
      baseUrl: normalizeBaseUrl(
        configuredBaseUrl || this.managedBaseUrl || DEFAULT_EVIDENCE_DAG_SERVICE_URL
      ),
      apiKey: environment[EVIDENCE_DAG_API_KEY_ENV]?.trim() || this.token
    }
  }

  ensureReady(): Promise<void> {
    if (this.ensureInFlight) return this.ensureInFlight
    const generation = this.generation
    const transition = this.transition.then(async () => {
      try { await this.ensureCurrent(generation) }
      catch (error) { await this.stopChild(); throw error }
    })
    this.transition = transition.catch(() => undefined)
    const inFlight = transition.finally(() => {
      if (this.ensureInFlight === inFlight) this.ensureInFlight = undefined
    })
    this.ensureInFlight = inFlight
    return inFlight
  }

  stop(): Promise<void> {
    this.generation++
    const transition = this.transition.then(() => this.stopChild())
    this.transition = transition.catch(() => undefined)
    return transition
  }

  private async stopChild(): Promise<void> {
    const child = this.child
    this.child = undefined
    this.activeReasoner = undefined
    if (!child || child.exitCode !== null || child.signalCode !== null) return
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

  private async ensureCurrent(generation: number): Promise<void> {
    const context = this.context
    if (!context) throw new Error('Evidence DAG runtime lifecycle is not active.')
    const assertCurrent = () => {
      if (generation !== this.generation || context.signal.aborted) {
        throw new Error('Evidence DAG lifecycle changed during startup.')
      }
    }
    assertCurrent()
    if (!await context.enablement.isEnabled()) {
      throw new Error('Evidence DAG is disabled.')
    }
    const reasoner = await resolveTextReasoner(context)
    assertCurrent()
    if (this.child && !sameTextReasoner(this.activeReasoner ?? null, reasoner)) {
      await this.stopChild()
    }
    const healthy = await this.healthy()
    assertCurrent()
    if (healthy) return
    if (context.environment.SCIFORGE_EVIDENCE_DAG_AUTO_START === '0') {
      throw new Error('Evidence DAG auto-start is disabled and no service is reachable.')
    }
    const activeChild = this.child
    if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) {
      await this.waitUntilReady(activeChild, assertCurrent)
      return
    }

    const endpoint = await this.prepareSpawnEndpoint(context)
    assertCurrent()
    const url = new URL(endpoint.baseUrl)
    const python = context.environment.SCIFORGE_PYTHON_COMMAND?.trim() ||
      (process.platform === 'win32' ? 'python' : 'python3')
    const packageRoot = resolveEvidenceDagPackageRoot(context)
    const pythonPath = resolveEvidenceDagPythonPath(packageRoot, context.environment)
    const environment: NodeJS.ProcessEnv = {
      ...context.environment,
      PYTHONUTF8: '1',
      EDAG_HOST: '127.0.0.1',
      EDAG_PORT: url.port || '3897',
      EDAG_STORAGE_DIR: evidenceDagStorageRoot(context.userDataDir, context.environment),
      [EVIDENCE_DAG_SERVICE_URL_ENV]: endpoint.baseUrl,
      [EVIDENCE_DAG_API_KEY_ENV]: endpoint.apiKey,
      // Never inherit a revoked host/router credential from the launch environment.
      EDAG_MODEL_ROUTER_BASE_URL: reasoner?.baseUrl,
      EDAG_MODEL_ROUTER_API_KEY: reasoner?.apiKey,
      EDAG_MODEL_ROUTER_MODEL: reasoner?.model,
      SCIFORGE_MODEL_ROUTER_BASE_URL: undefined,
      SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: undefined,
      EDAG_MODEL_ROUTER_TIMEOUT_S:
        context.environment.EDAG_MODEL_ROUTER_TIMEOUT_S || '180',
      EDAG_MODEL_ROUTER_MAX_ATTEMPTS:
        context.environment.EDAG_MODEL_ROUTER_MAX_ATTEMPTS || '1',
      PYTHONPATH: [pythonPath, context.environment.PYTHONPATH].filter(Boolean).join(
        process.platform === 'win32' ? ';' : ':'
      )
    }

    context.log({ level: 'info', message: 'Starting package-owned Evidence DAG sidecar.' })
    const spawnImpl = this.options.spawnImpl ?? ((command, args, options) =>
      spawn(command, args, options))
    const launch = ownedPythonLaunch(['-m', 'evidence_dag.server'], environment)
    const child = spawnImpl(python, launch.args, {
      cwd: packageRoot,
      env: launch.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    this.activeReasoner = reasoner
    child.stdout?.on('data', (chunk) => this.logChunk('debug', chunk))
    child.stderr?.on('data', (chunk) => this.logChunk('warn', chunk))
    child.once('error', (error) => {
      context.log({
        level: 'error',
        message: 'Evidence DAG sidecar failed to start.',
        detail: error.message
      })
    })
    child.once('exit', (code, signal) => {
      if (this.child === child) {
        this.child = undefined
        this.activeReasoner = undefined
      }
      if (code !== 0 || signal) {
        context.log({
          level: 'warn',
          message: 'Evidence DAG sidecar exited.',
          detail: { code, signal }
        })
      }
    })
    await this.waitUntilReady(child, assertCurrent)
  }

  private async healthy(): Promise<boolean> {
    const endpoint = this.endpoint()
    try {
      const response = await (this.options.fetchImpl ?? fetch)(`${endpoint.baseUrl}/version`, {
        headers: { Authorization: `Bearer ${endpoint.apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(2_000)
      })
      if (!response.ok) return false
      const envelope = await response.json().catch(() => null)
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return false
      return (envelope as { ok?: unknown }).ok === true &&
        isEvidenceDagServiceIdentity((envelope as { data?: unknown }).data)
    } catch {
      return false
    }
  }

  private async waitUntilReady(child: ChildProcess, assertCurrent: () => void): Promise<void> {
    const startedAt = Date.now()
    const timeoutMs = this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    while (Date.now() - startedAt < timeoutMs) {
      const healthy = await this.healthy()
      assertCurrent()
      if (healthy) return
      if (child.exitCode !== null || child.signalCode !== null || this.child !== child) {
        const outcome = child.signalCode
          ? `signal ${child.signalCode}`
          : `exit code ${child.exitCode ?? 'unknown'}`
        throw new Error(`Evidence DAG sidecar exited before becoming ready (${outcome}).`)
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('Evidence DAG sidecar did not become ready before the startup deadline.')
  }

  private async prepareSpawnEndpoint(
    context: DomainMainRuntimeLifecycleContext
  ): Promise<EvidenceDagServiceEndpoint> {
    if (context.environment[EVIDENCE_DAG_SERVICE_URL_ENV]?.trim()) return this.endpoint()
    const port = await (this.options.allocatePort ?? allocateLoopbackPort)()
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('Evidence DAG sidecar received an invalid allocated loopback port.')
    }
    this.managedBaseUrl = `http://127.0.0.1:${port}`
    return this.endpoint()
  }

  private logChunk(level: 'debug' | 'warn', chunk: unknown): void {
    const message = String(chunk).replace(/\s+/gu, ' ').trim().slice(0, 1_000)
    if (message) this.context?.log({ level, message: `Evidence DAG sidecar: ${message}` })
  }
}

export async function allocateLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate an Evidence DAG loopback port.')))
        return
      }
      const port = address.port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function resolveTextReasoner(
  context: DomainMainRuntimeLifecycleContext
): Promise<DomainMainTextReasoner | null> {
  const configured = await context.modelAccess.textReasoner()
  if (!configured) return null
  const baseUrl = configured.baseUrl.trim().replace(/\/+$/u, '')
  const apiKey = configured.apiKey.trim()
  const model = configured.model.trim()
  if (!baseUrl || !apiKey || !model) {
    throw new Error('Evidence DAG received incomplete text reasoning model access.')
  }
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error('Evidence DAG received an invalid text reasoning base URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Evidence DAG text reasoning access requires an HTTP(S) base URL.')
  }
  return Object.freeze({ baseUrl, apiKey, model })
}

function sameTextReasoner(
  left: DomainMainTextReasoner | null,
  right: DomainMainTextReasoner | null
): boolean {
  if (!left || !right) return left === right
  return left.baseUrl === right.baseUrl &&
    left.apiKey === right.apiKey &&
    left.model === right.model
}

export function resolveEvidenceDagPackageRoot(
  context: Pick<DomainMainRuntimeLifecycleContext, 'appRoot' | 'environment'>
): string {
  const explicit = context.environment.SCIFORGE_EVIDENCE_DAG_PACKAGE_ROOT?.trim()
  if (explicit) return explicit
  const unpackedRoot = context.appRoot.endsWith('.asar')
    ? `${context.appRoot}.unpacked`
    : context.appRoot
  const candidates = [
    join(context.appRoot, 'packages', 'domains', 'evidence-dag'),
    join(context.appRoot, 'node_modules', '@sciforge', 'domain-evidence-dag'),
    join(unpackedRoot, 'node_modules', '@sciforge', 'domain-evidence-dag'),
    join(unpackedRoot, 'packages', 'domains', 'evidence-dag')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ??
    (context.appRoot.endsWith('.asar') ? candidates[2]! : candidates[0]!)
}

export function resolveEvidenceDagPythonPath(
  packageRoot: string,
  environment: Readonly<Record<string, string | undefined>>
): string {
  const explicit = environment.SCIFORGE_EVIDENCE_DAG_PYTHONPATH?.trim()
  if (explicit) return explicit
  return join(packageRoot, 'python')
}

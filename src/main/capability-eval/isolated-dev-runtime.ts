import { once } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import {
  createDevBrowserBridgeRuntime,
  type DevBrowserBridgeRuntime
} from './dev-bridge-runtime'

const DEFAULT_STARTUP_TIMEOUT_MS = 10 * 60_000
const BRIDGE_POLL_INTERVAL_MS = 250
const BRIDGE_REQUEST_TIMEOUT_MS = 1_000
const SHUTDOWN_TIMEOUT_MS = 5_000

export type IsolatedDevBrowserBridgeRuntimeOptions = Readonly<{
  projectRoot?: string
  bridgeUrl?: string
  startupTimeoutMs?: number
  fetch?: typeof fetch
  env?: NodeJS.ProcessEnv
  /** Non-secret model access selector used to bootstrap a disposable Host. */
  modelAccessBootstrap?: Readonly<{
    mode: 'coding-plan'
    planAdapterId: string
  }>
}>

export type IsolatedDevBrowserBridgeRuntime = DevBrowserBridgeRuntime & Readonly<{
  isolatedUserDataDirectory: string
  isolatedInstanceId: string
}>

/**
 * Starts one disposable SciForge development process for one live workflow.
 * Electron's explicit user-data directory isolates Paper Radar's local DB,
 * profiles, Host approval caches, and other app-local durable state. The
 * caller must still treat external providers as shared unless their own
 * harness offers an isolated endpoint or fixture.
 */
export async function createIsolatedDevBrowserBridgeRuntime(
  options: IsolatedDevBrowserBridgeRuntimeOptions = {}
): Promise<IsolatedDevBrowserBridgeRuntime> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  const configuredBridgeUrl = options.bridgeUrl ?? process.env.SCIFORGE_DEV_BRIDGE_URL
  const bridgeUrl = normalizeBridgeUrl(
    configuredBridgeUrl ?? `http://127.0.0.1:${await findFreePort()}`
  )
  const bridgePort = bridgePortFromUrl(bridgeUrl)
  const rendererPort = await findFreePort(new Set(bridgePort === undefined ? [] : [bridgePort]))
  const fetchImpl = options.fetch ?? fetch
  const startupTimeoutMs = Math.max(1_000, options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS)
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'sciforge-capability-eval-user-data-'))
  if (options.modelAccessBootstrap) {
    await writeFile(
      join(userDataDirectory, 'sciforge-settings.json'),
      `${JSON.stringify({
        version: 1,
        modelAccess: options.modelAccessBootstrap,
        activeAgentRuntime: 'codex'
      }, null, 2)}\n`,
      'utf8'
    )
  }
  const instanceId = options.env?.SCIFORGE_DEV_INSTANCE_ID?.trim() || randomUUID()
  const child = spawn(
    process.execPath,
    [
      join(projectRoot, 'scripts/dev-bootstrap.mjs'),
      `--user-data-dir=${userDataDirectory}`,
      '--hidden'
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...options.env,
        // Some developer shells expose this flag while running Electron's
        // embedded Node. It must not leak into electron-vite's real Electron
        // child or Electron will execute the main bundle as plain Node.
        ELECTRON_RUN_AS_NODE: undefined,
        SCIFORGE_DEV_INSTANCE_ID: instanceId,
        SCIFORGE_DEV_LOCK_SCOPE: `capability-eval-${instanceId}`,
        SCIFORGE_DEV_BROWSER_BRIDGE: '1',
        SCIFORGE_DEV_RENDERER_PORT: String(rendererPort),
        ...(bridgePort ? { SCIFORGE_DEV_BROWSER_BRIDGE_PORT: String(bridgePort) } : {}),
        ELECTRON_RENDERER_URL: `http://127.0.0.1:${rendererPort}`,
        // Domain packages receive the isolated userData directory through the
        // generic host contract and own their internal storage layout.
      },
      stdio: 'inherit',
      detached: process.platform !== 'win32'
    }
  )

  try {
    await waitForBridge(child, bridgeUrl, instanceId, fetchImpl, startupTimeoutMs)
    const runtime = await createDevBrowserBridgeRuntime({
      bridgeUrl,
      instanceId,
      projectRoot,
      fetch: fetchImpl
    })
    let closed = false
    const close = async (): Promise<void> => {
        if (closed) return
        closed = true
        let closeError: unknown
        try {
          await runtime.close()
        } catch (error) {
          closeError = error
        }
        try {
          await terminateChild(child)
        } catch (error) {
          closeError ??= error
        }
        if (!closeError) {
          try {
            await removeIsolatedUserDataDirectory(userDataDirectory)
          } catch (error) {
            closeError = error
          }
        }
        if (closeError) throw closeError
      }

    return decorateIsolatedRuntime(runtime, {
      isolatedUserDataDirectory: userDataDirectory,
      isolatedInstanceId: instanceId,
      close
    })
  } catch (error) {
    let cleanupError: unknown
    try {
      await terminateChild(child)
    } catch (terminationError) {
      cleanupError = terminationError
    }
    if (!cleanupError) {
      try {
        await removeIsolatedUserDataDirectory(userDataDirectory)
      } catch (removalError) {
        cleanupError = removalError
      }
    }
    if (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Isolated SciForge runtime startup failed and cleanup also failed: ${errorMessage(error)}`
      )
    }
    throw error
  }
}

async function waitForBridge(
  child: ChildProcess,
  bridgeUrl: string,
  instanceId: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let spawnError: Error | undefined
  const onError = (error: Error): void => {
    spawnError = error
  }
  child.once('error', onError)
  try {
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(`Unable to start isolated SciForge development process: ${spawnError.message}`, {
          cause: spawnError
        })
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Isolated SciForge development process exited before its bridge became ready ` +
          `(code ${child.exitCode ?? 'null'}, signal ${child.signalCode ?? 'none'}).`
        )
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), BRIDGE_REQUEST_TIMEOUT_MS)
      try {
        const response = await fetchImpl(`${bridgeUrl}/health`, {
          headers: { 'X-SciForge-Dev-Instance': instanceId },
          signal: controller.signal
        })
        if (response.ok) return
      } catch {
        // The dev server is expected to refuse connections until Electron has
        // finished starting. The process/timeout checks classify real failure.
      } finally {
        clearTimeout(timer)
      }
      await delay(Math.min(BRIDGE_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())))
    }
  } finally {
    child.removeListener('error', onError)
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for the isolated SciForge browser bridge at ${bridgeUrl}.`)
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const pid = child.pid
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return
  sendSignal(child, pid, 'SIGTERM')
  await waitForExit(child, SHUTDOWN_TIMEOUT_MS).catch(() => undefined)
  if (child.exitCode === null && child.signalCode === null) {
    sendSignal(child, pid, 'SIGKILL')
    await waitForExit(child, SHUTDOWN_TIMEOUT_MS)
  }
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error(`Isolated SciForge development process ${pid} did not exit after termination.`)
  }
}

async function removeIsolatedUserDataDirectory(directory: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      if (!isRetryableUserDataRemovalError(error) || attempt === 7) throw error
      await delay(100 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function isRetryableUserDataRemovalError(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error
    ? error.code
    : undefined
  return code === 'ENOTEMPTY' || code === 'EBUSY' || code === 'EPERM'
}

function sendSignal(child: ChildProcess, pid: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      once(child, 'exit'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for isolated process exit.')), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function normalizeBridgeUrl(value: string): string {
  const normalized = value.trim().replace(/\/$/u, '')
  if (!normalized) throw new Error('An isolated development bridge URL is required.')
  return normalized
}

function bridgePortFromUrl(value: string): number | undefined {
  const parsed = new URL(value)
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : undefined
}

async function findFreePort(excludedPorts: ReadonlySet<number> = new Set()): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (
    !address ||
    typeof address === 'string' ||
    !Number.isInteger(address.port) ||
    address.port <= 0 ||
    excludedPorts.has(address.port)
  ) {
    if (address && typeof address !== 'string' && excludedPorts.has(address.port)) {
      return findFreePort(excludedPorts)
    }
    throw new Error('Unable to allocate a free port for the isolated development bridge.')
  }
  return address.port
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function decorateIsolatedRuntime(
  runtime: DevBrowserBridgeRuntime,
  metadata: Readonly<{
    isolatedUserDataDirectory: string
    isolatedInstanceId: string
    close: () => Promise<void>
  }>
): IsolatedDevBrowserBridgeRuntime {
  // Keep the runtime's prototype and private state intact. Spreading the
  // class instance here silently removed startThread/startTurn and all other
  // methods implemented on DevBrowserBridgeRuntimeImpl's prototype.
  Object.defineProperties(runtime, {
    isolatedUserDataDirectory: {
      configurable: false,
      enumerable: true,
      value: metadata.isolatedUserDataDirectory,
      writable: false
    },
    isolatedInstanceId: {
      configurable: false,
      enumerable: true,
      value: metadata.isolatedInstanceId,
      writable: false
    },
    close: {
      configurable: true,
      enumerable: false,
      value: metadata.close,
      writable: false
    }
  })
  return runtime as IsolatedDevBrowserBridgeRuntime
}

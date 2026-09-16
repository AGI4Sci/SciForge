import { once } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import {
  createDevBrowserBridgeRuntime,
  type DevBrowserBridgeRuntime
} from './dev-bridge-runtime'

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:5174'
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
  const bridgeUrl = normalizeBridgeUrl(options.bridgeUrl ?? process.env.SCIFORGE_DEV_BRIDGE_URL ?? DEFAULT_BRIDGE_URL)
  const fetchImpl = options.fetch ?? fetch
  const startupTimeoutMs = Math.max(1_000, options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS)
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'sciforge-capability-eval-user-data-'))
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
        SCIFORGE_DEV_INSTANCE_ID: instanceId,
        SCIFORGE_DEV_BROWSER_BRIDGE: '1',
        PAPER_RADAR_USER_DATA: userDataDirectory,
        PAPER_RADAR_DB: join(userDataDirectory, 'paper-radar', 'paper-radar.sqlite'),
        PAPER_RADAR_PROFILES: join(userDataDirectory, 'paper-radar', 'profiles.json')
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
    return {
      ...runtime,
      isolatedUserDataDirectory: userDataDirectory,
      isolatedInstanceId: instanceId,
      close: async () => {
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
        try {
          await rm(userDataDirectory, { recursive: true, force: true })
        } catch (error) {
          closeError ??= error
        }
        if (closeError) throw closeError
      }
    }
  } catch (error) {
    await terminateChild(child).catch(() => undefined)
    await rm(userDataDirectory, { recursive: true, force: true }).catch(() => undefined)
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
    await waitForExit(child, SHUTDOWN_TIMEOUT_MS).catch(() => undefined)
  }
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

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs))
}

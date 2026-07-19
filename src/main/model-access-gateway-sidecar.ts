import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { modelRouterManifest } from '../../packages/workers/model-router/src/manifest'
import {
  PLAN_GATEWAY_DEFAULT_HOST,
  PLAN_GATEWAY_DEFAULT_PORT,
  PLAN_GATEWAY_WORKER_ID
} from '../../packages/workers/plan-gateway/src/manifest'

export type ModelAccessGatewayMode = 'model-router' | 'plan-gateway'

export type ModelAccessGatewayLaunchSpec = {
  mode: ModelAccessGatewayMode
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
  signature: string
  instanceId: string
  healthUrl: string
  startMessage: string
  logLabel: string
  prepare?: () => Promise<void>
  waitReady?: (fetchImpl: typeof fetch) => Promise<void>
}

export type ModelAccessGatewaySidecarOptions = {
  userDataDir?: string
  spawnImpl?: typeof spawn
  fetchImpl?: typeof fetch
  killProcessImpl?: typeof process.kill
  isProcessAliveImpl?: (pid: number) => boolean
  recordedStopTimeoutMs?: number
  log?: (message: string) => void
}

type ManagedChild = {
  child: ChildProcess
  spec: ModelAccessGatewayLaunchSpec
  statePath: string
}

type RecordedState = {
  pid?: unknown
  instanceId?: unknown
  mode?: unknown
  healthUrl?: unknown
  signatureHash?: unknown
}

const STATE_DIRECTORY = 'model-access-gateway'
const STATE_FILE = 'sidecar-state.json'
const STOP_TIMEOUT_MS = 2_000
const RECORDED_STOP_POLL_MS = 100

let managedChild: ManagedChild | null = null
let operationQueue = Promise.resolve()

export function modelAccessGatewayStatePath(userDataDir: string): string {
  return join(userDataDir, STATE_DIRECTORY, STATE_FILE)
}

export function modelAccessGatewaySignatureHash(signature: string): string {
  return createHash('sha256').update(signature).digest('hex')
}

export function synchronizeModelAccessGatewaySidecar(
  spec: ModelAccessGatewayLaunchSpec | null,
  options: ModelAccessGatewaySidecarOptions & { userDataDir: string }
): Promise<void> {
  return enqueue(async () => {
    if (!spec) {
      await stopInternal(options)
      return
    }

    if (isManagedChildRunning() && managedChild?.spec.mode === spec.mode && managedChild.spec.signature === spec.signature) {
      return
    }

    if (isManagedChildRunning()) {
      options.log?.(`${spec.logLabel} sidecar launch settings changed; restarting sidecar.`)
      await stopInternal(options)
    }

    await stopRecordedSidecar(options, spec)
    await spec.prepare?.()

    const spawnImpl = options.spawnImpl ?? spawn
    const useShell = spec.command.toLowerCase().endsWith('.cmd')
    const spawnArgs = useShell ? spec.args.map(quoteWindowsShellArg) : spec.args
    options.log?.(spec.startMessage)
    const child = spawnImpl(spec.command, spawnArgs, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell: useShell
    })
    const statePath = modelAccessGatewayStatePath(options.userDataDir)
    managedChild = { child, spec, statePath }
    try {
      await writeManagedState(statePath, child, spec)
    } catch (error) {
      managedChild = null
      if (isChildRunning(child)) await terminateChild(child)
      throw error
    }
    attachChildLogging(child, spec.logLabel, options.log)
    child.once('error', (error) => {
      if (managedChild?.child !== child) return
      managedChild = null
      void rm(statePath, { force: true }).catch(() => undefined)
      options.log?.(`${spec.logLabel} sidecar failed to start: ${error.message}`)
    })
    child.once('exit', (code, signal) => {
      if (managedChild?.child !== child) return
      managedChild = null
      void rm(statePath, { force: true }).catch(() => undefined)
      if (code !== 0 || signal) {
        options.log?.(`${spec.logLabel} sidecar exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`)
      }
    })

    try {
      await spec.waitReady?.(options.fetchImpl ?? fetch)
    } catch (error) {
      if (managedChild?.child === child) await stopInternal(options)
      throw error
    }
  })
}

export function stopModelAccessGatewaySidecar(
  options: ModelAccessGatewaySidecarOptions & { legacyStatePaths?: readonly string[] }
): Promise<void> {
  return enqueue(() => stopInternal(options))
}

function enqueue(task: () => Promise<void>): Promise<void> {
  const next = operationQueue.then(task, task)
  operationQueue = next.catch(() => undefined)
  return next
}

async function stopInternal(
  options: ModelAccessGatewaySidecarOptions & { legacyStatePaths?: readonly string[] }
): Promise<void> {
  const current = managedChild
  managedChild = null
  if (current && isChildRunning(current.child)) await terminateChild(current.child)
  if (current) await rm(current.statePath, { force: true })
  await stopRecordedSidecar(options)
}

async function stopRecordedSidecar(
  options: ModelAccessGatewaySidecarOptions & { legacyStatePaths?: readonly string[] },
  expectedSpec?: ModelAccessGatewayLaunchSpec
): Promise<void> {
  const statePaths = new Set([
    ...(options.userDataDir ? [modelAccessGatewayStatePath(options.userDataDir)] : []),
    ...(options.userDataDir
      ? [
          join(options.userDataDir, 'model-router', 'sidecar-state.json'),
          join(options.userDataDir, 'plan-gateway', 'sidecar-state.json')
        ]
      : []),
    ...(options.legacyStatePaths ?? [])
  ])
  for (const statePath of statePaths) {
    const state = await readRecordedState(statePath)
    if (!state) continue
    const pid = validPid(state.pid)
    const instanceId = typeof state.instanceId === 'string' ? state.instanceId.trim() : ''
    const healthUrl = typeof state.healthUrl === 'string' ? state.healthUrl.trim() : ''
    const inferredMode = state.mode === 'model-router' || state.mode === 'plan-gateway'
      ? state.mode
      : statePath.includes('plan-gateway')
        ? 'plan-gateway'
        : statePath.includes('model-router')
          ? 'model-router'
          : null
    const inferredHealthUrl = healthUrl || (inferredMode === 'plan-gateway'
      ? `http://${PLAN_GATEWAY_DEFAULT_HOST}:${PLAN_GATEWAY_DEFAULT_PORT}/healthz`
      : inferredMode === expectedSpec?.mode
        ? expectedSpec.healthUrl
        : '')
    if (pid && instanceId && inferredHealthUrl && inferredMode) {
      const healthy = await isRecordedInstanceHealthy(
        inferredMode,
        options.fetchImpl ?? fetch,
        inferredHealthUrl,
        instanceId
      )
      if (healthy) {
        try {
          (options.killProcessImpl ?? process.kill)(pid, 'SIGTERM')
          options.log?.(`Stopped a stale app-managed ${inferredMode} sidecar before launching the current runtime.`)
          const stopped = await waitForRecordedExit(
            pid,
            inferredMode,
            options.fetchImpl ?? fetch,
            inferredHealthUrl,
            instanceId,
            options.isProcessAliveImpl,
            options.recordedStopTimeoutMs
          )
          if (!stopped) {
            try {
              (options.killProcessImpl ?? process.kill)(pid, 'SIGKILL')
              options.log?.(`Force-stopped a stale app-managed ${inferredMode} sidecar after graceful shutdown timed out.`)
            } catch {
              // The recorded process already exited.
            }
          }
        } catch {
          // The recorded process already exited.
        }
      }
    }
    await rm(statePath, { force: true })
  }
}

async function waitForRecordedExit(
  pid: number,
  mode: ModelAccessGatewayMode,
  fetchImpl: typeof fetch,
  healthUrl: string,
  instanceId: string,
  isProcessAliveImpl: ((pid: number) => boolean) | undefined,
  timeoutMs = STOP_TIMEOUT_MS
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [processAlive, ownsHealthEndpoint] = await Promise.all([
      isProcessAliveImpl ? isProcessAliveImpl(pid) : isProcessAlive(pid),
      isRecordedInstanceHealthy(
        mode,
        fetchImpl,
        healthUrl,
        instanceId,
        Math.min(1_500, Math.max(1, deadline - Date.now()))
      )
    ])
    // Health ownership is still probed for diagnostics, but it is not enough
    // to prove that the old PID released its listening socket.
    void ownsHealthEndpoint
    if (!processAlive) return true
    await delay(RECORDED_STOP_POLL_MS)
  }
  return false
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function isRecordedInstanceHealthy(
  mode: ModelAccessGatewayMode,
  fetchImpl: typeof fetch,
  healthUrl: string,
  instanceId: string,
  timeoutMs = 1_500
): Promise<boolean> {
  try {
    if (mode === 'model-router') {
      const response = await fetchImpl(healthUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!response.ok) return false
      const body = await response.json() as Record<string, unknown>
      return body.service === modelRouterManifest.workerId && body.instanceId === instanceId
    }
    const response = await fetchImpl(healthUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) return false
    const body = await response.json() as Record<string, unknown>
    return body.status === 'ok' && body.workerId === PLAN_GATEWAY_WORKER_ID && body.instanceId === instanceId
  } catch {
    return false
  }
}

async function readRecordedState(path: string): Promise<RecordedState | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as RecordedState
  } catch {
    return null
  }
}

async function writeManagedState(
  path: string,
  child: ChildProcess,
  spec: ModelAccessGatewayLaunchSpec
): Promise<void> {
  if (!child.pid) return
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify({
    pid: child.pid,
    instanceId: spec.instanceId,
    mode: spec.mode,
    healthUrl: spec.healthUrl,
    signatureHash: modelAccessGatewaySignatureHash(spec.signature)
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function isManagedChildRunning(): boolean {
  return Boolean(managedChild && isChildRunning(managedChild.child))
}

function isChildRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

async function terminateChild(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, STOP_TIMEOUT_MS)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

function attachChildLogging(
  child: ChildProcess,
  label: string,
  log: ((message: string) => void) | undefined
): void {
  if (!log) return
  child.stdout?.on('data', (chunk) => logChildChunk('stdout', chunk, label, log))
  child.stderr?.on('data', (chunk) => logChildChunk('stderr', chunk, label, log))
}

function logChildChunk(
  stream: 'stdout' | 'stderr',
  chunk: unknown,
  label: string,
  log: (message: string) => void
): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return
  log(`${label} sidecar ${stream}: ${normalized.slice(0, 1_000)}`)
}

function validPid(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 1 ? value : 0
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function quoteWindowsShellArg(arg: string): string {
  if (arg.length > 0 && !/[\s"&|<>^()]/.test(arg)) return arg
  return `"${arg.replace(/"/g, '\\"')}"`
}

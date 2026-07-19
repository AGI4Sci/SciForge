import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSettingsV1 } from '../shared/app-settings'
import { PLAN_GATEWAY_BASE_URL, resolvePlanGatewayRuntime } from './plan-gateway-config'
import { checkPlanGatewayHealth, isManagedPlanGatewayInstance } from './plan-gateway-health'
import { resolveModelAccessSidecarProcessLaunch } from './model-access-sidecar-launch'
import { createBuiltInPlanAdapterRegistry } from '../../packages/workers/plan-gateway/src/adapters'
import { PLAN_GATEWAY_PROXY_RULES_ENV } from '../../packages/workers/plan-gateway/src/proxy'

const PLAN_GATEWAY_INSTANCE_ID_ENV = 'SCIFORGE_PLAN_GATEWAY_INSTANCE_ID'
const DEFAULT_READY_TIMEOUT_MS = 10_000

let planGatewayChild: ChildProcess | null = null
let planGatewayLaunchSignature: string | null = null
let planGatewayStatePath: string | null = null

export type PlanGatewaySidecarLaunch = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
  adapterId: string
  baseUrl: string
  instanceId: string
  proxyFingerprint: string
}

export type PlanGatewaySidecarLaunchResult =
  | { ok: true; launch: PlanGatewaySidecarLaunch }
  | { ok: false; reason: string }

export function buildPlanGatewaySidecarLaunch(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    appRoot?: string
    resourcesPath?: string
    execPath?: string
    isPackaged?: boolean
    env?: NodeJS.ProcessEnv
    npmCommand?: string
    instanceId?: string
    proxyRules?: string
  }
): PlanGatewaySidecarLaunchResult {
  const runtime = resolvePlanGatewayRuntime(settings)
  if (!runtime) {
    return { ok: false, reason: 'Plan Gateway starts only when Coding Plan access is selected with an adapter.' }
  }

  const instanceId = options.instanceId ?? randomUUID()
  const launchEnv: NodeJS.ProcessEnv = {
    ...(options.env ?? process.env),
    [PLAN_GATEWAY_INSTANCE_ID_ENV]: instanceId,
    SCIFORGE_PLAN_GATEWAY_USER_DATA_DIR: options.userDataDir
  }
  const proxyRules = options.proxyRules?.trim()
  if (proxyRules) launchEnv[PLAN_GATEWAY_PROXY_RULES_ENV] = proxyRules

  const processLaunch = resolveModelAccessSidecarProcessLaunch('plan-gateway', [
    '--host',
    runtime.host,
    '--port',
    String(runtime.port),
    '--mount-path',
    runtime.mountPath,
    '--adapter',
    runtime.adapterId,
    '--quiet'
  ], {
    appRoot: options.appRoot,
    resourcesPath: options.resourcesPath,
    execPath: options.execPath,
    isPackaged: options.isPackaged,
    npmCommand: options.npmCommand,
    env: launchEnv
  })
  return {
    ok: true,
    launch: {
      ...processLaunch,
      adapterId: runtime.adapterId,
      baseUrl: runtime.baseUrl,
      instanceId,
      proxyFingerprint: proxyFingerprint(launchEnv)
    }
  }
}

export async function ensurePlanGatewaySidecar(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    appRoot?: string
    resourcesPath?: string
    execPath?: string
    isPackaged?: boolean
    env?: NodeJS.ProcessEnv
    spawnImpl?: typeof spawn
    fetchImpl?: typeof fetch
    readyTimeoutMs?: number
    resolveProxy?: (url: string) => Promise<string>
    log?: (message: string) => void
  }
): Promise<void> {
  const proxyRules = await resolvePlanGatewayProxyRules(settings, options)
  const launchResult = buildPlanGatewaySidecarLaunch(settings, { ...options, proxyRules })
  if (!launchResult.ok) {
    options.log?.(launchResult.reason)
    await stopPlanGatewaySidecar({
      userDataDir: options.userDataDir,
      fetchImpl: options.fetchImpl,
      log: options.log
    })
    return
  }

  const launch = launchResult.launch
  const signature = managedLaunchSignature(launch)
  if (isPlanGatewayChildRunning()) {
    if (planGatewayLaunchSignature === signature) return
    options.log?.('Plan Gateway launch settings changed; restarting sidecar.')
    await stopPlanGatewaySidecar()
  }

  await stopRecordedPlanGatewaySidecar(options.userDataDir, options.fetchImpl, options.log)

  const spawnImpl = options.spawnImpl ?? spawn
  const useShell = launch.command.toLowerCase().endsWith('.cmd')
  const spawnArgs = useShell ? launch.args.map(quoteWindowsShellArg) : launch.args
  options.log?.(`Starting Plan Gateway sidecar for adapter ${launch.adapterId}.`)
  planGatewayChild = spawnImpl(launch.command, spawnArgs, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    shell: useShell
  })
  planGatewayLaunchSignature = signature
  planGatewayStatePath = statePath(options.userDataDir)
  const child = planGatewayChild
  if (child.pid) {
    await mkdir(join(options.userDataDir, 'plan-gateway'), { recursive: true })
    await writeFile(planGatewayStatePath, `${JSON.stringify({
      pid: child.pid,
      instanceId: launch.instanceId,
      signature
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  attachChildLogging(child, options.log)
  child.once('error', (error) => {
    options.log?.(`Plan Gateway failed to start: ${error.message}`)
  })
  child.once('exit', (code, signal) => {
    if (planGatewayChild !== child) return
    planGatewayChild = null
    planGatewayLaunchSignature = null
    if (code !== 0 || signal) {
      options.log?.(`Plan Gateway exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`)
    }
  })

  try {
    await waitForPlanGatewayHealth(
      settings,
      launch.instanceId,
      options.fetchImpl,
      options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    )
  } catch (error) {
    if (planGatewayChild === child) await stopPlanGatewaySidecar()
    throw error
  }
}

export async function stopPlanGatewaySidecar(options: {
  userDataDir?: string
  fetchImpl?: typeof fetch
  killProcessImpl?: typeof process.kill
  log?: (message: string) => void
} = {}): Promise<void> {
  const child = planGatewayChild
  planGatewayChild = null
  planGatewayLaunchSignature = null
  if (child && child.exitCode === null && child.signalCode === null) {
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
  if (planGatewayStatePath) {
    await rm(planGatewayStatePath, { force: true })
    planGatewayStatePath = null
  }
  if (options.userDataDir) {
    await stopRecordedPlanGatewaySidecar(
      options.userDataDir,
      options.fetchImpl,
      options.log,
      options.killProcessImpl
    )
  }
}

async function waitForPlanGatewayHealth(
  settings: AppSettingsV1,
  instanceId: string,
  fetchImpl: typeof fetch | undefined,
  timeoutMs: number
): Promise<void> {
  const startedAt = Date.now()
  let lastMessage = 'Plan Gateway is unavailable'
  while (Date.now() - startedAt < timeoutMs) {
    const health = await checkPlanGatewayHealth(settings, {
      fetchImpl,
      expectedInstanceId: instanceId,
      timeoutMs: Math.min(timeoutMs, 1_000)
    })
    if (health.ok) return
    lastMessage = health.message
    await delay(100)
  }
  throw new Error(`${lastMessage}; Plan Gateway did not become ready within ${timeoutMs}ms.`)
}

async function stopRecordedPlanGatewaySidecar(
  userDataDir: string,
  fetchImpl?: typeof fetch,
  log?: (message: string) => void,
  killProcessImpl: typeof process.kill = process.kill
): Promise<void> {
  const path = statePath(userDataDir)
  let state: { pid?: unknown; instanceId?: unknown }
  try {
    state = JSON.parse(await readFile(path, 'utf8')) as { pid?: unknown; instanceId?: unknown }
  } catch {
    return
  }
  const pid = typeof state.pid === 'number' && Number.isInteger(state.pid) && state.pid > 1 ? state.pid : 0
  const instanceId = typeof state.instanceId === 'string' ? state.instanceId.trim() : ''
  if (!pid || !instanceId) {
    await rm(path, { force: true })
    return
  }
  const ownsRecordedProcess = await isManagedPlanGatewayInstance(PLAN_GATEWAY_BASE_URL, instanceId, {
    fetchImpl,
    timeoutMs: 1_000
  })
  if (ownsRecordedProcess) {
    try {
      killProcessImpl(pid, 'SIGTERM')
      log?.('Stopped a stale app-managed Plan Gateway before launching the current sidecar.')
    } catch {
      // The recorded process already exited.
    }
  }
  await rm(path, { force: true })
}

function statePath(userDataDir: string): string {
  return join(userDataDir, 'plan-gateway', 'sidecar-state.json')
}

function isPlanGatewayChildRunning(): boolean {
  return Boolean(planGatewayChild && planGatewayChild.exitCode === null && planGatewayChild.signalCode === null)
}

function managedLaunchSignature(launch: PlanGatewaySidecarLaunch): string {
  return JSON.stringify({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    adapterId: launch.adapterId,
    baseUrl: launch.baseUrl,
    proxyFingerprint: launch.proxyFingerprint
  })
}

async function resolvePlanGatewayProxyRules(
  settings: AppSettingsV1,
  options: {
    env?: NodeJS.ProcessEnv
    resolveProxy?: (url: string) => Promise<string>
    log?: (message: string) => void
  }
): Promise<string | undefined> {
  const env = options.env ?? process.env
  if (hasExplicitProxyEnvironment(env) || !options.resolveProxy) return undefined
  const runtime = resolvePlanGatewayRuntime(settings)
  if (!runtime) return undefined
  const upstreamBaseUrl = createBuiltInPlanAdapterRegistry().get(runtime.adapterId).upstreamBaseUrl
  try {
    return (await options.resolveProxy(upstreamBaseUrl)).trim() || 'DIRECT'
  } catch (error) {
    options.log?.(`Could not resolve the operating-system proxy; Plan Gateway will use environment proxy settings or direct access. (${error instanceof Error ? error.message : String(error)})`)
    return undefined
  }
}

function hasExplicitProxyEnvironment(env: NodeJS.ProcessEnv): boolean {
  return [
    PLAN_GATEWAY_PROXY_RULES_ENV,
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy'
  ].some((name) => Boolean(env[name]?.trim()))
}

function proxyFingerprint(env: NodeJS.ProcessEnv): string {
  const values = [
    PLAN_GATEWAY_PROXY_RULES_ENV,
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
    'NO_PROXY',
    'no_proxy'
  ].map((name) => `${name}=${env[name] ?? ''}`).join('\n')
  return createHash('sha256').update(values).digest('hex')
}

function quoteWindowsShellArg(arg: string): string {
  if (arg.length > 0 && !/[\s"&|<>^()]/.test(arg)) return arg
  return `"${arg.replace(/"/g, '\\"')}"`
}

function attachChildLogging(child: ChildProcess, log: ((message: string) => void) | undefined): void {
  if (!log) return
  child.stdout?.on('data', (chunk) => logChildChunk('stdout', chunk, log))
  child.stderr?.on('data', (chunk) => logChildChunk('stderr', chunk, log))
}

function logChildChunk(stream: 'stdout' | 'stderr', chunk: unknown, log: (message: string) => void): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized) log(`Plan Gateway ${stream}: ${normalized.slice(0, 1_000)}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

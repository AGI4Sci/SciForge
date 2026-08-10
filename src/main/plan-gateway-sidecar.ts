import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AppSettingsV1 } from '../shared/app-settings'
import { resolvePlanGatewayRuntime } from './plan-gateway-config'
import { checkPlanGatewayHealth } from './plan-gateway-health'
import { resolveModelAccessSidecarProcessLaunch } from './model-access-sidecar-launch'
import { createBuiltInPlanAdapterRegistry } from '../../packages/workers/plan-gateway/src/adapters'
import { PLAN_GATEWAY_PROXY_RULES_ENV } from '../../packages/workers/plan-gateway/src/proxy'
import {
  stopModelAccessGatewaySidecar,
  synchronizeModelAccessGatewaySidecar,
  type ModelAccessGatewayLaunchSpec
} from './model-access-gateway-sidecar'

const PLAN_GATEWAY_INSTANCE_ID_ENV = 'SCIFORGE_PLAN_GATEWAY_INSTANCE_ID'
const DEFAULT_READY_TIMEOUT_MS = 10_000

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
    platform?: NodeJS.Platform
    resolveProxy?: (url: string) => Promise<string>
    log?: (message: string) => void
  }
): Promise<void> {
  const proxyRules = await resolvePlanGatewayProxyRules(settings, options)
  const launchResult = buildPlanGatewayGatewayLaunchSpec(settings, { ...options, proxyRules })
  if (!launchResult.ok) {
    options.log?.(launchResult.reason)
    await synchronizeModelAccessGatewaySidecar(null, options)
    return
  }
  await synchronizeModelAccessGatewaySidecar(launchResult.spec, options)
}

type PlanGatewayGatewayLaunchSpecResult =
  | { ok: true; spec: ModelAccessGatewayLaunchSpec }
  | { ok: false; reason: string }

export function buildPlanGatewayGatewayLaunchSpec(
  settings: AppSettingsV1,
  options: Parameters<typeof buildPlanGatewaySidecarLaunch>[1] & { readyTimeoutMs?: number }
): PlanGatewayGatewayLaunchSpecResult {
  const launchResult = buildPlanGatewaySidecarLaunch(settings, options)
  if (!launchResult.ok) return launchResult
  const launch = launchResult.launch
  const signature = managedLaunchSignature(launch)
  return {
    ok: true,
    spec: {
      mode: 'plan-gateway',
      ...launch,
      signature,
      instanceId: launch.instanceId,
      healthUrl: `${launch.baseUrl.replace(/\/v1\/?$/, '')}/healthz`,
      startMessage: `Starting Plan Gateway sidecar for adapter ${launch.adapterId}.`,
      logLabel: 'Plan Gateway',
      waitReady: (fetchImpl) => waitForPlanGatewayHealth(
        settings,
        launch.instanceId,
        fetchImpl,
        options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
      )
    }
  }
}

export async function stopPlanGatewaySidecar(options: {
  userDataDir?: string
  fetchImpl?: typeof fetch
  killProcessImpl?: typeof process.kill
  killProcessTreeImpl?: (pid: number) => Promise<void>
  platform?: NodeJS.Platform
  log?: (message: string) => void
} = {}): Promise<void> {
  await stopModelAccessGatewaySidecar({
    ...options,
    legacyStatePaths: options.userDataDir
      ? [join(options.userDataDir, 'plan-gateway', 'sidecar-state.json')]
      : undefined
  })
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

import type { AppSettingsV1 } from '../shared/app-settings'
import type { ModelAccessWireProtocol } from '../shared/sciforge-api'
import { PLAN_GATEWAY_WORKER_ID } from '../../packages/workers/plan-gateway/src/manifest'
import { resolvePlanGatewayRuntime } from './plan-gateway-config'

export type PlanGatewayHealthResult =
  | {
      ok: true
      status: 'healthy'
      message: string
      baseUrl: string
      adapterId: string
      protocol: ModelAccessWireProtocol
      traceCaptureReady: boolean
    }
  | {
      ok: false
      status: 'not_configured' | 'unavailable' | 'wrong_service' | 'wrong_adapter'
      message: string
    }

type PlanGatewayHealthBody = {
  status?: unknown
  workerId?: unknown
  adapterId?: unknown
  instanceId?: unknown
  protocol?: unknown
  traceCapture?: unknown
}

export async function isManagedPlanGatewayInstance(
  baseUrl: string,
  expectedInstanceId: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<boolean> {
  try {
    const response = await (options.fetchImpl ?? fetch)(planGatewayHealthUrl(baseUrl), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 2_000)
    })
    if (!response.ok) return false
    const body = await response.json() as PlanGatewayHealthBody
    return body.status === 'ok' &&
      body.workerId === PLAN_GATEWAY_WORKER_ID &&
      body.instanceId === expectedInstanceId
  } catch {
    return false
  }
}

export async function checkPlanGatewayHealth(
  settings: AppSettingsV1,
  options: {
    fetchImpl?: typeof fetch
    expectedInstanceId?: string
    timeoutMs?: number
  } = {}
): Promise<PlanGatewayHealthResult> {
  const runtime = resolvePlanGatewayRuntime(settings)
  if (!runtime) {
    return {
      ok: false,
      status: 'not_configured',
      message: 'Coding Plan access and a plan adapter are required'
    }
  }

  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(planGatewayHealthUrl(runtime.baseUrl), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 2_000)
    })
    if (!response.ok) {
      return { ok: false, status: 'unavailable', message: `Plan Gateway health returned HTTP ${response.status}` }
    }
    const body = await response.json() as PlanGatewayHealthBody
    if (body.status !== 'ok' || body.workerId !== PLAN_GATEWAY_WORKER_ID) {
      return { ok: false, status: 'wrong_service', message: 'The local port is not serving SciForge Plan Gateway' }
    }
    if (body.adapterId !== runtime.adapterId) {
      return { ok: false, status: 'wrong_adapter', message: 'Plan Gateway is running with a different adapter' }
    }
    const protocol = modelAccessWireProtocol(body.protocol)
    if (!protocol) {
      return { ok: false, status: 'wrong_service', message: 'Plan Gateway did not report a supported wire protocol' }
    }
    if (options.expectedInstanceId && body.instanceId !== options.expectedInstanceId) {
      return { ok: false, status: 'wrong_service', message: 'Plan Gateway belongs to a different SciForge process' }
    }
    return {
      ok: true,
      status: 'healthy',
      message: 'Plan Gateway is healthy',
      baseUrl: runtime.baseUrl,
      adapterId: runtime.adapterId,
      protocol,
      traceCaptureReady: body.traceCapture === 'ready'
    }
  } catch {
    return { ok: false, status: 'unavailable', message: 'Plan Gateway is unavailable' }
  }
}

function modelAccessWireProtocol(value: unknown): ModelAccessWireProtocol | null {
  return value === 'responses' || value === 'chat-completions' || value === 'anthropic-messages'
    ? value
    : null
}

function planGatewayHealthUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = '/healthz'
  url.search = ''
  url.hash = ''
  return url.toString()
}

export async function isPlanGatewayServiceHealthy(
  settings: AppSettingsV1,
  options: Parameters<typeof checkPlanGatewayHealth>[1] = {}
): Promise<boolean> {
  return (await checkPlanGatewayHealth(settings, options)).ok
}

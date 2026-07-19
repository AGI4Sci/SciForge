import { getModelAccessSettings, type AppSettingsV1 } from '../shared/app-settings'
import type {
  ModelAccessCredentialState,
  ModelAccessStatus
} from '../shared/sciforge-api'
import { resolveCodingPlanAdapter } from '../shared/coding-plan-adapters'
import type { AgentRuntimeAuxiliaryInput } from '../shared/agent-runtime-contract'
import {
  checkModelRouterHealth,
  type ModelRouterHealthResult
} from './model-router-health'
import {
  checkPlanGatewayHealth,
  type PlanGatewayHealthResult
} from './plan-gateway-health'

export async function getModelAccessStatus(
  settings: AppSettingsV1,
  options: {
    checkModelRouterHealthImpl?: (settings: AppSettingsV1) => Promise<ModelRouterHealthResult>
    checkPlanGatewayHealthImpl?: (settings: AppSettingsV1) => Promise<PlanGatewayHealthResult>
    getCodingPlanCredentialStateImpl?: (
      settings: AppSettingsV1,
      adapterId: string
    ) => Promise<ModelAccessCredentialState>
  } = {}
): Promise<ModelAccessStatus> {
  const access = getModelAccessSettings(settings)
  if (!access) {
    return {
      setupRequired: true,
      mode: null,
      service: null,
      health: 'not_configured',
      adapterId: null,
      credentialState: 'missing',
      protocol: null,
      protocolState: 'not-applicable',
      traceCaptureReady: false,
      action: 'Choose API access or Coding Plan access and save the model setup.'
    }
  }

  if (access.mode === 'api') {
    const result = await (options.checkModelRouterHealthImpl ?? checkModelRouterHealth)(settings)
    const credentialState = modelRouterCredentialState(result)
    return {
      setupRequired: !result.ok && result.status === 'not_configured',
      mode: 'api',
      service: 'model-router',
      health: modelRouterServiceHealth(result),
      adapterId: null,
      credentialState,
      protocol: result.protocol,
      protocolState: result.protocol ? 'cached' : 'pending-first-request',
      traceCaptureReady: result.traceCaptureReady,
      action: modelRouterActionableMessage(result)
    }
  }

  const adapterId = access.planAdapterId.trim()
  if (!adapterId) {
    return {
      setupRequired: true,
      mode: 'coding-plan',
      service: 'plan-gateway',
      health: 'not_configured',
      adapterId: null,
      credentialState: 'missing',
      protocol: null,
      protocolState: 'unknown',
      traceCaptureReady: false,
      action: 'Select a Coding Plan adapter and save the model setup.'
    }
  }

  const [result, credentialState] = await Promise.all([
    (options.checkPlanGatewayHealthImpl ?? checkPlanGatewayHealth)(settings),
    readCodingPlanCredentialState(settings, adapterId, options.getCodingPlanCredentialStateImpl)
  ])
  return {
    setupRequired:
      (!result.ok && result.status === 'not_configured') ||
      credentialState === 'missing' ||
      credentialState === 'unauthenticated',
    mode: 'coding-plan',
    service: 'plan-gateway',
    health: planGatewayServiceHealth(result),
    adapterId,
    credentialState,
    protocol: result.ok ? result.protocol : null,
    protocolState: result.ok ? 'selected' : 'unknown',
    traceCaptureReady: result.ok && result.traceCaptureReady,
    action: planGatewayActionableMessage(result, credentialState)
  }
}

export function codingPlanCredentialState(value: unknown): ModelAccessCredentialState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown'
  const result = value as Record<string, unknown>
  if (result.ok === false) return 'unknown'
  const body = result.value && typeof result.value === 'object' && !Array.isArray(result.value)
    ? result.value as Record<string, unknown>
    : result
  if (body.authenticated === true) return 'authenticated'
  if (body.authenticated === false) return 'unauthenticated'
  return 'unknown'
}

export async function codingPlanCredentialStateForAdapter(
  adapterId: string,
  auxiliary: (input: AgentRuntimeAuxiliaryInput) => Promise<unknown>
): Promise<ModelAccessCredentialState> {
  const adapter = resolveCodingPlanAdapter(adapterId)
  if (!adapter) return 'unknown'
  try {
    return codingPlanCredentialState(await auxiliary({
      runtimeId: adapter.runtimeId,
      operation: 'getCodingPlanAccount',
      payload: { refreshToken: true }
    }))
  } catch {
    return 'unknown'
  }
}

async function readCodingPlanCredentialState(
  settings: AppSettingsV1,
  adapterId: string,
  read?: (settings: AppSettingsV1, adapterId: string) => Promise<ModelAccessCredentialState>
): Promise<ModelAccessCredentialState> {
  if (!read) return 'unknown'
  try {
    return await read(settings, adapterId)
  } catch {
    return 'unknown'
  }
}

function modelRouterCredentialState(result: ModelRouterHealthResult): ModelAccessCredentialState {
  if (!result.ok && result.status === 'not_configured') return 'missing'
  if (!result.ok && result.status === 'provider_auth_blocked') return 'rejected'
  return 'configured'
}

function modelRouterServiceHealth(result: ModelRouterHealthResult): ModelAccessStatus['health'] {
  if (result.ok) return 'healthy'
  if (result.status === 'not_configured') return 'not_configured'
  if (result.status === 'unavailable' || result.status === 'provider_network') return 'unavailable'
  return 'error'
}

function modelRouterActionableMessage(result: ModelRouterHealthResult): string {
  if (result.ok) {
    if (!result.traceCaptureReady) return 'Restart SciForge to enable durable trace capture.'
    return result.protocol
      ? 'Model Router and trace capture are ready.'
      : 'Model Router and trace capture are ready. The wire protocol will be confirmed by the first real request.'
  }
  switch (result.status) {
    case 'not_configured':
      return 'Enter the Base URL, API key, and model name, then save the model setup.'
    case 'provider_auth_blocked':
      return 'Check the configured API key and try a real model request again.'
    case 'provider_network':
      return 'Check the Base URL and network connection, then try a real model request again.'
    case 'provider_bad_response':
      return 'Check that the Base URL exposes a supported model API, then try a real model request again.'
    case 'provider_error':
      return 'Check the model service status or quota, then try a real model request again.'
    case 'unavailable':
      return 'Model Router is unavailable. Restart SciForge and try again.'
  }
}

function planGatewayServiceHealth(result: PlanGatewayHealthResult): ModelAccessStatus['health'] {
  if (result.ok) return 'healthy'
  if (result.status === 'not_configured') return 'not_configured'
  if (result.status === 'unavailable') return 'unavailable'
  return 'error'
}

function planGatewayActionableMessage(
  result: PlanGatewayHealthResult,
  credentialState: ModelAccessCredentialState
): string {
  if (!result.ok) {
    switch (result.status) {
      case 'not_configured':
        return 'Select a Coding Plan adapter and save the model setup.'
      case 'wrong_adapter':
        return 'Plan Gateway is using a different adapter. Save the selected adapter again or restart SciForge.'
      case 'wrong_service':
        return 'Another local service is occupying the Plan Gateway endpoint. Close it or restart SciForge.'
      case 'unavailable':
        return 'Plan Gateway is unavailable. Restart SciForge and try again.'
    }
  }
  if (credentialState === 'unauthenticated' || credentialState === 'missing') {
    return 'Sign in with the selected Coding Plan account.'
  }
  if (credentialState === 'unknown') {
    return 'Refresh the Coding Plan account status.'
  }
  if (result.ok) {
    return result.traceCaptureReady
      ? 'Coding Plan access and trace capture are ready.'
      : 'Restart SciForge to enable durable trace capture.'
  }
  return 'Refresh the model access status.'
}

import { getModelAccessSettings, type AppSettingsV1 } from '../shared/app-settings'
import {
  PLAN_GATEWAY_DEFAULT_HOST,
  PLAN_GATEWAY_DEFAULT_MOUNT_PATH,
  PLAN_GATEWAY_DEFAULT_PORT
} from '../../packages/workers/plan-gateway/src/manifest'

export const PLAN_GATEWAY_HOST = PLAN_GATEWAY_DEFAULT_HOST
export const PLAN_GATEWAY_PORT = PLAN_GATEWAY_DEFAULT_PORT
export const PLAN_GATEWAY_MOUNT_PATH = PLAN_GATEWAY_DEFAULT_MOUNT_PATH
export const PLAN_GATEWAY_BASE_URL = `http://${PLAN_GATEWAY_HOST}:${PLAN_GATEWAY_PORT}${PLAN_GATEWAY_MOUNT_PATH}`

export type PlanGatewayRuntimeConfig = {
  adapterId: string
  host: string
  port: number
  mountPath: string
  baseUrl: string
}

export function resolvePlanGatewayRuntime(
  settings: AppSettingsV1
): PlanGatewayRuntimeConfig | null {
  const modelAccess = getModelAccessSettings(settings)
  if (modelAccess?.mode !== 'coding-plan') return null
  const adapterId = modelAccess.planAdapterId.trim()
  if (!adapterId) return null
  return {
    adapterId,
    host: PLAN_GATEWAY_HOST,
    port: PLAN_GATEWAY_PORT,
    mountPath: PLAN_GATEWAY_MOUNT_PATH,
    baseUrl: PLAN_GATEWAY_BASE_URL
  }
}

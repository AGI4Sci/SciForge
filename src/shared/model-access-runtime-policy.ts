import { getActiveAgentRuntime } from './app-settings-codex'
import { getModelAccessSettings } from './app-settings-model-router'
import type { AgentRuntimeId, AppSettingsV1 } from './app-settings-types'
import { resolveCodingPlanAdapter } from './coding-plan-adapters'

export type ModelAccessRuntimePolicy = Readonly<{
  mode: 'api' | 'coding-plan' | null
  activeRuntime: AgentRuntimeId
  planAdapterId: string | null
  sciforge: boolean
  codex: boolean
  claude: boolean
}>

export function resolveModelAccessRuntimePolicy(
  settings: AppSettingsV1
): ModelAccessRuntimePolicy {
  const access = getModelAccessSettings(settings)
  const activeRuntime = getActiveAgentRuntime(settings)
  if (access?.mode === 'api') {
    return {
      mode: 'api',
      activeRuntime,
      planAdapterId: null,
      sciforge: false,
      codex: activeRuntime === 'codex',
      claude: activeRuntime === 'claude'
    }
  }

  const planAdapterId = access?.mode === 'coding-plan'
    ? access.planAdapterId.trim()
    : ''
  const planRuntime = planAdapterId
    ? resolveCodingPlanAdapter(planAdapterId)?.runtimeId
    : undefined
  const selectedPlanRuntime = planRuntime === activeRuntime ? planRuntime : undefined
  return {
    mode: access?.mode ?? null,
    activeRuntime,
    planAdapterId: planAdapterId || null,
    sciforge: false,
    codex: selectedPlanRuntime === 'codex',
    claude: false
  }
}

export function modelAccessRuntimePolicyChanged(
  previous: AppSettingsV1,
  next: AppSettingsV1
): boolean {
  const a = resolveModelAccessRuntimePolicy(previous)
  const b = resolveModelAccessRuntimePolicy(next)
  return a.mode !== b.mode
    || a.activeRuntime !== b.activeRuntime
    || a.planAdapterId !== b.planAdapterId
}

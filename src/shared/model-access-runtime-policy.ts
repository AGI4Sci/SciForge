import { getActiveAgentRuntime } from './app-settings-codex'
import { getModelAccessSettings } from './app-settings-model-router'
import type { AgentRuntimeId, AppSettingsV1 } from './app-settings-types'
import { resolveCodingPlanAdapter } from './coding-plan-adapters'

export type ModelAccessRuntimePolicy = Readonly<{
  mode: 'api' | 'coding-plan' | null
  activeRuntime: AgentRuntimeId
  planAdapterId: string | null
  codex: boolean
  claude: boolean
  dsh: boolean
  pi: boolean
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
      codex: activeRuntime === 'codex',
      claude: activeRuntime === 'claude',
      dsh: activeRuntime === 'dsh',
      // Pi authenticates models through its own configuration, not through
      // SciForge plan-backed model access; keep that access closed.
      pi: false
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
    codex: selectedPlanRuntime === 'codex',
    // DSH has no coding-plan adapter yet; keep it closed until the runtime
    // capability statement confirms plan-backed model access.
    claude: false,
    dsh: false,
    pi: false
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

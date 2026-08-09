import type {
  AgentCapabilitySettingsPatchV1,
  AgentCapabilitySettingsV1,
  AppSettingsV1
} from './app-settings-types'

const DEFAULT_SUBAGENT_MAX_PARALLEL = 2
export const MAX_SUBAGENT_MAX_PARALLEL = 64

export function defaultAgentCapabilitySettings(): AgentCapabilitySettingsV1 {
  return {
    subagents: {
      enabled: true,
      maxParallel: DEFAULT_SUBAGENT_MAX_PARALLEL
    }
  }
}

export function normalizeAgentCapabilitySettings(
  input: AgentCapabilitySettingsPatchV1 | undefined
): AgentCapabilitySettingsV1 {
  const defaults = defaultAgentCapabilitySettings()
  return {
    subagents: {
      enabled: input?.subagents?.enabled !== false,
      maxParallel: boundedPositiveInt(
        input?.subagents?.maxParallel,
        defaults.subagents.maxParallel,
        MAX_SUBAGENT_MAX_PARALLEL
      )
    }
  }
}

export function mergeAgentCapabilitySettings(
  current: AgentCapabilitySettingsV1 | undefined,
  patch: AgentCapabilitySettingsPatchV1 | undefined
): AgentCapabilitySettingsV1 {
  const normalizedCurrent = normalizeAgentCapabilitySettings(current)
  return normalizeAgentCapabilitySettings({
    subagents: {
      ...normalizedCurrent.subagents,
      ...(patch?.subagents ?? {})
    }
  })
}

export function getAgentCapabilitySettings(settings: AppSettingsV1): AgentCapabilitySettingsV1 {
  return normalizeAgentCapabilitySettings(settings.agentCapabilities)
}

function boundedPositiveInt(value: unknown, fallback: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(numberValue) || numberValue <= 0) return fallback
  return Math.min(numberValue, max)
}

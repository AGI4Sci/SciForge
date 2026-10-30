import type {
  AgentRuntimeId,
  AppSettingsV1,
  ComputerUseSettingsPatchV1,
  ComputerUseSettingsV1
} from './app-settings-types'

export const DEFAULT_COMPUTER_USE_BACKEND = 'gui-owl'

export function defaultComputerUseSettings(): ComputerUseSettingsV1 {
  return {
    enabled: true,
    runtimeEnabled: defaultComputerUseRuntimeEnabled()
  }
}

export function normalizeComputerUseSettings(
  input: ComputerUseSettingsPatchV1 | undefined
): ComputerUseSettingsV1 {
  return {
    enabled: input?.enabled !== false,
    runtimeEnabled: normalizeComputerUseRuntimeEnabled(input?.runtimeEnabled)
  }
}

export function mergeComputerUseSettings(
  current: ComputerUseSettingsV1 | undefined,
  patch: ComputerUseSettingsPatchV1 | undefined
): ComputerUseSettingsV1 {
  const normalizedCurrent = normalizeComputerUseSettings(current)
  return normalizeComputerUseSettings({
    ...normalizedCurrent,
    ...(patch ?? {}),
    runtimeEnabled: {
      ...normalizedCurrent.runtimeEnabled,
      ...(patch?.runtimeEnabled ?? {})
    }
  })
}

export function getComputerUseSettings(settings: AppSettingsV1): ComputerUseSettingsV1 {
  return normalizeComputerUseSettings(settings.computerUse)
}

export function isComputerUseEnabledForRuntime(
  settings: AppSettingsV1,
  runtimeId: AgentRuntimeId
): boolean {
  const computerUse = getComputerUseSettings(settings)
  return computerUse.enabled && computerUse.runtimeEnabled[runtimeId] !== false
}

function defaultComputerUseRuntimeEnabled(): Record<AgentRuntimeId, boolean> {
  return {
    codex: true,
    claude: true,
    dsh: false,
    // Pi runs conversations and governed research tools through its own
    // process; it has no computer-use surface, so it must not receive
    // computer-use tools. Mirror the hard-disabled dsh pattern.
    pi: false
  }
}

function normalizeComputerUseRuntimeEnabled(
  input: ComputerUseSettingsPatchV1['runtimeEnabled'] | undefined
): Record<AgentRuntimeId, boolean> {
  const defaults = defaultComputerUseRuntimeEnabled()
  return {
    codex: input?.codex !== false && defaults.codex,
    claude: input?.claude !== false && defaults.claude,
    dsh: input?.dsh === true && defaults.dsh,
    pi: input?.pi === true && defaults.pi
  }
}

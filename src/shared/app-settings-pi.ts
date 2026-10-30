import {
  type AppSettingsV1,
  type AgentRuntimeSettingsEnvelopePatchV1,
  type PiRuntimeSettingsPatchV1,
  type PiRuntimeSettingsV1
} from './app-settings-types'

// Settings for the Pi coding agent harness. Empty values mean "let discovery
// decide". Conversation-stage execution is text-only: all tools stay disabled
// at launch until approval and lease governance land, so no tool, permission,
// or model-execution options exist here yet.
const DEFAULT_PI_COMMAND = 'pi'
const DEFAULT_PI_EXECUTABLE_PATH = ''

export function defaultPiRuntimeSettings(): PiRuntimeSettingsV1 {
  return {
    command: DEFAULT_PI_COMMAND,
    executablePath: DEFAULT_PI_EXECUTABLE_PATH
  }
}

export function getPiRuntimeSettings(settings: AppSettingsV1): PiRuntimeSettingsV1 {
  return mergePiRuntimeSettings(
    defaultPiRuntimeSettings(),
    (settings as { agents?: { pi?: PiRuntimeSettingsPatchV1 } }).agents?.pi
  )
}

export function piSettingsPatch(
  pi: PiRuntimeSettingsPatchV1 | undefined
): AgentRuntimeSettingsEnvelopePatchV1 {
  return pi ? { pi } : {}
}

export function mergePiRuntimeSettings(
  current: PiRuntimeSettingsV1,
  patch: PiRuntimeSettingsPatchV1 | undefined
): PiRuntimeSettingsV1 {
  return normalizePiRuntimeSettings({ ...current, ...(patch ?? {}) })
}

export function withPiRuntimeSettings(
  settings: AppSettingsV1,
  pi: PiRuntimeSettingsV1
): AppSettingsV1 {
  return {
    ...settings,
    agents: {
      ...settings.agents,
      pi
    }
  }
}

export function applyPiRuntimePatch(
  settings: AppSettingsV1,
  patch: PiRuntimeSettingsPatchV1 | undefined
): AppSettingsV1 {
  return withPiRuntimeSettings(
    settings,
    mergePiRuntimeSettings(getPiRuntimeSettings(settings), patch)
  )
}

function normalizePiRuntimeSettings(
  input: Partial<PiRuntimeSettingsV1> | undefined
): PiRuntimeSettingsV1 {
  const defaults = defaultPiRuntimeSettings()
  return {
    command: optionalString(input?.command) || defaults.command,
    executablePath: optionalString(input?.executablePath) || defaults.executablePath
  }
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

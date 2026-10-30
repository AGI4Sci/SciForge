import {
  type AppSettingsV1,
  type AgentRuntimeSettingsEnvelopePatchV1,
  type DshReasoningEffort,
  type DshRuntimeSettingsPatchV1,
  type DshRuntimeSettingsV1
} from './app-settings-types'

// Empty values mean "let the runtime default / discovery decide". The
// production DSH runtime path pins its executable to the packaged,
// release-verified artifact and selects the model through the Host
// ModelRouter, so these persisted selections are user-preference records
// only; the renderer surfaces them and the canonical engine may ignore them.
const DEFAULT_DSH_COMMAND = 'dsh'
const DEFAULT_DSH_EXECUTABLE_PATH = ''
const DEFAULT_DSH_SELECTED_MODEL = ''
const DEFAULT_DSH_REASONING_EFFORT: DshReasoningEffort = ''
// Fail-closed: a missing or unreadable value never enables the native shell.
const DEFAULT_DSH_COMMAND_EXECUTION = false

export function defaultDshRuntimeSettings(): DshRuntimeSettingsV1 {
  return {
    command: DEFAULT_DSH_COMMAND,
    executablePath: DEFAULT_DSH_EXECUTABLE_PATH,
    selectedModel: DEFAULT_DSH_SELECTED_MODEL,
    reasoningEffort: DEFAULT_DSH_REASONING_EFFORT,
    commandExecution: DEFAULT_DSH_COMMAND_EXECUTION
  }
}

/**
 * The one predicate for the DSH command-execution switch. Both consumers — the
 * capability matrix the UI reads and the reviewed launch composition in
 * @sciforge/dsh-runtime — derive from this, so what the UI reports and what the
 * launched deployment enables can never disagree.
 */
export function isDshCommandExecutionEnabled(settings: unknown): boolean {
  return getDshRuntimeSettings((settings ?? {}) as AppSettingsV1).commandExecution
}

export function getDshRuntimeSettings(settings: AppSettingsV1): DshRuntimeSettingsV1 {
  return mergeDshRuntimeSettings(
    defaultDshRuntimeSettings(),
    (settings as { agents?: { dsh?: DshRuntimeSettingsPatchV1 } }).agents?.dsh
  )
}

export function dshSettingsPatch(
  dsh: DshRuntimeSettingsPatchV1 | undefined
): AgentRuntimeSettingsEnvelopePatchV1 {
  return dsh ? { dsh } : {}
}

export function mergeDshRuntimeSettings(
  current: DshRuntimeSettingsV1,
  patch: DshRuntimeSettingsPatchV1 | undefined
): DshRuntimeSettingsV1 {
  return normalizeDshRuntimeSettings({ ...current, ...(patch ?? {}) })
}

export function withDshRuntimeSettings(
  settings: AppSettingsV1,
  dsh: DshRuntimeSettingsV1
): AppSettingsV1 {
  return {
    ...settings,
    agents: {
      ...settings.agents,
      dsh
    }
  }
}

export function applyDshRuntimePatch(
  settings: AppSettingsV1,
  patch: DshRuntimeSettingsPatchV1 | undefined
): AppSettingsV1 {
  return withDshRuntimeSettings(
    settings,
    mergeDshRuntimeSettings(getDshRuntimeSettings(settings), patch)
  )
}

function normalizeDshRuntimeSettings(
  input: Partial<DshRuntimeSettingsV1> | undefined
): DshRuntimeSettingsV1 {
  const defaults = defaultDshRuntimeSettings()
  return {
    command: optionalString(input?.command) || defaults.command,
    executablePath: optionalString(input?.executablePath) || defaults.executablePath,
    selectedModel: optionalString(input?.selectedModel) || defaults.selectedModel,
    reasoningEffort: optionalString(input?.reasoningEffort) || defaults.reasoningEffort,
    commandExecution: input?.commandExecution === true
  }
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

import type {
  WorkbenchToolbarSettingsPatchV1,
  WorkbenchToolbarSettingsV1
} from './app-settings-types'

export const WORKBENCH_TOOLBAR_MAX_COMMANDS = 256
export const WORKBENCH_TOOLBAR_COMMAND_ID_MAX_LENGTH = 256

export function defaultWorkbenchToolbarSettings(): WorkbenchToolbarSettingsV1 {
  return {
    hiddenCommandIds: [],
    commandOrder: []
  }
}

export function normalizeWorkbenchToolbarSettings(
  input?: WorkbenchToolbarSettingsPatchV1 | null
): WorkbenchToolbarSettingsV1 {
  return {
    hiddenCommandIds: normalizeCommandIds(input?.hiddenCommandIds),
    commandOrder: normalizeCommandIds(input?.commandOrder)
  }
}

export function mergeWorkbenchToolbarSettings(
  current?: WorkbenchToolbarSettingsV1,
  patch?: WorkbenchToolbarSettingsPatchV1
): WorkbenchToolbarSettingsV1 {
  return normalizeWorkbenchToolbarSettings({
    hiddenCommandIds: patch?.hiddenCommandIds ?? current?.hiddenCommandIds,
    commandOrder: patch?.commandOrder ?? current?.commandOrder
  })
}

function normalizeCommandIds(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const commandId = raw.trim()
    if (!commandId || commandId.length > WORKBENCH_TOOLBAR_COMMAND_ID_MAX_LENGTH) continue
    if (seen.has(commandId)) continue
    seen.add(commandId)
    result.push(commandId)
    if (result.length >= WORKBENCH_TOOLBAR_MAX_COMMANDS) break
  }
  return result
}

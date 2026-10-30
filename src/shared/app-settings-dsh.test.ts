import { describe, expect, it } from 'vitest'
import { normalizeAgentRuntimeId, normalizeAppSettings, type AppSettingsV1 } from './app-settings'
import { applyDshRuntimePatch, defaultDshRuntimeSettings, isDshCommandExecutionEnabled } from './app-settings-dsh'

describe('independent DSH runtime settings', () => {
  it('preserves explicit dsh selection without reviving legacy DeepSeek', () => {
    expect(normalizeAgentRuntimeId('dsh')).toBe('dsh')
    expect(normalizeAgentRuntimeId(undefined)).toBe('codex')
    expect(normalizeAgentRuntimeId('deepseek-runtime')).toBe('codex')
  })
  it('normalizes an independent command without changing Codex or Claude', () => {
    const settings = normalizeAppSettings({ activeAgentRuntime: 'dsh', agents: {
      dsh: { command: ' /opt/dsh ' }, codex: { command: '/opt/codex' }, claude: { command: '/opt/claude' }
    } } as unknown as AppSettingsV1)
    expect(settings.activeAgentRuntime).toBe('dsh')
    expect(settings.agents.dsh).toEqual({
      command: '/opt/dsh',
      executablePath: '',
      selectedModel: '',
      reasoningEffort: '',
      commandExecution: false
    })
    expect(settings.agents.codex?.command).toBe('/opt/codex')
    expect(settings.agents.claude?.command).toBe('/opt/claude')
  })
  it('keeps the reviewed shell switch fail-closed and only accepts an explicit opt-in', () => {
    // Fail-closed by default: absent, malformed or inherited values never enable.
    expect(defaultDshRuntimeSettings().commandExecution).toBe(false)
    expect(isDshCommandExecutionEnabled(undefined)).toBe(false)
    expect(isDshCommandExecutionEnabled({})).toBe(false)
    expect(isDshCommandExecutionEnabled({ agents: { dsh: { commandExecution: 'yes' } } })).toBe(false)
    expect(isDshCommandExecutionEnabled({ agents: { dsh: { commandExecution: 1 } } })).toBe(false)
    // An explicit true is the only thing that enables it, and normalization
    // preserves it while dropping everything else malformed.
    expect(isDshCommandExecutionEnabled({ agents: { dsh: { commandExecution: true } } })).toBe(true)
    const normalized = normalizeAppSettings({ agents: { dsh: { commandExecution: true, command: ' /opt/dsh ' } } } as unknown as AppSettingsV1)
    expect(normalized.agents.dsh).toEqual({
      command: '/opt/dsh',
      executablePath: '',
      selectedModel: '',
      reasoningEffort: '',
      commandExecution: true
    })
    // The reviewed patch path carries the switch without disturbing the rest.
    expect(applyDshRuntimePatch(normalizeAppSettings({} as AppSettingsV1), { commandExecution: true }).agents.dsh?.commandExecution).toBe(true)
  })
})

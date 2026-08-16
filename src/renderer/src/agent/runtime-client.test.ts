import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from './runtime-client'

function settings(apiKey: string): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    modelRouter: {
      ...defaultModelRouterSettings(),
      runtimeApiKey: apiKey
    },
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    skills: defaultSkillsSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('rendererRuntimeClient', () => {
  it('caches settings reads until invalidated', async () => {
    const getSettings = vi.fn(async () => settings('sk-1'))
    vi.stubGlobal('window', {
      sciforge: {
        getSettings,
        setSettings: vi.fn(),
        codex: {},
        forbiddenDirectCall: vi.fn(),
      }
    })

    const first = await rendererRuntimeClient.getSettings()
    const second = await rendererRuntimeClient.getSettings()

    expect(first.modelRouter?.runtimeApiKey).toBe('sk-1')
    expect(second.modelRouter?.runtimeApiKey).toBe('sk-1')
    expect(getSettings).toHaveBeenCalledTimes(1)
  })

  it('refreshes the cache after setSettings', async () => {
    const getSettings = vi.fn(async () => settings('sk-1'))
    const setSettings = vi.fn(async () => settings('sk-2'))
    vi.stubGlobal('window', {
      sciforge: {
        getSettings,
        setSettings,
        codex: {},
        forbiddenDirectCall: vi.fn(),
      }
    })

    await rendererRuntimeClient.getSettings()
    const next = await rendererRuntimeClient.setSettings({ workspaceRoot: '/tmp/next' })
    const cached = await rendererRuntimeClient.getSettings()

    expect(next.modelRouter?.runtimeApiKey).toBe('sk-2')
    expect(cached.modelRouter?.runtimeApiKey).toBe('sk-2')
    expect(getSettings).toHaveBeenCalledTimes(1)
    expect(setSettings).toHaveBeenCalledTimes(1)
  })

})

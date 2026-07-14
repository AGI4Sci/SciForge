import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultRemoteChannelSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  resolveScheduleModelConfig,
  waitForAssistantTextViaRuntime,
  type ScheduleRuntimeDeps
} from './schedule-runtime-helpers'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: {
      ...defaultModelRouterSettings(),
      publicModelAlias: 'router-public-alias',
      runtimeApiKey: 'local-runtime-router-key'
    },
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('resolveScheduleModelConfig', () => {
  it('uses the Model Router public alias instead of task or workflow model names', () => {
    expect(resolveScheduleModelConfig(settings(), {
      providerId: 'legacy-provider',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high'
    })).toEqual({
      providerId: 'legacy-provider',
      model: 'router-public-alias',
      reasoningEffort: 'high'
    })
  })
})

describe('waitForAssistantTextViaRuntime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts a completed tool-driven turn with no assistant text', async () => {
    vi.useFakeTimers()
    const readThread = vi.fn(async () => ({
      turns: [{ id: 'turn-1', status: 'completed', items: [] }]
    }))
    const deps = {
      agentRuntime: { readThread }
    } as unknown as ScheduleRuntimeDeps

    const result = waitForAssistantTextViaRuntime(deps, 'sciforge', 'thread-1', 'turn-1', 30_000)
    await vi.advanceTimersByTimeAsync(1_500)

    await expect(result).resolves.toBe('')
    expect(readThread).toHaveBeenCalledOnce()
  })
})

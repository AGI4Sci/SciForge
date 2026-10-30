import { describe, expect, it } from 'vitest'
import {
  normalizeAppSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { coerceRendererSettings, mergeSettings } from './settings-utils'

function settings(modelAccess?: AppSettingsV1['modelAccess']): AppSettingsV1 {
  return normalizeAppSettings({
    ...(modelAccess ? { modelAccess } : {}),
    locale: 'en'
  } as AppSettingsV1)
}

describe('renderer model access settings', () => {
  it('preserves Coding Plan selection across unrelated edits', () => {
    const next = mergeSettings(
      settings({ mode: 'coding-plan', planAdapterId: 'codex' }),
      { locale: 'zh' }
    )

    expect(next.locale).toBe('zh')
    expect(next.modelAccess).toEqual({ mode: 'coding-plan', planAdapterId: 'codex' })
  })

  it('merges access-mode edits without discarding the selected adapter', () => {
    const next = mergeSettings(
      settings({ mode: 'coding-plan', planAdapterId: 'codex' }),
      { modelAccess: { mode: 'api' } }
    )

    expect(next.modelAccess).toEqual({ mode: 'api', planAdapterId: 'codex' })
  })

  it('keeps missing access settings setup-required', () => {
    expect(coerceRendererSettings(settings()).modelAccess).toBeUndefined()
  })

  it('preserves Workbench toolbar preferences across unrelated settings edits', () => {
    const current = {
      ...settings(),
      workbenchToolbar: {
        hiddenCommandIds: ['paper-radar.open'],
        commandOrder: ['remote-ssh.open', 'paper-radar.open']
      }
    }
    const next = mergeSettings(current, { locale: 'zh' })

    expect(next.workbenchToolbar).toEqual(current.workbenchToolbar)
  })

  it('round-trips the performance mode flag through coerce and merge', () => {
    const enabled = mergeSettings(settings(), { performanceMode: true })
    expect(enabled.performanceMode).toBe(true)
    expect(coerceRendererSettings(enabled).performanceMode).toBe(true)

    const preserved = mergeSettings(enabled, { locale: 'zh' })
    expect(preserved.performanceMode).toBe(true)
  })

  it('applies Pi runtime patches and preserves them across unrelated edits', () => {
    const patched = mergeSettings(settings(), {
      activeAgentRuntime: 'pi',
      agents: { pi: { command: 'C:\\tools\\pi.cmd' } }
    })
    expect(patched.activeAgentRuntime).toBe('pi')
    expect(patched.agents.pi?.command).toBe('C:\\tools\\pi.cmd')

    const preserved = mergeSettings(patched, { locale: 'zh' })
    expect(preserved.agents.pi?.command).toBe('C:\\tools\\pi.cmd')
    expect(preserved.activeAgentRuntime).toBe('pi')

    const coerced = coerceRendererSettings(preserved)
    expect(coerced.agents.pi?.command).toBe('C:\\tools\\pi.cmd')
    expect(coerced.activeAgentRuntime).toBe('pi')
  })
})

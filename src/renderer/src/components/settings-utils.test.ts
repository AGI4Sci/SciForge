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
})

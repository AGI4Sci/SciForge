import { describe, expect, it } from 'vitest'

import { normalizeAppSettings, type AppSettingsV1 } from '../shared/app-settings'
import {
  MODEL_ROUTER_RUNTIME_API_KEY_ENV,
  resolveRuntimeModelRouterSettings
} from './runtime-model-router-settings'

describe('process-scoped Model Router settings', () => {
  it('prefers the process runtime API key without mutating persisted settings', () => {
    const settings = normalizeAppSettings({} as AppSettingsV1)
    settings.modelRouter!.runtimeApiKey = 'persisted-runtime-key'

    expect(resolveRuntimeModelRouterSettings(settings, {
      [MODEL_ROUTER_RUNTIME_API_KEY_ENV]: 'ephemeral-runtime-key'
    }).apiKey).toBe('ephemeral-runtime-key')
    expect(settings.modelRouter?.runtimeApiKey).toBe('persisted-runtime-key')
  })

  it('falls back to the persisted key when the process override is absent', () => {
    const settings = normalizeAppSettings({} as AppSettingsV1)
    settings.modelRouter!.runtimeApiKey = 'persisted-runtime-key'

    expect(resolveRuntimeModelRouterSettings(settings, {}).apiKey).toBe('persisted-runtime-key')
  })
})

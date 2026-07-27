import { describe, expect, it } from 'vitest'
import {
  CurrentTraceSensitiveSettings,
  traceSensitiveValuesFromSettings
} from './trace-sensitive-settings'

describe('CurrentTraceSensitiveSettings', () => {
  it('collects secret fields generically without treating provider or protocol labels as secrets', () => {
    expect(traceSensitiveValuesFromSettings({
      modelRouter: {
        apiKey: 'api-secret',
        runtimeToken: 'runtime-secret',
        model: 'coding-model',
        protocol: 'responses'
      },
      nested: { password: ' password-secret ' }
    })).toEqual(expect.arrayContaining(['api-secret', 'runtime-secret', 'password-secret']))
    expect(traceSensitiveValuesFromSettings({ protocol: 'responses', provider: 'generic' })).toEqual([])
  })

  it('keeps one synchronous closure current across settings changes', () => {
    const current = new CurrentTraceSensitiveSettings({ apiKey: 'old-secret' })
    const provider = current.values

    expect(provider()).toEqual(['old-secret'])
    current.update({ apiKey: 'new-secret' })
    expect(provider()).toEqual(['new-secret'])
  })
})

import { describe, expect, it } from 'vitest'
import { providerSupportsCapability } from './chat-store-provider-capabilities'

describe('providerSupportsCapability', () => {
  it('treats missing capability fields as available during runtime migration', () => {
    expect(providerSupportsCapability({}, 'steer')).toBe(true)
    expect(providerSupportsCapability({ getCapabilities: () => ({}) }, 'steer')).toBe(true)
  })

  it('only disables a capability when the provider reports explicit false', () => {
    expect(providerSupportsCapability({ getCapabilities: () => ({ steer: false }) }, 'steer')).toBe(false)
    expect(providerSupportsCapability({ getCapabilities: () => ({ steer: true }) }, 'steer')).toBe(true)
  })
})

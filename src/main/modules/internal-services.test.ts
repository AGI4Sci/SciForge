import { describe, expect, it } from 'vitest'

import { HostInternalServiceRegistry } from './internal-services'

describe('Host internal services', () => {
  it('derives provider and consumer owners and rejects non-allowlisted acquisition', () => {
    const registry = new HostInternalServiceRegistry()
    const connector = registry.forOwner({
      moduleId: 'sciforge.opencontent-connector',
      moduleVersion: '1.0.0'
    })
    const adapter = registry.forOwner({
      moduleId: 'sciforge.opencontent-content-space-provider',
      moduleVersion: '1.0.0'
    })
    const foreign = registry.forOwner({
      moduleId: 'sciforge.foreign',
      moduleVersion: '1.0.0'
    })
    const service = Object.freeze({ listRoots: async () => [] })

    expect(() => adapter.acquire('opencontent.content-space', '1.0.0')).toThrow(
      'unavailable'
    )
    connector.register({
      serviceId: 'opencontent.content-space',
      contractVersion: '1.0.0',
      allowedConsumerModuleIds: ['sciforge.opencontent-content-space-provider'],
      service
    })

    expect(adapter.acquire('opencontent.content-space', '1.0.0')).toBe(service)
    expect(() => foreign.acquire('opencontent.content-space', '1.0.0')).toThrow(
      'not authorized'
    )
    expect(() => connector.register({
      serviceId: 'opencontent.content-space',
      contractVersion: '1.0.0',
      allowedConsumerModuleIds: ['sciforge.opencontent-content-space-provider'],
      service: {}
    })).toThrow('already registered')
  })
})

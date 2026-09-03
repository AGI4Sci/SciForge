import { describe, expect, it } from 'vitest'
import type { InstalledMainDomainContribution } from '@sciforge/domain-sdk/main'

import { HostInternalServiceRegistry } from './internal-services'

describe('Host internal services', () => {
  it('derives provider and consumer owners and rejects non-allowlisted acquisition', () => {
    const registry = registryWithDescriptor()
    const connector = registry.forOwner({
      moduleId: 'sciforge.document-provider',
      moduleVersion: '1.0.0'
    })
    const adapter = registry.forOwner({
      moduleId: 'sciforge.document-provider',
      moduleVersion: '1.0.0'
    })
    const foreign = registry.forOwner({
      moduleId: 'sciforge.foreign',
      moduleVersion: '1.0.0'
    })
    const service = Object.freeze({ listRoots: async () => [] })

    expect(() => adapter.acquire('document-provider.service', '1.0.0')).toThrow(
      'unavailable'
    )
    connector.register({
      serviceId: 'document-provider.service',
      contractVersion: '1.0.0',
      allowedConsumerModuleIds: ['sciforge.document-provider'],
      service
    })

    expect(adapter.acquire('document-provider.service', '1.0.0')).toBe(service)
    expect(() => foreign.acquire('document-provider.service', '1.0.0')).toThrow(
      'not authorized'
    )
    expect(() => connector.register({
      serviceId: 'document-provider.service',
      contractVersion: '1.0.0',
      allowedConsumerModuleIds: ['sciforge.document-provider'],
      service: {}
    })).toThrow('already registered')
    registry.assertComplete()
  })

  it('rejects undeclared, wrong-owner, incompatible, and policy-drifted implementations', () => {
    const empty = new HostInternalServiceRegistry()
    expect(() => empty.forOwner(connectorOwner).register(registration()))
      .toThrow('no declared descriptor')

    const wrongOwner = registryWithDescriptor()
    expect(() => wrongOwner.forOwner({
      moduleId: 'sciforge.impersonator',
      moduleVersion: '1.0.0'
    }).register(registration())).toThrow('does not own')

    const wrongVersion = registryWithDescriptor()
    expect(() => wrongVersion.forOwner(connectorOwner).register(registration({
      contractVersion: '2.0.0'
    }))).toThrow('incompatible contract version')

    const wrongPolicy = registryWithDescriptor()
    expect(() => wrongPolicy.forOwner(connectorOwner).register(registration({
      allowedConsumerModuleIds: ['sciforge.impersonator']
    }))).toThrow('consumer policy does not match')
  })

  it('rejects duplicate descriptors and missing implementations', () => {
    expect(() => new HostInternalServiceRegistry([
      descriptorContribution(),
      descriptorContribution({
        contributionId: 'fixture.duplicate-service',
        provider: { moduleId: 'sciforge.other-provider', moduleVersion: '1.0.0' }
      })
    ])).toThrow('descriptor is duplicated')

    expect(() => registryWithDescriptor().assertComplete())
      .toThrow('no registered implementation')
  })

  it('is load-order independent because acquisition resolves only after registration', () => {
    const registry = registryWithDescriptor()
    const adapter = registry.forOwner(adapterOwner)
    expect(() => adapter.acquire('document-provider.service', '1.0.0'))
      .toThrow('unavailable')
    const service = Object.freeze({ listRoots: async () => [] })
    registry.forOwner(connectorOwner).register(registration({ service }))
    registry.assertComplete()
    expect(adapter.acquire('document-provider.service', '1.0.0')).toBe(service)
  })

  it('keeps Connector registration valid without the adapter and exposes no adapter-only fallback', () => {
    const connectorOnly = registryWithDescriptor()
    connectorOnly.forOwner(connectorOwner).register(registration())
    expect(() => connectorOnly.assertComplete()).not.toThrow()

    const adapterOnly = new HostInternalServiceRegistry()
    expect(() => adapterOnly.forOwner(adapterOwner).acquire(
      'document-provider.service',
      '1.0.0'
    )).toThrow('unavailable')
  })
})

const connectorOwner = Object.freeze({
  moduleId: 'sciforge.document-provider',
  moduleVersion: '1.0.0'
})
const adapterOwner = Object.freeze({
  moduleId: 'sciforge.document-provider',
  moduleVersion: '1.0.0'
})

function registryWithDescriptor(): HostInternalServiceRegistry {
  return new HostInternalServiceRegistry([descriptorContribution()])
}

function registration(overrides: Partial<{
  contractVersion: string
  allowedConsumerModuleIds: readonly string[]
  service: object
}> = {}) {
  return {
    serviceId: 'document-provider.service',
    contractVersion: overrides.contractVersion ?? '1.0.0',
    allowedConsumerModuleIds: overrides.allowedConsumerModuleIds ?? [adapterOwner.moduleId],
    service: overrides.service ?? {}
  }
}

function descriptorContribution(input: Readonly<{
  contributionId?: string
  provider?: Readonly<{ moduleId: string; moduleVersion: string }>
}> = {}): InstalledMainDomainContribution {
  const owner = input.provider ?? connectorOwner
  const id = input.contributionId ?? 'fixture.document-service'
  return Object.freeze({
    process: 'main',
    packageName: '@fixture/document-service',
    entrypoint: './main',
    declaration: Object.freeze({
      id,
      kind: 'main.extension',
      version: '1.0.0',
      priority: 100
    }),
    contract: Object.freeze({
      location: 'main.internal-service-descriptor',
      serviceId: 'document-provider.service',
      contractVersion: '1.0.0',
      allowedConsumerModuleIds: [adapterOwner.moduleId]
    }),
    owner
  })
}

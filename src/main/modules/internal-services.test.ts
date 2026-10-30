import { describe, expect, it } from 'vitest'
import type { InstalledMainDomainContribution } from '@sciforge/domain-sdk/main'

import { HostInternalServiceRegistry } from './internal-services'

describe('Host internal services', () => {
  it('derives provider and consumer owners and rejects non-allowlisted acquisition', () => {
    const registry = registryWithDescriptor()
    const provider = registry.forOwner({
      moduleId: 'sciforge.content-space',
      moduleVersion: '1.0.0'
    })
    const consumer = registry.forOwner({
      moduleId: 'sciforge.siyuan-content-space-provider',
      moduleVersion: '1.0.0'
    })
    const foreign = registry.forOwner({
      moduleId: 'sciforge.foreign',
      moduleVersion: '1.0.0'
    })
    const service = Object.freeze({ listRoots: async () => [] })

    expect(() => consumer.acquire('content-space.provider-service', '1.0.0')).toThrow(
      'unavailable'
    )
    provider.register({
      serviceId: 'content-space.provider-service',
      contractVersion: '1.0.0',
      allowedConsumerModuleIds: ['sciforge.siyuan-content-space-provider'],
      service
    })

    expect(consumer.acquire('content-space.provider-service', '1.0.0')).toBe(service)
    expect(() => foreign.acquire('content-space.provider-service', '1.0.0')).toThrow(
      'not authorized'
    )
    expect(() => provider.register({
      serviceId: 'content-space.provider-service',
      contractVersion: '1.0.0',
      allowedConsumerModuleIds: ['sciforge.siyuan-content-space-provider'],
      service: {}
    })).toThrow('already registered')
    registry.assertComplete()
  })

  it('rejects undeclared, wrong-owner, incompatible, and policy-drifted implementations', () => {
    const empty = new HostInternalServiceRegistry()
    expect(() => empty.forOwner(providerOwner).register(registration()))
      .toThrow('no declared descriptor')

    const wrongOwner = registryWithDescriptor()
    expect(() => wrongOwner.forOwner({
      moduleId: 'sciforge.impersonator',
      moduleVersion: '1.0.0'
    }).register(registration())).toThrow('does not own')

    const wrongVersion = registryWithDescriptor()
    expect(() => wrongVersion.forOwner(providerOwner).register(registration({
      contractVersion: '2.0.0'
    }))).toThrow('incompatible contract version')

    const wrongPolicy = registryWithDescriptor()
    expect(() => wrongPolicy.forOwner(providerOwner).register(registration({
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
    const consumer = registry.forOwner(consumerOwner)
    expect(() => consumer.acquire('content-space.provider-service', '1.0.0'))
      .toThrow('unavailable')
    const service = Object.freeze({ listRoots: async () => [] })
    registry.forOwner(providerOwner).register(registration({ service }))
    registry.assertComplete()
    expect(consumer.acquire('content-space.provider-service', '1.0.0')).toBe(service)
  })

  it('keeps provider registration valid without the consumer and exposes no consumer-only fallback', () => {
    const providerOnly = registryWithDescriptor()
    providerOnly.forOwner(providerOwner).register(registration())
    expect(() => providerOnly.assertComplete()).not.toThrow()

    const consumerOnly = new HostInternalServiceRegistry()
    expect(() => consumerOnly.forOwner(consumerOwner).acquire(
      'content-space.provider-service',
      '1.0.0'
    )).toThrow('unavailable')
  })
})

const providerOwner = Object.freeze({
  moduleId: 'sciforge.content-space',
  moduleVersion: '1.0.0'
})
const consumerOwner = Object.freeze({
  moduleId: 'sciforge.siyuan-content-space-provider',
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
    serviceId: 'content-space.provider-service',
    contractVersion: overrides.contractVersion ?? '1.0.0',
    allowedConsumerModuleIds: overrides.allowedConsumerModuleIds ?? [consumerOwner.moduleId],
    service: overrides.service ?? {}
  }
}

function descriptorContribution(input: Readonly<{
  contributionId?: string
  provider?: Readonly<{ moduleId: string; moduleVersion: string }>
}> = {}): InstalledMainDomainContribution {
  const owner = input.provider ?? providerOwner
  const id = input.contributionId ?? 'fixture.provider-service'
  return Object.freeze({
    process: 'main',
    packageName: '@fixture/provider-service',
    entrypoint: './main',
    declaration: Object.freeze({
      id,
      kind: 'main.extension',
      version: '1.0.0',
      priority: 100
    }),
    contract: Object.freeze({
      location: 'main.internal-service-descriptor',
      serviceId: 'content-space.provider-service',
      contractVersion: '1.0.0',
      allowedConsumerModuleIds: [consumerOwner.moduleId]
    }),
    owner
  })
}

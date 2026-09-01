import type {
  DomainMainInternalServiceHost,
  DomainRuntimeContributionOwner
} from '@sciforge/domain-sdk/host'
import type {
  DomainMainPortableResourceReferencesHost
} from '@sciforge/domain-sdk/portable-resource-references'

export function createUnavailablePortableResourcesForTest(): (
  owner: DomainRuntimeContributionOwner
) => DomainMainPortableResourceReferencesHost {
  return () => Object.freeze({
    materialize: async () => {
      throw new Error('Portable resource materialization is unavailable in this test.')
    },
    discard: async () => {
      throw new Error('Portable resource discard is unavailable in this test.')
    },
    export: async () => {
      throw new Error('Portable resource export is unavailable in this test.')
    }
  })
}

export function createIsolatedInternalServicesForTest(): DomainMainInternalServiceHost {
  const services = new Map<string, Readonly<{ contractVersion: string; service: object }>>()
  return Object.freeze({
    register: (registration) => {
      services.set(registration.serviceId, Object.freeze({
        contractVersion: registration.contractVersion,
        service: registration.service
      }))
    },
    acquire: <Service extends object>(serviceId: string, contractVersion: string): Service => {
      const registered = services.get(serviceId)
      if (!registered || registered.contractVersion !== contractVersion) {
        throw new Error(`Internal service ${serviceId} is unavailable in this test.`)
      }
      return registered.service as Service
    }
  })
}

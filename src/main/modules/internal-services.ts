import type {
  DomainMainInternalServiceDescriptor,
  DomainMainInternalServiceHost,
  DomainMainInternalServiceRegistration,
  DomainRuntimeContributionOwner
} from '@sciforge/domain-sdk/host'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  domainMainInternalServiceDescriptorSchema
} from '@sciforge/domain-sdk/host'
import type { InstalledMainDomainContribution } from '@sciforge/domain-sdk/main'

type RegisteredService = Readonly<{
  provider: DomainRuntimeContributionOwner
  contractVersion: string
  allowedConsumerModuleIds: ReadonlySet<string>
  service: object
}>

type DeclaredService = Readonly<{
  provider: DomainRuntimeContributionOwner
  descriptor: DomainMainInternalServiceDescriptor
}>

export class HostInternalServiceRegistry {
  readonly #declarations = new Map<string, DeclaredService>()
  readonly #services = new Map<string, RegisteredService>()
  readonly #hosts = new Map<string, DomainMainInternalServiceHost>()

  constructor(contributions: readonly InstalledMainDomainContribution[] = []) {
    for (const contribution of contributions) {
      if (contribution.declaration.kind !== MAIN_EXTENSION_CONTRIBUTION_KIND) continue
      const parsed = domainMainInternalServiceDescriptorSchema.safeParse(contribution.contract)
      if (!parsed.success) continue
      const descriptor = Object.freeze({
        ...parsed.data,
        allowedConsumerModuleIds: Object.freeze([...parsed.data.allowedConsumerModuleIds].sort())
      })
      if (this.#declarations.has(descriptor.serviceId)) {
        throw new Error(`Internal service ${descriptor.serviceId} descriptor is duplicated.`)
      }
      this.#declarations.set(descriptor.serviceId, Object.freeze({
        provider: parseOwner(contribution.owner),
        descriptor
      }))
    }
  }

  forOwner(rawOwner: DomainRuntimeContributionOwner): DomainMainInternalServiceHost {
    const owner = parseOwner(rawOwner)
    const ownerKey = `${owner.moduleId}\u0000${owner.moduleVersion}`
    const existing = this.#hosts.get(ownerKey)
    if (existing) return existing
    const host: DomainMainInternalServiceHost = Object.freeze({
      register: <Service extends object>(rawRegistration:
      DomainMainInternalServiceRegistration<Service>): void => {
        const registration = parseRegistration(rawRegistration)
        const declaration = this.#declarations.get(registration.serviceId)
        if (!declaration) {
          throw new Error(`Internal service ${registration.serviceId} has no declared descriptor.`)
        }
        if (!sameOwner(declaration.provider, owner)) {
          throw new Error(`Package ${owner.moduleId} does not own internal service ${registration.serviceId}.`)
        }
        if (declaration.descriptor.contractVersion !== registration.contractVersion) {
          throw new Error(`Internal service ${registration.serviceId} implementation has an incompatible contract version.`)
        }
        if (!sameStrings(
          declaration.descriptor.allowedConsumerModuleIds,
          registration.allowedConsumerModuleIds
        )) {
          throw new Error(`Internal service ${registration.serviceId} consumer policy does not match its descriptor.`)
        }
        if (this.#services.has(registration.serviceId)) {
          throw new Error(`Internal service ${registration.serviceId} is already registered.`)
        }
        this.#services.set(registration.serviceId, Object.freeze({
          provider: owner,
          contractVersion: registration.contractVersion,
          allowedConsumerModuleIds: new Set(registration.allowedConsumerModuleIds),
          service: registration.service
        }))
      },
      acquire: <Service extends object>(rawServiceId: string, rawContractVersion: string): Service => {
        const serviceId = parseCanonicalId(rawServiceId, 'service ID')
        const contractVersion = parseVersion(rawContractVersion)
        const registration = this.#services.get(serviceId)
        if (!registration) throw new Error(`Internal service ${serviceId} is unavailable.`)
        if (registration.contractVersion !== contractVersion) {
          throw new Error(`Internal service ${serviceId} has an incompatible contract version.`)
        }
        if (!registration.allowedConsumerModuleIds.has(owner.moduleId)) {
          throw new Error(`Package ${owner.moduleId} is not authorized for internal service ${serviceId}.`)
        }
        return registration.service as Service
      }
    })
    this.#hosts.set(ownerKey, host)
    return host
  }

  assertComplete(): void {
    for (const serviceId of this.#declarations.keys()) {
      if (!this.#services.has(serviceId)) {
        throw new Error(`Internal service ${serviceId} has no registered implementation.`)
      }
    }
  }
}

function parseRegistration<Service extends object>(
  registration: DomainMainInternalServiceRegistration<Service>
): Readonly<{
  serviceId: string
  contractVersion: string
  allowedConsumerModuleIds: readonly string[]
  service: Service
}> {
  if (!registration || typeof registration !== 'object' || Array.isArray(registration)) {
    throw new TypeError('Internal service registration is invalid.')
  }
  const keys = Object.keys(registration).sort()
  if (keys.join(',') !== 'allowedConsumerModuleIds,contractVersion,service,serviceId') {
    throw new TypeError('Internal service registration fields are invalid.')
  }
  if (!registration.service || typeof registration.service !== 'object' ||
    Array.isArray(registration.service)) {
    throw new TypeError('Internal service implementation must be an object.')
  }
  const allowed = [...new Set(registration.allowedConsumerModuleIds.map((value) =>
    parseCanonicalId(value, 'consumer module ID')
  ))].sort()
  if (allowed.length === 0 || allowed.length !== registration.allowedConsumerModuleIds.length) {
    throw new TypeError('Internal service consumers must be a non-empty unique list.')
  }
  return Object.freeze({
    serviceId: parseCanonicalId(registration.serviceId, 'service ID'),
    contractVersion: parseVersion(registration.contractVersion),
    allowedConsumerModuleIds: Object.freeze(allowed),
    service: registration.service
  })
}

function parseOwner(owner: DomainRuntimeContributionOwner): DomainRuntimeContributionOwner {
  return Object.freeze({
    moduleId: parseCanonicalId(owner.moduleId, 'module ID'),
    moduleVersion: parseVersion(owner.moduleVersion)
  })
}

function sameOwner(
  left: DomainRuntimeContributionOwner,
  right: DomainRuntimeContributionOwner
): boolean {
  return left.moduleId === right.moduleId && left.moduleVersion === right.moduleVersion
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function parseCanonicalId(value: string, label: string): string {
  if (typeof value !== 'string' || value.length < 3 || value.length > 192 ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u.test(value)) {
    throw new TypeError(`Internal service ${label} is invalid.`)
  }
  return value
}

function parseVersion(value: string): string {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/u.test(value)) {
    throw new TypeError('Internal service contract version is invalid.')
  }
  return value
}

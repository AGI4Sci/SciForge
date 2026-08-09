import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import { defineTrustedMainDomainPackageEntry } from '@sciforge/domain-sdk/main'
import { domainPackageDefinition } from './definition.js'

export function createDomainMainEntry(
  _host: DomainMainHost
): TrustedDomainProcessEntryInput<never> {
  return defineTrustedMainDomainPackageEntry({
    definition: domainPackageDefinition,
    contributions: []
  })
}

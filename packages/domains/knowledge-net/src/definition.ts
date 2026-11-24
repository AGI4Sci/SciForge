import { defineTrustedDomainPackage, type TrustedDomainPackageDefinitionInput } from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }
export const domainPackageDefinition = defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const OPENCONTENT_CONTENT_SPACE_FACTORY_CONTRIBUTION = domainPackageDefinition
  .entrypoints.find((entrypoint) => entrypoint.process === 'main')!
  .contributions.find((contribution) =>
    contribution.id === 'opencontent-content-space.provider-factory'
  )!
export const OPENCONTENT_CONTENT_SPACE_FACTORY_CONTRACT = domainPackageDefinition
  .contributionContracts[OPENCONTENT_CONTENT_SPACE_FACTORY_CONTRIBUTION.id]!

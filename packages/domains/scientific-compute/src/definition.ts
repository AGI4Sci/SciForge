import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const SCIENTIFIC_COMPUTE_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const SCIENTIFIC_COMPUTE_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const SCIENTIFIC_COMPUTE_CAPABILITY_FACTORY_CONTRIBUTION = (() => {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === 'main')
    ?.contributions.find((candidate) => candidate.kind === 'main.capability-factory')
  if (!contribution) {
    throw new Error('Scientific Compute manifest is missing main.capability-factory.')
  }
  return contribution
})()

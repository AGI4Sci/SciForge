import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const LOCAL_MOCK_PROVIDER_KIND = 'sciforge-local-mock' as const
export const LOCAL_MOCK_PROVIDER_INSTANCE_REF = 'sciforge-content-space-local' as const
export const LOCAL_MOCK_PROVIDER_FACTORY_CONTRIBUTION = contributionById(
  'content-space-mock.provider-factory'
)
export const LOCAL_MOCK_PROVIDER_INSTANCE_CONTRIBUTION = contributionById(
  'content-space-mock.provider-instance'
)
export const LOCAL_MOCK_PROVIDER_FACTORY_CONTRACT = contractFor(
  LOCAL_MOCK_PROVIDER_FACTORY_CONTRIBUTION.id
)
export const LOCAL_MOCK_PROVIDER_INSTANCE_CONTRACT = contractFor(
  LOCAL_MOCK_PROVIDER_INSTANCE_CONTRIBUTION.id
)

function contributionById(id: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === 'main')
    ?.contributions.find((candidate) => candidate.id === id)
  if (!contribution) {
    throw new Error(`Content Space mock Provider manifest is missing main:${id}.`)
  }
  return contribution
}

function contractFor(id: string) {
  const contract = domainPackageDefinition.contributionContracts[id]
  if (!contract) {
    throw new Error(`Content Space mock Provider manifest is missing contract ${id}.`)
  }
  return contract
}

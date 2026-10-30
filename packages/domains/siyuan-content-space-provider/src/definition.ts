import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition = defineTrustedDomainPackage(
  manifest as TrustedDomainPackageDefinitionInput
)

export function mainContribution(id: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entry) => entry.process === 'main')?.contributions.find((entry) => entry.id === id)
  const contract = domainPackageDefinition.contributionContracts[id]
  if (!contribution || !contract) throw new Error('Missing SiYuan contribution contract.')
  return { ...contribution, contract }
}

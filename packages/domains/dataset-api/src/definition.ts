import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const DATASET_API_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const DATASET_API_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const DATASET_API_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main',
  'main.capability-factory'
)

export const DATASET_API_TIMELINE_RESULTS_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.chat-result-panel'
)

function contributionFor(process: 'main' | 'renderer', kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) throw new Error(`Dataset API manifest is missing ${process}:${kind}.`)
  return contribution
}

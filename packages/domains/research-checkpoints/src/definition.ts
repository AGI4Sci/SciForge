import {
  defineTrustedDomainPackage,
  type DomainPackageProcess,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const RESEARCH_CHECKPOINTS_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const RESEARCH_CHECKPOINTS_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const RESEARCH_CHECKPOINTS_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main',
  'main.capability-factory'
)
export const RESEARCH_CHECKPOINTS_RUNTIME_LIFECYCLE_CONTRIBUTION = contributionFor(
  'main',
  'main.runtime-lifecycle'
)
export const RESEARCH_CHECKPOINTS_RUNTIME_LIFECYCLE_CONTRACT =
  domainPackageDefinition.contributionContracts[
    RESEARCH_CHECKPOINTS_RUNTIME_LIFECYCLE_CONTRIBUTION.id
  ]!
export const RESEARCH_CHECKPOINTS_ARTIFACT_CONSUMER_CONTRIBUTION = contributionFor(
  'main',
  'main.artifact-consumer'
)
export const RESEARCH_CHECKPOINTS_CHAT_RESULT_PANEL_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.chat-result-panel'
)
export const RESEARCH_CHECKPOINTS_I18N_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.i18n-resource'
)

function contributionFor(process: DomainPackageProcess, kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) {
    throw new Error(`Research Checkpoints manifest is missing ${process}:${kind}.`)
  }
  return contribution
}

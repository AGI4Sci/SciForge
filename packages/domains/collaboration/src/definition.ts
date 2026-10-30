import {
  defineTrustedDomainPackage,
  type DomainPackageProcess,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const COLLABORATION_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const COLLABORATION_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const COLLABORATION_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main',
  'main.capability-factory'
)
export const COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION = contributionFor(
  'main',
  'main.runtime-lifecycle'
)
export const COLLABORATION_RUNTIME_LIFECYCLE_CONTRACT =
  domainPackageDefinition.contributionContracts[
    COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION.id
  ]!
export const COLLABORATION_COORDINATOR_CLOUD_COMMAND_CONTRIBUTION = contributionFor(
  'main',
  'main.extension',
  'collaboration.coordinator-cloud-command'
)
export const COLLABORATION_COORDINATOR_CLOUD_COMMAND_CONTRACT =
  domainPackageDefinition.contributionContracts[
    COLLABORATION_COORDINATOR_CLOUD_COMMAND_CONTRIBUTION.id
  ]!
export const COLLABORATION_WORKER_SESSION_PROJECTION_CONTRIBUTION = contributionFor(
  'main',
  'main.extension',
  'collaboration.worker-session-projection'
)
export const COLLABORATION_WORKER_SESSION_PROJECTION_CONTRACT =
  domainPackageDefinition.contributionContracts[
    COLLABORATION_WORKER_SESSION_PROJECTION_CONTRIBUTION.id
  ]!
export const COLLABORATION_MAIN_AREA_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.extension',
  'collaboration.workbench-main-area'
)
export const COLLABORATION_MAIN_AREA_CONTRACT =
  domainPackageDefinition.contributionContracts[
    COLLABORATION_MAIN_AREA_CONTRIBUTION.id
  ]!
export const COLLABORATION_COMPOSER_CONTEXT_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.composer-context-provider'
)
export const COLLABORATION_COMPOSER_CONTEXT_CONTRACT =
  domainPackageDefinition.contributionContracts[
    COLLABORATION_COMPOSER_CONTEXT_CONTRIBUTION.id
  ]!
export const COLLABORATION_CHAT_MESSAGE_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.chat-message'
)
export const COLLABORATION_CHAT_MESSAGE_CONTRACT =
  domainPackageDefinition.contributionContracts[
    COLLABORATION_CHAT_MESSAGE_CONTRIBUTION.id
  ]!
export const COLLABORATION_I18N_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.i18n-resource'
)

function contributionFor(process: DomainPackageProcess, kind: string, id?: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind && (!id || candidate.id === id))
  if (!contribution) {
    throw new Error(`Collaboration manifest is missing ${process}:${kind}.`)
  }
  return contribution
}

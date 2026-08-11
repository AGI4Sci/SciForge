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

export const DATASET_API_WORKFLOW_EXECUTION_RECEIPT_CONTRIBUTION = contributionFor(
  'main',
  'main.workflow-execution-receipt-provider'
)

export const DATASET_API_CREATE_LOOP_RESOURCE_EXECUTOR_CONTRIBUTION = contributionFor(
  'main',
  'main.extension'
)
export const DATASET_API_CREATE_LOOP_RESOURCE_EXECUTOR_CONTRACT =
  domainPackageDefinition.contributionContracts[
    DATASET_API_CREATE_LOOP_RESOURCE_EXECUTOR_CONTRIBUTION.id
  ]!

export const DATASET_API_TIMELINE_RESULTS_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.chat-result-panel'
)

export const DATASET_API_CREATE_LOOP_RESOURCES_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.extension'
)
export const DATASET_API_CREATE_LOOP_RESOURCES_CONTRACT =
  domainPackageDefinition.contributionContracts[
    DATASET_API_CREATE_LOOP_RESOURCES_CONTRIBUTION.id
  ]!

export const DATASET_API_RENDERER_I18N_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.i18n-resource'
)

function contributionFor(process: 'main' | 'renderer', kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) throw new Error(`Dataset API manifest is missing ${process}:${kind}.`)
  return contribution
}

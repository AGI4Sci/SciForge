import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const PROJECT_DAG_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const PROJECT_DAG_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const PROJECT_DAG_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main',
  'main.capability-factory'
)
export const PROJECT_DAG_RUNTIME_LIFECYCLE_CONTRIBUTION = contributionFor(
  'main',
  'main.runtime-lifecycle'
)
export const PROJECT_DAG_AGENT_ARTIFACT_CONSUMER_CONTRIBUTION = contributionFor(
  'main',
  'main.agent-artifact-consumer'
)
export const PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-right-panel'
)
export const PROJECT_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-toolbar-action'
)
export const PROJECT_DAG_RENDERER_TOOLBAR_ACTION_CONTRACT =
  domainPackageDefinition.contributionContracts[
    PROJECT_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  ]!
export const PROJECT_DAG_RENDERER_I18N_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.i18n-resource'
)

function contributionFor(process: 'main' | 'renderer', kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) {
    throw new Error(`Project DAG manifest is missing ${process}:${kind}.`)
  }
  return contribution
}

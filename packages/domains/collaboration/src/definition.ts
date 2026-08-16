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
export const COLLABORATION_RIGHT_PANEL_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-right-panel'
)
export const COLLABORATION_RIGHT_PANEL_CONTRACT =
  domainPackageDefinition.contributionContracts[
    COLLABORATION_RIGHT_PANEL_CONTRIBUTION.id
  ]!
export const COLLABORATION_OPEN_COMMAND_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.command'
)
export const COLLABORATION_TOOLBAR_ACTION_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-toolbar-action'
)
export const COLLABORATION_TOOLBAR_ACTION_CONTRACT =
  domainPackageDefinition.contributionContracts[
    COLLABORATION_TOOLBAR_ACTION_CONTRIBUTION.id
  ]!
export const COLLABORATION_I18N_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.i18n-resource'
)

function contributionFor(process: DomainPackageProcess, kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) {
    throw new Error(`Collaboration manifest is missing ${process}:${kind}.`)
  }
  return contribution
}

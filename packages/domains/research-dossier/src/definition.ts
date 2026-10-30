import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const RESEARCH_DOSSIER_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const RESEARCH_DOSSIER_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION = contributionFor(
  'renderer.workbench-right-panel'
)
export const RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRACT =
  domainPackageDefinition.contributionContracts[
    RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  ]!
export const RESEARCH_DOSSIER_RENDERER_COMMAND_CONTRIBUTION = contributionFor(
  'renderer.command'
)
export const RESEARCH_DOSSIER_RENDERER_TOOLBAR_ACTION_CONTRIBUTION = contributionFor(
  'renderer.workbench-toolbar-action'
)
export const RESEARCH_DOSSIER_RENDERER_TOOLBAR_ACTION_CONTRACT =
  domainPackageDefinition.contributionContracts[
    RESEARCH_DOSSIER_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  ]!
export const RESEARCH_DOSSIER_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION = contributionFor(
  'renderer.resource-navigation'
)
export const RESEARCH_DOSSIER_RENDERER_RESOURCE_NAVIGATION_CONTRACT =
  domainPackageDefinition.contributionContracts[
    RESEARCH_DOSSIER_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION.id
  ]!
export const RESEARCH_DOSSIER_RENDERER_I18N_CONTRIBUTION = contributionFor(
  'renderer.i18n-resource'
)

function contributionFor(kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === 'renderer')
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) throw new Error(`Research Dossier manifest is missing renderer:${kind}.`)
  return contribution
}

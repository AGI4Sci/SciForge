import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const TERMINAL_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const TERMINAL_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const TERMINAL_RENDERER_COMMAND_CONTRIBUTION = contributionFor(
  'renderer.command'
)
export const TERMINAL_RENDERER_BOTTOM_PANEL_CONTRIBUTION = contributionFor(
  'renderer.workbench-bottom-panel'
)
export const TERMINAL_RENDERER_BOTTOM_PANEL_CONTRACT =
  domainPackageDefinition.contributionContracts[
    TERMINAL_RENDERER_BOTTOM_PANEL_CONTRIBUTION.id
  ]!
export const TERMINAL_RENDERER_TOOLBAR_ACTION_CONTRIBUTION = contributionFor(
  'renderer.workbench-toolbar-action'
)
export const TERMINAL_RENDERER_TOOLBAR_ACTION_CONTRACT =
  domainPackageDefinition.contributionContracts[
    TERMINAL_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  ]!
export const TERMINAL_RENDERER_I18N_CONTRIBUTION = contributionFor(
  'renderer.i18n-resource'
)
export const TERMINAL_RENDERER_LIFECYCLE_CONTRIBUTION = contributionFor(
  'renderer.lifecycle'
)

function contributionFor(kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === 'renderer')
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) throw new Error(`Terminal manifest is missing renderer:${kind}.`)
  return contribution
}

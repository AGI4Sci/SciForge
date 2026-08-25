import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const BROWSER_PREVIEW_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const BROWSER_PREVIEW_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const BROWSER_PREVIEW_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main',
  'main.capability-factory'
)
export const BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-right-panel'
)
export const BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRACT =
  domainPackageDefinition.contributionContracts[
    BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  ]!
export const BROWSER_PREVIEW_RENDERER_COMMAND_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.command'
)
export const BROWSER_PREVIEW_RENDERER_TOOLBAR_ACTION_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-toolbar-action'
)
export const BROWSER_PREVIEW_RENDERER_TOOLBAR_ACTION_CONTRACT =
  domainPackageDefinition.contributionContracts[
    BROWSER_PREVIEW_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  ]!
export const BROWSER_PREVIEW_RENDERER_I18N_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.i18n-resource'
)

function contributionFor(process: 'main' | 'renderer', kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) {
    throw new Error(`Web Preview manifest is missing ${process}:${kind}.`)
  }
  return contribution
}

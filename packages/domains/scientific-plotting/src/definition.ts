import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const SCIENTIFIC_PLOTTING_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const SCIENTIFIC_PLOTTING_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const SCIENTIFIC_PLOTTING_CAPABILITY_FACTORY_CONTRIBUTION = (() => {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === 'main')
    ?.contributions.find((candidate) => candidate.kind === 'main.capability-factory')
  if (!contribution) {
    throw new Error('Scientific Plotting manifest is missing main.capability-factory.')
  }
  return contribution
})()

export const SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-right-panel'
)
export const SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRACT =
  domainPackageDefinition.contributionContracts[
    SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  ]!
export const SCIENTIFIC_PLOTTING_RENDERER_COMMAND_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.command'
)
export const SCIENTIFIC_PLOTTING_RENDERER_TOOLBAR_ACTION_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-toolbar-action'
)
export const SCIENTIFIC_PLOTTING_RENDERER_TOOLBAR_ACTION_CONTRACT =
  domainPackageDefinition.contributionContracts[
    SCIENTIFIC_PLOTTING_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  ]!
export const SCIENTIFIC_PLOTTING_RENDERER_I18N_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.i18n-resource'
)

function contributionFor(process: 'main' | 'renderer', kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) {
    throw new Error(`Scientific Plotting manifest is missing ${process}:${kind}.`)
  }
  return contribution
}

import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const ARTIFACT_VERSIONS_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const ARTIFACT_VERSIONS_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const ARTIFACT_VERSIONS_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main',
  'main.capability-factory'
)
export const ARTIFACT_VERSIONS_RUNTIME_LIFECYCLE_CONTRIBUTION = contributionFor(
  'main',
  'main.runtime-lifecycle'
)
export const ARTIFACT_VERSIONS_IDENTITY_GRANT_CONTRIBUTION = contributionFor(
  'main',
  'main.system-capability-grant'
)
export const ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-right-panel'
)
export const ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRACT =
  domainPackageDefinition.contributionContracts[
    ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  ]!
export const ARTIFACT_VERSIONS_RENDERER_COMMAND_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.command'
)
export const ARTIFACT_VERSIONS_RENDERER_TOOLBAR_ACTION_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-toolbar-action'
)
export const ARTIFACT_VERSIONS_RENDERER_TOOLBAR_ACTION_CONTRACT =
  domainPackageDefinition.contributionContracts[
    ARTIFACT_VERSIONS_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  ]!
export const ARTIFACT_VERSIONS_RENDERER_I18N_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.i18n-resource'
)

function contributionFor(process: 'main' | 'renderer', kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) {
    throw new Error(`Artifact Versions manifest is missing ${process}:${kind}.`)
  }
  return contribution
}

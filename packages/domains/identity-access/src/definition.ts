import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const IDENTITY_ACCESS_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const IDENTITY_ACCESS_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const IDENTITY_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main',
  'main.capability-factory'
)
export const IDENTITY_PRINCIPAL_PROVIDER_CONTRIBUTION = contributionFor(
  'main',
  'main.principal-provider'
)
export const IDENTITY_RUNTIME_LIFECYCLE_CONTRIBUTION = contributionFor(
  'main',
  'main.runtime-lifecycle'
)
export const IDENTITY_AUTHENTICATED_CLOUD_TRANSPORT_CONTRIBUTION = contributionFor(
  'main',
  'main.extension',
  'identity-access.authenticated-cloud-transport'
)
export const IDENTITY_AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT =
  domainPackageDefinition.contributionContracts[
    IDENTITY_AUTHENTICATED_CLOUD_TRANSPORT_CONTRIBUTION.id
  ]!
export const IDENTITY_RENDERER_COMMAND_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.command'
)
export const IDENTITY_RENDERER_TOOLBAR_ACTION_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-toolbar-action'
)
export const IDENTITY_RENDERER_TOOLBAR_ACTION_CONTRACT =
  domainPackageDefinition.contributionContracts[
    IDENTITY_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  ]!
export const IDENTITY_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-global-overlay'
)
export const IDENTITY_RENDERER_GLOBAL_OVERLAY_CONTRACT =
  domainPackageDefinition.contributionContracts[
    IDENTITY_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION.id
  ]!
export const IDENTITY_RENDERER_LIFECYCLE_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.lifecycle'
)
export const IDENTITY_RENDERER_I18N_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.i18n-resource'
)

function contributionFor(process: 'main' | 'renderer', kind: string, id?: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind && (!id || candidate.id === id))
  if (!contribution) {
    throw new Error(`Identity manifest is missing ${process}:${kind}.`)
  }
  return contribution
}

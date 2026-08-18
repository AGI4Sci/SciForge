import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const OPENCONTENT_CONNECTOR_DOMAIN_MODULE_ID = domainPackageDefinition.module.id

export const OPENCONTENT_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main',
  'main.capability-factory'
)

export const OPENCONTENT_PROVIDER_INSTANCE_CONTRIBUTION = contributionFor(
  'main',
  'main.extension',
  'opencontent-connector.provider-instance'
)
export const OPENCONTENT_PROVIDER_INSTANCE_CONTRACT =
  domainPackageDefinition.contributionContracts[
    OPENCONTENT_PROVIDER_INSTANCE_CONTRIBUTION.id
  ]!

export const OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRIBUTION = contributionFor(
  'main',
  'main.extension',
  'opencontent-connector.content-space-service'
)
export const OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRACT =
  domainPackageDefinition.contributionContracts[
    OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRIBUTION.id
  ]!

export const OPENCONTENT_RENDERER_RIGHT_PANEL_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-right-panel'
)
export const OPENCONTENT_RENDERER_COMMAND_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.command'
)
export const OPENCONTENT_RENDERER_TOOLBAR_ACTION_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-toolbar-action'
)
export const OPENCONTENT_RENDERER_RIGHT_PANEL_CONTRACT =
  domainPackageDefinition.contributionContracts[
    OPENCONTENT_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  ]!
export const OPENCONTENT_RENDERER_TOOLBAR_ACTION_CONTRACT =
  domainPackageDefinition.contributionContracts[
    OPENCONTENT_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  ]!

function contributionFor(process: 'main' | 'renderer', kind: string, id?: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind && (!id || candidate.id === id))
  if (!contribution) {
    throw new Error(`OpenContent Connector manifest is missing ${process}:${kind}.`)
  }
  return contribution
}

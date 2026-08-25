import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const CONTENT_SPACE_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const CONTENT_SPACE_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main', 'main.capability-factory'
)
export const CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION = contributionFor(
  'main', 'main.runtime-lifecycle'
)
export const CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_CONTRIBUTION = contributionFor(
  'main', 'main.system-capability-grant'
)
export const CONTENT_SPACE_PROVISIONING_BATCH_GRANT_CONTRIBUTION = contributionById(
  'main', 'content-space.provisioning-batch'
)
export const CONTENT_SPACE_CONTAINER_REFERENCE_CODEC_CONTRIBUTION = contributionById(
  'main', 'content-space.container-reference-codec'
)
export const CONTENT_SPACE_FILE_REFERENCE_CODEC_CONTRIBUTION = contributionById(
  'main', 'content-space.file-reference-codec'
)
export const CONTENT_SPACE_ARTIFACT_REFERENCE_CODEC_CONTRIBUTION = contributionById(
  'main', 'content-space.artifact-reference-codec'
)
export const CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_CONTRIBUTION = contributionById(
  'main', 'content-space.provider-instance-authority'
)
export const CONTENT_SPACE_RENDERER_RIGHT_PANEL_CONTRIBUTION = contributionFor(
  'renderer', 'renderer.workbench-right-panel'
)
export const CONTENT_SPACE_RENDERER_COMMAND_CONTRIBUTION = contributionFor(
  'renderer', 'renderer.command'
)
export const CONTENT_SPACE_RENDERER_TOOLBAR_ACTION_CONTRIBUTION = contributionFor(
  'renderer', 'renderer.workbench-toolbar-action'
)
export const CONTENT_SPACE_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION = contributionFor(
  'renderer', 'renderer.resource-navigation'
)

export const CONTENT_SPACE_CONTAINER_REFERENCE_CODEC_CONTRACT = contractFor(
  CONTENT_SPACE_CONTAINER_REFERENCE_CODEC_CONTRIBUTION.id
)
export const CONTENT_SPACE_FILE_REFERENCE_CODEC_CONTRACT = contractFor(
  CONTENT_SPACE_FILE_REFERENCE_CODEC_CONTRIBUTION.id
)
export const CONTENT_SPACE_ARTIFACT_REFERENCE_CODEC_CONTRACT = contractFor(
  CONTENT_SPACE_ARTIFACT_REFERENCE_CODEC_CONTRIBUTION.id
)
export const CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_CONTRACT = contractFor(
  CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_CONTRIBUTION.id
)
export const CONTENT_SPACE_RENDERER_RIGHT_PANEL_CONTRACT = contractFor(
  CONTENT_SPACE_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
)
export const CONTENT_SPACE_RENDERER_TOOLBAR_ACTION_CONTRACT = contractFor(
  CONTENT_SPACE_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
)
export const CONTENT_SPACE_RENDERER_RESOURCE_NAVIGATION_CONTRACT = contractFor(
  CONTENT_SPACE_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION.id
)

function contributionFor(process: 'main' | 'renderer', kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) {
    throw new Error(`Content Space manifest is missing ${process}:${kind}.`)
  }
  return contribution
}

function contributionById(process: 'main' | 'renderer', id: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.id === id)
  if (!contribution) {
    throw new Error(`Content Space manifest is missing ${process}:${id}.`)
  }
  return contribution
}

function contractFor(id: string) {
  const contract = domainPackageDefinition.contributionContracts[id]
  if (!contract) throw new Error(`Content Space manifest is missing contract ${id}.`)
  return contract
}

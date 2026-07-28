import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const ANCHORED_COMMENTS_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const ANCHORED_COMMENTS_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const ANCHORED_COMMENTS_CAPABILITY_FACTORY_CONTRIBUTION =
  contributionFor('main', 'main.capability-factory')
export const ANCHORED_COMMENTS_COMMAND_CONTRIBUTION =
  contributionFor('renderer', 'renderer.command')
export const ANCHORED_COMMENTS_TOOLBAR_CONTRIBUTION =
  contributionFor('renderer', 'renderer.workbench-toolbar-action')
export const ANCHORED_COMMENTS_OVERLAY_CONTRIBUTION =
  contributionFor('renderer', 'renderer.workbench-global-overlay')
export const ANCHORED_COMMENTS_COMPOSER_CONTEXT_CONTRIBUTION =
  contributionFor('renderer', 'renderer.composer-context-provider')

export const ANCHORED_COMMENTS_TOOLBAR_CONTRACT =
  domainPackageDefinition.contributionContracts[
    ANCHORED_COMMENTS_TOOLBAR_CONTRIBUTION.id
  ]!
export const ANCHORED_COMMENTS_OVERLAY_CONTRACT =
  domainPackageDefinition.contributionContracts[
    ANCHORED_COMMENTS_OVERLAY_CONTRIBUTION.id
  ]!
export const ANCHORED_COMMENTS_COMPOSER_CONTEXT_CONTRACT =
  domainPackageDefinition.contributionContracts[
    ANCHORED_COMMENTS_COMPOSER_CONTEXT_CONTRIBUTION.id
  ]!

function contributionFor(process: 'main' | 'renderer', kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) {
    throw new Error(`Anchored Comments manifest is missing ${process}:${kind}.`)
  }
  return contribution
}

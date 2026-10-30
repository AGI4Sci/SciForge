import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import { MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND } from '@sciforge/domain-sdk/capability-eval'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const BIOLOGY_ROOM_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const BIOLOGY_ROOM_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const BIOLOGY_ROOM_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main.capability-factory'
)
export const BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRIBUTION = contributionFor(
  MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND
)
export const BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRACT =
  domainPackageDefinition.contributionContracts[BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRIBUTION.id]!

function contributionFor(kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === 'main')
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) throw new Error(`Biology Room manifest is missing main:${kind}.`)
  return contribution
}

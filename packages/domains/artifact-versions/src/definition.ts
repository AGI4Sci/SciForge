import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import { MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND } from '@sciforge/domain-sdk/capability-eval'
import { MAIN_HOST_PORTS_CONTRIBUTION_KIND } from '@sciforge/domain-sdk/host-ports'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const ARTIFACT_VERSIONS_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const ARTIFACT_VERSIONS_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const ARTIFACT_VERSIONS_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main',
  'main.capability-factory'
)
export const ARTIFACT_VERSIONS_CAPABILITY_EVAL_CONTRIBUTION = contributionFor(
  'main',
  MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND
)
export const ARTIFACT_VERSIONS_CAPABILITY_EVAL_CONTRACT =
  domainPackageDefinition.contributionContracts[
    ARTIFACT_VERSIONS_CAPABILITY_EVAL_CONTRIBUTION.id
  ]!
export const ARTIFACT_VERSIONS_HOST_PORTS_CONTRIBUTION = contributionFor(
  'main',
  MAIN_HOST_PORTS_CONTRIBUTION_KIND
)
export const ARTIFACT_VERSIONS_HOST_PORTS_CONTRACT =
  domainPackageDefinition.contributionContracts[
    ARTIFACT_VERSIONS_HOST_PORTS_CONTRIBUTION.id
  ]!
export const ARTIFACT_VERSIONS_RUNTIME_LIFECYCLE_CONTRIBUTION = contributionFor(
  'main',
  'main.runtime-lifecycle'
)
export const ARTIFACT_VERSIONS_IDENTITY_GRANT_CONTRIBUTION = contributionFor(
  'main',
  'main.system-capability-grant'
)
export const ARTIFACT_VERSIONS_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.research-summary.v1'
)
export const ARTIFACT_VERSIONS_RENDERER_RESEARCH_SUMMARY_CONTRACT =
  domainPackageDefinition.contributionContracts['artifact-versions.research-summary']!

function contributionFor(process: 'main' | 'renderer', kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) {
    throw new Error(`Artifact Versions manifest is missing ${process}:${kind}.`)
  }
  return contribution
}

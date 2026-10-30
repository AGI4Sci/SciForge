import type { DomainPackageProcess } from '@sciforge/domain-sdk/contract'

import {
  domainPackageDefinition
} from '../definition.js'

/**
 * Coordinator is an internal module of the Collaboration package. These named
 * exports retain the implementation vocabulary used by the moved Coordinator
 * sources while every declaration is resolved from the single Collaboration
 * manifest.
 */
export { domainPackageDefinition }

export const PROJECT_COORDINATOR_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const PROJECT_COORDINATOR_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

// The Coordinator factory is an internal implementation contribution. The
// merged Collaboration package publishes one canonical capability factory;
// the root entry folds this factory's definitions into it before validation.
export const PROJECT_COORDINATOR_CAPABILITY_FACTORY_CONTRIBUTION = Object.freeze({
  id: 'collaboration.coordinator.capabilities',
  kind: 'main.capability-factory',
  priority: 73
} as const)
export const PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRIBUTION = contributionFor(
  'main',
  'main.runtime-lifecycle',
  'collaboration.coordinator.runtime-lifecycle'
)
export const PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRACT =
  domainPackageDefinition.contributionContracts[
    PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRIBUTION.id
  ]!
function contributionFor(
  process: DomainPackageProcess,
  kind: string,
  id: string
) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind && candidate.id === id)
  if (!contribution) {
    throw new Error(`Collaboration manifest is missing ${process}:${id}.`)
  }
  return contribution
}

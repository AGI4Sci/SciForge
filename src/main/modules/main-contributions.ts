import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import {
  type AppCapabilityContributionFactory,
  type AppCapabilityDomainPolicy
} from '../capabilities/app-contributions/composition'
import { CapabilityRegistry } from '../capabilities/registry'
import {
  DomainModuleCatalog,
  type DomainContributionRuntimeGuard
} from './catalog'

export const MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND = 'main.capability-factory'

export const isAppCapabilityContributionFactory: DomainContributionRuntimeGuard<
  AppCapabilityContributionFactory<AppCapabilityDependencies>
> = (value, metadata): value is AppCapabilityContributionFactory<AppCapabilityDependencies> => {
  if (!isRecord(value) || !isRecord(value.policy)) return false
  return value.moduleId === metadata.owner.moduleId &&
    typeof value.createDefinitions === 'function' &&
    isAppCapabilityDomainPolicy(value.policy)
}

export function composeMainCapabilityRegistry(
  catalog: DomainModuleCatalog,
  dependencies: AppCapabilityDependencies
): CapabilityRegistry {
  const factories = catalog.listContributions(
    MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
    isAppCapabilityContributionFactory
  ).map((contribution) => contribution.value)
  return new CapabilityRegistry(
    factories.flatMap((factory) => factory.createDefinitions(dependencies))
  )
}

export function listMainCapabilityDomainPolicies(
  catalog: DomainModuleCatalog
): readonly AppCapabilityDomainPolicy[] {
  return Object.freeze(catalog.listContributions(
    MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
    isAppCapabilityContributionFactory
  ).map((contribution) => contribution.value.policy))
}

function isAppCapabilityDomainPolicy(value: Record<string, unknown>): value is AppCapabilityDomainPolicy {
  return typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    Array.isArray(value.directTransportPrefixes) &&
    value.directTransportPrefixes.every((entry) => typeof entry === 'string') &&
    Array.isArray(value.allowedDirectTransports) &&
    value.allowedDirectTransports.every((entry) => typeof entry === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

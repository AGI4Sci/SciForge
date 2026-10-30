import {
  MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND,
  domainCapabilityEvalContributionContractSchema,
  isDomainCapabilityEvalContribution,
  type DomainCapabilityEvalRegistration
} from '@sciforge/domain-sdk/capability-eval'
import {
  MAIN_HOST_PORTS_CONTRIBUTION_KIND,
  domainHostPortsContributionContractSchema,
  isDomainHostPortsContribution,
  type DomainHostPortsRegistration
} from '@sciforge/domain-sdk/host-ports'
import {
  MAIN_PRINCIPAL_PROVIDER_CONTRIBUTION_KIND,
  isDomainMainPrincipalProvider
} from '@sciforge/domain-sdk/principal'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import {
  type AppCapabilityContributionFactory,
  type AppCapabilityDomainPolicy
} from '../capabilities/app-contributions/composition'
import { CapabilityRegistrationError, CapabilityRegistry } from '../capabilities/registry'
import {
  DomainModuleCatalog,
  type DomainContributionRuntimeGuard
} from './catalog'

export const MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND = 'main.capability-factory'

export { MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND } from '@sciforge/domain-sdk/capability-eval'

export { MAIN_HOST_PORTS_CONTRIBUTION_KIND } from '@sciforge/domain-sdk/host-ports'

export function listMainHostPorts(
  catalog: DomainModuleCatalog
): readonly DomainHostPortsRegistration[] {
  return Object.freeze(catalog.listContributions(
    MAIN_HOST_PORTS_CONTRIBUTION_KIND,
    (value, metadata): value is DomainHostPortsRegistration => {
      if (!isDomainHostPortsContribution(value)) return false
      return domainHostPortsContributionContractSchema.safeParse(metadata.contract).success
    }
  ).map((contribution) => Object.freeze({
    ...contribution.value,
    contributionId: contribution.declaration.id,
    packageName: contribution.packageName,
    moduleVersion: contribution.owner.moduleVersion,
    owner: contribution.owner,
    contract: domainHostPortsContributionContractSchema.parse(contribution.contract)
  })))
}

export function listMainCapabilityEvalContributions(
  catalog: DomainModuleCatalog
): readonly DomainCapabilityEvalRegistration[] {
  return Object.freeze(catalog.listContributions(
    MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND,
    (value, metadata): value is DomainCapabilityEvalRegistration => {
      if (!isDomainCapabilityEvalContribution(value, metadata.owner.moduleId)) return false
      return domainCapabilityEvalContributionContractSchema.safeParse(metadata.contract).success
    }
  ).map((contribution) => Object.freeze({
    ...contribution.value,
    contributionId: contribution.declaration.id,
    packageName: contribution.packageName,
    moduleVersion: contribution.owner.moduleVersion,
    contract: domainCapabilityEvalContributionContractSchema.parse(contribution.contract)
  })))
}

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
  )
  const principalProviders = catalog.listContributions(
    MAIN_PRINCIPAL_PROVIDER_CONTRIBUTION_KIND,
    isDomainMainPrincipalProvider
  )
  const definitions = factories.flatMap((contribution) => {
    const ownedDefinitions = contribution.value.createDefinitions(dependencies)
    if (
      ownedDefinitions.some(({ descriptor }) => descriptor.principalTransition === 'host-authority') &&
      (
        principalProviders.length !== 1 ||
        principalProviders[0]?.owner.moduleId !== contribution.owner.moduleId
      )
    ) {
      throw new CapabilityRegistrationError(
        'unauthorized_principal_transition',
        `Capability factory ${contribution.owner.moduleId} declares a Host Principal transition without owning a Principal provider.`
      )
    }
    return ownedDefinitions
  })
  return new CapabilityRegistry(definitions)
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

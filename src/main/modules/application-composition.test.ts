import { describe, expect, it } from 'vitest'
import { installedDomainPackages } from '../../shared/installed-domain-packages'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import {
  createApplicationCapabilityRegistry,
  createApplicationDomainCatalog
} from './application-composition'
import {
  MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
  isAppCapabilityContributionFactory,
  listMainCapabilityDomainPolicies
} from './main-contributions'

describe('application domain composition', () => {
  it('composes explicit host-core and installed package capabilities through one catalog', () => {
    const catalog = createApplicationDomainCatalog({
      getUserDataDir: () => '/tmp/sciforge-domain-composition-test'
    })
    const packages = catalog.listPackages()

    expect(packages.map((definition) => definition.packageName)).toEqual([
      '@sciforge/core-controlled-process',
      '@sciforge/core-surface',
      '@sciforge/core-version-control',
      '@sciforge/core-workspace-preview',
      ...installedDomainPackages.definitions
        .filter((definition) => definition.entrypoints.some(({ process }) => process === 'main'))
        .map((definition) => definition.packageName)
    ])
    const factories = catalog.listContributions(
      MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
      isAppCapabilityContributionFactory
    )
    expect(factories.every((contribution) =>
      contribution.owner.moduleId === contribution.value.moduleId
    )).toBe(true)

    const dependencies = unavailableDependencies()
    const expectedCapabilityIds = factories.flatMap(({ value }) =>
      value.createDefinitions(dependencies).map(({ descriptor }) => descriptor.id)
    ).sort()
    const registry = createApplicationCapabilityRegistry(catalog, dependencies)
    expect(registry.list().map((descriptor) => descriptor.id)).toEqual(
      expectedCapabilityIds
    )
    expect(listMainCapabilityDomainPolicies(catalog).map((policy) => policy.id)).toEqual(
      factories.map(({ value }) => value.policy.id)
    )

    catalog.dispose()
  })
})

function unavailableDependencies(): AppCapabilityDependencies {
  const unavailable = () => undefined
  return new Proxy({}, {
    get: () => unavailable
  }) as AppCapabilityDependencies
}

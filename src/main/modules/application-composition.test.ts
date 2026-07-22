import { PAPER_RADAR_CAPABILITY_IDS } from '@sciforge/domain-paper-radar/contract'
import { BIOLOGY_ROOM_CAPABILITY_IDS } from '@sciforge/domain-biology-room/contract'
import { describe, expect, it } from 'vitest'
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
      '@sciforge/core-surface',
      '@sciforge/core-artifact',
      '@sciforge/core-workspace-preview',
      '@sciforge/domain-life-science-preview',
      '@sciforge/domain-biology-room',
      '@sciforge/domain-paper-radar'
    ])
    const factories = catalog.listContributions(
      MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
      isAppCapabilityContributionFactory
    )
    expect(factories).toHaveLength(5)
    expect(factories.every((contribution) =>
      contribution.owner.moduleId === contribution.value.moduleId
    )).toBe(true)

    const registry = createApplicationCapabilityRegistry(catalog, unavailableDependencies())
    expect(registry.list().map((descriptor) => descriptor.id)).toEqual(expect.arrayContaining(
      [...Object.values(PAPER_RADAR_CAPABILITY_IDS), ...Object.values(BIOLOGY_ROOM_CAPABILITY_IDS)]
    ))
    expect(listMainCapabilityDomainPolicies(catalog).map((policy) => policy.id)).toEqual([
      'surface',
      'artifact',
      'workspace-preview',
      'biology-room',
      'paper-radar'
    ])

    catalog.dispose()
  })
})

function unavailableDependencies(): AppCapabilityDependencies {
  const unavailable = () => undefined
  return new Proxy({}, {
    get: () => unavailable
  }) as AppCapabilityDependencies
}

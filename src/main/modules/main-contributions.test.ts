import { DOMAIN_PACKAGE_CONTRACT_VERSION } from '@sciforge/domain-sdk'
import { describe, expect, it } from 'vitest'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import { defineAppCapabilityContribution } from '../capabilities/app-contributions/composition'
import {
  MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
  isAppCapabilityContributionFactory,
  listMainCapabilityDomainPolicies
} from './main-contributions'
import { DomainModuleCatalog, type MainDomainModuleDefinition } from './catalog'

const capabilityFactory = defineAppCapabilityContribution<AppCapabilityDependencies>(
  'fixture.capability',
  () => [],
  {
    id: 'fixture',
    title: 'Fixture',
    directTransportPrefixes: ['fixture:'],
    allowedDirectTransports: []
  }
)

function createCatalog() {
  const catalog = new DomainModuleCatalog()
  catalog.registerBatch([
    fixtureEntry('fixture.capability', '@fixture/capability', [{
      id: 'fixture.capability.factory',
      kind: MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
      value: capabilityFactory
    }])
  ])
  return catalog
}

describe('main domain contribution composition', () => {
  it('projects capability factories and policies only through the catalog', () => {
    const catalog = createCatalog()

    expect(catalog.listModules().map((module) => module.id)).toEqual(['fixture.capability'])
    expect(catalog.listContributions(
      MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
      isAppCapabilityContributionFactory
    ).map((contribution) => contribution.value)).toEqual([capabilityFactory])
    expect(listMainCapabilityDomainPolicies(catalog)).toEqual([capabilityFactory.policy])
  })
})

function fixtureEntry(
  moduleId: string,
  packageName: string,
  contributions: ReadonlyArray<{
    id: string
    kind: string
    value: unknown
    onDispose?: () => void
  }>
): MainDomainModuleDefinition {
  return {
    definition: {
      contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
      kind: 'trusted-compile-time' as const,
      packageName,
      module: {
        id: moduleId,
        displayName: moduleId,
        version: '1.0.0',
        hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
        priority: 100
      },
      entrypoints: [{
        process: 'main' as const,
        export: './main' as const,
        contributions: contributions.map(({ id, kind }) => ({ id, kind }))
      }]
    },
    contributions
  }
}

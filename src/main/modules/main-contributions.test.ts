import { DOMAIN_PACKAGE_CONTRACT_VERSION } from '@sciforge/domain-sdk'
import {
  MAIN_PRINCIPAL_PROVIDER_CONTRIBUTION_KIND,
  definePrincipalContextSnapshot
} from '@sciforge/domain-sdk/principal'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import { defineAppCapabilityContribution } from '../capabilities/app-contributions/composition'
import { defineCapability } from '../capabilities/registry'
import {
  MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
  composeMainCapabilityRegistry,
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

  it('allows Host Principal transitions only for the unique same-owner Principal provider', () => {
    const dependencies = {} as AppCapabilityDependencies
    const withoutProvider = catalogWithPrincipalTransition('fixture.identity')
    expect(() => composeMainCapabilityRegistry(withoutProvider, dependencies))
      .toThrow(/without owning a Principal provider/)

    const otherOwner = catalogWithPrincipalTransition('fixture.identity', ['fixture.other'])
    expect(() => composeMainCapabilityRegistry(otherOwner, dependencies))
      .toThrow(/without owning a Principal provider/)

    const multipleProviders = catalogWithPrincipalTransition(
      'fixture.identity',
      ['fixture.identity', 'fixture.other']
    )
    expect(() => composeMainCapabilityRegistry(multipleProviders, dependencies))
      .toThrow(/without owning a Principal provider/)

    const sameOwner = catalogWithPrincipalTransition('fixture.identity', ['fixture.identity'])
    expect(composeMainCapabilityRegistry(sameOwner, dependencies).list())
      .toEqual([expect.objectContaining({
        id: 'identity.transition',
        principalTransition: 'host-authority'
      })])
  })
})

function catalogWithPrincipalTransition(
  transitionOwner: string,
  principalProviderOwners: readonly string[] = []
): DomainModuleCatalog {
  const catalog = new DomainModuleCatalog()
  const owners = new Set([transitionOwner, ...principalProviderOwners])
  catalog.registerBatch([...owners].map((owner) => {
    const contributions: Array<{ id: string; kind: string; value: unknown }> = []
    if (owner === transitionOwner) {
      contributions.push({
        id: `${owner}.capabilities`,
        kind: MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
        value: defineAppCapabilityContribution<AppCapabilityDependencies>(
          owner,
          () => [defineCapability({
            id: 'identity.transition',
            version: '1',
            title: 'Transition identity',
            description: 'Transitions the Host Principal in a trusted UI.',
            audiences: ['ui'],
            scope: 'global',
            effect: 'external-write',
            approval: 'none',
            concurrency: { revision: 'none', idempotency: 'required' },
            principalTransition: 'host-authority',
            inputSchema: z.object({}).strict(),
            outputSchema: z.object({ ok: z.boolean() }).strict(),
            handler: async () => ({ output: { ok: true } })
          })],
          {
            id: owner,
            title: owner,
            directTransportPrefixes: [],
            allowedDirectTransports: []
          }
        )
      })
    }
    if (principalProviderOwners.includes(owner)) {
      contributions.push({
        id: `${owner}.principal`,
        kind: MAIN_PRINCIPAL_PROVIDER_CONTRIBUTION_KIND,
        value: {
          current: () => undefined,
          snapshot: () => definePrincipalContextSnapshot({ identityVersion: 0, principal: null }),
          subscribe: () => () => undefined
        }
      })
    }
    return fixtureEntry(owner, `@fixture/${owner}`, contributions)
  }))
  return catalog
}

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

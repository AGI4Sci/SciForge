import {
  DOMAIN_PACKAGE_CONTRACT_VERSION,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk'
import {
  MAIN_VISUAL_SOURCE_CONTRIBUTION_KIND,
  VISUAL_SOURCE_CONTRACT_VERSION,
  type VisualSourceContributionContractInput,
  type VisualSourceProviderInput
} from '@sciforge/domain-sdk/visual-source'
import { describe, expect, it } from 'vitest'

import { VisualSourceRegistry } from '../runtime/agent-runtime/visual-source-registry'
import {
  DomainModuleCatalog,
  type MainDomainModuleDefinition
} from './catalog'
import {
  isMainVisualSourceContribution,
  listMainVisualSourceContributions
} from './visual-source-contributions'

function visualContract(
  id: string,
  resourceKinds: readonly string[]
): VisualSourceContributionContractInput {
  return {
    contractVersion: VISUAL_SOURCE_CONTRACT_VERSION,
    id,
    resourceKinds
  }
}

function visualProvider(
  contract: VisualSourceContributionContractInput
): VisualSourceProviderInput {
  return {
    contract,
    render: async (request) => ({
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
      width: 1,
      height: 1,
      sourceRevision: request.resource.semanticRevision,
      anchor: { kind: 'resource' }
    })
  }
}

function visualModule(input: Readonly<{
  moduleId: string
  contributionId?: string
  canonicalContract: VisualSourceContributionContractInput
  provider?: unknown
  priority?: number
}>): MainDomainModuleDefinition {
  const contributionId = input.contributionId ?? input.canonicalContract.id
  const packageSegment = input.moduleId.split('.').at(-1)!
  const canonicalContract = {
    contractVersion: input.canonicalContract.contractVersion,
    id: input.canonicalContract.id,
    resourceKinds: [...input.canonicalContract.resourceKinds]
  }
  const definition: TrustedDomainPackageDefinitionInput = {
    contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
    kind: 'trusted-compile-time',
    packageName: `@fixture/${packageSegment}`,
    module: {
      id: input.moduleId,
      displayName: input.moduleId,
      version: '1.0.0',
      hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
      priority: 100
    },
    contributionContracts: {
      [contributionId]: canonicalContract
    },
    entrypoints: [{
      process: 'main',
      export: './main',
      contributions: [{
        id: contributionId,
        kind: MAIN_VISUAL_SOURCE_CONTRIBUTION_KIND,
        priority: input.priority ?? 100
      }]
    }]
  }
  return {
    definition,
    contributions: [{
      id: contributionId,
      kind: MAIN_VISUAL_SOURCE_CONTRIBUTION_KIND,
      contract: canonicalContract,
      value: input.provider ?? visualProvider(input.canonicalContract)
    }]
  }
}

describe('main visual source contributions', () => {
  it('collects immutable owner/provider registrations without a domain map', () => {
    const firstContract = visualContract(
      'fixture.first-visual-source',
      ['fixture-first-resource']
    )
    const secondContract = visualContract(
      'fixture.second-visual-source',
      ['fixture-second-resource']
    )
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([
      visualModule({
        moduleId: 'fixture.first',
        canonicalContract: firstContract,
        priority: 10
      }),
      visualModule({
        moduleId: 'fixture.second',
        canonicalContract: secondContract,
        priority: 20
      })
    ])

    const registrations = listMainVisualSourceContributions(catalog)

    expect(registrations.map(({ ownerId, provider }) =>
      `${ownerId}:${provider.contract.id}`
    )).toEqual([
      'fixture.second:fixture.second-visual-source',
      'fixture.first:fixture.first-visual-source'
    ])
    expect(Object.isFrozen(registrations)).toBe(true)
    expect(Object.isFrozen(registrations[0])).toBe(true)
    expect(Object.isFrozen(registrations[0]?.provider)).toBe(true)
    expect(Object.isFrozen(registrations[0]?.provider.contract)).toBe(true)
  })

  it('rejects a manifest contribution ID that differs from the provider contract ID', () => {
    const contract = visualContract(
      'fixture.provider-visual-source',
      ['fixture-resource']
    )
    const catalog = new DomainModuleCatalog()
    catalog.registerModule(visualModule({
      moduleId: 'fixture.id-mismatch',
      contributionId: 'fixture.manifest-visual-source',
      canonicalContract: contract
    }))

    expect(() => listMainVisualSourceContributions(catalog))
      .toThrow('failed runtime validation')
  })

  it('rejects provider contract drift and incomplete provider values', () => {
    const canonical = visualContract(
      'fixture.drifted-visual-source',
      ['fixture-resource']
    )
    const driftedCatalog = new DomainModuleCatalog()
    driftedCatalog.registerModule(visualModule({
      moduleId: 'fixture.drifted',
      canonicalContract: canonical,
      provider: visualProvider({
        ...canonical,
        resourceKinds: ['other-resource']
      })
    }))
    expect(() => listMainVisualSourceContributions(driftedCatalog))
      .toThrow('failed runtime validation')

    const incompleteCatalog = new DomainModuleCatalog()
    incompleteCatalog.registerModule(visualModule({
      moduleId: 'fixture.incomplete',
      canonicalContract: canonical,
      provider: { contract: canonical }
    }))
    expect(() => listMainVisualSourceContributions(incompleteCatalog))
      .toThrow('failed runtime validation')

    expect(isMainVisualSourceContribution(
      { ...visualProvider(canonical), extra: true },
      {
        process: 'main',
        packageName: '@fixture/direct-guard',
        entrypoint: './main',
        declaration: {
          id: canonical.id,
          kind: MAIN_VISUAL_SOURCE_CONTRIBUTION_KIND,
          priority: 100
        },
        contract: {
          ...canonical,
          resourceKinds: [...canonical.resourceKinds]
        },
        owner: {
          moduleId: 'fixture.direct-guard',
          moduleVersion: '1.0.0'
        }
      }
    )).toBe(false)
  })

  it('leaves duplicate resource-kind ownership to the canonical registry guard', () => {
    const first = visualContract(
      'fixture.first-duplicate-source',
      ['shared-resource']
    )
    const second = visualContract(
      'fixture.second-duplicate-source',
      ['shared-resource']
    )
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([
      visualModule({
        moduleId: 'fixture.duplicate-first',
        canonicalContract: first
      }),
      visualModule({
        moduleId: 'fixture.duplicate-second',
        canonicalContract: second
      })
    ])

    const registrations = listMainVisualSourceContributions(catalog)
    expect(registrations).toHaveLength(2)
    expect(() => new VisualSourceRegistry(registrations))
      .toThrow(/resource kind shared-resource is already owned/)
  })

  it('reflects package removal without retaining stale registrations', () => {
    const contract = visualContract(
      'fixture.removable-visual-source',
      ['removable-resource']
    )
    const catalog = new DomainModuleCatalog()
    const registration = catalog.registerModule(visualModule({
      moduleId: 'fixture.removable',
      canonicalContract: contract
    }))

    expect(listMainVisualSourceContributions(catalog)).toHaveLength(1)
    registration.dispose()
    expect(listMainVisualSourceContributions(catalog)).toEqual([])
  })
})

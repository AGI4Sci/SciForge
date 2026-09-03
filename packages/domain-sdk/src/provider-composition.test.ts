import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
  MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
  PROVIDER_FACTORY_CONTRACT_VERSION,
  ProviderCompositionError,
  createDocumentProviderFactoryCatalog,
  createProviderInstanceDirectory,
  defineDocumentProviderFactory,
  defineProviderInstanceDirectoryEntry,
  documentProviderFactoryContributionContractSchema,
  providerFactoryContributionContractSchema,
  providerInstanceRefSchema,
  providerKindSchema
} from './provider-composition.js'
import type { DomainMainContribution, DomainMainContributionHost } from './host.js'
import { MAIN_EXTENSION_CONTRIBUTION_KIND } from './host.js'

type FixtureProvider = Readonly<{ provider: string }>
type FixturePorts = Readonly<{ marker: string }>

function host(contributions: readonly DomainMainContribution[]): DomainMainContributionHost {
  return { list: (kind) => kind === MAIN_EXTENSION_CONTRIBUTION_KIND ? contributions : [] }
}

function instanceContribution(): DomainMainContribution {
  const value = defineProviderInstanceDirectoryEntry({
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerInstanceRef: 'provider_instance_alpha',
    providerKind: 'fixture-local',
    displayName: 'Fixture instance'
  })
  return {
    id: 'fixture.instance',
    kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
    packageName: '@fixture/instance',
    owner: { moduleId: 'fixture.instance', moduleVersion: '1.0.0' },
    version: PROVIDER_FACTORY_CONTRACT_VERSION,
    contract: { location: MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerInstanceRef: 'provider_instance_alpha',
      providerKind: 'fixture-local',
      displayName: 'Fixture instance' },
    value
  }
}

describe('Provider composition public contracts', () => {
  it('validates the local document provider contract', () => {
    const contract = {
      location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: 'fixture-local'
    }
    assert.deepEqual(documentProviderFactoryContributionContractSchema.parse(contract), contract)
    assert.equal(providerFactoryContributionContractSchema.safeParse(contract).success, true)
    assert.equal(providerKindSchema.safeParse('fixture-local').success, true)
    assert.equal(providerKindSchema.safeParse('Fixture Local').success, false)
    assert.equal(providerInstanceRefSchema.safeParse('provider_instance_alpha').success, true)
  })

  it('defines frozen document provider values and composes a trusted catalog', async () => {
    const runtime = defineDocumentProviderFactory<FixtureProvider, FixturePorts>({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: 'fixture-local',
      createProvider: ({ ports }) => ({ provider: ports.marker })
    })
    assert.equal(Object.isFrozen(runtime), true)
    const contribution: DomainMainContribution = {
      id: 'fixture.document',
      kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
      packageName: '@fixture/document',
      owner: { moduleId: 'fixture.document', moduleVersion: '1.0.0' },
      version: PROVIDER_FACTORY_CONTRACT_VERSION,
      contract: {
        location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
        contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
        providerKind: 'fixture-local'
      },
      value: runtime
    }
    const catalog = createDocumentProviderFactoryCatalog<FixtureProvider, FixturePorts>(host([contribution]))
    const directory = createProviderInstanceDirectory(host([instanceContribution()]))
    const selection = catalog.select(directory, 'provider_instance_alpha')
    assert.deepEqual(await selection.createProvider({ marker: 'ok' }), { provider: 'ok' })
  })

  it('rejects duplicate provider kinds and untrusted directories', () => {
    const make = (suffix: string): DomainMainContribution => {
      const id = `fixture.provider-${suffix}`
      return {
      kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
      id,
      packageName: `@fixture/provider-${suffix}`,
      owner: { moduleId: id, moduleVersion: '1.0.0' },
      version: PROVIDER_FACTORY_CONTRACT_VERSION,
      contract: {
        location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
        contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
        providerKind: 'fixture-local'
      },
      value: defineDocumentProviderFactory({
        contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
        providerKind: 'fixture-local',
        createProvider: () => ({ provider: id })
      })
      }
    }
    assert.throws(() => createDocumentProviderFactoryCatalog(host([make('a'), make('b')])),
      (error: unknown) => error instanceof ProviderCompositionError && error.code === 'duplicate_provider_kind')
    assert.throws(() => createProviderInstanceDirectory(undefined as never),
      (error: unknown) => error instanceof ProviderCompositionError && error.code === 'composition_not_ready')
  })
})

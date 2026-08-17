import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DOMAIN_PACKAGE_CONTRACT_VERSION,
  type DomainPackageJsonValue,
  type TrustedDomainPackageDefinitionInput
} from './contract.js'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost
} from './host.js'
import {
  TrustedDomainProcessEntryError,
  defineTrustedDomainProcessEntry
} from './process-entry.js'
import {
  MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
  MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
  MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
  PROVIDER_FACTORY_CONTRACT_VERSION,
  ProviderCompositionError,
  contentSpaceProviderFactoryContributionContractSchema,
  createContentSpaceProviderFactoryCatalog,
  createDocumentProviderFactoryCatalog,
  createProviderInstanceDirectory,
  defineContentSpaceProviderFactory,
  defineDocumentProviderFactory,
  defineProviderInstanceDirectoryEntry,
  documentProviderFactoryContributionContractSchema,
  providerFactoryContributionContractSchema,
  providerInstanceDirectoryEntryContributionContractSchema,
  providerInstanceRefSchema,
  providerKindSchema,
  type ProviderFactoryRuntimeValue,
  type ProviderInstanceDirectory
} from './provider-composition.js'

type FixtureProvider = Readonly<{ provider: string; instance?: string }>
type FixturePorts = Readonly<{ operationDependency: () => string }>

function expectCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ProviderCompositionError && error.code === code
}

function providerContribution(input: Readonly<{
  location:
    | typeof MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION
    | typeof MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION
  providerKind: string
  owner?: string
  contractVersion?: string
  declarationVersion?: string
  omitDeclarationVersion?: boolean
  contract?: DomainPackageJsonValue
  value?: unknown
}>): DomainMainContribution {
  const owner = input.owner ?? 'fixture.provider-integration'
  const contractVersion = input.contractVersion ?? PROVIDER_FACTORY_CONTRACT_VERSION
  const id = `${owner}.${input.location === MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION
    ? 'document'
    : 'content-space'}`
  const contract = input.contract ?? Object.freeze({
    location: input.location,
    contractVersion,
    providerKind: input.providerKind
  })
  const value = input.value ?? Object.freeze({
    location: input.location,
    contractVersion,
    providerKind: input.providerKind,
    createProvider: () => ({ provider: input.providerKind })
  })
  return Object.freeze({
    id,
    kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
    packageName: `@fixture/${owner.replaceAll('.', '-')}`,
    owner: Object.freeze({ moduleId: owner, moduleVersion: '1.2.3' }),
    ...(input.omitDeclarationVersion
      ? {}
      : { version: input.declarationVersion ?? contractVersion }),
    contract,
    value
  })
}

function instanceContribution(input: Readonly<{
  owner?: string
  providerInstanceRef?: string
  runtimeRef?: string
  providerKind?: string
  displayName?: string
  contractVersion?: string
  declarationVersion?: string
  value?: unknown
}> = {}): DomainMainContribution {
  const owner = input.owner ?? 'fixture.provider-instance'
  const contractVersion = input.contractVersion ?? PROVIDER_FACTORY_CONTRACT_VERSION
  const contract = Object.freeze({
    location: MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
    contractVersion,
    providerInstanceRef: input.providerInstanceRef ?? 'provider_instance_alpha',
    providerKind: input.providerKind ?? 'fixture-cloud',
    displayName: input.displayName ?? 'Fixture instance'
  })
  return Object.freeze({
    id: `${owner}.instance`,
    kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
    packageName: `@fixture/${owner.replaceAll('.', '-')}`,
    owner: Object.freeze({ moduleId: owner, moduleVersion: '1.0.0' }),
    version: input.declarationVersion ?? contractVersion,
    contract,
    value: input.value ?? defineProviderInstanceDirectoryEntry({
      contractVersion,
      providerInstanceRef: input.runtimeRef ?? contract.providerInstanceRef,
      providerKind: contract.providerKind,
      displayName: contract.displayName
    })
  })
}

function contributionHost(
  contributions: readonly DomainMainContribution[]
): DomainMainContributionHost {
  return Object.freeze({
    list: (kind) => kind === MAIN_EXTENSION_CONTRIBUTION_KIND
      ? Object.freeze([...contributions])
      : Object.freeze([])
  })
}

function trustedDirectory(entries: readonly Readonly<{
  providerInstanceRef: string
  providerKind: string
  displayName: string
}>[] = []): ProviderInstanceDirectory {
  return createProviderInstanceDirectory(contributionHost(entries.map((entry, index) =>
    instanceContribution({
      owner: `fixture.directory-${index}`,
      providerInstanceRef: entry.providerInstanceRef,
      runtimeRef: entry.providerInstanceRef,
      providerKind: entry.providerKind,
      displayName: entry.displayName
    })
  )))
}

describe('Provider composition public contracts', () => {
  it('strictly validates bounded factory contracts, Provider Kinds, and instance references', () => {
    const documentContract = {
      location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
      contractVersion: '1.4.0',
      providerKind: 'fixture-cloud'
    }
    const contentContract = {
      ...documentContract,
      location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION
    }
    assert.deepEqual(documentProviderFactoryContributionContractSchema.parse(documentContract),
      documentContract)
    assert.deepEqual(contentSpaceProviderFactoryContributionContractSchema.parse(contentContract),
      contentContract)
    assert.equal(providerFactoryContributionContractSchema.safeParse(documentContract).success, true)
    assert.equal(providerFactoryContributionContractSchema.safeParse(contentContract).success, true)

    for (const invalid of [
      { contractVersion: '1.0.0', providerKind: 'fixture-cloud' },
      { ...documentContract, contractVersion: '1' },
      { ...documentContract, providerKind: 'UPPER' },
      { ...documentContract, endpoint: 'forbidden' }
    ]) {
      assert.equal(providerFactoryContributionContractSchema.safeParse(invalid).success, false)
    }
    for (const invalid of ['OpenContent', 'ab', 'fixture/cloud', ' fixture-cloud']) {
      assert.equal(providerKindSchema.safeParse(invalid).success, false)
    }
    for (const invalid of [
      'https://provider.invalid',
      'connection_local_alpha',
      'credential-alpha',
      'res_deadbeef',
      'cap_deadbeef',
      `xfer_${'a'.repeat(32)}`,
      `portal_${'b'.repeat(32)}`,
      'ab'
    ]) {
      assert.equal(providerInstanceRefSchema.safeParse(invalid).success, false)
    }
    for (const valid of [
      'xfer_business-record',
      'portal_customer-record',
      `xfer_${'a'.repeat(31)}`,
      `portal_${'b'.repeat(33)}`
    ]) {
      assert.equal(providerInstanceRefSchema.safeParse(valid).success, true)
    }
  })

  it('defines frozen domain-specific runtime values with exact keys and locations', () => {
    const document = defineDocumentProviderFactory<FixtureProvider, FixturePorts>({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: 'fixture-cloud',
      createProvider: () => ({ provider: 'document' })
    })
    const content = defineContentSpaceProviderFactory<FixtureProvider, FixturePorts>({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: 'fixture-cloud',
      createProvider: () => ({ provider: 'content-space' })
    })
    assert.equal(document.location, MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION)
    assert.equal(content.location, MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION)
    assert.equal(Object.isFrozen(document), true)
    assert.equal(Object.isFrozen(content), true)
    assert.throws(
      () => defineDocumentProviderFactory({
        contractVersion: '1.0.0',
        providerKind: 'fixture-cloud',
        createProvider: () => ({ provider: 'document' }),
        extra: true
      } as unknown as Parameters<typeof defineDocumentProviderFactory>[0]),
      expectCode('invalid_contribution')
    )
  })

  it('uses the standard process contract for exact main.extension values and contracts', () => {
    const definition = providerPackageDefinition()
    const document = providerContribution({
      location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
      providerKind: 'fixture-cloud'
    })
    const content = providerContribution({
      location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
      providerKind: 'fixture-cloud'
    })
    const entry = defineTrustedDomainProcessEntry('main', {
      definition,
      contributions: [
        { id: document.id, kind: document.kind, contract: document.contract, value: document.value },
        { id: content.id, kind: content.kind, contract: content.contract, value: content.value }
      ]
    })
    assert.deepEqual(
      entry.definition.entrypoints[0]?.contributions.map(({ kind, version }) => ({ kind, version })),
      [
        { kind: MAIN_EXTENSION_CONTRIBUTION_KIND, version: '1.0.0' },
        { kind: MAIN_EXTENSION_CONTRIBUTION_KIND, version: '1.0.0' }
      ]
    )
    assert.throws(
      () => defineTrustedDomainProcessEntry('main', {
        definition,
        contributions: [
          { id: document.id, kind: document.kind, contract: document.contract, value: document.value }
        ]
      }),
      (error) => error instanceof TrustedDomainProcessEntryError &&
        error.code === 'runtime_contribution_mismatch'
    )
    assert.throws(
      () => defineTrustedDomainProcessEntry('main', {
        definition,
        contributions: [
          {
            id: document.id,
            kind: document.kind,
            contract: { ...document.contract as object, providerKind: 'drifted-cloud' },
            value: document.value
          },
          { id: content.id, kind: content.kind, contract: content.contract, value: content.value }
        ]
      }),
      (error) => error instanceof TrustedDomainProcessEntryError &&
        error.code === 'runtime_contribution_contract_mismatch'
    )
  })
})

describe('domain-specific Provider factory catalogs', () => {
  it('composes Document and Content Space locations independently', () => {
    const document = providerContribution({
      location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
      providerKind: 'fixture-cloud'
    })
    const content = providerContribution({
      location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
      providerKind: 'fixture-cloud'
    })
    const host = contributionHost([document, content])
    assert.deepEqual(
      createDocumentProviderFactoryCatalog(host).list().map(({ providerKind }) => providerKind),
      ['fixture-cloud']
    )
    assert.deepEqual(
      createContentSpaceProviderFactoryCatalog(host).list().map(({ providerKind }) => providerKind),
      ['fixture-cloud']
    )
  })

  it('does not let an invalid sibling location manufacture or invalidate another Provider', () => {
    const invalidDocument = providerContribution({
      location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
      providerKind: 'fixture-cloud',
      value: { contractVersion: '1.0.0', providerKind: 'fixture-cloud' }
    })
    const content = providerContribution({
      location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
      providerKind: 'fixture-cloud'
    })
    const host = contributionHost([invalidDocument, content])
    assert.throws(
      () => createDocumentProviderFactoryCatalog(host),
      expectCode('invalid_contribution')
    )
    assert.equal(createContentSpaceProviderFactoryCatalog(host).list().length, 1)
  })

  it('fails each factory location independently without poisoning its sibling catalog', () => {
    const validDocument = providerContribution({
      location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
      providerKind: 'fixture-cloud'
    })
    const incompatibleContent = providerContribution({
      location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
      providerKind: 'fixture-cloud',
      contractVersion: '2.0.0'
    })
    const host = contributionHost([validDocument, incompatibleContent])

    assert.equal(createDocumentProviderFactoryCatalog(host).list().length, 1)
    assert.throws(
      () => createContentSpaceProviderFactoryCatalog(host),
      expectCode('incompatible_contract_version')
    )
  })

  it('rejects duplicate ownership, incompatible majors, and all version or runtime drift', () => {
    assert.throws(
      () => createDocumentProviderFactoryCatalog(contributionHost([
        providerContribution({
          location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
          providerKind: 'fixture-cloud',
          owner: 'fixture.one'
        }),
        providerContribution({
          location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
          providerKind: 'fixture-cloud',
          owner: 'fixture.two'
        })
      ])),
      expectCode('duplicate_provider_kind')
    )
    assert.throws(
      () => createDocumentProviderFactoryCatalog(contributionHost([
        providerContribution({
          location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
          providerKind: 'fixture-cloud',
          contractVersion: '2.0.0'
        })
      ])),
      expectCode('incompatible_contract_version')
    )
    for (const contribution of [
      providerContribution({
        location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
        providerKind: 'fixture-cloud',
        omitDeclarationVersion: true
      }),
      providerContribution({
        location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
        providerKind: 'fixture-cloud',
        declarationVersion: '1.1.0'
      }),
      providerContribution({
        location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
        providerKind: 'fixture-cloud',
        value: {
          location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
          contractVersion: '1.0.0',
          providerKind: 'other-cloud',
          createProvider: () => ({ provider: 'other-cloud' })
        }
      }),
      providerContribution({
        location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
        providerKind: 'fixture-cloud',
        value: defineContentSpaceProviderFactory({
          contractVersion: '1.0.0',
          providerKind: 'fixture-cloud',
          createProvider: () => ({ provider: 'content-space' })
        })
      })
    ]) {
      assert.throws(
        () => createDocumentProviderFactoryCatalog(contributionHost([contribution])),
        expectCode('invalid_contribution')
      )
    }
  })

  it('constructs catalogs and selects instances without invoking factories or ports', async () => {
    let factoryCalls = 0
    let dependencyCalls = 0
    let receivedOwner: unknown
    let receivedInstance: unknown
    const runtime: ProviderFactoryRuntimeValue<FixtureProvider, FixturePorts> = Object.freeze({
      location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: 'fixture-cloud' as ProviderFactoryRuntimeValue<
        FixtureProvider,
        FixturePorts
      >['providerKind'],
      createProvider: (hostView) => {
        factoryCalls += 1
        receivedOwner = hostView.owner
        receivedInstance = hostView.instance
        return { provider: hostView.ports.operationDependency() }
      }
    })
    const catalog = createDocumentProviderFactoryCatalog<FixtureProvider, FixturePorts>(
      contributionHost([providerContribution({
        location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
        providerKind: 'fixture-cloud',
        value: runtime
      })])
    )
    const directory = trustedDirectory([{
      providerInstanceRef: 'provider_instance_alpha',
      providerKind: 'fixture-cloud',
      displayName: 'Alpha'
    }])
    const selected = catalog.select(directory, 'provider_instance_alpha')
    assert.equal(factoryCalls, 0)
    assert.equal(dependencyCalls, 0)
    assert.deepEqual(selected.owner, {
      packageName: '@fixture/fixture-provider-integration',
      moduleId: 'fixture.provider-integration',
      moduleVersion: '1.2.3',
      contributionId: 'fixture.provider-integration.document'
    })

    assert.deepEqual(await selected.createProvider({
      operationDependency: () => {
        dependencyCalls += 1
        return 'lazy-provider'
      }
    }), { provider: 'lazy-provider' })
    assert.equal(factoryCalls, 1)
    assert.equal(dependencyCalls, 1)
    assert.deepEqual(receivedOwner, selected.owner)
    assert.deepEqual(receivedInstance, {
      providerInstanceRef: 'provider_instance_alpha',
      providerKind: 'fixture-cloud',
      displayName: 'Alpha'
    })
  })

  it('fails unknown and missing instances before invoking any factory', () => {
    let factoryCalls = 0
    const catalog = createDocumentProviderFactoryCatalog(contributionHost([
      providerContribution({
        location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
        providerKind: 'fixture-cloud',
        value: defineDocumentProviderFactory({
          contractVersion: '1.0.0',
          providerKind: 'fixture-cloud',
          createProvider: () => {
            factoryCalls += 1
            return { provider: 'fixture-cloud' }
          }
        })
      })
    ]))
    assert.throws(
      () => catalog.select(trustedDirectory(), 'provider_instance_unknown'),
      expectCode('unknown_provider_instance')
    )
    assert.throws(
      () => catalog.select(trustedDirectory(), {
        providerInstanceRef: 'provider_instance_unknown',
        packageName: '@fixture/forced'
      } as unknown as string),
      expectCode('invalid_provider_instance')
    )
    assert.throws(
      () => catalog.select(trustedDirectory([{
        providerInstanceRef: 'provider_instance_missing',
        providerKind: 'missing-cloud',
        displayName: 'Missing'
      }]), 'provider_instance_missing'),
      expectCode('missing_provider')
    )
    assert.equal(factoryCalls, 0)
  })

  it('never falls back when the pinned Provider factory is unavailable', async () => {
    let pinnedCalls = 0
    let fallbackCalls = 0
    const catalog = createDocumentProviderFactoryCatalog<FixtureProvider, FixturePorts>(
      contributionHost([
        providerContribution({
          location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
          providerKind: 'pinned-cloud',
          owner: 'fixture.pinned',
          value: defineDocumentProviderFactory<FixtureProvider, FixturePorts>({
            contractVersion: '1.0.0',
            providerKind: 'pinned-cloud',
            createProvider: () => {
              pinnedCalls += 1
              throw new Error('offline')
            }
          })
        }),
        providerContribution({
          location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
          providerKind: 'fallback-cloud',
          owner: 'fixture.fallback',
          value: defineDocumentProviderFactory<FixtureProvider, FixturePorts>({
            contractVersion: '1.0.0',
            providerKind: 'fallback-cloud',
            createProvider: () => {
              fallbackCalls += 1
              return { provider: 'fallback-cloud' }
            }
          })
        })
      ])
    )
    const selection = catalog.select(trustedDirectory([{
      providerInstanceRef: 'provider_instance_pinned',
      providerKind: 'pinned-cloud',
      displayName: 'Pinned'
    }]), 'provider_instance_pinned')
    await assert.rejects(
      selection.createProvider({ operationDependency: () => 'unused' }),
      expectCode('provider_unavailable')
    )
    assert.equal(pinnedCalls, 1)
    assert.equal(fallbackCalls, 0)
  })

  it('does not let a Provider factory manufacture Host composition errors', async () => {
    const catalog = createDocumentProviderFactoryCatalog<FixtureProvider, FixturePorts>(
      contributionHost([providerContribution({
        location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
        providerKind: 'fixture-cloud',
        value: defineDocumentProviderFactory<FixtureProvider, FixturePorts>({
          contractVersion: '1.0.0',
          providerKind: 'fixture-cloud',
          createProvider: () => {
            throw new ProviderCompositionError(
              'unknown_provider_instance',
              'manufactured by an untrusted runtime value'
            )
          }
        })
      })])
    )
    const selection = catalog.select(trustedDirectory([{
      providerInstanceRef: 'provider_instance_alpha',
      providerKind: 'fixture-cloud',
      displayName: 'Alpha'
    }]), 'provider_instance_alpha')
    await assert.rejects(
      selection.createProvider({ operationDependency: () => 'unused' }),
      expectCode('provider_unavailable')
    )
  })

  it('keeps two instances of one Provider Kind exactly separated', async () => {
    const received: string[] = []
    const catalog = createContentSpaceProviderFactoryCatalog<FixtureProvider, FixturePorts>(
      contributionHost([providerContribution({
        location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
        providerKind: 'fixture-cloud',
        value: defineContentSpaceProviderFactory<FixtureProvider, FixturePorts>({
          contractVersion: '1.0.0',
          providerKind: 'fixture-cloud',
          createProvider: ({ instance }) => {
            received.push(instance.providerInstanceRef)
            return { provider: 'fixture-cloud', instance: instance.providerInstanceRef }
          }
        })
      })])
    )
    const directory = trustedDirectory([{
      providerInstanceRef: 'provider_instance_alpha',
      providerKind: 'fixture-cloud',
      displayName: 'Alpha'
    }, {
      providerInstanceRef: 'provider_instance_beta',
      providerKind: 'fixture-cloud',
      displayName: 'Beta'
    }])
    const ports = { operationDependency: () => 'unused' }
    assert.deepEqual(
      await catalog.select(directory, 'provider_instance_alpha').createProvider(ports),
      { provider: 'fixture-cloud', instance: 'provider_instance_alpha' }
    )
    assert.deepEqual(
      await catalog.select(directory, 'provider_instance_beta').createProvider(ports),
      { provider: 'fixture-cloud', instance: 'provider_instance_beta' }
    )
    assert.deepEqual(received, ['provider_instance_alpha', 'provider_instance_beta'])
  })
})

describe('trusted Provider Instance Directory composition', () => {
  it('strictly validates, sorts, and freezes bounded non-secret entries', () => {
    const contract = {
      location: MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
      contractVersion: '1.0.0',
      providerInstanceRef: 'provider_instance_alpha',
      providerKind: 'fixture-cloud',
      displayName: 'Fixture instance'
    }
    assert.deepEqual(
      providerInstanceDirectoryEntryContributionContractSchema.parse(contract),
      contract
    )
    const directory = createProviderInstanceDirectory(contributionHost([
      instanceContribution({
        owner: 'fixture.beta',
        providerInstanceRef: 'provider_instance_beta',
        runtimeRef: 'provider_instance_beta'
      }),
      instanceContribution()
    ]))
    assert.deepEqual(directory.list().map(({ providerInstanceRef }) => providerInstanceRef), [
      'provider_instance_alpha',
      'provider_instance_beta'
    ])
    assert.equal(Object.isFrozen(directory.list()), true)
    assert.equal(Object.isFrozen(directory.list()[0]), true)
    assert.equal(Object.isFrozen(directory), true)
    assert.equal(Object.isFrozen(Object.getPrototypeOf(directory)), true)
  })

  it('rejects duplicate instances, version drift, runtime drift, and unsafe extra fields', () => {
    assert.throws(
      () => createProviderInstanceDirectory(contributionHost([
        instanceContribution({ owner: 'fixture.one' }),
        instanceContribution({ owner: 'fixture.two' })
      ])),
      expectCode('duplicate_provider_instance')
    )
    assert.throws(
      () => createProviderInstanceDirectory(contributionHost([
        instanceContribution({ declarationVersion: '1.1.0' })
      ])),
      expectCode('invalid_contribution')
    )
    assert.throws(
      () => createProviderInstanceDirectory(contributionHost([
        instanceContribution({ contractVersion: '2.0.0' })
      ])),
      expectCode('incompatible_contract_version')
    )
    assert.throws(
      () => createProviderInstanceDirectory(contributionHost([
        instanceContribution({ runtimeRef: 'provider_instance_other' })
      ])),
      expectCode('invalid_contribution')
    )
    assert.throws(
      () => createProviderInstanceDirectory(contributionHost([instanceContribution({
        value: {
          location: MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
          contractVersion: '1.0.0',
          providerInstanceRef: 'provider_instance_alpha',
          providerKind: 'fixture-cloud',
          displayName: 'Fixture',
          endpoint: 'https://provider.invalid'
        }
      })])),
      expectCode('invalid_contribution')
    )
  })

  it('rejects caller-built directory lookalikes before resolving a Provider', () => {
    const catalog = createContentSpaceProviderFactoryCatalog(contributionHost([
      providerContribution({
        location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
        providerKind: 'fixture-cloud'
      })
    ]))
    const forgedDirectory = Object.freeze({
      resolve: () => ({
        providerInstanceRef: 'provider_instance_forged',
        providerKind: 'fixture-cloud',
        displayName: 'Forged'
      }),
      list: () => Object.freeze([])
    }) as unknown as ProviderInstanceDirectory

    assert.throws(
      () => catalog.select(forgedDirectory, 'provider_instance_forged'),
      expectCode('invalid_provider_instance')
    )
    const genuineDirectory = trustedDirectory([{
      providerInstanceRef: 'provider_instance_alpha',
      providerKind: 'fixture-cloud',
      displayName: 'Alpha'
    }])
    assert.throws(
      () => catalog.select(new Proxy(genuineDirectory, {}), 'provider_instance_alpha'),
      expectCode('invalid_provider_instance')
    )
  })

  it('fails an invalid directory independently without poisoning either factory catalog', () => {
    const host = contributionHost([
      providerContribution({
        location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
        providerKind: 'fixture-cloud'
      }),
      providerContribution({
        location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
        providerKind: 'fixture-cloud'
      }),
      instanceContribution({ runtimeRef: 'provider_instance_other' })
    ])

    assert.equal(createDocumentProviderFactoryCatalog(host).list().length, 1)
    assert.equal(createContentSpaceProviderFactoryCatalog(host).list().length, 1)
    assert.throws(
      () => createProviderInstanceDirectory(host),
      expectCode('invalid_contribution')
    )
  })

  it('ignores unrelated extension locations and rejects an unavailable composition host', () => {
    const unrelated: DomainMainContribution = {
      id: 'fixture.unrelated.extension',
      kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
      packageName: '@fixture/unrelated',
      owner: { moduleId: 'fixture.unrelated', moduleVersion: '1.0.0' },
      contract: { location: 'fixture.unrelated' },
      value: Object.freeze({})
    }
    assert.deepEqual(createProviderInstanceDirectory(contributionHost([unrelated])).list(), [])
    assert.throws(
      () => createProviderInstanceDirectory(undefined as unknown as DomainMainContributionHost),
      expectCode('composition_not_ready')
    )
  })
})

function providerPackageDefinition(): TrustedDomainPackageDefinitionInput {
  const documentId = 'fixture.provider-integration.document'
  const contentId = 'fixture.provider-integration.content-space'
  const documentContract: DomainPackageJsonValue = {
    location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerKind: 'fixture-cloud'
  }
  const contentContract: DomainPackageJsonValue = {
    location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerKind: 'fixture-cloud'
  }
  return {
    contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
    kind: 'trusted-compile-time',
    packageName: '@fixture/fixture-provider-integration',
    module: {
      id: 'fixture.provider-integration',
      displayName: 'Fixture Provider Integration',
      version: '1.2.3',
      hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' }
    },
    contributionContracts: {
      [documentId]: documentContract,
      [contentId]: contentContract
    },
    entrypoints: [{
      process: 'main',
      export: './main',
      contributions: [
        {
          id: documentId,
          kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
          version: PROVIDER_FACTORY_CONTRACT_VERSION
        },
        {
          id: contentId,
          kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
          version: PROVIDER_FACTORY_CONTRACT_VERSION
        }
      ]
    }]
  }
}

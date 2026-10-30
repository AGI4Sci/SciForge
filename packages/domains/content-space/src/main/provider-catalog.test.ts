import { describe, expect, it, vi } from 'vitest'

import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost
} from '@sciforge/domain-sdk/host'
import {
  MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
  MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
  MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
  PROVIDER_FACTORY_CONTRACT_VERSION,
  ProviderCompositionError,
  defineContentSpaceProviderFactory,
  defineDocumentProviderFactory,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'

import {
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  defineContentSpaceProvider,
  type ContentSpaceProvider
} from '../contract.js'
import { ContentSpaceProviderCatalog } from './provider-catalog.js'

describe('ContentSpaceProviderCatalog', () => {
  it('constructs without creating or contacting a Provider, then pins the exact instance', async () => {
    const createProvider = vi.fn(({ instance }) => providerFixture(instance.providerInstanceRef))
    const catalog = new ContentSpaceProviderCatalog(host([
      factoryContribution('factory-a', 'kind-a', createProvider),
      instanceContribution('instance-a', 'kind-a', 'Provider A'),
      documentFactoryContribution('document-kind')
    ]))

    expect(createProvider).not.toHaveBeenCalled()
    expect(catalog.listProviderKinds()).toEqual(['kind-a'])
    expect(catalog.listProviderInstances().map(({ providerInstanceRef }) =>
      providerInstanceRef)).toEqual(['instance-a'])

    const pinned = await catalog.pin('instance-a')
    expect(pinned.providerInstanceRef).toBe('instance-a')
    expect(createProvider).toHaveBeenCalledTimes(1)
    expect(createProvider.mock.calls[0]?.[0].instance.providerInstanceRef).toBe('instance-a')
  })

  it('fails unknown and missing exact Providers without fallback', async () => {
    const catalog = new ContentSpaceProviderCatalog(host([
      factoryContribution('factory-a', 'kind-a', () => providerFixture('instance-a')),
      instanceContribution('instance-a', 'kind-a', 'Provider A'),
      instanceContribution('instance-b', 'kind-b', 'Provider B')
    ]))
    await expect(catalog.pin('unknown-instance')).rejects.toMatchObject({
      code: 'unknown_provider_instance'
    })
    await expect(catalog.pin('instance-b')).rejects.toMatchObject({ code: 'missing_provider' })
  })

  it('fails duplicate Provider Kind ownership during catalog construction', () => {
    expect(() => new ContentSpaceProviderCatalog(host([
      factoryContribution('factory-a', 'kind-a', () => providerFixture('instance-a')),
      factoryContribution('factory-b', 'kind-a', () => providerFixture('instance-a')),
      instanceContribution('instance-a', 'kind-a', 'Provider A')
    ]))).toThrowError(expect.objectContaining<Partial<ProviderCompositionError>>({
      code: 'duplicate_provider_kind'
    }))
  })

  it('binds two instances of the same kind to their exact Host view', async () => {
    const seen: string[] = []
    const catalog = new ContentSpaceProviderCatalog(host([
      factoryContribution('factory-a', 'kind-a', ({ instance }) => {
        seen.push(instance.providerInstanceRef)
        return providerFixture(instance.providerInstanceRef)
      }),
      instanceContribution('instance-a', 'kind-a', 'Provider A'),
      instanceContribution('instance-b', 'kind-a', 'Provider B')
    ]))
    await catalog.pin('instance-b')
    await catalog.pin('instance-a')
    expect(seen).toEqual(['instance-b', 'instance-a'])
  })

  it('rejects a malformed Provider returned by a trusted factory', async () => {
    const catalog = new ContentSpaceProviderCatalog(host([
      factoryContribution('factory-a', 'kind-a', () => ({
        contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION
      }) as ContentSpaceProvider),
      instanceContribution('instance-a', 'kind-a', 'Provider A')
    ]))
    await expect(catalog.pin('instance-a')).rejects.toThrow('contract is invalid')
  })
})

function host(contributions: readonly DomainMainContribution[]): DomainMainContributionHost {
  return Object.freeze({
    list: (kind: typeof MAIN_EXTENSION_CONTRIBUTION_KIND) =>
      kind === MAIN_EXTENSION_CONTRIBUTION_KIND ? contributions : []
  })
}

function factoryContribution(
  id: string,
  providerKind: string,
  createProvider: Parameters<typeof defineContentSpaceProviderFactory<
    ContentSpaceProvider,
    Readonly<{ contractVersion: '1.0.0' }>
  >>[0]['createProvider']
): DomainMainContribution {
  const value = defineContentSpaceProviderFactory({
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerKind,
    createProvider
  })
  return contribution(id, {
    location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerKind
  }, value)
}

function documentFactoryContribution(providerKind: string): DomainMainContribution {
  const value = defineDocumentProviderFactory({
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerKind,
    createProvider: () => Object.freeze({})
  })
  return contribution('document-factory', {
    location: MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION,
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerKind
  }, value)
}

function instanceContribution(
  providerInstanceRef: string,
  providerKind: string,
  displayName: string
): DomainMainContribution {
  const value = defineProviderInstanceDirectoryEntry({
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerInstanceRef,
    providerKind,
    displayName
  })
  return contribution(`instance.${providerInstanceRef}`, {
    location: MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerInstanceRef,
    providerKind,
    displayName
  }, value)
}

function contribution(
  id: string,
  contract: DomainPackageJsonValue,
  value: unknown
): DomainMainContribution {
  return Object.freeze({
    id,
    kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
    packageName: '@sciforge/domain-content-space-mock-provider',
    owner: Object.freeze({ moduleId: 'sciforge.test-provider', moduleVersion: '1.0.0' }),
    version: PROVIDER_FACTORY_CONTRACT_VERSION,
    contract,
    value
  })
}

function providerFixture(providerInstanceRef: string): ContentSpaceProvider {
  return defineContentSpaceProvider({
    contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
    attestExternalBinding: async () => undefined,
    describeCapabilities: async () => [],
    listContainers: async ({ context }) => ({
      providerInstanceRef: context.providerInstanceRef,
      items: []
    }),
    listEntries: async ({ parent }) => ({ parent, items: [] }),
    observeEntry: async () => ({
      entry: {
        kind: 'file',
        reference: { providerInstanceRef, fileId: 'file-a' },
        label: 'File',
        size: 0
      },
      capabilities: []
    }),
    proveFileDescendant: async ({ context, root, candidate }) => ({
      invocationId: context.invocationId,
      providerInstanceRef: context.providerInstanceRef,
      authority: context.providerInstanceRef,
      root,
      candidate,
      binding: context.expectedExternalBinding ?? {
        providerInstanceRef: context.providerInstanceRef,
        principal: context.principal,
        externalSubject: 'a'.repeat(64),
        bindingRevision: 'b'.repeat(64)
      },
      counts: { depth: 1, pages: 1, nodes: 2, elapsedMs: 0 },
      provedAt: new Date().toISOString(),
      cacheable: false,
      portable: false
    }),
    createFolder: async ({ context, parent, name }) => ({
      invocationId: context.invocationId,
      parent,
      name,
      reference: { providerInstanceRef, containerId: 'folder-a' }
    }),
    uploadNewFile: async ({ context, parent, name, source }) => ({
      invocationId: context.invocationId,
      parent,
      name,
      sourceSize: source.size,
      reference: { providerInstanceRef, fileId: 'file-a' },
      writeAfterObservation: {
        parent,
        reference: { providerInstanceRef, fileId: 'file-a' },
        name,
        size: source.size
      }
    }),
    authorizeDownload: async ({ context, reference }) => ({
      consume: async () => ({
        invocationId: context.invocationId,
        reference,
        bytesWritten: 0
      }),
      retire: async () => undefined
    }),
    resolvePortalTarget: async () => ({
      url: 'https://content-space.invalid/portal',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }),
    observeImmutableVersion: async () => ({
      proven: false,
      reasonCode: 'resource_capability_missing'
    })
  })
}

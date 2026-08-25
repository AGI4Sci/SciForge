import { describe, expect, it, vi } from 'vitest'

import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost
} from '@sciforge/domain-sdk/host'
import {
  MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
  MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineContentSpaceProviderFactory,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'

import {
  ARTIFACT_RESOURCE_KIND,
  CONTENT_CONTAINER_REFERENCE_KIND,
  CONTENT_FILE_REFERENCE_KIND,
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  artifactReferenceCodec,
  defineContentSpaceProvider,
  toPortableContentContainerReference,
  toPortableContentFileReference,
  toPortableArtifactReference,
  type ArtifactReference,
  type ContentSpaceProvider
} from '../contract.js'
import {
  createContentSpacePortableAuthorityResolver,
  resolveContentSpacePortableInvocationReference
} from './portable-authority-resolver.js'
import { ContentSpaceProviderCatalog } from './provider-catalog.js'
import { ContentSpaceService } from './service.js'

const PROVIDER_INSTANCE_REF = 'provider-instance-alpha'
const FILE_ID = 'file-one'
const REAL_VERSION = 'version-real'
const REAL_DIGEST = Object.freeze({ algorithm: 'sha256' as const, value: 'a'.repeat(64) })
const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: '123e4567-e89b-42d3-a456-426614174000',
  assurance: 'local-selection' as const,
  deviceId: 'portable-resolver-test-device',
  identityVersion: 1
})

describe('Content Space portable authority resolver', () => {
  it('decodes narrow root and file envelopes through one exact authority without materializing resources', () => {
    const observeEntry = vi.fn()
    const { resolver, createProvider } = resolverFixture(observeEntry)
    const lookupAuthority = vi.fn(resolver.lookupAuthority)
    const materialize = vi.fn(resolver.resolve)
    const invocationResolver = Object.freeze({
      ...resolver,
      lookupAuthority,
      resolve: materialize
    })
    const root = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'container-root'
    })
    const candidate = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      fileId: FILE_ID
    })

    expect(resolveContentSpacePortableInvocationReference(
      invocationResolver,
      toPortableContentContainerReference(root)
    )).toEqual(root)
    expect(resolveContentSpacePortableInvocationReference(
      invocationResolver,
      toPortableContentFileReference(candidate)
    )).toEqual(candidate)
    expect(lookupAuthority).toHaveBeenNthCalledWith(1, {
      reference: PROVIDER_INSTANCE_REF,
      kind: CONTENT_CONTAINER_REFERENCE_KIND
    })
    expect(lookupAuthority).toHaveBeenNthCalledWith(2, {
      reference: PROVIDER_INSTANCE_REF,
      kind: CONTENT_FILE_REFERENCE_KIND
    })
    expect(materialize).not.toHaveBeenCalled()
    expect(createProvider).not.toHaveBeenCalled()
    expect(observeEntry).not.toHaveBeenCalled()
  })

  it('rejects a missing Provider Instance before decoding or materializing', () => {
    const observeEntry = vi.fn()
    const { resolver, createProvider } = resolverFixture(observeEntry)
    const materialize = vi.fn(resolver.resolve)
    const invocationResolver = Object.freeze({ ...resolver, resolve: materialize })
    const root = toPortableContentContainerReference({
      providerInstanceRef: 'provider-instance-missing',
      containerId: 'container-root'
    })

    expect(() => resolveContentSpacePortableInvocationReference(
      invocationResolver,
      root
    )).toThrow('Content Space portable authority is unavailable.')
    expect(materialize).not.toHaveBeenCalled()
    expect(createProvider).not.toHaveBeenCalled()
    expect(observeEntry).not.toHaveBeenCalled()
  })

  it('rejects a resolver authority that is not bound to the envelope authority', () => {
    const observeEntry = vi.fn()
    const { resolver, createProvider } = resolverFixture(observeEntry)
    const materialize = vi.fn(resolver.resolve)
    const root = toPortableContentContainerReference({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'container-root'
    })
    const authority = resolver.lookupAuthority({
      reference: root.authority,
      kind: root.kind
    })!
    const invocationResolver = Object.freeze({
      ...resolver,
      lookupAuthority: vi.fn(() => Object.freeze({
        ...authority,
        reference: 'provider-instance-other'
      })),
      resolve: materialize
    })

    expect(() => resolveContentSpacePortableInvocationReference(
      invocationResolver,
      root
    )).toThrow('Content Space portable authority is unavailable.')
    expect(materialize).not.toHaveBeenCalled()
    expect(createProvider).not.toHaveBeenCalled()
    expect(observeEntry).not.toHaveBeenCalled()
  })

  it('rejects an Artifact envelope presented as a narrow file reference', () => {
    const observeEntry = vi.fn()
    const { resolver, createProvider } = resolverFixture(observeEntry)
    const materialize = vi.fn(resolver.resolve)
    const invocationResolver = Object.freeze({ ...resolver, resolve: materialize })
    const artifact = toPortableArtifactReference({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      fileId: FILE_ID,
      immutableVersionId: REAL_VERSION,
      digest: REAL_DIGEST
    })

    expect(() => resolveContentSpacePortableInvocationReference(
      invocationResolver,
      artifact as ReturnType<typeof toPortableContentFileReference>
    )).toThrow('Portable reference kind is incompatible.')
    expect(materialize).not.toHaveBeenCalled()
    expect(createProvider).not.toHaveBeenCalled()
    expect(observeEntry).not.toHaveBeenCalled()
  })

  it('rejects malformed owner identity without materializing a resource', () => {
    const observeEntry = vi.fn()
    const { resolver, createProvider } = resolverFixture(observeEntry)
    const materialize = vi.fn(resolver.resolve)
    const invocationResolver = Object.freeze({ ...resolver, resolve: materialize })
    const candidate = toPortableContentFileReference({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      fileId: FILE_ID
    })
    const malformed = {
      ...candidate,
      identity: { ...candidate.identity, displayName: 'untrusted metadata' }
    } as unknown as ReturnType<typeof toPortableContentFileReference>

    expect(() => resolveContentSpacePortableInvocationReference(
      invocationResolver,
      malformed
    )).toThrow()
    expect(materialize).not.toHaveBeenCalled()
    expect(createProvider).not.toHaveBeenCalled()
    expect(observeEntry).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong file', { fileId: 'file-other', immutableVersionId: REAL_VERSION }],
    ['wrong version', { fileId: FILE_ID, immutableVersionId: 'version-forged' }],
    ['wrong digest', {
      fileId: FILE_ID,
      immutableVersionId: REAL_VERSION,
      digest: { algorithm: 'sha256' as const, value: 'b'.repeat(64) }
    }]
  ])('rejects a forged ArtifactReference with %s before local registration', async (
    _label,
    identity
  ) => {
    const observeEntry = vi.fn(async ({ reference }) => ({
      entry: {
        kind: 'file' as const,
        reference: {
          providerInstanceRef: reference.providerInstanceRef,
          fileId: reference.fileId
        },
        label: 'File',
        size: 0
      },
      capabilities: [{
        operation: 'observe-immutable-version' as const,
        readiness: 'production_ready' as const,
        reasonCode: 'available' as const
      }]
    }))
    const { resolver } = resolverFixture(observeEntry)
    const artifact = {
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      ...identity
    } as ArtifactReference
    const envelope = toPortableArtifactReference(artifact)
    const authority = resolver.lookupAuthority({
      reference: envelope.authority,
      kind: envelope.kind
    })
    expect(authority).toBeDefined()

    await expect(resolver.resolve({
      envelope,
      identity: artifactReferenceCodec.decodeIdentity(envelope.identity),
      resourceKind: ARTIFACT_RESOURCE_KIND,
      authority: authority!,
      principal,
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ detail: { code: 'immutable_version_unproven' } })
    expect(observeEntry).toHaveBeenCalledTimes(1)
  })

  it('uses a fresh Host assertion for materialize, observe, and safe export projection', async () => {
    const observeEntry = vi.fn(async ({ reference }) => ({
      entry: {
        kind: 'file' as const,
        reference: {
          providerInstanceRef: reference.providerInstanceRef,
          fileId: reference.fileId
        },
        label: 'File',
        size: 0
      },
      capabilities: [{
        operation: 'observe-immutable-version' as const,
        readiness: 'production_ready' as const,
        reasonCode: 'available' as const
      }]
    }))
    const { resolver } = resolverFixture(observeEntry)
    const artifact: ArtifactReference = {
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      fileId: FILE_ID,
      immutableVersionId: REAL_VERSION,
      digest: REAL_DIGEST
    }
    const envelope = toPortableArtifactReference(artifact)
    const authority = resolver.lookupAuthority({
      reference: envelope.authority,
      kind: envelope.kind
    })!
    const materializeAssertion = vi.fn()
    const resolution = await resolver.resolve({
      envelope,
      identity: artifactReferenceCodec.decodeIdentity(envelope.identity),
      resourceKind: ARTIFACT_RESOURCE_KIND,
      authority,
      principal,
      assertPrincipalCurrent: materializeAssertion
    })
    expect(materializeAssertion).toHaveBeenCalled()

    const observeAssertion = vi.fn()
    await resolution.registration.observe({
      principal,
      assertPrincipalCurrent: observeAssertion
    })
    expect(observeAssertion).toHaveBeenCalled()

    const exportAssertion = vi.fn()
    await expect(resolution.exportProjection?.project({
      principal,
      consumer: { moduleId: 'sciforge.content-space', moduleVersion: '1.0.0' },
      assertPrincipalCurrent: exportAssertion
    })).resolves.toEqual({
      fileId: FILE_ID,
      immutableVersionId: REAL_VERSION,
      digest: REAL_DIGEST
    })
    expect(exportAssertion).toHaveBeenCalled()
    expect(observeEntry).toHaveBeenCalledTimes(6)
  })

  it('fails unknown Provider authority without contacting a Provider', () => {
    const observeEntry = vi.fn()
    const { resolver, createProvider } = resolverFixture(observeEntry)
    expect(resolver.lookupAuthority({
      reference: 'provider-instance-unknown',
      kind: artifactReferenceCodec.kind
    })).toBeUndefined()
    expect(createProvider).not.toHaveBeenCalled()
  })

  it.each([
    `xfer_${'a'.repeat(32)}`,
    `portal_${'b'.repeat(32)}`
  ])('does not claim Host-owned runtime handle authority %s', (reference) => {
    const observeEntry = vi.fn()
    const { resolver, createProvider } = resolverFixture(observeEntry)
    expect(resolver.lookupAuthority({
      reference,
      kind: artifactReferenceCodec.kind
    })).toBeUndefined()
    expect(createProvider).not.toHaveBeenCalled()
    expect(observeEntry).not.toHaveBeenCalled()
  })
})

function resolverFixture(observeEntry: ContentSpaceProvider['observeEntry']) {
  const provider = defineContentSpaceProvider({
    contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
    attestExternalBinding: async () => undefined,
    describeCapabilities: async () => [{
      operation: 'observe-entry',
      readiness: 'production_ready',
      reasonCode: 'available'
    }, {
      operation: 'observe-immutable-version',
      readiness: 'production_ready',
      reasonCode: 'available'
    }],
    listContainers: async ({ context }) => ({
      providerInstanceRef: context.providerInstanceRef,
      items: []
    }),
    listEntries: async ({ parent }) => ({ parent, items: [] }),
    observeEntry,
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
    createFolder: async () => { throw new Error('unused') },
    uploadNewFile: async () => { throw new Error('unused') },
    authorizeDownload: async () => { throw new Error('unused') },
    resolvePortalTarget: async () => { throw new Error('unused') },
    observeImmutableVersion: async () => ({
      proven: true,
      proof: {
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: FILE_ID },
        immutableVersionId: REAL_VERSION,
        immutableIdentity: true,
        retentionGuaranteed: true,
        versionSpecificRetrieval: true,
        digest: REAL_DIGEST
      }
    })
  })
  const createProvider = vi.fn(() => provider)
  const catalog = new ContentSpaceProviderCatalog(host([
    contribution('fixture.factory', {
      location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: 'fixture-content-space'
    }, defineContentSpaceProviderFactory<ContentSpaceProvider, Readonly<{
      contractVersion: '1.0.0'
    }>>({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: 'fixture-content-space',
      createProvider
    })),
    contribution('fixture.instance', {
      location: MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      providerKind: 'fixture-content-space',
      displayName: 'Fixture'
    }, defineProviderInstanceDirectoryEntry({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      providerKind: 'fixture-content-space',
      displayName: 'Fixture'
    }))
  ]))
  const service = new ContentSpaceService({
    catalog,
    platform: { fileTransfers: true, externalNavigation: true }
  })
  return Object.freeze({
    createProvider,
    resolver: createContentSpacePortableAuthorityResolver({
      getCatalog: () => catalog,
      getService: () => service
    })
  })
}

function contribution(
  id: string,
  contract: DomainPackageJsonValue,
  value: unknown
): DomainMainContribution {
  return Object.freeze({
    id,
    kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
    packageName: '@fixture/content-space-provider',
    owner: Object.freeze({ moduleId: 'fixture.content-space', moduleVersion: '1.0.0' }),
    version: PROVIDER_FACTORY_CONTRACT_VERSION,
    contract,
    value
  })
}

function host(contributions: readonly DomainMainContribution[]): DomainMainContributionHost {
  return Object.freeze({ list: () => contributions })
}

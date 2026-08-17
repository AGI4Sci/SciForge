import { describe, expect, it } from 'vitest'

import { parsePortableResourceReference } from '@sciforge/domain-sdk/portable-resource-references'

import * as contract from './contract.js'

describe('Content Space public contract', () => {
  it('round-trips only bounded provider-neutral portable identities', () => {
    const container = {
      providerInstanceRef: 'provider-instance-a',
      containerId: 'container_a'
    }
    const file = {
      providerInstanceRef: 'provider-instance-a',
      fileId: 'file_a'
    }
    const artifact = {
      ...file,
      immutableVersionId: 'version_a',
      digest: { algorithm: 'sha256' as const, value: 'a'.repeat(64) }
    }

    expect(contract.parsePortableContentContainerReference(
      contract.toPortableContentContainerReference(container)
    )).toEqual(container)
    expect(contract.parsePortableContentFileReference(
      contract.toPortableContentFileReference(file)
    )).toEqual(file)
    expect(contract.parsePortableArtifactReference(
      contract.toPortableArtifactReference(artifact)
    )).toEqual(artifact)

    const envelope = contract.toPortableContentFileReference(file)
    expect(envelope).not.toHaveProperty('url')
    expect(envelope).not.toHaveProperty('connectionId')
    expect(envelope).not.toHaveProperty('displayName')
  })

  it('rejects URL, credential, path, local handle, and display metadata injection', () => {
    const base = {
      contractVersion: 1,
      kind: contract.CONTENT_FILE_REFERENCE_KIND,
      authority: 'provider-instance-a'
    }
    for (const identity of [
      { fileId: 'file_a', url: 'https://example.invalid' },
      { fileId: 'file_a', token: 'secret-value' },
      { fileId: 'file_a', path: '/tmp/private' },
      { fileId: 'cap_local_handle' },
      { fileId: 'file_a', displayName: 'Leak' }
    ]) {
      expect(() => parsePortableResourceReference({ ...base, identity })).toThrow()
    }
    expect(() => contract.contentFileReferenceSchema.parse({
      providerInstanceRef: 'provider-instance-a',
      fileId: 'file_a',
      endpoint: 'https://example.invalid'
    })).toThrow()
    for (const fileId of [
      `xfer_${'a'.repeat(32)}`,
      `portal_${'a'.repeat(32)}`
    ]) {
      expect(() => contract.contentFileReferenceSchema.parse({
        providerInstanceRef: 'provider-instance-a',
        fileId
      })).toThrow()
    }
  })

  it('enforces bounded pagination, names, invocation IDs, and transfer handles', () => {
    expect(() => contract.contentSpacePageRequestSchema.parse({ limit: 201 })).toThrow()
    expect(() => contract.contentSpaceEntryNameSchema.parse('../escape')).toThrow()
    expect(() => contract.contentSpaceCreateFolderInputSchema.parse({
      parent: { providerInstanceRef: 'provider-instance-a', containerId: 'root' },
      name: 'ok',
      invocationId: 'caller_must_not_supply_this'
    })).toThrow()
    expect(() => contract.contentSpaceUploadNewInputSchema.parse({
      parent: { providerInstanceRef: 'provider-instance-a', containerId: 'root' },
      name: 'file.txt',
      sourceHandle: '/Users/example/file.txt'
    })).toThrow()
    expect(contract.contentSpaceOpenPortalTargetInputSchema.parse({
      handle: `portal_${'p'.repeat(32)}`
    }).handle).toBe(`portal_${'p'.repeat(32)}`)
    expect(() => contract.contentSpaceOpenPortalTargetInputSchema.parse({
      handle: 'https://provider.invalid/portal?token=secret'
    })).toThrow()
  })

  it('keeps outcome_unknown permanently non-retryable', () => {
    expect(() => contract.contentSpaceErrorSchema.parse({
      code: 'outcome_unknown',
      message: 'Unknown',
      retry: 'safe-with-same-invocation'
    })).toThrow()
    expect(contract.contentSpaceErrorSchema.parse({
      code: 'outcome_unknown',
      message: 'Unknown',
      retry: 'never'
    }).retry).toBe('never')
  })

  it('reports only finite operation-bound transfer phases without arbitrary payloads', () => {
    expect(contract.contentSpaceTransferProgressSchema.parse({
      operation: 'upload',
      phase: 'uploading'
    })).toEqual({ operation: 'upload', phase: 'uploading' })
    expect(() => contract.contentSpaceTransferProgressSchema.parse({
      operation: 'download',
      phase: 'uploading'
    })).toThrow()
    expect(() => contract.contentSpaceTransferProgressSchema.parse({
      operation: 'upload',
      phase: 'streaming-provider-payload',
      detail: 'unbounded'
    })).toThrow()
  })

  it('binds readiness exactly to the available reason', () => {
    expect(() => contract.contentSpaceCapabilityStateSchema.parse({
      operation: 'download',
      readiness: 'production_ready',
      reasonCode: 'platform_gate_blocked'
    })).toThrow()
    expect(() => contract.contentSpaceCapabilityStateSchema.parse({
      operation: 'download',
      readiness: 'blocked_by_contract',
      reasonCode: 'available'
    })).toThrow()
    expect(contract.contentSpaceCapabilityStateSchema.parse({
      operation: 'download',
      readiness: 'production_ready',
      reasonCode: 'available'
    }).readiness).toBe('production_ready')
  })

  it('does not expose a caller-controlled ArtifactReference issuer', () => {
    expect(contract).not.toHaveProperty('issueArtifactReference')
  })

  it('accepts only the exact cohesive Provider contract', () => {
    const provider = providerFixture()
    expect(contract.defineContentSpaceProvider(provider)).toBe(provider)
    expect(() => contract.defineContentSpaceProvider({
      ...provider,
      rawClient: {}
    } as typeof provider)).toThrow()
    expect(() => contract.defineContentSpaceProvider({
      ...provider,
      contractVersion: '2.0.0'
    } as unknown as typeof provider)).toThrow()
  })
})

function providerFixture(): contract.ContentSpaceProvider {
  return {
    contractVersion: contract.CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
    describeCapabilities: async () => [],
    listContainers: async ({ context }) => ({
      providerInstanceRef: context.providerInstanceRef,
      items: []
    }),
    listEntries: async ({ parent }) => ({ parent, items: [] }),
    observeEntry: async ({ reference }) => ({
      entry: 'containerId' in reference
        ? { kind: 'container', reference, label: 'Container' }
        : {
            kind: 'file',
            reference: {
              providerInstanceRef: reference.providerInstanceRef,
              fileId: reference.fileId
            },
            label: 'File',
            size: 0
          },
      capabilities: []
    }),
    createFolder: async ({ context, parent, name }) => ({
      invocationId: context.invocationId,
      parent,
      name,
      reference: { providerInstanceRef: parent.providerInstanceRef, containerId: 'new_folder' }
    }),
    uploadNewFile: async ({ context, parent, name, source }) => ({
      invocationId: context.invocationId,
      parent,
      name,
      sourceSize: source.size,
      reference: { providerInstanceRef: parent.providerInstanceRef, fileId: 'new_file' }
    }),
    downloadFile: async ({ context, reference }) => ({
      invocationId: context.invocationId,
      reference,
      bytesWritten: 0
    }),
    resolvePortalTarget: async () => ({
      url: 'https://content-space.invalid/portal',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }),
    observeImmutableVersion: async () => ({
      proven: false,
      reasonCode: 'resource_capability_missing'
    })
  }
}

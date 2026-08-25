import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS,
  type ContentContainerReference,
  type ContentSpaceProvider,
  type ContentSpaceProviderOperationContext,
  type ContentSpaceProviderWriteContext
} from '@sciforge/domain-content-space/contract'

import {
  LOCAL_MOCK_CONTENT_SPACE_LIMITS,
  createLocalMockContentSpaceProvider
} from './local-mock-provider.js'

const PROVIDER_INSTANCE_REF = 'local-content-space-instance'
const NOW = new Date('2026-08-16T08:00:00.000Z')
const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: '123e4567-e89b-42d3-a456-426614174000',
  assurance: 'local-selection' as const,
  deviceId: 'mock-provider-test-device',
  identityVersion: 1
})

describe('local mock Content Space Provider', () => {
  it('lists a stable bounded root and paginates deterministic children', async () => {
    const provider = createProvider()
    const containers = await provider.listContainers({
      context: readContext(),
      page: { limit: 1 }
    })
    expect(containers.items).toHaveLength(1)
    const root = containers.items[0]!.reference
    for (const [index, name] of ['Charlie', 'Alpha', 'Bravo'].entries()) {
      await provider.createFolder({
        context: writeContext(`invocation_folder_page_000${index}`),
        parent: root,
        name
      })
    }

    const first = await provider.listEntries({
      context: readContext(),
      parent: root,
      page: { limit: 2 }
    })
    const second = await provider.listEntries({
      context: readContext(),
      parent: root,
      page: { limit: 2, cursor: first.nextCursor }
    })
    expect(first.items.map(({ label }) => label)).toEqual(['Alpha', 'Bravo'])
    expect(second.items.map(({ label }) => label)).toEqual(['Charlie'])
    expect(second.nextCursor).toBeUndefined()
  })

  it('replays only the exact create invocation and reports collision separately', async () => {
    const provider = createProvider()
    const root = await rootReference(provider)
    const context = writeContext('invocation_create_exact_0001')
    const first = await provider.createFolder({ context, parent: root, name: 'Results' })
    const replay = await provider.createFolder({ context, parent: root, name: 'Results' })
    expect(replay).toEqual(first)

    await expect(provider.createFolder({
      context,
      parent: root,
      name: 'Different'
    })).rejects.toMatchObject({ detail: { code: 'outcome_unknown', retry: 'never' } })
    await expect(provider.createFolder({
      context: writeContext('invocation_create_collision_0002'),
      parent: root,
      name: 'Results'
    })).rejects.toMatchObject({
      detail: { code: 'conflict', retry: 'after-human-action' }
    })
  })

  it('binds upload idempotency to exact bytes, not only size', async () => {
    const provider = createProvider()
    const root = await rootReference(provider)
    const context = writeContext('invocation_upload_exact_0001')
    const first = await provider.uploadNewFile({
      context,
      parent: root,
      name: 'data.bin',
      source: source(new Uint8Array([1, 2, 3]))
    })
    expect(first.writeAfterObservation).toEqual({
      parent: root,
      reference: first.reference,
      name: 'data.bin',
      size: 3
    })
    const replay = await provider.uploadNewFile({
      context,
      parent: root,
      name: 'data.bin',
      source: source(new Uint8Array([1, 2, 3]))
    })
    expect(replay).toEqual(first)
    await expect(provider.uploadNewFile({
      context,
      parent: root,
      name: 'data.bin',
      source: source(new Uint8Array([3, 2, 1]))
    })).rejects.toMatchObject({ detail: { code: 'outcome_unknown' } })
  })

  it('does not create a file when cancellation occurs while reading the source', async () => {
    const provider = createProvider()
    const root = await rootReference(provider)
    const controller = new AbortController()
    await expect(provider.uploadNewFile({
      context: writeContext('invocation_upload_cancel_0001', controller.signal),
      parent: root,
      name: 'cancelled.bin',
      source: {
        name: 'cancelled.bin',
        size: 2,
        read: async () => {
          controller.abort()
          return new Uint8Array([1, 2])
        }
      }
    })).rejects.toMatchObject({ detail: { code: 'cancelled' } })
    const entries = await provider.listEntries({
      context: readContext(),
      parent: root,
      page: { limit: 10 }
    })
    expect(entries.items).toEqual([])
  })

  it('fails stored-byte capacity before reading or allocating another upload', async () => {
    const provider = createProvider()
    const root = await rootReference(provider)
    const full = new Uint8Array(LOCAL_MOCK_CONTENT_SPACE_LIMITS.maxStoredBytes)
    await provider.uploadNewFile({
      context: writeContext('invocation_upload_capacity_0001'),
      parent: root,
      name: 'full.bin',
      source: source(full)
    })
    const read = vi.fn(async () => new Uint8Array([1]))
    await expect(provider.uploadNewFile({
      context: writeContext('invocation_upload_capacity_0002'),
      parent: root,
      name: 'overflow.bin',
      source: { name: 'overflow.bin', size: 1, read }
    })).rejects.toMatchObject({ detail: { code: 'bounds_exceeded' } })
    expect(read).not.toHaveBeenCalled()
  })

  it('retrieves and digests a live file but refuses cross-restart Artifact proof', async () => {
    const provider = createProvider()
    const root = await rootReference(provider)
    const bytes = new Uint8Array([9, 8, 7, 6])
    const uploaded = await provider.uploadNewFile({
      context: writeContext('invocation_upload_artifact_0001'),
      parent: root,
      name: 'artifact.bin',
      source: source(bytes)
    })
    const observed = await provider.observeImmutableVersion({
      context: readContext(),
      reference: uploaded.reference
    })
    expect(observed).toEqual({
      proven: false,
      reasonCode: 'verification_profile_required'
    })
    const chunks: Uint8Array[] = []
    const lease = await provider.authorizeDownload({
      context: writeContext('invocation_download_artifact_0001'),
      reference: uploaded.reference
    })
    expect(chunks).toEqual([])
    const receipt = await lease.consume({
      destination: { write: async (chunk) => { chunks.push(chunk) } }
    })
    expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))).toEqual(Buffer.from(bytes))
    expect(receipt.digest?.value).toBe(createHash('sha256').update(bytes).digest('hex'))

    await expect(lease.consume({
      destination: { write: vi.fn(async () => undefined) }
    })).rejects.toMatchObject({ detail: { code: 'unauthorized' } })
    await expect(lease.retire()).resolves.toBeUndefined()

    await expect(provider.authorizeDownload({
      context: writeContext('invocation_download_forged_0002'),
      reference: {
        ...uploaded.reference,
        immutableVersionId: 'mock_version_1',
        digest: { algorithm: 'sha256', value: '0'.repeat(64) }
      }
    })).rejects.toMatchObject({ detail: { code: 'invalid_reference' } })
  })

  it('proves exact bounded ancestry only under the current non-portable binding', async () => {
    const provider = createProvider()
    const root = await rootReference(provider)
    const child = await provider.createFolder({
      context: writeContext('invocation_proof_folder_0001'),
      parent: root,
      name: 'Nested'
    })
    const uploaded = await provider.uploadNewFile({
      context: writeContext('invocation_proof_upload_0002'),
      parent: child.reference,
      name: 'nested.bin',
      source: source(new Uint8Array([4, 2]))
    })
    const binding = await provider.attestExternalBinding(readContext())
    expect(binding).toBeDefined()
    const context = Object.freeze({
      ...writeContext('invocation_proof_exact_0003'),
      expectedExternalBinding: binding
    })

    await expect(provider.proveFileDescendant({
      context,
      root,
      candidate: uploaded.reference,
      limits: CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS
    })).resolves.toMatchObject({
      root,
      candidate: uploaded.reference,
      binding,
      counts: { depth: 2, pages: 0, nodes: 3 },
      cacheable: false,
      portable: false
    })
    await expect(provider.proveFileDescendant({
      context,
      root: child.reference,
      candidate: {
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        fileId: 'missing-file'
      },
      limits: CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS
    })).rejects.toMatchObject({ detail: { code: 'invalid_reference' } })
  })

  it('binds all operations to the pinned Provider Instance and current deadline', async () => {
    const provider = createProvider()
    await expect(provider.listContainers({
      context: { ...readContext(), providerInstanceRef: 'another-instance' },
      page: { limit: 1 }
    })).rejects.toMatchObject({ detail: { code: 'invalid_target' } })
    await expect(provider.listContainers({
      context: { ...readContext(), deadlineAt: NOW.toISOString() },
      page: { limit: 1 }
    })).rejects.toMatchObject({ detail: { code: 'cancelled' } })
  })

  it('returns only a bounded HTTPS mock portal target', async () => {
    const provider = createProvider()
    const root = await rootReference(provider)
    const target = await provider.resolvePortalTarget({
      context: readContext(),
      reference: root
    })
    expect(target.url).toMatch(/^https:\/\/content-space\.invalid\/portal\//u)
    expect(Date.parse(target.expiresAt) - NOW.getTime()).toBe(60_000)
  })
})

function createProvider(): ContentSpaceProvider {
  return createLocalMockContentSpaceProvider({
    providerInstanceRef: PROVIDER_INSTANCE_REF,
    now: () => NOW
  })
}

async function rootReference(provider: ContentSpaceProvider): Promise<ContentContainerReference> {
  const page = await provider.listContainers({ context: readContext(), page: { limit: 1 } })
  return page.items[0]!.reference
}

function readContext(): ContentSpaceProviderOperationContext {
  return Object.freeze({
    principal,
    providerInstanceRef: PROVIDER_INSTANCE_REF,
    deadlineAt: new Date(NOW.getTime() + 60_000).toISOString(),
    signal: new AbortController().signal,
    assertPrincipalCurrent: () => undefined
  })
}

function writeContext(
  invocationId: string,
  signal = new AbortController().signal
): ContentSpaceProviderWriteContext {
  return Object.freeze({ ...readContext(), invocationId, signal })
}

function source(bytes: Uint8Array) {
  return Object.freeze({
    name: 'input.bin',
    size: bytes.byteLength,
    read: async ({ offset, length }: Readonly<{ offset: number; length: number }>) =>
      bytes.slice(offset, offset + length)
  })
}

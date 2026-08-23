import { describe, expect, it, vi } from 'vitest'

import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS
} from '@sciforge/domain-content-space/extended-operations-contract'

import {
  openContentExtendedCommandInvocationSchema
} from '@sciforge/domain-opencontent-connector/main-contract'
import {
  openContentIdentityIdSchema
} from '@sciforge/domain-opencontent-connector/team-administration-contract'
import {
  OPENCONTENT_EXTENDED_OPERATION_MAPPINGS,
  createOpenContentExtendedOperationAdapter
} from './extended-operation-adapter.js'

const PROVIDER = 'provider-instance-a'
const INVOCATION = 'invocation_extended_0001'
const FILE = Object.freeze({ providerInstanceRef: PROVIDER, fileId: 'file-a' })
const FILE_B = Object.freeze({ providerInstanceRef: PROVIDER, fileId: 'file-b' })
const FOLDER = Object.freeze({ providerInstanceRef: PROVIDER, containerId: 'folder-a' })
const SOURCE_SHA256 = 'd'.repeat(64)
const OPENCONTENT_CLI_RESULT_PROTOCOL = 'opencontent-cli-result:v1' as const
type OpenContentExtendedCommandInvocation = ReturnType<
  typeof openContentExtendedCommandInvocationSchema.parse
>

function success(invocation: OpenContentExtendedCommandInvocation, json: unknown) {
  return Object.freeze({
    protocol: OPENCONTENT_CLI_RESULT_PROTOCOL,
    invocationId: invocation.invocationId,
    command: invocation.command,
    attemptCount: 1,
    outcome: 'succeeded',
    json,
    structuredDeliveryItems: [],
    managedDataFiles: []
  })
}

function adapterWith(
  handler: (invocation: OpenContentExtendedCommandInvocation) => unknown | Promise<unknown>
) {
  const invoke = vi.fn(async (invocation: OpenContentExtendedCommandInvocation) =>
    handler(invocation))
  return {
    invoke,
    adapter: createOpenContentExtendedOperationAdapter({
      providerInstanceRef: PROVIDER,
      transport: { invoke },
      now: () => new Date('2026-08-20T00:00:00.000Z')
    })
  }
}

function failureCode(value: unknown): unknown {
  return (value as { error?: { code?: unknown } }).error?.code
}

describe('OpenContent extended-operation adapter', () => {
  it('exhaustively maps every public operation without vendor Team routing', () => {
    const publicKeys = Object.keys(CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS).sort()
    expect(publicKeys).toHaveLength(52)
    expect(Object.keys(OPENCONTENT_EXTENDED_OPERATION_MAPPINGS).sort()).toEqual(publicKeys)

    for (const key of publicKeys) {
      const operation = key as keyof typeof OPENCONTENT_EXTENDED_OPERATION_MAPPINGS
      const mapping = OPENCONTENT_EXTENDED_OPERATION_MAPPINGS[operation]
      expect(mapping.operation).toBe(operation)
      expect(() => CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS[operation].resultSchema.parse({
        ok: false,
        error: {
          code: 'provider_contract_violation',
          message: 'Strict normalization stopped.',
          retry: 'never'
        }
      })).not.toThrow()
    }
    expect(JSON.stringify(OPENCONTENT_EXTENDED_OPERATION_MAPPINGS)).not.toMatch(
      /raw|argv|environment|team/iu
    )
  })

  it('rejects Provider authority drift before transport and validates request schemas', async () => {
    const { adapter, invoke } = adapterWith(() => {
      throw new Error('must not run')
    })
    const drift = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'getEntryInfo',
      request: { reference: { providerInstanceRef: 'provider-instance-b', fileId: 'file-a' } }
    })
    expect(failureCode(drift)).toBe('invalid_reference')

    const invalid = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'renameEntry',
      request: { target: FILE, name: '../escape' }
    })
    expect(failureCode(invalid)).toBe('invalid_input')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('normalizes discovery information into provider-neutral strict references', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: {
        fileGuid: 'file-guid-a',
        fileName: 'Report.pdf',
        folderGuid: 'folder-guid-a',
        fileSize: 1024,
        fileModifyTime: '2026-08-20T00:00:00.000Z',
        fileVerId: 'version-a'
      }
    }))
    const result = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'getEntryInfo',
      request: { reference: FILE }
    })
    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'file',
        reference: { providerInstanceRef: PROVIDER, fileId: 'file-guid-a' },
        name: 'Report.pdf',
        parent: { providerInstanceRef: PROVIDER, containerId: 'folder-guid-a' },
        size: 1024,
        modifiedAt: '2026-08-20T00:00:00.000Z',
        currentVersionId: 'version-a'
      }
    })
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({ command: 'file-info', dataFiles: [] })
  })

  it('keeps malformed read payloads as provider contract violations', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: {}
    }))
    const result = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'getEntryInfo',
      request: { reference: FILE }
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'provider_contract_violation',
        message: 'File identity is missing.',
        retry: 'never'
      }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('keeps malformed workspace-write transport receipts as provider contract violations', async () => {
    const { adapter, invoke } = adapterWith(() => ({}))
    const write = vi.fn(async () => undefined)
    const result = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'exportFileAsPdf',
      request: { reference: FILE },
      destination: { write }
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'provider_contract_violation',
        message: 'OpenContent returned data outside the declared Provider contract.',
        retry: 'never'
      }
    })
    expect(invoke).toHaveBeenCalledOnce()
    expect(write).not.toHaveBeenCalled()
  })

  it('normalizes one representative read from every non-transfer CLI family', async () => {
    const fixtures: Record<string, unknown> = {
      'meta-types': { success: true, data: [{ TypeId: 'meta-a', TypeName: 'Research' }] },
      'attach-list': { success: true, data: { items: [{ fileId: 'attachment-a', fileName: 'data.csv', size: 12 }] } },
      'relation-list': { success: true, data: { items: [{ fileId: 'file-b', mainRelate: true }] } },
      'file-tag-list': { success: true, data: { items: [{ tagId: 'tag-a', tagName: 'reviewed' }] } },
      'my-publish-list': { success: true, data: { items: [{ Publish_Code: 'Apublication', Publish_Name: 'Release' }] } },
      albums: { success: true, data: { albums: [{ fsId: 'album-a', name: 'Default', fileCount: 2, folderCount: 1, isDefault: true }] } },
      'perm-cates': { success: true, data: [{ cateId: 'edit-a', name: 'Edit' }] },
      'collab-list': {
        success: true,
        data: {
          data: [{
            FileId: 'file-a',
            DocflowFileName: 'Draft.mdoc',
            DocflowCreateTime: '2026-08-20T00:00:00.000Z',
            DocflowFileCreateUserId: 'person-a',
            DocflowFileCreateUserName: 'Ada',
            DocflowRead: 1,
            isDeleted: false
          }]
        }
      },
      'kbox-list': {
        success: true,
        data: { items: [{ boxId: 'box-a', boxName: 'Research', folderId: 'folder-a', boxStatus: 'online' }] }
      }
    }
    const { adapter } = adapterWith((invocation) => success(invocation, fixtures[invocation.command]))
    const cases = [
      ['listMetadataTypes', { providerInstanceRef: PROVIDER, page: { limit: 10 } }],
      ['listAttachments', { master: FILE, page: { limit: 10 } }],
      ['listRelations', { target: FILE, page: { limit: 10 } }],
      ['listTags', { target: FILE, page: { limit: 10 } }],
      ['listPublications', { providerInstanceRef: PROVIDER, page: { limit: 10 } }],
      ['listAlbums', { providerInstanceRef: PROVIDER, page: { limit: 10 } }],
      ['listPermissionCategories', { providerInstanceRef: PROVIDER, targetKind: 'file' }],
      ['listCollaborationEntries', { providerInstanceRef: PROVIDER, filter: 'all', page: { limit: 10 } }],
      ['listKnowledgeCollections', { providerInstanceRef: PROVIDER, page: { limit: 10 } }]
    ] as const
    for (const [operation, request] of cases) {
      const result = await adapter.execute({ invocationId: INVOCATION, operation, request })
      expect(result).toMatchObject({ ok: true })
      expect(() => CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS[operation].resultSchema.parse(result))
        .not.toThrow()
    }
  })

  it('resolves current-principal authority from the authenticated Provider session without supplier dispatch', async () => {
    const currentIdentityId = vi.fn(async () => openContentIdentityIdSchema.parse(9000041))
    const invoke = vi.fn(async () => {
      throw new Error('Supplier transport must not run for current-principal resolution.')
    })
    const adapter = createOpenContentExtendedOperationAdapter({
      providerInstanceRef: PROVIDER,
      currentPrincipal: { currentIdentityId },
      transport: { invoke }
    })

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'getCurrentPrincipal',
      request: { providerInstanceRef: PROVIDER }
    })).resolves.toEqual({
      ok: true,
      value: {
        reference: {
          providerInstanceRef: PROVIDER,
          kind: 'user',
          principalId: '9000041'
        },
        displayName: 'Current OpenContent user'
      }
    })
    expect(OPENCONTENT_EXTENDED_OPERATION_MAPPINGS.getCurrentPrincipal.commands).toEqual([])
    expect(OPENCONTENT_EXTENDED_OPERATION_MAPPINGS.getCurrentPrincipal.route)
      .toBe('current-principal')
    expect(currentIdentityId).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects alias-shaped or conflicting current-principal authority from the semantic port', async () => {
    const invalidAuthorities = [
      { identityId: 41 },
      { IdentityId: 41 },
      { identityId: 41, IdentityId: 42 },
      { id: 41 },
      { Id: 41 },
      { guid: 'synthetic-guid-a' },
      { Guid: 'synthetic-guid-b' },
      { identityId: 41, displayName: 'Synthetic User', name: 'Conflicting Synthetic User' },
      { identityId: 41, Name: 'Synthetic User' },
      { identityId: 41, userName: 'Synthetic User' },
      { identityId: 41, UserName: 'Synthetic User' }
    ]

    for (const invalidAuthority of invalidAuthorities) {
      const adapter = createOpenContentExtendedOperationAdapter({
        providerInstanceRef: PROVIDER,
        currentPrincipal: {
          currentIdentityId: async () => invalidAuthority as never
        }
      })
      await expect(adapter.execute({
        invocationId: INVOCATION,
        operation: 'getCurrentPrincipal',
        request: { providerInstanceRef: PROVIDER }
      })).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'provider_contract_violation',
          retry: 'never'
        }
      })
    }
  })

  it('blocks unpinned directory result contracts before supplier dispatch', async () => {
    const { adapter, invoke } = adapterWith(() => {
      throw new Error('Supplier transport must not run.')
    })

    for (const operation of [
      'searchUsers',
      'searchDepartments',
      'searchPositions',
      'searchGroups'
    ] as const) {
      await expect(adapter.execute({
        invocationId: INVOCATION,
        operation,
        request: {
          providerInstanceRef: PROVIDER,
          query: 'Ada',
          page: { limit: 10 }
        }
      })).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'blocked_by_contract',
          retry: 'never'
        }
      })
    }
    expect(invoke).not.toHaveBeenCalled()
  })

  it('executes one mutation attempt and never replays an unknown write outcome', async () => {
    const { adapter, invoke } = adapterWith(async () => {
      const error = new Error('Socket closed after the write started.') as Error & { code: string }
      error.code = 'outcome-unknown'
      throw error
    })
    const result = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'renameEntry',
      request: { target: FILE, name: 'Renamed.pdf' }
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'outcome_unknown',
        message: 'Socket closed after the write started.',
        retry: 'never'
      }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('reports an unknown destructive outcome when the deletion receipt count mismatches', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: { operationCount: 1, successCount: 1 }
    }))
    const result = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'deleteEntries',
      request: { entries: [FILE, FOLDER] }
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'outcome_unknown',
        message: 'OpenContent deletion count does not match the request.',
        retry: 'never'
      }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('does not claim a rename when the successful transport has no target proof', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: {}
    }))
    const result = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'renameEntry',
      request: { target: FILE, name: 'Renamed.pdf' }
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'outcome_unknown',
        message: 'OpenContent rename receipt does not prove the requested target and name.',
        retry: 'never'
      }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('does not claim copied result identities from a malformed mutation receipt', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: {}
    }))
    const result = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'copyEntries',
      request: { entries: [FILE], destination: FOLDER }
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'outcome_unknown',
        message: 'OpenContent copy did not return every created entry identity.',
        retry: 'never'
      }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('does not claim moved entries from a receipt without completed batch counts', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: {}
    }))
    const result = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'moveEntries',
      request: { entries: [FILE], destination: FOLDER }
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'outcome_unknown',
        message: 'OpenContent move receipt did not prove completion for every requested entry.',
        retry: 'never'
      }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('treats an invalid mutation receipt identity as unknown after transport returns', async () => {
    const { adapter, invoke } = adapterWith((invocation) => Object.freeze({
      ...success(invocation, {
        success: true,
        data: { id: 'file-a', type: 'file', newName: 'Renamed.pdf' }
      }),
      command: 'copy' as const
    }))
    const result = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'renameEntry',
      request: { target: FILE, name: 'Renamed.pdf' }
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'outcome_unknown',
        message: 'The CLI runner returned a receipt for another invocation or command.',
        retry: 'never'
      }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it.each([
    [409, 'conflict'],
    [403, 'unauthorized']
  ] as const)(
    'preserves explicit Provider business code %s after mutation dispatch',
    async (providerCode, expectedCode) => {
      const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
        success: false,
        code: providerCode,
        error: `Provider business error ${providerCode}.`
      }))
      const result = await adapter.execute({
        invocationId: INVOCATION,
        operation: 'renameEntry',
        request: { target: FILE, name: 'Renamed.pdf' }
      })
      expect(failureCode(result)).toBe(expectedCode)
      expect(invoke).toHaveBeenCalledOnce()
    }
  )

  it('accepts operation-specific mutation proofs without inventing identities or counts', async () => {
    const { adapter } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: invocation.command === 'rename'
        ? { id: 'resolved-file-a', type: 'file', newName: 'Renamed.pdf' }
        : invocation.command === 'copy'
          ? { items: [{ newId: 'copied-file-a' }] }
          : { operationCount: 1, successCount: 1 }
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'renameEntry',
      request: { target: FILE, name: 'Renamed.pdf' }
    })).resolves.toEqual({ ok: true, value: { target: FILE, name: 'Renamed.pdf' } })

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'copyEntries',
      request: { entries: [FILE], destination: FOLDER }
    })).resolves.toEqual({
      ok: true,
      value: { items: [{ ok: true, source: FILE, result: { providerInstanceRef: PROVIDER, fileId: 'copied-file-a' } }] }
    })

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'moveEntries',
      request: { entries: [FILE], destination: FOLDER }
    })).resolves.toEqual({
      ok: true,
      value: { items: [{ ok: true, source: FILE, result: FILE }] }
    })

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'deleteEntries',
      request: { entries: [FILE] }
    })).resolves.toEqual({ ok: true, value: { deleted: [FILE], failed: [] } })
  })

  it('passes managed source and destination streams without handles, paths, or size downgrades', async () => {
    const writes: Uint8Array[] = []
    const sourceRead = vi.fn(async () => new Uint8Array([1, 2, 3]))
    const destinationWrite = vi.fn(async (chunk: Uint8Array) => { writes.push(chunk) })
    const seen: OpenContentExtendedCommandInvocation[] = []
    const { adapter } = adapterWith(async (invocation) => {
      seen.push(invocation)
      if (invocation.command === 'upload') {
        return success(invocation, {
          success: true,
          data: { fileId: 'attachment-a', createTime: '2026-08-20T00:00:00.000Z' }
        })
      }
      const destination = invocation.dataFiles[0]
      if (destination?.role === 'destination') await destination.write(new Uint8Array([4, 5]))
      return success(invocation, { success: true, data: { bytesWritten: 2 } })
    })
    const attachment = await adapter.execute({
      invocationId: 'invocation_extended_0004',
      operation: 'addAttachment',
      request: { master: FILE, name: 'Evidence.csv' },
      source: { name: 'Evidence.csv', size: 3, sha256: SOURCE_SHA256, read: sourceRead }
    })
    expect(attachment).toMatchObject({
      ok: true,
      value: {
        attachment: { fileId: 'attachment-a' },
        name: 'Evidence.csv',
        size: 3
      }
    })
    const upload = seen.find((item) => item.command === 'upload')
    expect(upload?.args).toEqual({ masterFileId: FILE.fileId })
    expect(upload?.dataFiles[0]).toMatchObject({
      role: 'source',
      encoding: 'managed-stream',
      size: 3
    })
    expect(JSON.stringify(upload?.args)).not.toMatch(/xfer_|filePaths|\/tmp\//u)

    const exported = await adapter.execute({
      invocationId: 'invocation_extended_0002',
      operation: 'exportFileAsPdf',
      request: { reference: FILE },
      destination: { write: destinationWrite }
    })
    expect(exported).toMatchObject({ ok: true, value: { bytesWritten: 2, format: 'pdf' } })
    expect(writes).toEqual([new Uint8Array([4, 5])])
  })

  it('blocks same-file version updates until OpenContent exposes atomic CAS', async () => {
    const { adapter, invoke } = adapterWith(() => {
      throw new Error('unexpected Provider invocation')
    })
    const result = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'updateFileVersion',
      request: { reference: FILE, strategy: 'major', expectedVersionId: 'version-a' },
      source: {
        name: 'Report.pdf',
        size: 3,
        sha256: SOURCE_SHA256,
        read: async () => new Uint8Array(3)
      }
    })
    expect(failureCode(result)).toBe('blocked_by_contract')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('uses names for tag assignment and complete relation endpoints for removal', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: { applied: true }
    }))
    const tags = await adapter.execute({
      invocationId: INVOCATION,
      operation: 'setTags',
      request: { targets: [FILE, FILE_B], names: ['reviewed'] }
    })
    expect(tags).toEqual({ ok: true, value: { targets: [FILE, FILE_B], names: ['reviewed'] } })
    expect(invoke.mock.calls[0]?.[0].args).toEqual({ fileIds: 'file-a,file-b', tags: 'reviewed' })

    const relation = {
      reference: { providerInstanceRef: PROVIDER, relationId: 'file-a:file-b' },
      source: FILE,
      target: FILE_B,
      kind: 'related' as const
    }
    const removed = await adapter.execute({
      invocationId: 'invocation_extended_0003',
      operation: 'removeRelation',
      request: { relation }
    })
    expect(removed).toMatchObject({ ok: true, value: { removed: true } })
    expect(invoke.mock.calls[1]?.[0].args).toEqual({ fileId: 'file-a', relatedFileId: 'file-b' })
  })
})

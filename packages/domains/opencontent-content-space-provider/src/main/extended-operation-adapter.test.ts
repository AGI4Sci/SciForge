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
    json
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
        fileGuid: FILE.fileId,
        fileName: 'Report.pdf',
        folderGuid: 'folder-guid-a',
        fileSize: 1024,
        fileModifyTime: '2026-08-20T00:00:00.000Z',
        fileLastVerId: 'version-a'
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
        reference: FILE,
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

  it('rejects a bare supplier payload instead of guessing a success envelope', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      fileGuid: FILE.fileId,
      fileName: 'Report.pdf',
      folderGuid: FOLDER.containerId,
      fileSize: 1024
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'getEntryInfo',
      request: { reference: FILE }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('rejects a response alias even when it repeats the canonical identity', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: {
        fileGuid: FILE.fileId,
        fileId: FILE.fileId,
        fileName: 'Report.pdf',
        folderGuid: FOLDER.containerId,
        fileSize: 1024
      }
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'getEntryInfo',
      request: { reference: FILE }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('rejects an alias-only response instead of minting a resource identity', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: {
        fileId: FILE.fileId,
        fileName: 'Report.pdf',
        folderGuid: FOLDER.containerId,
        fileSize: 1024
      }
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'getEntryInfo',
      request: { reference: FILE }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it.each([
    ['a non-string required field', { fileName: 42 }],
    ['an empty present optional string', { fileLastVerId: '' }],
    ['a string-coerced required number', { fileSize: '1024' }],
    ['an invalid present timestamp', { fileModifyTime: 'not-a-time' }],
    ['a whitespace-normalized canonical identity', { fileGuid: ` ${FILE.fileId} ` }]
  ] as const)('rejects %s in a canonical file receipt', async (_label, drift) => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: {
        fileGuid: FILE.fileId,
        fileName: 'Report.pdf',
        folderGuid: FOLDER.containerId,
        fileSize: 1024,
        ...drift
      }
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'getEntryInfo',
      request: { reference: FILE }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it.each([null, ''] as const)(
    'rejects a present malformed optional page total %p',
    async (total) => {
      const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
        success: true,
        data: { items: [], total }
      }))

      await expect(adapter.execute({
        invocationId: INVOCATION,
        operation: 'listAttachments',
        request: { master: FILE, page: { limit: 10 } }
      })).resolves.toMatchObject({
        ok: false,
        error: { code: 'provider_contract_violation', retry: 'never' }
      })
      expect(invoke).toHaveBeenCalledOnce()
    }
  )

  it('rejects a missing canonical result list instead of normalizing it to empty', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: {}
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'listMetadataTypes',
      request: { providerInstanceRef: PROVIDER, page: { limit: 10 } }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it.each(['unknown', 0] as const)(
    'rejects a malformed completeness boolean %p instead of coercing it',
    async (truncated) => {
      const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
        success: true,
        data: {
          executable: true,
          fileScope: { fileGuids: [], total: 0, truncated }
        }
      }))

      await expect(adapter.execute({
        invocationId: INVOCATION,
        operation: 'buildFileScope',
        request: {
          scope: { kind: 'provider-scope', providerInstanceRef: PROVIDER, scope: 'personal' },
          query: 'report'
        }
      })).resolves.toMatchObject({
        ok: false,
        error: { code: 'provider_contract_violation', retry: 'never' }
      })
      expect(invoke).toHaveBeenCalledOnce()
    }
  )

  it('rejects a missing file-scope identity array instead of minting an empty scope', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: {
        executable: true,
        fileScope: { total: 0, truncated: false }
      }
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'buildFileScope',
      request: {
        scope: { kind: 'provider-scope', providerInstanceRef: PROVIDER, scope: 'personal' },
        query: 'report'
      }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it.each(['unknown', '1 KB'] as const)(
    'rejects a malformed attachment size %p instead of coercing it',
    async (size) => {
      const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
        success: true,
        data: {
          items: [{ fileId: FILE_B.fileId, fileName: 'Evidence.csv', size }],
          total: 1
        }
      }))

      await expect(adapter.execute({
        invocationId: INVOCATION,
        operation: 'listAttachments',
        request: { master: FILE, page: { limit: 10 } }
      })).resolves.toMatchObject({
        ok: false,
        error: { code: 'provider_contract_violation', retry: 'never' }
      })
      expect(invoke).toHaveBeenCalledOnce()
    }
  )

  it('rejects a paged response without an exact completeness count', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: { items: [] }
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'listAttachments',
      request: { master: FILE, page: { limit: 10 } }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('rejects contradictory metadata multiplicity instead of overriding the supplier receipt', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: {
        typeName: 'Research',
        attrs: [{
          attrId: 'field-a',
          attrName: 'Choice',
          controlType: 'edoc2DynamicList',
          required: false,
          multiple: false,
          readOnly: false
        }]
      }
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'listMetadataFields',
      request: {
        type: { providerInstanceRef: PROVIDER, metadataTypeId: 'meta-a' }
      }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('requires an exact search-result kind instead of defaulting a missing kind to file', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: { items: [{ id: FILE.fileId }], total: 1 }
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'searchEntries',
      request: {
        scope: { kind: 'provider-scope', providerInstanceRef: PROVIDER, scope: 'personal' },
        query: 'report',
        page: { limit: 10 }
      }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('requires exact numeric authority kinds in permission receipts', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: [{ memberType: 'user', memberId: 'user-a', permCateId: 'edit-a', state: 0 }]
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'listPermissions',
      request: { target: FILE, targetKind: 'file' }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('requires an exact favorite entry kind instead of defaulting a missing kind to file', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: { files: [{ fileId: FILE.fileId, fvId: 'favorite-a' }], totalCount: 1 }
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'listAlbumEntries',
      request: {
        album: { providerInstanceRef: PROVIDER, albumId: 'album-a' },
        page: { limit: 10 }
      }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('normalizes one representative read from every non-transfer CLI family', async () => {
    const fixtures: Record<string, unknown> = {
      'meta-types': { success: true, data: [{ TypeId: 'meta-a', TypeName: 'Research' }] },
      'attach-list': { success: true, data: { items: [{ fileId: 'attachment-a', fileName: 'data.csv', size: 12 }], total: 1 } },
      'relation-list': { success: true, data: { items: [{ fileId: 'file-b', mainRelate: true }], total: 1 } },
      'file-tag-list': { success: true, data: { items: [{ tagId: 'tag-a', tagName: 'reviewed' }] } },
      'my-publish-list': { success: true, data: { items: [{ Publish_Code: 'Apublication', Publish_Name: 'Release' }], totalCount: 1 } },
      albums: { success: true, data: { albums: [{ fsId: 'album-a', name: 'Default', fileCount: 2, folderCount: 1, isDefault: true }], totalCount: 1 } },
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
          }],
          allCount: 1
        }
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
      ['listCollaborationEntries', { providerInstanceRef: PROVIDER, filter: 'all', page: { limit: 10 } }]
    ] as const
    for (const [operation, request] of cases) {
      const result = await adapter.execute({ invocationId: INVOCATION, operation, request })
      expect(result, `${operation}: ${JSON.stringify(result)}`).toMatchObject({ ok: true })
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

  it('blocks unpinned knowledge-root receipts before supplier dispatch', async () => {
    const { adapter, invoke } = adapterWith(() => {
      throw new Error('Supplier transport must not run.')
    })

    for (const operation of [
      'listKnowledgeCollections',
      'searchKnowledgeCollections'
    ] as const) {
      await expect(adapter.execute({
        invocationId: INVOCATION,
        operation,
        request: {
          providerInstanceRef: PROVIDER,
          ...(operation === 'searchKnowledgeCollections' ? { query: 'Research' } : {}),
          page: { limit: 10 }
        }
      })).resolves.toMatchObject({
        ok: false,
        error: { code: 'blocked_by_contract', retry: 'never' }
      })
    }
    expect(invoke).not.toHaveBeenCalled()
  })

  it('blocks unpinned link receipts before supplier dispatch', async () => {
    const { adapter, invoke } = adapterWith(() => {
      throw new Error('Supplier transport must not run.')
    })

    for (const [operation, request] of [
      ['resolveInternalLink', { reference: FILE }],
      ['resolveCollaborationInvitation', { file: FILE }]
    ] as const) {
      await expect(adapter.execute({
        invocationId: INVOCATION,
        operation,
        request
      })).resolves.toMatchObject({
        ok: false,
        error: { code: 'blocked_by_contract', retry: 'never' }
      })
    }
    expect(invoke).not.toHaveBeenCalled()
  })

  it('blocks metadata-choice pagination without a supplier completeness receipt', async () => {
    const { adapter, invoke } = adapterWith(() => {
      throw new Error('Supplier transport must not run.')
    })

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'listMetadataChoices',
      request: {
        field: {
          type: { providerInstanceRef: PROVIDER, metadataTypeId: 'meta-a' },
          fieldId: 'field-a'
        },
        page: { limit: 10 }
      }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'blocked_by_contract', retry: 'never' }
    })
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

  it('does not claim a rename when the receipt identifies a different target', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: { id: 'different-file', type: 'file', newName: 'Renamed.pdf' }
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

  it('treats a dual success envelope as an unknown mutation outcome', async () => {
    const { adapter, invoke } = adapterWith((invocation) => success(invocation, {
      success: true,
      data: { id: FILE.fileId, type: 'file', newName: 'Renamed.pdf' },
      result: 0
    }))

    await expect(adapter.execute({
      invocationId: INVOCATION,
      operation: 'renameEntry',
      request: { target: FILE, name: 'Renamed.pdf' }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'outcome_unknown', retry: 'never' }
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
        ? { id: FILE.fileId, type: 'file', newName: 'Renamed.pdf' }
        : invocation.command === 'copy'
          ? { items: [{ resultId: 'copied-file-a' }] }
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

  it('passes managed source streams without handles, paths, or size downgrades', async () => {
    const sourceRead = vi.fn(async () => new Uint8Array([1, 2, 3]))
    const seen: OpenContentExtendedCommandInvocation[] = []
    const { adapter } = adapterWith(async (invocation) => {
      seen.push(invocation)
      return success(invocation, {
        success: true,
        data: { fileId: 'attachment-a', createTime: '2026-08-20T00:00:00.000Z' }
      })
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

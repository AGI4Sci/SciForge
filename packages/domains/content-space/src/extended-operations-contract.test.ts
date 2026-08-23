import { describe, expect, it } from 'vitest'

import * as contract from './extended-operations-contract.js'

describe('Content Space extended operations contract', () => {
  it('publishes a closed provider-neutral operation catalog without vendor Team governance', () => {
    const operations = Object.values(contract.CONTENT_SPACE_EXTENDED_OPERATIONS)

    expect(contract.CONTENT_SPACE_EXTENDED_CONTRACT_VERSION).toBe('2.0.0')
    expect(new Set(operations.map(({ id }) => id)).size).toBe(operations.length)
    expect(new Set(operations.map(({ key }) => key)).size).toBe(operations.length)
    expect(operations.every(({ id }) => id.startsWith('content-space.'))).toBe(true)
    expect(operations.map(({ family }) => family)).not.toContain('team-governance')
    expect(contract.CONTENT_SPACE_EXTENDED_OPERATIONS).not.toHaveProperty('updateTeamMemberRole')
    expect(contract.CONTENT_SPACE_EXTENDED_OPERATIONS).not.toHaveProperty('transferTeamOwnership')
    expect(JSON.stringify(operations)).not.toMatch(/opencontent|raw|team/iu)
  })

  it('accepts bounded structured discovery criteria and rejects query passthrough', () => {
    const request = {
      scope: {
        kind: 'container' as const,
        container: { providerInstanceRef: 'provider-instance-a', containerId: 'root_a' }
      },
      query: 'quarterly report',
      entryKinds: ['file' as const],
      extensions: ['pdf'],
      modified: {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-08-20T00:00:00.000Z'
      },
      page: { limit: 20 },
      sort: { field: 'modified-at' as const, direction: 'descending' as const }
    }

    expect(contract.contentSpaceSearchEntriesRequestSchema.parse(request)).toEqual(request)
    expect(() => contract.contentSpaceSearchEntriesRequestSchema.parse({
      ...request,
      providerQuery: 'name:* OR secret:true'
    })).toThrow()
    expect(() => contract.contentSpaceSearchEntriesRequestSchema.parse({
      ...request,
      scope: { kind: 'container', container: { providerUrl: 'https://provider.invalid' } }
    })).toThrow()
  })

  it('uses a closed typed error envelope for every extended result', () => {
    expect(contract.contentSpaceExtendedErrorSchema.parse({
      code: 'not_found',
      message: 'The requested entry is unavailable.',
      retry: 'never'
    }).code).toBe('not_found')
    expect(() => contract.contentSpaceExtendedErrorSchema.parse({
      code: 'provider_500',
      message: 'leaked provider response',
      retry: 'never',
      response: { result: 500 }
    })).toThrow()
  })

  it('rejects a non-user principal from the typed user-search result', () => {
    const result = (kind: 'user' | 'department' | 'position' | 'group') => ({
      ok: true,
      value: {
        items: [{
          reference: {
            providerInstanceRef: 'provider-instance-a',
            kind,
            principalId: `${kind}-a`
          },
          displayName: `${kind} A`
        }]
      }
    })

    expect(() => contract.contentSpaceSearchUsersResultSchema.parse(result('department')))
      .toThrow()
    expect(() => contract.contentSpaceSearchUsersResultSchema.parse({
      ok: true,
      value: {
        items: [
          ...result('user').value.items,
          ...result('department').value.items
        ]
      }
    })).toThrow()
    for (const [schema, kind] of [
      [contract.contentSpaceSearchUsersResultSchema, 'user'],
      [contract.contentSpaceSearchDepartmentsResultSchema, 'department'],
      [contract.contentSpaceSearchPositionsResultSchema, 'position'],
      [contract.contentSpaceSearchGroupsResultSchema, 'group']
    ] as const) {
      expect(schema.parse(result(kind))).toMatchObject({
        ok: true,
        value: { items: [{ reference: { kind } }] }
      })
    }
    expect(contract.contentSpaceSearchDepartmentsResultSchema)
      .not.toBe(contract.contentSpaceSearchUsersResultSchema)
    expect(() => contract.contentSpaceSearchDepartmentsResultSchema.parse(result('user')))
      .toThrow()
  })

  it('keeps a user-search directory scope aligned with its typed principal', () => {
    const request = {
      providerInstanceRef: 'provider-instance-a',
      query: 'Ada',
      page: { limit: 20 },
      within: {
        kind: 'department' as const,
        principal: {
          providerInstanceRef: 'provider-instance-a',
          kind: 'department' as const,
          principalId: 'department-a'
        },
        recursive: true
      }
    }

    expect(contract.contentSpaceSearchUsersRequestSchema.parse(request)).toEqual(request)
    expect(() => contract.contentSpaceSearchUsersRequestSchema.parse({
      ...request,
      within: {
        ...request.within,
        principal: {
          ...request.within.principal,
          kind: 'position'
        }
      }
    })).toThrow()
    expect(contract.contentSpaceSearchUsersRequestSchema.parse({
      ...request,
      within: {
        kind: 'position',
        principal: {
          providerInstanceRef: 'provider-instance-a',
          kind: 'position',
          principalId: 'position-a'
        },
        recursive: false
      }
    }).within).toMatchObject({ kind: 'position', principal: { kind: 'position' } })
  })

  it('models metadata values as a closed discriminated union', () => {
    expect(contract.contentSpaceMetadataValueSchema.parse({
      kind: 'number',
      value: 42
    })).toEqual({ kind: 'number', value: 42 })
    expect(contract.contentSpaceMetadataValueSchema.parse({
      kind: 'directory-principals',
      values: [{
        providerInstanceRef: 'provider-instance-a',
        kind: 'user',
        principalId: 'person_a'
      }]
    }).kind).toBe('directory-principals')
    expect(() => contract.contentSpaceMetadataValueSchema.parse({
      kind: 'provider-value',
      value: { arbitrary: true }
    })).toThrow()
  })

  it('keeps new-version updates and PDF export explicit and typed', () => {
    expect(contract.contentSpaceUpdateFileVersionRequestSchema.parse({
      reference: { providerInstanceRef: 'provider-instance-a', fileId: 'file_a' },
      sourceHandle: `xfer_${'s'.repeat(32)}`,
      strategy: 'major',
      expectedVersionId: 'version_a'
    }).strategy).toBe('major')
    expect(contract.contentSpaceUpdateFileVersionReceiptSchema.parse({
      reference: { providerInstanceRef: 'provider-instance-a', fileId: 'file_a' },
      versionId: 'version_b',
      strategy: 'minor',
      byteLength: 128,
      digest: { algorithm: 'sha256', value: 'a'.repeat(64) }
    })).toMatchObject({ versionId: 'version_b', byteLength: 128 })
    expect(contract.contentSpaceExportFileAsPdfRequestSchema.parse({
      reference: { providerInstanceRef: 'provider-instance-a', fileId: 'file_a' },
      destinationHandle: `xfer_${'d'.repeat(32)}`
    }).reference.fileId).toBe('file_a')
    expect(() => contract.contentSpaceUpdateFileVersionRequestSchema.parse({
      reference: { providerInstanceRef: 'provider-instance-a', fileId: 'file_a' },
      sourceHandle: '/tmp/new-version.pdf',
      strategy: 'overwrite-whatever-provider-supports'
    })).toThrow()
    expect(() => contract.contentSpaceUpdateFileVersionRequestSchema.parse({
      reference: { providerInstanceRef: 'provider-instance-a', fileId: 'file_a' },
      sourceHandle: `xfer_${'s'.repeat(32)}`,
      strategy: 'major'
    })).toThrow()
    expect(() => contract.contentSpaceUpdateFileVersionRequestSchema.parse({
      reference: { providerInstanceRef: 'provider-instance-a', fileId: 'file_a' },
      sourceHandle: `xfer_${'s'.repeat(32)}`,
      strategy: 'replace-latest',
      expectedVersionId: 'version_a'
    })).toThrow()
    expect(contract.CONTENT_SPACE_EXTENDED_OPERATIONS.exportFileAsPdf.effect)
      .toBe('workspace-write')
  })

  it('uses Workspace-relative paths for Agent extended transfers', () => {
    const reference = { providerInstanceRef: 'provider-instance-a', fileId: 'file_a' }
    const sourceHandle = `xfer_${'s'.repeat(32)}`
    const destinationHandle = `xfer_${'d'.repeat(32)}`

    expect(contract.contentSpaceAgentExtendedRequestSchema('updateFileVersion').parse({
      reference,
      workspaceRelativePath: 'versions/file-v2.pdf',
      strategy: 'major',
      expectedVersionId: 'version_a'
    })).toMatchObject({ workspaceRelativePath: 'versions/file-v2.pdf' })
    expect(contract.contentSpaceAgentExtendedRequestSchema('addAttachment').parse({
      master: reference,
      name: 'evidence.csv',
      workspaceRelativePath: 'attachments/evidence.csv'
    })).toMatchObject({ workspaceRelativePath: 'attachments/evidence.csv' })
    expect(contract.contentSpaceAgentExtendedRequestSchema('exportFileAsPdf').parse({
      reference,
      workspaceRelativePath: 'exports/file.pdf'
    })).toMatchObject({ workspaceRelativePath: 'exports/file.pdf' })

    expect(() => contract.contentSpaceAgentExtendedRequestSchema('updateFileVersion').parse({
      reference,
      sourceHandle,
      strategy: 'major',
      expectedVersionId: 'version_a'
    })).toThrow()
    expect(() => contract.contentSpaceAgentExtendedRequestSchema('exportFileAsPdf').parse({
      reference,
      destinationHandle
    })).toThrow()
    expect(() => contract.contentSpaceAgentExtendedRequestSchema('addAttachment').parse({
      master: reference,
      name: 'escape.txt',
      workspaceRelativePath: '../escape.txt'
    })).toThrow()
  })

  it('separates tag-name assignment from identity-based tag removal', () => {
    const target = { providerInstanceRef: 'provider-instance-a', fileId: 'file_a' }
    expect(contract.contentSpaceSetTagsRequestSchema.parse({
      targets: [target],
      names: ['reviewed', 'important']
    })).toEqual({ targets: [target], names: ['reviewed', 'important'] })
    expect(contract.contentSpaceRemoveTagsRequestSchema.parse({
      targets: [target],
      tags: [{ providerInstanceRef: 'provider-instance-a', tagId: 'tag_a' }]
    }).tags[0]?.tagId).toBe('tag_a')
    expect(() => contract.contentSpaceSetTagsRequestSchema.parse({
      targets: [target],
      tags: [{ providerInstanceRef: 'provider-instance-a', tagId: 'tag_a' }]
    })).toThrow()
  })

  it('carries the relation endpoints required for an unambiguous removal', () => {
    const source = { providerInstanceRef: 'provider-instance-a', fileId: 'file_a' }
    const target = { providerInstanceRef: 'provider-instance-a', fileId: 'file_b' }
    expect(contract.contentSpaceRemoveRelationRequestSchema.parse({
      relation: {
        reference: { providerInstanceRef: 'provider-instance-a', relationId: 'relation_a' },
        source,
        target,
        kind: 'related'
      }
    }).relation.target).toEqual(target)
    expect(() => contract.contentSpaceRemoveRelationRequestSchema.parse({
      relation: { providerInstanceRef: 'provider-instance-a', relationId: 'relation_a' }
    })).toThrow()
  })

  it('distinguishes complete create observations from honest partial list observations', () => {
    const publication = {
      observation: 'partial' as const,
      reference: { providerInstanceRef: 'provider-instance-a', publicationId: 'publication_a' },
      name: 'Quarterly release'
    }
    expect(contract.contentSpacePublicationSummarySchema.parse(publication)).toEqual(publication)
    expect(() => contract.contentSpaceCreatePublicationResultSchema.parse({
      ok: true,
      value: publication
    })).toThrow()

    const share = {
      observation: 'partial' as const,
      reference: { providerInstanceRef: 'provider-instance-a', shareId: 'share_a' },
      name: 'Reviewers'
    }
    expect(contract.contentSpaceShareSummarySchema.parse(share)).toEqual(share)
    expect(() => contract.contentSpaceCreateShareResultSchema.parse({
      ok: true,
      value: share
    })).toThrow()
  })

  it('returns expiring HTTPS provider portal targets for core issuance', () => {
    const rawTarget = {
      url: 'https://content.example.test/ecm#/preview?fileid=file_a',
      expiresAt: '2026-08-20T00:05:00.000Z'
    }
    expect(contract.contentSpaceResolvedInternalLinkSchema.parse({
      reference: { providerInstanceRef: 'provider-instance-a', fileId: 'file_a' },
      target: rawTarget
    }).target).toEqual(rawTarget)
    expect(contract.contentSpaceCollaborationInvitationSchema.parse({
      file: { providerInstanceRef: 'provider-instance-a', fileId: 'file_a' },
      target: rawTarget
    }).target).toEqual(rawTarget)
    expect(() => contract.contentSpaceProviderPortalTargetSchema.parse({
      ...rawTarget,
      url: 'http://content.example.test/insecure'
    })).toThrow()
  })

  it('contracts every catalog operation without dormant vendor operations', () => {
    expect(Object.keys(contract.CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS).sort()).toEqual(
      Object.keys(contract.CONTENT_SPACE_EXTENDED_OPERATIONS).sort()
    )
    expect(Object.values(contract.CONTENT_SPACE_EXTENDED_OPERATIONS)
      .every(({ stage }) => stage === 'contracted')).toBe(true)
    expect(Object.keys(contract.CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS).join(','))
      .not.toMatch(/team/iu)
  })

  it('does not export vendor Team request, receipt, result, or role schemas', () => {
    expect(Object.keys(contract).filter((name) => /team|ownership|memberrole/iu.test(name)))
      .toEqual([])
  })
})

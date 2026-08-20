import { describe, expect, it, vi } from 'vitest'

import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS
} from '@sciforge/domain-content-space/extended-operations-contract'
import { NATIVE_DOCUMENT_OPERATIONS } from '@sciforge/domain-content-space/native-document-contract'

import {
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  OpenContentConnectorError,
  type OpenContentContentSpaceFacade
} from '@sciforge/domain-opencontent-connector/contract'

import { createOpenContentContentSpaceProvider } from './provider.js'

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'local-account-a',
  assurance: 'local-selection' as const,
  deviceId: 'test-device',
  identityVersion: 1
})
const assertPrincipalCurrent = () => undefined

describe('OpenContent Content Space Provider', () => {
  it('declares unverified administration operations PoC-only and Project provisioning blocked', async () => {
    const useTeamAdministration = vi.fn(async () => {
      throw new Error('Administration readiness must not open a remote session.')
    }) as unknown as NonNullable<OpenContentContentSpaceFacade['useTeamAdministration']>
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({ useTeamAdministration })
    })

    const administration = provider.features?.administration
    expect(administration?.describeOperations).toBeTypeOf('function')
    expect(administration?.bind).toBeTypeOf('function')
    const administrationStates = await administration!.describeOperations({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })
    expect(administrationStates).toHaveLength(11)
    expect(administrationStates.filter(({ operation }) => operation !== 'provision-project')
      .every(({ readiness, reasonCode }) => (
        readiness === 'poc_only' && reasonCode === 'verification_profile_required'
      ))).toBe(true)
    expect(administrationStates).toContainEqual({
      operation: 'provision-project',
      readiness: 'blocked_by_contract',
      reasonCode: 'provider_contract_missing'
    })
    expect(administrationStates.some(({ readiness }) => readiness === 'production_ready'))
      .toBe(false)
    expect(useTeamAdministration).not.toHaveBeenCalled()
  })

  it('keeps ordinary and public Team governance operations PoC-only without attachment assets', async () => {
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({})
    })

    expect(provider.features?.nativeDocuments).toBeUndefined()
    const extended = provider.features?.extendedOperations
    expect(extended).toBeDefined()
    const capabilities = await provider.describeCapabilities({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })
    expect(capabilities).toHaveLength(8)
    expect(capabilities).toEqual(expect.arrayContaining([
      {
        operation: 'list-containers',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      },
      {
        operation: 'list-entries',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      },
      {
        operation: 'observe-entry',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      },
      {
        operation: 'create-folder',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      },
      {
        operation: 'upload-new',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      },
      {
        operation: 'download',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      }
    ]))
    expect(capabilities.filter(({ readiness }) => readiness === 'poc_only')).toHaveLength(6)
    expect(capabilities.filter(({ readiness }) => readiness === 'blocked_by_contract'))
      .toEqual([
        {
          operation: 'portal-target',
          readiness: 'blocked_by_contract',
          reasonCode: 'provider_contract_missing'
        },
        {
          operation: 'observe-immutable-version',
          readiness: 'blocked_by_contract',
          reasonCode: 'provider_contract_missing'
        }
      ])
    expect(capabilities.some(({ readiness }) => readiness === 'production_ready')).toBe(false)

    const states = await extended!.describeOperations({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })
    expect(states).toHaveLength(54)
    expect(states.filter(({ readiness }) => readiness === 'poc_only'))
      .toEqual([
        {
          operation: 'updateTeamMemberRole',
          readiness: 'poc_only',
          reasonCode: 'verification_profile_required'
        },
        {
          operation: 'transferTeamOwnership',
          readiness: 'poc_only',
          reasonCode: 'verification_profile_required'
        }
      ])
    expect(states.filter(({ readiness }) => readiness === 'blocked_by_contract'))
      .toHaveLength(52)
  })

  it('advertises safe runtime operations and keeps non-CAS mutations blocked', async () => {
    const useSkillRuntime: NonNullable<OpenContentContentSpaceFacade['useSkillRuntime']> =
      async () => { throw new Error('Execution is outside this readiness test.') }
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({ useSkillRuntime })
    })
    const extended = provider.features?.extendedOperations
    const native = provider.features?.nativeDocuments
    expect(extended).toBeDefined()
    expect(native).toBeDefined()
    const states = await extended!.describeOperations({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })

    expect(states.map(({ operation }) => operation).sort()).toEqual(
      Object.keys(CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS).sort()
    )
    expect(states).toContainEqual({
      operation: 'updateFileVersion',
      readiness: 'blocked_by_contract',
      reasonCode: 'provider_contract_missing'
    })
    expect(states.filter(({ operation }) => operation !== 'updateFileVersion')
      .every(({ readiness, reasonCode }) =>
        readiness === 'poc_only' && reasonCode === 'verification_profile_required'))
      .toBe(true)
    expect(states.filter(({ readiness }) => readiness === 'poc_only')).toHaveLength(53)

    const nativeStates = await native!.describeOperations({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })
    expect(nativeStates.map(({ operation }) => operation).sort())
      .toEqual([...NATIVE_DOCUMENT_OPERATIONS].sort())
    expect(nativeStates).toHaveLength(20)
    expect(nativeStates.filter(({ readiness }) => readiness === 'blocked_by_contract')
      .map(({ operation }) => operation).sort()).toEqual([
        'comment-create',
        'comment-delete',
        'comment-reopen',
        'comment-reply',
        'comment-solve',
        'edit',
        'insert',
        'redo',
        'undo',
        'update'
      ])
    expect(nativeStates.filter(({ readiness }) => readiness === 'poc_only'))
      .toHaveLength(10)
    expect(nativeStates.filter(({ readiness }) => readiness === 'poc_only')
      .every(({ reasonCode }) => reasonCode === 'verification_profile_required')).toBe(true)
    expect(nativeStates.some(({ readiness }) => readiness === 'production_ready')).toBe(false)
  })

  it.each([
    ['invalid_input', 'invalid_input', 'never'],
    ['unauthorized', 'unauthorized', 'after-human-action'],
    ['reauthentication_required', 'unauthorized', 'after-human-action'],
    ['cancelled', 'cancelled', 'never'],
    ['rate_limited', 'rate_limited', 'after-human-action'],
    ['provider_contract_violation', 'provider_contract_violation', 'never'],
    ['bounds_exceeded', 'bounds_exceeded', 'never'],
    ['conflict', 'conflict', 'after-human-action'],
    ['outcome_unknown', 'outcome_unknown', 'never']
  ] as const)(
    'preserves the bounded %s Connector outcome',
    async (connectorCode, contentCode, retry) => {
      const provider = createOpenContentContentSpaceProvider({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        facade: facadeFixture({
          listRootFolders: vi.fn().mockRejectedValue(
            new OpenContentConnectorError(connectorCode, 'secret provider diagnostic')
          ),
          listFolderEntries: vi.fn(),
          observeEntry: vi.fn(),
          createFolder: vi.fn(),
          uploadNewFile: vi.fn(),
          downloadFile: vi.fn()
        })
      })

      const error = await provider.listContainers({
        context: {
          principal,
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          deadlineAt: new Date(Date.now() + 10_000).toISOString(),
          assertPrincipalCurrent
        },
        page: { limit: 20 }
      }).catch((caught: unknown) => caught)
      expect(error).toMatchObject({
        detail: { code: contentCode, retry }
      })
      expect(JSON.stringify(error)).not.toContain('secret provider diagnostic')
    }
  )

  it('maps the personal root and Team roots to stable scoped containers', async () => {
    const listRootFolders = vi.fn<OpenContentContentSpaceFacade['listRootFolders']>()
      .mockResolvedValueOnce({
        roots: [{
          source: 'personal-root',
          folderGuid: 'personal-folder-guid',
          label: 'Personal library'
        }]
      })
      .mockResolvedValueOnce({
        roots: [{
          source: 'team-root',
          folderGuid: 'team-folder-guid',
          label: 'sciforge test'
        }]
      })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders,
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadFile: vi.fn()
      })
    })
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      assertPrincipalCurrent
    }

    await expect(provider.listContainers({
      context,
      page: { limit: 20 }
    })).resolves.toEqual({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      items: [{
        reference: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          containerId: 'personal-folder-guid'
        },
        scope: 'personal',
        label: 'Personal library'
      }],
      nextCursor: 'teams_1'
    })
    await expect(provider.listContainers({
      context,
      page: { limit: 20, cursor: 'teams_1' }
    })).resolves.toEqual({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      items: [{
        reference: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          containerId: 'team-folder-guid'
        },
        scope: 'shared',
        label: 'sciforge test'
      }]
    })
    expect(listRootFolders).toHaveBeenNthCalledWith(1, expect.objectContaining({
      includePersonal: true,
      includeTeams: false,
      assertPrincipalCurrent
    }))
    expect(listRootFolders).toHaveBeenNthCalledWith(2, expect.objectContaining({
      includePersonal: false,
      includeTeams: true,
      teamPage: 1,
      assertPrincipalCurrent
    }))
  })

  it('continues past an empty OpenContent Team page before returning a public cursor page', async () => {
    const listRootFolders = vi.fn<OpenContentContentSpaceFacade['listRootFolders']>()
      .mockResolvedValueOnce({ roots: [], nextTeamPage: 2 })
      .mockResolvedValueOnce({
        roots: [{
          source: 'team-root',
          folderGuid: 'later-team-root-guid',
          label: 'Later Team'
        }]
      })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders,
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadFile: vi.fn()
      })
    })

    await expect(provider.listContainers({
      context: {
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        assertPrincipalCurrent
      },
      page: { limit: 200, cursor: 'teams_1' }
    })).resolves.toEqual({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      items: [{
        reference: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          containerId: 'later-team-root-guid'
        },
        scope: 'shared',
        label: 'Later Team'
      }]
    })
    expect(listRootFolders).toHaveBeenCalledTimes(2)
    expect(listRootFolders).toHaveBeenNthCalledWith(1, expect.objectContaining({
      teamPage: 1,
      teamPageSize: 100
    }))
    expect(listRootFolders).toHaveBeenNthCalledWith(2, expect.objectContaining({
      teamPage: 2,
      teamPageSize: 100
    }))
  })

  it('continues into Team roots when OpenContent returns no personal root', async () => {
    const listRootFolders = vi.fn<OpenContentContentSpaceFacade['listRootFolders']>()
      .mockResolvedValueOnce({ roots: [] })
      .mockResolvedValueOnce({
        roots: [{
          source: 'team-root',
          folderGuid: 'first-team-root-guid',
          label: 'First Team'
        }]
      })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders,
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadFile: vi.fn()
      })
    })

    await expect(provider.listContainers({
      context: {
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        assertPrincipalCurrent
      },
      page: { limit: 20 }
    })).resolves.toEqual({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      items: [{
        reference: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          containerId: 'first-team-root-guid'
        },
        scope: 'shared',
        label: 'First Team'
      }]
    })
    expect(listRootFolders).toHaveBeenNthCalledWith(1, expect.objectContaining({
      includePersonal: true,
      includeTeams: false
    }))
    expect(listRootFolders).toHaveBeenNthCalledWith(2, expect.objectContaining({
      includePersonal: false,
      includeTeams: true,
      teamPage: 1
    }))
  })

  it('keeps the OpenContent Team page size in the cursor when the public limit changes', async () => {
    const listRootFolders = vi.fn<OpenContentContentSpaceFacade['listRootFolders']>()
      .mockImplementation(async ({ teamPage, teamPageSize }) => ({
        roots: Array.from({ length: teamPageSize }, (_, index) => ({
          source: 'team-root' as const,
          folderGuid: `team-root-${String((teamPage - 1) * teamPageSize + index + 1)}`,
          label: `Team ${String((teamPage - 1) * teamPageSize + index + 1)}`
        })),
        nextTeamPage: teamPage + 1
      }))
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders,
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadFile: vi.fn()
      })
    })
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      assertPrincipalCurrent
    }

    const first = await provider.listContainers({
      context,
      page: { limit: 20, cursor: 'teams_1' }
    })
    expect(first.nextCursor).toBe('teams_2_20')
    const second = await provider.listContainers({
      context,
      page: { limit: 100, cursor: first.nextCursor }
    })
    expect(second.items).toHaveLength(20)
    expect(second.items[0]).toMatchObject({ label: 'Team 21' })
    expect(second.items[19]).toMatchObject({ label: 'Team 40' })
    expect(second.nextCursor).toBe('teams_3_20')
    expect(listRootFolders).toHaveBeenNthCalledWith(2, expect.objectContaining({
      teamPage: 2,
      teamPageSize: 20
    }))
  })

  it('uses a Team cursor offset when the next public limit is smaller than the Provider page', async () => {
    const listRootFolders = vi.fn<OpenContentContentSpaceFacade['listRootFolders']>()
      .mockImplementation(async ({ teamPage, teamPageSize }) => ({
        roots: Array.from({ length: teamPageSize }, (_, index) => ({
          source: 'team-root' as const,
          folderGuid: `team-root-${String((teamPage - 1) * teamPageSize + index + 1)}`,
          label: `Team ${String((teamPage - 1) * teamPageSize + index + 1)}`
        })),
        nextTeamPage: teamPage + 1
      }))
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders,
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadFile: vi.fn()
      })
    })
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      assertPrincipalCurrent
    }

    const first = await provider.listContainers({
      context,
      page: { limit: 100, cursor: 'teams_1' }
    })
    expect(first.nextCursor).toBe('teams_2_100')
    const second = await provider.listContainers({
      context,
      page: { limit: 20, cursor: first.nextCursor }
    })
    expect(second.items).toHaveLength(20)
    expect(second.items[0]).toMatchObject({ label: 'Team 101' })
    expect(second.items[19]).toMatchObject({ label: 'Team 120' })
    expect(second.nextCursor).toBe('teams_2_100_20')
  })

  it('maps Provider folder and file GUIDs without exposing numeric IDs', async () => {
    const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
      .mockResolvedValue({
        parentFolderGuid: 'team-folder-guid',
        entries: [{
          kind: 'container',
          folderGuid: 'child-folder-guid',
          label: 'Experiment A'
        }, {
          kind: 'file',
          fileGuid: 'child-file-guid',
          label: 'result.txt',
          size: 98
        }]
      })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders: vi.fn(),
        listFolderEntries,
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadFile: vi.fn()
      })
    })
    const parent = {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: 'team-folder-guid'
    }

    await expect(provider.listEntries({
      context: {
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        assertPrincipalCurrent
      },
      parent,
      page: { limit: 20 }
    })).resolves.toEqual({
      parent,
      items: [{
        kind: 'container',
        reference: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          containerId: 'child-folder-guid'
        },
        label: 'Experiment A'
      }, {
        kind: 'file',
        reference: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          fileId: 'child-file-guid'
        },
        label: 'result.txt',
        size: 98
      }]
    })
  })

  it('serves a 200-item Content Space page through bounded 100-item OpenContent pages', async () => {
    const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
      .mockImplementation(async ({ parentFolderGuid, page, pageSize }) => ({
        parentFolderGuid,
        entries: Array.from({ length: pageSize }, (_, index) => ({
          kind: 'container' as const,
          folderGuid: `folder-${String((page - 1) * pageSize + index + 1)}`,
          label: `Folder ${String((page - 1) * pageSize + index + 1)}`
        })),
        nextPage: page + 1
      }))
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders: vi.fn(),
        listFolderEntries,
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadFile: vi.fn()
      })
    })
    const parent = {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: 'team-folder-guid'
    }

    const result = await provider.listEntries({
      context: {
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        assertPrincipalCurrent
      },
      parent,
      page: { limit: 200 }
    })

    expect(result.items).toHaveLength(200)
    expect(result.items[0]).toMatchObject({ label: 'Folder 1' })
    expect(result.items[199]).toMatchObject({ label: 'Folder 200' })
    expect(result.nextCursor).toBe('entries_3_100_0')
    expect(listFolderEntries).toHaveBeenCalledTimes(2)
    expect(listFolderEntries).toHaveBeenNthCalledWith(1, expect.objectContaining({
      page: 1,
      pageSize: 100
    }))
    expect(listFolderEntries).toHaveBeenNthCalledWith(2, expect.objectContaining({
      page: 2,
      pageSize: 100
    }))
  })

  it('rejects obsolete entry cursors before invoking the Connector', async () => {
    const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders: vi.fn(),
        listFolderEntries,
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadFile: vi.fn()
      })
    })

    await expect(provider.listEntries({
      context: {
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        assertPrincipalCurrent
      },
      parent: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        containerId: 'team-folder-guid'
      },
      page: { limit: 20, cursor: 'page_2' }
    })).rejects.toMatchObject({ detail: { code: 'invalid_input' } })
    expect(listFolderEntries).not.toHaveBeenCalled()
  })

  it('binds write and transfer receipts to the exact invocation and GUID references', async () => {
    const bytes = new TextEncoder().encode('result bytes')
    const createFolder = vi.fn<OpenContentContentSpaceFacade['createFolder']>()
      .mockResolvedValue({ folderGuid: 'created-folder-guid' })
    const uploadNewFile = vi.fn<OpenContentContentSpaceFacade['uploadNewFile']>()
      .mockResolvedValue({ fileGuid: 'uploaded-file-guid' })
    const downloadFile = vi.fn<OpenContentContentSpaceFacade['downloadFile']>()
      .mockImplementation(async ({ write }) => {
        await write(bytes)
        return { bytesWritten: bytes.byteLength }
      })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders: vi.fn(),
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder,
        uploadNewFile,
        downloadFile
      })
    })
    const parent = {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: 'team-folder-guid'
    }
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: 'invocation-opencontent-001',
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    }

    await expect(provider.createFolder({ context, parent, name: 'Experiment' }))
      .resolves.toMatchObject({
        invocationId: context.invocationId,
        reference: { containerId: 'created-folder-guid' }
      })
    await expect(provider.uploadNewFile({
      context,
      parent,
      name: 'result.txt',
      source: {
        name: 'result.txt',
        size: bytes.byteLength,
        read: async ({ offset, length }) => bytes.slice(offset, offset + length)
      }
    })).resolves.toMatchObject({
      invocationId: context.invocationId,
      sourceSize: bytes.byteLength,
      reference: { fileId: 'uploaded-file-guid' }
    })
    const writes: Uint8Array[] = []
    await expect(provider.downloadFile({
      context,
      reference: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        fileId: 'uploaded-file-guid'
      },
      destination: { write: async (chunk) => { writes.push(Uint8Array.from(chunk)) } }
    })).resolves.toMatchObject({
      invocationId: context.invocationId,
      bytesWritten: bytes.byteLength
    })
    expect(Buffer.concat(writes)).toEqual(Buffer.from(bytes))
  })

  it.each(['2', '7', '19'])(
    'never forwards numeric OpenContent identity %s as a folder parent',
    async (containerId) => {
      const createFolder = vi.fn<OpenContentContentSpaceFacade['createFolder']>()
      const provider = createOpenContentContentSpaceProvider({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        facade: facadeFixture({
          listRootFolders: vi.fn(),
          listFolderEntries: vi.fn(),
          observeEntry: vi.fn(),
          createFolder,
          uploadNewFile: vi.fn(),
          downloadFile: vi.fn()
        })
      })

      await expect(provider.createFolder({
        context: {
          principal,
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          invocationId: 'invocation-opencontent-magic-parent',
          deadlineAt: new Date(Date.now() + 10_000).toISOString(),
          signal: new AbortController().signal,
          assertPrincipalCurrent
        },
        parent: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          containerId
        },
        name: 'Experiment'
      })).rejects.toMatchObject({
        detail: { code: 'invalid_input', retry: 'never' }
      })
      expect(createFolder).not.toHaveBeenCalled()
    }
  )
})

function facadeFixture(
  overrides: Partial<OpenContentContentSpaceFacade>
): OpenContentContentSpaceFacade {
  const useTeamAdministration: OpenContentContentSpaceFacade['useTeamAdministration'] =
    async () => {
      throw new Error('Team administration is outside this provider test.')
    }
  return {
    useTeamAdministration,
    listRootFolders: vi.fn(),
    listFolderEntries: vi.fn(),
    observeEntry: vi.fn(),
    createFolder: vi.fn(),
    uploadNewFile: vi.fn(),
    downloadFile: vi.fn(),
    ...overrides
  }
}

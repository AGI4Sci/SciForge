import { describe, expect, it, vi } from 'vitest'

import {
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

describe('OpenContent Content Space Provider', () => {
  it.each([
    ['unauthorized', 'unauthorized'],
    ['reauthentication_required', 'unauthorized'],
    ['cancelled', 'cancelled'],
    ['rate_limited', 'rate_limited'],
    ['provider_contract_violation', 'provider_contract_violation'],
    ['bounds_exceeded', 'bounds_exceeded'],
    ['conflict', 'conflict'],
    ['outcome_unknown', 'outcome_unknown']
  ] as const)('preserves the bounded %s Connector outcome', async (connectorCode, contentCode) => {
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: 'opencontent-edoc2-demo',
      facade: {
        listRootFolders: vi.fn().mockRejectedValue(
          new OpenContentConnectorError(connectorCode, 'secret provider diagnostic')
        ),
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadFile: vi.fn()
      }
    })

    const error = await provider.listContainers({
      context: {
        principal,
        providerInstanceRef: 'opencontent-edoc2-demo',
        deadlineAt: new Date(Date.now() + 10_000).toISOString()
      },
      page: { limit: 20 }
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      detail: { code: contentCode }
    })
    expect(JSON.stringify(error)).not.toContain('secret provider diagnostic')
  })

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
      providerInstanceRef: 'opencontent-edoc2-demo',
      facade: {
        listRootFolders,
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadFile: vi.fn()
      }
    })
    const context = {
      principal,
      providerInstanceRef: 'opencontent-edoc2-demo',
      deadlineAt: new Date(Date.now() + 10_000).toISOString()
    }

    await expect(provider.listContainers({
      context,
      page: { limit: 20 }
    })).resolves.toEqual({
      providerInstanceRef: 'opencontent-edoc2-demo',
      items: [{
        reference: {
          providerInstanceRef: 'opencontent-edoc2-demo',
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
      providerInstanceRef: 'opencontent-edoc2-demo',
      items: [{
        reference: {
          providerInstanceRef: 'opencontent-edoc2-demo',
          containerId: 'team-folder-guid'
        },
        scope: 'shared',
        label: 'sciforge test'
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
      providerInstanceRef: 'opencontent-edoc2-demo',
      facade: {
        listRootFolders: vi.fn(),
        listFolderEntries,
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadFile: vi.fn()
      }
    })
    const parent = {
      providerInstanceRef: 'opencontent-edoc2-demo',
      containerId: 'team-folder-guid'
    }

    await expect(provider.listEntries({
      context: {
        principal,
        providerInstanceRef: 'opencontent-edoc2-demo',
        deadlineAt: new Date(Date.now() + 10_000).toISOString()
      },
      parent,
      page: { limit: 20 }
    })).resolves.toEqual({
      parent,
      items: [{
        kind: 'container',
        reference: {
          providerInstanceRef: 'opencontent-edoc2-demo',
          containerId: 'child-folder-guid'
        },
        label: 'Experiment A'
      }, {
        kind: 'file',
        reference: {
          providerInstanceRef: 'opencontent-edoc2-demo',
          fileId: 'child-file-guid'
        },
        label: 'result.txt',
        size: 98
      }]
    })
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
      providerInstanceRef: 'opencontent-edoc2-demo',
      facade: {
        listRootFolders: vi.fn(),
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder,
        uploadNewFile,
        downloadFile
      }
    })
    const parent = {
      providerInstanceRef: 'opencontent-edoc2-demo',
      containerId: 'team-folder-guid'
    }
    const context = {
      principal,
      providerInstanceRef: 'opencontent-edoc2-demo',
      invocationId: 'invocation-opencontent-001',
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal
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
        providerInstanceRef: 'opencontent-edoc2-demo',
        fileId: 'uploaded-file-guid'
      },
      destination: { write: async (chunk) => { writes.push(Uint8Array.from(chunk)) } }
    })).resolves.toMatchObject({
      invocationId: context.invocationId,
      bytesWritten: bytes.byteLength
    })
    expect(Buffer.concat(writes)).toEqual(Buffer.from(bytes))
  })
})

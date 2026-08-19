import { describe, expect, it, vi } from 'vitest'

import {
  DomainMainProviderCredentialError,
  type DomainMainPackageSettingsHost,
  type DomainMainProviderCredentialStoreHost
} from '@sciforge/domain-sdk/package-storage'

import type { OpenContentClient } from './opencontent-client.js'
import { createOpenContentConnectionService } from './connection-service.js'
import { OPENCONTENT_PROVIDER_INSTANCE_REF } from '../contract.js'

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'local-account-a',
  assurance: 'local-selection' as const,
  deviceId: 'test-device',
  identityVersion: 1
})

describe('OpenContent connection service', () => {
  it('rejects an unknown status target before reading connection storage', async () => {
    const settings = inMemorySettings()
    const read = vi.spyOn(settings, 'read')
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      credentials: inMemoryCredentials(),
      client: stubClient()
    })

    await expect(service.status({
      principal,
      providerInstanceRef: 'opencontent-unknown',
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects an unknown bind target before sending credentials to a Provider', async () => {
    const authenticateExistingAccount = vi.fn<OpenContentClient['authenticateExistingAccount']>()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings: inMemorySettings(),
      credentials: inMemoryCredentials(),
      client: stubClient({ authenticateExistingAccount })
    })

    await expect(service.bindExistingAccount({
      principal,
      providerInstanceRef: 'opencontent-unknown',
      username: 'fixture-user',
      password: 'fixture-password',
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(authenticateExistingAccount).not.toHaveBeenCalled()
  })

  it('rejects an unknown unbind target before reading connection storage', async () => {
    const settings = inMemorySettings()
    const read = vi.spyOn(settings, 'read')
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      credentials: inMemoryCredentials(),
      client: stubClient()
    })

    await expect(service.unbind({
      principal,
      providerInstanceRef: 'opencontent-unknown',
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects a second same-kind Instance before credentials or Provider network access', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const read = vi.spyOn(settings, 'read')
    const use = vi.spyOn(credentials, 'use')
    const isTokenValid = vi.fn<OpenContentClient['isTokenValid']>()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      credentials,
      client: stubClient({ isTokenValid })
    })

    await expect(service.useCurrentToken({
      principal,
      providerInstanceRef: 'opencontent-edoc2-secondary',
      assertPrincipalCurrent: () => undefined
    }, async () => 'must not run')).rejects.toMatchObject({ code: 'invalid_input' })
    expect(read).not.toHaveBeenCalled()
    expect(use).not.toHaveBeenCalled()
    expect(isTokenValid).not.toHaveBeenCalled()
  })

  it('commits only the validated Token and replaces the one current binding explicitly', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const authenticateExistingAccount = vi.fn<OpenContentClient['authenticateExistingAccount']>()
      .mockResolvedValueOnce({
        token: 'first-opaque-token',
        account: {
          id: 'external-user-a',
          identityId: 41,
          account: 'fixture-user-a',
          name: 'Fixture User A',
          topPersonalFolderId: '1001'
        }
      })
      .mockResolvedValueOnce({
        token: 'second-opaque-token',
        account: {
          id: 'external-user-b',
          identityId: 42,
          account: 'fixture-user-b',
          name: 'Fixture User B',
          topPersonalFolderId: '1002'
        }
      })
    let sequence = 0
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      credentials,
      client: {
        authenticateExistingAccount,
        isTokenValid: async () => true,
        listRootFolders: async () => ({ roots: [] }),
        listFolderEntries: async ({ parentFolderGuid }) => ({
          parentFolderGuid,
          entries: []
        }),
        observeEntry: async ({ kind, resourceGuid }) => kind === 'container'
          ? { kind, folderGuid: resourceGuid, label: 'Folder' }
          : { kind, fileGuid: resourceGuid, label: 'File', size: 0 },
        createFolder: async () => ({ folderGuid: 'created-folder-guid' }),
        uploadNewFile: async () => ({ fileGuid: 'uploaded-file-guid' }),
        downloadFile: async () => ({ bytesWritten: 0 })
      },
      createConnectionId: () => `connection-${++sequence}`,
      now: () => new Date('2026-08-17T06:00:00.000Z')
    })

    await service.bindExistingAccount({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'fixture-user-a',
      password: 'first-fixture-password',
      assertPrincipalCurrent: () => undefined
    })
    await service.bindExistingAccount({
      principal: { ...principal, identityVersion: 2 },
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'fixture-user-b',
      password: 'second-fixture-password',
      assertPrincipalCurrent: () => undefined
    })

    await expect(service.status({
      principal: { ...principal, identityVersion: 3 },
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({
      state: 'connected',
      externalAccount: {
        id: 'external-user-b',
        account: 'fixture-user-b',
        name: 'Fixture User B'
      }
    })
    expect(credentials.values).toEqual(new Map([
      [`${OPENCONTENT_PROVIDER_INSTANCE_REF}:connection-2`, 'second-opaque-token']
    ]))
    const persisted = await settings.read()
    expect(JSON.stringify(persisted.value)).not.toContain('password')
    expect(JSON.stringify(persisted.value)).not.toContain('opaque-token')
    expect(authenticateExistingAccount).toHaveBeenCalledTimes(2)
  })

  it('keeps a committed rebind successful when stale-credential cleanup fails', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const authenticateExistingAccount = vi.fn<OpenContentClient['authenticateExistingAccount']>()
      .mockResolvedValueOnce(authenticatedSession('external-user-a', 'fixture-user-a'))
      .mockResolvedValueOnce(authenticatedSession('external-user-b', 'fixture-user-b'))
    let sequence = 0
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      credentials,
      client: stubClient({ authenticateExistingAccount }),
      createConnectionId: () => `connection-${++sequence}`
    })

    await service.bindExistingAccount({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'fixture-user-a',
      password: 'first-fixture-password',
      assertPrincipalCurrent: () => undefined
    })
    credentials.failRemove('connection-1')

    await expect(service.bindExistingAccount({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'fixture-user-b',
      password: 'second-fixture-password',
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({
      state: 'connected',
      externalAccount: { id: 'external-user-b', account: 'fixture-user-b' }
    })
    const queued = await settings.read()
    expect(queued.value).toMatchObject({
      connections: [expect.objectContaining({
        connectionId: 'connection-2',
        retiredCredentialIds: ['connection-1']
      })]
    })
    expect(JSON.stringify(queued.value)).not.toMatch(/opaque-token|password/u)
    expect(credentials.values.has(
      `${OPENCONTENT_PROVIDER_INSTANCE_REF}:connection-1`
    )).toBe(true)
    await expect(service.unbind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'secure_storage_unavailable' })
    expect((await settings.read()).value).toMatchObject({
      connections: [expect.objectContaining({ connectionId: 'connection-2' })]
    })

    credentials.failRemove(undefined)
    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({
      state: 'connected',
      externalAccount: { id: 'external-user-b' }
    })
    expect(credentials.values.get(`${OPENCONTENT_PROVIDER_INSTANCE_REF}:connection-2`))
      .toBe('opaque-token-external-user-b')
    expect(credentials.values.has(
      `${OPENCONTENT_PROVIDER_INSTANCE_REF}:connection-1`
    )).toBe(false)
    const persisted = await settings.read()
    expect(persisted.value).toEqual(expect.objectContaining({
      connections: [expect.not.objectContaining({ retiredCredentialIds: expect.anything() })]
    }))
  })

  it('validates a public status remotely without revalidating the just-bound session', async () => {
    const isTokenValid = vi.fn<OpenContentClient['isTokenValid']>().mockResolvedValue(true)
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings: inMemorySettings(),
      credentials: inMemoryCredentials(),
      client: stubClient({ isTokenValid }),
      createConnectionId: () => 'connection-current'
    })
    await service.bindExistingAccount({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'fixture-user-a',
      password: 'fixture-password',
      assertPrincipalCurrent: () => undefined
    })
    expect(isTokenValid).not.toHaveBeenCalled()
    const controller = new AbortController()

    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      signal: controller.signal,
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({ state: 'connected' })
    expect(isTokenValid).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal
    }))
  })

  it('uses and unbinds only the current Principal connection', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      credentials,
      client: {
        authenticateExistingAccount: async () => ({
          token: 'bound-opaque-token',
          account: {
            id: 'external-user-a',
            identityId: 41,
            account: 'fixture-user-a',
            name: 'Fixture User A',
            topPersonalFolderId: '1001'
          }
        }),
        isTokenValid: async () => true,
        listRootFolders: async () => ({ roots: [] }),
        listFolderEntries: async ({ parentFolderGuid }) => ({
          parentFolderGuid,
          entries: []
        }),
        observeEntry: async ({ kind, resourceGuid }) => kind === 'container'
          ? { kind, folderGuid: resourceGuid, label: 'Folder' }
          : { kind, fileGuid: resourceGuid, label: 'File', size: 0 },
        createFolder: async () => ({ folderGuid: 'created-folder-guid' }),
        uploadNewFile: async () => ({ fileGuid: 'uploaded-file-guid' }),
        downloadFile: async () => ({ bytesWritten: 0 })
      },
      createConnectionId: () => 'connection-current'
    })
    await service.bindExistingAccount({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'fixture-user-a',
      password: 'fixture-password',
      assertPrincipalCurrent: () => undefined
    })

    await expect(service.useCurrentToken({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async (token) => token.length)).resolves.toBe(18)
    const otherPrincipal = Object.freeze({ ...principal, subject: 'local-account-b' })
    await expect(service.status({
      principal: otherPrincipal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected' })
    await expect(service.useCurrentToken({
      principal: otherPrincipal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async () => 'must not run')).rejects.toMatchObject({
      code: 'reauthentication_required'
    })
    await expect(service.unbind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected', remoteRevocation: 'unsupported' })
    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected' })
    await expect(service.useCurrentToken({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async () => 'must not run')).rejects.toMatchObject({
      code: 'reauthentication_required'
    })
    expect(credentials.values).toEqual(new Map())
  })

  it('returns and persists reauthentication_required when public status finds an invalid Token', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const isTokenValid = vi.fn<OpenContentClient['isTokenValid']>()
      .mockResolvedValueOnce(false)
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      credentials,
      client: {
        authenticateExistingAccount: async () => ({
          token: 'bound-opaque-token',
          account: {
            id: 'external-user-a',
            identityId: 41,
            account: 'fixture-user-a',
            name: 'Fixture User A',
            topPersonalFolderId: '1001'
          }
        }),
        isTokenValid,
        listRootFolders: async () => ({ roots: [] }),
        listFolderEntries: async ({ parentFolderGuid }) => ({
          parentFolderGuid,
          entries: []
        }),
        observeEntry: async ({ kind, resourceGuid }) => kind === 'container'
          ? { kind, folderGuid: resourceGuid, label: 'Folder' }
          : { kind, fileGuid: resourceGuid, label: 'File', size: 0 },
        createFolder: async () => ({ folderGuid: 'created-folder-guid' }),
        uploadNewFile: async () => ({ fileGuid: 'uploaded-file-guid' }),
        downloadFile: async () => ({ bytesWritten: 0 })
      },
      createConnectionId: () => 'connection-current'
    })
    await service.bindExistingAccount({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'fixture-user-a',
      password: 'fixture-password',
      assertPrincipalCurrent: () => undefined
    })

    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({ state: 'reauthentication_required' })
    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({
      state: 'reauthentication_required'
    })
    expect(isTokenValid).toHaveBeenCalledTimes(1)
  })

  it('propagates secure-storage failures without mislabeling the connection as invalid', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      credentials,
      client: {
        authenticateExistingAccount: async () => ({
          token: 'bound-opaque-token',
          account: {
            id: 'external-user-a',
            identityId: 41,
            account: 'fixture-user-a',
            name: 'Fixture User A',
            topPersonalFolderId: '1001'
          }
        }),
        isTokenValid: async () => true,
        listRootFolders: async () => ({ roots: [] }),
        listFolderEntries: async ({ parentFolderGuid }) => ({
          parentFolderGuid,
          entries: []
        }),
        observeEntry: async ({ kind, resourceGuid }) => kind === 'container'
          ? { kind, folderGuid: resourceGuid, label: 'Folder' }
          : { kind, fileGuid: resourceGuid, label: 'File', size: 0 },
        createFolder: async () => ({ folderGuid: 'created-folder-guid' }),
        uploadNewFile: async () => ({ fileGuid: 'uploaded-file-guid' }),
        downloadFile: async () => ({ bytesWritten: 0 })
      },
      createConnectionId: () => 'connection-current'
    })
    await service.bindExistingAccount({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'fixture-user-a',
      password: 'fixture-password',
      assertPrincipalCurrent: () => undefined
    })
    credentials.failUse(new DomainMainProviderCredentialError(
      'secure_storage_unavailable',
      'The operating-system secure storage service is unavailable.'
    ))

    await expect(service.useCurrentToken({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async () => 'must not run')).rejects.toMatchObject({
      code: 'secure_storage_unavailable'
    })
    credentials.failUse(undefined)
    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({ state: 'connected' })
  })
})

function inMemorySettings(): DomainMainPackageSettingsHost {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
  return {
    read: async () => ({ revision, value }),
    write: async (next, expectedRevision) => {
      if (expectedRevision !== revision) throw new Error('revision conflict')
      value = structuredClone(next)
      revision += 1
      return { revision, value }
    },
    clear: async (expectedRevision) => {
      if (expectedRevision !== revision) throw new Error('revision conflict')
      value = null
      revision += 1
      return { revision, value }
    }
  }
}

function stubClient(
  overrides: Partial<OpenContentClient> = {}
): OpenContentClient {
  return {
    authenticateExistingAccount: async () => ({
      token: 'bound-opaque-token',
      account: {
        id: 'external-user-a',
        identityId: 41,
        account: 'fixture-user-a',
        name: 'Fixture User A',
        topPersonalFolderId: '1001'
      }
    }),
    isTokenValid: async () => true,
    listRootFolders: async () => ({ roots: [] }),
    listFolderEntries: async ({ parentFolderGuid }) => ({ parentFolderGuid, entries: [] }),
    observeEntry: async ({ kind, resourceGuid }) => kind === 'container'
      ? { kind, folderGuid: resourceGuid, label: 'Folder' }
      : { kind, fileGuid: resourceGuid, label: 'File', size: 0 },
    createFolder: async () => ({ folderGuid: 'created-folder-guid' }),
    uploadNewFile: async () => ({ fileGuid: 'uploaded-file-guid' }),
    downloadFile: async () => ({ bytesWritten: 0 }),
    ...overrides
  }
}

function authenticatedSession(id: string, account: string) {
  return Object.freeze({
    token: `opaque-token-${id}`,
    account: Object.freeze({
      id,
      identityId: id === 'external-user-a' ? 41 : 42,
      account,
      name: account,
      topPersonalFolderId: id === 'external-user-a' ? '1001' : '1002'
    })
  })
}

function inMemoryCredentials(): DomainMainProviderCredentialStoreHost & Readonly<{
  values: Map<string, string>
  failUse: (error: Error | undefined) => void
  failRemove: (connectionId: string | undefined) => void
}> {
  const values = new Map<string, string>()
  let useFailure: Error | undefined
  let failedRemoveConnectionId: string | undefined
  const key = (access: Readonly<{
    binding: Readonly<{ providerInstanceRef: string; connectionId: string }>
  }>) => `${access.binding.providerInstanceRef}:${access.binding.connectionId}`
  return {
    values,
    failUse: (error) => { useFailure = error },
    failRemove: (connectionId) => { failedRemoveConnectionId = connectionId },
    status: async (access) => values.has(key(access))
      ? { state: 'available' as const, recordVersion: 1 as const }
      : { state: 'absent' as const },
    replace: async (access, secret) => { values.set(key(access), secret) },
    use: async (access, operation) => {
      if (useFailure) throw useFailure
      const value = values.get(key(access))
      if (!value) throw new Error('credential unavailable')
      return operation(value)
    },
    remove: async (access) => {
      if (access.binding.connectionId === failedRemoveConnectionId) {
        throw new DomainMainProviderCredentialError(
          'secure_storage_unavailable',
          'The test secure storage cleanup failed.'
        )
      }
      values.delete(key(access))
    }
  }
}

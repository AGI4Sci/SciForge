import { describe, expect, it, vi } from 'vitest'

import {
  DomainMainProviderCredentialError,
  type DomainMainPackageSettingsHost,
  type DomainMainProviderCredentialStoreHost
} from '@sciforge/domain-sdk/package-storage'

import type { OpenContentClient } from './opencontent-client.js'
import { createOpenContentConnectionService } from './connection-service.js'

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'local-account-a',
  assurance: 'local-selection' as const,
  deviceId: 'test-device',
  identityVersion: 1
})

describe('OpenContent connection service', () => {
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
      providerInstanceRef: 'opencontent-edoc2-demo',
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
      username: 'fixture-user-a',
      password: 'first-fixture-password',
      assertPrincipalCurrent: () => undefined
    })
    await service.bindExistingAccount({
      principal: { ...principal, identityVersion: 2 },
      username: 'fixture-user-b',
      password: 'second-fixture-password',
      assertPrincipalCurrent: () => undefined
    })

    await expect(service.status({ ...principal, identityVersion: 3 })).resolves.toMatchObject({
      state: 'connected',
      externalAccount: {
        id: 'external-user-b',
        account: 'fixture-user-b',
        name: 'Fixture User B'
      }
    })
    expect(credentials.values).toEqual(new Map([
      ['opencontent-edoc2-demo:connection-2', 'second-opaque-token']
    ]))
    const persisted = await settings.read()
    expect(JSON.stringify(persisted.value)).not.toContain('password')
    expect(JSON.stringify(persisted.value)).not.toContain('opaque-token')
    expect(authenticateExistingAccount).toHaveBeenCalledTimes(2)
  })

  it('uses and unbinds only the current Principal connection', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const service = createOpenContentConnectionService({
      providerInstanceRef: 'opencontent-edoc2-demo',
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
      username: 'fixture-user-a',
      password: 'fixture-password',
      assertPrincipalCurrent: () => undefined
    })

    await expect(service.useCurrentToken({
      principal,
      assertPrincipalCurrent: () => undefined
    }, async (token) => token.length)).resolves.toBe(18)
    const otherPrincipal = Object.freeze({ ...principal, subject: 'local-account-b' })
    await expect(service.status(otherPrincipal)).resolves.toEqual({ state: 'disconnected' })
    await expect(service.useCurrentToken({
      principal: otherPrincipal,
      assertPrincipalCurrent: () => undefined
    }, async () => 'must not run')).rejects.toMatchObject({
      code: 'reauthentication_required'
    })
    await expect(service.unbind({
      principal,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected', remoteRevocation: 'unsupported' })
    await expect(service.status(principal)).resolves.toEqual({ state: 'disconnected' })
    await expect(service.useCurrentToken({
      principal,
      assertPrincipalCurrent: () => undefined
    }, async () => 'must not run')).rejects.toMatchObject({
      code: 'reauthentication_required'
    })
    expect(credentials.values).toEqual(new Map())
  })

  it('persists reauthentication_required when the stored Token is no longer valid', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const isTokenValid = vi.fn<OpenContentClient['isTokenValid']>()
      .mockResolvedValueOnce(false)
    const service = createOpenContentConnectionService({
      providerInstanceRef: 'opencontent-edoc2-demo',
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
      username: 'fixture-user-a',
      password: 'fixture-password',
      assertPrincipalCurrent: () => undefined
    })

    await expect(service.useCurrentToken({
      principal,
      assertPrincipalCurrent: () => undefined
    }, async () => 'must not run')).rejects.toMatchObject({
      code: 'reauthentication_required'
    })
    await expect(service.status(principal)).resolves.toMatchObject({
      state: 'reauthentication_required'
    })
    expect(isTokenValid).toHaveBeenCalledTimes(1)
  })

  it('propagates secure-storage failures without mislabeling the connection as invalid', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const service = createOpenContentConnectionService({
      providerInstanceRef: 'opencontent-edoc2-demo',
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
      assertPrincipalCurrent: () => undefined
    }, async () => 'must not run')).rejects.toMatchObject({
      code: 'secure_storage_unavailable'
    })
    credentials.failUse(undefined)
    await expect(service.status(principal)).resolves.toMatchObject({ state: 'connected' })
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

function inMemoryCredentials(): DomainMainProviderCredentialStoreHost & Readonly<{
  values: Map<string, string>
  failUse: (error: Error | undefined) => void
}> {
  const values = new Map<string, string>()
  let useFailure: Error | undefined
  const key = (access: Readonly<{
    binding: Readonly<{ providerInstanceRef: string; connectionId: string }>
  }>) => `${access.binding.providerInstanceRef}:${access.binding.connectionId}`
  return {
    values,
    failUse: (error) => { useFailure = error },
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
    remove: async (access) => { values.delete(key(access)) }
  }
}

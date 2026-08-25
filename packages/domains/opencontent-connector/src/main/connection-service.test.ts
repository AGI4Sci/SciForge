import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'

import { createOpenContentClient, type OpenContentClient } from './opencontent-client.js'
import { createOpenContentConnectionService } from './connection-service.js'
import {
  OpenContentPrivateAccountError,
  type OpenContentPrivateAccountRuntime
} from './private-account-runtime.js'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'opencontent-edoc2-demo' as const

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'local-account-a',
  assurance: 'local-selection' as const,
  deviceId: 'test-device',
  identityVersion: 1
})

describe('OpenContent connection service', () => {
  it('exposes one atomic current-session operation surface', () => {
    expectTypeOf<ReturnType<typeof createOpenContentConnectionService>>()
      .toHaveProperty('useCurrentSession')
    expectTypeOf<ReturnType<typeof createOpenContentConnectionService>>()
      .not.toHaveProperty('useCurrentToken')
  })

  it('rejects an unknown status target before reading connection storage', async () => {
    const settings = inMemorySettings()
    const read = vi.spyOn(settings, 'read')
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts: inMemoryCredentials(),
      getRuntime: configuredRuntime(stubClient())
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
      accounts: inMemoryCredentials(),
      getRuntime: configuredRuntime(stubClient({ authenticateExistingAccount }))
    })

    await expect(service.enroll({
      principal,
      providerInstanceRef: 'opencontent-unknown',
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
      accounts: inMemoryCredentials(),
      getRuntime: configuredRuntime(stubClient())
    })

    await expect(service.unbind({
      principal,
      providerInstanceRef: 'opencontent-unknown',
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(read).not.toHaveBeenCalled()
  })

  it('clears the local connection when deployment runtime is unavailable', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    let runtime: Readonly<{ client: OpenContentClient }> | undefined = Object.freeze({
      client: stubClient()
    })
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts: credentials,
      getRuntime: () => runtime,
      createConnectionId: () => 'connection-current'
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    expect(credentials.values.size).toBe(1)

    runtime = undefined
    await expect(service.unbind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected', remoteRevocation: 'unsupported' })

    expect(credentials.values).toEqual(new Map())
    await expect(settings.read()).resolves.toMatchObject({
      value: { version: 2, connections: [], retiredConnections: [] }
    })
  })

  it('rejects a second same-kind Instance before credentials or Provider network access', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const read = vi.spyOn(settings, 'read')
    const use = vi.spyOn(credentials, 'withSession')
    const isTokenValid = vi.fn<OpenContentClient['isTokenValid']>()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts: credentials,
      getRuntime: configuredRuntime(stubClient({ isTokenValid }))
    })

    await expect(service.useCurrentSession({
      principal,
      providerInstanceRef: 'opencontent-edoc2-secondary',
      assertPrincipalCurrent: () => undefined
    }, async () => 'must not run')).rejects.toMatchObject({ code: 'invalid_input' })
    expect(read).not.toHaveBeenCalled()
    expect(use).not.toHaveBeenCalled()
    expect(isTokenValid).not.toHaveBeenCalled()
  })

  it('retires a legacy Provider Instance binding without reusing its Token', async () => {
    const settings = inMemorySettings(legacyConnectionSettings(principal))
    const credentials = inMemoryCredentials()
    credentials.values.set('opencontent-default:legacy-connection', 'legacy-opaque-token')
    const isTokenValid = vi.fn<OpenContentClient['isTokenValid']>()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts: credentials,
      getRuntime: configuredRuntime(stubClient({ isTokenValid }))
    })

    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected' })

    expect(credentials.values.has('opencontent-default:legacy-connection')).toBe(false)
    expect(isTokenValid).not.toHaveBeenCalled()
    await expect(settings.read()).resolves.toMatchObject({
      value: {
        version: 2,
        connections: [],
        retiredConnections: []
      }
    })
  })

  it('retains legacy cleanup metadata until secure deletion succeeds', async () => {
    const settings = inMemorySettings(legacyConnectionSettings(principal))
    const credentials = inMemoryCredentials()
    credentials.values.set('opencontent-default:legacy-connection', 'legacy-opaque-token')
    credentials.failRemove('legacy-connection')
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts: credentials,
      getRuntime: configuredRuntime(stubClient())
    })

    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected' })
    await expect(settings.read()).resolves.toMatchObject({
      value: {
        version: 2,
        connections: [],
        retiredConnections: [{
          providerInstanceRef: 'opencontent-default',
          credentialIds: ['legacy-connection']
        }]
      }
    })
    expect(credentials.values.has('opencontent-default:legacy-connection')).toBe(true)
    await expect(service.unbind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'secure_storage_unavailable' })

    credentials.failRemove(undefined)
    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected' })
    expect(credentials.values.has('opencontent-default:legacy-connection')).toBe(false)
    await expect(settings.read()).resolves.toMatchObject({
      value: { version: 2, connections: [], retiredConnections: [] }
    })
  })

  it('defers legacy credential deletion until its owning Principal is current', async () => {
    const settings = inMemorySettings(legacyConnectionSettings(principal))
    const credentials = inMemoryCredentials()
    credentials.values.set('opencontent-default:legacy-connection', 'legacy-opaque-token')
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts: credentials,
      getRuntime: configuredRuntime(stubClient())
    })
    const otherPrincipal = Object.freeze({ ...principal, subject: 'local-account-b' })

    await expect(service.status({
      principal: otherPrincipal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected' })
    expect(credentials.values.has('opencontent-default:legacy-connection')).toBe(true)
    await expect(settings.read()).resolves.toMatchObject({
      value: {
        version: 2,
        retiredConnections: [expect.objectContaining({
          providerInstanceRef: 'opencontent-default',
          credentialIds: ['legacy-connection']
        })]
      }
    })

    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected' })
    expect(credentials.values.has('opencontent-default:legacy-connection')).toBe(false)
  })

  it('keeps cleanup metadata when the Principal switches during credential removal', async () => {
    const settings = inMemorySettings({
      version: 2,
      connections: [{
        principal: stableStoredPrincipal(principal),
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        connectionId: 'connection-current',
        retiredCredentialIds: ['connection-retired'],
        externalAccount: {
          id: 'external-user-a',
          identityId: 9000041,
          account: 'fixture-user-a',
          name: 'Fixture User A'
        },
        state: 'connected',
        updatedAt: '2026-08-17T06:00:00.000Z'
      }],
      retiredConnections: []
    })
    let currentSubject: string = principal.subject
    const values = new Map([
      [`${principal.subject}:${OPENCONTENT_PROVIDER_INSTANCE_REF}:connection-retired`, 'retired-token']
    ])
    const status = vi.fn<OpenContentPrivateAccountRuntime['status']>()
    const credentials: OpenContentPrivateAccountRuntime = {
      enroll: async () => {
        throw new Error('enrollment must not run')
      },
      status,
      withSession: async (_binding, operation) => operation({ token: 'unused-token' }),
      remove: async (binding) => {
        currentSubject = 'local-account-b'
        values.delete(
          `${currentSubject}:${binding.providerInstanceRef}:${binding.connectionId}`
        )
      }
    }
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts: credentials,
      getRuntime: configuredRuntime(stubClient())
    })
    const assertPrincipalCurrent = () => {
      if (currentSubject !== principal.subject) throw new Error('Principal changed during cleanup.')
    }

    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent
    })).rejects.toMatchObject({ code: 'unauthorized' })

    expect(values.has(
      `${principal.subject}:${OPENCONTENT_PROVIDER_INSTANCE_REF}:connection-retired`
    )).toBe(true)
    expect(status).not.toHaveBeenCalled()
    await expect(settings.read()).resolves.toMatchObject({
      value: {
        connections: [expect.objectContaining({
          connectionId: 'connection-current',
          retiredCredentialIds: ['connection-retired']
        })]
      }
    })
  })

  it('fails a connection identity collision before enrollment and preserves the existing session', async () => {
    const existing = {
      principal: stableStoredPrincipal(principal),
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connectionId: 'connection-current',
      externalAccount: {
        id: 'external-user-a',
        identityId: 9000041,
        account: 'fixture-user-a',
        name: 'Fixture User A'
      },
      state: 'connected' as const,
      updatedAt: '2026-08-17T06:00:00.000Z'
    }
    const settings = inMemorySettings({
      version: 2,
      connections: [existing],
      retiredConnections: []
    })
    const credentials = inMemoryCredentials()
    const vaultKey = `${OPENCONTENT_PROVIDER_INSTANCE_REF}:connection-current`
    credentials.values.set(vaultKey, 'existing-opaque-token')
    const enroll = vi.spyOn(credentials, 'enroll')
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts: credentials,
      getRuntime: configuredRuntime(stubClient()),
      createConnectionId: () => 'connection-current'
    })

    await expect(service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })

    expect(enroll).not.toHaveBeenCalled()
    expect(credentials.values.get(vaultKey)).toBe('existing-opaque-token')
    await expect(settings.read()).resolves.toMatchObject({
      value: { connections: [existing] }
    })
  })

  it('commits only the validated Token and replaces the one current binding explicitly', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const authenticateExistingAccount = vi.fn<OpenContentClient['authenticateExistingAccount']>()
      .mockResolvedValue(authenticatedSession('external-user-a', 'fixture-user-a'))
    credentials.queueEnrollment(
      authenticatedSession('external-user-a', 'fixture-user-a'),
      authenticatedSession('external-user-b', 'fixture-user-b')
    )
    const enroll = vi.spyOn(credentials, 'enroll')
    let sequence = 0
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts: credentials,
      getRuntime: configuredRuntime({
        authenticateExistingAccount,
        isTokenValid: async () => true,
        observeCurrentExternalAccount: async () => fixtureExternalAccount('external-user-b'),
        listPersonalRootFolder: async () => ({
          source: 'personal-root',
          folderGuid: 'personal-folder-guid',
          label: 'Personal library'
        }),
        listFolderEntries: async ({ parentFolderGuid }) => ({
          parentFolderGuid,
          entries: []
        }),
        observeEntry: async ({ kind, resourceGuid }) => kind === 'container'
          ? { kind, folderGuid: resourceGuid, label: 'Folder' }
          : { kind, fileGuid: resourceGuid, label: 'File', size: 0 },
        observeEntryParent: async ({ kind, resourceGuid }) => ({
          child: { kind, resourceGuid }
        }),
        createFolder: async () => ({ folderGuid: 'created-folder-guid' }),
        uploadNewFile: async ({ parentFolderGuid, name, size }) => ({
          fileGuid: 'uploaded-file-guid',
          writeAfterObservation: {
            parentFolderGuid, fileGuid: 'uploaded-file-guid', name, size
          }
        }),
        authorizeDownload: async ({ fileGuid }) => ({
          fileGuid, regionType: 0, regionHash: 'fixture-region', regionUrl: ''
        }),
        downloadAuthorizedFile: async () => ({ bytesWritten: 0 })
      }),
      createConnectionId: () => `connection-${++sequence}`,
      now: () => new Date('2026-08-17T06:00:00.000Z')
    })

    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    await service.enroll({
      principal: { ...principal, identityVersion: 2 },
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
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
      [`${OPENCONTENT_PROVIDER_INSTANCE_REF}:connection-2`, 'opaque-token-external-user-b']
    ]))
    const persisted = await settings.read()
    expect(JSON.stringify(persisted.value)).not.toContain('password')
    expect(JSON.stringify(persisted.value)).not.toContain('opaque-token')
    expect(enroll).toHaveBeenCalledTimes(2)
  })

  it('does not persist a binding when the Principal changes between enrollment requests', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    let principalCurrent = true
    const requestedPaths: string[] = []
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input))
        requestedPaths.push(url.pathname)
        if (url.pathname === '/inbiz/org/api/auth/GetLoginRsaPublicKey') {
          return jsonResponse({
            result: 0,
            message: null,
            data: { PublicKey: publicKeyPem, Algorithm: 'RSA', Padding: 'OAEP-SHA256' },
            totalCount: 0
          })
        }
        if (url.pathname === '/flatsdk/api/services/Auth/UserLogin') {
          principalCurrent = false
          return jsonResponse({
            result: 0,
            msg: '',
            data: 'opaque-token-value-0001',
            clientId: null
          })
        }
        throw new Error(`A Principal change must stop request ${url.pathname}`)
      })
    })
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const accounts: OpenContentPrivateAccountRuntime = {
      ...credentials,
      enroll: async (input) => {
        await client.authenticateExistingAccount({
          username: 'fixture-user',
          password: 'fixture-secret',
          signal: input.signal,
          assertPrincipalCurrent: input.assertPrincipalCurrent
        })
        return credentials.enroll(input)
      }
    }
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts,
      getRuntime: configuredRuntime(client)
    })

    const error = await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: async () => {
        await Promise.resolve()
        if (!principalCurrent) throw new Error('sensitive-principal-diagnostic')
      }
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'unauthorized' })
    expect((error as Error).message).not.toContain('sensitive-principal-diagnostic')
    expect(requestedPaths).toEqual([
      '/inbiz/org/api/auth/GetLoginRsaPublicKey',
      '/flatsdk/api/services/Auth/UserLogin'
    ])
    expect(credentials.values).toEqual(new Map())
    await expect(settings.read()).resolves.toMatchObject({ value: null })
  })

  it('keeps a committed rebind successful when stale-credential cleanup fails', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const authenticateExistingAccount = vi.fn<OpenContentClient['authenticateExistingAccount']>()
      .mockResolvedValueOnce(authenticatedSession('external-user-a', 'fixture-user-a'))
      .mockResolvedValueOnce(authenticatedSession('external-user-b', 'fixture-user-b'))
    credentials.queueEnrollment(
      authenticatedSession('external-user-a', 'fixture-user-a'),
      authenticatedSession('external-user-b', 'fixture-user-b')
    )
    let sequence = 0
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts: credentials,
      getRuntime: configuredRuntime(stubClient({ authenticateExistingAccount })),
      createConnectionId: () => `connection-${++sequence}`
    })

    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    credentials.failRemove('connection-1')

    await expect(service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
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
      accounts: inMemoryCredentials(),
      getRuntime: configuredRuntime(stubClient({ isTokenValid })),
      createConnectionId: () => 'connection-current'
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
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
      accounts: credentials,
      getRuntime: configuredRuntime({
        authenticateExistingAccount: async () => ({
          token: 'bound-opaque-token',
          account: {
            id: 'external-user-a',
            identityId: 9000041,
            account: 'fixture-user-a',
            name: 'Fixture User A',
            topPersonalFolderId: '1001'
          }
        }),
        isTokenValid: async () => true,
        observeCurrentExternalAccount: async () => fixtureExternalAccount('external-user-a'),
        listPersonalRootFolder: async () => ({
          source: 'personal-root',
          folderGuid: 'personal-folder-guid',
          label: 'Personal library'
        }),
        listFolderEntries: async ({ parentFolderGuid }) => ({
          parentFolderGuid,
          entries: []
        }),
        observeEntry: async ({ kind, resourceGuid }) => kind === 'container'
          ? { kind, folderGuid: resourceGuid, label: 'Folder' }
          : { kind, fileGuid: resourceGuid, label: 'File', size: 0 },
        observeEntryParent: async ({ kind, resourceGuid }) => ({
          child: { kind, resourceGuid }
        }),
        createFolder: async () => ({ folderGuid: 'created-folder-guid' }),
        uploadNewFile: async ({ parentFolderGuid, name, size }) => ({
          fileGuid: 'uploaded-file-guid',
          writeAfterObservation: {
            parentFolderGuid, fileGuid: 'uploaded-file-guid', name, size
          }
        }),
        authorizeDownload: async ({ fileGuid }) => ({
          fileGuid, regionType: 0, regionHash: 'fixture-region', regionUrl: ''
        }),
        downloadAuthorizedFile: async () => ({ bytesWritten: 0 })
      }),
      createConnectionId: () => 'connection-current'
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })

    await expect(service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async ({ token }) => token.length)).resolves.toBe(18)
    const otherPrincipal = Object.freeze({ ...principal, subject: 'local-account-b' })
    await expect(service.status({
      principal: otherPrincipal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected' })
    await expect(service.useCurrentSession({
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
    await expect(service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async () => 'must not run')).rejects.toMatchObject({
      code: 'reauthentication_required'
    })
    expect(credentials.values).toEqual(new Map())
  })

  it('exposes one atomic session with the Token and login-readback external identity', async () => {
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings: inMemorySettings(),
      accounts: inMemoryCredentials(),
      getRuntime: configuredRuntime(stubClient()),
      createConnectionId: () => 'connection-current'
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })

    const observed = await service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async (session) => ({
      ...session,
      frozen: Object.isFrozen(session)
    }))

    expect(observed).toEqual({
      token: 'bound-opaque-token',
      externalIdentityId: 9000041,
      bindingAttestation: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        principal,
        externalSubject: expect.stringMatching(/^[0-9a-f]{64}$/u),
        bindingRevision: expect.stringMatching(/^[0-9a-f]{64}$/u)
      },
      frozen: true
    })
  })

  it('attests the exact Principal and rotates only the binding revision on same-account rebind', async () => {
    let sequence = 0
    const authenticateExistingAccount = vi.fn<OpenContentClient['authenticateExistingAccount']>()
      .mockResolvedValue(authenticatedSession('external-user-a', 'fixture-user-a'))
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings: inMemorySettings(),
      accounts: inMemoryCredentials(),
      getRuntime: configuredRuntime(stubClient({ authenticateExistingAccount })),
      createConnectionId: () => `connection-${++sequence}`
    })
    const bind = () => service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })

    await bind()
    const first = await service.attestExternalBinding({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    await bind()
    const rebound = await service.attestExternalBinding({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })

    expect(first).toEqual({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      principal,
      externalSubject: expect.stringMatching(/^[0-9a-f]{64}$/u),
      bindingRevision: expect.stringMatching(/^[0-9a-f]{64}$/u)
    })
    expect(Object.isFrozen(first)).toBe(true)
    expect(rebound.externalSubject).toBe(first.externalSubject)
    expect(rebound.bindingRevision).not.toBe(first.bindingRevision)
    expect(JSON.stringify([first, rebound])).not.toMatch(
      /external-user-a|fixture-user-a|connection-[12]|"identityId"/u
    )
  })

  it('rejects a superseded binding attestation before the protected operation', async () => {
    let sequence = 0
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings: inMemorySettings(),
      accounts: inMemoryCredentials(),
      getRuntime: configuredRuntime(stubClient()),
      createConnectionId: () => `connection-${++sequence}`
    })
    const bind = () => service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    await bind()
    const attestation = await service.attestExternalBinding({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    await expect(service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedBindingAttestation: attestation,
      assertPrincipalCurrent: () => undefined
    }, async () => 'admitted')).resolves.toBe('admitted')

    await bind()
    const operation = vi.fn(async () => 'must not run')
    await expect(service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedBindingAttestation: attestation,
      assertPrincipalCurrent: () => undefined
    }, operation)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(operation).not.toHaveBeenCalled()
  })

  it('requires every external binding attestation field to match exactly', async () => {
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings: inMemorySettings(),
      accounts: inMemoryCredentials(),
      getRuntime: configuredRuntime(stubClient()),
      createConnectionId: () => 'connection-current'
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    const attestation = await service.attestExternalBinding({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    const mismatches = [
      { ...attestation, providerInstanceRef: 'opencontent-other-instance' },
      { ...attestation, principal: { ...principal, identityVersion: 2 } },
      { ...attestation, externalSubject: 'c'.repeat(64) },
      { ...attestation, bindingRevision: 'd'.repeat(64) }
    ]

    for (const expectedBindingAttestation of mismatches) {
      const operation = vi.fn(async () => 'must not run')
      await expect(service.useCurrentSession({
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        expectedBindingAttestation,
        assertPrincipalCurrent: () => undefined
      }, operation)).rejects.toMatchObject({ code: 'unauthorized' })
      expect(operation).not.toHaveBeenCalled()
    }
  })

  it('keeps a valid binding when only Provider display fields change', async () => {
    let observedAccount: Awaited<ReturnType<
      OpenContentClient['observeCurrentExternalAccount']
    >> = fixtureExternalAccount('external-user-a')
    const observeCurrentExternalAccount = vi.fn<
      OpenContentClient['observeCurrentExternalAccount']
    >(async () => observedAccount)
    const operation = vi.fn(async (session) => session.bindingAttestation)
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings: inMemorySettings(),
      accounts: inMemoryCredentials(),
      getRuntime: configuredRuntime(stubClient({ observeCurrentExternalAccount })),
      createConnectionId: () => 'connection-current'
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    const attestation = await service.attestExternalBinding({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    observedAccount = Object.freeze({
      ...observedAccount,
      account: 'renamed-fixture-user-a',
      name: 'Changed Provider Name'
    })

    await expect(service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedBindingAttestation: attestation,
      assertPrincipalCurrent: () => undefined
    }, operation)).resolves.toEqual(attestation)

    expect(observeCurrentExternalAccount).toHaveBeenCalledTimes(2)
    expect(operation).toHaveBeenCalledOnce()
    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({ state: 'connected' })
  })

  it.each([{
    field: 'id',
    observedAccount: Object.freeze({
      ...fixtureExternalAccount('external-user-a'),
      id: 'external-user-other'
    })
  }, {
    field: 'identityId',
    observedAccount: Object.freeze({
      ...fixtureExternalAccount('external-user-a'),
      identityId: 9000099
    })
  }])('requires reauthentication when stable external account $field changes', async ({
    observedAccount
  }) => {
    const operation = vi.fn(async () => 'must not run')
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings: inMemorySettings(),
      accounts: inMemoryCredentials(),
      getRuntime: configuredRuntime(stubClient({
        observeCurrentExternalAccount: async () => observedAccount
      })),
      createConnectionId: () => 'connection-current'
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })

    await expect(service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, operation)).rejects.toMatchObject({ code: 'reauthentication_required' })
    expect(operation).not.toHaveBeenCalled()
    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({ state: 'reauthentication_required' })
  })

  it('does not let a rebind replace the account during an active atomic session', async () => {
    const authenticateExistingAccount = vi.fn<OpenContentClient['authenticateExistingAccount']>()
      .mockResolvedValueOnce(authenticatedSession('external-user-a', 'fixture-user-a'))
      .mockResolvedValueOnce(authenticatedSession('external-user-b', 'fixture-user-b'))
    let connectionSequence = 0
    const credentials = inMemoryCredentials()
    credentials.queueEnrollment(
      authenticatedSession('external-user-a', 'fixture-user-a'),
      authenticatedSession('external-user-b', 'fixture-user-b')
    )
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings: inMemorySettings(),
      accounts: credentials,
      getRuntime: configuredRuntime(stubClient({ authenticateExistingAccount })),
      createConnectionId: () => `connection-${++connectionSequence}`
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })

    let enterSession!: () => void
    const enteredSession = new Promise<void>((resolve) => { enterSession = resolve })
    let releaseSession!: () => void
    const sessionReleased = new Promise<void>((resolve) => { releaseSession = resolve })
    const activeSession = service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async (session) => {
      enterSession()
      await sessionReleased
      return session.externalIdentityId
    })
    await enteredSession

    let rebindCompleted = false
    const rebind = service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }).then((status) => {
      rebindCompleted = true
      return status
    })
    await Promise.resolve()
    expect(rebindCompleted).toBe(false)

    releaseSession()
    await expect(activeSession).resolves.toBe(9000041)
    await expect(rebind).resolves.toMatchObject({
      externalAccount: { identityId: 9000042 }
    })
  })

  it('returns and persists reauthentication_required when public status finds an invalid Token', async () => {
    const settings = inMemorySettings()
    const credentials = inMemoryCredentials()
    const isTokenValid = vi.fn<OpenContentClient['isTokenValid']>()
      .mockResolvedValueOnce(false)
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts: credentials,
      getRuntime: configuredRuntime({
        authenticateExistingAccount: async () => ({
          token: 'bound-opaque-token',
          account: {
            id: 'external-user-a',
            identityId: 9000041,
            account: 'fixture-user-a',
            name: 'Fixture User A',
            topPersonalFolderId: '1001'
          }
        }),
        isTokenValid,
        observeCurrentExternalAccount: async () => fixtureExternalAccount('external-user-a'),
        listPersonalRootFolder: async () => ({
          source: 'personal-root',
          folderGuid: 'personal-folder-guid',
          label: 'Personal library'
        }),
        listFolderEntries: async ({ parentFolderGuid }) => ({
          parentFolderGuid,
          entries: []
        }),
        observeEntry: async ({ kind, resourceGuid }) => kind === 'container'
          ? { kind, folderGuid: resourceGuid, label: 'Folder' }
          : { kind, fileGuid: resourceGuid, label: 'File', size: 0 },
        observeEntryParent: async ({ kind, resourceGuid }) => ({
          child: { kind, resourceGuid }
        }),
        createFolder: async () => ({ folderGuid: 'created-folder-guid' }),
        uploadNewFile: async ({ parentFolderGuid, name, size }) => ({
          fileGuid: 'uploaded-file-guid',
          writeAfterObservation: {
            parentFolderGuid, fileGuid: 'uploaded-file-guid', name, size
          }
        }),
        authorizeDownload: async ({ fileGuid }) => ({
          fileGuid, regionType: 0, regionHash: 'fixture-region', regionUrl: ''
        }),
        downloadAuthorizedFile: async () => ({ bytesWritten: 0 })
      }),
      createConnectionId: () => 'connection-current'
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
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
      accounts: credentials,
      getRuntime: configuredRuntime({
        authenticateExistingAccount: async () => ({
          token: 'bound-opaque-token',
          account: {
            id: 'external-user-a',
            identityId: 9000041,
            account: 'fixture-user-a',
            name: 'Fixture User A',
            topPersonalFolderId: '1001'
          }
        }),
        isTokenValid: async () => true,
        observeCurrentExternalAccount: async () => authenticatedSession(
          'external-user-a',
          'fixture-user-a'
        ).account,
        listPersonalRootFolder: async () => ({
          source: 'personal-root',
          folderGuid: 'personal-folder-guid',
          label: 'Personal library'
        }),
        listFolderEntries: async ({ parentFolderGuid }) => ({
          parentFolderGuid,
          entries: []
        }),
        observeEntry: async ({ kind, resourceGuid }) => kind === 'container'
          ? { kind, folderGuid: resourceGuid, label: 'Folder' }
          : { kind, fileGuid: resourceGuid, label: 'File', size: 0 },
        observeEntryParent: async ({ kind, resourceGuid }) => ({
          child: { kind, resourceGuid }
        }),
        createFolder: async () => ({ folderGuid: 'created-folder-guid' }),
        uploadNewFile: async ({ parentFolderGuid, name, size }) => ({
          fileGuid: 'uploaded-file-guid',
          writeAfterObservation: {
            parentFolderGuid, fileGuid: 'uploaded-file-guid', name, size
          }
        }),
        authorizeDownload: async ({ fileGuid }) => ({
          fileGuid, regionType: 0, regionHash: 'fixture-region', regionUrl: ''
        }),
        downloadAuthorizedFile: async () => ({ bytesWritten: 0 })
      }),
      createConnectionId: () => 'connection-current'
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    credentials.failUse(new OpenContentPrivateAccountError(
      'secure_storage_unavailable',
      'The operating-system secure storage service is unavailable.'
    ))

    await expect(service.useCurrentSession({
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

  it('removes a newly stored Token if the Principal lease expires before settings commit', async () => {
    const stored = inMemoryCredentials()
    let principalCurrent = true
    const credentials: OpenContentPrivateAccountRuntime = {
      ...stored,
      enroll: async (input) => {
        const receipt = await stored.enroll(input)
        principalCurrent = false
        return receipt
      }
    }
    const settings = inMemorySettings()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      settings,
      accounts: credentials,
      getRuntime: configuredRuntime(stubClient()),
      createConnectionId: () => 'connection-principal-expired'
    })

    await expect(service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: async () => {
        await Promise.resolve()
        if (!principalCurrent) throw new Error('Principal changed after Token storage.')
      }
    })).rejects.toMatchObject({ code: 'unauthorized' })

    expect(stored.values).toEqual(new Map())
    await expect(settings.read()).resolves.toMatchObject({ value: null })
  })
})

function inMemorySettings(
  initialValue: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
): DomainMainPackageSettingsHost {
  let revision = 0
  let value = structuredClone(initialValue)
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

function legacyConnectionSettings(owner: typeof principal) {
  return {
    version: 1,
    connections: [{
      principal: stableStoredPrincipal(owner),
      providerInstanceRef: 'opencontent-default',
      connectionId: 'legacy-connection',
      externalAccount: {
        id: 'legacy-external-user',
        identityId: 40,
        account: 'legacy-fixture-user',
        name: 'Legacy Fixture User'
      },
      state: 'connected',
      updatedAt: '2026-08-16T06:00:00.000Z'
    }]
  }
}

function stableStoredPrincipal(owner: typeof principal) {
  return {
    authority: owner.authority,
    subject: owner.subject,
    assurance: owner.assurance,
    deviceId: owner.deviceId
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
        identityId: 9000041,
        account: 'fixture-user-a',
        name: 'Fixture User A',
        topPersonalFolderId: '1001'
      }
    }),
    isTokenValid: async () => true,
    observeCurrentExternalAccount: async () => fixtureExternalAccount('external-user-a'),
    listPersonalRootFolder: async () => ({
      source: 'personal-root',
      folderGuid: 'personal-folder-guid',
      label: 'Personal library'
    }),
    listFolderEntries: async ({ parentFolderGuid }) => ({ parentFolderGuid, entries: [] }),
    observeEntry: async ({ kind, resourceGuid }) => kind === 'container'
      ? { kind, folderGuid: resourceGuid, label: 'Folder' }
      : { kind, fileGuid: resourceGuid, label: 'File', size: 0 },
    observeEntryParent: async ({ kind, resourceGuid }) => ({
      child: { kind, resourceGuid }
    }),
    createFolder: async () => ({ folderGuid: 'created-folder-guid' }),
    uploadNewFile: async ({ parentFolderGuid, name, size }) => ({
      fileGuid: 'uploaded-file-guid',
      writeAfterObservation: {
        parentFolderGuid, fileGuid: 'uploaded-file-guid', name, size
      }
    }),
    authorizeDownload: async ({ fileGuid }) => ({
      fileGuid, regionType: 0, regionHash: 'fixture-region', regionUrl: ''
    }),
    downloadAuthorizedFile: async () => ({ bytesWritten: 0 }),
    ...overrides
  }
}

function configuredRuntime(client: OpenContentClient) {
  const runtime = Object.freeze({ client })
  return () => runtime
}

function authenticatedSession(id: string, account: string) {
  return Object.freeze({
    token: `opaque-token-${id}`,
    account: Object.freeze({
      id,
      identityId: id === 'external-user-a' ? 9000041 : 9000042,
      account,
      name: id === 'external-user-a' ? 'Fixture User A' : 'Fixture User B',
      topPersonalFolderId: id === 'external-user-a' ? '1001' : '1002'
    })
  })
}

function fixtureExternalAccount(id: 'external-user-a' | 'external-user-b') {
  const account = id === 'external-user-a' ? 'fixture-user-a' : 'fixture-user-b'
  return Object.freeze({
    id,
    identityId: id === 'external-user-a' ? 9000041 : 9000042,
    account,
    name: id === 'external-user-a' ? 'Fixture User A' : 'Fixture User B',
    topPersonalFolderId: id === 'external-user-a' ? '1001' : '1002'
  })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function inMemoryCredentials(): OpenContentPrivateAccountRuntime & Readonly<{
  values: Map<string, string>
  failUse: (error: Error | undefined) => void
  failRemove: (connectionId: string | undefined) => void
  queueEnrollment: (...sessions: ReturnType<typeof authenticatedSession>[]) => void
}> {
  const values = new Map<string, string>()
  const enrollments: ReturnType<typeof authenticatedSession>[] = []
  let useFailure: Error | undefined
  let failedRemoveConnectionId: string | undefined
  const key = (binding: Readonly<{
    providerInstanceRef: string
    connectionId: string
  }>) => `${binding.providerInstanceRef}:${binding.connectionId}`
  return {
    values,
    failUse: (error) => { useFailure = error },
    failRemove: (connectionId) => { failedRemoveConnectionId = connectionId },
    queueEnrollment: (...sessions) => { enrollments.push(...sessions) },
    enroll: async (input) => {
      const session = enrollments.shift() ?? {
        ...authenticatedSession('external-user-a', 'fixture-user-a'),
        token: 'bound-opaque-token'
      }
      values.set(key(input), session.token)
      return {
        externalAccount: {
          id: session.account.id,
          identityId: session.account.identityId,
          account: session.account.account,
          name: session.account.name
        }
      }
    },
    status: async (binding) => values.has(key(binding))
      ? { state: 'available' as const }
      : { state: 'absent' as const },
    withSession: async (binding, operation) => {
      if (useFailure) throw useFailure
      const value = values.get(key(binding))
      if (!value) throw new OpenContentPrivateAccountError(
        'session_unavailable',
        'The fixture session is unavailable.'
      )
      return operation({ token: value })
    },
    remove: async (binding) => {
      if (binding.connectionId === failedRemoveConnectionId) {
        throw new OpenContentPrivateAccountError(
          'secure_storage_unavailable',
          'The test secure storage cleanup failed.'
        )
      }
      values.delete(key(binding))
    }
  }
}

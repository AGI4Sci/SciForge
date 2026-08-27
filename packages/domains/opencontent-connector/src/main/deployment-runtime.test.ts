import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type {
  DomainMainHost,
  DomainMainInternalServiceRegistration
} from '@sciforge/domain-sdk/host'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type {
  DomainMainProviderCredentialAccess,
  DomainMainProviderCredentialStoreHost
} from '@sciforge/domain-sdk/package-storage'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  OPENCONTENT_CONTENT_SPACE_SERVICE_ID
} from '../contract.js'
import type { OpenContentContentSpaceFacade } from '../main-contract.js'
import { OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR } from './deployment-config.js'
import { createDomainMainEntry } from './index.js'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'opencontent-edoc2-demo' as const

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'deployment-unavailable-user',
  assurance: 'local-selection' as const,
  deviceId: 'deployment-unavailable-device',
  identityVersion: 1
})

const tempRoots: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('OpenContent deployment runtime availability', () => {
  it('registers discovery, capabilities, and facade without configuration but gates every Provider call', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-opencontent-unconfigured-'))
    tempRoots.push(root)
    const fetch = vi.fn()
    const getExecutablePath = vi.fn(() => process.execPath)
    vi.stubGlobal('fetch', fetch)
    const settings = Object.freeze({
      read: vi.fn(async () => ({ revision: 0, value: null })),
      write: vi.fn(async (value: DomainPackageJsonValue) => ({ revision: 1, value })),
      clear: vi.fn(async () => ({ revision: 1, value: null }))
    })
    const providerCredentials = Object.freeze({
      status: vi.fn(async () => ({ state: 'absent' as const })),
      replace: vi.fn(async () => undefined),
      use: vi.fn(async () => {
        throw new Error('Synthetic credential is unavailable.')
      }) as unknown as DomainMainProviderCredentialStoreHost['use'] & ReturnType<typeof vi.fn>,
      remove: vi.fn(async () => undefined)
    })
    let facade: OpenContentContentSpaceFacade | undefined
    const host: DomainMainHost = Object.freeze({
      getUserDataDir: () => join(root, 'user-data'),
      getAppRoot: () => root,
      getExecutablePath,
      isPackaged: () => false,
      defineCapability: (options: unknown) => options,
      packageSettings: settings,
      packageSecrets: Object.freeze({
        has: vi.fn(async () => false),
        read: vi.fn(async () => null),
        write: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        providerCredentials
      }),
      internalServices: Object.freeze({
        register<Service extends object>(
          registration: DomainMainInternalServiceRegistration<Service>
        ): void {
          facade = registration.service as OpenContentContentSpaceFacade
        },
        acquire<Service extends object>(): Service {
          throw new Error('service acquisition is outside this test')
        }
      })
    })

    const entry = createDomainMainEntry(host)
    const capabilityFactory = entry.contributions.find(
      ({ kind }) => kind === 'main.capability-factory'
    )?.value as Readonly<{ createDefinitions(): readonly CapabilityDefinition[] }>
    const definitions = capabilityFactory.createDefinitions()
    const status = requireCapability(definitions, OPENCONTENT_CONNECTION_CAPABILITY_IDS.status)
    const bind = requireCapability(definitions, OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind)

    expect(entry.contributions.map(({ id }) => id)).toEqual(expect.arrayContaining([
      'opencontent-connector.capabilities',
      'opencontent-connector.provider-instance',
      'opencontent-connector.content-space-service'
    ]))
    expect(facade).toBeDefined()
    await expect(status.handler({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    }, capabilityContext())).resolves.toEqual({
      output: {
        outcome: 'error',
        error: { code: 'provider_unavailable', action: 'retry' }
      }
    })
    await expect(bind.handler({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      account: 'deployment-unavailable-user',
      password: 'one-use-password'
    }, capabilityContext())).resolves.toEqual({
      output: {
        outcome: 'error',
        error: { code: 'provider_unavailable', action: 'retry' }
      }
    })

    const providerCall = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: vi.fn()
    }
    await expect(facade!.attestExternalBinding(providerCall)).rejects.toMatchObject({
      code: 'provider_unavailable'
    })
    await expect(facade!.listRootFolders({
      ...providerCall,
      teamPage: 1,
      teamPageSize: 20
    })).rejects.toMatchObject({ code: 'provider_unavailable' })
    await expect(facade!.listFolderEntries({
      ...providerCall,
      parentFolderGuid: 'folder-guid',
      page: 1,
      pageSize: 20
    })).rejects.toMatchObject({ code: 'provider_unavailable' })
    await expect(facade!.observeEntry({
      ...providerCall,
      kind: 'file',
      resourceGuid: 'file-guid'
    })).rejects.toMatchObject({ code: 'provider_unavailable' })
    await expect(facade!.createFolder({
      ...providerCall,
      parentFolderGuid: 'folder-guid',
      name: 'Folder',
      signal: new AbortController().signal
    })).rejects.toMatchObject({ code: 'provider_unavailable' })
    await expect(facade!.uploadNewFile({
      ...providerCall,
      parentFolderGuid: 'folder-guid',
      name: 'file.txt',
      size: 1,
      read: async () => Uint8Array.of(1),
      signal: new AbortController().signal
    })).rejects.toMatchObject({ code: 'provider_unavailable' })
    await expect(facade!.authorizeDownload({
      ...providerCall,
      fileGuid: 'file-guid',
      expectedBindingAttestation: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        principal,
        externalSubject: 'a'.repeat(64),
        bindingRevision: 'b'.repeat(64)
      },
      signal: new AbortController().signal
    })).rejects.toMatchObject({ code: 'provider_unavailable' })
    await expect(facade!.useTeamAdministration(providerCall, async () => undefined))
      .rejects.toMatchObject({ code: 'provider_unavailable' })
    expect(facade!.useSupplierTransport).toBeUndefined()

    expect(settings.read).not.toHaveBeenCalled()
    expect(settings.write).not.toHaveBeenCalled()
    expect(settings.clear).not.toHaveBeenCalled()
    expect(providerCredentials.status).not.toHaveBeenCalled()
    expect(providerCredentials.replace).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(getExecutablePath).not.toHaveBeenCalled()
  })

  it('preserves invalid Provider Instance priority before deployment availability', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-opencontent-unconfigured-'))
    tempRoots.push(root)
    const read = vi.fn(async () => ({ revision: 0, value: null }))
    let facade: OpenContentContentSpaceFacade | undefined
    const host = minimalHost(root, read, (service) => { facade = service })
    const entry = createDomainMainEntry(host)
    const capabilityFactory = entry.contributions.find(
      ({ kind }) => kind === 'main.capability-factory'
    )?.value as Readonly<{ createDefinitions(): readonly CapabilityDefinition[] }>
    const status = requireCapability(
      capabilityFactory.createDefinitions(),
      OPENCONTENT_CONNECTION_CAPABILITY_IDS.status
    )

    await expect(status.handler({ providerInstanceRef: 'opencontent-unknown' }, capabilityContext()))
      .resolves.toEqual({
        output: {
          outcome: 'error',
          error: { code: 'invalid_provider_instance', action: 'select_provider' }
        }
      })
    await expect(facade!.listFolderEntries({
      principal,
      providerInstanceRef: 'opencontent-unknown',
      parentFolderGuid: 'folder-guid',
      page: 1,
      pageSize: 20,
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(read).not.toHaveBeenCalled()
  })

  it('exercises the packaged bind/status path under a simulated win32 platform contract', async () => {
    const resourcesRoot = mkdtempSync(join(tmpdir(), 'sciforge-opencontent-packaged-'))
    tempRoots.push(resourcesRoot)
    const appRoot = join(resourcesRoot, 'app.asar')
    writeFileSync(appRoot, 'synthetic archive', 'utf8')
    expect(
      OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.packagedResourcesRelativePath
    ).toBe('domain-deployments/opencontent-connector.json')
    writeJson(
      join(
        resourcesRoot,
        OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.packagedResourcesRelativePath
      ),
      {
        contractVersion: 1,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        origin: 'https://tenant.example'
      }
    )

    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    let tokenValid = true
    const fetch = vi.fn(async (rawUrl: string | URL | Request) => {
      const url = new URL(typeof rawUrl === 'string' ? rawUrl : rawUrl.toString())
      if (url.pathname.endsWith('/inbiz/org/api/auth/GetLoginRsaPublicKey')) {
        return jsonResponse({
          result: 0,
          message: null,
          data: { PublicKey: publicKeyPem, Algorithm: 'RSA', Padding: 'OAEP-SHA256' },
          totalCount: 0
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/Auth/UserLogin')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: 'packaged-session-token-must-be-encrypted',
          clientId: null
        })
      }
      if (url.pathname.endsWith('/Auth/CheckUserTokenValidity')) {
        return jsonResponse({ result: 0, msg: '', data: tokenValid })
      }
      if (url.pathname.endsWith('/User/GetUserInfoByToken')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            id: 'packaged-external-account',
            identityId: 42,
            account: 'packaged-user',
            name: 'Packaged User',
            topPersonalFolderId: 1001
          }
        })
      }
      throw new Error(`Unexpected packaged Connector request: ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetch)
    const getExecutablePath = vi.fn(() => process.execPath)
    let storedSession: string | undefined
    const use = vi.fn(async (
      _access: DomainMainProviderCredentialAccess,
      operation: (secret: string) => unknown | Promise<unknown>
    ) => {
      if (storedSession === undefined) throw new Error('Synthetic credential is unavailable.')
      return operation(storedSession)
    }) as unknown as
      DomainMainProviderCredentialStoreHost['use'] & ReturnType<typeof vi.fn>
    const providerCredentials = Object.freeze({
      status: vi.fn(async () => storedSession === undefined
        ? ({ state: 'absent' as const })
        : ({ state: 'available' as const, recordVersion: 1 as const })),
      replace: vi.fn(async (_access: DomainMainProviderCredentialAccess, secret: string) => {
        storedSession = secret
      }),
      use,
      remove: vi.fn(async () => { storedSession = undefined })
    })
    const packageSettings = Object.freeze({
      read: vi.fn(async () => ({ revision: 0, value: null })),
      write: vi.fn(async (value: DomainPackageJsonValue) => ({ revision: 1, value })),
      clear: vi.fn(async () => ({ revision: 1, value: null }))
    })
    let facade: OpenContentContentSpaceFacade | undefined
    const host: DomainMainHost = Object.freeze({
      getUserDataDir: () => join(resourcesRoot, 'user-data'),
      getAppRoot: () => appRoot,
      getExecutablePath,
      isPackaged: () => true,
      defineCapability: (options: unknown) => options,
      packageSettings,
      packageSecrets: Object.freeze({
        has: vi.fn(async () => false),
        read: vi.fn(async () => null),
        write: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        providerCredentials
      }),
      internalServices: Object.freeze({
        register: (registration: DomainMainInternalServiceRegistration<object>) => {
          facade = registration.service as OpenContentContentSpaceFacade
        },
        acquire: <Service extends object>(): Service => {
          throw new Error('service acquisition is outside this test')
        }
      })
    })

    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    if (!platformDescriptor) throw new Error('Node.js process.platform is unavailable.')
    Object.defineProperty(process, 'platform', {
      ...platformDescriptor,
      value: 'win32'
    })
    try {
      const entry = createDomainMainEntry(host)
      const capabilityFactory = entry.contributions.find(
        ({ kind }) => kind === 'main.capability-factory'
      )?.value as Readonly<{ createDefinitions(): readonly CapabilityDefinition[] }>
      const definitions = capabilityFactory.createDefinitions()
      const bind = requireCapability(
        definitions,
        OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind
      )
      const status = requireCapability(
        definitions,
        OPENCONTENT_CONNECTION_CAPABILITY_IDS.status
      )
      expect(facade?.useSupplierTransport).toBeUndefined()
      await expect(bind.handler({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        account: 'packaged-user',
        password: 'packaged-password-must-never-persist'
      }, capabilityContext())).resolves.toMatchObject({
        output: {
          outcome: 'success',
          status: {
            state: 'connected',
            providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
          }
        }
      })
      expect(storedSession).toBe('packaged-session-token-must-be-encrypted')
      expect(storedSession).not.toContain('packaged-password')
      expect(providerCredentials.replace).toHaveBeenCalledOnce()
      expect(JSON.stringify(providerCredentials.replace.mock.calls)).not.toContain(
        'packaged-password-must-never-persist'
      )
      expect(packageSettings.read).not.toHaveBeenCalled()
      expect(packageSettings.write).not.toHaveBeenCalled()
      expect(packageSettings.clear).not.toHaveBeenCalled()
      expect(fetch).toHaveBeenCalledTimes(4)

      tokenValid = false
      await expect(status.handler({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
      }, capabilityContext())).resolves.toEqual({
        output: {
          outcome: 'success',
          status: {
            state: 'reauthentication_required',
            providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
          }
        }
      })
      expect(providerCredentials.replace).toHaveBeenCalledOnce()
      expect(fetch).toHaveBeenCalledTimes(5)
      expect(getExecutablePath).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', platformDescriptor)
    }
  })
})

type CapabilityDefinition = Readonly<{
  id: string
  handler(input: any, context: any): Promise<Readonly<{ output: unknown }>>
}>

function requireCapability(
  definitions: readonly CapabilityDefinition[],
  id: string
): CapabilityDefinition {
  const definition = definitions.find((candidate) => candidate.id === id)
  if (!definition) throw new Error(`Missing capability ${id}`)
  return definition
}

function capabilityContext() {
  return Object.freeze({
    caller: Object.freeze({ audience: 'ui' as const, principal }),
    assertPrincipalCurrent: vi.fn()
  })
}

function minimalHost(
  root: string,
  read: () => Promise<Readonly<{ revision: number; value: null }>>,
  registered: (service: OpenContentContentSpaceFacade) => void
): DomainMainHost {
  return Object.freeze({
    getUserDataDir: () => join(root, 'user-data'),
    getAppRoot: () => root,
    isPackaged: () => false,
    defineCapability: (options: unknown) => options,
    packageSettings: Object.freeze({
      read,
      write: async (value: DomainPackageJsonValue) => ({ revision: 1, value }),
      clear: async () => ({ revision: 1, value: null })
    }),
    internalServices: Object.freeze({
      register: (registration: DomainMainInternalServiceRegistration<object>) => {
        expect(registration.serviceId).toBe(OPENCONTENT_CONTENT_SPACE_SERVICE_ID)
        registered(registration.service as OpenContentContentSpaceFacade)
      },
      acquire: <Service extends object>(): Service => {
        throw new Error('service acquisition is outside this test')
      }
    })
  })
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value), 'utf8')
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

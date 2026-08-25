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
    let facade: OpenContentContentSpaceFacade | undefined
    const host: DomainMainHost = Object.freeze({
      getUserDataDir: () => join(root, 'user-data'),
      getAppRoot: () => root,
      getExecutablePath,
      isPackaged: () => false,
      defineCapability: (options: unknown) => options,
      packageSettings: settings,
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
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
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

  it('fails closed when the native account vault has no packaged session', async () => {
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

    const fetch = vi.fn(async (rawUrl: string | URL | Request) => {
      const url = new URL(typeof rawUrl === 'string' ? rawUrl : rawUrl.toString())
      if (url.pathname.endsWith('/Auth/CheckUserTokenValidity')) {
        return jsonResponse({ result: 0, msg: '', data: true })
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
    const legacyUse = vi.fn(async (
      _access: DomainMainProviderCredentialAccess,
      operation: (secret: string) => unknown | Promise<unknown>
    ) => operation('legacy-host-token-must-not-be-used')) as unknown as
      DomainMainProviderCredentialStoreHost['use'] & ReturnType<typeof vi.fn>
    const legacyProviderCredentials = Object.freeze({
      status: vi.fn(async () => ({ state: 'available' as const, recordVersion: 1 as const })),
      replace: vi.fn(async () => undefined),
      use: legacyUse,
      remove: vi.fn(async () => undefined)
    })
    let facade: OpenContentContentSpaceFacade | undefined
    const host: DomainMainHost = Object.freeze({
      getUserDataDir: () => join(resourcesRoot, 'user-data'),
      getAppRoot: () => appRoot,
      getExecutablePath,
      isPackaged: () => true,
      defineCapability: (options: unknown) => options,
      packageSettings: Object.freeze({
        read: vi.fn(async () => ({
          revision: 1,
          value: {
            version: 2,
            connections: [{
              principal: {
                authority: principal.authority,
                subject: principal.subject,
                assurance: principal.assurance,
                deviceId: principal.deviceId
              },
              providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
              connectionId: 'packaged-connection',
              externalAccount: {
                id: 'packaged-external-account',
                identityId: 42,
                account: 'packaged-user',
                name: 'Packaged User'
              },
              state: 'connected',
              updatedAt: '2026-08-23T00:00:00.000Z'
            }],
            retiredConnections: []
          } satisfies DomainPackageJsonValue
        })),
        write: vi.fn(async (value: DomainPackageJsonValue) => ({ revision: 2, value })),
        clear: vi.fn(async () => ({ revision: 2, value: null }))
      }),
      packageSecrets: Object.freeze({
        has: vi.fn(async () => false),
        read: vi.fn(async () => null),
        write: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        providerCredentials: legacyProviderCredentials
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

    expect(() => createDomainMainEntry(host)).not.toThrow()
    expect(facade?.useSupplierTransport).toBeUndefined()
    await expect(facade!.useTeamAdministration({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, ({ administration }) => typeof administration.listTeams)).rejects.toMatchObject({
      code: 'reauthentication_required'
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(getExecutablePath).not.toHaveBeenCalled()
    expect(legacyProviderCredentials.status).not.toHaveBeenCalled()
    expect(legacyProviderCredentials.replace).not.toHaveBeenCalled()
    expect(legacyProviderCredentials.use).not.toHaveBeenCalled()
    expect(legacyProviderCredentials.remove).not.toHaveBeenCalled()
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

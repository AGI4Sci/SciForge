import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  CONTENT_SPACE_CAPABILITY_IDS,
  type ContentSpaceContainerPage,
  type ContentSpaceResult
} from '@sciforge/domain-content-space/contract'
import {
  CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION,
  CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION
} from '@sciforge/domain-content-space/definition'
import {
  createDomainMainEntry as createContentSpaceMainEntry
} from '@sciforge/domain-content-space/main'
import {
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  OPENCONTENT_PROVIDER_INSTANCE_REF
} from '@sciforge/domain-opencontent-connector/contract'
import {
  OPENCONTENT_CAPABILITY_FACTORY_CONTRIBUTION
} from '@sciforge/domain-opencontent-connector/definition'
import {
  createDomainMainEntry as createOpenContentMainEntry
} from '@sciforge/domain-opencontent-connector/main'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost,
  type DomainMainInternalServiceHost,
  type DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  DomainMainProviderCredentialError,
  type DomainMainPackageSecretStoreHost,
  type DomainMainPackageSettingsHost,
  type DomainMainProviderCredentialAccess,
  type DomainMainProviderCredentialStoreHost
} from '@sciforge/domain-sdk/package-storage'

import { createDomainMainEntry as createAdapterMainEntry } from './index.js'

const TRUSTED_ORIGIN = 'https://test1.edoc2.com'
const TOKEN_CANARY = 'opaque-integration-token-0001'
const PASSWORD_CANARY = 'password-canary-do-not-return'
const LEGACY_PROVIDER_INSTANCE_REF = 'opencontent-default'

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'opencontent-content-space-user',
  assurance: 'local-selection' as const,
  deviceId: 'opencontent-content-space-device',
  identityVersion: 3
})

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

type CapabilityDefinition = Readonly<{
  id: string
  handler(
    input: unknown,
    context: ReturnType<typeof capabilityContext>
  ): Promise<Readonly<{ output: unknown }>>
}>

describe('composed Content Space with the OpenContent Provider adapter', () => {
  it('persists the binding and keeps personal and Team library reads working after restart', async () => {
    const storage = persistentStorage()
    const transport = deterministicOpenContentTransport()
    const first = await composeRuntime(storage, transport.fetch)

    try {
      const bound = await invoke(first.connectorDefinitions, OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind, {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        username: 'fixture-scientist',
        password: PASSWORD_CANARY
      }, 'invocation_opencontent_bind_0001')
      expect(bound).toEqual({
        outcome: 'success',
        status: {
          state: 'connected',
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          externalAccount: {
            id: 'opencontent-user-guid',
            identityId: 42,
            account: 'fixture-scientist',
            name: 'Fixture Scientist'
          }
        }
      })

      const personal = await invoke<ContentSpaceResult<ContentSpaceContainerPage>>(
        first.contentDefinitions,
        CONTENT_SPACE_CAPABILITY_IDS.listContainers,
        {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          page: { limit: 20 }
        },
        'invocation_content_space_personal_0002'
      )
      expect(personal).toEqual({
        ok: true,
        value: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          items: [{
            reference: {
              providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
              containerId: 'personal-folder-guid'
            },
            label: 'Personal library',
            scope: 'personal'
          }],
          nextCursor: 'teams_1'
        }
      })
      expectSafePublicOutput({ bound, personal })
    } finally {
      await first.dispose()
    }

    const second = await composeRuntime(storage, transport.fetch)
    try {
      const status = await invoke(
        second.connectorDefinitions,
        OPENCONTENT_CONNECTION_CAPABILITY_IDS.status,
        { providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF },
        'invocation_opencontent_status_after_restart_0003'
      )
      expect(status).toMatchObject({
        outcome: 'success',
        status: {
          state: 'connected',
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          externalAccount: { identityId: 42, account: 'fixture-scientist' }
        }
      })

      const teams = await invoke<ContentSpaceResult<ContentSpaceContainerPage>>(
        second.contentDefinitions,
        CONTENT_SPACE_CAPABILITY_IDS.listContainers,
        {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          page: { limit: 20, cursor: 'teams_1' }
        },
        'invocation_content_space_teams_after_restart_0004'
      )
      expect(teams).toEqual({
        ok: true,
        value: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          items: [{
            reference: {
              providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
              containerId: 'team-folder-guid'
            },
            label: 'SciForge Research',
            scope: 'shared'
          }]
        }
      })
      expectSafePublicOutput({ status, teams })
      expect(transport.loginRequests).toHaveLength(1)
      expect(transport.requestedPaths).toEqual([
        '/inbiz/org/api/auth/GetLoginRsaPublicKey',
        '/flatsdk/api/services/Auth/UserLogin',
        '/flatsdk/api/services/Auth/CheckUserTokenValidity',
        '/flatsdk/api/services/User/GetUserInfoByToken',
        '/flatsdk/api/services/Auth/CheckUserTokenValidity',
        '/flatsdk/api/services/User/GetTopPersonalFolderId',
        '/flatsdk/api/services/DocList/GetFolderInfoById',
        '/flatsdk/api/services/Auth/CheckUserTokenValidity',
        '/flatsdk/api/services/Auth/CheckUserTokenValidity',
        '/flatsdk/api/services/Team/GetMyTeamList',
        '/flatsdk/api/services/DocList/GetFolderInfoById'
      ])
    } finally {
      await second.dispose()
    }
  })

  it('rejects the removed Provider Instance at the catalog gate before service or storage access', async () => {
    const storage = persistentStorage()
    const transport = deterministicOpenContentTransport()
    const runtime = await composeRuntime(storage, transport.fetch)

    try {
      const result = await invoke<ContentSpaceResult<ContentSpaceContainerPage>>(
        runtime.contentDefinitions,
        CONTENT_SPACE_CAPABILITY_IDS.listContainers,
        {
          providerInstanceRef: LEGACY_PROVIDER_INSTANCE_REF,
          page: { limit: 20 }
        },
        'invocation_content_space_legacy_ref_0004'
      )

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'unknown_provider_instance',
          message: 'The selected Provider Instance is unknown.',
          retry: 'never'
        }
      })
      expect(runtime.internalServices.acquire).not.toHaveBeenCalled()
      expect(transport.fetch).not.toHaveBeenCalled()
      expect(storage.settings.read).not.toHaveBeenCalled()
      expect(storage.settings.write).not.toHaveBeenCalled()
      expect(storage.credentials.status).not.toHaveBeenCalled()
      expect(storage.credentials.replace).not.toHaveBeenCalled()
      expect(storage.credentials.use).not.toHaveBeenCalled()
      expect(storage.credentials.remove).not.toHaveBeenCalled()
    } finally {
      await runtime.dispose()
    }
  })
})

async function composeRuntime(
  storage: ReturnType<typeof persistentStorage>,
  fetchImplementation: typeof fetch
) {
  const internalServices = inMemoryInternalServices()
  const packageSecrets: DomainMainPackageSecretStoreHost = Object.freeze({
    has: vi.fn(async () => false),
    read: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    providerCredentials: storage.credentials
  })
  const commonHost = Object.freeze({
    getUserDataDir: () => '/private/tmp/sciforge-opencontent-content-space-composed-test',
    defineCapability: (options: unknown) => options,
    internalServices
  })
  const connectorEntry = createOpenContentMainEntry(Object.freeze({
    ...commonHost,
    packageSettings: storage.settings,
    packageSecrets
  }), { fetch: fetchImplementation })
  const adapterEntry = createAdapterMainEntry(commonHost)
  const contentEntry = createContentSpaceMainEntry(commonHost)
  const lifecycle = runtimeContribution<DomainMainRuntimeLifecycleContribution>(
    contentEntry,
    CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION.id
  )
  const dispose = await lifecycle.activate({
    contributions: contributionHost(projectMainExtensions([
      connectorEntry,
      adapterEntry
    ]))
  } as unknown as Parameters<DomainMainRuntimeLifecycleContribution['activate']>[0])

  return Object.freeze({
    connectorDefinitions: capabilityDefinitions(
      connectorEntry,
      OPENCONTENT_CAPABILITY_FACTORY_CONTRIBUTION.id
    ),
    contentDefinitions: capabilityDefinitions(
      contentEntry,
      CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION.id
    ),
    internalServices,
    dispose: async () => {
      if (typeof dispose === 'function') await dispose()
    }
  })
}

function capabilityContext(invocationId: string) {
  return Object.freeze({
    caller: Object.freeze({
      audience: 'ui' as const,
      callerId: 'renderer:opencontent-content-space-composed-test',
      principal
    }),
    invocationId,
    signal: new AbortController().signal,
    assertPrincipalCurrent: () => undefined,
    issueResource: () => Object.freeze({})
  })
}

async function invoke<Value>(
  definitions: readonly CapabilityDefinition[],
  id: string,
  input: unknown,
  invocationId: string
): Promise<Value> {
  const definition = definitions.find((candidate) => candidate.id === id)
  if (!definition) throw new Error(`Missing capability ${id}.`)
  const { output } = await definition.handler(input, capabilityContext(invocationId))
  return output as Value
}

function capabilityDefinitions(
  entry: TrustedDomainProcessEntryInput<unknown>,
  contributionId: string
): readonly CapabilityDefinition[] {
  return runtimeContribution<Readonly<{
    createDefinitions(): readonly CapabilityDefinition[]
  }>>(entry, contributionId).createDefinitions()
}

function runtimeContribution<Value>(
  entry: TrustedDomainProcessEntryInput<unknown>,
  id: string
): Value {
  const contribution = entry.contributions.find((candidate) => candidate.id === id)
  if (!contribution) throw new Error(`Missing runtime contribution ${id}.`)
  return contribution.value as Value
}

function projectMainExtensions(
  entries: readonly TrustedDomainProcessEntryInput<unknown>[]
): readonly DomainMainContribution[] {
  return Object.freeze(entries.flatMap((entry) => {
    const declarations = entry.definition.entrypoints.find(({ process }) => process === 'main')
      ?.contributions
    if (!declarations) throw new Error(`${entry.definition.packageName} has no main entrypoint.`)
    return entry.contributions.flatMap((runtime) => {
      const declaration = declarations.find(({ id }) => id === runtime.id)
      if (!declaration || declaration.kind !== MAIN_EXTENSION_CONTRIBUTION_KIND) return []
      const contract = runtime.contract
      if (!contract) throw new Error(`Main extension ${runtime.id} has no contract.`)
      return [Object.freeze({
        id: runtime.id,
        kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
        packageName: entry.definition.packageName,
        owner: Object.freeze({
          moduleId: entry.definition.module.id,
          moduleVersion: entry.definition.module.version
        }),
        ...(declaration.version ? { version: declaration.version } : {}),
        contract,
        value: runtime.value
      })]
    })
  }))
}

function contributionHost(
  contributions: readonly DomainMainContribution[]
): DomainMainContributionHost {
  return Object.freeze({
    list: (kind) => kind === MAIN_EXTENSION_CONTRIBUTION_KIND ? contributions : []
  })
}

function persistentStorage() {
  const settings = inMemorySettings()
  const credentials = inMemoryCredentials()
  return Object.freeze({ settings, credentials })
}

function inMemorySettings(): DomainMainPackageSettingsHost & Readonly<{
  read: ReturnType<typeof vi.fn<DomainMainPackageSettingsHost['read']>>
  write: ReturnType<typeof vi.fn<DomainMainPackageSettingsHost['write']>>
  clear: ReturnType<typeof vi.fn<DomainMainPackageSettingsHost['clear']>>
}> {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
  const read = vi.fn<DomainMainPackageSettingsHost['read']>(async () => ({
    revision,
    value: value === null ? null : structuredClone(value)
  }))
  const write = vi.fn<DomainMainPackageSettingsHost['write']>(async (next, expectedRevision) => {
    if (expectedRevision !== revision) throw new Error('settings revision conflict')
    value = structuredClone(next)
    revision += 1
    return { revision, value: structuredClone(value) }
  })
  const clear = vi.fn<DomainMainPackageSettingsHost['clear']>(async (expectedRevision) => {
    if (expectedRevision !== revision) throw new Error('settings revision conflict')
    value = null
    revision += 1
    return { revision, value }
  })
  return Object.freeze({ read, write, clear })
}

function inMemoryCredentials(): DomainMainProviderCredentialStoreHost & Readonly<{
  status: ReturnType<typeof vi.fn<DomainMainProviderCredentialStoreHost['status']>>
  replace: ReturnType<typeof vi.fn<DomainMainProviderCredentialStoreHost['replace']>>
  use: DomainMainProviderCredentialStoreHost['use'] & ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn<DomainMainProviderCredentialStoreHost['remove']>>
}> {
  const values = new Map<string, string>()
  const key = (access: DomainMainProviderCredentialAccess) =>
    `${access.binding.providerInstanceRef}:${access.binding.connectionId}`
  const status = vi.fn<DomainMainProviderCredentialStoreHost['status']>(async (access) =>
    values.has(key(access))
      ? { state: 'available', recordVersion: 1 }
      : { state: 'absent' })
  const replace = vi.fn<DomainMainProviderCredentialStoreHost['replace']>(
    async (access, secret) => { values.set(key(access), secret) }
  )
  const use = vi.fn(async (
    access: DomainMainProviderCredentialAccess,
    operation: (secret: string) => unknown | Promise<unknown>
  ) => {
    const secret = values.get(key(access))
    if (!secret) {
      throw new DomainMainProviderCredentialError(
        'credential_unavailable',
        'The composed-test credential is unavailable.'
      )
    }
    return operation(secret)
  }) as unknown as DomainMainProviderCredentialStoreHost['use'] & ReturnType<typeof vi.fn>
  const remove = vi.fn<DomainMainProviderCredentialStoreHost['remove']>(
    async (access) => { values.delete(key(access)) }
  )
  return Object.freeze({ status, replace, use, remove })
}

function inMemoryInternalServices(): DomainMainInternalServiceHost & Readonly<{
  acquire: ReturnType<typeof vi.fn>
}> {
  const services = new Map<string, Readonly<{ contractVersion: string; service: object }>>()
  const register: DomainMainInternalServiceHost['register'] = (registration) => {
    services.set(registration.serviceId, {
      contractVersion: registration.contractVersion,
      service: registration.service
    })
  }
  const acquireImplementation = <Service extends object>(
    serviceId: string,
    contractVersion: string
  ): Service => {
    const registered = services.get(serviceId)
    if (!registered || registered.contractVersion !== contractVersion) {
      throw new Error(`Internal service ${serviceId} is unavailable.`)
    }
    return registered.service as Service
  }
  const acquire = vi.fn(acquireImplementation) as DomainMainInternalServiceHost['acquire'] &
    ReturnType<typeof vi.fn>
  return Object.freeze({ register, acquire })
}

function deterministicOpenContentTransport() {
  const requestedPaths: string[] = []
  const loginRequests: unknown[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    expect(url.origin).toBe(TRUSTED_ORIGIN)
    requestedPaths.push(url.pathname)

    if (url.pathname === '/inbiz/org/api/auth/GetLoginRsaPublicKey') {
      return jsonResponse({
        result: 0,
        message: null,
        data: {
          PublicKey: publicKeyPem,
          Algorithm: 'RSA',
          Padding: 'OAEP-SHA256'
        },
        totalCount: 0
      })
    }
    if (url.pathname === '/flatsdk/api/services/Auth/UserLogin') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      loginRequests.push(body)
      expect(body).toMatchObject({ clientType: 4, secure: false, rsaSecure: true })
      expect(body.userName).not.toBe('fixture-scientist')
      expect(body.password).not.toBe(PASSWORD_CANARY)
      return jsonResponse({ result: 0, msg: '', data: TOKEN_CANARY, clientId: null })
    }
    if (url.pathname === '/flatsdk/api/services/Auth/CheckUserTokenValidity') {
      expect(url.searchParams.get('token')).toBe(TOKEN_CANARY)
      return jsonResponse({ result: 0, msg: '', data: true })
    }
    if (url.pathname === '/flatsdk/api/services/User/GetUserInfoByToken') {
      expect(JSON.parse(String(init?.body))).toEqual({ token: TOKEN_CANARY })
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          id: 'opencontent-user-guid',
          identityId: 42,
          account: 'fixture-scientist',
          name: 'Fixture Scientist',
          topPersonalFolderId: 1001
        }
      })
    }
    if (url.pathname === '/flatsdk/api/services/User/GetTopPersonalFolderId') {
      expect(JSON.parse(String(init?.body))).toEqual({ token: TOKEN_CANARY })
      return jsonResponse({ result: 0, msg: '', data: '1001' })
    }
    if (url.pathname === '/flatsdk/api/services/Team/GetMyTeamList') {
      expect(JSON.parse(String(init?.body))).toEqual({
        token: TOKEN_CANARY,
        pageNum: 1,
        pageSize: 20,
        sortName: 'team_name',
        teamType: 0,
        desc: false,
        keyWord: ''
      })
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          pageNum: 1,
          pageSize: 20,
          totalCount: 1,
          teamList: [{
            teamId: 19,
            folderId: 2213,
            teamName: 'SciForge Research',
            teamStatus: 1,
            teamOwner: 42,
            permission: 7,
            teamType: 0,
            isStick: false
          }],
          sortName: 'team_name',
          sortDesc: 'false'
        }
      })
    }
    if (url.pathname === '/flatsdk/api/services/DocList/GetFolderInfoById') {
      const body = JSON.parse(String(init?.body)) as { token: string; folderId: number }
      expect(body.token).toBe(TOKEN_CANARY)
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          id: body.folderId,
          folderGuid: body.folderId === 1001 ? 'personal-folder-guid' : 'team-folder-guid',
          parentFolderId: 0,
          folderType: body.folderId === 1001 ? 1 : 2,
          teamId: body.folderId === 1001 ? 0 : 19,
          permission: 7,
          childFolderCount: 0,
          childFileCount: 0
        }
      })
    }
    throw new Error(`Unexpected OpenContent test request path: ${url.pathname}`)
  })

  return Object.freeze({ fetch: fetch as typeof fetch, requestedPaths, loginRequests })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function expectSafePublicOutput(output: unknown): void {
  const serialized = JSON.stringify(output)
  expect(serialized).not.toContain(PASSWORD_CANARY)
  expect(serialized).not.toContain(TOKEN_CANARY)
  expect(serialized).not.toContain(TRUSTED_ORIGIN)
  expect(serialized).not.toMatch(/"(?:connectionId|endpoint|password|token)"/iu)
}

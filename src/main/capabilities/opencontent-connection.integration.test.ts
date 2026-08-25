import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { DomainMainHost, DomainMainInternalServiceHost } from '@sciforge/domain-sdk/host'
import type {
  DomainMainPackageSecretStoreHost,
  DomainMainPackageSettingsHost,
  DomainMainProviderCredentialAccess,
  DomainMainProviderCredentialStoreHost
} from '@sciforge/domain-sdk/package-storage'
import {
  OPENCONTENT_CONNECTION_CAPABILITY_IDS
} from '@sciforge/domain-opencontent-connector/contract'
import { createDomainMainEntry } from '@sciforge/domain-opencontent-connector/main'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import type { CapabilityCallerContextInput } from '../../shared/capability-broker'
import { CapabilityBroker } from './broker'
import {
  CapabilityRegistry,
  defineCapability,
  type CapabilityDefinition
} from './registry'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'opencontent-edoc2-demo'
const TRUSTED_ORIGIN = 'https://tenant.example'
const PASSWORD_CANARY = 'password-canary-do-not-return'
const TOKEN_CANARY = 'opaque-token-canary-do-not-return'
const PROVIDER_MESSAGE_CANARY = 'raw-provider-message-canary-do-not-return'
const STACK_CANARY = 'stack-canary-do-not-return'

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'opencontent-integration-user',
  assurance: 'local-selection' as const,
  deviceId: 'opencontent-integration-device',
  identityVersion: 7
})

const caller: CapabilityCallerContextInput = Object.freeze({
  audience: 'ui' as const,
  callerId: 'opencontent-integration-window'
})

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const deploymentRoot = mkdtempSync(join(tmpdir(), 'sciforge-opencontent-host-integration-'))
const deploymentPath = join(
  deploymentRoot,
  '.sciforge/private/deployments/opencontent-connector.json'
)
mkdirSync(dirname(deploymentPath), { recursive: true })
writeFileSync(deploymentPath, JSON.stringify({
  contractVersion: 1,
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  origin: TRUSTED_ORIGIN
}), 'utf8')
afterAll(() => rmSync(deploymentRoot, { recursive: true, force: true }))
afterEach(() => vi.unstubAllGlobals())

describe('OpenContent connection through the Host capability Broker', () => {
  it('binds and reads status through the package-owned deployment sidecar', async () => {
    const requests: Array<Readonly<{ origin: string; path: string; method: string }>> = []
    const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input)
      requests.push({
        origin: url.origin,
        path: url.pathname,
        method: requestMethod(input, init)
      })
      expect(url.origin).toBe(TRUSTED_ORIGIN)

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
        expect(body).toMatchObject({ clientType: 4, secure: false, rsaSecure: true })
        expect(body.userName).not.toBe('fixture-scientist')
        expect(body.password).not.toBe(PASSWORD_CANARY)
        return jsonResponse({
          result: 0,
          msg: '',
          data: TOKEN_CANARY,
          clientId: null
        })
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
            topPersonalFolderId: 2213
          }
        })
      }
      throw new Error(`Unexpected OpenContent test request path: ${url.pathname}`)
    })
    const harness = createHarness(fakeFetch as typeof fetch)
    const bound = await harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      invocationId: 'opencontent-bind-success',
      input: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        username: 'fixture-scientist',
        password: PASSWORD_CANARY
      }
    })

    expect(bound.output).toEqual({
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
    expectNoSensitiveOutput(bound.output)

    const status = await harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.status,
      input: { providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF }
    })
    expect(status.output).toEqual(bound.output)
    expectNoSensitiveOutput(status.output)
    expect(requests).toEqual([
      {
        origin: TRUSTED_ORIGIN,
        path: '/inbiz/org/api/auth/GetLoginRsaPublicKey',
        method: 'GET'
      },
      {
        origin: TRUSTED_ORIGIN,
        path: '/flatsdk/api/services/Auth/UserLogin',
        method: 'POST'
      },
      {
        origin: TRUSTED_ORIGIN,
        path: '/flatsdk/api/services/Auth/CheckUserTokenValidity',
        method: 'POST'
      },
      {
        origin: TRUSTED_ORIGIN,
        path: '/flatsdk/api/services/User/GetUserInfoByToken',
        method: 'POST'
      },
      {
        origin: TRUSTED_ORIGIN,
        path: '/flatsdk/api/services/Auth/CheckUserTokenValidity',
        method: 'POST'
      }
    ])
  })

  it('resolves Provider authentication failure as a typed result instead of a Broker handler failure', async () => {
    const fakeFetch = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input)
      expect(url.origin).toBe(TRUSTED_ORIGIN)
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
        return jsonResponse({
          result: 401,
          msg: `${PROVIDER_MESSAGE_CANARY}:${STACK_CANARY}`,
          data: TOKEN_CANARY,
          clientId: null
        })
      }
      throw new Error(`Unexpected OpenContent test request path: ${url.pathname}`)
    })
    const harness = createHarness(fakeFetch as typeof fetch)

    const result = await harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      invocationId: 'opencontent-bind-invalid-credentials',
      input: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        username: 'fixture-scientist',
        password: PASSWORD_CANARY
      }
    })

    expect(result.output).toEqual({
      outcome: 'error',
      error: {
        code: 'invalid_credentials',
        action: 'check_credentials'
      }
    })
    expectNoSensitiveOutput(result.output)
    expect(fakeFetch).toHaveBeenCalledTimes(2)
    expect(harness.settings.write).not.toHaveBeenCalled()
    expect(harness.credentials.replace).not.toHaveBeenCalled()
  })

  it('returns an invalid Provider Instance before fetch, settings, or credential access', async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error('fetch must not run for an unknown Provider Instance')
    })
    const harness = createHarness(fakeFetch as typeof fetch)

    const result = await harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      invocationId: 'opencontent-bind-wrong-provider',
      input: {
        providerInstanceRef: 'opencontent-unknown-provider',
        username: 'fixture-scientist',
        password: PASSWORD_CANARY
      }
    })

    expect(result.output).toEqual({
      outcome: 'error',
      error: {
        code: 'invalid_provider_instance',
        action: 'select_provider'
      }
    })
    expectNoSensitiveOutput(result.output)
    expect(fakeFetch).not.toHaveBeenCalled()
    expect(harness.settings.read).not.toHaveBeenCalled()
    expect(harness.settings.write).not.toHaveBeenCalled()
    expect(harness.settings.clear).not.toHaveBeenCalled()
    expect(harness.credentials.status).not.toHaveBeenCalled()
    expect(harness.credentials.replace).not.toHaveBeenCalled()
    expect(harness.credentials.use).not.toHaveBeenCalled()
    expect(harness.credentials.remove).not.toHaveBeenCalled()
  })
})

function createHarness(fetchImplementation: typeof fetch) {
  vi.stubGlobal('fetch', fetchImplementation)
  const settings = inMemorySettings()
  const credentials = inMemoryCredentials()
  const services = inMemoryInternalServices()
  const packageSecrets: DomainMainPackageSecretStoreHost = Object.freeze({
    has: vi.fn(async () => false),
    read: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    providerCredentials: credentials
  })
  const host: DomainMainHost = Object.freeze({
    getUserDataDir: () => '/opencontent-integration-user-data',
    getAppRoot: () => deploymentRoot,
    isPackaged: () => false,
    defineCapability: (options: unknown) => defineCapability(options as never),
    packageSettings: settings,
    packageSecrets,
    internalServices: services
  })
  const entry = createDomainMainEntry(host)
  const factory: unknown = entry.contributions
    .find((contribution) => contribution.kind === 'main.capability-factory')
    ?.value
  if (!hasCapabilityDefinitions(factory)) {
    throw new Error('OpenContent capability factory is missing from its main entry.')
  }
  const registry = new CapabilityRegistry(factory.createDefinitions())
  const broker = new CapabilityBroker(registry, {
    resolveCurrentPrincipal: () => principal
  })
  return { broker, settings, credentials }
}

function hasCapabilityDefinitions(value: unknown): value is Readonly<{
  createDefinitions(): readonly CapabilityDefinition[]
}> {
  return typeof value === 'object' && value !== null &&
    'createDefinitions' in value && typeof value.createDefinitions === 'function'
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

function inMemoryCredentials(): DomainMainProviderCredentialStoreHost {
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
      if (!secret) throw new Error('credential unavailable')
      return operation(secret)
    }) as unknown as DomainMainProviderCredentialStoreHost['use']
  const remove = vi.fn<DomainMainProviderCredentialStoreHost['remove']>(
    async (access) => { values.delete(key(access)) }
  )
  return Object.freeze({ status, replace, use, remove })
}

function inMemoryInternalServices(): DomainMainInternalServiceHost {
  const services = new Map<string, Readonly<{ contractVersion: string; service: object }>>()
  return Object.freeze({
    register: (registration) => {
      services.set(registration.serviceId, {
        contractVersion: registration.contractVersion,
        service: registration.service
      })
    },
    acquire: <Service extends object>(serviceId: string, contractVersion: string): Service => {
      const registered = services.get(serviceId)
      if (!registered || registered.contractVersion !== contractVersion) {
        throw new Error(`Internal service ${serviceId} is unavailable.`)
      }
      return registered.service as Service
    }
  })
}

function requestUrl(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : String(input))
}

function requestMethod(input: string | URL | Request, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function expectNoSensitiveOutput(output: unknown): void {
  const serialized = JSON.stringify(output)
  expect(serialized).not.toContain(PASSWORD_CANARY)
  expect(serialized).not.toContain(TOKEN_CANARY)
  expect(serialized).not.toContain(TRUSTED_ORIGIN)
  expect(serialized).not.toContain(PROVIDER_MESSAGE_CANARY)
  expect(serialized).not.toContain(STACK_CANARY)
  expect(serialized).not.toMatch(/"(?:password|token|endpoint|stack)"/iu)
}

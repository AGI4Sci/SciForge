import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inspect } from 'node:util'

import type { DomainMainHost, DomainMainInternalServiceHost } from '@sciforge/domain-sdk/host'
import { DomainMainProviderCredentialError } from '@sciforge/domain-sdk/package-storage'
import type {
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
const ACCOUNT_CANARY = 'account-canary-must-not-be-retained@example.test'
const PASSWORD_CANARY = 'password-canary-must-not-be-retained'
const SESSION_TOKEN_CANARY = 'session-token-canary-only-for-encrypted-host-storage'

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'opencontent-integration-user',
  assurance: 'local-selection' as const,
  deviceId: 'opencontent-integration-device',
  identityVersion: 7
})
const otherPrincipal = Object.freeze({
  ...principal,
  subject: 'opencontent-other-integration-user',
  identityVersion: 8
})

const caller: CapabilityCallerContextInput = Object.freeze({
  audience: 'ui' as const,
  callerId: 'opencontent-integration-window'
})

const applicationRoot = mkdtempSync(join(tmpdir(), 'sciforge-opencontent-host-integration-'))
const deploymentPath = join(
  applicationRoot,
  'packages/domains/opencontent-connector/config/opencontent-connector.json'
)
mkdirSync(dirname(deploymentPath), { recursive: true })
writeFileSync(deploymentPath, JSON.stringify({
  contractVersion: 1,
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  origin: 'https://opencontent.integration.test'
}), 'utf8')

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const enrollmentPublicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString()

afterAll(() => rmSync(applicationRoot, { recursive: true, force: true }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OpenContent connection through the Host capability Broker', () => {
  it.each(['win32', 'darwin'] as const)(
    'binds under a simulated %s contract through the UI-only sensitive capability and retains only the Session Token',
    async (platform) => {
      const fetchImplementation = enrollmentFetch(
        `${ACCOUNT_CANARY}:${PASSWORD_CANARY}:${SESSION_TOKEN_CANARY}`
      )
      vi.stubGlobal('fetch', fetchImplementation)
      const logSpies = captureConsoleSinks()

      const { harness, result, replay } = await withPlatform(platform, async () => {
        const harness = createHarness()
        const request = {
          actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
          invocationId: `opencontent-sensitive-bind-${platform}`,
          input: {
            providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
            account: ACCOUNT_CANARY,
            password: PASSWORD_CANARY
          }
        } as const
        const result = await harness.broker.invoke(caller, request)
        const replay = await harness.broker.invoke(caller, request)
        return { harness, result, replay }
      })

      expect(result.output).toMatchObject({
        outcome: 'success',
        status: {
          state: 'connected',
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
        }
      })
      expect(replay.replayed).toBe(true)
      expect(harness.credentials.replace).toHaveBeenCalledOnce()
      expect(fetchImplementation).toHaveBeenCalledTimes(4)

      const [credentialAccess, storedSecret] = harness.credentials.replace.mock.calls[0]!
      expect(storedSecret).toBe(SESSION_TOKEN_CANARY)
      expect(credentialAccess).toEqual({
        binding: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          connectionId: expect.any(String)
        },
        expectedPrincipal: principal
      })
      expect(harness.credentials.inspect()).toEqual({
        access: credentialAccess,
        secret: SESSION_TOKEN_CANARY
      })
      expect(JSON.stringify(harness.credentials.replace.mock.calls)).not.toContain(ACCOUNT_CANARY)
      expect(JSON.stringify(harness.credentials.replace.mock.calls)).not.toContain(PASSWORD_CANARY)

      expectRetainedSurfacesNotToContainSecrets([
        ['Broker result/receipt', result],
        ['Broker replay result/receipt', replay],
        ['Broker audit', harness.broker.listAuditRecords()],
        ['package settings writes', harness.settings.write.mock.calls],
        ['console/log sinks', logSpies.flatMap((spy) => spy.mock.calls)]
      ])
      expect(credentialAccess.binding.connectionId).toBe('opencontent-session')
      expect(harness.settings.read).not.toHaveBeenCalled()
      expect(harness.settings.write).not.toHaveBeenCalled()
      expect(harness.settings.clear).not.toHaveBeenCalled()
      expectGenericPackageSecretsUnused(harness.packageSecrets)
    }
  )

  it('binds the Session through the Host credential port and restores it only for that Principal', async () => {
    const fetchImplementation = enrollmentFetch()
    vi.stubGlobal('fetch', fetchImplementation)
    const logSpies = captureConsoleSinks()
    const harness = createHarness()

    await harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      invocationId: 'opencontent-principal-bound-session',
      input: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        account: ACCOUNT_CANARY,
        password: PASSWORD_CANARY
      }
    })

    harness.setCurrentPrincipal(otherPrincipal)
    const otherStatus = await harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.status,
      input: { providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF }
    })
    expect(otherStatus.output).toEqual({
      outcome: 'success',
      status: { state: 'disconnected' }
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(4)

    harness.setCurrentPrincipal(principal)
    const restoredStatus = await harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.status,
      input: { providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF }
    })
    expect(restoredStatus.output).toMatchObject({
      outcome: 'success',
      status: {
        state: 'connected',
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
      }
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(6)
    expect(harness.credentials.use).toHaveBeenCalledOnce()
    expect(harness.settings.read).not.toHaveBeenCalled()
    expect(harness.settings.write).not.toHaveBeenCalled()
    expect(harness.settings.clear).not.toHaveBeenCalled()
    expectGenericPackageSecretsUnused(harness.packageSecrets)
    expectRetainedSurfacesNotToContainSecrets([
      ['other Principal result/receipt', otherStatus],
      ['restored Principal result/receipt', restoredStatus],
      ['Broker audit', harness.broker.listAuditRecords()],
      ['console/log sinks', logSpies.flatMap((spy) => spy.mock.calls)]
    ])
  })

  it('returns a bounded secret-free conflict while another sensitive enrollment is active', async () => {
    const enrollmentStarted = deferred<void>()
    const releaseEnrollment = deferred<void>()
    const baseFetch = enrollmentFetch()
    const fetchImplementation = vi.fn(async (
      rawUrl: string | URL | Request,
      init?: RequestInit
    ) => {
      const url = new URL(typeof rawUrl === 'string' ? rawUrl : rawUrl.toString())
      if (url.pathname === '/inbiz/org/api/auth/GetLoginRsaPublicKey') {
        enrollmentStarted.resolve()
        await releaseEnrollment.promise
      }
      return baseFetch(rawUrl, init)
    })
    vi.stubGlobal('fetch', fetchImplementation)
    const logSpies = captureConsoleSinks()
    const harness = createHarness()
    const input = {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      account: ACCOUNT_CANARY,
      password: PASSWORD_CANARY
    } as const

    const active = harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      invocationId: 'opencontent-active-sensitive-bind',
      input
    })
    await enrollmentStarted.promise

    const conflict = await harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      invocationId: 'opencontent-conflicting-sensitive-bind',
      input
    })
    expect(conflict.output).toEqual({
      outcome: 'error',
      error: {
        code: 'enrollment_in_progress',
        action: 'retry'
      }
    })
    expect(harness.credentials.replace).not.toHaveBeenCalled()

    releaseEnrollment.resolve()
    const completed = await active
    expect(completed.output).toMatchObject({
      outcome: 'success',
      status: {
        state: 'connected',
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
      }
    })
    expect(harness.credentials.replace).toHaveBeenCalledOnce()
    expect(fetchImplementation).toHaveBeenCalledTimes(4)
    expect(harness.settings.read).not.toHaveBeenCalled()
    expect(harness.settings.write).not.toHaveBeenCalled()
    expect(harness.settings.clear).not.toHaveBeenCalled()
    expectGenericPackageSecretsUnused(harness.packageSecrets)
    expectRetainedSurfacesNotToContainSecrets([
      ['conflict result/receipt', conflict],
      ['completed result/receipt', completed],
      ['Broker audit', harness.broker.listAuditRecords()],
      ['console/log sinks', logSpies.flatMap((spy) => spy.mock.calls)]
    ])
  })

  it('keeps enrollment unavailable to Agent callers before Provider HTTP or Host storage', async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error('Provider HTTP must not receive an Agent enrollment request.')
    })
    vi.stubGlobal('fetch', fetchImplementation)
    const harness = createHarness()

    await expect(harness.broker.invoke({
      audience: 'agent',
      callerId: 'opencontent-integration-agent'
    }, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      invocationId: 'opencontent-agent-bind-denied',
      input: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        account: ACCOUNT_CANARY,
        password: PASSWORD_CANARY
      }
    })).rejects.toMatchObject({ code: 'audience_denied' })

    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(harness.credentials.replace).not.toHaveBeenCalled()
    expect(harness.settings.read).not.toHaveBeenCalled()
    expect(harness.settings.write).not.toHaveBeenCalled()
    expectRetainedSurfacesNotToContainSecrets([
      ['Broker audit', harness.broker.listAuditRecords()]
    ])
  })

  it('returns an invalid Provider Instance before enrollment or settings access', async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error('Provider HTTP must not receive an invalid Provider Instance.')
    })
    vi.stubGlobal('fetch', fetchImplementation)
    const harness = createHarness()
    const result = await harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      invocationId: 'opencontent-bind-wrong-provider',
      input: {
        providerInstanceRef: 'opencontent-unknown-provider',
        account: ACCOUNT_CANARY,
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
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(harness.credentials.replace).not.toHaveBeenCalled()
    expect(harness.settings.read).not.toHaveBeenCalled()
    expect(harness.settings.write).not.toHaveBeenCalled()
    expect(harness.settings.clear).not.toHaveBeenCalled()
    expectRetainedSurfacesNotToContainSecrets([
      ['Broker result/receipt', result],
      ['Broker audit', harness.broker.listAuditRecords()]
    ])
  })
})

function createHarness() {
  let currentPrincipal: typeof principal | typeof otherPrincipal = principal
  const settings = inMemorySettings()
  const credentials = inMemoryProviderCredentials(() => currentPrincipal)
  const packageSecrets = Object.freeze({
    has: vi.fn(async () => false),
    read: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    providerCredentials: credentials.store
  })
  const host: DomainMainHost = Object.freeze({
    getUserDataDir: () => '/opencontent-integration-user-data',
    getAppRoot: () => applicationRoot,
    isPackaged: () => false,
    defineCapability: (options: unknown) => defineCapability(options as never),
    packageSettings: settings,
    packageSecrets,
    internalServices: inMemoryInternalServices()
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
    resolveCurrentPrincipal: () => currentPrincipal
  })
  return {
    broker,
    settings,
    credentials,
    packageSecrets,
    setCurrentPrincipal: (next: typeof principal | typeof otherPrincipal) => {
      currentPrincipal = next
    }
  }
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

function inMemoryProviderCredentials(
  resolveCurrentPrincipal: () => typeof principal | typeof otherPrincipal
): Readonly<{
  store: DomainMainProviderCredentialStoreHost
  replace: ReturnType<typeof vi.fn<DomainMainProviderCredentialStoreHost['replace']>>
  use: DomainMainProviderCredentialStoreHost['use'] & ReturnType<typeof vi.fn>
  inspect(): Readonly<{
    access: DomainMainProviderCredentialAccess
    secret: string
  }> | undefined
}> {
  let stored: Readonly<{
    principal: typeof principal | typeof otherPrincipal
    access: DomainMainProviderCredentialAccess
    secret: string
  }> | undefined
  const sameAccess = (
    left: DomainMainProviderCredentialAccess,
    right: DomainMainProviderCredentialAccess
  ) => JSON.stringify(left.binding) === JSON.stringify(right.binding)
  const samePrincipal = (
    left: typeof principal | typeof otherPrincipal,
    right: typeof principal | typeof otherPrincipal
  ) => left.authority === right.authority &&
    left.subject === right.subject &&
    left.assurance === right.assurance &&
    left.deviceId === right.deviceId
  const assertExpectedPrincipal = (access: DomainMainProviderCredentialAccess) => {
    if (JSON.stringify(access.expectedPrincipal) !== JSON.stringify(resolveCurrentPrincipal())) {
      throw new DomainMainProviderCredentialError(
        'credential_binding_mismatch',
        'Synthetic expected Principal does not match the current Principal.'
      )
    }
  }
  const status = vi.fn<DomainMainProviderCredentialStoreHost['status']>(async (access, options) => {
    options?.signal?.throwIfAborted()
    assertExpectedPrincipal(access)
    return stored && samePrincipal(stored.principal, resolveCurrentPrincipal()) &&
      sameAccess(stored.access, access)
      ? { state: 'available' as const, recordVersion: 1 as const }
      : { state: 'absent' as const }
  })
  const replace = vi.fn<DomainMainProviderCredentialStoreHost['replace']>(async (
    access,
    secret,
    options
  ) => {
    options?.signal?.throwIfAborted()
    assertExpectedPrincipal(access)
    stored = Object.freeze({
      principal: structuredClone(resolveCurrentPrincipal()),
      access: structuredClone(access),
      secret
    })
  })
  const use = vi.fn(async <T>(
    access: DomainMainProviderCredentialAccess,
    operation: (secret: string) => T | Promise<T>,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<T> => {
    options?.signal?.throwIfAborted()
    assertExpectedPrincipal(access)
    if (!stored || !samePrincipal(stored.principal, resolveCurrentPrincipal()) ||
      !sameAccess(stored.access, access)) {
      throw new Error('Synthetic provider credential is unavailable.')
    }
    return operation(stored.secret)
  }) as DomainMainProviderCredentialStoreHost['use'] & ReturnType<typeof vi.fn>
  const remove = vi.fn<DomainMainProviderCredentialStoreHost['remove']>(async (access, options) => {
    options?.signal?.throwIfAborted()
    assertExpectedPrincipal(access)
    if (stored && samePrincipal(stored.principal, resolveCurrentPrincipal()) &&
      sameAccess(stored.access, access)) stored = undefined
  })
  return Object.freeze({
    store: Object.freeze({ status, replace, use, remove }),
    replace,
    use,
    inspect: () => stored === undefined
      ? undefined
      : Object.freeze({ access: structuredClone(stored.access), secret: stored.secret })
  })
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

function enrollmentFetch(displayName = 'OpenContent Fixture Scientist') {
  return vi.fn(async (rawUrl: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof rawUrl === 'string' ? rawUrl : rawUrl.toString())
    expect(url.origin).toBe('https://opencontent.integration.test')
    if (url.pathname === '/inbiz/org/api/auth/GetLoginRsaPublicKey') {
      return jsonResponse({
        result: 0,
        message: null,
        data: {
          PublicKey: enrollmentPublicKey,
          Algorithm: 'RSA',
          Padding: 'OAEP-SHA256'
        },
        totalCount: 0
      })
    }
    if (url.pathname === '/flatsdk/api/services/Auth/UserLogin') {
      const rawBody = String(init?.body)
      expect(rawBody).not.toContain(ACCOUNT_CANARY)
      expect(rawBody).not.toContain(PASSWORD_CANARY)
      return jsonResponse({
        result: 0,
        msg: '',
        data: SESSION_TOKEN_CANARY,
        clientId: null
      })
    }
    if (url.pathname === '/flatsdk/api/services/Auth/CheckUserTokenValidity') {
      expect(url.searchParams.get('token')).toBe(SESSION_TOKEN_CANARY)
      return jsonResponse({ result: 0, msg: '', data: true })
    }
    if (url.pathname === '/flatsdk/api/services/User/GetUserInfoByToken') {
      expect(JSON.parse(String(init?.body))).toEqual({ token: SESSION_TOKEN_CANARY })
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          id: 'opencontent-external-id',
          identityId: 314159,
          account: ACCOUNT_CANARY,
          name: displayName,
          topPersonalFolderId: 271828
        }
      })
    }
    throw new Error(`Unexpected OpenContent request: ${url.pathname}`)
  })
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function captureConsoleSinks() {
  return [
    vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'trace').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  ]
}

function expectRetainedSurfacesNotToContainSecrets(
  surfaces: readonly (readonly [name: string, value: unknown])[]
): void {
  for (const [name, value] of surfaces) {
    const serialized = `${JSON.stringify(value)}\n${inspect(value, {
      colors: false,
      depth: 20,
      getters: false
    })}`
    expect(serialized, `${name} retained the enrollment account`).not.toContain(ACCOUNT_CANARY)
    expect(serialized, `${name} retained the enrollment password`).not.toContain(PASSWORD_CANARY)
    expect(serialized, `${name} retained the Session Token`).not.toContain(SESSION_TOKEN_CANARY)
  }
}

function expectGenericPackageSecretsUnused(input: Readonly<{
  has: ReturnType<typeof vi.fn>
  read: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}>): void {
  expect(input.has).not.toHaveBeenCalled()
  expect(input.read).not.toHaveBeenCalled()
  expect(input.write).not.toHaveBeenCalled()
  expect(input.remove).not.toHaveBeenCalled()
}

async function withPlatform<T>(
  platform: 'win32' | 'darwin',
  operation: () => Promise<T>
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  if (!descriptor) throw new Error('Node.js process.platform is unavailable.')
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform })
  try {
    return await operation()
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

function deferred<T>(): Readonly<{
  promise: Promise<T>
  resolve(value: T): void
}> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return Object.freeze({ promise, resolve })
}

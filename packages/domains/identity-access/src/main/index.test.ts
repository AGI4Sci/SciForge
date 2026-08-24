import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION,
  AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
  type AuthenticatedCloudTransport
} from '../authenticated-cloud-transport.js'
import {
  IDENTITY_CAPABILITY_IDS,
  IDENTITY_RESET_CONFIRMATION
} from '../contract.js'
import {
  createDomainMainEntry,
  createIdentityCapabilityFactory,
  type IdentityCapabilityOptions
} from './index.js'
import { CloudIdentityRuntime } from './cloud-runtime.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Identity main contributions', () => {
  it('publishes the token-free authenticated Cloud transport through Host mediation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-transport-'))
    roots.push(root)
    const registered = new Map<string, object>()
    const register = vi.fn((registration: Readonly<{
      serviceId: string
      contractVersion: string
      service: object
    }>) => {
      registered.set(`${registration.serviceId}@${registration.contractVersion}`, registration.service)
    })
    const entry = createDomainMainEntry({
      getUserDataDir: () => root,
      getDeviceId: () => 'device-1',
      packageSecrets: memorySecrets(),
      internalServices: {
        register: register as never,
        acquire: vi.fn() as never
      },
      defineCapability: (definition) => definition
    })

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
      contractVersion: AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION,
      allowedConsumerModuleIds: ['sciforge.collaboration', 'sciforge.project-coordinator']
    }))
    expect(entry.contributions[3]).toMatchObject({
      id: 'identity-access.authenticated-cloud-transport',
      kind: 'main.extension',
      contract: {
        location: 'main.internal-service-descriptor',
        serviceId: AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
        contractVersion: AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION,
        allowedConsumerModuleIds: ['sciforge.collaboration', 'sciforge.project-coordinator']
      }
    })
    const transport = registered.get(
      `${AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID}@${AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION}`
    ) as AuthenticatedCloudTransport
    expect(transport.status()).toEqual({
      state: 'unavailable',
      reason: 'Cloud identity runtime is not active.'
    })
    await expect(transport.execute({
      contractVersion: 1,
      operationId: 'sciforge.cloud.command',
      payload: {}
    })).rejects.toMatchObject({ code: 'transport_unavailable' })
  })

  it('declares one UI-only global capability set with governed mutation policies', () => {
    const definitions = createIdentityCapabilityFactory({
      defineCapability: (definition) => definition,
      getService: () => ({}) as never,
      getCloudRuntime: () => ({}) as never
    }).createDefinitions() as IdentityCapabilityOptions[]
    expect(definitions.map((definition) => definition.id)).toEqual(Object.values(IDENTITY_CAPABILITY_IDS))
    for (const definition of definitions) {
      expect(definition.audiences).toEqual(['ui'])
      expect(definition.scope).toBe('global')
      expect(definition.concurrency.idempotency).toBe(
        definition.effect === 'read' ? 'none' : 'required'
      )
    }
    expect(definitions.find(({ id }) => id === IDENTITY_CAPABILITY_IDS.backupAndReset))
      .toMatchObject({ effect: 'destructive', approval: 'confirmation' })
    expect(definitions.filter((definition) => (
      definition.principalTransition === 'host-authority'
    )).map(({ id }) => id)).toEqual([
      IDENTITY_CAPABILITY_IDS.createAccount,
      IDENTITY_CAPABILITY_IDS.selectAccount,
      IDENTITY_CAPABILITY_IDS.exitAccount,
      IDENTITY_CAPABILITY_IDS.backupAndReset,
      IDENTITY_CAPABILITY_IDS.cloudLogin,
      IDENTITY_CAPABILITY_IDS.cloudReauthenticate,
      IDENTITY_CAPABILITY_IDS.cloudLogout,
      IDENTITY_CAPABILITY_IDS.cloudEnrollDevice,
      IDENTITY_CAPABILITY_IDS.cloudRefreshDevices,
      IDENTITY_CAPABILITY_IDS.cloudRevokeDevice
    ])
  })

  it('shares one lazy service between capabilities and Principal provider and rejects Agent calls', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-main-'))
    roots.push(root)
    const entry = createDomainMainEntry({
      getUserDataDir: () => root,
      getDeviceId: () => 'device-1',
      packageSecrets: memorySecrets(),
      internalServices: memoryInternalServices(),
      defineCapability: (definition) => definition
    })
    const factory = entry.contributions[0]!.value as ReturnType<typeof createIdentityCapabilityFactory>
    const provider = entry.contributions[1]!.value as { current(): unknown }
    expect(provider.current()).toBeUndefined()
    const definitions = factory.createDefinitions() as unknown as IdentityCapabilityOptions[]
    const create = definitions.find(({ id }) => id === IDENTITY_CAPABILITY_IDS.createAccount)!
    expect(() => create.handler({ username: 'Alice' }, {
      caller: { audience: 'agent' },
      assertPrincipalCurrent: vi.fn()
    }))
      .toThrow('trusted Human UI')
    const created = await create.handler({ username: 'Alice' }, {
      caller: { audience: 'ui' },
      assertPrincipalCurrent: vi.fn(() => {
        throw codedError('principal_changed')
      })
    })
    expect(created.output).toMatchObject({ currentAccount: { username: 'Alice' } })
    expect(created).not.toHaveProperty('changed')
    expect(provider.current()).toMatchObject({
      authority: 'sciforge.identity-access',
      subject: (created.output as { currentAccount: { userId: string } }).currentAccount.userId,
      assurance: 'local-selection',
      deviceId: 'device-1'
    })
    const reset = definitions.find(({ id }) => id === IDENTITY_CAPABILITY_IDS.backupAndReset)!
    expect(reset.inputSchema.safeParse({ secondConfirmation: IDENTITY_RESET_CONFIRMATION }).success).toBe(true)
    entry.contributions[0]!.onDispose?.()
    entry.contributions[1]!.onDispose?.()
  })

  it('acknowledges only committed Host Principal transitions and keeps no-op repeats valid', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-transition-'))
    roots.push(root)
    const entry = createDomainMainEntry({
      getUserDataDir: () => root,
      getDeviceId: () => 'device-1',
      packageSecrets: memorySecrets(),
      internalServices: memoryInternalServices(),
      defineCapability: (definition) => definition
    })
    const factory = entry.contributions[0]!.value as ReturnType<typeof createIdentityCapabilityFactory>
    const provider = entry.contributions[1]!.value as {
      current(): { subject: string; identityVersion: number } | undefined
    }
    const definitions = factory.createDefinitions() as unknown as IdentityCapabilityOptions[]
    const definition = (id: string): IdentityCapabilityOptions =>
      definitions.find((candidate) => candidate.id === id)!
    const transitionContext = (
      verifyCommittedPrincipal: () => void
    ): Parameters<IdentityCapabilityOptions['handler']>[1] => ({
      caller: { audience: 'ui' },
      assertPrincipalCurrent: vi.fn(() => {
        verifyCommittedPrincipal()
        throw codedError('principal_changed')
      })
    })

    const create = definition(IDENTITY_CAPABILITY_IDS.createAccount)
    const select = definition(IDENTITY_CAPABILITY_IDS.selectAccount)
    const exit = definition(IDENTITY_CAPABILITY_IDS.exitAccount)

    const aliceResult = await create.handler(
      { username: 'Alice' },
      transitionContext(() => expect(provider.current()?.subject).toEqual(expect.any(String)))
    )
    const alice = (aliceResult.output as { currentAccount: { userId: string } }).currentAccount
    const bobResult = await create.handler(
      { username: 'Bob' },
      transitionContext(() => expect(provider.current()?.subject).toEqual(expect.any(String)))
    )
    const bob = (bobResult.output as { currentAccount: { userId: string } }).currentAccount

    await select.handler(
      { userId: alice.userId },
      transitionContext(() => expect(provider.current()?.subject).toBe(alice.userId))
    )
    const selectedBob = await select.handler(
      { userId: bob.userId },
      transitionContext(() => expect(provider.current()?.subject).toBe(bob.userId))
    )
    const selectedVersion = (selectedBob.output as { identityVersion: number }).identityVersion
    const unchangedSelectionAssert = vi.fn(() => {
      expect(provider.current()).toMatchObject({ subject: bob.userId, identityVersion: selectedVersion })
    })
    const unchangedSelection = await select.handler(
      { userId: bob.userId },
      { caller: { audience: 'ui' }, assertPrincipalCurrent: unchangedSelectionAssert }
    )
    expect((unchangedSelection.output as { identityVersion: number }).identityVersion).toBe(selectedVersion)
    expect(unchangedSelectionAssert).toHaveBeenCalledOnce()

    await select.handler(
      { userId: alice.userId },
      transitionContext(() => expect(provider.current()?.subject).toBe(alice.userId))
    )
    await exit.handler(
      {},
      transitionContext(() => expect(provider.current()).toBeUndefined())
    )
    const signedOutVersion = (
      (await exit.handler({}, {
        caller: { audience: 'ui' },
        assertPrincipalCurrent: vi.fn(() => expect(provider.current()).toBeUndefined())
      })).output as { identityVersion: number }
    ).identityVersion
    expect(provider.current()).toBeUndefined()
    expect(signedOutVersion).toBeGreaterThan(selectedVersion)

    entry.contributions[0]!.onDispose?.()
    entry.contributions[1]!.onDispose?.()
  })

  it('does not acknowledge non-transition assertion failures after a committed mutation', async () => {
    const operation = vi.fn(() => ({ status: 'available' as const }))
    const definitions = createIdentityCapabilityFactory({
      defineCapability: (definition) => definition,
      getService: () => ({ createAccount: operation }) as never,
      getCloudRuntime: () => ({}) as never
    }).createDefinitions() as IdentityCapabilityOptions[]
    const create = definitions.find(({ id }) => id === IDENTITY_CAPABILITY_IDS.createAccount)!
    const failure = codedError('principal_provider_failed')

    expect(() => create.handler({ username: 'Alice' }, {
      caller: { audience: 'ui' },
      assertPrincipalCurrent: vi.fn(() => { throw failure })
    })).toThrow(failure)
    expect(operation).toHaveBeenCalledOnce()
  })

  it('acknowledges a committed unavailable-database reset as a signed-out context transition', async () => {
    const reset = vi.fn(() => ({
      state: {
        status: 'available' as const,
        identityVersion: 1,
        currentAccount: null,
        accountCount: 0,
        firstPromptDismissed: false
      },
      backupPath: '/private/tmp/identity.backup.sqlite'
    }))
    const definitions = createIdentityCapabilityFactory({
      defineCapability: (definition) => definition,
      getService: () => ({ backupAndReset: reset }) as never,
      getCloudRuntime: () => ({}) as never
    }).createDefinitions() as IdentityCapabilityOptions[]
    const capability = definitions.find(
      ({ id }) => id === IDENTITY_CAPABILITY_IDS.backupAndReset
    )!
    const assertPrincipalCurrent = vi.fn(() => {
      throw codedError('principal_changed')
    })

    await expect(Promise.resolve(capability.handler(
      { secondConfirmation: IDENTITY_RESET_CONFIRMATION },
      { caller: { audience: 'ui' }, assertPrincipalCurrent }
    ))).resolves.toMatchObject({ output: { state: { identityVersion: 1 } } })
    expect(reset).toHaveBeenCalledOnce()
    expect(assertPrincipalCurrent).toHaveBeenCalledOnce()
  })

  it('publishes runtime changes while keeping Principal mutations global and resource-neutral', async () => {
    let revision = 1
    const listeners = new Set<() => void>()
    const snapshot = () => ({
      identity: { state: 'signed-out' as const },
      device: { state: 'signed-out' as const },
      devices: [],
      revision: `cloud-${revision}`
    })
    const runtime = {
      snapshot,
      semanticRevision: () => `cloud-${revision}`,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      login: async () => {
        revision += 1
        for (const listener of listeners) listener()
        return snapshot()
      }
    }
    let registration: {
      subscribeChanges: (
        listener: (change: { semanticRevision: string; layoutRevision?: string }) => void
      ) => () => void
    } | undefined
    const resource = {
      token: `cap_${'a'.repeat(24)}`,
      semanticRevision: 'cloud-1',
      expiresAt: '2027-08-21T00:00:00.000Z'
    }
    const definitions = createIdentityCapabilityFactory({
      defineCapability: (definition) => definition,
      getService: () => ({}) as never,
      getCloudRuntime: () => runtime as never
    }).createDefinitions() as IdentityCapabilityOptions[]
    const inspect = definitions.find(({ id }) => id === IDENTITY_CAPABILITY_IDS.cloudInspect)!
    const login = definitions.find(({ id }) => id === IDENTITY_CAPABILITY_IDS.cloudLogin)!
    const context = {
      caller: { audience: 'ui' as const },
      assertPrincipalCurrent: vi.fn(),
      issueResource: (value: {
        subscribeChanges: (
          listener: (change: { semanticRevision: string; layoutRevision?: string }) => void
        ) => () => void
      }) => {
        registration = value
        return resource
      }
    }

    await inspect.handler({}, context)
    const providerChanges: unknown[] = []
    const unsubscribe = registration!.subscribeChanges((change) => providerChanges.push(change))
    const result = await login.handler({}, {
      caller: { audience: 'ui' },
      assertPrincipalCurrent: vi.fn()
    })

    expect(providerChanges).toEqual([{ semanticRevision: 'cloud-2' }])
    expect(login).toMatchObject({
      scope: 'global',
      principalTransition: 'host-authority',
      concurrency: { revision: 'none', idempotency: 'required' }
    })
    expect(login).not.toHaveProperty('resourceKinds')
    expect(result).toEqual({ output: expect.objectContaining({ revision: 'cloud-2' }) })
    unsubscribe()
  })

  it('fails an inactive Cloud mutation without constructing a fallback runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-inactive-'))
    roots.push(root)
    const createRuntime = vi.spyOn(CloudIdentityRuntime, 'create')
    const entry = createDomainMainEntry({
      getUserDataDir: () => root,
      getDeviceId: () => 'device-1',
      packageSecrets: memorySecrets(),
      internalServices: memoryInternalServices(),
      defineCapability: (definition) => definition
    })
    const factory = entry.contributions[0]!.value as ReturnType<typeof createIdentityCapabilityFactory>
    const login = (factory.createDefinitions() as IdentityCapabilityOptions[]).find(
      ({ id }) => id === IDENTITY_CAPABILITY_IDS.cloudLogin
    )!

    await expect(Promise.resolve(login.handler({}, {
      caller: { audience: 'ui' },
      assertPrincipalCurrent: vi.fn()
    }))).rejects.toThrow('Cloud identity runtime is not active.')
    expect(createRuntime).not.toHaveBeenCalled()
    entry.contributions[0]!.onDispose?.()
    entry.contributions[1]!.onDispose?.()
    await entry.contributions[2]!.onDispose?.()
  })

  it('fails closed when the Host does not provide a canonical installation identity', () => {
    for (const getDeviceId of [undefined, () => ' device-1']) {
      const entry = createDomainMainEntry({
        getUserDataDir: () => '/private/tmp/sciforge-identity-missing-device',
        ...(getDeviceId ? { getDeviceId } : {}),
        packageSecrets: memorySecrets(),
        internalServices: memoryInternalServices(),
        defineCapability: (definition) => definition
      })
      const provider = entry.contributions[1]!.value as { current(): unknown }

      expect(() => provider.current()).toThrow()
      entry.contributions[0]!.onDispose?.()
      entry.contributions[1]!.onDispose?.()
    }
  })

  it('fails Cloud activation before construction when the Host application version is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-version-'))
    roots.push(root)
    const createRuntime = vi.spyOn(CloudIdentityRuntime, 'create')
    const entry = createDomainMainEntry({
      getUserDataDir: () => root,
      getDeviceId: () => 'device-1',
      packageSecrets: memorySecrets(),
      internalServices: memoryInternalServices(),
      defineCapability: (definition) => definition
    })
    const lifecycle = entry.contributions[2]!.value as {
      activate(context: unknown): Promise<unknown>
    }

    await expect(lifecycle.activate(lifecycleContext(root))).rejects.toThrow(
      'Identity requires the canonical Host application version.'
    )
    expect(createRuntime).not.toHaveBeenCalled()
    await expect(Promise.resolve(entry.contributions[2]!.onDispose?.())).resolves.toBeUndefined()
  })

  it('passes the canonical Host application version unchanged into Cloud activation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-version-'))
    roots.push(root)
    const runtime = runtimeDouble(Promise.resolve())
    const createRuntime = vi.spyOn(CloudIdentityRuntime, 'create').mockResolvedValueOnce(runtime.value)
    const getAppVersion = vi.fn(() => '9.8.7-host')
    const entry = createDomainMainEntry({
      getUserDataDir: () => root,
      getDeviceId: () => 'device-1',
      getAppVersion,
      packageSecrets: memorySecrets(),
      internalServices: memoryInternalServices(),
      defineCapability: (definition) => definition
    })
    const lifecycle = entry.contributions[2]!.value as {
      activate(context: unknown): Promise<unknown>
    }

    const dispose = await lifecycle.activate(lifecycleContext(root)) as () => void
    expect(getAppVersion).toHaveBeenCalledOnce()
    expect(createRuntime).toHaveBeenCalledWith(expect.objectContaining({
      appRoot: root,
      appVersion: '9.8.7-host'
    }))
    dispose()
    expect(runtime.close).toHaveBeenCalledOnce()
  })

  it('waits for initialization before disposing an in-flight activation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-lifecycle-'))
    roots.push(root)
    const initialization = deferred<void>()
    const runtime = runtimeDouble(initialization.promise)
    vi.spyOn(CloudIdentityRuntime, 'create').mockResolvedValueOnce(runtime.value)
    const entry = createDomainMainEntry({
      getUserDataDir: () => root,
      getDeviceId: () => 'device-1',
      getAppVersion: () => '1.0.0',
      packageSecrets: memorySecrets(),
      internalServices: memoryInternalServices(),
      defineCapability: (definition) => definition
    })
    const lifecycle = entry.contributions[2]!.value as {
      activate(context: unknown): Promise<unknown>
    }

    const activation = lifecycle.activate(lifecycleContext(root))
    await vi.waitFor(() => expect(runtime.initialize).toHaveBeenCalledOnce())
    const cleanup = Promise.resolve(entry.contributions[2]!.onDispose?.())

    expect(runtime.close).not.toHaveBeenCalled()
    initialization.resolve()
    const returnedDisposer = await activation as () => void
    await expect(cleanup).resolves.toBeUndefined()

    expect(runtime.close).toHaveBeenCalledOnce()
    await expectCloudRuntimeInactive(entry)
    returnedDisposer()
    expect(runtime.close).toHaveBeenCalledOnce()
  })

  it('keeps initialization rejection with the activation owner during concurrent cleanup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-lifecycle-'))
    roots.push(root)
    const initialization = deferred<void>()
    const runtime = runtimeDouble(initialization.promise)
    vi.spyOn(CloudIdentityRuntime, 'create').mockResolvedValueOnce(runtime.value)
    const entry = createDomainMainEntry({
      getUserDataDir: () => root,
      getDeviceId: () => 'device-1',
      getAppVersion: () => '1.0.0',
      packageSecrets: memorySecrets(),
      internalServices: memoryInternalServices(),
      defineCapability: (definition) => definition
    })
    const lifecycle = entry.contributions[2]!.value as {
      activate(context: unknown): Promise<unknown>
    }

    const activation = lifecycle.activate(lifecycleContext(root))
    await vi.waitFor(() => expect(runtime.initialize).toHaveBeenCalledOnce())
    const cleanup = Promise.resolve(entry.contributions[2]!.onDispose?.())
    const failure = new Error('structural initialization failed')
    const activationFailure = expect(activation).rejects.toBe(failure)

    expect(runtime.close).not.toHaveBeenCalled()
    initialization.reject(failure)

    await activationFailure
    await expect(cleanup).resolves.toBeUndefined()
    expect(runtime.close).toHaveBeenCalledOnce()
    await expectCloudRuntimeInactive(entry)
  })

  it('publishes a recoverable signed-out initialization result as an active runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-lifecycle-'))
    roots.push(root)
    const snapshot = {
      identity: { state: 'signed-out' as const },
      device: { state: 'signed-out' as const },
      devices: [],
      revision: 'cloud-1',
      error: {
        source: 'identity' as const,
        code: 'OIDC_CONFIGURATION_ERROR',
        message: 'Cloud identity configuration is unavailable.'
      }
    }
    const runtime = runtimeDouble(Promise.resolve(snapshot), snapshot)
    vi.spyOn(CloudIdentityRuntime, 'create').mockResolvedValueOnce(runtime.value)
    const entry = createDomainMainEntry({
      getUserDataDir: () => root,
      getDeviceId: () => 'device-1',
      getAppVersion: () => '1.0.0',
      packageSecrets: memorySecrets(),
      internalServices: memoryInternalServices(),
      defineCapability: (definition) => definition
    })
    const lifecycle = entry.contributions[2]!.value as {
      activate(context: unknown): Promise<unknown>
    }

    const returnedDisposer = await lifecycle.activate(lifecycleContext(root)) as () => void
    const factory = entry.contributions[0]!.value as ReturnType<typeof createIdentityCapabilityFactory>
    const inspect = (factory.createDefinitions() as IdentityCapabilityOptions[]).find(
      ({ id }) => id === IDENTITY_CAPABILITY_IDS.cloudInspect
    )!
    const result = await inspect.handler({}, {
      caller: { audience: 'ui' },
      assertPrincipalCurrent: vi.fn(),
      issueResource: () => ({
        token: `cap_${'a'.repeat(24)}`,
        semanticRevision: 'cloud-1',
        expiresAt: '2027-08-21T00:00:00.000Z'
      })
    })

    expect(result.output).toMatchObject({
      snapshot: {
        identity: { state: 'signed-out' },
        error: { source: 'identity', code: 'OIDC_CONFIGURATION_ERROR' }
      }
    })
    expect(runtime.close).not.toHaveBeenCalled()
    returnedDisposer()
    expect(runtime.close).toHaveBeenCalledOnce()
  })

  it.each(['returned-first', 'catalog-first'] as const)(
    'closes a normally activated runtime once when disposal is %s',
    async (order) => {
      const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-lifecycle-'))
      roots.push(root)
      const runtime = runtimeDouble(Promise.resolve())
      vi.spyOn(CloudIdentityRuntime, 'create').mockResolvedValueOnce(runtime.value)
      const entry = createDomainMainEntry({
        getUserDataDir: () => root,
        getDeviceId: () => 'device-1',
        getAppVersion: () => '1.0.0',
        packageSecrets: memorySecrets(),
        internalServices: memoryInternalServices(),
        defineCapability: (definition) => definition
      })
      const lifecycle = entry.contributions[2]!.value as {
        activate(context: unknown): Promise<unknown>
      }
      const returnedDisposer = await lifecycle.activate(lifecycleContext(root)) as () => void

      if (order === 'returned-first') {
        returnedDisposer()
        await entry.contributions[2]!.onDispose?.()
      } else {
        await entry.contributions[2]!.onDispose?.()
        returnedDisposer()
      }

      expect(runtime.close).toHaveBeenCalledOnce()
      await expectCloudRuntimeInactive(entry)
    }
  )
})

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

function memorySecrets() {
  const values = new Map<string, string>()
  return {
    has: async (key: string) => values.has(key),
    read: async (key: string) => values.get(key) ?? null,
    write: async (key: string, value: string) => {
      values.set(key, value)
    },
    remove: async (key: string) => {
      values.delete(key)
    }
  }
}

function memoryInternalServices() {
  const services = new Map<string, object>()
  return {
    register: <Service extends object>(registration: Readonly<{
      serviceId: string
      contractVersion: string
      allowedConsumerModuleIds: readonly string[]
      service: Service
    }>) => {
      services.set(`${registration.serviceId}@${registration.contractVersion}`, registration.service)
    },
    acquire: <Service extends object>(serviceId: string, contractVersion: string): Service => {
      const service = services.get(`${serviceId}@${contractVersion}`)
      if (!service) throw new Error('Internal service is not registered.')
      return service as Service
    }
  }
}

function lifecycleContext(root: string) {
  return {
    userDataDir: root,
    appRoot: root,
    environment: {},
    signal: new AbortController().signal
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function runtimeDouble(
  initialization: Promise<unknown>,
  snapshot: unknown = {
    identity: { state: 'signed-out' },
    device: { state: 'signed-out' },
    devices: [],
    revision: 'cloud-1'
  }
) {
  const initialize = vi.fn(() => initialization)
  const close = vi.fn()
  return {
    initialize,
    close,
    value: {
      initialize,
      close,
      snapshot: vi.fn(() => snapshot),
      semanticRevision: vi.fn(() => 'cloud-1'),
      subscribe: vi.fn(() => () => undefined)
    } as unknown as CloudIdentityRuntime
  }
}

async function expectCloudRuntimeInactive(
  entry: ReturnType<typeof createDomainMainEntry>
): Promise<void> {
  const factory = entry.contributions[0]!.value as ReturnType<typeof createIdentityCapabilityFactory>
  const inspect = (factory.createDefinitions() as IdentityCapabilityOptions[]).find(
    ({ id }) => id === IDENTITY_CAPABILITY_IDS.cloudInspect
  )!
  await expect(Promise.resolve(inspect.handler({}, {
    caller: { audience: 'ui' },
    assertPrincipalCurrent: vi.fn(),
    issueResource: vi.fn()
  }))).rejects.toThrow('Cloud identity runtime is not active.')
}

import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  OpenContentConnectorError,
  type OpenContentExternalBindingAttestation
} from '../contract.js'
import type { OpenContentClient } from './opencontent-client.js'
import { createOpenContentConnectionService } from './connection-service.js'
import {
  OpenContentPrivateAccountError,
  type OpenContentPrivateAccountBinding,
  type OpenContentPrivateAccountRuntime
} from './private-account-runtime.js'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'opencontent-edoc2-demo' as const
const OPENCONTENT_SESSION_CONNECTION_ID = 'opencontent-session' as const

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'local-account-a',
  assurance: 'local-selection' as const,
  deviceId: 'test-device',
  identityVersion: 1
})

describe('OpenContent connection service', () => {
  it('exposes one atomic session surface without package settings or random connection IDs', () => {
    expectTypeOf<ReturnType<typeof createOpenContentConnectionService>>()
      .toHaveProperty('useCurrentSession')
    expectTypeOf<ReturnType<typeof createOpenContentConnectionService>>()
      .not.toHaveProperty('useCurrentToken')
    expectTypeOf<Parameters<typeof createOpenContentConnectionService>[0]>()
      .not.toHaveProperty('settings')
    expectTypeOf<Parameters<typeof createOpenContentConnectionService>[0]>()
      .not.toHaveProperty('createConnectionId')
  })

  it('rejects an unknown enrollment target before runtime or credential-store access', async () => {
    const accounts = inMemoryAccounts()
    const enroll = vi.spyOn(accounts, 'enroll')
    const getRuntime = vi.fn(configuredRuntime(stubClient()))
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime
    })
    const credentials = enrollmentCredentials()

    await expect(service.enroll({
      principal,
      providerInstanceRef: 'opencontent-unknown',
      credentials,
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'invalid_input' })

    expect(credentials).toEqual({ account: '', password: '' })
    expect(getRuntime).not.toHaveBeenCalled()
    expect(enroll).not.toHaveBeenCalled()
  })

  it('rejects an unknown status target before runtime or credential-store access', async () => {
    const accounts = inMemoryAccounts()
    const status = vi.spyOn(accounts, 'status')
    const getRuntime = vi.fn(configuredRuntime(stubClient()))
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime
    })

    await expect(service.status({
      principal,
      providerInstanceRef: 'opencontent-unknown',
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'invalid_input' })

    expect(getRuntime).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
  })

  it('gates status on deployment availability before reading a Host credential', async () => {
    const accounts = inMemoryAccounts()
    const getRuntime = vi.fn(() => undefined)
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime
    })

    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'provider_unavailable' })

    expect(getRuntime).toHaveBeenCalledOnce()
    expect(accounts.bindings).toEqual([])
  })

  it('replaces only the fixed Host credential and clears successful one-use credentials', async () => {
    const accounts = inMemoryAccounts()
    accounts.queueEnrollment(
      authenticatedSession('external-user-a', 'Fixture User A'),
      authenticatedSession('external-user-b', 'Fixture User B')
    )
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient({
        observeCurrentExternalAccount: async () => fixtureExternalAccount(
          'external-user-b',
          'Fixture User B'
        )
      }))
    })
    const firstCredentials = enrollmentCredentials('fixture-user-a')
    const first = await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: firstCredentials,
      assertPrincipalCurrent: () => undefined
    })
    const secondCredentials = enrollmentCredentials('fixture-user-b')
    const second = await service.enroll({
      principal: { ...principal, identityVersion: 2 },
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: secondCredentials,
      assertPrincipalCurrent: () => undefined
    })

    expect(first).toEqual({
      state: 'connected',
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    })
    expect(second).toEqual({
      state: 'connected',
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    })
    expect(JSON.stringify([first, second])).not.toMatch(
      /fixture-user-[ab]|password|opaque-token|external-user|identityId/u
    )
    expect(firstCredentials).toEqual({ account: '', password: '' })
    expect(secondCredentials).toEqual({ account: '', password: '' })
    expect(accounts.values).toEqual(new Map([
      [sessionBindingKey(principal), 'opaque-token-external-user-b']
    ]))
    expect(accounts.bindings.every(
      (binding) => binding.connectionId === OPENCONTENT_SESSION_CONNECTION_ID
    )).toBe(true)
  })

  it('rejects a concurrent enrollment before runtime lookup or serialized credential retention', async () => {
    const stored = inMemoryAccounts()
    let markEnrollmentStarted!: () => void
    const enrollmentStarted = new Promise<void>((resolve) => {
      markEnrollmentStarted = resolve
    })
    let releaseEnrollment!: () => void
    const enrollmentReleased = new Promise<void>((resolve) => {
      releaseEnrollment = resolve
    })
    const enroll = vi.fn<OpenContentPrivateAccountRuntime['enroll']>(async (input) => {
      markEnrollmentStarted()
      await enrollmentReleased
      return stored.enroll(input)
    })
    const accounts: OpenContentPrivateAccountRuntime = { ...stored, enroll }
    const getRuntime = vi.fn(configuredRuntime(stubClient()))
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime
    })
    const firstCredentials = enrollmentCredentials('first-account')
    const first = service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: firstCredentials,
      assertPrincipalCurrent: () => undefined
    })
    await enrollmentStarted

    const secondCredentials = enrollmentCredentials('second-account')
    await expect(service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: secondCredentials,
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'conflict' })

    expect(secondCredentials).toEqual({ account: '', password: '' })
    expect(firstCredentials).toEqual({
      account: 'first-account',
      password: 'first-account-password'
    })
    expect(getRuntime).toHaveBeenCalledOnce()
    expect(enroll).toHaveBeenCalledOnce()

    releaseEnrollment()
    await expect(first).resolves.toMatchObject({ state: 'connected' })
    expect(firstCredentials).toEqual({ account: '', password: '' })
  })

  it.each([
    new Error('provider authentication failed'),
    new OpenContentPrivateAccountError('cancelled', 'Enrollment was cancelled.')
  ])('clears failed or cancelled credentials and releases enrollment admission', async (failure) => {
    const accounts = inMemoryAccounts()
    accounts.failEnroll(failure)
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient())
    })
    const failedCredentials = enrollmentCredentials()

    await expect(service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: failedCredentials,
      assertPrincipalCurrent: () => undefined
    })).rejects.toBe(failure)

    expect(failedCredentials).toEqual({ account: '', password: '' })
    expect(accounts.values).toEqual(new Map())

    accounts.failEnroll(undefined)
    const retryCredentials = enrollmentCredentials('retry-account')
    await expect(service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: retryCredentials,
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({ state: 'connected' })
    expect(retryCredentials).toEqual({ account: '', password: '' })
  })

  it('treats a returned enrollment receipt as committed without a post-commit assertion', async () => {
    const stored = inMemoryAccounts()
    let principalCurrent = true
    const accounts: OpenContentPrivateAccountRuntime = {
      ...stored,
      enroll: async (input) => {
        const receipt = await stored.enroll(input)
        principalCurrent = false
        return receipt
      }
    }
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient())
    })
    const credentials = enrollmentCredentials()
    let assertionCount = 0

    await expect(service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials,
      assertPrincipalCurrent: async () => {
        assertionCount += 1
        await Promise.resolve()
        if (!principalCurrent) throw new Error('sensitive-principal-diagnostic')
      }
    })).resolves.toEqual({
      state: 'connected',
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    })

    expect(assertionCount).toBe(1)
    expect(credentials).toEqual({ account: '', password: '' })
    expect(stored.values.get(sessionBindingKey(principal))).toBe('bound-opaque-token')
  })

  it('restores a valid stored Token after service recreation without exposing Provider profile fields', async () => {
    const accounts = inMemoryAccounts()
    const firstService = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient())
    })
    await firstService.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })
    const isTokenValid = vi.fn<OpenContentClient['isTokenValid']>().mockResolvedValue(true)
    const observeCurrentExternalAccount = vi.fn<
      OpenContentClient['observeCurrentExternalAccount']
    >().mockResolvedValue(fixtureExternalAccount('external-user-a', 'Live Provider Name'))
    const restartedService = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient({
        isTokenValid,
        observeCurrentExternalAccount
      }))
    })
    const controller = new AbortController()

    await expect(restartedService.status({
      principal: { ...principal, identityVersion: 9 },
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      signal: controller.signal,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({
      state: 'connected',
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    })

    expect(isTokenValid).toHaveBeenCalledWith({
      token: 'bound-opaque-token',
      signal: controller.signal,
      assertPrincipalCurrent: expect.any(Function)
    })
    expect(observeCurrentExternalAccount).toHaveBeenCalledWith({
      token: 'bound-opaque-token',
      signal: controller.signal,
      assertPrincipalCurrent: expect.any(Function)
    })
  })

  it('derives reauthentication_required from an invalid Token without old account metadata', async () => {
    const accounts = inMemoryAccounts()
    const observeCurrentExternalAccount = vi.fn<
      OpenContentClient['observeCurrentExternalAccount']
    >()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient({
        isTokenValid: async () => false,
        observeCurrentExternalAccount
      }))
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })

    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({
      state: 'reauthentication_required',
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    })
    await expect(service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async () => 'must not run')).rejects.toMatchObject({
      code: 'reauthentication_required'
    })

    expect(observeCurrentExternalAccount).not.toHaveBeenCalled()
    expect(accounts.values.get(sessionBindingKey(principal))).toBe('bound-opaque-token')
  })

  it('reports disconnected if the credential disappears between status and use', async () => {
    const stored = inMemoryAccounts()
    const accounts: OpenContentPrivateAccountRuntime = {
      ...stored,
      status: async () => ({ state: 'available' }),
      withSession: async () => {
        throw new OpenContentPrivateAccountError(
          'session_unavailable',
          'The encrypted Token disappeared.'
        )
      }
    }
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient())
    })

    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected' })
  })

  it('propagates secure-storage failures without mislabeling the Token as invalid', async () => {
    const accounts = inMemoryAccounts()
    await accounts.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connectionId: OPENCONTENT_SESSION_CONNECTION_ID,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })
    accounts.failUse(new OpenContentPrivateAccountError(
      'secure_storage_unavailable',
      'The operating-system secure storage service is unavailable.'
    ))
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient())
    })

    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'secure_storage_unavailable' })
    await expect(service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async () => 'must not run')).rejects.toMatchObject({
      code: 'secure_storage_unavailable'
    })
  })

  it('binds the fixed Token independently to the exact Principal and Provider Instance', async () => {
    const accounts = inMemoryAccounts()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient())
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })
    const otherPrincipal = Object.freeze({ ...principal, subject: 'local-account-b' })

    await expect(service.status({
      principal: otherPrincipal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({ state: 'disconnected' })
    await service.unbind({
      principal: otherPrincipal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({ state: 'connected' })

    expect(accounts.values).toEqual(new Map([
      [sessionBindingKey(principal), 'bound-opaque-token']
    ]))
    expect(accounts.bindings.every((binding) =>
      binding.providerInstanceRef === OPENCONTENT_PROVIDER_INSTANCE_REF &&
      binding.connectionId === OPENCONTENT_SESSION_CONNECTION_ID
    )).toBe(true)
  })

  it('exposes one frozen atomic session with live identity and a non-secret attestation', async () => {
    const accounts = inMemoryAccounts()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient())
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })

    const observed = await service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async (session) => ({ ...session, frozen: Object.isFrozen(session) }))

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
    expect(JSON.stringify(observed.bindingAttestation)).not.toMatch(
      /bound-opaque-token|fixture-user|external-user|identityId/u
    )
  })

  it('rotates only the Token-derived binding revision on a same-account rebind', async () => {
    const accounts = inMemoryAccounts()
    accounts.queueEnrollment(
      authenticatedSession('external-user-a', 'Fixture User A', 'first-session-token'),
      authenticatedSession('external-user-a', 'Fixture User A', 'second-session-token')
    )
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient())
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })
    const first = await service.attestExternalBinding({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })
    const rebound = await service.attestExternalBinding({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })

    expect(rebound.externalSubject).toBe(first.externalSubject)
    expect(rebound.bindingRevision).not.toBe(first.bindingRevision)
    const operation = vi.fn(async () => 'must not run')
    await expect(service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedBindingAttestation: first,
      assertPrincipalCurrent: () => undefined
    }, operation)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(operation).not.toHaveBeenCalled()
  })

  it('uses the currently observed external identity instead of a persisted account snapshot', async () => {
    const accounts = inMemoryAccounts()
    let observedAccount = fixtureExternalAccount('external-user-a', 'Fixture User A')
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient({
        observeCurrentExternalAccount: async () => observedAccount
      }))
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })
    const first = await service.attestExternalBinding({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    observedAccount = fixtureExternalAccount('external-user-b', 'Fixture User B')

    const current = await service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async (session) => session)
    expect(current.externalIdentityId).toBe(9000042)
    expect(current.bindingAttestation.externalSubject).not.toBe(first.externalSubject)

    const operation = vi.fn(async () => 'must not run')
    await expect(service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedBindingAttestation: first,
      assertPrincipalCurrent: () => undefined
    }, operation)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(operation).not.toHaveBeenCalled()
  })

  it('requires every expected binding attestation field to match exactly', async () => {
    const accounts = inMemoryAccounts()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient())
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })
    const attestation = await service.attestExternalBinding({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    const mismatches: OpenContentExternalBindingAttestation[] = [
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

  it('rejects a rebind immediately while a canonical session operation is active', async () => {
    const accounts = inMemoryAccounts()
    accounts.queueEnrollment(
      authenticatedSession('external-user-a', 'Fixture User A', 'first-session-token'),
      authenticatedSession('external-user-b', 'Fixture User B', 'second-session-token')
    )
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient())
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })

    let markSessionEntered!: () => void
    const sessionEntered = new Promise<void>((resolve) => { markSessionEntered = resolve })
    let releaseSession!: () => void
    const sessionReleased = new Promise<void>((resolve) => { releaseSession = resolve })
    const activeSession = service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async ({ token }) => {
      markSessionEntered()
      await sessionReleased
      return token
    })
    await sessionEntered

    const rebindCredentials = enrollmentCredentials('rebind-account')
    const rebind = service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: rebindCredentials,
      assertPrincipalCurrent: () => undefined
    }).then(
      () => 'unexpected-success' as const,
      (error: unknown) => error
    )
    await Promise.resolve()

    expect(await rebind).toMatchObject({ code: 'conflict' })
    expect(rebindCredentials).toEqual({ account: '', password: '' })
    expect(accounts.values.get(sessionBindingKey(principal))).toBe('first-session-token')

    releaseSession()
    await expect(activeSession).resolves.toBe('first-session-token')
    expect(accounts.values.get(sessionBindingKey(principal))).toBe('first-session-token')
  })

  it('rejects and clears enrollment while canonical status validation is active', async () => {
    const accounts = inMemoryAccounts()
    await accounts.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connectionId: OPENCONTENT_SESSION_CONNECTION_ID,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })
    const enroll = vi.spyOn(accounts, 'enroll')
    enroll.mockClear()
    let markValidationStarted!: () => void
    const validationStarted = new Promise<void>((resolve) => {
      markValidationStarted = resolve
    })
    let releaseValidation!: () => void
    const validationReleased = new Promise<void>((resolve) => {
      releaseValidation = resolve
    })
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient({
        isTokenValid: async () => {
          markValidationStarted()
          await validationReleased
          return true
        }
      }))
    })
    const activeStatus = service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })
    await validationStarted
    const credentials = enrollmentCredentials('status-race-account')

    await expect(service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials,
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'conflict' })

    expect(credentials).toEqual({ account: '', password: '' })
    expect(enroll).not.toHaveBeenCalled()
    releaseValidation()
    await expect(activeStatus).resolves.toMatchObject({ state: 'connected' })
  })

  it('unbinds the fixed Host Token without deployment runtime and leaves no local session', async () => {
    const accounts = inMemoryAccounts()
    await accounts.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connectionId: OPENCONTENT_SESSION_CONNECTION_ID,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })
    const getRuntime = vi.fn(() => undefined)
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime
    })

    await expect(service.unbind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({
      state: 'disconnected',
      remoteRevocation: 'unsupported'
    })
    await expect(service.status({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'provider_unavailable' })

    expect(getRuntime).toHaveBeenCalledOnce()
    expect(accounts.values).toEqual(new Map())
  })

  it('does not remove the Token when a queued unbind is cancelled', async () => {
    const accounts = inMemoryAccounts()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient())
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })
    let markSessionEntered!: () => void
    const sessionEntered = new Promise<void>((resolve) => { markSessionEntered = resolve })
    let releaseSession!: () => void
    const sessionReleased = new Promise<void>((resolve) => { releaseSession = resolve })
    const activeSession = service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async () => {
      markSessionEntered()
      await sessionReleased
    })
    await sessionEntered
    const controller = new AbortController()

    const unbind = service.unbind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      signal: controller.signal,
      assertPrincipalCurrent: () => undefined
    })
    controller.abort()
    releaseSession()

    await activeSession
    await expect(unbind).rejects.toMatchObject({ code: 'cancelled' })
    expect(accounts.values.get(sessionBindingKey(principal))).toBe('bound-opaque-token')
  })

  it('does not convert arbitrary operation failures into reauthentication', async () => {
    const accounts = inMemoryAccounts()
    const service = createOpenContentConnectionService({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      accounts,
      getRuntime: configuredRuntime(stubClient())
    })
    await service.enroll({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => undefined
    })
    const failure = new OpenContentConnectorError(
      'outcome_unknown',
      'The protected operation outcome is unknown.'
    )

    await expect(service.useCurrentSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    }, async () => {
      throw failure
    })).rejects.toBe(failure)
  })
})

function enrollmentCredentials(account = 'fixture-user-a') {
  return {
    account,
    password: `${account}-password`
  }
}

function authenticatedSession(
  id: 'external-user-a' | 'external-user-b',
  name: string,
  token = `opaque-token-${id}`
) {
  return Object.freeze({
    token,
    account: fixtureExternalAccount(id, name)
  })
}

function fixtureExternalAccount(
  id: 'external-user-a' | 'external-user-b',
  name: string
) {
  return Object.freeze({
    id,
    identityId: id === 'external-user-a' ? 9000041 : 9000042,
    account: id === 'external-user-a' ? 'fixture-user-a' : 'fixture-user-b',
    name,
    topPersonalFolderId: id === 'external-user-a' ? '1001' : '1002'
  })
}

function stubClient(overrides: Partial<OpenContentClient> = {}): OpenContentClient {
  return {
    authenticateExistingAccount: async () => authenticatedSession(
      'external-user-a',
      'Fixture User A',
      'bound-opaque-token'
    ),
    isTokenValid: async () => true,
    observeCurrentExternalAccount: async () => fixtureExternalAccount(
      'external-user-a',
      'Fixture User A'
    ),
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

function bindingKey(binding: OpenContentPrivateAccountBinding): string {
  return [
    binding.principal.authority,
    binding.principal.subject,
    binding.principal.assurance,
    binding.principal.deviceId,
    binding.providerInstanceRef,
    binding.connectionId
  ].join(':')
}

function sessionBindingKey(owner: typeof principal): string {
  return bindingKey({
    principal: owner,
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    connectionId: OPENCONTENT_SESSION_CONNECTION_ID
  })
}

function inMemoryAccounts(): OpenContentPrivateAccountRuntime & Readonly<{
  values: Map<string, string>
  bindings: OpenContentPrivateAccountBinding[]
  failEnroll(error: Error | undefined): void
  failUse(error: Error | undefined): void
  queueEnrollment(...sessions: ReturnType<typeof authenticatedSession>[]): void
}> {
  const values = new Map<string, string>()
  const bindings: OpenContentPrivateAccountBinding[] = []
  const enrollments: ReturnType<typeof authenticatedSession>[] = []
  let enrollFailure: Error | undefined
  let useFailure: Error | undefined
  const record = (binding: OpenContentPrivateAccountBinding) => {
    bindings.push({
      principal: { ...binding.principal },
      providerInstanceRef: binding.providerInstanceRef,
      connectionId: binding.connectionId
    })
    return bindingKey(binding)
  }

  return {
    values,
    bindings,
    failEnroll: (error) => { enrollFailure = error },
    failUse: (error) => { useFailure = error },
    queueEnrollment: (...sessions) => { enrollments.push(...sessions) },
    enroll: async (input) => {
      const key = record(input)
      if (enrollFailure) throw enrollFailure
      const session = enrollments.shift() ?? authenticatedSession(
        'external-user-a',
        'Fixture User A',
        'bound-opaque-token'
      )
      values.set(key, session.token)
      return undefined
    },
    status: async (binding) => values.has(record(binding))
      ? { state: 'available' as const }
      : { state: 'absent' as const },
    withSession: async (binding, operation) => {
      const value = values.get(record(binding))
      if (useFailure) throw useFailure
      if (!value) {
        throw new OpenContentPrivateAccountError(
          'session_unavailable',
          'The fixture session is unavailable.'
        )
      }
      return operation({ token: value })
    },
    remove: async (binding) => {
      values.delete(record(binding))
    }
  }
}

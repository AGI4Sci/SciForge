import { describe, expect, it, vi } from 'vitest'

import {
  DomainMainProviderCredentialError,
  domainMainProviderCredentialAccessSchema,
  type DomainMainProviderCredentialAccess,
  type DomainMainProviderCredentialOperationOptions,
  type DomainMainProviderCredentialStoreHost
} from '@sciforge/domain-sdk/package-storage'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'

import { OpenContentConnectorError } from '../contract.js'
import type { OpenContentClient } from './opencontent-client.js'
import {
  OpenContentPrivateAccountError
} from './private-account-runtime.js'
import {
  createOpenContentPrivateAccountRuntime
} from './provider-credential-runtime.js'

const providerInstanceRef = 'opencontent-edoc2-demo'
const connectionId = 'synthetic-connection-id'

const principal = Object.freeze({
  authority: 'https://identity.run0.invalid/realms/sciforge',
  subject: 'synthetic-user-a',
  assurance: 'cloud-authenticated',
  deviceId: 'synthetic-device-a',
  identityVersion: 7
}) satisfies PrincipalSnapshot

const externalAccount = Object.freeze({
  id: 'synthetic-external-account-id',
  identityId: 42,
  account: 'synthetic.account',
  name: 'Synthetic Account',
  topPersonalFolderId: '101'
})

const sessionToken = 'synthetic-session-token-value'

describe('OpenContent Host provider-credential runtime', () => {
  it('clears one-use credentials when rejecting a different Provider instance', async () => {
    const credentials = enrollmentCredentials()
    const authenticateExistingAccount = vi.fn()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      getRuntime: () => ({
        client: { authenticateExistingAccount } as unknown as OpenContentClient
      })
    })

    await expect(runtime.enroll({
      principal,
      providerInstanceRef: 'another-installed-provider',
      connectionId,
      credentials,
      assertPrincipalCurrent: vi.fn()
    })).rejects.toMatchObject({ code: 'binding_mismatch' })

    expect(credentials).toEqual({ account: '', password: '' })
    expect(authenticateExistingAccount).not.toHaveBeenCalled()
  })

  it('rejects a connection outside the public Host binding schema before authentication', async () => {
    const credentials = enrollmentCredentials()
    const authenticateExistingAccount = vi.fn()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      getRuntime: () => ({
        client: { authenticateExistingAccount } as unknown as OpenContentClient
      })
    })

    await expect(runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId: 'connection id with spaces',
      credentials,
      assertPrincipalCurrent: vi.fn()
    })).rejects.toMatchObject({ code: 'binding_mismatch' })

    expect(credentials).toEqual({ account: '', password: '' })
    expect(authenticateExistingAccount).not.toHaveBeenCalled()
  })

  it.each(['darwin', 'win32'] as const)(
    'uses the same generic Host credential contract under simulated %s and replaces only the Token',
    async (platform) => {
      await withSimulatedPlatform(platform, async () => {
        const host = fakeProviderCredentialStore()
        const credentials = enrollmentCredentials()
        const authenticateExistingAccount = vi.fn(async (input: Readonly<{
          username: string
          password: string
          assertPrincipalCurrent(): void | Promise<void>
        }>) => {
          expect(input.username).toBe('synthetic.account')
          expect(input.password).toBe('synthetic-password-value')
          await input.assertPrincipalCurrent()
          return Object.freeze({ token: sessionToken })
        })
        const observeCurrentExternalAccount = vi.fn(async (input: Readonly<{
          token: string
          assertPrincipalCurrent(): void | Promise<void>
        }>) => {
          expect(credentials).toEqual({ account: '', password: '' })
          expect(input.token).toBe(sessionToken)
          await input.assertPrincipalCurrent()
          return externalAccount
        })
        const runtime = createOpenContentPrivateAccountRuntime({
          providerInstanceRef,
          credentials: host.credentials,
          getRuntime: () => ({
            client: {
              authenticateExistingAccount,
              observeCurrentExternalAccount
            } as unknown as OpenContentClient
          })
        })
        const assertPrincipalCurrent = vi.fn()

        const receipt = await runtime.enroll({
          principal,
          providerInstanceRef,
          connectionId,
          credentials,
          assertPrincipalCurrent
        })

        expect(receipt).toBeUndefined()
        expect(host.replacements).toEqual([{
          access: providerAccess(),
          secret: sessionToken
        }])
        expect(JSON.stringify(host.replacements[0]?.access)).not.toContain(
          externalAccount.account
        )
        expect(credentials).toEqual({ account: '', password: '' })
        expect(authenticateExistingAccount).toHaveBeenCalledOnce()
        expect(observeCurrentExternalAccount).toHaveBeenCalledOnce()
        expect(assertPrincipalCurrent).toHaveBeenCalledTimes(5)
      })
    }
  )

  it('clears the caller credential object as soon as authentication starts', async () => {
    const host = fakeProviderCredentialStore()
    const enrollment = enrollmentCredentials()
    let capturedAuthenticationInput: Readonly<{
      username: string
      password: string
    }> | undefined
    let finishAuthentication!: () => void
    const authenticateExistingAccount = vi.fn((input: Readonly<{
      username: string
      password: string
    }>) => new Promise<Readonly<{ token: string }>>((resolve) => {
      capturedAuthenticationInput = input
      finishAuthentication = () => resolve(Object.freeze({ token: sessionToken }))
    }))
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({
        client: {
          authenticateExistingAccount,
          observeCurrentExternalAccount: vi.fn(async () => externalAccount)
        } as unknown as OpenContentClient
      })
    })

    const pending = runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      credentials: enrollment,
      assertPrincipalCurrent: vi.fn()
    })
    await vi.waitFor(() => expect(authenticateExistingAccount).toHaveBeenCalledOnce())

    expect(enrollment).toEqual({ account: '', password: '' })
    expect(capturedAuthenticationInput).toMatchObject({
      username: '',
      password: ''
    })
    finishAuthentication()
    await expect(pending).resolves.toBeUndefined()
  })

  it('restores the Session Token through a new runtime without reauthentication', async () => {
    const host = fakeProviderCredentialStore()
    const first = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })
    await first.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: vi.fn()
    })

    const authenticateExistingAccount = vi.fn()
    const restartedPrincipal = Object.freeze({
      ...principal,
      identityVersion: principal.identityVersion + 1
    })
    host.setCurrentPrincipal(restartedPrincipal)
    const restarted = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({
        client: { authenticateExistingAccount } as unknown as OpenContentClient
      })
    })
    const restartedBinding = {
      principal: restartedPrincipal,
      providerInstanceRef,
      connectionId
    }

    await expect(restarted.status(restartedBinding)).resolves.toEqual({
      state: 'available'
    })
    await expect(restarted.withSession(restartedBinding, ({ token }) => ({
      valid: token === sessionToken
    }))).resolves.toEqual({ valid: true })
    expect(authenticateExistingAccount).not.toHaveBeenCalled()
  })

  it('binds credential access to the current Principal, Provider instance, and connection', async () => {
    const host = fakeProviderCredentialStore()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })
    await runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: vi.fn()
    })

    await expect(runtime.status({
      principal,
      providerInstanceRef,
      connectionId: 'different-connection-id'
    })).resolves.toEqual({ state: 'absent' })

    const differentPrincipal = Object.freeze({
      ...principal,
      subject: 'synthetic-user-b',
      identityVersion: principal.identityVersion + 1
    })
    host.setCurrentPrincipal(differentPrincipal)
    await expect(runtime.status({
      principal: differentPrincipal,
      providerInstanceRef,
      connectionId
    })).resolves.toEqual({ state: 'absent' })

    host.setCurrentPrincipal(principal)
    await expect(runtime.status({
      principal,
      providerInstanceRef: 'another-installed-provider',
      connectionId
    })).rejects.toMatchObject({ code: 'binding_mismatch' })
  })

  it('forwards one request AbortSignal to every Host credential operation', async () => {
    const host = fakeProviderCredentialStore()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })
    const controller = new AbortController()
    const binding = { principal, providerInstanceRef, connectionId }

    await runtime.enroll({
      ...binding,
      credentials: enrollmentCredentials(),
      signal: controller.signal,
      assertPrincipalCurrent: vi.fn()
    })
    await runtime.status(binding, { signal: controller.signal })
    await runtime.withSession(
      binding,
      async () => undefined,
      { signal: controller.signal }
    )
    await runtime.remove(binding, { signal: controller.signal })

    expect(host.requests).toEqual([
      { method: 'status', signal: controller.signal },
      { method: 'replace', signal: controller.signal },
      { method: 'status', signal: controller.signal },
      { method: 'use', signal: controller.signal },
      { method: 'remove', signal: controller.signal }
    ])
  })

  it('maps Host lock-wait cancellation to the bounded cancelled result', async () => {
    const host = fakeProviderCredentialStore()
    const controller = new AbortController()
    const cancelledCredentials: DomainMainProviderCredentialStoreHost = Object.freeze({
      ...host.credentials,
      status: async (_access, requestOptions) => {
        controller.abort()
        requestOptions?.signal?.throwIfAborted()
        return { state: 'absent' as const }
      }
    })
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: cancelledCredentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })

    await expect(runtime.status(
      { principal, providerInstanceRef, connectionId },
      { signal: controller.signal }
    )).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('does not send credentials to OpenContent when secure storage is unavailable', async () => {
    const host = fakeProviderCredentialStore()
    const storageFailure = () => hostCredentialError('secure_storage_insecure')
    const unavailableCredentials: DomainMainProviderCredentialStoreHost = Object.freeze({
      ...host.credentials,
      status: vi.fn(async () => { throw storageFailure() }),
      replace: vi.fn(async () => { throw storageFailure() })
    })
    const authenticateExistingAccount = vi.fn(async () => Object.freeze({
      token: sessionToken,
      account: externalAccount
    }))
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: unavailableCredentials,
      getRuntime: () => ({
        client: { authenticateExistingAccount } as unknown as OpenContentClient
      })
    })
    const enrollment = enrollmentCredentials()

    await expect(runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      credentials: enrollment,
      assertPrincipalCurrent: vi.fn()
    })).rejects.toMatchObject({ code: 'secure_storage_unavailable' })

    expect(authenticateExistingAccount).not.toHaveBeenCalled()
    expect(enrollment).toEqual({ account: '', password: '' })
  })

  it('reports a missing Session without invoking the package-internal lease callback', async () => {
    const host = fakeProviderCredentialStore()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })
    const operation = vi.fn()
    const accountBinding = { principal, providerInstanceRef, connectionId }

    await expect(runtime.status(accountBinding)).resolves.toEqual({ state: 'absent' })
    await expect(runtime.withSession(accountBinding, operation))
      .rejects.toMatchObject({ code: 'session_unavailable' })
    await expect(runtime.remove(accountBinding)).resolves.toBeUndefined()
    await expect(runtime.remove(accountBinding)).resolves.toBeUndefined()
    expect(operation).not.toHaveBeenCalled()
  })

  it('rejects an invalid Session from secure storage before leasing it', async () => {
    const host = fakeProviderCredentialStore()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })
    const accountBinding = { principal, providerInstanceRef, connectionId }
    await runtime.enroll({
      ...accountBinding,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: vi.fn()
    })
    const storedKey = host.records.keys().next().value
    if (typeof storedKey !== 'string') throw new Error('Synthetic Session was not stored.')
    host.records.set(storedKey, 'short')
    const operation = vi.fn()

    const failure = await runtime.withSession(accountBinding, operation)
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'secure_storage_unavailable' })
    expect(String(failure)).not.toContain('short')
    expect(operation).not.toHaveBeenCalled()
  })

  it('rebuilds a bounded Connector callback failure without retaining a Token echo', async () => {
    const host = fakeProviderCredentialStore()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })
    const binding = { principal, providerInstanceRef, connectionId }
    await runtime.enroll({
      ...binding,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: vi.fn()
    })
    const original = new OpenContentConnectorError(
      'outcome_unknown',
      `Provider echoed ${sessionToken}`
    )

    const failure = await runtime.withSession(binding, () => {
      throw original
    }).catch((error: unknown) => error)

    expect(failure).not.toBe(original)
    expect(failure).toMatchObject({ code: 'outcome_unknown' })
    expect(serializeFailure(failure)).not.toContain(sessionToken)
  })

  it('rejects a successful callback result that echoes the Session Token', async () => {
    const host = fakeProviderCredentialStore()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })
    const binding = { principal, providerInstanceRef, connectionId }
    await runtime.enroll({
      ...binding,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: vi.fn()
    })

    const failure = await runtime.withSession(binding, () => ({
      entries: [{ label: `Provider echoed ${sessionToken}` }]
    })).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(OpenContentConnectorError)
    expect(failure).toMatchObject({ code: 'provider_contract_violation' })
    expect(serializeFailure(failure)).not.toContain(sessionToken)
  })

  it('does not execute custom error getters or retain their Token closure', async () => {
    const host = fakeProviderCredentialStore()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })
    const binding = { principal, providerInstanceRef, connectionId }
    await runtime.enroll({
      ...binding,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: vi.fn()
    })
    let codeReads = 0
    let messageReads = 0
    const hostile = Object.create(OpenContentConnectorError.prototype) as Error
    Object.defineProperties(hostile, {
      code: {
        get: () => {
          codeReads += 1
          return 'cancelled'
        }
      },
      message: {
        get: () => {
          messageReads += 1
          return sessionToken
        }
      }
    })

    const failure = await runtime.withSession(binding, () => {
      throw hostile
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'provider_unavailable' })
    expect(codeReads).toBe(0)
    expect(messageReads).toBe(0)
    expect(serializeFailure(failure)).not.toContain(sessionToken)
  })

  it('preserves a bounded private callback code without retaining its error', async () => {
    const host = fakeProviderCredentialStore()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })
    const binding = { principal, providerInstanceRef, connectionId }
    await runtime.enroll({
      ...binding,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: vi.fn()
    })
    const original = new OpenContentPrivateAccountError(
      'cancelled',
      `Private callback echoed ${sessionToken}`
    )

    const failure = await runtime.withSession(binding, () => {
      throw original
    }).catch((error: unknown) => error)

    expect(failure).not.toBe(original)
    expect(failure).toBeInstanceOf(OpenContentPrivateAccountError)
    expect(failure).toMatchObject({ code: 'cancelled' })
    expect(serializeFailure(failure)).not.toContain(sessionToken)
  })

  it('maps an unknown callback failure to provider_unavailable without copied details', async () => {
    const host = fakeProviderCredentialStore()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })
    const binding = { principal, providerInstanceRef, connectionId }
    await runtime.enroll({
      ...binding,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: vi.fn()
    })
    const original = Object.assign(
      new Error(`Unknown callback echoed ${sessionToken}`),
      {
        cause: { token: sessionToken },
        detail: sessionToken
      }
    )

    const failure = await runtime.withSession(binding, () => {
      throw original
    }).catch((error: unknown) => error)

    expect(failure).not.toBe(original)
    expect(failure).toBeInstanceOf(OpenContentConnectorError)
    expect(failure).toMatchObject({ code: 'provider_unavailable' })
    expect(failure).not.toHaveProperty('cause')
    expect(failure).not.toHaveProperty('detail')
    expect(serializeFailure(failure)).not.toContain(sessionToken)
  })

  it('clears credentials and performs no work when enrollment is already cancelled', async () => {
    const host = fakeProviderCredentialStore()
    const authenticateExistingAccount = vi.fn()
    const observeCurrentExternalAccount = vi.fn()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({
        client: {
          authenticateExistingAccount,
          observeCurrentExternalAccount
        } as unknown as OpenContentClient
      })
    })
    const controller = new AbortController()
    controller.abort()
    const enrollment = enrollmentCredentials()

    await expect(runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      credentials: enrollment,
      signal: controller.signal,
      assertPrincipalCurrent: vi.fn()
    })).rejects.toMatchObject({ code: 'cancelled' })

    expect(enrollment).toEqual({ account: '', password: '' })
    expect(authenticateExistingAccount).not.toHaveBeenCalled()
    expect(observeCurrentExternalAccount).not.toHaveBeenCalled()
    expect(host.replacements).toEqual([])
  })

  it('does not observe or persist a Session when cancelled as authentication completes', async () => {
    const host = fakeProviderCredentialStore()
    const controller = new AbortController()
    const enrollment = enrollmentCredentials()
    const authenticateExistingAccount = vi.fn(async () => {
      controller.abort()
      return Object.freeze({ token: sessionToken })
    })
    const observeCurrentExternalAccount = vi.fn()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({
        client: {
          authenticateExistingAccount,
          observeCurrentExternalAccount
        } as unknown as OpenContentClient
      })
    })

    await expect(runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      credentials: enrollment,
      signal: controller.signal,
      assertPrincipalCurrent: vi.fn()
    })).rejects.toMatchObject({ code: 'cancelled' })

    expect(enrollment).toEqual({ account: '', password: '' })
    expect(observeCurrentExternalAccount).not.toHaveBeenCalled()
    expect(host.replacements).toEqual([])
  })

  it('clears credentials when Provider authentication throws synchronously', async () => {
    const host = fakeProviderCredentialStore()
    const enrollment = enrollmentCredentials()
    const authenticateExistingAccount = vi.fn(() => {
      throw Object.assign(new Error('bounded authentication rejection'), {
        code: 'unauthorized'
      })
    })
    const observeCurrentExternalAccount = vi.fn()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({
        client: {
          authenticateExistingAccount,
          observeCurrentExternalAccount
        } as unknown as OpenContentClient
      })
    })

    await expect(runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      credentials: enrollment,
      assertPrincipalCurrent: vi.fn()
    })).rejects.toMatchObject({ code: 'unauthorized' })

    expect(enrollment).toEqual({ account: '', password: '' })
    expect(observeCurrentExternalAccount).not.toHaveBeenCalled()
    expect(host.replacements).toEqual([])
  })

  it('rejects a stale Principal before Provider authentication with bounded diagnostics', async () => {
    const host = fakeProviderCredentialStore()
    const authenticateExistingAccount = vi.fn()
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: host.credentials,
      getRuntime: () => ({
        client: { authenticateExistingAccount } as unknown as OpenContentClient
      })
    })
    const enrollment = enrollmentCredentials()

    const failure = await runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      credentials: enrollment,
      assertPrincipalCurrent: () => {
        throw new Error('raw stale Principal identity detail')
      }
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'unauthorized' })
    expect(String(failure)).not.toContain('identity detail')
    expect(enrollment).toEqual({ account: '', password: '' })
    expect(authenticateExistingAccount).not.toHaveBeenCalled()
  })

  it('maps raw Host failures to bounded secure-storage diagnostics', async () => {
    const host = fakeProviderCredentialStore()
    const rawDetail = 'raw DPAPI database path and opaque implementation status'
    const failingCredentials: DomainMainProviderCredentialStoreHost = Object.freeze({
      ...host.credentials,
      status: async () => { throw new Error(rawDetail) }
    })
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: failingCredentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })

    const failure = await runtime.status({ principal, providerInstanceRef, connectionId })
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'secure_storage_unavailable' })
    expect(String(failure)).not.toContain(rawDetail)
    expect(String(failure).length).toBeLessThanOrEqual(320)
  })

  it('treats a successful Host replace as the Session commit point', async () => {
    const host = fakeProviderCredentialStore()
    let principalCurrent = true
    const committedCredentials: DomainMainProviderCredentialStoreHost = Object.freeze({
      ...host.credentials,
      replace: async (access, secret) => {
        await host.credentials.replace(access, secret)
        principalCurrent = false
      }
    })
    const runtime = createOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      credentials: committedCredentials,
      getRuntime: () => ({ client: authenticatedClient() })
    })

    await expect(runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      credentials: enrollmentCredentials(),
      assertPrincipalCurrent: () => {
        if (!principalCurrent) throw new Error('Principal changed after commit')
      }
    })).resolves.toBeUndefined()
    expect([...host.records.values()]).toEqual([sessionToken])
  })
})

function enrollmentCredentials() {
  return {
    account: 'synthetic.account',
    password: 'synthetic-password-value'
  }
}

function authenticatedClient(): OpenContentClient {
  return {
    authenticateExistingAccount: vi.fn(async () => Object.freeze({
      token: sessionToken
    })),
    observeCurrentExternalAccount: vi.fn(async () => externalAccount)
  } as unknown as OpenContentClient
}

function providerAccess(): DomainMainProviderCredentialAccess {
  return {
    binding: { providerInstanceRef, connectionId },
    expectedPrincipal: principal
  }
}

function fakeProviderCredentialStore(
  options: Readonly<{
    records?: Map<string, string>
    currentPrincipal?: PrincipalSnapshot
  }> = {}
) {
  const records = options.records ?? new Map<string, string>()
  let currentPrincipal: PrincipalSnapshot | undefined =
    options.currentPrincipal ?? principal
  const replacements: Array<Readonly<{
    access: DomainMainProviderCredentialAccess
    secret: string
  }>> = []
  const accesses: DomainMainProviderCredentialAccess[] = []
  const requests: Array<Readonly<{
    method: 'status' | 'replace' | 'use' | 'remove'
    signal?: AbortSignal
  }>> = []

  const accessContext = (rawAccess: DomainMainProviderCredentialAccess) => {
    const access = domainMainProviderCredentialAccessSchema.parse(rawAccess)
    accesses.push(access)
    if (!currentPrincipal) {
      throw hostCredentialError('principal_unavailable')
    }
    if (!samePrincipal(access.expectedPrincipal, currentPrincipal)) {
      throw hostCredentialError('credential_binding_mismatch')
    }
    const key = JSON.stringify({
      authority: access.expectedPrincipal.authority,
      subject: access.expectedPrincipal.subject,
      assurance: access.expectedPrincipal.assurance,
      deviceId: access.expectedPrincipal.deviceId,
      binding: access.binding
    })
    return { access, key }
  }

  const credentials: DomainMainProviderCredentialStoreHost = Object.freeze({
    status: async (rawAccess, requestOptions) => {
      requests.push({ method: 'status', signal: requestOptions?.signal })
      const { key } = accessContext(rawAccess)
      return records.has(key)
        ? Object.freeze({ state: 'available' as const, recordVersion: 1 as const })
        : Object.freeze({ state: 'absent' as const })
    },
    replace: async (rawAccess, secret, requestOptions) => {
      requests.push({ method: 'replace', signal: requestOptions?.signal })
      const { access, key } = accessContext(rawAccess)
      replacements.push(Object.freeze({ access, secret }))
      records.set(key, secret)
    },
    use: async <T>(rawAccess: DomainMainProviderCredentialAccess, operation: (
      secret: string
    ) => T | Promise<T>, requestOptions?: DomainMainProviderCredentialOperationOptions): Promise<T> => {
      requests.push({ method: 'use', signal: requestOptions?.signal })
      const { key } = accessContext(rawAccess)
      const secret = records.get(key)
      if (secret === undefined) throw hostCredentialError('credential_unavailable')
      try {
        return await operation(secret)
      } catch {
        throw hostOwnedCallbackFailure()
      }
    },
    remove: async (rawAccess, requestOptions) => {
      requests.push({ method: 'remove', signal: requestOptions?.signal })
      const { key } = accessContext(rawAccess)
      records.delete(key)
    }
  })
  return {
    credentials,
    replacements,
    accesses,
    requests,
    records,
    setCurrentPrincipal(next: PrincipalSnapshot | undefined) {
      currentPrincipal = next
    }
  }
}

function samePrincipal(left: PrincipalSnapshot, right: PrincipalSnapshot): boolean {
  return left.authority === right.authority &&
    left.subject === right.subject &&
    left.assurance === right.assurance &&
    left.deviceId === right.deviceId &&
    left.identityVersion === right.identityVersion
}

function hostCredentialError(
  code: ConstructorParameters<typeof DomainMainProviderCredentialError>[0]
): DomainMainProviderCredentialError {
  return new DomainMainProviderCredentialError(code, `raw host ${code} detail`)
}

function hostOwnedCallbackFailure(): Error & Readonly<{ code: string }> {
  return Object.create(Error.prototype, {
    name: {
      value: 'DomainMainProviderCredentialCallbackError',
      enumerable: true
    },
    message: {
      value: 'The provider credential callback failed.',
      enumerable: true
    },
    code: {
      value: 'provider_credential_callback_failed',
      enumerable: true
    }
  }) as Error & Readonly<{ code: string }>
}

async function withSimulatedPlatform<T>(
  platform: NodeJS.Platform,
  operation: () => Promise<T>
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  if (!descriptor) throw new Error('process.platform descriptor is unavailable.')
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform })
  try {
    return await operation()
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

function serializeFailure(failure: unknown): string {
  if (!(failure instanceof Error)) return String(failure)
  return JSON.stringify({
    name: failure.name,
    message: failure.message,
    code: 'code' in failure
      ? (failure as Error & Readonly<{ code?: unknown }>).code
      : undefined
  })
}

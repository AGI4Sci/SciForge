import { describe, expect, it, vi } from 'vitest'

import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'

import type { OpenContentClient } from '../opencontent-client.js'
import type { OpenContentPrivateAccountBinding } from '../private-account-runtime.js'
import { createNativeOpenContentPrivateAccountRuntime } from './index.js'
import type {
  NativeEnrollmentCredentials,
  NativeOpenContentEnrollmentBinding
} from './native-binding.js'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'opencontent-edoc2-demo' as const

const principal = Object.freeze({
  authority: 'https://identity.run0.invalid/realms/sciforge',
  subject: 'synthetic-user-a',
  assurance: 'cloud-authenticated',
  deviceId: 'synthetic-device-a',
  identityVersion: 7
}) satisfies PrincipalSnapshot

const account = Object.freeze({
  id: 'synthetic-external-account-id',
  identityId: 42,
  account: 'synthetic.account',
  name: 'Synthetic Account',
  topPersonalFolderId: '101'
})

const connectionId = 'synthetic-connection-id'
const providerInstanceRef = OPENCONTENT_PROVIDER_INSTANCE_REF

describe('native OpenContent private account runtime', () => {
  it('fails closed outside macOS even when a test binding is supplied', async () => {
    const native = fakeNativeBinding()
    const runtime = createNativeOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      getRuntime: () => ({ client: authenticatedClient() }),
      nativeTestBinding: { platform: 'linux', binding: native.binding }
    })

    await expect(runtime.status(binding())).rejects.toMatchObject({
      code: 'native_enrollment_unavailable'
    })
    expect(native.promptCredentials).not.toHaveBeenCalled()
    expect(native.hasSecret).not.toHaveBeenCalled()
  })

  it('collects credentials natively, stores only the session, and returns metadata only', async () => {
    const credentials: NativeEnrollmentCredentials = {
      username: 'synthetic.account',
      password: 'synthetic-password-value'
    }
    const native = fakeNativeBinding({ credentials })
    const authenticateExistingAccount = vi.fn(async (input: Readonly<{
      username: string
      password: string
      assertPrincipalCurrent(): void | Promise<void>
    }>) => {
      expect(input.username).toBe('synthetic.account')
      expect(input.password).toBe('synthetic-password-value')
      await input.assertPrincipalCurrent()
      return Object.freeze({
        token: 'synthetic-session-token-value',
        account
      })
    })
    const runtime = createNativeOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      getRuntime: () => ({
        client: { authenticateExistingAccount } as unknown as OpenContentClient
      }),
      nativeTestBinding: { platform: 'darwin', binding: native.binding }
    })
    const assertPrincipalCurrent = vi.fn()

    const receipt = await runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      assertPrincipalCurrent
    })

    expect(receipt).toEqual({
      externalAccount: {
        id: account.id,
        identityId: account.identityId,
        account: account.account,
        name: account.name
      }
    })
    expect(JSON.stringify(receipt)).not.toContain('password')
    expect(JSON.stringify(receipt)).not.toContain('session-token')
    expect(native.storeSecret).toHaveBeenCalledOnce()
    expect(native.storeSecret.mock.calls[0]?.[0]).toMatch(/^[0-9a-f]{64}$/u)
    expect(native.storeSecret.mock.calls[0]?.[1]).toBe('synthetic-session-token-value')
    expect(credentials).toEqual({ username: '', password: '' })
    expect(assertPrincipalCurrent).toHaveBeenCalledTimes(4)
  })

  it('derives a stable owner-scoped vault key without identityVersion', async () => {
    const native = fakeNativeBinding()
    const runtime = createNativeOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      getRuntime: () => ({ client: authenticatedClient() }),
      nativeTestBinding: { platform: 'darwin', binding: native.binding }
    })
    const storedBinding = binding()
    const originalKey = await vaultKeyObservedBy(native, storedBinding)
    native.secrets.set(originalKey, 'synthetic-session-token-value')
    native.hasSecret.mockClear()

    await expect(runtime.status({
      ...storedBinding,
      principal: { ...principal, identityVersion: principal.identityVersion + 1 }
    })).resolves.toEqual({ state: 'available' })
    await expect(runtime.status({
      ...storedBinding,
      principal: { ...principal, subject: 'synthetic-user-b' }
    })).resolves.toEqual({ state: 'absent' })

    expect(native.hasSecret.mock.calls[0]?.[0]).toBe(originalKey)
    expect(native.hasSecret.mock.calls[0]?.[0]).not.toBe(
      native.hasSecret.mock.calls[1]?.[0]
    )
  })

  it('leases a session only to a package-internal callback and removes it idempotently', async () => {
    const native = fakeNativeBinding()
    const runtime = createNativeOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      getRuntime: () => ({ client: authenticatedClient() }),
      nativeTestBinding: { platform: 'darwin', binding: native.binding }
    })
    const accountBinding = binding()
    const key = await vaultKeyObservedBy(native, accountBinding)
    native.secrets.set(key, 'synthetic-session-token-value')

    await expect(runtime.withSession(accountBinding, async ({ token }) => ({
      valid: token === 'synthetic-session-token-value'
    }))).resolves.toEqual({ valid: true })

    await runtime.remove(accountBinding)
    await runtime.remove(accountBinding)
    await expect(runtime.status(accountBinding)).resolves.toEqual({ state: 'absent' })
    await expect(runtime.withSession(accountBinding, async () => undefined))
      .rejects.toMatchObject({ code: 'session_unavailable' })
  })

  it('maps native failures to bounded diagnostics without leaking native details', async () => {
    const native = fakeNativeBinding()
    native.hasSecret.mockImplementation(() => {
      throw Object.assign(new Error('raw keychain database path and status'), {
        code: 'unexpected_native_failure'
      })
    })
    const runtime = createNativeOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      getRuntime: () => ({ client: authenticatedClient() }),
      nativeTestBinding: { platform: 'darwin', binding: native.binding }
    })

    const failure = await runtime.status(binding()).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'secure_storage_unavailable' })
    expect(String(failure)).not.toContain('database path')
    expect(String(failure)).not.toContain('status')
  })

  it('does not open the native prompt after cancellation or a stale Principal', async () => {
    const native = fakeNativeBinding()
    const runtime = createNativeOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      getRuntime: () => ({ client: authenticatedClient() }),
      nativeTestBinding: { platform: 'darwin', binding: native.binding }
    })
    const controller = new AbortController()
    controller.abort()

    await expect(runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      signal: controller.signal,
      assertPrincipalCurrent: vi.fn()
    })).rejects.toMatchObject({ code: 'cancelled' })
    await expect(runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      assertPrincipalCurrent: () => { throw new Error('stale identity detail') }
    })).rejects.toMatchObject({ code: 'unauthorized' })
    expect(native.promptCredentials).not.toHaveBeenCalled()
  })

  it('allows only one active enrollment invocation', async () => {
    const native = fakeNativeBinding()
    let finishAuthentication!: () => void
    const authenticateExistingAccount = vi.fn(() => new Promise<Readonly<{
      token: string
      account: typeof account
    }>>((resolve) => {
      finishAuthentication = () => resolve(Object.freeze({
        token: 'synthetic-session-token-value',
        account
      }))
    }))
    const runtime = createNativeOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      getRuntime: () => ({
        client: { authenticateExistingAccount } as unknown as OpenContentClient
      }),
      nativeTestBinding: { platform: 'darwin', binding: native.binding }
    })
    const first = runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      assertPrincipalCurrent: vi.fn()
    })
    await vi.waitFor(() => expect(authenticateExistingAccount).toHaveBeenCalledOnce())

    await expect(runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId: 'synthetic-connection-id-2',
      assertPrincipalCurrent: vi.fn()
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(native.promptCredentials).toHaveBeenCalledOnce()

    finishAuthentication()
    await expect(first).resolves.toMatchObject({
      externalAccount: { id: account.id }
    })
  })

  it('maps native user cancellation and rejects a different installed Provider instance', async () => {
    const cancelledNative = fakeNativeBinding({ credentials: null })
    const authenticateExistingAccount = vi.fn()
    const runtime = createNativeOpenContentPrivateAccountRuntime({
      providerInstanceRef,
      getRuntime: () => ({
        client: { authenticateExistingAccount } as unknown as OpenContentClient
      }),
      nativeTestBinding: { platform: 'darwin', binding: cancelledNative.binding }
    })

    await expect(runtime.enroll({
      principal,
      providerInstanceRef,
      connectionId,
      assertPrincipalCurrent: vi.fn()
    })).rejects.toMatchObject({ code: 'cancelled' })
    await expect(runtime.status({
      ...binding(),
      providerInstanceRef: 'another-installed-provider'
    })).rejects.toMatchObject({ code: 'binding_mismatch' })
    expect(authenticateExistingAccount).not.toHaveBeenCalled()
  })
})

function binding(): OpenContentPrivateAccountBinding {
  return Object.freeze({ principal, providerInstanceRef, connectionId })
}

function authenticatedClient(): OpenContentClient {
  return {
    authenticateExistingAccount: vi.fn(async () => Object.freeze({
      token: 'synthetic-session-token-value',
      account
    }))
  } as unknown as OpenContentClient
}

function fakeNativeBinding(options: Readonly<{
  credentials?: NativeEnrollmentCredentials | null
}> = {}) {
  const secrets = new Map<string, string>()
  const promptCredentials = vi.fn(() => Object.hasOwn(options, 'credentials')
    ? options.credentials ?? null
    : {
        username: 'synthetic.account',
        password: 'synthetic-password-value'
      })
  const storeSecret = vi.fn((key: string, secret: string) => {
    secrets.set(key, secret)
  })
  const hasSecret = vi.fn((key: string) => secrets.has(key))
  const readSecret = vi.fn((key: string) => secrets.get(key) ?? null)
  const deleteSecret = vi.fn((key: string) => {
    secrets.delete(key)
  })
  const binding: NativeOpenContentEnrollmentBinding = Object.freeze({
    isAvailable: () => true,
    promptCredentials,
    storeSecret,
    hasSecret,
    readSecret,
    deleteSecret
  })
  return {
    binding,
    secrets,
    promptCredentials,
    storeSecret,
    hasSecret,
    readSecret,
    deleteSecret
  }
}

/** Obtains the runtime's opaque key without duplicating its derivation in the test. */
async function vaultKeyObservedBy(
  native: ReturnType<typeof fakeNativeBinding>,
  accountBinding: OpenContentPrivateAccountBinding
): Promise<string> {
  const runtime = createNativeOpenContentPrivateAccountRuntime({
    providerInstanceRef,
    getRuntime: () => ({ client: authenticatedClient() }),
    nativeTestBinding: { platform: 'darwin', binding: native.binding }
  })
  await runtime.status(accountBinding)
  const key = native.hasSecret.mock.calls.at(-1)?.[0]
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/u.test(key)) {
    throw new Error('Synthetic native binding did not observe a vault key.')
  }
  return key
}

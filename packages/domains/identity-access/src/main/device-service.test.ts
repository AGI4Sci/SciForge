import { describe, expect, it, vi } from 'vitest'
import { verifiedOidcClaimsSchema, type Device } from '@sciforge/collaboration-contracts'
import type { CollaborationIdentityClient, IdentityAccessContext } from '@sciforge/collaboration-identity'
import { InMemoryCollaborationIdentityClient } from '@sciforge/collaboration-identity/testing'
import type { DesktopIdentityStatus } from '../contract.js'
import { DesktopDeviceService, cloudInstallationId } from './device-service.js'

function memorySecrets() {
  const values = new Map<string, string>()
  return {
    has: vi.fn(async (key: string) => values.has(key)),
    read: vi.fn(async (key: string) => values.get(key) ?? null),
    write: vi.fn(async (key: string, value: string) => {
      values.set(key, value)
    }),
    remove: vi.fn(async (key: string) => {
      values.delete(key)
    }),
    value: (key: string) => values.get(key) ?? null
  }
}

function signedInStatus(
  userId: string,
  oidcIdentityId: string,
  subject = 'keycloak-user-001'
): DesktopIdentityStatus {
  return {
    state: 'signed-in',
    user: {
      userId,
      oidcIdentityId,
      issuer: 'https://login.sciforge.example/realms/SciForge',
      subject,
      displayName: 'Researcher One',
      email: 'researcher@example.invalid'
    },
    accessTokenExpiresAt: '2027-08-19T00:00:00.000Z'
  }
}

function identityHarness(initialStatus: DesktopIdentityStatus, initialToken: string | null) {
  let status = initialStatus
  let token = initialToken
  const listeners = new Set<(next: DesktopIdentityStatus) => void>()
  return {
    identity: {
      getStatus: () => status,
      getAccessToken: () => status.state === 'signed-in' ? token : null,
      subscribe: (listener: (next: DesktopIdentityStatus) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    },
    setStatus(next: DesktopIdentityStatus, nextToken: string | null = null) {
      status = next
      token = nextToken
      for (const listener of listeners) listener(status)
    }
  }
}

function clientStub(overrides: Record<string, unknown> = {}): CollaborationIdentityClient {
  return {
    getCurrentUser: vi.fn(),
    listDevices: vi.fn(async () => ({ devices: [] })),
    createDeviceEnrollment: vi.fn(),
    createDevice: vi.fn(),
    revokeDevice: vi.fn(),
    ...overrides
  } as unknown as CollaborationIdentityClient
}

function cloudDevice(
  status: 'active' | 'revoked',
  userId = 'usr_CloudUser000001'
): Device {
  return {
    deviceId: 'dev_CloudDevice0001',
    userId,
    installationId: cloudInstallationId('sciforge-local-installation'),
    displayName: 'Lab Desktop',
    status,
    platform: { os: 'windows', arch: 'x64', osVersion: '11', appVersion: '0.2.17' },
    activatedAt: '2026-08-18T12:00:00.000Z',
    ...(status === 'revoked' ? { revokedAt: '2026-08-18T12:01:00.000Z' } : {})
  } as unknown as Device
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

describe('DesktopDeviceService', () => {
  it('registers an Ed25519 Desktop through the owner-scoped secret port and revokes it', async () => {
    const client = new InMemoryCollaborationIdentityClient()
    const token = 'local-access-token'
    const current = await client.getCurrentUser({
      accessToken: token,
      verifiedClaims: verifiedOidcClaimsSchema.parse({
        type: 'verified_oidc_claims',
        issuer: 'https://login.sciforge.example/realms/SciForge',
        subject: 'keycloak-user-001',
        audiences: ['sciforge-cloud-api'],
        issuedAt: '2026-08-19T00:00:00.000Z',
        expiresAt: '2027-08-19T00:00:00.000Z',
        email: 'researcher@example.invalid',
        displayName: 'Researcher One'
      })
    })
    const status = signedInStatus(current.userId, current.oidcIdentityId)
    const secrets = memorySecrets()
    const service = new DesktopDeviceService({
      identity: {
        getStatus: () => status,
        getAccessToken: () => token,
        subscribe: () => () => undefined
      },
      client,
      installationSeed: 'sciforge-local-installation',
      secrets,
      appVersion: '0.2.17',
      platform: 'win32',
      architecture: 'x64',
      osVersion: '11',
      displayName: 'Lab Desktop'
    })

    const enrolled = await service.ensureRegistered()
    expect(enrolled.ok, enrolled.ok ? undefined : enrolled.message).toBe(true)
    expect(enrolled.status).toMatchObject({ state: 'active' })
    expect(enrolled.devices).toHaveLength(1)
    expect(enrolled.devices[0]).toMatchObject({
      displayName: 'Lab Desktop',
      status: 'active',
      platform: { os: 'windows', arch: 'x64' }
    })
    expect(secrets.write).toHaveBeenCalledOnce()

    const registration = client.adapter.getDesktopDeviceRegistration(enrolled.devices[0]!.deviceId)
    expect(registration.publicKey).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA' })
    expect(registration.publicKey).not.toHaveProperty('d')
    expect(JSON.parse(secrets.value('device.key') ?? '{}')).toMatchObject({
      version: 1,
      publicKey: { kty: 'OKP', crv: 'Ed25519' },
      privateKey: { kty: 'OKP', crv: 'Ed25519' }
    })

    const revoked = await service.revoke(enrolled.devices[0]!.deviceId)
    expect(revoked.ok).toBe(true)
    expect(revoked.status).toMatchObject({ state: 'revoked' })
    expect(revoked.devices[0]?.status).toBe('revoked')
    service.close()
  })

  it('derives a stable cloud installation ID from the existing Desktop installation seed', () => {
    expect(cloudInstallationId('sciforge-local-installation')).toBe(
      cloudInstallationId('sciforge-local-installation')
    )
    expect(cloudInstallationId('sciforge-local-installation')).toMatch(/^ins_[a-f0-9]{32}$/u)
  })

  it.each(['enrollment', 'refresh'] as const)(
    'discards a deferred %s result after logout',
    async (operationKind) => {
      const listed = deferred<{ devices: Device[] }>()
      const identity = identityHarness(
        signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
        'access-token-one'
      )
      const linkDevice = vi.fn()
      const states: string[] = []
      const service = new DesktopDeviceService({
        identity: identity.identity,
        client: clientStub({ listDevices: vi.fn(() => listed.promise) }),
        installationSeed: 'sciforge-local-installation',
        secrets: memorySecrets(),
        appVersion: '0.2.17',
        linkDevice
      })
      service.subscribe((status) => states.push(status.state))

      const operation = operationKind === 'enrollment'
        ? service.ensureRegistered()
        : service.refresh()
      identity.setStatus({ state: 'signed-out' })
      listed.resolve({ devices: [cloudDevice('active')] })

      await operation
      expect(service.getStatus()).toEqual({ state: 'signed-out' })
      expect(service.listDevices()).toEqual([])
      expect(linkDevice).not.toHaveBeenCalled()
      expect(states).not.toContain('active')
      service.close()
    }
  )

  it('lets a new account proceed without waiting for an old account operation', async () => {
    const firstAccount = deferred<{ devices: Device[] }>()
    const secondAccount = deferred<{ devices: Device[] }>()
    const listDevices = vi.fn((context: IdentityAccessContext) => (
      context.accessToken === 'access-token-one' ? firstAccount.promise : secondAccount.promise
    ))
    const identity = identityHarness(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001', 'keycloak-user-001'),
      'access-token-one'
    )
    const linkDevice = vi.fn()
    const states: string[] = []
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({ listDevices }),
      installationSeed: 'sciforge-local-installation',
      secrets: memorySecrets(),
      appVersion: '0.2.17',
      linkDevice
    })
    service.subscribe((status) => states.push(status.state))

    const oldOperation = service.ensureRegistered()
    identity.setStatus(
      signedInStatus('usr_CloudUser000002', 'oid_CloudIdent0002', 'keycloak-user-002'),
      'access-token-two'
    )
    const newOperation = service.ensureRegistered()
    expect(listDevices).toHaveBeenCalledTimes(2)

    firstAccount.resolve({ devices: [cloudDevice('active', 'usr_CloudUser000001')] })
    await oldOperation
    expect(service.getStatus()).toEqual({ state: 'not-enrolled' })
    expect(linkDevice).not.toHaveBeenCalled()
    expect(states).not.toContain('active')

    service.close()
    secondAccount.resolve({ devices: [cloudDevice('active', 'usr_CloudUser000002')] })
    await newOperation
    expect(service.getStatus()).toEqual({ state: 'signed-out' })
    expect(linkDevice).not.toHaveBeenCalled()
  })

  it('does not publish or link a result that completes after close', async () => {
    const listed = deferred<{ devices: Device[] }>()
    const identity = identityHarness(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
      'access-token-one'
    )
    const linkDevice = vi.fn()
    const listener = vi.fn()
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({ listDevices: vi.fn(() => listed.promise) }),
      installationSeed: 'sciforge-local-installation',
      secrets: memorySecrets(),
      appVersion: '0.2.17',
      linkDevice
    })
    service.subscribe(listener)

    const refresh = service.refresh()
    service.close()
    listed.resolve({ devices: [cloudDevice('active')] })

    await refresh
    expect(service.getStatus()).toEqual({ state: 'signed-out' })
    expect(linkDevice).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('discards a deferred revoke response after logout', async () => {
    const revoked = deferred<unknown>()
    const listDevices = vi.fn()
    const identity = identityHarness(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
      'access-token-one'
    )
    const linkDevice = vi.fn()
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({
        listDevices,
        revokeDevice: vi.fn(() => revoked.promise)
      }),
      installationSeed: 'sciforge-local-installation',
      secrets: memorySecrets(),
      appVersion: '0.2.17',
      linkDevice
    })

    const operation = service.revoke('dev_CloudDevice0001')
    identity.setStatus({ state: 'signed-out' })
    revoked.resolve({})

    await operation
    expect(service.getStatus()).toEqual({ state: 'signed-out' })
    expect(listDevices).not.toHaveBeenCalled()
    expect(linkDevice).not.toHaveBeenCalled()
    service.close()
  })

  it.each(['refresh', 'enrollment'] as const)(
    'keeps revoke authoritative over an older deferred %s snapshot',
    async (operationKind) => {
      const oldSnapshot = deferred<{ devices: Device[] }>()
      const revokedDevice = cloudDevice('revoked')
      const listDevices = vi.fn()
        .mockImplementationOnce(() => oldSnapshot.promise)
        .mockResolvedValueOnce({ devices: [revokedDevice] })
      const identity = identityHarness(
        signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
        'access-token-one'
      )
      const linkDevice = vi.fn()
      const service = new DesktopDeviceService({
        identity: identity.identity,
        client: clientStub({
          listDevices,
          revokeDevice: vi.fn(async () => ({}))
        }),
        installationSeed: 'sciforge-local-installation',
        secrets: memorySecrets(),
        appVersion: '0.2.17',
        linkDevice
      })

      const staleOperation = operationKind === 'refresh'
        ? service.refresh()
        : service.ensureRegistered()
      const revoke = service.revoke('dev_CloudDevice0001')

      await expect(revoke).resolves.toMatchObject({
        ok: true,
        status: { state: 'revoked' }
      })
      oldSnapshot.resolve({ devices: [cloudDevice('active')] })
      await staleOperation

      expect(service.getStatus()).toMatchObject({ state: 'revoked' })
      expect(linkDevice.mock.calls.map(([device]) => device.status)).toEqual(['revoked'])
      service.close()
    }
  )
})

import { createPublicKey, verify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  canonicalDeviceFactAttestationBytes,
  canonicalEnrollmentBytes,
  type Device,
  type DeviceCreateRequest
} from '@sciforge/collaboration-contracts'
import type { DesktopIdentityStatus } from '../contract.js'
import {
  CloudIdentityClientError,
  type CloudIdentityAccessContext,
  type CloudIdentityClient
} from './cloud-identity-client.js'
import { DesktopDeviceService, cloudInstallationId } from './device-service.js'

function memoryVault() {
  const values = new Map<string, string>()
  const key = (ref: Readonly<{ kind: string; agentId?: string }>) =>
    `${ref.kind}:${ref.agentId ?? ''}`
  return {
    has: vi.fn(async (ref: Readonly<{ kind: string; agentId?: string }>) => values.has(key(ref))),
    read: vi.fn(async (ref: Readonly<{ kind: string; agentId?: string }>) => values.get(key(ref)) ?? null),
    write: vi.fn(async (ref: Readonly<{ kind: string; agentId?: string }>, value: string) => {
      values.set(key(ref), value)
    }),
    remove: vi.fn(async (ref: Readonly<{ kind: string; agentId?: string }>) => {
      values.delete(key(ref))
    }),
    value: (ref: Readonly<{ kind: string; agentId?: string }>) => values.get(key(ref)) ?? null
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
  let renewals = 0
  const listeners = new Set<(next: DesktopIdentityStatus) => void>()
  return {
    identity: {
      getStatus: () => status,
      getAccessToken: () => status.state === 'signed-in' ? token : null,
      renewAccessToken: async (rejected: string) => {
        if (token && token !== rejected) return token
        renewals += 1
        token = `renewed-${renewals}`
        return token
      },
      subscribe: (listener: (next: DesktopIdentityStatus) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    },
    renewals: () => renewals,
    setStatus(next: DesktopIdentityStatus, nextToken: string | null = null) {
      status = next
      token = nextToken
      for (const listener of listeners) listener(status)
    }
  }
}

function clientStub(overrides: Record<string, unknown> = {}): CloudIdentityClient {
  return {
    getCurrentUser: vi.fn(),
    listDevices: vi.fn(async () => ({ devices: [] })),
    createDeviceEnrollment: vi.fn(),
    createDevice: vi.fn(),
    revokeDevice: vi.fn(),
    ...overrides
  } as unknown as CloudIdentityClient
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

/**
 * A signed-in Desktop that enrolled its exact Device and stored its signing
 * key, plus the Cloud read/write doubles used by each scenario.
 */
function enrolledDeviceWorld() {
  const enrollment = {
    enrollmentId: 'enr_Enrollment0001',
    nonce: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    expiresAt: '2030-08-19T00:05:00.000Z'
  }
  let currentDevice: Device | null = null
  const listDevices = vi.fn(async (_context: CloudIdentityAccessContext) => ({
    devices: currentDevice ? [currentDevice] : []
  }))
  const createDevice = vi.fn(async (
    _context: CloudIdentityAccessContext,
    input: DeviceCreateRequest
  ) => {
    currentDevice = {
      schemaVersion: 1,
      type: 'device',
      deviceId: 'dev_CloudDevice0001',
      userId: 'usr_CloudUser000001',
      installationId: input.installationId,
      displayName: input.displayName,
      platform: input.platform,
      publicKeyJwk: input.publicKeyJwk,
      capabilitySummary: input.capabilitySummary,
      status: 'active',
      revision: 1,
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z'
    } as unknown as Device
    return currentDevice
  })
  const identity = identityHarness(
    signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
    'access-token-one'
  )
  const vault = memoryVault()
  const service = new DesktopDeviceService({
    identity: identity.identity,
    client: clientStub({
      listDevices,
      createDeviceEnrollment: vi.fn(async () => enrollment),
      createDevice
    }),
    installationSeed: 'sciforge-local-installation',
    vault,
    appVersion: '0.2.17',
    now: () => Date.parse('2026-08-19T00:02:00.000Z')
  })
  return {
    service,
    identity,
    vault,
    listDevices,
    createDevice,
    currentDevice: () => currentDevice,
    async enroll() {
      const result = await service.ensureRegistered()
      if (!result.ok) throw new Error(`Enrollment failed: ${result.message}`)
      return result
    }
  }
}

const signingRequest = {
  purpose: 'worker-delivery-review',
  factDigest: 'a'.repeat(64),
  factRevision: 3,
  observedAt: '2026-08-19T00:01:30.000Z'
} as const

describe('DesktopDeviceService', () => {
  it.each([
    'worker-delivery-review',
    'project-completion-approval'
  ] as const)('signs %s with the enrolled private key and enforces revocation', async (purpose) => {
    const token = 'local-access-token'
    const userId = 'usr_CloudUser000001'
    const enrollment = {
      enrollmentId: 'enr_Enrollment0001',
      nonce: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
      expiresAt: '2027-08-19T00:05:00.000Z'
    }
    let currentDevice: Device | null = null
    const listDevices = vi.fn(async () => ({ devices: currentDevice ? [currentDevice] : [] }))
    const createDevice = vi.fn(async (
      _context: CloudIdentityAccessContext,
      input: DeviceCreateRequest
    ) => {
      const valid = verify(
        null,
        canonicalEnrollmentBytes({
          enrollmentId: enrollment.enrollmentId,
          nonce: enrollment.nonce,
          userId,
          installationId: input.installationId,
          expiresAt: enrollment.expiresAt
        }),
        createPublicKey({ key: input.publicKeyJwk, format: 'jwk' }),
        Buffer.from(input.signature, 'base64url')
      )
      expect(valid).toBe(true)
      currentDevice = {
        schemaVersion: 1,
        type: 'device',
        deviceId: 'dev_CloudDevice0001',
        userId,
        installationId: input.installationId,
        displayName: input.displayName,
        platform: input.platform,
        publicKeyJwk: input.publicKeyJwk,
        capabilitySummary: input.capabilitySummary,
        status: 'active',
        revision: 1,
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T00:00:00.000Z'
      } as unknown as Device
      return currentDevice
    })
    const client = clientStub({
      listDevices,
      createDeviceEnrollment: vi.fn(async () => enrollment),
      createDevice,
      revokeDevice: vi.fn(async () => {
        currentDevice = {
          ...currentDevice!,
          status: 'revoked',
          revision: 2,
          updatedAt: '2026-08-19T00:01:00.000Z',
          revokedAt: '2026-08-19T00:01:00.000Z'
        }
        return currentDevice
      })
    })
    const status = signedInStatus(userId, 'oid_CloudIdent0001')
    const vault = memoryVault()
    const service = new DesktopDeviceService({
      identity: {
        getStatus: () => status,
        getAccessToken: () => token,
        renewAccessToken: async () => { throw new Error('Device signing does not renew here.') },
        subscribe: () => () => undefined
      },
      client,
      installationSeed: 'sciforge-local-installation',
      vault,
      appVersion: '0.2.17',
      platform: 'win32',
      architecture: 'x64',
      osVersion: '11',
      displayName: 'Lab Desktop',
      now: () => Date.parse('2026-08-19T00:02:00.000Z')
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
    expect(vault.write).toHaveBeenCalledOnce()

    const createInput = createDevice.mock.calls[0]?.[1]
    expect(createInput?.publicKeyJwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA' })
    expect(createInput?.publicKeyJwk).not.toHaveProperty('d')
    expect(JSON.parse(vault.value({ kind: 'device-key' }) ?? '{}')).toMatchObject({
      version: 1,
      publicKey: { kty: 'OKP', crv: 'Ed25519' },
      privateKey: { kty: 'OKP', crv: 'Ed25519' }
    })

    const factDigest = 'a'.repeat(64)
    const signed = await service.signDeviceFactAttestation({
      purpose,
      factDigest,
      factRevision: 3,
      observedAt: '2026-08-19T00:01:30.000Z'
    })
    expect(signed).toMatchObject({
      purpose,
      userId,
      deviceId: 'dev_CloudDevice0001',
      deviceKeyId: createInput?.publicKeyJwk.kid,
      deviceKeyRevision: 1,
      signatureAlgorithm: 'Ed25519',
      canonicalPayloadDigest: factDigest,
      factRevision: 3,
      observedAt: '2026-08-19T00:01:30.000Z',
      issuedAt: '2026-08-19T00:02:00.000Z'
    })
    expect(listDevices).toHaveBeenCalledTimes(3)
    expect(verify(
      null,
      canonicalDeviceFactAttestationBytes(signed),
      createPublicKey({ key: createInput!.publicKeyJwk, format: 'jwk' }),
      Buffer.from(signed.signature, 'base64url')
    )).toBe(true)
    expect(verify(
      null,
      canonicalDeviceFactAttestationBytes({
        ...signed,
        purpose: purpose === 'worker-delivery-review'
          ? 'project-completion-approval'
          : 'worker-delivery-review'
      }),
      createPublicKey({ key: createInput!.publicKeyJwk, format: 'jwk' }),
      Buffer.from(signed.signature, 'base64url')
    )).toBe(false)
    expect(signed).not.toHaveProperty('accessToken')
    expect(signed).not.toHaveProperty('privateKey')

    const enrolledDevice = currentDevice as unknown as Device
    currentDevice = {
      ...enrolledDevice,
      revision: 2,
      updatedAt: '2026-08-19T00:02:30.000Z',
      publicKeyJwk: { ...enrolledDevice.publicKeyJwk, kid: 'device-rotated-key' }
    }
    await expect(service.signDeviceFactAttestation({
      purpose,
      factDigest,
      factRevision: 4,
      observedAt: '2026-08-19T00:01:30.000Z'
    })).rejects.toMatchObject({ code: 'device_key_mismatch' })
    currentDevice = enrolledDevice

    const revoked = await service.revoke(enrolled.devices[0]!.deviceId)
    expect(revoked.ok).toBe(true)
    expect(revoked.status).toMatchObject({ state: 'revoked' })
    expect(revoked.devices[0]?.status).toBe('revoked')
    await expect(service.signDeviceFactAttestation({
      purpose,
      factDigest,
      factRevision: 5,
      observedAt: '2026-08-19T00:01:30.000Z'
    })).rejects.toMatchObject({ code: 'device_revoked' })
    service.close()
  })

  it('derives a stable cloud installation ID from the existing Desktop installation seed', () => {
    expect(cloudInstallationId('sciforge-local-installation')).toBe(
      cloudInstallationId('sciforge-local-installation')
    )
    expect(cloudInstallationId('sciforge-local-installation')).toMatch(/^ins_[a-f0-9]{32}$/u)
  })

  it('fails closed before Cloud refresh when no OIDC User is current', async () => {
    const listDevices = vi.fn()
    const identity = identityHarness({ state: 'signed-out' }, null)
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({ listDevices }),
      installationSeed: 'sciforge-local-installation',
      vault: memoryVault(),
      appVersion: '0.2.17'
    })

    await expect(service.signDeviceFactAttestation({
      purpose: 'project-completion-approval',
      factDigest: 'c'.repeat(64),
      factRevision: 1,
      observedAt: '2026-08-19T00:00:00.000Z'
    })).rejects.toMatchObject({ code: 'identity_required' })
    expect(listDevices).not.toHaveBeenCalled()
    service.close()
  })

  it('keeps the ACTIVE Device lease stable across a same-User token refresh', async () => {
    const listDevices = vi.fn(async (_context: CloudIdentityAccessContext) => ({
      devices: [cloudDevice('active')]
    }))
    const identity = identityHarness(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
      'access-token-one'
    )
    const states: string[] = []
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({ listDevices }),
      installationSeed: 'sciforge-local-installation',
      vault: memoryVault(),
      appVersion: '0.2.17'
    })
    service.subscribe((status) => states.push(status.state))

    await expect(service.ensureRegistered()).resolves.toMatchObject({
      ok: true,
      status: { state: 'active' }
    })
    const revalidated = deferred<void>()
    states.length = 0
    const disposeRevalidation = service.subscribe((status) => {
      if (status.state === 'active') revalidated.resolve()
    })

    identity.setStatus(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
      'access-token-two'
    )

    expect(service.getStatus()).toMatchObject({ state: 'active' })
    expect(states).toEqual([])
    await revalidated.promise
    expect(listDevices.mock.calls.map(([context]) => context.accessToken)).toEqual([
      'access-token-one',
      'access-token-two'
    ])
    expect(states).toEqual(['active'])
    disposeRevalidation()
    service.close()
  })

  it('automatically drops the ACTIVE Device lease when token refresh finds it revoked', async () => {
    const listDevices = vi.fn()
      .mockResolvedValueOnce({ devices: [cloudDevice('active')] })
      .mockResolvedValueOnce({ devices: [cloudDevice('revoked')] })
      .mockResolvedValue({ devices: [cloudDevice('revoked')] })
    const identity = identityHarness(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
      'access-token-one'
    )
    const states: string[] = []
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({ listDevices }),
      installationSeed: 'sciforge-local-installation',
      vault: memoryVault(),
      appVersion: '0.2.17'
    })

    await expect(service.ensureRegistered()).resolves.toMatchObject({
      ok: true,
      status: { state: 'active' }
    })
    const revalidated = deferred<void>()
    const disposeRevalidation = service.subscribe((status) => {
      states.push(status.state)
      if (status.state === 'revoked') revalidated.resolve()
    })

    identity.setStatus(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
      'access-token-two'
    )

    await revalidated.promise
    // The status listener observes the result before the Cloud read settles;
    // let the in-flight revalidation finish so signing revalidates on its own.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listDevices.mock.calls.map(([context]) => context.accessToken)).toEqual([
      'access-token-one',
      'access-token-two'
    ])
    expect(service.getStatus()).toMatchObject({ state: 'revoked' })
    expect(states).toEqual(['revoked'])
    await expect(service.signDeviceFactAttestation({
      purpose: 'project-completion-approval',
      factDigest: 'b'.repeat(64),
      factRevision: 2,
      observedAt: '2026-08-19T00:00:00.000Z'
    })).rejects.toMatchObject({ code: 'device_revoked' })
    expect(listDevices.mock.calls.map(([context]) => context.accessToken)).toEqual([
      'access-token-one',
      'access-token-two',
      'access-token-two'
    ])
    disposeRevalidation()
    service.close()
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
        vault: memoryVault(),
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
    const listDevices = vi.fn((context: CloudIdentityAccessContext) => (
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
      vault: memoryVault(),
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

  it('shares one Cloud read across concurrent revalidations and fact signings', async () => {
    const world = enrolledDeviceWorld()
    try {
      await world.enroll()
      world.listDevices.mockClear()
      const listed = deferred<{ devices: Device[] }>()
      world.listDevices.mockImplementationOnce(() => listed.promise)

      const revalidations = [
        world.service.refresh(),
        world.service.refresh(),
        world.service.refresh()
      ]
      const signatures = [
        world.service.signDeviceFactAttestation(signingRequest),
        world.service.signDeviceFactAttestation({ ...signingRequest, factRevision: 4 })
      ]

      // The first revalidation owns the Cloud read; every later caller joins it.
      expect(world.listDevices).toHaveBeenCalledOnce()
      listed.resolve({ devices: [world.currentDevice()!] })

      const results = await Promise.all([...revalidations, ...signatures])
      const refreshResults = results.slice(0, 3)
      for (const result of refreshResults) {
        expect(result).toMatchObject({ ok: true, status: { state: 'active' } })
      }
      expect(results.slice(3)).toEqual([
        expect.objectContaining({
          purpose: 'worker-delivery-review',
          deviceId: 'dev_CloudDevice0001',
          deviceKeyRevision: 1,
          factRevision: 3
        }),
        expect.objectContaining({
          purpose: 'worker-delivery-review',
          deviceId: 'dev_CloudDevice0001',
          deviceKeyRevision: 1,
          factRevision: 4
        })
      ])
      expect(world.listDevices).toHaveBeenCalledOnce()
    } finally {
      world.service.close()
    }
  })

  it('keeps a later revalidation from superseding an attestation that is signing', async () => {
    const world = enrolledDeviceWorld()
    const keyReadStarted = deferred<void>()
    const keyReadGate = deferred<void>()
    const storedRead = world.vault.read
    let holdKeyRead = false
    world.vault.read = vi.fn(async (ref: Readonly<{ kind: string; agentId?: string }>) => {
      if (holdKeyRead && ref.kind === 'device-key') {
        keyReadStarted.resolve()
        await keyReadGate.promise
      }
      return storedRead(ref)
    })
    try {
      await world.enroll()
      world.listDevices.mockClear()

      // The attested fact is signed from a lease that the ongoing dashboard
      // revalidation must not invalidate.
      holdKeyRead = true
      const signing = world.service.signDeviceFactAttestation(signingRequest)
      await keyReadStarted.promise
      await expect(world.service.refresh()).resolves.toMatchObject({
        ok: true,
        status: { state: 'active' }
      })
      keyReadGate.resolve()

      await expect(signing).resolves.toMatchObject({
        deviceId: 'dev_CloudDevice0001',
        deviceKeyRevision: 1,
        signatureAlgorithm: 'Ed25519'
      })
      expect(world.listDevices).toHaveBeenCalledTimes(2)
    } finally {
      keyReadGate.resolve()
      world.service.close()
    }
  })

  it('keeps an old Account revalidation stale when the signed-in User changes', async () => {
    const firstAccount = deferred<{ devices: Device[] }>()
    const secondAccount = deferred<{ devices: Device[] }>()
    const identity = identityHarness(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001', 'keycloak-user-001'),
      'access-token-one'
    )
    const linkDevice = vi.fn()
    const listDevices = vi.fn((context: CloudIdentityAccessContext) => (
      context.accessToken === 'access-token-one' ? firstAccount.promise : secondAccount.promise
    ))
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({ listDevices }),
      installationSeed: 'sciforge-local-installation',
      vault: memoryVault(),
      appVersion: '0.2.17',
      linkDevice
    })
    try {
      const oldRevalidation = service.refresh()
      identity.setStatus(
        signedInStatus('usr_CloudUser000002', 'oid_CloudIdent0002', 'keycloak-user-002'),
        'access-token-two'
      )
      const newRevalidation = service.refresh()

      firstAccount.resolve({ devices: [cloudDevice('active', 'usr_CloudUser000001')] })
      await expect(oldRevalidation).resolves.toMatchObject({
        ok: false,
        message: 'The Desktop Device operation was superseded by an identity change.'
      })
      expect(linkDevice).not.toHaveBeenCalled()

      secondAccount.resolve({ devices: [cloudDevice('active', 'usr_CloudUser000002')] })
      await expect(newRevalidation).resolves.toMatchObject({
        ok: true,
        status: { state: 'active' }
      })
      expect(service.getStatus()).toMatchObject({
        state: 'active',
        device: { deviceId: 'dev_CloudDevice0001' }
      })
    } finally {
      service.close()
    }
  })

  it('does not let a same-User token refresh supersede an in-flight enrollment', async () => {
    const world = enrolledDeviceWorld()
    const listed = deferred<{ devices: Device[] }>()
    world.listDevices.mockImplementationOnce(() => listed.promise)
    try {
      const enrolling = world.service.ensureRegistered()
      // A renewed access token for the same OIDC User revalidates the Device
      // through the identity subscription while enrollment is still running.
      world.identity.setStatus(
        signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
        'access-token-two'
      )
      expect(world.listDevices).toHaveBeenCalledOnce()

      listed.resolve({ devices: [] })
      await expect(enrolling).resolves.toMatchObject({
        ok: true,
        status: { state: 'active' }
      })
      expect(world.createDevice).toHaveBeenCalledOnce()
      expect(world.listDevices).toHaveBeenCalledTimes(2)
      expect(world.service.getStatus()).toMatchObject({
        state: 'active',
        device: { deviceId: 'dev_CloudDevice0001' }
      })
    } finally {
      world.service.close()
    }
  })

  it('waits for a running revalidation before enrolling instead of superseding it', async () => {
    const world = enrolledDeviceWorld()
    try {
      await world.enroll()
      world.listDevices.mockClear()
      world.createDevice.mockClear()
      const listed = deferred<{ devices: Device[] }>()
      world.listDevices.mockImplementationOnce(() => listed.promise)

      const revalidation = world.service.refresh()
      const enrollment = world.service.ensureRegistered()
      listed.resolve({ devices: [world.currentDevice()!] })

      await expect(revalidation).resolves.toMatchObject({ ok: true })
      await expect(enrollment).resolves.toMatchObject({
        ok: true,
        status: { state: 'active' }
      })
      expect(world.createDevice).not.toHaveBeenCalled()
      expect(world.listDevices).toHaveBeenCalledTimes(2)
    } finally {
      world.service.close()
    }
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
      vault: memoryVault(),
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
      vault: memoryVault(),
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
        vault: memoryVault(),
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

  it('retries a recoverable Cloud failure with backoff and returns to the active Device', async () => {
    const identity = identityHarness(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
      'access-token-one'
    )
    const listDevices = vi.fn()
      .mockRejectedValueOnce(new CloudIdentityClientError(
        'provider_unavailable',
        'Cannot reach the SciForge Cloud identity service.'
      ))
      .mockResolvedValue({ devices: [cloudDevice('active')] })
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({ listDevices }),
      installationSeed: 'sciforge-local-installation',
      vault: memoryVault(),
      appVersion: '0.2.17',
      retry: { baseDelayMs: 5, maxDelayMs: 10, random: () => 0 }
    })

    try {
      await expect(service.ensureRegistered()).resolves.toMatchObject({
        ok: false,
        status: { state: 'error' }
      })
      await waitFor(() => service.getStatus().state === 'active')
      expect(listDevices.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(service.getStatus()).toMatchObject({
        state: 'active',
        device: { deviceId: 'dev_CloudDevice0001' }
      })
    } finally {
      service.close()
    }
  })

  it('retries the standardized HTTP 500 internal_error response', async () => {
    const identity = identityHarness(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
      'access-token-one'
    )
    const listDevices = vi.fn()
      .mockRejectedValueOnce(new CloudIdentityClientError(
        'internal_error',
        'The identity service failed internally.',
        undefined,
        500
      ))
      .mockResolvedValue({ devices: [cloudDevice('active')] })
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({ listDevices }),
      installationSeed: 'sciforge-local-installation',
      vault: memoryVault(),
      appVersion: '0.2.17',
      retry: { baseDelayMs: 5, maxDelayMs: 10, random: () => 0 }
    })

    try {
      await expect(service.ensureRegistered()).resolves.toMatchObject({
        ok: false,
        status: { state: 'error' }
      })
      await waitFor(() => service.getStatus().state === 'active')
      expect(listDevices.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(service.getStatus()).toMatchObject({
        state: 'active',
        device: { deviceId: 'dev_CloudDevice0001' }
      })
    } finally {
      service.close()
    }
  })

  it('does not retry a definitive rejection such as a revoked credential', async () => {
    const identity = identityHarness(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
      'access-token-one'
    )
    const listDevices = vi.fn(async () => {
      throw new CloudIdentityClientError('credential_revoked', 'The credential was revoked.')
    })
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({ listDevices }),
      installationSeed: 'sciforge-local-installation',
      vault: memoryVault(),
      appVersion: '0.2.17',
      retry: { baseDelayMs: 5, maxDelayMs: 10, random: () => 0 }
    })

    try {
      await expect(service.ensureRegistered()).resolves.toMatchObject({
        ok: false,
        status: { state: 'error' }
      })
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(listDevices).toHaveBeenCalledOnce()
      expect(service.getStatus().state).toBe('error')
    } finally {
      service.close()
    }
  })

  it('renews one rejected access token and replays the Device request', async () => {
    const identity = identityHarness(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
      'expired-access-token'
    )
    const listDevices = vi.fn()
      .mockRejectedValueOnce(new CloudIdentityClientError(
        'authentication_required',
        'The OIDC access token is not valid.',
        undefined,
        401
      ))
      .mockResolvedValue({ devices: [cloudDevice('active')] })
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({ listDevices }),
      installationSeed: 'sciforge-local-installation',
      vault: memoryVault(),
      appVersion: '0.2.17'
    })

    try {
      await expect(service.refresh()).resolves.toMatchObject({
        ok: true,
        status: { state: 'active' }
      })
      expect(identity.renewals()).toBe(1)
      expect(listDevices.mock.calls.map(([context]) => context.accessToken)).toEqual([
        'expired-access-token',
        'renewed-1'
      ])
    } finally {
      service.close()
    }
  })

  it('replays enrollment and createDevice with their original idempotency keys after 401', async () => {
    const identity = identityHarness(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
      'expired-access-token'
    )
    const enrollment = {
      enrollmentId: 'enr_Enrollment0001',
      nonce: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
      expiresAt: '2030-08-19T00:05:00.000Z'
    }
    const listDevices = vi.fn()
      .mockResolvedValueOnce({ devices: [] })
      .mockResolvedValue({ devices: [cloudDevice('active')] })
    const createDeviceEnrollment = vi.fn()
      .mockRejectedValueOnce(new CloudIdentityClientError(
        'authentication_required',
        'The OIDC access token is not valid.',
        undefined,
        401
      ))
      .mockResolvedValue(enrollment)
    const createDevice = vi.fn()
      .mockRejectedValueOnce(new CloudIdentityClientError(
        'authentication_required',
        'The OIDC access token is not valid.',
        undefined,
        401
      ))
      .mockResolvedValue(cloudDevice('active'))
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({ listDevices, createDeviceEnrollment, createDevice }),
      installationSeed: 'sciforge-local-installation',
      vault: memoryVault(),
      appVersion: '0.2.17'
    })

    try {
      await expect(service.ensureRegistered()).resolves.toMatchObject({
        ok: true,
        status: { state: 'active' }
      })
      expect(createDeviceEnrollment).toHaveBeenCalledTimes(2)
      expect(new Set(createDeviceEnrollment.mock.calls
        .map(([, input]) => input.idempotencyKey)).size).toBe(1)
      expect(createDevice).toHaveBeenCalledTimes(2)
      expect(new Set(createDevice.mock.calls
        .map(([, input]) => input.idempotencyKey)).size).toBe(1)
    } finally {
      service.close()
    }
  })

  it('replays revoke with its original idempotency key after 401', async () => {
    const identity = identityHarness(
      signedInStatus('usr_CloudUser000001', 'oid_CloudIdent0001'),
      'expired-access-token'
    )
    let currentDevice = cloudDevice('active')
    const listDevices = vi.fn(async () => ({ devices: [currentDevice] }))
    const revokeDevice = vi.fn()
      .mockRejectedValueOnce(new CloudIdentityClientError(
        'authentication_required',
        'The OIDC access token is not valid.',
        undefined,
        401
      ))
      .mockImplementation(async () => {
        currentDevice = cloudDevice('revoked')
        return currentDevice
      })
    const service = new DesktopDeviceService({
      identity: identity.identity,
      client: clientStub({ listDevices, revokeDevice }),
      installationSeed: 'sciforge-local-installation',
      vault: memoryVault(),
      appVersion: '0.2.17'
    })

    try {
      await expect(service.revoke(currentDevice.deviceId)).resolves.toMatchObject({
        ok: true,
        status: { state: 'revoked' }
      })
      expect(revokeDevice).toHaveBeenCalledTimes(2)
      expect(new Set(revokeDevice.mock.calls
        .map(([, input]) => input.idempotencyKey)).size).toBe(1)
    } finally {
      service.close()
    }
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Condition was not met in time.')
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

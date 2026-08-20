import { generateKeyPairSync, sign } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  canonicalEnrollmentBytes,
  desktopDeviceRegistrationSchema,
  oidcExchangeRequestSchema,
  oidcExternalIdentitySchema,
  oidcIdentityKey,
  verifiedOidcClaimsSchema
} from './identity.js'
import {
  CollaborationIdentityMockError,
  InMemoryCollaborationIdentityAdapter
} from './identity-testing.js'

const ISSUED_AT = '2026-08-18T02:00:00.000Z'
const EXPIRES_AT = '2026-08-18T03:00:00.000Z'
const DEVICE_KEY_PAIR = generateKeyPairSync('ed25519')

function claims(overrides: Record<string, unknown> = {}) {
  return verifiedOidcClaimsSchema.parse({
    type: 'verified_oidc_claims',
    issuer: 'https://login.sciforge.example/realms/SciForge',
    subject: 'keycloak-user-001',
    audiences: ['sciforge-cloud-api'],
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    email: 'researcher@example.invalid',
    emailVerified: true,
    displayName: 'Researcher One',
    ...overrides
  })
}

function registration(
  challenge: ReturnType<InMemoryCollaborationIdentityAdapter['startDeviceEnrollment']>,
  overrides: Record<string, unknown> = {}
) {
  const publicKey = DEVICE_KEY_PAIR.publicKey.export({ format: 'jwk' })
  const signature = sign(
    null,
    canonicalEnrollmentBytes(challenge),
    DEVICE_KEY_PAIR.privateKey
  ).toString('base64url')
  return desktopDeviceRegistrationSchema.parse({
    enrollmentId: challenge.enrollmentId,
    installationId: challenge.installationId,
    displayName: 'Lab Desktop',
    platform: {
      os: 'windows',
      arch: 'x64',
      osVersion: '11',
      appVersion: '0.2.17'
    },
    publicKey: {
      ...publicKey,
      alg: 'EdDSA',
      use: 'sig',
      kid: 'device-key-01'
    },
    capabilities: ['agent.execute', 'workspace.read'],
    proof: { alg: 'EdDSA', signature },
    ...overrides
  })
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action()
    throw new Error('Expected action to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(CollaborationIdentityMockError)
    expect((error as CollaborationIdentityMockError).collaborationError.code).toBe(code)
  }
}

describe('OIDC identity contracts', () => {
  it('normalizes issuer identity without using email as the key', () => {
    const first = claims({ issuer: 'https://login.sciforge.example/realms/SciForge/' })
    const changedEmail = claims({ email: 'renamed@example.invalid' })
    expect(first.issuer).toBe(changedEmail.issuer)
    expect(oidcIdentityKey(first)).toBe(oidcIdentityKey(changedEmail))
  })

  it('rejects insecure issuers, invalid token times, and token material in the exchange body', () => {
    expect(verifiedOidcClaimsSchema.safeParse({
      ...claims(),
      issuer: 'http://127.0.0.1:8080/realms/SciForge'
    }).success).toBe(true)
    expect(verifiedOidcClaimsSchema.safeParse({
      ...claims(),
      issuer: 'http://localhost:8080/realms/SciForge'
    }).success).toBe(true)
    expect(verifiedOidcClaimsSchema.safeParse({
      ...claims(),
      issuer: 'http://login.sciforge.example/realms/SciForge'
    }).success).toBe(false)
    expect(verifiedOidcClaimsSchema.safeParse({
      ...claims(),
      expiresAt: ISSUED_AT
    }).success).toBe(false)
    expect(oidcExchangeRequestSchema.safeParse({
      protocolVersion: '1.0',
      requestId: 'req_OidcExchange01',
      type: 'oidc.exchange',
      accessToken: 'must-not-enter-json'
    }).success).toBe(false)
  })

  it('requires revoked identities to carry a revocation timestamp', () => {
    const identity = {
      schemaVersion: 1,
      type: 'oidc_external_identity',
      externalIdentityId: 'xid_Identity000001',
      userId: 'usr_User00000001',
      issuer: 'https://login.sciforge.example/realms/SciForge',
      subject: 'keycloak-user-001',
      status: 'revoked',
      verifiedAt: ISSUED_AT,
      revision: 1,
      createdAt: ISSUED_AT,
      updatedAt: ISSUED_AT
    }
    expect(oidcExternalIdentitySchema.safeParse(identity).success).toBe(false)
    expect(oidcExternalIdentitySchema.safeParse({ ...identity, revokedAt: ISSUED_AT }).success).toBe(true)
  })

})

describe('strict Device contracts', () => {
  it('freezes enrollment proof bytes as six UTF-8 lines without a trailing LF', () => {
    const facts = {
      enrollmentId: 'enr_golden_vector_0001',
      nonce: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
      userId: 'usr_golden_vector_0001',
      installationId: 'ins_golden_vector_0001',
      expiresAt: '2026-08-20T12:34:56.000Z'
    }
    const expected = [
      'SCIFORGE-DEVICE-ENROLLMENT-V1',
      facts.enrollmentId,
      facts.nonce,
      facts.userId,
      facts.installationId,
      facts.expiresAt
    ].join('\n')
    const canonical = canonicalEnrollmentBytes(facts)
    const canonicalBuffer = Buffer.from(canonical)

    expect(canonical).toBeInstanceOf(Uint8Array)
    expect(canonicalBuffer).toEqual(Buffer.from(expected, 'utf8'))
    expect(canonicalBuffer.toString('utf8').split('\n')).toHaveLength(6)
    expect(canonical.at(-1)).not.toBe(0x0a)
    expect(() => canonicalEnrollmentBytes({
      ...facts,
      installationId: 'bad\ninstallation'
    })).toThrow(TypeError)
    expect(() => canonicalEnrollmentBytes({ ...facts, nonce: '' })).toThrow(TypeError)
  })
})

describe('OIDC-first collaboration identity mock', () => {
  it('maps repeated issuer and subject claims to one stable SciForge user', () => {
    const adapter = new InMemoryCollaborationIdentityAdapter(() => new Date('2026-08-18T02:30:00.000Z'))
    const first = adapter.exchangeOidc(claims())
    const repeated = adapter.exchangeOidc(claims({ email: 'changed@example.invalid', displayName: 'Renamed' }))
    expect(repeated.user.userId).toBe(first.user.userId)
    expect(repeated.identity.externalIdentityId).toBe(first.identity.externalIdentityId)
  })

  it('does not merge different issuers or subjects just because email matches', () => {
    const adapter = new InMemoryCollaborationIdentityAdapter(() => new Date('2026-08-18T02:30:00.000Z'))
    const first = adapter.exchangeOidc(claims())
    const differentSubject = adapter.exchangeOidc(claims({ subject: 'keycloak-user-002' }))
    const differentIssuer = adapter.exchangeOidc(claims({
      issuer: 'https://institution.example/realms/SciForge',
      subject: 'keycloak-user-001'
    }))
    expect(new Set([
      first.user.userId,
      differentSubject.user.userId,
      differentIssuer.user.userId
    ]).size).toBe(3)
  })

  it('rejects expired OIDC claims and revoked OIDC identities', () => {
    const adapter = new InMemoryCollaborationIdentityAdapter(() => new Date('2026-08-18T03:30:00.000Z'))
    expectCode(() => adapter.exchangeOidc(claims()), 'expired')

    const activeAdapter = new InMemoryCollaborationIdentityAdapter(() => new Date('2026-08-18T02:30:00.000Z'))
    const exchanged = activeAdapter.exchangeOidc(claims())
    activeAdapter.revokeOidcIdentity(exchanged.identity.externalIdentityId)
    expectCode(() => activeAdapter.exchangeOidc(claims()), 'credential_revoked')
  })

  it('rejects expired enrollment and invalid Device possession proofs', () => {
    let current = new Date('2026-08-18T02:30:00.000Z')
    const adapter = new InMemoryCollaborationIdentityAdapter(() => current)
    const user = adapter.exchangeOidc(claims()).user
    const expiredChallenge = adapter.startDeviceEnrollment(user.userId, 'ins_Desktop000001', 1_000)
    current = new Date('2026-08-18T02:30:02.000Z')
    expectCode(
      () => adapter.registerDesktopDevice(user.userId, registration(expiredChallenge)),
      'expired'
    )

    const activeChallenge = adapter.startDeviceEnrollment(user.userId, 'ins_Desktop000002')
    const validRegistration = registration(activeChallenge)
    const signature = validRegistration.proof.signature
    const forgedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
    expectCode(() => adapter.registerDesktopDevice(user.userId, {
      ...validRegistration,
      proof: { ...validRegistration.proof, signature: forgedSignature }
    }), 'authentication_required')
  })

  it('proves Device key possession, then links and revokes its Desktop Agent', () => {
    const adapter = new InMemoryCollaborationIdentityAdapter(() => new Date('2026-08-18T02:30:00.000Z'))
    const firstUser = adapter.exchangeOidc(claims()).user
    const secondUser = adapter.exchangeOidc(claims({ subject: 'keycloak-user-002' })).user
    const challenge = adapter.startDeviceEnrollment(firstUser.userId, 'ins_Desktop000001')
    const deviceRegistration = registration(challenge)
    const device = adapter.registerDesktopDevice(firstUser.userId, deviceRegistration)
    const agent = adapter.registerDesktopAgent(firstUser.userId, device.deviceId)
    expect(agent.ownerUserId).toBe(firstUser.userId)
    expect(adapter.getDesktopDeviceRegistration(device.deviceId)).toMatchObject({
      platform: { os: 'windows', arch: 'x64' },
      publicKey: { kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA' }
    })
    expect(adapter.registerDesktopAgent(firstUser.userId, device.deviceId).agentId).toBe(agent.agentId)
    expectCode(() => adapter.registerDesktopAgent(secondUser.userId, device.deviceId), 'identity_conflict')

    const revokedDevice = adapter.revokeDevice(device.deviceId)
    expect(revokedDevice.status).toBe('revoked')
    expect(adapter.getIdentitySnapshot(firstUser.userId).agents[0]).toMatchObject({
      lifecycleStatus: 'revoked',
      connectionStatus: 'offline'
    })
  })

  it('returns one identity snapshot and auditable actor/source attribution', () => {
    const adapter = new InMemoryCollaborationIdentityAdapter(() => new Date('2026-08-18T02:30:00.000Z'))
    const user = adapter.exchangeOidc(claims()).user
    const deviceChallenge = adapter.startDeviceEnrollment(user.userId, 'ins_Desktop000001')
    const device = adapter.registerDesktopDevice(user.userId, registration(deviceChallenge))
    adapter.registerDesktopAgent(user.userId, device.deviceId)

    const snapshot = adapter.getIdentitySnapshot(user.userId)
    expect(snapshot.oidcIdentities).toHaveLength(1)
    expect(snapshot.humanEndpoints).toHaveLength(0)
    expect(snapshot.devices).toHaveLength(1)
    const linkedAgent = snapshot.agents[0]!
    expect(snapshot.deviceAgentLinks).toEqual([{ deviceId: device.deviceId, agentId: linkedAgent.agentId }])
    expect(snapshot.agents).toHaveLength(1)
    expect(new Set(adapter.listAuditEvents().map((event) => event.source))).toEqual(
      new Set(['oidc', 'desktop'])
    )
  })
})

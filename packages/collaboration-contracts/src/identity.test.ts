import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  canonicalEnrollmentBytes,
  canonicalDeviceFactAttestationBytes,
  deviceCreateRequestSchema,
  deviceSchema,
  meResponseSchema,
  normalizeOidcIssuer,
  oidcIssuerSchema
} from './identity.js'

const AT = '2026-08-18T02:00:00.000Z'

const publicKeyJwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  alg: 'EdDSA',
  use: 'sig',
  kid: 'device-key-01',
  x: Buffer.alloc(32, 7).toString('base64url')
} as const

describe('canonical OIDC boundary contracts', () => {
  it('normalizes only a fixed secure issuer shape', () => {
    expect(normalizeOidcIssuer('https://login.sciforge.example/realms/SciForge/'))
      .toBe('https://login.sciforge.example/realms/SciForge')
    expect(oidcIssuerSchema.safeParse('http://127.0.0.1:8080/realms/SciForge').success).toBe(true)
    expect(oidcIssuerSchema.safeParse('http://login.sciforge.example/realms/SciForge').success).toBe(false)
    expect(oidcIssuerSchema.safeParse('https://user:pass@login.sciforge.example/realms/SciForge').success).toBe(false)
    expect(oidcIssuerSchema.safeParse('https://login.sciforge.example/realms/SciForge?fallback=old').success).toBe(false)
  })

  it('returns only a token-free current User fact', () => {
    const me = {
      schemaVersion: 1,
      type: 'me',
      userId: 'usr_User00000001',
      displayName: 'Researcher One',
      status: 'active',
      oidcIdentityId: 'oid_Identity000001',
      issuer: 'https://login.sciforge.example/realms/SciForge',
      revision: 1,
      createdAt: AT,
      updatedAt: AT
    }
    expect(meResponseSchema.safeParse(me).success).toBe(true)
    expect(meResponseSchema.safeParse({ ...me, accessToken: 'must-not-cross-the-contract' }).success).toBe(false)
    expect(meResponseSchema.safeParse({ ...me, email: 'identity-is-not-keyed-by-email@example.invalid' }).success).toBe(false)
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
    const bytes = Buffer.from(canonical)

    expect(bytes).toEqual(Buffer.from(expected, 'utf8'))
    expect(bytes.toString('utf8').split('\n')).toHaveLength(6)
    expect(canonical.at(-1)).not.toBe(0x0a)
    expect(() => canonicalEnrollmentBytes({ ...facts, installationId: 'bad\ninstallation' })).toThrow(TypeError)
    expect(() => canonicalEnrollmentBytes({ ...facts, nonce: '' })).toThrow(TypeError)
  })

  it('freezes the one allowlisted Device fact-signing envelope', () => {
    const facts = {
      purpose: 'project-content-provisioning-attestation' as const,
      userId: 'usr_User00000001',
      deviceId: 'dev_Device000001',
      deviceKeyId: 'device-key-01',
      deviceKeyRevision: 1,
      canonicalPayloadDigest: 'a'.repeat(64),
      factRevision: 3,
      observedAt: '2026-08-18T01:59:00.000Z',
      issuedAt: AT
    }
    const expected = [
      'SCIFORGE-DEVICE-FACT-ATTESTATION-V1',
      facts.purpose,
      facts.userId,
      facts.deviceId,
      facts.deviceKeyId,
      '1',
      facts.canonicalPayloadDigest,
      '3',
      facts.observedAt,
      facts.issuedAt
    ].join('\n')
    expect(Buffer.from(canonicalDeviceFactAttestationBytes(facts))).toEqual(Buffer.from(expected, 'utf8'))
    expect(() => canonicalDeviceFactAttestationBytes({
      ...facts,
      purpose: 'arbitrary-domain-signing' as never
    })).toThrow()
  })

  it('accepts only public possession material and rejects secret fields', () => {
    const request = {
      enrollmentId: 'enr_Enroll0000001',
      nonce: Buffer.alloc(32, 3).toString('base64url'),
      installationId: 'ins_Install000001',
      displayName: 'Lab Desktop',
      platform: { os: 'macos', arch: 'arm64', appVersion: '0.2.17' },
      publicKeyJwk,
      capabilitySummary: ['agent.execute', 'workspace.read'],
      signature: Buffer.alloc(64, 9).toString('base64url'),
      idempotencyKey: 'idem_device_enrollment_0001'
    }
    expect(deviceCreateRequestSchema.safeParse(request).success).toBe(true)
    expect(deviceCreateRequestSchema.safeParse({ ...request, privateKey: 'forbidden' }).success).toBe(false)
    expect(deviceCreateRequestSchema.safeParse({ ...request, capabilitySummary: ['agent.execute', 'agent.execute'] }).success).toBe(false)
  })

  it('requires an exact revocation fact', () => {
    const device = {
      schemaVersion: 1,
      type: 'device',
      deviceId: 'dev_Device000001',
      userId: 'usr_User00000001',
      installationId: 'ins_Install000001',
      displayName: 'Lab Desktop',
      platform: { os: 'linux', arch: 'x64', appVersion: '0.2.17' },
      publicKeyJwk,
      capabilitySummary: ['agent.execute'],
      status: 'active',
      revision: 1,
      createdAt: AT,
      updatedAt: AT
    }
    expect(deviceSchema.safeParse(device).success).toBe(true)
    expect(deviceSchema.safeParse({ ...device, status: 'revoked' }).success).toBe(false)
    expect(deviceSchema.safeParse({ ...device, revokedAt: AT }).success).toBe(false)
    expect(deviceSchema.safeParse({ ...device, status: 'revoked', revokedAt: AT }).success).toBe(true)
  })
})

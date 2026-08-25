import {
  generateKeyPairSync,
  randomBytes,
  sign as signBytes,
  verify as verifyBytes
} from 'node:crypto'

export function canonicalEnrollmentBytes(input) {
  const values = [
    'SCIFORGE-DEVICE-ENROLLMENT-V1',
    input.enrollmentId,
    input.nonce,
    input.userId,
    input.installationId,
    input.expiresAt
  ]
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\n') || value.includes('\r')) {
      throw new TypeError('Enrollment signing fields must be non-empty strings without line breaks.')
    }
  }
  return Buffer.from(values.join('\n'), 'utf8')
}

export function createDeviceFixture(overrides = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicJwk = publicKey.export({ format: 'jwk' })
  const now = overrides.now ?? new Date('2026-08-18T12:00:00.000Z')
  const enrollment = {
    enrollmentId: overrides.enrollmentId ?? 'enr_identity_test_0001',
    nonce: overrides.nonce ?? randomBytes(32).toString('base64url'),
    userId: overrides.userId ?? 'usr_identity_test_0001',
    installationId: overrides.installationId ?? 'ins_identity_test_0001',
    expiresAt: overrides.expiresAt ?? new Date(now.getTime() + 5 * 60_000).toISOString()
  }
  const payload = canonicalEnrollmentBytes(enrollment)
  const signature = signBytes(null, payload, privateKey).toString('base64url')
  const deviceRequest = {
    enrollmentId: enrollment.enrollmentId,
    installationId: enrollment.installationId,
    displayName: overrides.displayName ?? 'Identity Test Desktop',
    platform: overrides.platform ?? {
      os: 'macos',
      arch: 'arm64',
      osVersion: '15.6',
      appVersion: '0.2.17'
    },
    publicKeyJwk: {
      ...publicJwk,
      alg: 'EdDSA',
      use: 'sig',
      kid: overrides.kid ?? 'device-key-test-01'
    },
    capabilitySummary: overrides.capabilitySummary ?? ['agent-runtime', 'local-files'],
    signature
  }

  return {
    enrollment,
    deviceRequest,
    canonicalPayload: payload,
    verifySignature(candidate = signature, candidatePayload = payload) {
      return verifyBytes(null, candidatePayload, publicKey, Buffer.from(candidate, 'base64url'))
    },
    agentRegister(deviceId = 'dev_identity_test_0001') {
      return {
        protocolVersion: '1.0',
        requestId: 'req_identity_agent_0001',
        type: 'agent.register',
        idempotencyKey: 'idem_identity_agent_0001',
        ownerUserId: enrollment.userId,
        deviceId,
        displayName: 'Identity Test Agent',
        nodeType: 'desktop',
        capabilities: [...deviceRequest.capabilitySummary]
      }
    }
  }
}

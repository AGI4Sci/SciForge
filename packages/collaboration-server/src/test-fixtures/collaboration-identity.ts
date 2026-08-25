import {
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type JsonWebKey
} from 'node:crypto'
import {
  agentCredentialEnvelopeAad,
  agentCredentialEnvelopeSchema,
  type AgentCredentialEnvelope
} from '@sciforge/collaboration-contracts'

import type { OidcUserActor } from '../actor.js'
import { stableDigest } from '../crypto.js'
import type { CollaborationRepository } from '../repository.js'

const ENVELOPE_INFO = Buffer.from('sciforge-agent-credential-envelope-v1', 'utf8')

export async function seedOidcUserDevice(
  repository: CollaborationRepository,
  label: string,
  at: Date
): Promise<Readonly<{ user: OidcUserActor; userId: string; deviceId: string }>> {
  const suffix = stableDigest(label).slice(0, 24)
  const userId = `usr_${suffix}`
  const identityId = `oid_${suffix}`
  const deviceId = `dev_${suffix}`
  const timestamp = at.toISOString()
  const signing = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' })
  await repository.transaction(async (tx) => {
    await tx.insertUser({ userId, displayName: label, status: 'active', revision: 1,
      createdAt: timestamp, updatedAt: timestamp })
    await tx.insertOidcIdentity({ identityId, userId, issuer: 'https://identity.sciforge.test', subject: `subject-${suffix}`,
      status: 'active', revision: 1, createdAt: timestamp, updatedAt: timestamp })
    await tx.insertDevice({ deviceId, userId, installationId: `ins_${suffix}`, displayName: `${label} Device`,
      platform: { os: 'macos', arch: 'arm64', appVersion: '0.1.0-test' },
      publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig', kid: `device-${suffix}`,
        x: signing.x! }, capabilitySummary: ['research.execute'], status: 'active', revision: 1,
      createdAt: timestamp, updatedAt: timestamp })
  })
  return {
    user: { kind: 'user', authentication: 'oidc', actorKey: `oidc:${identityId}`, userId, identityId,
      issuer: 'https://identity.sciforge.test', subject: `subject-${suffix}`,
      authTime: Math.floor(at.getTime() / 1_000), expiresAt: Math.floor(at.getTime() / 1_000) + 3_600,
      assurance: 'verified' },
    userId,
    deviceId
  }
}

export function createAgentCredentialBootstrap(): Readonly<{
  publicKey: { kty: 'OKP'; crv: 'X25519'; x: string }
  open(envelope: AgentCredentialEnvelope): string
}> {
  const keyPair = generateKeyPairSync('x25519')
  const publicJwk = keyPair.publicKey.export({ format: 'jwk' })
  const publicKey = { kty: 'OKP' as const, crv: 'X25519' as const, x: publicJwk.x! }
  return {
    publicKey,
    open(rawEnvelope) {
      const envelope = agentCredentialEnvelopeSchema.parse(rawEnvelope)
      const ephemeral = createPublicKey({ key: envelope.ephemeralPublicKey as JsonWebKey, format: 'jwk' })
      const sharedSecret = diffieHellman({ privateKey: keyPair.privateKey, publicKey: ephemeral })
      const key = Buffer.from(hkdfSync('sha256', sharedSecret, Buffer.from(envelope.salt, 'base64url'),
        ENVELOPE_INFO, 32))
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'))
        decipher.setAAD(Buffer.from(agentCredentialEnvelopeAad(envelope), 'utf8'))
        decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64url'))
        return Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
          decipher.final()
        ]).toString('utf8')
      } finally {
        sharedSecret.fill(0)
        key.fill(0)
      }
    }
  }
}

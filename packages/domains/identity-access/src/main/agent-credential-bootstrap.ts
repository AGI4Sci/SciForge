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
  type AgentCredentialBootstrapPublicKey,
  type AgentCredentialEnvelope
} from '@sciforge/collaboration-contracts'

const ENVELOPE_INFO = Buffer.from('sciforge-agent-credential-envelope-v1', 'utf8')

export type AgentCredentialBootstrap = Readonly<{
  publicKey: AgentCredentialBootstrapPublicKey
  open(envelope: AgentCredentialEnvelope): string
}>

export function createAgentCredentialBootstrap(): AgentCredentialBootstrap {
  const keyPair = generateKeyPairSync('x25519')
  const publicJwk = keyPair.publicKey.export({ format: 'jwk' })
  const publicKey: AgentCredentialBootstrapPublicKey = {
    kty: 'OKP',
    crv: 'X25519',
    x: publicJwk.x!
  }
  let consumed = false
  return Object.freeze({
    publicKey,
    open(rawEnvelope) {
      if (consumed) throw new Error('The Agent authority bootstrap was already consumed.')
      const envelope = agentCredentialEnvelopeSchema.parse(rawEnvelope)
      const ephemeral = createPublicKey({
        key: envelope.ephemeralPublicKey as JsonWebKey,
        format: 'jwk'
      })
      const sharedSecret = diffieHellman({ privateKey: keyPair.privateKey, publicKey: ephemeral })
      const key = Buffer.from(hkdfSync(
        'sha256',
        sharedSecret,
        Buffer.from(envelope.salt, 'base64url'),
        ENVELOPE_INFO,
        32
      ))
      try {
        const decipher = createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(envelope.iv, 'base64url')
        )
        decipher.setAAD(Buffer.from(agentCredentialEnvelopeAad(envelope), 'utf8'))
        decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64url'))
        const credentialBytes = Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
          decipher.final()
        ])
        try {
          const authority = credentialBytes.toString('utf8')
          if (!/^agent\.[A-Za-z0-9_-]{20,}$/u.test(authority) || authority.length > 512) {
            throw new Error('The sealed Agent authority payload is invalid.')
          }
          consumed = true
          return authority
        } finally {
          credentialBytes.fill(0)
        }
      } finally {
        sharedSecret.fill(0)
        key.fill(0)
      }
    }
  })
}


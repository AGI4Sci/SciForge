import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type JsonWebKey
} from 'node:crypto'
import {
  agentCredentialBootstrapPublicKeySchema,
  agentCredentialEnvelopeAad,
  agentCredentialEnvelopeSchema,
  type AgentCredentialBootstrapPublicKey,
  type AgentCredentialEnvelope
} from '@sciforge/collaboration-contracts'

const ENVELOPE_INFO = Buffer.from('sciforge-agent-credential-envelope-v1', 'utf8')

export function sealAgentCredential(input: Readonly<{
  credential: string
  recipientPublicKey: AgentCredentialBootstrapPublicKey
  agentId: string
  deviceId: string
  credentialGeneration: number
  issuedAt: string
}>): AgentCredentialEnvelope {
  if (!input.credential || Buffer.byteLength(input.credential, 'utf8') > 2_048) {
    throw new TypeError('Agent credential plaintext has an invalid size.')
  }
  const recipientJwk = agentCredentialBootstrapPublicKeySchema.parse(input.recipientPublicKey)
  const recipientKey = createPublicKey({ key: recipientJwk as JsonWebKey, format: 'jwk' })
  const ephemeral = generateKeyPairSync('x25519')
  const sharedSecret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipientKey })
  const salt = randomBytes(32)
  const iv = randomBytes(12)
  const key = Buffer.from(hkdfSync('sha256', sharedSecret, salt, ENVELOPE_INFO, 32))
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(agentCredentialEnvelopeAad(input), 'utf8'))
    const ciphertext = Buffer.concat([
      cipher.update(input.credential, 'utf8'),
      cipher.final()
    ])
    const ephemeralJwk = ephemeral.publicKey.export({ format: 'jwk' })
    return agentCredentialEnvelopeSchema.parse({
      schemaVersion: 1,
      algorithm: 'X25519-HKDF-SHA256+A256GCM',
      agentId: input.agentId,
      deviceId: input.deviceId,
      credentialGeneration: input.credentialGeneration,
      issuedAt: input.issuedAt,
      ephemeralPublicKey: {
        kty: ephemeralJwk.kty,
        crv: ephemeralJwk.crv,
        x: ephemeralJwk.x
      },
      salt: salt.toString('base64url'),
      iv: iv.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      authenticationTag: cipher.getAuthTag().toString('base64url')
    })
  } finally {
    sharedSecret.fill(0)
    key.fill(0)
  }
}

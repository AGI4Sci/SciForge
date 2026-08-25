import { createPublicKey, randomBytes, verify } from 'node:crypto'

import {
  canonicalDeviceFactAttestationBytes,
  canonicalEnrollmentBytes as canonicalContractEnrollmentBytes,
  deviceFactSignatureMetadataSchema,
  type DeviceFactSignatureMetadata,
  type Ed25519PublicJwk,
  type EnrollmentSigningFacts
} from '@sciforge/collaboration-contracts'

import { digestSecret } from './crypto.js'
import { fail } from './errors.js'

const BASE32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export type { EnrollmentSigningFacts }

export function issueEnrollmentNonce(): string {
  return randomBytes(32).toString('base64url')
}

export function enrollmentNonceDigest(nonce: string): string {
  return digestSecret(nonce)
}

export function issueBindingCode(): string {
  const entropy = randomBytes(10)
  let value = 0
  let bits = 0
  let encoded = ''
  for (const byte of entropy) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      encoded += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
      value &= (1 << bits) - 1
    }
  }
  if (bits > 0) encoded += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return `SF-${encoded.slice(0, 8)}-${encoded.slice(8)}`
}

export function canonicalEnrollmentBytes(input: EnrollmentSigningFacts): Buffer {
  try {
    return Buffer.from(canonicalContractEnrollmentBytes(input))
  } catch (error) {
    if (error instanceof TypeError) {
      fail('validation_failed', 'Enrollment signing fields must be non-empty strings without line breaks.')
    }
    throw error
  }
}

export function verifyDeviceEnrollmentProof(input: Readonly<{
  facts: EnrollmentSigningFacts
  publicKeyJwk: Ed25519PublicJwk
  signature: string
}>): void {
  const signature = decodeCanonicalBase64Url(input.signature, 64, 'Device signature')
  let publicKey: ReturnType<typeof createPublicKey>
  try {
    publicKey = createPublicKey({ key: input.publicKeyJwk, format: 'jwk' })
  } catch {
    return fail('validation_failed', 'The Device public key is not a valid Ed25519 public JWK.')
  }
  if (publicKey.asymmetricKeyType !== 'ed25519' ||
      !verify(null, canonicalEnrollmentBytes(input.facts), publicKey, signature)) {
    fail('validation_failed', 'The Device enrollment proof is invalid.')
  }
}

/** Verifies a bounded Device fact signature; it never establishes Provider ACL. */
export function verifyDeviceFactAttestation(input: Readonly<{
  metadata: DeviceFactSignatureMetadata
  publicKeyJwk: Ed25519PublicJwk
}>): DeviceFactSignatureMetadata {
  let metadata: DeviceFactSignatureMetadata
  try {
    metadata = deviceFactSignatureMetadataSchema.parse(input.metadata)
  } catch {
    return fail('validation_failed', 'The Device fact signature metadata is invalid.')
  }
  if (input.publicKeyJwk.kid !== metadata.deviceKeyId) {
    return fail('validation_failed', 'The Device fact signature key identity is invalid.')
  }
  const signature = decodeCanonicalBase64Url(metadata.signature, 64, 'Device fact signature')
  let publicKey: ReturnType<typeof createPublicKey>
  try {
    publicKey = createPublicKey({ key: input.publicKeyJwk, format: 'jwk' })
  } catch {
    return fail('validation_failed', 'The Device public key is not a valid Ed25519 public JWK.')
  }
  let payload: Uint8Array
  try {
    payload = canonicalDeviceFactAttestationBytes(metadata)
  } catch {
    return fail('validation_failed', 'The Device fact signing fields are invalid.')
  }
  if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, payload, publicKey, signature)) {
    fail('validation_failed', 'The Device fact signature is invalid.')
  }
  return metadata
}

export function decodeCanonicalBase64Url(value: string, expectedBytes: number, label: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    fail('validation_failed', `${label} is not canonical base64url.`)
  }
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.length !== expectedBytes || decoded.toString('base64url') !== value) {
    fail('validation_failed', `${label} has an invalid length or encoding.`)
  }
  return decoded
}

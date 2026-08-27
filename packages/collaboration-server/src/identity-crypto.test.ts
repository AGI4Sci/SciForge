import { generateKeyPairSync, sign } from 'node:crypto'

import { canonicalDeviceFactAttestationBytes } from '@sciforge/collaboration-contracts'
import { describe, expect, it } from 'vitest'

import {
  canonicalEnrollmentBytes,
  decodeCanonicalBase64Url,
  enrollmentNonceDigest,
  issueBindingCode,
  issueEnrollmentNonce,
  verifyDeviceEnrollmentProof,
  verifyDeviceFactAttestation
} from './identity-crypto.js'
import { CollaborationServiceError } from './errors.js'

import { createDeviceFixture } from './test-fixtures/device-fixture.mjs'

describe('identity cryptography', () => {
  it('matches the dynamic fixture canonical payload and verifies Ed25519 possession', () => {
    const fixture = createDeviceFixture()
    const facts = fixture.enrollment
    expect(Buffer.from(canonicalEnrollmentBytes(facts))).toEqual(fixture.canonicalPayload)
    expect(() => verifyDeviceEnrollmentProof({
      facts,
      publicKeyJwk: fixture.deviceRequest.publicKeyJwk,
      signature: fixture.deviceRequest.signature
    })).not.toThrow()
  })

  it('rejects payload substitution and non-canonical signatures without exposing proof material', () => {
    const fixture = createDeviceFixture()
    for (const candidate of [
      { facts: { ...fixture.enrollment, userId: 'usr_identity_other_0001' }, signature: fixture.deviceRequest.signature },
      { facts: fixture.enrollment, signature: `${fixture.deviceRequest.signature}=` },
      { facts: fixture.enrollment, signature: Buffer.alloc(64).toString('base64url') }
    ]) {
      let thrown: unknown
      try {
        verifyDeviceEnrollmentProof({
          facts: candidate.facts,
          publicKeyJwk: fixture.deviceRequest.publicKeyJwk,
          signature: candidate.signature
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(CollaborationServiceError)
      expect(String((thrown as Error).message)).not.toContain(candidate.signature)
      expect((thrown as CollaborationServiceError).code).toBe('validation_failed')
    }
  })

  it('issues bounded nonce and binding-code entropy and hashes the nonce for persistence', () => {
    const nonce = issueEnrollmentNonce()
    expect(decodeCanonicalBase64Url(nonce, 32, 'nonce')).toHaveLength(32)
    expect(enrollmentNonceDigest(nonce)).toMatch(/^[a-f0-9]{64}$/u)
    expect(enrollmentNonceDigest(nonce)).not.toContain(nonce)
    expect(issueBindingCode()).toMatch(/^SF-[A-Z2-9]{8}-[A-Z2-9]{8}$/u)
  })

  it('refuses line breaks in every canonical signing field', () => {
    const fixture = createDeviceFixture()
    expect(() => canonicalEnrollmentBytes({ ...fixture.enrollment, installationId: 'bad\ninstallation' }))
      .toThrow()
    expect(() => verifyDeviceEnrollmentProof({
      facts: { ...fixture.enrollment, installationId: 'bad\ninstallation' },
      publicKeyJwk: fixture.deviceRequest.publicKeyJwk,
      signature: fixture.deviceRequest.signature
    })).toThrowError(CollaborationServiceError)
  })

  it('verifies only the canonical allowlisted Device fact envelope', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const exported = publicKey.export({ format: 'jwk' })
    const metadata = {
      purpose: 'project-content-provisioning-attestation' as const,
      userId: 'usr_DeviceFact0001',
      deviceId: 'dev_DeviceFact0001',
      deviceKeyId: 'device-fact-key-01',
      deviceKeyRevision: 1,
      signatureAlgorithm: 'Ed25519' as const,
      canonicalPayloadDigest: 'a'.repeat(64),
      factRevision: 2,
      observedAt: '2026-08-18T11:59:00.000Z',
      issuedAt: '2026-08-18T12:00:00.000Z',
      signature: ''
    }
    const signature = sign(
      null,
      canonicalDeviceFactAttestationBytes(metadata),
      privateKey
    ).toString('base64url')
    const signed = { ...metadata, signature }
    expect(verifyDeviceFactAttestation({
      metadata: signed,
      publicKeyJwk: { ...exported, alg: 'EdDSA', use: 'sig', kid: metadata.deviceKeyId }
    })).toEqual(signed)
    expect(() => verifyDeviceFactAttestation({
      metadata: { ...signed, factRevision: 3 },
      publicKeyJwk: { ...exported, alg: 'EdDSA', use: 'sig', kid: metadata.deviceKeyId }
    })).toThrowError(CollaborationServiceError)
    expect(() => verifyDeviceFactAttestation({
      metadata: signed,
      publicKeyJwk: { ...exported, alg: 'EdDSA', use: 'sig', kid: 'different-device-key' }
    })).toThrowError(CollaborationServiceError)
  })
})

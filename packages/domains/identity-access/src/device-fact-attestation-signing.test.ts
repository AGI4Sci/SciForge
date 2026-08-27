import { describe, expect, it, vi } from 'vitest'
import {
  defineDeviceFactAttestationSigningService,
  type DeviceFactAttestationSigningService
} from './device-fact-attestation-signing.js'

const request = {
  purpose: 'project-content-provisioning-attestation' as const,
  factDigest: 'a'.repeat(64),
  factRevision: 3,
  observedAt: '2026-08-18T01:59:00.000Z'
}

const metadata = {
  purpose: request.purpose,
  userId: 'usr_User00000001',
  deviceId: 'dev_Device000001',
  deviceKeyId: 'device-key-01',
  deviceKeyRevision: 1,
  signatureAlgorithm: 'Ed25519' as const,
  canonicalPayloadDigest: request.factDigest,
  factRevision: request.factRevision,
  observedAt: request.observedAt,
  issuedAt: '2026-08-18T02:00:00.000Z',
  signature: Buffer.alloc(64, 7).toString('base64url')
}

describe('Device fact attestation signing contract', () => {
  it('accepts only the allowlisted fact envelope and validates returned metadata', async () => {
    const signDeviceFact = vi.fn(async () => metadata)
    const service = defineDeviceFactAttestationSigningService({ signDeviceFact })

    await expect(service.signDeviceFact(request)).resolves.toEqual(metadata)
    expect(signDeviceFact).toHaveBeenCalledWith(request)
  })

  it.each([
    ['unknown purpose', { ...request, purpose: 'arbitrary-domain-signing' }],
    ['arbitrary bytes', { ...request, bytes: Buffer.from('do not sign').toString('base64url') }],
    ['secret-bearing request', { ...request, privateKey: 'forbidden' }]
  ])('fails closed for %s', async (_label, invalid) => {
    const signDeviceFact = vi.fn(async () => metadata)
    const service = defineDeviceFactAttestationSigningService({ signDeviceFact })

    await expect(service.signDeviceFact(invalid as never)).rejects.toThrow()
    expect(signDeviceFact).not.toHaveBeenCalled()
  })

  it('rejects an implementation that returns undeclared or malformed metadata', async () => {
    const service = defineDeviceFactAttestationSigningService({
      signDeviceFact: vi.fn(async () => ({ ...metadata, accessToken: 'forbidden' }))
    } as unknown as DeviceFactAttestationSigningService)

    await expect(service.signDeviceFact(request)).rejects.toThrow()
  })
})

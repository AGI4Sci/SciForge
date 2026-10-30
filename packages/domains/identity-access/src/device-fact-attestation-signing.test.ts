import { workerDeliveryConfirmationDigest, workerDeliveryHumanActionFactDigest } from '@sciforge/collaboration-contracts'
import { describe, expect, it, vi } from 'vitest'
import {
  defineDeviceFactAttestationSigningService,
  type DeviceFactAttestationSigningService
} from './device-fact-attestation-signing.js'

const target = { projectId: 'prj_Project000001', taskId: 'tsk_Task00000001', executionId: 'exe_Execution001', contractRevision: 1, resultRevision: 3, bundleDigest: 'a'.repeat(64), decision: 'approved' as const }
const confirmation = { purpose: 'worker-delivery-review' as const, target,
  action: { actionId: 'human-action-one', interaction: 'explicit_click' as const, occurredAt: '2026-08-18T01:59:00.000Z',
    confirmedInputDigest: workerDeliveryConfirmationDigest(target), sourceMessageDigest: null } }
const request = {
  purpose: 'worker-delivery-review' as const,
  factDigest: workerDeliveryHumanActionFactDigest(target, confirmation.action),
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

    await expect(service.signDeviceFact(request, confirmation)).resolves.toEqual(metadata)
    expect(signDeviceFact).toHaveBeenCalledWith(request, confirmation)
  })

  it.each([
    ['retired provisioning purpose', { ...request, purpose: 'project-content-provisioning-attestation' }],
    ['unknown purpose', { ...request, purpose: 'arbitrary-domain-signing' }],
    ['arbitrary bytes', { ...request, bytes: Buffer.from('do not sign').toString('base64url') }],
    ['secret-bearing request', { ...request, privateKey: 'forbidden' }]
  ])('fails closed for %s', async (_label, invalid) => {
    const signDeviceFact = vi.fn(async () => metadata)
    const service = defineDeviceFactAttestationSigningService({ signDeviceFact })

    await expect(service.signDeviceFact(invalid as never, confirmation)).rejects.toThrow()
    expect(signDeviceFact).not.toHaveBeenCalled()
  })

  it('rejects an implementation that returns undeclared or malformed metadata', async () => {
    const service = defineDeviceFactAttestationSigningService({
      signDeviceFact: vi.fn(async () => ({ ...metadata, accessToken: 'forbidden' }))
    } as unknown as DeviceFactAttestationSigningService)

    await expect(service.signDeviceFact(request, confirmation)).rejects.toThrow()
  })
})

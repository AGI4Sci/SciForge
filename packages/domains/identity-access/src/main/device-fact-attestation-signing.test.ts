import { describe, expect, it, vi } from 'vitest'
import {
  projectCompletionHumanActionFactDigest,
  projectCompletionTargetDigest,
  workerDeliveryConfirmationDigest,
  workerDeliveryHumanActionFactDigest,
  type DeviceFactHumanConfirmation,
  type DeviceFactSignatureMetadata,
  type DeviceFactSigningRequest
} from '@sciforge/collaboration-contracts'
import type { DomainMainHumanActionsHost } from '@sciforge/domain-sdk/host'
import { createIdentityDeviceFactAttestationSigningService } from './device-fact-attestation-signing.js'
import type { CloudIdentityRuntime } from './cloud-runtime.js'

const action = {
  actionId: 'human-action:review-one',
  interaction: 'explicit_click' as const,
  occurredAt: '2026-10-16T00:00:00.000Z',
  sourceMessageDigest: null
}
const workerTarget = {
  projectId: 'prj_Project000001', taskId: 'tsk_Task00000001', executionId: 'exe_Execution001',
  contractRevision: 1, resultRevision: 2, bundleDigest: 'a'.repeat(64), decision: 'approved' as const
}
const completionTarget = {
  projectId: workerTarget.projectId, expectedProjectRevision: 3,
  expectedCoordinatorAuthorityEpoch: 1, expectedExecutionAuthorityEpoch: 1,
  projectPlanId: 'pln_Plan00000001', confirmedPlanRevision: 2,
  projectResultIds: ['res_Result000001'], summary: 'Validated project result.'
}
const confirmations: DeviceFactHumanConfirmation[] = [
  { purpose: 'worker-delivery-review', target: workerTarget,
    action: { ...action, confirmedInputDigest: workerDeliveryConfirmationDigest(workerTarget) } },
  { purpose: 'project-completion-approval', target: completionTarget,
    action: { ...action, confirmedInputDigest: projectCompletionTargetDigest(completionTarget) } }
]
function harness(confirmation: DeviceFactHumanConfirmation) {
  const request: DeviceFactSigningRequest = {
    purpose: confirmation.purpose,
    factDigest: confirmation.purpose === 'worker-delivery-review'
      ? workerDeliveryHumanActionFactDigest(confirmation.target, confirmation.action)
      : projectCompletionHumanActionFactDigest(confirmation.target, confirmation.action),
    factRevision: 2,
    observedAt: confirmation.action.occurredAt
  }
  const signature: DeviceFactSignatureMetadata = {
    purpose: request.purpose, userId: 'usr_User00000001', deviceId: 'dev_Device000001',
    deviceKeyId: 'device-key-01', deviceKeyRevision: 1, signatureAlgorithm: 'Ed25519',
    canonicalPayloadDigest: request.factDigest, factRevision: request.factRevision,
    observedAt: request.observedAt, issuedAt: '2026-10-16T00:00:01.000Z',
    signature: Buffer.alloc(64, 7).toString('base64url')
  }
  const principal = {
    authority: 'sciforge-cloud', subject: signature.userId, deviceId: signature.deviceId,
    assurance: 'cloud-authenticated' as const, identityVersion: 1
  }
  const assertCurrent = vi.fn()
  const validate = vi.fn(() => ({ principal, assertCurrent }))
  const humanActions: DomainMainHumanActionsHost = { capture: vi.fn(), validate }
  const signDeviceFactAttestation = vi.fn(async () => signature)
  const service = createIdentityDeviceFactAttestationSigningService({
    getRuntime: () => ({ signDeviceFactAttestation }) as unknown as CloudIdentityRuntime,
    humanActions
  })
  return { service, request, signature, principal, assertCurrent, validate, signDeviceFactAttestation }
}

describe.each(confirmations)('Human Device signing: $purpose', (confirmation) => {
  it('binds the typed target and genuine Host action before and after signing', async () => {
    const h = harness(confirmation)
    await expect(h.service.signDeviceFact(h.request, confirmation)).resolves.toEqual(h.signature)
    expect(h.validate).toHaveBeenCalledWith({ target: confirmation.target, action: confirmation.action })
    expect(h.assertCurrent).toHaveBeenCalledTimes(2)
    expect(h.signDeviceFactAttestation).toHaveBeenCalledWith(h.request)
  })

  it.each(['factDigest', 'factRevision', 'observedAt', 'purpose'] as const)('rejects a different %s before using the key', async (field) => {
    const h = harness(confirmation)
    const values = { factDigest: 'b'.repeat(64), factRevision: 3, observedAt: '2026-10-16T00:00:02.000Z',
      purpose: confirmation.purpose === 'worker-delivery-review' ? 'project-completion-approval' : 'worker-delivery-review' }
    await expect(h.service.signDeviceFact({ ...h.request, [field]: values[field] }, confirmation))
      .rejects.toMatchObject({ code: 'human_confirmation_required' })
    expect(h.signDeviceFactAttestation).not.toHaveBeenCalled()
  })

  it('rejects bare digest signing and missing Host validation', async () => {
    const h = harness(confirmation)
    await expect(h.service.signDeviceFact(h.request, undefined as never)).rejects.toMatchObject({ code: 'human_confirmation_required' })
    const unhosted = createIdentityDeviceFactAttestationSigningService({
      getRuntime: () => ({ signDeviceFactAttestation: h.signDeviceFactAttestation }) as unknown as CloudIdentityRuntime
    })
    await expect(unhosted.signDeviceFact(h.request, confirmation)).rejects.toMatchObject({ code: 'human_confirmation_required' })
    expect(h.signDeviceFactAttestation).not.toHaveBeenCalled()
  })

  it('rejects a forged or stale action before key use', async () => {
    const h = harness(confirmation)
    h.validate.mockImplementation(() => { throw new Error('Host action mismatch') })
    await expect(h.service.signDeviceFact(h.request, confirmation)).rejects.toThrow('Host action mismatch')
    expect(h.signDeviceFactAttestation).not.toHaveBeenCalled()
  })

  it('discards a signature when the active human lease expires during Device refresh', async () => {
    const h = harness(confirmation)
    h.assertCurrent.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error('expired') })
    await expect(h.service.signDeviceFact(h.request, confirmation)).rejects.toThrow('expired')
    expect(h.signDeviceFactAttestation).toHaveBeenCalledOnce()
  })

  it.each(['userId', 'deviceId'] as const)('rejects a signature for a different %s', async (field) => {
    const h = harness(confirmation)
    h.signDeviceFactAttestation.mockResolvedValue({ ...h.signature, [field]: `${h.signature[field]}other` })
    await expect(h.service.signDeviceFact(h.request, confirmation)).rejects.toMatchObject({ code: 'device_revalidation_failed' })
  })

  it('requires Cloud authentication rather than a local account selection', async () => {
    const h = harness(confirmation)
    h.validate.mockReturnValue({ principal: { ...h.principal, assurance: 'local-selection' } as never, assertCurrent: h.assertCurrent })
    await expect(h.service.signDeviceFact(h.request, confirmation)).rejects.toMatchObject({ code: 'identity_required' })
    expect(h.signDeviceFactAttestation).not.toHaveBeenCalled()
  })
})

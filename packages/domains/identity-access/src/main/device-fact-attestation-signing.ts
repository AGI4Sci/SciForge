import {
  workerDeliveryHumanActionFactDigest,
  projectCompletionHumanActionFactDigest
} from '@sciforge/collaboration-contracts'
import type { DomainMainHumanActionsHost } from '@sciforge/domain-sdk/host'
import {
  DeviceFactAttestationSigningError,
  defineDeviceFactAttestationSigningService,
  type DeviceFactAttestationSigningService
} from '../device-fact-attestation-signing.js'
import type { CloudIdentityRuntime } from './cloud-runtime.js'

export function createIdentityDeviceFactAttestationSigningService(options: Readonly<{
  getRuntime: () => CloudIdentityRuntime | null
  humanActions?: DomainMainHumanActionsHost
}>): DeviceFactAttestationSigningService {
  return defineDeviceFactAttestationSigningService({
    signDeviceFact: async (request, confirmation) => {
      const factDigest = confirmation.purpose === 'worker-delivery-review'
        ? workerDeliveryHumanActionFactDigest(confirmation.target, confirmation.action)
        : projectCompletionHumanActionFactDigest(confirmation.target, confirmation.action)
      const revision = confirmation.purpose === 'worker-delivery-review'
        ? confirmation.target.resultRevision
        : 'baselineKind' in confirmation.target
          ? confirmation.target.confirmedRequirementsRevision
          : confirmation.target.confirmedPlanRevision
      if (!options.humanActions || request.purpose !== confirmation.purpose ||
        request.factDigest !== factDigest || request.factRevision !== revision ||
        request.observedAt !== confirmation.action.occurredAt) {
        throw new DeviceFactAttestationSigningError('human_confirmation_required', 'The Device fact does not match the confirmed human decision.')
      }
      const lease = options.humanActions.validate({ target: confirmation.target, action: confirmation.action })
      if (lease.principal.assurance !== 'cloud-authenticated' || lease.principal.authority !== 'sciforge-cloud') {
        throw new DeviceFactAttestationSigningError('identity_required', 'Human decision signing requires the current Cloud-authenticated Principal.')
      }
      lease.assertCurrent()
      const runtime = options.getRuntime()
      if (!runtime) {
        throw new DeviceFactAttestationSigningError(
          'signer_unavailable',
          'Cloud identity runtime is not active.'
        )
      }
      const signature = await runtime.signDeviceFactAttestation(request)
      lease.assertCurrent()
      if (signature.userId !== lease.principal.subject || signature.deviceId !== lease.principal.deviceId) {
        throw new DeviceFactAttestationSigningError('device_revalidation_failed', 'The signing Device does not match the confirmed human Principal.')
      }
      return signature
    }
  })
}

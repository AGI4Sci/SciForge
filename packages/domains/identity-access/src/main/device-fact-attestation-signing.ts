import {
  DeviceFactAttestationSigningError,
  defineDeviceFactAttestationSigningService,
  type DeviceFactAttestationSigningService
} from '../device-fact-attestation-signing.js'
import type { CloudIdentityRuntime } from './cloud-runtime.js'

export function createIdentityDeviceFactAttestationSigningService(options: Readonly<{
  getRuntime: () => CloudIdentityRuntime | null
}>): DeviceFactAttestationSigningService {
  return defineDeviceFactAttestationSigningService({
    signDeviceFact: async (request) => {
      const runtime = options.getRuntime()
      if (!runtime) {
        throw new DeviceFactAttestationSigningError(
          'signer_unavailable',
          'Cloud identity runtime is not active.'
        )
      }
      return runtime.signDeviceFactAttestation(request)
    }
  })
}

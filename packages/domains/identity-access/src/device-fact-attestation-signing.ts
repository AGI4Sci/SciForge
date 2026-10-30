import {
  deviceFactSignatureMetadataSchema,
  deviceFactHumanConfirmationSchema,
  deviceFactSigningRequestSchema,
  type DeviceFactSignatureMetadata,
  type DeviceFactHumanConfirmation,
  type DeviceFactSigningRequest
} from '@sciforge/collaboration-contracts'

export const DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID =
  'sciforge.device-fact-attestation-signing' as const
export const DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION = '2.0.0' as const

export type DeviceFactAttestationSigningService = Readonly<{
  signDeviceFact(
    request: DeviceFactSigningRequest,
    humanConfirmation: DeviceFactHumanConfirmation
  ): Promise<DeviceFactSignatureMetadata>
}>

export type DeviceFactAttestationSigningErrorCode =
  | 'signer_unavailable'
  | 'human_confirmation_required'
  | 'identity_required'
  | 'device_required'
  | 'device_revoked'
  | 'device_revalidation_failed'
  | 'device_key_unavailable'
  | 'device_key_mismatch'
  | 'fact_observation_invalid'

export class DeviceFactAttestationSigningError extends Error {
  constructor(
    readonly code: DeviceFactAttestationSigningErrorCode,
    message: string
  ) {
    super(message.slice(0, 2_048))
    this.name = 'DeviceFactAttestationSigningError'
  }
}

export function defineDeviceFactAttestationSigningService(
  input: DeviceFactAttestationSigningService
): DeviceFactAttestationSigningService {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    typeof input.signDeviceFact !== 'function') {
    throw new TypeError('Device fact attestation signing service is invalid.')
  }
  return Object.freeze({
    signDeviceFact: async (request, humanConfirmation) => {
      const parsed = deviceFactSigningRequestSchema.parse(request)
      if (humanConfirmation === undefined) {
        throw new DeviceFactAttestationSigningError('human_confirmation_required', 'This signing purpose requires its exact typed human confirmation.')
      }
      return deviceFactSignatureMetadataSchema.parse(await input.signDeviceFact(
        parsed,
        deviceFactHumanConfirmationSchema.parse(humanConfirmation)
      ))
    }
  })
}

export type {
  DeviceFactSignatureMetadata,
  DeviceFactHumanConfirmation,
  DeviceFactSigningRequest
} from '@sciforge/collaboration-contracts'

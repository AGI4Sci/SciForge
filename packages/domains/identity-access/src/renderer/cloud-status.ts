import type { CloudIdentitySnapshot } from '../contract.js'

/**
 * Canonical device labels for a Cloud snapshot. The account overlay renders the
 * full state; the sidebar reuses the same keys for its compact summary.
 */
export const CLOUD_DEVICE_STATUS_MESSAGE = Object.freeze({
  'signed-out': 'cloudDeviceNotEnrolled',
  'not-enrolled': 'cloudDeviceNotEnrolled',
  enrolling: 'cloudDeviceEnrolling',
  active: 'cloudDeviceActive',
  revoked: 'cloudDeviceRevoked',
  error: 'cloudDeviceError'
} as const)

export type CloudStatusTone = 'muted' | 'positive' | 'warning' | 'critical'

export type CloudAccountStatus = Readonly<{
  signedIn: boolean
  messageKey: string
  tone: CloudStatusTone
}>

/**
 * Presentation-only classification of the canonical Cloud snapshot. Surfaces
 * that only summarize Cloud state must not re-implement identity or device
 * transitions, and must never perform a sign-in mutation of their own.
 */
export function cloudAccountStatus(
  cloud: CloudIdentitySnapshot | null,
  cloudLoading: boolean
): CloudAccountStatus {
  if (!cloud) {
    return {
      signedIn: false,
      messageKey: cloudLoading ? 'cloudLoading' : 'cloudSignedOut',
      tone: 'muted'
    }
  }
  if (cloud.identity.state !== 'signed-in') {
    return { signedIn: false, messageKey: 'cloudSignedOut', tone: 'muted' }
  }
  const deviceState = cloud.device.state
  return {
    signedIn: true,
    messageKey: CLOUD_DEVICE_STATUS_MESSAGE[deviceState],
    tone: deviceState === 'active'
      ? 'positive'
      : deviceState === 'revoked' || deviceState === 'error'
        ? 'critical'
        : 'warning'
  }
}

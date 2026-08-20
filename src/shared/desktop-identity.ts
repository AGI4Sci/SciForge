export type DesktopIdentityUser = {
  userId: string
  externalIdentityId: string
  issuer: string
  subject: string
  displayName: string
  username?: string
  email?: string
  emailVerified?: boolean
}

export type DesktopIdentityStatus =
  | { state: 'signed-out' }
  | {
      state: 'signed-in'
      user: DesktopIdentityUser
      accessTokenExpiresAt: string
    }

export type DesktopIdentityErrorCode =
  | 'OIDC_CONFIGURATION_ERROR'
  | 'OIDC_PROVIDER_UNAVAILABLE'
  | 'OIDC_LOGIN_CANCELLED'
  | 'OIDC_LOGIN_TIMEOUT'
  | 'OIDC_CALLBACK_INVALID'
  | 'OIDC_TOKEN_INVALID'
  | 'OIDC_LOGIN_FAILED'
  | 'SCIFORGE_CLOUD_UNAVAILABLE'
  | 'SCIFORGE_CLOUD_AUTH_FAILED'
  | 'SCIFORGE_CLOUD_RESPONSE_INVALID'

export type DesktopIdentityActionResult =
  | { ok: true; status: DesktopIdentityStatus }
  | {
      ok: false
      error: {
        code: DesktopIdentityErrorCode
        message: string
      }
      status: DesktopIdentityStatus
    }

export type DesktopDeviceSummary = {
  deviceId: string
  displayName: string
  status: 'pending' | 'active' | 'revoked'
  platform: {
    os: 'windows' | 'macos' | 'linux'
    arch: 'x64' | 'arm64'
    osVersion?: string
    appVersion: string
  }
  activatedAt?: string
  revokedAt?: string
}

export type DesktopDeviceStatus =
  | { state: 'signed-out' }
  | { state: 'not-enrolled' }
  | { state: 'enrolling' }
  | { state: 'active'; device: DesktopDeviceSummary }
  | { state: 'revoked'; device: DesktopDeviceSummary }
  | { state: 'error'; message: string }

export type DesktopDeviceActionResult =
  | { ok: true; status: DesktopDeviceStatus; devices: DesktopDeviceSummary[] }
  | { ok: false; status: DesktopDeviceStatus; devices: DesktopDeviceSummary[]; message: string }

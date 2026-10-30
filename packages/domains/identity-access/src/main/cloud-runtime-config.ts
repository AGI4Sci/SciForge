import {
  CloudIdentityClientError,
  type CloudIdentityClient
} from './cloud-identity-client.js'

export type DesktopIdentityRuntimeConfig =
  | Readonly<{ mode: 'http'; issuer: string; cloudBaseUrl: string }>
  | Readonly<{ mode: 'disabled'; issuer: string | null; error: string }>

export function resolveDesktopIdentityRuntimeConfig(input: Readonly<{
  oidcIssuer?: string
  cloudBaseUrl?: string
}>): DesktopIdentityRuntimeConfig {
  const configuredIssuer = trimmed(input.oidcIssuer)
  const configuredCloudBaseUrl = trimmed(input.cloudBaseUrl)
  if (!configuredIssuer || !configuredCloudBaseUrl) {
    const missing = [
      ...(configuredIssuer ? [] : ['SCIFORGE_OIDC_ISSUER']),
      ...(configuredCloudBaseUrl ? [] : ['SCIFORGE_CLOUD_BASE_URL'])
    ]
    return {
      mode: 'disabled',
      issuer: configuredIssuer ?? null,
      error: `Cloud identity is disabled because ${missing.join(' and ')} is not configured.`
    }
  }

  try {
    validateIdentityUrl(configuredIssuer, 'OIDC issuer')
    validateIdentityUrl(configuredCloudBaseUrl, 'SciForge Cloud base URL')
  } catch (error) {
    return {
      mode: 'disabled',
      issuer: null,
      error: error instanceof Error ? error.message : 'Cloud identity configuration is invalid.'
    }
  }

  return { mode: 'http', issuer: configuredIssuer, cloudBaseUrl: configuredCloudBaseUrl }
}

export function createUnavailableCloudIdentityClient(
  message: string
): CloudIdentityClient {
  const fail = (): never => {
    throw new CloudIdentityClientError('provider_unavailable', message)
  }
  return {
    getCurrentUser: async () => fail(),
    createDeviceEnrollment: async () => fail(),
    createDevice: async () => fail(),
    listDevices: async () => fail(),
    revokeDevice: async () => fail()
  }
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim()
  return result ? result : undefined
}

function validateIdentityUrl(value: string, label: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError(`${label} must be a valid URL.`)
  }
  const loopbackHttp = url.protocol === 'http:' && (
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  )
  if (
    (url.protocol !== 'https:' && !loopbackHttp) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new TypeError(`${label} must use HTTPS, except for loopback development, with no credentials, query, or fragment.`)
  }
}

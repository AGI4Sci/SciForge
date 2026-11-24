import {
  CloudIdentityClientError,
  type CloudIdentityClient
} from './cloud-identity-client.js'

export type IdentityConfigurationField = 'oidcIssuer' | 'cloudBaseUrl'
export type IdentityConfigurationSource = 'settings' | 'environment'

/**
 * Deployment input for Desktop Cloud sign-in.
 *
 * `settings` is the package-owned, non-secret document a user edits from the
 * Account surface. `oidcIssuer`/`cloudBaseUrl` are the deployment-provided
 * environment values. An explicit saved setting wins over the environment so a
 * user can correct a deployment default without editing the launch script.
 *
 * The repository's shared-development defaults live in
 * `deployments/development/sciforge.env` and `.env.local.example`, which the
 * development launcher applies. Packaged builds deliberately carry no endpoint
 * default: incomplete configuration fails closed instead of contacting an
 * invented production service.
 */
export type DesktopIdentityConfigurationInput = Readonly<{
  oidcIssuer?: string
  cloudBaseUrl?: string
  settings?: Readonly<{
    oidcIssuer?: string | null
    cloudBaseUrl?: string | null
  }> | null
}>

export type DesktopIdentityConfigurationStatus = Readonly<{
  oidcIssuer: string | null
  cloudBaseUrl: string | null
  source: Readonly<Record<IdentityConfigurationField, IdentityConfigurationSource | null>>
  missing: readonly IdentityConfigurationField[]
  invalid: readonly IdentityConfigurationField[]
  error: string | null
}>

export type DesktopIdentityRuntimeConfig =
  | Readonly<{ mode: 'http'; issuer: string; cloudBaseUrl: string }>
  | Readonly<{ mode: 'disabled'; issuer: string | null; error: string }>

const FIELD_DESCRIPTIONS: Readonly<Record<IdentityConfigurationField, Readonly<{
  label: string
  env: string
}>>> = Object.freeze({
  oidcIssuer: Object.freeze({ label: 'the OIDC issuer', env: 'SCIFORGE_OIDC_ISSUER' }),
  cloudBaseUrl: Object.freeze({
    label: 'the SciForge Cloud service address',
    env: 'SCIFORGE_CLOUD_BASE_URL'
  })
})

/**
 * Pure configuration inspection shared by runtime activation and the Account
 * settings capability. It never performs I/O and never falls back to an
 * invented endpoint: incomplete or invalid input fails closed.
 */
export function inspectDesktopIdentityConfiguration(
  input: DesktopIdentityConfigurationInput
): DesktopIdentityConfigurationStatus {
  const oidcIssuer = resolveField(
    trimmed(input.settings?.oidcIssuer),
    trimmed(input.oidcIssuer)
  )
  const cloudBaseUrl = resolveField(
    trimmed(input.settings?.cloudBaseUrl),
    trimmed(input.cloudBaseUrl)
  )
  const missing: IdentityConfigurationField[] = []
  const invalid: IdentityConfigurationField[] = []
  const validationErrors: string[] = []
  const validate = (field: IdentityConfigurationField, value: string | null): void => {
    if (!value) {
      missing.push(field)
      return
    }
    try {
      validateIdentityUrl(value, FIELD_DESCRIPTIONS[field].label)
    } catch (error) {
      invalid.push(field)
      validationErrors.push(error instanceof Error ? error.message : 'The value is not a valid URL.')
    }
  }
  validate('oidcIssuer', oidcIssuer.value)
  validate('cloudBaseUrl', cloudBaseUrl.value)

  const missingMessage = missing.length > 0
    ? `SciForge Cloud is not configured. Set ${missing.map((field) =>
      FIELD_DESCRIPTIONS[field].label).join(' and ')} in Account settings, or provide ${missing.map(
      (field) => FIELD_DESCRIPTIONS[field].env).join(' and ')}.`
    : null
  const invalidMessage = validationErrors.length > 0
    ? `${validationErrors.join(' ')} Correct the value in Account settings.`
    : null

  return {
    oidcIssuer: oidcIssuer.value,
    cloudBaseUrl: cloudBaseUrl.value,
    source: {
      oidcIssuer: oidcIssuer.source,
      cloudBaseUrl: cloudBaseUrl.source
    },
    missing,
    invalid,
    error: missingMessage ?? invalidMessage
  }
}

export function resolveDesktopIdentityRuntimeConfig(
  input: DesktopIdentityConfigurationInput
): DesktopIdentityRuntimeConfig {
  const status = inspectDesktopIdentityConfiguration(input)
  if (status.error) {
    const issuer = status.invalid.length > 0 ? null : status.oidcIssuer
    return { mode: 'disabled', issuer, error: status.error }
  }
  return {
    mode: 'http',
    issuer: status.oidcIssuer!,
    cloudBaseUrl: status.cloudBaseUrl!
  }
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

function resolveField(
  setting: string | undefined,
  environment: string | undefined
): Readonly<{ value: string | null; source: IdentityConfigurationSource | null }> {
  if (setting) return { value: setting, source: 'settings' }
  if (environment) return { value: environment, source: 'environment' }
  return { value: null, source: null }
}

function trimmed(value: string | null | undefined): string | undefined {
  const result = value?.trim()
  return result ? result : undefined
}

export function validateIdentityUrl(value: string, label: string): void {
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

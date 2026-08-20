import {
  collaborationErrorCodeSchema,
  currentUserResponseSchema,
  currentDevicesResponseSchema,
  desktopDeviceRegistrationSchema,
  deviceEnrollmentChallengeSchema,
  deviceEnrollmentStartSchema,
  deviceRecordSchema,
  type CollaborationErrorCode,
  type CurrentUserResponse,
  type CurrentDevicesResponse,
  type DesktopDeviceRegistration,
  type DeviceEnrollmentChallenge,
  type DeviceEnrollmentStart,
  type DeviceRecord,
  type VerifiedOidcClaims
} from '@sciforge/collaboration-contracts'

export type IdentityAccessContext = Readonly<{
  accessToken: string
  verifiedClaims?: VerifiedOidcClaims
}>

export interface CollaborationIdentityClient {
  getCurrentUser(context: IdentityAccessContext): Promise<CurrentUserResponse>
  startDeviceEnrollment(
    context: IdentityAccessContext,
    input: DeviceEnrollmentStart
  ): Promise<DeviceEnrollmentChallenge>
  registerDevice(
    context: IdentityAccessContext,
    input: DesktopDeviceRegistration
  ): Promise<DeviceRecord>
  listDevices(context: IdentityAccessContext): Promise<CurrentDevicesResponse>
  revokeDevice(context: IdentityAccessContext, deviceId: string): Promise<DeviceRecord>
}

export class CollaborationIdentityClientError extends Error {
  constructor(
    readonly code: CollaborationErrorCode,
    message: string,
    readonly requestId?: string,
    readonly httpStatus?: number
  ) {
    super(message)
    this.name = 'CollaborationIdentityClientError'
  }
}

export type HttpCollaborationIdentityClientOptions = Readonly<{
  baseUrl: string
  fetchImpl?: typeof fetch
}>

export class HttpCollaborationIdentityClient implements CollaborationIdentityClient {
  readonly #baseUrl: string
  readonly #fetch: typeof fetch

  constructor(options: HttpCollaborationIdentityClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl)
    this.#fetch = options.fetchImpl ?? fetch
  }

  async getCurrentUser(context: IdentityAccessContext): Promise<CurrentUserResponse> {
    const response = await this.#request('GET', '/v1/me', context.accessToken)
    return currentUserResponseSchema.parse(response)
  }

  async startDeviceEnrollment(
    context: IdentityAccessContext,
    input: DeviceEnrollmentStart
  ): Promise<DeviceEnrollmentChallenge> {
    const body = deviceEnrollmentStartSchema.parse(input)
    const response = await this.#request('POST', '/v1/device-enrollments', context.accessToken, body)
    return deviceEnrollmentChallengeSchema.parse(response)
  }

  async registerDevice(
    context: IdentityAccessContext,
    input: DesktopDeviceRegistration
  ): Promise<DeviceRecord> {
    const body = desktopDeviceRegistrationSchema.parse(input)
    const response = await this.#request('POST', '/v1/devices', context.accessToken, body)
    return deviceRecordSchema.parse(response)
  }

  async listDevices(context: IdentityAccessContext): Promise<CurrentDevicesResponse> {
    const response = await this.#request('GET', '/v1/me/devices', context.accessToken)
    return currentDevicesResponseSchema.parse(response)
  }

  async revokeDevice(context: IdentityAccessContext, deviceId: string): Promise<DeviceRecord> {
    const response = await this.#request(
      'DELETE',
      `/v1/me/devices/${encodeURIComponent(deviceId)}`,
      context.accessToken
    )
    return deviceRecordSchema.parse(response)
  }

  async #request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    accessToken: string,
    requestBody?: unknown
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
          ...(requestBody === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) })
      })
    } catch {
      throw new CollaborationIdentityClientError(
        'provider_unavailable',
        'Cannot reach the SciForge Cloud identity service.'
      )
    }

    const responseBody = await response.json().catch(() => null)
    if (!response.ok) throw cloudError(response.status, responseBody)
    return responseBody
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim())
  const loopbackHttp = url.protocol === 'http:' && (
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  )
  if ((url.protocol !== 'https:' && !loopbackHttp) || url.username || url.password || url.search || url.hash) {
    throw new TypeError('SciForge Cloud base URL must use HTTPS, except for loopback development.')
  }
  return url.toString().replace(/\/+$/u, '')
}

function cloudError(status: number, body: unknown): CollaborationIdentityClientError {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const nested = record.error && typeof record.error === 'object'
    ? record.error as Record<string, unknown>
    : record
  const rawCode = typeof nested.code === 'string' ? nested.code.toLowerCase() : ''
  const parsedCode = collaborationErrorCodeSchema.safeParse(rawCode)
  const codeAliases: Readonly<Record<string, CollaborationErrorCode>> = {
    binding_code_expired: 'expired',
    binding_code_used: 'invalid_state_transition',
    identity_already_bound: 'identity_conflict',
    device_revoked: 'credential_revoked'
  }
  const code = parsedCode.success ? parsedCode.data : codeAliases[rawCode] ?? (status === 401
    ? 'authentication_required'
    : status === 403
      ? 'permission_denied'
      : status === 409
        ? 'identity_conflict'
        : status === 404
          ? 'not_found'
          : status >= 500
            ? 'provider_unavailable'
            : status === 410
              ? 'expired'
              : 'validation_error')
  const message = typeof nested.message === 'string' && nested.message.trim()
    ? nested.message.trim()
    : `SciForge Cloud identity request failed with HTTP ${status}.`
  const requestId = typeof nested.requestId === 'string' ? nested.requestId : undefined
  return new CollaborationIdentityClientError(code, message, requestId, status)
}

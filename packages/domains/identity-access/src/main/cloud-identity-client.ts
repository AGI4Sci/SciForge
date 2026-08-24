import {
  collaborationErrorCodeSchema,
  deviceCreateRequestSchema,
  deviceEnrollmentCreateRequestSchema,
  deviceEnrollmentCreateResponseSchema,
  deviceListResponseSchema,
  deviceResponseSchema,
  deviceRevokeRequestSchema,
  meResponseSchema,
  type CollaborationErrorCode,
  type Device,
  type DeviceCreateRequest,
  type DeviceEnrollmentCreateRequest,
  type DeviceEnrollmentCreateResponse,
  type DeviceListResponse,
  type DeviceRevokeRequest,
  type MeResponse
} from '@sciforge/collaboration-contracts'

/** Main-process-private authority used only while making an authenticated Cloud request. */
export type CloudIdentityAccessContext = Readonly<{
  accessToken: string
}>

/** Main-process-private client shared by OIDC bootstrap and Device lifecycle services. */
export interface CloudIdentityClient {
  getCurrentUser(context: CloudIdentityAccessContext): Promise<MeResponse>
  createDeviceEnrollment(
    context: CloudIdentityAccessContext,
    input: DeviceEnrollmentCreateRequest
  ): Promise<DeviceEnrollmentCreateResponse>
  createDevice(
    context: CloudIdentityAccessContext,
    input: DeviceCreateRequest
  ): Promise<Device>
  listDevices(context: CloudIdentityAccessContext): Promise<DeviceListResponse>
  revokeDevice(context: CloudIdentityAccessContext, input: DeviceRevokeRequest): Promise<Device>
}

export class CloudIdentityClientError extends Error {
  constructor(
    readonly code: CollaborationErrorCode,
    message: string,
    readonly requestId?: string,
    readonly httpStatus?: number
  ) {
    super(message)
    this.name = 'CloudIdentityClientError'
  }
}

export type HttpCloudIdentityClientOptions = Readonly<{
  baseUrl: string
  fetchImpl?: typeof fetch
}>

export class HttpCloudIdentityClient implements CloudIdentityClient {
  readonly #baseUrl: string
  readonly #fetch: typeof fetch

  constructor(options: HttpCloudIdentityClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl)
    this.#fetch = options.fetchImpl ?? fetch
  }

  async getCurrentUser(context: CloudIdentityAccessContext): Promise<MeResponse> {
    const response = await this.#request('GET', '/v1/me', context.accessToken)
    return meResponseSchema.parse(response)
  }

  async createDeviceEnrollment(
    context: CloudIdentityAccessContext,
    input: DeviceEnrollmentCreateRequest
  ): Promise<DeviceEnrollmentCreateResponse> {
    const body = deviceEnrollmentCreateRequestSchema.parse(input)
    const response = await this.#request(
      'POST',
      '/v1/device-enrollments',
      context.accessToken,
      body,
      body.idempotencyKey
    )
    return deviceEnrollmentCreateResponseSchema.parse(response)
  }

  async createDevice(
    context: CloudIdentityAccessContext,
    input: DeviceCreateRequest
  ): Promise<Device> {
    const body = deviceCreateRequestSchema.parse(input)
    const response = await this.#request(
      'POST',
      '/v1/devices',
      context.accessToken,
      body,
      body.idempotencyKey
    )
    return deviceResponseSchema.parse(response).device
  }

  async listDevices(context: CloudIdentityAccessContext): Promise<DeviceListResponse> {
    const response = await this.#request('GET', '/v1/me/devices', context.accessToken)
    return deviceListResponseSchema.parse(response)
  }

  async revokeDevice(
    context: CloudIdentityAccessContext,
    input: DeviceRevokeRequest
  ): Promise<Device> {
    const body = deviceRevokeRequestSchema.parse(input)
    const response = await this.#request(
      'DELETE',
      `/v1/me/devices/${encodeURIComponent(body.deviceId)}`,
      context.accessToken,
      body,
      body.idempotencyKey
    )
    return deviceResponseSchema.parse(response).device
  }

  async #request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    accessToken: string,
    requestBody?: unknown,
    idempotencyKey?: string
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
          ...(requestBody === undefined ? {} : { 'content-type': 'application/json' }),
          ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey })
        },
        ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) })
      })
    } catch {
      throw new CloudIdentityClientError(
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

function cloudError(status: number, body: unknown): CloudIdentityClientError {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const nested = record.error && typeof record.error === 'object'
    ? record.error as Record<string, unknown>
    : record
  const rawCode = typeof nested.code === 'string' ? nested.code.toLowerCase() : ''
  const parsedCode = collaborationErrorCodeSchema.safeParse(rawCode)
  const code = parsedCode.success ? parsedCode.data : status === 401
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
              : 'validation_error'
  const message = typeof nested.message === 'string' && nested.message.trim()
    ? nested.message.trim()
    : `SciForge Cloud identity request failed with HTTP ${status}.`
  const requestId = typeof record.requestId === 'string'
    ? record.requestId
    : typeof nested.requestId === 'string'
      ? nested.requestId
      : undefined
  return new CloudIdentityClientError(code, message, requestId, status)
}

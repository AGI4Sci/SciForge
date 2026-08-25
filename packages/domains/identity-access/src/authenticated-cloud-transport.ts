import { z } from 'zod'
import {
  deviceIdSchema,
  isCredentialFieldName,
  redactedJsonSchema,
  restRequestSchema,
  restResponseSchema,
  userIdSchema,
  type RestRequest
} from '@sciforge/collaboration-contracts'

export const AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID =
  'sciforge.authenticated-cloud-transport' as const
export const AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION = '2.0.0' as const
export const AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID = 'sciforge.cloud.command' as const

const publicAuthenticatedCloudCommandSchema = restRequestSchema.superRefine(
  (request, context) => {
    if (request.type === 'agent.register' || request.type === 'agent.rotate_credential' ||
        request.type === 'agent.revoke') {
      context.addIssue({
        code: 'custom',
        path: ['type'],
        message: 'Agent credential lifecycle commands belong to the Identity-private Agent runtime.'
      })
    }
    rejectSecretBearingJsonExtensions(request, context)
  }
)

const publicAuthenticatedCloudResponseSchema = restResponseSchema.superRefine(
  (response, context) => {
    if (response.type === 'agent.registered' || response.type === 'agent.credential_rotated') {
      context.addIssue({
        code: 'custom',
        path: ['type'],
        message: 'Sealed Agent credentials belong to the Identity-private Agent runtime.'
      })
    }
    rejectSecretBearingJsonExtensions(response, context)
  }
)

export const authenticatedCloudRequestSchema = z.object({
  contractVersion: z.literal(1),
  operationId: z.literal(AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID),
  payload: publicAuthenticatedCloudCommandSchema
}).strict().superRefine((request, context) => {
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > 1_048_576) {
    context.addIssue({ code: 'custom', message: 'Authenticated Cloud request exceeds 1 MiB.' })
  }
}).readonly()

export const authenticatedCloudResponseSchema = z.object({
  contractVersion: z.literal(1),
  status: z.number().int().min(100).max(599),
  body: publicAuthenticatedCloudResponseSchema
}).strict().superRefine((response, context) => {
  if (new TextEncoder().encode(JSON.stringify(response)).byteLength > 1_048_576) {
    context.addIssue({ code: 'custom', message: 'Authenticated Cloud response exceeds 1 MiB.' })
  }
}).readonly()

export const authenticatedCloudTransportStatusSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ready'),
    baseUrl: z.url().max(2_048),
    userId: userIdSchema,
    deviceId: deviceIdSchema
  }).strict().readonly(),
  z.object({
    state: z.literal('identity_required'),
    baseUrl: z.url().max(2_048)
  }).strict().readonly(),
  z.object({
    state: z.literal('device_required'),
    baseUrl: z.url().max(2_048),
    reason: z.string().trim().min(1).max(2_048)
  }).strict().readonly(),
  z.object({
    state: z.literal('unavailable'),
    reason: z.string().trim().min(1).max(2_048)
  }).strict().readonly()
])

export type AuthenticatedCloudRequest = z.infer<typeof authenticatedCloudRequestSchema>
export type AuthenticatedCloudResponse = z.infer<typeof authenticatedCloudResponseSchema>
export type AuthenticatedCloudTransportStatus = z.infer<
  typeof authenticatedCloudTransportStatusSchema
>

export type AuthenticatedCloudTransport = Readonly<{
  status(): AuthenticatedCloudTransportStatus
  execute(
    request: AuthenticatedCloudRequest,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<AuthenticatedCloudResponse>
}>

export type AuthenticatedCloudTransportErrorCode =
  | 'transport_unavailable'
  | 'identity_required'
  | 'device_required'
  | 'operation_not_allowed'
  | 'cloud_unavailable'
  | 'cloud_response_invalid'

export class AuthenticatedCloudTransportError extends Error {
  constructor(
    readonly code: AuthenticatedCloudTransportErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message.slice(0, 2_048), options)
    this.name = 'AuthenticatedCloudTransportError'
  }
}

export function defineAuthenticatedCloudTransport(
  input: AuthenticatedCloudTransport
): AuthenticatedCloudTransport {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    typeof input.status !== 'function' || typeof input.execute !== 'function') {
    throw new TypeError('Authenticated Cloud transport is invalid.')
  }
  return Object.freeze({
    status: () => authenticatedCloudTransportStatusSchema.parse(input.status()),
    execute: async (request, options) => authenticatedCloudResponseSchema.parse(
      await input.execute(authenticatedCloudRequestSchema.parse(request), options)
    )
  })
}

/** Parses the one closed Cloud command contract used by both public and Identity-private callers. */
export function authenticatedCloudJsonBody(value: unknown): RestRequest {
  return restRequestSchema.parse(value)
}

/**
 * collaboration-contracts is closed except for provider-neutral portable
 * locator identity. Validate that exact extension with the contracts-owned
 * credential detector rather than maintaining another field denylist here.
 */
function rejectSecretBearingJsonExtensions(
  value: unknown,
  context: z.RefinementCtx,
  path: Array<string | number> = []
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretBearingJsonExtensions(
      item,
      context,
      [...path, index]
    ))
    return
  }
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (
    record.contractVersion === 1 &&
    typeof record.kind === 'string' &&
    record.kind.startsWith('content-space.') &&
    typeof record.authority === 'string' &&
    record.identity !== null &&
    typeof record.identity === 'object'
  ) {
    const result = redactedJsonSchema.safeParse(record.identity)
    if (!result.success) {
      context.addIssue({
        code: 'custom',
        path: [...path, 'identity'],
        message: 'Secret material cannot cross a portable Cloud resource identity.'
      })
    }
    rejectCredentialChannelKeys(record.identity, context, [...path, 'identity'])
  }
  for (const [key, item] of Object.entries(record)) {
    rejectSecretBearingJsonExtensions(item, context, [...path, key])
  }
}

function rejectCredentialChannelKeys(
  value: unknown,
  context: z.RefinementCtx,
  path: Array<string | number>
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectCredentialChannelKeys(
      item,
      context,
      [...path, index]
    ))
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (isCredentialFieldName(key)) {
      context.addIssue({
        code: 'custom',
        path: [...path, key],
        message: 'Credential-shaped keys are not portable resource identity.'
      })
      continue
    }
    rejectCredentialChannelKeys(item, context, [...path, key])
  }
}

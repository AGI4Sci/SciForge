import { z } from 'zod'
import {
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from '@sciforge/domain-sdk/contract'
import { deviceIdSchema, userIdSchema } from '@sciforge/collaboration-contracts'

export const AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID =
  'sciforge.authenticated-cloud-transport' as const
export const AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION = '1.0.0' as const
export const AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID = 'sciforge.cloud.command' as const

export const authenticatedCloudOperationIdSchema = z.string()
  .trim()
  .min(3)
  .max(192)
  .regex(
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u,
    'Use a namespaced authenticated Cloud operation ID.'
  )

export const authenticatedCloudRequestSchema = z.object({
  contractVersion: z.literal(1),
  operationId: authenticatedCloudOperationIdSchema,
  payload: domainPackageJsonValueSchema
}).strict().superRefine((request, context) => {
  rejectSecretMaterial(request.payload, context, ['payload'])
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > 1_048_576) {
    context.addIssue({ code: 'custom', message: 'Authenticated Cloud request exceeds 1 MiB.' })
  }
}).readonly()

export const authenticatedCloudResponseSchema = z.object({
  contractVersion: z.literal(1),
  status: z.number().int().min(100).max(599),
  body: domainPackageJsonValueSchema
}).strict().superRefine((response, context) => {
  rejectSecretMaterial(response.body, context, ['body'])
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

export function authenticatedCloudJsonBody(value: unknown): DomainPackageJsonValue {
  return domainPackageJsonValueSchema.parse(value)
}

const FORBIDDEN_SECRET_FIELDS = new Set([
  'accesstoken',
  'authorization',
  'authorizationcode',
  'clientsecret',
  'credential',
  'devicemachinecredential',
  'idtoken',
  'oidctoken',
  'password',
  'pkceverifier',
  'privatekey',
  'refreshtoken',
  'secret'
])

function rejectSecretMaterial(
  value: DomainPackageJsonValue,
  context: z.RefinementCtx,
  path: Array<string | number>
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretMaterial(item, context, [...path, index]))
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.replace(/[-_.]/gu, '').toLowerCase()
    if (FORBIDDEN_SECRET_FIELDS.has(normalized)) {
      context.addIssue({
        code: 'custom',
        path: [...path, key],
        message: 'Secret material cannot cross the authenticated Cloud transport contract.'
      })
      continue
    }
    rejectSecretMaterial(item, context, [...path, key])
  }
}

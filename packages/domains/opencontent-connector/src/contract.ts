import { z } from 'zod'
import {
  principalSnapshotSchema
} from '@sciforge/domain-sdk/principal'

export const OPENCONTENT_PROVIDER_KIND = 'opencontent' as const
export const OPENCONTENT_CONTENT_SPACE_SERVICE_ID = 'opencontent.content-space' as const
export const OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION = '4.0.0' as const

const openContentBindingDigestSchema = z.string().regex(/^[0-9a-f]{64}$/u)

export const openContentExternalBindingAttestationSchema = z.object({
  providerInstanceRef: z.string().trim().min(3).max(256),
  principal: principalSnapshotSchema,
  externalSubject: openContentBindingDigestSchema,
  bindingRevision: openContentBindingDigestSchema
}).strict().readonly()

export type OpenContentExternalBindingAttestation = z.infer<
  typeof openContentExternalBindingAttestationSchema
>

export const OPENCONTENT_CONNECTION_CAPABILITY_IDS = Object.freeze({
  status: 'opencontent.connection.status',
  bind: 'opencontent.connection.bind',
  unbind: 'opencontent.connection.unbind'
} as const)

export const openContentConnectionTargetInputSchema = z.object({
  providerInstanceRef: z.string().trim().min(3).max(256)
}).strict().readonly()

/**
 * Public enrollment is a non-secret action trigger. Account authentication is
 * owned entirely by the Connector's private native runtime.
 */
export const openContentBindInputSchema = openContentConnectionTargetInputSchema

const openContentUnbindSuccessOutputSchema = z.object({
  outcome: z.literal('success'),
  state: z.literal('disconnected'),
  remoteRevocation: z.literal('unsupported')
}).strict().readonly()

const openContentExternalAccountSummarySchema = z.object({
  id: z.string().trim().min(1).max(256),
  identityId: z.number().int().nonnegative().safe(),
  account: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(256)
}).strict().readonly()

export const openContentConnectionStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('disconnected') }).strict().readonly(),
  z.object({
    state: z.enum(['connected', 'reauthentication_required']),
    providerInstanceRef: z.string().trim().min(3).max(256),
    externalAccount: openContentExternalAccountSummarySchema
  }).strict().readonly()
])

export type OpenContentConnectionStatus = z.infer<typeof openContentConnectionStatusSchema>

const openContentConnectionSuccessResultSchema = z.object({
  outcome: z.literal('success'),
  status: openContentConnectionStatusSchema
}).strict().readonly()

export const openContentEnrollmentErrorSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('invalid_provider_instance'),
    action: z.literal('select_provider')
  }).strict().readonly(),
  z.object({
    code: z.literal('invalid_credentials'),
    action: z.literal('check_credentials')
  }).strict().readonly(),
  z.object({
    code: z.literal('provider_unavailable'),
    action: z.literal('retry')
  }).strict().readonly(),
  z.object({
    code: z.literal('rate_limited'),
    action: z.literal('retry_later')
  }).strict().readonly(),
  z.object({
    code: z.literal('provider_contract_violation'),
    action: z.literal('contact_support')
  }).strict().readonly(),
  z.object({
    code: z.literal('secure_storage_unavailable'),
    action: z.literal('repair_secure_storage')
  }).strict().readonly(),
  z.object({
    code: z.literal('native_enrollment_unavailable'),
    action: z.literal('install_native_support')
  }).strict().readonly(),
  z.object({
    code: z.literal('cancelled'),
    action: z.literal('none')
  }).strict().readonly()
])

const openContentConnectionErrorResultSchema = z.object({
  outcome: z.literal('error'),
  error: openContentEnrollmentErrorSchema
}).strict().readonly()

export const openContentConnectionResultSchema = z.discriminatedUnion('outcome', [
  openContentConnectionSuccessResultSchema,
  openContentConnectionErrorResultSchema
])

const openContentUnbindErrorOutputSchema = z.object({
  outcome: z.literal('error'),
  error: openContentEnrollmentErrorSchema
}).strict().readonly()

export const openContentUnbindOutputSchema = z.discriminatedUnion('outcome', [
  openContentUnbindSuccessOutputSchema,
  openContentUnbindErrorOutputSchema
])

export type OpenContentEnrollmentError = z.infer<typeof openContentEnrollmentErrorSchema>
export type OpenContentConnectionResult = z.infer<typeof openContentConnectionResultSchema>
export type OpenContentUnbindResult = z.infer<typeof openContentUnbindOutputSchema>

export type OpenContentConnectorErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'reauthentication_required'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'provider_contract_violation'
  | 'conflict'
  | 'outcome_unknown'
  | 'bounds_exceeded'
  | 'cancelled'

export class OpenContentConnectorError extends Error {
  readonly code: OpenContentConnectorErrorCode

  constructor(code: OpenContentConnectorErrorCode, message: string, options?: ErrorOptions) {
    super(message.slice(0, 256), options)
    this.name = 'OpenContentConnectorError'
    this.code = code
  }
}

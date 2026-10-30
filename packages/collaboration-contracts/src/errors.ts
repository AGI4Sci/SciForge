import { z } from 'zod'
import {
  entityMetadataShape,
  protocolVersionSchema,
  redactedJsonSchema,
  requestIdSchema,
  revisionSchema
} from './core.js'

export const collaborationErrorCodeSchema = z.enum([
  'validation_error',
  'authentication_required',
  'credential_revoked',
  'permission_denied',
  'assurance_insufficient',
  'not_found',
  'identity_conflict',
  'ownership_conflict',
  'revision_conflict',
  'idempotency_conflict',
  'invalid_state_transition',
  'routing_ambiguous',
  'routing_not_found',
  'provider_unavailable',
  'recipient_mismatch',
  'payload_too_large',
  'rate_limited',
  'expired',
  'version_incompatible',
  'internal_error'
])

export const collaborationErrorCategorySchema = z.enum([
  'validation',
  'authentication',
  'authorization',
  'conflict',
  'routing',
  'provider',
  'limit',
  'version',
  'internal'
])

export type CollaborationErrorCode = z.infer<typeof collaborationErrorCodeSchema>
export type CollaborationErrorCategory = z.infer<typeof collaborationErrorCategorySchema>

export type ErrorRule = Readonly<{
  category: CollaborationErrorCategory
  httpStatus: number
  retryable: boolean
}>

export const COLLABORATION_ERROR_RULES = {
  validation_error: { category: 'validation', httpStatus: 400, retryable: false },
  authentication_required: { category: 'authentication', httpStatus: 401, retryable: false },
  credential_revoked: { category: 'authentication', httpStatus: 401, retryable: false },
  permission_denied: { category: 'authorization', httpStatus: 403, retryable: false },
  assurance_insufficient: { category: 'authorization', httpStatus: 403, retryable: false },
  not_found: { category: 'validation', httpStatus: 404, retryable: false },
  identity_conflict: { category: 'conflict', httpStatus: 409, retryable: false },
  ownership_conflict: { category: 'conflict', httpStatus: 409, retryable: false },
  revision_conflict: { category: 'conflict', httpStatus: 409, retryable: true },
  idempotency_conflict: { category: 'conflict', httpStatus: 409, retryable: false },
  invalid_state_transition: { category: 'conflict', httpStatus: 409, retryable: false },
  routing_ambiguous: { category: 'routing', httpStatus: 409, retryable: false },
  routing_not_found: { category: 'routing', httpStatus: 404, retryable: false },
  provider_unavailable: { category: 'provider', httpStatus: 503, retryable: true },
  recipient_mismatch: { category: 'routing', httpStatus: 409, retryable: false },
  payload_too_large: { category: 'limit', httpStatus: 413, retryable: false },
  rate_limited: { category: 'limit', httpStatus: 429, retryable: true },
  expired: { category: 'conflict', httpStatus: 410, retryable: false },
  version_incompatible: { category: 'version', httpStatus: 426, retryable: false },
  internal_error: { category: 'internal', httpStatus: 500, retryable: true }
} as const satisfies Record<CollaborationErrorCode, ErrorRule>

export const collaborationErrorSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('error'),
  requestId: requestIdSchema.optional(),
  code: collaborationErrorCodeSchema,
  category: collaborationErrorCategorySchema,
  httpStatus: z.number().int().min(400).max(599),
  retryable: z.boolean(),
  message: z.string().trim().min(1).max(500),
  resourceType: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u).optional(),
  resourceId: z.string().min(1).max(128).optional(),
  expectedRevision: revisionSchema.optional(),
  currentRevision: revisionSchema.optional(),
  details: redactedJsonSchema.optional()
}).strict().superRefine((error, context) => {
  const rule = COLLABORATION_ERROR_RULES[error.code]
  if (error.category !== rule.category) {
    context.addIssue({ code: 'custom', path: ['category'], message: `Expected ${rule.category}` })
  }
  if (error.httpStatus !== rule.httpStatus) {
    context.addIssue({ code: 'custom', path: ['httpStatus'], message: `Expected ${rule.httpStatus}` })
  }
  if (error.retryable !== rule.retryable) {
    context.addIssue({ code: 'custom', path: ['retryable'], message: `Expected ${String(rule.retryable)}` })
  }
})

export type CollaborationError = z.infer<typeof collaborationErrorSchema>

export function createCollaborationError(
  code: CollaborationErrorCode,
  message: string,
  fields: Partial<Pick<CollaborationError,
    'requestId' | 'resourceType' | 'resourceId' | 'expectedRevision' | 'currentRevision' | 'details'>> = {}
): CollaborationError {
  const rule = COLLABORATION_ERROR_RULES[code]
  return collaborationErrorSchema.parse({
    protocolVersion: '1.0',
    type: 'error',
    code,
    message,
    ...rule,
    ...fields
  })
}

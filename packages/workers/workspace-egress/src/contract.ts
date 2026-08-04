import { z } from 'zod'
import {
  workspaceHostEgressAuthorizationSchema,
  workspaceNetworkEgressSelectionSchema,
  type WorkspaceNetworkEgressSelection
} from '@sciforge/domain-sdk/workspace-host'

export const WORKSPACE_EGRESS_PROTOCOL = 'sciforge.workspace-egress.v1' as const
export const DEFAULT_WORKSPACE_EGRESS_LEASE_TTL_MS = 60_000
export const MIN_WORKSPACE_EGRESS_LEASE_TTL_MS = 5_000
export const MAX_WORKSPACE_EGRESS_LEASE_TTL_MS = 60 * 60_000

const opaqueIdSchema = (label: string) => z.string()
  .trim()
  .min(1, `${label} is required.`)
  .max(256)
  .regex(/^\S+$/, `${label} must be an opaque, non-whitespace identifier.`)
  .refine(
    (value) => [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 31 && codePoint !== 127
    }),
    `${label} cannot contain control characters.`
  )

export const workspaceEgressWorkspaceIdSchema = opaqueIdSchema('workspaceId')
export const workspaceEgressLeaseIdSchema = opaqueIdSchema('leaseId')

export const workspaceEgressSelectionSchema = workspaceNetworkEgressSelectionSchema

export const workspaceEgressAcquireLeaseInputSchema = z.object({
  workspaceId: workspaceEgressWorkspaceIdSchema,
  selection: workspaceEgressSelectionSchema,
  ttlMs: z.number()
    .int()
    .min(MIN_WORKSPACE_EGRESS_LEASE_TTL_MS)
    .max(MAX_WORKSPACE_EGRESS_LEASE_TTL_MS)
    .optional()
}).strict()

export const workspaceEgressLeaseCredentialSchema = workspaceHostEgressAuthorizationSchema

export const workspaceEgressRelayEndpointSchema = z.object({
  protocol: z.literal('http-connect'),
  host: z.string().min(1).max(64),
  port: z.number().int().min(1).max(65_535)
}).strict()

export const workspaceEgressProxyAccessSchema = z.object({
  endpoint: workspaceEgressRelayEndpointSchema,
  credential: workspaceEgressLeaseCredentialSchema
}).strict()

export const workspaceEgressLeaseSchema = z.object({
  protocol: z.literal(WORKSPACE_EGRESS_PROTOCOL),
  leaseId: workspaceEgressLeaseIdSchema,
  workspaceId: workspaceEgressWorkspaceIdSchema,
  selection: workspaceEgressSelectionSchema,
  endpoint: workspaceEgressRelayEndpointSchema,
  credential: workspaceEgressLeaseCredentialSchema,
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
}).strict()

export const workspaceEgressHeartbeatInputSchema = z.object({
  workspaceId: workspaceEgressWorkspaceIdSchema,
  leaseId: workspaceEgressLeaseIdSchema,
  token: workspaceHostEgressAuthorizationSchema.shape.token,
  ttlMs: z.number()
    .int()
    .min(MIN_WORKSPACE_EGRESS_LEASE_TTL_MS)
    .max(MAX_WORKSPACE_EGRESS_LEASE_TTL_MS)
    .optional()
}).strict()

export const workspaceEgressRevokeInputSchema = z.object({
  workspaceId: workspaceEgressWorkspaceIdSchema,
  leaseId: workspaceEgressLeaseIdSchema,
  token: workspaceHostEgressAuthorizationSchema.shape.token
}).strict()

export const workspaceEgressDestinationSchema = z.object({
  hostname: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535)
}).strict()

export const workspaceEgressErrorCodeSchema = z.enum([
  'invalid_request',
  'egress_disabled',
  'route_unavailable',
  'lease_not_found',
  'lease_expired',
  'lease_revoked',
  'workspace_scope_denied',
  'invalid_lease_token',
  'destination_denied',
  'relay_closed',
  'internal_error'
])

export type WorkspaceEgressSelection = WorkspaceNetworkEgressSelection
export type WorkspaceEgressAcquireLeaseInput = z.input<typeof workspaceEgressAcquireLeaseInputSchema>
export type WorkspaceEgressRelayEndpoint = z.infer<typeof workspaceEgressRelayEndpointSchema>
export type WorkspaceEgressProxyAccess = z.infer<typeof workspaceEgressProxyAccessSchema>
export type WorkspaceEgressLease = z.output<typeof workspaceEgressLeaseSchema>
export type WorkspaceEgressHeartbeatInput = z.input<typeof workspaceEgressHeartbeatInputSchema>
export type WorkspaceEgressRevokeInput = z.input<typeof workspaceEgressRevokeInputSchema>
export type WorkspaceEgressDestination = z.infer<typeof workspaceEgressDestinationSchema>
export type WorkspaceEgressErrorCode = z.infer<typeof workspaceEgressErrorCodeSchema>

export type WorkspaceEgressLeaseState = Readonly<{
  leaseId: string
  workspaceId: string
  selection: WorkspaceEgressSelection
  expiresAt: string
}>

export class WorkspaceEgressError extends Error {
  readonly code: WorkspaceEgressErrorCode
  readonly retryable: boolean

  constructor(input: {
    code: WorkspaceEgressErrorCode
    message: string
    retryable?: boolean
  }) {
    super(input.message)
    this.name = 'WorkspaceEgressError'
    this.code = input.code
    this.retryable = input.retryable === true
  }
}

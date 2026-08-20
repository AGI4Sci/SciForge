import { z } from 'zod'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import { workspaceLocatorSchema } from '@sciforge/domain-sdk/workspace-host'

export const CAPABILITY_BROKER_CONTRACT_VERSION = 1

export type CapabilityJsonValue =
  | null
  | boolean
  | number
  | string
  | CapabilityJsonValue[]
  | { [key: string]: CapabilityJsonValue }

export const capabilityJsonValueSchema: z.ZodType<CapabilityJsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(capabilityJsonValueSchema),
  z.record(z.string(), capabilityJsonValueSchema)
]))

export const capabilityAudienceSchema = z.enum(['ui', 'agent', 'system'])
export type CapabilityAudience = z.infer<typeof capabilityAudienceSchema>

export const capabilityEffectSchema = z.enum([
  'read',
  'compute',
  'workspace-write',
  'external-write',
  'destructive'
])
export type CapabilityEffect = z.infer<typeof capabilityEffectSchema>

export const capabilityApprovalModeSchema = z.enum(['none', 'confirmation', 'system'])
export type CapabilityApprovalMode = z.infer<typeof capabilityApprovalModeSchema>

export const capabilityScopeSchema = z.enum(['global', 'workspace', 'resource'])
export type CapabilityScope = z.infer<typeof capabilityScopeSchema>

export const capabilityProviderFamilySchema = z.enum(['native', 'managed-mcp'])
export type CapabilityProviderFamily = z.infer<typeof capabilityProviderFamilySchema>

export const capabilityConcurrencySchema = z.object({
  revision: z.enum(['none', 'optimistic']),
  idempotency: z.enum(['none', 'required'])
}).strict()
export type CapabilityConcurrency = z.infer<typeof capabilityConcurrencySchema>

export const capabilityIdSchema = z.string()
  .trim()
  .min(3)
  .max(192)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/, 'Use a namespaced lowercase capability ID.')

export const capabilityDescriptorSchema = z.object({
  contractVersion: z.literal(CAPABILITY_BROKER_CONTRACT_VERSION),
  id: capabilityIdSchema,
  version: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
  audiences: z.array(capabilityAudienceSchema).min(1).max(3),
  scope: capabilityScopeSchema,
  resourceKinds: z.array(z.string().trim().min(1).max(128)).max(64).default([]),
  producedResourceKinds: z.array(z.string().trim().min(1).max(128)).max(64).optional(),
  effect: capabilityEffectSchema,
  approval: capabilityApprovalModeSchema,
  /**
   * Allows an Agent external write to rely on an already-issued Broker
   * resource as its complete authority, without manufacturing a Human
   * confirmation grant. This policy is deliberately unavailable to global,
   * workspace, read, or compute capabilities; destructive operations remain
   * bounded by the exact authorized resource.
   */
  autonomousWrite: z.literal('resource-authorized').optional(),
  concurrency: capabilityConcurrencySchema,
  /** Trusted declaration that this UI action may replace the Host Principal. */
  principalTransition: z.literal('host-authority').optional(),
  inputSchema: capabilityJsonValueSchema,
  outputSchema: capabilityJsonValueSchema,
  tags: z.array(z.string().trim().min(1).max(64)).max(32).default([])
}).strict().superRefine((descriptor, context) => {
  if (new Set(descriptor.audiences).size !== descriptor.audiences.length) {
    context.addIssue({ code: 'custom', path: ['audiences'], message: 'Capability audiences must be unique.' })
  }
  if (new Set(descriptor.resourceKinds).size !== descriptor.resourceKinds.length) {
    context.addIssue({ code: 'custom', path: ['resourceKinds'], message: 'Capability resource kinds must be unique.' })
  }
  if (
    descriptor.producedResourceKinds
    && new Set(descriptor.producedResourceKinds).size !== descriptor.producedResourceKinds.length
  ) {
    context.addIssue({
      code: 'custom',
      path: ['producedResourceKinds'],
      message: 'Produced capability resource kinds must be unique.'
    })
  }
  if (descriptor.scope === 'resource' && descriptor.resourceKinds.length === 0) {
    context.addIssue({ code: 'custom', path: ['resourceKinds'], message: 'Resource-scoped capabilities must declare resource kinds.' })
  }
  if (descriptor.scope !== 'resource' && descriptor.resourceKinds.length > 0) {
    context.addIssue({ code: 'custom', path: ['resourceKinds'], message: 'Only resource-scoped capabilities may declare resource kinds.' })
  }
  if (descriptor.effect === 'read' && descriptor.approval !== 'none') {
    context.addIssue({ code: 'custom', path: ['approval'], message: 'Read capabilities cannot require approval.' })
  }
  if (descriptor.effect === 'read' && descriptor.concurrency.idempotency !== 'none') {
    context.addIssue({ code: 'custom', path: ['concurrency', 'idempotency'], message: 'Read capabilities do not use invocation idempotency.' })
  }
  if (descriptor.autonomousWrite === 'resource-authorized') {
    if (descriptor.scope !== 'resource') {
      context.addIssue({
        code: 'custom',
        path: ['autonomousWrite'],
        message: 'Resource-authorized autonomous writes must be resource-scoped.'
      })
    }
    if (descriptor.effect !== 'external-write' && descriptor.effect !== 'destructive') {
      context.addIssue({
        code: 'custom',
        path: ['autonomousWrite'],
        message: 'Resource authority can authorize only external or destructive writes.'
      })
    }
    if (descriptor.approval !== 'none') {
      context.addIssue({
        code: 'custom',
        path: ['approval'],
        message: 'Resource-authorized autonomous writes use no separate approval.'
      })
    }
    if (descriptor.audiences.length !== 1 || descriptor.audiences[0] !== 'agent') {
      context.addIssue({
        code: 'custom',
        path: ['audiences'],
        message: 'Resource-authorized autonomous writes are Agent-only.'
      })
    }
  }
  if (descriptor.effect !== 'read' && descriptor.concurrency.idempotency !== 'required') {
    context.addIssue({ code: 'custom', path: ['concurrency', 'idempotency'], message: 'Non-read capabilities must require idempotency.' })
  }
  if (descriptor.concurrency.revision === 'optimistic' && descriptor.scope !== 'resource') {
    context.addIssue({ code: 'custom', path: ['concurrency', 'revision'], message: 'Optimistic revisions require resource scope.' })
  }
  if (descriptor.principalTransition === 'host-authority') {
    if (descriptor.audiences.length !== 1 || descriptor.audiences[0] !== 'ui') {
      context.addIssue({
        code: 'custom',
        path: ['audiences'],
        message: 'Host Principal transitions must be UI-only.'
      })
    }
    if (descriptor.scope !== 'global') {
      context.addIssue({
        code: 'custom',
        path: ['scope'],
        message: 'Host Principal transitions must use global scope.'
      })
    }
    if (descriptor.effect === 'read') {
      context.addIssue({
        code: 'custom',
        path: ['effect'],
        message: 'Host Principal transitions must be mutations.'
      })
    }
    if (descriptor.resourceKinds.length > 0 || (descriptor.producedResourceKinds?.length ?? 0) > 0) {
      context.addIssue({
        code: 'custom',
        path: ['resourceKinds'],
        message: 'Host Principal transitions cannot consume or produce Broker resources.'
      })
    }
  }
  if (
    descriptor.audiences.includes('agent')
    && (descriptor.effect === 'external-write' || descriptor.effect === 'destructive')
    && descriptor.approval === 'none'
    && descriptor.autonomousWrite !== 'resource-authorized'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['approval'],
      message: 'Agent-visible external or destructive actions require approval.'
    })
  }
  if (descriptor.approval === 'system' && descriptor.audiences.some((audience) => audience !== 'system')) {
    context.addIssue({
      code: 'custom',
      path: ['audiences'],
      message: 'System-approved capabilities may only be exposed to the system audience.'
    })
  }
})
export type CapabilityDescriptor = z.infer<typeof capabilityDescriptorSchema>

/**
 * Explicit transport/registry handshake used before a caller treats discovery
 * results as authoritative. An empty capability list is valid only when this
 * contract reports `ready` for the caller's required operations.
 */
export const capabilityReadinessRequestSchema = z.object({
  workspaceId: z.string().trim().min(1).max(4_096).optional(),
  expectedContractVersion: z.number().int().positive(),
  requiredCapabilityIds: z.array(capabilityIdSchema).max(512).default([])
}).strict().superRefine((request, context) => {
  if (new Set(request.requiredCapabilityIds).size !== request.requiredCapabilityIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['requiredCapabilityIds'],
      message: 'Required capability IDs must be unique.'
    })
  }
})
export type CapabilityReadinessRequest = z.infer<typeof capabilityReadinessRequestSchema>

export const capabilityReadinessStatusSchema = z.enum(['ready', 'incompatible', 'incomplete'])
export type CapabilityReadinessStatus = z.infer<typeof capabilityReadinessStatusSchema>

export const capabilityReadinessSchema = z.object({
  contractVersion: z.number().int().positive(),
  status: capabilityReadinessStatusSchema,
  registryFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  availableCapabilityIds: z.array(capabilityIdSchema).max(2_048),
  missingCapabilityIds: z.array(capabilityIdSchema).max(512),
  message: z.string().trim().min(1).max(2_000)
}).strict()
export type CapabilityReadiness = z.infer<typeof capabilityReadinessSchema>

export const capabilityApprovalGrantSchema = z.object({
  actionId: capabilityIdSchema,
  invocationId: z.string().trim().min(1).max(256).optional(),
  mode: z.enum(['confirmation', 'system'])
}).strict()
export type CapabilityApprovalGrant = z.infer<typeof capabilityApprovalGrantSchema>

export const capabilityCallerContextSchema = z.object({
  audience: capabilityAudienceSchema,
  callerId: z.string().trim().min(1).max(256),
  workspaceId: z.string().trim().min(1).max(1_024).optional(),
  workspaceLocator: workspaceLocatorSchema.optional(),
  approvals: z.array(capabilityApprovalGrantSchema).max(64).default([])
}).strict()
export type CapabilityCallerContext = z.infer<typeof capabilityCallerContextSchema> & Readonly<{
  /** Host-captured Principal authority; intentionally absent from the public raw schema. */
  principal?: PrincipalSnapshot
  /** Host-captured signed-in or signed-out Principal context revision. */
  principalContextVersion?: number
  /** Host-issued package authority; this is intentionally absent from the public raw schema. */
  capabilityGrants?: readonly string[]
}>
export type CapabilityCallerContextInput = z.input<typeof capabilityCallerContextSchema>

export const capabilityTransportRequestIdSchema = z.string().uuid()
export type CapabilityTransportRequestId = z.infer<typeof capabilityTransportRequestIdSchema>

export const capabilityResourceHandleSchema = z.object({
  token: z.string().regex(/^cap_[A-Za-z0-9_-]{20,}$/),
  semanticRevision: z.string().trim().min(1).max(256),
  expiresAt: z.string().datetime({ offset: true })
}).strict()
export type CapabilityResourceHandle = z.infer<typeof capabilityResourceHandleSchema>

export const capabilityResourceBindingSchema = z.object({
  resource: capabilityResourceHandleSchema,
  resourceRef: z.string().regex(/^res_[A-Za-z0-9_-]{20,}$/).optional(),
  operations: z.array(capabilityDescriptorSchema).max(512)
}).strict()
export type CapabilityResourceBinding = z.infer<typeof capabilityResourceBindingSchema>

export const capabilityResourceContentDescriptorSchema = z.object({
  size: z.number().int().nonnegative(),
  mimeType: z.string().trim().min(1).max(256),
  fileName: z.string().trim().min(1).max(1_024).optional(),
  maxChunkBytes: z.number().int().positive(),
  recommendedChunkBytes: z.number().int().positive()
}).strict()
export type CapabilityResourceContentDescriptor = z.infer<typeof capabilityResourceContentDescriptorSchema>

export const capabilityResourceContentRangeSchema = z.object({
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  dataBase64: z.string()
}).strict()
export type CapabilityResourceContentRange = z.infer<typeof capabilityResourceContentRangeSchema>

export const capabilityResourceContentAccessSchema = z.object({
  workspaceId: z.string().trim().min(1).max(4_096).optional(),
  resource: capabilityResourceHandleSchema
}).strict()
export type CapabilityResourceContentAccess = z.infer<typeof capabilityResourceContentAccessSchema>

export const capabilityDiscoveryQuerySchema = z.object({
  capabilityId: capabilityIdSchema.optional(),
  text: z.string().trim().min(1).max(256).optional(),
  scope: capabilityScopeSchema.optional(),
  acceptedResourceKind: z.string().trim().min(1).max(128).optional(),
  producedResourceKind: z.string().trim().min(1).max(128).optional(),
  providerFamily: capabilityProviderFamilySchema.optional(),
  effects: z.array(capabilityEffectSchema).min(1).max(5).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).min(1).max(16).optional(),
  limit: z.number().int().min(1).max(50).optional()
}).strict()
export type CapabilityDiscoveryQuery = z.infer<typeof capabilityDiscoveryQuerySchema>

export const capabilityObserveRequestSchema = z.object({
  resource: capabilityResourceHandleSchema
}).strict()
export type CapabilityObserveRequest = z.infer<typeof capabilityObserveRequestSchema>

export const capabilityResourceBindRequestSchema = z.object({
  resourceRef: z.string().regex(/^res_[A-Za-z0-9_-]{20,}$/)
}).strict()
export type CapabilityResourceBindRequest = z.infer<typeof capabilityResourceBindRequestSchema>

export const capabilityObservationSchema = z.object({
  resource: capabilityResourceHandleSchema,
  resourceRef: z.string().regex(/^res_[A-Za-z0-9_-]{20,}$/),
  resourceKind: z.string().trim().min(1).max(128),
  semanticRevision: z.string().trim().min(1).max(256),
  layoutRevision: z.string().trim().min(1).max(256).optional(),
  observedAt: z.string().datetime({ offset: true }),
  state: capabilityJsonValueSchema,
  operations: z.array(capabilityDescriptorSchema).max(512)
}).strict()
export type CapabilityObservation = z.infer<typeof capabilityObservationSchema>

export const capabilityInvocationRequestSchema = z.object({
  actionId: capabilityIdSchema,
  invocationId: z.string().trim().min(1).max(256).optional(),
  resource: capabilityResourceHandleSchema.optional(),
  expectedRevision: z.string().trim().min(1).max(256).optional(),
  input: capabilityJsonValueSchema
}).strict()
export type CapabilityInvocationRequest = z.infer<typeof capabilityInvocationRequestSchema>

export const capabilityInvocationResultSchema = z.object({
  actionId: capabilityIdSchema,
  invocationId: z.string().trim().min(1).max(256).optional(),
  output: capabilityJsonValueSchema,
  resource: capabilityResourceHandleSchema.optional(),
  beforeRevision: z.string().trim().min(1).max(256).optional(),
  afterRevision: z.string().trim().min(1).max(256).optional(),
  changed: z.boolean(),
  replayed: z.boolean(),
  completedAt: z.string().datetime({ offset: true })
}).strict()
export type CapabilityInvocationResult = z.infer<typeof capabilityInvocationResultSchema>

export const capabilityAuditStatusSchema = z.enum(['success', 'rejected', 'failed', 'replayed'])
export const capabilityAuditRecordSchema = z.object({
  id: z.string().regex(/^audit_[A-Za-z0-9_-]{20,}$/),
  occurredAt: z.string().datetime({ offset: true }),
  status: capabilityAuditStatusSchema,
  caller: z.object({
    audience: capabilityAudienceSchema,
    callerId: z.string().trim().min(1).max(256),
    workspaceId: z.string().trim().min(1).max(1_024).optional()
  }).strict(),
  actionId: capabilityIdSchema,
  invocationId: z.string().trim().min(1).max(256).optional(),
  resourceRef: z.string().regex(/^res_[A-Za-z0-9_-]{20,}$/).optional(),
  effect: capabilityEffectSchema.optional(),
  approval: capabilityApprovalModeSchema.optional(),
  beforeRevision: z.string().trim().min(1).max(256).optional(),
  afterRevision: z.string().trim().min(1).max(256).optional(),
  errorCode: z.string().trim().min(1).max(128).optional()
}).strict()
export type CapabilityAuditRecord = z.infer<typeof capabilityAuditRecordSchema>

const capabilityResourceChangeEventBaseSchema = z.object({
  id: z.string().regex(/^event_[A-Za-z0-9_-]{20,}$/),
  type: z.literal('resource.changed'),
  occurredAt: z.string().datetime({ offset: true }),
  workspaceId: z.string().trim().min(1).max(1_024).optional(),
  resourceRef: z.string().regex(/^res_[A-Za-z0-9_-]{20,}$/),
  resourceStatus: z.enum(['live', 'retired']).default('live'),
  resourceKind: z.string().trim().min(1).max(128),
  beforeRevision: z.string().trim().min(1).max(256),
  afterRevision: z.string().trim().min(1).max(256)
})

const capabilityMutationResourceChangeEventSchema = capabilityResourceChangeEventBaseSchema.extend({
  origin: z.literal('capability'),
  actionId: capabilityIdSchema,
  invocationId: z.string().trim().min(1).max(256)
}).strict()

const capabilityProviderResourceChangeEventSchema = capabilityResourceChangeEventBaseSchema.extend({
  origin: z.literal('provider')
}).strict()

export const capabilityResourceChangeEventSchema = z.discriminatedUnion('origin', [
  capabilityMutationResourceChangeEventSchema,
  capabilityProviderResourceChangeEventSchema
])
export type CapabilityResourceChangeEvent = z.infer<typeof capabilityResourceChangeEventSchema>

export const capabilityEventQuerySchema = z.object({
  afterEventId: z.string().regex(/^event_[A-Za-z0-9_-]{20,}$/).optional(),
  resourceRef: z.string().regex(/^res_[A-Za-z0-9_-]{20,}$/).optional(),
  limit: z.number().int().min(1).max(500).default(100)
}).strict()
export type CapabilityEventQuery = z.infer<typeof capabilityEventQuerySchema>

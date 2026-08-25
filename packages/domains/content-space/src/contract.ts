import { z } from 'zod'

import {
  domainCapabilityResourceHandleSchema,
  domainFileTransferHandleSchema,
  domainWorkspaceRelativePathSchema,
  type DomainCapabilityContract
} from '@sciforge/domain-sdk/host'
import {
  domainExternalNavigationIssuedTargetSchema,
  domainExternalNavigationTargetHandleSchema
} from '@sciforge/domain-sdk/external-navigation'
import {
  MAIN_PORTABLE_RESOURCE_CODEC_LOCATION,
  PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
  PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION,
  parsePortableResourceReference,
  validatePortableIdentity,
  type PortableResourceIdentity,
  type PortableResourceReferenceCodec,
  type PortableResourceReferenceEnvelope
} from '@sciforge/domain-sdk/portable-resource-references'
import {
  principalSnapshotSchema,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import {
  providerInstanceRefSchema,
  providerKindSchema
} from '@sciforge/domain-sdk/provider-composition'

import type { ContentSpaceProviderFeatures } from './provider-features.js'
import { contentSpaceProviderFeaturesSchema } from './provider-features-schema.js'

export const CONTENT_SPACE_DOMAIN_MODULE_ID = 'sciforge.content-space' as const
export const CONTENT_SPACE_PROVIDER_CONTRACT_VERSION = '4.0.0' as const

/** The single manifest-issued grant governing the Content Space system transfer family. */
export const CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID =
  'content-space.system-transfer' as const
/** Provider-owned grant for one exact, live Human-confirmed administration batch. */
export const CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID =
  'content-space.provisioning-batch' as const
export const CONTENT_SPACE_SYSTEM_CAPABILITY_GRANTS = Object.freeze([
  CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID
] as const)

export const CONTENT_CONTAINER_REFERENCE_KIND = 'content-space.container-reference' as const
export const CONTENT_FILE_REFERENCE_KIND = 'content-space.file-reference' as const
export const ARTIFACT_REFERENCE_KIND = 'content-space.artifact-reference' as const
export const CONTENT_CONTAINER_RESOURCE_KIND = 'content-space.container' as const
export const CONTENT_FILE_RESOURCE_KIND = 'content-space.file' as const
export const ARTIFACT_RESOURCE_KIND = 'content-space.artifact' as const
export const CONTENT_SPACE_PROVIDER_ADMINISTRATION_RESOURCE_KIND =
  'content-space.provider-administration' as const
export const CONTENT_SPACE_FEATURE_SELECTION_RESOURCE_KIND =
  'content-space.feature-selection' as const
export const CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_ID =
  'content-space.provider-instance-authority' as const
export const CONTENT_SPACE_PORTABLE_EXPORT_CONSUMER_MODULE_IDS = Object.freeze([
  CONTENT_SPACE_DOMAIN_MODULE_ID
] as const)

const contentSpaceDirectoryPrincipalIdSchema = z.string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), 'Identifiers must be canonical.')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, 'Use an opaque provider-neutral identifier.')
  .refine((value) => !/^(?:res|cap|conn(?:ection)?|xfer|portal)_/iu.test(value), {
    message: 'Local handles are not durable Content Space identities.'
  })

export const contentSpaceDirectoryPrincipalKindSchema = z.enum([
  'user',
  'department',
  'position',
  'group'
])
const contentSpaceDirectoryPrincipalReferenceShape = Object.freeze({
  providerInstanceRef: providerInstanceRefSchema,
  principalId: contentSpaceDirectoryPrincipalIdSchema
})
export const contentSpaceDirectoryPrincipalReferenceSchema = z.object({
  ...contentSpaceDirectoryPrincipalReferenceShape,
  kind: contentSpaceDirectoryPrincipalKindSchema,
}).strict().readonly()
function directoryPrincipalReferenceSchema<
  Kind extends z.infer<typeof contentSpaceDirectoryPrincipalKindSchema>
>(kind: Kind) {
  return z.object({
    ...contentSpaceDirectoryPrincipalReferenceShape,
    kind: z.literal(kind)
  }).strict().readonly()
}
export const contentSpaceDirectoryUserReferenceSchema =
  directoryPrincipalReferenceSchema('user')
export const contentSpaceDirectoryDepartmentReferenceSchema =
  directoryPrincipalReferenceSchema('department')
export const contentSpaceDirectoryPositionReferenceSchema =
  directoryPrincipalReferenceSchema('position')
export const contentSpaceDirectoryGroupReferenceSchema =
  directoryPrincipalReferenceSchema('group')

export const CONTENT_SPACE_CAPABILITY_IDS = Object.freeze({
  listProviderInstances: 'content-space.list-provider-instances',
  listAgentRootCandidates: 'content-space.list-agent-root-candidates',
  describeCapabilities: 'content-space.describe-capabilities',
  listContainers: 'content-space.list-containers',
  listEntries: 'content-space.list-entries',
  observeEntry: 'content-space.observe-entry',
  createFolder: 'content-space.create-folder',
  uploadNew: 'content-space.upload-new',
  download: 'content-space.download',
  systemTransferPreflight: 'content-space.system-transfer-preflight',
  systemDownload: 'content-space.system-download',
  systemUploadNew: 'content-space.system-upload-new',
  authorizeAgentRoot: 'content-space.authorize-agent-root',
  agentListEntries: 'content-space.agent-list-entries',
  agentCreateFolder: 'content-space.agent-create-folder',
  agentUploadNew: 'content-space.agent-upload-new',
  agentDownload: 'content-space.agent-download',
  agentNativeDocumentRead: 'content-space.agent-native-document-read',
  agentNativeDocumentWorkspaceWrite: 'content-space.agent-native-document-workspace-write',
  agentNativeDocumentWrite: 'content-space.agent-native-document-write',
  agentNativeDocumentDestructive: 'content-space.agent-native-document-destructive',
  agentExtendedRead: 'content-space.agent-extended-read',
  agentExtendedWrite: 'content-space.agent-extended-write',
  agentExtendedDestructive: 'content-space.agent-extended-destructive',
  authorizeFeatureSelection: 'content-space.authorize-feature-selection',
  authorizeProviderAdministration: 'content-space.authorize-provider-administration',
  agentAdminListSpaces: 'content-space.agent-admin-list-spaces',
  agentAdminCreateSpace: 'content-space.agent-admin-create-space',
  agentAdminObserveSpace: 'content-space.agent-admin-observe-space',
  agentAdminUpdateSpace: 'content-space.agent-admin-update-space',
  agentAdminPinSpace: 'content-space.agent-admin-pin-space',
  agentAdminUnpinSpace: 'content-space.agent-admin-unpin-space',
  agentAdminOpenRoot: 'content-space.agent-admin-open-root',
  agentAdminListMembers: 'content-space.agent-admin-list-members',
  agentAdminAddMember: 'content-space.agent-admin-add-member',
  agentAdminRemoveMember: 'content-space.agent-admin-remove-member',
  resolvePortalTarget: 'content-space.resolve-portal-target',
  openPortalTarget: 'content-space.open-portal-target',
  observeImmutableVersion: 'content-space.observe-immutable-version'
} as const)

export const CONTENT_SPACE_LIMITS = Object.freeze({
  maxPageItems: 200,
  maxProviderInstances: 64,
  maxEntryNameCharacters: 128,
  maxLabelCharacters: 256,
  maxFileBytes: 1_073_741_824,
  maxUploadBytes: 16 * 1024 * 1024,
  operationDeadlineMs: 30_000,
  featureOperationDeadlineMs: 240_000,
  maxPortalLifetimeMs: 5 * 60_000
})

/** Fixed accounting limits for one fresh root-to-file descendant proof. */
export const CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS = Object.freeze({
  maxDepth: 32,
  maxPages: 64,
  maxNodes: 4_096,
  deadlineMs: 10_000
} as const)

export const contentSpaceTransferProgressSchema = z.object({
  operation: z.enum(['upload', 'download']),
  phase: z.enum([
    'selecting',
    'preparing',
    'uploading',
    'downloading',
    'finalizing',
    'succeeded',
    'failed',
    'cancelled'
  ])
}).strict().readonly().superRefine((progress, context) => {
  if ((progress.operation === 'upload' && progress.phase === 'downloading') ||
    (progress.operation === 'download' && progress.phase === 'uploading')) {
    context.addIssue({
      code: 'custom',
      message: 'Transfer progress phase does not match its operation.'
    })
  }
})
export type ContentSpaceTransferProgress = z.infer<typeof contentSpaceTransferProgressSchema>

export const contentSpaceReadinessSchema = z.enum([
  'poc_only',
  'blocked_by_contract',
  'production_ready'
])
export const contentSpaceOperationSchema = z.enum([
  'list-containers',
  'list-entries',
  'observe-entry',
  'create-folder',
  'upload-new',
  'download',
  'portal-target',
  'observe-immutable-version'
])
export const contentSpaceReadinessReasonSchema = z.enum([
  'available',
  'verification_profile_required',
  'provider_contract_missing',
  'instance_policy_blocked',
  'resource_capability_missing',
  'platform_gate_blocked',
  'audience_policy_blocked'
])
export const contentSpaceCapabilityAdmissionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('admitted'),
    reasonCode: z.enum(['production_ready', 'verification_profile_admitted'])
  }).strict().readonly(),
  z.object({
    status: z.literal('blocked'),
    reasonCode: z.enum([
      'verification_profile_required',
      'provider_contract_missing',
      'instance_policy_blocked',
      'resource_capability_missing',
      'platform_gate_blocked',
      'audience_policy_blocked'
    ])
  }).strict().readonly()
])
export const contentSpaceCapabilityStateSchema = z.object({
  operation: contentSpaceOperationSchema,
  readiness: contentSpaceReadinessSchema,
  reasonCode: contentSpaceReadinessReasonSchema
}).strict().superRefine((state, context) => {
  const available = state.reasonCode === 'available'
  const ready = state.readiness === 'production_ready'
  if (available !== ready) {
    context.addIssue({
      code: 'custom',
      path: ['reasonCode'],
      message: 'Only production-ready operations may use the available reason.'
    })
  }
}).readonly()
export const contentSpaceCapabilityStateListSchema = z.array(
  contentSpaceCapabilityStateSchema
).max(8).superRefine((states, context) => {
  const seen = new Set<string>()
  for (const [index, state] of states.entries()) {
    if (seen.has(state.operation)) {
      context.addIssue({
        code: 'custom',
        path: [index, 'operation'],
        message: `Operation ${state.operation} is duplicated.`
      })
    }
    seen.add(state.operation)
  }
}).readonly()
export const contentSpaceAdmittedCapabilityStateSchema = z.object({
  operation: contentSpaceOperationSchema,
  readiness: contentSpaceReadinessSchema,
  reasonCode: contentSpaceReadinessReasonSchema,
  admission: contentSpaceCapabilityAdmissionSchema
}).strict().superRefine((state, context) => {
  const available = state.reasonCode === 'available'
  const ready = state.readiness === 'production_ready'
  if (available !== ready) {
    context.addIssue({
      code: 'custom',
      path: ['reasonCode'],
      message: 'Only production-ready operations may use the available reason.'
    })
  }
  if (state.admission.status === 'admitted' &&
    state.admission.reasonCode === 'production_ready' && !ready) {
    context.addIssue({
      code: 'custom',
      path: ['admission', 'reasonCode'],
      message: 'Only production-ready evidence may use production-ready admission.'
    })
  }
  if (state.admission.status === 'admitted' &&
    state.admission.reasonCode === 'verification_profile_admitted' &&
    (state.readiness !== 'poc_only' ||
      state.reasonCode !== 'verification_profile_required')) {
    context.addIssue({
      code: 'custom',
      path: ['admission', 'reasonCode'],
      message: 'Only exact PoC verification-required evidence may be admitted by a profile.'
    })
  }
}).readonly()
export const contentSpaceAdmittedCapabilityStateListSchema = z.array(
  contentSpaceAdmittedCapabilityStateSchema
).max(8).superRefine((states, context) => {
  const seen = new Set<string>()
  for (const [index, state] of states.entries()) {
    if (seen.has(state.operation)) {
      context.addIssue({
        code: 'custom',
        path: [index, 'operation'],
        message: `Operation ${state.operation} is duplicated.`
      })
    }
    seen.add(state.operation)
  }
}).readonly()

export type ContentSpaceReadiness = z.infer<typeof contentSpaceReadinessSchema>
export type ContentSpaceReadinessReason = z.infer<typeof contentSpaceReadinessReasonSchema>
export type ContentSpaceOperation = z.infer<typeof contentSpaceOperationSchema>
export type ContentSpaceCapabilityState = z.infer<typeof contentSpaceCapabilityStateSchema>
export type ContentSpaceAdmittedCapabilityState = z.infer<
  typeof contentSpaceAdmittedCapabilityStateSchema
>

export const contentSpaceErrorCodeSchema = z.enum([
  'invalid_input',
  'invalid_reference',
  'invalid_target',
  'composition_not_ready',
  'invalid_contribution',
  'incompatible_contract_version',
  'unknown_provider_instance',
  'missing_provider',
  'provider_unavailable',
  'rate_limited',
  'provider_contract_violation',
  'unauthorized',
  'blocked_by_contract',
  'bounds_exceeded',
  'conflict',
  'outcome_unknown',
  'cancelled',
  'source_unavailable',
  'destination_unavailable',
  'unsafe_portal_target',
  'immutable_version_unproven'
])
export const contentSpaceErrorSchema = z.object({
  code: contentSpaceErrorCodeSchema,
  message: z.string().trim().min(1).max(256),
  retry: z.enum(['never', 'after-human-action', 'safe-with-same-invocation'])
}).strict().superRefine((error, context) => {
  if (error.code === 'outcome_unknown' && error.retry !== 'never') {
    context.addIssue({
      code: 'custom',
      path: ['retry'],
      message: 'Unknown outcomes cannot be retried automatically.'
    })
  }
})

export type ContentSpaceErrorCode = z.infer<typeof contentSpaceErrorCodeSchema>
export type ContentSpaceError = z.infer<typeof contentSpaceErrorSchema>
export type ContentSpaceResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: ContentSpaceError }>

export class ContentSpaceOperationError extends Error {
  readonly detail: ContentSpaceError

  constructor(detail: ContentSpaceError, options?: ErrorOptions) {
    const parsed = contentSpaceErrorSchema.parse(detail)
    super(parsed.message, options)
    this.name = 'ContentSpaceOperationError'
    this.detail = Object.freeze(parsed)
  }
}

export function contentSpaceResultSchema<ValueSchema extends z.ZodType>(
  valueSchema: ValueSchema
) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: valueSchema }).strict(),
    z.object({ ok: z.literal(false), error: contentSpaceErrorSchema }).strict()
  ])
}

export function contentSpaceSuccess<Value>(value: Value): ContentSpaceResult<Value> {
  return Object.freeze({ ok: true, value })
}

export function contentSpaceFailure(error: ContentSpaceError): ContentSpaceResult<never> {
  return Object.freeze({ ok: false, error: Object.freeze(contentSpaceErrorSchema.parse(error)) })
}

export const contentSpaceInvocationIdSchema = z.string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]+$/u)

const providerResourceIdSchema = z.string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), 'Resource IDs must be canonical.')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, 'Use an opaque Provider resource identity.')
  .refine((value) => !/^(?:res|cap|conn(?:ection)?)_/iu.test(value) &&
    !/^(?:xfer|portal)_[A-Za-z0-9_-]{32}$/u.test(value), {
    message: 'Local Broker and connection handles are not Provider resource identities.'
  })

export const contentSpaceSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)

export const artifactDigestSchema = z.object({
  algorithm: z.literal('sha256'),
  value: contentSpaceSha256Schema
}).strict().readonly()

const contentContainerIdentitySchema = z.object({
  containerId: providerResourceIdSchema
}).strict().readonly()
const contentFileIdentitySchema = z.object({
  fileId: providerResourceIdSchema
}).strict().readonly()
const artifactIdentitySchema = z.object({
  fileId: providerResourceIdSchema,
  immutableVersionId: providerResourceIdSchema,
  digest: artifactDigestSchema.optional()
}).strict().readonly()

/** Exact owner-coded portable envelopes accepted by the system transfer family. */
export const contentSpacePortableContainerReferenceEnvelopeSchema = z.object({
  contractVersion: z.literal(PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION),
  kind: z.literal(CONTENT_CONTAINER_REFERENCE_KIND),
  authority: providerInstanceRefSchema,
  identity: contentContainerIdentitySchema
}).strict().readonly()
export const contentSpacePortableFileReferenceEnvelopeSchema = z.object({
  contractVersion: z.literal(PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION),
  kind: z.literal(CONTENT_FILE_REFERENCE_KIND),
  authority: providerInstanceRefSchema,
  identity: contentFileIdentitySchema
}).strict().readonly()
export type ContentSpacePortableContainerReferenceEnvelope = z.infer<
  typeof contentSpacePortableContainerReferenceEnvelopeSchema
>
export type ContentSpacePortableFileReferenceEnvelope = z.infer<
  typeof contentSpacePortableFileReferenceEnvelopeSchema
>

export const contentContainerReferenceSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  containerId: providerResourceIdSchema
}).strict().readonly()
export const contentFileReferenceSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  fileId: providerResourceIdSchema
}).strict().readonly()
export const artifactReferenceSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  fileId: providerResourceIdSchema,
  immutableVersionId: providerResourceIdSchema,
  digest: artifactDigestSchema.optional()
}).strict().readonly()
export const contentEntryReferenceSchema = z.union([
  contentContainerReferenceSchema,
  contentFileReferenceSchema,
  artifactReferenceSchema
])

export type ContentContainerReference = z.infer<typeof contentContainerReferenceSchema>
export type ContentFileReference = z.infer<typeof contentFileReferenceSchema>
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>
export type ContentEntryReference = z.infer<typeof contentEntryReferenceSchema>
type ContentContainerIdentity = z.infer<typeof contentContainerIdentitySchema>
type ContentFileIdentity = z.infer<typeof contentFileIdentitySchema>
type ArtifactIdentity = z.infer<typeof artifactIdentitySchema>

export const contentSpaceEntryNameSchema = z.string()
  .trim()
  .min(1)
  .max(CONTENT_SPACE_LIMITS.maxEntryNameCharacters)
  .refine((name) => !/[\\/\0]/u.test(name) && name !== '.' && name !== '..', {
    message: 'Entry names cannot contain path syntax.'
  })

export const contentSpacePageRequestSchema = z.object({
  cursor: z.string().trim().min(1).max(256).optional(),
  limit: z.number().int().min(1).max(CONTENT_SPACE_LIMITS.maxPageItems)
}).strict().readonly()
export type ContentSpacePageRequest = z.infer<typeof contentSpacePageRequestSchema>

export const contentSpaceContainerSummarySchema = z.object({
  reference: contentContainerReferenceSchema,
  scope: z.enum(['personal', 'shared']),
  label: z.string().trim().min(1).max(CONTENT_SPACE_LIMITS.maxLabelCharacters)
}).strict().readonly()
export const contentSpaceEntrySummarySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('container'),
    reference: contentContainerReferenceSchema,
    label: z.string().trim().min(1).max(CONTENT_SPACE_LIMITS.maxLabelCharacters)
  }).strict().readonly(),
  z.object({
    kind: z.literal('file'),
    reference: contentFileReferenceSchema,
    label: z.string().trim().min(1).max(CONTENT_SPACE_LIMITS.maxLabelCharacters),
    size: z.number().int().nonnegative().max(CONTENT_SPACE_LIMITS.maxFileBytes),
    modifiedAt: z.string().datetime({ offset: true }).optional()
  }).strict().readonly()
])
export const contentSpaceContainerPageSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  items: z.array(contentSpaceContainerSummarySchema)
    .max(CONTENT_SPACE_LIMITS.maxPageItems).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceEntryPageSchema = z.object({
  parent: contentContainerReferenceSchema,
  items: z.array(contentSpaceEntrySummarySchema)
    .max(CONTENT_SPACE_LIMITS.maxPageItems).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceProviderEntryObservationSchema = z.object({
  entry: contentSpaceEntrySummarySchema,
  capabilities: contentSpaceCapabilityStateListSchema
}).strict().readonly()
export const contentSpaceEntryObservationSchema = z.object({
  entry: contentSpaceEntrySummarySchema,
  capabilities: contentSpaceAdmittedCapabilityStateListSchema
}).strict().readonly()
export const contentSpacePortableResourceStateSchema = z.object({
  reference: contentEntryReferenceSchema,
  entry: contentSpaceEntrySummarySchema,
  capabilities: contentSpaceAdmittedCapabilityStateListSchema
}).strict().readonly()

export type ContentSpaceContainerSummary = z.infer<typeof contentSpaceContainerSummarySchema>
export type ContentSpaceEntrySummary = z.infer<typeof contentSpaceEntrySummarySchema>
export type ContentSpaceContainerPage = z.infer<typeof contentSpaceContainerPageSchema>
export type ContentSpaceEntryPage = z.infer<typeof contentSpaceEntryPageSchema>
export type ContentSpaceEntryObservation = z.infer<typeof contentSpaceEntryObservationSchema>
export type ContentSpaceProviderEntryObservation = z.infer<
  typeof contentSpaceProviderEntryObservationSchema
>

export const createFolderReceiptSchema = z.object({
  invocationId: contentSpaceInvocationIdSchema,
  parent: contentContainerReferenceSchema,
  name: contentSpaceEntryNameSchema,
  reference: contentContainerReferenceSchema
}).strict().readonly()
export const uploadNewReceiptSchema = z.object({
  invocationId: contentSpaceInvocationIdSchema,
  parent: contentContainerReferenceSchema,
  name: contentSpaceEntryNameSchema,
  sourceSize: z.number().int().nonnegative().max(CONTENT_SPACE_LIMITS.maxUploadBytes),
  reference: contentFileReferenceSchema
}).strict().readonly()
/**
 * Provider-owned write-after observation for one upload-new dispatch. The
 * observation is evidence of the exact entry read back after the external
 * write; it is not an ACL, permission grant, or portable authority proof.
 */
export const contentSpaceUploadWriteAfterObservationSchema = z.object({
  parent: contentContainerReferenceSchema,
  reference: contentFileReferenceSchema,
  name: contentSpaceEntryNameSchema,
  size: z.number().int().nonnegative().max(CONTENT_SPACE_LIMITS.maxUploadBytes)
}).strict().superRefine((observation, context) => {
  if (observation.parent.providerInstanceRef !== observation.reference.providerInstanceRef) {
    context.addIssue({
      code: 'custom',
      path: ['reference', 'providerInstanceRef'],
      message: 'Upload observation parent and file must use one Provider Instance.'
    })
  }
}).readonly()
export const contentSpaceProviderUploadNewReceiptSchema = z.object({
  invocationId: contentSpaceInvocationIdSchema,
  parent: contentContainerReferenceSchema,
  name: contentSpaceEntryNameSchema,
  sourceSize: z.number().int().nonnegative().max(CONTENT_SPACE_LIMITS.maxUploadBytes),
  reference: contentFileReferenceSchema,
  writeAfterObservation: contentSpaceUploadWriteAfterObservationSchema
}).strict().superRefine((receipt, context) => {
  const observation = receipt.writeAfterObservation
  if (observation.parent.providerInstanceRef !== receipt.parent.providerInstanceRef ||
    observation.parent.containerId !== receipt.parent.containerId ||
    observation.reference.providerInstanceRef !== receipt.reference.providerInstanceRef ||
    observation.reference.fileId !== receipt.reference.fileId ||
    observation.name !== receipt.name ||
    observation.size !== receipt.sourceSize) {
    context.addIssue({
      code: 'custom',
      path: ['writeAfterObservation'],
      message: 'Upload write-after observation must exactly match the canonical receipt.'
    })
  }
}).readonly()
export const downloadReceiptSchema = z.object({
  invocationId: contentSpaceInvocationIdSchema,
  reference: z.union([contentFileReferenceSchema, artifactReferenceSchema]),
  bytesWritten: z.number().int().nonnegative().max(CONTENT_SPACE_LIMITS.maxFileBytes),
  digest: artifactDigestSchema.optional()
}).strict().readonly()

export type CreateFolderReceipt = z.infer<typeof createFolderReceiptSchema>
export type UploadNewReceipt = z.infer<typeof uploadNewReceiptSchema>
export type ContentSpaceUploadWriteAfterObservation = z.infer<
  typeof contentSpaceUploadWriteAfterObservationSchema
>
export type ContentSpaceProviderUploadNewReceipt = z.infer<
  typeof contentSpaceProviderUploadNewReceiptSchema
>
export type DownloadReceipt = z.infer<typeof downloadReceiptSchema>

/** Trusted Provider claim. Only ContentSpaceService may turn it into an ArtifactReference. */
export const contentSpaceImmutableVersionProofSchema = z.object({
  reference: contentFileReferenceSchema,
  immutableVersionId: providerResourceIdSchema,
  immutableIdentity: z.literal(true),
  retentionGuaranteed: z.literal(true),
  versionSpecificRetrieval: z.literal(true),
  digest: artifactDigestSchema.optional()
}).strict().readonly()
export const contentSpaceProviderImmutableVersionObservationSchema = z.discriminatedUnion(
  'proven',
  [
    z.object({
      proven: z.literal(false),
      reasonCode: contentSpaceReadinessReasonSchema
    }).strict().readonly(),
    z.object({
      proven: z.literal(true),
      proof: contentSpaceImmutableVersionProofSchema
    }).strict().readonly()
  ]
)
export const immutableVersionObservationSchema = z.discriminatedUnion('proven', [
  z.object({
    proven: z.literal(false),
    reasonCode: contentSpaceReadinessReasonSchema
  }).strict().readonly(),
  z.object({
    proven: z.literal(true),
    artifact: artifactReferenceSchema
  }).strict().readonly()
])

export type ContentSpaceImmutableVersionProof = z.infer<
  typeof contentSpaceImmutableVersionProofSchema
>
export type ContentSpaceProviderImmutableVersionObservation = z.infer<
  typeof contentSpaceProviderImmutableVersionObservationSchema
>
export type ImmutableVersionObservation = z.infer<typeof immutableVersionObservationSchema>

export const contentSpaceProviderInstanceSummarySchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  providerKind: providerKindSchema,
  label: z.string().trim().min(1).max(160)
}).strict().readonly()
export const contentSpaceProviderInstanceListSchema = z.object({
  items: z.array(contentSpaceProviderInstanceSummarySchema)
    .max(CONTENT_SPACE_LIMITS.maxProviderInstances).readonly()
}).strict().readonly()
export const contentSpaceProviderInstanceInputSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema
}).strict().readonly()
export const contentSpaceListAgentRootCandidatesInputSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  scope: z.enum(['personal', 'shared']),
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceAgentRootCandidateSchema = z.object({
  libraryLabel: z.string().trim().min(1).max(CONTENT_SPACE_LIMITS.maxLabelCharacters)
}).strict().readonly()
export const contentSpaceAgentRootCandidatePageSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  scope: z.enum(['personal', 'shared']),
  items: z.array(contentSpaceAgentRootCandidateSchema)
    .max(CONTENT_SPACE_LIMITS.maxPageItems).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceCapabilityListSchema = z.object({
  items: contentSpaceAdmittedCapabilityStateListSchema
}).strict().readonly()
export const contentSpaceListContainersInputSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceListEntriesInputSchema = z.object({
  parent: contentContainerReferenceSchema,
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceObserveEntryInputSchema = z.object({
  reference: contentEntryReferenceSchema
}).strict().readonly()
export const contentSpaceCreateFolderInputSchema = z.object({
  parent: contentContainerReferenceSchema,
  name: contentSpaceEntryNameSchema
}).strict().readonly()

export const contentSpaceUploadNewInputSchema = z.object({
  parent: contentContainerReferenceSchema,
  name: contentSpaceEntryNameSchema,
  sourceHandle: domainFileTransferHandleSchema
}).strict().readonly()
export const contentSpaceDownloadInputSchema = z.object({
  reference: z.union([contentFileReferenceSchema, artifactReferenceSchema]),
  destinationHandle: domainFileTransferHandleSchema
}).strict().readonly()
export const contentSpaceSystemDownloadInputSchema = z.object({
  root: contentSpacePortableContainerReferenceEnvelopeSchema,
  candidate: contentSpacePortableFileReferenceEnvelopeSchema,
  workspaceRelativePath: domainWorkspaceRelativePathSchema
}).strict().superRefine((input, context) => {
  if (input.root.authority !== input.candidate.authority) {
    context.addIssue({
      code: 'custom',
      path: ['candidate', 'authority'],
      message: 'System download root and candidate must use one exact authority.'
    })
  }
}).readonly()
export const contentSpaceSystemUploadNewInputSchema = z.object({
  root: contentSpacePortableContainerReferenceEnvelopeSchema,
  name: contentSpaceEntryNameSchema,
  workspaceRelativePath: domainWorkspaceRelativePathSchema
}).strict().readonly()
export const contentSpaceSystemTransferPreflightInputSchema = z.discriminatedUnion(
  'operation',
  [
    z.object({
      operation: z.literal('download'),
      input: contentSpaceSystemDownloadInputSchema
    }).strict(),
    z.object({
      operation: z.literal('upload-new'),
      input: contentSpaceSystemUploadNewInputSchema
    }).strict()
  ]
).readonly()

export type ContentSpaceSystemDownloadInput = z.infer<
  typeof contentSpaceSystemDownloadInputSchema
>
export type ContentSpaceSystemUploadNewInput = z.infer<
  typeof contentSpaceSystemUploadNewInputSchema
>
export type ContentSpaceSystemTransferPreflightInput = z.infer<
  typeof contentSpaceSystemTransferPreflightInputSchema
>

export const contentSpaceSystemUploadWriteAfterObservationSchema = z.object({
  parent: contentSpacePortableContainerReferenceEnvelopeSchema,
  reference: contentSpacePortableFileReferenceEnvelopeSchema,
  name: contentSpaceEntryNameSchema,
  size: z.number().int().nonnegative().max(CONTENT_SPACE_LIMITS.maxUploadBytes)
}).strict().superRefine((observation, context) => {
  if (observation.parent.authority !== observation.reference.authority) {
    context.addIssue({
      code: 'custom',
      path: ['reference', 'authority'],
      message: 'System upload observation parent and file must use one authority.'
    })
  }
}).readonly()
export type ContentSpaceSystemUploadWriteAfterObservation = z.infer<
  typeof contentSpaceSystemUploadWriteAfterObservationSchema
>

const systemCallerIdSchema = z.string().min(1).max(256)
  .refine((value) => value === value.trim())
const systemDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
export const contentSpaceSystemExecutionBindingSchema = z.object({
  callerId: systemCallerIdSchema,
  principal: principalSnapshotSchema,
  principalSnapshotDigest: systemDigestSchema,
  workspaceId: z.string().min(1).max(1_024).refine((value) => value === value.trim()),
  executionContextDigest: systemDigestSchema,
  invocationId: contentSpaceInvocationIdSchema
}).strict().readonly()
export type ContentSpaceSystemExecutionBinding = z.infer<
  typeof contentSpaceSystemExecutionBindingSchema
>

export const contentSpaceSystemTransferPreflightStatusSchema = z.enum([
  'ready',
  'provider_not_ready',
  'principal_stale',
  'binding_stale'
])
export const contentSpaceSystemTransferPreflightObservationSchema = z.object({
  execution: contentSpaceSystemExecutionBindingSchema,
  status: contentSpaceSystemTransferPreflightStatusSchema,
  intentDigest: systemDigestSchema,
  observationRevision: systemDigestSchema,
  authorization: z.literal('not_granted'),
  cacheable: z.literal(false)
}).strict().readonly()
export type ContentSpaceSystemTransferPreflightStatus = z.infer<
  typeof contentSpaceSystemTransferPreflightStatusSchema
>
export type ContentSpaceSystemTransferPreflightObservation = z.infer<
  typeof contentSpaceSystemTransferPreflightObservationSchema
>

export const contentSpaceDeferredProviderDigestSchema = z.object({
  status: z.literal('deferred'),
  reason: z.literal('provider_digest_not_in_run0_contract')
}).strict().readonly()

/** Host-observed bytes from the exact Provider-authorized system download. */
export const contentSpaceSystemDownloadObservationSchema = z.object({
  reference: contentSpacePortableFileReferenceEnvelopeSchema,
  bytes: z.number().int().nonnegative().max(CONTENT_SPACE_LIMITS.maxFileBytes),
  sha256: contentSpaceSha256Schema
}).strict().readonly()
export type ContentSpaceSystemDownloadObservation = z.infer<
  typeof contentSpaceSystemDownloadObservationSchema
>

export const contentSpaceSystemDownloadReceiptSchema = z.object({
  execution: contentSpaceSystemExecutionBindingSchema,
  receipt: downloadReceiptSchema,
  readAfterObservation: contentSpaceSystemDownloadObservationSchema,
  workspaceRelativePath: domainWorkspaceRelativePathSchema,
  bytes: z.number().int().nonnegative().max(CONTENT_SPACE_LIMITS.maxFileBytes),
  sha256: contentSpaceSha256Schema,
  transferReceiptDigest: systemDigestSchema,
  observationDigest: systemDigestSchema,
  providerDigest: contentSpaceDeferredProviderDigestSchema
}).strict().superRefine((output, context) => {
  if ('immutableVersionId' in output.receipt.reference) {
    context.addIssue({
      code: 'custom',
      path: ['receipt', 'reference'],
      message: 'Run-0 system download accepts Content File references only.'
    })
  }
  if (output.receipt.bytesWritten !== output.bytes) {
    context.addIssue({
      code: 'custom',
      path: ['bytes'],
      message: 'System download bytes must match the canonical receipt.'
    })
  }
  if (output.receipt.digest && output.receipt.digest.value !== output.sha256) {
    context.addIssue({
      code: 'custom',
      path: ['sha256'],
      message: 'System download SHA-256 must match the canonical receipt digest.'
    })
  }
  const observation = output.readAfterObservation
  if ('immutableVersionId' in output.receipt.reference ||
    observation.reference.authority !== output.receipt.reference.providerInstanceRef ||
    observation.reference.identity.fileId !== output.receipt.reference.fileId ||
    observation.bytes !== output.bytes || observation.sha256 !== output.sha256) {
    context.addIssue({
      code: 'custom',
      path: ['readAfterObservation'],
      message: 'System download observation must identify the exact authorized bytes.'
    })
  }
}).readonly()
export const contentSpaceSystemUploadNewReceiptSchema = z.object({
  execution: contentSpaceSystemExecutionBindingSchema,
  receipt: uploadNewReceiptSchema,
  portableReference: contentSpacePortableFileReferenceEnvelopeSchema,
  writeAfterObservation: contentSpaceSystemUploadWriteAfterObservationSchema,
  workspaceRelativePath: domainWorkspaceRelativePathSchema,
  bytes: z.number().int().nonnegative().max(CONTENT_SPACE_LIMITS.maxUploadBytes),
  sha256: contentSpaceSha256Schema,
  transferReceiptDigest: systemDigestSchema,
  observationDigest: systemDigestSchema,
  providerDigest: contentSpaceDeferredProviderDigestSchema
}).strict().superRefine((output, context) => {
  if (output.receipt.sourceSize !== output.bytes) {
    context.addIssue({
      code: 'custom',
      path: ['bytes'],
      message: 'System upload bytes must match the canonical receipt.'
    })
  }
  const identity = output.portableReference.identity
  if (output.portableReference.authority !== output.receipt.reference.providerInstanceRef ||
    identity.fileId !== output.receipt.reference.fileId) {
    context.addIssue({
      code: 'custom',
      path: ['portableReference'],
      message: 'System upload portable reference must identify the canonical receipt file.'
    })
  }
  const observation = output.writeAfterObservation
  if (observation.parent.authority !== output.receipt.parent.providerInstanceRef ||
    observation.parent.identity.containerId !== output.receipt.parent.containerId ||
    observation.reference.authority !== output.portableReference.authority ||
    observation.reference.identity.fileId !== identity.fileId ||
    observation.name !== output.receipt.name ||
    observation.size !== output.receipt.sourceSize) {
    context.addIssue({
      code: 'custom',
      path: ['writeAfterObservation'],
      message: 'System upload observation must identify the exact canonical write result.'
    })
  }
}).readonly()

export type ContentSpaceSystemDownloadReceipt = z.infer<
  typeof contentSpaceSystemDownloadReceiptSchema
>
export type ContentSpaceSystemUploadNewReceipt = z.infer<
  typeof contentSpaceSystemUploadNewReceiptSchema
>
export type ContentSpaceSystemDownloadResult = ContentSpaceResult<
  ContentSpaceSystemDownloadReceipt
>
export type ContentSpaceSystemUploadNewResult = ContentSpaceResult<
  ContentSpaceSystemUploadNewReceipt
>
export type ContentSpaceSystemTransferPreflightResult = ContentSpaceResult<
  ContentSpaceSystemTransferPreflightObservation
>
export const contentSpaceAuthorizeAgentRootInputSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  scope: z.enum(['personal', 'shared']),
  label: z.string().trim().min(1).max(CONTENT_SPACE_LIMITS.maxLabelCharacters)
}).strict().readonly()
export const contentSpaceAgentRootAuthorizationSchema = z.object({
  resource: domainCapabilityResourceHandleSchema
}).strict().readonly()
export const contentSpaceAgentListEntriesInputSchema = z.object({
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceAgentEntryPageSchema = z.object({
  parent: contentContainerReferenceSchema,
  items: z.array(z.object({
    entry: contentSpaceEntrySummarySchema,
    resource: domainCapabilityResourceHandleSchema
  }).strict().readonly()).max(CONTENT_SPACE_LIMITS.maxPageItems).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceAgentCreateFolderInputSchema = z.object({
  name: contentSpaceEntryNameSchema
}).strict().readonly()
export const contentSpaceAgentUploadNewInputSchema = z.object({
  name: contentSpaceEntryNameSchema,
  workspaceRelativePath: domainWorkspaceRelativePathSchema
}).strict().readonly()
export const contentSpaceAgentDownloadInputSchema = z.object({
  workspaceRelativePath: domainWorkspaceRelativePathSchema
}).strict().readonly()
export const contentSpaceResolvePortalTargetInputSchema = z.object({
  reference: contentEntryReferenceSchema
}).strict().readonly()
export const contentSpaceOpenPortalTargetInputSchema = z.object({
  handle: domainExternalNavigationTargetHandleSchema
}).strict().readonly()
export const contentSpacePortalTargetHandleSchema = domainExternalNavigationIssuedTargetSchema
export const contentSpaceOpenPortalTargetResultSchema = z.object({
  opened: z.literal(true)
}).strict().readonly()
export const contentSpaceObserveImmutableVersionInputSchema = z.object({
  reference: contentFileReferenceSchema
}).strict().readonly()

export const contentSpaceProviderInstanceListResultSchema = contentSpaceResultSchema(
  contentSpaceProviderInstanceListSchema
)
export const contentSpaceAgentRootCandidatePageResultSchema = contentSpaceResultSchema(
  contentSpaceAgentRootCandidatePageSchema
)
export const contentSpaceCapabilityListResultSchema = contentSpaceResultSchema(
  contentSpaceCapabilityListSchema
)
export const contentSpaceContainerPageResultSchema = contentSpaceResultSchema(
  contentSpaceContainerPageSchema
)
export const contentSpaceEntryPageResultSchema = contentSpaceResultSchema(
  contentSpaceEntryPageSchema
)
export const contentSpaceEntryObservationResultSchema = contentSpaceResultSchema(
  contentSpaceEntryObservationSchema
)
export const createFolderResultSchema = contentSpaceResultSchema(createFolderReceiptSchema)
export const uploadNewResultSchema = contentSpaceResultSchema(uploadNewReceiptSchema)
export const downloadResultSchema = contentSpaceResultSchema(downloadReceiptSchema)
export const contentSpaceSystemDownloadResultSchema = contentSpaceResultSchema(
  contentSpaceSystemDownloadReceiptSchema
)
export const contentSpaceSystemUploadNewResultSchema = contentSpaceResultSchema(
  contentSpaceSystemUploadNewReceiptSchema
)
export const contentSpaceSystemTransferPreflightResultSchema = contentSpaceResultSchema(
  contentSpaceSystemTransferPreflightObservationSchema
)
export const contentSpaceAgentRootAuthorizationResultSchema = contentSpaceResultSchema(
  contentSpaceAgentRootAuthorizationSchema
)
export const contentSpaceAgentEntryPageResultSchema = contentSpaceResultSchema(
  contentSpaceAgentEntryPageSchema
)
export const contentSpacePortalTargetResultSchema = contentSpaceResultSchema(
  contentSpacePortalTargetHandleSchema
)
export const contentSpaceOpenPortalResultSchema = contentSpaceResultSchema(
  contentSpaceOpenPortalTargetResultSchema
)
export const immutableVersionObservationResultSchema = contentSpaceResultSchema(
  immutableVersionObservationSchema
)

export const CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT: DomainCapabilityContract<
  ContentSpaceSystemDownloadInput,
  ContentSpaceSystemDownloadResult
> = Object.freeze({
  actionId: CONTENT_SPACE_CAPABILITY_IDS.systemDownload,
  effect: 'workspace-write',
  inputSchema: contentSpaceSystemDownloadInputSchema,
  outputSchema: contentSpaceSystemDownloadResultSchema
})
export const CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT: DomainCapabilityContract<
  ContentSpaceSystemTransferPreflightInput,
  ContentSpaceSystemTransferPreflightResult
> = Object.freeze({
  actionId: CONTENT_SPACE_CAPABILITY_IDS.systemTransferPreflight,
  effect: 'read',
  inputSchema: contentSpaceSystemTransferPreflightInputSchema,
  outputSchema: contentSpaceSystemTransferPreflightResultSchema
})
export const CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT: DomainCapabilityContract<
  ContentSpaceSystemUploadNewInput,
  ContentSpaceSystemUploadNewResult
> = Object.freeze({
  actionId: CONTENT_SPACE_CAPABILITY_IDS.systemUploadNew,
  effect: 'external-write',
  inputSchema: contentSpaceSystemUploadNewInputSchema,
  outputSchema: contentSpaceSystemUploadNewResultSchema
})

export const opaqueExternalBindingValueSchema = z.string().regex(/^[a-f0-9]{64}$/u)

/**
 * Provider-authenticated, token-free evidence for one exact local connection binding.
 * Neither value is a credential, Provider resource reference, or portable authority.
 */
export const contentSpaceExternalBindingAttestationSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  principal: principalSnapshotSchema,
  externalSubject: opaqueExternalBindingValueSchema,
  bindingRevision: opaqueExternalBindingValueSchema
}).strict().readonly()
export type ContentSpaceExternalBindingAttestation = z.infer<
  typeof contentSpaceExternalBindingAttestationSchema
>

export const contentSpaceFileDescendantProofLimitsSchema = z.object({
  maxDepth: z.literal(CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.maxDepth),
  maxPages: z.literal(CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.maxPages),
  maxNodes: z.literal(CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.maxNodes),
  deadlineMs: z.literal(CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.deadlineMs)
}).strict().readonly()
export type ContentSpaceFileDescendantProofLimits = z.infer<
  typeof contentSpaceFileDescendantProofLimitsSchema
>

export const contentSpaceFileDescendantProofRequestSchema = z.object({
  root: contentContainerReferenceSchema,
  candidate: contentFileReferenceSchema,
  limits: contentSpaceFileDescendantProofLimitsSchema
}).strict().superRefine((request, context) => {
  if (request.root.providerInstanceRef !== request.candidate.providerInstanceRef) {
    context.addIssue({
      code: 'custom',
      path: ['candidate', 'providerInstanceRef'],
      message: 'Descendant proof root and candidate must use one Provider Instance.'
    })
  }
}).readonly()
export type ContentSpaceFileDescendantProofRequest = z.infer<
  typeof contentSpaceFileDescendantProofRequestSchema
>

export const contentSpaceFileDescendantProofEvidenceSchema = z.object({
  invocationId: contentSpaceInvocationIdSchema,
  providerInstanceRef: providerInstanceRefSchema,
  authority: providerInstanceRefSchema,
  root: contentContainerReferenceSchema,
  candidate: contentFileReferenceSchema,
  binding: contentSpaceExternalBindingAttestationSchema,
  counts: z.object({
    depth: z.number().int().min(1)
      .max(CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.maxDepth),
    pages: z.number().int().nonnegative()
      .max(CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.maxPages),
    nodes: z.number().int().min(2)
      .max(CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.maxNodes),
    elapsedMs: z.number().nonnegative()
      .max(CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.deadlineMs)
  }).strict().readonly(),
  provedAt: z.string().datetime({ offset: true }),
  cacheable: z.literal(false),
  portable: z.literal(false)
}).strict().superRefine((evidence, context) => {
  const authorities = [
    evidence.authority,
    evidence.root.providerInstanceRef,
    evidence.candidate.providerInstanceRef,
    evidence.binding.providerInstanceRef
  ]
  if (authorities.some((authority) => authority !== evidence.providerInstanceRef)) {
    context.addIssue({
      code: 'custom',
      path: ['providerInstanceRef'],
      message: 'Descendant proof evidence must echo one exact Provider Instance and authority.'
    })
  }
}).readonly()
export type ContentSpaceFileDescendantProofEvidence = z.infer<
  typeof contentSpaceFileDescendantProofEvidenceSchema
>

export type ContentSpaceProviderOperationContext = Readonly<{
  principal: PrincipalSnapshot
  providerInstanceRef: string
  /** Service-installed expectation that the Connector must recheck before remote dispatch. */
  expectedExternalBinding?: ContentSpaceExternalBindingAttestation
  invocationId?: string
  deadlineAt: string
  signal?: AbortSignal
  /**
   * Non-serializable Host lease guard captured for this exact invocation.
   * Providers must pass it through their canonical Connector boundary before
   * every remote dispatch; callers and Provider packages cannot replace it.
   */
  assertPrincipalCurrent(): void | Promise<void>
}>
export type ContentSpaceProviderWriteContext = ContentSpaceProviderOperationContext & Readonly<{
  invocationId: string
  signal: AbortSignal
}>
export type ContentSpaceProviderFileDescendantProofInput = Readonly<{
  context: ContentSpaceProviderWriteContext
  root: ContentContainerReference
  candidate: ContentFileReference
  limits: ContentSpaceFileDescendantProofLimits
}>
export type ContentSpaceProviderDownloadLease = Readonly<{
  /** One-use provider authorization bound to the exact current session. */
  consume(input: Readonly<{
    destination: ContentSpaceDownloadDestination
  }>): Promise<DownloadReceipt>
  /** Idempotently retires an unconsumed authorization without dispatching bytes. */
  retire(): Promise<void>
}>
export type ContentSpaceUploadSource = Readonly<{
  name: string
  size: number
  /** Host-attested SHA-256 when the source crosses the canonical Host transfer boundary. */
  sha256?: string
  read(input: Readonly<{ offset: number; length: number }>): Promise<Uint8Array>
}>
/** Provider may stream bytes only. The service is the sole commit/abort owner. */
export type ContentSpaceDownloadDestination = Readonly<{
  write(chunk: Uint8Array): Promise<void>
}>
export type ContentSpacePortalTarget = Readonly<{
  url: string
  expiresAt: string
}>

export type ContentSpaceProvider = Readonly<{
  contractVersion: typeof CONTENT_SPACE_PROVIDER_CONTRACT_VERSION
  features?: ContentSpaceProviderFeatures
  attestExternalBinding(
    context: ContentSpaceProviderOperationContext
  ): Promise<ContentSpaceExternalBindingAttestation | undefined>
  describeCapabilities(
    context: ContentSpaceProviderOperationContext
  ): Promise<readonly ContentSpaceCapabilityState[]>
  listContainers(input: Readonly<{
    context: ContentSpaceProviderOperationContext
    page: ContentSpacePageRequest
  }>): Promise<ContentSpaceContainerPage>
  listEntries(input: Readonly<{
    context: ContentSpaceProviderOperationContext
    parent: ContentContainerReference
    page: ContentSpacePageRequest
  }>): Promise<ContentSpaceEntryPage>
  observeEntry(input: Readonly<{
    context: ContentSpaceProviderOperationContext
    reference: ContentEntryReference
  }>): Promise<ContentSpaceProviderEntryObservation>
  proveFileDescendant(
    input: ContentSpaceProviderFileDescendantProofInput
  ): Promise<ContentSpaceFileDescendantProofEvidence>
  createFolder(input: Readonly<{
    context: ContentSpaceProviderWriteContext
    parent: ContentContainerReference
    name: string
  }>): Promise<CreateFolderReceipt>
  uploadNewFile(input: Readonly<{
    context: ContentSpaceProviderWriteContext
    parent: ContentContainerReference
    name: string
    source: ContentSpaceUploadSource
  }>): Promise<ContentSpaceProviderUploadNewReceipt>
  authorizeDownload(input: Readonly<{
    context: ContentSpaceProviderWriteContext
    reference: ContentFileReference | ArtifactReference
  }>): Promise<ContentSpaceProviderDownloadLease>
  resolvePortalTarget(input: Readonly<{
    context: ContentSpaceProviderOperationContext
    reference: ContentEntryReference
  }>): Promise<ContentSpacePortalTarget>
  observeImmutableVersion(input: Readonly<{
    context: ContentSpaceProviderOperationContext
    reference: ContentFileReference
  }>): Promise<ContentSpaceProviderImmutableVersionObservation>
}>

export type ContentSpaceProviderHostPorts = Readonly<{
  contractVersion: typeof CONTENT_SPACE_PROVIDER_CONTRACT_VERSION
}>

export function defineContentSpaceProvider(input: ContentSpaceProvider): ContentSpaceProvider {
  const required = [
    'attestExternalBinding',
    'contractVersion',
    'createFolder',
    'describeCapabilities',
    'authorizeDownload',
    'listContainers',
    'listEntries',
    'observeEntry',
    'observeImmutableVersion',
    'proveFileDescendant',
    'resolvePortalTarget',
    'uploadNewFile'
  ].sort()
  const allowed = [...required, 'features'].sort()
  const keys = isRecord(input) ? Object.keys(input).sort() : []
  if (!isRecord(input) ||
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !keys.includes(key)) ||
    input.contractVersion !== CONTENT_SPACE_PROVIDER_CONTRACT_VERSION ||
    required.filter((key) => key !== 'contractVersion')
      .some((key) => typeof input[key as keyof ContentSpaceProvider] !== 'function')) {
    throw new TypeError('ContentSpaceProvider contract is invalid.')
  }
  if (input.features === undefined) return Object.freeze(input)
  const features = contentSpaceProviderFeaturesSchema.safeParse(input.features)
  if (!features.success) {
    throw new TypeError('ContentSpaceProvider contract is invalid.')
  }
  return Object.freeze({ ...input, features: features.data })
}

export const contentContainerReferenceCodec: PortableResourceReferenceCodec<
  ContentContainerIdentity,
  ContentContainerIdentity
> = defineReferenceCodec(
  CONTENT_CONTAINER_REFERENCE_KIND,
  CONTENT_CONTAINER_RESOURCE_KIND,
  contentContainerIdentitySchema
)
export const contentFileReferenceCodec: PortableResourceReferenceCodec<
  ContentFileIdentity,
  ContentFileIdentity
> = defineReferenceCodec(
  CONTENT_FILE_REFERENCE_KIND,
  CONTENT_FILE_RESOURCE_KIND,
  contentFileIdentitySchema
)
export const artifactReferenceCodec: PortableResourceReferenceCodec<
  ArtifactIdentity,
  ArtifactIdentity
> = defineReferenceCodec(
  ARTIFACT_REFERENCE_KIND,
  ARTIFACT_RESOURCE_KIND,
  artifactIdentitySchema
)

export function toPortableContentContainerReference(
  input: ContentContainerReference
): ContentSpacePortableContainerReferenceEnvelope {
  const reference = contentContainerReferenceSchema.parse(input)
  return contentSpacePortableContainerReferenceEnvelopeSchema.parse(
    portableEnvelope(reference.providerInstanceRef, contentContainerReferenceCodec, {
      containerId: reference.containerId
    })
  )
}
export function toPortableContentFileReference(
  input: ContentFileReference
): ContentSpacePortableFileReferenceEnvelope {
  const reference = contentFileReferenceSchema.parse(input)
  return contentSpacePortableFileReferenceEnvelopeSchema.parse(
    portableEnvelope(reference.providerInstanceRef, contentFileReferenceCodec, {
      fileId: reference.fileId
    })
  )
}
export function toPortableArtifactReference(
  input: ArtifactReference
): PortableResourceReferenceEnvelope {
  const reference = artifactReferenceSchema.parse(input)
  return portableEnvelope(reference.providerInstanceRef, artifactReferenceCodec, {
    fileId: reference.fileId,
    immutableVersionId: reference.immutableVersionId,
    ...(reference.digest ? { digest: reference.digest } : {})
  })
}

export function parsePortableContentContainerReference(
  input: unknown
): ContentContainerReference {
  const { envelope, identity } = parseOwnedEnvelope(input, contentContainerReferenceCodec)
  return contentContainerReferenceSchema.parse({
    providerInstanceRef: envelope.authority,
    ...identity
  })
}
export function parsePortableContentFileReference(input: unknown): ContentFileReference {
  const { envelope, identity } = parseOwnedEnvelope(input, contentFileReferenceCodec)
  return contentFileReferenceSchema.parse({
    providerInstanceRef: envelope.authority,
    ...identity
  })
}
export function parsePortableArtifactReference(input: unknown): ArtifactReference {
  const { envelope, identity } = parseOwnedEnvelope(input, artifactReferenceCodec)
  return artifactReferenceSchema.parse({
    providerInstanceRef: envelope.authority,
    ...identity
  })
}

function defineReferenceCodec<Identity>(
  kind: string,
  resourceKind: string,
  schema: z.ZodType<Identity>
): PortableResourceReferenceCodec<Identity, Identity> {
  return Object.freeze({
    location: MAIN_PORTABLE_RESOURCE_CODEC_LOCATION,
    contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
    kind,
    resourceKind,
    resolverId: CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_ID,
    decodeIdentity: (identity) => schema.parse(identity),
    encodeIdentity: (identity) => validatePortableIdentity(schema.parse(identity)),
    projectExport: (projection) => schema.parse(projection)
  })
}

function portableEnvelope<Identity>(
  providerInstanceRef: string,
  codec: PortableResourceReferenceCodec<Identity>,
  identity: Identity
): PortableResourceReferenceEnvelope {
  return parsePortableResourceReference({
    contractVersion: PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION,
    kind: codec.kind,
    authority: providerInstanceRef,
    identity: codec.encodeIdentity(identity)
  })
}

function parseOwnedEnvelope<Identity>(
  input: unknown,
  codec: PortableResourceReferenceCodec<Identity>
): Readonly<{ envelope: PortableResourceReferenceEnvelope; identity: Identity }> {
  const envelope = parsePortableResourceReference(input)
  if (envelope.kind !== codec.kind) {
    throw new TypeError('Portable reference kind is incompatible.')
  }
  providerInstanceRefSchema.parse(envelope.authority)
  return Object.freeze({ envelope, identity: codec.decodeIdentity(envelope.identity) })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

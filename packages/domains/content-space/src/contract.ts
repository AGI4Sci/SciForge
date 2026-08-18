import { z } from 'zod'

import {
  domainCapabilityResourceHandleSchema,
  domainFileTransferHandleSchema,
  domainWorkspaceRelativePathSchema
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
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import { providerInstanceRefSchema } from '@sciforge/domain-sdk/provider-composition'

export const CONTENT_SPACE_DOMAIN_MODULE_ID = 'sciforge.content-space' as const
export const CONTENT_SPACE_PROVIDER_CONTRACT_VERSION = '1.0.0' as const

export const CONTENT_CONTAINER_REFERENCE_KIND = 'content-space.container-reference' as const
export const CONTENT_FILE_REFERENCE_KIND = 'content-space.file-reference' as const
export const ARTIFACT_REFERENCE_KIND = 'content-space.artifact-reference' as const
export const CONTENT_CONTAINER_RESOURCE_KIND = 'content-space.container' as const
export const CONTENT_FILE_RESOURCE_KIND = 'content-space.file' as const
export const ARTIFACT_RESOURCE_KIND = 'content-space.artifact' as const
export const CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_ID =
  'content-space.provider-instance-authority' as const
export const CONTENT_SPACE_PORTABLE_EXPORT_CONSUMER_MODULE_IDS = Object.freeze([
  CONTENT_SPACE_DOMAIN_MODULE_ID
] as const)

export const CONTENT_SPACE_CAPABILITY_IDS = Object.freeze({
  listProviderInstances: 'content-space.list-provider-instances',
  describeCapabilities: 'content-space.describe-capabilities',
  listContainers: 'content-space.list-containers',
  listEntries: 'content-space.list-entries',
  observeEntry: 'content-space.observe-entry',
  createFolder: 'content-space.create-folder',
  uploadNew: 'content-space.upload-new',
  download: 'content-space.download',
  authorizeAgentRoot: 'content-space.authorize-agent-root',
  agentListEntries: 'content-space.agent-list-entries',
  agentCreateFolder: 'content-space.agent-create-folder',
  agentUploadNew: 'content-space.agent-upload-new',
  agentDownload: 'content-space.agent-download',
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
  maxPortalLifetimeMs: 5 * 60_000
})

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

export type ContentSpaceReadiness = z.infer<typeof contentSpaceReadinessSchema>
export type ContentSpaceOperation = z.infer<typeof contentSpaceOperationSchema>
export type ContentSpaceCapabilityState = z.infer<typeof contentSpaceCapabilityStateSchema>

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

export const artifactDigestSchema = z.object({
  algorithm: z.literal('sha256'),
  value: z.string().regex(/^[a-f0-9]{64}$/u)
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
export const contentSpaceEntryObservationSchema = z.object({
  entry: contentSpaceEntrySummarySchema,
  capabilities: contentSpaceCapabilityStateListSchema
}).strict().readonly()
export const contentSpacePortableResourceStateSchema = z.object({
  reference: contentEntryReferenceSchema,
  entry: contentSpaceEntrySummarySchema,
  capabilities: contentSpaceCapabilityStateListSchema
}).strict().readonly()

export type ContentSpaceContainerSummary = z.infer<typeof contentSpaceContainerSummarySchema>
export type ContentSpaceEntrySummary = z.infer<typeof contentSpaceEntrySummarySchema>
export type ContentSpaceContainerPage = z.infer<typeof contentSpaceContainerPageSchema>
export type ContentSpaceEntryPage = z.infer<typeof contentSpaceEntryPageSchema>
export type ContentSpaceEntryObservation = z.infer<typeof contentSpaceEntryObservationSchema>

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
export const downloadReceiptSchema = z.object({
  invocationId: contentSpaceInvocationIdSchema,
  reference: z.union([contentFileReferenceSchema, artifactReferenceSchema]),
  bytesWritten: z.number().int().nonnegative().max(CONTENT_SPACE_LIMITS.maxFileBytes),
  digest: artifactDigestSchema.optional()
}).strict().readonly()

export type CreateFolderReceipt = z.infer<typeof createFolderReceiptSchema>
export type UploadNewReceipt = z.infer<typeof uploadNewReceiptSchema>
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
  label: z.string().trim().min(1).max(160)
}).strict().readonly()
export const contentSpaceProviderInstanceListSchema = z.object({
  items: z.array(contentSpaceProviderInstanceSummarySchema)
    .max(CONTENT_SPACE_LIMITS.maxProviderInstances).readonly()
}).strict().readonly()
export const contentSpaceProviderInstanceInputSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema
}).strict().readonly()
export const contentSpaceCapabilityListSchema = z.object({
  items: contentSpaceCapabilityStateListSchema
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

export type ContentSpaceProviderOperationContext = Readonly<{
  principal: PrincipalSnapshot
  providerInstanceRef: string
  invocationId?: string
  deadlineAt: string
  signal?: AbortSignal
}>
export type ContentSpaceProviderWriteContext = ContentSpaceProviderOperationContext & Readonly<{
  invocationId: string
  signal: AbortSignal
}>
export type ContentSpaceUploadSource = Readonly<{
  name: string
  size: number
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
  }>): Promise<ContentSpaceEntryObservation>
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
  }>): Promise<UploadNewReceipt>
  downloadFile(input: Readonly<{
    context: ContentSpaceProviderWriteContext
    reference: ContentFileReference | ArtifactReference
    destination: ContentSpaceDownloadDestination
  }>): Promise<DownloadReceipt>
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
  const expected = [
    'contractVersion',
    'createFolder',
    'describeCapabilities',
    'downloadFile',
    'listContainers',
    'listEntries',
    'observeEntry',
    'observeImmutableVersion',
    'resolvePortalTarget',
    'uploadNewFile'
  ].sort()
  if (!isRecord(input) || Object.keys(input).sort().join(',') !== expected.join(',') ||
    input.contractVersion !== CONTENT_SPACE_PROVIDER_CONTRACT_VERSION ||
    expected.filter((key) => key !== 'contractVersion')
      .some((key) => typeof input[key as keyof ContentSpaceProvider] !== 'function')) {
    throw new TypeError('ContentSpaceProvider contract is invalid.')
  }
  return Object.freeze(input)
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
): PortableResourceReferenceEnvelope {
  const reference = contentContainerReferenceSchema.parse(input)
  return portableEnvelope(reference.providerInstanceRef, contentContainerReferenceCodec, {
    containerId: reference.containerId
  })
}
export function toPortableContentFileReference(
  input: ContentFileReference
): PortableResourceReferenceEnvelope {
  const reference = contentFileReferenceSchema.parse(input)
  return portableEnvelope(reference.providerInstanceRef, contentFileReferenceCodec, {
    fileId: reference.fileId
  })
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

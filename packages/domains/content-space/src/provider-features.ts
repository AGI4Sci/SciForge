import { z } from 'zod'

import {
  artifactDigestSchema,
  contentSpaceInvocationIdSchema,
  contentSpaceReadinessReasonSchema,
  contentSpaceReadinessSchema
} from './contract.js'
import {
  NATIVE_DOCUMENT_CONTRACT_VERSION,
  NATIVE_DOCUMENT_OPERATIONS,
  NATIVE_DOCUMENT_RESOURCE_TYPE,
  nativeDocumentConflictErrorSchema,
  nativeDocumentFailureErrorSchema,
  nativeDocumentOperationSchema,
  nativeDocumentOutcomeUnknownErrorSchema,
  nativeDocumentSuccessResultSchema
} from './native-document-contract.js'
import {
  defineContentSpaceAdministrationPort,
  type ContentSpaceAdministrationOperationState,
  type ContentSpaceAdministrationPort
} from './administration-contract.js'
import type {
  ArtifactReference,
  ContentContainerReference,
  ContentSpaceDownloadDestination,
  ContentEntryReference,
  ContentSpaceProviderOperationContext,
  ContentSpaceProviderWriteContext,
  ContentSpaceReadiness,
  ContentSpaceReadinessReason,
  ContentSpaceUploadSource
} from './contract.js'
import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS,
  type ContentSpaceExtendedOperationKey
} from './extended-operations-contract.js'
import type {
  AgentNativeDocumentRequest,
  NativeDocumentRequest
} from './native-document-contract.js'

export type ContentSpaceProviderFeatureEffect =
  | 'read'
  | 'workspace-write'
  | 'external-write'
  | 'destructive'

export type ContentSpaceProviderFeatureExecutionContext =
  | Readonly<{
    effect: 'read'
    context: ContentSpaceProviderOperationContext
  }>
  | Readonly<{
    effect: Exclude<ContentSpaceProviderFeatureEffect, 'read'>
    context: ContentSpaceProviderWriteContext
  }>

export type ContentSpaceProviderContentTarget = Readonly<{
  kind: 'content'
  root: ContentContainerReference
  primary: ContentEntryReference
  authorized: readonly ContentEntryReference[]
}>

export type ContentSpaceProviderAdministrationTarget = Readonly<{
  kind: 'provider-administration'
  providerInstanceRef: string
}>

export type ContentSpaceProviderFeatureTarget =
  | ContentSpaceProviderContentTarget
  | ContentSpaceProviderAdministrationTarget

export type ContentSpaceNativeDocumentExecutor = Readonly<{
  describeOperations(
    context: ContentSpaceProviderOperationContext
  ): readonly ContentSpaceNativeDocumentOperationState[] |
    Promise<readonly ContentSpaceNativeDocumentOperationState[]>
  execute(input: ContentSpaceProviderFeatureExecutionContext & Readonly<{
    target: ContentSpaceProviderContentTarget
    operation: NativeDocumentRequest['operation']
    /** Strictly parsed request with Host transfer handles removed. */
    request: unknown
    source?: ContentSpaceUploadSource
    destination?: ContentSpaceDownloadDestination
  }>): Promise<ContentSpaceProviderNativeDocumentReceipt>
}>

export type ContentSpaceNativeDocumentOperationState = Readonly<{
  operation: NativeDocumentRequest['operation']
  readiness: ContentSpaceReadiness
  reasonCode: ContentSpaceReadinessReason
}>

export type ContentSpaceExtendedOperationsExecutor = Readonly<{
  describeOperations(
    context: ContentSpaceProviderOperationContext
  ): readonly ContentSpaceExtendedOperationState[] |
    Promise<readonly ContentSpaceExtendedOperationState[]>
  execute(input: ContentSpaceProviderFeatureExecutionContext & Readonly<{
    target: ContentSpaceProviderFeatureTarget
    operation: ContentSpaceExtendedOperationKey
    /** Strictly parsed request with Host handles removed. */
    request: unknown
    source?: ContentSpaceUploadSource
    destination?: ContentSpaceDownloadDestination
  }>): Promise<unknown>
}>

export type ContentSpaceExtendedOperationState = Readonly<{
  operation: ContentSpaceExtendedOperationKey
  readiness: ContentSpaceReadiness
  reasonCode: ContentSpaceReadinessReason
}>

export type ContentSpaceProviderAdministrationBinding = Readonly<{
  administration: ContentSpaceAdministrationPort
}>

export function defineContentSpaceProviderAdministrationBinding(
  input: unknown
): ContentSpaceProviderAdministrationBinding {
  const keys = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? Reflect.ownKeys(input)
    : []
  if (typeof input !== 'object' || input === null || Array.isArray(input) ||
    keys.length !== 1 || keys[0] !== 'administration') {
    throw new TypeError('Content Space Provider administration binding is invalid.')
  }
  return Object.freeze({
    administration: defineContentSpaceAdministrationPort(
      Reflect.get(input, 'administration') as ContentSpaceAdministrationPort
    )
  })
}

export type ContentSpaceAdministrationFeature = Readonly<{
  /** Trusted, side-effect-free declaration used before any administration binding. */
  describeOperations(
    context: ContentSpaceProviderOperationContext
  ): readonly ContentSpaceAdministrationOperationState[] |
    Promise<readonly ContentSpaceAdministrationOperationState[]>
  bind(
    context: ContentSpaceProviderOperationContext
  ): ContentSpaceProviderAdministrationBinding | Promise<ContentSpaceProviderAdministrationBinding>
}>

export type ContentSpaceProviderFeatures = Readonly<{
  nativeDocuments?: ContentSpaceNativeDocumentExecutor
  extendedOperations?: ContentSpaceExtendedOperationsExecutor
  administration?: ContentSpaceAdministrationFeature
}>

const nativeDocumentExecuteSchema = z.custom<ContentSpaceNativeDocumentExecutor['execute']>(
  (value) => typeof value === 'function',
  'A native-document executor must be a function.'
)
const nativeDocumentDescribeSchema = z.custom<
  ContentSpaceNativeDocumentExecutor['describeOperations']
>(
  (value) => typeof value === 'function',
  'A native-document operation descriptor must be a function.'
)
const extendedOperationsExecuteSchema = z.custom<ContentSpaceExtendedOperationsExecutor['execute']>(
  (value) => typeof value === 'function',
  'An extended-operations executor must be a function.'
)
const extendedOperationsDescribeSchema = z.custom<
  ContentSpaceExtendedOperationsExecutor['describeOperations']
>(
  (value) => typeof value === 'function',
  'An extended-operations descriptor must be a function.'
)
const administrationBindSchema = z.custom<ContentSpaceAdministrationFeature['bind']>(
  (value) => typeof value === 'function',
  'An administration feature binder must be a function.'
)
const administrationDescribeSchema = z.custom<
  ContentSpaceAdministrationFeature['describeOperations']
>(
  (value) => typeof value === 'function',
  'An administration operation descriptor must be a function.'
)

const nativeDocumentExecutorSchema = z.object({
  describeOperations: nativeDocumentDescribeSchema,
  execute: nativeDocumentExecuteSchema
}).strict().readonly()
const extendedOperationsExecutorSchema = z.object({
  describeOperations: extendedOperationsDescribeSchema,
  execute: extendedOperationsExecuteSchema
}).strict().readonly()
const administrationFeatureSchema = z.object({
  describeOperations: administrationDescribeSchema,
  bind: administrationBindSchema
}).strict().readonly()

export const contentSpaceProviderFeaturesSchema: z.ZodType<ContentSpaceProviderFeatures> = z.object({
  nativeDocuments: nativeDocumentExecutorSchema.optional(),
  extendedOperations: extendedOperationsExecutorSchema.optional(),
  administration: administrationFeatureSchema.optional()
}).strict().readonly()

export const contentSpaceNativeDocumentOperationStateSchema = z.object({
  operation: nativeDocumentOperationSchema,
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

export const contentSpaceNativeDocumentOperationStateListSchema = z.array(
  contentSpaceNativeDocumentOperationStateSchema
).max(NATIVE_DOCUMENT_OPERATIONS.length).superRefine((states, context) => {
  const seen = new Set<NativeDocumentRequest['operation']>()
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

const extendedOperationKeys = Object.keys(
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS
) as [ContentSpaceExtendedOperationKey, ...ContentSpaceExtendedOperationKey[]]

export const contentSpaceExtendedOperationStateSchema = z.object({
  operation: z.enum(extendedOperationKeys),
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

export const contentSpaceExtendedOperationStateListSchema = z.array(
  contentSpaceExtendedOperationStateSchema
).max(extendedOperationKeys.length).superRefine((states, context) => {
  const seen = new Set<ContentSpaceExtendedOperationKey>()
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

const providerNativeDocumentArtifactResultSchema = z.object({
  kind: z.literal('artifact'),
  name: z.string().trim().min(1).max(256),
  mediaType: z.string().trim().min(1).max(128),
  bytesWritten: z.number().int().nonnegative().optional(),
  digest: artifactDigestSchema.optional()
}).strict().readonly()

const providerNativeDocumentNonArtifactResultSchema = nativeDocumentSuccessResultSchema.refine(
  (result) => result.kind !== 'artifact',
  'Provider feature results cannot contain a Host transfer handle.'
)

export const contentSpaceProviderNativeDocumentSuccessResultSchema = z.union([
  providerNativeDocumentNonArtifactResultSchema,
  providerNativeDocumentArtifactResultSchema
])

const providerNativeReceiptBase = {
  contractVersion: z.literal(NATIVE_DOCUMENT_CONTRACT_VERSION),
  resourceType: z.literal(NATIVE_DOCUMENT_RESOURCE_TYPE),
  operation: nativeDocumentOperationSchema,
  invocationId: contentSpaceInvocationIdSchema
} as const

export const contentSpaceProviderNativeDocumentReceiptSchema = z.discriminatedUnion('outcome', [
  z.object({
    ...providerNativeReceiptBase,
    outcome: z.literal('succeeded'),
    result: contentSpaceProviderNativeDocumentSuccessResultSchema
  }).strict().readonly(),
  z.object({
    ...providerNativeReceiptBase,
    outcome: z.literal('conflict'),
    error: nativeDocumentConflictErrorSchema
  }).strict().readonly(),
  z.object({
    ...providerNativeReceiptBase,
    outcome: z.literal('outcome_unknown'),
    error: nativeDocumentOutcomeUnknownErrorSchema
  }).strict().readonly(),
  z.object({
    ...providerNativeReceiptBase,
    outcome: z.literal('failed'),
    error: nativeDocumentFailureErrorSchema
  }).strict().readonly()
]).superRefine((receipt, context) => {
  if (receipt.outcome !== 'succeeded') return
  const expectedKind = NATIVE_DOCUMENT_RESULT_KIND_BY_OPERATION[receipt.operation]
  if (receipt.result.kind !== expectedKind) {
    context.addIssue({
      code: 'custom',
      path: ['result', 'kind'],
      message: `Operation ${receipt.operation} cannot return ${receipt.result.kind}.`
    })
  }
})

export type ContentSpaceProviderNativeDocumentReceipt = z.infer<
  typeof contentSpaceProviderNativeDocumentReceiptSchema
>

const NATIVE_DOCUMENT_RESULT_KIND_BY_OPERATION = Object.freeze({
  create: 'document',
  read: 'content',
  update: 'document',
  insert: 'document',
  probe: 'probe',
  plan: 'plan',
  edit: 'document',
  undo: 'document',
  redo: 'document',
  'image-upload': 'image',
  'image-download': 'artifact',
  'comment-create': 'document',
  'comment-list': 'comments',
  'comment-get': 'comment',
  'comment-reply': 'document',
  'comment-solve': 'document',
  'comment-reopen': 'document',
  'comment-delete': 'document',
  import: 'document',
  export: 'artifact'
} as const satisfies Readonly<Record<
  NativeDocumentRequest['operation'],
  string
>>)

const NATIVE_DOCUMENT_EFFECTS = Object.freeze({
  create: 'external-write',
  read: 'read',
  update: 'external-write',
  insert: 'external-write',
  probe: 'read',
  plan: 'read',
  edit: 'external-write',
  undo: 'external-write',
  redo: 'external-write',
  'image-upload': 'external-write',
  'image-download': 'workspace-write',
  'comment-create': 'external-write',
  'comment-list': 'read',
  'comment-get': 'read',
  'comment-reply': 'external-write',
  'comment-solve': 'external-write',
  'comment-reopen': 'external-write',
  'comment-delete': 'destructive',
  import: 'external-write',
  export: 'workspace-write'
} as const satisfies Readonly<Record<
  NativeDocumentRequest['operation'],
  ContentSpaceProviderFeatureEffect
>>)

const EXTENDED_OPERATION_EFFECTS = Object.freeze({
  searchEntries: 'read',
  listRecentEntries: 'read',
  getEntryInfo: 'read',
  resolveInternalLink: 'read',
  buildFileScope: 'read',
  listMetadataTypes: 'read',
  listMetadataFields: 'read',
  listMetadataChoices: 'read',
  readEntryMetadata: 'read',
  editEntryMetadata: 'external-write',
  renameEntry: 'external-write',
  copyEntries: 'external-write',
  moveEntries: 'external-write',
  deleteEntries: 'destructive',
  createShortcut: 'external-write',
  updateEntryProperties: 'external-write',
  listSecurityLevels: 'read',
  updateFileVersion: 'external-write',
  exportFileAsPdf: 'workspace-write',
  listAttachments: 'read',
  addAttachment: 'external-write',
  removeAttachment: 'destructive',
  listRelations: 'read',
  createRelation: 'external-write',
  removeRelation: 'destructive',
  listTags: 'read',
  setTags: 'external-write',
  removeTags: 'destructive',
  createPublication: 'external-write',
  listPublications: 'read',
  cancelPublication: 'destructive',
  createShare: 'external-write',
  listShares: 'read',
  cancelShare: 'destructive',
  listAlbums: 'read',
  listAlbumEntries: 'read',
  addFavorite: 'external-write',
  removeFavorite: 'destructive',
  getCurrentPrincipal: 'read',
  searchUsers: 'read',
  searchDepartments: 'read',
  searchPositions: 'read',
  searchGroups: 'read',
  listPermissionCategories: 'read',
  listPermissions: 'read',
  changePermissions: 'external-write',
  listCollaborationEntries: 'read',
  searchCollaborationEntries: 'read',
  resolveCollaborationInvitation: 'read',
  listKnowledgeCollections: 'read',
  searchKnowledgeCollections: 'read',
  browseKnowledgeCollection: 'read'
} as const satisfies Readonly<Record<
  ContentSpaceExtendedOperationKey,
  ContentSpaceProviderFeatureEffect
>>)

export type ContentSpaceExtendedOperationAuthority =
  | Readonly<{ kind: 'entry'; reference: ContentEntryReference }>
  | Readonly<{ kind: 'provider'; providerInstanceRef: string }>

type AuthorityExtractor = (request: any) => ContentSpaceExtendedOperationAuthority

const entryAuthority = (
  reference: ContentEntryReference
): ContentSpaceExtendedOperationAuthority => Object.freeze({ kind: 'entry', reference })
const providerAuthority = (
  providerInstanceRef: string
): ContentSpaceExtendedOperationAuthority => Object.freeze({
  kind: 'provider',
  providerInstanceRef
})
const scopeAuthority: AuthorityExtractor = (request) => request.scope.kind === 'container'
  ? entryAuthority(request.scope.container)
  : providerAuthority(request.scope.providerInstanceRef)

const EXTENDED_AUTHORITY_EXTRACTORS = Object.freeze({
  searchEntries: scopeAuthority,
  listRecentEntries: (request) => providerAuthority(request.providerInstanceRef),
  getEntryInfo: (request) => entryAuthority(request.reference),
  resolveInternalLink: (request) => entryAuthority(request.reference),
  buildFileScope: scopeAuthority,
  listMetadataTypes: (request) => providerAuthority(request.providerInstanceRef),
  listMetadataFields: (request) => providerAuthority(request.type.providerInstanceRef),
  listMetadataChoices: (request) => providerAuthority(request.field.type.providerInstanceRef),
  readEntryMetadata: (request) => entryAuthority(request.target),
  editEntryMetadata: (request) => entryAuthority(request.target),
  renameEntry: (request) => entryAuthority(request.target),
  copyEntries: (request) => entryAuthority(request.destination),
  moveEntries: (request) => entryAuthority(request.entries[0]),
  deleteEntries: (request) => entryAuthority(request.entries[0]),
  createShortcut: (request) => entryAuthority(request.destination),
  updateEntryProperties: (request) => entryAuthority(request.target),
  listSecurityLevels: (request) => providerAuthority(request.providerInstanceRef),
  updateFileVersion: (request) => entryAuthority(request.reference),
  exportFileAsPdf: (request) => entryAuthority(request.reference),
  listAttachments: (request) => entryAuthority(request.master),
  addAttachment: (request) => entryAuthority(request.master),
  removeAttachment: (request) => entryAuthority(request.attachment),
  listRelations: (request) => entryAuthority(request.target),
  createRelation: (request) => entryAuthority(request.source),
  removeRelation: (request) => entryAuthority(request.relation.source),
  listTags: (request) => entryAuthority(request.target),
  setTags: (request) => entryAuthority(request.targets[0]),
  removeTags: (request) => entryAuthority(request.targets[0]),
  createPublication: (request) => entryAuthority(request.targets[0]),
  listPublications: (request) => providerAuthority(request.providerInstanceRef),
  cancelPublication: (request) => providerAuthority(request.publications[0].providerInstanceRef),
  createShare: (request) => entryAuthority(request.targets[0]),
  listShares: (request) => providerAuthority(request.providerInstanceRef),
  cancelShare: (request) => providerAuthority(request.shares[0].providerInstanceRef),
  listAlbums: (request) => providerAuthority(request.providerInstanceRef),
  listAlbumEntries: (request) => providerAuthority(request.album.providerInstanceRef),
  addFavorite: (request) => providerAuthority(request.album.providerInstanceRef),
  removeFavorite: (request) => providerAuthority(request.album.providerInstanceRef),
  getCurrentPrincipal: (request) => providerAuthority(request.providerInstanceRef),
  searchUsers: (request) => providerAuthority(request.providerInstanceRef),
  searchDepartments: (request) => providerAuthority(request.providerInstanceRef),
  searchPositions: (request) => providerAuthority(request.providerInstanceRef),
  searchGroups: (request) => providerAuthority(request.providerInstanceRef),
  listPermissionCategories: (request) => providerAuthority(request.providerInstanceRef),
  listPermissions: (request) => entryAuthority(request.target),
  changePermissions: (request) => entryAuthority(request.target),
  listCollaborationEntries: (request) => providerAuthority(request.providerInstanceRef),
  searchCollaborationEntries: (request) => providerAuthority(request.providerInstanceRef),
  resolveCollaborationInvitation: (request) => entryAuthority(request.file),
  listKnowledgeCollections: (request) => providerAuthority(request.providerInstanceRef),
  searchKnowledgeCollections: (request) => providerAuthority(request.providerInstanceRef),
  browseKnowledgeCollection: (request) => request.parent
    ? entryAuthority(request.parent)
    : providerAuthority(request.collection.providerInstanceRef)
} satisfies Readonly<Record<ContentSpaceExtendedOperationKey, AuthorityExtractor>>)

export function nativeDocumentOperationEffect(
  operation: NativeDocumentRequest['operation']
): ContentSpaceProviderFeatureEffect {
  return NATIVE_DOCUMENT_EFFECTS[operation]
}

export function nativeDocumentRequestTarget(
  request: NativeDocumentRequest | AgentNativeDocumentRequest
): ContentEntryReference {
  return request.operation === 'create' || request.operation === 'import'
    ? request.parent
    : request.document.reference
}

export function extendedOperationEffect(
  operation: ContentSpaceExtendedOperationKey
): ContentSpaceProviderFeatureEffect {
  return EXTENDED_OPERATION_EFFECTS[operation]
}

export function extendedOperationAuthority(
  operation: ContentSpaceExtendedOperationKey,
  request: unknown
): ContentSpaceExtendedOperationAuthority {
  return EXTENDED_AUTHORITY_EXTRACTORS[operation](request)
}

export function collectProviderInstanceRefs(value: unknown): readonly string[] {
  const collected = new Set<string>()
  visitObjectGraph(value, (candidate) => {
    if (typeof candidate.providerInstanceRef === 'string') {
      collected.add(candidate.providerInstanceRef)
    }
  })
  return Object.freeze([...collected])
}

export function collectContentEntryReferences(
  value: unknown
): readonly ContentEntryReference[] {
  const collected = new Map<string, ContentEntryReference>()
  visitObjectGraph(value, (candidate) => {
    const reference = contentEntryReference(candidate)
    if (reference) collected.set(contentEntryReferenceKey(reference), reference)
  })
  return Object.freeze([...collected.values()])
}

export function sameContentEntryReference(
  left: ContentEntryReference,
  right: ContentEntryReference
): boolean {
  if (left.providerInstanceRef !== right.providerInstanceRef) return false
  if ('containerId' in left || 'containerId' in right) {
    return 'containerId' in left && 'containerId' in right &&
      left.containerId === right.containerId
  }
  if (left.fileId !== right.fileId) return false
  const leftVersion = 'immutableVersionId' in left ? left.immutableVersionId : undefined
  const rightVersion = 'immutableVersionId' in right ? right.immutableVersionId : undefined
  return leftVersion === rightVersion
}

function contentEntryReference(candidate: Record<string, unknown>): ContentEntryReference | undefined {
  if (typeof candidate.providerInstanceRef !== 'string') return undefined
  if (typeof candidate.containerId === 'string') {
    return candidate as ContentContainerReference
  }
  if (typeof candidate.fileId !== 'string') return undefined
  return candidate as ArtifactReference
}

function contentEntryReferenceKey(reference: ContentEntryReference): string {
  return 'containerId' in reference
    ? `${reference.providerInstanceRef}:container:${reference.containerId}`
    : `${reference.providerInstanceRef}:file:${reference.fileId}:${
        'immutableVersionId' in reference ? reference.immutableVersionId : ''
      }`
}

function visitObjectGraph(
  value: unknown,
  visit: (candidate: Record<string, unknown>) => void
): void {
  if (Array.isArray(value)) {
    for (const item of value) visitObjectGraph(item, visit)
    return
  }
  if (typeof value !== 'object' || value === null) return
  const candidate = value as Record<string, unknown>
  visit(candidate)
  for (const nested of Object.values(candidate)) visitObjectGraph(nested, visit)
}

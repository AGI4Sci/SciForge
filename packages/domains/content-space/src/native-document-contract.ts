import { z } from 'zod'

import {
  domainFileTransferHandleSchema,
  domainWorkspaceRelativePathSchema
} from '@sciforge/domain-sdk/host'

import {
  contentContainerReferenceSchema,
  contentFileReferenceSchema
} from './contract.js'

export const NATIVE_DOCUMENT_CONTRACT_VERSION = '1.0.0' as const
export const NATIVE_DOCUMENT_RESOURCE_TYPE = 'native_document' as const

export const nativeDocumentReferenceSchema = z.object({
  resourceType: z.literal(NATIVE_DOCUMENT_RESOURCE_TYPE),
  reference: contentFileReferenceSchema
}).strict().readonly()

export type NativeDocumentReference = z.infer<typeof nativeDocumentReferenceSchema>

export const NATIVE_DOCUMENT_OPERATIONS = Object.freeze([
  'create',
  'read',
  'update',
  'insert',
  'probe',
  'plan',
  'edit',
  'undo',
  'redo',
  'image-upload',
  'image-download',
  'comment-create',
  'comment-list',
  'comment-get',
  'comment-reply',
  'comment-solve',
  'comment-reopen',
  'comment-delete',
  'import',
  'export'
] as const)

export const nativeDocumentOperationSchema = z.enum(NATIVE_DOCUMENT_OPERATIONS)
export type NativeDocumentOperation = z.infer<typeof nativeDocumentOperationSchema>

export const nativeDocumentHashSchema = z.string().regex(/^[a-f0-9]{64}$/u)

const boundedIdSchema = z.string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), 'Identifiers must be canonical.')

const boundedTextSchema = z.string().min(1).max(1_000_000)
const boundedCommentSchema = z.string().trim().min(1).max(16_384)

export const nativeDocumentContentSchema = z.object({
  encoding: z.literal('json'),
  value: z.json()
}).strict().readonly()

export const nativeDocumentSelectorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: boundedTextSchema,
    occurrence: z.number().int().min(1).max(100_000)
  }).strict().readonly(),
  z.object({
    kind: z.literal('range'),
    startText: boundedTextSchema,
    endText: boundedTextSchema
  }).strict().readonly(),
  z.object({
    kind: z.literal('component'),
    componentType: boundedIdSchema,
    occurrence: z.number().int().min(1).max(100_000)
  }).strict().readonly()
])

export const nativeDocumentEditCapabilitySchema = z.enum([
  'locate',
  'replace_text',
  'insert_text',
  'delete_text',
  'insert_block',
  'delete_block',
  'format_text',
  'update_component'
])

const valueChangeSchema = z.object({
  kind: z.enum([
    'replace_text',
    'insert_text',
    'insert_block',
    'format_text',
    'update_component'
  ]),
  target: nativeDocumentSelectorSchema,
  value: z.json()
}).strict().readonly()

const deletionChangeSchema = z.object({
  kind: z.enum(['delete_text', 'delete_block']),
  target: nativeDocumentSelectorSchema
}).strict().readonly()

export const nativeDocumentChangeSchema = z.union([
  valueChangeSchema,
  deletionChangeSchema
])

const createRequestSchema = z.object({
  operation: z.literal('create'),
  resourceType: z.literal(NATIVE_DOCUMENT_RESOURCE_TYPE),
  parent: contentContainerReferenceSchema,
  title: z.string().trim().min(1).max(256),
  content: nativeDocumentContentSchema
}).strict().readonly()

const readRequestSchema = z.object({
  operation: z.literal('read'),
  document: nativeDocumentReferenceSchema
}).strict().readonly()

const updateRequestSchema = z.object({
  operation: z.literal('update'),
  document: nativeDocumentReferenceSchema,
  baseHash: nativeDocumentHashSchema,
  content: nativeDocumentContentSchema
}).strict().readonly()

const insertRequestSchema = z.object({
  operation: z.literal('insert'),
  document: nativeDocumentReferenceSchema,
  baseHash: nativeDocumentHashSchema,
  position: z.enum(['start', 'end']),
  content: nativeDocumentContentSchema
}).strict().readonly()

const probeRequestSchema = z.object({
  operation: z.literal('probe'),
  document: nativeDocumentReferenceSchema,
  selector: nativeDocumentSelectorSchema,
  requestedCapability: nativeDocumentEditCapabilitySchema
}).strict().readonly()

const planRequestSchema = z.object({
  operation: z.literal('plan'),
  document: nativeDocumentReferenceSchema,
  probeReceiptId: boundedIdSchema,
  baseHash: nativeDocumentHashSchema,
  changes: z.array(nativeDocumentChangeSchema).min(1).max(1_000).readonly()
}).strict().readonly()

const editRequestSchema = z.object({
  operation: z.literal('edit'),
  document: nativeDocumentReferenceSchema,
  planReceiptId: boundedIdSchema,
  baseHash: nativeDocumentHashSchema
}).strict().readonly()

const revisionRequestSchemas = [
  z.object({
    operation: z.literal('undo'),
    document: nativeDocumentReferenceSchema,
    baseHash: nativeDocumentHashSchema
  }).strict().readonly(),
  z.object({
    operation: z.literal('redo'),
    document: nativeDocumentReferenceSchema,
    baseHash: nativeDocumentHashSchema
  }).strict().readonly()
] as const

const imageRequestSchemas = [
  z.object({
    operation: z.literal('image-upload'),
    document: nativeDocumentReferenceSchema,
    sourceHandle: domainFileTransferHandleSchema,
    mediaType: z.enum([
      'image/avif',
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/svg+xml',
      'image/webp'
    ])
  }).strict().readonly(),
  z.object({
    operation: z.literal('image-download'),
    document: nativeDocumentReferenceSchema,
    position: z.number().int().min(1).max(100_000),
    destinationHandle: domainFileTransferHandleSchema
  }).strict().readonly()
] as const

const commentReadRequestSchemas = [
  z.object({
    operation: z.literal('comment-list'),
    document: nativeDocumentReferenceSchema,
    status: z.enum(['all', 'open', 'solved'])
  }).strict().readonly(),
  z.object({
    operation: z.literal('comment-get'),
    document: nativeDocumentReferenceSchema,
    commentId: boundedIdSchema
  }).strict().readonly()
] as const

const commentMutationBase = {
  document: nativeDocumentReferenceSchema,
  baseHash: nativeDocumentHashSchema
} as const

const commentMutationRequestSchemas = [
  z.object({
    operation: z.literal('comment-create'),
    ...commentMutationBase,
    selector: nativeDocumentSelectorSchema,
    body: boundedCommentSchema
  }).strict().readonly(),
  z.object({
    operation: z.literal('comment-reply'),
    ...commentMutationBase,
    commentId: boundedIdSchema,
    body: boundedCommentSchema
  }).strict().readonly(),
  z.object({
    operation: z.literal('comment-solve'),
    ...commentMutationBase,
    commentId: boundedIdSchema
  }).strict().readonly(),
  z.object({
    operation: z.literal('comment-reopen'),
    ...commentMutationBase,
    commentId: boundedIdSchema
  }).strict().readonly(),
  z.object({
    operation: z.literal('comment-delete'),
    ...commentMutationBase,
    commentId: boundedIdSchema
  }).strict().readonly()
] as const

const transferRequestSchemas = [
  z.object({
    operation: z.literal('import'),
    resourceType: z.literal(NATIVE_DOCUMENT_RESOURCE_TYPE),
    parent: contentContainerReferenceSchema,
    sourceHandle: domainFileTransferHandleSchema
  }).strict().readonly(),
  z.object({
    operation: z.literal('export'),
    document: nativeDocumentReferenceSchema,
    format: z.enum(['docx', 'pdf', 'markdown']),
    destinationHandle: domainFileTransferHandleSchema
  }).strict().readonly()
] as const

export const nativeDocumentRequestSchema = z.discriminatedUnion('operation', [
  createRequestSchema,
  readRequestSchema,
  updateRequestSchema,
  insertRequestSchema,
  probeRequestSchema,
  planRequestSchema,
  editRequestSchema,
  ...revisionRequestSchemas,
  ...imageRequestSchemas,
  commentMutationRequestSchemas[0],
  ...commentReadRequestSchemas,
  ...commentMutationRequestSchemas.slice(1),
  ...transferRequestSchemas
])

const agentImageRequestSchemas = [
  z.object({
    operation: z.literal('image-upload'),
    document: nativeDocumentReferenceSchema,
    workspaceRelativePath: domainWorkspaceRelativePathSchema,
    mediaType: z.enum([
      'image/avif',
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/svg+xml',
      'image/webp'
    ])
  }).strict().readonly(),
  z.object({
    operation: z.literal('image-download'),
    document: nativeDocumentReferenceSchema,
    position: z.number().int().min(1).max(100_000),
    workspaceRelativePath: domainWorkspaceRelativePathSchema
  }).strict().readonly()
] as const

const agentTransferRequestSchemas = [
  z.object({
    operation: z.literal('import'),
    resourceType: z.literal(NATIVE_DOCUMENT_RESOURCE_TYPE),
    parent: contentContainerReferenceSchema,
    workspaceRelativePath: domainWorkspaceRelativePathSchema
  }).strict().readonly(),
  z.object({
    operation: z.literal('export'),
    document: nativeDocumentReferenceSchema,
    format: z.enum(['docx', 'pdf', 'markdown']),
    workspaceRelativePath: domainWorkspaceRelativePathSchema
  }).strict().readonly()
] as const

/**
 * Agent capability input. Transfer authority is always an active Workspace-relative
 * path; Host transfer handles remain confined to Human/System capability surfaces.
 */
export const agentNativeDocumentRequestSchema = z.discriminatedUnion('operation', [
  createRequestSchema,
  readRequestSchema,
  updateRequestSchema,
  insertRequestSchema,
  probeRequestSchema,
  planRequestSchema,
  editRequestSchema,
  ...revisionRequestSchemas,
  ...agentImageRequestSchemas,
  commentMutationRequestSchemas[0],
  ...commentReadRequestSchemas,
  ...commentMutationRequestSchemas.slice(1),
  ...agentTransferRequestSchemas
])

export type NativeDocumentContent = z.infer<typeof nativeDocumentContentSchema>
export type NativeDocumentSelector = z.infer<typeof nativeDocumentSelectorSchema>
export type NativeDocumentChange = z.infer<typeof nativeDocumentChangeSchema>
export type NativeDocumentRequest = z.infer<typeof nativeDocumentRequestSchema>
export type AgentNativeDocumentRequest = z.infer<typeof agentNativeDocumentRequestSchema>

const nativeDocumentCommentSchema = z.object({
  commentId: boundedIdSchema,
  body: boundedCommentSchema,
  status: z.enum(['open', 'solved']),
  createdAt: z.string().datetime({ offset: true })
}).strict().readonly()

export const nativeDocumentSuccessResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('document'),
    document: nativeDocumentReferenceSchema,
    documentHash: nativeDocumentHashSchema,
    revisionId: boundedIdSchema
  }).strict().readonly(),
  z.object({
    kind: z.literal('content'),
    document: nativeDocumentReferenceSchema,
    documentHash: nativeDocumentHashSchema,
    content: z.json()
  }).strict().readonly(),
  z.object({
    kind: z.literal('probe'),
    document: nativeDocumentReferenceSchema,
    documentHash: nativeDocumentHashSchema,
    probeReceiptId: boundedIdSchema,
    capabilitySupported: z.boolean(),
    selection: z.json().optional()
  }).strict().readonly(),
  z.object({
    kind: z.literal('plan'),
    document: nativeDocumentReferenceSchema,
    baseHash: nativeDocumentHashSchema,
    planReceiptId: boundedIdSchema,
    canApply: z.literal(true),
    changeCount: z.number().int().min(1).max(1_000)
  }).strict().readonly(),
  z.object({
    kind: z.literal('image'),
    resourceId: boundedIdSchema,
    mediaType: z.string().trim().min(1).max(128)
  }).strict().readonly(),
  z.object({
    kind: z.literal('artifact'),
    transferHandle: domainFileTransferHandleSchema,
    name: z.string().trim().min(1).max(256),
    mediaType: z.string().trim().min(1).max(128),
    bytesWritten: z.number().int().nonnegative().optional()
  }).strict().readonly(),
  z.object({
    kind: z.literal('comments'),
    document: nativeDocumentReferenceSchema,
    comments: z.array(nativeDocumentCommentSchema).max(10_000).readonly()
  }).strict().readonly(),
  z.object({
    kind: z.literal('comment'),
    document: nativeDocumentReferenceSchema,
    comment: nativeDocumentCommentSchema
  }).strict().readonly()
])

export const nativeDocumentConflictErrorSchema = z.object({
  code: z.literal('conflict'),
  reason: z.enum(['hash_mismatch', 'revision_conflict', 'stale_plan']),
  message: z.string().trim().min(1).max(256),
  retry: z.literal('never'),
  expectedHash: nativeDocumentHashSchema,
  actualHash: nativeDocumentHashSchema.optional()
}).strict().readonly()

export const nativeDocumentOutcomeUnknownErrorSchema = z.object({
  code: z.literal('outcome_unknown'),
  stage: z.enum(['write', 'publish', 'verify', 'comment_commit']),
  message: z.string().trim().min(1).max(256),
  retry: z.literal('never')
}).strict().readonly()

export const nativeDocumentFailureErrorSchema = z.object({
  code: z.enum([
    'invalid_input',
    'invalid_reference',
    'not_found',
    'unsupported',
    'unauthorized',
    'provider_unavailable',
    'contract_violation',
    'cancelled'
  ]),
  message: z.string().trim().min(1).max(256),
  retry: z.enum(['never', 'after-human-action', 'safe-with-same-invocation'])
}).strict().readonly()

const nativeDocumentReceiptBaseShape = {
  contractVersion: z.literal(NATIVE_DOCUMENT_CONTRACT_VERSION),
  resourceType: z.literal(NATIVE_DOCUMENT_RESOURCE_TYPE),
  operation: nativeDocumentOperationSchema,
  invocationId: boundedIdSchema
} as const

export const nativeDocumentReceiptSchema = z.discriminatedUnion('outcome', [
  z.object({
    ...nativeDocumentReceiptBaseShape,
    outcome: z.literal('succeeded'),
    result: nativeDocumentSuccessResultSchema
  }).strict().readonly(),
  z.object({
    ...nativeDocumentReceiptBaseShape,
    outcome: z.literal('conflict'),
    error: nativeDocumentConflictErrorSchema
  }).strict().readonly(),
  z.object({
    ...nativeDocumentReceiptBaseShape,
    outcome: z.literal('outcome_unknown'),
    error: nativeDocumentOutcomeUnknownErrorSchema
  }).strict().readonly(),
  z.object({
    ...nativeDocumentReceiptBaseShape,
    outcome: z.literal('failed'),
    error: nativeDocumentFailureErrorSchema
  }).strict().readonly()
]).superRefine((receipt, context) => {
  if (receipt.outcome !== 'succeeded') return
  const expectedKindByOperation: Readonly<Record<NativeDocumentOperation, string>> = {
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
  }
  if (receipt.result.kind !== expectedKindByOperation[receipt.operation]) {
    context.addIssue({
      code: 'custom',
      path: ['result', 'kind'],
      message: `Operation ${receipt.operation} cannot return ${receipt.result.kind}.`
    })
  }
})

const agentNativeDocumentArtifactResultSchema = z.object({
  kind: z.literal('artifact'),
  workspaceRelativePath: domainWorkspaceRelativePathSchema,
  name: z.string().trim().min(1).max(256),
  mediaType: z.string().trim().min(1).max(128),
  bytesWritten: z.number().int().nonnegative().optional()
}).strict().readonly()

export const agentNativeDocumentSuccessResultSchema = z.union([
  nativeDocumentSuccessResultSchema.refine(
    (result) => result.kind !== 'artifact',
    'Agent transfer results cannot contain Host transfer handles.'
  ),
  agentNativeDocumentArtifactResultSchema
])

export const agentNativeDocumentReceiptSchema = z.discriminatedUnion('outcome', [
  z.object({
    ...nativeDocumentReceiptBaseShape,
    outcome: z.literal('succeeded'),
    result: agentNativeDocumentSuccessResultSchema
  }).strict().readonly(),
  z.object({
    ...nativeDocumentReceiptBaseShape,
    outcome: z.literal('conflict'),
    error: nativeDocumentConflictErrorSchema
  }).strict().readonly(),
  z.object({
    ...nativeDocumentReceiptBaseShape,
    outcome: z.literal('outcome_unknown'),
    error: nativeDocumentOutcomeUnknownErrorSchema
  }).strict().readonly(),
  z.object({
    ...nativeDocumentReceiptBaseShape,
    outcome: z.literal('failed'),
    error: nativeDocumentFailureErrorSchema
  }).strict().readonly()
]).superRefine((receipt, context) => {
  if (receipt.outcome !== 'succeeded') return
  const expectedKindByOperation: Readonly<Record<NativeDocumentOperation, string>> = {
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
  }
  if (receipt.result.kind !== expectedKindByOperation[receipt.operation]) {
    context.addIssue({
      code: 'custom',
      path: ['result', 'kind'],
      message: `Operation ${receipt.operation} cannot return ${receipt.result.kind}.`
    })
  }
})

export type NativeDocumentSuccessResult = z.infer<
  typeof nativeDocumentSuccessResultSchema
>
export type NativeDocumentReceipt = z.infer<typeof nativeDocumentReceiptSchema>
export type AgentNativeDocumentReceipt = z.infer<typeof agentNativeDocumentReceiptSchema>

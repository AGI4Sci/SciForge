import { z } from 'zod'

export const DOCFLOW_NATIVE_DOCUMENT_COMMANDS = Object.freeze([
  'docflow-create',
  'docflow-read',
  'docflow-probe',
  'docflow-plan',
  'docflow-image-upload',
  'docflow-image-download',
  'docflow-comment-list',
  'docflow-comment-get',
  'docflow-import',
  'docflow-export'
] as const)

export const docflowCommandSchema = z.enum(DOCFLOW_NATIVE_DOCUMENT_COMMANDS)
export type DocflowCommand = z.infer<typeof docflowCommandSchema>

const invocationIdSchema = z.string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]+$/u)

const safeDataFileNameSchema = z.string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => value !== '.' && value !== '..')
  .refine((value) => !/[\\/]/u.test(value) && [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint >= 32 && codePoint !== 127
  }))

export const docflowDataFileRoleSchema = z.enum([
  'content',
  'operations',
  'probe-template',
  'source',
  'image',
  'destination'
])

const docflowInputDataFileRoleSchema = z.enum([
  'content',
  'operations',
  'probe-template',
  'source',
  'image'
])

export type DocflowManagedOutputWrite = (chunk: Uint8Array) => Promise<void>

const managedOutputWriteSchema = z.custom<DocflowManagedOutputWrite>(
  (value) => typeof value === 'function',
  'A runner-managed output requires a write function.'
)

export const docflowDataFileSchema = z.discriminatedUnion('encoding', [
  z.object({
    role: docflowInputDataFileRoleSchema,
    encoding: z.literal('utf8'),
    name: safeDataFileNameSchema,
    mediaType: z.string().trim().min(1).max(128),
    content: z.string().max(16 * 1024 * 1024)
  }).strict().readonly(),
  z.object({
    role: docflowInputDataFileRoleSchema,
    encoding: z.literal('json'),
    name: safeDataFileNameSchema,
    mediaType: z.literal('application/json'),
    content: z.json()
  }).strict().readonly(),
  z.object({
    role: docflowInputDataFileRoleSchema,
    encoding: z.literal('base64'),
    name: safeDataFileNameSchema,
    mediaType: z.string().trim().min(1).max(128),
    content: z.string().max(24 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/u)
  }).strict().readonly(),
  z.object({
    role: z.literal('probe-template'),
    encoding: z.literal('managed'),
    token: z.string().regex(/^ocdf_[A-Za-z0-9_-]{32,128}$/u)
  }).strict().readonly(),
  z.object({
    role: z.literal('destination'),
    encoding: z.literal('managed-stream'),
    name: safeDataFileNameSchema,
    write: managedOutputWriteSchema
  }).strict().readonly()
])

const resourceIdSchema = z.string()
  .min(1)
  .max(4_096)
  .refine((value) => value === value.trim(), 'Resource identifiers must be canonical.')

const documentHashSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const referenceSchema = z.object({
  fileId: resourceIdSchema,
  fileName: z.string().trim().min(1).max(256).optional(),
  systemId: z.literal('ecm').optional(),
  description: z.string().trim().min(1).max(1_024).optional()
}).strict().readonly()

export const docflowCanonicalEditOperationSchema = z.enum([
  'locate',
  'replaceText',
  'insertText',
  'deleteText',
  'setInlineFormat',
  'replaceBlock',
  'insertBlockBefore',
  'insertBlockAfter',
  'deleteBlock',
  'setBlockAttribute',
  'setListLevel',
  'setListType',
  'clearFormatting',
  'copyFormatting',
  'setComponentState',
  'updateCodeBlock',
  'resizeImage',
  'resetImage',
  'insertImageIntoImageSet',
  'setTableCellContent',
  'setTableCellStyle',
  'setTableTemplate',
  'insertTableRow',
  'deleteTableRow',
  'insertTableColumn',
  'deleteTableColumn',
  'mergeTableCells',
  'splitTableCell',
  'setTableRowHeight',
  'setTableColumnWidth',
  'moveChapter'
])

const probeArgsSchema = z.object({
  fileId: resourceIdSchema,
  target: z.json().optional(),
  targets: z.array(z.json()).min(1).max(50).readonly().optional(),
  view: z.enum(['target', 'summary']),
  operation: docflowCanonicalEditOperationSchema,
  include: z.array(z.enum([
    'nodes',
    'text',
    'formats',
    'links',
    'tables',
    'resources',
    'slots'
  ])).min(1).max(7).readonly(),
  context: z.number().int().min(0).max(5).optional(),
  limit: z.number().int().min(1).max(50).optional()
}).strict().superRefine((args, context) => {
  if (args.target !== undefined && args.targets !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'Probe accepts target or targets, never both.'
    })
  }
  if (args.view === 'target' && args.target === undefined && args.targets === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'A target view requires target data.'
    })
  }
}).readonly()

const imageUploadArgsSchema = z.object({
  source: z.enum(['url', 'data-file']),
  url: z.string().url().max(8_192).optional()
}).strict().superRefine((args, context) => {
  if ((args.source === 'url') !== (args.url !== undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['url'],
      message: 'Only URL image sources may carry a URL.'
    })
  }
}).readonly()

const commonDataFilesSchema = z.array(docflowDataFileSchema).max(2).readonly()

function invocationSchema<
  Command extends DocflowCommand,
  Args extends z.ZodType
>(command: Command, args: Args) {
  return z.object({
    invocationId: invocationIdSchema,
    command: z.literal(command),
    args,
    dataFiles: commonDataFilesSchema
  }).strict().readonly()
}

const commandInvocationSchemas = [
  invocationSchema('docflow-create', z.object({
    title: z.string().trim().min(1).max(256),
    folderId: resourceIdSchema.optional(),
    references: z.array(referenceSchema).max(8).readonly()
  }).strict().readonly()),
  invocationSchema('docflow-read', z.object({
    fileId: resourceIdSchema
  }).strict().readonly()),
  invocationSchema('docflow-probe', probeArgsSchema),
  invocationSchema('docflow-plan', z.object({
    fileId: resourceIdSchema,
    baseHash: documentHashSchema
  }).strict().readonly()),
  invocationSchema('docflow-image-upload', imageUploadArgsSchema),
  invocationSchema('docflow-image-download', z.object({
    fileId: resourceIdSchema,
    position: z.number().int().min(1).max(100_000)
  }).strict().readonly()),
  invocationSchema('docflow-comment-list', z.object({
    fileId: resourceIdSchema,
    status: z.enum(['all', 'open', 'solved'])
  }).strict().readonly()),
  invocationSchema('docflow-comment-get', z.object({
    fileId: resourceIdSchema,
    commentId: resourceIdSchema
  }).strict().readonly()),
  invocationSchema('docflow-import', z.object({
    folderId: resourceIdSchema.optional()
  }).strict().readonly()),
  invocationSchema('docflow-export', z.object({
    fileId: resourceIdSchema,
    format: z.enum(['docx', 'pdf', 'md'])
  }).strict().readonly())
] as const

export const docflowCommandInvocationSchema = z.union(commandInvocationSchemas)
  .superRefine((invocation, context) => {
    const expectedRoles = expectedDataFileRoles(invocation)
    const actualRoles = invocation.dataFiles.map((file) => file.role)
    if (actualRoles.length !== expectedRoles.length ||
      actualRoles.some((role, index) => role !== expectedRoles[index])) {
      context.addIssue({
        code: 'custom',
        path: ['dataFiles'],
        message: `Command ${invocation.command} requires data-file roles: ${expectedRoles.join(', ') || '(none)'}.`
      })
      return
    }
    for (const [index, file] of invocation.dataFiles.entries()) {
      if (file.role === 'content' && !['utf8', 'json'].includes(file.encoding)) {
        context.addIssue({ code: 'custom', path: ['dataFiles', index, 'encoding'], message: 'Document content must be UTF-8 or JSON data.' })
      }
      if (file.role === 'operations' && file.encoding !== 'json') {
        context.addIssue({ code: 'custom', path: ['dataFiles', index, 'encoding'], message: 'Edit operations must be JSON data.' })
      }
      if (file.role === 'probe-template' && file.encoding !== 'managed') {
        context.addIssue({ code: 'custom', path: ['dataFiles', index, 'encoding'], message: 'Plans and templates require a runner-managed token.' })
      }
      if (file.role === 'image' && (file.encoding !== 'base64' || !file.mediaType.startsWith('image/'))) {
        context.addIssue({ code: 'custom', path: ['dataFiles', index], message: 'Images require base64 image data.' })
      }
      if (file.role === 'source' && !['utf8', 'base64'].includes(file.encoding)) {
        context.addIssue({ code: 'custom', path: ['dataFiles', index, 'encoding'], message: 'Import sources must be UTF-8 or base64 data.' })
      }
      if (file.role === 'destination' && file.encoding !== 'managed-stream') {
        context.addIssue({ code: 'custom', path: ['dataFiles', index, 'encoding'], message: 'Download destinations require a runner-managed stream.' })
      }
    }
  })

export type DocflowDataFile = z.infer<typeof docflowDataFileSchema>
export type DocflowCommandInvocation = z.infer<typeof docflowCommandInvocationSchema>

function expectedDataFileRoles(
  invocation: Readonly<{ command: DocflowCommand; args: unknown }>
): readonly z.infer<typeof docflowDataFileRoleSchema>[] {
  switch (invocation.command) {
    case 'docflow-create':
      return ['content']
    case 'docflow-plan':
      return ['probe-template', 'operations']
    case 'docflow-image-upload':
      return (invocation.args as { source?: unknown }).source === 'data-file'
        ? ['image']
        : []
    case 'docflow-import':
      return ['source']
    case 'docflow-image-download':
    case 'docflow-export':
      return ['destination']
    default:
      return []
  }
}

export const DOCFLOW_COMMAND_RESULT_PROTOCOL = 'docflow-command-result:v1' as const
export const DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL =
  'docflowNativeDocumentReceipt:v1' as const

const boundedIdentifierSchema = z.string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim(), 'Identifiers must be canonical.')

export const docflowStructuredDeliverySchema = z.object({
  protocol: z.literal('docflowCard:v1'),
  outcome: z.literal('succeeded'),
  businessIdentity: boundedIdentifierSchema,
  payload: z.object({
    projectId: boundedIdentifierSchema,
    name: z.string().trim().min(1).max(256),
    accessUrl: z.string().url().max(4_096),
    updateTime: z.string().datetime({ offset: true })
  }).strict().readonly()
}).strict().superRefine((delivery, context) => {
  if (delivery.businessIdentity !== delivery.payload.projectId) {
    context.addIssue({
      code: 'custom',
      path: ['payload', 'projectId'],
      message: 'Structured delivery identities must match.'
    })
  }
}).readonly()

export const docflowManagedDataFileSchema = z.object({
  role: z.literal('probe-template'),
  token: z.string().regex(/^ocdf_[A-Za-z0-9_-]{32,128}$/u),
  name: safeDataFileNameSchema,
  mediaType: z.literal('application/json')
}).strict().readonly()

const docflowTransportSuccessSchema = z.object({
  protocol: z.literal(DOCFLOW_COMMAND_RESULT_PROTOCOL),
  command: docflowCommandSchema,
  ok: z.literal(true),
  json: z.record(z.string(), z.json()),
  structuredDeliveryItems: z.array(docflowStructuredDeliverySchema).max(1).readonly(),
  managedDataFiles: z.array(docflowManagedDataFileSchema).max(1).readonly()
}).strict().readonly()

const docflowTransportErrorSchema = z.object({
  code: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(512),
  stage: z.enum([
    'validation',
    'dispatch',
    'read',
    'write',
    'publish',
    'verify',
    'transport'
  ]),
  dispatched: z.boolean(),
  expectedHash: documentHashSchema.optional(),
  actualHash: documentHashSchema.optional()
}).strict().readonly()

const docflowTransportFailureSchema = z.object({
  protocol: z.literal(DOCFLOW_COMMAND_RESULT_PROTOCOL),
  command: docflowCommandSchema,
  ok: z.literal(false),
  error: docflowTransportErrorSchema
}).strict().readonly()

export const docflowTransportResultSchema = z.union([
  docflowTransportSuccessSchema,
  docflowTransportFailureSchema
])
export type DocflowTransportResult = z.infer<typeof docflowTransportResultSchema>

export const docflowNativeDocumentSuccessReceiptSchema = z.object({
  protocol: z.literal(DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL),
  invocationId: invocationIdSchema,
  command: docflowCommandSchema,
  attemptCount: z.literal(1),
  outcome: z.literal('succeeded'),
  json: z.record(z.string(), z.json()),
  structuredDeliveryItems: z.array(docflowStructuredDeliverySchema).max(1).readonly(),
  managedDataFiles: z.array(docflowManagedDataFileSchema).max(1).readonly()
}).strict().readonly()

const receiptBaseShape = {
  protocol: z.literal(DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL),
  invocationId: invocationIdSchema,
  command: docflowCommandSchema,
  attemptCount: z.literal(1)
} as const

export const docflowNativeDocumentConflictReceiptSchema = z.object({
  ...receiptBaseShape,
  outcome: z.literal('conflict'),
  error: z.object({
    code: z.literal('conflict'),
    reason: z.enum(['hash_mismatch', 'revision_conflict', 'stale_plan']),
    message: z.string().trim().min(1).max(512),
    retry: z.literal('never'),
    expectedHash: documentHashSchema.optional(),
    actualHash: documentHashSchema.optional()
  }).strict().readonly()
}).strict().readonly()

export const docflowNativeDocumentOutcomeUnknownReceiptSchema = z.object({
  ...receiptBaseShape,
  outcome: z.literal('outcome_unknown'),
  error: z.object({
    code: z.literal('outcome_unknown'),
    stage: z.enum(['write', 'publish', 'verify']),
    message: z.string().trim().min(1).max(512),
    retry: z.literal('never')
  }).strict().readonly()
}).strict().readonly()

export const docflowNativeDocumentFailureReceiptSchema = z.object({
  ...receiptBaseShape,
  outcome: z.literal('failed'),
  error: z.object({
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
    message: z.string().trim().min(1).max(512),
    retry: z.literal('never')
  }).strict().readonly()
}).strict().readonly()

export const docflowNativeDocumentReceiptSchema = z.union([
  docflowNativeDocumentSuccessReceiptSchema,
  docflowNativeDocumentConflictReceiptSchema,
  docflowNativeDocumentOutcomeUnknownReceiptSchema,
  docflowNativeDocumentFailureReceiptSchema
])

export type DocflowNativeDocumentReceipt = z.infer<
  typeof docflowNativeDocumentReceiptSchema
>

/**
 * Production transports privately inject authentication and materialize data
 * files in a controlled temporary directory. The invocation deliberately has
 * no argv, environment, executable, working-directory, or filesystem path.
 */
export interface DocflowCommandTransport {
  invoke(invocation: DocflowCommandInvocation): Promise<unknown>
}

export type DocflowNativeDocumentAdapter = Readonly<{
  execute(input: unknown): Promise<DocflowNativeDocumentReceipt>
}>

export function createDocflowNativeDocumentAdapter(
  transport: DocflowCommandTransport
): DocflowNativeDocumentAdapter {
  return Object.freeze({
    async execute(input: unknown): Promise<DocflowNativeDocumentReceipt> {
      const invocation = docflowCommandInvocationSchema.parse(input)
      let rawResponse: unknown
      try {
        rawResponse = await transport.invoke(invocation)
      } catch (error) {
        return isWriteCommand(invocation.command)
          ? outcomeUnknownReceipt(
              invocation,
              'write',
              boundedMessage(error, 'The command transport failed after dispatch began.')
            )
          : failureReceipt(
              invocation,
              'provider_unavailable',
              boundedMessage(error, 'The command transport is unavailable.')
            )
      }
      const parsedResponse = docflowTransportResultSchema.safeParse(rawResponse)
      if (!parsedResponse.success) {
        return isWriteCommand(invocation.command)
          ? outcomeUnknownReceipt(
              invocation,
              'verify',
              'The command returned an invalid result after a possible write.'
            )
          : failureReceipt(
              invocation,
              'contract_violation',
              'The command returned an invalid structured result.'
            )
      }
      const response = parsedResponse.data
      if (response.command !== invocation.command) {
        return isWriteCommand(invocation.command)
          ? outcomeUnknownReceipt(
              invocation,
              'verify',
              'The command result could not be bound to the requested write.'
            )
          : failureReceipt(
              invocation,
              'contract_violation',
              'The command result does not match the requested command.'
            )
      }
      if (!response.ok) {
        return mapTransportFailure(invocation, response.error)
      }
      if (requiresStructuredDelivery(invocation.command) &&
        response.structuredDeliveryItems.length !== 1) {
        return outcomeUnknownReceipt(
          invocation,
          'verify',
          'The write result lacks its required structured delivery receipt.'
        )
      }
      return Object.freeze(docflowNativeDocumentSuccessReceiptSchema.parse({
        protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
        invocationId: invocation.invocationId,
        command: invocation.command,
        attemptCount: 1,
        outcome: 'succeeded',
        json: response.json,
        structuredDeliveryItems: response.structuredDeliveryItems,
        managedDataFiles: response.managedDataFiles
      }))
    }
  })
}

const HASH_CONFLICT_CODES = new Set([
  'DOCFLOW_DOCUMENT_HASH_MISMATCH',
  'DOCFLOW_EDIT_PLAN_PRECONDITION_FAILED',
  'DOCFLOW_REVISION_CONFLICT'
])

const WRITE_COMMANDS = new Set<DocflowCommand>([
  'docflow-create',
  'docflow-image-upload',
  'docflow-image-download',
  'docflow-import',
  'docflow-export'
])

const DELIVERY_COMMANDS = new Set<DocflowCommand>([
  'docflow-create',
  'docflow-import'
])

function isWriteCommand(command: DocflowCommand): boolean {
  return WRITE_COMMANDS.has(command)
}

function requiresStructuredDelivery(command: DocflowCommand): boolean {
  return DELIVERY_COMMANDS.has(command)
}

function mapTransportFailure(
  invocation: DocflowCommandInvocation,
  error: z.infer<typeof docflowTransportErrorSchema>
): DocflowNativeDocumentReceipt {
  if (HASH_CONFLICT_CODES.has(error.code)) {
    return Object.freeze(docflowNativeDocumentConflictReceiptSchema.parse({
      protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
      invocationId: invocation.invocationId,
      command: invocation.command,
      attemptCount: 1,
      outcome: 'conflict',
      error: {
        code: 'conflict',
        reason: error.code === 'DOCFLOW_REVISION_CONFLICT'
          ? 'revision_conflict'
          : 'hash_mismatch',
        message: error.message,
        retry: 'never',
        expectedHash: error.expectedHash ?? invocationBaseHash(invocation),
        actualHash: error.actualHash
      }
    }))
  }
  if (error.code === 'DOCFLOW_POSTCOMMIT_VERIFY_FAILED') {
    return outcomeUnknownReceipt(invocation, 'verify', error.message)
  }
  if (error.dispatched && isWriteCommand(invocation.command) &&
    !['validation', 'read'].includes(error.stage)) {
    const stage = error.stage === 'publish'
      ? 'publish'
      : error.stage === 'verify'
        ? 'verify'
        : 'write'
    return outcomeUnknownReceipt(invocation, stage, error.message)
  }
  return failureReceipt(invocation, normalizeFailureCode(error.code), error.message)
}

function outcomeUnknownReceipt(
  invocation: DocflowCommandInvocation,
  stage: 'write' | 'publish' | 'verify',
  message: string
): DocflowNativeDocumentReceipt {
  return Object.freeze(docflowNativeDocumentOutcomeUnknownReceiptSchema.parse({
    protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
    invocationId: invocation.invocationId,
    command: invocation.command,
    attemptCount: 1,
    outcome: 'outcome_unknown',
    error: { code: 'outcome_unknown', stage, message, retry: 'never' }
  }))
}

function failureReceipt(
  invocation: DocflowCommandInvocation,
  code: z.infer<typeof docflowNativeDocumentFailureReceiptSchema>['error']['code'],
  message: string
): DocflowNativeDocumentReceipt {
  return Object.freeze(docflowNativeDocumentFailureReceiptSchema.parse({
    protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
    invocationId: invocation.invocationId,
    command: invocation.command,
    attemptCount: 1,
    outcome: 'failed',
    error: { code, message, retry: 'never' }
  }))
}

function invocationBaseHash(invocation: DocflowCommandInvocation): string | undefined {
  return 'baseHash' in invocation.args && typeof invocation.args.baseHash === 'string'
    ? invocation.args.baseHash
    : undefined
}

function normalizeFailureCode(
  code: string
): z.infer<typeof docflowNativeDocumentFailureReceiptSchema>['error']['code'] {
  if (/AUTH|PERMISSION|NOT_PERMISSION|FORBIDDEN/iu.test(code)) return 'unauthorized'
  if (/NOT_FOUND|TARGET_UNRESOLVED/iu.test(code)) return 'not_found'
  if (/UNSUPPORTED/iu.test(code)) return 'unsupported'
  if (/INVALID|PARAM/iu.test(code)) return 'invalid_input'
  if (/CANCEL/iu.test(code)) return 'cancelled'
  return 'provider_unavailable'
}

function boundedMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback
  return message.slice(0, 512)
}

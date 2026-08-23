import { z } from 'zod'
export const OPENCONTENT_EXTENDED_OPERATION_COMMANDS = Object.freeze([
  'file-search',
  'file-rag-scope',
  'file-info',
  'folder-info',
  'recent-files',
  'meta-types',
  'meta-attrs',
  'meta-info',
  'meta-edit',
  'rename',
  'copy',
  'move',
  'delete',
  'create-shortcut',
  'file-edit',
  'folder-edit',
  'sec-level-list',
  'upload',
  'attach-list',
  'attach-remove',
  'relation-list',
  'relation-create',
  'relation-remove',
  'file-tag-list',
  'file-tag-set',
  'file-tag-delete',
  'publish',
  'my-publish-list',
  'cancel-publish',
  'create-share',
  'my-share-list',
  'cancel-share',
  'albums',
  'album-files',
  'favorite-add',
  'favorite-remove',
  'perm-cates',
  'perm-list',
  'perm-set',
  'collab-list',
  'collab-search'
] as const)

const openContentExtendedOperationCommandSchema = z.enum(
  OPENCONTENT_EXTENDED_OPERATION_COMMANDS
)
export type OpenContentExtendedOperationCommand = z.infer<
  typeof openContentExtendedOperationCommandSchema
>

const invocationIdSchema = z.string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]+$/u)

const commandArgsSchema = z.record(z.string(), z.json())
const safeTransferNameSchema = z.string().trim().min(1).max(256)
  .refine((value) => value !== '.' && value !== '..' && !/[\\/]/u.test(value) &&
    [...value].every((character) => {
      const code = character.codePointAt(0) ?? 0
      return code > 31 && code !== 127
    }))
const transferReadSchema = z.custom<OpenContentExtendedUploadSource['read']>(
  (value) => typeof value === 'function',
  'A managed upload source requires a read function.'
)
const openContentExtendedDataFileSchema = z.object({
  role: z.literal('source'),
  encoding: z.literal('managed-stream'),
  name: safeTransferNameSchema,
  size: z.number().int().nonnegative().max(1_073_741_824),
  read: transferReadSchema
}).strict().readonly()
export type OpenContentExtendedDataFile = z.infer<typeof openContentExtendedDataFileSchema>

/** Only attachment upload accepts one runner-managed source. */
export const openContentExtendedCommandInvocationSchema = z.object({
  invocationId: invocationIdSchema,
  command: openContentExtendedOperationCommandSchema,
  args: commandArgsSchema,
  dataFiles: z.array(openContentExtendedDataFileSchema).max(1).readonly()
}).strict().superRefine((invocation, issue) => {
  const roles = invocation.dataFiles.map((file) => file.role)
  const needsSource = invocation.command === 'upload'
  const expected = needsSource ? ['source'] : []
  if (roles.length !== expected.length || roles.some((role, index) => role !== expected[index])) {
    issue.addIssue({
      code: 'custom',
      path: ['dataFiles'],
      message: `${invocation.command} requires data-file roles: ${expected.join(', ') || '(none)'}.`
    })
  }
}).readonly()

export type OpenContentExtendedCommandInvocation = z.infer<
  typeof openContentExtendedCommandInvocationSchema
>

export const OPENCONTENT_CLI_RESULT_PROTOCOL = 'opencontent-cli-result:v1' as const

const openContentSupplierBusinessCodeSchema = z.union([
  z.string().trim().min(1).max(128),
  z.number().int()
])

/** The one accepted supplier JSON envelope below the Connector receipt. */
const openContentExtendedSupplierResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    data: z.json()
  }).strict(),
  z.object({
    success: z.literal(false),
    code: openContentSupplierBusinessCodeSchema,
    error: z.string().trim().min(1).max(512)
  }).strict()
]).readonly()

/** The success receipt shared with the private CLI runner. */
export const openContentExtendedCommandSuccessSchema = z.object({
  protocol: z.literal(OPENCONTENT_CLI_RESULT_PROTOCOL),
  invocationId: invocationIdSchema,
  command: openContentExtendedOperationCommandSchema,
  attemptCount: z.literal(1),
  outcome: z.literal('succeeded'),
  json: openContentExtendedSupplierResponseSchema
}).strict().readonly()

export interface OpenContentExtendedCommandTransport {
  invoke(invocation: OpenContentExtendedCommandInvocation): Promise<unknown>
}
export type OpenContentExtendedUploadSource = Readonly<{
  name: string
  size: number
  sha256?: string
  read(input: Readonly<{ offset: number; length: number }>): Promise<Uint8Array>
}>

import { z } from 'zod'
import { executionIdSchema, planItemIdSchema, projectIdSchema, taskIdSchema, resourceRefIdSchema, revisionSchema, sha256Schema } from './core.js'
import { taskFileDestinationNameSchema, taskFileOutputIntentSchema, taskExecutionFileInputSchema, taskFileIntentSchema, taskExecutionFileIntentSchema } from './task-object-io.js'

const containsControlCharacter = (value: string): boolean => [...value].some((character) => {
  const codePoint = character.codePointAt(0)!
  return codePoint <= 0x1f || codePoint === 0x7f
})

const canonicalOpaqueSchema = (maximum: number) => z.string()
  .min(1)
  .max(maximum)
  .refine((value) => value === value.trim(), 'Opaque values must be canonical.')
  .refine((value) => !containsControlCharacter(value), 'Opaque values cannot contain control characters.')

const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength

const portableIdentitySchema = z.record(z.string(), z.json())
  .superRefine((identity, context) => {
    const serialized = JSON.stringify(identity)
    if (utf8Length(serialized) > 6_144) {
      context.addIssue({ code: 'custom', message: 'Portable identity exceeds the bounded locator size.' })
    }
  })

/**
 * Provider-neutral locator only. It is never interpreted as proof of authorization.
 * E/Host remains the sole owner of decoding and materialization.
 */
export const portableContentSpaceLocatorSchema = z.object({
  contractVersion: z.literal(1),
  kind: z.enum([
    'content-space.file-reference',
    'content-space.container-reference',
    'content-space.artifact-reference'
  ]),
  authority: canonicalOpaqueSchema(256).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/u),
  identity: portableIdentitySchema
}).strict().superRefine((locator, context) => {
  if (utf8Length(JSON.stringify(locator)) > 8_192) {
    context.addIssue({ code: 'custom', message: 'Portable locator exceeds 8192 bytes.' })
  }
})
export type PortableContentSpaceLocator = z.infer<typeof portableContentSpaceLocatorSchema>

/** Historical Provider inputs; never accepted by current Task write schemas. */
export const legacyTaskContentSpaceInputSchema = z.object({
  kind: z.literal('content-space.input-file'),
  locator: portableContentSpaceLocatorSchema.refine((locator) => locator.kind === 'content-space.file-reference', 'Historical Task input must identify a file.'),
  destinationName: taskFileDestinationNameSchema,
  expectedSemanticRevision: canonicalOpaqueSchema(256).nullable(),
  expectedMediaType: z.string().trim().min(1).max(256).nullable()
}).strict()
/** Exact old file facts remain decodable only for read-only history. */
export const legacyTaskFileOutputIntentSchema = taskFileOutputIntentSchema.omit({ kind: true }).extend({
  kind: z.literal('content-space.output-new'),
  target: z.literal('project-binding-root'),
  mode: z.literal('upload-new')
}).strict()
export const legacyTaskFileIntentSchema = z.object({
  schemaVersion: z.literal(1),
  inputs: z.array(legacyTaskContentSpaceInputSchema).max(100),
  output: legacyTaskFileOutputIntentSchema,
  bindingRevision: revisionSchema
}).strict()
export const taskFileIntentHistorySchema = z.union([taskFileIntentSchema, legacyTaskFileIntentSchema])
export type TaskFileIntentHistory = z.infer<typeof taskFileIntentHistorySchema>

export const legacyTaskExecutionFileIntentSchema = z.object({
  schemaVersion: z.literal(1), type: z.literal('task_execution_file_intent'),
  projectId: projectIdSchema, taskId: taskIdSchema, executionId: executionIdSchema,
  assignmentTaskRevision: revisionSchema, bindingRevision: revisionSchema, declarationDigest: sha256Schema,
  inputs: z.array(taskExecutionFileInputSchema).max(100),
  output: taskFileOutputIntentSchema.omit({ kind: true }).extend({ rootResourceRefId: resourceRefIdSchema }).strict()
}).strict()
export const taskExecutionFileIntentHistorySchema = z.union([taskExecutionFileIntentSchema, legacyTaskExecutionFileIntentSchema])
export type TaskExecutionFileIntentHistory = z.infer<typeof taskExecutionFileIntentHistorySchema>

export const legacyTaskFileDeclarationSchema = z.object({
  schemaVersion: z.literal(2), inputs: z.array(legacyTaskContentSpaceInputSchema).max(100),
  dependencyInputs: z.array(z.object({ planItemId: planItemIdSchema,
    outputIndex: z.number().int().min(0).max(99), destinationName: taskFileDestinationNameSchema }).strict()).max(100),
  output: legacyTaskFileOutputIntentSchema
}).strict()

/** Legacy Task result output facts; decodable only for read-only history. */
export const taskResultOutputSchema = z.object({
  executionId: executionIdSchema,
  assignmentTaskRevision: revisionSchema,
  locator: portableContentSpaceLocatorSchema,
  locatorDigest: sha256Schema,
  rootLocatorDigest: sha256Schema,
  bindingRevision: revisionSchema,
  transferReceiptDigest: sha256Schema,
  observationDigest: sha256Schema,
  preflightObservationDigest: sha256Schema
}).strict().superRefine((output, context) => {
  if (output.locator.kind !== 'content-space.file-reference' &&
      output.locator.kind !== 'content-space.artifact-reference') {
    context.addIssue({
      code: 'custom',
      path: ['locator', 'kind'],
      message: 'A Task result output must be an exact file or fixed artifact reference.'
    })
  }
})
export type TaskResultOutput = z.infer<typeof taskResultOutputSchema>

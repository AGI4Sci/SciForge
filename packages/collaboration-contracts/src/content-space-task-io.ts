import { z } from 'zod'

import {
  entityMetadataShape,
  executionIdSchema,
  projectIdSchema,
  resourceRefIdSchema,
  revisionSchema,
  sha256Schema,
  taskIdSchema,
  timestampSchema
} from './core.js'

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

export const taskFileDestinationNameSchema = z.string().trim().min(1).max(128)
  .refine((value) => value !== '.' && value !== '..', 'Destination names cannot be traversal segments.')
  .refine((value) => !value.includes('/') && !value.includes('\\') && !containsControlCharacter(value),
    'Destination names must be one safe path component.')

export const taskFileInputIntentSchema = z.object({
  kind: z.literal('content-space.input-file'),
  locator: portableContentSpaceLocatorSchema.refine(
    (locator) => locator.kind === 'content-space.file-reference',
    'Task inputs must be ContentSpace file locators.'
  ),
  destinationName: taskFileDestinationNameSchema,
  expectedSemanticRevision: canonicalOpaqueSchema(256).nullable(),
  expectedMediaType: z.string().trim().min(1).max(256).nullable()
}).strict()

export const taskFileOutputIntentSchema = z.object({
  kind: z.literal('content-space.output-new'),
  target: z.literal('project-binding-root'),
  mode: z.literal('upload-new'),
  fileName: taskFileDestinationNameSchema,
  mediaType: z.string().trim().min(1).max(256),
  maxBytes: z.number().int().min(1).max(1_073_741_824)
}).strict()

/** Coordinator declaration. Cloud binds it to the created Task execution later. */
export const taskFileIntentSchema = z.object({
  schemaVersion: z.literal(1),
  bindingRevision: revisionSchema,
  inputs: z.array(taskFileInputIntentSchema).max(100),
  output: taskFileOutputIntentSchema
}).strict().superRefine((intent, context) => {
  const destinations = intent.inputs.map((input) => input.destinationName)
  if (new Set(destinations).size !== destinations.length) {
    context.addIssue({ code: 'custom', path: ['inputs'], message: 'Task input destination names must be unique.' })
  }
  const locators = intent.inputs.map((input) => JSON.stringify(input.locator))
  if (new Set(locators).size !== locators.length) {
    context.addIssue({ code: 'custom', path: ['inputs'], message: 'Task input locators must be unique.' })
  }
})
export type TaskFileIntent = z.infer<typeof taskFileIntentSchema>

export const taskExecutionFileInputSchema = z.object({
  resourceRefId: resourceRefIdSchema,
  destinationName: taskFileDestinationNameSchema
}).strict()

export const taskExecutionFileOutputSchema = z.object({
  rootResourceRefId: resourceRefIdSchema,
  fileName: taskFileDestinationNameSchema,
  mediaType: z.string().trim().min(1).max(256),
  maxBytes: z.number().int().min(1).max(1_073_741_824)
}).strict()

/** Cloud-generated execution binding for one immutable Coordinator declaration. */
export const taskExecutionFileIntentSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('task_execution_file_intent'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  assignmentTaskRevision: revisionSchema,
  bindingRevision: revisionSchema,
  declarationDigest: sha256Schema,
  inputs: z.array(taskExecutionFileInputSchema).max(100),
  output: taskExecutionFileOutputSchema
}).strict().superRefine((intent, context) => {
  const references = [
    ...intent.inputs.map(({ resourceRefId }) => resourceRefId),
    intent.output.rootResourceRefId
  ]
  if (new Set(references).size !== references.length) {
    context.addIssue({
      code: 'custom',
      path: ['inputs'],
      message: 'Every execution-bound file role requires a distinct Cloud ResourceRef.'
    })
  }
  const destinations = intent.inputs.map(({ destinationName }) => destinationName)
  if (new Set(destinations).size !== destinations.length) {
    context.addIssue({
      code: 'custom',
      path: ['inputs'],
      message: 'Execution input destinations must be unique.'
    })
  }
})
export type TaskExecutionFileIntent = z.infer<typeof taskExecutionFileIntentSchema>

export const cloudResourceRefRoleSchema = z.enum(['input-file', 'output-container', 'output-file'])
export const cloudResourceRefStatusSchema = z.enum(['available', 'invalidated', 'revoked'])

export const cloudResourceRefSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('resource_ref'),
  resourceRefId: resourceRefIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  assignmentTaskRevision: revisionSchema,
  bindingRevision: revisionSchema,
  intentDigest: sha256Schema,
  role: cloudResourceRefRoleSchema,
  ordinal: z.number().int().min(0).max(100),
  locator: portableContentSpaceLocatorSchema,
  locatorDigest: sha256Schema,
  status: cloudResourceRefStatusSchema,
  invalidatedAt: timestampSchema.nullable()
}).strict().superRefine((resource, context) => {
  const expectedKind = resource.role === 'input-file'
    ? 'content-space.file-reference'
    : resource.role === 'output-container'
      ? 'content-space.container-reference'
      : 'content-space.file-reference'
  if (resource.locator.kind !== expectedKind) {
    context.addIssue({ code: 'custom', path: ['locator', 'kind'], message: 'Resource role and locator kind disagree.' })
  }
  if ((resource.status === 'available') !== (resource.invalidatedAt === null)) {
    context.addIssue({ code: 'custom', path: ['invalidatedAt'], message: 'Only unavailable ResourceRefs have an invalidation time.' })
  }
})
export type CloudResourceRef = z.infer<typeof cloudResourceRefSchema>

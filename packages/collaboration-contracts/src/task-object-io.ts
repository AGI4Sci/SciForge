import { z } from 'zod'
import { isPortableWorkspacePathSegment, portableWorkspacePathComparisonKey } from '@sciforge/domain-sdk/file-transfer-portability'
import { objectReferenceSchema } from './object-reference.js'
import { entityMetadataShape, executionIdSchema, planItemIdSchema, projectIdSchema, projectResultIdSchema,
  deliveryManifestIdSchema, materialRevisionIdSchema, resourceRefIdSchema, revisionSchema, sha256Schema,
  taskIdSchema, timestampSchema
} from './core.js'

export const taskFileDestinationNameSchema = z.string().trim().min(1).max(128)
  .regex(/^[\x20-\x7e]+$/u, 'Task file names must use portable printable ASCII.')
  .refine((value) => value !== '.' && value !== '..', 'Destination names cannot be traversal segments.')
  .refine(isPortableWorkspacePathSegment,
    'Destination names must be one portable path component.')

export function taskFileDestinationNamesAreUnique(destinationNames: readonly string[]): boolean {
  const comparisonKeys = destinationNames.map(portableWorkspacePathComparisonKey)
  return new Set(comparisonKeys).size === comparisonKeys.length
}

/** Exact Cloud object lineage; its transport VersionId stays in the object authority. */
export const collaborationObjectLocatorSchema = z.object({
  kind: z.literal('collaboration.object-reference'),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('shared_material'), materialRevisionId: materialRevisionIdSchema }).strict(),
    z.object({ kind: z.literal('adopted_delivery'), deliveryManifestId: deliveryManifestIdSchema }).strict(),
    z.object({ kind: z.literal('project_result'), projectResultId: projectResultIdSchema, deliveryManifestId: deliveryManifestIdSchema }).strict()
  ]),
  object: objectReferenceSchema
}).strict().superRefine((locator, context) => {
  if (locator.object.visibility !== 'project_public') {
    context.addIssue({ code: 'custom', path: ['object', 'visibility'], message: 'A Task input must resolve a published Project object.' })
  }
})
export type CollaborationObjectLocator = z.infer<typeof collaborationObjectLocatorSchema>

export const taskObjectInputIntentSchema = z.object({
  kind: z.literal('collaboration.object-input'),
  locator: collaborationObjectLocatorSchema,
  destinationName: taskFileDestinationNameSchema
}).strict()
export const taskFileInputIntentSchema = taskObjectInputIntentSchema
export type TaskFileInputIntent = z.infer<typeof taskFileInputIntentSchema>

export const taskFileOutputIntentSchema = z.object({
  kind: z.literal('delivery.output'),
  fileName: taskFileDestinationNameSchema,
  mediaType: z.string().trim().min(1).max(256),
  maxBytes: z.number().int().min(1).max(1_073_741_824)
}).strict()

export const taskFileDependencyInputSchema = z.object({
  planItemId: planItemIdSchema,
  outputIndex: z.literal(0),
  destinationName: taskFileDestinationNameSchema
}).strict()
export type TaskFileDependencyInput = z.infer<typeof taskFileDependencyInputSchema>

const taskFileDeclarationShape = {
  schemaVersion: z.literal(2),
  inputs: z.array(taskFileInputIntentSchema.refine((input) => input.locator.source.kind === 'shared_material', 'Static Task inputs must reference an exact Shared Material revision.')).max(100),
  dependencyInputs: z.array(taskFileDependencyInputSchema).max(100),
  output: taskFileOutputIntentSchema
} as const

function validateTaskFileInputs(
  declaration: Readonly<{
    inputs: readonly z.infer<typeof taskFileInputIntentSchema>[]
  }>,
  context: z.RefinementCtx
): void {
  const destinations = declaration.inputs.map((input) => input.destinationName)
  if (!taskFileDestinationNamesAreUnique(destinations)) {
    context.addIssue({ code: 'custom', path: ['inputs'], message: 'Task input destination names must be unique.' })
  }
  const locators = declaration.inputs.map((input) => JSON.stringify(input.locator))
  if (new Set(locators).size !== locators.length) {
    context.addIssue({ code: 'custom', path: ['inputs'], message: 'Task input locators must be unique.' })
  }
}

function validateTaskFileOutputName(
  destinationNames: readonly string[],
  outputFileName: string,
  context: z.RefinementCtx
): void {
  if (!taskFileDestinationNamesAreUnique([...destinationNames, outputFileName])) {
    context.addIssue({
      code: 'custom',
      path: ['output', 'fileName'],
      message: 'A Task output filename must be distinct from every input destination.'
    })
  }
}

/** Immutable logical file declaration stored in a confirmed Project Plan. */
export const taskFileDeclarationSchema = z.object(taskFileDeclarationShape)
  .strict()
  .superRefine((declaration, context) => {
    validateTaskFileInputs(declaration, context)
    if (declaration.inputs.length + declaration.dependencyInputs.length > 100) {
      context.addIssue({
        code: 'custom',
        path: ['dependencyInputs'],
        message: 'A Task file declaration may contain at most 100 total inputs.'
      })
    }
    const destinations = [
      ...declaration.inputs.map((input) => input.destinationName),
      ...declaration.dependencyInputs.map((input) => input.destinationName)
    ]
    if (!taskFileDestinationNamesAreUnique(destinations)) {
      context.addIssue({
        code: 'custom',
        path: ['dependencyInputs'],
        message: 'Static and dependency input destination names must be unique.'
      })
    }
    validateTaskFileOutputName(destinations, declaration.output.fileName, context)
    const selectors = declaration.dependencyInputs.map(
      ({ planItemId, outputIndex }) => `${planItemId}\u0000${outputIndex}`
    )
    if (new Set(selectors).size !== selectors.length) {
      context.addIssue({
        code: 'custom',
        path: ['dependencyInputs'],
        message: 'Dependency output selectors must be unique.'
      })
    }
  })
export type TaskFileDeclaration = z.infer<typeof taskFileDeclarationSchema>

/** Cloud-bound Task intent created from a Plan declaration at offer time. */
export const taskFileIntentSchema = z.object({
  schemaVersion: z.literal(1),
  inputs: z.array(taskFileInputIntentSchema).max(100),
  output: taskFileOutputIntentSchema
}).strict().superRefine((intent, context) => {
  validateTaskFileInputs(intent, context)
  validateTaskFileOutputName(
    intent.inputs.map(({ destinationName }) => destinationName),
    intent.output.fileName,
    context
  )
})
export type TaskFileIntent = z.infer<typeof taskFileIntentSchema>

export function bindTaskFileDeclaration(
  declaration: TaskFileDeclaration,
  dependencyInputs: readonly z.infer<typeof taskFileInputIntentSchema>[] = []
): TaskFileIntent {
  const canonicalDeclaration = taskFileDeclarationSchema.parse(declaration)
  if (
    dependencyInputs.length !== canonicalDeclaration.dependencyInputs.length ||
    dependencyInputs.some((input, index) => (
      input.locator.source.kind !== 'project_result' ||
      input.destinationName !== canonicalDeclaration.dependencyInputs[index]?.destinationName
    ))
  ) {
    throw new Error('Resolved dependency inputs must match the declared destination order.')
  }
  return taskFileIntentSchema.parse({
    schemaVersion: 1,
    inputs: [...canonicalDeclaration.inputs, ...dependencyInputs],
    output: canonicalDeclaration.output
  })
}

/** Converts an already concrete intent into a new declaration with only static inputs. */
export function taskFileDeclarationFromIntent(
  intent: TaskFileIntent
): TaskFileDeclaration {
  return taskFileDeclarationSchema.parse({
    schemaVersion: 2,
    inputs: intent.inputs,
    dependencyInputs: [],
    output: intent.output
  })
}

export const taskExecutionFileInputSchema = z.object({
  resourceRefId: resourceRefIdSchema,
  destinationName: taskFileDestinationNameSchema
}).strict()

export const taskExecutionFileOutputSchema = taskFileOutputIntentSchema

/** Cloud-generated execution binding for one immutable Coordinator declaration. */
export const taskExecutionFileIntentSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('task_execution_file_intent'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  assignmentTaskRevision: revisionSchema,
  declarationDigest: sha256Schema,
  inputs: z.array(taskExecutionFileInputSchema).max(100),
  output: taskExecutionFileOutputSchema
}).strict().superRefine((intent, context) => {
  const references = intent.inputs.map(({ resourceRefId }) => resourceRefId)
  if (new Set(references).size !== references.length) {
    context.addIssue({
      code: 'custom',
      path: ['inputs'],
      message: 'Every execution-bound file role requires a distinct Cloud ResourceRef.'
    })
  }
  const destinations = intent.inputs.map(({ destinationName }) => destinationName)
  if (!taskFileDestinationNamesAreUnique(destinations)) {
    context.addIssue({
      code: 'custom',
      path: ['inputs'],
      message: 'Execution input destinations must be unique.'
    })
  }
  validateTaskFileOutputName(destinations, intent.output.fileName, context)
})
export type TaskExecutionFileIntent = z.infer<typeof taskExecutionFileIntentSchema>

export const cloudResourceRefRoleSchema = z.literal('input-file')
export const cloudResourceRefStatusSchema = z.enum(['available', 'invalidated', 'revoked'])

export const cloudResourceRefSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('resource_ref'),
  resourceRefId: resourceRefIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  assignmentTaskRevision: revisionSchema,
  intentDigest: sha256Schema,
  role: cloudResourceRefRoleSchema,
  ordinal: z.number().int().min(0).max(100),
  locator: collaborationObjectLocatorSchema,
  locatorDigest: sha256Schema,
  status: cloudResourceRefStatusSchema,
  invalidatedAt: timestampSchema.nullable()
}).strict().superRefine((resource, context) => {
  if (resource.locator.object.projectId !== resource.projectId) {
    context.addIssue({ code: 'custom', path: ['locator', 'object', 'projectId'], message: 'A Cloud input must belong to the exact Project.' })
  }
  if ((resource.status === 'available') !== (resource.invalidatedAt === null)) {
    context.addIssue({ code: 'custom', path: ['invalidatedAt'], message: 'Only unavailable ResourceRefs have an invalidation time.' })
  }
})
export type CloudResourceRef = z.infer<typeof cloudResourceRefSchema>

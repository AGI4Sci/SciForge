import { z } from 'zod'
import {
  workspaceObservationSchema,
  workspacePreviewJsonValueSchema,
  workspaceStructuredSelectionSchema,
  type WorkspaceObservation,
  type WorkspaceStructuredSelection
} from './workspace-preview/contract'

export const SCIENTIFIC_OBJECT_SCHEMA_VERSION = 1
export const SCIENTIFIC_OBJECT_MAX_EXTRACT_DEPTH = 8
export const SCIENTIFIC_OBJECT_MAX_EXTRACT_NODES = 512
export const SCIENTIFIC_OBJECT_MAX_EXTRACT_ITEMS = 64
export const SCIENTIFIC_OBJECT_MAX_COMPARISON_ITEMS = 32
export const SCIENTIFIC_OBJECT_MAX_ANNOTATIONS = 1_000

const idSchema = z.string().trim().min(1).max(256)
const pathSchema = z.string().trim().min(1).max(4096)
const shortStringSchema = z.string().trim().min(1).max(256)
const timestampSchema = z.string().trim().min(1).max(128)

export const scientificObjectModalitySchema = z.enum([
  'molecular',
  'sequence',
  'spectra',
  'omics',
  'bioimaging'
])

export type ScientificObjectModality = z.infer<typeof scientificObjectModalitySchema>

export const scientificObjectSourceSchema = z.enum([
  'workspace',
  'attachment',
  'tool',
  'generated',
  'remote'
])

export type ScientificObjectSource = z.infer<typeof scientificObjectSourceSchema>

export const scientificObjectHashSchema = z.object({
  algorithm: z.literal('sha256'),
  digest: z.string().regex(/^[a-f0-9]{64}$/)
}).strict()

export type ScientificObjectHash = z.infer<typeof scientificObjectHashSchema>

export const scientificObjectPreviewSchema = z.object({
  kind: z.literal('image'),
  path: pathSchema,
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  alt: z.string().trim().max(1_000).optional(),
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
  hash: scientificObjectHashSchema.optional()
}).strict()

export type ScientificObjectPreview = z.infer<typeof scientificObjectPreviewSchema>

export const scientificObjectProvenanceSchema = z.object({
  sourceUri: z.string().trim().min(1).max(4_096).optional(),
  creator: shortStringSchema.optional(),
  toolName: shortStringSchema.optional(),
  toolVersion: shortStringSchema.optional(),
  toolCallId: idSchema.optional(),
  model: shortStringSchema.optional(),
  modelVersion: shortStringSchema.optional(),
  createdAt: timestampSchema.optional(),
  acquiredAt: timestampSchema.optional(),
  citations: z.array(z.string().trim().min(1).max(4_096)).max(64).optional(),
  metadata: z.record(z.string().trim().min(1).max(128), workspacePreviewJsonValueSchema).optional()
}).strict()

export type ScientificObjectProvenance = z.infer<typeof scientificObjectProvenanceSchema>

export const scientificObjectAnnotationTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('object'),
    objectId: idSchema
  }).strict(),
  z.object({
    kind: z.literal('selection'),
    objectId: idSchema,
    selection: workspaceStructuredSelectionSchema
  }).strict()
])

export type ScientificObjectAnnotationTarget = z.infer<typeof scientificObjectAnnotationTargetSchema>

export const scientificObjectAnnotationSchema = z.object({
  schemaVersion: z.literal(SCIENTIFIC_OBJECT_SCHEMA_VERSION),
  id: idSchema,
  target: scientificObjectAnnotationTargetSchema,
  kind: z.enum(['note', 'comment', 'highlight', 'question', 'answer']).default('note'),
  text: z.string().trim().min(1).max(80_000),
  authorId: idSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema.optional()
}).strict()

export type ScientificObjectAnnotation = z.infer<typeof scientificObjectAnnotationSchema>

export const scientificObjectRefSchema = z.object({
  schemaVersion: z.literal(SCIENTIFIC_OBJECT_SCHEMA_VERSION),
  id: idSchema,
  modality: scientificObjectModalitySchema,
  title: z.string().trim().min(1).max(512),
  source: scientificObjectSourceSchema,
  path: pathSchema,
  workspaceRoot: pathSchema,
  mimeType: z.string().trim().min(1).max(256),
  hash: scientificObjectHashSchema,
  sessionId: idSchema.optional(),
  selection: workspaceStructuredSelectionSchema.optional(),
  observation: workspaceObservationSchema.optional(),
  preview: scientificObjectPreviewSchema.optional(),
  provenance: scientificObjectProvenanceSchema.optional(),
  annotations: z.array(scientificObjectAnnotationSchema)
    .max(SCIENTIFIC_OBJECT_MAX_ANNOTATIONS)
    .optional()
}).strict().superRefine((object, context) => {
  if (object.observation && object.observation.file.path !== object.path) {
    context.addIssue({
      code: 'custom',
      path: ['observation', 'file', 'path'],
      message: 'Observation path must match the scientific object path.'
    })
  }
  if (
    object.observation?.file.workspaceRoot != null &&
    object.observation.file.workspaceRoot !== object.workspaceRoot
  ) {
    context.addIssue({
      code: 'custom',
      path: ['observation', 'file', 'workspaceRoot'],
      message: 'Observation workspaceRoot must match the scientific object workspaceRoot.'
    })
  }
  if (object.observation && object.observation.view.modality !== object.modality) {
    context.addIssue({
      code: 'custom',
      path: ['observation', 'view', 'modality'],
      message: 'Observation modality must match the scientific object modality.'
    })
  }
})

export type ScientificObjectRef = z.infer<typeof scientificObjectRefSchema>

export const scientificObjectComparisonSchema = z.object({
  schemaVersion: z.literal(SCIENTIFIC_OBJECT_SCHEMA_VERSION),
  id: idSchema,
  title: z.string().trim().min(1).max(512).optional(),
  objects: z.array(scientificObjectRefSchema)
    .min(2)
    .max(SCIENTIFIC_OBJECT_MAX_COMPARISON_ITEMS),
  annotations: z.array(scientificObjectAnnotationSchema)
    .max(SCIENTIFIC_OBJECT_MAX_ANNOTATIONS)
    .optional(),
  createdAt: timestampSchema.optional()
}).strict().superRefine((comparison, context) => {
  const identities = new Set<string>()
  for (const [index, object] of comparison.objects.entries()) {
    const identity = scientificObjectIdentityKey(object)
    if (identities.has(identity)) {
      context.addIssue({
        code: 'custom',
        path: ['objects', index],
        message: 'A comparison must contain at least two distinct scientific objects.'
      })
    }
    identities.add(identity)
  }
})

export type ScientificObjectComparison = z.infer<typeof scientificObjectComparisonSchema>

export type ExtractScientificObjectMetadataOptions = {
  maxDepth?: number
  maxNodes?: number
  maxItems?: number
}

export type ExtractedScientificObjectMetadata = {
  scientificObjects: ScientificObjectRef[]
  comparisons: ScientificObjectComparison[]
  workspaceObservations: WorkspaceObservation[]
}

const SCIENTIFIC_OBJECT_CONTAINER_KEYS = new Set(['scientificObjects', 'scientific_objects'])
const SCIENTIFIC_OBJECT_COMPARISON_CONTAINER_KEYS = new Set([
  'scientificObjectComparisons',
  'scientific_object_comparisons'
])
const WORKSPACE_OBSERVATION_CONTAINER_KEYS = new Set([
  'workspaceObservation',
  'workspaceObservations',
  'workspace_observation',
  'workspace_observations'
])

/**
 * Returns the stable, content-addressed identity used for deduplication and comparison.
 */
export function scientificObjectIdentityKey(object: ScientificObjectRef): string {
  return [
    object.hash.algorithm,
    object.hash.digest,
    object.workspaceRoot,
    object.path
  ].join('\u0000')
}

/**
 * Extracts only objects placed under explicit scientific-object/observation container keys.
 * Traversal is cycle-safe and bounded so arbitrary tool metadata cannot cause unbounded work.
 * Invalid containers or entries are skipped instead of throwing.
 */
export function extractScientificObjectMetadata(
  input: unknown,
  options: ExtractScientificObjectMetadataOptions = {}
): ExtractedScientificObjectMetadata {
  const maxDepth = boundedInteger(options.maxDepth, SCIENTIFIC_OBJECT_MAX_EXTRACT_DEPTH, 0, 32)
  const maxNodes = boundedInteger(options.maxNodes, SCIENTIFIC_OBJECT_MAX_EXTRACT_NODES, 1, 100_000)
  const maxItems = boundedInteger(options.maxItems, SCIENTIFIC_OBJECT_MAX_EXTRACT_ITEMS, 1, 10_000)
  const scientificObjects: ScientificObjectRef[] = []
  const comparisons: ScientificObjectComparison[] = []
  const workspaceObservations: WorkspaceObservation[] = []
  const objectKeys = new Set<string>()
  const comparisonKeys = new Set<string>()
  const observationKeys = new Set<string>()
  const visited = new WeakSet<object>()
  let visitedNodes = 0

  const addObservation = (candidate: unknown): void => {
    if (workspaceObservations.length >= maxItems) return
    const parsed = workspaceObservationSchema.safeParse(candidate)
    if (!parsed.success) return
    const key = workspaceObservationIdentityKey(parsed.data)
    if (observationKeys.has(key)) return
    observationKeys.add(key)
    workspaceObservations.push(parsed.data)
  }

  const addScientificObject = (candidate: unknown): void => {
    if (scientificObjects.length >= maxItems) return
    const parsed = scientificObjectRefSchema.safeParse(candidate)
    if (!parsed.success) return
    const key = scientificObjectIdentityKey(parsed.data)
    if (objectKeys.has(key)) return
    objectKeys.add(key)
    scientificObjects.push(parsed.data)
    if (parsed.data.observation) addObservation(parsed.data.observation)
  }

  const addComparison = (candidate: unknown): void => {
    if (comparisons.length >= maxItems) return
    const parsed = scientificObjectComparisonSchema.safeParse(candidate)
    if (!parsed.success || comparisonKeys.has(parsed.data.id)) return
    comparisonKeys.add(parsed.data.id)
    comparisons.push(parsed.data)
    for (const object of parsed.data.objects) addScientificObject(object)
  }

  const extractContainerItems = (value: unknown, add: (candidate: unknown) => void): void => {
    if (Array.isArray(value)) {
      const count = Math.min(value.length, maxItems)
      for (let index = 0; index < count; index += 1) add(safeArrayValue(value, index))
      return
    }
    add(value)
  }

  const visit = (value: unknown, depth: number): void => {
    if (depth > maxDepth || visitedNodes >= maxNodes || value == null || typeof value !== 'object') return
    if (visited.has(value)) return
    visited.add(value)
    visitedNodes += 1

    if (Array.isArray(value)) {
      const count = Math.min(value.length, maxNodes - visitedNodes)
      for (let index = 0; index < count; index += 1) visit(safeArrayValue(value, index), depth + 1)
      return
    }

    for (const key of safeObjectKeys(value)) {
      if (visitedNodes >= maxNodes) break
      const child = safeObjectValue(value, key)
      if (SCIENTIFIC_OBJECT_CONTAINER_KEYS.has(key)) {
        extractContainerItems(child, addScientificObject)
      } else if (SCIENTIFIC_OBJECT_COMPARISON_CONTAINER_KEYS.has(key)) {
        extractContainerItems(child, addComparison)
      } else if (WORKSPACE_OBSERVATION_CONTAINER_KEYS.has(key)) {
        extractContainerItems(child, addObservation)
      } else {
        visit(child, depth + 1)
      }
    }
  }

  try {
    visit(input, 0)
  } catch {
    // Hostile proxies/getters must not make metadata extraction fail the caller.
  }

  return { scientificObjects, comparisons, workspaceObservations }
}

export function extractScientificObjects(
  input: unknown,
  options?: ExtractScientificObjectMetadataOptions
): ScientificObjectRef[] {
  return extractScientificObjectMetadata(input, options).scientificObjects
}

export function extractWorkspaceObservations(
  input: unknown,
  options?: ExtractScientificObjectMetadataOptions
): WorkspaceObservation[] {
  return extractScientificObjectMetadata(input, options).workspaceObservations
}

export function extractScientificObjectComparisons(
  input: unknown,
  options?: ExtractScientificObjectMetadataOptions
): ScientificObjectComparison[] {
  return extractScientificObjectMetadata(input, options).comparisons
}

function workspaceObservationIdentityKey(observation: WorkspaceObservation): string {
  return [
    observation.file.workspaceRoot ?? '',
    observation.file.path,
    observation.view.pluginId,
    observation.view.modality
  ].join('\u0000')
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function safeObjectKeys(value: object): string[] {
  try {
    return Object.keys(value)
  } catch {
    return []
  }
}

function safeObjectValue(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

function safeArrayValue(value: unknown[], index: number): unknown {
  try {
    return value[index]
  } catch {
    return undefined
  }
}

// Re-exporting these makes downstream card and annotation code depend on one shared protocol module.
export type { WorkspaceObservation, WorkspaceStructuredSelection }

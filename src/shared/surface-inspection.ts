import { z } from 'zod'
import { capabilityJsonValueSchema } from './capability-broker'

export const SURFACE_RESOURCE_KIND = 'surface'

export const surfaceTargetRefSchema = z.string().regex(/^target_[A-Za-z0-9_-]{20,}$/u)

export const surfaceInspectInputSchema = z.object({
  targetRef: surfaceTargetRefSchema.optional(),
  task: z.string().trim().min(1).max(16_000),
  truthLocks: z.array(z.string().trim().min(1).max(4_000)).max(64).optional(),
  outputIntent: z.object({
    kind: z.enum(['description', 'ocr', 'comparison', 'quality-review', 'structured-extraction', 'custom']),
    instructions: z.string().trim().min(1).max(8_000).optional()
  }).strict().optional()
}).strict()

export type SurfaceInspectInput = z.infer<typeof surfaceInspectInputSchema>

export const surfaceTargetObservationSchema = z.object({
  targetRef: surfaceTargetRefSchema,
  kind: z.enum(['component', 'document-page', 'region', 'window']),
  contentType: z.string().trim().min(1).max(128).optional(),
  title: z.string().trim().min(1).max(256).optional(),
  page: z.number().int().positive().optional(),
  active: z.boolean().optional()
}).strict()

export const surfaceVisibleResourceSchema = z.object({
  kind: z.string().trim().min(1).max(128),
  role: z.string().trim().min(1).max(128).optional(),
  title: z.string().trim().min(1).max(512).optional(),
  component: z.string().trim().min(1).max(128).optional(),
  priority: z.number().finite().optional(),
  active: z.boolean().optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  resourceRef: z.string().regex(/^res_[A-Za-z0-9_-]{20,}$/u)
}).strict()

export const surfaceObservationStateSchema = z.object({
  route: z.string().trim().max(128).optional(),
  layoutFreshness: z.object({
    stale: z.boolean(),
    ageMs: z.number().finite().nonnegative(),
    staleAfterMs: z.number().finite().positive()
  }).strict(),
  targets: z.array(surfaceTargetObservationSchema).max(64),
  resources: z.array(surfaceVisibleResourceSchema).max(64)
}).strict()

export const surfaceInspectionArtifactSchema = z.object({
  artifactRef: z.string().regex(/^artifact_[A-Za-z0-9_-]{20,}$/u),
  mimeType: z.literal('image/png'),
  capturedAt: z.string().datetime({ offset: true }),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  targetRef: surfaceTargetRefSchema.optional()
}).strict()

export const surfaceInspectOutputSchema = z.object({
  artifact: surfaceInspectionArtifactSchema,
  evidence: capabilityJsonValueSchema
}).strict()

export type SurfaceInspectOutput = z.infer<typeof surfaceInspectOutputSchema>

const normalizedRegionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(512).optional(),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1)
}).strict().refine((region) => region.x + region.width <= 1 && region.y + region.height <= 1, {
  message: 'Normalized regions must remain inside the image.'
})

export const artifactInspectInputSchema = z.object({
  task: z.string().trim().min(1).max(16_000),
  artifacts: z.array(z.object({
    id: z.string().trim().min(1).max(128),
    path: z.string().trim().min(1).max(4_096),
    regions: z.array(normalizedRegionSchema).max(64).optional()
  }).strict()).min(1).max(8),
  truthLocks: z.array(z.string().trim().min(1).max(1_000)).max(64).optional(),
  outputIntent: z.object({
    kind: z.enum(['description', 'ocr', 'comparison', 'quality-review', 'structured-extraction', 'custom']),
    instructions: z.string().trim().min(1).max(4_000).optional()
  }).strict().optional()
}).strict().superRefine((input, context) => {
  const ids = new Set<string>()
  input.artifacts.forEach((artifact, index) => {
    if (ids.has(artifact.id)) {
      context.addIssue({ code: 'custom', path: ['artifacts', index, 'id'], message: 'Artifact ids must be unique.' })
    }
    ids.add(artifact.id)
  })
})

export type ArtifactInspectInput = z.infer<typeof artifactInspectInputSchema>

export const artifactInspectOutputSchema = z.object({
  artifacts: z.array(z.object({
    id: z.string().trim().min(1).max(128),
    artifactRef: z.string().regex(/^artifact_[A-Za-z0-9_-]{20,}$/u),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u)
  }).strict()).min(1).max(8),
  evidence: capabilityJsonValueSchema
}).strict()

export type ArtifactInspectOutput = z.infer<typeof artifactInspectOutputSchema>

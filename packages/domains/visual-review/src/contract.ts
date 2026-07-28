import { z } from 'zod'
import { domainPackageJsonValueSchema } from '@sciforge/domain-sdk/contract'

export * from './types.js'
import type {
  VisualDocument,
  VisualDocumentCreateCandidateResult,
  VisualDocumentExportReviewPacketResult,
  VisualDocumentOpenResult,
  VisualDocumentRevisionDecisionResult,
  VisualDocumentSaveAnnotationsResult,
  VisualDocumentUpdateContextResult
} from './types.js'

export const VISUAL_REVIEW_RESOURCE_KIND = 'visual-review-document'

export const VISUAL_REVIEW_CAPABILITY_IDS = Object.freeze({
  open: 'visual-review.open',
  readDocument: 'visual-review.read-document',
  readImage: 'visual-review.read-image',
  updateContext: 'visual-review.update-context',
  saveAnnotations: 'visual-review.save-annotations',
  exportReviewPacket: 'visual-review.export-review-packet',
  createCandidate: 'visual-review.create-candidate',
  acceptCandidate: 'visual-review.accept-candidate',
  rejectCandidate: 'visual-review.reject-candidate'
} as const)

export const VISUAL_REVIEW_COMMAND_ID = 'visual-review.open'
export const VISUAL_REVIEW_PANEL_CONTRIBUTION_ID = 'visual-review.workbench-right-panel'

const identifierSchema = z.string().trim().min(1).max(120)
const pathSchema = z.string().trim().min(1).max(4_096)
const reviewImagePathSchema = pathSchema.refine(
  (path) => /\.(?:avif|bmp|gif|jpe?g|png|webp)$/iu.test(path),
  'Visual Review supports bounded raster images only.'
)
const isoDateTimeSchema = z.string().datetime({ offset: true })
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const normalizedCoordinateSchema = z.number().finite().min(0).max(1)

export const visualReviewPointSchema = z.object({
  x: normalizedCoordinateSchema,
  y: normalizedCoordinateSchema
}).strict()

export const visualReviewBoundsSchema = visualReviewPointSchema.extend({
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1)
}).strict().refine(
  ({ x, y, width, height }) => x + width <= 1 && y + height <= 1,
  'Normalized bounds must remain inside the artifact.'
)

export const visualReviewAnnotationGeometrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('box'), bounds: visualReviewBoundsSchema }).strict(),
  z.object({ kind: z.literal('pin'), point: visualReviewPointSchema }).strict(),
  z.object({
    kind: z.literal('arrow'),
    from: visualReviewPointSchema,
    to: visualReviewPointSchema
  }).strict(),
  z.object({
    kind: z.literal('freehand'),
    points: z.array(visualReviewPointSchema).min(2).max(20_000)
  }).strict()
])

export const visualReviewArtifactKindSchema = z.enum([
  'image',
  'generated_image',
  'edited_image',
  'scientific_plot',
  'presentation_slide'
])

export const visualReviewArtifactActivationSchema = z.object({
  kind: visualReviewArtifactKindSchema,
  sourcePath: reviewImagePathSchema,
  manifestPath: pathSchema.optional(),
  title: z.string().trim().min(1).max(1_000).optional(),
  caption: z.string().trim().min(1).max(10_000).optional(),
  mimeType: z.string().trim().min(1).max(200).optional(),
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional()
}).strict()

/**
 * Bounded JSON payload accepted by the package-owned renderer command. The
 * command derives workspace and session ownership from its invocation context.
 */
export const visualReviewActivationSchema = z.object({
  documentId: identifierSchema,
  artifact: visualReviewArtifactActivationSchema.optional(),
  refreshKey: z.number().int().nonnegative().optional()
}).strict()
export type VisualReviewActivation = z.infer<typeof visualReviewActivationSchema>

export const visualReviewOpenInputSchema = z.object({
  documentId: identifierSchema,
  artifact: visualReviewArtifactActivationSchema.optional()
}).strict()

export const visualReviewReadImageInputSchema = z.object({
  path: reviewImagePathSchema
}).strict()

export const visualReviewReadImageOutputSchema = z.object({
  ok: z.literal(true),
  dataUrl: z.string().startsWith('data:').max(64 * 1024 * 1024)
}).strict()

export const visualReviewSaveAnnotationsInputSchema = z.object({
  documentId: identifierSchema,
  annotations: z.array(z.object({
    id: identifierSchema.optional(),
    geometry: visualReviewAnnotationGeometrySchema,
    instruction: z.string().trim().min(1).max(20_000),
    targetNodeIds: z.array(identifierSchema).max(10_000).optional(),
    status: z.enum(['open', 'resolved']).optional()
  }).strict()).max(10_000)
}).strict()

export const visualReviewUpdateContextInputSchema = z.object({
  documentId: identifierSchema,
  styleProfileRef: pathSchema.nullable().optional(),
  truthLocks: z.array(z.object({
    id: identifierSchema,
    description: z.string().trim().min(1).max(20_000),
    nodeIds: z.array(identifierSchema).max(10_000),
    sourceRef: z.string().trim().min(1).max(4_096).optional()
  }).strict()).max(10_000).optional(),
  nodes: z.array(z.object({
    id: identifierSchema,
    kind: z.enum([
      'generated_asset',
      'scientific_plot',
      'text',
      'shape',
      'connector',
      'group'
    ]),
    bounds: visualReviewBoundsSchema,
    semanticRef: z.string().trim().min(1).max(4_096).optional(),
    sourceSpecRef: pathSchema.optional(),
    assetPath: pathSchema.optional(),
    maskPath: pathSchema.optional(),
    parentId: identifierSchema.optional(),
    childIds: z.array(identifierSchema).max(10_000).optional(),
    style: z.record(z.string(), domainPackageJsonValueSchema).optional(),
    editable: z.boolean(),
    truthLocked: z.boolean()
  }).strict()).max(10_000).optional()
}).strict()

export const visualReviewDocumentInputSchema = z.object({
  documentId: identifierSchema
}).strict()

const reviewEvidenceSchema = z.object({
  tool: z.literal('image_generation_review_candidate'),
  ok: z.literal(true),
  reviewedArtifactPath: pathSchema,
  reviewedArtifactHash: sha256Schema,
  reviewedAt: isoDateTimeSchema,
  score: z.object({
    overall: z.number().finite().min(0).max(1),
    dimensions: z.number().finite().min(0).max(1),
    nonEmpty: z.number().finite().min(0).max(1),
    background: z.number().finite().min(0).max(1),
    reference: z.number().finite().min(0).max(1).optional(),
    semantic: z.number().finite().min(0).max(1),
    warnings: z.array(z.string().max(10_000)).max(1_000)
  }).strict(),
  semantic: z.object({
    pass: z.literal(true),
    summary: z.string().max(20_000),
    violations: z.array(z.string().max(10_000)).max(1_000),
    repairInstructions: z.array(z.string().max(10_000)).max(1_000)
  }).strict(),
  repairable: z.literal(false),
  warnings: z.array(z.string().max(10_000)).max(1_000)
}).strict()

export const visualReviewCreateCandidateInputSchema = z.object({
  documentId: identifierSchema,
  candidatePath: reviewImagePathSchema,
  summary: z.string().trim().min(1).max(20_000),
  reviewEvidence: reviewEvidenceSchema,
  expectedBaseHash: sha256Schema.optional(),
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional()
}).strict()

export const visualReviewRevisionDecisionInputSchema = z.object({
  documentId: identifierSchema,
  revisionId: identifierSchema
}).strict()

const visualReviewAnnotationSchema = z.object({
  id: identifierSchema,
  kind: z.enum(['box', 'arrow', 'freehand', 'pin']),
  geometry: visualReviewAnnotationGeometrySchema,
  instruction: z.string().min(1).max(20_000),
  targetNodeIds: z.array(identifierSchema).max(10_000),
  status: z.enum(['open', 'resolved']),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict()

const visualReviewTruthLockSchema = z.object({
  id: identifierSchema,
  description: z.string().min(1).max(20_000),
  nodeIds: z.array(identifierSchema).max(10_000),
  sourceRef: z.string().min(1).max(4_096).optional()
}).strict()

const visualReviewNodeSchema = visualReviewUpdateContextInputSchema.shape.nodes
  .unwrap()
  .element

const visualReviewArtifactSchema = z.object({
  id: identifierSchema,
  kind: visualReviewArtifactKindSchema,
  sourcePath: pathSchema,
  sourceHash: sha256Schema,
  workingCopyPath: pathSchema,
  workingCopyHash: sha256Schema,
  mimeType: z.string().min(1).max(200).optional(),
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
  manifestPath: pathSchema.optional(),
  title: z.string().min(1).max(1_000).optional(),
  caption: z.string().min(1).max(10_000).optional()
}).strict()

const visualReviewRevisionSchema = z.object({
  id: identifierSchema,
  status: z.enum(['candidate', 'accepted', 'rejected']),
  basedOnHash: sha256Schema,
  artifactPath: pathSchema,
  artifactHash: sha256Schema,
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
  summary: z.string().min(1).max(20_000),
  reviewEvidence: reviewEvidenceSchema,
  createdAt: isoDateTimeSchema,
  decidedAt: isoDateTimeSchema.optional(),
  backupPath: pathSchema.optional()
}).strict()

export const visualReviewDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  documentId: identifierSchema,
  canvas: z.object({
    width: z.number().finite().positive().max(100_000),
    height: z.number().finite().positive().max(100_000),
    background: z.string().min(1).max(512)
  }).strict(),
  artifact: visualReviewArtifactSchema.nullable(),
  nodes: z.array(visualReviewNodeSchema).max(10_000),
  annotations: z.array(visualReviewAnnotationSchema).max(10_000),
  truthLocks: z.array(visualReviewTruthLockSchema).max(10_000),
  styleProfileRef: pathSchema.nullable(),
  revisions: z.array(visualReviewRevisionSchema).max(10_000),
  activeCandidateRevisionId: identifierSchema.nullable(),
  acceptedRevisionId: identifierSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict()

const visualReviewDocumentPathsSchema = z.object({
  documentDir: pathSchema,
  documentPath: pathSchema,
  assetsDir: pathSchema,
  revisionsDir: pathSchema,
  backupsDir: pathSchema,
  reviewPacketsDir: pathSchema
}).strict()

const visualReviewPacketSchema = z.object({
  schemaVersion: z.literal(1),
  packetId: identifierSchema,
  documentId: identifierSchema,
  createdAt: isoDateTimeSchema,
  sourceArtifact: visualReviewArtifactSchema,
  annotations: z.array(visualReviewAnnotationSchema).max(10_000),
  truthLocks: z.array(visualReviewTruthLockSchema).max(10_000),
  styleProfileRef: pathSchema.nullable(),
  revisionContext: z.object({
    acceptedRevisionId: identifierSchema.nullable(),
    activeCandidateRevisionId: identifierSchema.nullable(),
    selectedRegions: z.array(visualReviewAnnotationGeometrySchema).max(10_000),
    selectedNodeIds: z.array(identifierSchema).max(10_000),
    preserve: z.array(z.string().max(20_000)).max(10_000)
  }).strict()
}).strict()

export const visualReviewOpenOutputSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['created', 'opened']),
  workspaceRoot: pathSchema,
  document: visualReviewDocumentSchema,
  paths: visualReviewDocumentPathsSchema
}).strict()

export const visualReviewSaveAnnotationsOutputSchema = z.object({
  ok: z.literal(true),
  status: z.literal('saved'),
  annotations: z.array(visualReviewAnnotationSchema).max(10_000),
  document: visualReviewDocumentSchema
}).strict()

export const visualReviewUpdateContextOutputSchema = z.object({
  ok: z.literal(true),
  status: z.literal('updated'),
  document: visualReviewDocumentSchema
}).strict()

export const visualReviewExportReviewPacketOutputSchema = z.object({
  ok: z.literal(true),
  status: z.literal('exported'),
  packet: visualReviewPacketSchema,
  packetPath: pathSchema
}).strict()

export const visualReviewCreateCandidateOutputSchema = z.object({
  ok: z.literal(true),
  status: z.literal('candidate_created'),
  revision: visualReviewRevisionSchema,
  document: visualReviewDocumentSchema
}).strict()

export const visualReviewRevisionDecisionOutputSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['accepted', 'rejected']),
  revision: visualReviewRevisionSchema,
  document: visualReviewDocumentSchema
}).strict()

export type VisualReviewOpenInput = z.infer<typeof visualReviewOpenInputSchema>
export type VisualReviewReadImageInput = z.infer<typeof visualReviewReadImageInputSchema>
export type VisualReviewSaveAnnotationsInput = z.infer<typeof visualReviewSaveAnnotationsInputSchema>
export type VisualReviewUpdateContextInput = z.infer<typeof visualReviewUpdateContextInputSchema>
export type VisualReviewDocumentInput = z.infer<typeof visualReviewDocumentInputSchema>
export type VisualReviewCreateCandidateInput = z.infer<typeof visualReviewCreateCandidateInputSchema>
export type VisualReviewRevisionDecisionInput =
  z.infer<typeof visualReviewRevisionDecisionInputSchema>

export type VisualReviewCapabilityOutput =
  | VisualDocument
  | VisualDocumentOpenResult
  | VisualDocumentSaveAnnotationsResult
  | VisualDocumentUpdateContextResult
  | VisualDocumentExportReviewPacketResult
  | VisualDocumentCreateCandidateResult
  | VisualDocumentRevisionDecisionResult

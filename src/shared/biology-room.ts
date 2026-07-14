import { z } from 'zod'

export const BIOLOGY_ROOM_SCHEMA_VERSION = 1
export const BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES = 25 * 1024 * 1024
export const BIOLOGY_ROOM_MAX_TOTAL_ASSET_BYTES = 100 * 1024 * 1024
export const BIOLOGY_ROOM_MAX_ASSETS = 128
export const BIOLOGY_ROOM_MAX_ANNOTATIONS = 2_000
export const BIOLOGY_ROOM_MAX_CONTIGS_PER_ASSET = 10_000
export const BIOLOGY_ROOM_DEFAULT_OBSERVE_ASSET_LIMIT = 32
export const BIOLOGY_ROOM_DEFAULT_OBSERVE_ANNOTATION_LIMIT = 50
export const BIOLOGY_ROOM_DEFAULT_OBSERVE_CONTIG_LIMIT = 50

export const BIOLOGY_ROOM_SUPPORTED_EXTENSIONS = [
  '.fa',
  '.fasta',
  '.fna',
  '.faa',
  '.gb',
  '.gbk',
  '.pdb',
  '.cif',
  '.mmcif',
  '.gff',
  '.gff3',
  '.bed',
  '.vcf',
  '.fa.gz',
  '.fasta.gz',
  '.fna.gz',
  '.faa.gz',
  '.gff.gz',
  '.gff3.gz',
  '.bed.gz',
  '.vcf.gz'
] as const

export const biologyRoomFormatSchema = z.enum([
  'fasta',
  'genbank',
  'pdb',
  'mmcif',
  'gff3',
  'bed',
  'vcf'
])

export type BiologyRoomFormat = z.infer<typeof biologyRoomFormatSchema>

export const biologyRoomAssetModalitySchema = z.enum([
  'sequence',
  'structure',
  'genome-reference',
  'genome-feature',
  'genome-variant'
])

export type BiologyRoomAssetModality = z.infer<typeof biologyRoomAssetModalitySchema>

export const biologyRoomIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Biology Room IDs may only contain letters, numbers, dots, underscores, and hyphens.')
  .refine((value) => value !== '.' && value !== '..', 'Biology Room ID is invalid.')

export const biologyRoomEntityIdSchema = z.string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Biology Room entity ID contains unsupported characters.')

/**
 * Normalize a user-facing path into the portable, workspace-relative form used
 * by room manifests. This intentionally rejects absolute and parent-relative
 * paths rather than silently rebasing them.
 */
export function normalizeBiologyRoomRelativePath(raw: string): string {
  const value = raw.trim().replaceAll('\\', '/')
  if (!value || value.includes('\0')) throw new Error('Biology Room path is required.')
  if (value.startsWith('/') || /^[A-Za-z]:\//.test(value) || value.startsWith('//')) {
    throw new Error('Biology Room paths must be workspace-relative.')
  }
  const segments = value.split('/').filter((segment) => segment.length > 0 && segment !== '.')
  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    throw new Error('Biology Room paths must stay within the workspace.')
  }
  return segments.join('/')
}

export const biologyRoomRelativePathSchema = z.string().trim().min(1).max(4_096)
  .transform((value, context) => {
    try {
      return normalizeBiologyRoomRelativePath(value)
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : String(error)
      })
      return z.NEVER
    }
  })

export type BiologyRoomRelativePath = z.infer<typeof biologyRoomRelativePathSchema>

export function biologyRoomFormatFromPath(path: string): BiologyRoomFormat | null {
  const lower = path.trim().toLowerCase().replaceAll('\\', '/')
  const uncompressed = lower.endsWith('.gz') ? lower.slice(0, -3) : lower
  if (/\.(?:fa|fasta|fna|faa)$/.test(uncompressed)) return 'fasta'
  if (/\.(?:gb|gbk)$/.test(uncompressed)) return 'genbank'
  if (uncompressed.endsWith('.pdb')) return 'pdb'
  if (/\.(?:cif|mmcif)$/.test(uncompressed)) return 'mmcif'
  if (/\.(?:gff|gff3)$/.test(uncompressed)) return 'gff3'
  if (uncompressed.endsWith('.bed')) return 'bed'
  if (uncompressed.endsWith('.vcf')) return 'vcf'
  return null
}

export function biologyRoomModalityForFormat(
  format: BiologyRoomFormat,
  options: { asReference?: boolean } = {}
): BiologyRoomAssetModality {
  if (format === 'fasta') return options.asReference ? 'genome-reference' : 'sequence'
  if (format === 'genbank') return 'sequence'
  if (format === 'pdb' || format === 'mmcif') return 'structure'
  if (format === 'vcf') return 'genome-variant'
  return 'genome-feature'
}

const nonNegativeIntegerSchema = z.number().int().nonnegative()
const finiteNumberSchema = z.number().finite()
const isoDateTimeSchema = z.string().datetime({ offset: true })
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const biologyContigSchema = z.object({
  name: z.string().trim().min(1).max(1_024),
  length: nonNegativeIntegerSchema.optional()
}).strict()

export type BiologyContig = z.infer<typeof biologyContigSchema>

export const biologyRoomAssetReadinessSchema = z.enum(['ready', 'missing', 'error'])

export const biologyRoomIndexFingerprintSchema = z.object({
  path: biologyRoomRelativePathSchema,
  sha256: sha256Schema,
  sizeBytes: nonNegativeIntegerSchema,
  mtimeMs: finiteNumberSchema.nonnegative()
}).strict()

export type BiologyRoomAssetReadiness = z.infer<typeof biologyRoomAssetReadinessSchema>
export type BiologyRoomIndexFingerprint = z.infer<typeof biologyRoomIndexFingerprintSchema>

export const biologyRoomTrackReferenceCompatibilitySchema = z.object({
  status: z.enum(['compatible', 'partial', 'incompatible', 'unverified']),
  referenceAssetId: biologyRoomEntityIdSchema.optional(),
  trackSha256: sha256Schema,
  referenceSha256: sha256Schema.optional(),
  trackContigCount: nonNegativeIntegerSchema.optional(),
  referenceContigCount: nonNegativeIntegerSchema.optional(),
  matchedContigCount: nonNegativeIntegerSchema.optional(),
  unmatchedContigCount: nonNegativeIntegerSchema.optional(),
  unmatchedExamples: z.array(z.string().trim().min(1).max(1_024)).max(5).default([]),
  reason: z.string().trim().min(1).max(2_000).optional(),
  checkedAt: isoDateTimeSchema
}).strict()

export type BiologyRoomTrackReferenceCompatibility = z.infer<
  typeof biologyRoomTrackReferenceCompatibilitySchema
>

export const biologyRoomAssetInputSchema = z.object({
  id: biologyRoomEntityIdSchema.optional(),
  path: biologyRoomRelativePathSchema,
  format: biologyRoomFormatSchema.optional(),
  asReference: z.boolean().optional(),
  indexPaths: z.array(biologyRoomRelativePathSchema).max(4).default([]),
  referenceAssetId: biologyRoomEntityIdSchema.optional()
}).strict()

export type BiologyRoomAssetInput = z.infer<typeof biologyRoomAssetInputSchema>

export const biologyRoomAssetSchema = z.object({
  id: biologyRoomEntityIdSchema,
  path: biologyRoomRelativePathSchema,
  format: biologyRoomFormatSchema,
  modality: biologyRoomAssetModalitySchema,
  sha256: sha256Schema,
  sizeBytes: nonNegativeIntegerSchema,
  mtimeMs: finiteNumberSchema.nonnegative(),
  indexPaths: z.array(biologyRoomRelativePathSchema).max(4).default([]),
  indexFingerprints: z.array(biologyRoomIndexFingerprintSchema).max(4).optional(),
  readiness: biologyRoomAssetReadinessSchema.optional(),
  readinessError: z.string().trim().min(1).max(2_000).optional(),
  referenceAssetId: biologyRoomEntityIdSchema.optional(),
  referenceCompatibility: biologyRoomTrackReferenceCompatibilitySchema.optional(),
  contigs: z.array(biologyContigSchema).max(BIOLOGY_ROOM_MAX_CONTIGS_PER_ASSET).optional(),
  contigsTruncated: z.boolean().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict()

export type BiologyRoomAsset = z.infer<typeof biologyRoomAssetSchema>

export const biologySequenceRangeSchema = z.object({
  start: nonNegativeIntegerSchema,
  end: nonNegativeIntegerSchema,
  strand: z.enum(['+', '-']).optional()
}).strict().refine((range) => range.end > range.start, {
  message: 'Selection end must be greater than start.',
  path: ['end']
})

export const biologyMolecularLocatorSchema = z.object({
  modelId: z.union([z.string().trim().min(1).max(256), nonNegativeIntegerSchema]).optional(),
  chainId: z.string().trim().min(1).max(128).optional(),
  residueNumber: z.number().int().optional(),
  insertionCode: z.string().trim().max(16).optional(),
  residueName: z.string().trim().max(64).optional(),
  atomName: z.string().trim().max(64).optional(),
  atomId: z.union([z.string().trim().min(1).max(256), nonNegativeIntegerSchema]).optional()
}).strict().refine(
  (locator) => locator.modelId !== undefined || locator.chainId !== undefined ||
    locator.residueNumber !== undefined || locator.atomName !== undefined || locator.atomId !== undefined,
  'A molecular locator must identify at least a model, chain, residue, or atom.'
)

export const biologyRoomSelectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sequence'),
    assetId: biologyRoomEntityIdSchema,
    sequenceId: z.string().trim().min(1).max(1_024).optional(),
    ranges: z.array(biologySequenceRangeSchema).min(1).max(1_000),
    featureIds: z.array(z.string().trim().min(1).max(1_024)).max(1_000).optional()
  }).strict(),
  z.object({
    kind: z.literal('genomic'),
    assetId: biologyRoomEntityIdSchema,
    referenceAssetId: biologyRoomEntityIdSchema,
    refName: z.string().trim().min(1).max(1_024),
    start: nonNegativeIntegerSchema,
    end: nonNegativeIntegerSchema,
    strand: z.enum(['+', '-']).optional(),
    featureId: z.string().trim().min(1).max(1_024).optional(),
    variantId: z.string().trim().min(1).max(1_024).optional()
  }).strict().refine((selection) => selection.end > selection.start, {
    message: 'Selection end must be greater than start.',
    path: ['end']
  }),
  z.object({
    kind: z.literal('molecular'),
    assetId: biologyRoomEntityIdSchema,
    locators: z.array(biologyMolecularLocatorSchema).min(1).max(10_000)
  }).strict()
])

export type BiologyRoomSelection = z.infer<typeof biologyRoomSelectionSchema>

export const biologyRoomActorSchema = z.object({
  kind: z.enum(['user', 'agent', 'system']),
  id: z.string().trim().min(1).max(256).optional(),
  taskId: z.string().trim().min(1).max(256).optional(),
  turnId: z.string().trim().min(1).max(256).optional()
}).strict()

export type BiologyRoomActor = z.infer<typeof biologyRoomActorSchema>

export const biologyAnnotationSchema = z.object({
  id: biologyRoomEntityIdSchema,
  anchor: biologyRoomSelectionSchema,
  body: z.string().trim().min(1).max(20_000),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  actor: biologyRoomActorSchema,
  orphaned: z.boolean().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict()

export type BiologyAnnotation = z.infer<typeof biologyAnnotationSchema>

export const biologySequenceViewStateSchema = z.object({
  assetId: biologyRoomEntityIdSchema,
  sequenceId: z.string().trim().min(1).max(1_024).optional(),
  mode: z.enum(['linear', 'circular']).default('linear'),
  zoom: finiteNumberSchema.positive().optional(),
  showTranslations: z.boolean().default(false)
}).strict()

export const biologyGenomeViewStateSchema = z.object({
  referenceAssetId: biologyRoomEntityIdSchema,
  refName: z.string().trim().min(1).max(1_024).optional(),
  start: nonNegativeIntegerSchema.optional(),
  end: nonNegativeIntegerSchema.optional(),
  bpPerPx: finiteNumberSchema.positive().optional(),
  trackVisibility: z.record(biologyRoomEntityIdSchema, z.boolean()).default({})
}).strict().refine(
  (state) => state.start === undefined || state.end === undefined || state.end > state.start,
  { message: 'Viewport end must be greater than start.', path: ['end'] }
)

const vector3Schema = z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema])

export const biologyMolecularCameraSchema = z.object({
  position: vector3Schema,
  target: vector3Schema,
  up: vector3Schema
}).strict()

export const biologyMolecularViewStateSchema = z.object({
  assetId: biologyRoomEntityIdSchema,
  representation: z.enum(['cartoon', 'ball-and-stick', 'surface', 'spacefill', 'line']).default('cartoon'),
  colorScheme: z.enum(['chain', 'element', 'residue', 'uniform']).default('chain'),
  uniformColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  camera: biologyMolecularCameraSchema.optional()
}).strict().refine(
  (state) => state.colorScheme !== 'uniform' || state.uniformColor !== undefined,
  { message: 'A uniform molecular color requires uniformColor.', path: ['uniformColor'] }
)

export const biologyRoomViewerStateSchema = z.object({
  sequence: biologySequenceViewStateSchema.optional(),
  genome: biologyGenomeViewStateSchema.optional(),
  molecular: biologyMolecularViewStateSchema.optional()
}).strict()

export type BiologySequenceViewState = z.infer<typeof biologySequenceViewStateSchema>
export type BiologyGenomeViewState = z.infer<typeof biologyGenomeViewStateSchema>
export type BiologyMolecularViewState = z.infer<typeof biologyMolecularViewStateSchema>
export type BiologyRoomViewerState = z.infer<typeof biologyRoomViewerStateSchema>

export const biologyRoomManifestSchema = z.object({
  schemaVersion: z.literal(BIOLOGY_ROOM_SCHEMA_VERSION),
  roomId: biologyRoomIdSchema,
  title: z.string().trim().min(1).max(300),
  revision: z.number().int().positive(),
  assets: z.array(biologyRoomAssetSchema).max(BIOLOGY_ROOM_MAX_ASSETS),
  activeAssetId: biologyRoomEntityIdSchema.optional(),
  selection: biologyRoomSelectionSchema.optional(),
  viewerStates: biologyRoomViewerStateSchema,
  annotations: z.array(biologyAnnotationSchema).max(BIOLOGY_ROOM_MAX_ANNOTATIONS),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict()

export type BiologyRoomManifest = z.infer<typeof biologyRoomManifestSchema>

export const biologyRoomOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create'),
    title: z.string().trim().min(1).max(300),
    assets: z.array(biologyRoomAssetInputSchema).max(BIOLOGY_ROOM_MAX_ASSETS).optional()
  }).strict(),
  z.object({ type: z.literal('addAsset'), asset: biologyRoomAssetInputSchema }).strict(),
  z.object({
    type: z.literal('removeAsset'),
    assetId: biologyRoomEntityIdSchema,
    cascade: z.boolean().optional()
  }).strict(),
  z.object({
    type: z.literal('setActiveAsset'),
    assetId: biologyRoomEntityIdSchema.nullable()
  }).strict(),
  z.object({
    type: z.literal('setSelection'),
    selection: biologyRoomSelectionSchema.nullable()
  }).strict(),
  z.object({
    type: z.literal('setViewport'),
    viewport: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('sequence'), state: biologySequenceViewStateSchema }).strict(),
      z.object({ kind: z.literal('genome'), state: biologyGenomeViewStateSchema }).strict()
    ])
  }).strict(),
  z.object({
    type: z.literal('setTrackVisibility'),
    trackAssetId: biologyRoomEntityIdSchema,
    visible: z.boolean()
  }).strict(),
  z.object({
    type: z.literal('setMolecularView'),
    state: biologyMolecularViewStateSchema
  }).strict(),
  z.object({
    type: z.literal('upsertAnnotation'),
    annotation: biologyAnnotationSchema
  }).strict(),
  z.object({
    type: z.literal('deleteAnnotation'),
    annotationId: biologyRoomEntityIdSchema
  }).strict(),
  z.object({
    type: z.literal('restoreRevision'),
    revision: z.number().int().positive()
  }).strict(),
  z.object({
    type: z.literal('refreshAssets'),
    assetIds: z.array(biologyRoomEntityIdSchema).max(BIOLOGY_ROOM_MAX_ASSETS),
    orphanedAnnotationIds: z.array(biologyRoomEntityIdSchema).max(BIOLOGY_ROOM_MAX_ANNOTATIONS)
  }).strict(),
  z.object({
    type: z.literal('setTrackReference'),
    trackAssetId: biologyRoomEntityIdSchema,
    referenceAssetId: biologyRoomEntityIdSchema
  }).strict()
])

export type BiologyRoomOperation = z.infer<typeof biologyRoomOperationSchema>

export const biologyRoomMutationOperationSchema = z.union([
  biologyRoomOperationSchema.options[1],
  biologyRoomOperationSchema.options[2],
  biologyRoomOperationSchema.options[3],
  biologyRoomOperationSchema.options[4],
  biologyRoomOperationSchema.options[5],
  biologyRoomOperationSchema.options[6],
  biologyRoomOperationSchema.options[7],
  biologyRoomOperationSchema.options[8],
  biologyRoomOperationSchema.options[9],
  biologyRoomOperationSchema.options[10],
  biologyRoomOperationSchema.options[12]
])

export type BiologyRoomMutationOperation = z.infer<typeof biologyRoomMutationOperationSchema>

export const biologyRoomCreateInputSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096),
  roomId: biologyRoomIdSchema.optional(),
  title: z.string().trim().min(1).max(300),
  assets: z.array(biologyRoomAssetInputSchema).max(BIOLOGY_ROOM_MAX_ASSETS).default([]),
  actor: biologyRoomActorSchema.optional()
}).strict()

export const biologyRoomOpenOrCreateInputSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096),
  path: biologyRoomRelativePathSchema,
  title: z.string().trim().min(1).max(300).optional(),
  format: biologyRoomFormatSchema.optional(),
  asReference: z.boolean().optional(),
  indexPaths: z.array(biologyRoomRelativePathSchema).max(4).default([]),
  referenceAssetId: biologyRoomEntityIdSchema.optional(),
  actor: biologyRoomActorSchema.optional()
}).strict()

export const biologyRoomTargetSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096),
  roomId: biologyRoomIdSchema
}).strict()

export const biologyRoomApplyInputSchema = biologyRoomTargetSchema.extend({
  baseRevision: z.number().int().positive(),
  dryRun: z.boolean().default(false),
  operations: z.array(biologyRoomMutationOperationSchema).min(1).max(100),
  actor: biologyRoomActorSchema.optional()
}).strict()

export const biologyRoomObserveInputSchema = biologyRoomTargetSchema.extend({
  assetLimit: z.number().int().min(1).max(BIOLOGY_ROOM_MAX_ASSETS).default(BIOLOGY_ROOM_DEFAULT_OBSERVE_ASSET_LIMIT),
  annotationLimit: z.number().int().min(1).max(200).default(BIOLOGY_ROOM_DEFAULT_OBSERVE_ANNOTATION_LIMIT),
  contigLimit: z.number().int().min(1).max(500).default(BIOLOGY_ROOM_DEFAULT_OBSERVE_CONTIG_LIMIT)
}).strict()

export const biologyRoomRefreshInputSchema = biologyRoomTargetSchema.extend({
  actor: biologyRoomActorSchema.optional()
}).strict()

export const biologyRoomHistoryInputSchema = biologyRoomTargetSchema.extend({
  beforeRevision: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(50)
}).strict()

export const biologyRoomListInputSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096),
  limit: z.number().int().min(1).max(500).default(100)
}).strict()

export type BiologyRoomCreateInput = z.input<typeof biologyRoomCreateInputSchema>
export type BiologyRoomOpenOrCreateInput = z.input<typeof biologyRoomOpenOrCreateInputSchema>
export type BiologyRoomTarget = z.input<typeof biologyRoomTargetSchema>
export type BiologyRoomApplyInput = z.input<typeof biologyRoomApplyInputSchema>
export type BiologyRoomObserveInput = z.input<typeof biologyRoomObserveInputSchema>
export type BiologyRoomRefreshInput = z.input<typeof biologyRoomRefreshInputSchema>
export type BiologyRoomHistoryInput = z.input<typeof biologyRoomHistoryInputSchema>
export type BiologyRoomListInput = z.input<typeof biologyRoomListInputSchema>

export const biologyRoomEventSchema = z.object({
  eventId: biologyRoomEntityIdSchema,
  roomId: biologyRoomIdSchema,
  fromRevision: nonNegativeIntegerSchema,
  toRevision: z.number().int().positive(),
  actor: biologyRoomActorSchema,
  operations: z.array(biologyRoomOperationSchema).min(1).max(100),
  timestamp: isoDateTimeSchema
}).strict()

export type BiologyRoomEvent = z.infer<typeof biologyRoomEventSchema>

export const biologyRoomHistoryEntrySchema = z.object({
  revision: z.number().int().positive(),
  updatedAt: isoDateTimeSchema,
  event: biologyRoomEventSchema.optional()
}).strict()

export const biologyRoomHistoryResultSchema = z.object({
  roomId: biologyRoomIdSchema,
  currentRevision: z.number().int().positive(),
  entries: z.array(biologyRoomHistoryEntrySchema).max(100),
  truncated: z.boolean()
}).strict()

export type BiologyRoomHistoryEntry = z.infer<typeof biologyRoomHistoryEntrySchema>
export type BiologyRoomHistoryResult = z.infer<typeof biologyRoomHistoryResultSchema>

export const biologyRoomApplyResultSchema = z.object({
  dryRun: z.boolean(),
  changed: z.boolean(),
  previousRevision: z.number().int().positive(),
  revision: z.number().int().positive(),
  manifest: biologyRoomManifestSchema,
  warnings: z.array(z.string().max(2_000)).max(100)
}).strict()

export type BiologyRoomApplyResult = z.infer<typeof biologyRoomApplyResultSchema>

export const biologyRoomOpenOrCreateResultSchema = z.object({
  created: z.boolean(),
  manifest: biologyRoomManifestSchema
}).strict()

export type BiologyRoomOpenOrCreateResult = z.infer<typeof biologyRoomOpenOrCreateResultSchema>

export const biologyRoomSummarySchema = z.object({
  roomId: biologyRoomIdSchema,
  title: z.string().trim().min(1).max(300),
  revision: z.number().int().positive(),
  assetCount: nonNegativeIntegerSchema,
  annotationCount: nonNegativeIntegerSchema,
  activeAssetId: biologyRoomEntityIdSchema.optional(),
  updatedAt: isoDateTimeSchema
}).strict()

export type BiologyRoomSummary = z.infer<typeof biologyRoomSummarySchema>

export const biologyRoomObserveResultSchema = z.object({
  schemaVersion: z.literal(BIOLOGY_ROOM_SCHEMA_VERSION),
  roomId: biologyRoomIdSchema,
  title: z.string().trim().min(1).max(300),
  revision: z.number().int().positive(),
  activeAssetId: biologyRoomEntityIdSchema.optional(),
  selection: biologyRoomSelectionSchema.optional(),
  viewerStates: biologyRoomViewerStateSchema,
  assets: z.array(biologyRoomAssetSchema),
  annotations: z.array(biologyAnnotationSchema),
  visibleTrackIds: z.array(biologyRoomEntityIdSchema),
  truncated: z.object({
    assets: z.boolean(),
    annotations: z.boolean(),
    contigs: z.boolean()
  }).strict(),
  updatedAt: isoDateTimeSchema
}).strict()

export type BiologyRoomObserveResult = z.infer<typeof biologyRoomObserveResultSchema>

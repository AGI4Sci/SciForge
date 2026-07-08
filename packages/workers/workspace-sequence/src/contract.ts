import { z } from 'zod'

export const WORKSPACE_SEQUENCE_CONTRACT_VERSION = 1
export const WORKSPACE_PREVIEW_CONTRACT_VERSION = 1
export const WORKSPACE_SEQUENCE_PACKAGE_NAME = '@sciforge/workspace-sequence'
export const WORKSPACE_SEQUENCE_PLUGIN_ID = 'sequence-genomics'

export const WORKSPACE_SEQUENCE_DEFAULT_RECORD_LIMIT = 100
export const WORKSPACE_SEQUENCE_MAX_RECORDS = 1000
export const WORKSPACE_SEQUENCE_DEFAULT_REFERENCE_LIMIT = 200
export const WORKSPACE_SEQUENCE_MAX_REFERENCES = 1000
export const WORKSPACE_SEQUENCE_MAX_TEXT_CHARS = 2_000_000
export const WORKSPACE_SEQUENCE_MAX_VISIBLE_TEXT_CHARS = 200_000
export const WORKSPACE_SEQUENCE_MAX_WARNING_CHARS = 1000
export const WORKSPACE_SEQUENCE_MAX_WARNINGS = 20
export const WORKSPACE_SEQUENCE_MAX_ID_CHARS = 256
export const WORKSPACE_SEQUENCE_MAX_PREVIEW_CHARS = 200
export const WORKSPACE_SEQUENCE_DEFAULT_REGION_ITEM_LIMIT = 100
export const WORKSPACE_SEQUENCE_MAX_REGION_ITEMS = 1000
export const WORKSPACE_SEQUENCE_MAX_INDEXED_RANGES = 2000
export const WORKSPACE_SEQUENCE_DEFAULT_SEARCH_RESULT_LIMIT = 100
export const WORKSPACE_SEQUENCE_MAX_SEARCH_RESULTS = 1000
export const WORKSPACE_SEQUENCE_MAX_SEARCH_QUERY_CHARS = 512

export const WORKSPACE_SEQUENCE_ACTIONS = [
  'observe',
  'select',
  'sequence.selectRegion',
  'sequence.search',
  'sequence.inspectFeatures',
  'sequence.exportSummary'
] as const

export const workspaceSequenceFormatSchema = z.enum([
  'auto',
  'fasta',
  'fastq',
  'genbank',
  'gff',
  'gtf',
  'bed',
  'vcf'
])
export const workspaceSequenceResolvedFormatSchema = z.enum([
  'fasta',
  'fastq',
  'genbank',
  'gff',
  'gtf',
  'bed',
  'vcf'
])
export const workspaceSequenceAlphabetSchema = z.enum(['dna', 'rna', 'protein', 'unknown'])
export const workspaceSequenceVariantTypeSchema = z.enum(['snv', 'mnv', 'indel', 'symbolic', 'mixed', 'unknown'])
export const workspaceSequenceIndexedRangeKindSchema = z.enum([
  'reference',
  'sequence',
  'read',
  'feature',
  'interval',
  'variant'
])
export const workspaceSequenceSearchScopeSchema = z.enum([
  'records',
  'references',
  'features',
  'variants',
  'ranges',
  'all'
])
export const workspaceSequenceSearchMatchKindSchema = z.enum([
  'record',
  'motif',
  'reference',
  'feature',
  'variant',
  'range'
])

const pathSchema = z.string().trim().min(1).max(4096)
const optionalPathSchema = z.string().trim().max(4096).optional()
const mimeTypeSchema = z.string().trim().max(128)
const boundedIdSchema = z.string().trim().min(1).max(WORKSPACE_SEQUENCE_MAX_ID_CHARS)
const optionalBoundedIdSchema = z.string().trim().max(WORKSPACE_SEQUENCE_MAX_ID_CHARS).optional()
const boundedWarningSchema = z.string().trim().min(1).max(WORKSPACE_SEQUENCE_MAX_WARNING_CHARS)
const boundedPreviewSchema = z.string().max(WORKSPACE_SEQUENCE_MAX_PREVIEW_CHARS)

export const workspaceSequenceIndexedRangeSchema = z.object({
  kind: workspaceSequenceIndexedRangeKindSchema,
  reference: boundedIdSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  id: optionalBoundedIdSchema,
  type: z.string().trim().min(1).max(128).optional(),
  strand: z.enum(['+', '-']).optional()
}).strict()

export const workspaceSequenceRegionSummarySchema = z.object({
  reference: boundedIdSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  sequenceLength: z.number().int().nonnegative().optional(),
  rangeCount: z.number().int().nonnegative(),
  featureCount: z.number().int().nonnegative().optional(),
  intervalCount: z.number().int().nonnegative().optional(),
  variantCount: z.number().int().nonnegative().optional()
}).strict()

export const workspaceSequencePreviewInputSchema = z.object({
  text: z.string().max(WORKSPACE_SEQUENCE_MAX_TEXT_CHARS),
  format: workspaceSequenceFormatSchema.default('auto'),
  maxRecords: z.number().int().min(0).max(WORKSPACE_SEQUENCE_MAX_RECORDS).default(WORKSPACE_SEQUENCE_DEFAULT_RECORD_LIMIT),
  maxReferences: z.number().int().min(0).max(WORKSPACE_SEQUENCE_MAX_REFERENCES).default(WORKSPACE_SEQUENCE_DEFAULT_REFERENCE_LIMIT),
  includeObservation: z.boolean().default(true),
  path: optionalPathSchema,
  workspaceRoot: optionalPathSchema,
  mimeType: mimeTypeSchema.optional(),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional()
}).strict()

export const workspaceSequenceRecordSummarySchema = z.object({
  id: boundedIdSchema,
  description: z.string().trim().max(1000).optional(),
  length: z.number().int().nonnegative(),
  alphabet: workspaceSequenceAlphabetSchema,
  gcContent: z.number().finite().min(0).max(1).optional(),
  preview: boundedPreviewSchema.optional()
}).strict()

export const workspaceSequenceReferenceSummarySchema = z.object({
  id: boundedIdSchema,
  sequenceLength: z.number().int().nonnegative().optional(),
  featureCount: z.number().int().nonnegative().optional(),
  intervalCount: z.number().int().nonnegative().optional(),
  variantCount: z.number().int().nonnegative().optional(),
  indexedRange: workspaceSequenceIndexedRangeSchema.optional()
}).strict()

export const workspaceSequenceFeatureSummarySchema = z.object({
  id: optionalBoundedIdSchema,
  reference: boundedIdSchema,
  type: z.string().trim().min(1).max(128),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  strand: z.enum(['+', '-']).optional(),
  indexedRange: workspaceSequenceIndexedRangeSchema.optional()
}).strict()

export const workspaceSequenceVariantSummarySchema = z.object({
  id: optionalBoundedIdSchema,
  reference: boundedIdSchema,
  position: z.number().int().nonnegative(),
  ref: z.string().trim().min(1).max(512),
  alt: z.array(z.string().trim().min(1).max(512)).max(128),
  type: workspaceSequenceVariantTypeSchema,
  indexedRange: workspaceSequenceIndexedRangeSchema.optional()
}).strict()

export const workspaceSequenceSelectionRangeSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  strand: z.enum(['+', '-']).optional()
}).strict()

export const workspaceSequenceSelectionFeatureSchema = z.object({
  id: optionalBoundedIdSchema,
  type: z.string().trim().min(1).max(128),
  start: z.number().int().min(0),
  end: z.number().int().min(0)
}).strict()

export const workspaceSequenceSelectionSchema = z.object({
  kind: z.literal('sequence'),
  sequenceId: boundedIdSchema.optional(),
  ranges: z.array(workspaceSequenceSelectionRangeSchema).min(1).max(10_000),
  features: z.array(workspaceSequenceSelectionFeatureSchema).max(10_000).optional()
}).strict()

export const workspaceSequenceObservationSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_PREVIEW_CONTRACT_VERSION),
  file: z.object({
    path: pathSchema,
    workspaceRoot: optionalPathSchema,
    mimeType: mimeTypeSchema.optional(),
    size: z.number().finite().nonnegative().optional(),
    mtimeMs: z.number().finite().nonnegative().optional()
  }).strict(),
  view: z.object({
    pluginId: z.literal(WORKSPACE_SEQUENCE_PLUGIN_ID),
    modality: z.literal('sequence'),
    mode: z.literal('preview'),
    title: z.string().trim().min(1).max(512)
  }).strict(),
  selection: workspaceSequenceSelectionSchema.optional(),
  visibleText: z.string().max(WORKSPACE_SEQUENCE_MAX_VISIBLE_TEXT_CHARS).optional(),
  sequence: z.object({
    sequenceCount: z.number().int().nonnegative().optional(),
    totalLength: z.number().int().nonnegative().optional(),
    alphabet: workspaceSequenceAlphabetSchema.optional(),
    references: z.array(workspaceSequenceReferenceSummarySchema).max(WORKSPACE_SEQUENCE_MAX_REFERENCES).optional(),
    features: z.array(workspaceSequenceFeatureSummarySchema).max(WORKSPACE_SEQUENCE_MAX_RECORDS).optional(),
    indexedRanges: z.array(workspaceSequenceIndexedRangeSchema).max(WORKSPACE_SEQUENCE_MAX_INDEXED_RANGES).optional(),
    truncatedRecords: z.boolean().optional(),
    truncatedReferences: z.boolean().optional()
  }).strict().optional(),
  annotations: z.array(z.object({
    id: boundedIdSchema,
    kind: z.string().trim().min(1).max(128),
    summary: z.string().trim().max(1000).optional()
  }).strict()).max(1000).optional(),
  actions: z.array(z.string().trim().min(1).max(128)).max(256)
}).strict()

export const workspaceSequencePreviewResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_SEQUENCE_CONTRACT_VERSION),
  format: workspaceSequenceResolvedFormatSchema,
  sequenceCount: z.number().int().nonnegative(),
  totalLength: z.number().int().nonnegative(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  averageLength: z.number().finite().nonnegative().optional(),
  alphabet: workspaceSequenceAlphabetSchema,
  readCount: z.number().int().nonnegative().optional(),
  featureCount: z.number().int().nonnegative().optional(),
  intervalCount: z.number().int().nonnegative().optional(),
  variantCount: z.number().int().nonnegative().optional(),
  sampleCount: z.number().int().nonnegative().optional(),
  records: z.array(workspaceSequenceRecordSummarySchema).max(WORKSPACE_SEQUENCE_MAX_RECORDS),
  references: z.array(workspaceSequenceReferenceSummarySchema).max(WORKSPACE_SEQUENCE_MAX_REFERENCES),
  features: z.array(workspaceSequenceFeatureSummarySchema).max(WORKSPACE_SEQUENCE_MAX_RECORDS),
  variants: z.array(workspaceSequenceVariantSummarySchema).max(WORKSPACE_SEQUENCE_MAX_RECORDS),
  indexedRanges: z.array(workspaceSequenceIndexedRangeSchema).max(WORKSPACE_SEQUENCE_MAX_INDEXED_RANGES),
  regionSummary: z.array(workspaceSequenceRegionSummarySchema).max(WORKSPACE_SEQUENCE_MAX_REFERENCES),
  truncatedRecords: z.boolean(),
  truncatedReferences: z.boolean(),
  warnings: z.array(boundedWarningSchema).max(WORKSPACE_SEQUENCE_MAX_WARNINGS),
  observation: workspaceSequenceObservationSchema.optional()
}).strict()

export const workspaceSequenceRegionSelectionInputSchema = z.object({
  preview: workspaceSequencePreviewResultSchema,
  reference: boundedIdSchema,
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  strand: z.enum(['+', '-']).optional(),
  maxFeatures: z.number().int().min(0).max(WORKSPACE_SEQUENCE_MAX_REGION_ITEMS).default(WORKSPACE_SEQUENCE_DEFAULT_REGION_ITEM_LIMIT),
  maxVariants: z.number().int().min(0).max(WORKSPACE_SEQUENCE_MAX_REGION_ITEMS).default(WORKSPACE_SEQUENCE_DEFAULT_REGION_ITEM_LIMIT)
}).strict()

export const workspaceSequenceRegionSelectionResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_SEQUENCE_CONTRACT_VERSION),
  reference: boundedIdSchema,
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  region: workspaceSequenceRegionSummarySchema,
  indexedRanges: z.array(workspaceSequenceIndexedRangeSchema).max(WORKSPACE_SEQUENCE_MAX_REGION_ITEMS),
  features: z.array(workspaceSequenceFeatureSummarySchema).max(WORKSPACE_SEQUENCE_MAX_REGION_ITEMS),
  variants: z.array(workspaceSequenceVariantSummarySchema).max(WORKSPACE_SEQUENCE_MAX_REGION_ITEMS),
  featureCount: z.number().int().nonnegative(),
  variantCount: z.number().int().nonnegative(),
  truncatedFeatures: z.boolean(),
  truncatedVariants: z.boolean(),
  selection: workspaceSequenceSelectionSchema,
  visibleText: z.string().max(WORKSPACE_SEQUENCE_MAX_VISIBLE_TEXT_CHARS).optional(),
  warnings: z.array(boundedWarningSchema).max(WORKSPACE_SEQUENCE_MAX_WARNINGS)
}).strict()

export const workspaceSequenceSearchInputSchema = z.object({
  preview: workspaceSequencePreviewResultSchema,
  query: z.string().trim().min(1).max(WORKSPACE_SEQUENCE_MAX_SEARCH_QUERY_CHARS),
  scope: workspaceSequenceSearchScopeSchema.default('all'),
  caseSensitive: z.boolean().default(false),
  maxResults: z.number().int().min(0).max(WORKSPACE_SEQUENCE_MAX_SEARCH_RESULTS).default(WORKSPACE_SEQUENCE_DEFAULT_SEARCH_RESULT_LIMIT)
}).strict()

export const workspaceSequenceSearchMatchSchema = z.object({
  kind: workspaceSequenceSearchMatchKindSchema,
  reference: boundedIdSchema,
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
  id: optionalBoundedIdSchema,
  type: z.string().trim().min(1).max(128).optional(),
  preview: boundedPreviewSchema.optional()
}).strict()

export const workspaceSequenceSearchResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_SEQUENCE_CONTRACT_VERSION),
  query: z.string().trim().min(1).max(WORKSPACE_SEQUENCE_MAX_SEARCH_QUERY_CHARS),
  scope: workspaceSequenceSearchScopeSchema,
  caseSensitive: z.boolean(),
  matchCount: z.number().int().nonnegative(),
  matches: z.array(workspaceSequenceSearchMatchSchema).max(WORKSPACE_SEQUENCE_MAX_SEARCH_RESULTS),
  selection: workspaceSequenceSelectionSchema.optional(),
  visibleText: z.string().max(WORKSPACE_SEQUENCE_MAX_VISIBLE_TEXT_CHARS).optional(),
  truncated: z.boolean(),
  warnings: z.array(boundedWarningSchema).max(WORKSPACE_SEQUENCE_MAX_WARNINGS)
}).strict()

export type WorkspaceSequenceFormat = z.infer<typeof workspaceSequenceFormatSchema>
export type WorkspaceSequenceResolvedFormat = z.infer<typeof workspaceSequenceResolvedFormatSchema>
export type WorkspaceSequenceAlphabet = z.infer<typeof workspaceSequenceAlphabetSchema>
export type WorkspaceSequenceVariantType = z.infer<typeof workspaceSequenceVariantTypeSchema>
export type WorkspaceSequenceIndexedRangeKind = z.infer<typeof workspaceSequenceIndexedRangeKindSchema>
export type WorkspaceSequenceSearchScope = z.infer<typeof workspaceSequenceSearchScopeSchema>
export type WorkspaceSequenceSearchMatchKind = z.infer<typeof workspaceSequenceSearchMatchKindSchema>
export type WorkspaceSequencePreviewInput = z.input<typeof workspaceSequencePreviewInputSchema>
export type NormalizedWorkspaceSequencePreviewInput = z.output<typeof workspaceSequencePreviewInputSchema>
export type WorkspaceSequenceRecordSummary = z.infer<typeof workspaceSequenceRecordSummarySchema>
export type WorkspaceSequenceReferenceSummary = z.infer<typeof workspaceSequenceReferenceSummarySchema>
export type WorkspaceSequenceFeatureSummary = z.infer<typeof workspaceSequenceFeatureSummarySchema>
export type WorkspaceSequenceVariantSummary = z.infer<typeof workspaceSequenceVariantSummarySchema>
export type WorkspaceSequenceIndexedRange = z.infer<typeof workspaceSequenceIndexedRangeSchema>
export type WorkspaceSequenceRegionSummary = z.infer<typeof workspaceSequenceRegionSummarySchema>
export type WorkspaceSequenceSelection = z.infer<typeof workspaceSequenceSelectionSchema>
export type WorkspaceSequenceObservation = z.infer<typeof workspaceSequenceObservationSchema>
export type WorkspaceSequencePreviewResult = z.infer<typeof workspaceSequencePreviewResultSchema>
export type WorkspaceSequenceRegionSelectionInput = z.input<typeof workspaceSequenceRegionSelectionInputSchema>
export type NormalizedWorkspaceSequenceRegionSelectionInput = z.output<typeof workspaceSequenceRegionSelectionInputSchema>
export type WorkspaceSequenceRegionSelectionResult = z.infer<typeof workspaceSequenceRegionSelectionResultSchema>
export type WorkspaceSequenceSearchInput = z.input<typeof workspaceSequenceSearchInputSchema>
export type NormalizedWorkspaceSequenceSearchInput = z.output<typeof workspaceSequenceSearchInputSchema>
export type WorkspaceSequenceSearchMatch = z.infer<typeof workspaceSequenceSearchMatchSchema>
export type WorkspaceSequenceSearchResult = z.infer<typeof workspaceSequenceSearchResultSchema>

import { z } from 'zod'

export const WORKSPACE_OMICS_CONTRACT_VERSION = 1
export const WORKSPACE_PREVIEW_CONTRACT_VERSION = 1
export const WORKSPACE_OMICS_PACKAGE_NAME = '@sciforge/workspace-omics'
export const WORKSPACE_OMICS_PLUGIN_ID = 'omics'

export const WORKSPACE_OMICS_MAX_TEXT_CHARS = 2_000_000
export const WORKSPACE_OMICS_MAX_VISIBLE_TEXT_CHARS = 200_000
export const WORKSPACE_OMICS_MAX_METADATA_ENTRIES = 200
export const WORKSPACE_OMICS_MAX_MATRICES = 64
export const WORKSPACE_OMICS_MAX_SHAPE_AXES = 8
export const WORKSPACE_OMICS_MAX_AXIS_KEYS = 128
export const WORKSPACE_OMICS_MAX_EMBEDDINGS = 64
export const WORKSPACE_OMICS_MAX_SELECTION_ITEMS = 256
export const WORKSPACE_OMICS_MAX_WARNINGS = 20

export const WORKSPACE_OMICS_ACTIONS = [
  'omics.preview',
  'omics.inspectMetadata',
  'omics.selectDataset',
  'omics.declareCapabilities'
] as const

export const workspaceOmicsFormatSchema = z.enum([
  'auto',
  'matrix-market',
  'json',
  'h5ad',
  'loom',
  'h5',
  'hdf5',
  'zarr'
])

export const workspaceOmicsResolvedFormatSchema = z.enum([
  'matrix-market',
  'json',
  'h5ad',
  'loom',
  'hdf5',
  'zarr',
  'unknown'
])

export const workspaceOmicsCapabilityFormatSchema = z.enum([
  'matrix-market',
  'json-metadata',
  'h5ad',
  'loom',
  'hdf5',
  'zarr'
])

export const workspaceOmicsMatrixSourceSchema = z.enum([
  'matrix-market',
  'metadata',
  'placeholder'
])

export const workspaceOmicsMetadataSourceSchema = z.enum([
  'json',
  'key-value',
  'matrix-market-comments',
  'none'
])

export const workspaceOmicsMetadataValueTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'null'
])

const pathSchema = z.string().trim().min(1).max(4096)
const optionalPathSchema = z.string().trim().max(4096).optional()
const mimeTypeSchema = z.string().trim().max(128)
const boundedWarningSchema = z.string().trim().min(1).max(1000)
const boundedMetadataKeySchema = z.string().trim().min(1).max(256)
const boundedMetadataValueSchema = z.string().max(10_000)
const boundedNameSchema = z.string().trim().min(1).max(256)
const boundedCountSchema = z.number().int().nonnegative()
const boundedShapeSchema = z.array(boundedCountSchema).min(2).max(WORKSPACE_OMICS_MAX_SHAPE_AXES)

export const workspaceOmicsPreviewInputSchema = z.object({
  text: z.string().max(WORKSPACE_OMICS_MAX_TEXT_CHARS).default(''),
  format: workspaceOmicsFormatSchema.default('auto'),
  includeObservation: z.boolean().default(true),
  path: optionalPathSchema,
  workspaceRoot: optionalPathSchema,
  mimeType: mimeTypeSchema.optional(),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional()
}).strict()

export const workspaceOmicsFormatCapabilitySchema = z.object({
  format: workspaceOmicsCapabilityFormatSchema,
  extensions: z.array(z.string().trim().min(1).max(32)).max(16),
  canParseMatrixPayload: z.boolean(),
  canParseMatrixMarketDimensions: z.boolean(),
  canExtractTextMetadata: z.boolean(),
  binaryPlaceholderOnly: z.boolean(),
  summary: z.string().trim().min(1).max(512)
}).strict()

export const workspaceOmicsMatrixSummarySchema = z.object({
  id: boundedNameSchema,
  name: z.string().trim().max(256).optional(),
  source: workspaceOmicsMatrixSourceSchema,
  format: workspaceOmicsResolvedFormatSchema,
  shape: boundedShapeSchema.optional(),
  rowCount: z.number().int().nonnegative().optional(),
  columnCount: z.number().int().nonnegative().optional(),
  nonZeroCount: z.number().int().nonnegative().optional(),
  density: z.number().finite().min(0).max(1).optional(),
  storage: z.enum(['coordinate', 'array']).optional(),
  field: z.string().trim().max(64).optional(),
  symmetry: z.string().trim().max(64).optional()
}).strict()

export const workspaceOmicsMetadataEntrySchema = z.object({
  key: boundedMetadataKeySchema,
  value: boundedMetadataValueSchema,
  valueType: workspaceOmicsMetadataValueTypeSchema
}).strict()

export const workspaceOmicsMetadataSummarySchema = z.object({
  source: workspaceOmicsMetadataSourceSchema,
  entries: z.array(workspaceOmicsMetadataEntrySchema).max(WORKSPACE_OMICS_MAX_METADATA_ENTRIES),
  truncated: z.boolean()
}).strict()

export const workspaceOmicsDatasetSummarySchema = z.object({
  nObs: boundedCountSchema.optional(),
  nVars: boundedCountSchema.optional(),
  shape: boundedShapeSchema.optional(),
  nnz: boundedCountSchema.optional(),
  obsKeyCount: boundedCountSchema.optional(),
  varKeyCount: boundedCountSchema.optional(),
  obsKeys: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_AXIS_KEYS).optional(),
  varKeys: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_AXIS_KEYS).optional(),
  embeddingNames: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_EMBEDDINGS).optional()
}).strict()

export const workspaceOmicsSelectionAxisSchema = z.enum(['obs', 'var', 'row', 'column'])

export const workspaceOmicsAxisRangeRequestSchema = z.object({
  matrixId: boundedNameSchema.optional(),
  matrixName: boundedNameSchema.optional(),
  axis: workspaceOmicsSelectionAxisSchema,
  start: boundedCountSchema,
  end: boundedCountSchema
}).strict()

export const workspaceOmicsSelectionRangeSchema = z.object({
  matrixId: boundedNameSchema,
  matrixName: boundedNameSchema.optional(),
  axis: workspaceOmicsSelectionAxisSchema,
  start: boundedCountSchema,
  end: boundedCountSchema,
  axisLength: boundedCountSchema.optional(),
  clipped: z.boolean().optional()
}).strict()

export const workspaceOmicsSelectionSchema = z.object({
  kind: z.literal('omics'),
  matrixIds: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS).optional(),
  obsKeys: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS).optional(),
  varKeys: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS).optional(),
  embeddings: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS).optional(),
  ranges: z.array(workspaceOmicsSelectionRangeSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS).optional()
}).strict()

export const workspaceOmicsPlaceholderSchema = z.object({
  format: workspaceOmicsResolvedFormatSchema,
  reason: z.string().trim().min(1).max(1000),
  supportedSummaries: z.array(z.string().trim().min(1).max(256)).max(16)
}).strict()

export const workspaceOmicsObservationSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_PREVIEW_CONTRACT_VERSION),
  file: z.object({
    path: pathSchema,
    workspaceRoot: optionalPathSchema,
    mimeType: mimeTypeSchema.optional(),
    size: z.number().finite().nonnegative().optional(),
    mtimeMs: z.number().finite().nonnegative().optional()
  }).strict(),
  view: z.object({
    pluginId: z.literal(WORKSPACE_OMICS_PLUGIN_ID),
    modality: z.literal('omics'),
    mode: z.literal('preview'),
    title: z.string().trim().min(1).max(512)
  }).strict(),
  visibleText: z.string().max(WORKSPACE_OMICS_MAX_VISIBLE_TEXT_CHARS).optional(),
  omics: z.object({
    format: workspaceOmicsResolvedFormatSchema,
    matrices: z.array(workspaceOmicsMatrixSummarySchema).max(WORKSPACE_OMICS_MAX_MATRICES),
    metadata: workspaceOmicsMetadataSummarySchema,
    dataset: workspaceOmicsDatasetSummarySchema.optional(),
    capabilities: z.array(workspaceOmicsFormatCapabilitySchema).max(16),
    placeholder: workspaceOmicsPlaceholderSchema.optional()
  }).strict(),
  annotations: z.array(z.object({
    id: z.string().trim().min(1).max(256),
    kind: z.string().trim().min(1).max(128),
    summary: z.string().trim().max(1000).optional()
  }).strict()).max(1000).optional(),
  selection: workspaceOmicsSelectionSchema.optional(),
  actions: z.array(z.string().trim().min(1).max(128)).max(256)
}).strict()

export const workspaceOmicsPreviewResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_OMICS_CONTRACT_VERSION),
  format: workspaceOmicsResolvedFormatSchema,
  capabilities: z.array(workspaceOmicsFormatCapabilitySchema).max(16),
  matrices: z.array(workspaceOmicsMatrixSummarySchema).max(WORKSPACE_OMICS_MAX_MATRICES),
  metadata: workspaceOmicsMetadataSummarySchema,
  dataset: workspaceOmicsDatasetSummarySchema.optional(),
  placeholder: workspaceOmicsPlaceholderSchema.optional(),
  warnings: z.array(boundedWarningSchema).max(WORKSPACE_OMICS_MAX_WARNINGS),
  observation: workspaceOmicsObservationSchema.optional()
}).strict()

export const workspaceOmicsSelectionMissingRequestsSchema = z.object({
  matrixIds: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS),
  matrixNames: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS),
  obsKeys: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS),
  varKeys: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS),
  embeddings: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS),
  ranges: z.array(workspaceOmicsAxisRangeRequestSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS)
}).strict()

export const workspaceOmicsDatasetSelectionInputSchema = z.object({
  preview: workspaceOmicsPreviewResultSchema,
  matrixIds: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS).default([]),
  matrixNames: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS).default([]),
  obsKeys: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS).default([]),
  varKeys: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS).default([]),
  embeddingNames: z.array(boundedNameSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS).default([]),
  ranges: z.array(workspaceOmicsAxisRangeRequestSchema).max(WORKSPACE_OMICS_MAX_SELECTION_ITEMS).default([])
}).strict().superRefine((input, context) => {
  if (
    input.matrixIds.length === 0 &&
    input.matrixNames.length === 0 &&
    input.obsKeys.length === 0 &&
    input.varKeys.length === 0 &&
    input.embeddingNames.length === 0 &&
    input.ranges.length === 0
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Dataset selection requires at least one matrix, axis key, embedding, or axis range request.'
    })
  }
})

export const workspaceOmicsDatasetSelectionResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_OMICS_CONTRACT_VERSION),
  selection: workspaceOmicsSelectionSchema,
  missing: workspaceOmicsSelectionMissingRequestsSchema,
  visibleText: z.string().max(WORKSPACE_OMICS_MAX_VISIBLE_TEXT_CHARS).optional(),
  warnings: z.array(boundedWarningSchema).max(WORKSPACE_OMICS_MAX_WARNINGS)
}).strict()

export type WorkspaceOmicsFormat = z.infer<typeof workspaceOmicsFormatSchema>
export type WorkspaceOmicsResolvedFormat = z.infer<typeof workspaceOmicsResolvedFormatSchema>
export type WorkspaceOmicsFormatCapability = z.infer<typeof workspaceOmicsFormatCapabilitySchema>
export type WorkspaceOmicsMatrixSource = z.infer<typeof workspaceOmicsMatrixSourceSchema>
export type WorkspaceOmicsMatrixSummary = z.infer<typeof workspaceOmicsMatrixSummarySchema>
export type WorkspaceOmicsMetadataEntry = z.infer<typeof workspaceOmicsMetadataEntrySchema>
export type WorkspaceOmicsMetadataSummary = z.infer<typeof workspaceOmicsMetadataSummarySchema>
export type WorkspaceOmicsDatasetSummary = z.infer<typeof workspaceOmicsDatasetSummarySchema>
export type WorkspaceOmicsSelectionAxis = z.infer<typeof workspaceOmicsSelectionAxisSchema>
export type WorkspaceOmicsAxisRangeRequest = z.infer<typeof workspaceOmicsAxisRangeRequestSchema>
export type WorkspaceOmicsSelectionRange = z.infer<typeof workspaceOmicsSelectionRangeSchema>
export type WorkspaceOmicsSelection = z.infer<typeof workspaceOmicsSelectionSchema>
export type WorkspaceOmicsPlaceholder = z.infer<typeof workspaceOmicsPlaceholderSchema>
export type WorkspaceOmicsPreviewInput = z.input<typeof workspaceOmicsPreviewInputSchema>
export type NormalizedWorkspaceOmicsPreviewInput = z.output<typeof workspaceOmicsPreviewInputSchema>
export type WorkspaceOmicsObservation = z.infer<typeof workspaceOmicsObservationSchema>
export type WorkspaceOmicsPreviewResult = z.infer<typeof workspaceOmicsPreviewResultSchema>
export type WorkspaceOmicsSelectionMissingRequests = z.infer<typeof workspaceOmicsSelectionMissingRequestsSchema>
export type WorkspaceOmicsDatasetSelectionInput = z.input<typeof workspaceOmicsDatasetSelectionInputSchema>
export type NormalizedWorkspaceOmicsDatasetSelectionInput = z.output<typeof workspaceOmicsDatasetSelectionInputSchema>
export type WorkspaceOmicsDatasetSelectionResult = z.infer<typeof workspaceOmicsDatasetSelectionResultSchema>

export const WORKSPACE_OMICS_FORMAT_CAPABILITIES: WorkspaceOmicsFormatCapability[] = [
  {
    format: 'matrix-market',
    extensions: ['.mtx'],
    canParseMatrixPayload: false,
    canParseMatrixMarketDimensions: true,
    canExtractTextMetadata: true,
    binaryPlaceholderOnly: false,
    summary: 'Parses Matrix Market headers and dimensions, including coordinate nnz counts.'
  },
  {
    format: 'json-metadata',
    extensions: ['.json', '.zattrs', '.zarray'],
    canParseMatrixPayload: false,
    canParseMatrixMarketDimensions: false,
    canExtractTextMetadata: true,
    binaryPlaceholderOnly: false,
    summary: 'Extracts bounded JSON and line-oriented key-value metadata summaries.'
  },
  {
    format: 'h5ad',
    extensions: ['.h5ad'],
    canParseMatrixPayload: false,
    canParseMatrixMarketDimensions: false,
    canExtractTextMetadata: true,
    binaryPlaceholderOnly: true,
    summary: 'AnnData/HDF5 payloads are represented as safe placeholders unless text metadata is provided.'
  },
  {
    format: 'loom',
    extensions: ['.loom'],
    canParseMatrixPayload: false,
    canParseMatrixMarketDimensions: false,
    canExtractTextMetadata: true,
    binaryPlaceholderOnly: true,
    summary: 'Loom/HDF5 payloads are represented as safe placeholders unless text metadata is provided.'
  },
  {
    format: 'hdf5',
    extensions: ['.h5', '.hdf5'],
    canParseMatrixPayload: false,
    canParseMatrixMarketDimensions: false,
    canExtractTextMetadata: true,
    binaryPlaceholderOnly: true,
    summary: 'Generic HDF5 payloads are represented as safe placeholders unless text metadata is provided.'
  },
  {
    format: 'zarr',
    extensions: ['.zarr'],
    canParseMatrixPayload: false,
    canParseMatrixMarketDimensions: false,
    canExtractTextMetadata: true,
    binaryPlaceholderOnly: true,
    summary: 'Zarr stores are represented as safe placeholders unless text metadata is provided.'
  }
]

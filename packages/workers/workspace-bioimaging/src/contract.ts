import { z } from 'zod'

export const WORKSPACE_BIOIMAGING_CONTRACT_VERSION = 1
export const WORKSPACE_PREVIEW_CONTRACT_VERSION = 1
export const WORKSPACE_BIOIMAGING_PACKAGE_NAME = '@sciforge/workspace-bioimaging'
export const WORKSPACE_BIOIMAGING_PLUGIN_ID = 'bioimaging'

export const WORKSPACE_BIOIMAGING_MAX_BYTES = 4 * 1024 * 1024
export const WORKSPACE_BIOIMAGING_MAX_CHANNELS = 1_000
export const WORKSPACE_BIOIMAGING_MAX_IMAGES = 100
export const WORKSPACE_BIOIMAGING_MAX_TIFF_TAGS = 64
export const WORKSPACE_BIOIMAGING_MAX_WARNINGS = 20
export const WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS = 200_000
export const WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE = 512
export const WORKSPACE_BIOIMAGING_MAX_PYRAMID_LEVELS = 16
export const WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS = 10_000

export const WORKSPACE_BIOIMAGING_ACTIONS = [
  'bioimaging.observeMetadata',
  'bioimaging.inspectHeader',
  'bioimaging.describeTilePlan',
  'bioimaging.selectRegion',
  'bioimaging.selectChannels',
  'bioimaging.annotateRegion',
  'bioimaging.exportRoiSet'
] as const

const pathSchema = z.string().trim().min(1).max(4096)
const optionalPathSchema = z.string().trim().max(4096).optional()
const mimeTypeSchema = z.string().trim().max(128)
const boundedStringSchema = z.string().trim().max(1000)
const boundedRequiredStringSchema = z.string().trim().min(1).max(1000)
const boundedIdSchema = z.string().trim().min(1).max(256)
const channelNameSchema = z.string().trim().min(1).max(128)
const annotationLabelSchema = z.string().trim().min(1).max(256)

export const workspaceBioimagingFormatSchema = z.enum([
  'auto',
  'tiff',
  'ome-tiff',
  'czi',
  'svs',
  'ndpi'
])

export const workspaceBioimagingResolvedFormatSchema = z.enum([
  'tiff',
  'ome-tiff',
  'czi',
  'svs',
  'ndpi',
  'unknown'
])

export const workspaceBioimagingDetectionSourceSchema = z.enum([
  'input',
  'path',
  'signature',
  'metadata',
  'unknown'
])

export const workspaceBioimagingDimensionsSchema = z.object({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  z: z.number().int().positive().optional(),
  c: z.number().int().positive().optional(),
  t: z.number().int().positive().optional()
}).strict()

export const workspaceBioimagingChannelSchema = z.object({
  id: z.string().trim().max(256).optional(),
  name: channelNameSchema,
  color: z.string().trim().max(64).optional()
}).strict()

export const workspaceBioimagingOmeImageSchema = z.object({
  id: z.string().trim().max(256).optional(),
  name: z.string().trim().max(256).optional(),
  dimensionOrder: z.string().trim().max(16).optional(),
  pixelType: z.string().trim().max(64).optional(),
  dimensions: workspaceBioimagingDimensionsSchema.optional(),
  channels: z.array(workspaceBioimagingChannelSchema).max(WORKSPACE_BIOIMAGING_MAX_CHANNELS)
}).strict()

export const workspaceBioimagingOmeSummarySchema = z.object({
  xmlCharCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  images: z.array(workspaceBioimagingOmeImageSchema).max(WORKSPACE_BIOIMAGING_MAX_IMAGES)
}).strict()

export const workspaceBioimagingTiffTagSchema = z.object({
  tag: z.number().int().min(0).max(65535),
  name: z.string().trim().min(1).max(96),
  type: z.string().trim().min(1).max(32),
  count: z.number().finite().nonnegative(),
  valuePreview: z.string().trim().max(512).optional()
}).strict()

export const workspaceBioimagingTiffSummarySchema = z.object({
  byteOrder: z.enum(['little', 'big']),
  flavor: z.enum(['classic-tiff', 'bigtiff']),
  magic: z.number().int(),
  firstIfdOffset: z.number().int().nonnegative(),
  imageWidth: z.number().int().positive().optional(),
  imageHeight: z.number().int().positive().optional(),
  bitsPerSample: z.array(z.number().int().nonnegative()).max(16).optional(),
  samplesPerPixel: z.number().int().positive().optional(),
  compression: z.string().trim().max(128).optional(),
  photometricInterpretation: z.string().trim().max(128).optional(),
  imageDescriptionCharCount: z.number().int().nonnegative().optional(),
  omeXmlPresent: z.boolean(),
  tags: z.array(workspaceBioimagingTiffTagSchema).max(WORKSPACE_BIOIMAGING_MAX_TIFF_TAGS)
}).strict()

export const workspaceBioimagingPlaceholderSchema = z.object({
  kind: z.enum(['proprietary-container', 'whole-slide', 'unsupported']),
  vendor: z.string().trim().max(128).optional(),
  tileRendererImplemented: z.literal(false),
  reason: z.string().trim().min(1).max(1000)
}).strict()

export const workspaceBioimagingTileSizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive()
}).strict()

export const workspaceBioimagingTilePyramidLevelSchema = z.object({
  level: z.number().int().nonnegative(),
  downsample: z.number().finite().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
  tileCount: z.number().int().nonnegative().optional()
}).strict()

export const workspaceBioimagingTilePlanSchema = z.object({
  status: z.literal('metadata-only'),
  kind: z.literal('metadata-derived-pyramid'),
  source: z.enum(['tiff-metadata', 'ome-tiff-metadata']),
  tileRendererImplemented: z.literal(false),
  pixelDecoding: z.literal(false),
  baseDimensions: workspaceBioimagingDimensionsSchema,
  recommendedTileSize: workspaceBioimagingTileSizeSchema,
  channelCount: z.number().int().nonnegative().optional(),
  levels: z.array(workspaceBioimagingTilePyramidLevelSchema).max(WORKSPACE_BIOIMAGING_MAX_PYRAMID_LEVELS),
  notes: z.array(boundedRequiredStringSchema).max(16)
}).strict()

export const workspaceBioimagingSelectionRegionSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  z: z.number().finite().nonnegative().optional(),
  t: z.number().finite().nonnegative().optional()
}).strict()

export const workspaceBioimagingSelectionSchema = z.object({
  kind: z.literal('bioimaging'),
  roiIds: z.array(boundedIdSchema).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS).optional(),
  channels: z.array(channelNameSchema).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS).optional(),
  regions: z.array(workspaceBioimagingSelectionRegionSchema).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS).optional()
}).strict()

export const workspaceBioimagingObservationSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_PREVIEW_CONTRACT_VERSION),
  file: z.object({
    path: pathSchema,
    workspaceRoot: optionalPathSchema,
    mimeType: mimeTypeSchema.optional(),
    size: z.number().finite().nonnegative().optional(),
    mtimeMs: z.number().finite().nonnegative().optional()
  }).strict(),
  view: z.object({
    pluginId: z.literal(WORKSPACE_BIOIMAGING_PLUGIN_ID),
    modality: z.literal('bioimaging'),
    mode: z.literal('preview'),
    title: z.string().trim().min(1).max(512)
  }).strict(),
  selection: workspaceBioimagingSelectionSchema.optional(),
  visibleText: z.string().max(WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS).optional(),
  bioimaging: z.object({
    channels: z.array(channelNameSchema).max(WORKSPACE_BIOIMAGING_MAX_CHANNELS).optional(),
    dimensions: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      z: z.number().int().positive().optional(),
      t: z.number().int().positive().optional()
    }).strict().optional()
  }).strict().optional(),
  annotations: z.array(z.object({
    id: z.string().trim().min(1).max(256),
    kind: z.string().trim().min(1).max(128),
    summary: z.string().trim().max(1000).optional()
  }).strict()).max(1000).optional(),
  actions: z.array(z.string().trim().min(1).max(128)).max(256)
}).strict()

const bytesSchema = z.instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength <= WORKSPACE_BIOIMAGING_MAX_BYTES, {
    message: `bytes must be at most ${WORKSPACE_BIOIMAGING_MAX_BYTES} bytes`
  })

export const workspaceBioimagingPreviewInputSchema = z.object({
  bytes: bytesSchema,
  format: workspaceBioimagingFormatSchema.default('auto'),
  includeObservation: z.boolean().default(true),
  path: optionalPathSchema,
  workspaceRoot: optionalPathSchema,
  mimeType: mimeTypeSchema.optional(),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional()
}).strict()

export const workspaceBioimagingPreviewResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_BIOIMAGING_CONTRACT_VERSION),
  format: workspaceBioimagingResolvedFormatSchema,
  detectedBy: workspaceBioimagingDetectionSourceSchema,
  byteLength: z.number().int().nonnegative(),
  dimensions: workspaceBioimagingDimensionsSchema.optional(),
  channels: z.array(channelNameSchema).max(WORKSPACE_BIOIMAGING_MAX_CHANNELS),
  tiff: workspaceBioimagingTiffSummarySchema.optional(),
  ome: workspaceBioimagingOmeSummarySchema.optional(),
  placeholder: workspaceBioimagingPlaceholderSchema.optional(),
  tilePlan: workspaceBioimagingTilePlanSchema.optional(),
  warnings: z.array(boundedStringSchema).max(WORKSPACE_BIOIMAGING_MAX_WARNINGS),
  observation: workspaceBioimagingObservationSchema.optional()
}).strict()

export const workspaceBioimagingRegionSelectionInputSchema = z.object({
  preview: workspaceBioimagingPreviewResultSchema,
  region: workspaceBioimagingSelectionRegionSchema,
  roiId: boundedIdSchema.optional(),
  clampToImage: z.boolean().default(true)
}).strict()

export const workspaceBioimagingRegionSelectionResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_BIOIMAGING_CONTRACT_VERSION),
  region: workspaceBioimagingSelectionRegionSchema,
  roiId: boundedIdSchema.optional(),
  clipped: z.boolean(),
  imageDimensions: workspaceBioimagingDimensionsSchema.optional(),
  selection: workspaceBioimagingSelectionSchema,
  visibleText: z.string().max(WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS).optional(),
  warnings: z.array(boundedStringSchema).max(WORKSPACE_BIOIMAGING_MAX_WARNINGS)
}).strict()

export const workspaceBioimagingChannelSelectionInputSchema = z.object({
  preview: workspaceBioimagingPreviewResultSchema,
  channels: z.array(channelNameSchema).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS).optional(),
  channelIndexes: z.array(z.number().int().nonnegative()).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS).optional(),
  allowUnknown: z.boolean().default(false)
}).strict().superRefine((input, context) => {
  if (!input.channels?.length && !input.channelIndexes?.length) {
    context.addIssue({
      code: 'custom',
      message: 'channels or channelIndexes must include at least one requested channel'
    })
  }
})

export const workspaceBioimagingChannelSelectionResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_BIOIMAGING_CONTRACT_VERSION),
  channels: z.array(channelNameSchema).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS),
  channelIndexes: z.array(z.number().int().nonnegative()).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS),
  unknownChannels: z.array(channelNameSchema).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS),
  selection: workspaceBioimagingSelectionSchema,
  visibleText: z.string().max(WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS).optional(),
  warnings: z.array(boundedStringSchema).max(WORKSPACE_BIOIMAGING_MAX_WARNINGS)
}).strict()

export const workspaceBioimagingRoiAnnotationSchema = z.object({
  id: boundedIdSchema,
  kind: z.literal('roi-annotation'),
  metadataOnly: z.literal(true),
  pixelDecoding: z.literal(false),
  roiId: boundedIdSchema,
  label: annotationLabelSchema.optional(),
  body: boundedStringSchema.optional(),
  region: workspaceBioimagingSelectionRegionSchema,
  channels: z.array(channelNameSchema).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS).optional(),
  format: workspaceBioimagingResolvedFormatSchema,
  summary: boundedStringSchema
}).strict()

export const workspaceBioimagingRegionAnnotationInputSchema = z.object({
  preview: workspaceBioimagingPreviewResultSchema,
  region: workspaceBioimagingSelectionRegionSchema,
  roiId: boundedIdSchema.optional(),
  label: annotationLabelSchema.optional(),
  body: boundedStringSchema.optional(),
  channels: z.array(channelNameSchema).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS).optional(),
  channelIndexes: z.array(z.number().int().nonnegative()).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS).optional(),
  allowUnknownChannels: z.boolean().default(false),
  clampToImage: z.boolean().default(true)
}).strict()

export const workspaceBioimagingRegionAnnotationResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_BIOIMAGING_CONTRACT_VERSION),
  region: workspaceBioimagingSelectionRegionSchema,
  roiId: boundedIdSchema,
  clipped: z.boolean(),
  channels: z.array(channelNameSchema).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS),
  channelIndexes: z.array(z.number().int().nonnegative()).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS),
  unknownChannels: z.array(channelNameSchema).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS),
  imageDimensions: workspaceBioimagingDimensionsSchema.optional(),
  selection: workspaceBioimagingSelectionSchema,
  annotation: workspaceBioimagingRoiAnnotationSchema,
  visibleText: z.string().max(WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS).optional(),
  warnings: z.array(boundedStringSchema).max(WORKSPACE_BIOIMAGING_MAX_WARNINGS)
}).strict()

export const workspaceBioimagingRoiSetSchema = z.object({
  kind: z.literal('bioimaging-roi-set'),
  schemaVersion: z.literal(WORKSPACE_BIOIMAGING_CONTRACT_VERSION),
  metadataOnly: z.literal(true),
  pixelDecoding: z.literal(false),
  containsPixels: z.literal(false),
  source: z.object({
    format: workspaceBioimagingResolvedFormatSchema,
    byteLength: z.number().int().nonnegative(),
    dimensions: workspaceBioimagingDimensionsSchema.optional(),
    channels: z.array(channelNameSchema).max(WORKSPACE_BIOIMAGING_MAX_CHANNELS),
    placeholder: workspaceBioimagingPlaceholderSchema.optional()
  }).strict(),
  selection: workspaceBioimagingSelectionSchema,
  annotations: z.array(workspaceBioimagingRoiAnnotationSchema).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS)
}).strict()

export const workspaceBioimagingRoiSetExportInputSchema = z.object({
  preview: workspaceBioimagingPreviewResultSchema,
  selection: workspaceBioimagingSelectionSchema.optional(),
  annotations: z.array(workspaceBioimagingRoiAnnotationSchema).max(WORKSPACE_BIOIMAGING_MAX_SELECTION_ITEMS).optional()
}).strict().superRefine((input, context) => {
  const hasSelection = Boolean(
    input.selection?.roiIds?.length ||
    input.selection?.channels?.length ||
    input.selection?.regions?.length
  )
  if (!hasSelection && !input.annotations?.length) {
    context.addIssue({
      code: 'custom',
      message: 'selection or annotations must include at least one ROI/channel item'
    })
  }
})

export const workspaceBioimagingRoiSetExportResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_BIOIMAGING_CONTRACT_VERSION),
  mimeType: z.literal('application/vnd.sciforge.bioimaging.roi-set+json'),
  fileExtension: z.literal('.bioimaging-roi-set.json'),
  roiSet: workspaceBioimagingRoiSetSchema,
  jsonText: z.string(),
  visibleText: z.string().max(WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS).optional(),
  warnings: z.array(boundedStringSchema).max(WORKSPACE_BIOIMAGING_MAX_WARNINGS)
}).strict()

export type WorkspaceBioimagingFormat = z.infer<typeof workspaceBioimagingFormatSchema>
export type WorkspaceBioimagingResolvedFormat = z.infer<typeof workspaceBioimagingResolvedFormatSchema>
export type WorkspaceBioimagingDetectionSource = z.infer<typeof workspaceBioimagingDetectionSourceSchema>
export type WorkspaceBioimagingDimensions = z.infer<typeof workspaceBioimagingDimensionsSchema>
export type WorkspaceBioimagingChannel = z.infer<typeof workspaceBioimagingChannelSchema>
export type WorkspaceBioimagingOmeSummary = z.infer<typeof workspaceBioimagingOmeSummarySchema>
export type WorkspaceBioimagingTiffSummary = z.infer<typeof workspaceBioimagingTiffSummarySchema>
export type WorkspaceBioimagingPlaceholder = z.infer<typeof workspaceBioimagingPlaceholderSchema>
export type WorkspaceBioimagingTilePlan = z.infer<typeof workspaceBioimagingTilePlanSchema>
export type WorkspaceBioimagingSelectionRegion = z.infer<typeof workspaceBioimagingSelectionRegionSchema>
export type WorkspaceBioimagingSelection = z.infer<typeof workspaceBioimagingSelectionSchema>
export type WorkspaceBioimagingObservation = z.infer<typeof workspaceBioimagingObservationSchema>
export type WorkspaceBioimagingPreviewInput = z.input<typeof workspaceBioimagingPreviewInputSchema>
export type NormalizedWorkspaceBioimagingPreviewInput = z.output<typeof workspaceBioimagingPreviewInputSchema>
export type WorkspaceBioimagingPreviewResult = z.infer<typeof workspaceBioimagingPreviewResultSchema>
export type WorkspaceBioimagingRegionSelectionInput = z.input<typeof workspaceBioimagingRegionSelectionInputSchema>
export type NormalizedWorkspaceBioimagingRegionSelectionInput = z.output<typeof workspaceBioimagingRegionSelectionInputSchema>
export type WorkspaceBioimagingRegionSelectionResult = z.infer<typeof workspaceBioimagingRegionSelectionResultSchema>
export type WorkspaceBioimagingChannelSelectionInput = z.input<typeof workspaceBioimagingChannelSelectionInputSchema>
export type NormalizedWorkspaceBioimagingChannelSelectionInput = z.output<typeof workspaceBioimagingChannelSelectionInputSchema>
export type WorkspaceBioimagingChannelSelectionResult = z.infer<typeof workspaceBioimagingChannelSelectionResultSchema>
export type WorkspaceBioimagingRoiAnnotation = z.infer<typeof workspaceBioimagingRoiAnnotationSchema>
export type WorkspaceBioimagingRegionAnnotationInput = z.input<typeof workspaceBioimagingRegionAnnotationInputSchema>
export type NormalizedWorkspaceBioimagingRegionAnnotationInput = z.output<typeof workspaceBioimagingRegionAnnotationInputSchema>
export type WorkspaceBioimagingRegionAnnotationResult = z.infer<typeof workspaceBioimagingRegionAnnotationResultSchema>
export type WorkspaceBioimagingRoiSet = z.infer<typeof workspaceBioimagingRoiSetSchema>
export type WorkspaceBioimagingRoiSetExportInput = z.input<typeof workspaceBioimagingRoiSetExportInputSchema>
export type NormalizedWorkspaceBioimagingRoiSetExportInput = z.output<typeof workspaceBioimagingRoiSetExportInputSchema>
export type WorkspaceBioimagingRoiSetExportResult = z.infer<typeof workspaceBioimagingRoiSetExportResultSchema>

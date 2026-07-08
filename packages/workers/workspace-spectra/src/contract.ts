import { z } from 'zod'

export const WORKSPACE_SPECTRA_CONTRACT_VERSION = 1
export const WORKSPACE_PREVIEW_CONTRACT_VERSION = 1
export const WORKSPACE_SPECTRA_PACKAGE_NAME = '@sciforge/workspace-spectra'
export const WORKSPACE_SPECTRA_PLUGIN_ID = 'spectra'

export const WORKSPACE_SPECTRA_MAX_TEXT_CHARS = 2_000_000
export const WORKSPACE_SPECTRA_MAX_ITEMS = 10_000
export const WORKSPACE_SPECTRA_MAX_VISIBLE_TEXT_CHARS = 200_000
export const WORKSPACE_SPECTRA_MAX_WARNINGS = 20

export const WORKSPACE_SPECTRA_ACTIONS = [
  'spectra.preview',
  'spectra.inspectScans',
  'spectra.selectPeaksByRange',
  'spectra.annotateRange',
  'spectra.exportPeakList'
] as const

const pathSchema = z.string().trim().min(1).max(4096)
const optionalPathSchema = z.string().trim().max(4096).optional()
const mimeTypeSchema = z.string().trim().max(128)
const boundedTextSchema = z.string().trim().min(1).max(1000)
const boundedOptionalTextSchema = z.string().trim().min(1).max(1000).optional()
const boundedWarningSchema = z.string().trim().min(1).max(1000)

export const workspaceSpectraFormatSchema = z.enum(['auto', 'mgf', 'mzml', 'mzxml', 'fcs'])
export const workspaceSpectraResolvedFormatSchema = z.enum(['mgf', 'mzml', 'mzxml', 'fcs', 'unknown'])

export const workspaceSpectraPreviewInputSchema = z.object({
  text: z.string().max(WORKSPACE_SPECTRA_MAX_TEXT_CHARS),
  format: workspaceSpectraFormatSchema.default('auto'),
  includeObservation: z.boolean().default(true),
  path: optionalPathSchema,
  workspaceRoot: optionalPathSchema,
  mimeType: mimeTypeSchema.optional(),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional()
}).strict()

export const workspaceSpectraNumericRangeSchema = z.object({
  min: z.number().finite().nonnegative(),
  max: z.number().finite().nonnegative()
}).strict().superRefine((range, context) => {
  if (range.max < range.min) {
    context.addIssue({
      code: 'custom',
      message: 'range max must be greater than or equal to min'
    })
  }
})

export const workspaceSpectraPeakSampleSchema = z.object({
  spectrumIndex: z.number().int().nonnegative().optional(),
  scanIndex: z.number().int().nonnegative().optional(),
  peakIndex: z.number().int().nonnegative().optional(),
  mz: z.number().finite().nonnegative(),
  intensity: z.number().finite().nonnegative(),
  label: boundedOptionalTextSchema
}).strict()

export const workspaceMgfSpectrumSummarySchema = z.object({
  index: z.number().int().nonnegative(),
  title: boundedOptionalTextSchema,
  precursorMz: z.number().finite().nonnegative().optional(),
  charge: boundedOptionalTextSchema,
  peakCount: z.number().int().nonnegative(),
  mzRange: workspaceSpectraNumericRangeSchema.optional(),
  intensityRange: workspaceSpectraNumericRangeSchema.optional()
}).strict()

export const workspaceSpectraScanMarkerSchema = z.object({
  index: z.number().int().nonnegative(),
  id: boundedOptionalTextSchema,
  scanNumber: boundedOptionalTextSchema,
  msLevel: boundedOptionalTextSchema,
  peakCount: z.number().int().nonnegative().optional(),
  mzRange: workspaceSpectraNumericRangeSchema.optional(),
  intensityRange: workspaceSpectraNumericRangeSchema.optional()
}).strict()

export const workspaceFcsSegmentOffsetsSchema = z.object({
  textStartByte: z.number().int().nonnegative().optional(),
  textEndByte: z.number().int().nonnegative().optional(),
  dataStartByte: z.number().int().nonnegative().optional(),
  dataEndByte: z.number().int().nonnegative().optional(),
  analysisStartByte: z.number().int().nonnegative().optional(),
  analysisEndByte: z.number().int().nonnegative().optional()
}).strict()

export const workspaceFcsKeywordSummarySchema = z.object({
  key: z.string().trim().min(1).max(64),
  value: z.string().trim().min(1).max(256)
}).strict()

export const workspaceFcsEventAxisSchema = z.object({
  index: z.number().int().positive(),
  name: boundedOptionalTextSchema,
  label: boundedOptionalTextSchema,
  range: workspaceSpectraNumericRangeSchema.optional()
}).strict()

export const workspaceFcsGatingPlaceholderSchema = z.object({
  status: z.literal('placeholder'),
  implemented: z.literal(false),
  axes: z.array(boundedTextSchema).max(64),
  notes: z.array(boundedTextSchema).max(16)
}).strict()

export const workspaceFcsPlaceholderMetadataSchema = z.object({
  metadataStatus: z.literal('placeholder'),
  binaryParsing: z.literal(false),
  version: boundedOptionalTextSchema,
  totalEvents: z.number().int().nonnegative().optional(),
  parameterCount: z.number().int().nonnegative().optional(),
  segmentOffsets: workspaceFcsSegmentOffsetsSchema.optional(),
  keywords: z.array(workspaceFcsKeywordSummarySchema).max(64),
  eventAxes: z.array(workspaceFcsEventAxisSchema).max(64).optional(),
  gating: workspaceFcsGatingPlaceholderSchema.optional(),
  notes: z.array(boundedTextSchema).max(16)
}).strict()

export const workspaceSpectraSelectionSchema = z.object({
  kind: z.literal('spectra'),
  ranges: z.array(z.object({
    xStart: z.number().finite(),
    xEnd: z.number().finite(),
    yStart: z.number().finite().optional(),
    yEnd: z.number().finite().optional()
  }).strict()).min(1).max(WORKSPACE_SPECTRA_MAX_ITEMS),
  peaks: z.array(z.object({
    mz: z.number().finite().optional(),
    intensity: z.number().finite().optional(),
    label: z.string().trim().max(128).optional()
  }).strict()).max(WORKSPACE_SPECTRA_MAX_ITEMS).optional()
}).strict()

export const workspaceSpectraObservationSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_PREVIEW_CONTRACT_VERSION),
  file: z.object({
    path: pathSchema,
    workspaceRoot: optionalPathSchema,
    mimeType: mimeTypeSchema.optional(),
    size: z.number().finite().nonnegative().optional(),
    mtimeMs: z.number().finite().nonnegative().optional()
  }).strict(),
  view: z.object({
    pluginId: z.literal(WORKSPACE_SPECTRA_PLUGIN_ID),
    modality: z.literal('spectra'),
    mode: z.literal('preview'),
    title: z.string().trim().min(1).max(512)
  }).strict(),
  selection: workspaceSpectraSelectionSchema.optional(),
  visibleText: z.string().max(WORKSPACE_SPECTRA_MAX_VISIBLE_TEXT_CHARS).optional(),
  spectra: z.object({
    format: workspaceSpectraResolvedFormatSchema,
    spectrumCount: z.number().int().nonnegative(),
    peakCount: z.number().int().nonnegative(),
    scanCount: z.number().int().nonnegative(),
    xAxis: z.string().trim().max(128).optional(),
    mzRange: workspaceSpectraNumericRangeSchema.optional(),
    intensityRange: workspaceSpectraNumericRangeSchema.optional(),
    sampledPeaks: z.array(workspaceSpectraPeakSampleSchema).max(WORKSPACE_SPECTRA_MAX_ITEMS).optional(),
    scanMarkers: z.array(workspaceSpectraScanMarkerSchema).max(WORKSPACE_SPECTRA_MAX_ITEMS).optional(),
    fcs: workspaceFcsPlaceholderMetadataSchema.optional()
  }).strict(),
  annotations: z.array(z.object({
    id: z.string().trim().min(1).max(256),
    kind: z.string().trim().min(1).max(128),
    summary: z.string().trim().max(1000).optional()
  }).strict()).max(1000).optional(),
  actions: z.array(z.string().trim().min(1).max(128)).max(256)
}).strict()

export const workspaceSpectraPreviewResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_SPECTRA_CONTRACT_VERSION),
  format: workspaceSpectraResolvedFormatSchema,
  spectrumCount: z.number().int().nonnegative(),
  peakCount: z.number().int().nonnegative(),
  scanCount: z.number().int().nonnegative(),
  mzRange: workspaceSpectraNumericRangeSchema.optional(),
  intensityRange: workspaceSpectraNumericRangeSchema.optional(),
  spectra: z.array(workspaceMgfSpectrumSummarySchema).max(WORKSPACE_SPECTRA_MAX_ITEMS),
  scanMarkers: z.array(workspaceSpectraScanMarkerSchema).max(WORKSPACE_SPECTRA_MAX_ITEMS),
  sampledPeaks: z.array(workspaceSpectraPeakSampleSchema).max(WORKSPACE_SPECTRA_MAX_ITEMS),
  fcs: workspaceFcsPlaceholderMetadataSchema.optional(),
  warnings: z.array(boundedWarningSchema).max(WORKSPACE_SPECTRA_MAX_WARNINGS),
  observation: workspaceSpectraObservationSchema.optional()
}).strict()

export const workspaceSpectraPeakSelectionRangeSchema = z.object({
  mzMin: z.number().finite().nonnegative().optional(),
  mzMax: z.number().finite().nonnegative().optional(),
  intensityMin: z.number().finite().nonnegative().optional(),
  intensityMax: z.number().finite().nonnegative().optional(),
  spectrumIndexes: z.array(z.number().int().nonnegative()).max(WORKSPACE_SPECTRA_MAX_ITEMS).optional()
}).strict().superRefine((range, context) => {
  if (range.mzMin !== undefined && range.mzMax !== undefined && range.mzMax < range.mzMin) {
    context.addIssue({
      code: 'custom',
      message: 'mzMax must be greater than or equal to mzMin'
    })
  }
  if (range.intensityMin !== undefined && range.intensityMax !== undefined && range.intensityMax < range.intensityMin) {
    context.addIssue({
      code: 'custom',
      message: 'intensityMax must be greater than or equal to intensityMin'
    })
  }
})

export const workspaceSpectraSelectPeaksByRangeInputSchema = z.object({
  peaks: z.array(workspaceSpectraPeakSampleSchema).max(WORKSPACE_SPECTRA_MAX_ITEMS),
  range: workspaceSpectraPeakSelectionRangeSchema.default({}),
  maxPeaks: z.number().int().min(0).max(WORKSPACE_SPECTRA_MAX_ITEMS).default(WORKSPACE_SPECTRA_MAX_ITEMS)
}).strict()

export const workspaceSpectraPeakSelectionResultSchema = z.object({
  peakCount: z.number().int().nonnegative(),
  peaks: z.array(workspaceSpectraPeakSampleSchema).max(WORKSPACE_SPECTRA_MAX_ITEMS),
  mzRange: workspaceSpectraNumericRangeSchema.optional(),
  intensityRange: workspaceSpectraNumericRangeSchema.optional(),
  truncated: z.boolean()
}).strict()

export const workspaceSpectraAnnotationRangeSchema = z.object({
  mzMin: z.number().finite().nonnegative().optional(),
  mzMax: z.number().finite().nonnegative().optional(),
  intensityMin: z.number().finite().nonnegative().optional(),
  intensityMax: z.number().finite().nonnegative().optional(),
  eventMin: z.number().int().nonnegative().optional(),
  eventMax: z.number().int().nonnegative().optional(),
  spectrumIndexes: z.array(z.number().int().nonnegative()).max(WORKSPACE_SPECTRA_MAX_ITEMS).optional(),
  scanIndexes: z.array(z.number().int().nonnegative()).max(WORKSPACE_SPECTRA_MAX_ITEMS).optional(),
  axes: z.array(boundedTextSchema).max(64).optional()
}).strict().superRefine((range, context) => {
  if (range.mzMin !== undefined && range.mzMax !== undefined && range.mzMax < range.mzMin) {
    context.addIssue({
      code: 'custom',
      message: 'mzMax must be greater than or equal to mzMin'
    })
  }
  if (range.intensityMin !== undefined && range.intensityMax !== undefined && range.intensityMax < range.intensityMin) {
    context.addIssue({
      code: 'custom',
      message: 'intensityMax must be greater than or equal to intensityMin'
    })
  }
  if (range.eventMin !== undefined && range.eventMax !== undefined && range.eventMax < range.eventMin) {
    context.addIssue({
      code: 'custom',
      message: 'eventMax must be greater than or equal to eventMin'
    })
  }
})

export const workspaceSpectraRangeAnnotationKindSchema = z.enum([
  'peak-range',
  'scan-range',
  'population-gate',
  'range'
])

export const workspaceSpectraFcsPopulationAnnotationSchema = z.object({
  status: z.literal('placeholder'),
  binaryParsing: z.literal(false),
  axes: z.array(boundedTextSchema).max(64),
  eventRange: workspaceSpectraNumericRangeSchema.optional(),
  estimatedEventCount: z.number().int().nonnegative().optional(),
  notes: z.array(boundedTextSchema).max(16)
}).strict()

export const workspaceSpectraRangeAnnotationSummarySchema = z.object({
  id: z.string().trim().min(1).max(256),
  kind: workspaceSpectraRangeAnnotationKindSchema,
  label: boundedTextSchema,
  body: z.string().trim().max(4000).optional(),
  range: workspaceSpectraAnnotationRangeSchema,
  source: z.object({
    format: workspaceSpectraResolvedFormatSchema,
    spectrumCount: z.number().int().nonnegative(),
    peakCount: z.number().int().nonnegative(),
    scanCount: z.number().int().nonnegative()
  }).strict(),
  peakCount: z.number().int().nonnegative(),
  scanCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative().optional(),
  sampledOnly: z.boolean(),
  bounded: z.boolean(),
  fcsPopulation: workspaceSpectraFcsPopulationAnnotationSchema.optional(),
  summary: z.string().trim().min(1).max(1000)
}).strict()

export const workspaceSpectraAnnotateRangeInputSchema = z.object({
  preview: workspaceSpectraPreviewResultSchema,
  range: workspaceSpectraAnnotationRangeSchema.default({}),
  label: boundedTextSchema.default('Spectra annotation'),
  body: z.string().trim().max(4000).optional(),
  maxPeaks: z.number().int().min(0).max(WORKSPACE_SPECTRA_MAX_ITEMS).default(1000),
  maxScanMarkers: z.number().int().min(0).max(WORKSPACE_SPECTRA_MAX_ITEMS).default(1000)
}).strict()

export const workspaceSpectraAnnotateRangeResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_SPECTRA_CONTRACT_VERSION),
  annotationSummary: workspaceSpectraRangeAnnotationSummarySchema,
  selection: workspaceSpectraSelectionSchema,
  peaks: z.array(workspaceSpectraPeakSampleSchema).max(WORKSPACE_SPECTRA_MAX_ITEMS),
  scanMarkers: z.array(workspaceSpectraScanMarkerSchema).max(WORKSPACE_SPECTRA_MAX_ITEMS),
  visibleText: z.string().max(WORKSPACE_SPECTRA_MAX_VISIBLE_TEXT_CHARS),
  warnings: z.array(boundedWarningSchema).max(WORKSPACE_SPECTRA_MAX_WARNINGS)
}).strict()

export const workspaceSpectraExportPeakListFormatSchema = z.enum(['csv', 'tsv', 'json'])

export const workspaceSpectraExportPeakListInputSchema = z.object({
  preview: workspaceSpectraPreviewResultSchema,
  range: workspaceSpectraPeakSelectionRangeSchema.default({}),
  format: workspaceSpectraExportPeakListFormatSchema.default('csv'),
  maxPeaks: z.number().int().min(0).max(WORKSPACE_SPECTRA_MAX_ITEMS).default(WORKSPACE_SPECTRA_MAX_ITEMS),
  includeHeader: z.boolean().default(true)
}).strict()

export const workspaceSpectraExportPeakListSummarySchema = z.object({
  sourceFormat: workspaceSpectraResolvedFormatSchema,
  sampledOnly: z.literal(true),
  bounded: z.literal(true),
  sourcePeakCount: z.number().int().nonnegative(),
  totalSampledPeakCount: z.number().int().nonnegative(),
  selectedSampledPeakCount: z.number().int().nonnegative(),
  exportedPeakCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  range: workspaceSpectraPeakSelectionRangeSchema,
  peaks: z.array(workspaceSpectraPeakSampleSchema).max(WORKSPACE_SPECTRA_MAX_ITEMS)
}).strict()

export const workspaceSpectraExportPeakListResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_SPECTRA_CONTRACT_VERSION),
  format: workspaceSpectraExportPeakListFormatSchema,
  sampledOnly: z.literal(true),
  bounded: z.literal(true),
  text: z.string().max(WORKSPACE_SPECTRA_MAX_TEXT_CHARS).optional(),
  summary: workspaceSpectraExportPeakListSummarySchema,
  warnings: z.array(boundedWarningSchema).max(WORKSPACE_SPECTRA_MAX_WARNINGS)
}).strict()

export type WorkspaceSpectraFormat = z.infer<typeof workspaceSpectraFormatSchema>
export type WorkspaceSpectraResolvedFormat = z.infer<typeof workspaceSpectraResolvedFormatSchema>
export type WorkspaceSpectraPreviewInput = z.input<typeof workspaceSpectraPreviewInputSchema>
export type NormalizedWorkspaceSpectraPreviewInput = z.output<typeof workspaceSpectraPreviewInputSchema>
export type WorkspaceSpectraNumericRange = z.infer<typeof workspaceSpectraNumericRangeSchema>
export type WorkspaceSpectraPeakSample = z.infer<typeof workspaceSpectraPeakSampleSchema>
export type WorkspaceMgfSpectrumSummary = z.infer<typeof workspaceMgfSpectrumSummarySchema>
export type WorkspaceSpectraScanMarker = z.infer<typeof workspaceSpectraScanMarkerSchema>
export type WorkspaceFcsEventAxis = z.infer<typeof workspaceFcsEventAxisSchema>
export type WorkspaceFcsPlaceholderMetadata = z.infer<typeof workspaceFcsPlaceholderMetadataSchema>
export type WorkspaceSpectraSelection = z.infer<typeof workspaceSpectraSelectionSchema>
export type WorkspaceSpectraObservation = z.infer<typeof workspaceSpectraObservationSchema>
export type WorkspaceSpectraPreviewResult = z.infer<typeof workspaceSpectraPreviewResultSchema>
export type WorkspaceSpectraPeakSelectionRange = z.input<typeof workspaceSpectraPeakSelectionRangeSchema>
export type WorkspaceSpectraSelectPeaksByRangeInput = z.input<typeof workspaceSpectraSelectPeaksByRangeInputSchema>
export type WorkspaceSpectraPeakSelectionResult = z.infer<typeof workspaceSpectraPeakSelectionResultSchema>
export type WorkspaceSpectraAnnotationRange = z.input<typeof workspaceSpectraAnnotationRangeSchema>
export type WorkspaceSpectraRangeAnnotationKind = z.infer<typeof workspaceSpectraRangeAnnotationKindSchema>
export type WorkspaceSpectraFcsPopulationAnnotation = z.infer<typeof workspaceSpectraFcsPopulationAnnotationSchema>
export type WorkspaceSpectraRangeAnnotationSummary = z.infer<typeof workspaceSpectraRangeAnnotationSummarySchema>
export type WorkspaceSpectraAnnotateRangeInput = z.input<typeof workspaceSpectraAnnotateRangeInputSchema>
export type WorkspaceSpectraAnnotateRangeResult = z.infer<typeof workspaceSpectraAnnotateRangeResultSchema>
export type WorkspaceSpectraExportPeakListFormat = z.infer<typeof workspaceSpectraExportPeakListFormatSchema>
export type WorkspaceSpectraExportPeakListInput = z.input<typeof workspaceSpectraExportPeakListInputSchema>
export type WorkspaceSpectraExportPeakListSummary = z.infer<typeof workspaceSpectraExportPeakListSummarySchema>
export type WorkspaceSpectraExportPeakListResult = z.infer<typeof workspaceSpectraExportPeakListResultSchema>

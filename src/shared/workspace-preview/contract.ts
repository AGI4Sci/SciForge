import { z } from 'zod'

export const WORKSPACE_PREVIEW_CONTRACT_VERSION = 1
export const WORKSPACE_PREVIEW_MAX_EXTENSIONS = 64
export const WORKSPACE_PREVIEW_MAX_MIME_TYPES = 64
export const WORKSPACE_PREVIEW_MAX_TEXT_CHARS = 2_000_000
export const WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS = 200_000
export const WORKSPACE_PREVIEW_MAX_DECK_TEXT_ELEMENT_CHARS = 2_000
export const WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS = 10_000
export const WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS = 1_000
export const WORKSPACE_PREVIEW_MAX_RANGE_BYTES = 50 * 1024 * 1024
export const WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES = 8 * 1024 * 1024
export const WORKSPACE_PREVIEW_MAX_ARTIFACT_BYTES = 1024 * 1024
export const WORKSPACE_PREVIEW_MAX_IMPORT_PACKAGE_BASE64_CHARS = 160_000_000
export const WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_ITEMS = 20
export const WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_CHARS = 4_000
export const WORKSPACE_PREVIEW_MAX_TRANSFER_ITEMS = 512
export const WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS = 80_000
export const WORKSPACE_PREVIEW_MAX_ANNOTATION_CONTEXT_CHARS = 2_000
export const WORKSPACE_PREVIEW_MAX_ANNOTATION_RECTS = 800
export const WORKSPACE_PREVIEW_MAX_PLUGIN_METADATA_STRING_CHARS = 32_000
export const WORKSPACE_PREVIEW_DRAG_SOURCE_MIME = 'application/vnd.sciforge.workspace-preview.drag-source+json'
export const WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_EXTENSIONS = [
  '.txt',
  '.text',
  '.log',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.env',
  '.sh',
  '.py',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.sql',
  '.tex',
  '.bib'
] as const
export const WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_FILE_NAMES = [
  '.env',
  '.gitignore',
  '.dockerignore',
  'dockerfile',
  'makefile'
] as const
export const WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_FILE_PREFIXES = [
  '.env.'
] as const
export const WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_MIME_TYPES = [
  'text/plain',
  'application/json',
  'application/xml',
  'text/xml',
  'application/yaml',
  'text/yaml'
] as const
export const WORKSPACE_PREVIEW_FIRST_PARTY_MARKDOWN_MIME_TYPES = ['text/markdown', 'text/x-markdown'] as const
export const WORKSPACE_PREVIEW_FIRST_PARTY_PDF_MIME_TYPES = ['application/pdf', 'application/x-pdf'] as const
export const WORKSPACE_PREVIEW_FIRST_PARTY_IMAGE_EXPORT_FORMATS = ['png', 'jpg', 'jpeg', 'webp'] as const
export const WORKSPACE_PREVIEW_FIRST_PARTY_TABULAR_SHELL_EXTENSIONS = ['.csv', '.tsv', '.jsonl', '.ndjson', '.xlsx'] as const
export const WORKSPACE_PREVIEW_DELIMITED_TABULAR_EDIT_EXTENSIONS = ['.csv', '.tsv'] as const
export const WORKSPACE_PREVIEW_DECK_TEXT_ELEMENT_KINDS = [
  'title',
  'subtitle',
  'body',
  'notes',
  'placeholder',
  'text'
] as const
export const WORKSPACE_PREVIEW_ANNOTATION_KINDS = [
  'highlight',
  'comment',
  'note',
  'translation',
  'question',
  'answer'
] as const
export const WORKSPACE_PREVIEW_ANNOTATION_DOCUMENT_KINDS = ['pdf', 'docx'] as const
export const WORKSPACE_PREVIEW_ANNOTATION_ANCHOR_KINDS = ['text', 'image', 'visual'] as const
export const WORKSPACE_PREVIEW_ANNOTATION_THREAD_STATUSES = ['open', 'resolved'] as const
export const TEXT_WORKSPACE_PREVIEW_PLUGIN_ID = 'text'
export const MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID = 'markdown'
export const HTML_WORKSPACE_PREVIEW_PLUGIN_ID = 'html'
export const IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID = 'image'
export const PDF_WORKSPACE_PREVIEW_PLUGIN_ID = 'pdf'
export const DOCX_WORKSPACE_PREVIEW_PLUGIN_ID = 'docx'
export const TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID = 'tabular'
export const DECK_WORKSPACE_PREVIEW_PLUGIN_ID = 'deck'

export const WORKSPACE_PREVIEW_AGENT_ACCESS = {
  observe: true,
  select: true,
  proposeEdit: true,
  applyEdit: true,
  save: true
} as const

export const workspacePreviewModalitySchema = z.enum([
  'text',
  'document',
  'image',
  'tabular',
  'deck',
  'molecular',
  'sequence',
  'omics',
  'bioimaging',
  'spectra',
  'unknown'
])

export type WorkspacePreviewModality = z.infer<typeof workspacePreviewModalitySchema>

export const workspacePreviewLifecycleSchema = z.enum([
  'renderer',
  'main',
  'worker',
  'hybrid'
])

export type WorkspacePreviewLifecycle = z.infer<typeof workspacePreviewLifecycleSchema>

export const workspacePreviewCapabilitySchema = z.object({
  preview: z.boolean(),
  edit: z.boolean(),
  inspect: z.boolean(),
  structuredSelection: z.boolean(),
  annotations: z.boolean().optional(),
  export: z.array(z.string().trim().min(1).max(64)).max(32).optional(),
  agent: z.object({
    observe: z.literal(true),
    select: z.literal(true),
    proposeEdit: z.literal(true),
    applyEdit: z.literal(true),
    save: z.literal(true)
  }).strict().default(WORKSPACE_PREVIEW_AGENT_ACCESS)
}).strict()

export type WorkspacePreviewCapability = z.infer<typeof workspacePreviewCapabilitySchema>

export const workspacePreviewPluginManifestSchema = z.object({
  contractVersion: z.literal(WORKSPACE_PREVIEW_CONTRACT_VERSION),
  id: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(128),
  version: z.string().trim().min(1).max(64),
  modality: workspacePreviewModalitySchema,
  lifecycle: workspacePreviewLifecycleSchema,
  priority: z.number().int().min(0).max(10_000).default(100),
  extensions: z.array(z.string().trim().min(1).max(64)).max(WORKSPACE_PREVIEW_MAX_EXTENSIONS).default([]),
  mimeTypes: z.array(z.string().trim().min(1).max(128)).max(WORKSPACE_PREVIEW_MAX_MIME_TYPES).default([]),
  capabilities: workspacePreviewCapabilitySchema,
  workerPackage: z.string().trim().min(1).max(256).optional(),
  rendererModule: z.string().trim().min(1).max(512).optional(),
  notes: z.string().trim().max(1000).optional()
}).strict()

export type WorkspacePreviewPluginManifest = z.infer<typeof workspacePreviewPluginManifestSchema>

export type WorkspacePreviewSession = {
  id: string
  pluginId: string
  workspaceRoot: string
  path: string
  modality: WorkspacePreviewModality
  mode: 'preview' | 'edit' | 'inspect'
  openedAt: string
  updatedAt: string
  mtimeMs?: number
  selection?: WorkspaceStructuredSelection
}

export type WorkspacePreviewDocumentRect = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export type WorkspacePreviewAnchor =
  | {
      kind: 'text'
      line: number
      column?: number
      endLine?: number
      endColumn?: number
    }
  | {
      kind: 'document'
      id?: string
      page?: number
      paragraphIndex?: number
      quote?: string
      rects?: WorkspacePreviewDocumentRect[]
    }
  | {
      kind: 'tabular'
      sheet?: string
      /** Source/evidence row ordinals are 1-based by default; use 0 for legacy viewer indices. */
      rowIndexBase?: 0 | 1
      /** Columns are viewer indices by default because SourceSelector exposes names, not indices. */
      columnIndexBase?: 0 | 1
      rowStart: number
      rowEnd: number
      columnStart: number
      columnEnd: number
    }

export type WorkspacePreviewIntegrityExpectation = {
  algorithm: 'sha256'
  expectedDigest: string
}

export type WorkspacePreviewIntegrityVerification = WorkspacePreviewIntegrityExpectation & {
  actualDigest: string
  verified: true
}

export type WorkspaceStructuredSelection =
  | {
      kind: 'text'
      ranges: Array<{ startLine: number; startColumn: number; endLine: number; endColumn: number; text?: string }>
    }
  | {
      kind: 'tabular'
      sheet?: string
      ranges: Array<{ rowStart: number; rowEnd: number; columnStart: number; columnEnd: number }>
      cells?: Array<{ row: number; column: number; value?: unknown }>
    }
  | {
      kind: 'document'
      anchors: Array<{
        id: string
        page?: number
        paragraphIndex?: number
        quote?: string
        rects?: WorkspacePreviewDocumentRect[]
      }>
    }
  | {
      kind: 'deck'
      slideIds: string[]
      elementIds?: string[]
    }
  | {
      kind: 'molecular'
      chains?: string[]
      residues?: Array<{ chain?: string; index: number; insertionCode?: string; name?: string }>
      atoms?: Array<{ id?: string; index?: number; element?: string }>
      ligands?: string[]
    }
  | {
      kind: 'sequence'
      sequenceId?: string
      ranges: Array<{ start: number; end: number; strand?: '+' | '-' }>
      features?: Array<{ id?: string; type: string; start: number; end: number }>
    }
  | {
      kind: 'omics'
      matrixIds?: string[]
      obsKeys?: string[]
      varKeys?: string[]
      embeddings?: string[]
      ranges?: Array<{
        matrixId: string
        matrixName?: string
        axis: 'obs' | 'var' | 'row' | 'column'
        start: number
        end: number
        axisLength?: number
        clipped?: boolean
      }>
    }
  | {
      kind: 'bioimaging'
      roiIds?: string[]
      channels?: string[]
      regions?: Array<{ x: number; y: number; width: number; height: number; z?: number; t?: number }>
    }
  | {
      kind: 'spectra'
      ranges: Array<{ xStart: number; xEnd: number; yStart?: number; yEnd?: number }>
      peaks?: Array<{ mz?: number; intensity?: number; label?: string }>
    }

export type WorkspaceDeckObservationTextElementKind = typeof WORKSPACE_PREVIEW_DECK_TEXT_ELEMENT_KINDS[number]

export type WorkspacePreviewAnnotationKind = typeof WORKSPACE_PREVIEW_ANNOTATION_KINDS[number]
export type WorkspacePreviewAnnotationDocumentKind = typeof WORKSPACE_PREVIEW_ANNOTATION_DOCUMENT_KINDS[number]
export type WorkspacePreviewAnnotationAnchorKind = typeof WORKSPACE_PREVIEW_ANNOTATION_ANCHOR_KINDS[number]
export type WorkspacePreviewAnnotationThreadStatus = typeof WORKSPACE_PREVIEW_ANNOTATION_THREAD_STATUSES[number]

export type WorkspaceDeckObservationTextElement = {
  slideId: string
  elementId: string
  kind: WorkspaceDeckObservationTextElementKind
  text: string
}

export type WorkspaceDeckObservationSlidePreviewTextBox = {
  elementId: string
  kind: WorkspaceDeckObservationTextElementKind
  text: string
  x?: number
  y?: number
  width?: number
  height?: number
}

export type WorkspaceDeckObservationSlidePreview = {
  slideId: string
  index: number
  width: number
  height: number
  textBoxes?: WorkspaceDeckObservationSlidePreviewTextBox[]
  truncatedTextBoxes?: boolean
}

export type WorkspaceSequenceObservationReference = {
  id: string
  sequenceLength?: number
  featureCount?: number
  intervalCount?: number
  variantCount?: number
}

export type WorkspaceSequenceObservationFeature = {
  id?: string
  reference: string
  type: string
  start: number
  end: number
  strand?: '+' | '-'
}

export type WorkspaceSequenceObservationIndexedRange = {
  kind: 'sequence' | 'read' | 'reference' | 'feature' | 'interval' | 'variant'
  reference: string
  start: number
  end: number
  id?: string
  type?: string
  strand?: '+' | '-'
}

export type WorkspacePreviewJsonValue =
  | null
  | boolean
  | number
  | string
  | WorkspacePreviewJsonValue[]
  | { [key: string]: WorkspacePreviewJsonValue }

export type WorkspacePreviewPluginMetadataItem = {
  source: 'plugin-metadata'
  metadataKind: string
  mimeType?: string
  metadataOnly: true
  containsPixels: false
  pixelDecoding?: false
  data: WorkspacePreviewJsonValue
  selection?: WorkspaceStructuredSelection
  actions?: string[]
}

export type WorkspaceObservation = {
  schemaVersion: typeof WORKSPACE_PREVIEW_CONTRACT_VERSION
  file: {
    path: string
    workspaceRoot?: string
    mimeType?: string
    size?: number
    mtimeMs?: number
  }
  view: {
    pluginId: string
    modality: WorkspacePreviewModality
    mode: 'preview' | 'edit' | 'inspect'
    title: string
  }
  selection?: WorkspaceStructuredSelection
  visibleText?: string
  outline?: Array<{ id: string; title: string; level?: number; page?: number }>
  document?: {
    paragraphs?: Array<{ id: string; index: number; text: string; style?: string }>
    truncatedParagraphs?: boolean
  }
  tables?: Array<{ id: string; name?: string; rowCount?: number; columnCount?: number }>
  tabular?: {
    header?: string[]
    rows?: Array<{ index: number; values: string[] }>
    truncatedRows?: boolean
    truncatedColumns?: boolean
  }
  text?: {
    lineCount?: number
    characterCount?: number
    truncated?: boolean
  }
  slides?: Array<{ id: string; index: number; title?: string; notes?: string }>
  deck?: {
    textElementCount?: number
    truncatedTextElements?: boolean
    textElements?: WorkspaceDeckObservationTextElement[]
    slidePreviews?: WorkspaceDeckObservationSlidePreview[]
  }
  molecular?: {
    modelCount?: number
    chains?: string[]
    ligands?: string[]
    representations?: string[]
  }
  sequence?: {
    sequenceCount?: number
    totalLength?: number
    alphabet?: 'dna' | 'rna' | 'protein' | 'unknown'
    references?: WorkspaceSequenceObservationReference[]
    features?: WorkspaceSequenceObservationFeature[]
    indexedRanges?: WorkspaceSequenceObservationIndexedRange[]
    truncatedRecords?: boolean
    truncatedReferences?: boolean
  }
  omics?: {
    format?: string
    matrixShape?: [number, number]
    matrixIds?: string[]
    observationCount?: number
    variableCount?: number
    obsKeys?: string[]
    varKeys?: string[]
    embeddings?: string[]
    metadataKeys?: string[]
  }
  bioimaging?: {
    format?: string
    detectedBy?: string
    byteLength?: number
    channels?: string[]
    dimensions?: { width: number; height: number; z?: number; t?: number }
    tilePlan?: {
      status?: string
      source?: string
      levelCount?: number
      tileSize?: { width: number; height: number }
      pixelDecoding?: boolean
      tileRendererImplemented?: boolean
    }
  }
  spectra?: {
    format?: string
    spectrumCount?: number
    peakCount?: number
    scanCount?: number
    xAxis?: string
    mzRange?: { min: number; max: number }
    intensityRange?: { min: number; max: number }
    sampledPeaks?: Array<{ mz: number; intensity: number; label?: string; spectrumIndex?: number; scanIndex?: number; peakIndex?: number }>
    scanMarkers?: Array<{ index: number; id?: string; scanNumber?: string; msLevel?: string; peakCount?: number; mzRange?: { min: number; max: number }; intensityRange?: { min: number; max: number } }>
  }
  annotations?: Array<{ id: string; kind: string; summary?: string }>
  pluginMetadata?: WorkspacePreviewPluginMetadataItem[]
  actions: string[]
}

const positionSchema = z.object({
  line: z.number().int().min(1),
  column: z.number().int().min(1)
}).strict()

const boundedString = (max: number): z.ZodString => z.string().max(max)
const pathSchema = z.string().trim().min(1).max(4096)
const optionalPathSchema = z.string().trim().max(4096).optional()
const idSchema = z.string().trim().min(1).max(256)
const optionalShortStringSchema = z.string().trim().max(256).optional()

export const workspacePreviewAnnotationKindSchema = z.enum(WORKSPACE_PREVIEW_ANNOTATION_KINDS)
export const workspacePreviewAnnotationDocumentKindSchema = z.enum(WORKSPACE_PREVIEW_ANNOTATION_DOCUMENT_KINDS)
export const workspacePreviewAnnotationAnchorKindSchema = z.enum(WORKSPACE_PREVIEW_ANNOTATION_ANCHOR_KINDS)
export const workspacePreviewAnnotationThreadStatusSchema = z.enum(WORKSPACE_PREVIEW_ANNOTATION_THREAD_STATUSES)

export const workspacePreviewAnnotationAnchorRectSchema = z.object({
  page: z.number().int().positive().max(1_000_000),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().gt(0).max(1),
  height: z.number().finite().gt(0).max(1)
}).strict()

export const workspacePreviewAnnotationUpsertTargetSchema = z.object({
  documentKind: workspacePreviewAnnotationDocumentKindSchema.optional(),
  threadId: idSchema.optional(),
  anchor: z.object({
    id: idSchema,
    kind: workspacePreviewAnnotationAnchorKindSchema.optional(),
    quote: boundedString(WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS).optional(),
    contextBefore: boundedString(WORKSPACE_PREVIEW_MAX_ANNOTATION_CONTEXT_CHARS).optional(),
    contextAfter: boundedString(WORKSPACE_PREVIEW_MAX_ANNOTATION_CONTEXT_CHARS).optional(),
    pageStart: z.number().int().positive().max(1_000_000).optional(),
    pageEnd: z.number().int().positive().max(1_000_000).optional(),
    rects: z.array(workspacePreviewAnnotationAnchorRectSchema)
      .max(WORKSPACE_PREVIEW_MAX_ANNOTATION_RECTS)
      .optional()
  }).strict().refine(
    (anchor) => anchor.pageStart == null || anchor.pageEnd == null || anchor.pageEnd >= anchor.pageStart,
    { message: 'Annotation anchor pageEnd must be greater than or equal to pageStart.' }
  ).optional(),
  thread: z.object({
    kind: workspacePreviewAnnotationKindSchema.optional(),
    status: workspacePreviewAnnotationThreadStatusSchema.optional(),
    title: z.string().trim().max(512).optional(),
    authorId: idSchema.optional(),
    sourceQuoteId: idSchema.optional(),
    sourceMessageId: idSchema.optional()
  }).strict().optional(),
  annotation: z.object({
    authorId: idSchema.optional(),
    color: z.string().trim().max(64).optional(),
    targetLanguage: z.string().trim().max(128).optional(),
    sourceText: boundedString(WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS).optional(),
    sourceMessageId: idSchema.optional()
  }).strict().optional()
}).strict()

export type WorkspacePreviewAnnotationUpsertTarget = z.infer<typeof workspacePreviewAnnotationUpsertTargetSchema>

const numericRangeSchema = z.object({
  min: z.number().finite(),
  max: z.number().finite()
}).strict()

export const workspaceDeckObservationTextElementKindSchema = z.enum(WORKSPACE_PREVIEW_DECK_TEXT_ELEMENT_KINDS)

export const workspaceDeckObservationTextElementSchema = z.object({
  slideId: idSchema,
  elementId: idSchema,
  kind: workspaceDeckObservationTextElementKindSchema,
  text: z.string().trim().min(1).max(WORKSPACE_PREVIEW_MAX_DECK_TEXT_ELEMENT_CHARS)
}).strict()

export const workspaceDeckObservationSlidePreviewTextBoxSchema = z.object({
  elementId: idSchema,
  kind: workspaceDeckObservationTextElementKindSchema,
  text: z.string().trim().min(1).max(WORKSPACE_PREVIEW_MAX_DECK_TEXT_ELEMENT_CHARS),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().finite().positive().optional(),
  height: z.number().finite().positive().optional()
}).strict()

export const workspaceDeckObservationSlidePreviewSchema = z.object({
  slideId: idSchema,
  index: z.number().int().min(0),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  textBoxes: z.array(workspaceDeckObservationSlidePreviewTextBoxSchema)
    .max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS)
    .optional(),
  truncatedTextBoxes: z.boolean().optional()
}).strict()

export const workspaceSequenceObservationReferenceSchema = z.object({
  id: idSchema,
  sequenceLength: z.number().int().nonnegative().optional(),
  featureCount: z.number().int().nonnegative().optional(),
  intervalCount: z.number().int().nonnegative().optional(),
  variantCount: z.number().int().nonnegative().optional()
}).strict()

export const workspaceSequenceObservationFeatureSchema = z.object({
  id: idSchema.optional(),
  reference: idSchema,
  type: z.string().trim().min(1).max(128),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  strand: z.enum(['+', '-']).optional()
}).strict()

export const workspaceSequenceObservationIndexedRangeSchema = z.object({
  kind: z.enum(['sequence', 'read', 'reference', 'feature', 'interval', 'variant']),
  reference: idSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  id: idSchema.optional(),
  type: z.string().trim().min(1).max(128).optional(),
  strand: z.enum(['+', '-']).optional()
}).strict()

const textSelectionRangeSchema = z.object({
  startLine: z.number().int().min(1),
  startColumn: z.number().int().min(1),
  endLine: z.number().int().min(1),
  endColumn: z.number().int().min(1),
  text: boundedString(WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS).optional()
}).strict()

const tabularSelectionRangeSchema = z.object({
  rowStart: z.number().int().min(0),
  rowEnd: z.number().int().min(0),
  columnStart: z.number().int().min(0),
  columnEnd: z.number().int().min(0)
}).strict()

export const workspacePreviewDocumentRectSchema = z.object({
  page: z.number().int().positive().max(1_000_000),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().gt(0).max(1),
  height: z.number().finite().gt(0).max(1)
}).strict().refine(
  (rect) => rect.x + rect.width <= 1 && rect.y + rect.height <= 1,
  { message: 'Document rectangle must stay within normalized page bounds.' }
)

export function normalizeWorkspacePreviewSha256Digest(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^sha256:/, '')
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('Expected a SHA-256 digest with 64 hexadecimal characters.')
  }
  return `sha256:${normalized}`
}

export const workspacePreviewIntegrityExpectationSchema = z.object({
  algorithm: z.literal('sha256'),
  expectedDigest: z.string().trim().min(1).max(128)
    .transform(normalizeWorkspacePreviewSha256Digest)
}).strict()

export const workspacePreviewIntegrityVerificationSchema = workspacePreviewIntegrityExpectationSchema.extend({
  actualDigest: z.string().trim().min(1).max(128)
    .transform(normalizeWorkspacePreviewSha256Digest),
  verified: z.literal(true)
}).strict()

export const workspacePreviewAnchorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    line: z.number().int().positive().max(1_000_000),
    column: z.number().int().positive().max(1_000_000).optional(),
    endLine: z.number().int().positive().max(1_000_000).optional(),
    endColumn: z.number().int().positive().max(1_000_000).optional()
  }).strict(),
  z.object({
    kind: z.literal('document'),
    id: idSchema.optional(),
    page: z.number().int().positive().max(1_000_000).optional(),
    paragraphIndex: z.number().int().positive().max(1_000_000).optional(),
    quote: boundedString(WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS).optional(),
    rects: z.array(workspacePreviewDocumentRectSchema)
      .min(1)
      .max(WORKSPACE_PREVIEW_MAX_ANNOTATION_RECTS)
      .optional()
  }).strict(),
  z.object({
    kind: z.literal('tabular'),
    sheet: optionalShortStringSchema,
    rowIndexBase: z.union([z.literal(0), z.literal(1)]).optional(),
    columnIndexBase: z.union([z.literal(0), z.literal(1)]).optional(),
    rowStart: z.number().int().min(0),
    rowEnd: z.number().int().min(0),
    columnStart: z.number().int().min(0),
    columnEnd: z.number().int().min(0)
  }).strict()
]).superRefine((anchor, context) => {
  if (anchor.kind !== 'document') return
  if (anchor.page != null || anchor.paragraphIndex != null || anchor.quote || anchor.rects?.length) return
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'Document anchor requires a page, paragraph, quote, or rectangle.'
  })
})

export const workspaceStructuredSelectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    ranges: z.array(textSelectionRangeSchema).min(1).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS)
  }).strict(),
  z.object({
    kind: z.literal('tabular'),
    sheet: optionalShortStringSchema,
    ranges: z.array(tabularSelectionRangeSchema).min(1).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS),
    cells: z.array(z.object({
      row: z.number().int().min(0),
      column: z.number().int().min(0),
      value: z.unknown().optional()
    }).strict()).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional()
  }).strict(),
  z.object({
    kind: z.literal('document'),
    anchors: z.array(z.object({
      id: idSchema,
      page: z.number().int().min(1).optional(),
      paragraphIndex: z.number().int().min(1).optional(),
      quote: boundedString(WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS).optional(),
      rects: z.array(workspacePreviewDocumentRectSchema)
        .max(WORKSPACE_PREVIEW_MAX_ANNOTATION_RECTS)
        .optional()
    }).strict()).min(1).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS)
  }).strict(),
  z.object({
    kind: z.literal('deck'),
    slideIds: z.array(idSchema).min(1).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS),
    elementIds: z.array(idSchema).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional()
  }).strict(),
  z.object({
    kind: z.literal('molecular'),
    chains: z.array(z.string().trim().min(1).max(64)).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional(),
    residues: z.array(z.object({
      chain: z.string().trim().max(64).optional(),
      index: z.number().int().min(0),
      insertionCode: z.string().trim().max(8).optional(),
      name: z.string().trim().max(32).optional()
    }).strict()).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional(),
    atoms: z.array(z.object({
      id: z.string().trim().max(128).optional(),
      index: z.number().int().min(0).optional(),
      element: z.string().trim().max(8).optional()
    }).strict()).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional(),
    ligands: z.array(z.string().trim().min(1).max(64)).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional()
  }).strict(),
  z.object({
    kind: z.literal('sequence'),
    sequenceId: idSchema.optional(),
    ranges: z.array(z.object({
      start: z.number().int().min(0),
      end: z.number().int().min(0),
      strand: z.enum(['+', '-']).optional()
    }).strict()).min(1).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS),
    features: z.array(z.object({
      id: idSchema.optional(),
      type: z.string().trim().min(1).max(128),
      start: z.number().int().min(0),
      end: z.number().int().min(0)
    }).strict()).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional()
  }).strict(),
  z.object({
    kind: z.literal('omics'),
    matrixIds: z.array(idSchema).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional(),
    obsKeys: z.array(idSchema).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional(),
    varKeys: z.array(idSchema).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional(),
    embeddings: z.array(idSchema).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional(),
    ranges: z.array(z.object({
      matrixId: idSchema,
      matrixName: optionalShortStringSchema,
      axis: z.enum(['obs', 'var', 'row', 'column']),
      start: z.number().int().min(0),
      end: z.number().int().min(0),
      axisLength: z.number().int().min(0).optional(),
      clipped: z.boolean().optional()
    }).strict()).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional()
  }).strict(),
  z.object({
    kind: z.literal('bioimaging'),
    roiIds: z.array(idSchema).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional(),
    channels: z.array(z.string().trim().min(1).max(128)).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional(),
    regions: z.array(z.object({
      x: z.number().finite().nonnegative(),
      y: z.number().finite().nonnegative(),
      width: z.number().finite().positive(),
      height: z.number().finite().positive(),
      z: z.number().finite().nonnegative().optional(),
      t: z.number().finite().nonnegative().optional()
    }).strict()).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional()
  }).strict(),
  z.object({
    kind: z.literal('spectra'),
    ranges: z.array(z.object({
      xStart: z.number().finite(),
      xEnd: z.number().finite(),
      yStart: z.number().finite().optional(),
      yEnd: z.number().finite().optional()
    }).strict()).min(1).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS),
    peaks: z.array(z.object({
      mz: z.number().finite().optional(),
      intensity: z.number().finite().optional(),
      label: z.string().trim().max(128).optional()
    }).strict()).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS).optional()
  }).strict()
])

export function resolveWorkspacePreviewInitialSelection(input: {
  selection?: WorkspaceStructuredSelection
  anchor?: WorkspacePreviewAnchor
  line?: number
  column?: number
}): WorkspaceStructuredSelection | undefined {
  if (input.selection) return workspaceStructuredSelectionSchema.parse(input.selection)

  if (input.anchor) {
    const anchor = workspacePreviewAnchorSchema.parse(input.anchor)
    if (anchor.kind === 'text') {
      const startColumn = anchor.column ?? 1
      return workspaceStructuredSelectionSchema.parse({
        kind: 'text',
        ranges: [{
          startLine: anchor.line,
          startColumn,
          endLine: anchor.endLine ?? anchor.line,
          endColumn: anchor.endColumn ?? (anchor.endLine != null ? 1_000_000 : startColumn)
        }]
      })
    }
    if (anchor.kind === 'tabular') {
      const rowBase = anchor.rowIndexBase ?? 1
      const columnBase = anchor.columnIndexBase ?? 0
      return workspaceStructuredSelectionSchema.parse({
        kind: 'tabular',
        ...(anchor.sheet ? { sheet: anchor.sheet } : {}),
        ranges: [{
          rowStart: Math.max(0, anchor.rowStart - rowBase),
          rowEnd: Math.max(0, anchor.rowEnd - rowBase),
          columnStart: Math.max(0, anchor.columnStart - columnBase),
          columnEnd: Math.max(0, anchor.columnEnd - columnBase)
        }]
      })
    }
    return workspaceStructuredSelectionSchema.parse({
      kind: 'document',
      anchors: [{
        id: anchor.id ?? 'initial-document-anchor',
        ...(anchor.page != null ? { page: anchor.page } : {}),
        ...(anchor.paragraphIndex != null ? { paragraphIndex: anchor.paragraphIndex } : {}),
        ...(anchor.quote ? { quote: anchor.quote } : {}),
        ...(anchor.rects?.length ? { rects: anchor.rects } : {})
      }]
    })
  }

  if (input.line != null) {
    const column = input.column ?? 1
    return workspaceStructuredSelectionSchema.parse({
      kind: 'text',
      ranges: [{
        startLine: input.line,
        startColumn: column,
        endLine: input.line,
        endColumn: column
      }]
    })
  }
  return undefined
}

export const workspacePreviewFileStateSchema = z.object({
  workspaceRoot: pathSchema,
  path: pathSchema,
  relativePath: z.string().trim().max(4096).optional(),
  mimeType: z.string().trim().max(128).optional(),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional(),
  sha256: z.string().trim().regex(/^[a-f0-9]{64}$/).optional()
}).strict()

export type WorkspacePreviewFileState = z.infer<typeof workspacePreviewFileStateSchema>

export const workspacePreviewModeSchema = z.enum(['preview', 'edit', 'inspect'])

export const workspacePreviewSessionSchema = z.object({
  id: idSchema,
  pluginId: z.string().trim().min(1).max(128),
  workspaceRoot: pathSchema,
  path: pathSchema,
  modality: workspacePreviewModalitySchema,
  mode: workspacePreviewModeSchema,
  openedAt: z.string().trim().min(1).max(128),
  updatedAt: z.string().trim().min(1).max(128),
  mtimeMs: z.number().finite().nonnegative().optional(),
  file: workspacePreviewFileStateSchema.optional(),
  selection: workspaceStructuredSelectionSchema.optional()
}).strict()

export const workspacePreviewJsonValueSchema: z.ZodType<WorkspacePreviewJsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string().max(WORKSPACE_PREVIEW_MAX_PLUGIN_METADATA_STRING_CHARS),
  z.array(workspacePreviewJsonValueSchema).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS),
  z.record(z.string().trim().min(1).max(128), workspacePreviewJsonValueSchema)
]))

export const workspacePreviewPluginMetadataItemSchema = z.object({
  source: z.literal('plugin-metadata'),
  metadataKind: z.string().trim().min(1).max(128),
  mimeType: z.string().trim().min(1).max(128).optional(),
  metadataOnly: z.literal(true),
  containsPixels: z.literal(false),
  pixelDecoding: z.literal(false).optional(),
  data: workspacePreviewJsonValueSchema,
  selection: workspaceStructuredSelectionSchema.optional(),
  actions: z.array(z.string().trim().min(1).max(128)).max(256).optional()
}).strict()

export const workspaceObservationSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_PREVIEW_CONTRACT_VERSION),
  file: z.object({
    path: pathSchema,
    workspaceRoot: optionalPathSchema,
    mimeType: z.string().trim().max(128).optional(),
    size: z.number().finite().nonnegative().optional(),
    mtimeMs: z.number().finite().nonnegative().optional()
  }).strict(),
  view: z.object({
    pluginId: z.string().trim().min(1).max(128),
    modality: workspacePreviewModalitySchema,
    mode: workspacePreviewModeSchema,
    title: z.string().trim().min(1).max(512)
  }).strict(),
  selection: workspaceStructuredSelectionSchema.optional(),
  visibleText: boundedString(WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS).optional(),
  outline: z.array(z.object({
    id: idSchema,
    title: z.string().trim().min(1).max(512),
    level: z.number().int().min(1).max(12).optional(),
    page: z.number().int().min(1).optional()
  }).strict()).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
  tables: z.array(z.object({
    id: idSchema,
    name: optionalShortStringSchema,
    rowCount: z.number().int().nonnegative().optional(),
    columnCount: z.number().int().nonnegative().optional()
  }).strict()).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
  tabular: z.object({
    header: z.array(boundedString(256)).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
    rows: z.array(z.object({
      index: z.number().int().nonnegative(),
      values: z.array(boundedString(WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS)).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS)
    }).strict()).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
    truncatedRows: z.boolean().optional(),
    truncatedColumns: z.boolean().optional()
  }).strict().optional(),
  text: z.object({
    lineCount: z.number().int().nonnegative().optional(),
    characterCount: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional()
  }).strict().optional(),
  document: z.object({
    paragraphs: z.array(z.object({
      id: idSchema,
      index: z.number().int().min(1),
      text: boundedString(WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS),
      style: optionalShortStringSchema
    }).strict()).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
    truncatedParagraphs: z.boolean().optional()
  }).strict().optional(),
  slides: z.array(z.object({
    id: idSchema,
    index: z.number().int().min(0),
    title: optionalShortStringSchema,
    notes: boundedString(WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS).optional()
  }).strict()).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
  deck: z.object({
    textElementCount: z.number().int().nonnegative().optional(),
    truncatedTextElements: z.boolean().optional(),
    textElements: z.array(workspaceDeckObservationTextElementSchema)
      .max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS)
      .optional(),
    slidePreviews: z.array(workspaceDeckObservationSlidePreviewSchema)
      .max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS)
      .optional()
  }).strict().optional(),
  molecular: z.object({
    modelCount: z.number().int().nonnegative().optional(),
    chains: z.array(z.string().trim().min(1).max(64)).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
    ligands: z.array(z.string().trim().min(1).max(128)).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
    representations: z.array(z.string().trim().min(1).max(128)).max(64).optional()
  }).strict().optional(),
  sequence: z.object({
    sequenceCount: z.number().int().nonnegative().optional(),
    totalLength: z.number().int().nonnegative().optional(),
    alphabet: z.enum(['dna', 'rna', 'protein', 'unknown']).optional(),
    references: z.array(workspaceSequenceObservationReferenceSchema)
      .max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS)
      .optional(),
    features: z.array(workspaceSequenceObservationFeatureSchema)
      .max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS)
      .optional(),
    indexedRanges: z.array(workspaceSequenceObservationIndexedRangeSchema)
      .max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS)
      .optional(),
    truncatedRecords: z.boolean().optional(),
    truncatedReferences: z.boolean().optional()
  }).strict().optional(),
  omics: z.object({
    format: z.string().trim().min(1).max(64).optional(),
    matrixShape: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
    matrixIds: z.array(idSchema).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
    observationCount: z.number().int().nonnegative().optional(),
    variableCount: z.number().int().nonnegative().optional(),
    obsKeys: z.array(idSchema).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
    varKeys: z.array(idSchema).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
    embeddings: z.array(z.string().trim().min(1).max(128)).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
    metadataKeys: z.array(idSchema).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional()
  }).strict().optional(),
  bioimaging: z.object({
    format: z.string().trim().min(1).max(64).optional(),
    detectedBy: z.string().trim().min(1).max(64).optional(),
    byteLength: z.number().int().nonnegative().optional(),
    channels: z.array(z.string().trim().min(1).max(128)).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
    dimensions: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      z: z.number().int().positive().optional(),
      t: z.number().int().positive().optional()
    }).strict().optional(),
    tilePlan: z.object({
      status: z.string().trim().min(1).max(64).optional(),
      source: z.string().trim().min(1).max(128).optional(),
      levelCount: z.number().int().nonnegative().optional(),
      tileSize: z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive()
      }).strict().optional(),
      pixelDecoding: z.boolean().optional(),
      tileRendererImplemented: z.boolean().optional()
    }).strict().optional()
  }).strict().optional(),
  spectra: z.object({
    format: z.string().trim().min(1).max(64).optional(),
    spectrumCount: z.number().int().nonnegative().optional(),
    peakCount: z.number().int().nonnegative().optional(),
    scanCount: z.number().int().nonnegative().optional(),
    xAxis: z.string().trim().max(128).optional(),
    mzRange: numericRangeSchema.optional(),
    intensityRange: numericRangeSchema.optional(),
    sampledPeaks: z.array(z.object({
      mz: z.number().finite(),
      intensity: z.number().finite(),
      label: z.string().trim().max(128).optional(),
      spectrumIndex: z.number().int().nonnegative().optional(),
      scanIndex: z.number().int().nonnegative().optional(),
      peakIndex: z.number().int().nonnegative().optional()
    }).strict()).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
    scanMarkers: z.array(z.object({
      index: z.number().int().nonnegative(),
      id: z.string().trim().max(1000).optional(),
      scanNumber: z.string().trim().max(1000).optional(),
      msLevel: z.string().trim().max(1000).optional(),
      peakCount: z.number().int().nonnegative().optional(),
      mzRange: numericRangeSchema.optional(),
      intensityRange: numericRangeSchema.optional()
    }).strict()).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional()
  }).strict().optional(),
  annotations: z.array(z.object({
    id: idSchema,
    kind: z.string().trim().min(1).max(128),
    summary: z.string().trim().max(1000).optional()
  }).strict()).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS).optional(),
  pluginMetadata: z.array(workspacePreviewPluginMetadataItemSchema)
    .max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS)
    .optional(),
  actions: z.array(z.string().trim().min(1).max(128)).max(256)
}).strict()

export const workspacePreviewEditOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('workspace.setSelection'),
    path: pathSchema,
    selection: workspaceStructuredSelectionSchema
  }).strict(),
  z.object({
    kind: z.literal('text.replaceRange'),
    path: pathSchema,
    range: z.object({
      start: positionSchema,
      end: positionSchema
    }).strict(),
    text: boundedString(WORKSPACE_PREVIEW_MAX_TEXT_CHARS)
  }).strict(),
  z.object({
    kind: z.literal('tabular.updateCell'),
    path: pathSchema,
    sheet: z.string().trim().max(256).optional(),
    row: z.number().int().min(0),
    column: z.number().int().min(0),
    value: z.unknown()
  }).strict(),
  z.object({
    kind: z.literal('tabular.insertRows'),
    path: pathSchema,
    sheet: z.string().trim().max(256).optional(),
    afterRow: z.number().int().min(-1),
    rows: z.array(z.array(z.unknown()).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS))
      .min(1)
      .max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS)
  }).strict(),
  z.object({
    kind: z.literal('tabular.insertColumns'),
    path: pathSchema,
    sheet: z.string().trim().max(256).optional(),
    afterColumn: z.number().int().min(-1),
    columns: z.array(z.array(z.unknown()).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS))
      .min(1)
      .max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS)
  }).strict(),
  z.object({
    kind: z.literal('tabular.deleteRows'),
    path: pathSchema,
    sheet: z.string().trim().max(256).optional(),
    rows: z.array(z.number().int().min(0)).min(1).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS)
  }).strict(),
  z.object({
    kind: z.literal('tabular.deleteColumns'),
    path: pathSchema,
    sheet: z.string().trim().max(256).optional(),
    columns: z.array(z.number().int().min(0)).min(1).max(WORKSPACE_PREVIEW_MAX_SELECTION_ITEMS)
  }).strict(),
  z.object({
    kind: z.literal('deck.updateTextElement'),
    path: pathSchema,
    slideId: idSchema,
    elementId: idSchema,
    text: boundedString(WORKSPACE_PREVIEW_MAX_DECK_TEXT_ELEMENT_CHARS)
  }).strict(),
  z.object({
    kind: z.literal('document.updateParagraph'),
    path: pathSchema,
    paragraphIndex: z.number().int().min(1),
    text: boundedString(WORKSPACE_PREVIEW_MAX_TEXT_CHARS)
  }).strict(),
  z.object({
    kind: z.literal('annotation.upsert'),
    path: pathSchema,
    annotationId: idSchema,
    annotationKind: workspacePreviewAnnotationKindSchema,
    body: boundedString(WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS),
    target: workspacePreviewAnnotationUpsertTargetSchema.optional()
  }).strict(),
  z.object({
    kind: z.literal('annotation.thread.update'),
    path: pathSchema,
    threadId: idSchema,
    patch: z.object({
      status: z.enum(['open', 'resolved']).optional(),
      title: boundedString(512).optional()
    }).strict().refine((patch) => patch.status !== undefined || patch.title !== undefined, {
      message: 'annotation.thread.update requires at least one patch field.'
    })
  }).strict(),
  z.object({
    kind: z.literal('annotation.thread.delete'),
    path: pathSchema,
    threadId: idSchema,
    pruneOrphanAnchors: z.boolean().default(true)
  }).strict(),
  z.object({
    kind: z.literal('molecular.setSelection'),
    path: pathSchema,
    selection: workspaceStructuredSelectionSchema
  }).strict()
])

export type WorkspacePreviewEditOperation = z.infer<typeof workspacePreviewEditOperationSchema>

export const workspacePreviewEditDiffSummarySchema = z.object({
  schemaVersion: z.literal(WORKSPACE_PREVIEW_CONTRACT_VERSION),
  kind: z.literal('bounded'),
  summary: z.string().trim().min(1).max(1000),
  operationKind: z.string().trim().min(1).max(128),
  target: z.object({
    path: pathSchema,
    textRange: z.object({
      start: positionSchema,
      end: positionSchema
    }).strict().optional(),
    tabular: z.object({
      sheet: z.string().trim().max(256).optional(),
      cells: z.array(z.object({
        row: z.number().int().min(0),
        column: z.number().int().min(0)
      }).strict()).max(WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_ITEMS).optional(),
      rows: z.array(z.number().int().min(0)).max(WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_ITEMS).optional(),
      columns: z.array(z.number().int().min(0)).max(WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_ITEMS).optional()
    }).strict().optional()
  }).strict(),
  counts: z.object({
    filesChanged: z.union([z.literal(0), z.literal(1)]),
    bytesDelta: z.number().int().optional(),
    charsInserted: z.number().int().nonnegative().optional(),
    charsDeleted: z.number().int().nonnegative().optional(),
    cellsChanged: z.number().int().nonnegative().optional(),
    rowsInserted: z.number().int().nonnegative().optional(),
    rowsDeleted: z.number().int().nonnegative().optional(),
    columnsInserted: z.number().int().nonnegative().optional(),
    columnsDeleted: z.number().int().nonnegative().optional()
  }).strict(),
  previews: z.array(z.object({
    label: z.string().trim().min(1).max(128),
    before: z.string().max(WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_CHARS).optional(),
    after: z.string().max(WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_CHARS).optional(),
    truncated: z.boolean().optional()
  }).strict()).max(WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_ITEMS).optional(),
  undo: z.object({
    available: z.literal(false),
    hint: z.string().trim().min(1).max(1000)
  }).strict(),
  bounded: z.object({
    maxPreviewItems: z.number().int().positive(),
    maxPreviewChars: z.number().int().positive(),
    truncated: z.boolean()
  }).strict()
}).strict()

export type WorkspacePreviewEditDiffSummary = z.infer<typeof workspacePreviewEditDiffSummarySchema>

export const workspacePreviewExportTargetSchema = z.object({
  kind: z.enum(['download', 'workspace-file', 'clipboard', 'attachment']),
  format: z.string().trim().min(1).max(64),
  path: z.string().trim().max(4096).optional(),
  mimeType: z.string().trim().max(128).optional()
}).strict()

export type WorkspacePreviewExportTarget = z.infer<typeof workspacePreviewExportTargetSchema>

export const workspacePreviewPluginActionInputSchema = z.object({
  actionId: z.string().trim().min(1).max(128),
  input: z.record(z.string().trim().min(1).max(128), z.unknown()).default({})
}).strict()

export type WorkspacePreviewPluginActionInput = z.infer<typeof workspacePreviewPluginActionInputSchema>

export const workspacePreviewAnnotationSidecarImportActionInputSchema = z.object({
  packagePath: z.string().trim().min(1).max(4096).optional(),
  packageBase64: z.string().trim().min(1).max(WORKSPACE_PREVIEW_MAX_IMPORT_PACKAGE_BASE64_CHARS).optional(),
  attemptRelocation: z.boolean().optional()
}).strict().refine((input) => {
  const hasPath = Boolean(input.packagePath?.trim())
  const hasBase64 = Boolean(input.packageBase64?.trim())
  return hasPath !== hasBase64
}, {
  message: 'Exactly one PDF annotation package path or base64 content is required.'
})

export type WorkspacePreviewAnnotationSidecarImportActionInput =
  z.infer<typeof workspacePreviewAnnotationSidecarImportActionInputSchema>

export const workspacePreviewAnnotationSidecarImportActionResultSchema = z.object({
  sidecar: z.unknown(),
  importedAt: z.string().trim().min(1).max(128),
  pdfFingerprint: z.object({
    sha256: z.string().trim().min(1).max(128),
    size: z.number().int().nonnegative(),
    mtimeMs: z.number().finite().nonnegative().optional(),
    pageCount: z.number().int().positive().max(1_000_000).optional(),
    fileName: z.string().trim().max(512).optional()
  }).strict(),
  fingerprintMatched: z.boolean(),
  warnings: z.array(z.string().trim().max(1000)).max(WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS),
  counts: z.object({
    threads: z.number().int().nonnegative(),
    annotations: z.number().int().nonnegative(),
    anchors: z.number().int().nonnegative()
  }).strict(),
  effect: z.literal('sidecar-write')
}).strict()

export type WorkspacePreviewAnnotationSidecarImportActionResult =
  z.infer<typeof workspacePreviewAnnotationSidecarImportActionResultSchema>

export const workspacePreviewPluginActionResultSchema = z.object({
  ok: z.literal(true),
  sessionId: idSchema,
  pluginId: z.string().trim().min(1).max(128),
  actionId: z.string().trim().min(1).max(128),
  invokedAt: z.string().trim().min(1).max(128),
  result: z.unknown(),
  audit: z.object({
    pluginId: z.string().trim().min(1).max(128),
    path: pathSchema,
    actionId: z.string().trim().min(1).max(128),
    effect: z.enum(['worker-action', 'host-action'])
  }).strict()
}).strict()

export type WorkspacePreviewPluginActionResult = z.infer<typeof workspacePreviewPluginActionResultSchema>

export const workspacePreviewTransferRuntimeSchema = z.enum(['desktop', 'web'])

export type WorkspacePreviewTransferRuntime = z.infer<typeof workspacePreviewTransferRuntimeSchema>

export const workspacePreviewDragInActionSchema = z.enum([
  'import-files',
  'import-directory',
  'move-workspace-items',
  'paste-content',
  'attach-to-session'
])

export type WorkspacePreviewDragInAction = z.infer<typeof workspacePreviewDragInActionSchema>

export const workspacePreviewDragOutActionSchema = z.enum([
  'native-file',
  'download',
  'copy-path',
  'copy-content',
  'attach-to-session'
])

export type WorkspacePreviewDragOutAction = z.infer<typeof workspacePreviewDragOutActionSchema>

export const workspacePreviewDragActionSchema = z.union([
  workspacePreviewDragInActionSchema,
  workspacePreviewDragOutActionSchema
])

export type WorkspacePreviewDragAction = z.infer<typeof workspacePreviewDragActionSchema>

export const workspacePreviewCopyPayloadKindSchema = z.enum(['path', 'content', 'attachment'])

export type WorkspacePreviewCopyPayloadKind = z.infer<typeof workspacePreviewCopyPayloadKindSchema>

export const workspacePreviewPastePayloadKindSchema = z.enum(['text', 'files', 'screenshot', 'attachment'])

export type WorkspacePreviewPastePayloadKind = z.infer<typeof workspacePreviewPastePayloadKindSchema>

export const workspacePreviewConflictStrategySchema = z.enum([
  'ask',
  'overwrite',
  'rename',
  'skip',
  'merge'
])

export type WorkspacePreviewConflictStrategy = z.infer<typeof workspacePreviewConflictStrategySchema>

export const workspacePreviewConflictPolicySchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('ask')
  }).strict(),
  z.object({
    strategy: z.literal('overwrite')
  }).strict(),
  z.object({
    strategy: z.literal('skip')
  }).strict(),
  z.object({
    strategy: z.literal('merge')
  }).strict(),
  z.object({
    strategy: z.literal('rename'),
    renameTemplate: z.string().trim().min(1).max(256).default('{name} copy{ext}'),
    maxAttempts: z.number().int().min(1).max(10_000).default(100)
  }).strict()
])

export type WorkspacePreviewConflictPolicy = z.infer<typeof workspacePreviewConflictPolicySchema>

export const DEFAULT_WORKSPACE_PREVIEW_CONFLICT_POLICY: WorkspacePreviewConflictPolicy = {
  strategy: 'ask'
}

const transferNameSchema = z.string().trim().min(1).max(512)

const transferMimeTypeSchema = z.string().trim().max(128).optional()

const transferFileReferenceSchema = z.object({
  name: transferNameSchema,
  path: pathSchema.optional(),
  mimeType: transferMimeTypeSchema,
  size: z.number().finite().nonnegative().optional(),
  lastModifiedMs: z.number().finite().nonnegative().optional()
}).strict()

const transferAttachmentReferenceSchema = z.object({
  attachmentId: idSchema.optional(),
  name: transferNameSchema,
  path: pathSchema.optional(),
  mimeType: transferMimeTypeSchema,
  size: z.number().finite().nonnegative().optional()
}).strict()

export const workspacePreviewDragSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('workspace-file'),
    path: pathSchema,
    displayName: z.string().trim().max(512).optional(),
    mimeType: transferMimeTypeSchema,
    size: z.number().finite().nonnegative().optional(),
    supportedActions: z.array(workspacePreviewDragOutActionSchema).max(16).optional()
  }).strict(),
  z.object({
    kind: z.literal('workspace-directory'),
    path: pathSchema,
    displayName: z.string().trim().max(512).optional(),
    supportedActions: z.array(workspacePreviewDragOutActionSchema).max(16).optional()
  }).strict(),
  z.object({
    kind: z.literal('selection'),
    path: pathSchema,
    selection: workspaceStructuredSelectionSchema,
    text: boundedString(WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS).optional(),
    supportedActions: z.array(workspacePreviewDragOutActionSchema).max(16).optional()
  }).strict(),
  z.object({
    kind: z.literal('attachment'),
    attachment: transferAttachmentReferenceSchema,
    supportedActions: z.array(workspacePreviewDragOutActionSchema).max(16).optional()
  }).strict(),
  z.object({
    kind: z.literal('external-file'),
    file: transferFileReferenceSchema,
    supportedActions: z.array(workspacePreviewDragInActionSchema).max(16).optional()
  }).strict(),
  z.object({
    kind: z.literal('external-directory'),
    directory: transferFileReferenceSchema,
    supportedActions: z.array(workspacePreviewDragInActionSchema).max(16).optional()
  }).strict(),
  z.object({
    kind: z.literal('external-text'),
    text: boundedString(WORKSPACE_PREVIEW_MAX_TEXT_CHARS),
    mimeType: transferMimeTypeSchema,
    supportedActions: z.array(workspacePreviewDragInActionSchema).max(16).optional()
  }).strict()
])

export type WorkspacePreviewDragSource = z.infer<typeof workspacePreviewDragSourceSchema>

export const workspacePreviewDragTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('workspace-directory'),
    path: pathSchema,
    acceptedActions: z.array(workspacePreviewDragActionSchema).max(16).optional(),
    conflictPolicy: workspacePreviewConflictPolicySchema.optional()
  }).strict(),
  z.object({
    kind: z.literal('preview-session'),
    sessionId: idSchema,
    path: pathSchema.optional(),
    acceptedActions: z.array(workspacePreviewDragActionSchema).max(16).optional()
  }).strict(),
  z.object({
    kind: z.literal('browser-download'),
    acceptedActions: z.array(workspacePreviewDragOutActionSchema).max(16).optional()
  }).strict(),
  z.object({
    kind: z.literal('external-app'),
    acceptedActions: z.array(workspacePreviewDragOutActionSchema).max(16).optional()
  }).strict(),
  z.object({
    kind: z.literal('clipboard'),
    acceptedActions: z.array(workspacePreviewDragOutActionSchema).max(16).optional()
  }).strict()
])

export type WorkspacePreviewDragTarget = z.infer<typeof workspacePreviewDragTargetSchema>

export const workspacePreviewCopyPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('path'),
    path: pathSchema,
    pathFormat: z.enum(['absolute', 'workspace-relative']).default('workspace-relative'),
    displayPath: z.string().trim().max(4096).optional()
  }).strict(),
  z.object({
    kind: z.literal('content'),
    text: boundedString(WORKSPACE_PREVIEW_MAX_TEXT_CHARS),
    mimeType: transferMimeTypeSchema,
    sourcePath: pathSchema.optional()
  }).strict(),
  z.object({
    kind: z.literal('attachment'),
    attachment: transferAttachmentReferenceSchema
  }).strict()
])

export type WorkspacePreviewCopyPayload = z.infer<typeof workspacePreviewCopyPayloadSchema>

export const workspacePreviewPastePayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: boundedString(WORKSPACE_PREVIEW_MAX_TEXT_CHARS),
    mimeType: transferMimeTypeSchema,
    targetDirectory: pathSchema.optional(),
    conflictPolicy: workspacePreviewConflictPolicySchema.optional()
  }).strict(),
  z.object({
    kind: z.literal('files'),
    files: z.array(transferFileReferenceSchema).min(1).max(WORKSPACE_PREVIEW_MAX_TRANSFER_ITEMS),
    targetDirectory: pathSchema,
    conflictPolicy: workspacePreviewConflictPolicySchema.default(DEFAULT_WORKSPACE_PREVIEW_CONFLICT_POLICY)
  }).strict(),
  z.object({
    kind: z.literal('screenshot'),
    name: transferNameSchema.default('screenshot.png'),
    mimeType: z.string().trim().min(1).max(128).default('image/png'),
    dataRef: idSchema.optional(),
    targetDirectory: pathSchema.optional(),
    conflictPolicy: workspacePreviewConflictPolicySchema.optional()
  }).strict(),
  z.object({
    kind: z.literal('attachment'),
    attachments: z.array(transferAttachmentReferenceSchema).min(1).max(WORKSPACE_PREVIEW_MAX_TRANSFER_ITEMS),
    targetDirectory: pathSchema.optional(),
    targetSessionId: idSchema.optional(),
    conflictPolicy: workspacePreviewConflictPolicySchema.optional()
  }).strict()
])

export type WorkspacePreviewPastePayload = z.infer<typeof workspacePreviewPastePayloadSchema>

export const workspacePreviewTransferCapabilitySchema = z.object({
  runtime: workspacePreviewTransferRuntimeSchema,
  nativeFileSystem: z.boolean(),
  dragInActions: z.array(workspacePreviewDragInActionSchema).max(16),
  dragOutActions: z.array(workspacePreviewDragOutActionSchema).max(16),
  copyPayloadKinds: z.array(workspacePreviewCopyPayloadKindSchema).max(16),
  pastePayloadKinds: z.array(workspacePreviewPastePayloadKindSchema).max(16),
  conflictStrategies: z.array(workspacePreviewConflictStrategySchema).max(16),
  fallbacks: z.array(z.object({
    from: z.string().trim().min(1).max(64),
    to: z.array(z.string().trim().min(1).max(64)).min(1).max(8),
    reason: z.string().trim().min(1).max(512)
  }).strict()).max(32)
}).strict()

export type WorkspacePreviewTransferCapability = z.infer<typeof workspacePreviewTransferCapabilitySchema>

export function resolveWorkspacePreviewTransferCapabilities(
  input: WorkspacePreviewTransferRuntime | { runtime: WorkspacePreviewTransferRuntime }
): WorkspacePreviewTransferCapability {
  const runtime = typeof input === 'string' ? input : input.runtime
  if (runtime === 'desktop') {
    return workspacePreviewTransferCapabilitySchema.parse({
      runtime,
      nativeFileSystem: true,
      dragInActions: ['import-files', 'import-directory', 'move-workspace-items', 'paste-content', 'attach-to-session'],
      dragOutActions: ['native-file', 'copy-path', 'copy-content', 'attach-to-session'],
      copyPayloadKinds: ['path', 'content', 'attachment'],
      pastePayloadKinds: ['text', 'files', 'screenshot', 'attachment'],
      conflictStrategies: ['ask', 'overwrite', 'rename', 'skip', 'merge'],
      fallbacks: []
    })
  }

  return workspacePreviewTransferCapabilitySchema.parse({
    runtime,
    nativeFileSystem: false,
    dragInActions: ['paste-content', 'attach-to-session'],
    dragOutActions: ['download', 'copy-path', 'copy-content', 'attach-to-session'],
    copyPayloadKinds: ['path', 'content', 'attachment'],
    pastePayloadKinds: ['text', 'attachment'],
    conflictStrategies: ['ask', 'rename', 'skip'],
    fallbacks: [
      {
        from: 'native-file',
        to: ['download', 'copy-path', 'copy-content'],
        reason: 'Web previews cannot expose native workspace file handles.'
      },
      {
        from: 'import-files',
        to: ['attach-to-session', 'paste-content'],
        reason: 'Web previews cannot perform trusted workspace file writes directly.'
      },
      {
        from: 'move-workspace-items',
        to: ['copy-path'],
        reason: 'Web previews can reference workspace paths without moving files.'
      }
    ]
  })
}

export const workspacePreviewByteRangeSchema = z.object({
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive().max(WORKSPACE_PREVIEW_MAX_RANGE_BYTES)
}).strict()

export type WorkspacePreviewByteRange = z.infer<typeof workspacePreviewByteRangeSchema>

export const workspacePreviewAssetTransportKindSchema = z.enum([
  'byte-range',
  'object-url',
  'tile',
  'thumbnail',
  'cache-artifact'
])

export type WorkspacePreviewAssetTransportKind = z.infer<typeof workspacePreviewAssetTransportKindSchema>

export const workspacePreviewAssetTransportStatusSchema = z.enum([
  'available',
  'requires-renderer',
  'requires-plugin',
  'deferred'
])

export type WorkspacePreviewAssetTransportStatus = z.infer<typeof workspacePreviewAssetTransportStatusSchema>

export const workspacePreviewArtifactKindSchema = z.enum([
  'thumbnail',
  'cache-artifact',
  'tile'
])

export type WorkspacePreviewArtifactKind = z.infer<typeof workspacePreviewArtifactKindSchema>

export const workspacePreviewCacheArtifactSourceSchema = z.enum([
  'observation',
  'plugin-metadata'
])

export type WorkspacePreviewCacheArtifactSource =
  z.infer<typeof workspacePreviewCacheArtifactSourceSchema>

export const workspacePreviewArtifactCacheSourceSchema = z.enum([
  'observation',
  'plugin-metadata',
  'worker-decoder'
])

export type WorkspacePreviewArtifactCacheSource =
  z.infer<typeof workspacePreviewArtifactCacheSourceSchema>

export const workspacePreviewArtifactDescriptorSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_PREVIEW_CONTRACT_VERSION),
  sessionId: idSchema,
  assetId: idSchema,
  artifactId: idSchema,
  kind: workspacePreviewArtifactKindSchema,
  pluginId: z.string().trim().min(1).max(128),
  mimeType: z.string().trim().min(1).max(128),
  byteLength: z.number().int().nonnegative().max(WORKSPACE_PREVIEW_MAX_ARTIFACT_BYTES),
  range: z.object({
    available: z.literal(true),
    size: z.number().int().nonnegative().max(WORKSPACE_PREVIEW_MAX_ARTIFACT_BYTES),
    maxChunkBytes: z.number().int().positive().max(WORKSPACE_PREVIEW_MAX_RANGE_BYTES),
    recommendedChunkBytes: z.number().int().positive().max(WORKSPACE_PREVIEW_MAX_RANGE_BYTES)
  }).strict(),
  source: z.object({
    assetId: idSchema,
    size: z.number().finite().nonnegative().optional(),
    mtimeMs: z.number().finite().nonnegative().optional(),
    sha256: z.string().trim().regex(/^[a-f0-9]{64}$/).optional()
  }).strict(),
  cache: z.object({
    scope: z.literal('session'),
    source: workspacePreviewArtifactCacheSourceSchema,
    metadataKind: z.string().trim().min(1).max(128).optional(),
    createdAt: z.string().trim().min(1).max(128),
    invalidation: z.enum(['source-size-mtime', 'source-sha256'])
  }).strict(),
  thumbnail: z.object({
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000)
  }).strict().optional(),
  tile: z.object({
    level: z.number().int().nonnegative().max(1_000_000),
    x: z.number().int().nonnegative().max(1_000_000),
    y: z.number().int().nonnegative().max(1_000_000),
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000)
  }).strict().optional()
}).strict()

export type WorkspacePreviewArtifactDescriptor =
  z.infer<typeof workspacePreviewArtifactDescriptorSchema>

export const workspacePreviewPrepareArtifactRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cache-artifact'),
    source: workspacePreviewCacheArtifactSourceSchema,
    metadataKind: z.string().trim().min(1).max(128).optional()
  }).strict(),
  z.object({
    kind: z.literal('tile'),
    level: z.number().int().nonnegative().max(1_000_000),
    x: z.number().int().nonnegative().max(1_000_000),
    y: z.number().int().nonnegative().max(1_000_000),
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000),
    channelIndex: z.number().int().nonnegative().max(1_000_000).optional(),
    z: z.number().int().nonnegative().max(1_000_000).optional(),
    t: z.number().int().nonnegative().max(1_000_000).optional()
  }).strict(),
  z.object({
    kind: z.literal('thumbnail'),
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
    channelIndex: z.number().int().nonnegative().max(1_000_000).optional(),
    z: z.number().int().nonnegative().max(1_000_000).optional(),
    t: z.number().int().nonnegative().max(1_000_000).optional()
  }).strict()
])

export type WorkspacePreviewPrepareArtifactRequest =
  z.infer<typeof workspacePreviewPrepareArtifactRequestSchema>

export const workspacePreviewReadArtifactRangeRequestSchema = z.object({
  artifactId: idSchema,
  range: workspacePreviewByteRangeSchema
}).strict()

export type WorkspacePreviewReadArtifactRangeRequest =
  z.infer<typeof workspacePreviewReadArtifactRangeRequestSchema>

export const workspacePreviewAssetFileDescriptorSchema = z.object({
  name: z.string().trim().min(1).max(512),
  relativePath: z.string().trim().min(1).max(4096).optional(),
  mimeType: z.string().trim().max(128).optional(),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional(),
  sha256: z.string().trim().regex(/^[a-f0-9]{64}$/).optional()
}).strict()

export type WorkspacePreviewAssetFileDescriptor =
  z.infer<typeof workspacePreviewAssetFileDescriptorSchema>

export const workspacePreviewAssetTransportDescriptorSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_PREVIEW_CONTRACT_VERSION),
  sessionId: idSchema,
  assetId: idSchema,
  pluginId: z.string().trim().min(1).max(128),
  modality: workspacePreviewModalitySchema,
  file: workspacePreviewAssetFileDescriptorSchema,
  primary: workspacePreviewAssetTransportKindSchema,
  eagerRead: z.object({
    allowed: z.boolean(),
    reason: z.string().trim().min(1).max(512)
  }).strict(),
  range: z.object({
    available: z.boolean(),
    maxChunkBytes: z.number().int().positive().max(WORKSPACE_PREVIEW_MAX_RANGE_BYTES),
    recommendedChunkBytes: z.number().int().positive().max(WORKSPACE_PREVIEW_MAX_RANGE_BYTES),
    size: z.number().int().nonnegative()
  }).strict(),
  strategies: z.array(z.object({
    kind: workspacePreviewAssetTransportKindSchema,
    status: workspacePreviewAssetTransportStatusSchema,
    reason: z.string().trim().min(1).max(512),
    maxChunkBytes: z.number().int().positive().max(WORKSPACE_PREVIEW_MAX_RANGE_BYTES).optional()
  }).strict()).min(1).max(16),
  artifacts: z.array(workspacePreviewArtifactDescriptorSchema).max(64).optional(),
  warnings: z.array(z.string().trim().min(1).max(1000)).max(32).optional()
}).strict()

export type WorkspacePreviewAssetTransportDescriptor =
  z.infer<typeof workspacePreviewAssetTransportDescriptorSchema>

export function normalizePreviewExtension(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

export function previewPathSegments(path: string): string[] {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
}

export function fileNameFromPreviewPath(path: string): string {
  const segments = previewPathSegments(path)
  return segments.at(-1) ?? path
}

export function extensionFromPreviewPath(path: string, knownExtensions: readonly string[] = []): string {
  const fileName = fileNameFromPreviewPath(path).toLowerCase()
  const normalizedKnown = knownExtensions
    .map(normalizePreviewExtension)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  const known = normalizedKnown.find((extension) => fileName.endsWith(extension))
  if (known) return known
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot) : ''
}

export function previewPathHasKnownExtension(path: string, knownExtensions: readonly string[]): boolean {
  const fileName = fileNameFromPreviewPath(path).toLowerCase()
  return knownExtensions
    .map(normalizePreviewExtension)
    .filter(Boolean)
    .some((extension) => fileName.endsWith(extension))
}

export function isFirstPartyTabularShellPreviewPath(path: string): boolean {
  return previewPathHasKnownExtension(path, WORKSPACE_PREVIEW_FIRST_PARTY_TABULAR_SHELL_EXTENSIONS)
}

export function isDelimitedTabularEditPreviewPath(path: string): boolean {
  return previewPathHasKnownExtension(path, WORKSPACE_PREVIEW_DELIMITED_TABULAR_EDIT_EXTENSIONS)
}

export function isFirstPartyTextPreviewPath(path: string): boolean {
  const fileName = fileNameFromPreviewPath(path).toLowerCase()
  return previewPathHasKnownExtension(path, WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_EXTENSIONS) ||
    WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_FILE_NAMES.includes(fileName as typeof WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_FILE_NAMES[number]) ||
    WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_FILE_PREFIXES.some((prefix) => fileName.startsWith(prefix))
}

export function normalizePreviewMimeType(value: string | undefined): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

export function isTextLikePreviewMimeType(value: string | undefined): boolean {
  const mimeType = normalizePreviewMimeType(value)
  return mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/yaml' ||
    mimeType === 'application/x-yaml'
}

export function normalizePreviewManifest(
  manifest: WorkspacePreviewPluginManifest
): WorkspacePreviewPluginManifest {
  return workspacePreviewPluginManifestSchema.parse({
    ...manifest,
    extensions: manifest.extensions.map(normalizePreviewExtension),
    mimeTypes: manifest.mimeTypes.map(normalizePreviewMimeType).filter(Boolean)
  })
}

export function resolveWorkspacePreviewPlugin(input: {
  path: string
  mimeType?: string
  manifests: readonly WorkspacePreviewPluginManifest[]
}): WorkspacePreviewPluginManifest | null {
  const manifests = input.manifests.map(normalizePreviewManifest)
  const knownExtensions = manifests.flatMap((manifest) => manifest.extensions)
  const extension = extensionFromPreviewPath(input.path, knownExtensions)
  const mimeType = normalizePreviewMimeType(input.mimeType)

  const matches = manifests.filter((manifest) =>
    (mimeType && manifest.mimeTypes.includes(mimeType)) ||
    (extension && manifest.extensions.includes(extension)) ||
    (manifest.id === TEXT_WORKSPACE_PREVIEW_PLUGIN_ID && (
      isTextLikePreviewMimeType(mimeType) ||
      isFirstPartyTextPreviewPath(input.path)
    ))
  )

  return matches.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0] ?? null
}

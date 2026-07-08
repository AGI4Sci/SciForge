import { z } from 'zod'

export const WORKSPACE_DECK_CONTRACT_VERSION = 1
export const WORKSPACE_PREVIEW_CONTRACT_VERSION = 1
export const WORKSPACE_DECK_PLUGIN_ID = 'deck'
export const WORKSPACE_DECK_MAX_SLIDES = 500
export const WORKSPACE_DECK_MAX_TEXT_CHARS = 100_000
export const WORKSPACE_DECK_MAX_VISIBLE_TEXT_CHARS = 100_000
export const WORKSPACE_DECK_MAX_SLIDE_TEXT_SNIPPET_CHARS = 1_000
export const WORKSPACE_DECK_MAX_NOTES_PREVIEW_CHARS = 2_000
export const WORKSPACE_DECK_MAX_TEXT_ELEMENTS = 10_000
export const WORKSPACE_DECK_MAX_OBSERVATION_TEXT_ELEMENTS = 1_000
export const WORKSPACE_DECK_MAX_TEXT_ELEMENT_CHARS = 2_000
export const WORKSPACE_DECK_MAX_SLIDE_PREVIEWS = 250
export const WORKSPACE_DECK_MAX_SLIDE_PREVIEW_TEXT_BOXES = 1_000
export const WORKSPACE_DECK_MAX_SELECTION_ITEMS = 1_000
export const WORKSPACE_DECK_MAX_COMMENTS = 1_000
export const WORKSPACE_DECK_MAX_COMMENT_TEXT_CHARS = 2_000
export const WORKSPACE_DECK_MAX_WARNINGS = 32
export const WORKSPACE_DECK_MAX_ANNOTATIONS = WORKSPACE_DECK_MAX_COMMENTS + WORKSPACE_DECK_MAX_WARNINGS
export const WORKSPACE_DECK_ACTIONS = ['observe', 'select', 'deck.selectSlide', 'deck.selectText', 'applyEdit', 'export'] as const

const pathSchema = z.string().trim().min(1).max(4096)
const optionalPathSchema = z.string().trim().max(4096).optional()
const warningSchema = z.string().trim().min(1).max(1000)
const boundedIdSchema = z.string().trim().min(1).max(256)
const bytesSchema = z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0, {
  message: 'PPTX bytes are required'
})

export const workspaceDeckTextElementKindSchema = z.enum([
  'title',
  'subtitle',
  'body',
  'notes',
  'placeholder',
  'text'
])

export const workspaceDeckTextElementSummarySchema = z.object({
  id: boundedIdSchema,
  slideId: boundedIdSchema,
  text: z.string().trim().min(1).max(WORKSPACE_DECK_MAX_TEXT_ELEMENT_CHARS),
  kind: workspaceDeckTextElementKindSchema
}).strict()

export const workspaceDeckObservationTextElementSummarySchema = z.object({
  slideId: boundedIdSchema,
  elementId: boundedIdSchema,
  text: z.string().trim().min(1).max(WORKSPACE_DECK_MAX_TEXT_ELEMENT_CHARS),
  kind: workspaceDeckTextElementKindSchema
}).strict()

export const workspaceDeckSlidePreviewTextBoxSchema = z.object({
  elementId: boundedIdSchema,
  text: z.string().trim().min(1).max(WORKSPACE_DECK_MAX_TEXT_ELEMENT_CHARS),
  kind: workspaceDeckTextElementKindSchema,
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().finite().positive().optional(),
  height: z.number().finite().positive().optional()
}).strict()

export const workspaceDeckSlidePreviewSchema = z.object({
  slideId: boundedIdSchema,
  index: z.number().int().min(0),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  textBoxes: z.array(workspaceDeckSlidePreviewTextBoxSchema)
    .max(WORKSPACE_DECK_MAX_SLIDE_PREVIEW_TEXT_BOXES)
    .optional(),
  truncatedTextBoxes: z.boolean().optional()
}).strict()

export const workspaceDeckSlideInputSchema = z.object({
  id: boundedIdSchema,
  index: z.number().int().min(0),
  title: z.string().trim().max(512).optional(),
  notes: z.string().max(WORKSPACE_DECK_MAX_TEXT_CHARS).optional(),
  text: z.string().max(WORKSPACE_DECK_MAX_TEXT_CHARS).optional(),
  elements: z.array(workspaceDeckTextElementSummarySchema).max(WORKSPACE_DECK_MAX_TEXT_ELEMENTS).optional()
}).strict()

export const workspaceDeckObservationSlideSchema = z.object({
  id: boundedIdSchema,
  index: z.number().int().min(0),
  title: z.string().trim().max(256).optional(),
  notes: z.string().max(WORKSPACE_DECK_MAX_TEXT_CHARS).optional()
}).strict()

const workspaceDeckCommentPositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
}).strict()

export const workspaceDeckCommentAuthorSchema = z.object({
  id: boundedIdSchema,
  name: z.string().trim().max(256).optional(),
  initials: z.string().trim().max(32).optional()
}).strict()

export const workspaceDeckCommentSchema = z.object({
  id: boundedIdSchema,
  slideId: boundedIdSchema,
  slideIndex: z.number().int().min(0),
  partPath: pathSchema,
  authorId: boundedIdSchema.optional(),
  authorName: z.string().trim().max(256).optional(),
  initials: z.string().trim().max(32).optional(),
  index: z.number().int().nonnegative().optional(),
  createdAt: z.string().trim().max(128).optional(),
  text: z.string().trim().min(1).max(WORKSPACE_DECK_MAX_COMMENT_TEXT_CHARS),
  position: workspaceDeckCommentPositionSchema.optional()
}).strict()

export const workspaceDeckPreviewInputSchema = z.object({
  slides: z.array(workspaceDeckSlideInputSchema).max(WORKSPACE_DECK_MAX_SLIDES),
  path: optionalPathSchema,
  workspaceRoot: optionalPathSchema,
  mimeType: z.string().trim().max(128).optional(),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional()
}).strict()

export const workspaceDeckPptxPreviewInputSchema = z.object({
  bytes: bytesSchema,
  path: optionalPathSchema,
  workspaceRoot: optionalPathSchema,
  mimeType: z.string().trim().max(128).optional(),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional()
}).strict()

export const workspaceDeckPptxTextElementUpdateInputSchema = z.object({
  bytes: bytesSchema,
  slideId: boundedIdSchema,
  elementId: boundedIdSchema,
  text: z.string().max(WORKSPACE_DECK_MAX_TEXT_ELEMENT_CHARS)
}).strict()

export const workspaceDeckPptxTextElementUpdateResultSchema = z.object({
  bytes: bytesSchema,
  slideId: boundedIdSchema,
  elementId: boundedIdSchema,
  source: z.enum(['slide', 'notes']),
  partPath: pathSchema,
  beforeText: z.string().max(WORKSPACE_DECK_MAX_TEXT_ELEMENT_CHARS),
  afterText: z.string().max(WORKSPACE_DECK_MAX_TEXT_ELEMENT_CHARS)
}).strict()

export const workspaceDeckPreviewResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_DECK_CONTRACT_VERSION),
  slideCount: z.number().int().nonnegative(),
  textCharacterCount: z.number().int().nonnegative(),
  notesCount: z.number().int().nonnegative().optional(),
  elementCount: z.number().int().nonnegative(),
  elements: z.array(workspaceDeckTextElementSummarySchema).max(WORKSPACE_DECK_MAX_TEXT_ELEMENTS),
  truncatedElements: z.boolean(),
  commentCount: z.number().int().nonnegative(),
  comments: z.array(workspaceDeckCommentSchema).max(WORKSPACE_DECK_MAX_COMMENTS),
  truncatedComments: z.boolean(),
  warnings: z.array(warningSchema).max(WORKSPACE_DECK_MAX_WARNINGS).optional(),
  observation: z.object({
    schemaVersion: z.literal(WORKSPACE_PREVIEW_CONTRACT_VERSION),
    file: z.object({
      path: pathSchema,
      workspaceRoot: optionalPathSchema,
      mimeType: z.string().trim().max(128).optional(),
      size: z.number().finite().nonnegative().optional(),
      mtimeMs: z.number().finite().nonnegative().optional()
    }).strict(),
    view: z.object({
      pluginId: z.literal(WORKSPACE_DECK_PLUGIN_ID),
      modality: z.literal('deck'),
      mode: z.literal('preview'),
      title: z.string().trim().min(1).max(512)
    }).strict(),
    visibleText: z.string().max(WORKSPACE_DECK_MAX_VISIBLE_TEXT_CHARS).optional(),
    slides: z.array(workspaceDeckObservationSlideSchema).max(WORKSPACE_DECK_MAX_SLIDES),
    deck: z.object({
      textElementCount: z.number().int().nonnegative().optional(),
      truncatedTextElements: z.boolean().optional(),
      textElements: z.array(workspaceDeckObservationTextElementSummarySchema)
        .max(WORKSPACE_DECK_MAX_OBSERVATION_TEXT_ELEMENTS)
        .optional(),
      slidePreviews: z.array(workspaceDeckSlidePreviewSchema)
        .max(WORKSPACE_DECK_MAX_SLIDE_PREVIEWS)
        .optional()
    }).strict().optional(),
    annotations: z.array(z.object({
      id: boundedIdSchema,
      kind: z.string().trim().min(1).max(128),
      summary: warningSchema.optional()
    }).strict()).max(WORKSPACE_DECK_MAX_ANNOTATIONS).optional(),
    actions: z.array(z.string().trim().min(1).max(128)).max(256)
  }).strict()
}).strict()

export const workspaceDeckSelectionSchema = z.object({
  kind: z.literal('deck'),
  slideIds: z.array(boundedIdSchema).max(WORKSPACE_DECK_MAX_SELECTION_ITEMS),
  elementIds: z.array(boundedIdSchema).max(WORKSPACE_DECK_MAX_SELECTION_ITEMS).optional()
}).strict()

export const workspaceDeckSlideSelectionInputSchema = z.object({
  preview: workspaceDeckPreviewResultSchema,
  slideId: boundedIdSchema.optional(),
  index: z.number().int().min(0).optional(),
  maxElements: z.number().int().min(0).max(WORKSPACE_DECK_MAX_SELECTION_ITEMS).default(WORKSPACE_DECK_MAX_SELECTION_ITEMS)
}).strict().superRefine((input, context) => {
  if (!input.slideId && input.index === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'slideId or index is required'
    })
  }
})

export const workspaceDeckSlideSelectionResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_DECK_CONTRACT_VERSION),
  slide: workspaceDeckObservationSlideSchema,
  elementCount: z.number().int().nonnegative(),
  elements: z.array(workspaceDeckTextElementSummarySchema).max(WORKSPACE_DECK_MAX_SELECTION_ITEMS),
  truncatedElements: z.boolean(),
  selection: workspaceDeckSelectionSchema,
  visibleText: z.string().max(WORKSPACE_DECK_MAX_VISIBLE_TEXT_CHARS).optional(),
  warnings: z.array(warningSchema).max(WORKSPACE_DECK_MAX_WARNINGS)
}).strict()

export const workspaceDeckTextSelectionInputSchema = z.object({
  preview: workspaceDeckPreviewResultSchema,
  slideId: boundedIdSchema.optional(),
  elementId: boundedIdSchema.optional(),
  query: z.string().trim().min(1).max(512).optional(),
  kind: workspaceDeckTextElementKindSchema.optional(),
  maxElements: z.number().int().min(0).max(WORKSPACE_DECK_MAX_SELECTION_ITEMS).default(WORKSPACE_DECK_MAX_SELECTION_ITEMS)
}).strict().superRefine((input, context) => {
  if (!input.slideId && !input.elementId && !input.query && !input.kind) {
    context.addIssue({
      code: 'custom',
      message: 'slideId, elementId, query, or kind is required'
    })
  }
})

export const workspaceDeckTextSelectionResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_DECK_CONTRACT_VERSION),
  elementCount: z.number().int().nonnegative(),
  elements: z.array(workspaceDeckTextElementSummarySchema).max(WORKSPACE_DECK_MAX_SELECTION_ITEMS),
  truncatedElements: z.boolean(),
  selection: workspaceDeckSelectionSchema,
  visibleText: z.string().max(WORKSPACE_DECK_MAX_VISIBLE_TEXT_CHARS).optional(),
  warnings: z.array(warningSchema).max(WORKSPACE_DECK_MAX_WARNINGS)
}).strict()

export type WorkspaceDeckPreviewInput = z.input<typeof workspaceDeckPreviewInputSchema>
export type NormalizedWorkspaceDeckPreviewInput = z.output<typeof workspaceDeckPreviewInputSchema>
export type WorkspaceDeckPptxPreviewInput = z.input<typeof workspaceDeckPptxPreviewInputSchema>
export type NormalizedWorkspaceDeckPptxPreviewInput = z.output<typeof workspaceDeckPptxPreviewInputSchema>
export type WorkspaceDeckPptxTextElementUpdateInput = z.input<typeof workspaceDeckPptxTextElementUpdateInputSchema>
export type NormalizedWorkspaceDeckPptxTextElementUpdateInput = z.output<typeof workspaceDeckPptxTextElementUpdateInputSchema>
export type WorkspaceDeckPptxTextElementUpdateResult = z.infer<typeof workspaceDeckPptxTextElementUpdateResultSchema>
export type WorkspaceDeckTextElementKind = z.infer<typeof workspaceDeckTextElementKindSchema>
export type WorkspaceDeckTextElementSummary = z.infer<typeof workspaceDeckTextElementSummarySchema>
export type WorkspaceDeckObservationTextElementSummary = z.infer<typeof workspaceDeckObservationTextElementSummarySchema>
export type WorkspaceDeckSlidePreviewTextBox = z.infer<typeof workspaceDeckSlidePreviewTextBoxSchema>
export type WorkspaceDeckSlidePreview = z.infer<typeof workspaceDeckSlidePreviewSchema>
export type WorkspaceDeckObservationSlide = z.infer<typeof workspaceDeckObservationSlideSchema>
export type WorkspaceDeckSelection = z.infer<typeof workspaceDeckSelectionSchema>
export type WorkspaceDeckPreviewResult = z.infer<typeof workspaceDeckPreviewResultSchema>
export type WorkspaceDeckComment = z.infer<typeof workspaceDeckCommentSchema>
export type WorkspaceDeckCommentAuthor = z.infer<typeof workspaceDeckCommentAuthorSchema>
export type WorkspaceDeckSlideSelectionInput = z.input<typeof workspaceDeckSlideSelectionInputSchema>
export type NormalizedWorkspaceDeckSlideSelectionInput = z.output<typeof workspaceDeckSlideSelectionInputSchema>
export type WorkspaceDeckSlideSelectionResult = z.infer<typeof workspaceDeckSlideSelectionResultSchema>
export type WorkspaceDeckTextSelectionInput = z.input<typeof workspaceDeckTextSelectionInputSchema>
export type NormalizedWorkspaceDeckTextSelectionInput = z.output<typeof workspaceDeckTextSelectionInputSchema>
export type WorkspaceDeckTextSelectionResult = z.infer<typeof workspaceDeckTextSelectionResultSchema>

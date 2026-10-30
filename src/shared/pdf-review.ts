import { z } from 'zod'
import {
  pdfAnchorRectSchema,
  pdfAnnotationSidecarSchema,
  pdfAnnotationSidecarTargetSchema,
  type PdfAnchorRect,
  type PdfAnnotationSidecar,
  type PdfAnnotationSidecarTarget
} from './pdf-annotations'

export const PDF_REVIEW_GENERATE_ACTION_ID = 'annotation.review.generate'
export const PDF_REVIEW_IMPROVE_ACTION_ID = 'annotation.review.improve'

export type PdfReviewSelection = {
  text?: string
  rects?: PdfAnchorRect[]
  pageStart?: number
  pageEnd?: number
}

export type PdfReviewGenerateActionInput = {
  maxComments?: number
  prompt?: string
  selection?: PdfReviewSelection
  replaceExisting?: boolean
}

export type PdfReviewGeneratePayload = PdfAnnotationSidecarTarget & PdfReviewGenerateActionInput & {
  reviewDataPath?: string
}

export type PdfReviewGenerateResult =
  | {
      ok: true
      mode: 'auto' | 'import'
      sidecar: PdfAnnotationSidecar
      path: string
      reviewDataPath?: string
      commentCount: number
      skippedCount: number
      generatedAt: string
    }
  | { ok: false; message: string }

export type PdfReviewImproveAnnotationActionInput = {
  threadId: string
  annotationId?: string
  userComment?: string
}

export type PdfReviewImproveAnnotationPayload =
  PdfAnnotationSidecarTarget & PdfReviewImproveAnnotationActionInput

export type PdfReviewImproveAnnotationResult =
  | {
      ok: true
      sidecar: PdfAnnotationSidecar
      path: string
      threadId: string
      annotationId: string
      modificationAdvice: string
      revisedContent: string
      generatedAt: string
    }
  | { ok: false; message: string }

export const pdfReviewSelectionSchema = z.object({
  text: z.string().trim().max(80_000).optional(),
  rects: z.array(pdfAnchorRectSchema).min(1).max(800).optional(),
  pageStart: z.number().int().positive().max(1_000_000).optional(),
  pageEnd: z.number().int().positive().max(1_000_000).optional()
}).strict().refine((selection) => Boolean(selection.text || selection.rects?.length), {
  message: 'PDF review selection must include text or rects.'
})

export const pdfReviewGenerateActionInputSchema = z.object({
  maxComments: z.number().int().positive().max(50).optional(),
  prompt: z.string().trim().min(1).max(20_000).optional(),
  selection: pdfReviewSelectionSchema.optional(),
  replaceExisting: z.boolean().optional()
}).strict()

export const pdfReviewGeneratePayloadSchema = pdfAnnotationSidecarTargetSchema
  .extend({
    reviewDataPath: z.string().trim().min(1).max(4096).optional(),
    maxComments: z.number().int().positive().max(50).optional(),
    prompt: z.string().trim().min(1).max(20_000).optional(),
    selection: pdfReviewSelectionSchema.optional(),
    replaceExisting: z.boolean().optional()
  })
  .strict()

export const pdfReviewImproveAnnotationActionInputSchema = z.object({
  threadId: z.string().trim().min(1).max(512),
  annotationId: z.string().trim().min(1).max(512).optional(),
  userComment: z.string().max(80_000).optional()
}).strict()

export const pdfReviewImproveAnnotationPayloadSchema = pdfAnnotationSidecarTargetSchema
  .extend({
    threadId: z.string().trim().min(1).max(512),
    annotationId: z.string().trim().min(1).max(512).optional(),
    userComment: z.string().max(80_000).optional()
  })
  .strict()

export const pdfReviewGenerateActionResultSchema = z.object({
  sidecar: pdfAnnotationSidecarSchema,
  mode: z.enum(['auto', 'import']),
  path: z.string().trim().min(1).max(4096),
  reviewDataPath: z.string().trim().min(1).max(4096).optional(),
  commentCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  generatedAt: z.string().trim().min(1).max(128),
  effect: z.literal('sidecar-write')
}).strict()

export const pdfReviewImproveAnnotationActionResultSchema = z.object({
  sidecar: pdfAnnotationSidecarSchema,
  path: z.string().trim().min(1).max(4096),
  threadId: z.string().trim().min(1).max(512),
  annotationId: z.string().trim().min(1).max(512),
  modificationAdvice: z.string().trim().min(1).max(80_000),
  revisedContent: z.string().trim().min(1).max(80_000),
  generatedAt: z.string().trim().min(1).max(128),
  effect: z.literal('sidecar-write')
}).strict()

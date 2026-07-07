import { z } from 'zod'
import {
  pdfAnchorRectSchema,
  pdfAnnotationSidecarSchema,
  pdfAnnotationSidecarTargetSchema,
  type PdfAnchorRect,
  type PdfAnnotationSidecar,
  type PdfAnnotationSidecarTarget
} from './pdf-annotations'

export type PdfReviewSelection = {
  text?: string
  rects?: PdfAnchorRect[]
  pageStart?: number
  pageEnd?: number
}

export type PdfReviewGeneratePayload = PdfAnnotationSidecarTarget & {
  reviewDataPath?: string
  gifPath?: string
  maxComments?: number
  selection?: PdfReviewSelection
  replaceExisting?: boolean
}

export type PdfReviewGenerateResult =
  | {
      ok: true
      mode: 'auto' | 'import'
      sidecar: PdfAnnotationSidecar
      path: string
      reviewDataPath?: string
      gifPath?: string
      commentCount: number
      skippedCount: number
      generatedAt: string
    }
  | { ok: false; message: string }

export type PdfReviewImproveAnnotationPayload = PdfAnnotationSidecarTarget & {
  sidecar: PdfAnnotationSidecar
  threadId: string
  annotationId?: string
  userComment?: string
}

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

export const pdfReviewGeneratePayloadSchema = pdfAnnotationSidecarTargetSchema
  .extend({
    reviewDataPath: z.string().trim().min(1).max(4096).optional(),
    gifPath: z.string().trim().min(1).max(4096).optional(),
    maxComments: z.number().int().positive().max(200).optional(),
    selection: z.object({
      text: z.string().trim().max(80_000).optional(),
      rects: z.array(pdfAnchorRectSchema).min(1).max(800).optional(),
      pageStart: z.number().int().positive().max(1_000_000).optional(),
      pageEnd: z.number().int().positive().max(1_000_000).optional()
    }).strict().refine((selection) => Boolean(selection.text || selection.rects?.length), {
      message: 'PDF review selection must include text or rects.'
    }).optional(),
    replaceExisting: z.boolean().optional()
  })
  .strict()

export const pdfReviewImproveAnnotationPayloadSchema = pdfAnnotationSidecarTargetSchema
  .extend({
    sidecar: pdfAnnotationSidecarSchema,
    threadId: z.string().trim().min(1).max(512),
    annotationId: z.string().trim().min(1).max(512).optional(),
    userComment: z.string().max(80_000).optional()
  })
  .strict()

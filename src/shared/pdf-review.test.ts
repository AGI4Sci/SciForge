import { describe, expect, it } from 'vitest'
import {
  PDF_REVIEW_GENERATE_ACTION_ID,
  PDF_REVIEW_IMPROVE_ACTION_ID,
  pdfReviewGenerateActionInputSchema,
  pdfReviewGenerateActionResultSchema,
  pdfReviewImproveAnnotationActionInputSchema,
  pdfReviewImproveAnnotationActionResultSchema
} from './pdf-review'

describe('PDF review action contracts', () => {
  it('validates bounded PDF review generation inputs', () => {
    const parsed = pdfReviewGenerateActionInputSchema.parse({
      maxComments: 12,
      replaceExisting: false,
      selection: {
        text: '  Selected claim text  ',
        rects: [{ page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
        pageStart: 1,
        pageEnd: 1
      }
    })

    expect(PDF_REVIEW_GENERATE_ACTION_ID).toBe('annotation.review.generate')
    expect(parsed.maxComments).toBe(12)
    expect(parsed.replaceExisting).toBe(false)
    expect(parsed.selection?.text).toBe('Selected claim text')
    expect(() => pdfReviewGenerateActionInputSchema.parse({ maxComments: 51 })).toThrow()
    expect(() => pdfReviewGenerateActionInputSchema.parse({ selection: {} })).toThrow()
  })

  it('validates PDF review improvement inputs and sidecar-write results', () => {
    const input = pdfReviewImproveAnnotationActionInputSchema.parse({
      threadId: ' thread-1 ',
      annotationId: 'ann-1',
      userComment: 'Please make the evidence more concrete.'
    })

    expect(PDF_REVIEW_IMPROVE_ACTION_ID).toBe('annotation.review.improve')
    expect(input.threadId).toBe('thread-1')
    expect(() => pdfReviewImproveAnnotationActionInputSchema.parse({ threadId: '' })).toThrow()

    expect(pdfReviewGenerateActionResultSchema.safeParse({
      sidecar: emptySidecar(),
      mode: 'auto',
      path: '.sciforge/pdf-annotations/review.json',
      commentCount: 1,
      skippedCount: 0,
      generatedAt: '2026-07-09T00:00:00.000Z',
      effect: 'sidecar-write'
    }).success).toBe(true)

    expect(pdfReviewImproveAnnotationActionResultSchema.safeParse({
      sidecar: emptySidecar(),
      path: '.sciforge/pdf-annotations/review.json',
      threadId: 'thread-1',
      annotationId: 'ann-1',
      modificationAdvice: 'Add concrete evidence.',
      revisedContent: 'We add concrete evidence here.',
      generatedAt: '2026-07-09T00:00:00.000Z',
      effect: 'sidecar-write'
    }).success).toBe(true)
  })
})

function emptySidecar() {
  const now = '2026-07-09T00:00:00.000Z'
  return {
    schemaVersion: 1,
    version: 1,
    manifest: {
      app: 'sciforge.pdf-annotations',
      schemaVersion: 1,
      sourcePdfName: 'paper.pdf',
      privacy: {
        explicitOnly: true,
        chatTranscriptEmbedded: false
      },
      contribution: {
        reviewableJson: true,
        mergeKey: 'threadId',
        conflictResolution: 'updatedAt'
      },
      createdAt: now,
      updatedAt: now
    },
    pdfFingerprint: {
      sha256: 'pdf-sha',
      size: 100,
      pageCount: 1,
      fileName: 'paper.pdf'
    },
    anchors: [],
    annotations: [],
    threads: [],
    authors: [],
    updatedAt: now
  }
}

import { describe, expect, it } from 'vitest'
import {
  createEmptyPdfAnnotationSidecar,
  createPdfAnchor,
  hashPdfAnchorText,
  migratePdfAnnotationSidecar,
  normalizePdfAnchorRects,
  pdfAnchorPageRange,
  relocatePdfAnchor,
  stablePdfAnnotationSidecar,
  type PdfAnnotationSidecar,
  type PdfFingerprint
} from './pdf-annotations'

const fingerprint: PdfFingerprint = {
  sha256: 'sha256-paper',
  size: 1234,
  pageCount: 12,
  fileName: 'paper.pdf'
}

describe('pdf annotation sidecar schema', () => {
  it('creates a v1 sidecar with explicit-only privacy defaults', () => {
    const sidecar = createEmptyPdfAnnotationSidecar(fingerprint, {
      sourcePdfName: 'paper.pdf',
      sourcePdfPath: '/workspace/paper.pdf',
      now: '2026-06-22T00:00:00.000Z'
    })

    expect(sidecar.schemaVersion).toBe(1)
    expect(sidecar.manifest.app).toBe('sciforge.pdf-annotations')
    expect(sidecar.manifest.privacy).toEqual({
      explicitOnly: true,
      chatTranscriptEmbedded: false
    })
    expect(sidecar.manifest.contribution).toEqual({
      reviewableJson: true,
      mergeKey: 'threadId',
      conflictResolution: 'updatedAt'
    })
    expect(sidecar.deletedThreads).toEqual([])
  })

  it('migrates sparse legacy-shaped JSON into a valid v1 sidecar', () => {
    const migrated = migratePdfAnnotationSidecar({
      version: 4,
      pdfFingerprint: fingerprint,
      anchors: [],
      annotations: [],
      threads: [],
      authors: [],
      updatedAt: '2026-06-22T00:00:00.000Z'
    })

    expect(migrated.schemaVersion).toBe(1)
    expect(migrated.version).toBe(4)
    expect(migrated.manifest.schemaVersion).toBe(1)
  })

  it('persists stable text ranges through create, schema migration, and stable normalization', () => {
    const anchor = createPdfAnchor({
      id: 'markdown-anchor',
      rects: [],
      quote: 'bounded selection',
      contextBefore: 'before',
      contextAfter: 'after',
      textRange: {
        start: 12,
        end: 29,
        startLine: 2,
        startColumn: 4,
        endLine: 2,
        endColumn: 21
      },
      pdfFingerprint: fingerprint,
      createdAt: '2026-06-22T00:00:00.000Z'
    })
    const sidecar: PdfAnnotationSidecar = {
      ...createEmptyPdfAnnotationSidecar(fingerprint),
      anchors: [anchor]
    }

    expect(anchor.textRange).toEqual({
      start: 12,
      end: 29,
      startLine: 2,
      startColumn: 4,
      endLine: 2,
      endColumn: 21
    })
    expect(migratePdfAnnotationSidecar(JSON.parse(JSON.stringify(sidecar))).anchors[0]?.textRange)
      .toEqual(anchor.textRange)
    expect(stablePdfAnnotationSidecar(sidecar).anchors[0]?.textRange).toEqual(anchor.textRange)
  })

  it('rejects inverted stable text ranges', () => {
    expect(() => createPdfAnchor({
      id: 'bad-range',
      rects: [],
      quote: 'bad',
      textRange: { start: 9, end: 3 },
      pdfFingerprint: fingerprint
    })).toThrow('Annotation text range end')
  })

  it('keeps stable ordering for reviewable JSON diffs', () => {
    const sidecar: PdfAnnotationSidecar = {
      ...createEmptyPdfAnnotationSidecar(fingerprint),
      anchors: [
        createPdfAnchor({ id: 'b', rects: [{ page: 2, x: 0, y: 0, width: 0.1, height: 0.1 }], pdfFingerprint: fingerprint }),
        createPdfAnchor({ id: 'a', rects: [{ page: 1, x: 0, y: 0, width: 0.1, height: 0.1 }], pdfFingerprint: fingerprint })
      ],
      annotations: [
        {
          id: 'ann-b',
          threadId: 'thread-b',
          anchorId: 'b',
          kind: 'comment',
          body: 'B',
          createdAt: '2026-06-22T00:00:02.000Z',
          updatedAt: '2026-06-22T00:00:02.000Z'
        },
        {
          id: 'ann-a',
          threadId: 'thread-a',
          anchorId: 'a',
          kind: 'highlight',
          body: '',
          createdAt: '2026-06-22T00:00:01.000Z',
          updatedAt: '2026-06-22T00:00:01.000Z'
        }
      ],
      threads: [
        {
          id: 'thread-b',
          kind: 'comment',
          anchorIds: ['b', 'a', 'a'],
          annotationIds: ['ann-b'],
          status: 'open',
          createdAt: '2026-06-22T00:00:02.000Z',
          updatedAt: '2026-06-22T00:00:02.000Z'
        },
        {
          id: 'thread-a',
          kind: 'highlight',
          anchorIds: ['a'],
          annotationIds: ['ann-a'],
          status: 'open',
          createdAt: '2026-06-22T00:00:01.000Z',
          updatedAt: '2026-06-22T00:00:01.000Z'
        }
      ]
    }

    const stable = stablePdfAnnotationSidecar(sidecar)

    expect(stable.anchors.map((anchor) => anchor.id)).toEqual(['a', 'b'])
    expect(stable.annotations.map((annotation) => annotation.id)).toEqual(['ann-a', 'ann-b'])
    expect(stable.threads.map((thread) => thread.id)).toEqual(['thread-a', 'thread-b'])
    expect(stable.threads[1].anchorIds).toEqual(['a', 'b'])
  })

  it('keeps deleted thread content removed when a stale snapshot contains it', () => {
    const now = '2026-06-22T00:00:03.000Z'
    const sidecar: PdfAnnotationSidecar = {
      ...createEmptyPdfAnnotationSidecar(fingerprint),
      anchors: [
        createPdfAnchor({
          id: 'anchor-deleted',
          rects: [{ page: 1, x: 0, y: 0, width: 0.1, height: 0.1 }],
          pdfFingerprint: fingerprint
        })
      ],
      annotations: [{
        id: 'annotation-deleted',
        threadId: 'thread-deleted',
        anchorId: 'anchor-deleted',
        kind: 'comment',
        body: 'This content must not return.',
        createdAt: now,
        updatedAt: now
      }],
      threads: [{
        id: 'thread-deleted',
        kind: 'comment',
        anchorIds: ['anchor-deleted'],
        annotationIds: ['annotation-deleted'],
        status: 'open',
        createdAt: now,
        updatedAt: now
      }],
      deletedThreads: [{
        threadId: 'thread-deleted',
        annotationIds: ['annotation-deleted'],
        anchorIds: ['anchor-deleted'],
        deletedAt: '2026-06-22T00:00:04.000Z',
        deletedVersion: 2
      }]
    }

    const stable = stablePdfAnnotationSidecar(sidecar)

    expect(stable.threads).toEqual([])
    expect(stable.annotations).toEqual([])
    expect(stable.anchors).toEqual([])
    expect(stable.deletedThreads).toHaveLength(1)
  })
})

describe('pdf anchor geometry', () => {
  it('normalizes coordinates and caps impossible rects', () => {
    expect(normalizePdfAnchorRects([
      { page: 1, x: 0.9, y: -1, width: 0.4, height: 2 },
      { page: 0, x: 0, y: 0, width: 0.1, height: 0.1 }
    ])).toEqual([
      { page: 1, x: 0.6, y: 0, width: 0.4, height: 1 }
    ])
  })

  it('derives a cross-page range from rects', () => {
    expect(pdfAnchorPageRange([
      { page: 5, x: 0, y: 0, width: 0.2, height: 0.1 },
      { page: 3, x: 0, y: 0, width: 0.2, height: 0.1 }
    ])).toEqual({ pageStart: 3, pageEnd: 5 })
  })

  it('relocates by quote before falling back to original rects', () => {
    const anchor = createPdfAnchor({
      id: 'anchor-1',
      rects: [{ page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      quote: 'loss landscape',
      contextBefore: 'sharp minima',
      contextAfter: 'flat basin',
      pdfFingerprint: fingerprint,
      createdAt: '2026-06-22T00:00:00.000Z'
    })

    expect(anchor.textHash).toBe(hashPdfAnchorText('loss landscape'))
    expect(relocatePdfAnchor(anchor, [
      { page: 1, text: 'unrelated' },
      { page: 2, text: 'The loss landscape is smoother after pretraining.' }
    ])).toMatchObject({
      strategy: 'text-hash',
      pageStart: 2,
      pageEnd: 2
    })

    expect(relocatePdfAnchor({ ...anchor, quote: 'missing', textHash: hashPdfAnchorText('missing') }, [
      { page: 1, text: 'still unrelated' }
    ])).toMatchObject({
      strategy: 'original-rect',
      pageStart: 1,
      pageEnd: 1
    })
  })
})

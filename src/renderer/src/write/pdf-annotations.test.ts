import { describe, expect, it } from 'vitest'
import {
  createEmptyPdfAnnotationSidecar,
  type PdfAnchor,
  type PdfAnnotationSidecar
} from '@shared/pdf-annotations'
import {
  addPdfAnnotationToThread,
  createPdfAnnotationThread,
  deletePdfAnnotationThread,
  getPdfAnnotationThreadSummaries,
  mergePdfAnnotationContribution,
  reopenPdfAnnotationThread,
  resolvePdfAnnotationThread,
  sortPdfAnnotationThreadSummaries,
  updatePdfAnnotation,
  updatePdfAnnotationThread
} from './pdf-annotations'

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-01T01:00:00.000Z'
const T2 = '2026-01-01T02:00:00.000Z'
const T3 = '2026-01-01T03:00:00.000Z'
const T4 = '2026-01-01T04:00:00.000Z'
const T5 = '2026-01-01T05:00:00.000Z'
const T6 = '2026-01-01T06:00:00.000Z'

function anchor(id: string, pageStart: number, pageEnd = pageStart, quote = `Quote ${id}`): PdfAnchor {
  return {
    id,
    kind: 'text',
    pageStart,
    pageEnd,
    rects: [{ page: pageStart, x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    quote,
    textHash: `hash-${id}`,
    contextBefore: '',
    contextAfter: '',
    pdfFingerprint: { sha256: 'pdf-sha', size: 2048, pageCount: 12, fileName: 'paper.pdf' },
    createdAt: T0,
    updatedAt: T0
  }
}

function emptySidecar(): PdfAnnotationSidecar {
  return {
    ...createEmptyPdfAnnotationSidecar(
      { sha256: 'pdf-sha', size: 2048, pageCount: 12, fileName: 'paper.pdf' },
      { sourcePdfName: 'paper.pdf', now: T0 }
    ),
    anchors: [
      anchor('anchor-a', 2, 2, 'The first claim'),
      anchor('anchor-b', 5, 6, 'A question about anisotropy'),
      anchor('anchor-c', 9, 9, 'Translation target')
    ],
    authors: [{ id: 'author-a', name: 'Ada', createdAt: T0, updatedAt: T0 }]
  }
}

function seededSidecar(): PdfAnnotationSidecar {
  const withFirst = createPdfAnnotationThread(emptySidecar(), {
    id: 'thread-a',
    kind: 'comment',
    anchorIds: ['anchor-a'],
    annotations: [{
      id: 'ann-a',
      anchorId: 'anchor-a',
      body: 'First note on the claim',
      authorId: 'author-a'
    }],
    title: 'Claim note',
    createdAt: T1
  })
  return createPdfAnnotationThread(withFirst, {
    id: 'thread-b',
    kind: 'question',
    anchorIds: ['anchor-b'],
    annotations: [{
      id: 'ann-b',
      anchorId: 'anchor-b',
      body: 'Why does anisotropy change the measurement?'
    }],
    status: 'resolved',
    createdAt: T2,
    updatedAt: T3
  })
}

describe('renderer PDF annotation helpers', () => {
  it('creates a thread and annotation without mutating the input sidecar', () => {
    const base = emptySidecar()
    const next = createPdfAnnotationThread(base, {
      id: 'thread-new',
      kind: 'highlight',
      anchorIds: ['anchor-a'],
      annotations: [{
        id: 'ann-new',
        anchorId: 'anchor-a',
        body: '  Highlighted claim  ',
        color: ' #ffe08a '
      }],
      createdAt: T1
    })

    expect(base.threads).toHaveLength(0)
    expect(base.annotations).toHaveLength(0)
    expect(next.version).toBe(base.version + 1)
    expect(next.updatedAt).toBe(T1)
    expect(next.threads).toHaveLength(1)
    expect(next.annotations).toMatchObject([{
      id: 'ann-new',
      threadId: 'thread-new',
      anchorId: 'anchor-a',
      kind: 'highlight',
      body: 'Highlighted claim',
      color: '#ffe08a'
    }])
  })

  it('updates thread metadata and edits an annotation body', () => {
    const sidecar = seededSidecar()
    const resolved = resolvePdfAnnotationThread(sidecar, 'thread-a', T4)
    const retitled = updatePdfAnnotationThread(resolved, 'thread-a', {
      title: '  Revised claim note  ',
      status: 'open',
      updatedAt: T4
    })
    const edited = updatePdfAnnotation(retitled, 'ann-a', {
      body: '  Edited note on the claim  ',
      color: '#ffcc00',
      updatedAt: T5
    })
    const summary = getPdfAnnotationThreadSummaries(edited, {
      filter: { query: 'edited note' }
    })[0]

    expect(sidecar.threads.find((thread) => thread.id === 'thread-a')?.status).toBe('open')
    expect(retitled.threads.find((thread) => thread.id === 'thread-a')).toMatchObject({
      title: 'Revised claim note',
      status: 'open',
      updatedAt: T4
    })
    expect(summary.thread.id).toBe('thread-a')
    expect(summary.thread.updatedAt).toBe(T5)
    expect(summary.firstAnnotation).toMatchObject({
      body: 'Edited note on the claim',
      color: '#ffcc00'
    })
  })

  it('reopens a resolved thread and advances sidecar timestamps', () => {
    const sidecar = seededSidecar()
    const reopened = reopenPdfAnnotationThread(sidecar, 'thread-b', T4)

    expect(sidecar.threads.find((thread) => thread.id === 'thread-b')).toMatchObject({
      status: 'resolved',
      updatedAt: T3
    })
    expect(reopened.version).toBe(sidecar.version + 1)
    expect(reopened.updatedAt).toBe(T4)
    expect(reopened.manifest.updatedAt).toBe(T4)
    expect(reopened.threads.find((thread) => thread.id === 'thread-b')).toMatchObject({
      status: 'open',
      updatedAt: T4
    })
  })

  it('adds an assistant answer annotation to an existing thread and links the source message', () => {
    const sidecar = seededSidecar()
    const next = addPdfAnnotationToThread(sidecar, 'thread-b', {
      id: 'ann-answer',
      kind: 'answer',
      body: '  The measurement changes because the anisotropic axis is rotated.  ',
      sourceText: 'A question about anisotropy',
      sourceMessageId: 'assistant-message-1',
      createdAt: T4,
      resolveThread: true
    })

    expect(sidecar.annotations.map((annotation) => annotation.id)).toEqual(['ann-a', 'ann-b'])
    expect(next.version).toBe(sidecar.version + 1)
    expect(next.updatedAt).toBe(T4)
    expect(next.threads.find((thread) => thread.id === 'thread-b')).toMatchObject({
      annotationIds: ['ann-answer', 'ann-b'],
      status: 'resolved',
      updatedAt: T4
    })
    expect(next.annotations.find((annotation) => annotation.id === 'ann-answer')).toMatchObject({
      threadId: 'thread-b',
      anchorId: 'anchor-b',
      kind: 'answer',
      body: 'The measurement changes because the anisotropic axis is rotated.',
      sourceText: 'A question about anisotropy',
      sourceMessageId: 'assistant-message-1',
      createdAt: T4,
      updatedAt: T4
    })
  })

  it('backfills image anchor quote from saved OCR or vision annotation text', () => {
    const visualAnchor: PdfAnchor = {
      ...anchor('anchor-visual', 4, 4, 'PDF visual region'),
      kind: 'image',
      textHash: 'placeholder-hash'
    }
    const sidecar = createPdfAnnotationThread({
      ...emptySidecar(),
      anchors: [visualAnchor]
    }, {
      id: 'thread-visual',
      kind: 'question',
      anchorIds: ['anchor-visual'],
      annotations: [{
        id: 'ann-visual-question',
        anchorId: 'anchor-visual',
        body: 'Question sent to the assistant.',
        sourceText: 'PDF visual region'
      }],
      createdAt: T1
    })

    const next = addPdfAnnotationToThread(sidecar, 'thread-visual', {
      id: 'ann-visual-answer',
      kind: 'answer',
      body: 'The scanned figure label reads ATP concentration.',
      sourceText: 'PDF visual region',
      createdAt: T4,
      resolveThread: true
    })
    const nextAnchor = next.anchors.find((item) => item.id === 'anchor-visual')

    expect(nextAnchor).toMatchObject({
      quote: 'The scanned figure label reads ATP concentration.',
      updatedAt: T4
    })
    expect(nextAnchor?.textHash).toMatch(/^fnv1a32:/)
    expect(nextAnchor?.textHash).not.toBe('placeholder-hash')
  })

  it('does not overwrite established text anchor quotes when saving assistant annotations', () => {
    const sidecar = seededSidecar()
    const next = addPdfAnnotationToThread(sidecar, 'thread-a', {
      id: 'ann-answer-text-anchor',
      kind: 'answer',
      body: 'A later answer should not replace the selected quote.',
      sourceText: 'The first claim',
      createdAt: T4
    })

    expect(next.anchors.find((item) => item.id === 'anchor-a')?.quote).toBe('The first claim')
  })

  it('deletes a thread with its annotations and prunes orphan anchors', () => {
    const sidecar = seededSidecar()
    const deleted = deletePdfAnnotationThread(sidecar, 'thread-a', { updatedAt: T4 })

    expect(deleted.threads.map((thread) => thread.id)).toEqual(['thread-b'])
    expect(deleted.annotations.map((annotation) => annotation.id)).toEqual(['ann-b'])
    expect(deleted.anchors.map((item) => item.id)).toEqual(['anchor-b', 'anchor-c'])
    expect(sidecar.anchors.map((item) => item.id)).toEqual(['anchor-a', 'anchor-b', 'anchor-c'])
  })

  it('filters thread summaries by kind, status, page, and query', () => {
    const sidecar = seededSidecar()

    expect(getPdfAnnotationThreadSummaries(sidecar, {
      filter: { kind: 'question', status: 'resolved', page: 6 }
    }).map((summary) => summary.thread.id)).toEqual(['thread-b'])

    expect(getPdfAnnotationThreadSummaries(sidecar, {
      filter: { kind: 'question', status: 'open', page: 6 }
    })).toHaveLength(0)

    expect(getPdfAnnotationThreadSummaries(sidecar, {
      filter: { query: 'first claim', page: 2 }
    }).map((summary) => summary.thread.id)).toEqual(['thread-a'])
  })

  it('sorts summaries by updated time and page with deterministic ties', () => {
    const sidecar = createPdfAnnotationThread(seededSidecar(), {
      id: 'thread-c',
      kind: 'translation',
      anchorIds: ['anchor-c'],
      annotations: [{
        id: 'ann-c',
        anchorId: 'anchor-c',
        body: 'Translate the highlighted sentence.'
      }],
      createdAt: T2,
      updatedAt: T2
    })
    const summaries = getPdfAnnotationThreadSummaries(sidecar, {
      sort: { key: 'updatedAt', direction: 'desc' }
    })

    expect(summaries.map((summary) => summary.thread.id)).toEqual(['thread-b', 'thread-c', 'thread-a'])
    expect(sortPdfAnnotationThreadSummaries(summaries, {
      key: 'page',
      direction: 'asc'
    }).map((summary) => summary.thread.id)).toEqual(['thread-a', 'thread-b', 'thread-c'])
  })

  it('merges incoming contribution threads by updatedAt and returns merge counts', () => {
    const local = seededSidecar()
    const incoming: PdfAnnotationSidecar = {
      ...emptySidecar(),
      anchors: [
        anchor('anchor-a', 2, 2, 'Incoming revised claim'),
        anchor('anchor-b', 5, 6, 'Stale incoming question'),
        anchor('anchor-d', 11, 11, 'New contributed observation')
      ],
      annotations: [
        {
          id: 'ann-a',
          threadId: 'thread-a',
          anchorId: 'anchor-a',
          kind: 'note',
          body: 'Incoming replacement note',
          authorId: 'author-a',
          createdAt: T1,
          updatedAt: T5
        },
        {
          id: 'ann-b',
          threadId: 'thread-b',
          anchorId: 'anchor-b',
          kind: 'question',
          body: 'Stale incoming question body',
          createdAt: T2,
          updatedAt: T2
        },
        {
          id: 'ann-d',
          threadId: 'thread-d',
          anchorId: 'anchor-d',
          kind: 'comment',
          body: 'New incoming thread body',
          authorId: 'author-d',
          createdAt: T4,
          updatedAt: T4
        }
      ],
      threads: [
        {
          id: 'thread-a',
          kind: 'note',
          anchorIds: ['anchor-a'],
          annotationIds: ['ann-a'],
          status: 'resolved',
          title: 'Incoming replacement title',
          authorId: 'author-a',
          createdAt: T1,
          updatedAt: T5
        },
        {
          id: 'thread-b',
          kind: 'question',
          anchorIds: ['anchor-b'],
          annotationIds: ['ann-b'],
          status: 'open',
          title: 'Stale incoming title',
          createdAt: T2,
          updatedAt: T2
        },
        {
          id: 'thread-d',
          kind: 'comment',
          anchorIds: ['anchor-d'],
          annotationIds: ['ann-d'],
          status: 'open',
          title: 'New incoming title',
          authorId: 'author-d',
          createdAt: T4,
          updatedAt: T4
        }
      ],
      authors: [
        { id: 'author-a', name: 'Ada Revised', createdAt: T0, updatedAt: T5 },
        { id: 'author-d', name: 'Dorothy', createdAt: T4, updatedAt: T4 }
      ],
      updatedAt: T5
    }

    const result = mergePdfAnnotationContribution(local, incoming, { updatedAt: T6 })

    expect(result.addedThreadCount).toBe(1)
    expect(result.updatedThreadCount).toBe(1)
    expect(result.skippedThreadCount).toBe(1)
    expect(result.conflicts).toEqual([
      {
        threadId: 'thread-a',
        kept: 'incoming',
        localUpdatedAt: T1,
        incomingUpdatedAt: T5
      },
      {
        threadId: 'thread-b',
        kept: 'local',
        localUpdatedAt: T3,
        incomingUpdatedAt: T2
      }
    ])
    expect(result.sidecar.version).toBe(local.version + 1)
    expect(result.sidecar.updatedAt).toBe(T6)
    expect(result.sidecar.manifest.updatedAt).toBe(T6)
    expect(result.sidecar.threads.map((thread) => thread.id)).toEqual(['thread-b', 'thread-d', 'thread-a'])
    expect(result.sidecar.threads.find((thread) => thread.id === 'thread-a')).toMatchObject({
      kind: 'note',
      status: 'resolved',
      title: 'Incoming replacement title',
      updatedAt: T5
    })
    expect(result.sidecar.threads.find((thread) => thread.id === 'thread-b')).toMatchObject({
      status: 'resolved',
      updatedAt: T3
    })
    expect(result.sidecar.threads.find((thread) => thread.id === 'thread-d')).toMatchObject({
      title: 'New incoming title',
      updatedAt: T4
    })
    expect(result.sidecar.authors).toEqual([
      { id: 'author-a', name: 'Ada Revised', createdAt: T0, updatedAt: T5 },
      { id: 'author-d', name: 'Dorothy', createdAt: T4, updatedAt: T4 }
    ])
    expect(result.sidecar.anchors.find((item) => item.id === 'anchor-a')?.quote).toBe('Incoming revised claim')
    expect(result.sidecar.anchors.find((item) => item.id === 'anchor-b')?.quote).toBe('A question about anisotropy')
    expect(result.sidecar.anchors.find((item) => item.id === 'anchor-d')?.quote).toBe('New contributed observation')
    expect(result.sidecar.annotations.find((annotation) => annotation.id === 'ann-a')).toMatchObject({
      body: 'Incoming replacement note',
      kind: 'note',
      updatedAt: T5
    })
    expect(result.sidecar.annotations.find((annotation) => annotation.id === 'ann-b')).toMatchObject({
      body: 'Why does anisotropy change the measurement?',
      updatedAt: T3
    })
    expect(result.sidecar.annotations.find((annotation) => annotation.id === 'ann-d')).toMatchObject({
      body: 'New incoming thread body',
      updatedAt: T4
    })
  })

  it('rejects merging a contribution from a different PDF fingerprint', () => {
    const local = seededSidecar()
    const incoming: PdfAnnotationSidecar = {
      ...local,
      pdfFingerprint: {
        ...local.pdfFingerprint,
        sha256: 'different-pdf-sha'
      }
    }

    expect(() => mergePdfAnnotationContribution(local, incoming, { updatedAt: T4 }))
      .toThrow('PDF annotation contribution fingerprint mismatch.')
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyPdfAnnotationSidecar, type PdfAnchor, type PdfAnnotationSidecar } from '@shared/pdf-annotations'
import i18n from '../../i18n'
import { createPdfAnnotationThread, resolvePdfAnnotationThread } from '../../write/pdf-annotations'
import { WritePdfAnnotationsPanel } from './WritePdfAnnotationsPanel'

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-01T01:00:00.000Z'
const T2 = '2026-01-01T02:00:00.000Z'

function anchor(id: string, page: number, quote: string): PdfAnchor {
  return {
    id,
    kind: 'text',
    pageStart: page,
    pageEnd: page,
    rects: [{ page, x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    quote,
    textHash: `hash-${id}`,
    contextBefore: '',
    contextAfter: '',
    pdfFingerprint: { sha256: 'pdf-sha', size: 2048, pageCount: 12, fileName: 'paper.pdf' },
    createdAt: T0,
    updatedAt: T0
  }
}

function panelSidecar(): PdfAnnotationSidecar {
  const base = {
    ...createEmptyPdfAnnotationSidecar(
      { sha256: 'pdf-sha', size: 2048, pageCount: 12, fileName: 'paper.pdf' },
      { sourcePdfName: 'paper.pdf', now: T0 }
    ),
    anchors: [
      anchor('anchor-a', 2, 'Commented claim'),
      anchor('anchor-b', 5, 'Questioned claim')
    ]
  }
  const commented = createPdfAnnotationThread(base, {
    id: 'thread-a',
    kind: 'comment',
    anchorIds: ['anchor-a'],
    annotations: [{
      id: 'ann-a',
      anchorId: 'anchor-a',
      body: 'A comment on the claim.'
    }],
    createdAt: T1
  })
  return resolvePdfAnnotationThread(createPdfAnnotationThread(commented, {
    id: 'thread-b',
    kind: 'question',
    anchorIds: ['anchor-b'],
    annotations: [{
      id: 'ann-b',
      anchorId: 'anchor-b',
      body: 'Why does this measurement change?'
    }],
    createdAt: T2
  }), 'thread-b', T2)
}

function emptyCommentSidecar(): PdfAnnotationSidecar {
  const base = {
    ...createEmptyPdfAnnotationSidecar(
      { sha256: 'pdf-sha', size: 2048, pageCount: 12, fileName: 'paper.pdf' },
      { sourcePdfName: 'paper.pdf', now: T0 }
    ),
    anchors: [
      anchor('anchor-empty-comment', 1, 'Claim that needs a comment')
    ]
  }
  return createPdfAnnotationThread(base, {
    id: 'thread-empty-comment',
    kind: 'comment',
    anchorIds: ['anchor-empty-comment'],
    annotations: [{
      id: 'ann-empty-comment',
      anchorId: 'anchor-empty-comment',
      body: ''
    }],
    createdAt: T1
  })
}

describe('WritePdfAnnotationsPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders filtered annotation threads with jump, edit, delete, reopen, import, and export controls', () => {
    const html = renderToStaticMarkup(createElement(WritePdfAnnotationsPanel, {
      sidecar: panelSidecar(),
      selectedThreadId: 'thread-b',
      initialKind: 'question',
      questionReplies: {
        'thread-b': {
          text: 'Yes, temperature can matter by changing local disorder.',
          turns: [
            {
              id: 'side-thread:user-1',
              role: 'user',
              text: 'Why does this measurement change?'
            },
            {
              id: 'side-thread:assistant-1',
              role: 'assistant',
              text: 'It changes because the anisotropic axis rotates relative to the measurement direction.'
            },
            {
              id: 'side-thread:user-2',
              role: 'user',
              text: 'Does temperature matter too?'
            },
            {
              id: 'side-thread:assistant-2',
              role: 'assistant',
              text: 'Yes, temperature can matter when \\(c_t < 1\\).'
            }
          ]
        }
      },
      onLocateThread: vi.fn(),
      onReopenThread: vi.fn(),
      onDeleteThread: vi.fn(),
      onEditAnnotation: vi.fn(),
      onAskQuestion: vi.fn(),
      onExportPackage: vi.fn(),
      onExportPdf: vi.fn(),
      onImportPackage: vi.fn(),
      onReloadSidecar: vi.fn(),
      pdfReviewAvailable: true,
      pdfReviewHasSelection: true,
      pdfReviewSelectionLabel: '24 chars',
      pdfReviewNotice: { tone: 'success', message: 'Generated 1 review comment.' },
      onGeneratePdfReview: vi.fn(),
      onImproveAnnotation: vi.fn()
    }))

    expect(html).toContain('PDF annotations')
    expect(html).toContain('Export package')
    expect(html).toContain('Export PDF')
    expect(html).toContain('Import package')
    expect(html).toContain('Reload annotations')
    expect(html).toContain('Generate SciForge PDF review')
    expect(html).toContain('Full PDF')
    expect(html).toContain('Generated 1 review comment.')
    expect(html).toContain('Improve with SciForge')
    expect(html).toContain('Text highlights')
    expect(html).toContain('Hidden')
    expect(html).toContain('Current')
    expect(html).toContain('All')
    expect(html).toContain('Why does this measurement change?')
    expect(html).toContain('Translate selection')
    expect(html).toContain('Follow up')
    expect(html).toContain('aria-label="Resize editor"')
    expect(html).toContain('Does temperature matter too?')
    expect(html).toContain('Agent answer')
    expect(html).toContain('anisotropic axis rotates')
    expect(html.match(/ds-markdown ds-chat-answer/g)).toHaveLength(2)
    expect(html.match(/aria-label="Copy message"/g)?.length).toBeGreaterThanOrEqual(4)
    expect(html.match(/ds-selectable-text/g)?.length).toBeGreaterThanOrEqual(4)
    expect(html).not.toContain('A comment on the claim.')
    expect(html).not.toContain('Translation</option>')
    expect(html.match(/aria-label="Locate in document"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Reopen thread"')
    expect(html).toContain('aria-label="Edit annotation"')
    expect(html).toContain('aria-label="Delete thread"')
  })

  it('opens the inline editor for a newly created empty comment', () => {
    const html = renderToStaticMarkup(createElement(WritePdfAnnotationsPanel, {
      sidecar: emptyCommentSidecar(),
      selectedThreadId: 'thread-empty-comment',
      onLocateThread: vi.fn(),
      onDeleteThread: vi.fn(),
      onEditAnnotation: vi.fn()
    }))

    expect(html).toContain('Write a comment...')
    expect(html).toContain('Save')
    expect(html).toContain('Cancel')
    expect(html).toContain('aria-label="Edit annotation"')
    expect(html).toContain('aria-label="Resize editor"')
  })

  it('renders document annotation copy without PDF-only package and page controls', () => {
    const html = renderToStaticMarkup(createElement(WritePdfAnnotationsPanel, {
      documentKind: 'docx',
      sidecar: panelSidecar(),
      selectedThreadId: 'thread-b',
      onLocateThread: vi.fn(),
      onEditAnnotation: vi.fn(),
      onAskQuestion: vi.fn(),
      onReloadSidecar: vi.fn()
    }))

    expect(html).toContain('Document annotations')
    expect(html).toContain('Ask about this document selection...')
    expect(html).toContain('aria-label="Document selection question"')
    expect(html).toContain('Reload annotations')
    expect(html).not.toContain('PDF annotations')
    expect(html).not.toContain('Export package')
    expect(html).not.toContain('Export PDF')
    expect(html).not.toContain('Import package')
    expect(html).not.toContain('placeholder="Page"')
  })
})

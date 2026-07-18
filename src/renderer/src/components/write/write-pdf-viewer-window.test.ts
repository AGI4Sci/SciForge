import { describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  TextLayer: class {},
  getDocument: vi.fn()
}))

import {
  buildPdfPresentationState,
  pdfPageRenderWindow,
  type WritePdfSelection
} from './WritePdfViewer'

describe('PDF page render window', () => {
  it('renders only the current page and its two nearest neighbours on each side', () => {
    expect(pdfPageRenderWindow(42, 83)).toEqual([40, 41, 42, 43, 44])
    expect(pdfPageRenderWindow(42, 83)).toHaveLength(5)
  })

  it('clamps the render window at the first and last page', () => {
    expect(pdfPageRenderWindow(1, 83)).toEqual([1, 2, 3])
    expect(pdfPageRenderWindow(83, 83)).toEqual([81, 82, 83])
  })

  it('normalizes invalid counts, page positions, and radii', () => {
    expect(pdfPageRenderWindow(1, 0)).toEqual([])
    expect(pdfPageRenderWindow(-10, 4)).toEqual([1, 2, 3])
    expect(pdfPageRenderWindow(99, 4)).toEqual([2, 3, 4])
    expect(pdfPageRenderWindow(2, 4, -5)).toEqual([2])
    expect(pdfPageRenderWindow(2, 4, 1)).toEqual([1, 2, 3])
  })

  it('publishes only the bounded text for the current PDF page', () => {
    const state = buildPdfPresentationState({
      title: 'Voyager: An Open-Ended Embodied Agent',
      currentPage: 7,
      pageCount: 42,
      currentPageText: 'x'.repeat(8_000),
      selection: null
    })

    expect(state).toMatchObject({
      kind: 'document',
      title: 'Voyager: An Open-Ended Embodied Agent',
      position: {
        index: 7,
        count: 42,
        label: 'Page 7 of 42'
      },
      visibleContent: {
        label: 'Page 7',
        truncated: true
      },
      selection: null
    })
    expect(state?.visibleContent?.text).toHaveLength(6_000)
  })

  it('publishes a bounded live selection through the same presentation state', () => {
    const selectedText = 's'.repeat(2_500)
    const selection: WritePdfSelection = {
      text: selectedText,
      ranges: [],
      charCount: selectedText.length,
      sourceKind: 'pdf',
      pageStart: 3,
      pageEnd: 3,
      metadata: {
        sourceKind: 'pdf',
        filePath: '/workspace/paper.pdf',
        sourceTitle: 'paper.pdf',
        mimeType: 'application/pdf',
        pageStart: 3,
        pageEnd: 3,
        pageCount: 10,
        rects: []
      }
    }

    const state = buildPdfPresentationState({
      title: 'Paper',
      currentPage: 3,
      pageCount: 10,
      currentPageText: 'Visible page text',
      selection
    })

    expect(state?.selection).toMatchObject({
      kind: 'text',
      summary: 'Page 3; 2500 selected characters'
    })
    expect(state?.selection?.text).toHaveLength(2_000)
  })
})

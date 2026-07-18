import { describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  TextLayer: class {},
  getDocument: vi.fn()
}))

import { pdfPageRenderWindow } from './WritePdfViewer'

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
})

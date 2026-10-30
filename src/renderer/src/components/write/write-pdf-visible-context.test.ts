import { describe, expect, it } from 'vitest'
import { normalizedBoundsForPageRects } from './write-pdf-visible-context'

describe('PDF visual context targets', () => {
  it('builds one bounded region for selection fragments on the active page', () => {
    const bounds = normalizedBoundsForPageRects([
      { page: 4, x: 0.2, y: 0.3, width: 0.1, height: 0.05 },
      { page: 4, x: 0.35, y: 0.32, width: 0.2, height: 0.06 },
      { page: 5, x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
    ], 4)
    expect(bounds?.x).toBeCloseTo(0.2)
    expect(bounds?.y).toBeCloseTo(0.3)
    expect(bounds?.width).toBeCloseTo(0.35)
    expect(bounds?.height).toBeCloseTo(0.08)
  })
})

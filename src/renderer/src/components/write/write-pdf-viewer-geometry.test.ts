import { describe, expect, it, vi } from 'vitest'
import {
  preferNativePdfDragSelection,
  rotatedPdfTextBounds,
  slicedRotatedPdfTextBounds
} from './write-pdf-viewer-geometry'

describe('PDF search text geometry', () => {
  it('normalizes horizontal PDF text bounds', () => {
    const rect = rotatedPdfTextBounds({
      left: 20,
      top: 30,
      angle: 0,
      textWidth: 30,
      textHeight: 10,
      viewportWidth: 100,
      viewportHeight: 100
    })

    expect(rect.x).toBeCloseTo(0.2)
    expect(rect.y).toBeCloseTo(0.3)
    expect(rect.width).toBeCloseTo(0.3)
    expect(rect.height).toBeCloseTo(0.1)
  })

  it('uses the axis-aligned bounding box for rotated page text', () => {
    const rect = rotatedPdfTextBounds({
      left: 70,
      top: 20,
      angle: Math.PI / 2,
      textWidth: 30,
      textHeight: 10,
      viewportWidth: 100,
      viewportHeight: 100
    })

    expect(rect.x).toBeCloseTo(0.6)
    expect(rect.y).toBeCloseTo(0.2)
    expect(rect.width).toBeCloseTo(0.1)
    expect(rect.height).toBeCloseTo(0.3)
  })

  it('slices rotated text along its rendered baseline', () => {
    const rect = slicedRotatedPdfTextBounds({
      left: 70,
      top: 20,
      angle: Math.PI / 2,
      textWidth: 30,
      textHeight: 10,
      viewportWidth: 100,
      viewportHeight: 100
    }, 1 / 3, 1 / 3)

    expect(rect.x).toBeCloseTo(0.6)
    expect(rect.y).toBeCloseTo(0.3)
    expect(rect.width).toBeCloseTo(0.1)
    expect(rect.height).toBeCloseTo(0.1)
  })
})

describe('PDF drag selection', () => {
  it('keeps a non-empty native selection without evaluating the fallback', () => {
    const nativeSelection = { text: 'precise native range' }
    const createFallback = vi.fn(() => ({ text: 'coordinate fallback' }))

    expect(preferNativePdfDragSelection(nativeSelection, createFallback)).toBe(nativeSelection)
    expect(createFallback).not.toHaveBeenCalled()
  })

  it('uses coordinate selection when the browser selection is empty', () => {
    const fallbackSelection = { text: 'coordinate fallback' }

    expect(preferNativePdfDragSelection({ text: '  ' }, () => fallbackSelection)).toBe(fallbackSelection)
  })
})

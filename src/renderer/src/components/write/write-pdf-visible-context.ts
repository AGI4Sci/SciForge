import type { VisibleContextBounds } from '@shared/visible-context'
import type { WritePdfSelectionPageRect } from './WritePdfViewer'

export function normalizedBoundsForPageRects(
  rects: WritePdfSelectionPageRect[],
  page: number
): VisibleContextBounds | null {
  const pageRects = rects.filter((rect) => rect.page === page && rect.width > 0 && rect.height > 0)
  if (pageRects.length === 0) return null
  const x = Math.min(...pageRects.map((rect) => rect.x))
  const y = Math.min(...pageRects.map((rect) => rect.y))
  const right = Math.max(...pageRects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...pageRects.map((rect) => rect.y + rect.height))
  return {
    x,
    y,
    width: right - x,
    height: bottom - y
  }
}

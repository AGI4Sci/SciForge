export type NormalizedPdfTextBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type RotatedPdfTextGeometry = {
  left: number
  top: number
  angle: number
  textWidth: number
  textHeight: number
  viewportWidth: number
  viewportHeight: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function rotatedPdfTextBounds(input: RotatedPdfTextGeometry): NormalizedPdfTextBounds {
  const widthX = Math.cos(input.angle) * input.textWidth
  const widthY = Math.sin(input.angle) * input.textWidth
  const heightX = -Math.sin(input.angle) * input.textHeight
  const heightY = Math.cos(input.angle) * input.textHeight
  const corners = [
    [input.left, input.top],
    [input.left + widthX, input.top + widthY],
    [input.left + heightX, input.top + heightY],
    [input.left + widthX + heightX, input.top + widthY + heightY]
  ]
  const left = clamp01(Math.min(...corners.map(([x]) => x)) / input.viewportWidth)
  const right = clamp01(Math.max(...corners.map(([x]) => x)) / input.viewportWidth)
  const top = clamp01(Math.min(...corners.map(([, y]) => y)) / input.viewportHeight)
  const bottom = clamp01(Math.max(...corners.map(([, y]) => y)) / input.viewportHeight)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function slicedRotatedPdfTextBounds(
  geometry: RotatedPdfTextGeometry,
  startRatio: number,
  widthRatio: number
): NormalizedPdfTextBounds {
  const normalizedStart = clamp01(startRatio)
  const normalizedWidth = Math.min(clamp01(widthRatio), 1 - normalizedStart)
  const startOffset = geometry.textWidth * normalizedStart
  return rotatedPdfTextBounds({
    ...geometry,
    left: geometry.left + Math.cos(geometry.angle) * startOffset,
    top: geometry.top + Math.sin(geometry.angle) * startOffset,
    textWidth: geometry.textWidth * normalizedWidth
  })
}

export function preferNativePdfDragSelection<T extends { text: string }>(
  nativeSelection: T,
  createFallbackSelection: () => T
): T {
  return nativeSelection.text.trim() ? nativeSelection : createFallbackSelection()
}

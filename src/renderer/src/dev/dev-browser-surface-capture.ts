import type { VisibleContextBounds } from '@shared/visible-context'

export type DevBrowserSurfaceCaptureRequest = Readonly<{
  requestId: string
  revision: number
  bounds?: VisibleContextBounds
}>

export type DevBrowserSurfaceCaptureResponse =
  | Readonly<{
      requestId: string
      revision: number
      ok: true
      viewportWidth: number
      viewportHeight: number
      pngBase64: string
    }>
  | Readonly<{
      requestId: string
      revision: number
      ok: false
      error: string
    }>

export async function captureDevBrowserSurface(
  request: DevBrowserSurfaceCaptureRequest,
  currentRevision: () => number | null
): Promise<DevBrowserSurfaceCaptureResponse> {
  try {
    assertCaptureRevision(request.revision, currentRevision(), 'before capture')
    const viewportWidth = positiveViewportDimension(window.innerWidth, 'width')
    const viewportHeight = positiveViewportDimension(window.innerHeight, 'height')
    const bounds = request.bounds
      ? clipCaptureBounds(request.bounds, viewportWidth, viewportHeight)
      : { x: 0, y: 0, width: viewportWidth, height: viewportHeight }
    await nextPaint()
    const { default: html2canvas } = await import('html2canvas-pro')
    const canvas = await html2canvas(document.documentElement, {
      allowTaint: false,
      backgroundColor: null,
      height: bounds.height,
      logging: false,
      removeContainer: true,
      scale: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      useCORS: true,
      width: bounds.width,
      windowHeight: viewportHeight,
      windowWidth: viewportWidth,
      x: window.scrollX + bounds.x,
      y: window.scrollY + bounds.y
    })
    const pngBase64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/u, '')
    if (!pngBase64) throw new Error('Browser rasterizer returned an empty PNG.')
    assertCaptureRevision(request.revision, currentRevision(), 'during capture')
    return {
      requestId: request.requestId,
      revision: request.revision,
      ok: true,
      viewportWidth,
      viewportHeight,
      pngBase64
    }
  } catch (error) {
    return {
      requestId: request.requestId,
      revision: request.revision,
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 1_000) : 'Browser pixel capture failed.'
    }
  }
}

function assertCaptureRevision(
  requestedRevision: number,
  currentRevision: number | null,
  phase: 'before capture' | 'during capture'
): void {
  if (currentRevision === requestedRevision) return
  const current = currentRevision === null ? 'unpublished' : String(currentRevision)
  throw new Error(
    `Browser visible-context revision changed ${phase}: requested ${requestedRevision}, current ${current}.`
  )
}

function positiveViewportDimension(value: number, field: string): number {
  const normalized = Math.floor(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new Error(`Browser viewport ${field} is unavailable.`)
  }
  return normalized
}

function clipCaptureBounds(
  bounds: VisibleContextBounds,
  viewportWidth: number,
  viewportHeight: number
): VisibleContextBounds {
  const x = Math.max(0, Math.floor(bounds.x))
  const y = Math.max(0, Math.floor(bounds.y))
  const right = Math.min(viewportWidth, Math.ceil(bounds.x + bounds.width))
  const bottom = Math.min(viewportHeight, Math.ceil(bounds.y + bounds.height))
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    right <= x ||
    bottom <= y
  ) {
    throw new Error('Visual target is outside the browser viewport.')
  }
  return { x, y, width: right - x, height: bottom - y }
}

async function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

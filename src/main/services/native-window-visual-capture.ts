import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { BrowserWindow, View, WebContents } from 'electron'
import type { VisibleContextBounds } from '../../shared/visible-context'
import type { CapturedVisualPage } from './visible-context-service'

type Rect = VisibleContextBounds

type CaptureLayer = { contents: WebContents; bounds: Rect; clip: Rect }

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

export function collectNativeCaptureLayers(root: View, viewport: Rect): ReadonlyArray<{ contents: WebContents; bounds: Rect; clip: Rect }> {
  const layers: CaptureLayer[] = []
  function visit(view: View, parentX: number, parentY: number, parentClip: Rect): void {
    if (!view.getVisible()) return
    const local = view.getBounds()
    const bounds = { ...local, x: parentX + local.x, y: parentY + local.y }
    const clip = intersect(bounds, parentClip)
    if (!clip) return
    // Electron's public View hierarchy orders children from back to front.
    if ('webContents' in view) {
      const contents = view.webContents as WebContents
      if (!contents.isDestroyed()) layers.push({ contents, bounds, clip })
    }
    for (const child of view.children) visit(child, bounds.x, bounds.y, clip)
  }
  for (const child of root.children) visit(child, 0, 0, viewport)
  return layers
}

/** Capture a renderer surface together with native WebContentsView descendants.
 * View geometry is in DIP; registered visual target geometry is in renderer CSS
 * pixels. Decode PNG sizes instead of NativeImage.getSize(), which is logical on
 * Retina displays. Every layer is scaled into the host image's pixel grid.
 */
export async function captureBrowserWindowPage(
  window: BrowserWindow,
  bounds?: VisibleContextBounds,
  captureContents: WebContents = window.webContents
): Promise<CapturedVisualPage> {
  const [width, height] = window.getContentSize()
  const viewport = { x: 0, y: 0, width, height }
  const layers = collectNativeCaptureLayers(window.contentView, viewport)
  const surface = captureContents === window.webContents
    ? viewport
    : layers.find(layer => layer.contents === captureContents)?.bounds
  if (!surface) throw new Error('Visual surface is no longer attached to the SciForge window.')
  const zoom = captureContents.getZoomFactor()
  const base = await loadImage((await captureContents.capturePage()).toPNG())
  if (!base.width || !base.height) throw new Error('Visual surface returned an empty screenshot.')
  const canvas = createCanvas(base.width, base.height)
  const context = canvas.getContext('2d')
  context.drawImage(base, 0, 0)
  const scaleX = base.width / surface.width
  const scaleY = base.height / surface.height
  if (captureContents === window.webContents) {
    // capturePage captures only this renderer. Native sibling views must be
    // captured separately, then composited in their actual stacking order.
    for (const layer of layers) {
      if (layer.contents === captureContents) continue
      const image = await loadImage((await layer.contents.capturePage()).toPNG())
      context.save()
      context.beginPath()
      context.rect(layer.clip.x * scaleX, layer.clip.y * scaleY, layer.clip.width * scaleX, layer.clip.height * scaleY)
      context.clip()
      context.drawImage(image, layer.bounds.x * scaleX, layer.bounds.y * scaleY, layer.bounds.width * scaleX, layer.bounds.height * scaleY)
      context.restore()
    }
  }
  const cssViewport = { x: 0, y: 0, width: surface.width / zoom, height: surface.height / zoom }
  const clippedBounds = bounds ? intersect(bounds, cssViewport) : undefined
  if (bounds && !clippedBounds) throw new Error('Visual target is outside the SciForge window viewport.')
  if (clippedBounds) {
    const x = Math.floor(clippedBounds.x * zoom * scaleX)
    const y = Math.floor(clippedBounds.y * zoom * scaleY)
    const right = Math.min(base.width, Math.ceil((clippedBounds.x + clippedBounds.width) * zoom * scaleX))
    const bottom = Math.min(base.height, Math.ceil((clippedBounds.y + clippedBounds.height) * zoom * scaleY))
    const cropped = createCanvas(right - x, bottom - y)
    cropped.getContext('2d').drawImage(canvas, -x, -y)
    return {
      png: cropped.toBuffer('image/png'), width: cropped.width, height: cropped.height,
      scaleFactor: zoom * scaleX,
      bounds: { x: x / (zoom * scaleX), y: y / (zoom * scaleY), width: cropped.width / (zoom * scaleX), height: cropped.height / (zoom * scaleY) }
    }
  }
  return { png: canvas.toBuffer('image/png'), width: canvas.width, height: canvas.height, scaleFactor: zoom * scaleX }
}

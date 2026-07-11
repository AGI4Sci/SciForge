import { createCanvas, loadImage } from '@napi-rs/canvas'
import { release } from 'node:os'
import {
  anchoredCommentCaptureRequestSchema,
  type AnchoredCommentCaptureBundle,
  type AnchoredCommentCaptureRequest,
  type AnchoredCommentCaptureResult,
  type CommentRect,
  type CommentScreenshotAssetRef,
  type CommentViewport
} from '../../shared/anchored-comments'

const CALLOUT_COLOR = '#f59e0b'
const CALLOUT_TEXT_COLOR = '#111827'
const REDACTION_COLOR = '#111827'
const CROP_PADDING_CSS_PX = 32
const MIN_STROKE_PX = 3

export type CapturedWindowImage = {
  png: Uint8Array
  viewport: CommentViewport
}

export type ScreenshotAssetWriter = {
  putScreenshotAsset: (
    bytes: Uint8Array,
    dimensions: { width: number; height: number }
  ) => Promise<CommentScreenshotAssetRef>
}

export type AnchoredCommentScreenshotServiceOptions = {
  captureWindow: () => Promise<CapturedWindowImage>
  assetWriter: ScreenshotAssetWriter
  getAppVersion: () => string
  getAppBuild?: () => string | undefined
  now?: () => Date
  platform?: string
  osVersion?: string
}

export type ProcessedCommentScreenshots = {
  fullWindowPng: Uint8Array
  focusedPng: Uint8Array
  fullWindowSize: { width: number; height: number }
  focusedSize: { width: number; height: number }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function scaleRect(
  rect: CommentRect,
  scaleX: number,
  scaleY: number,
  imageWidth: number,
  imageHeight: number
): CommentRect {
  const x = clamp(rect.x * scaleX, 0, Math.max(0, imageWidth - 1))
  const y = clamp(rect.y * scaleY, 0, Math.max(0, imageHeight - 1))
  const right = clamp((rect.x + rect.width) * scaleX, x + 1, imageWidth)
  const bottom = clamp((rect.y + rect.height) * scaleY, y + 1, imageHeight)
  return { x, y, width: right - x, height: bottom - y }
}

function drawRedactions(
  context: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  rects: CommentRect[]
): void {
  context.fillStyle = REDACTION_COLOR
  for (const rect of rects) {
    context.fillRect(
      Math.floor(rect.x),
      Math.floor(rect.y),
      Math.ceil(rect.width),
      Math.ceil(rect.height)
    )
  }
}

function drawCallout(
  context: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  rect: CommentRect,
  scale: number
): void {
  const stroke = Math.max(MIN_STROKE_PX, Math.round(3 * scale))
  const badgeRadius = Math.max(11, Math.round(12 * scale))
  const badgeX = clamp(rect.x + stroke / 2, badgeRadius + 1, context.canvas.width - badgeRadius - 1)
  const badgeY = clamp(rect.y + stroke / 2, badgeRadius + 1, context.canvas.height - badgeRadius - 1)

  context.save()
  context.strokeStyle = CALLOUT_COLOR
  context.lineWidth = stroke
  context.strokeRect(
    Math.floor(rect.x),
    Math.floor(rect.y),
    Math.max(1, Math.ceil(rect.width)),
    Math.max(1, Math.ceil(rect.height))
  )
  context.fillStyle = CALLOUT_COLOR
  context.beginPath()
  context.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = CALLOUT_TEXT_COLOR
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `bold ${Math.max(12, Math.round(13 * scale))}px sans-serif`
  context.fillText('1', badgeX, badgeY + 0.5)
  context.restore()
}

/**
 * Produces deterministic, metadata-free PNG evidence. Redactions are applied
 * before either output is rendered, so sensitive pixels never survive in the
 * focused derivative.
 */
export async function processCommentScreenshot(
  sourcePng: Uint8Array,
  viewport: CommentViewport,
  targetBounds: CommentRect,
  redactionBounds: CommentRect[]
): Promise<ProcessedCommentScreenshots> {
  const source = await loadImage(Buffer.from(sourcePng))
  const imageWidth = source.width
  const imageHeight = source.height
  if (imageWidth < 1 || imageHeight < 1) {
    throw new Error('Captured window image is empty.')
  }

  const scaleX = imageWidth / viewport.width
  const scaleY = imageHeight / viewport.height
  const calloutScale = Math.max(1, (scaleX + scaleY) / 2)
  const target = scaleRect(targetBounds, scaleX, scaleY, imageWidth, imageHeight)
  const redactions = redactionBounds.map((rect) => (
    scaleRect(rect, scaleX, scaleY, imageWidth, imageHeight)
  ))

  const sanitized = createCanvas(imageWidth, imageHeight)
  const sanitizedContext = sanitized.getContext('2d')
  sanitizedContext.drawImage(source, 0, 0, imageWidth, imageHeight)
  drawRedactions(sanitizedContext, redactions)

  const fullWindow = createCanvas(imageWidth, imageHeight)
  const fullContext = fullWindow.getContext('2d')
  fullContext.drawImage(sanitized, 0, 0)
  drawCallout(fullContext, target, calloutScale)

  const paddingX = CROP_PADDING_CSS_PX * scaleX
  const paddingY = CROP_PADDING_CSS_PX * scaleY
  const cropX = Math.floor(clamp(target.x - paddingX, 0, imageWidth - 1))
  const cropY = Math.floor(clamp(target.y - paddingY, 0, imageHeight - 1))
  const cropRight = Math.ceil(clamp(target.x + target.width + paddingX, cropX + 1, imageWidth))
  const cropBottom = Math.ceil(clamp(target.y + target.height + paddingY, cropY + 1, imageHeight))
  const cropWidth = cropRight - cropX
  const cropHeight = cropBottom - cropY
  const focused = createCanvas(cropWidth, cropHeight)
  const focusedContext = focused.getContext('2d')
  focusedContext.drawImage(
    sanitized,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight
  )
  drawCallout(focusedContext, {
    x: target.x - cropX,
    y: target.y - cropY,
    width: target.width,
    height: target.height
  }, calloutScale)

  return {
    fullWindowPng: fullWindow.encodeSync('png'),
    focusedPng: focused.encodeSync('png'),
    fullWindowSize: { width: imageWidth, height: imageHeight },
    focusedSize: { width: cropWidth, height: cropHeight }
  }
}

export class AnchoredCommentScreenshotService {
  private readonly options: AnchoredCommentScreenshotServiceOptions

  constructor(options: AnchoredCommentScreenshotServiceOptions) {
    this.options = options
  }

  async capture(input: unknown): Promise<AnchoredCommentCaptureResult> {
    let request: AnchoredCommentCaptureRequest
    try {
      request = anchoredCommentCaptureRequestSchema.parse(input)
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Invalid screenshot capture request.'
      }
    }

    try {
      const captured = await this.options.captureWindow()
      const processed = await processCommentScreenshot(
        captured.png,
        request.viewport,
        request.targetBounds,
        request.redactionBounds
      )
      const [fullWindowScreenshot, focusedScreenshot] = await Promise.all([
        this.options.assetWriter.putScreenshotAsset(
          processed.fullWindowPng,
          processed.fullWindowSize
        ),
        this.options.assetWriter.putScreenshotAsset(
          processed.focusedPng,
          processed.focusedSize
        )
      ])
      const appBuild = this.options.getAppBuild?.()
      const capture: AnchoredCommentCaptureBundle = {
        capturedAt: (this.options.now ?? (() => new Date()))().toISOString(),
        appVersion: this.options.getAppVersion(),
        ...(appBuild ? { appBuild } : {}),
        platform: this.options.platform ?? process.platform,
        osVersion: this.options.osVersion ?? release(),
        ...(request.route ? { route: request.route } : {}),
        viewport: request.viewport,
        ...(request.theme ? { theme: request.theme } : {}),
        ...(request.locale ? { locale: request.locale } : {}),
        targetLabel: request.targetLabel,
        targetBounds: request.targetBounds,
        fullWindowScreenshot,
        focusedScreenshot
      }
      return { ok: true, capture }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to capture visual evidence.'
      }
    }
  }
}

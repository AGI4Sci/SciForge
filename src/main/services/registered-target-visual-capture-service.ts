import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createHash } from 'node:crypto'
import {
  VISUAL_CAPTURE_MAX_PNG_BYTES,
  domainMainVisualCaptureRequestSchema,
  domainMainVisualCaptureResultSchema,
  type DomainMainVisualCaptureHost,
  type DomainMainVisualCaptureRequest,
  type DomainMainVisualCaptureResult
} from '@sciforge/domain-sdk/visual-capture'
import { z } from 'zod'

const captureBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive()
}).strict()

const registeredVisualTargetSchema = z.object({
  surface: z.object({
    windowId: z.string().trim().min(1).max(256),
    revision: z.number().int().nonnegative(),
    activeThreadId: z.string().trim().max(256).nullable()
  }).strict(),
  bounds: captureBoundsSchema.optional(),
  sensitive: z.boolean(),
  redactionBounds: z.array(captureBoundsSchema).max(64).default([])
}).strict()

const capturedWindowSchema = z.object({
  png: z.instanceof(Uint8Array),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scaleFactor: z.number().finite().positive().max(16)
}).strict()

const CALLOUT_COLOR = '#f59e0b'
const CALLOUT_TEXT_COLOR = '#111827'
const REDACTION_COLOR = '#111827'
const CROP_PADDING_CSS_PX = 32
const MIN_STROKE_PX = 3

export type VisualCaptureBounds = z.infer<typeof captureBoundsSchema>

/**
 * A Host-owned resolution of a registered target. This is intentionally not
 * part of the package SDK: packages receive neither geometry nor surface
 * identity and can provide only the registered targetRef.
 */
export type RegisteredVisualTarget = Readonly<{
  surface: Readonly<{
    windowId: string
    revision: number
    activeThreadId: string | null
  }>
  bounds?: VisualCaptureBounds
  sensitive: boolean
  redactionBounds: readonly VisualCaptureBounds[]
}>

export type CapturedRegisteredTargetWindow = Readonly<{
  png: Uint8Array<ArrayBufferLike>
  width: number
  height: number
  scaleFactor: number
}>

export type RegisteredTargetVisualCaptureServiceOptions = Readonly<{
  resolveRegisteredTarget: (
    targetRef: string
  ) => Promise<RegisteredVisualTarget | null>
  captureWindow: (
    surface: RegisteredVisualTarget['surface']
  ) => Promise<CapturedRegisteredTargetWindow>
}>

export type ProcessedRegisteredTargetCapture = Readonly<{
  png: Uint8Array
  width: number
  height: number
  redacted: boolean
}>

type CanvasContext = ReturnType<ReturnType<typeof createCanvas>['getContext']>

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function scaleRect(
  rect: VisualCaptureBounds,
  scaleX: number,
  scaleY: number,
  imageWidth: number,
  imageHeight: number
): VisualCaptureBounds | null {
  const x = clamp(rect.x * scaleX, 0, imageWidth)
  const y = clamp(rect.y * scaleY, 0, imageHeight)
  const right = clamp((rect.x + rect.width) * scaleX, 0, imageWidth)
  const bottom = clamp((rect.y + rect.height) * scaleY, 0, imageHeight)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

function intersection(
  left: VisualCaptureBounds,
  right: VisualCaptureBounds
): VisualCaptureBounds | null {
  const x = Math.max(left.x, right.x)
  const y = Math.max(left.y, right.y)
  const intersectionRight = Math.min(left.x + left.width, right.x + right.width)
  const intersectionBottom = Math.min(left.y + left.height, right.y + right.height)
  if (intersectionRight <= x || intersectionBottom <= y) return null
  return {
    x,
    y,
    width: intersectionRight - x,
    height: intersectionBottom - y
  }
}

function drawRedactions(context: CanvasContext, rects: readonly VisualCaptureBounds[]): void {
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
  context: CanvasContext,
  rect: VisualCaptureBounds,
  scale: number
): void {
  const stroke = Math.max(MIN_STROKE_PX, Math.round(3 * scale))
  const badgeRadius = Math.max(11, Math.round(12 * scale))
  const badgeX = clamp(
    rect.x + stroke / 2,
    badgeRadius + 1,
    context.canvas.width - badgeRadius - 1
  )
  const badgeY = clamp(
    rect.y + stroke / 2,
    badgeRadius + 1,
    context.canvas.height - badgeRadius - 1
  )

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
 * Produces a focused, metadata-free PNG from Host-owned target geometry.
 * Redactions are painted before the crop and callout, so the returned
 * derivative cannot recover sensitive source pixels.
 */
export async function processRegisteredTargetCapture(
  source: CapturedRegisteredTargetWindow,
  targetBounds: VisualCaptureBounds | undefined,
  redactionBounds: readonly VisualCaptureBounds[],
  annotation: 'none' | 'callout'
): Promise<ProcessedRegisteredTargetCapture> {
  const captured = capturedWindowSchema.parse(source)
  const image = await loadImage(Buffer.from(captured.png))
  if (
    image.width !== captured.width ||
    image.height !== captured.height
  ) {
    throw new Error('Captured window dimensions do not match its PNG bytes.')
  }

  const viewportWidth = captured.width / captured.scaleFactor
  const viewportHeight = captured.height / captured.scaleFactor
  const scaleX = image.width / viewportWidth
  const scaleY = image.height / viewportHeight
  const calloutScale = Math.max(1, (scaleX + scaleY) / 2)
  const target = scaleRect(
    targetBounds ?? {
      x: 0,
      y: 0,
      width: viewportWidth,
      height: viewportHeight
    },
    scaleX,
    scaleY,
    image.width,
    image.height
  )
  if (!target) throw new Error('The registered visual target is outside the captured viewport.')
  const redactions = redactionBounds.flatMap((bounds) => {
    const scaled = scaleRect(bounds, scaleX, scaleY, image.width, image.height)
    return scaled ? [scaled] : []
  })

  const paddingX = CROP_PADDING_CSS_PX * scaleX
  const paddingY = CROP_PADDING_CSS_PX * scaleY
  const cropX = Math.floor(clamp(target.x - paddingX, 0, image.width - 1))
  const cropY = Math.floor(clamp(target.y - paddingY, 0, image.height - 1))
  const cropRight = Math.ceil(clamp(
    target.x + target.width + paddingX,
    cropX + 1,
    image.width
  ))
  const cropBottom = Math.ceil(clamp(
    target.y + target.height + paddingY,
    cropY + 1,
    image.height
  ))
  const cropBounds = {
    x: cropX,
    y: cropY,
    width: cropRight - cropX,
    height: cropBottom - cropY
  }

  const sanitized = createCanvas(image.width, image.height)
  const sanitizedContext = sanitized.getContext('2d')
  sanitizedContext.drawImage(image, 0, 0, image.width, image.height)
  drawRedactions(sanitizedContext, redactions)

  const focused = createCanvas(cropBounds.width, cropBounds.height)
  const focusedContext = focused.getContext('2d')
  focusedContext.drawImage(
    sanitized,
    cropBounds.x,
    cropBounds.y,
    cropBounds.width,
    cropBounds.height,
    0,
    0,
    cropBounds.width,
    cropBounds.height
  )
  if (annotation === 'callout') {
    drawCallout(focusedContext, {
      x: target.x - cropBounds.x,
      y: target.y - cropBounds.y,
      width: target.width,
      height: target.height
    }, calloutScale)
  }

  return {
    png: focused.encodeSync('png'),
    width: cropBounds.width,
    height: cropBounds.height,
    redacted: redactions.some((bounds) => intersection(cropBounds, bounds) !== null)
  }
}

/**
 * The sole DomainMainHost.visualCapture implementation. Package input is
 * parsed with the strict SDK schema before any registry or pixel access.
 */
export class RegisteredTargetVisualCaptureService implements DomainMainVisualCaptureHost {
  constructor(
    private readonly options: RegisteredTargetVisualCaptureServiceOptions
  ) {}

  async captureRegisteredTarget(
    input: DomainMainVisualCaptureRequest
  ): Promise<DomainMainVisualCaptureResult> {
    const parsed = domainMainVisualCaptureRequestSchema.safeParse(input)
    if (!parsed.success) {
      return failure('capture-failed', 'Invalid registered-target capture request.')
    }

    try {
      const resolvedValue = await this.options.resolveRegisteredTarget(parsed.data.targetRef)
      if (!resolvedValue) {
        return failure(
          'target-not-found',
          'The registered visual target is no longer available.'
        )
      }
      const resolved = registeredVisualTargetSchema.parse(resolvedValue)
      if (resolved.sensitive) {
        return failure(
          'target-redacted',
          'Sensitive visual targets cannot be captured.'
        )
      }

      const captured = capturedWindowSchema.parse(
        await this.options.captureWindow(resolved.surface)
      )
      const processed = await processRegisteredTargetCapture(
        captured,
        resolved.bounds,
        resolved.redactionBounds,
        parsed.data.annotation
      )
      if (processed.png.byteLength > VISUAL_CAPTURE_MAX_PNG_BYTES) {
        return failure(
          'capture-too-large',
          `Captured PNG exceeds the ${VISUAL_CAPTURE_MAX_PNG_BYTES}-byte limit.`
        )
      }

      return domainMainVisualCaptureResultSchema.parse({
        ok: true,
        png: processed.png,
        width: processed.width,
        height: processed.height,
        sha256: createHash('sha256').update(processed.png).digest('hex'),
        redacted: processed.redacted
      })
    } catch (error) {
      return failure(
        'capture-failed',
        error instanceof Error ? error.message : 'Failed to capture the registered target.'
      )
    }
  }
}

function failure(
  code: 'target-not-found' | 'target-redacted' | 'capture-failed' | 'capture-too-large',
  message: string
): DomainMainVisualCaptureResult {
  const normalizedMessage = message.trim().slice(0, 1_000) || 'Visual capture failed.'
  return domainMainVisualCaptureResultSchema.parse({
    ok: false,
    error: { code, message: normalizedMessage }
  })
}

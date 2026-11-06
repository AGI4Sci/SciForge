import { createHash } from 'node:crypto'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it, vi } from 'vitest'
import {
  RegisteredTargetVisualCaptureService,
  processRegisteredTargetCapture,
  type RegisteredTargetVisualCaptureServiceOptions
} from './registered-target-visual-capture-service'

function fixturePng(): Uint8Array<ArrayBuffer> {
  const canvas = createCanvas(200, 120)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#2563eb'
  context.fillRect(20, 20, 40, 30)
  context.fillStyle = '#ef4444'
  context.fillRect(80, 40, 20, 20)
  const encoded = canvas.encodeSync('png')
  const bytes = new Uint8Array(encoded.byteLength)
  bytes.set(encoded)
  return bytes
}

async function pixel(png: Uint8Array, x: number, y: number): Promise<number[]> {
  const image = await loadImage(Buffer.from(png))
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  return [...context.getImageData(x, y, 1, 1).data]
}

function serviceOptions(
  overrides: Partial<RegisteredTargetVisualCaptureServiceOptions> = {}
): RegisteredTargetVisualCaptureServiceOptions {
  return {
    resolveRegisteredTarget: vi.fn(async () => ({
      surface: {
        windowId: 'electron:1',
        revision: 7,
        activeThreadId: 'thread-1'
      },
      bounds: { x: 10, y: 10, width: 20, height: 15 },
      sensitive: false,
      redactionBounds: [{ x: 40, y: 20, width: 10, height: 10 }]
    })),
    captureWindow: vi.fn(async () => ({
      png: fixturePng(),
      width: 200,
      height: 120,
      scaleFactor: 2
    })),
    ...overrides
  }
}

describe('processRegisteredTargetCapture', () => {
  it.each([
    { name: 'horizontal fractional boundary', scale: 1, rect: { x: 10.5, y: 4, width: 1, height: 2 } },
    { name: 'vertical fractional boundary', scale: 1, rect: { x: 4, y: 10.5, width: 2, height: 1 } },
    { name: 'fractional scale', scale: 1.5, rect: { x: 7, y: 5, width: 1, height: 1 } },
    { name: 'double scale fractional coordinates', scale: 2, rect: { x: 5.25, y: 4.25, width: 0.5, height: 0.5 } },
    { name: 'negative clipped boundary', scale: 1, rect: { x: -0.5, y: -0.5, width: 2, height: 2 } },
    { name: 'right and bottom clipped boundary', scale: 1, rect: { x: 18.5, y: 18.5, width: 3, height: 3 } },
    { name: 'fully outside boundary', scale: 1, rect: { x: 21.5, y: 21.5, width: 1, height: 1 } },
    { name: 'integer regression', scale: 1, rect: { x: 10, y: 4, width: 2, height: 2 } }
  ])('covers every intersecting pixel: $name', async ({ scale, rect }) => {
    const source = createCanvas(20, 20)
    const sourceContext = source.getContext('2d')
    sourceContext.fillStyle = '#ffffff'
    sourceContext.fillRect(0, 0, 20, 20)
    const result = await processRegisteredTargetCapture(
      { png: source.encodeSync('png'), width: 20, height: 20, scaleFactor: scale },
      undefined, [rect], 'none'
    )
    const image = await loadImage(Buffer.from(result.png))
    const output = createCanvas(20, 20)
    const outputContext = output.getContext('2d')
    outputContext.drawImage(image, 0, 0)
    const data = outputContext.getImageData(0, 0, 20, 20).data
    let maskedPixels = 0
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        // A pixel must be fully opaque whenever its area intersects the
        // scaled sensitive rectangle, including a fractional trailing edge.
        const masked = x < (rect.x + rect.width) * scale && x + 1 > rect.x * scale &&
          y < (rect.y + rect.height) * scale && y + 1 > rect.y * scale
        const offset = (y * 20 + x) * 4
        expect([...data.slice(offset, offset + 4)], `pixel ${x},${y}`).toEqual(
          masked ? [17, 24, 39, 255] : [255, 255, 255, 255]
        )
        if (masked) maskedPixels++
      }
    }
    expect(result.redacted).toBe(maskedPixels > 0)
  })

  it('redacts sensitive pixels before cropping and then draws a Host callout', async () => {
    const result = await processRegisteredTargetCapture(
      {
        png: fixturePng(),
        width: 200,
        height: 120,
        scaleFactor: 2
      },
      { x: 10, y: 10, width: 20, height: 15 },
      [{ x: 40, y: 20, width: 10, height: 10 }],
      'callout'
    )

    expect(result).toMatchObject({
      width: 124,
      height: 114,
      redacted: true
    })
    expect(await pixel(result.png, 85, 45)).toEqual([17, 24, 39, 255])
    expect(await pixel(result.png, 10, 25)).toEqual([245, 158, 11, 255])
  })

  it('does not render a callout when the SDK request selects none', async () => {
    const result = await processRegisteredTargetCapture(
      {
        png: fixturePng(),
        width: 200,
        height: 120,
        scaleFactor: 2
      },
      { x: 10, y: 10, width: 20, height: 15 },
      [],
      'none'
    )

    expect(result.redacted).toBe(false)
    expect(await pixel(result.png, 20, 22)).toEqual([37, 99, 235, 255])
  })
})

describe('RegisteredTargetVisualCaptureService', () => {
  it('accepts only targetRef input and returns digest-checked Host pixels', async () => {
    const options = serviceOptions()
    const service = new RegisteredTargetVisualCaptureService(options)

    const result = await service.captureRegisteredTarget({
      targetRef: 'target_registered-1',
      annotation: 'callout',
      label: 'Export button'
    })

    expect(options.resolveRegisteredTarget).toHaveBeenCalledWith('target_registered-1')
    expect(options.captureWindow).toHaveBeenCalledWith({
      windowId: 'electron:1',
      revision: 7,
      activeThreadId: 'thread-1'
    })
    expect(result).toMatchObject({
      ok: true,
      width: 124,
      height: 114,
      redacted: true
    })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.sha256).toBe(
      createHash('sha256').update(result.png).digest('hex')
    )
  })

  it('rejects selector and bounds injection before registry or pixel access', async () => {
    const resolveRegisteredTarget = vi.fn()
    const captureWindow = vi.fn()
    const service = new RegisteredTargetVisualCaptureService(
      serviceOptions({ resolveRegisteredTarget, captureWindow })
    )

    const selectorResult = await service.captureRegisteredTarget({
      targetRef: 'target_registered-1',
      selector: '#password'
    } as never)
    const boundsResult = await service.captureRegisteredTarget({
      targetRef: 'target_registered-1',
      targetBounds: { x: 0, y: 0, width: 1, height: 1 }
    } as never)

    expect(selectorResult).toMatchObject({
      ok: false,
      error: { code: 'capture-failed' }
    })
    expect(boundsResult).toMatchObject({
      ok: false,
      error: { code: 'capture-failed' }
    })
    expect(resolveRegisteredTarget).not.toHaveBeenCalled()
    expect(captureWindow).not.toHaveBeenCalled()
  })

  it('fails closed for missing and sensitive registered targets', async () => {
    const captureWindow = vi.fn()
    const missing = new RegisteredTargetVisualCaptureService(
      serviceOptions({
        resolveRegisteredTarget: vi.fn(async () => null),
        captureWindow
      })
    )
    const sensitive = new RegisteredTargetVisualCaptureService(
      serviceOptions({
        resolveRegisteredTarget: vi.fn(async () => ({
          surface: {
            windowId: 'electron:1',
            revision: 7,
            activeThreadId: 'thread-1'
          },
          bounds: { x: 10, y: 10, width: 20, height: 15 },
          sensitive: true,
          redactionBounds: []
        })),
        captureWindow
      })
    )

    await expect(missing.captureRegisteredTarget({
      targetRef: 'target_missing'
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'target-not-found' }
    })
    await expect(sensitive.captureRegisteredTarget({
      targetRef: 'target_sensitive'
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'target-redacted' }
    })
    expect(captureWindow).not.toHaveBeenCalled()
  })
})

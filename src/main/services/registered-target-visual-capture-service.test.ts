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

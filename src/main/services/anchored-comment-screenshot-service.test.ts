import { createHash } from 'node:crypto'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it, vi } from 'vitest'
import {
  AnchoredCommentScreenshotService,
  processCommentScreenshot
} from './anchored-comment-screenshot-service'

function fixturePng(): Buffer {
  const canvas = createCanvas(200, 120)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#2563eb'
  context.fillRect(20, 20, 40, 30)
  context.fillStyle = '#ef4444'
  context.fillRect(140, 80, 20, 20)
  return canvas.encodeSync('png')
}

async function pixel(png: Uint8Array, x: number, y: number): Promise<number[]> {
  const image = await loadImage(Buffer.from(png))
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  return [...context.getImageData(x, y, 1, 1).data]
}

describe('processCommentScreenshot', () => {
  it('redacts sensitive pixels before producing full and focused evidence', async () => {
    const result = await processCommentScreenshot(
      fixturePng(),
      { width: 100, height: 60, scaleFactor: 2 },
      { x: 10, y: 10, width: 20, height: 15 },
      [{ x: 70, y: 40, width: 10, height: 10 }]
    )

    expect(result.fullWindowSize).toEqual({ width: 200, height: 120 })
    expect(result.focusedSize.width).toBeLessThan(200)
    expect(result.focusedSize.height).toBeLessThan(120)
    expect(await pixel(result.fullWindowPng, 150, 90)).toEqual([17, 24, 39, 255])
    // The callout border is the stable amber annotation color.
    expect(await pixel(result.fullWindowPng, 20, 22)).toEqual([245, 158, 11, 255])
  })
})

describe('AnchoredCommentScreenshotService', () => {
  it('stores both immutable PNG variants and returns a complete capture bundle', async () => {
    const putScreenshotAsset = vi.fn(async (bytes: Uint8Array, dimensions: { width: number; height: number }) => ({
      digest: createHash('sha256').update(bytes).digest('hex'),
      mimeType: 'image/png' as const,
      byteLength: bytes.byteLength,
      ...dimensions
    }))
    const service = new AnchoredCommentScreenshotService({
      captureWindow: async () => ({
        png: fixturePng(),
        viewport: { width: 100, height: 60, scaleFactor: 2 }
      }),
      assetWriter: { putScreenshotAsset },
      getAppVersion: () => '1.2.3',
      now: () => new Date('2026-07-11T03:00:00.000Z'),
      platform: 'test',
      osVersion: 'test-os'
    })

    const result = await service.capture({
      targetBounds: { x: 10, y: 10, width: 20, height: 15 },
      redactionBounds: [],
      targetLabel: 'Export button',
      route: '/workspace',
      viewport: { width: 100, height: 60, scaleFactor: 2 },
      theme: 'dark',
      locale: 'zh-CN'
    })

    expect(result).toMatchObject({
      ok: true,
      capture: {
        appVersion: '1.2.3',
        targetLabel: 'Export button',
        theme: 'dark',
        locale: 'zh-CN',
        fullWindowScreenshot: { mimeType: 'image/png' },
        focusedScreenshot: { mimeType: 'image/png' }
      }
    })
    expect(putScreenshotAsset).toHaveBeenCalledTimes(2)
  })

  it('keeps malformed renderer payloads away from capturePage', async () => {
    const captureWindow = vi.fn()
    const service = new AnchoredCommentScreenshotService({
      captureWindow,
      assetWriter: { putScreenshotAsset: vi.fn() },
      getAppVersion: () => '1.0.0'
    })

    await expect(service.capture({ targetBounds: { x: -1 } })).resolves.toMatchObject({ ok: false })
    expect(captureWindow).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { AnchoredCommentService } from './comment-service'
import {
  ANCHORED_COMMENT_CAPABILITY_IDS,
  anchoredCommentCaptureResultSchema
} from '../contract'
import { createAnchoredCommentsCapabilityFactory } from './index'

describe('Anchored Comments capability factory', () => {
  it('publishes one broker path for every package operation', () => {
    const factory = createAnchoredCommentsCapabilityFactory({
      defineCapability: (definition) => definition,
      getComments: vi.fn(),
      getFeedback: vi.fn()
    })
    expect(factory.createDefinitions().map((definition) => definition.id))
      .toEqual(Object.values(ANCHORED_COMMENT_CAPABILITY_IDS))
    expect(factory.policy).toMatchObject({
      directTransportPrefixes: ['anchoredComments:'],
      allowedDirectTransports: []
    })
  })

  it('fails closed when the Host safe-capture contract is unavailable', async () => {
    const factory = createAnchoredCommentsCapabilityFactory({
      defineCapability: (definition) => definition,
      getComments: vi.fn(),
      getFeedback: vi.fn()
    })
    const capture = factory.createDefinitions().find(
      (definition) => definition.id === ANCHORED_COMMENT_CAPABILITY_IDS.capture
    )!
    const result = await capture.handler({
      targetRef: 'preview.figure:figure-2',
      targetBounds: { x: 1, y: 1, width: 100, height: 80 },
      targetLabel: 'Figure 2',
      viewport: { width: 1000, height: 800, scaleFactor: 2 }
    })
    expect(anchoredCommentCaptureResultSchema.parse(result.output)).toMatchObject({
      ok: false,
      message: expect.stringContaining('unavailable')
    })
  })

  it('stores only Host-redacted registered-target capture bytes', async () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const sha256 = createHash('sha256').update(png).digest('hex')
    const putScreenshotAsset = vi.fn(async () => ({
      digest: sha256,
      mimeType: 'image/png' as const,
      byteLength: png.byteLength,
      width: 120,
      height: 80
    }))
    const captureRegisteredTarget = vi.fn(async () => ({
      ok: true as const,
      png,
      width: 120,
      height: 80,
      sha256,
      redacted: true
    }))
    const factory = createAnchoredCommentsCapabilityFactory({
      defineCapability: (definition) => definition,
      getComments: () => ({
        putScreenshotAsset
      }) as unknown as AnchoredCommentService,
      getFeedback: vi.fn(),
      visualCapture: { captureRegisteredTarget }
    })
    const capture = factory.createDefinitions().find(
      (definition) => definition.id === ANCHORED_COMMENT_CAPABILITY_IDS.capture
    )!
    const result = await capture.handler({
      targetRef: 'preview.figure:figure-2',
      targetBounds: { x: 10, y: 20, width: 120, height: 80 },
      targetLabel: 'Figure 2',
      viewport: { width: 1000, height: 800, scaleFactor: 2 }
    })

    expect(captureRegisteredTarget).toHaveBeenCalledWith({
      targetRef: 'preview.figure:figure-2',
      annotation: 'callout',
      label: 'Figure 2'
    })
    expect(putScreenshotAsset).toHaveBeenCalledWith(png, {
      width: 120,
      height: 80
    })
    expect(anchoredCommentCaptureResultSchema.parse(result.output)).toMatchObject({
      ok: true,
      capture: {
        contentDigest: sha256,
        redacted: true,
        focusedScreenshot: { digest: sha256 }
      }
    })
  })
})

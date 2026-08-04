import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'

import {
  VISUAL_CAPTURE_MAX_PNG_BYTES,
  domainMainVisualCaptureRequestSchema,
  domainMainVisualCaptureResultSchema
} from './visual-capture.js'

describe('registered visual capture contract', () => {
  it('accepts only registered-target identity and host-owned annotation options', () => {
    assert.deepEqual(domainMainVisualCaptureRequestSchema.parse({
      targetRef: 'registered-target-1',
      annotation: 'callout',
      label: 'Review note'
    }), {
      targetRef: 'registered-target-1',
      annotation: 'callout',
      label: 'Review note'
    })
    for (const unsafe of [
      {
        targetRef: 'registered-target-1',
        selector: '#private-element'
      },
      {
        targetRef: 'registered-target-1',
        redactionBounds: [{ x: 0, y: 0, width: 10, height: 10 }]
      }
    ]) {
      assert.throws(() => domainMainVisualCaptureRequestSchema.parse(unsafe), z.ZodError)
    }
  })

  it('bounds successful PNG bytes and keeps redaction failures explicit', () => {
    const success = domainMainVisualCaptureResultSchema.parse({
      ok: true,
      png: new Uint8Array([137, 80, 78, 71]),
      width: 100,
      height: 80,
      sha256: 'a'.repeat(64),
      redacted: true
    })
    assert.equal(success.ok, true)

    assert.deepEqual(domainMainVisualCaptureResultSchema.parse({
      ok: false,
      error: {
        code: 'target-redacted',
        message: 'The registered target cannot be captured.'
      }
    }), {
      ok: false,
      error: {
        code: 'target-redacted',
        message: 'The registered target cannot be captured.'
      }
    })
    assert.throws(
      () => domainMainVisualCaptureResultSchema.parse({
        ok: true,
        png: new Uint8Array(VISUAL_CAPTURE_MAX_PNG_BYTES + 1),
        width: 1,
        height: 1,
        sha256: 'a'.repeat(64),
        redacted: false
      }),
      z.ZodError
    )
  })
})

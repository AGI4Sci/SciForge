import { describe, expect, it } from 'vitest'
import { parseRuntimeErrorBody, runtimeErrorToError } from './runtime-error'

describe('runtime error parsing', () => {
  it('parses local runtime code, message, and details payloads', () => {
    const parsed = parseRuntimeErrorBody(
      JSON.stringify({
        code: 'attachment_validation_failed',
        message: 'image is too large',
        details: [{ path: ['dataBase64'], message: 'too big' }]
      }),
      'fallback'
    )

    expect(parsed).toEqual({
      code: 'attachment_validation_failed',
      message: 'image is too large',
      details: [{ path: ['dataBase64'], message: 'too big' }]
    })
  })

  it('round trips structured runtime errors through Error instances', () => {
    const error = runtimeErrorToError({
      code: 'provider_unavailable',
      message: 'provider failed',
      details: { status: 503 }
    })

    expect(parseRuntimeErrorBody(error.message, 'fallback')).toEqual({
      code: 'provider_unavailable',
      message: 'provider failed',
      details: { status: 503 }
    })
  })
})

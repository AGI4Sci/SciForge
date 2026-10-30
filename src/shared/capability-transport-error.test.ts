import { describe, expect, it } from 'vitest'
import {
  capabilityTransportFailure,
  capabilityTransportSuccess,
  unwrapCapabilityTransportEnvelope
} from './capability-transport-error'

describe('capability transport error envelope', () => {
  it('does not forward untyped Error messages or causes', () => {
    const envelope = capabilityTransportFailure(new Error(
      'Failed at /private/provider/cache.',
      { cause: new Error('provider token') }
    ))

    expect(envelope).toEqual({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'capability_transport_failed',
        message: 'The capability request failed before a safe result could be delivered.',
        category: 'failed',
        retryable: false
      }
    })
    expect(JSON.stringify(envelope)).not.toContain('/private/provider/cache')
    expect(JSON.stringify(envelope)).not.toContain('provider token')
  })

  it('unwraps success and reconstructs typed errors without message decoration', () => {
    expect(unwrapCapabilityTransportEnvelope(capabilityTransportSuccess({ ok: true })))
      .toEqual({ ok: true })

    expect(() => unwrapCapabilityTransportEnvelope({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'outcome_unknown',
        message: 'The mutation outcome is unknown.',
        category: 'failed',
        retryable: false,
        details: { expected: 'revision-2' }
      }
    })).toThrow(expect.objectContaining({
      name: 'CapabilityTransportError',
      message: 'The mutation outcome is unknown.',
      code: 'outcome_unknown',
      category: 'failed',
      retryable: false,
      details: { expected: 'revision-2' }
    }))
  })
})

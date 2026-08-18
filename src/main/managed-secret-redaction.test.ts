import { describe, expect, it } from 'vitest'
import { sanitizeTraceTextChunks, sanitizeTraceValue } from '@sciforge/full-trace'

import { ManagedSecretRedactionRegistry } from './managed-secret-redaction'
import { redactExactSensitiveValues } from '../shared/secret-redaction'

describe('managed secret redaction registry', () => {
  it('keeps active and recently replaced values, then retires them on a bounded clock', () => {
    let now = 1_000
    const registry = new ManagedSecretRedactionRegistry({
      now: () => now,
      retirementMs: 2_000
    })

    registry.activate({ recordId: 'owner:record', secret: 'active-secret-one' })
    expect(registry.values()).toEqual(['active-secret-one'])

    registry.activate({
      recordId: 'owner:record',
      secret: 'active-secret-two',
      replacedSecret: 'active-secret-one'
    })
    expect(new Set(registry.values())).toEqual(new Set([
      'active-secret-two',
      'active-secret-one'
    ]))

    registry.retire({ recordId: 'owner:record', secret: 'active-secret-two' })
    now += 1_999
    expect(new Set(registry.values())).toEqual(new Set([
      'active-secret-two',
      'active-secret-one'
    ]))
    now += 1
    expect(registry.values()).toEqual([])
  })

  it('feeds opaque active values into the canonical full-trace sanitizer', () => {
    const registry = new ManagedSecretRedactionRegistry()
    const canary = 'opaque-value-without-a-secret-looking-prefix-7b13'
    registry.activate({ recordId: 'record-a', secret: canary })
    expect(sanitizeTraceTextChunks([
      `provider failure echoed ${canary}`
    ], { sensitiveValues: registry.values() })).toEqual([
      'provider failure echoed [REDACTED]'
    ])
  })

  it('removes one opaque canary from errors, diagnostics, URLs, and serialized trace values', () => {
    const registry = new ManagedSecretRedactionRegistry()
    const canary = 'opaque-provider-surface-canary-11d8'
    registry.activate({ recordId: 'record-surface', secret: canary })
    const url = `https://opencontent.invalid/download?token=${canary}`
    const diagnostic = `provider error echoed ${url}`
    const redactedDiagnostic = redactExactSensitiveValues(diagnostic, registry.values())
    const redactedTrace = sanitizeTraceValue({
      error: new Error(diagnostic),
      diagnostic,
      url,
      nested: { token: canary }
    }, { sensitiveValues: registry.values() })

    expect(redactedDiagnostic).not.toContain(canary)
    expect(JSON.stringify(redactedTrace)).not.toContain(canary)
    expect(JSON.stringify(redactedTrace)).toContain('[REDACTED]')
  })
})

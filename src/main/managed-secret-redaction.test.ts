import { describe, expect, it } from 'vitest'
import { sanitizeTraceTextChunks, sanitizeTraceValue } from '@sciforge/full-trace'

import { ManagedSecretRedactionRegistry } from './managed-secret-redaction'
import { redactExactSensitiveValues } from '../shared/secret-redaction'

describe('managed secret redaction registry', () => {
  it('releases only the exact active value without retaining plaintext', () => {
    const registry = new ManagedSecretRedactionRegistry()
    registry.activate({ recordId: 'owner:record', secret: 'active-secret-one' })
    expect(registry.values()).toEqual(['active-secret-one'])

    registry.release({ recordId: 'owner:record', secret: 'different-secret' })
    expect(registry.values()).toEqual(['active-secret-one'])
    registry.release({ recordId: 'owner:record', secret: 'active-secret-one' })
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

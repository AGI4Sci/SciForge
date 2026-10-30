import assert from 'node:assert/strict'
import test from 'node:test'

import { auditDelivery } from './delivery-audit.js'

test('delivers only from structured output and terminal child evidence', () => {
  const result = auditDelivery({
    outputSchema: {
      type: 'object',
      required: ['status'],
      additionalProperties: false,
      properties: { status: { const: 'delivered' } }
    },
    output: { status: 'delivered' },
    children: [{ id: 'child-1', status: 'completed' }]
  })
  assert.equal(result.status, 'delivered')
  assert.equal(result.deliveryState, 'delivered')
  assert.equal(result.canAutoContinue, false)
  assert.equal(result.evidence.outputSchemaValidated, true)
})

test('ignores natural-language completion and asks for continuation when evidence is missing', () => {
  const result = auditDelivery({
    output: 'Everything is complete.',
    children: [{ id: 'child-1', status: 'completed' }]
  })
  assert.equal(result.status, 'needs_continuation')
  assert.equal(result.canAutoContinue, true)
  assert.ok(result.findings.some((finding) => finding.code === 'no_delivery_evidence'))
})

test('does not deliver while a child is still running', () => {
  const result = auditDelivery({
    outputSchema: { type: 'object', required: ['ok'], properties: { ok: { const: true } } },
    output: { ok: true },
    children: [{ id: 'child-1', status: 'running' }]
  })
  assert.equal(result.status, 'needs_continuation')
  assert.equal(result.evidence.childrenTerminal, false)
  assert.ok(result.findings.some((finding) => finding.code === 'child_incomplete'))
})

test('child failure remains resumable while malformed host evidence is blocked', () => {
  const resumable = auditDelivery({
    outputSchema: { type: 'object', required: ['ok'], properties: { ok: { const: true } } },
    output: { ok: true },
    children: [{ id: 'child-1', status: 'failed' }]
  })
  assert.equal(resumable.status, 'needs_continuation')
  assert.equal(resumable.canAutoContinue, true)

  const blocked = auditDelivery({
    outputSchema: { type: 'object', required: ['ok'], properties: { ok: { const: true } } },
    output: { ok: true },
    filePatchReceipts: [{
      contractVersion: 1,
      kind: 'host-authenticated-file-patch',
      issuer: 'sciforge.agent-runtime-host',
      source: 'codex-app-server-file-change',
      callId: 'call-1',
      executorSequence: 1,
      path: 'out.txt',
      operation: 'add',
      patchFormat: 'full-content',
      patchText: 'hello',
      patchDigest: '0'.repeat(64)
    }]
  })
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.canAutoContinue, false)
})

test('validates required file and executor receipt evidence', () => {
  const result = auditDelivery({
    requiredFiles: [{ path: 'report.md', effect: 'created' }],
    requiredReceipts: [{ path: 'report.md', operation: 'add' }],
    fileEffects: {
      contractVersion: 1,
      effects: [{ kind: 'created', path: 'report.md' }],
      issues: []
    },
    filePatchReceipts: [{
      contractVersion: 1,
      kind: 'host-authenticated-file-patch',
      issuer: 'sciforge.agent-runtime-host',
      source: 'codex-app-server-file-change',
      callId: 'call-1',
      executorSequence: 1,
      path: 'report.md',
      operation: 'add',
      patchFormat: 'full-content',
      patchText: 'hello',
      patchDigest: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    }]
  })
  assert.equal(result.status, 'delivered')
  assert.equal(result.evidence.requiredFilesSatisfied, true)
  assert.equal(result.evidence.requiredReceiptsSatisfied, true)
})

test('keeps provider lifecycle separate from delivery lifecycle', () => {
  const running = auditDelivery({ providerTurnState: 'running', output: 'done' })
  assert.equal(running.status, 'needs_continuation')
  const failed = auditDelivery({ providerTurnState: 'failed' })
  assert.equal(failed.status, 'blocked')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evidenceDagAuditForGate,
  evidenceDagWriteExportGuardPayloadSchema,
  evaluateEvidenceDagHighImpactGate,
  normalizeEvidenceDagRiskDigest
} from './gate.js'

const completedAt = '2026-07-07T01:00:00.000Z'
const now = '2026-07-07T01:05:00.000Z'

test('normalizes worker risk digests and audit timestamps', () => {
  assert.deepEqual(normalizeEvidenceDagRiskDigest(digest('minor')), {
    status: 'risks_found',
    totalFindings: 1,
    countsBySeverity: { blocker: 0, major: 0, minor: 1, info: 0 },
    highestSeverity: 'minor',
    recommendation: 'continue_with_attention'
  })
  assert.deepEqual(evidenceDagAuditForGate({
    completed_at: completedAt,
    risk_digest: digest('none')
  }), {
    auditCompletedAt: completedAt,
    riskDigest: digest('none')
  })
})

test('blocks blocker and requires an explicit override for major findings', () => {
  const blocker = evaluateEvidenceDagHighImpactGate({
    action: 'write.export',
    riskDigest: digest('blocker'),
    auditCompletedAt: completedAt,
    overrideConfirmed: true,
    requireFreshAudit: true,
    now
  })
  const major = evaluateEvidenceDagHighImpactGate({
    action: 'write.export',
    riskDigest: digest('major'),
    auditCompletedAt: completedAt,
    requireFreshAudit: true,
    now
  })
  assert.equal(blocker.allowed, false)
  assert.equal(blocker.reason, 'blocker')
  assert.equal(major.allowed, false)
  assert.equal(major.reason, 'major_requires_override')
  assert.match(major.message, /overrideConfirmed/)
})

test('allows major with override and treats minor or clean results as advisory/clean', () => {
  const major = evaluateEvidenceDagHighImpactGate({
    action: 'write.export',
    riskDigest: digest('major'),
    auditCompletedAt: completedAt,
    overrideConfirmed: true,
    requireFreshAudit: true,
    now
  })
  assert.equal(major.allowed, true)
  assert.equal(major.reason, 'major_override')
  for (const severity of ['minor', 'info', 'none'] as const) {
    const decision = evaluateEvidenceDagHighImpactGate({
      action: 'write.export',
      riskDigest: digest(severity),
      auditCompletedAt: completedAt,
      requireFreshAudit: true,
      now
    })
    assert.equal(decision.allowed, true)
    assert.equal(decision.metadata.advisory, severity !== 'none')
  }
})

test('preserves missing/stale override semantics and normalized action context', () => {
  const payload = evidenceDagWriteExportGuardPayloadSchema.parse({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace',
    overrideConfirmed: true,
    unrelatedWriteField: 'ignored'
  })
  assert.deepEqual(payload, {
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace',
    overrideConfirmed: true
  })
  const missing = evaluateEvidenceDagHighImpactGate({
    action: 'write.export',
    auditUnavailableReason: 'runtimeId and threadId were not supplied.',
    overrideConfirmed: payload.overrideConfirmed,
    workspaceRoot: payload.workspaceRoot
  })
  const stale = evaluateEvidenceDagHighImpactGate({
    action: 'write.export',
    riskDigest: digest('none'),
    auditCompletedAt: '2026-07-07T00:00:00.000Z',
    requireFreshAudit: true,
    maxAuditAgeMs: 10 * 60 * 1_000,
    now
  })
  assert.equal(missing.allowed, true)
  assert.equal(missing.reason, 'missing_audit_override')
  assert.equal(missing.metadata.workspaceRoot, '/workspace')
  assert.equal(stale.allowed, false)
  assert.equal(stale.reason, 'stale_audit_requires_override')
})

function digest(highestSeverity: 'blocker' | 'major' | 'minor' | 'info' | 'none') {
  return {
    status: highestSeverity === 'none' ? 'clean' : 'risks_found',
    total_findings: highestSeverity === 'none' ? 0 : 1,
    counts_by_severity: {
      blocker: highestSeverity === 'blocker' ? 1 : 0,
      major: highestSeverity === 'major' ? 1 : 0,
      minor: highestSeverity === 'minor' ? 1 : 0,
      info: highestSeverity === 'info' ? 1 : 0
    },
    highest_severity: highestSeverity,
    recommendation: highestSeverity === 'none'
      ? 'no_action_needed'
      : 'continue_with_attention'
  }
}

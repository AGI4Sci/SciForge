import { describe, expect, it } from 'vitest'
import {
  evaluateEvidenceDagHighImpactGate,
  normalizeEvidenceDagRiskDigest
} from './evidence-dag-gate'

const completedAt = '2026-07-07T01:00:00.000Z'
const now = '2026-07-07T01:05:00.000Z'

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
    recommendation: highestSeverity === 'none' ? 'no_action_needed' : 'continue_with_attention'
  }
}

describe('Evidence DAG high-impact gate', () => {
  it('normalizes snake_case risk digests for gate metadata', () => {
    expect(normalizeEvidenceDagRiskDigest(digest('minor'))).toEqual({
      status: 'risks_found',
      totalFindings: 1,
      countsBySeverity: {
        blocker: 0,
        major: 0,
        minor: 1,
        info: 0
      },
      highestSeverity: 'minor',
      recommendation: 'continue_with_attention'
    })
  })

  it('rejects blocker findings even with an override', () => {
    const decision = evaluateEvidenceDagHighImpactGate({
      action: 'write:export',
      riskDigest: digest('blocker'),
      auditCompletedAt: completedAt,
      overrideConfirmed: true,
      requireFreshAudit: true,
      now
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('blocker')
    expect(decision.metadata.highestSeverity).toBe('blocker')
  })

  it('rejects major findings until the caller explicitly overrides', () => {
    const decision = evaluateEvidenceDagHighImpactGate({
      action: 'write:export',
      riskDigest: digest('major'),
      auditCompletedAt: completedAt,
      requireFreshAudit: true,
      now
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('major_requires_override')
    expect(decision.metadata.requiresOverride).toBe(true)
  })

  it('allows major findings when the caller explicitly overrides', () => {
    const decision = evaluateEvidenceDagHighImpactGate({
      action: 'write:export',
      riskDigest: digest('major'),
      auditCompletedAt: completedAt,
      overrideConfirmed: true,
      requireFreshAudit: true,
      now
    })

    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe('major_override')
    expect(decision.metadata.advisory).toBe(true)
  })

  it('allows minor, info, and clean audits as advisory metadata', () => {
    for (const severity of ['minor', 'info', 'none'] as const) {
      const decision = evaluateEvidenceDagHighImpactGate({
        action: 'write:export',
        riskDigest: digest(severity),
        auditCompletedAt: completedAt,
        requireFreshAudit: true,
        now
      })

      expect(decision.allowed).toBe(true)
      expect(decision.metadata.highestSeverity).toBe(severity)
      expect(decision.metadata.riskDigest?.highestSeverity).toBe(severity)
    }
  })

  it('requires an override when the audit is missing or stale', () => {
    const missing = evaluateEvidenceDagHighImpactGate({
      action: 'write:export',
      auditUnavailableReason: 'Evidence DAG service is not configured.'
    })
    const stale = evaluateEvidenceDagHighImpactGate({
      action: 'write:export',
      riskDigest: digest('none'),
      auditCompletedAt: '2026-07-07T00:00:00.000Z',
      requireFreshAudit: true,
      maxAuditAgeMs: 10 * 60 * 1000,
      now
    })

    expect(missing.allowed).toBe(false)
    expect(missing.reason).toBe('missing_audit_requires_override')
    expect(stale.allowed).toBe(false)
    expect(stale.reason).toBe('stale_audit_requires_override')
  })
})

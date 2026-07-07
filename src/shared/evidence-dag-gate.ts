export const DEFAULT_EVIDENCE_DAG_AUDIT_MAX_AGE_MS = 30 * 60 * 1000

export const EVIDENCE_DAG_RISK_SEVERITIES = ['blocker', 'major', 'minor', 'info', 'none'] as const

export type EvidenceDagRiskSeverity = (typeof EVIDENCE_DAG_RISK_SEVERITIES)[number]
export type EvidenceDagAuditState = 'fresh' | 'missing' | 'stale'

export type EvidenceDagGateReason =
  | 'clean'
  | 'advisory'
  | 'blocker'
  | 'major_requires_override'
  | 'major_override'
  | 'missing_audit_requires_override'
  | 'missing_audit_override'
  | 'stale_audit_requires_override'
  | 'stale_audit_override'

export type EvidenceDagGateRiskDigest = {
  status?: string
  totalFindings?: number
  countsBySeverity?: Partial<Record<Exclude<EvidenceDagRiskSeverity, 'none'>, number>>
  highestSeverity: EvidenceDagRiskSeverity
  recommendation?: string
}

export type EvidenceDagGateMetadata = {
  policy: 'evidence-dag-high-impact-gate'
  action: string
  auditState: EvidenceDagAuditState
  highestSeverity: EvidenceDagRiskSeverity
  requiresOverride: boolean
  overrideConfirmed: boolean
  riskDigest?: EvidenceDagGateRiskDigest
  auditCompletedAt?: string
  auditAgeMs?: number
  advisory: boolean
  message?: string
  auditUnavailableReason?: string
}

export type EvidenceDagGateDecision = {
  allowed: boolean
  reason: EvidenceDagGateReason
  message: string
  metadata: EvidenceDagGateMetadata
}

export type EvaluateEvidenceDagHighImpactGateInput = {
  action?: string
  riskDigest?: unknown
  auditCompletedAt?: string
  auditUnavailableReason?: string
  overrideConfirmed?: boolean
  requireFreshAudit?: boolean
  maxAuditAgeMs?: number
  now?: Date | number | string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeSeverity(value: unknown): EvidenceDagRiskSeverity | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return EVIDENCE_DAG_RISK_SEVERITIES.includes(normalized as EvidenceDagRiskSeverity)
    ? normalized as EvidenceDagRiskSeverity
    : undefined
}

function normalizeCounts(value: unknown): EvidenceDagGateRiskDigest['countsBySeverity'] | undefined {
  if (!isRecord(value)) return undefined
  const counts: EvidenceDagGateRiskDigest['countsBySeverity'] = {}
  for (const severity of ['blocker', 'major', 'minor', 'info'] as const) {
    const count = readNumber(value, severity)
    if (count !== undefined) counts[severity] = count
  }
  return Object.keys(counts).length ? counts : undefined
}

function highestSeverityFromCounts(
  counts: EvidenceDagGateRiskDigest['countsBySeverity'] | undefined
): EvidenceDagRiskSeverity | undefined {
  if (!counts) return undefined
  for (const severity of ['blocker', 'major', 'minor', 'info'] as const) {
    if ((counts[severity] ?? 0) > 0) return severity
  }
  return 'none'
}

export function normalizeEvidenceDagRiskDigest(value: unknown): EvidenceDagGateRiskDigest | undefined {
  if (!isRecord(value)) return undefined

  const countsBySeverity = normalizeCounts(value.counts_by_severity ?? value.countsBySeverity)
  const totalFindings = readNumber(value, 'total_findings') ?? readNumber(value, 'totalFindings')
  const status = readString(value, 'status')
  const recommendation = readString(value, 'recommendation')
  const highestSeverity =
    normalizeSeverity(value.highest_severity ?? value.highestSeverity) ??
    highestSeverityFromCounts(countsBySeverity) ??
    (status === 'clean' || totalFindings === 0 ? 'none' : undefined)

  if (!highestSeverity) return undefined

  return {
    ...(status ? { status } : {}),
    ...(totalFindings !== undefined ? { totalFindings } : {}),
    ...(countsBySeverity ? { countsBySeverity } : {}),
    highestSeverity,
    ...(recommendation ? { recommendation } : {})
  }
}

function timeMs(value: Date | number | string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

function auditAgeMs(input: EvaluateEvidenceDagHighImpactGateInput): number | undefined {
  const completedMs = timeMs(input.auditCompletedAt)
  if (completedMs === undefined) return undefined
  const nowMs = timeMs(input.now) ?? Date.now()
  return Math.max(0, nowMs - completedMs)
}

export function evaluateEvidenceDagHighImpactGate(
  input: EvaluateEvidenceDagHighImpactGateInput
): EvidenceDagGateDecision {
  const action = input.action?.trim() || 'high-impact-action'
  const overrideConfirmed = input.overrideConfirmed === true
  const riskDigest = normalizeEvidenceDagRiskDigest(input.riskDigest)
  const maxAuditAgeMs = input.maxAuditAgeMs ?? DEFAULT_EVIDENCE_DAG_AUDIT_MAX_AGE_MS
  const ageMs = auditAgeMs(input)
  const auditState: EvidenceDagAuditState = !riskDigest
    ? 'missing'
    : input.requireFreshAudit === true && (ageMs === undefined || ageMs > maxAuditAgeMs)
      ? 'stale'
      : 'fresh'
  const highestSeverity = riskDigest?.highestSeverity ?? 'none'

  const baseMetadata: EvidenceDagGateMetadata = {
    policy: 'evidence-dag-high-impact-gate',
    action,
    auditState,
    highestSeverity,
    requiresOverride: false,
    overrideConfirmed,
    ...(riskDigest ? { riskDigest } : {}),
    ...(input.auditCompletedAt ? { auditCompletedAt: input.auditCompletedAt } : {}),
    ...(ageMs !== undefined ? { auditAgeMs: ageMs } : {}),
    advisory: false,
    ...(input.auditUnavailableReason ? { auditUnavailableReason: input.auditUnavailableReason } : {})
  }

  if (auditState === 'missing') {
    const message = input.auditUnavailableReason
      ? `Evidence DAG audit is missing for ${action}: ${input.auditUnavailableReason}`
      : `Evidence DAG audit is missing for ${action}.`
    if (!overrideConfirmed) {
      return {
        allowed: false,
        reason: 'missing_audit_requires_override',
        message: `${message} Pass evidenceDagGateOverride: true to explicitly accept this risk.`,
        metadata: {
          ...baseMetadata,
          requiresOverride: true,
          message
        }
      }
    }
    return {
      allowed: true,
      reason: 'missing_audit_override',
      message,
      metadata: {
        ...baseMetadata,
        requiresOverride: true,
        advisory: true,
        message
      }
    }
  }

  if (auditState === 'stale') {
    const message = input.auditCompletedAt
      ? `Evidence DAG audit for ${action} is stale.`
      : `Evidence DAG audit for ${action} has no freshness timestamp.`
    if (!overrideConfirmed) {
      return {
        allowed: false,
        reason: 'stale_audit_requires_override',
        message: `${message} Pass evidenceDagGateOverride: true to explicitly accept this risk.`,
        metadata: {
          ...baseMetadata,
          requiresOverride: true,
          message
        }
      }
    }
    return {
      allowed: true,
      reason: 'stale_audit_override',
      message,
      metadata: {
        ...baseMetadata,
        requiresOverride: true,
        advisory: true,
        message
      }
    }
  }

  if (highestSeverity === 'blocker') {
    const message = `Evidence DAG audit found blocker risks for ${action}; resolve them before continuing.`
    return {
      allowed: false,
      reason: 'blocker',
      message,
      metadata: {
        ...baseMetadata,
        message
      }
    }
  }

  if (highestSeverity === 'major') {
    const message = `Evidence DAG audit found major risks for ${action}.`
    if (!overrideConfirmed) {
      return {
        allowed: false,
        reason: 'major_requires_override',
        message: `${message} Pass evidenceDagGateOverride: true to explicitly accept this risk.`,
        metadata: {
          ...baseMetadata,
          requiresOverride: true,
          message
        }
      }
    }
    return {
      allowed: true,
      reason: 'major_override',
      message,
      metadata: {
        ...baseMetadata,
        requiresOverride: true,
        advisory: true,
        message
      }
    }
  }

  const clean = highestSeverity === 'none'
  const message = clean
    ? `Evidence DAG audit is clean for ${action}.`
    : `Evidence DAG audit found ${highestSeverity} advisory risks for ${action}.`
  return {
    allowed: true,
    reason: clean ? 'clean' : 'advisory',
    message,
    metadata: {
      ...baseMetadata,
      advisory: !clean,
      message
    }
  }
}

import { z } from 'zod'

export const DEFAULT_EVIDENCE_DAG_AUDIT_MAX_AGE_MS = 30 * 60 * 1_000
export const EVIDENCE_DAG_WRITE_EXPORT_ACTION = 'write.export' as const
export const EVIDENCE_DAG_RISK_SEVERITIES =
  ['blocker', 'major', 'minor', 'info', 'none'] as const

export const evidenceDagWriteExportGuardPayloadSchema = z.object({
  runtimeId: z.string().trim().min(1).max(128).optional(),
  threadId: z.string().trim().min(1).max(512).optional(),
  workspaceRoot: z.string().trim().min(1).max(4_096).optional(),
  overrideConfirmed: z.boolean().default(false)
})

export type EvidenceDagWriteExportGuardPayload = z.input<
  typeof evidenceDagWriteExportGuardPayloadSchema
>
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

export type EvidenceDagGateRiskDigest = Readonly<{
  status?: string
  totalFindings?: number
  countsBySeverity?: Partial<Record<Exclude<EvidenceDagRiskSeverity, 'none'>, number>>
  highestSeverity: EvidenceDagRiskSeverity
  recommendation?: string
}>

export type EvidenceDagGateMetadata = Readonly<{
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
  runtimeId?: string
  threadId?: string
  workspaceRoot?: string
}>

export type EvidenceDagGateDecision = Readonly<{
  allowed: boolean
  reason: EvidenceDagGateReason
  message: string
  metadata: EvidenceDagGateMetadata
}>

export type EvaluateEvidenceDagHighImpactGateInput = Readonly<{
  action?: string
  riskDigest?: unknown
  auditCompletedAt?: string
  auditUnavailableReason?: string
  overrideConfirmed?: boolean
  requireFreshAudit?: boolean
  maxAuditAgeMs?: number
  now?: Date | number | string
  runtimeId?: string
  threadId?: string
  workspaceRoot?: string
}>

export function normalizeEvidenceDagRiskDigest(
  value: unknown
): EvidenceDagGateRiskDigest | undefined {
  const input = record(value)
  if (!input) return undefined
  const countsBySeverity = normalizeCounts(
    input.counts_by_severity ?? input.countsBySeverity
  )
  const totalFindings = numberValue(input.total_findings) ??
    numberValue(input.totalFindings)
  const status = stringValue(input.status)
  const recommendation = stringValue(input.recommendation)
  const highestSeverity =
    normalizeSeverity(input.highest_severity ?? input.highestSeverity) ??
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

export function evidenceDagAuditForGate(audit: unknown): Readonly<{
  riskDigest?: unknown
  auditCompletedAt?: string
  auditUnavailableReason?: string
}> {
  const input = record(audit)
  if (!input) {
    return { auditUnavailableReason: 'Evidence DAG audit response was empty.' }
  }
  const riskDigest = input.risk_digest ?? input.riskDigest
  if (!riskDigest) {
    return {
      auditUnavailableReason: 'Evidence DAG audit response did not include risk_digest.'
    }
  }
  return {
    riskDigest,
    ...(stringValue(input.completed_at ?? input.completedAt)
      ? { auditCompletedAt: stringValue(input.completed_at ?? input.completedAt) }
      : {})
  }
}

export function evaluateEvidenceDagHighImpactGate(
  input: EvaluateEvidenceDagHighImpactGateInput
): EvidenceDagGateDecision {
  const action = input.action?.trim() || 'high-impact-action'
  const overrideConfirmed = input.overrideConfirmed === true
  const riskDigest = normalizeEvidenceDagRiskDigest(input.riskDigest)
  const ageMs = auditAgeMs(input)
  const auditState: EvidenceDagAuditState = !riskDigest
    ? 'missing'
    : input.requireFreshAudit === true &&
        (ageMs === undefined ||
          ageMs > (input.maxAuditAgeMs ?? DEFAULT_EVIDENCE_DAG_AUDIT_MAX_AGE_MS))
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
    ...(input.auditUnavailableReason
      ? { auditUnavailableReason: input.auditUnavailableReason }
      : {}),
    ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {})
  }
  if (auditState === 'missing') {
    const message = input.auditUnavailableReason
      ? `Evidence DAG audit is missing for ${action}: ${input.auditUnavailableReason}`
      : `Evidence DAG audit is missing for ${action}.`
    return overrideConfirmed
      ? allowOverride('missing_audit_override', message, baseMetadata)
      : requireOverride('missing_audit_requires_override', message, baseMetadata)
  }
  if (auditState === 'stale') {
    const message = input.auditCompletedAt
      ? `Evidence DAG audit for ${action} is stale.`
      : `Evidence DAG audit for ${action} has no freshness timestamp.`
    return overrideConfirmed
      ? allowOverride('stale_audit_override', message, baseMetadata)
      : requireOverride('stale_audit_requires_override', message, baseMetadata)
  }
  if (highestSeverity === 'blocker') {
    const message =
      `Evidence DAG audit found blocker risks for ${action}; resolve them before continuing.`
    return {
      allowed: false,
      reason: 'blocker',
      message,
      metadata: { ...baseMetadata, message }
    }
  }
  if (highestSeverity === 'major') {
    const message = `Evidence DAG audit found major risks for ${action}.`
    return overrideConfirmed
      ? allowOverride('major_override', message, baseMetadata)
      : requireOverride('major_requires_override', message, baseMetadata)
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

function requireOverride(
  reason: Extract<EvidenceDagGateReason, `${string}_requires_override`>,
  message: string,
  metadata: EvidenceDagGateMetadata
): EvidenceDagGateDecision {
  return {
    allowed: false,
    reason,
    message: `${message} Pass overrideConfirmed: true to explicitly accept this risk.`,
    metadata: {
      ...metadata,
      requiresOverride: true,
      message
    }
  }
}

function allowOverride(
  reason: 'missing_audit_override' | 'stale_audit_override' | 'major_override',
  message: string,
  metadata: EvidenceDagGateMetadata
): EvidenceDagGateDecision {
  return {
    allowed: true,
    reason,
    message,
    metadata: {
      ...metadata,
      requiresOverride: true,
      advisory: true,
      message
    }
  }
}

function normalizeSeverity(value: unknown): EvidenceDagRiskSeverity | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return EVIDENCE_DAG_RISK_SEVERITIES.includes(normalized as EvidenceDagRiskSeverity)
    ? normalized as EvidenceDagRiskSeverity
    : undefined
}

function normalizeCounts(
  value: unknown
): EvidenceDagGateRiskDigest['countsBySeverity'] | undefined {
  const input = record(value)
  if (!input) return undefined
  const counts: Partial<Record<'blocker' | 'major' | 'minor' | 'info', number>> = {}
  for (const severity of ['blocker', 'major', 'minor', 'info'] as const) {
    const count = numberValue(input[severity])
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

function auditAgeMs(input: EvaluateEvidenceDagHighImpactGateInput): number | undefined {
  const completedMs = timeMs(input.auditCompletedAt)
  if (completedMs === undefined) return undefined
  return Math.max(0, (timeMs(input.now) ?? Date.now()) - completedMs)
}

function timeMs(value: Date | number | string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(milliseconds) ? milliseconds : undefined
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

import type { GatewayRequest } from '../runtime-types.js';
import { extractLikelyErrorLine, isRecord, toStringList, uniqueStrings } from '../gateway-utils.js';

export interface AgentServerRepairContextPolicySummary {
  schemaVersion: 'sciforge.agentserver.repair-context-policy-summary.v1';
  source: string;
  kind?: string;
  maxAttempts?: number;
  includeStdoutSummary: boolean;
  includeStderrSummary: boolean;
  includeValidationFindings: boolean;
  includePriorAttemptRefs: boolean;
  allowedFailureEvidenceRefs: string[];
  blockedFailureEvidenceRefs: string[];
}

interface RepairEvidenceDecision {
  include: boolean;
  reason?: 'blocked' | 'not-allowed' | 'disabled';
  refs: string[];
}

export function repairContextPolicySummaryForAgentServer(
  request: GatewayRequest,
  repairContext: Record<string, unknown> | undefined,
): AgentServerRepairContextPolicySummary | undefined {
  const requestMetadata = isRecord((request as { metadata?: unknown }).metadata)
    ? (request as { metadata?: Record<string, unknown> }).metadata
    : undefined;
  const candidates: Array<{ source: string; value: unknown }> = [
    { source: 'repairContext.agentHarnessHandoff', value: repairContext?.agentHarnessHandoff },
    { source: 'repairContext.repairContextPolicy', value: repairContext?.repairContextPolicy },
    { source: 'request.metadata.agentHarnessHandoff', value: requestMetadata?.agentHarnessHandoff },
    { source: 'request.metadata.repairContextPolicy', value: requestMetadata?.repairContextPolicy },
    { source: 'request.uiState.agentHarnessHandoff', value: isRecord(request.uiState) ? request.uiState.agentHarnessHandoff : undefined },
    { source: 'request.uiState.agentHarness.contract', value: isRecord(request.uiState) && isRecord(request.uiState.agentHarness) ? request.uiState.agentHarness.contract : undefined },
  ];
  for (const candidate of candidates) {
    const policy = repairContextPolicyFromCandidate(candidate.value);
    if (!policy) continue;
    return {
      schemaVersion: 'sciforge.agentserver.repair-context-policy-summary.v1',
      source: candidate.source,
      kind: stringField(policy.kind),
      maxAttempts: numberField(policy.maxAttempts),
      includeStdoutSummary: policy.includeStdoutSummary === true,
      includeStderrSummary: policy.includeStderrSummary === true,
      includeValidationFindings: policy.includeValidationFindings === true,
      includePriorAttemptRefs: policy.includePriorAttemptRefs === true,
      allowedFailureEvidenceRefs: toStringList(policy.allowedFailureEvidenceRefs).slice(0, 12),
      blockedFailureEvidenceRefs: toStringList(policy.blockedFailureEvidenceRefs).slice(0, 12),
    };
  }
  return undefined;
}

export function applyRepairContextPolicyForAgentServer(
  repairContext: Record<string, unknown> | undefined,
  policy: AgentServerRepairContextPolicySummary | undefined,
): Record<string, unknown> | undefined {
  if (!repairContext || !policy) return repairContext;
  const workspaceRefs = isRecord(repairContext.workspaceRefs) ? repairContext.workspaceRefs : {};
  const stdoutRefs = failureEvidenceRefAliases(workspaceRefs.stdoutRef, 'stdout', 'stdoutSummary');
  const stderrRefs = failureEvidenceRefAliases(workspaceRefs.stderrRef, 'stderr', 'stderrSummary');
  const outputRefs = failureEvidenceRefAliases(workspaceRefs.outputRef, 'output', 'workEvidenceSummary');
  const failureReasonRefs = failureEvidenceRefAliases(workspaceRefs.outputRef, 'failureReason', 'failure:reason');
  const validationRefs = failureEvidenceRefAliases(workspaceRefs.outputRef, 'validation:findings', 'validator:findings', 'schemaErrors');
  const audit = repairContextPolicyAudit(policy);
  const filtered: Record<string, unknown> = {
    ...repairContext,
    repairContextPolicy: {
      source: policy.source,
      kind: policy.kind,
      maxAttempts: policy.maxAttempts,
      includeStdoutSummary: policy.includeStdoutSummary,
      includeStderrSummary: policy.includeStderrSummary,
      includeValidationFindings: policy.includeValidationFindings,
      includePriorAttemptRefs: policy.includePriorAttemptRefs,
      allowedFailureEvidenceRefs: policy.allowedFailureEvidenceRefs,
      blockedFailureEvidenceRefs: policy.blockedFailureEvidenceRefs,
    },
  };

  const failure = isRecord(repairContext.failure) ? { ...repairContext.failure } : {};
  const failureEvidenceText: string[] = [];
  applyFailureFieldPolicy(failure, 'failureReason', failureReasonRefs, true, policy, audit, failureEvidenceText);
  applyFailureFieldPolicy(failure, 'stdoutTail', stdoutRefs, policy.includeStdoutSummary, policy, audit, failureEvidenceText);
  applyFailureFieldPolicy(failure, 'stderrTail', stderrRefs, policy.includeStderrSummary, policy, audit, failureEvidenceText);
  applyFailureFieldPolicy(failure, 'outputHead', outputRefs, true, policy, audit, failureEvidenceText);
  applyFailureFieldPolicy(failure, 'workEvidenceSummary', outputRefs, true, policy, audit);
  filterSchemaErrorsForRepairPolicy(failure, validationRefs, policy, audit, failureEvidenceText);
  const likelyErrorLine = extractLikelyErrorLine(failureEvidenceText.join('\n'));
  if (likelyErrorLine) {
    failure.likelyErrorLine = likelyErrorLine;
  } else {
    delete failure.likelyErrorLine;
  }
  filtered.failure = failure;
  filtered.priorAttempts = filterPriorAttemptsForRepairPolicy(repairContext.priorAttempts, policy, audit);
  filtered.repairContextPolicyAudit = audit;
  return filtered;
}

function applyFailureFieldPolicy(
  failure: Record<string, unknown>,
  field: string,
  refs: string[],
  enabled: boolean,
  policy: AgentServerRepairContextPolicySummary,
  audit: Record<string, unknown>,
  failureEvidenceText?: string[],
) {
  if (failure[field] === undefined) return;
  const decision = repairEvidenceDecision(refs, policy, enabled);
  recordRepairEvidenceDecision(audit, `failure.${field}`, decision);
  if (!decision.include) {
    delete failure[field];
    return;
  }
  if (failureEvidenceText && typeof failure[field] === 'string') {
    failureEvidenceText.push(failure[field]);
  }
}

function filterSchemaErrorsForRepairPolicy(
  failure: Record<string, unknown>,
  refs: string[],
  policy: AgentServerRepairContextPolicySummary,
  audit: Record<string, unknown>,
  failureEvidenceText: string[],
) {
  if (!Array.isArray(failure.schemaErrors)) return;
  const decision = repairEvidenceDecision(refs, policy, policy.includeValidationFindings);
  recordRepairEvidenceDecision(audit, 'failure.schemaErrors', decision);
  if (!decision.include) {
    delete failure.schemaErrors;
    return;
  }
  failureEvidenceText.push(...failure.schemaErrors.map((entry) => String(entry || '')).filter(Boolean));
}

function filterPriorAttemptsForRepairPolicy(
  value: unknown,
  policy: AgentServerRepairContextPolicySummary,
  audit: Record<string, unknown>,
) {
  if (!Array.isArray(value)) return [];
  const kept: unknown[] = [];
  value.forEach((attempt, index) => {
    if (!isRecord(attempt)) return;
    const refs = failureEvidenceRefsForRecord(attempt);
    const decision = repairEvidenceDecision(refs.length ? refs : [`priorAttempt:${index + 1}`], policy, policy.includePriorAttemptRefs);
    recordRepairEvidenceDecision(audit, `priorAttempts[${index}]`, decision);
    if (!decision.include) return;
    const filteredAttempt = { ...attempt };
    applyFailureFieldPolicy(filteredAttempt, 'stdoutRef', failureEvidenceRefAliases(filteredAttempt.stdoutRef, 'stdout'), policy.includeStdoutSummary, policy, audit);
    applyFailureFieldPolicy(filteredAttempt, 'stderrRef', failureEvidenceRefAliases(filteredAttempt.stderrRef, 'stderr'), policy.includeStderrSummary, policy, audit);
    if (!policy.includeValidationFindings) delete filteredAttempt.schemaErrors;
    kept.push(filteredAttempt);
  });
  return kept;
}

function failureEvidenceRefsForRecord(record: Record<string, unknown>) {
  return uniqueStrings([
    ...toStringList(record.evidenceRefs),
    ...['ref', 'codeRef', 'outputRef', 'stdoutRef', 'stderrRef', 'traceRef', 'diffRef'].flatMap((key) => {
      const value = stringField(record[key]);
      return value ? [value] : [];
    }),
  ]);
}

function failureEvidenceRefAliases(...refs: unknown[]) {
  return uniqueStrings(refs.flatMap((ref) => {
    const value = stringField(ref);
    return value ? [value] : [];
  }));
}

function repairEvidenceDecision(
  refs: string[],
  policy: AgentServerRepairContextPolicySummary,
  enabled = true,
): RepairEvidenceDecision {
  const normalizedRefs = uniqueStrings(refs);
  if (!enabled) return { include: false, reason: 'disabled', refs: normalizedRefs };
  const blocked = normalizedRefs.filter((ref) => policy.blockedFailureEvidenceRefs.includes(ref));
  if (blocked.length) return { include: false, reason: 'blocked', refs: blocked };
  if (policy.allowedFailureEvidenceRefs.length) {
    const allowed = normalizedRefs.filter((ref) => policy.allowedFailureEvidenceRefs.includes(ref));
    if (!allowed.length) return { include: false, reason: 'not-allowed', refs: normalizedRefs };
    return { include: true, refs: allowed };
  }
  return { include: true, refs: normalizedRefs };
}

function repairContextPolicyAudit(policy: AgentServerRepairContextPolicySummary): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.agentserver.repair-context-policy-audit.v1',
    source: policy.source,
    deterministic: true,
    allowedFailureEvidenceRefs: policy.allowedFailureEvidenceRefs,
    blockedFailureEvidenceRefs: policy.blockedFailureEvidenceRefs,
    includeStdoutSummary: policy.includeStdoutSummary,
    includeStderrSummary: policy.includeStderrSummary,
    includeValidationFindings: policy.includeValidationFindings,
    includePriorAttemptRefs: policy.includePriorAttemptRefs,
    includedFailureEvidenceRefs: [],
    omittedFailureEvidenceRefs: [],
    omittedFields: [],
  };
}

function recordRepairEvidenceDecision(
  audit: Record<string, unknown>,
  path: string,
  decision: RepairEvidenceDecision,
) {
  if (decision.include) {
    audit.includedFailureEvidenceRefs = uniqueStrings([
      ...toStringList(audit.includedFailureEvidenceRefs),
      ...decision.refs,
    ]);
    return;
  }
  audit.omittedFailureEvidenceRefs = uniqueStrings([
    ...toStringList(audit.omittedFailureEvidenceRefs),
    ...decision.refs,
  ]);
  const omittedFields = Array.isArray(audit.omittedFields) ? audit.omittedFields.filter(isRecord) : [];
  omittedFields.push({
    path,
    reason: decision.reason,
    refs: decision.refs,
  });
  audit.omittedFields = omittedFields;
}

function repairContextPolicyFromCandidate(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.repairContextPolicy)) return value.repairContextPolicy;
  if (stringField(value.kind) || value.maxAttempts !== undefined) return value;
  return undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

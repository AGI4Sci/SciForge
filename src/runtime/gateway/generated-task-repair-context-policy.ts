import type { GatewayRequest } from '../runtime-types.js';
import { extractLikelyErrorLine, hashJson, isRecord, toStringList, uniqueStrings } from '../gateway-utils.js';

export interface BackendRepairContextPolicySummary {
  schemaVersion: 'sciforge.agentserver.repair-context-policy-summary.v1';
  source: string;
  sourceKind: 'contract-handoff' | 'contract';
  contractRef?: string;
  traceRef?: string;
  deterministicDecisionRef: string;
  ignoredLegacySources?: BackendIgnoredLegacyRepairContextPolicySource[];
  kind?: string;
  maxAttempts?: number;
  includeStdoutSummary: boolean;
  includeStderrSummary: boolean;
  includeValidationFindings: boolean;
  includePriorAttemptRefs: boolean;
  allowedFailureEvidenceRefs: string[];
  blockedFailureEvidenceRefs: string[];
}

export interface BackendIgnoredLegacyRepairContextPolicySource {
  source: string;
  reason: 'contract-only-repair-context-policy';
  fields: string[];
  allowedFailureEvidenceRefCount?: number;
  blockedFailureEvidenceRefCount?: number;
}

interface RepairEvidenceDecision {
  include: boolean;
  reason?: 'blocked' | 'not-allowed' | 'disabled';
  refs: string[];
}

export function repairContextPolicySummaryForBackend(
  request: GatewayRequest,
  repairContext: Record<string, unknown> | undefined,
): BackendRepairContextPolicySummary | undefined {
  const requestMetadata = isRecord((request as { metadata?: unknown }).metadata)
    ? (request as { metadata?: Record<string, unknown> }).metadata
    : undefined;
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const agentHarness = isRecord(uiState.agentHarness) ? uiState.agentHarness : {};
  const ignoredLegacySources = ignoredLegacyRepairContextPolicySources(request, repairContext);
  const embeddedPolicy = contractEmbeddedRepairContextPolicy(repairContext?.repairContextPolicy);
  const candidates: Array<{
    source: string;
    sourceKind: BackendRepairContextPolicySummary['sourceKind'];
    value: unknown;
  }> = [
    { source: 'repairContext.agentHarnessHandoff', sourceKind: 'contract-handoff', value: repairContext?.agentHarnessHandoff },
    { source: 'request.metadata.agentHarnessHandoff', sourceKind: 'contract-handoff', value: requestMetadata?.agentHarnessHandoff },
    { source: 'request.uiState.agentHarnessHandoff', sourceKind: 'contract-handoff', value: uiState.agentHarnessHandoff },
    { source: 'request.uiState.agentHarness.contract', sourceKind: 'contract', value: agentHarness.contract },
    ...(embeddedPolicy ? [{
      source: 'repairContext.repairContextPolicy',
      sourceKind: embeddedPolicy.sourceKind,
      value: embeddedPolicy.value,
    }] : []),
  ];
  for (const candidate of candidates) {
    const policy = repairContextPolicyFromCandidate(candidate.value);
    if (!policy) continue;
    if (stringField(policy.kind) === 'supplement') continue;
    const sourceRefs = repairContextPolicySourceRefs(candidate.value);
    const summary: BackendRepairContextPolicySummary = {
      schemaVersion: 'sciforge.agentserver.repair-context-policy-summary.v1',
      source: candidate.source,
      sourceKind: candidate.sourceKind,
      contractRef: sourceRefs.contractRef,
      traceRef: sourceRefs.traceRef,
      deterministicDecisionRef: '',
      kind: stringField(policy.kind),
      maxAttempts: numberField(policy.maxAttempts),
      includeStdoutSummary: policy.includeStdoutSummary === true,
      includeStderrSummary: policy.includeStderrSummary === true,
      includeValidationFindings: policy.includeValidationFindings === true,
      includePriorAttemptRefs: policy.includePriorAttemptRefs === true,
      allowedFailureEvidenceRefs: toStringList(policy.allowedFailureEvidenceRefs).slice(0, 12),
      blockedFailureEvidenceRefs: toStringList(policy.blockedFailureEvidenceRefs).slice(0, 12),
    };
    summary.deterministicDecisionRef = repairContextPolicyDecisionRef(summary);
    if (ignoredLegacySources.length) summary.ignoredLegacySources = ignoredLegacySources;
    return summary;
  }
  return repairContext
    ? defaultRepairContextPolicySummaryForBackend(ignoredLegacySources)
    : undefined;
}

export function ignoredLegacyRepairContextPolicyAuditForBackend(
  request: GatewayRequest,
  repairContext: Record<string, unknown> | undefined,
) {
  const ignoredLegacySources = ignoredLegacyRepairContextPolicySources(request, repairContext);
  if (!ignoredLegacySources.length) return undefined;
  return {
    schemaVersion: 'sciforge.agentserver.repair-context-policy-ignored-legacy.v1',
    deterministic: true,
    reason: 'contract-only-repair-context-policy',
    ignoredLegacySources,
    deterministicDecisionRef: hashJson({ ignoredLegacySources }),
  };
}

export function applyRepairContextPolicyForBackend(
  repairContext: Record<string, unknown> | undefined,
  policy: BackendRepairContextPolicySummary | undefined,
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
      sourceKind: policy.sourceKind,
      contractRef: policy.contractRef,
      traceRef: policy.traceRef,
      deterministicDecisionRef: policy.deterministicDecisionRef,
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
  const stderrDecision = repairEvidenceDecision(stderrRefs, policy, policy.includeStderrSummary);
  applyFailureFieldPolicy(failure, 'failureReason', failureReasonRefs, true, policy, audit, failureEvidenceText);
  applyFailureFieldPolicy(failure, 'stdoutTail', stdoutRefs, policy.includeStdoutSummary, policy, audit, failureEvidenceText);
  applyFailureFieldPolicy(failure, 'stderrTail', stderrRefs, policy.includeStderrSummary, policy, audit, failureEvidenceText);
  recordRepairEvidenceDecision(audit, 'diagnostics.stdoutRef', repairEvidenceDecision(stdoutRefs, policy, policy.includeStdoutSummary));
  recordRepairEvidenceDecision(audit, 'diagnostics.stderrRef', stderrDecision);
  sanitizeFailureReasonEmbeddedBlockedStderr(failure, stderrDecision, audit);
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
  policy: BackendRepairContextPolicySummary,
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

function sanitizeFailureReasonEmbeddedBlockedStderr(
  failure: Record<string, unknown>,
  stderrDecision: RepairEvidenceDecision,
  audit: Record<string, unknown>,
) {
  if (stderrDecision.include || typeof failure.failureReason !== 'string') return;
  const sanitized = redactEmbeddedStderrFromFailureReason(failure.failureReason);
  if (sanitized === failure.failureReason) return;
  failure.failureReason = sanitized;
  recordRepairEvidenceDecision(audit, 'failure.failureReason.embeddedStderr', stderrDecision);
}

function redactEmbeddedStderrFromFailureReason(value: string) {
  if (!failureReasonLooksLikeEmbeddedStderr(value)) return value;
  const exitMatch = value.match(/\bbackend-generated task exited\s+(\d+)/i);
  if (exitMatch) {
    return `backend-generated task exited ${exitMatch[1]}; stderr details omitted by repairContextPolicy.`;
  }
  return 'Generated task failed during execution; stderr details omitted by repairContextPolicy.';
}

function failureReasonLooksLikeEmbeddedStderr(value: string) {
  return /BLOCKED_STDERR_SECRET|Traceback \(most recent call last\)|\b(?:RuntimeError|SyntaxError|ValueError|TypeError|Exception|Error):|(?:^|\n)\s*File ".*?", line \d+/i.test(value);
}

function filterSchemaErrorsForRepairPolicy(
  failure: Record<string, unknown>,
  refs: string[],
  policy: BackendRepairContextPolicySummary,
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
  policy: BackendRepairContextPolicySummary,
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
  policy: BackendRepairContextPolicySummary,
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

function repairContextPolicyAudit(policy: BackendRepairContextPolicySummary): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.agentserver.repair-context-policy-audit.v1',
    source: policy.source,
    sourceKind: policy.sourceKind,
    contractRef: policy.contractRef,
    traceRef: policy.traceRef,
    deterministicDecisionRef: policy.deterministicDecisionRef,
    deterministic: true,
    allowedFailureEvidenceRefs: policy.allowedFailureEvidenceRefs,
    blockedFailureEvidenceRefs: policy.blockedFailureEvidenceRefs,
    includeStdoutSummary: policy.includeStdoutSummary,
    includeStderrSummary: policy.includeStderrSummary,
    includeValidationFindings: policy.includeValidationFindings,
    includePriorAttemptRefs: policy.includePriorAttemptRefs,
    ignoredLegacySources: policy.ignoredLegacySources,
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

function contractEmbeddedRepairContextPolicy(value: unknown): {
  sourceKind: BackendRepairContextPolicySummary['sourceKind'];
  value: Record<string, unknown>;
} | undefined {
  if (!isRecord(value)) return undefined;
  const sourceKind = value.sourceKind === 'contract' || value.sourceKind === 'contract-handoff'
    ? value.sourceKind
    : undefined;
  if (!sourceKind || !stringField(value.deterministicDecisionRef)) return undefined;
  if (stringField(value.kind) === 'supplement') return undefined;
  return { sourceKind, value };
}

function defaultRepairContextPolicySummaryForBackend(
  ignoredLegacySources: BackendIgnoredLegacyRepairContextPolicySource[],
): BackendRepairContextPolicySummary {
  const summary: BackendRepairContextPolicySummary = {
    schemaVersion: 'sciforge.agentserver.repair-context-policy-summary.v1',
    source: 'runtime.defaultBackendRepairHandoff',
    sourceKind: 'contract-handoff',
    deterministicDecisionRef: '',
    kind: 'none',
    maxAttempts: 0,
    includeStdoutSummary: true,
    includeStderrSummary: false,
    includeValidationFindings: false,
    includePriorAttemptRefs: false,
    allowedFailureEvidenceRefs: ['stdout'],
    blockedFailureEvidenceRefs: ['stderr', 'validation:findings'],
  };
  summary.deterministicDecisionRef = repairContextPolicyDecisionRef(summary);
  if (ignoredLegacySources.length) summary.ignoredLegacySources = ignoredLegacySources;
  return summary;
}

function repairContextPolicySourceRefs(value: unknown) {
  const record = isRecord(value) ? value : {};
  const summary = isRecord(record.summary) ? record.summary : {};
  const promptRenderPlan = isRecord(record.promptRenderPlan) ? record.promptRenderPlan : {};
  const sourceRefs = isRecord(promptRenderPlan.sourceRefs) ? promptRenderPlan.sourceRefs : {};
  return {
    contractRef: stringField(record.harnessContractRef) ?? stringField(record.contractRef) ?? stringField(summary.contractRef) ?? stringField(sourceRefs.contractRef),
    traceRef: stringField(record.harnessTraceRef) ?? stringField(record.traceRef) ?? stringField(summary.traceRef) ?? stringField(sourceRefs.traceRef),
  };
}

function repairContextPolicyDecisionRef(summary: BackendRepairContextPolicySummary) {
  return hashJson({
    source: summary.source,
    sourceKind: summary.sourceKind,
    contractRef: summary.contractRef,
    traceRef: summary.traceRef,
    kind: summary.kind,
    maxAttempts: summary.maxAttempts,
    includeStdoutSummary: summary.includeStdoutSummary,
    includeStderrSummary: summary.includeStderrSummary,
    includeValidationFindings: summary.includeValidationFindings,
    includePriorAttemptRefs: summary.includePriorAttemptRefs,
    allowedFailureEvidenceRefs: summary.allowedFailureEvidenceRefs,
    blockedFailureEvidenceRefs: summary.blockedFailureEvidenceRefs,
  });
}

function ignoredLegacyRepairContextPolicySources(
  request: GatewayRequest,
  repairContext: Record<string, unknown> | undefined,
): BackendIgnoredLegacyRepairContextPolicySource[] {
  const requestMetadata = isRecord((request as { metadata?: unknown }).metadata)
    ? (request as { metadata?: Record<string, unknown> }).metadata
    : undefined;
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return [
    legacyRepairContextPolicySource('repairContext.repairContextPolicy', repairContext?.repairContextPolicy),
    legacyRepairContextPolicySource('request.metadata.repairContextPolicy', requestMetadata?.repairContextPolicy),
    legacyRepairContextPolicySource('request.uiState.repairContextPolicy', uiState.repairContextPolicy),
    legacyRepairContextPolicySource('request.uiState.contextPolicy.repairContextPolicy', isRecord(uiState.contextPolicy) ? uiState.contextPolicy.repairContextPolicy : undefined),
    legacyRepairContextPolicySource('request.uiState.capabilityPolicy.repairContextPolicy', isRecord(uiState.capabilityPolicy) ? uiState.capabilityPolicy.repairContextPolicy : undefined),
    legacyRepairContextPolicySource('request.uiState.capabilityBrokerPolicy.repairContextPolicy', isRecord(uiState.capabilityBrokerPolicy) ? uiState.capabilityBrokerPolicy.repairContextPolicy : undefined),
  ].filter((entry): entry is BackendIgnoredLegacyRepairContextPolicySource => Boolean(entry));
}

function legacyRepairContextPolicySource(source: string, value: unknown): BackendIgnoredLegacyRepairContextPolicySource | undefined {
  if (!isRecord(value)) return undefined;
  if (value.sourceKind !== undefined || value.deterministicDecisionRef !== undefined) return undefined;
  const fields = legacyRepairContextPolicyFieldNames().filter((key) => value[key] !== undefined);
  if (!fields.length) return undefined;
  const allowedFailureEvidenceRefs = toStringList(value.allowedFailureEvidenceRefs);
  const blockedFailureEvidenceRefs = toStringList(value.blockedFailureEvidenceRefs);
  return {
    source,
    reason: 'contract-only-repair-context-policy',
    fields,
    allowedFailureEvidenceRefCount: allowedFailureEvidenceRefs.length || undefined,
    blockedFailureEvidenceRefCount: blockedFailureEvidenceRefs.length || undefined,
  };
}

function legacyRepairContextPolicyFieldNames() {
  return [
    'allowedFailureEvidenceRefs',
    'blockedFailureEvidenceRefs',
    'maxAttempts',
    'includeStdoutSummary',
    'includeStderrSummary',
    'includeValidationFindings',
    'includePriorAttemptRefs',
  ];
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

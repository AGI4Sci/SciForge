import type { ContractValidationFailure, ContractValidationFailureKind, ContractValidationIssue } from './validation-failure';
import type { ObserveResponse } from './observe';
import type { RuntimeVerificationResult } from './verification-result';
import type { WorkEvidence } from './work-evidence';

export const VALIDATION_REPAIR_AUDIT_CHAIN_CONTRACT_ID = 'sciforge.validation-repair-audit-chain.v1' as const;
export const VALIDATION_REPAIR_AUDIT_CHAIN_SCHEMA_VERSION = 1 as const;

export const VALIDATION_SUBJECT_KINDS = [
  'direct-payload',
  'generated-task-result',
  'repair-rerun-result',
  'observe-result',
  'action-result',
  'verification-gate',
] as const;

export const VALIDATION_DECISION_STATUSES = ['pass', 'failed', 'needs-human', 'skipped'] as const;
export const VALIDATION_FINDING_SEVERITIES = ['info', 'warning', 'error', 'blocking'] as const;
export const REPAIR_DECISION_ACTIONS = ['none', 'repair-rerun', 'supplement', 'fail-closed', 'needs-human'] as const;
export const AUDIT_RECORD_OUTCOMES = ['accepted', 'repair-requested', 'supplement-requested', 'failed-closed', 'needs-human'] as const;
export const VALIDATION_REPAIR_AUDIT_SINK_TARGETS = [
  'appendTaskAttempt',
  'ledger',
  'verification-artifact',
  'observe-invocation',
] as const;
export const VALIDATION_REPAIR_TELEMETRY_SPAN_KINDS = [
  'generation/request',
  'materialize',
  'payload-validation',
  'work-evidence',
  'verification-gate',
  'repair-decision',
  'repair-rerun',
  'ledger-write',
  'observe-invocation',
] as const;

export type ValidationSubjectKind = typeof VALIDATION_SUBJECT_KINDS[number];
export type ValidationDecisionStatus = typeof VALIDATION_DECISION_STATUSES[number];
export type ValidationFindingSeverity = typeof VALIDATION_FINDING_SEVERITIES[number];
export type RepairDecisionAction = typeof REPAIR_DECISION_ACTIONS[number];
export type AuditRecordOutcome = typeof AUDIT_RECORD_OUTCOMES[number];
export type ValidationRepairAuditSinkTarget = typeof VALIDATION_REPAIR_AUDIT_SINK_TARGETS[number];
export type ValidationRepairTelemetrySpanKind = typeof VALIDATION_REPAIR_TELEMETRY_SPAN_KINDS[number];

export type ValidationFindingKind =
  | ContractValidationFailureKind
  | 'runtime-verification'
  | 'observe-trace'
  | 'action-trace'
  | 'guidance-adoption'
  | 'result-metric-consistency'
  | 'unknown';

export type ValidationFindingSource =
  | 'contract-validation-failure'
  | 'runtime-verification-result'
  | 'observe-response'
  | 'action-response'
  | 'work-evidence'
  | 'harness';

export type ValidationResultProjectionStatus =
  | 'ok'
  | 'pass'
  | 'passed'
  | 'success'
  | 'done'
  | 'accepted'
  | 'skipped'
  | 'failed'
  | 'partial'
  | 'needs-approval'
  | 'needs-human'
  | 'rejected'
  | 'error'
  | (string & {});

export interface ValidationSubjectRef {
  kind: ValidationSubjectKind;
  id: string;
  capabilityId?: string;
  contractId?: string;
  schemaPath?: string;
  completedPayloadRef?: string;
  generatedTaskRef?: string;
  observeTraceRef?: string;
  actionTraceRef?: string;
  artifactRefs: string[];
  currentRefs: string[];
}

export interface ValidationFinding {
  id: string;
  source: ValidationFindingSource;
  kind: ValidationFindingKind;
  severity: ValidationFindingSeverity;
  message: string;
  contractId?: string;
  schemaPath?: string;
  capabilityId?: string;
  relatedRefs: string[];
  recoverActions: string[];
  issues: ContractValidationIssue[];
  diagnostics?: Record<string, unknown>;
}

export interface ValidationFindingProjectionInput {
  id?: string;
  source: ValidationFindingSource;
  kind: ValidationFindingKind;
  status?: ValidationResultProjectionStatus;
  failureMode?: string;
  severity?: ValidationFindingSeverity;
  message?: string;
  contractId?: string;
  schemaPath?: string;
  capabilityId?: string;
  traceRef?: string;
  artifactRefs?: string[];
  relatedRefs?: string[];
  recoverActions?: string[];
  issues?: ContractValidationIssue[];
  diagnostics?: Record<string, unknown> | string[];
  confidence?: number;
  isFailure?: boolean;
}

export interface ActionResultValidationProjection {
  id?: string;
  status: ValidationResultProjectionStatus;
  actionId?: string;
  providerId?: string;
  message?: string;
  failureMode?: string;
  traceRef?: string;
  artifactRefs?: string[];
  relatedRefs?: string[];
  recoverActions?: string[];
  issues?: ContractValidationIssue[];
  diagnostics?: Record<string, unknown> | string[];
  confidence?: number;
  contractId?: string;
  schemaPath?: string;
  severity?: ValidationFindingSeverity;
  isFailure?: boolean;
}

export interface RuntimeVerificationGateSnapshot {
  policyId?: string;
  results: RuntimeVerificationResult[];
}

export interface ResultValidationHarnessInput {
  decisionId: string;
  subject: ValidationSubjectRef;
  findings?: ValidationFinding[];
  workEvidence?: WorkEvidence[];
  providedVerificationResults?: RuntimeVerificationResult[];
  runtimeVerificationGate?: RuntimeVerificationGateSnapshot;
  guidanceAdoption?: {
    acceptedGuidanceRefs: string[];
    ignoredGuidanceRefs: string[];
  };
  relatedRefs?: string[];
  createdAt?: string;
}

export interface ValidationDecision {
  contract: typeof VALIDATION_REPAIR_AUDIT_CHAIN_CONTRACT_ID;
  schemaVersion: typeof VALIDATION_REPAIR_AUDIT_CHAIN_SCHEMA_VERSION;
  decisionId: string;
  status: ValidationDecisionStatus;
  subject: ValidationSubjectRef;
  findings: ValidationFinding[];
  workEvidence: WorkEvidence[];
  providedVerificationResults: RuntimeVerificationResult[];
  runtimeVerificationGate?: RuntimeVerificationGateSnapshot;
  guidanceAdoption?: {
    acceptedGuidanceRefs: string[];
    ignoredGuidanceRefs: string[];
  };
  relatedRefs: string[];
  createdAt: string;
}

export interface RepairBudgetSnapshot {
  maxAttempts: number;
  remainingAttempts: number;
  maxSupplementAttempts?: number;
  remainingSupplementAttempts?: number;
}

export interface RepairPolicyHarnessInput {
  decisionId: string;
  validation: ValidationDecision;
  budget: RepairBudgetSnapshot;
  allowSupplement?: boolean;
  allowHumanEscalation?: boolean;
  createdAt?: string;
}

export interface RepairDecision {
  contract: typeof VALIDATION_REPAIR_AUDIT_CHAIN_CONTRACT_ID;
  schemaVersion: typeof VALIDATION_REPAIR_AUDIT_CHAIN_SCHEMA_VERSION;
  decisionId: string;
  validationDecisionId: string;
  action: RepairDecisionAction;
  reason: string;
  repairBudget: RepairBudgetSnapshot;
  relatedRefs: string[];
  recoverActions: string[];
  createdAt: string;
}

export interface AuditSinkInput {
  auditId: string;
  validation: ValidationDecision;
  repair: RepairDecision;
  finalOutcome?: AuditRecordOutcome;
  sinkRefs?: string[];
  telemetrySpanRefs?: string[];
  createdAt?: string;
}

export interface AuditRecord {
  contract: typeof VALIDATION_REPAIR_AUDIT_CHAIN_CONTRACT_ID;
  schemaVersion: typeof VALIDATION_REPAIR_AUDIT_CHAIN_SCHEMA_VERSION;
  auditId: string;
  validationDecisionId: string;
  repairDecisionId: string;
  subject: ValidationSubjectRef;
  outcome: AuditRecordOutcome;
  contractId: string;
  failureKind?: ValidationFindingKind;
  relatedRefs: string[];
  repairBudget: RepairBudgetSnapshot;
  recoverActions: string[];
  sinkRefs: string[];
  telemetrySpanRefs: string[];
  createdAt: string;
}

export interface ValidationRepairAuditSinkRef {
  kind: 'validation-repair-audit-sink';
  target: ValidationRepairAuditSinkTarget;
  ref: string;
  auditId: string;
  validationDecisionId?: string;
  repairDecisionId?: string;
  contractId?: string;
  failureKind?: ValidationFindingKind;
  outcome?: AuditRecordOutcome;
  subject?: ValidationSubjectRef;
  relatedRefs: string[];
  sinkRefs: string[];
  telemetrySpanRefs: string[];
  createdAt?: string;
}

export interface ValidationRepairAuditSinkRecord {
  kind: 'validation-repair-audit-sink-record';
  target: ValidationRepairAuditSinkTarget;
  ref: string;
  auditRecord: AuditRecord;
  validationDecision?: ValidationDecision;
  repairDecision?: RepairDecision;
  relatedRefs: string[];
  createdAt?: string;
}

export interface ValidationRepairTelemetrySpanRef {
  kind: 'validation-repair-telemetry-span';
  spanKind: ValidationRepairTelemetrySpanKind;
  spanId: string;
  ref: string;
  source: 'validation-decision' | 'repair-decision' | 'audit-record' | 'repair-executor-result' | 'validation-repair-audit-chain';
  status?: string;
  validationDecisionId?: string;
  repairDecisionId?: string;
  auditId?: string;
  executorResultId?: string;
  subject?: ValidationSubjectRef;
  contractId?: string;
  failureKind?: ValidationFindingKind;
  outcome?: AuditRecordOutcome;
  action?: string;
  sourceRefs: string[];
  auditRefs: string[];
  repairRefs: string[];
  relatedRefs: string[];
  sinkRefs: string[];
  telemetrySpanRefs: string[];
  createdAt?: string;
}

export function createValidationDecision(input: ResultValidationHarnessInput): ValidationDecision {
  const findings = input.findings ?? [];
  const relatedRefs = uniqueStrings([
    ...(input.relatedRefs ?? []),
    ...input.subject.artifactRefs,
    ...input.subject.currentRefs,
    input.subject.completedPayloadRef,
    input.subject.generatedTaskRef,
    input.subject.observeTraceRef,
    input.subject.actionTraceRef,
    ...findings.flatMap((finding) => finding.relatedRefs),
    ...(input.workEvidence ?? []).flatMap((entry) => entry.evidenceRefs),
    ...(input.providedVerificationResults ?? []).flatMap((entry) => entry.evidenceRefs),
    ...(input.runtimeVerificationGate?.results ?? []).flatMap((entry) => entry.evidenceRefs),
  ]);
  return {
    contract: VALIDATION_REPAIR_AUDIT_CHAIN_CONTRACT_ID,
    schemaVersion: VALIDATION_REPAIR_AUDIT_CHAIN_SCHEMA_VERSION,
    decisionId: input.decisionId,
    status: validationStatusForFindings(findings),
    subject: {
      ...input.subject,
      artifactRefs: uniqueStrings(input.subject.artifactRefs),
      currentRefs: uniqueStrings(input.subject.currentRefs),
    },
    findings,
    workEvidence: input.workEvidence ?? [],
    providedVerificationResults: input.providedVerificationResults ?? [],
    runtimeVerificationGate: input.runtimeVerificationGate,
    guidanceAdoption: input.guidanceAdoption,
    relatedRefs,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function validationFindingsFromContractFailure(
  failure: ContractValidationFailure,
  options: { idPrefix?: string; severity?: ValidationFindingSeverity } = {},
): ValidationFinding[] {
  return [{
    id: `${options.idPrefix ?? 'contract'}:${failure.capabilityId}:${failure.failureKind}`,
    source: 'contract-validation-failure',
    kind: failure.failureKind,
    severity: options.severity ?? 'blocking',
    message: failure.failureReason,
    contractId: failure.contractId,
    schemaPath: failure.schemaPath,
    capabilityId: failure.capabilityId,
    relatedRefs: uniqueStrings(failure.relatedRefs),
    recoverActions: uniqueStrings(failure.recoverActions),
    issues: failure.issues,
    diagnostics: {
      missingFields: failure.missingFields,
      invalidRefs: failure.invalidRefs,
      unresolvedUris: failure.unresolvedUris,
      expected: failure.expected,
      actual: failure.actual,
      nextStep: failure.nextStep,
      auditNotes: failure.auditNotes,
    },
  }];
}

export function validationFindingsFromObserveResponse(
  response: ObserveResponse,
  options: { id: string; capabilityId?: string; relatedRefs?: string[] },
): ValidationFinding[] {
  return projectValidationFindingsFromResult({
    id: options.id,
    source: 'observe-response',
    kind: 'observe-trace',
    status: response.status,
    severity: response.status === 'needs-approval' ? 'warning' : 'blocking',
    message: response.failureMode
      ? `Observe response failed (${response.failureMode}): ${response.textResponse || response.diagnostics.join('; ')}`
      : `Observe response failed: ${response.textResponse || response.diagnostics.join('; ')}`,
    failureMode: response.failureMode,
    contractId: 'sciforge.observe-response.v1',
    schemaPath: 'packages/contracts/runtime/observe.ts#ObserveResponse',
    capabilityId: options.capabilityId ?? response.providerId,
    artifactRefs: response.artifactRefs,
    traceRef: response.traceRef,
    relatedRefs: options.relatedRefs,
    recoverActions: observeRecoverActions(response),
    issues: response.diagnostics.map((diagnostic, index) => ({
      path: `diagnostics[${index}]`,
      message: diagnostic,
    })),
    diagnostics: {
      providerId: response.providerId,
      status: response.status,
      failureMode: response.failureMode,
      confidence: response.confidence,
    },
  });
}

export function validationFindingsFromActionResult(input: ActionResultValidationProjection): ValidationFinding[] {
  return projectValidationFindingsFromResult({
    id: input.id ?? `action:${input.providerId ?? input.actionId ?? 'result'}:${input.failureMode ?? input.status}`,
    source: 'action-response',
    kind: 'action-trace',
    status: input.status,
    failureMode: input.failureMode,
    severity: input.severity,
    message: input.message,
    contractId: input.contractId ?? 'sciforge.action-response.v1',
    schemaPath: input.schemaPath ?? 'packages/contracts/runtime/validation-repair-audit.ts#ActionResultValidationProjection',
    capabilityId: input.providerId ?? input.actionId,
    traceRef: input.traceRef,
    artifactRefs: input.artifactRefs,
    relatedRefs: uniqueStrings([input.actionId, ...(input.relatedRefs ?? [])]),
    recoverActions: input.recoverActions ?? actionRecoverActions(input),
    issues: input.issues,
    diagnostics: {
      ...diagnosticsRecord(input.diagnostics),
      actionId: input.actionId,
      providerId: input.providerId,
      status: input.status,
      failureMode: input.failureMode,
      confidence: input.confidence,
    },
    confidence: input.confidence,
    isFailure: input.isFailure,
  });
}

export function projectValidationFindingsFromResult(
  input: ValidationFindingProjectionInput | ValidationFindingProjectionInput[],
): ValidationFinding[] {
  const inputs = Array.isArray(input) ? input : [input];
  return inputs.flatMap((entry) => {
    if (!isResultProjectionFailure(entry)) return [];
    const status = entry.status ?? 'failed';
    const failureMode = entry.failureMode ? ` (${entry.failureMode})` : '';
    const message = entry.message ?? `Validation result ${entry.kind} failed${failureMode}: status=${status}`;
    const diagnostics = diagnosticsRecord(entry.diagnostics);
    return [{
      id: entry.id ?? `${entry.source}:${entry.kind}:${entry.failureMode ?? status}`,
      source: entry.source,
      kind: entry.kind,
      severity: entry.severity ?? severityForResultStatus(status),
      message,
      contractId: entry.contractId,
      schemaPath: entry.schemaPath,
      capabilityId: entry.capabilityId,
      relatedRefs: uniqueStrings([
        ...(entry.relatedRefs ?? []),
        ...(entry.artifactRefs ?? []),
        entry.traceRef,
      ]),
      recoverActions: uniqueStrings(entry.recoverActions ?? ['repair result contract or fail closed with diagnostics']),
      issues: entry.issues ?? issuesFromDiagnostics(entry.diagnostics),
      diagnostics: {
        ...diagnostics,
        status,
        failureMode: entry.failureMode,
        confidence: entry.confidence,
      },
    }];
  });
}

export function validationFindingsFromRuntimeVerification(
  results: RuntimeVerificationResult[],
  options: { idPrefix?: string; capabilityId?: string; relatedRefs?: string[] } = {},
): ValidationFinding[] {
  return results
    .filter((result) => result.verdict === 'fail' || result.verdict === 'needs-human')
    .map((result, index) => ({
      id: `${options.idPrefix ?? 'verification'}:${result.id ?? index}`,
      source: 'runtime-verification-result',
      kind: 'runtime-verification',
      severity: result.verdict === 'needs-human' ? 'warning' : 'blocking',
      message: result.critique || `Runtime verification verdict=${result.verdict}`,
      contractId: 'sciforge.verification-result.v1',
      schemaPath: 'packages/contracts/runtime/verification-result.ts#RuntimeVerificationResult',
      capabilityId: options.capabilityId,
      relatedRefs: uniqueStrings([...(options.relatedRefs ?? []), ...result.evidenceRefs]),
      recoverActions: uniqueStrings(result.repairHints),
      issues: [{
        path: `verificationResults[${index}].verdict`,
        message: `Runtime verification verdict=${result.verdict}`,
        expected: 'pass',
        actual: result.verdict,
      }],
      diagnostics: {
        confidence: result.confidence,
        reward: result.reward,
        diagnostics: result.diagnostics,
      },
    }));
}

export function decideRepairPolicy(input: RepairPolicyHarnessInput): RepairDecision {
  const action = repairActionForValidation(input.validation, input.budget, input.allowSupplement ?? true, input.allowHumanEscalation ?? true);
  return {
    contract: VALIDATION_REPAIR_AUDIT_CHAIN_CONTRACT_ID,
    schemaVersion: VALIDATION_REPAIR_AUDIT_CHAIN_SCHEMA_VERSION,
    decisionId: input.decisionId,
    validationDecisionId: input.validation.decisionId,
    action,
    reason: repairReasonForAction(action, input.validation),
    repairBudget: input.budget,
    relatedRefs: input.validation.relatedRefs,
    recoverActions: uniqueStrings(input.validation.findings.flatMap((finding) => finding.recoverActions)),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function createAuditRecord(input: AuditSinkInput): AuditRecord {
  const firstFinding = input.validation.findings[0];
  const outcome = input.finalOutcome ?? auditOutcomeForRepair(input.repair);
  return {
    contract: VALIDATION_REPAIR_AUDIT_CHAIN_CONTRACT_ID,
    schemaVersion: VALIDATION_REPAIR_AUDIT_CHAIN_SCHEMA_VERSION,
    auditId: input.auditId,
    validationDecisionId: input.validation.decisionId,
    repairDecisionId: input.repair.decisionId,
    subject: input.validation.subject,
    outcome,
    contractId: firstFinding?.contractId ?? input.validation.subject.contractId ?? 'unknown',
    failureKind: firstFinding?.kind,
    relatedRefs: uniqueStrings([...input.validation.relatedRefs, ...input.repair.relatedRefs]),
    repairBudget: input.repair.repairBudget,
    recoverActions: input.repair.recoverActions,
    sinkRefs: uniqueStrings(input.sinkRefs ?? []),
    telemetrySpanRefs: uniqueStrings(input.telemetrySpanRefs ?? []),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function validationStatusForFindings(findings: ValidationFinding[]): ValidationDecisionStatus {
  if (findings.some((finding) => finding.kind === 'runtime-verification' && finding.severity === 'warning')) return 'needs-human';
  if (findings.some((finding) => finding.severity === 'blocking' || finding.severity === 'error')) return 'failed';
  return 'pass';
}

function repairActionForValidation(
  validation: ValidationDecision,
  budget: RepairBudgetSnapshot,
  allowSupplement: boolean,
  allowHumanEscalation: boolean,
): RepairDecisionAction {
  if (validation.status === 'pass' || validation.status === 'skipped') return 'none';
  if (validation.status === 'needs-human' && allowHumanEscalation) return 'needs-human';
  if (budget.remainingAttempts > 0) return 'repair-rerun';
  if (allowSupplement && (budget.remainingSupplementAttempts ?? 0) > 0) return 'supplement';
  return validation.status === 'needs-human' && allowHumanEscalation ? 'needs-human' : 'fail-closed';
}

function repairReasonForAction(action: RepairDecisionAction, validation: ValidationDecision) {
  const firstFinding = validation.findings[0];
  if (action === 'none') return 'Validation passed; no repair required.';
  if (action === 'repair-rerun') return `Repair rerun required for ${firstFinding?.kind ?? 'validation failure'}.`;
  if (action === 'supplement') return `Supplement required after repair budget exhaustion for ${firstFinding?.kind ?? 'validation failure'}.`;
  if (action === 'needs-human') return `Human decision required for ${firstFinding?.kind ?? 'validation failure'}.`;
  return `Fail closed after validation failure: ${firstFinding?.message ?? 'unknown failure'}`;
}

function auditOutcomeForRepair(repair: RepairDecision): AuditRecordOutcome {
  if (repair.action === 'none') return 'accepted';
  if (repair.action === 'repair-rerun') return 'repair-requested';
  if (repair.action === 'supplement') return 'supplement-requested';
  if (repair.action === 'needs-human') return 'needs-human';
  return 'failed-closed';
}

function observeRecoverActions(response: ObserveResponse) {
  if (response.status === 'needs-approval') return ['request human approval before retrying observe provider'];
  if (response.failureMode === 'provider-unavailable') return ['retry with fallback observe provider', 'record observe invocation failure'];
  if (response.failureMode === 'low-confidence') return ['rerun observe with narrower instruction or additional modality refs'];
  return ['repair observe request or fail closed with diagnostics'];
}

function actionRecoverActions(input: ActionResultValidationProjection) {
  if (input.status === 'needs-approval' || input.status === 'needs-human') return ['request human approval before retrying action provider'];
  if (input.failureMode === 'provider-unavailable') return ['retry with fallback action provider', 'record action invocation failure'];
  if (input.failureMode === 'timeout' || input.status === 'partial') return ['rerun action with bounded idempotency guard and preserve action trace'];
  return ['repair action request or fail closed with diagnostics'];
}

function isResultProjectionFailure(input: ValidationFindingProjectionInput) {
  if (typeof input.isFailure === 'boolean') return input.isFailure;
  return !isPassingResultStatus(input.status ?? 'failed');
}

function isPassingResultStatus(status: ValidationResultProjectionStatus) {
  return ['ok', 'pass', 'passed', 'success', 'done', 'accepted', 'skipped'].includes(status.toLowerCase());
}

function severityForResultStatus(status: ValidationResultProjectionStatus): ValidationFindingSeverity {
  const normalized = status.toLowerCase();
  if (normalized === 'needs-approval' || normalized === 'needs-human') return 'warning';
  if (normalized === 'partial' || normalized === 'error') return 'error';
  return 'blocking';
}

function diagnosticsRecord(value: Record<string, unknown> | string[] | undefined): Record<string, unknown> {
  if (Array.isArray(value)) return { diagnostics: value };
  return value ?? {};
}

function issuesFromDiagnostics(value: Record<string, unknown> | string[] | undefined): ContractValidationIssue[] {
  if (!Array.isArray(value)) return [];
  return value.map((diagnostic, index) => ({
    path: `diagnostics[${index}]`,
    message: diagnostic,
  }));
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

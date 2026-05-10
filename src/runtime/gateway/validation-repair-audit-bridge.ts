import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract/validation-failure';
import {
  normalizeRuntimeVerificationResults,
  VERIFICATION_RESULT_CONTRACT_ID,
  type RuntimeVerificationResult,
} from '@sciforge-ui/runtime-contract/verification-result';
import {
  createAuditRecord,
  createValidationDecision,
  decideRepairPolicy,
  validationFindingsFromContractFailure,
  validationFindingsFromRuntimeVerification,
  type AuditRecord,
  type RepairBudgetSnapshot,
  type RepairDecision,
  type ValidationDecision,
  type ValidationFinding,
  type ValidationSubjectRef,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import type { WorkEvidence } from '@sciforge-ui/runtime-contract/work-evidence';

export interface ValidationRepairAuditBridgeInput {
  chainId: string;
  subject: Pick<ValidationSubjectRef, 'kind' | 'id'> & Partial<Omit<ValidationSubjectRef, 'kind' | 'id'>>;
  contractValidationFailures?: ContractValidationFailure[];
  runtimeVerificationResults?: unknown;
  findings?: ValidationFinding[];
  workEvidence?: WorkEvidence[];
  repairBudget?: Partial<RepairBudgetSnapshot>;
  allowSupplement?: boolean;
  allowHumanEscalation?: boolean;
  sinkRefs?: string[];
  telemetrySpanRefs?: string[];
  runtimeVerificationPolicyId?: string;
  relatedRefs?: string[];
  createdAt?: string;
}

export interface ValidationRepairAuditChain {
  validation: ValidationDecision;
  repair: RepairDecision;
  audit: AuditRecord;
  runtimeVerificationResults: RuntimeVerificationResult[];
}

export const DEFAULT_VALIDATION_REPAIR_AUDIT_BRIDGE_REPAIR_BUDGET: RepairBudgetSnapshot = {
  maxAttempts: 1,
  remainingAttempts: 1,
  maxSupplementAttempts: 0,
  remainingSupplementAttempts: 0,
};

export function createValidationRepairAuditChain(input: ValidationRepairAuditBridgeInput): ValidationRepairAuditChain {
  const runtimeVerificationResults = normalizeRuntimeVerificationResults(input.runtimeVerificationResults);
  const subject = normalizeValidationSubject(input, runtimeVerificationResults);
  const findings = [
    ...(input.contractValidationFailures ?? []).flatMap((failure, index) => validationFindingsFromContractFailure(failure, {
      idPrefix: `${input.chainId}:contract:${index}`,
    })),
    ...validationFindingsFromRuntimeVerification(runtimeVerificationResults, {
      idPrefix: `${input.chainId}:verification`,
      capabilityId: subject.capabilityId,
      relatedRefs: input.relatedRefs,
    }),
    ...(input.findings ?? []),
  ];
  const workEvidence = input.workEvidence ?? bridgeWorkEvidence(input.chainId, findings);
  const validation = createValidationDecision({
    decisionId: `validation:${input.chainId}`,
    subject,
    findings,
    workEvidence,
    providedVerificationResults: runtimeVerificationResults,
    runtimeVerificationGate: runtimeVerificationResults.length > 0
      ? { policyId: input.runtimeVerificationPolicyId, results: runtimeVerificationResults }
      : undefined,
    relatedRefs: input.relatedRefs,
    createdAt: input.createdAt,
  });
  const repair = decideRepairPolicy({
    decisionId: `repair:${input.chainId}`,
    validation,
    budget: normalizeRepairBudget(input.repairBudget),
    allowSupplement: input.allowSupplement,
    allowHumanEscalation: input.allowHumanEscalation,
    createdAt: input.createdAt,
  });
  const audit = createAuditRecord({
    auditId: `audit:${input.chainId}`,
    validation,
    repair,
    sinkRefs: input.sinkRefs,
    telemetrySpanRefs: input.telemetrySpanRefs,
    createdAt: input.createdAt,
  });
  return { validation, repair, audit, runtimeVerificationResults };
}

function normalizeValidationSubject(
  input: ValidationRepairAuditBridgeInput,
  runtimeVerificationResults: RuntimeVerificationResult[],
): ValidationSubjectRef {
  const firstFailure = input.contractValidationFailures?.[0];
  return {
    kind: input.subject.kind,
    id: input.subject.id,
    capabilityId: input.subject.capabilityId ?? firstFailure?.capabilityId,
    contractId: input.subject.contractId ?? firstFailure?.contractId ?? (
      runtimeVerificationResults.length > 0 ? VERIFICATION_RESULT_CONTRACT_ID : undefined
    ),
    schemaPath: input.subject.schemaPath ?? firstFailure?.schemaPath,
    completedPayloadRef: input.subject.completedPayloadRef,
    generatedTaskRef: input.subject.generatedTaskRef,
    observeTraceRef: input.subject.observeTraceRef,
    actionTraceRef: input.subject.actionTraceRef,
    artifactRefs: uniqueStrings(input.subject.artifactRefs ?? []),
    currentRefs: uniqueStrings(input.subject.currentRefs ?? []),
  };
}

function normalizeRepairBudget(input: Partial<RepairBudgetSnapshot> | undefined): RepairBudgetSnapshot {
  return {
    maxAttempts: input?.maxAttempts ?? DEFAULT_VALIDATION_REPAIR_AUDIT_BRIDGE_REPAIR_BUDGET.maxAttempts,
    remainingAttempts: input?.remainingAttempts ?? DEFAULT_VALIDATION_REPAIR_AUDIT_BRIDGE_REPAIR_BUDGET.remainingAttempts,
    maxSupplementAttempts: input?.maxSupplementAttempts ?? DEFAULT_VALIDATION_REPAIR_AUDIT_BRIDGE_REPAIR_BUDGET.maxSupplementAttempts,
    remainingSupplementAttempts: input?.remainingSupplementAttempts ?? DEFAULT_VALIDATION_REPAIR_AUDIT_BRIDGE_REPAIR_BUDGET.remainingSupplementAttempts,
  };
}

function bridgeWorkEvidence(chainId: string, findings: ValidationFinding[]): WorkEvidence[] {
  if (!findings.length) return [];
  return [{
    kind: 'validate',
    status: 'repair-needed',
    provider: 'validation-repair-audit-bridge',
    outputSummary: `Validation bridge recorded ${findings.length} finding(s).`,
    evidenceRefs: uniqueStrings(findings.flatMap((finding) => finding.relatedRefs)),
    failureReason: findings[0]?.message,
    recoverActions: uniqueStrings(findings.flatMap((finding) => finding.recoverActions)),
    rawRef: `validation-repair-audit:${chainId}`,
  }];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

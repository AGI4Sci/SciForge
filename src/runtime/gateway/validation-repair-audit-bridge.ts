import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract/validation-failure';
import type { ObserveResponse } from '@sciforge-ui/runtime-contract/observe';
import {
  normalizeRuntimeVerificationResults,
  VERIFICATION_RESULT_CONTRACT_ID,
  type RuntimeVerificationResult,
} from '@sciforge-ui/runtime-contract/verification-result';
import {
  createAuditRecord,
  createValidationDecision,
  decideRepairPolicy,
  projectValidationFindingsFromResult,
  validationFindingsFromActionResult,
  validationFindingsFromContractFailure,
  validationFindingsFromObserveResponse,
  validationFindingsFromRuntimeVerification,
  type ActionResultValidationProjection,
  type AuditRecord,
  type RepairBudgetSnapshot,
  type RepairDecision,
  type ValidationDecision,
  type ValidationFinding,
  type ValidationFindingProjectionInput,
  type ValidationSubjectRef,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import type { WorkEvidence } from '@sciforge-ui/runtime-contract/work-evidence';
import { isRecord } from '../gateway-utils.js';

export interface ValidationRepairAuditBridgeInput {
  chainId: string;
  subject: Pick<ValidationSubjectRef, 'kind' | 'id'> & Partial<Omit<ValidationSubjectRef, 'kind' | 'id'>>;
  contractValidationFailures?: ContractValidationFailure[];
  runtimeVerificationResults?: unknown;
  observeResponse?: ObserveResponse;
  actionResult?: ActionResultValidationProjection;
  findingProjections?: ValidationFindingProjectionInput[];
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

export interface ValidationRepairAuditPayloadRef {
  validationDecision: ValidationDecision;
  repairDecision: RepairDecision;
  auditRecord: AuditRecord;
}

export interface ValidationRepairAuditAttemptRef {
  kind: 'validation-repair-audit';
  ref: string;
  auditId: string;
  validationDecisionId?: string;
  repairDecisionId?: string;
  contractId?: string;
  failureKind?: string;
  outcome?: string;
  subject?: ValidationSubjectRef;
  relatedRefs: string[];
  sinkRefs: string[];
  telemetrySpanRefs: string[];
  createdAt?: string;
}

export interface ValidationRepairAuditAttemptMetadata {
  auditRefs: ValidationRepairAuditAttemptRef[];
  auditRecords: AuditRecord[];
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
    ...validationFindingsFromObserveBridgeInput(input, subject),
    ...validationFindingsFromActionBridgeInput(input),
    ...projectValidationFindingsFromResult(input.findingProjections ?? []),
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

export function validationRepairAuditPayloadRefFromChain(chain: ValidationRepairAuditChain): ValidationRepairAuditPayloadRef {
  return {
    validationDecision: chain.validation,
    repairDecision: chain.repair,
    auditRecord: chain.audit,
  };
}

export function attachValidationRepairAuditChainToPayload<T>(payload: T, chain: ValidationRepairAuditChain): T {
  if (!isRecord(payload)) return payload;
  const chainRef = validationRepairAuditPayloadRefFromChain(chain);
  const refs = isRecord(payload.refs) ? payload.refs : {};
  return {
    ...payload,
    refs: attachValidationRepairAuditChainToRefs(refs, chainRef),
    executionUnits: Array.isArray(payload.executionUnits)
      ? payload.executionUnits.map((unit) => isRecord(unit)
        ? {
            ...unit,
            refs: attachValidationRepairAuditChainToRefs(isRecord(unit.refs) ? unit.refs : {}, chainRef),
          }
        : unit)
      : payload.executionUnits,
  } as T;
}

export function validationRepairAuditAttemptMetadataFromPayload(value: unknown): ValidationRepairAuditAttemptMetadata | undefined {
  const chains = validationRepairAuditChainsFromPayload(value);
  if (!chains.length) return undefined;
  const auditRecords = uniqueAuditRecords(chains.map((chain) => chain.auditRecord).filter(isAuditRecord));
  const auditRefs = uniqueAuditRefs(chains
    .map((chain) => auditRefFromChain(chain))
    .filter((ref): ref is ValidationRepairAuditAttemptRef => Boolean(ref)));
  return auditRefs.length || auditRecords.length ? { auditRefs, auditRecords } : undefined;
}

export function mergeValidationRepairAuditAttemptMetadata(
  current: Partial<ValidationRepairAuditAttemptMetadata> | undefined,
  next: ValidationRepairAuditAttemptMetadata | undefined,
): ValidationRepairAuditAttemptMetadata | undefined {
  const auditRefs = uniqueAuditRefs([
    ...(current?.auditRefs ?? []),
    ...(next?.auditRefs ?? []),
  ]);
  const auditRecords = uniqueAuditRecords([
    ...(current?.auditRecords ?? []),
    ...(next?.auditRecords ?? []),
  ]);
  return auditRefs.length || auditRecords.length ? { auditRefs, auditRecords } : undefined;
}

function attachValidationRepairAuditChainToRefs(
  refs: Record<string, unknown>,
  chainRef: ValidationRepairAuditPayloadRef,
): Record<string, unknown> {
  if (isRecord(refs.validationRepairAudit)) return refs;
  return {
    ...refs,
    validationRepairAudit: chainRef,
  };
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

function validationFindingsFromObserveBridgeInput(
  input: ValidationRepairAuditBridgeInput,
  subject: ValidationSubjectRef,
): ValidationFinding[] {
  if (!input.observeResponse) return [];
  return validationFindingsFromObserveResponse(input.observeResponse, {
    id: `${input.chainId}:observe:${input.observeResponse.providerId ?? subject.capabilityId ?? 'provider'}:${input.observeResponse.failureMode ?? input.observeResponse.status}`,
    capabilityId: subject.capabilityId ?? input.observeResponse.providerId,
    relatedRefs: input.relatedRefs,
  });
}

function validationFindingsFromActionBridgeInput(input: ValidationRepairAuditBridgeInput): ValidationFinding[] {
  if (!input.actionResult) return [];
  return validationFindingsFromActionResult({
    ...input.actionResult,
    id: input.actionResult.id ?? `${input.chainId}:action:${input.actionResult.providerId ?? input.actionResult.actionId ?? 'provider'}:${input.actionResult.failureMode ?? input.actionResult.status}`,
    relatedRefs: uniqueStrings([...(input.relatedRefs ?? []), ...(input.actionResult.relatedRefs ?? [])]),
  });
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function validationRepairAuditChainsFromPayload(value: unknown) {
  const chains: Array<{
    validationDecision?: ValidationDecision;
    repairDecision?: RepairDecision;
    auditRecord?: AuditRecord;
  }> = [];
  const pushChain = (chain: unknown) => {
    if (Array.isArray(chain)) {
      for (const entry of chain) pushChain(entry);
      return;
    }
    if (isRecord(chain)) chains.push(chain as typeof chains[number]);
  };
  const visit = (candidate: unknown) => {
    if (!isRecord(candidate)) return;
    const refs = isRecord(candidate.refs) ? candidate.refs : {};
    pushChain(candidate.validationRepairAudit);
    pushChain(refs.validationRepairAudit);
  };
  visit(value);
  const executionUnits = isRecord(value) && Array.isArray(value.executionUnits) ? value.executionUnits : [];
  for (const unit of executionUnits) visit(unit);
  return chains;
}

function auditRefFromChain(chain: {
  validationDecision?: ValidationDecision;
  repairDecision?: RepairDecision;
  auditRecord?: AuditRecord;
}): ValidationRepairAuditAttemptRef | undefined {
  const audit = chain.auditRecord;
  if (!isAuditRecord(audit)) return undefined;
  return {
    kind: 'validation-repair-audit',
    ref: audit.auditId,
    auditId: audit.auditId,
    validationDecisionId: audit.validationDecisionId ?? chain.validationDecision?.decisionId,
    repairDecisionId: audit.repairDecisionId ?? chain.repairDecision?.decisionId,
    contractId: audit.contractId,
    failureKind: audit.failureKind,
    outcome: audit.outcome,
    subject: chain.validationDecision?.subject,
    relatedRefs: uniqueStrings(audit.relatedRefs ?? []),
    sinkRefs: uniqueStrings(audit.sinkRefs ?? []),
    telemetrySpanRefs: uniqueStrings(audit.telemetrySpanRefs ?? []),
    createdAt: audit.createdAt,
  };
}

function isAuditRecord(value: unknown): value is AuditRecord {
  return isRecord(value) && typeof value.auditId === 'string' && value.auditId.trim().length > 0;
}

function uniqueAuditRefs(refs: ValidationRepairAuditAttemptRef[]) {
  const byId = new Map<string, ValidationRepairAuditAttemptRef>();
  for (const ref of refs) {
    const id = ref.auditId || ref.ref;
    if (!id || byId.has(id)) continue;
    byId.set(id, ref);
  }
  return [...byId.values()];
}

function uniqueAuditRecords(records: AuditRecord[]) {
  const byId = new Map<string, AuditRecord>();
  for (const record of records) {
    if (!record.auditId || byId.has(record.auditId)) continue;
    byId.set(record.auditId, record);
  }
  return [...byId.values()];
}

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
  agentHarnessRepairPolicy?: AgentHarnessRepairPolicyBridgeInput;
  relatedRefs?: string[];
  createdAt?: string;
}

export interface ValidationRepairAuditChain {
  validation: ValidationDecision;
  repair: RepairDecision;
  audit: AuditRecord;
  runtimeVerificationResults: RuntimeVerificationResult[];
}

export interface AgentHarnessRepairPolicyBridgeInput {
  enabled?: boolean;
  consume?: boolean;
  contract?: unknown;
  contractRef?: string;
  traceRef?: string;
  profileId?: string;
  source?: string;
}

interface AgentHarnessRepairPolicyProjection {
  source: string;
  contractRef?: string;
  traceRef?: string;
  profileId?: string;
  repairKind?: string;
  maxAttempts?: number;
  verificationIntensity?: string;
  requireCitations?: boolean;
  requireCurrentRefs?: boolean;
  requireArtifactRefs?: boolean;
  consume: boolean;
  auditRefs: string[];
  sinkRefs: string[];
  forceFailClosed: boolean;
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
  const harnessProjection = projectAgentHarnessRepairPolicy(input.agentHarnessRepairPolicy);
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
  const relatedRefs = uniqueStrings([
    ...(input.relatedRefs ?? []),
    ...(harnessProjection?.auditRefs ?? []),
  ]);
  const validation = createValidationDecision({
    decisionId: `validation:${input.chainId}`,
    subject,
    findings,
    workEvidence,
    providedVerificationResults: runtimeVerificationResults,
    runtimeVerificationGate: runtimeVerificationResults.length > 0
      ? { policyId: input.runtimeVerificationPolicyId, results: runtimeVerificationResults }
      : undefined,
    relatedRefs,
    createdAt: input.createdAt,
  });
  const repairBudget = repairBudgetWithAgentHarnessPolicy(normalizeRepairBudget(input.repairBudget), harnessProjection);
  const baseRepair = decideRepairPolicy({
    decisionId: `repair:${input.chainId}`,
    validation,
    budget: repairBudget,
    allowSupplement: input.allowSupplement,
    allowHumanEscalation: input.allowHumanEscalation,
    createdAt: input.createdAt,
  });
  const repair = repairDecisionWithAgentHarnessPolicy(baseRepair, validation, harnessProjection);
  const audit = createAuditRecord({
    auditId: `audit:${input.chainId}`,
    validation,
    repair,
    sinkRefs: uniqueStrings([
      ...(input.sinkRefs ?? []),
      ...(harnessProjection?.sinkRefs ?? []),
    ]),
    telemetrySpanRefs: input.telemetrySpanRefs,
    createdAt: input.createdAt,
  });
  return { validation, repair, audit, runtimeVerificationResults };
}

export function agentHarnessRepairPolicyBridgeFromRuntimeState(value: unknown): AgentHarnessRepairPolicyBridgeInput | undefined {
  if (!isRecord(value)) return undefined;
  const agentHarness = isRecord(value.agentHarness)
    ? value.agentHarness
    : isRecord(value.harness)
      ? value.harness
      : {};
  const handoff = isRecord(value.agentHarnessHandoff)
    ? value.agentHarnessHandoff
    : isRecord(agentHarness.agentHarnessHandoff)
      ? agentHarness.agentHarnessHandoff
      : {};
  const disabled = [
    value.agentHarnessRepairPolicyDisabled,
    value.agentHarnessRepairPolicyAuditDisabled,
    value.agentHarnessRepairPolicySkip,
    value.agentHarnessSkipRepairPolicy,
    value.agentHarnessRepairPolicyDisable,
    value.agentHarnessDisableRepairPolicy,
    agentHarness.repairPolicyDisabled,
    agentHarness.repairPolicyAuditDisabled,
    agentHarness.repairPolicySkip,
    agentHarness.skipRepairPolicy,
    agentHarness.repairPolicyDisable,
    agentHarness.disableRepairPolicy,
  ].some(isEnabledFlag) || [
    value.agentHarnessRepairPolicy,
    value.agentHarnessRepairPolicyAudit,
    value.agentHarnessRepairPolicyAuditEnabled,
    value.agentHarnessRepairPolicyEnabled,
    agentHarness.repairPolicy,
    agentHarness.repairPolicyAudit,
    agentHarness.repairPolicyAuditEnabled,
    agentHarness.repairPolicyEnabled,
  ].some(isDisabledFlag);
  if (disabled) return undefined;
  const consume = [
    value.agentHarnessRepairPolicy,
    value.agentHarnessRepairPolicyEnabled,
    value.agentHarnessConsumeRepairPolicy,
    value.agentHarnessValidationRepairPolicyEnabled,
    agentHarness.repairPolicy,
    agentHarness.repairPolicyEnabled,
    agentHarness.consumeRepairPolicy,
    agentHarness.validationRepairPolicyEnabled,
  ].some(isEnabledFlag);
  const contract = canonicalAgentHarnessRepairPolicyContract(agentHarness, handoff);
  if (!contract) return undefined;
  const summary = isRecord(agentHarness.summary) ? agentHarness.summary : {};
  const handoffSummary = isRecord(handoff.summary) ? handoff.summary : {};
  return {
    enabled: true,
    consume,
    contract,
    contractRef: stringField(agentHarness.contractRef)
      ?? stringField(summary.contractRef)
      ?? stringField(handoff.harnessContractRef)
      ?? stringField(handoff.contractRef)
      ?? stringField(handoffSummary.contractRef),
    traceRef: stringField(agentHarness.traceRef)
      ?? stringField(summary.traceRef)
      ?? stringField(handoff.harnessTraceRef)
      ?? stringField(handoff.traceRef)
      ?? stringField(handoffSummary.traceRef),
    profileId: stringField(agentHarness.profileId)
      ?? stringField(value.harnessProfileId)
      ?? stringField(handoff.harnessProfileId)
      ?? stringField(handoffSummary.profileId),
    source: isCanonicalAgentHarnessContract(agentHarness.contract)
      ? 'request.uiState.agentHarness.contract'
      : 'request.uiState.agentHarnessHandoff',
  };
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

function projectAgentHarnessRepairPolicy(
  input: AgentHarnessRepairPolicyBridgeInput | undefined,
): AgentHarnessRepairPolicyProjection | undefined {
  if (!input?.enabled || !isRecord(input.contract)) return undefined;
  const repairPolicy = isRecord(input.contract.repairContextPolicy) ? input.contract.repairContextPolicy : {};
  const verificationPolicy = isRecord(input.contract.verificationPolicy) ? input.contract.verificationPolicy : {};
  const repairKind = stringField(repairPolicy.kind);
  const maxAttempts = integerField(repairPolicy.maxAttempts);
  const verificationIntensity = stringField(verificationPolicy.intensity);
  const requireCitations = booleanField(verificationPolicy.requireCitations);
  const requireCurrentRefs = booleanField(verificationPolicy.requireCurrentRefs);
  const requireArtifactRefs = booleanField(verificationPolicy.requireArtifactRefs);
  const auditRefs = uniqueStrings([
    input.contractRef ? `agent-harness-contract:${input.contractRef}` : undefined,
    input.traceRef ? `agent-harness-trace:${input.traceRef}` : undefined,
    input.profileId ? `agent-harness-profile:${input.profileId}` : undefined,
    repairKind ? `agent-policy-repair-kind:${repairKind}` : undefined,
    typeof maxAttempts === 'number' ? `agent-policy-repair-max-attempts:${maxAttempts}` : undefined,
    verificationIntensity ? `agent-policy-verification-intensity:${verificationIntensity}` : undefined,
    requireCitations === true ? 'agent-policy-verification-require-citations:true' : undefined,
    requireCurrentRefs === true ? 'agent-policy-verification-require-current-refs:true' : undefined,
    requireArtifactRefs === true ? 'agent-policy-verification-require-artifact-refs:true' : undefined,
  ]);
  const sinkRefs = uniqueStrings([
    input.contractRef ? `agent-policy-repair:${input.contractRef}` : undefined,
    verificationIntensity ? `agent-policy-verification:${verificationIntensity}` : undefined,
  ]);
  if (!auditRefs.length && !sinkRefs.length) return undefined;
  return {
    source: input.source ?? 'agent-harness.contract',
    contractRef: input.contractRef,
    traceRef: input.traceRef,
    profileId: input.profileId,
    repairKind,
    maxAttempts,
    verificationIntensity,
    requireCitations,
    requireCurrentRefs,
    requireArtifactRefs,
    consume: input.consume ?? true,
    auditRefs,
    sinkRefs,
    forceFailClosed: repairKind === 'none' || repairKind === 'fail-closed',
  };
}

function repairBudgetWithAgentHarnessPolicy(
  budget: RepairBudgetSnapshot,
  projection: AgentHarnessRepairPolicyProjection | undefined,
): RepairBudgetSnapshot {
  if (!projection?.consume) return budget;
  const maxAttempts = projection?.maxAttempts;
  if (typeof maxAttempts !== 'number') return budget;
  const tightenedMaxAttempts = Math.min(budget.maxAttempts, maxAttempts);
  return {
    ...budget,
    maxAttempts: tightenedMaxAttempts,
    remainingAttempts: Math.min(budget.remainingAttempts, tightenedMaxAttempts),
  };
}

function repairDecisionWithAgentHarnessPolicy(
  repair: RepairDecision,
  validation: ValidationDecision,
  projection: AgentHarnessRepairPolicyProjection | undefined,
): RepairDecision {
  if (!projection) return repair;
  const relatedRefs = uniqueStrings([...repair.relatedRefs, ...projection.auditRefs]);
  if (!projection.consume) {
    return {
      ...repair,
      relatedRefs,
    };
  }
  const recoverActions = uniqueStrings([
    ...repair.recoverActions,
    projection.source ? `respect ${projection.source} before retrying repair` : undefined,
  ]);
  if (!projection.forceFailClosed || validation.status === 'pass' || repair.action === 'none') {
    return { ...repair, relatedRefs, recoverActions };
  }
  return {
    ...repair,
    action: 'fail-closed',
    reason: `${repair.reason} Source contract kind=${projection.repairKind} disallows automatic retry.`,
    relatedRefs,
    recoverActions,
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

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanField(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function integerField(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function canonicalAgentHarnessRepairPolicyContract(
  agentHarness: Record<string, unknown>,
  handoff: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (isCanonicalAgentHarnessContract(agentHarness.contract)) return agentHarness.contract;
  if (isCanonicalAgentHarnessHandoff(handoff) && isRecord(handoff.repairContextPolicy)) {
    return {
      schemaVersion: 'sciforge.agent-harness-contract.v1',
      profileId: stringField(handoff.harnessProfileId),
      contractRef: stringField(handoff.harnessContractRef) ?? stringField(handoff.contractRef),
      traceRef: stringField(handoff.harnessTraceRef) ?? stringField(handoff.traceRef),
      repairContextPolicy: handoff.repairContextPolicy,
    };
  }
  return undefined;
}

function isCanonicalAgentHarnessContract(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && value.schemaVersion === 'sciforge.agent-harness-contract.v1'
    && isRecord(value.repairContextPolicy);
}

function isCanonicalAgentHarnessHandoff(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && value.schemaVersion === 'sciforge.agent-harness-handoff.v1'
    && isRecord(value.repairContextPolicy);
}

function isEnabledFlag(value: unknown) {
  return value === true || ['1', 'true', 'on', 'enabled'].includes(String(value).trim().toLowerCase());
}

function isDisabledFlag(value: unknown) {
  return value === false || ['0', 'false', 'off', 'disabled'].includes(String(value).trim().toLowerCase());
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
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

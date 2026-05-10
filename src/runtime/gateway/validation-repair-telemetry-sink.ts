import { createHash } from 'node:crypto';

import {
  VALIDATION_REPAIR_TELEMETRY_SPAN_KINDS,
  type AuditRecord,
  type RepairDecision,
  type ValidationDecision,
  type ValidationRepairTelemetrySpanKind,
  type ValidationRepairTelemetrySpanRef,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import { isRecord } from '../gateway-utils.js';
import type { RepairExecutorResult } from './repair-executor.js';
import type { ValidationRepairAuditChain } from './validation-repair-audit-bridge.js';

export type ValidationRepairTelemetrySource =
  | ValidationDecision
  | RepairDecision
  | AuditRecord
  | RepairExecutorResult
  | ValidationRepairAuditChain
  | ValidationRepairTelemetryChain;

export interface ValidationRepairTelemetryChain {
  validationDecision?: ValidationDecision;
  repairDecision?: RepairDecision;
  auditRecord?: AuditRecord;
  executorResult?: RepairExecutorResult;
}

export interface ValidationRepairTelemetryProjectionOptions {
  spanKinds?: ValidationRepairTelemetrySpanKind[];
}

export interface ValidationRepairTelemetryProjection {
  spans: ValidationRepairTelemetrySpanRef[];
  spanRefs: string[];
  sourceRefs: string[];
  auditRefs: string[];
  repairRefs: string[];
}

interface NormalizedTelemetryChain {
  source: ValidationRepairTelemetrySpanRef['source'];
  validation?: ValidationDecision;
  repair?: RepairDecision;
  audit?: AuditRecord;
  executor?: RepairExecutorResult;
}

export function projectValidationRepairTelemetrySpans(
  source: ValidationRepairTelemetrySource | ValidationRepairTelemetrySource[],
  options: ValidationRepairTelemetryProjectionOptions = {},
): ValidationRepairTelemetryProjection {
  return telemetryProjectionFromChains(telemetryChainsFromSource(source), options);
}

export function validationRepairTelemetrySpansFromPayload(
  value: unknown,
  options: ValidationRepairTelemetryProjectionOptions = {},
): ValidationRepairTelemetryProjection | undefined {
  const projection = telemetryProjectionFromChains(telemetryChainsFromPayload(value), options);
  return projection.spans.length ? projection : undefined;
}

function telemetryProjectionFromChains(
  chains: NormalizedTelemetryChain[],
  options: ValidationRepairTelemetryProjectionOptions,
): ValidationRepairTelemetryProjection {
  const allowedKinds = new Set(options.spanKinds ?? [...VALIDATION_REPAIR_TELEMETRY_SPAN_KINDS]);
  const spans = uniqueSpans(chains.flatMap((chain) => spansForChain(chain)).filter((span) => allowedKinds.has(span.spanKind)));
  return {
    spans,
    spanRefs: uniqueStrings(spans.map((span) => span.ref)),
    sourceRefs: uniqueStrings(spans.flatMap((span) => span.sourceRefs)),
    auditRefs: uniqueStrings(spans.flatMap((span) => span.auditRefs)),
    repairRefs: uniqueStrings(spans.flatMap((span) => span.repairRefs)),
  };
}

function spansForChain(chain: NormalizedTelemetryChain): ValidationRepairTelemetrySpanRef[] {
  const spans: ValidationRepairTelemetrySpanRef[] = [];
  const validation = chain.validation;
  const repair = chain.repair;
  const audit = chain.audit;
  const executor = chain.executor;
  const subject = validation?.subject ?? audit?.subject;
  const auditRefs = uniqueStrings([
    audit?.auditId,
    ...(audit?.sinkRefs ?? []),
    ...(audit?.telemetrySpanRefs ?? []),
  ]);
  const repairRefs = uniqueStrings([
    repair?.decisionId,
    executor?.repairDecisionId,
    executor?.executorRef.ref,
    ...(executor?.auditTrail ?? []).filter((entry) => entry.kind === 'strategy-decision').map((entry) => entry.ref),
  ]);
  const relatedRefs = uniqueStrings([
    ...(validation?.relatedRefs ?? []),
    ...(repair?.relatedRefs ?? []),
    ...(audit?.relatedRefs ?? []),
    ...(executor?.relatedRefs ?? []),
    ...(executor?.executedRefs ?? []),
    subject?.completedPayloadRef,
    subject?.generatedTaskRef,
    subject?.observeTraceRef,
    subject?.actionTraceRef,
    ...(subject?.artifactRefs ?? []),
    ...(subject?.currentRefs ?? []),
  ]);

  if (subject?.generatedTaskRef || subject?.completedPayloadRef || validation) {
    spans.push(spanForChain(chain, 'generation/request', {
      status: validation?.status,
      sourceRefs: uniqueStrings([subject?.generatedTaskRef, subject?.completedPayloadRef, ...(subject?.currentRefs ?? [])]),
      auditRefs,
      repairRefs,
      relatedRefs,
    }));
  }
  if ((subject?.artifactRefs ?? []).length > 0 || relatedRefs.some((ref) => ref.startsWith('artifact:'))) {
    spans.push(spanForChain(chain, 'materialize', {
      status: 'recorded',
      sourceRefs: uniqueStrings([...(subject?.artifactRefs ?? []), subject?.completedPayloadRef]),
      auditRefs,
      repairRefs,
      relatedRefs,
    }));
  }
  if (validation) {
    spans.push(spanForChain(chain, 'payload-validation', {
      status: validation.status,
      sourceRefs: uniqueStrings([validation.decisionId, subject?.completedPayloadRef, ...validation.findings.flatMap((finding) => finding.relatedRefs)]),
      auditRefs,
      repairRefs,
      relatedRefs,
    }));
  }
  if ((validation?.workEvidence ?? []).length > 0) {
    spans.push(spanForChain(chain, 'work-evidence', {
      status: 'recorded',
      sourceRefs: uniqueStrings(validation?.workEvidence.flatMap((entry) => [entry.rawRef, ...entry.evidenceRefs]) ?? []),
      auditRefs,
      repairRefs,
      relatedRefs,
    }));
  }
  if (validation?.runtimeVerificationGate || (validation?.providedVerificationResults ?? []).length > 0 || subject?.kind === 'verification-gate') {
    spans.push(spanForChain(chain, 'verification-gate', {
      status: verificationGateStatus(validation),
      sourceRefs: uniqueStrings([
        validation?.runtimeVerificationGate?.policyId,
        ...(validation?.runtimeVerificationGate?.results ?? validation?.providedVerificationResults ?? []).flatMap((result) => [
          result.id,
          ...result.evidenceRefs,
        ]),
      ]),
      auditRefs,
      repairRefs,
      relatedRefs,
    }));
  }
  if (repair) {
    spans.push(spanForChain(chain, 'repair-decision', {
      status: repair.action,
      sourceRefs: uniqueStrings([repair.decisionId, repair.validationDecisionId, ...repair.recoverActions, ...repair.relatedRefs]),
      auditRefs,
      repairRefs,
      relatedRefs,
    }));
  }
  if (repair?.action === 'repair-rerun' || executor?.strategyAction === 'repair-rerun' || executor?.action === 'rerun') {
    spans.push(spanForChain(chain, 'repair-rerun', {
      status: executor?.status ?? repair?.action,
      sourceRefs: uniqueStrings([
        repair?.decisionId,
        executor?.executorRef.ref,
        executor?.plan.outputRef,
        ...(executor?.executedRefs ?? []),
      ]),
      auditRefs,
      repairRefs,
      relatedRefs,
    }));
  }
  if (audit && (audit.sinkRefs.some((ref) => ref === 'ledger' || ref.startsWith('ledger:')) || audit.outcome)) {
    spans.push(spanForChain(chain, 'ledger-write', {
      status: audit.outcome,
      sourceRefs: uniqueStrings([audit.auditId, ...audit.sinkRefs.filter((ref) => ref === 'ledger' || ref.startsWith('ledger:'))]),
      auditRefs,
      repairRefs,
      relatedRefs,
    }));
  }
  if (subject?.observeTraceRef || audit?.sinkRefs.some((ref) => ref === 'observe-invocation' || ref.startsWith('observe-invocation:'))) {
    spans.push(spanForChain(chain, 'observe-invocation', {
      status: 'recorded',
      sourceRefs: uniqueStrings([
        subject?.observeTraceRef,
        ...(audit?.sinkRefs.filter((ref) => ref === 'observe-invocation' || ref.startsWith('observe-invocation:')) ?? []),
      ]),
      auditRefs,
      repairRefs,
      relatedRefs,
    }));
  }
  return spans;
}

function spanForChain(
  chain: NormalizedTelemetryChain,
  spanKind: ValidationRepairTelemetrySpanKind,
  refs: {
    status?: string;
    sourceRefs: string[];
    auditRefs: string[];
    repairRefs: string[];
    relatedRefs: string[];
  },
): ValidationRepairTelemetrySpanRef {
  const validation = chain.validation;
  const repair = chain.repair;
  const audit = chain.audit;
  const executor = chain.executor;
  const subject = validation?.subject ?? audit?.subject;
  const spanId = stableSpanId(spanKind, {
    validationDecisionId: validation?.decisionId ?? audit?.validationDecisionId ?? executor?.validationDecisionId,
    repairDecisionId: repair?.decisionId ?? audit?.repairDecisionId ?? executor?.repairDecisionId,
    auditId: audit?.auditId ?? executor?.auditId,
    executorResultId: executor?.executorResultId,
    sourceRefs: refs.sourceRefs,
  });
  return {
    kind: 'validation-repair-telemetry-span',
    spanKind,
    spanId,
    ref: existingSpanRef(spanKind, audit?.telemetrySpanRefs ?? []) ?? `validation-repair-telemetry:${spanId}`,
    source: chain.source,
    status: refs.status,
    validationDecisionId: validation?.decisionId ?? audit?.validationDecisionId ?? executor?.validationDecisionId,
    repairDecisionId: repair?.decisionId ?? audit?.repairDecisionId ?? executor?.repairDecisionId,
    auditId: audit?.auditId ?? executor?.auditId,
    executorResultId: executor?.executorResultId,
    subject,
    contractId: audit?.contractId ?? subject?.contractId ?? validation?.findings[0]?.contractId,
    failureKind: audit?.failureKind ?? validation?.findings[0]?.kind,
    outcome: audit?.outcome,
    action: executor?.action ?? repair?.action,
    sourceRefs: refs.sourceRefs,
    auditRefs: refs.auditRefs,
    repairRefs: refs.repairRefs,
    relatedRefs: refs.relatedRefs,
    sinkRefs: uniqueStrings(audit?.sinkRefs ?? []),
    telemetrySpanRefs: uniqueStrings(audit?.telemetrySpanRefs ?? []),
    createdAt: executor?.createdAt ?? audit?.createdAt ?? repair?.createdAt ?? validation?.createdAt,
  };
}

function telemetryChainsFromSource(
  source: ValidationRepairTelemetrySource | ValidationRepairTelemetrySource[],
): NormalizedTelemetryChain[] {
  return Array.isArray(source)
    ? source.flatMap((entry) => telemetryChainsFromSource(entry))
    : normalizeTelemetryChain(source);
}

function telemetryChainsFromPayload(value: unknown): NormalizedTelemetryChain[] {
  const chains: NormalizedTelemetryChain[] = [];
  const visit = (candidate: unknown) => {
    if (!isRecord(candidate)) return;
    chains.push(...normalizeTelemetryChain(candidate));
    const refs = isRecord(candidate.refs) ? candidate.refs : {};
    const directChain = isRecord(candidate.validationRepairAudit) ? candidate.validationRepairAudit : undefined;
    const refsChain = isRecord(refs.validationRepairAudit) ? refs.validationRepairAudit : undefined;
    const directExecutor = isRepairExecutorResult(candidate.repairExecutorResult) ? candidate.repairExecutorResult : undefined;
    const refsExecutor = isRepairExecutorResult(refs.repairExecutorResult) ? refs.repairExecutorResult : undefined;
    if (directChain) chains.push(...normalizeTelemetryChain(directChain));
    if (refsChain) chains.push(...normalizeTelemetryChain(refsChain));
    if (directExecutor) chains.push(...normalizeTelemetryChain(directExecutor));
    if (refsExecutor) chains.push(...normalizeTelemetryChain(refsExecutor));
  };
  visit(value);
  const executionUnits = isRecord(value) && Array.isArray(value.executionUnits) ? value.executionUnits : [];
  for (const unit of executionUnits) visit(unit);
  return chains;
}

function normalizeTelemetryChain(source: unknown): NormalizedTelemetryChain[] {
  if (!isRecord(source)) return [];
  if (isValidationDecision(source)) return [{ source: 'validation-decision', validation: source }];
  if (isRepairDecision(source)) return [{ source: 'repair-decision', repair: source }];
  if (isAuditRecord(source)) return [{ source: 'audit-record', audit: source }];
  if (isRepairExecutorResult(source)) return [{ source: 'repair-executor-result', executor: source }];

  const validation = isValidationDecision(source.validationDecision)
    ? source.validationDecision
    : isValidationDecision(source.validation)
      ? source.validation
      : undefined;
  const repair = isRepairDecision(source.repairDecision)
    ? source.repairDecision
    : isRepairDecision(source.repair)
      ? source.repair
      : undefined;
  const audit = isAuditRecord(source.auditRecord)
    ? source.auditRecord
    : isAuditRecord(source.audit)
      ? source.audit
      : undefined;
  const executor = isRepairExecutorResult(source.executorResult)
    ? source.executorResult
    : isRepairExecutorResult(source.repairExecutorResult)
      ? source.repairExecutorResult
      : undefined;
  if (!validation && !repair && !audit && !executor) return [];
  return [{
    source: validation && repair && audit ? 'validation-repair-audit-chain' : sourceKindForParts(validation, repair, audit, executor),
    validation,
    repair,
    audit,
    executor,
  }];
}

function sourceKindForParts(
  validation: ValidationDecision | undefined,
  repair: RepairDecision | undefined,
  audit: AuditRecord | undefined,
  executor: RepairExecutorResult | undefined,
): ValidationRepairTelemetrySpanRef['source'] {
  if (executor) return 'repair-executor-result';
  if (audit) return 'audit-record';
  if (repair) return 'repair-decision';
  if (validation) return 'validation-decision';
  return 'validation-repair-audit-chain';
}

function verificationGateStatus(validation: ValidationDecision | undefined) {
  const results = validation?.runtimeVerificationGate?.results ?? validation?.providedVerificationResults ?? [];
  if (results.some((result) => result.verdict === 'fail')) return 'failed';
  if (results.some((result) => result.verdict === 'needs-human')) return 'needs-human';
  if (results.some((result) => result.verdict === 'pass')) return 'pass';
  return validation?.status;
}

function existingSpanRef(spanKind: ValidationRepairTelemetrySpanKind, refs: string[]) {
  return refs.find((ref) => ref === spanKind || ref.startsWith(`${spanKind}:`) || ref.startsWith(`span:${spanKind}:`));
}

function stableSpanId(spanKind: ValidationRepairTelemetrySpanKind, value: Record<string, unknown>) {
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
  return `${spanKind.replace(/[^a-z0-9]+/g, '-')}:${digest}`;
}

function isAuditRecord(value: unknown): value is AuditRecord {
  return isRecord(value) && typeof value.auditId === 'string' && typeof value.outcome === 'string';
}

function isValidationDecision(value: unknown): value is ValidationDecision {
  return isRecord(value)
    && typeof value.decisionId === 'string'
    && typeof value.status === 'string'
    && isRecord(value.subject)
    && Array.isArray(value.findings);
}

function isRepairDecision(value: unknown): value is RepairDecision {
  return isRecord(value)
    && typeof value.decisionId === 'string'
    && typeof value.validationDecisionId === 'string'
    && typeof value.action === 'string'
    && isRecord(value.repairBudget);
}

function isRepairExecutorResult(value: unknown): value is RepairExecutorResult {
  return isRecord(value)
    && typeof value.executorResultId === 'string'
    && typeof value.repairDecisionId === 'string'
    && typeof value.action === 'string'
    && Array.isArray(value.auditTrail);
}

function uniqueSpans(spans: ValidationRepairTelemetrySpanRef[]) {
  const byKey = new Map<string, ValidationRepairTelemetrySpanRef>();
  for (const span of spans) {
    const key = `${span.spanKind}:${span.spanId}`;
    if (byKey.has(key)) continue;
    byKey.set(key, span);
  }
  return [...byKey.values()];
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

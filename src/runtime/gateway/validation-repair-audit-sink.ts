import {
  VALIDATION_REPAIR_AUDIT_SINK_TARGETS,
  type AuditRecord,
  type RepairDecision,
  type ValidationDecision,
  type ValidationRepairAuditSinkRecord,
  type ValidationRepairAuditSinkRef,
  type ValidationRepairAuditSinkTarget,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import { isRecord } from '../gateway-utils.js';
import type { ValidationRepairAuditChain } from './validation-repair-audit-bridge.js';

export interface ValidationRepairAuditSinkChain {
  validationDecision?: ValidationDecision;
  repairDecision?: RepairDecision;
  auditRecord: AuditRecord;
}

export type ValidationRepairAuditSinkSource =
  | ValidationRepairAuditChain
  | ValidationRepairAuditSinkChain
  | {
    validation?: ValidationDecision;
    repair?: RepairDecision;
    audit: AuditRecord;
  };

export interface ValidationRepairAuditAttemptRef {
  kind: 'validation-repair-audit';
  ref: string;
  auditId: string;
  validationDecisionId?: string;
  repairDecisionId?: string;
  contractId?: string;
  failureKind?: string;
  outcome?: string;
  subject?: ValidationRepairAuditSinkRef['subject'];
  relatedRefs: string[];
  sinkRefs: string[];
  telemetrySpanRefs: string[];
  createdAt?: string;
}

export interface ValidationRepairAuditAttemptMetadata {
  auditRefs: ValidationRepairAuditAttemptRef[];
  auditRecords: AuditRecord[];
}

export interface ValidationRepairAuditSinkProjection {
  refs: ValidationRepairAuditSinkRef[];
  records: ValidationRepairAuditSinkRecord[];
  auditRecords: AuditRecord[];
  attemptMetadata?: ValidationRepairAuditAttemptMetadata;
}

export interface ValidationRepairAuditSinkProjectionOptions {
  targets?: ValidationRepairAuditSinkTarget[];
}

export function projectValidationRepairAuditSink(
  source: ValidationRepairAuditSinkSource | ValidationRepairAuditSinkSource[],
  options: ValidationRepairAuditSinkProjectionOptions = {},
): ValidationRepairAuditSinkProjection {
  return sinkProjectionFromChains(sinkChainsFromSource(source), options);
}

export function validationRepairAuditSinkProjectionFromPayload(
  value: unknown,
  options: ValidationRepairAuditSinkProjectionOptions = {},
): ValidationRepairAuditSinkProjection | undefined {
  const projection = sinkProjectionFromChains(sinkChainsFromPayload(value), options);
  return projection.refs.length || projection.records.length || projection.auditRecords.length ? projection : undefined;
}

export function validationRepairAuditAttemptMetadataFromPayload(value: unknown): ValidationRepairAuditAttemptMetadata | undefined {
  const projection = validationRepairAuditSinkProjectionFromPayload(value, { targets: ['appendTaskAttempt'] });
  return projection?.attemptMetadata;
}

export function mergeValidationRepairAuditAttemptMetadata(
  current: Partial<ValidationRepairAuditAttemptMetadata> | undefined,
  next: ValidationRepairAuditAttemptMetadata | undefined,
): ValidationRepairAuditAttemptMetadata | undefined {
  const auditRefs = uniqueAttemptRefs([
    ...(current?.auditRefs ?? []),
    ...(next?.auditRefs ?? []),
  ]);
  const auditRecords = uniqueAuditRecords([
    ...(current?.auditRecords ?? []),
    ...(next?.auditRecords ?? []),
  ]);
  return auditRefs.length || auditRecords.length ? { auditRefs, auditRecords } : undefined;
}

function sinkProjectionFromChains(
  chains: ValidationRepairAuditSinkChain[],
  options: ValidationRepairAuditSinkProjectionOptions,
): ValidationRepairAuditSinkProjection {
  const targets = uniqueTargets(options.targets ?? [...VALIDATION_REPAIR_AUDIT_SINK_TARGETS]);
  const uniqueChains = uniqueSinkChains(chains);
  const refs: ValidationRepairAuditSinkRef[] = [];
  const records: ValidationRepairAuditSinkRecord[] = [];
  for (const chain of uniqueChains) {
    for (const target of targets) {
      const ref = sinkRefForTarget(target, chain.auditRecord);
      refs.push(sinkRefFromChain(chain, target, ref));
      records.push(sinkRecordFromChain(chain, target, ref));
    }
  }
  const auditRecords = uniqueAuditRecords(uniqueChains.map((chain) => chain.auditRecord));
  const appendTaskAttemptRefs = refs
    .filter((ref) => ref.target === 'appendTaskAttempt')
    .map((ref) => attemptRefFromSinkRef(ref));
  return {
    refs: uniqueSinkRefs(refs),
    records: uniqueSinkRecords(records),
    auditRecords,
    attemptMetadata: appendTaskAttemptRefs.length || auditRecords.length
      ? { auditRefs: uniqueAttemptRefs(appendTaskAttemptRefs), auditRecords }
      : undefined,
  };
}

function sinkChainsFromSource(
  source: ValidationRepairAuditSinkSource | ValidationRepairAuditSinkSource[],
): ValidationRepairAuditSinkChain[] {
  return Array.isArray(source)
    ? source.flatMap((entry) => sinkChainsFromSource(entry))
    : normalizeSinkChain(source);
}

function sinkChainsFromPayload(value: unknown): ValidationRepairAuditSinkChain[] {
  const chains: ValidationRepairAuditSinkChain[] = [];
  const visit = (candidate: unknown) => {
    if (!isRecord(candidate)) return;
    chains.push(...normalizeSinkChain(candidate));
    const refs = isRecord(candidate.refs) ? candidate.refs : {};
    const directChain = isRecord(candidate.validationRepairAudit) ? candidate.validationRepairAudit : undefined;
    const refsChain = isRecord(refs.validationRepairAudit) ? refs.validationRepairAudit : undefined;
    if (directChain) chains.push(...normalizeSinkChain(directChain));
    if (refsChain) chains.push(...normalizeSinkChain(refsChain));
  };
  visit(value);
  const executionUnits = isRecord(value) && Array.isArray(value.executionUnits) ? value.executionUnits : [];
  for (const unit of executionUnits) visit(unit);
  return chains;
}

function normalizeSinkChain(source: unknown): ValidationRepairAuditSinkChain[] {
  if (!isRecord(source)) return [];
  const auditRecord = isAuditRecord(source.auditRecord)
    ? source.auditRecord
    : isAuditRecord(source.audit)
      ? source.audit
      : undefined;
  if (!auditRecord) return [];
  return [{
    validationDecision: isValidationDecision(source.validationDecision)
      ? source.validationDecision
      : isValidationDecision(source.validation)
        ? source.validation
        : undefined,
    repairDecision: isRepairDecision(source.repairDecision)
      ? source.repairDecision
      : isRepairDecision(source.repair)
        ? source.repair
        : undefined,
    auditRecord,
  }];
}

function sinkRefForTarget(target: ValidationRepairAuditSinkTarget, audit: AuditRecord) {
  const existing = audit.sinkRefs.find((ref) => ref === target || ref.startsWith(`${target}:`));
  return existing ?? `${target}:${audit.auditId}`;
}

function sinkRefFromChain(
  chain: ValidationRepairAuditSinkChain,
  target: ValidationRepairAuditSinkTarget,
  ref: string,
): ValidationRepairAuditSinkRef {
  const audit = chain.auditRecord;
  return {
    kind: 'validation-repair-audit-sink',
    target,
    ref,
    auditId: audit.auditId,
    validationDecisionId: audit.validationDecisionId ?? chain.validationDecision?.decisionId,
    repairDecisionId: audit.repairDecisionId ?? chain.repairDecision?.decisionId,
    contractId: audit.contractId,
    failureKind: audit.failureKind,
    outcome: audit.outcome,
    subject: chain.validationDecision?.subject ?? audit.subject,
    relatedRefs: uniqueStrings(audit.relatedRefs),
    sinkRefs: uniqueStrings(audit.sinkRefs),
    telemetrySpanRefs: uniqueStrings(audit.telemetrySpanRefs),
    createdAt: audit.createdAt,
  };
}

function sinkRecordFromChain(
  chain: ValidationRepairAuditSinkChain,
  target: ValidationRepairAuditSinkTarget,
  ref: string,
): ValidationRepairAuditSinkRecord {
  return {
    kind: 'validation-repair-audit-sink-record',
    target,
    ref,
    auditRecord: chain.auditRecord,
    validationDecision: chain.validationDecision,
    repairDecision: chain.repairDecision,
    relatedRefs: uniqueStrings(chain.auditRecord.relatedRefs),
    createdAt: chain.auditRecord.createdAt,
  };
}

function attemptRefFromSinkRef(ref: ValidationRepairAuditSinkRef): ValidationRepairAuditAttemptRef {
  return {
    kind: 'validation-repair-audit',
    ref: ref.auditId,
    auditId: ref.auditId,
    validationDecisionId: ref.validationDecisionId,
    repairDecisionId: ref.repairDecisionId,
    contractId: ref.contractId,
    failureKind: ref.failureKind,
    outcome: ref.outcome,
    subject: ref.subject,
    relatedRefs: ref.relatedRefs,
    sinkRefs: ref.sinkRefs,
    telemetrySpanRefs: ref.telemetrySpanRefs,
    createdAt: ref.createdAt,
  };
}

function isAuditRecord(value: unknown): value is AuditRecord {
  return isRecord(value) && typeof value.auditId === 'string' && value.auditId.trim().length > 0;
}

function isValidationDecision(value: unknown): value is ValidationDecision {
  return isRecord(value)
    && typeof value.decisionId === 'string'
    && isRecord(value.subject)
    && Array.isArray(value.findings);
}

function isRepairDecision(value: unknown): value is RepairDecision {
  return isRecord(value)
    && typeof value.decisionId === 'string'
    && typeof value.validationDecisionId === 'string'
    && typeof value.action === 'string';
}

function uniqueTargets(targets: ValidationRepairAuditSinkTarget[]) {
  const allowed = new Set<ValidationRepairAuditSinkTarget>(VALIDATION_REPAIR_AUDIT_SINK_TARGETS);
  return [...new Set(targets.filter((target) => allowed.has(target)))];
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

function uniqueSinkChains(chains: ValidationRepairAuditSinkChain[]) {
  const byId = new Map<string, ValidationRepairAuditSinkChain>();
  for (const chain of chains) {
    if (!chain.auditRecord.auditId || byId.has(chain.auditRecord.auditId)) continue;
    byId.set(chain.auditRecord.auditId, chain);
  }
  return [...byId.values()];
}

function uniqueSinkRefs(refs: ValidationRepairAuditSinkRef[]) {
  const byKey = new Map<string, ValidationRepairAuditSinkRef>();
  for (const ref of refs) {
    byKey.set(`${ref.target}:${ref.ref}:${ref.auditId}`, ref);
  }
  return [...byKey.values()];
}

function uniqueSinkRecords(records: ValidationRepairAuditSinkRecord[]) {
  const byKey = new Map<string, ValidationRepairAuditSinkRecord>();
  for (const record of records) {
    byKey.set(`${record.target}:${record.ref}:${record.auditRecord.auditId}`, record);
  }
  return [...byKey.values()];
}

function uniqueAttemptRefs(refs: ValidationRepairAuditAttemptRef[]) {
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

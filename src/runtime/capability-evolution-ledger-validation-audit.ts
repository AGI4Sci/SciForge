import type {
  CapabilityEvolutionRecord,
  CapabilityEvolutionRecordStatus,
  SelectedCapabilityRef,
} from '../../packages/contracts/runtime/capability-evolution.js';
import { CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID } from '../../packages/contracts/runtime/capability-evolution.js';
import type {
  AuditRecord,
  AuditRecordOutcome,
  RepairDecision,
  ValidationDecision,
  ValidationRepairAuditSinkRecord,
} from '../../packages/contracts/runtime/validation-repair-audit.js';

export interface ValidationRepairAuditLedgerRecordOptions {
  now?: () => Date;
  recordIdPrefix?: string;
  runId?: string;
  sessionId?: string;
}

export interface ValidationRepairAuditLedgerFact {
  kind: 'validation-repair-audit-ledger-fact';
  recordRef: string;
  auditId: string;
  validationDecisionId?: string;
  repairDecisionId?: string;
  contractId?: string;
  failureKind?: string;
  repairAction?: string;
  outcome?: string;
  sinkRefs: string[];
}

export function capabilityEvolutionRecordFromValidationRepairAuditSinkRecord(
  sinkRecord: ValidationRepairAuditSinkRecord,
  options: ValidationRepairAuditLedgerRecordOptions = {},
): CapabilityEvolutionRecord {
  const audit = sinkRecord.auditRecord;
  const validation = sinkRecord.validationDecision;
  const repair = sinkRecord.repairDecision;
  const subject = validation?.subject ?? audit.subject;
  const recordedAt = audit.createdAt || sinkRecord.createdAt || (options.now ?? (() => new Date()))().toISOString();
  const contractId = audit.contractId || subject.contractId;
  const failureKind = audit.failureKind ?? firstFindingKind(validation);
  const repairAction = repair?.action;
  const sinkRefs = uniqueSortedStrings([
    sinkRecord.ref,
    ...audit.sinkRefs,
  ]);
  const relatedRefs = uniqueSortedStrings([
    ...sinkRecord.relatedRefs,
    ...audit.relatedRefs,
    ...(validation?.relatedRefs ?? []),
    ...(repair?.relatedRefs ?? []),
    ...sinkRefs,
    audit.auditId,
    audit.validationDecisionId,
    audit.repairDecisionId,
    subject.completedPayloadRef ?? '',
    subject.generatedTaskRef ?? '',
    subject.observeTraceRef ?? '',
    subject.actionTraceRef ?? '',
  ]);
  const recoverActions = uniqueSortedStrings([
    ...audit.recoverActions,
    ...(repair?.recoverActions ?? []),
    ...(validation?.findings.flatMap((finding) => finding.recoverActions) ?? []),
    repairAction ? `repair-action:${repairAction}` : '',
    contractId ? `contract:${contractId}` : '',
    ...sinkRefs.map((ref) => `sink-ref:${ref}`),
  ]);
  return {
    schemaVersion: CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID,
    id: `${options.recordIdPrefix ?? 'validation-repair-audit'}:${safeRecordId(audit.auditId)}`,
    recordedAt,
    runId: options.runId ?? subject.id,
    sessionId: options.sessionId,
    goalSummary: compactText([
      'Validation/repair audit',
      audit.auditId,
      contractId ? `contract=${contractId}` : '',
      failureKind ? `failure=${failureKind}` : '',
      repairAction ? `repair=${repairAction}` : '',
    ].filter(Boolean).join(' '), 280),
    selectedCapabilities: uniqueSelectedCapabilities([
      subject.capabilityId
        ? { id: subject.capabilityId, role: 'primary' as const, ...(contractId ? { contractRef: contractId } : {}) }
        : undefined,
      validation?.findings.find((finding) => finding.capabilityId)?.capabilityId
        ? {
          id: validation.findings.find((finding) => finding.capabilityId)!.capabilityId!,
          role: 'validator' as const,
          ...(contractId ? { contractRef: contractId } : {}),
        }
        : undefined,
      repairAction && repairAction !== 'none'
        ? { id: `validation-repair:${repairAction}`, role: 'repair' as const, ...(contractId ? { contractRef: contractId } : {}) }
        : undefined,
    ]),
    providers: [{
      id: 'validation-repair-audit-sink',
      kind: 'local-runtime',
    }],
    inputSchemaRefs: uniqueSortedStrings([subject.schemaPath ?? '', contractId ?? '']),
    outputSchemaRefs: uniqueSortedStrings([contractId ?? '', audit.contract]),
    executionUnitRefs: relatedRefs,
    artifactRefs: uniqueSortedStrings(subject.artifactRefs),
    validationResult: {
      verdict: validationVerdict(validation, audit),
      validatorId: contractId ? `contract:${contractId}` : 'validation-repair-audit',
      failureCode: failureKind,
      summary: compactText([
        contractId ? `contract ${contractId}` : undefined,
        failureKind ? `failure ${failureKind}` : undefined,
        repairAction ? `repair action ${repairAction}` : undefined,
        firstFindingMessage(validation),
      ].filter(Boolean).join('; '), 240),
      resultRef: audit.auditId,
    },
    failureCode: failureKind,
    recoverActions,
    repairAttempts: repair
      ? [{
        id: repair.decisionId,
        status: repairAttemptStatusForAction(repair.action, audit.outcome),
        reason: compactText(repair.reason, 240),
        executionUnitRefs: relatedRefs,
        artifactRefs: uniqueSortedStrings(subject.artifactRefs),
        validationResult: {
          verdict: validationVerdict(validation, audit),
          validatorId: contractId ? `contract:${contractId}` : 'validation-repair-audit',
          failureCode: failureKind,
          summary: compactText(`audit ${audit.auditId}; outcome ${audit.outcome}; repair ${repair.action}`, 240),
          resultRef: audit.auditId,
        },
        startedAt: repair.createdAt,
        completedAt: audit.createdAt,
      }]
      : [],
    finalStatus: finalStatusForAudit(audit.outcome, repair?.action),
    metadata: {
      source: 'validation-repair-audit-sink',
      sinkTarget: sinkRecord.target,
      validationRepairAudit: {
        auditId: audit.auditId,
        validationDecisionId: audit.validationDecisionId,
        repairDecisionId: audit.repairDecisionId,
        contractId,
        failureKind,
        outcome: audit.outcome,
        repairAction,
        sinkRefs,
      },
    },
  };
}

export function validationRepairAuditLedgerFactFromRecord(
  sinkRecord: ValidationRepairAuditSinkRecord,
  recordRef: string,
): ValidationRepairAuditLedgerFact {
  const audit = sinkRecord.auditRecord;
  return {
    kind: 'validation-repair-audit-ledger-fact',
    recordRef,
    auditId: audit.auditId,
    validationDecisionId: audit.validationDecisionId,
    repairDecisionId: audit.repairDecisionId,
    contractId: audit.contractId || audit.subject.contractId,
    failureKind: audit.failureKind,
    repairAction: sinkRecord.repairDecision?.action,
    outcome: audit.outcome,
    sinkRefs: uniqueSortedStrings([sinkRecord.ref, ...audit.sinkRefs]),
  };
}

export function uniqueValidationRepairAuditLedgerSinkRecords(records: ValidationRepairAuditSinkRecord[]) {
  const byAuditId = new Map<string, ValidationRepairAuditSinkRecord>();
  for (const record of records) {
    if (record.target !== 'ledger') continue;
    const auditId = record.auditRecord.auditId;
    if (!auditId || byAuditId.has(auditId)) continue;
    byAuditId.set(auditId, record);
  }
  return [...byAuditId.values()];
}

function uniqueSelectedCapabilities(values: Array<SelectedCapabilityRef | undefined>): SelectedCapabilityRef[] {
  const byId = new Map<string, SelectedCapabilityRef>();
  for (const value of values) {
    if (!value?.id || byId.has(`${value.role ?? 'primary'}:${value.id}`)) continue;
    byId.set(`${value.role ?? 'primary'}:${value.id}`, value);
  }
  return [...byId.values()];
}

function finalStatusForAudit(
  outcome: AuditRecordOutcome,
  repairAction: RepairDecision['action'] | undefined,
): CapabilityEvolutionRecordStatus {
  if (outcome === 'accepted') return 'succeeded';
  if (outcome === 'needs-human') return 'needs-human';
  if (repairAction === 'needs-human') return 'needs-human';
  if (repairAction === 'repair-rerun' || repairAction === 'supplement') return 'repair-failed';
  return 'failed';
}

function repairAttemptStatusForAction(
  action: RepairDecision['action'],
  outcome: AuditRecordOutcome,
) {
  if (action === 'none' || action === 'fail-closed' || action === 'needs-human') return 'skipped';
  if (outcome === 'accepted') return 'succeeded';
  return 'attempted';
}

function validationVerdict(
  validation: ValidationDecision | undefined,
  audit: AuditRecord,
) {
  if (validation?.status === 'pass' || audit.outcome === 'accepted') return 'pass';
  if (validation?.status === 'needs-human' || audit.outcome === 'needs-human') return 'needs-human';
  if (validation?.status === 'skipped') return 'unverified';
  return 'fail';
}

function firstFindingKind(validation: ValidationDecision | undefined) {
  return validation?.findings.find((finding) => finding.kind)?.kind;
}

function firstFindingMessage(validation: ValidationDecision | undefined) {
  return validation?.findings.find((finding) => finding.message)?.message;
}

function safeRecordId(value: string) {
  return value.replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || shortStableHash(value);
}

function uniqueSortedStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function compactText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function shortStableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

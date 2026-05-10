import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  VALIDATION_REPAIR_TELEMETRY_SPAN_KINDS,
  type AuditRecord,
  type RepairDecision,
  type ValidationFindingKind,
  type ValidationDecision,
  type ValidationSubjectRef,
  type ValidationRepairTelemetrySpanKind,
  type ValidationRepairTelemetrySpanRef,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import { isRecord } from '../gateway-utils.js';
import { normalizeWorkspaceRootPath } from '../workspace-paths.js';
import type { RepairExecutorResult } from './repair-executor.js';
import type { ValidationRepairAuditChain } from './validation-repair-audit-bridge.js';

export const VALIDATION_REPAIR_TELEMETRY_RELATIVE_PATH = '.sciforge/validation-repair-telemetry/spans.jsonl';

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

export interface ValidationRepairTelemetryWriteOptions {
  workspacePath: string;
  telemetryPath?: string;
  now?: () => Date;
}

export interface ValidationRepairTelemetryReadOptions extends ValidationRepairTelemetryWriteOptions {
  limit?: number;
}

export interface ValidationRepairTelemetrySummaryOptions extends ValidationRepairTelemetryReadOptions {}

export interface ValidationRepairTelemetrySpanRecord {
  kind: 'validation-repair-telemetry-span-record';
  schemaVersion: 1;
  ref: string;
  span: ValidationRepairTelemetrySpanRef;
  spanId: string;
  spanKind: ValidationRepairTelemetrySpanKind;
  validationDecisionId?: string;
  repairDecisionId?: string;
  auditId?: string;
  executorResultId?: string;
  subject?: ValidationSubjectRef;
  contractId?: string;
  failureKind?: ValidationFindingKind;
  outcome?: string;
  action?: string;
  sourceRefs: string[];
  auditRefs: string[];
  repairRefs: string[];
  relatedRefs: string[];
  sinkRefs: string[];
  telemetrySpanRefs: string[];
  createdAt: string;
  recordedAt: string;
}

export interface ValidationRepairTelemetryWriteResult {
  path: string;
  ref: string;
  records: ValidationRepairTelemetrySpanRecord[];
  projection: ValidationRepairTelemetryProjection;
}

export interface ValidationRepairTelemetryAttemptRef {
  kind: 'validation-repair-telemetry';
  ref: string;
  spanRefs: string[];
  recordRefs: string[];
  spanKinds: ValidationRepairTelemetrySpanKind[];
}

export interface ValidationRepairTelemetryAttemptMetadata {
  telemetryRefs: ValidationRepairTelemetryAttemptRef[];
}

export interface ValidationRepairTelemetrySummary {
  kind: 'validation-repair-telemetry-summary';
  sourceRef: string;
  generatedAt: string;
  totalSpans: number;
  spanKindCounts: Partial<Record<ValidationRepairTelemetrySpanKind, number>>;
  validationDecisionIds: string[];
  repairDecisionIds: string[];
  auditIds: string[];
  executorResultIds: string[];
  sourceRefs: string[];
  auditRefs: string[];
  repairRefs: string[];
  recentSpans: Array<{
    ref: string;
    spanId: string;
    spanKind: ValidationRepairTelemetrySpanKind;
    status?: string;
    validationDecisionId?: string;
    repairDecisionId?: string;
    auditId?: string;
    executorResultId?: string;
    createdAt: string;
  }>;
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

export function validationRepairTelemetryAttemptMetadataFromPayload(
  value: unknown,
): ValidationRepairTelemetryAttemptMetadata | undefined {
  const refs = uniqueTelemetryAttemptRefs(telemetryAttemptRefsFromPayload(value));
  return refs.length ? { telemetryRefs: refs } : undefined;
}

export function resolveValidationRepairTelemetryPath(options: ValidationRepairTelemetryWriteOptions) {
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(options.workspacePath));
  if (!workspaceRoot) throw new Error('workspacePath is required');
  const rawTelemetryPath = options.telemetryPath?.trim() || VALIDATION_REPAIR_TELEMETRY_RELATIVE_PATH;
  const targetPath = isAbsolute(rawTelemetryPath) ? resolve(rawTelemetryPath) : resolve(workspaceRoot, rawTelemetryPath);
  assertInsideWorkspace(workspaceRoot, targetPath);
  return targetPath;
}

export async function writeValidationRepairTelemetrySpans(
  source: ValidationRepairTelemetrySource | ValidationRepairTelemetrySource[],
  options: ValidationRepairTelemetryWriteOptions,
  projectionOptions: ValidationRepairTelemetryProjectionOptions = {},
): Promise<ValidationRepairTelemetryWriteResult> {
  const projection = projectValidationRepairTelemetrySpans(source, projectionOptions);
  return writeValidationRepairTelemetryProjection(projection, options);
}

export async function writeValidationRepairTelemetrySpansFromPayload(
  value: unknown,
  options: ValidationRepairTelemetryWriteOptions,
  projectionOptions: ValidationRepairTelemetryProjectionOptions = {},
): Promise<ValidationRepairTelemetryWriteResult> {
  const projection = validationRepairTelemetrySpansFromPayload(value, projectionOptions) ?? emptyValidationRepairTelemetryProjection();
  return writeValidationRepairTelemetryProjection(projection, options);
}

async function writeValidationRepairTelemetryProjection(
  projection: ValidationRepairTelemetryProjection,
  options: ValidationRepairTelemetryWriteOptions,
): Promise<ValidationRepairTelemetryWriteResult> {
  const telemetryPath = resolveValidationRepairTelemetryPath(options);
  const fileRef = toWorkspaceRef(options.workspacePath, telemetryPath);
  const records = uniqueSpanRecords(projection.spans.map((span) => telemetryRecordFromSpan(span, fileRef, options)));
  if (records.length > 0) {
    await mkdir(dirname(telemetryPath), { recursive: true });
    await appendFile(telemetryPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  }
  return {
    path: telemetryPath,
    ref: fileRef,
    records,
    projection,
  };
}

function emptyValidationRepairTelemetryProjection(): ValidationRepairTelemetryProjection {
  return {
    spans: [],
    spanRefs: [],
    sourceRefs: [],
    auditRefs: [],
    repairRefs: [],
  };
}

export async function readValidationRepairTelemetrySpanRecords(
  options: ValidationRepairTelemetryReadOptions,
): Promise<ValidationRepairTelemetrySpanRecord[]> {
  const telemetryPath = resolveValidationRepairTelemetryPath(options);
  const raw = await readFile(telemetryPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const records = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ValidationRepairTelemetrySpanRecord);
  return typeof options.limit === 'number' && options.limit >= 0 ? records.slice(-options.limit) : records;
}

export async function buildValidationRepairTelemetrySummary(
  options: ValidationRepairTelemetrySummaryOptions,
): Promise<ValidationRepairTelemetrySummary> {
  const telemetryPath = resolveValidationRepairTelemetryPath(options);
  const records = await readValidationRepairTelemetrySpanRecords(options);
  const spanKindCounts: Partial<Record<ValidationRepairTelemetrySpanKind, number>> = {};
  for (const record of records) {
    spanKindCounts[record.spanKind] = (spanKindCounts[record.spanKind] ?? 0) + 1;
  }
  return {
    kind: 'validation-repair-telemetry-summary',
    sourceRef: toWorkspaceRef(options.workspacePath, telemetryPath),
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    totalSpans: records.length,
    spanKindCounts,
    validationDecisionIds: uniqueStrings(records.map((record) => record.validationDecisionId)),
    repairDecisionIds: uniqueStrings(records.map((record) => record.repairDecisionId)),
    auditIds: uniqueStrings(records.map((record) => record.auditId)),
    executorResultIds: uniqueStrings(records.map((record) => record.executorResultId)),
    sourceRefs: uniqueStrings(records.flatMap((record) => record.sourceRefs)),
    auditRefs: uniqueStrings(records.flatMap((record) => record.auditRefs)),
    repairRefs: uniqueStrings(records.flatMap((record) => record.repairRefs)),
    recentSpans: records.slice(-25).map((record) => ({
      ref: record.ref,
      spanId: record.spanId,
      spanKind: record.spanKind,
      status: record.span.status,
      validationDecisionId: record.validationDecisionId,
      repairDecisionId: record.repairDecisionId,
      auditId: record.auditId,
      executorResultId: record.executorResultId,
      createdAt: record.createdAt,
    })),
  };
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
  if (
    repair?.action === 'repair-rerun'
    || executor?.strategyAction === 'repair-rerun'
    || executor?.action === 'rerun'
    || subject?.kind === 'repair-rerun-result'
    || hasTelemetrySpanRef(audit, 'repair-rerun')
  ) {
    spans.push(spanForChain(chain, 'repair-rerun', {
      status: executor?.status ?? audit?.outcome ?? repair?.action,
      sourceRefs: uniqueStrings([
        repair?.decisionId,
        audit?.auditId,
        subject?.completedPayloadRef,
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
      status: audit?.outcome ?? validation?.status ?? 'recorded',
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

function telemetryAttemptRefsFromPayload(value: unknown): ValidationRepairTelemetryAttemptRef[] {
  const refs: ValidationRepairTelemetryAttemptRef[] = [];
  const visit = (candidate: unknown) => {
    if (!isRecord(candidate)) return;
    const candidateRefs = isRecord(candidate.refs) ? candidate.refs : {};
    if (!Array.isArray(candidateRefs.validationRepairTelemetry)) return;
    refs.push(...candidateRefs.validationRepairTelemetry
      .map(normalizeTelemetryAttemptRef)
      .filter((ref): ref is ValidationRepairTelemetryAttemptRef => Boolean(ref)));
  };
  visit(value);
  const executionUnits = isRecord(value) && Array.isArray(value.executionUnits) ? value.executionUnits : [];
  for (const unit of executionUnits) visit(unit);
  return refs;
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

function hasTelemetrySpanRef(audit: AuditRecord | undefined, spanKind: ValidationRepairTelemetrySpanKind) {
  return Boolean(existingSpanRef(spanKind, audit?.telemetrySpanRefs ?? []));
}

function stableSpanId(spanKind: ValidationRepairTelemetrySpanKind, value: Record<string, unknown>) {
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
  return `${spanKind.replace(/[^a-z0-9]+/g, '-')}:${digest}`;
}

function telemetryRecordFromSpan(
  span: ValidationRepairTelemetrySpanRef,
  fileRef: string,
  options: ValidationRepairTelemetryWriteOptions,
): ValidationRepairTelemetrySpanRecord {
  const recordedAt = (options.now ?? (() => new Date()))().toISOString();
  const createdAt = span.createdAt ?? recordedAt;
  return {
    kind: 'validation-repair-telemetry-span-record',
    schemaVersion: 1,
    ref: `${fileRef}#${span.spanId}`,
    span,
    spanId: span.spanId,
    spanKind: span.spanKind,
    validationDecisionId: span.validationDecisionId,
    repairDecisionId: span.repairDecisionId,
    auditId: span.auditId,
    executorResultId: span.executorResultId,
    subject: span.subject,
    contractId: span.contractId,
    failureKind: span.failureKind,
    outcome: span.outcome,
    action: span.action,
    sourceRefs: uniqueStrings(span.sourceRefs),
    auditRefs: uniqueStrings(span.auditRefs),
    repairRefs: uniqueStrings(span.repairRefs),
    relatedRefs: uniqueStrings(span.relatedRefs),
    sinkRefs: uniqueStrings(span.sinkRefs),
    telemetrySpanRefs: uniqueStrings(span.telemetrySpanRefs),
    createdAt,
    recordedAt,
  };
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

function uniqueSpanRecords(records: ValidationRepairTelemetrySpanRecord[]) {
  const byKey = new Map<string, ValidationRepairTelemetrySpanRecord>();
  for (const record of records) {
    const key = `${record.spanKind}:${record.spanId}`;
    if (byKey.has(key)) continue;
    byKey.set(key, record);
  }
  return [...byKey.values()];
}

function normalizeTelemetryAttemptRef(value: unknown): ValidationRepairTelemetryAttemptRef | undefined {
  if (!isRecord(value) || value.kind !== 'validation-repair-telemetry' || typeof value.ref !== 'string') return undefined;
  return {
    kind: 'validation-repair-telemetry',
    ref: value.ref,
    spanRefs: uniqueStrings(Array.isArray(value.spanRefs) ? value.spanRefs : []),
    recordRefs: uniqueStrings(Array.isArray(value.recordRefs) ? value.recordRefs : []),
    spanKinds: uniqueSpanKinds(Array.isArray(value.spanKinds) ? value.spanKinds : []),
  };
}

function uniqueTelemetryAttemptRefs(refs: ValidationRepairTelemetryAttemptRef[]) {
  const byKey = new Map<string, ValidationRepairTelemetryAttemptRef>();
  for (const ref of refs) {
    const key = `${ref.ref}:${ref.recordRefs.join('|')}:${ref.spanRefs.join('|')}`;
    if (byKey.has(key)) continue;
    byKey.set(key, ref);
  }
  return [...byKey.values()];
}

function uniqueSpanKinds(values: unknown[]) {
  const allowed = new Set(VALIDATION_REPAIR_TELEMETRY_SPAN_KINDS);
  return uniqueStrings(values.map((value) => typeof value === 'string' ? value : undefined))
    .filter((value): value is ValidationRepairTelemetrySpanKind => allowed.has(value as ValidationRepairTelemetrySpanKind));
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

function toWorkspaceRef(workspacePath: string, targetPath: string) {
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(workspacePath));
  const relativePath = relative(workspaceRoot, targetPath).split(sep).join('/');
  return relativePath && !relativePath.startsWith('..') ? relativePath : targetPath;
}

function assertInsideWorkspace(workspaceRoot: string, targetPath: string) {
  const relativePath = relative(workspaceRoot, targetPath);
  if (relativePath === '') return;
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Telemetry path must stay inside workspace: ${targetPath}`);
  }
}

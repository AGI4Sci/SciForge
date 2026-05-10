import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ObserveInvocationRecord } from '@sciforge-ui/runtime-contract/observe';
import {
  VALIDATION_REPAIR_AUDIT_SINK_TARGETS,
  type AuditRecord,
  type RepairDecision,
  type ValidationDecision,
  type ValidationRepairAuditSinkRecord,
  type ValidationRepairAuditSinkRef,
  type ValidationRepairAuditSinkTarget,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import {
  appendValidationRepairAuditSinkRecordsToCapabilityEvolutionLedger,
  type ValidationRepairAuditLedgerWriteOptions,
  type ValidationRepairAuditLedgerWriteResult,
} from '../capability-evolution-ledger.js';
import { isRecord } from '../gateway-utils.js';
import { normalizeWorkspaceRootPath } from '../workspace-paths.js';
import type { ValidationRepairAuditChain } from './validation-repair-audit-bridge.js';

export const VALIDATION_REPAIR_AUDIT_VERIFICATION_ARTIFACTS_RELATIVE_DIR = '.sciforge/validation-repair-audit/verification-artifacts';
export const VALIDATION_REPAIR_AUDIT_VERIFICATION_ARTIFACT_CONTRACT_ID = 'sciforge.validation-repair-audit-verification-artifact.v1';
export const VALIDATION_REPAIR_AUDIT_OBSERVE_INVOCATIONS_RELATIVE_DIR = '.sciforge/validation-repair-audit/observe-invocations';
export const VALIDATION_REPAIR_AUDIT_OBSERVE_INVOCATION_CONTRACT_ID = 'sciforge.validation-repair-audit-observe-invocation.v1';

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
  sinkRefs: ValidationRepairAuditSinkRef[];
  sinkRecords: ValidationRepairAuditSinkRecord[];
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

export interface ValidationRepairAuditVerificationArtifactWriteOptions {
  workspacePath: string;
  artifactDir?: string;
  now?: () => Date;
}

export interface ValidationRepairAuditVerificationArtifact {
  contract: typeof VALIDATION_REPAIR_AUDIT_VERIFICATION_ARTIFACT_CONTRACT_ID;
  artifactId: string;
  sourceSinkRef: string;
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
  auditRecord: AuditRecord;
  validationDecision?: ValidationDecision;
  repairDecision?: RepairDecision;
  createdAt?: string;
  recordedAt: string;
}

export interface ValidationRepairAuditVerificationArtifactFact {
  kind: 'validation-repair-audit-verification-artifact-fact';
  artifactRef: string;
  sourceSinkRef: string;
  auditId: string;
  validationDecisionId?: string;
  repairDecisionId?: string;
  contractId?: string;
  failureKind?: string;
  outcome?: string;
  sinkRefs: string[];
}

export interface ValidationRepairAuditVerificationArtifactWriteResult {
  path: string;
  ref: string;
  artifact: ValidationRepairAuditVerificationArtifact;
  fact: ValidationRepairAuditVerificationArtifactFact;
}

export interface ValidationRepairAuditObserveInvocationWriteOptions {
  workspacePath: string;
  invocationDir?: string;
  now?: () => Date;
  observeInvocationRecords?: ObserveInvocationRecord[];
}

export interface ValidationRepairAuditObserveInvocationArtifact {
  contract: typeof VALIDATION_REPAIR_AUDIT_OBSERVE_INVOCATION_CONTRACT_ID;
  artifactId: string;
  sourceSinkRef: string;
  auditId: string;
  validationDecisionId?: string;
  repairDecisionId?: string;
  contractId?: string;
  failureKind?: string;
  outcome?: string;
  subject?: ValidationRepairAuditSinkRef['subject'];
  observeInvocation?: ObserveInvocationRecord;
  relatedRefs: string[];
  sinkRefs: string[];
  telemetrySpanRefs: string[];
  auditRecord: AuditRecord;
  validationDecision?: ValidationDecision;
  repairDecision?: RepairDecision;
  createdAt?: string;
  recordedAt: string;
}

export interface ValidationRepairAuditObserveInvocationFact {
  kind: 'validation-repair-audit-observe-invocation-fact';
  artifactRef: string;
  sourceSinkRef: string;
  auditId: string;
  validationDecisionId?: string;
  repairDecisionId?: string;
  contractId?: string;
  failureKind?: string;
  outcome?: string;
  providerId?: string;
  callRef?: string;
  traceRef?: string;
  status?: string;
  sinkRefs: string[];
}

export interface ValidationRepairAuditObserveInvocationWriteResult {
  path: string;
  ref: string;
  artifact: ValidationRepairAuditObserveInvocationArtifact;
  fact: ValidationRepairAuditObserveInvocationFact;
}

export interface ValidationRepairAuditSinkArtifactSummary {
  kind: 'validation-repair-audit-sink-artifact-summary';
  target: 'verification-artifact' | 'observe-invocation';
  sourceRef: string;
  generatedAt: string;
  totalArtifacts: number;
  auditIds: string[];
  validationDecisionIds: string[];
  repairDecisionIds: string[];
  contractIds: string[];
  failureKindCounts: Record<string, number>;
  outcomeCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  sourceSinkRefs: string[];
  sinkRefs: string[];
  telemetrySpanRefs: string[];
  recentArtifacts: Array<{
    artifactId: string;
    sourceSinkRef: string;
    auditId: string;
    status?: string;
    recordedAt: string;
  }>;
}

export interface ValidationRepairAuditActionResultSummary {
  kind: 'validation-repair-audit-action-result-summary';
  target: 'action-result';
  sourceRef: string;
  generatedAt: string;
  totalActionResults: number;
  auditIds: string[];
  validationDecisionIds: string[];
  repairDecisionIds: string[];
  actionTraceRefs: string[];
  contractIds: string[];
  findingSourceCounts: Record<string, number>;
  failureKindCounts: Record<string, number>;
  outcomeCounts: Record<string, number>;
  sourceSinkRefs: string[];
  sinkRefs: string[];
  telemetrySpanRefs: string[];
  recentActionResults: Array<{
    artifactId: string;
    sourceSinkRef: string;
    auditId: string;
    actionTraceRef?: string;
    outcome?: string;
    recordedAt: string;
  }>;
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
  const projection = validationRepairAuditSinkProjectionFromPayload(value);
  return projection?.attemptMetadata;
}

export async function writeValidationRepairAuditSinkLedgerRecords(
  source: ValidationRepairAuditSinkSource | ValidationRepairAuditSinkSource[],
  options: ValidationRepairAuditLedgerWriteOptions,
): Promise<ValidationRepairAuditLedgerWriteResult[]> {
  const projection = projectValidationRepairAuditSink(source, { targets: ['ledger'] });
  return appendValidationRepairAuditSinkRecordsToCapabilityEvolutionLedger(options, projection.records);
}

export async function writeValidationRepairAuditSinkVerificationArtifacts(
  source: ValidationRepairAuditSinkSource | ValidationRepairAuditSinkSource[],
  options: ValidationRepairAuditVerificationArtifactWriteOptions,
): Promise<ValidationRepairAuditVerificationArtifactWriteResult[]> {
  const projection = projectValidationRepairAuditSink(source, { targets: ['verification-artifact'] });
  const results: ValidationRepairAuditVerificationArtifactWriteResult[] = [];
  for (const record of uniqueSinkRecords(projection.records)) {
    results.push(await writeValidationRepairAuditSinkVerificationArtifactRecord(options, record));
  }
  return results;
}

export async function writeValidationRepairAuditSinkVerificationArtifactRecord(
  options: ValidationRepairAuditVerificationArtifactWriteOptions,
  sinkRecord: ValidationRepairAuditSinkRecord,
): Promise<ValidationRepairAuditVerificationArtifactWriteResult> {
  if (sinkRecord.target !== 'verification-artifact') {
    throw new Error(`Expected verification-artifact sink record, received ${sinkRecord.target}`);
  }
  const artifactPath = resolveValidationRepairAuditVerificationArtifactPath(options, sinkRecord);
  const artifact = validationRepairAuditVerificationArtifactFromSinkRecord(sinkRecord, options);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  const artifactRef = toWorkspaceRef(options.workspacePath, artifactPath);
  return {
    path: artifactPath,
    ref: artifactRef,
    artifact,
    fact: validationRepairAuditVerificationArtifactFactFromArtifact(artifact, artifactRef),
  };
}

export async function readValidationRepairAuditSinkVerificationArtifacts(
  options: ValidationRepairAuditVerificationArtifactWriteOptions,
): Promise<ValidationRepairAuditVerificationArtifact[]> {
  const artifactDir = resolveValidationRepairAuditVerificationArtifactDir(options);
  const entries = await readdir(artifactDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const artifacts: ValidationRepairAuditVerificationArtifact[] = [];
  for (const entry of entries.filter((value) => value.endsWith('.json')).sort()) {
    const raw = await readFile(join(artifactDir, entry), 'utf8');
    artifacts.push(JSON.parse(raw) as ValidationRepairAuditVerificationArtifact);
  }
  return artifacts;
}

export async function buildValidationRepairAuditSinkVerificationArtifactSummary(
  options: ValidationRepairAuditVerificationArtifactWriteOptions,
): Promise<ValidationRepairAuditSinkArtifactSummary> {
  return validationRepairAuditSinkArtifactSummary(
    'verification-artifact',
    toWorkspaceRef(options.workspacePath, resolveValidationRepairAuditVerificationArtifactDir(options)),
    await readValidationRepairAuditSinkVerificationArtifacts(options),
    options.now,
  );
}

export async function buildValidationRepairAuditSinkActionResultSummary(
  options: ValidationRepairAuditVerificationArtifactWriteOptions,
): Promise<ValidationRepairAuditActionResultSummary> {
  const artifactDir = resolveValidationRepairAuditVerificationArtifactDir(options);
  const artifacts = (await readValidationRepairAuditSinkVerificationArtifacts(options))
    .filter((artifact) => actionResultSubject(artifact));
  return validationRepairAuditActionResultSummary(
    toWorkspaceRef(options.workspacePath, artifactDir),
    artifacts,
    options.now,
  );
}

export async function writeValidationRepairAuditSinkObserveInvocationRecords(
  source: ValidationRepairAuditSinkSource | ValidationRepairAuditSinkSource[],
  options: ValidationRepairAuditObserveInvocationWriteOptions,
): Promise<ValidationRepairAuditObserveInvocationWriteResult[]> {
  const projection = projectValidationRepairAuditSink(source, { targets: ['observe-invocation'] });
  const observeRecordsByRef = observeInvocationRecordsByRef(options.observeInvocationRecords ?? []);
  const results: ValidationRepairAuditObserveInvocationWriteResult[] = [];
  for (const record of uniqueSinkRecords(projection.records)) {
    results.push(await writeValidationRepairAuditSinkObserveInvocationRecord(options, record, observeRecordsByRef));
  }
  return results;
}

export async function writeValidationRepairAuditSinkObserveInvocationRecord(
  options: ValidationRepairAuditObserveInvocationWriteOptions,
  sinkRecord: ValidationRepairAuditSinkRecord,
  observeRecordsByRef: Map<string, ObserveInvocationRecord> = observeInvocationRecordsByRef(options.observeInvocationRecords ?? []),
): Promise<ValidationRepairAuditObserveInvocationWriteResult> {
  if (sinkRecord.target !== 'observe-invocation') {
    throw new Error(`Expected observe-invocation sink record, received ${sinkRecord.target}`);
  }
  const artifactPath = resolveValidationRepairAuditObserveInvocationPath(options, sinkRecord);
  const artifact = validationRepairAuditObserveInvocationArtifactFromSinkRecord(
    sinkRecord,
    options,
    observeRecordsByRef.get(sinkRecord.ref),
  );
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  const artifactRef = toWorkspaceRef(options.workspacePath, artifactPath);
  return {
    path: artifactPath,
    ref: artifactRef,
    artifact,
    fact: validationRepairAuditObserveInvocationFactFromArtifact(artifact, artifactRef),
  };
}

export async function readValidationRepairAuditSinkObserveInvocationRecords(
  options: ValidationRepairAuditObserveInvocationWriteOptions,
): Promise<ValidationRepairAuditObserveInvocationArtifact[]> {
  const invocationDir = resolveValidationRepairAuditObserveInvocationDir(options);
  const entries = await readdir(invocationDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const artifacts: ValidationRepairAuditObserveInvocationArtifact[] = [];
  for (const entry of entries.filter((value) => value.endsWith('.json')).sort()) {
    const raw = await readFile(join(invocationDir, entry), 'utf8');
    artifacts.push(JSON.parse(raw) as ValidationRepairAuditObserveInvocationArtifact);
  }
  return artifacts;
}

export async function buildValidationRepairAuditSinkObserveInvocationSummary(
  options: ValidationRepairAuditObserveInvocationWriteOptions,
): Promise<ValidationRepairAuditSinkArtifactSummary> {
  return validationRepairAuditSinkArtifactSummary(
    'observe-invocation',
    toWorkspaceRef(options.workspacePath, resolveValidationRepairAuditObserveInvocationDir(options)),
    await readValidationRepairAuditSinkObserveInvocationRecords(options),
    options.now,
  );
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
  const sinkRefs = uniqueSinkRefs([
    ...(current?.sinkRefs ?? []),
    ...(next?.sinkRefs ?? []),
  ]);
  const sinkRecords = uniqueSinkRecords([
    ...(current?.sinkRecords ?? []),
    ...(next?.sinkRecords ?? []),
  ]);
  return auditRefs.length || auditRecords.length || sinkRefs.length || sinkRecords.length
    ? { auditRefs, auditRecords, sinkRefs, sinkRecords }
    : undefined;
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
      ? {
        auditRefs: uniqueAttemptRefs(appendTaskAttemptRefs),
        auditRecords,
        sinkRefs: uniqueSinkRefs(refs),
        sinkRecords: uniqueSinkRecords(records),
      }
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

function validationRepairAuditVerificationArtifactFromSinkRecord(
  sinkRecord: ValidationRepairAuditSinkRecord,
  options: ValidationRepairAuditVerificationArtifactWriteOptions,
): ValidationRepairAuditVerificationArtifact {
  const audit = sinkRecord.auditRecord;
  const validation = sinkRecord.validationDecision;
  const repair = sinkRecord.repairDecision;
  return {
    contract: VALIDATION_REPAIR_AUDIT_VERIFICATION_ARTIFACT_CONTRACT_ID,
    artifactId: `validation-repair-audit-verification-artifact:${safeArtifactId(audit.auditId)}`,
    sourceSinkRef: sinkRecord.ref,
    auditId: audit.auditId,
    validationDecisionId: audit.validationDecisionId ?? validation?.decisionId,
    repairDecisionId: audit.repairDecisionId ?? repair?.decisionId,
    contractId: audit.contractId,
    failureKind: audit.failureKind,
    outcome: audit.outcome,
    subject: validation?.subject ?? audit.subject,
    relatedRefs: uniqueStrings([
      ...sinkRecord.relatedRefs,
      ...audit.relatedRefs,
      ...(validation?.relatedRefs ?? []),
      ...(repair?.relatedRefs ?? []),
    ]),
    sinkRefs: uniqueStrings([
      sinkRecord.ref,
      ...audit.sinkRefs,
    ]),
    telemetrySpanRefs: uniqueStrings(audit.telemetrySpanRefs),
    auditRecord: audit,
    validationDecision: validation,
    repairDecision: repair,
    createdAt: audit.createdAt || sinkRecord.createdAt,
    recordedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}

function validationRepairAuditVerificationArtifactFactFromArtifact(
  artifact: ValidationRepairAuditVerificationArtifact,
  artifactRef: string,
): ValidationRepairAuditVerificationArtifactFact {
  return {
    kind: 'validation-repair-audit-verification-artifact-fact',
    artifactRef,
    sourceSinkRef: artifact.sourceSinkRef,
    auditId: artifact.auditId,
    validationDecisionId: artifact.validationDecisionId,
    repairDecisionId: artifact.repairDecisionId,
    contractId: artifact.contractId,
    failureKind: artifact.failureKind,
    outcome: artifact.outcome,
    sinkRefs: artifact.sinkRefs,
  };
}

function validationRepairAuditObserveInvocationArtifactFromSinkRecord(
  sinkRecord: ValidationRepairAuditSinkRecord,
  options: ValidationRepairAuditObserveInvocationWriteOptions,
  observeInvocation: ObserveInvocationRecord | undefined,
): ValidationRepairAuditObserveInvocationArtifact {
  const audit = sinkRecord.auditRecord;
  const validation = sinkRecord.validationDecision;
  const repair = sinkRecord.repairDecision;
  return {
    contract: VALIDATION_REPAIR_AUDIT_OBSERVE_INVOCATION_CONTRACT_ID,
    artifactId: `validation-repair-audit-observe-invocation:${safeArtifactId(sinkRecord.ref)}`,
    sourceSinkRef: sinkRecord.ref,
    auditId: audit.auditId,
    validationDecisionId: audit.validationDecisionId ?? validation?.decisionId,
    repairDecisionId: audit.repairDecisionId ?? repair?.decisionId,
    contractId: audit.contractId,
    failureKind: audit.failureKind,
    outcome: audit.outcome,
    subject: validation?.subject ?? audit.subject,
    observeInvocation,
    relatedRefs: uniqueStrings([
      ...sinkRecord.relatedRefs,
      ...audit.relatedRefs,
      ...(validation?.relatedRefs ?? []),
      ...(repair?.relatedRefs ?? []),
      observeInvocation?.callRef,
      observeInvocation?.traceRef,
      ...(observeInvocation?.artifactRefs ?? []),
    ]),
    sinkRefs: uniqueStrings([
      sinkRecord.ref,
      ...audit.sinkRefs,
    ]),
    telemetrySpanRefs: uniqueStrings(audit.telemetrySpanRefs),
    auditRecord: audit,
    validationDecision: validation,
    repairDecision: repair,
    createdAt: audit.createdAt || sinkRecord.createdAt,
    recordedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}

function validationRepairAuditObserveInvocationFactFromArtifact(
  artifact: ValidationRepairAuditObserveInvocationArtifact,
  artifactRef: string,
): ValidationRepairAuditObserveInvocationFact {
  return {
    kind: 'validation-repair-audit-observe-invocation-fact',
    artifactRef,
    sourceSinkRef: artifact.sourceSinkRef,
    auditId: artifact.auditId,
    validationDecisionId: artifact.validationDecisionId,
    repairDecisionId: artifact.repairDecisionId,
    contractId: artifact.contractId,
    failureKind: artifact.failureKind,
    outcome: artifact.outcome,
    providerId: artifact.observeInvocation?.providerId,
    callRef: artifact.observeInvocation?.callRef,
    traceRef: artifact.observeInvocation?.traceRef,
    status: artifact.observeInvocation?.status,
    sinkRefs: artifact.sinkRefs,
  };
}

function validationRepairAuditSinkArtifactSummary(
  target: ValidationRepairAuditSinkArtifactSummary['target'],
  sourceRef: string,
  artifacts: Array<ValidationRepairAuditVerificationArtifact | ValidationRepairAuditObserveInvocationArtifact>,
  now: (() => Date) | undefined,
): ValidationRepairAuditSinkArtifactSummary {
  const fields = validationRepairAuditReadbackSummaryFields(target, sourceRef, artifacts, now);
  return {
    kind: 'validation-repair-audit-sink-artifact-summary',
    ...fields,
    totalArtifacts: artifacts.length,
    statusCounts: countStrings(artifacts.map((artifact) => observeArtifactStatus(artifact))),
    recentArtifacts: artifacts.slice(-25).map((artifact) => ({
      artifactId: artifact.artifactId,
      sourceSinkRef: artifact.sourceSinkRef,
      auditId: artifact.auditId,
      status: observeArtifactStatus(artifact),
      recordedAt: artifact.recordedAt,
    })),
  };
}

function validationRepairAuditActionResultSummary(
  sourceRef: string,
  artifacts: ValidationRepairAuditVerificationArtifact[],
  now: (() => Date) | undefined,
): ValidationRepairAuditActionResultSummary {
  const fields = validationRepairAuditReadbackSummaryFields('action-result', sourceRef, artifacts, now);
  return {
    kind: 'validation-repair-audit-action-result-summary',
    ...fields,
    totalActionResults: artifacts.length,
    actionTraceRefs: uniqueStrings(artifacts.map((artifact) => artifact.subject?.actionTraceRef ?? artifact.auditRecord.subject.actionTraceRef)),
    findingSourceCounts: countStrings(artifacts.flatMap((artifact) => artifact.validationDecision?.findings.map((finding) => finding.source) ?? [])),
    recentActionResults: artifacts.slice(-25).map((artifact) => ({
      artifactId: artifact.artifactId,
      sourceSinkRef: artifact.sourceSinkRef,
      auditId: artifact.auditId,
      actionTraceRef: artifact.subject?.actionTraceRef ?? artifact.auditRecord.subject.actionTraceRef,
      outcome: artifact.outcome,
      recordedAt: artifact.recordedAt,
    })),
  };
}

function validationRepairAuditReadbackSummaryFields<Target extends ValidationRepairAuditSinkArtifactSummary['target'] | ValidationRepairAuditActionResultSummary['target']>(
  target: Target,
  sourceRef: string,
  artifacts: Array<ValidationRepairAuditVerificationArtifact | ValidationRepairAuditObserveInvocationArtifact>,
  now: (() => Date) | undefined,
) {
  return {
    target,
    sourceRef,
    generatedAt: (now ?? (() => new Date()))().toISOString(),
    auditIds: uniqueStrings(artifacts.map((artifact) => artifact.auditId)),
    validationDecisionIds: uniqueStrings(artifacts.map((artifact) => artifact.validationDecisionId)),
    repairDecisionIds: uniqueStrings(artifacts.map((artifact) => artifact.repairDecisionId)),
    contractIds: uniqueStrings(artifacts.map((artifact) => artifact.contractId)),
    failureKindCounts: countStrings(artifacts.map((artifact) => artifact.failureKind)),
    outcomeCounts: countStrings(artifacts.map((artifact) => artifact.outcome)),
    sourceSinkRefs: uniqueStrings(artifacts.map((artifact) => artifact.sourceSinkRef)),
    sinkRefs: uniqueStrings(artifacts.flatMap((artifact) => artifact.sinkRefs)),
    telemetrySpanRefs: uniqueStrings(artifacts.flatMap((artifact) => artifact.telemetrySpanRefs)),
  };
}

function actionResultSubject(artifact: ValidationRepairAuditVerificationArtifact) {
  return artifact.subject?.kind === 'action-result' || artifact.auditRecord.subject.kind === 'action-result';
}

function resolveValidationRepairAuditVerificationArtifactPath(
  options: ValidationRepairAuditVerificationArtifactWriteOptions,
  sinkRecord: ValidationRepairAuditSinkRecord,
) {
  return join(
    resolveValidationRepairAuditVerificationArtifactDir(options),
    `${safeArtifactId(sinkRecord.auditRecord.auditId)}.json`,
  );
}

function resolveValidationRepairAuditObserveInvocationPath(
  options: ValidationRepairAuditObserveInvocationWriteOptions,
  sinkRecord: ValidationRepairAuditSinkRecord,
) {
  return join(
    resolveValidationRepairAuditObserveInvocationDir(options),
    `${safeArtifactId(sinkRecord.ref)}.json`,
  );
}

function resolveValidationRepairAuditVerificationArtifactDir(options: ValidationRepairAuditVerificationArtifactWriteOptions) {
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(options.workspacePath));
  if (!workspaceRoot) throw new Error('workspacePath is required');
  const rawDir = options.artifactDir?.trim() || VALIDATION_REPAIR_AUDIT_VERIFICATION_ARTIFACTS_RELATIVE_DIR;
  const targetDir = isAbsolute(rawDir) ? resolve(rawDir) : resolve(workspaceRoot, rawDir);
  assertInsideWorkspace(workspaceRoot, targetDir);
  return targetDir;
}

function resolveValidationRepairAuditObserveInvocationDir(options: ValidationRepairAuditObserveInvocationWriteOptions) {
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(options.workspacePath));
  if (!workspaceRoot) throw new Error('workspacePath is required');
  const rawDir = options.invocationDir?.trim() || VALIDATION_REPAIR_AUDIT_OBSERVE_INVOCATIONS_RELATIVE_DIR;
  const targetDir = isAbsolute(rawDir) ? resolve(rawDir) : resolve(workspaceRoot, rawDir);
  assertInsideWorkspace(workspaceRoot, targetDir);
  return targetDir;
}

function assertInsideWorkspace(workspacePath: string, targetPath: string) {
  const rel = relative(workspacePath, targetPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Validation repair audit sink refused to write outside the workspace.');
  }
}

function toWorkspaceRef(workspacePath: string, targetPath: string) {
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(workspacePath));
  const rel = relative(workspaceRoot, targetPath).split(sep).join('/');
  return rel || '.';
}

function safeArtifactId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'audit';
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

function countStrings(values: Array<string | undefined>) {
  const counts: Record<string, number> = {};
  for (const value of uniqueStrings(values)) {
    counts[value] = values.filter((candidate) => candidate === value).length;
  }
  return counts;
}

function observeArtifactStatus(
  artifact: ValidationRepairAuditVerificationArtifact | ValidationRepairAuditObserveInvocationArtifact,
) {
  return 'observeInvocation' in artifact ? artifact.observeInvocation?.status : undefined;
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

function observeInvocationRecordsByRef(records: ObserveInvocationRecord[]) {
  const byRef = new Map<string, ObserveInvocationRecord>();
  for (const record of records) {
    for (const ref of uniqueStrings([
      record.callRef,
      `observe-invocation:${record.callRef}`,
      record.traceRef,
      record.traceRef ? `observe-invocation:${record.traceRef}` : undefined,
    ])) {
      if (!byRef.has(ref)) byRef.set(ref, record);
    }
  }
  return byRef;
}

export interface RawDataExecutionGuardFile {
  path: string;
  content?: string;
  language?: string;
}

export interface RawDataExecutionGuardInput {
  taskFiles?: RawDataExecutionGuardFile[];
  artifacts?: unknown[];
  references?: unknown[];
  uiState?: unknown;
  actionSideEffects?: string[];
}

export interface RawDataExecutionGuardResult {
  blocked: boolean;
  rawIntentDetected: boolean;
  reason?: string;
  signals: string[];
  readinessRefs: string[];
  readyDossierRefs: string[];
  approvedScopeSignals: string[];
  taskScopeSignals: string[];
  scopeBound: boolean;
}

const RAW_DATA_ARTIFACT_TYPE = 'raw-data-readiness-dossier';
const READY_STATUS = 'ready';
const APPROVED_STATUS = 'approved';
const PASS_STATUS = 'pass';
const RAW_DATA_GUARD_REASON = 'Raw-data execution was detected before a ready raw-data-readiness-dossier was attached.';
const RAW_DATA_SCOPE_GUARD_REASON = 'Raw-data execution targets are not bound to the approved raw-data-readiness-dossier scope.';
const ACCESSION_PATTERN = /\b(?:GSE|GSM|SRR|SRX|SRA|ERR|ERX|ERP|DRR|DRX|PRJNA|SAMN)\d+\b/gi;

const RAW_TRANSFER_PATTERNS = [
  /\bfasterq-dump\b/i,
  /\bfastq-dump\b/i,
  /\bprefetch\b/i,
  /\bascp\b/i,
  /\bcurl\b.+(?:ftp|https?):\/\//i,
  /\bwget\b.+(?:ftp|https?):\/\//i,
  /\brequests\.(?:get|post)\s*\(/i,
  /\burllib\.request\b/i,
  /\bfetch\s*\(\s*['"](?:ftp|https?):\/\//i,
];

const RAW_DATA_PATTERNS = [
  /\bfastq(?:\.gz)?\b/i,
  /\bbam\b/i,
  /\bcram\b/i,
  /\bsra\b/i,
  /\bbigwig\b/i,
  /\bbed(?:\.gz)?\b/i,
  /\b(?:sra|ena|geo|gse|gsm|srr|srx)\d+\b/i,
  /\bftp\.ncbi\.nlm\.nih\.gov\b/i,
  /\bftp\.sra\.ebi\.ac\.uk\b/i,
];

export function evaluateRawDataPreExecutionGuard(input: RawDataExecutionGuardInput): RawDataExecutionGuardResult {
  const signals = rawDataIntentSignals(input);
  const readyDossiers = readyRawDataDossiers(input);
  const readiness = unique(readyDossiers.flatMap((record) => collectRecordRefs(record)));
  const approvedScopeSignals = unique(readyDossiers.flatMap((record) => approvedScopeFromReadyDossier(record)));
  const taskScopeSignals = rawDataTaskScopeSignals(input);
  const rawIntentDetected = signals.length > 0;
  const scopeBound = !rawIntentDetected || readyDossiers.some((record) => taskScopeIsBoundToApprovedScope(taskScopeSignals, approvedScopeFromReadyDossier(record)));
  const baseResult = {
    rawIntentDetected,
    signals,
    readinessRefs: readiness,
    readyDossierRefs: readiness,
    approvedScopeSignals,
    taskScopeSignals,
    scopeBound,
  };
  if (!rawIntentDetected) {
    return { blocked: false, ...baseResult };
  }
  if (readiness.length === 0) {
    return {
      blocked: true,
      reason: RAW_DATA_GUARD_REASON,
      ...baseResult,
    };
  }
  if (!scopeBound) {
    return {
      blocked: true,
      reason: RAW_DATA_SCOPE_GUARD_REASON,
      ...baseResult,
    };
  }
  return {
    blocked: false,
    ...baseResult,
  };
}

function rawDataIntentSignals(input: RawDataExecutionGuardInput) {
  const signals: string[] = [];
  for (const sideEffect of input.actionSideEffects ?? []) {
    const normalized = sideEffect.toLowerCase();
    if (normalized.includes('raw') && (normalized.includes('download') || normalized.includes('sequencing') || normalized.includes('data'))) {
      signals.push(`side-effect:${sideEffect}`);
    }
  }
  for (const file of input.taskFiles ?? []) {
    const content = file.content ?? '';
    if (!content) continue;
    const hasTransfer = RAW_TRANSFER_PATTERNS.some((pattern) => pattern.test(content));
    const hasRawDataTarget = RAW_DATA_PATTERNS.some((pattern) => pattern.test(content));
    if (hasTransfer && hasRawDataTarget) signals.push(`task-file:${file.path}`);
  }
  return unique(signals);
}

function rawDataTaskScopeSignals(input: RawDataExecutionGuardInput) {
  return unique([
    ...(input.actionSideEffects ?? []).flatMap(extractScopeSignals),
    ...(input.taskFiles ?? []).flatMap((file) => extractScopeSignals(file.content ?? '')),
  ]);
}

function readyRawDataDossiers(input: RawDataExecutionGuardInput) {
  const records = [
    ...(input.artifacts ?? []),
    ...(input.references ?? []),
    input.uiState,
  ].flatMap((value) => collectRecords(value));
  return records
    .map((record) => rawDossierFromRecord(record))
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .filter(isReadyRawDataDossier);
}

function approvedScopeFromReadyDossier(record: Record<string, unknown>) {
  const datasets = arrayRecords(record.datasets);
  const escalation = recordValue(record.n6Escalation);
  return unique([
    ...datasets.flatMap((dataset) => [
      stringValue(dataset.id),
      stringValue(dataset.accession),
      ...collectRecordRefs({ sourceRefs: dataset.sourceRefs, checksumRefs: dataset.checksumRefs }),
    ]),
    ...stringArray(escalation?.requestedFileClasses),
  ].flatMap(extractScopeSignals));
}

function taskScopeIsBoundToApprovedScope(taskScopeSignals: string[], approvedScopeSignals: string[]) {
  const taskTargets = taskScopeSignals.filter((signal) => !isRawFileClassSignal(signal));
  if (taskTargets.length === 0) return false;
  const approved = new Set(approvedScopeSignals);
  return taskTargets.every((signal) => approved.has(signal));
}

function rawDossierFromRecord(record: Record<string, unknown>) {
  if (stringValue(record.artifactType) === RAW_DATA_ARTIFACT_TYPE) return record;
  const data = recordValue(record.data);
  return data && stringValue(data.artifactType) === RAW_DATA_ARTIFACT_TYPE ? data : undefined;
}

function isReadyRawDataDossier(record: Record<string, unknown>) {
  const gate = recordValue(record.rawExecutionGate) ?? {};
  const datasets = arrayRecords(record.datasets);
  const checks = arrayRecords(record.readinessChecks);
  const budget = recordValue(record.computeBudget) ?? {};
  const environment = recordValue(record.environment) ?? {};
  return stringValue(record.rawExecutionStatus).toLowerCase() === READY_STATUS
    && stringValue(record.approvalStatus).toLowerCase() === APPROVED_STATUS
    && gate.allowed === true
    && checks.length > 0
    && checks.every((check) => stringValue(check.status).toLowerCase() === PASS_STATUS)
    && datasets.length > 0
    && datasets.every((dataset) => hasDatasetReadyFields(dataset, budget))
    && positiveNumber(budget.maxCpuHours)
    && positiveNumber(budget.maxMemoryGb)
    && positiveNumber(budget.maxWallHours)
    && collectRecordRefs(budget).length > 0
    && refArray(environment.toolVersionRefs).length > 0
    && refArray(environment.environmentLockRefs).length > 0
    && refArray(environment.genomeCacheRefs).length > 0
    && stringValue(record.degradationStrategy).length > 0;
}

function hasDatasetReadyFields(dataset: Record<string, unknown>, budget: Record<string, unknown>) {
  const download = finiteNumber(dataset.estimatedDownloadBytes);
  const storage = finiteNumber(dataset.estimatedStorageBytes);
  return stringValue(dataset.accession).length > 0
    && stringValue(dataset.database).length > 0
    && refArray(dataset.sourceRefs).length > 0
    && ['verified', 'approved'].includes(stringValue(dataset.licenseStatus).toLowerCase())
    && refArray(dataset.checksumRefs).length > 0
    && download !== undefined
    && storage !== undefined
    && download <= (finiteNumber(budget.maxDownloadBytes) ?? -1)
    && storage <= (finiteNumber(budget.maxStorageBytes) ?? -1);
}

function collectRecords(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => collectRecords(entry, depth + 1));
  if (!isRecord(value)) return [];
  return [value, ...Object.values(value).flatMap((entry) => collectRecords(entry, depth + 1))];
}

function collectRecordRefs(record: Record<string, unknown>) {
  const refs: string[] = [];
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) refs.push(...value.flatMap((entry) => isRecord(entry) ? collectRecordRefs(entry) : []));
    else if (isRecord(value)) {
      if (typeof value.ref === 'string' && value.ref.trim()) refs.push(value.ref.trim());
      refs.push(...collectRecordRefs(value));
    }
  }
  return unique(refs);
}

function extractScopeSignals(value: unknown) {
  if (typeof value !== 'string') return [];
  const normalized = value.toLowerCase();
  const signals = [
    ...Array.from(value.matchAll(ACCESSION_PATTERN)).map((match) => match[0]),
  ];
  for (const fileClass of ['fastq', 'bam', 'cram', 'sra', 'bigwig', 'bed']) {
    if (new RegExp(`\\b${fileClass}(?:\\.gz)?\\b`, 'i').test(normalized)) signals.push(fileClass);
  }
  return unique(signals.map((signal) => signal.toLowerCase()));
}

function isRawFileClassSignal(value: string) {
  return ['fastq', 'bam', 'cram', 'sra', 'bigwig', 'bed'].includes(value);
}

function refArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry) => isRecord(entry) && typeof entry.ref === 'string' && entry.ref.trim())
    : [];
}

function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

import type { RuntimeExecutionUnit } from './execution';

export const TASK_RUN_CARD_SCHEMA_VERSION = 'sciforge.task-run-card.v1' as const;
export const FAILURE_SIGNATURE_SCHEMA_VERSION = 'sciforge.failure-signature.v1' as const;
export const FAILURE_SIGNATURE_REGISTRY_SCHEMA_VERSION = 'sciforge.failure-signature-registry.v1' as const;
export const NO_HARDCODE_REVIEW_SCHEMA_VERSION = 'sciforge.no-hardcode-review.v1' as const;

export type TaskProtocolStatus = 'not-run' | 'running' | 'protocol-success' | 'protocol-failed' | 'cancelled';
export type TaskOutcomeStatus = 'satisfied' | 'needs-work' | 'needs-human' | 'blocked' | 'unknown';
export type TaskRunCardStatus = 'running' | 'complete' | 'partial' | 'needs-work' | 'needs-human' | 'failed' | 'cancelled' | 'not-run';
export type TaskRunCardRefKind = 'session' | 'run' | 'artifact' | 'execution-unit' | 'verification' | 'log' | 'file' | 'screenshot' | 'bundle' | 'other';
export type TaskRoundStatus = 'passed' | 'partial' | 'failed' | 'needs-human' | 'not-run';
export type TaskAttributionLayer =
  | 'harness'
  | 'runtime-server'
  | 'agentserver-parser'
  | 'payload-normalization'
  | 'presentation'
  | 'verification'
  | 'resume'
  | 'ui'
  | 'external-provider'
  | 'workspace'
  | 'unknown';
export type FailureSignatureKind =
  | 'schema-drift'
  | 'timeout'
  | 'repair-no-op'
  | 'external-transient'
  | 'missing-ref'
  | 'validation-failure'
  | 'user-cancelled'
  | 'backend-handoff'
  | 'unknown';
export type FailureSignatureRegistryKind = Extract<FailureSignatureKind, 'schema-drift' | 'timeout' | 'repair-no-op' | 'external-transient'>;

export const FAILURE_SIGNATURE_REGISTRY_TRACKED_KINDS: FailureSignatureRegistryKind[] = [
  'schema-drift',
  'timeout',
  'repair-no-op',
  'external-transient',
];

export interface TaskRunCardRef {
  kind: TaskRunCardRefKind;
  ref: string;
  label?: string;
  status?: string;
}

export interface TaskRunCardRound {
  round: number;
  prompt?: string;
  expected?: string;
  observed?: string;
  status: TaskRoundStatus;
  refs: TaskRunCardRef[];
}

export interface FailureSignatureInput {
  kind?: FailureSignatureKind;
  layer?: TaskAttributionLayer;
  message?: string;
  code?: string;
  httpStatus?: number;
  providerId?: string;
  operation?: string;
  schemaPath?: string;
  retryable?: boolean;
  refs?: string[];
}

export interface FailureSignature {
  schemaVersion: typeof FAILURE_SIGNATURE_SCHEMA_VERSION;
  id: string;
  kind: FailureSignatureKind;
  dedupeKey: string;
  layer: TaskAttributionLayer;
  retryable: boolean;
  message: string;
  normalizedMessage: string;
  providerId?: string;
  operation?: string;
  code?: string;
  httpStatus?: number;
  schemaPath?: string;
  refs: string[];
}

export interface FailureSignatureRunRef {
  runId: string;
  taskId?: string;
  attempt?: number;
  status?: string;
  createdAt?: string;
  sessionId?: string;
  sessionBundleRef?: string;
  refs: string[];
}

export interface FailureSignatureRegistryEntry {
  id: string;
  kind: FailureSignatureRegistryKind;
  dedupeKey: string;
  signatureIds: string[];
  signatureDedupeKeys: string[];
  layer: TaskAttributionLayer;
  retryable: boolean;
  message: string;
  normalizedMessage: string;
  providerIds: string[];
  operations: string[];
  codes: string[];
  httpStatuses: number[];
  schemaPaths: string[];
  refs: string[];
  runRefs: FailureSignatureRunRef[];
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface FailureSignatureRegistry {
  schemaVersion: typeof FAILURE_SIGNATURE_REGISTRY_SCHEMA_VERSION;
  updatedAt: string;
  entries: FailureSignatureRegistryEntry[];
}

export interface FailureSignatureRegistryRunInput {
  runId: string;
  taskId?: string;
  attempt?: number;
  status?: string;
  createdAt?: string;
  sessionId?: string;
  sessionBundleRef?: string;
  refs?: string[];
  failureSignatures: Array<FailureSignature | FailureSignatureInput>;
}

export interface NoHardcodeReview {
  schemaVersion: typeof NO_HARDCODE_REVIEW_SCHEMA_VERSION;
  appliesGenerally: boolean;
  generalityStatement: string;
  counterExamples: string[];
  forbiddenSpecialCases: string[];
  ownerLayer: TaskAttributionLayer;
  status: 'pass' | 'needs-review' | 'fail';
}

export interface TaskRunCardInput {
  id?: string;
  taskId?: string;
  title?: string;
  goal: string;
  protocolStatus?: TaskProtocolStatus;
  taskOutcome?: TaskOutcomeStatus;
  rounds?: Array<Partial<TaskRunCardRound>>;
  refs?: TaskRunCardRef[];
  executionUnits?: RuntimeExecutionUnit[];
  verificationRefs?: string[];
  failureSignatures?: Array<FailureSignature | FailureSignatureInput>;
  genericAttributionLayer?: TaskAttributionLayer;
  nextStep?: string;
  noHardcodeReview?: Partial<NoHardcodeReview>;
  updatedAt?: string;
}

export interface TaskRunCard {
  schemaVersion: typeof TASK_RUN_CARD_SCHEMA_VERSION;
  id: string;
  taskId?: string;
  title?: string;
  goal: string;
  status: TaskRunCardStatus;
  protocolStatus: TaskProtocolStatus;
  taskOutcome: TaskOutcomeStatus;
  rounds: TaskRunCardRound[];
  refs: TaskRunCardRef[];
  executionUnitRefs: string[];
  verificationRefs: string[];
  failureSignatures: FailureSignature[];
  genericAttributionLayer: TaskAttributionLayer;
  nextStep: string;
  noHardcodeReview: NoHardcodeReview;
  updatedAt: string;
}

const TRANSIENT_EXTERNAL_PATTERN = /\b(?:http(?:\s+error)?\s*(?:408|425|429|500|502|503|504)|too many requests|rate.?limit(?:ed)?|quota|throttl|temporar(?:y|ily)|timeout|timed out|econnreset|etimedout|eai_again|enotfound|network is unreachable|service unavailable)\b/i;
const EXTERNAL_TRANSIENT_CONTEXT_PATTERN = /\b(?:http|provider|external|network|dns|quota|rate.?limit(?:ed)?|too many requests|throttl|econnreset|etimedout|eai_again|enotfound|service unavailable)\b/i;

export function createFailureSignature(input: FailureSignatureInput): FailureSignature {
  const message = stringField(input.message) ?? stringField(input.code) ?? 'Unclassified failure.';
  const normalizedMessage = normalizeFailureMessage(message);
  const kind = input.kind ?? inferFailureSignatureKind(input, normalizedMessage);
  const layer = input.layer ?? layerForFailureSignatureKind(kind);
  const retryable = typeof input.retryable === 'boolean' ? input.retryable : defaultRetryableForFailure(kind);
  const dedupeParts = [
    kind,
    layer,
    stringField(input.providerId) ?? '',
    stringField(input.operation) ?? '',
    stringField(input.schemaPath) ?? '',
    input.httpStatus === undefined ? '' : String(input.httpStatus),
    normalizedMessage,
  ];
  const dedupeKey = stableKey(dedupeParts);
  return {
    schemaVersion: FAILURE_SIGNATURE_SCHEMA_VERSION,
    id: `failure:${dedupeKey}`,
    kind,
    dedupeKey,
    layer,
    retryable,
    message,
    normalizedMessage,
    providerId: stringField(input.providerId),
    operation: stringField(input.operation),
    code: stringField(input.code),
    httpStatus: numberField(input.httpStatus),
    schemaPath: stringField(input.schemaPath),
    refs: uniqueStrings(input.refs ?? []),
  };
}

export function createTaskRunCard(input: TaskRunCardInput): TaskRunCard {
  const protocolStatus = input.protocolStatus ?? inferProtocolStatus(input);
  const taskOutcome = input.taskOutcome ?? inferTaskOutcome(protocolStatus, input);
  const status = taskRunCardStatus(protocolStatus, taskOutcome);
  const failureSignatures = dedupeFailureSignatures((input.failureSignatures ?? []).map((signature) => {
    return isFailureSignature(signature) ? signature : createFailureSignature(signature);
  }));
  const executionUnitRefs = uniqueStrings([
    ...(input.executionUnits ?? []).map((unit) => unit.id ? `execution-unit:${unit.id}` : undefined).filter(isString),
    ...refsOfKind(input.refs ?? [], 'execution-unit'),
  ]);
  const refs = uniqueRefs([
    ...(input.refs ?? []),
    ...executionUnitRefs.map((ref): TaskRunCardRef => ({ kind: 'execution-unit', ref })),
    ...uniqueStrings(input.verificationRefs ?? []).map((ref): TaskRunCardRef => ({ kind: 'verification', ref })),
  ]);
  const genericAttributionLayer = input.genericAttributionLayer
    ?? failureSignatures[0]?.layer
    ?? inferAttributionLayerFromExecutionUnits(input.executionUnits ?? []);

  return {
    schemaVersion: TASK_RUN_CARD_SCHEMA_VERSION,
    id: stringField(input.id) ?? `task-card:${stableKey([input.taskId ?? '', input.goal, refs.map((ref) => ref.ref).join('|')])}`,
    taskId: stringField(input.taskId),
    title: stringField(input.title),
    goal: input.goal.trim(),
    status,
    protocolStatus,
    taskOutcome,
    rounds: normalizeRounds(input.rounds ?? []),
    refs,
    executionUnitRefs,
    verificationRefs: uniqueStrings(input.verificationRefs ?? []),
    failureSignatures,
    genericAttributionLayer,
    nextStep: stringField(input.nextStep) ?? defaultNextStep(status, failureSignatures),
    noHardcodeReview: createNoHardcodeReview(input.noHardcodeReview, genericAttributionLayer),
    updatedAt: stringField(input.updatedAt) ?? new Date(0).toISOString(),
  };
}

export function createFailureSignatureRegistry(input: Partial<FailureSignatureRegistry> = {}): FailureSignatureRegistry {
  return {
    schemaVersion: FAILURE_SIGNATURE_REGISTRY_SCHEMA_VERSION,
    updatedAt: stringField(input.updatedAt) ?? new Date(0).toISOString(),
    entries: dedupeRegistryEntries(input.entries ?? []),
  };
}

export function mergeFailureSignaturesIntoRegistry(
  registry: FailureSignatureRegistry | undefined,
  input: FailureSignatureRegistryRunInput,
): FailureSignatureRegistry {
  const base = createFailureSignatureRegistry(registry);
  const runRef = normalizeFailureSignatureRunRef(input);
  const byKey = new Map(base.entries.map((entry) => [entry.dedupeKey, entry]));
  for (const signatureInput of input.failureSignatures) {
    const signature = isFailureSignature(signatureInput) ? signatureInput : createFailureSignature(signatureInput);
    if (!isTrackedFailureSignature(signature)) continue;
    const dedupeKey = failureSignatureRegistryDedupeKey(signature);
    const current = byKey.get(dedupeKey);
    byKey.set(dedupeKey, current
      ? mergeRegistryEntry(current, signature, runRef)
      : createRegistryEntry(signature, dedupeKey, runRef));
  }
  const entries = [...byKey.values()].sort((left, right) => left.dedupeKey.localeCompare(right.dedupeKey));
  return {
    schemaVersion: FAILURE_SIGNATURE_REGISTRY_SCHEMA_VERSION,
    updatedAt: maxIsoString([base.updatedAt, input.createdAt, ...entries.map((entry) => entry.lastSeenAt)]) ?? new Date(0).toISOString(),
    entries,
  };
}

export function validateFailureSignatureRegistry(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ['FailureSignatureRegistry must be an object.'];
  if (value.schemaVersion !== FAILURE_SIGNATURE_REGISTRY_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${FAILURE_SIGNATURE_REGISTRY_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(value.entries)) issues.push('entries must be an array.');
  for (const [index, entry] of Array.isArray(value.entries) ? value.entries.entries() : []) {
    if (!isRecord(entry)) {
      issues.push(`entries[${index}] must be an object.`);
      continue;
    }
    if (!stringField(entry.id)) issues.push(`entries[${index}].id is required.`);
    if (!isFailureSignatureRegistryKind(entry.kind)) issues.push(`entries[${index}].kind is not tracked by the run-level registry.`);
    if (!stringField(entry.dedupeKey)) issues.push(`entries[${index}].dedupeKey is required.`);
    if (!Array.isArray(entry.runRefs)) issues.push(`entries[${index}].runRefs must be an array.`);
    if (typeof entry.occurrenceCount !== 'number') issues.push(`entries[${index}].occurrenceCount must be a number.`);
  }
  return issues;
}

export function taskRunCardStatus(protocolStatus: TaskProtocolStatus, taskOutcome: TaskOutcomeStatus): TaskRunCardStatus {
  if (protocolStatus === 'running') return 'running';
  if (protocolStatus === 'not-run') return 'not-run';
  if (protocolStatus === 'cancelled') return 'cancelled';
  if (taskOutcome === 'needs-human') return 'needs-human';
  if (taskOutcome === 'blocked') return 'failed';
  if (taskOutcome === 'needs-work') return protocolStatus === 'protocol-success' ? 'needs-work' : 'partial';
  if (taskOutcome === 'satisfied') return protocolStatus === 'protocol-success' ? 'complete' : 'partial';
  return protocolStatus === 'protocol-failed' ? 'failed' : 'partial';
}

export function validateTaskRunCard(card: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(card)) return ['TaskRunCard must be an object.'];
  if (card.schemaVersion !== TASK_RUN_CARD_SCHEMA_VERSION) issues.push(`schemaVersion must be ${TASK_RUN_CARD_SCHEMA_VERSION}.`);
  if (!stringField(card.id)) issues.push('id is required.');
  if (!stringField(card.goal)) issues.push('goal is required.');
  if (!['running', 'complete', 'partial', 'needs-work', 'needs-human', 'failed', 'cancelled', 'not-run'].includes(String(card.status))) issues.push('status is invalid.');
  if (card.protocolStatus === 'protocol-success' && card.taskOutcome === 'needs-work' && card.status !== 'needs-work') {
    issues.push('protocol success with unmet user goal must be status=needs-work.');
  }
  if (!Array.isArray(card.refs)) issues.push('refs must be an array.');
  if (!Array.isArray(card.failureSignatures)) issues.push('failureSignatures must be an array.');
  if (isRecord(card.noHardcodeReview) && card.noHardcodeReview.status === 'pass' && card.noHardcodeReview.appliesGenerally !== true) {
    issues.push('passing noHardcodeReview must apply generally.');
  }
  return issues;
}

function createNoHardcodeReview(input: Partial<NoHardcodeReview> | undefined, ownerLayer: TaskAttributionLayer): NoHardcodeReview {
  const appliesGenerally = input?.appliesGenerally === true;
  const counterExamples = uniqueStrings(input?.counterExamples ?? []);
  const forbiddenSpecialCases = uniqueStrings(input?.forbiddenSpecialCases ?? [
    'prompt-specific branch',
    'paper-title-specific branch',
    'artifact-name-specific branch',
    'backend-specific success path',
  ]);
  const hasStatement = Boolean(stringField(input?.generalityStatement));
  const status = input?.status ?? (appliesGenerally && hasStatement && counterExamples.length > 0 ? 'pass' : 'needs-review');
  return {
    schemaVersion: NO_HARDCODE_REVIEW_SCHEMA_VERSION,
    appliesGenerally,
    generalityStatement: stringField(input?.generalityStatement) ?? 'General applicability has not been reviewed yet.',
    counterExamples,
    forbiddenSpecialCases,
    ownerLayer: input?.ownerLayer ?? ownerLayer,
    status,
  };
}

function inferProtocolStatus(input: TaskRunCardInput): TaskProtocolStatus {
  if (input.rounds?.some((round) => round.status === 'failed')) return 'protocol-failed';
  if (input.executionUnits?.some((unit) => unit.status === 'running' || unit.status === 'planned')) return 'running';
  if (input.executionUnits?.some((unit) => unit.status === 'failed' || unit.status === 'failed-with-reason' || unit.status === 'repair-needed')) return 'protocol-failed';
  if (input.rounds?.length || input.executionUnits?.length || input.refs?.length) return 'protocol-success';
  return 'not-run';
}

function inferTaskOutcome(protocolStatus: TaskProtocolStatus, input: TaskRunCardInput): TaskOutcomeStatus {
  if (protocolStatus === 'running' || protocolStatus === 'not-run') return 'unknown';
  if (protocolStatus === 'cancelled') return 'blocked';
  if (input.executionUnits?.some((unit) => unit.status === 'needs-human')) return 'needs-human';
  if ((input.failureSignatures ?? []).some((signature) => (isFailureSignature(signature) ? signature.kind : signature.kind) === 'external-transient')) return 'needs-human';
  if (protocolStatus === 'protocol-failed') return input.refs?.length || input.rounds?.some((round) => round.status === 'partial') ? 'needs-work' : 'blocked';
  return 'satisfied';
}

function inferFailureSignatureKind(input: FailureSignatureInput, normalizedMessage: string): FailureSignatureKind {
  const joined = [input.code, normalizedMessage, input.schemaPath].filter(Boolean).join(' ');
  if ((TRANSIENT_EXTERNAL_PATTERN.test(joined) && EXTERNAL_TRANSIENT_CONTEXT_PATTERN.test(joined))
    || (input.httpStatus !== undefined && [408, 425, 429, 500, 502, 503, 504].includes(input.httpStatus))) return 'external-transient';
  if (/\btimeout|timed out|deadline\b/i.test(joined)) return 'timeout';
  if (/\brepair\b.*\b(no.?op|no change|same failure|repeated)\b/i.test(joined)) return 'repair-no-op';
  if (/\bschema|payload|missing field|invalid json|fenced json|contract\b/i.test(joined)) return 'schema-drift';
  if (/\bmissing ref|stale ref|not found|deleted artifact\b/i.test(joined)) return 'missing-ref';
  if (/\bvalidation|verifier|verification\b/i.test(joined)) return 'validation-failure';
  if (/\bcancelled|canceled|user abort\b/i.test(joined)) return 'user-cancelled';
  if (/\bbackend|handoff|agentserver\b/i.test(joined)) return 'backend-handoff';
  return 'unknown';
}

function layerForFailureSignatureKind(kind: FailureSignatureKind): TaskAttributionLayer {
  if (kind === 'schema-drift') return 'payload-normalization';
  if (kind === 'external-transient') return 'external-provider';
  if (kind === 'timeout' || kind === 'repair-no-op') return 'runtime-server';
  if (kind === 'validation-failure') return 'verification';
  if (kind === 'missing-ref') return 'resume';
  if (kind === 'backend-handoff') return 'agentserver-parser';
  return 'unknown';
}

function defaultRetryableForFailure(kind: FailureSignatureKind) {
  return kind === 'external-transient' || kind === 'timeout' || kind === 'missing-ref';
}

function inferAttributionLayerFromExecutionUnits(units: RuntimeExecutionUnit[]): TaskAttributionLayer {
  if (units.some((unit) => isRecord(unit) && unit.externalDependencyStatus === 'transient-unavailable')) return 'external-provider';
  if (units.some((unit) => unit.verificationVerdict === 'fail' || unit.verificationVerdict === 'uncertain')) return 'verification';
  if (units.some((unit) => unit.outputRef || unit.stdoutRef || unit.stderrRef)) return 'runtime-server';
  return 'unknown';
}

function defaultNextStep(status: TaskRunCardStatus, failures: FailureSignature[]) {
  if (status === 'complete') return 'No immediate follow-up required; preserve refs for audit or export.';
  if (failures.some((failure) => failure.kind === 'external-transient')) return 'Retry after provider backoff, or continue with cached evidence and label freshness explicitly.';
  if (status === 'needs-human') return 'Ask for missing approval, evidence, or recovery direction before continuing side effects.';
  if (status === 'needs-work' || status === 'partial') return 'Continue from preserved refs and repair the generic failing layer before rerunning expensive work.';
  if (status === 'failed') return 'Inspect failure signatures, stdout/stderr refs, and recover actions before rerun.';
  return 'Record current state and resume when the next user goal is clear.';
}

function normalizeRounds(rounds: Array<Partial<TaskRunCardRound>>): TaskRunCardRound[] {
  return rounds.map((round, index) => ({
    round: typeof round.round === 'number' ? round.round : index + 1,
    prompt: stringField(round.prompt),
    expected: stringField(round.expected),
    observed: stringField(round.observed),
    status: round.status ?? 'not-run',
    refs: uniqueRefs(round.refs ?? []),
  }));
}

function dedupeFailureSignatures(signatures: FailureSignature[]) {
  const byKey = new Map<string, FailureSignature>();
  for (const signature of signatures) byKey.set(signature.dedupeKey, signature);
  return [...byKey.values()].sort((left, right) => left.dedupeKey.localeCompare(right.dedupeKey));
}

function failureSignatureRegistryDedupeKey(signature: FailureSignature) {
  const parts = [
    signature.kind,
    registryCategoryForFailureSignature(signature),
    signature.schemaPath ?? '',
    signature.code ?? '',
  ];
  return stableKey(parts);
}

function registryCategoryForFailureSignature(signature: FailureSignature) {
  const text = `${signature.code ?? ''} ${signature.normalizedMessage}`.toLowerCase();
  if (signature.kind === 'external-transient') {
    if (signature.httpStatus !== undefined) return `http-${signature.httpStatus}`;
    if (/\b(?:429|too many requests|rate.?limit(?:ed)?|throttl)\b/i.test(text)) return 'rate-limit';
    if (/\b(?:quota)\b/i.test(text)) return 'quota';
    if (/\b(?:eai_again|enotfound|dns|network is unreachable|econnreset)\b/i.test(text)) return 'network';
    if (/\b(?:408|timeout|timed out|etimedout)\b/i.test(text)) return 'external-timeout';
    if (/\b(?:500|502|503|504|service unavailable)\b/i.test(text)) return 'service-unavailable';
    return signature.normalizedMessage;
  }
  if (signature.kind === 'schema-drift') return signature.normalizedMessage;
  if (signature.kind === 'timeout') return signature.normalizedMessage;
  if (signature.kind === 'repair-no-op') return signature.normalizedMessage;
  return signature.dedupeKey;
}

function createRegistryEntry(
  signature: FailureSignature & { kind: FailureSignatureRegistryKind },
  dedupeKey: string,
  runRef: FailureSignatureRunRef,
): FailureSignatureRegistryEntry {
  return {
    id: `failure-registry:${dedupeKey}`,
    kind: signature.kind,
    dedupeKey,
    signatureIds: uniqueStrings([signature.id]),
    signatureDedupeKeys: uniqueStrings([signature.dedupeKey]),
    layer: signature.layer,
    retryable: signature.retryable,
    message: signature.message,
    normalizedMessage: signature.normalizedMessage,
    providerIds: uniqueStrings([signature.providerId].filter(isString)),
    operations: uniqueStrings([signature.operation].filter(isString)),
    codes: uniqueStrings([signature.code].filter(isString)),
    httpStatuses: uniqueNumbers([signature.httpStatus].filter(numberFieldIsPresent)),
    schemaPaths: uniqueStrings([signature.schemaPath].filter(isString)),
    refs: uniqueStrings(signature.refs),
    runRefs: [runRef],
    occurrenceCount: 1,
    firstSeenAt: runRef.createdAt ?? new Date(0).toISOString(),
    lastSeenAt: runRef.createdAt ?? new Date(0).toISOString(),
  };
}

function mergeRegistryEntry(
  entry: FailureSignatureRegistryEntry,
  signature: FailureSignature & { kind: FailureSignatureRegistryKind },
  runRef: FailureSignatureRunRef,
): FailureSignatureRegistryEntry {
  const runRefs = uniqueRunRefs([...entry.runRefs, runRef]);
  const seenDates = runRefs.map((ref) => ref.createdAt).filter(isString);
  return {
    ...entry,
    signatureIds: uniqueStrings([...entry.signatureIds, signature.id]),
    signatureDedupeKeys: uniqueStrings([...entry.signatureDedupeKeys, signature.dedupeKey]),
    retryable: entry.retryable || signature.retryable,
    providerIds: uniqueStrings([...entry.providerIds, signature.providerId].filter(isString)),
    operations: uniqueStrings([...entry.operations, signature.operation].filter(isString)),
    codes: uniqueStrings([...entry.codes, signature.code].filter(isString)),
    httpStatuses: uniqueNumbers([...entry.httpStatuses, signature.httpStatus].filter(numberFieldIsPresent)),
    schemaPaths: uniqueStrings([...entry.schemaPaths, signature.schemaPath].filter(isString)),
    refs: uniqueStrings([...entry.refs, ...signature.refs]),
    runRefs,
    occurrenceCount: runRefs.length,
    firstSeenAt: minIsoString(seenDates) ?? entry.firstSeenAt,
    lastSeenAt: maxIsoString(seenDates) ?? entry.lastSeenAt,
  };
}

function normalizeFailureSignatureRunRef(input: FailureSignatureRegistryRunInput): FailureSignatureRunRef {
  return {
    runId: input.runId.trim(),
    taskId: stringField(input.taskId),
    attempt: typeof input.attempt === 'number' && Number.isFinite(input.attempt) ? input.attempt : undefined,
    status: stringField(input.status),
    createdAt: stringField(input.createdAt),
    sessionId: stringField(input.sessionId),
    sessionBundleRef: stringField(input.sessionBundleRef),
    refs: uniqueStrings(input.refs ?? []),
  };
}

function dedupeRegistryEntries(entries: FailureSignatureRegistryEntry[]) {
  const byKey = new Map<string, FailureSignatureRegistryEntry>();
  for (const entry of entries) {
    if (!isRecord(entry) || !stringField(entry.dedupeKey) || !isFailureSignatureRegistryKind(entry.kind)) continue;
    const runRefs = uniqueRunRefs(Array.isArray(entry.runRefs) ? entry.runRefs.filter(isFailureSignatureRunRef) : []);
    byKey.set(entry.dedupeKey, {
      ...entry,
      signatureIds: uniqueStrings(entry.signatureIds ?? []),
      signatureDedupeKeys: uniqueStrings(entry.signatureDedupeKeys ?? []),
      providerIds: uniqueStrings(entry.providerIds ?? []),
      operations: uniqueStrings(entry.operations ?? []),
      codes: uniqueStrings(entry.codes ?? []),
      httpStatuses: uniqueNumbers(entry.httpStatuses ?? []),
      schemaPaths: uniqueStrings(entry.schemaPaths ?? []),
      refs: uniqueStrings(entry.refs ?? []),
      runRefs,
      occurrenceCount: runRefs.length,
    });
  }
  return [...byKey.values()].sort((left, right) => left.dedupeKey.localeCompare(right.dedupeKey));
}

function uniqueRunRefs(refs: FailureSignatureRunRef[]) {
  const byId = new Map<string, FailureSignatureRunRef>();
  for (const ref of refs) {
    if (!ref.runId.trim()) continue;
    const current = byId.get(ref.runId);
    byId.set(ref.runId, {
      ...current,
      ...ref,
      refs: uniqueStrings([...(current?.refs ?? []), ...ref.refs]),
    });
  }
  return [...byId.values()].sort((left, right) => left.runId.localeCompare(right.runId));
}

function isFailureSignatureRegistryKind(value: unknown): value is FailureSignatureRegistryKind {
  return FAILURE_SIGNATURE_REGISTRY_TRACKED_KINDS.includes(value as FailureSignatureRegistryKind);
}

function isTrackedFailureSignature(signature: FailureSignature): signature is FailureSignature & { kind: FailureSignatureRegistryKind } {
  return isFailureSignatureRegistryKind(signature.kind);
}

function isFailureSignatureRunRef(value: unknown): value is FailureSignatureRunRef {
  return isRecord(value) && typeof value.runId === 'string' && Array.isArray(value.refs);
}

function minIsoString(values: string[]) {
  return values.filter(isString).sort()[0];
}

function maxIsoString(values: Array<string | undefined>) {
  return values.filter(isString).sort().at(-1);
}

function refsOfKind(refs: TaskRunCardRef[], kind: TaskRunCardRefKind) {
  return refs.filter((ref) => ref.kind === kind).map((ref) => ref.ref);
}

function uniqueRefs(refs: TaskRunCardRef[]) {
  const byKey = new Map<string, TaskRunCardRef>();
  for (const ref of refs) {
    if (!ref.ref) continue;
    byKey.set(`${ref.kind}:${ref.ref}`, ref);
  }
  return [...byKey.values()].sort((left, right) => `${left.kind}:${left.ref}`.localeCompare(`${right.kind}:${right.ref}`));
}

function normalizeFailureMessage(value: string) {
  return value
    .toLowerCase()
    .replace(/\b[0-9a-f]{8,}\b/g, '<hash>')
    .replace(/\b\d{4}-\d{2}-\d{2}t\S+\b/g, '<timestamp>')
    .replace(/\d+(?:\.\d+)?/g, '<num>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function stableKey(parts: string[]) {
  return hashText(parts.map((part) => part.trim().toLowerCase()).join('|')).slice(0, 12);
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  return Math.abs(hash).toString(36);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))].sort();
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function numberFieldIsPresent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.filter(numberFieldIsPresent))].sort((left, right) => left - right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFailureSignature(value: unknown): value is FailureSignature {
  return isRecord(value) && value.schemaVersion === FAILURE_SIGNATURE_SCHEMA_VERSION && typeof value.dedupeKey === 'string';
}

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
export type OwnershipLayerSuggestionConfidence = 'high' | 'medium' | 'low';
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

export const TASK_ATTRIBUTION_LAYERS: TaskAttributionLayer[] = [
  'harness',
  'runtime-server',
  'agentserver-parser',
  'payload-normalization',
  'presentation',
  'verification',
  'resume',
  'ui',
  'external-provider',
  'workspace',
  'unknown',
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

export interface OwnershipLayerSuggestion {
  layer: TaskAttributionLayer;
  confidence: OwnershipLayerSuggestionConfidence;
  reason: string;
  signals: string[];
  nextStep: string;
}

export interface TaskRunCardConversationProjectionSummary {
  schemaVersion: 'sciforge.task-run-card.conversation-projection-summary.v1';
  conversationId: string;
  status: string;
  activeRunId?: string;
  failureOwner?: {
    ownerLayer: TaskAttributionLayer | string;
    action?: string;
    retryable?: boolean;
    reason: string;
    evidenceRefs: string[];
    nextStep?: string;
  };
  recoverActions: string[];
  verificationState?: {
    status: string;
    verifierRef?: string;
    verdict?: string;
  };
  backgroundState?: {
    status: string;
    checkpointRefs: string[];
    revisionPlan?: string;
  };
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
  ownershipLayerSuggestions?: Array<Partial<OwnershipLayerSuggestion>>;
  nextStep?: string;
  conversationProjectionRef?: string;
  conversationProjectionSummary?: Partial<TaskRunCardConversationProjectionSummary>;
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
  ownershipLayerSuggestions: OwnershipLayerSuggestion[];
  nextStep: string;
  conversationProjectionRef?: string;
  conversationProjectionSummary?: TaskRunCardConversationProjectionSummary;
  noHardcodeReview: NoHardcodeReview;
  updatedAt: string;
}

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
    ...(stringField(input.conversationProjectionRef)
      ? [{ kind: 'other' as const, ref: stringField(input.conversationProjectionRef) as string, label: 'conversation projection' }]
      : []),
  ]);
  const genericAttributionLayer = input.genericAttributionLayer
    ?? failureSignatures[0]?.layer
    ?? inferAttributionLayerFromExecutionUnits(input.executionUnits ?? []);
  const nextStep = stringField(input.nextStep) ?? defaultNextStep(status, failureSignatures);
  const ownershipLayerSuggestions = normalizeOwnershipLayerSuggestions(input.ownershipLayerSuggestions, {
    status,
    protocolStatus,
    taskOutcome,
    genericAttributionLayer,
    nextStep,
    refs,
    failureSignatures,
    executionUnits: input.executionUnits ?? [],
    verificationRefs: input.verificationRefs ?? [],
  });

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
    ownershipLayerSuggestions,
    nextStep,
    conversationProjectionRef: stringField(input.conversationProjectionRef),
    conversationProjectionSummary: normalizeConversationProjectionSummary(input.conversationProjectionSummary),
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
  if (card.conversationProjectionSummary !== undefined) {
    if (!isRecord(card.conversationProjectionSummary)) {
      issues.push('conversationProjectionSummary must be an object when present.');
    } else {
      if (!stringField(card.conversationProjectionSummary.conversationId)) issues.push('conversationProjectionSummary.conversationId is required.');
      if (!stringField(card.conversationProjectionSummary.status)) issues.push('conversationProjectionSummary.status is required.');
      if (!Array.isArray(card.conversationProjectionSummary.recoverActions)) issues.push('conversationProjectionSummary.recoverActions must be an array.');
    }
  }
  if (card.ownershipLayerSuggestions !== undefined && !Array.isArray(card.ownershipLayerSuggestions)) {
    issues.push('ownershipLayerSuggestions must be an array when present.');
  }
  for (const [index, suggestion] of Array.isArray(card.ownershipLayerSuggestions) ? card.ownershipLayerSuggestions.entries() : []) {
    if (!isRecord(suggestion)) {
      issues.push(`ownershipLayerSuggestions[${index}] must be an object.`);
      continue;
    }
    if (!isTaskAttributionLayer(suggestion.layer)) issues.push(`ownershipLayerSuggestions[${index}].layer is invalid.`);
    if (!['high', 'medium', 'low'].includes(String(suggestion.confidence))) issues.push(`ownershipLayerSuggestions[${index}].confidence is invalid.`);
    if (!stringField(suggestion.reason)) issues.push(`ownershipLayerSuggestions[${index}].reason is required.`);
    if (!Array.isArray(suggestion.signals)) issues.push(`ownershipLayerSuggestions[${index}].signals must be an array.`);
    if (!stringField(suggestion.nextStep)) issues.push(`ownershipLayerSuggestions[${index}].nextStep is required.`);
  }
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

function normalizeConversationProjectionSummary(
  summary: Partial<TaskRunCardConversationProjectionSummary> | undefined,
): TaskRunCardConversationProjectionSummary | undefined {
  if (!summary || !stringField(summary.conversationId) || !stringField(summary.status)) return undefined;
  const failureOwner = isRecord(summary.failureOwner)
    ? {
        ownerLayer: stringField(summary.failureOwner.ownerLayer) ?? 'unknown',
        action: stringField(summary.failureOwner.action),
        retryable: typeof summary.failureOwner.retryable === 'boolean' ? summary.failureOwner.retryable : undefined,
        reason: stringField(summary.failureOwner.reason) ?? 'Conversation projection reported a failure owner.',
        evidenceRefs: uniqueStrings(Array.isArray(summary.failureOwner.evidenceRefs)
          ? summary.failureOwner.evidenceRefs.filter(isString)
          : []),
        nextStep: stringField(summary.failureOwner.nextStep),
      }
    : undefined;
  return {
    schemaVersion: 'sciforge.task-run-card.conversation-projection-summary.v1',
    conversationId: stringField(summary.conversationId) as string,
    status: stringField(summary.status) as string,
    activeRunId: stringField(summary.activeRunId),
    failureOwner,
    recoverActions: uniqueStrings(Array.isArray(summary.recoverActions) ? summary.recoverActions.filter(isString) : []),
    verificationState: isRecord(summary.verificationState)
      ? {
          status: stringField(summary.verificationState.status) ?? 'unverified',
          verifierRef: stringField(summary.verificationState.verifierRef),
          verdict: stringField(summary.verificationState.verdict),
        }
      : undefined,
    backgroundState: isRecord(summary.backgroundState)
      ? {
          status: stringField(summary.backgroundState.status) ?? 'running',
          checkpointRefs: uniqueStrings(Array.isArray(summary.backgroundState.checkpointRefs)
            ? summary.backgroundState.checkpointRefs.filter(isString)
            : []),
          revisionPlan: stringField(summary.backgroundState.revisionPlan),
        }
      : undefined,
  };
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
  const code = normalizeFailureCode(input.code);
  if (input.httpStatus !== undefined && [408, 425, 429, 500, 502, 503, 504].includes(input.httpStatus)) return 'external-transient';
  if (code && FAILURE_KIND_BY_CODE[code]) return FAILURE_KIND_BY_CODE[code];
  return 'unknown';
}

const FAILURE_KIND_BY_CODE: Record<string, FailureSignatureKind> = {
  'external-transient': 'external-transient',
  'provider-transient': 'external-transient',
  'rate-limit': 'external-transient',
  'service-unavailable': 'external-transient',
  timeout: 'timeout',
  deadline: 'timeout',
  'repair-no-op': 'repair-no-op',
  'schema-drift': 'schema-drift',
  'payload-schema': 'schema-drift',
  'contract-validation': 'schema-drift',
  'missing-ref': 'missing-ref',
  'stale-ref': 'missing-ref',
  'validation-failure': 'validation-failure',
  verifier: 'validation-failure',
  'user-cancelled': 'user-cancelled',
  cancelled: 'user-cancelled',
  'backend-handoff': 'backend-handoff',
  'agentserver-handoff': 'backend-handoff',
};

function normalizeFailureCode(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replaceAll(/[\s_]+/g, '-')
    : '';
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

function normalizeOwnershipLayerSuggestions(
  explicit: Array<Partial<OwnershipLayerSuggestion>> | undefined,
  input: {
    status: TaskRunCardStatus;
    protocolStatus: TaskProtocolStatus;
    taskOutcome: TaskOutcomeStatus;
    genericAttributionLayer: TaskAttributionLayer;
    nextStep: string;
    refs: TaskRunCardRef[];
    failureSignatures: FailureSignature[];
    executionUnits: RuntimeExecutionUnit[];
    verificationRefs: string[];
  },
): OwnershipLayerSuggestion[] {
  const explicitSuggestions = (explicit ?? [])
    .filter((suggestion) => isTaskAttributionLayer(suggestion.layer))
    .map((suggestion): OwnershipLayerSuggestion => ({
      layer: suggestion.layer as TaskAttributionLayer,
      confidence: isSuggestionConfidence(suggestion.confidence) ? suggestion.confidence : 'medium',
      reason: stringField(suggestion.reason) ?? reasonForOwnershipLayer(suggestion.layer as TaskAttributionLayer),
      signals: uniqueStrings(suggestion.signals ?? []),
      nextStep: stringField(suggestion.nextStep) ?? input.nextStep,
    }));
  return dedupeOwnershipLayerSuggestions([
    ...explicitSuggestions,
    ...inferOwnershipLayerSuggestions(input),
  ]);
}

function inferOwnershipLayerSuggestions(input: {
  status: TaskRunCardStatus;
  protocolStatus: TaskProtocolStatus;
  taskOutcome: TaskOutcomeStatus;
  genericAttributionLayer: TaskAttributionLayer;
  nextStep: string;
  refs: TaskRunCardRef[];
  failureSignatures: FailureSignature[];
  executionUnits: RuntimeExecutionUnit[];
  verificationRefs: string[];
}): OwnershipLayerSuggestion[] {
  const scores = new Map<TaskAttributionLayer, { score: number; signals: string[] }>();
  const add = (layer: TaskAttributionLayer, score: number, signal: string) => {
    const current = scores.get(layer) ?? { score: 0, signals: [] };
    scores.set(layer, { score: current.score + score, signals: uniqueStrings([...current.signals, signal]) });
  };

  add(input.genericAttributionLayer, 2, 'generic-attribution-layer');
  if (input.protocolStatus === 'not-run') add('harness', 2, 'not-run-protocol-status');
  if (input.protocolStatus === 'running') add('runtime-server', 2, 'running-protocol-status');
  if (input.status === 'complete') add('presentation', 1, 'completed-result-needs-visible-presentation');
  if (input.status === 'needs-work' || input.status === 'partial' || input.status === 'failed') {
    add(input.genericAttributionLayer, 2, 'unfinished-task-status');
  }
  if (input.taskOutcome === 'needs-human') add('harness', 1, 'human-decision-required');

  for (const signature of input.failureSignatures) {
    add(signature.layer, 4, `failure:${signature.kind}`);
    if (signature.kind === 'schema-drift') add('payload-normalization', 2, 'schema-drift-failure');
    if (signature.kind === 'backend-handoff') add('agentserver-parser', 2, 'backend-handoff-failure');
    if (signature.kind === 'validation-failure') add('verification', 2, 'validation-failure');
    if (signature.kind === 'missing-ref') add('resume', 2, 'missing-ref-failure');
    if (signature.kind === 'timeout' || signature.kind === 'repair-no-op') add('runtime-server', 1, `runtime-failure:${signature.kind}`);
  }

  for (const unit of input.executionUnits) {
    if (unit.verificationVerdict === 'fail' || unit.verificationVerdict === 'uncertain') add('verification', 3, 'execution-unit-verification-verdict');
    if (unit.status === 'repair-needed' || unit.status === 'failed-with-reason' || unit.status === 'failed') add(inferAttributionLayerFromExecutionUnits([unit]), 2, `execution-unit-status:${unit.status}`);
    if (unit.outputRef || unit.stdoutRef || unit.stderrRef) add('runtime-server', 1, 'execution-unit-runtime-refs');
  }

  if (input.verificationRefs.length || input.refs.some((ref) => ref.kind === 'verification')) add('verification', 1, 'verification-refs');
  if (input.refs.some((ref) => ref.kind === 'log' || ref.kind === 'bundle')) add('runtime-server', 1, 'runtime-diagnostic-refs');
  if (input.refs.some((ref) => ref.kind === 'artifact')) add('presentation', 1, 'artifact-result-refs');

  const ranked = [...scores.entries()]
    .filter(([layer]) => layer !== 'unknown')
    .sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([layer, scored]): OwnershipLayerSuggestion => ({
      layer,
      confidence: scored.score >= 5 ? 'high' : scored.score >= 3 ? 'medium' : 'low',
      reason: reasonForOwnershipLayer(layer),
      signals: scored.signals.slice(0, 8),
      nextStep: nextStepForOwnershipLayer(layer, input.nextStep),
    }));

  return ranked.length ? ranked : [{
    layer: 'runtime-server',
    confidence: 'low',
    reason: reasonForOwnershipLayer('runtime-server'),
    signals: ['fallback-no-specific-layer-signal'],
    nextStep: input.nextStep,
  }];
}

function dedupeOwnershipLayerSuggestions(suggestions: OwnershipLayerSuggestion[]) {
  const byLayer = new Map<TaskAttributionLayer, OwnershipLayerSuggestion>();
  for (const suggestion of suggestions) {
    const current = byLayer.get(suggestion.layer);
    if (!current || confidenceRank(suggestion.confidence) > confidenceRank(current.confidence)) {
      byLayer.set(suggestion.layer, suggestion);
      continue;
    }
    if (current.confidence === suggestion.confidence) {
      byLayer.set(suggestion.layer, {
        ...current,
        signals: uniqueStrings([...current.signals, ...suggestion.signals]).slice(0, 8),
      });
    }
  }
  return [...byLayer.values()].sort((left, right) => {
    const rank = confidenceRank(right.confidence) - confidenceRank(left.confidence);
    return rank || left.layer.localeCompare(right.layer);
  }).slice(0, 4);
}

function reasonForOwnershipLayer(layer: TaskAttributionLayer) {
  if (layer === 'harness') return 'The next improvement belongs to harness policy because stage, budget, or human-decision governance is the owning layer.';
  if (layer === 'runtime-server') return 'The next improvement belongs to the runtime server because execution state, refs, logs, or recovery orchestration are the owning layer.';
  if (layer === 'agentserver-parser') return 'The next improvement belongs to AgentServer parsing because backend handoff output could not be classified safely.';
  if (layer === 'payload-normalization') return 'The next improvement belongs to payload normalization because contract shape or semantic envelope normalization is the owning layer.';
  if (layer === 'presentation') return 'The next improvement belongs to presentation because result visibility, artifact ordering, or user-facing projection is the owning layer.';
  if (layer === 'verification') return 'The next improvement belongs to verification because evidence checks or verifier verdicts are the owning layer.';
  if (layer === 'resume') return 'The next improvement belongs to resume because preserved refs or prior work must be located, refreshed, or continued.';
  if (layer === 'ui') return 'The next improvement belongs to UI because interaction state or client rendering is the owning layer.';
  if (layer === 'external-provider') return 'The next improvement depends on external provider availability, backoff, or cached evidence policy.';
  if (layer === 'workspace') return 'The next improvement belongs to workspace state because local files, artifacts, or project storage are the owning layer.';
  return 'No specific owning layer could be inferred from stable runtime signals.';
}

function nextStepForOwnershipLayer(layer: TaskAttributionLayer, fallback: string) {
  if (layer === 'harness') return 'Review harness profile, budget, and stage-hook decisions before rerun.';
  if (layer === 'runtime-server') return 'Inspect runtime refs, logs, task status, and recovery orchestration before rerun.';
  if (layer === 'agentserver-parser') return 'Classify the backend handoff shape and return a structured recoverable payload.';
  if (layer === 'payload-normalization') return 'Apply only contract-approved normalization or fail closed with validation diagnostics.';
  if (layer === 'presentation') return 'Materialize the result presentation contract from preserved refs before changing task logic.';
  if (layer === 'verification') return 'Run or repair verifier evidence before marking the task satisfied.';
  if (layer === 'resume') return 'Resume from preserved refs or refresh missing refs before repeating expensive work.';
  if (layer === 'ui') return 'Check the client projection of the existing runtime contract before changing backend behavior.';
  if (layer === 'external-provider') return 'Retry after provider backoff or continue with cached evidence and explicit freshness labels.';
  if (layer === 'workspace') return 'Inspect workspace artifact paths, storage refs, and project state before rerun.';
  return fallback;
}

function confidenceRank(confidence: OwnershipLayerSuggestionConfidence) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;
  return 1;
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
  if (signature.kind === 'external-transient') {
    if (signature.httpStatus !== undefined) return `http-${signature.httpStatus}`;
    return normalizeFailureCode(signature.code) || 'external-transient';
  }
  if (signature.code) return normalizeFailureCode(signature.code);
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

function isTaskAttributionLayer(value: unknown): value is TaskAttributionLayer {
  return TASK_ATTRIBUTION_LAYERS.includes(value as TaskAttributionLayer);
}

function isSuggestionConfidence(value: unknown): value is OwnershipLayerSuggestionConfidence {
  return value === 'high' || value === 'medium' || value === 'low';
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

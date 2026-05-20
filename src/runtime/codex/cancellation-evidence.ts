export const CANCELLATION_EVIDENCE_SCHEMA_VERSION = 'sciforge.cancellation-evidence.v1' as const;

export type CancellationKind = 'user-cancelled' | 'system-abort';
export type SafeRemainderEffect = 'read-only' | 'idempotent' | 'reversible-write';
export type UnsafeRemainderEffect = 'unknown' | 'irreversible-side-effect' | 'depends-on-unsafe-boundary';

export interface CancellationCompletedStep {
  stepId: string;
  summary: string;
  artifactRefs?: string[];
  auditRefs?: string[];
}

export interface CancellationPartialArtifact {
  ref: string;
  status: 'partial' | 'complete-but-unvalidated' | 'invalid' | 'quarantined';
  description: string;
  producerStepId?: string;
  auditRefs?: string[];
}

export interface CancellationIrreversibleSideEffect {
  sideEffectId: string;
  stepId: string;
  description: string;
  externalRef?: string;
  auditRefs?: string[];
}

export interface CancellationSafeRemainderStep {
  stepId: string;
  action: string;
  effect: SafeRemainderEffect;
  dependsOn?: string[];
  requiredArtifactRefs?: string[];
  auditRefs?: string[];
}

export interface CancellationUnsafeRemainderStep {
  stepId: string;
  action: string;
  reason: string;
  effect: UnsafeRemainderEffect;
  blockedBySideEffectIds?: string[];
  auditRefs?: string[];
}

export interface CancellationEvidenceLedger {
  schemaVersion: typeof CANCELLATION_EVIDENCE_SCHEMA_VERSION;
  cancelledRunId: string;
  attemptId: string;
  cancellation: {
    kind: CancellationKind;
    reason: string;
    observedAt?: string;
    requestedBy?: string;
  };
  completedSteps: CancellationCompletedStep[];
  partialArtifacts: CancellationPartialArtifact[];
  irreversibleSideEffects: CancellationIrreversibleSideEffect[];
  unsafeRemainder: CancellationUnsafeRemainderStep[];
  safeRemainder: CancellationSafeRemainderStep[];
  auditRefs: string[];
}

export interface CancellationEvidenceValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface CancellationContinuationRequest {
  sourceCancelledRunId: string;
  sourceAttemptId: string;
  mode?: 'safe-remainder-only' | 'resume-cancelled-run';
  requestedStepIds?: string[];
}

export interface SafeCancellationContinuationPlan {
  ok: true;
  schemaVersion: typeof CANCELLATION_EVIDENCE_SCHEMA_VERSION;
  continuationScope: 'safe-remainder-only';
  cancelledRunId: string;
  attemptId: string;
  cancellationKind: CancellationKind;
  executableSteps: CancellationSafeRemainderStep[];
  blockedSteps: CancellationUnsafeRemainderStep[];
  completedStepIds: string[];
  partialArtifactRefs: string[];
  irreversibleSideEffectIds: string[];
  auditRefs: string[];
}

export interface BlockedCancellationContinuationPlan {
  ok: false;
  schemaVersion: typeof CANCELLATION_EVIDENCE_SCHEMA_VERSION | 'unknown';
  reason:
    | 'invalid-evidence'
    | 'boundaryless-resume-blocked'
    | 'run-boundary-mismatch'
    | 'unsafe-remainder-blocked';
  errors: string[];
  blockedSteps: CancellationUnsafeRemainderStep[];
  safeRemainder: CancellationSafeRemainderStep[];
  auditRefs: string[];
}

export type CancellationContinuationPlan =
  | SafeCancellationContinuationPlan
  | BlockedCancellationContinuationPlan;

const CANCELLATION_KINDS = new Set<CancellationKind>(['user-cancelled', 'system-abort']);
const SAFE_EFFECTS = new Set<SafeRemainderEffect>(['read-only', 'idempotent', 'reversible-write']);
const UNSAFE_EFFECTS = new Set<UnsafeRemainderEffect>(['unknown', 'irreversible-side-effect', 'depends-on-unsafe-boundary']);
const PARTIAL_ARTIFACT_STATUSES = new Set<CancellationPartialArtifact['status']>([
  'partial',
  'complete-but-unvalidated',
  'invalid',
  'quarantined',
]);

export function validateCancellationEvidenceLedger(ledger: unknown): CancellationEvidenceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(ledger)) {
    return { ok: false, errors: ['ledger must be an object'], warnings };
  }

  if (ledger.schemaVersion !== CANCELLATION_EVIDENCE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CANCELLATION_EVIDENCE_SCHEMA_VERSION}`);
  }

  requireNonEmptyString(ledger, 'cancelledRunId', errors);
  requireNonEmptyString(ledger, 'attemptId', errors);

  const cancellation = ledger.cancellation;
  if (!isRecord(cancellation)) {
    errors.push('cancellation must be an object');
  } else {
    if (!CANCELLATION_KINDS.has(cancellation.kind as CancellationKind)) {
      errors.push('cancellation.kind must be user-cancelled or system-abort');
    }
    requireNonEmptyString(cancellation, 'reason', errors, 'cancellation.reason');
    requireOptionalString(cancellation, 'observedAt', errors, 'cancellation.observedAt');
    requireOptionalString(cancellation, 'requestedBy', errors, 'cancellation.requestedBy');
  }

  const auditRefs = requireStringArray(ledger, 'auditRefs', errors, { requireNonEmpty: true });
  if (auditRefs.length === 0) {
    errors.push('auditRefs must include at least one cancellation boundary ref');
  }

  const completedSteps = requireRecordArray(ledger, 'completedSteps', errors);
  const partialArtifacts = requireRecordArray(ledger, 'partialArtifacts', errors);
  const irreversibleSideEffects = requireRecordArray(ledger, 'irreversibleSideEffects', errors);
  const unsafeRemainder = requireRecordArray(ledger, 'unsafeRemainder', errors);
  const safeRemainder = requireRecordArray(ledger, 'safeRemainder', errors);

  const completedStepIds = validateCompletedSteps(completedSteps, errors);
  validatePartialArtifacts(partialArtifacts, errors);
  const irreversibleSideEffectIds = validateIrreversibleSideEffects(irreversibleSideEffects, errors);
  const unsafeStepIds = validateUnsafeRemainder(unsafeRemainder, irreversibleSideEffectIds, errors, warnings);
  validateSafeRemainder(safeRemainder, {
    completedStepIds,
    unsafeStepIds,
    safeStepIds: new Set(
      safeRemainder
        .map((step) => textValue(step.stepId))
        .filter((stepId): stepId is string => Boolean(stepId)),
    ),
    errors,
  });

  return { ok: errors.length === 0, errors, warnings };
}

export function planCancellationContinuation(
  ledger: CancellationEvidenceLedger,
  request: CancellationContinuationRequest,
): CancellationContinuationPlan {
  const validation = validateCancellationEvidenceLedger(ledger);
  if (!validation.ok) {
    return blockedPlan({
      ledger,
      reason: 'invalid-evidence',
      errors: validation.errors,
    });
  }

  if ((request.mode ?? 'safe-remainder-only') !== 'safe-remainder-only') {
    return blockedPlan({
      ledger,
      reason: 'boundaryless-resume-blocked',
      errors: ['cancelled runs must continue from sciforge.cancellation-evidence.v1 safeRemainder, not by resuming the cancelled run without a boundary'],
    });
  }

  if (
    request.sourceCancelledRunId !== ledger.cancelledRunId
    || request.sourceAttemptId !== ledger.attemptId
  ) {
    return blockedPlan({
      ledger,
      reason: 'run-boundary-mismatch',
      errors: [`continuation source ${request.sourceCancelledRunId}/${request.sourceAttemptId} does not match cancellation boundary ${ledger.cancelledRunId}/${ledger.attemptId}`],
    });
  }

  if (request.requestedStepIds?.includes('*')) {
    return blockedPlan({
      ledger,
      reason: 'boundaryless-resume-blocked',
      errors: ['requestedStepIds="*" is boundaryless; request explicit safeRemainder steps or omit requestedStepIds to execute the bounded safe remainder'],
    });
  }

  const requestedStepIds = request.requestedStepIds
    ? unique(request.requestedStepIds)
    : ledger.safeRemainder.map((step) => step.stepId);
  const safeById = new Map(ledger.safeRemainder.map((step) => [step.stepId, step]));
  const unsafeById = new Map(ledger.unsafeRemainder.map((step) => [step.stepId, step]));
  const completedById = new Set(ledger.completedSteps.map((step) => step.stepId));
  const errors: string[] = [];
  const blockedSteps: CancellationUnsafeRemainderStep[] = [];

  for (const stepId of requestedStepIds) {
    if (!safeById.has(stepId)) {
      if (unsafeById.has(stepId)) {
        const unsafeStep = unsafeById.get(stepId)!;
        blockedSteps.push(unsafeStep);
        errors.push(`requested step ${stepId} is unsafe remainder: ${unsafeStep.reason}`);
      } else if (completedById.has(stepId)) {
        errors.push(`requested step ${stepId} is already completed and cannot be replayed as continuation work`);
      } else {
        errors.push(`requested step ${stepId} is not present in safeRemainder for cancelled run ${ledger.cancelledRunId}`);
      }
    }
  }

  if (errors.length > 0) {
    return blockedPlan({
      ledger,
      reason: 'unsafe-remainder-blocked',
      errors,
      blockedSteps,
    });
  }

  const requestedSet = new Set(requestedStepIds);
  const executableSteps = ledger.safeRemainder.filter((step) => requestedSet.has(step.stepId));

  return {
    ok: true,
    schemaVersion: CANCELLATION_EVIDENCE_SCHEMA_VERSION,
    continuationScope: 'safe-remainder-only',
    cancelledRunId: ledger.cancelledRunId,
    attemptId: ledger.attemptId,
    cancellationKind: ledger.cancellation.kind,
    executableSteps,
    blockedSteps: ledger.unsafeRemainder,
    completedStepIds: ledger.completedSteps.map((step) => step.stepId),
    partialArtifactRefs: ledger.partialArtifacts.map((artifact) => artifact.ref),
    irreversibleSideEffectIds: ledger.irreversibleSideEffects.map((effect) => effect.sideEffectId),
    auditRefs: unique([
      ...ledger.auditRefs,
      ...ledger.completedSteps.flatMap((step) => step.auditRefs ?? []),
      ...ledger.partialArtifacts.flatMap((artifact) => artifact.auditRefs ?? []),
      ...ledger.irreversibleSideEffects.flatMap((effect) => effect.auditRefs ?? []),
      ...executableSteps.flatMap((step) => step.auditRefs ?? []),
    ]),
  };
}

function validateCompletedSteps(steps: Record<string, unknown>[], errors: string[]): Set<string> {
  const ids = new Set<string>();
  for (const [index, step] of steps.entries()) {
    const path = `completedSteps[${index}]`;
    const stepId = requireNonEmptyString(step, 'stepId', errors, `${path}.stepId`);
    requireNonEmptyString(step, 'summary', errors, `${path}.summary`);
    requireStringArray(step, 'artifactRefs', errors, { path: `${path}.artifactRefs`, optional: true });
    requireStringArray(step, 'auditRefs', errors, { path: `${path}.auditRefs`, optional: true });
    rememberUnique(ids, stepId, `${path}.stepId`, errors);
  }
  return ids;
}

function validatePartialArtifacts(artifacts: Record<string, unknown>[], errors: string[]): Set<string> {
  const refs = new Set<string>();
  for (const [index, artifact] of artifacts.entries()) {
    const path = `partialArtifacts[${index}]`;
    const ref = requireNonEmptyString(artifact, 'ref', errors, `${path}.ref`);
    if (!PARTIAL_ARTIFACT_STATUSES.has(artifact.status as CancellationPartialArtifact['status'])) {
      errors.push(`${path}.status must be partial, complete-but-unvalidated, invalid, or quarantined`);
    }
    requireNonEmptyString(artifact, 'description', errors, `${path}.description`);
    requireOptionalString(artifact, 'producerStepId', errors, `${path}.producerStepId`);
    requireStringArray(artifact, 'auditRefs', errors, { path: `${path}.auditRefs`, optional: true });
    rememberUnique(refs, ref, `${path}.ref`, errors);
  }
  return refs;
}

function validateIrreversibleSideEffects(effects: Record<string, unknown>[], errors: string[]): Set<string> {
  const ids = new Set<string>();
  for (const [index, effect] of effects.entries()) {
    const path = `irreversibleSideEffects[${index}]`;
    const sideEffectId = requireNonEmptyString(effect, 'sideEffectId', errors, `${path}.sideEffectId`);
    requireNonEmptyString(effect, 'stepId', errors, `${path}.stepId`);
    requireNonEmptyString(effect, 'description', errors, `${path}.description`);
    requireOptionalString(effect, 'externalRef', errors, `${path}.externalRef`);
    requireStringArray(effect, 'auditRefs', errors, { path: `${path}.auditRefs`, optional: true });
    rememberUnique(ids, sideEffectId, `${path}.sideEffectId`, errors);
  }
  return ids;
}

function validateUnsafeRemainder(
  steps: Record<string, unknown>[],
  irreversibleSideEffectIds: Set<string>,
  errors: string[],
  warnings: string[],
): Set<string> {
  const ids = new Set<string>();
  for (const [index, step] of steps.entries()) {
    const path = `unsafeRemainder[${index}]`;
    const stepId = requireNonEmptyString(step, 'stepId', errors, `${path}.stepId`);
    requireNonEmptyString(step, 'action', errors, `${path}.action`);
    requireNonEmptyString(step, 'reason', errors, `${path}.reason`);
    if (!UNSAFE_EFFECTS.has(step.effect as UnsafeRemainderEffect)) {
      errors.push(`${path}.effect must be unknown, irreversible-side-effect, or depends-on-unsafe-boundary`);
    }
    const blockedBySideEffectIds = requireStringArray(step, 'blockedBySideEffectIds', errors, { path: `${path}.blockedBySideEffectIds`, optional: true });
    for (const sideEffectId of blockedBySideEffectIds) {
      if (!irreversibleSideEffectIds.has(sideEffectId)) {
        warnings.push(`${path}.blockedBySideEffectIds references unrecorded side effect ${sideEffectId}`);
      }
    }
    requireStringArray(step, 'auditRefs', errors, { path: `${path}.auditRefs`, optional: true });
    rememberUnique(ids, stepId, `${path}.stepId`, errors);
  }
  return ids;
}

function validateSafeRemainder(
  steps: Record<string, unknown>[],
  context: {
    completedStepIds: Set<string>;
    unsafeStepIds: Set<string>;
    safeStepIds: Set<string>;
    errors: string[];
  },
): void {
  const ids = new Set<string>();
  for (const [index, step] of steps.entries()) {
    const path = `safeRemainder[${index}]`;
    const stepId = requireNonEmptyString(step, 'stepId', context.errors, `${path}.stepId`);
    requireNonEmptyString(step, 'action', context.errors, `${path}.action`);
    if (!SAFE_EFFECTS.has(step.effect as SafeRemainderEffect)) {
      context.errors.push(`${path}.effect must be read-only, idempotent, or reversible-write`);
    }
    requireStringArray(step, 'auditRefs', context.errors, { path: `${path}.auditRefs`, optional: true });
    const dependsOn = requireStringArray(step, 'dependsOn', context.errors, { path: `${path}.dependsOn`, optional: true });
    for (const dependency of dependsOn) {
      if (context.unsafeStepIds.has(dependency)) {
        context.errors.push(`${path}.dependsOn references unsafe remainder step ${dependency}`);
      } else if (!context.completedStepIds.has(dependency) && !context.safeStepIds.has(dependency)) {
        context.errors.push(`${path}.dependsOn references unknown boundary step ${dependency}`);
      }
    }
    requireStringArray(step, 'requiredArtifactRefs', context.errors, { path: `${path}.requiredArtifactRefs`, optional: true });
    if (stepId && context.completedStepIds.has(stepId)) {
      context.errors.push(`${path}.stepId ${stepId} is already completed`);
    }
    if (stepId && context.unsafeStepIds.has(stepId)) {
      context.errors.push(`${path}.stepId ${stepId} is also listed in unsafeRemainder`);
    }
    rememberUnique(ids, stepId, `${path}.stepId`, context.errors);
  }
}

function blockedPlan(input: {
  ledger: CancellationEvidenceLedger;
  reason: BlockedCancellationContinuationPlan['reason'];
  errors: string[];
  blockedSteps?: CancellationUnsafeRemainderStep[];
}): BlockedCancellationContinuationPlan {
  const schemaVersion = input.ledger?.schemaVersion === CANCELLATION_EVIDENCE_SCHEMA_VERSION
    ? CANCELLATION_EVIDENCE_SCHEMA_VERSION
    : 'unknown';
  return {
    ok: false,
    schemaVersion,
    reason: input.reason,
    errors: input.errors,
    blockedSteps: input.blockedSteps ?? (Array.isArray(input.ledger?.unsafeRemainder) ? input.ledger.unsafeRemainder : []),
    safeRemainder: Array.isArray(input.ledger?.safeRemainder) ? input.ledger.safeRemainder : [],
    auditRefs: Array.isArray(input.ledger?.auditRefs) ? input.ledger.auditRefs : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  path = key,
): string | undefined {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return undefined;
  }
  return value;
}

function requireOptionalString(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  path = key,
): void {
  const value = record[key];
  if (value !== undefined && typeof value !== 'string') {
    errors.push(`${path} must be a string when present`);
  }
}

function requireRecordArray(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
): Record<string, unknown>[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array`);
    return [];
  }

  const records: Record<string, unknown>[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`${key}[${index}] must be an object`);
    } else {
      records.push(item);
    }
  }
  return records;
}

function requireStringArray(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  options: { path?: string; optional?: boolean; requireNonEmpty?: boolean } = {},
): string[] {
  const value = record[key];
  const path = options.path ?? key;
  if (value === undefined && options.optional) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array of strings`);
    return [];
  }

  const strings: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      errors.push(`${path}[${index}] must be a non-empty string`);
    } else {
      strings.push(item);
    }
  }
  if (options.requireNonEmpty && strings.length === 0) {
    errors.push(`${path} must include at least one ref`);
  }
  return strings;
}

function rememberUnique(
  seen: Set<string>,
  value: string | undefined,
  path: string,
  errors: string[],
): void {
  if (!value) return;
  if (seen.has(value)) {
    errors.push(`${path} duplicates ${value}`);
    return;
  }
  seen.add(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

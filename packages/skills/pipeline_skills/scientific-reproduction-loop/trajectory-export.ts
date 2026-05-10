import {
  SCIENTIFIC_REPRODUCTION_TRAJECTORY_SCHEMA_VERSION,
  sanitizeTrajectoryForExport,
  validateScientificReproductionTrajectory,
  type ActionModality,
  type RepairRecord,
  type ScientificReproductionTrajectory,
  type ScreenStateRef,
  type SelfPromptRecommendation,
  type TrajectoryStep,
  type WorkspaceRef,
} from './trajectory-contract';

const SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES = new Set([
  'paper-claim-graph',
  'figure-to-claim-map',
  'dataset-inventory',
  'analysis-plan',
  'analysis-notebook',
  'figure-reproduction-report',
  'evidence-matrix',
  'claim-verdict',
  'negative-result-report',
  'trajectory-training-record',
]);

export interface StoredAttemptLike {
  id: string;
  prompt?: string;
  skillDomain?: string;
  skillId?: string;
  scenarioPackageRef?: { id?: string; version?: string; source?: string };
  skillPlanRef?: string;
  uiPlanRef?: string;
  runtimeProfileId?: string;
  routeDecision?: {
    selectedSkill?: string;
    selectedRuntime?: string;
    fallbackReason?: string;
    selectedAt?: string;
  };
  attempt?: number;
  parentAttempt?: number;
  selfHealReason?: string;
  patchSummary?: string;
  diffRef?: string;
  failureReason?: string;
  status?: string;
  codeRef?: string;
  inputRef?: string;
  outputRef?: string;
  stdoutRef?: string;
  stderrRef?: string;
  exitCode?: number;
  schemaErrors?: string[];
  workEvidenceSummary?: {
    count?: number;
    items?: Array<{
      kind?: string;
      status?: string;
      provider?: string;
      resultCount?: number;
      outputSummary?: string;
      evidenceRefs?: string[];
      failureReason?: string;
      recoverActions?: string[];
      nextStep?: string;
      diagnostics?: string[];
      rawRef?: string;
    }>;
  };
  refs?: Record<string, unknown>;
  validationRepairAuditRecords?: unknown[];
  validationRepairAuditSinkRecords?: unknown[];
  validationRepairTelemetrySummary?: unknown;
  createdAt?: string;
}

export interface TrajectorySourceSubject {
  title?: string;
  topic?: string;
  scenarioId?: string;
  sourceRefs?: WorkspaceRef[];
}

export interface BuildTrajectoryTrainingRecordInput {
  attempt: StoredAttemptLike;
  taskResult?: unknown;
  validationEvents?: unknown[];
  workspaceRef?: string;
  runbookRef?: string;
  subject?: TrajectorySourceSubject;
  screenRefs?: {
    before?: ScreenStateRef[];
    after?: ScreenStateRef[];
  };
  now?: () => Date;
}

export interface TrajectoryAuditIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  refs?: string[];
}

export interface TrajectoryAuditResult {
  ok: boolean;
  issues: TrajectoryAuditIssue[];
  replayRefs: string[];
  artifactRefs: string[];
  validationRefs: string[];
  stepCount: number;
}

export function buildTrajectoryTrainingRecordFromStoredAttempt(
  input: BuildTrajectoryTrainingRecordInput,
): ScientificReproductionTrajectory {
  const attempt = input.attempt;
  const createdAt = timestamp(attempt.createdAt, input.now);
  const beforeRefs = nonEmptyScreens(
    input.screenRefs?.before,
    screenRef(`screen:attempt:${attempt.id}:before`, 'window-metadata', 'Attempt metadata was loaded from storage; no UI screenshot ref was supplied.'),
  );
  const afterRefs = nonEmptyScreens(
    input.screenRefs?.after,
    screenRef(`screen:attempt:${attempt.id}:after`, 'window-metadata', 'Attempt result metadata was loaded from storage; no UI screenshot ref was supplied.'),
  );
  const taskRefs = taskWorkspaceRefs(attempt);
  const resultRefs = taskResultWorkspaceRefs(input.taskResult);
  const validationRefs = validationWorkspaceRefs(attempt, input.taskResult, input.validationEvents);
  const artifactRefs = uniqueWorkspaceRefs([...taskRefs, ...resultRefs, ...validationRefs]);
  const repairHistory = repairHistoryFromAttempt(attempt, input.taskResult, validationRefs);
  const selfPromptRecommendations = selfPromptRecommendationsFromAttempt(attempt, artifactRefs);

  const steps: TrajectoryStep[] = [
    {
      id: `attempt-${attempt.attempt ?? 1}-prompt`,
      kind: 'prompt',
      timestamp: createdAt,
      prompt: {
        role: 'human-researcher',
        text: attempt.prompt || 'No prompt text was recorded for this attempt.',
        intent: `Run ${attempt.skillDomain || 'general'} task through the recorded SciForge attempt boundary.`,
        selectedRefs: subjectRefs(input.subject, artifactRefs),
      },
      action: {
        modality: 'keyboard',
        command: 'submit recorded task attempt prompt',
        target: attempt.scenarioPackageRef?.id || attempt.skillId || attempt.skillDomain || 'sciforge-task',
        inputSummary: summarizePrompt(attempt.prompt),
        screenBeforeRefs: beforeRefs,
        screenAfterRefs: afterRefs,
        traceRefs: [
          workspaceRef(`attempt:${attempt.id}:${attempt.attempt ?? 1}`, 'trace', 'Stored task attempt identity.'),
        ],
      },
      observation: {
        summary: attempt.routeDecision?.fallbackReason
          ? `Route selected ${attempt.routeDecision.selectedSkill || attempt.skillId || 'a skill'} with reason: ${attempt.routeDecision.fallbackReason}.`
          : `Stored attempt ${attempt.id} was created with status ${attempt.status || 'unknown'}.`,
        toolResultRefs: taskRefs.filter((ref) => ref.kind === 'execution-unit' || ref.kind === 'trace'),
        artifactRefs: artifactRefs.length ? artifactRefs : [workspaceRef(`attempt:${attempt.id}`, 'trace')],
      },
      rationale: {
        question: 'Why is this attempt replayable without chat context?',
        reason: 'The prompt, route, execution refs, output refs, and validation refs are recorded as workspace references.',
        alternativesConsidered: ['Use chat transcript only', 'Store raw logs inside the training record'],
        evidenceRefs: artifactRefs.length ? artifactRefs : [workspaceRef(`attempt:${attempt.id}`, 'trace')],
      },
    },
    {
      id: `attempt-${attempt.attempt ?? 1}-execution`,
      kind: executionStepKind(attempt.status),
      timestamp: createdAt,
      action: {
        modality: 'backend',
        command: `execute recorded task attempt ${attempt.id}`,
        target: attempt.runtimeProfileId || attempt.routeDecision?.selectedRuntime || 'workspace-runtime',
        screenBeforeRefs: afterRefs,
        screenAfterRefs: afterRefs,
        traceRefs: taskRefs.length ? taskRefs : [workspaceRef(`attempt:${attempt.id}:execution`, 'execution-unit')],
      },
      observation: {
        summary: executionSummary(attempt),
        toolResultRefs: taskRefs,
        artifactRefs: uniqueWorkspaceRefs([...resultRefs, ...validationRefs]),
        stdoutRef: attempt.stdoutRef ? workspaceRef(attempt.stdoutRef, 'workspace-file', 'Captured stdout ref for replay.') : undefined,
        stderrRef: attempt.stderrRef ? workspaceRef(attempt.stderrRef, 'workspace-file', 'Captured stderr ref for replay.') : undefined,
      },
    },
  ];

  if (validationRefs.length || input.validationEvents?.length || hasValidationMetadata(attempt, input.taskResult)) {
    steps.push({
      id: `attempt-${attempt.attempt ?? 1}-validation-audit`,
      kind: repairHistory.length ? 'repair' : 'inspect-artifact',
      timestamp: timestamp(undefined, input.now),
      observation: {
        summary: validationSummary(attempt, input.validationEvents),
        toolResultRefs: validationRefs.filter((ref) => ref.kind === 'trace' || ref.kind === 'audit' || ref.kind === 'ledger'),
        artifactRefs: validationRefs,
      },
      repair: repairHistory[0],
    });
  }

  if (selfPromptRecommendations.length) {
    steps.push({
      id: `attempt-${attempt.attempt ?? 1}-next-prompt`,
      kind: 'self-prompt-recommendation',
      timestamp: timestamp(undefined, input.now),
      observation: {
        summary: 'A follow-up prompt was derived from the stored attempt status and available artifact refs.',
        toolResultRefs: [],
        artifactRefs: artifactRefs.length ? artifactRefs : validationRefs,
      },
      selfPromptRecommendation: selfPromptRecommendations[0],
    });
  }

  const subjectRefsValue = subjectRefs(input.subject, artifactRefs);
  return sanitizeTrajectoryForExport({
    schemaVersion: SCIENTIFIC_REPRODUCTION_TRAJECTORY_SCHEMA_VERSION,
    attemptRef: `attempt:${attempt.id}:${attempt.attempt ?? 1}`,
    runbookRef: input.runbookRef || 'docs/runbooks/sciforge-web-reproduction.md',
    workspaceRef: input.workspaceRef || 'workspace:.sciforge',
    subject: {
      title: input.subject?.title || attempt.scenarioPackageRef?.id || attempt.skillId || attempt.skillDomain || `Task attempt ${attempt.id}`,
      topic: input.subject?.topic || attempt.prompt || undefined,
      scenarioId: input.subject?.scenarioId || attempt.scenarioPackageRef?.id,
      paperRefs: subjectRefsValue.length ? subjectRefsValue : [workspaceRef(`attempt:${attempt.id}:subject`, 'artifact')],
    },
    actors: [
      { id: 'operator.recorded-human-or-agent', role: 'human-operator' },
      { id: 'sciforge.backend', role: 'sciforge-backend' },
      { id: 'sciforge.trajectory-exporter', role: 'codex-worker' },
    ],
    steps,
    repairHistory,
    selfPromptRecommendations,
    finalVerdict: finalVerdictFromStatus(attempt.status, input.taskResult),
    exportNotes: {
      redactionPolicy: 'Store refs and bounded summaries only; redact local absolute paths, secrets, and raw tokens before export.',
      replayInstructions: [
        'Load the task attempt identified by attemptRef.',
        'Resolve workspace-file, artifact, trace, audit, and ledger refs from the .sciforge workspace.',
        'Replay steps in timestamp order using prompt, action, observation, and validation refs without relying on chat context.',
      ],
    },
  });
}

export function auditTrajectoryTrainingRecord(record: ScientificReproductionTrajectory): TrajectoryAuditResult {
  const validation = validateScientificReproductionTrajectory(record);
  const issues: TrajectoryAuditIssue[] = validation.errors.map((message) => ({
    severity: 'error',
    code: 'contract-validation',
    message,
  }));
  const replayRefs = uniqueStrings(workspaceRefsFromRecord(record).map((ref) => ref.ref));
  const artifactRefs = uniqueStrings(workspaceRefsFromRecord(record)
    .filter((ref) => ref.kind === 'artifact' || ref.kind === 'workspace-file' || ref.kind === 'execution-unit')
    .map((ref) => ref.ref));
  const validationRefs = uniqueStrings(workspaceRefsFromRecord(record)
    .filter((ref) => ref.kind === 'audit' || ref.kind === 'ledger' || /validation|audit|telemetry/i.test(ref.ref))
    .map((ref) => ref.ref));

  if (!record.steps.some((step) => step.prompt?.text)) {
    issues.push({ severity: 'error', code: 'missing-prompt', message: 'Replay requires at least one recorded prompt.' });
  }
  if (!artifactRefs.length) {
    issues.push({ severity: 'error', code: 'missing-artifact-refs', message: 'Replay requires at least one artifact or workspace-file ref.' });
  }
  if (!record.exportNotes.replayInstructions.length) {
    issues.push({ severity: 'error', code: 'missing-replay-instructions', message: 'Replay instructions are required.' });
  }
  if (!validationRefs.length) {
    issues.push({
      severity: 'warning',
      code: 'missing-validation-events',
      message: 'No validation/audit refs were found; the attempt can be replayed but has weaker audit evidence.',
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    issues,
    replayRefs,
    artifactRefs,
    validationRefs,
    stepCount: record.steps.length,
  };
}

function taskWorkspaceRefs(attempt: StoredAttemptLike): WorkspaceRef[] {
  return uniqueWorkspaceRefs([
    attempt.codeRef ? workspaceRef(attempt.codeRef, 'workspace-file', 'Task code ref.') : undefined,
    attempt.inputRef ? workspaceRef(attempt.inputRef, 'workspace-file', 'Task input ref.') : undefined,
    attempt.outputRef ? workspaceRef(attempt.outputRef, 'workspace-file', 'Task result ref.') : undefined,
    attempt.stdoutRef ? workspaceRef(attempt.stdoutRef, 'workspace-file', 'Task stdout ref.') : undefined,
    attempt.stderrRef ? workspaceRef(attempt.stderrRef, 'workspace-file', 'Task stderr ref.') : undefined,
    attempt.diffRef ? workspaceRef(attempt.diffRef, 'workspace-file', 'Repair diff ref.') : undefined,
    workspaceRef(`execution-unit:${attempt.id}:${attempt.attempt ?? 1}`, 'execution-unit', 'Recorded execution attempt.'),
  ]);
}

function taskResultWorkspaceRefs(taskResult: unknown): WorkspaceRef[] {
  const refs: WorkspaceRef[] = [];
  for (const candidate of flattenRecords(taskResult)) {
    const artifactIdentityRef = artifactIdentityFromRecord(candidate);
    if (artifactIdentityRef) refs.push(workspaceRef(artifactIdentityRef, 'artifact', 'Task result artifact identity.'));
    collectTaskResultRefs(candidate, refs);
  }
  return uniqueWorkspaceRefs(refs);
}

function collectTaskResultRefs(candidate: Record<string, unknown>, refs: WorkspaceRef[]) {
  for (const [key, value] of Object.entries(candidate)) {
    if (typeof value === 'string' && isReplayRefKey(key) && looksLikeReplayRef(value)) {
      refs.push(workspaceRef(value, workspaceKindFor(value), `Task result ${key}.`));
      continue;
    }
    if (!Array.isArray(value) || !isReplayRefCollectionKey(key)) continue;
    for (const item of value) {
      if (typeof item === 'string' && looksLikeReplayRef(item)) {
        refs.push(workspaceRef(item, workspaceKindFor(item), `Task result ${key}.`));
      } else if (isRecord(item)) {
        const ref = item.ref;
        if (typeof ref === 'string' && looksLikeReplayRef(ref)) {
          refs.push(workspaceRef(ref, workspaceKindFor(ref), `Task result ${key}.`));
        }
      }
    }
  }
}

function validationWorkspaceRefs(
  attempt: StoredAttemptLike,
  taskResult: unknown,
  validationEvents: unknown[] | undefined,
): WorkspaceRef[] {
  const refs: WorkspaceRef[] = [];
  collectValidationRefs(attempt.refs, refs);
  collectValidationRefs(attempt.validationRepairAuditRecords, refs);
  collectValidationRefs(attempt.validationRepairAuditSinkRecords, refs);
  collectValidationRefs(attempt.validationRepairTelemetrySummary, refs);
  collectValidationRefs(taskResult, refs);
  collectValidationRefs(validationEvents, refs);
  return uniqueWorkspaceRefs(refs);
}

function collectValidationRefs(value: unknown, refs: WorkspaceRef[]) {
  for (const candidate of flattenRecords(value)) {
    for (const [key, entry] of Object.entries(candidate)) {
      if (typeof entry === 'string' && /validation|audit|telemetry|ledger|sink|ref/i.test(key) && looksLikeReplayRef(entry)) {
        refs.push(workspaceRef(entry, workspaceKindFor(entry), `Validation/audit ${key}.`));
      }
      if (Array.isArray(entry) && /validation|audit|telemetry|ledger|sink|refs/i.test(key)) {
        for (const item of entry) {
          if (typeof item === 'string' && looksLikeReplayRef(item)) {
            refs.push(workspaceRef(item, workspaceKindFor(item), `Validation/audit ${key}.`));
          } else if (isRecord(item)) {
            collectValidationRefs(item, refs);
          }
        }
      }
    }
  }
}

function repairHistoryFromAttempt(
  attempt: StoredAttemptLike,
  taskResult: unknown,
  validationRefs: WorkspaceRef[],
): RepairRecord[] {
  if (!isRepairStatus(attempt.status) && !attempt.failureReason && !attempt.selfHealReason && !attempt.schemaErrors?.length) return [];
  const failureKind = classifyRepairFailureKind(attempt, taskResult);
  return [{
    failureKind,
    symptom: attempt.failureReason || attempt.schemaErrors?.join('; ') || attempt.selfHealReason || `Attempt status was ${attempt.status || 'unknown'}.`,
    diagnosis: attempt.schemaErrors?.length
      ? `Payload/schema validation reported ${attempt.schemaErrors.length} issue(s).`
      : 'The stored attempt status or validation metadata requires audit before reuse.',
    repairAction: attempt.patchSummary || attempt.selfHealReason || 'Replay the attempt from stored refs and inspect validation/audit events before continuing.',
    retestObservationRefs: validationRefs,
    outcome: attempt.status === 'done' || attempt.status === 'self-healed' ? 'recovered' : 'still-blocked',
  }];
}

function selfPromptRecommendationsFromAttempt(
  attempt: StoredAttemptLike,
  refs: WorkspaceRef[],
): SelfPromptRecommendation[] {
  if (!isRepairStatus(attempt.status) && !attempt.failureReason) return [];
  return [{
    nextPrompt: `Using attempt ${attempt.id} and the referenced artifacts, continue only after classifying the blockage as product failure, missing evidence, or a valid negative result.`,
    requiredRefs: refs,
    stopCondition: 'Stop if the required artifact, stdout/stderr, output, or validation refs cannot be resolved from workspace storage.',
    qualityGate: 'The next response must cite workspace refs and separate system failures from domain conclusions.',
    budget: {
      maxShadowRounds: 1,
      maxAutoSubmitRounds: 0,
      maxToolCalls: 6,
      maxRuntimeMinutes: 20,
      stopOnRepeatedFailure: true,
      reviewRequiredBeforeSubmit: true,
    },
    humanConfirmationPoint: 'A human reviewer must inspect the required refs and approve the follow-up before SciForge submits another turn.',
    reviewChecklist: ['required refs resolve', 'failure classification is explicit', 'next prompt advances one bounded objective'],
    mode: 'human-review-required',
  }];
}

function workspaceRefsFromRecord(record: ScientificReproductionTrajectory): WorkspaceRef[] {
  const refs: WorkspaceRef[] = [...record.subject.paperRefs];
  for (const step of record.steps) {
    refs.push(...step.prompt?.selectedRefs ?? []);
    refs.push(...step.action?.traceRefs ?? []);
    refs.push(...step.observation.toolResultRefs);
    refs.push(...step.observation.artifactRefs);
    if (step.observation.stdoutRef) refs.push(step.observation.stdoutRef);
    if (step.observation.stderrRef) refs.push(step.observation.stderrRef);
    refs.push(...step.rationale?.evidenceRefs ?? []);
    refs.push(...step.repair?.retestObservationRefs ?? []);
    refs.push(...step.selfPromptRecommendation?.requiredRefs ?? []);
  }
  return uniqueWorkspaceRefs(refs);
}

function subjectRefs(subject: TrajectorySourceSubject | undefined, fallback: WorkspaceRef[]) {
  const refs = uniqueWorkspaceRefs([...(subject?.sourceRefs ?? []), ...fallback]);
  return refs.length ? refs : [];
}

function executionStepKind(status: string | undefined): 'inspect-artifact' | 'repair' | 'verdict' {
  if (isRepairStatus(status)) return 'repair';
  if (status === 'done') return 'inspect-artifact';
  return 'inspect-artifact';
}

function finalVerdictFromStatus(status: string | undefined, taskResult: unknown): ScientificReproductionTrajectory['finalVerdict'] {
  const scientificVerdict = scientificVerdictFromTaskResult(taskResult);
  if (scientificVerdict && !isRepairStatus(status)) return scientificVerdict;
  if (status === 'done' || status === 'self-healed') return 'partially-reproduced';
  if (isRepairStatus(status)) return 'in-progress';
  return 'in-progress';
}

function executionSummary(attempt: StoredAttemptLike) {
  const parts = [
    `Attempt status: ${attempt.status || 'unknown'}.`,
    typeof attempt.exitCode === 'number' ? `Exit code: ${attempt.exitCode}.` : undefined,
    attempt.failureReason ? `Failure: ${attempt.failureReason}.` : undefined,
    attempt.workEvidenceSummary?.count ? `WorkEvidence items: ${attempt.workEvidenceSummary.count}.` : undefined,
  ].filter(Boolean);
  return parts.join(' ');
}

function validationSummary(attempt: StoredAttemptLike, validationEvents: unknown[] | undefined) {
  const eventCount = validationEvents?.length ?? 0;
  const auditCount = attempt.validationRepairAuditRecords?.length ?? 0;
  const sinkCount = attempt.validationRepairAuditSinkRecords?.length ?? 0;
  return `Validation/audit metadata assembled from ${eventCount} event(s), ${auditCount} audit record(s), and ${sinkCount} sink record(s).`;
}

function hasValidationMetadata(attempt: StoredAttemptLike, taskResult: unknown) {
  return Boolean(
    attempt.validationRepairAuditRecords?.length
    || attempt.validationRepairAuditSinkRecords?.length
    || (attempt.refs && JSON.stringify(attempt.refs).match(/validation|audit|telemetry/i))
    || (taskResult && JSON.stringify(taskResult).match(/validation|audit|telemetry/i)),
  );
}

function screenRef(ref: string, captureKind: ScreenStateRef['captureKind'], summary: string): ScreenStateRef {
  return { ref, captureKind, summary };
}

function nonEmptyScreens(value: ScreenStateRef[] | undefined, fallback: ScreenStateRef) {
  return value?.length ? value : [fallback];
}

function workspaceKindFor(ref: string): WorkspaceRef['kind'] {
  const normalized = normalizeReplayRef(ref);
  if (/audit/i.test(normalized)) return 'audit';
  if (/ledger/i.test(normalized)) return 'ledger';
  if (/trace|telemetry|span/i.test(normalized)) return 'trace';
  if (/execution-unit|^EU-|^run-/i.test(normalized)) return 'execution-unit';
  if (/screen/i.test(normalized)) return 'screen';
  if (/^(?:\.sciforge\/|file:)/.test(normalized)) return 'workspace-file';
  return 'artifact';
}

function looksLikeReplayRef(value: string) {
  return /^(?:\.sciforge\/|file:(?:\.sciforge\/|[^/])|artifact:|trace:|audit:|ledger:|screen:|execution-unit:|EU-|run-|message:|workEvidence:)/.test(value);
}

function flattenRecords(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => flattenRecords(entry, depth + 1));
  if (!isRecord(value)) return [];
  const nested = Object.values(value).flatMap((entry) => flattenRecords(entry, depth + 1));
  return [value, ...nested];
}

function uniqueWorkspaceRefs(refs: Array<WorkspaceRef | undefined>) {
  const byKey = new Map<string, WorkspaceRef>();
  for (const ref of refs) {
    if (!ref?.ref) continue;
    const key = `${ref.kind}:${ref.ref}`;
    if (byKey.has(key)) continue;
    byKey.set(key, ref);
  }
  return [...byKey.values()];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function isRepairStatus(status: string | undefined) {
  return /failed|repair-needed|needs-human|cancelled|timeout|blocked/i.test(status || '');
}

function hasOperationalFailure(attempt: StoredAttemptLike) {
  const haystack = [
    attempt.failureReason,
    attempt.selfHealReason,
    attempt.schemaErrors?.join(' '),
    attempt.status,
  ].filter(Boolean).join(' ');
  return /ToolPayload|payload|schema|contract|validation|runtime|exception|stderr|exit code|nonzero/i.test(haystack);
}

function classifyRepairFailureKind(attempt: StoredAttemptLike, taskResult: unknown): RepairRecord['failureKind'] {
  if (hasOperationalFailure(attempt)) return 'product-capability-failure';
  if (scientificNegativeVerdictFromTaskResult(taskResult)) return 'scientific-negative-result';
  if (/missing|unavailable|not found|no evidence/i.test(attempt.failureReason || '')) return 'blocked-missing-evidence';
  return 'product-capability-failure';
}

function workspaceRef(ref: string, kind: WorkspaceRef['kind'], description?: string): WorkspaceRef {
  const normalized = normalizeReplayRef(ref);
  const inferredKind = workspaceKindFor(normalized);
  return { ref: normalized, kind: inferredKind === kind ? kind : inferredKind, description };
}

function normalizeReplayRef(value: string) {
  return value.replace(/^file:(\.sciforge\/.*)$/i, '$1');
}

function artifactIdentityFromRecord(candidate: Record<string, unknown>) {
  const id = typeof candidate.id === 'string' ? candidate.id : undefined;
  const type = typeof candidate.type === 'string' ? candidate.type : undefined;
  const data = isRecord(candidate.data) ? candidate.data : undefined;
  const artifactType = typeof candidate.artifactType === 'string'
    ? candidate.artifactType
    : typeof data?.artifactType === 'string'
      ? data.artifactType
      : undefined;
  const typeIsScientific = Boolean(type && SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES.has(type));
  const dataTypeIsScientific = Boolean(artifactType && SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES.has(artifactType));
  if (!id || (!typeIsScientific && !dataTypeIsScientific && !('data' in candidate))) return undefined;
  return id.startsWith('artifact:') ? id : `artifact:${id}`;
}

function isReplayRefKey(key: string) {
  return /(?:^ref$|Ref$|Refs$|ref$|refs$|path$|Path$)/.test(key);
}

function isReplayRefCollectionKey(key: string) {
  return /(?:Refs$|refs$|references$|References$|artifacts$|Artifacts$)/.test(key);
}

function scientificVerdictFromTaskResult(taskResult: unknown): ScientificReproductionTrajectory['finalVerdict'] | undefined {
  const verdicts: string[] = [];
  for (const candidate of flattenRecords(taskResult)) {
    if (typeof candidate.verdict === 'string') verdicts.push(candidate.verdict);
    if (typeof candidate.result === 'string') verdicts.push(candidate.result);
  }
  if (verdicts.some((verdict) => verdict === 'contradicted')) return 'contradicted';
  if (verdicts.some((verdict) => verdict === 'not-reproduced')) return 'not-reproduced';
  if (verdicts.some((verdict) => verdict === 'partially-reproduced')) return 'partially-reproduced';
  if (verdicts.some((verdict) => verdict === 'reproduced')) return 'reproduced';
  return undefined;
}

function scientificNegativeVerdictFromTaskResult(taskResult: unknown) {
  return scientificVerdictFromTaskResult(taskResult) === 'not-reproduced'
    || scientificVerdictFromTaskResult(taskResult) === 'contradicted';
}

function timestamp(value: string | undefined, now: (() => Date) | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? (now?.() ?? new Date()).toISOString() : new Date(parsed).toISOString();
}

function summarizePrompt(value: string | undefined) {
  const trimmed = String(value || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'No prompt text recorded.';
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

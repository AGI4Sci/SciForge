import {
  NO_HARDCODE_REVIEW_SCHEMA_VERSION,
  type FailureSignatureRegistry,
  type FailureSignatureRegistryEntry,
  type NoHardcodeReview,
  type TaskAttributionLayer,
  type TaskRunCard,
} from './task-run-card';

export const USER_FEEDBACK_CONVERGENCE_SCHEMA_VERSION = 'sciforge.user-feedback-convergence.v1' as const;
export const USER_FEEDBACK_CONVERGENCE_CONTRACT_ID = 'sciforge.user-feedback-convergence.v1' as const;

export type UserFeedbackSignalKind =
  | 'latency'
  | 'crash'
  | 'unclear-result'
  | 'citation-mismatch'
  | 'duplicate-work'
  | 'goal-miss'
  | 'unknown';

export type UserFeedbackSignalSeverity = 'low' | 'normal' | 'high' | 'urgent';
export type UserFeedbackConvergenceStatus = 'ready' | 'empty';

export interface UserFeedbackSignalInput {
  id: string;
  text: string;
  priority?: UserFeedbackSignalSeverity | string;
  status?: string;
  tags?: string[];
  page?: string;
  scenarioId?: string;
  sessionId?: string;
  activeRunId?: string;
  sourceRefs?: string[];
  taskRunCardRefs?: string[];
  failureSignatureRefs?: string[];
}

export interface UserFeedbackSignal {
  id: string;
  rawText: string;
  kind: UserFeedbackSignalKind;
  severity: UserFeedbackSignalSeverity;
  evidenceTokens: string[];
  refs: string[];
  source: {
    page?: string;
    scenarioId?: string;
    sessionId?: string;
    activeRunId?: string;
  };
}

export interface FeedbackTodoCandidate {
  todoId: string;
  title: string;
  signalKind: UserFeedbackSignalKind;
  ownerLayer: TaskAttributionLayer;
  severity: UserFeedbackSignalSeverity;
  dedupeKey: string;
  occurrenceCount: number;
  sourceSignalIds: string[];
  sourceRefs: string[];
  taskRunCardRefs: string[];
  failureSignatureRefs: string[];
  acceptanceCriteria: string[];
  nextStep: string;
  noHardcodeReview: NoHardcodeReview;
}

export interface UserFeedbackConvergenceInput {
  signals: UserFeedbackSignalInput[];
  taskRunCards?: TaskRunCard[];
  failureSignatureRegistry?: FailureSignatureRegistry;
  createdAt?: string;
  source?: string;
}

export interface UserFeedbackConvergence {
  schemaVersion: typeof USER_FEEDBACK_CONVERGENCE_SCHEMA_VERSION;
  contract: typeof USER_FEEDBACK_CONVERGENCE_CONTRACT_ID;
  status: UserFeedbackConvergenceStatus;
  createdAt: string;
  source?: string;
  signals: UserFeedbackSignal[];
  todoCandidates: FeedbackTodoCandidate[];
  unclassifiedSignalIds: string[];
  diagnostics: string[];
  nextActions: string[];
}

interface FeedbackConvergenceRule {
  kind: UserFeedbackSignalKind;
  ownerLayer: TaskAttributionLayer;
  title: string;
  evidenceTokens: string[];
  patterns: RegExp[];
  acceptanceCriteria: string[];
  nextStep: string;
  supportingFailureKinds?: FailureSignatureRegistryEntry['kind'][];
  supportingTaskLayers?: TaskAttributionLayer[];
}

const FEEDBACK_CONVERGENCE_RULES: FeedbackConvergenceRule[] = [{
  kind: 'latency',
  ownerLayer: 'runtime-server',
  title: 'Converge slow or stuck work into runtime progress and budget repair',
  evidenceTokens: ['latency', 'timeout', 'stuck-progress', 'background-work'],
  patterns: [/慢|卡|等太久|等很久|没反应|超时|一直转|slow|latency|timeout|stuck|hang/i],
  acceptanceCriteria: [
    'Runtime progress must expose current stage, wait reason, and next action.',
    'Long work must have a bounded background or retry policy with refs.',
    'The same high-cost operation must not restart without explicit authorization.',
  ],
  nextStep: 'Inspect latency budget, progress events, and timeout failure signatures before rerun.',
  supportingFailureKinds: ['timeout'],
  supportingTaskLayers: ['runtime-server', 'harness'],
}, {
  kind: 'crash',
  ownerLayer: 'verification',
  title: 'Converge crash reports into failed-result diagnostics and verification evidence',
  evidenceTokens: ['crash', 'blank-page', 'exception', 'failed-run'],
  patterns: [/崩|闪退|白屏|报错|异常|crash|blank|exception|failed|error/i],
  acceptanceCriteria: [
    'Failure UI must show user-readable cause, reusable refs, and recovery actions.',
    'Repair evidence must include a focused test or smoke result.',
    'Protocol success cannot be treated as task success when the user-visible result failed.',
  ],
  nextStep: 'Attach failed run refs and verification evidence, then repair the generic failure boundary.',
  supportingFailureKinds: ['schema-drift', 'external-transient', 'repair-no-op'],
  supportingTaskLayers: ['verification', 'runtime-server', 'payload-normalization'],
}, {
  kind: 'unclear-result',
  ownerLayer: 'presentation',
  title: 'Converge unclear result feedback into presentation clarity repair',
  evidenceTokens: ['unclear-result', 'raw-trace-visible', 'presentation-order'],
  patterns: [/看不懂|不清楚|太乱|难懂|trace 太多|raw trace|unclear|confusing|hard to understand/i],
  acceptanceCriteria: [
    'The first visible result must prioritize answer, confidence, risk, and next action.',
    'Raw logs, traces, and diagnostics must be folded by default.',
    'Artifact, run, and execution refs must remain inspectable from the result.',
  ],
  nextStep: 'Project existing runtime refs through the result-presentation contract before changing task logic.',
  supportingTaskLayers: ['presentation', 'ui'],
}, {
  kind: 'citation-mismatch',
  ownerLayer: 'verification',
  title: 'Converge citation and reference complaints into evidence repair',
  evidenceTokens: ['citation-mismatch', 'unsupported-claim', 'stale-reference'],
  patterns: [/引用错|证据错|来源错|不可信|citation|cite|reference|unsupported|hallucinat/i],
  acceptanceCriteria: [
    'Each corrected claim must point to source refs, artifact refs, or paper ids.',
    'Only the targeted claim or citation is revised; unrelated artifacts stay unchanged.',
    'Evidence gaps and uncertainty must be explicit instead of inferred.',
  ],
  nextStep: 'Locate the cited artifact/ref, run evidence verification, and emit a derived correction artifact.',
  supportingFailureKinds: ['schema-drift'],
  supportingTaskLayers: ['verification', 'payload-normalization', 'presentation'],
}, {
  kind: 'duplicate-work',
  ownerLayer: 'resume',
  title: 'Converge duplicate rerun complaints into resume and side-effect guard repair',
  evidenceTokens: ['duplicate-work', 'rerun-loop', 'side-effect-guard'],
  patterns: [/重复跑|重复执行|又跑|重新跑|别重试|反复|duplicate|rerun|again and again|loop/i],
  acceptanceCriteria: [
    'Continuation must list reusable refs and non-reusable side-effect boundaries.',
    'The same side effect cannot run again without an explicit new user intent.',
    'History, refresh, and compaction recovery must preserve artifact and run refs.',
  ],
  nextStep: 'Inspect resume state, failure registry dedupe, and side-effect policy before continuing.',
  supportingFailureKinds: ['repair-no-op'],
  supportingTaskLayers: ['resume', 'workspace', 'runtime-server'],
}, {
  kind: 'goal-miss',
  ownerLayer: 'harness',
  title: 'Converge missed-goal feedback into intent and acceptance repair',
  evidenceTokens: ['goal-miss', 'acceptance-gap', 'latest-request'],
  patterns: [/没按我说|答非所问|目标错|范围错|不是我要的|wrong goal|missed request|not what i asked/i],
  acceptanceCriteria: [
    'The latest user request must update the task goal and acceptance criteria.',
    'Changed scope must identify affected refs and stale conclusions.',
    'Unmet user goals must become needs-work or needs-human, not completed.',
  ],
  nextStep: 'Compare the latest user request with the TaskRunCard acceptance state before repair.',
  supportingTaskLayers: ['harness', 'verification'],
}];

export function createUserFeedbackConvergence(input: UserFeedbackConvergenceInput): UserFeedbackConvergence {
  const createdAt = normalizedText(input.createdAt) ?? 'pending-clock';
  const normalizedSignals = input.signals.map((signal) => normalizeUserFeedbackSignal(signal)).filter((signal) => signal.id && signal.rawText);
  if (!normalizedSignals.length) {
    return {
      schemaVersion: USER_FEEDBACK_CONVERGENCE_SCHEMA_VERSION,
      contract: USER_FEEDBACK_CONVERGENCE_CONTRACT_ID,
      status: 'empty',
      createdAt,
      source: normalizedText(input.source),
      signals: [],
      todoCandidates: [],
      unclassifiedSignalIds: [],
      diagnostics: ['No user feedback signals were available for convergence.'],
      nextActions: ['Collect feedback comments with runtime refs before creating generic TODOs.'],
    };
  }

  const evidence = buildEvidenceIndex(input.taskRunCards ?? [], input.failureSignatureRegistry);
  const todoCandidates = convergeSignalsIntoTodos(normalizedSignals, evidence);
  const unclassifiedSignalIds = normalizedSignals.filter((signal) => signal.kind === 'unknown').map((signal) => signal.id);
  return {
    schemaVersion: USER_FEEDBACK_CONVERGENCE_SCHEMA_VERSION,
    contract: USER_FEEDBACK_CONVERGENCE_CONTRACT_ID,
    status: 'ready',
    createdAt,
    source: normalizedText(input.source),
    signals: normalizedSignals,
    todoCandidates,
    unclassifiedSignalIds,
    diagnostics: unclassifiedSignalIds.length
      ? [`${unclassifiedSignalIds.length} feedback signal(s) require human classification before repair.`]
      : [],
    nextActions: [
      ...todoCandidates.map((todo) =>
        `Create or update ${todo.todoId} at ${todo.ownerLayer}; covers ${todo.occurrenceCount} feedback signal(s).`
      ),
      ...(unclassifiedSignalIds.length ? [`Human-triage unclassified signals: ${unclassifiedSignalIds.join(', ')}.`] : []),
    ],
  };
}

export function normalizeUserFeedbackSignal(input: UserFeedbackSignalInput): UserFeedbackSignal {
  const id = normalizedText(input.id) ?? '';
  const rawText = normalizedText(input.text) ?? '';
  const text = [rawText, ...(input.tags ?? []), input.page, input.scenarioId].filter(Boolean).join(' ');
  const rule = FEEDBACK_CONVERGENCE_RULES.find((candidate) => candidate.patterns.some((pattern) => pattern.test(text)));
  const sourceRefs = uniqueStrings([
    ...(input.sourceRefs ?? []),
    ...(input.taskRunCardRefs ?? []),
    ...(input.failureSignatureRefs ?? []),
    input.sessionId ? `session:${input.sessionId}` : '',
    input.activeRunId ? `run:${input.activeRunId}` : '',
  ]);
  return {
    id,
    rawText,
    kind: rule?.kind ?? 'unknown',
    severity: normalizeSeverity(input.priority),
    evidenceTokens: uniqueStrings(rule?.evidenceTokens ?? ['needs-human-triage']),
    refs: sourceRefs,
    source: {
      page: normalizedText(input.page),
      scenarioId: normalizedText(input.scenarioId),
      sessionId: normalizedText(input.sessionId),
      activeRunId: normalizedText(input.activeRunId),
    },
  };
}

export function mergeUserFeedbackConvergence(
  left: UserFeedbackConvergence | undefined,
  right: UserFeedbackConvergence,
): UserFeedbackConvergence {
  if (!left || left.status === 'empty') return right;
  const bySignalId = new Map([...left.signals, ...right.signals].map((signal) => [signal.id, signal]));
  const merged = createUserFeedbackConvergence({
    signals: [...bySignalId.values()].map((signal) => ({
      id: signal.id,
      text: signal.rawText,
      priority: signal.severity,
      page: signal.source.page,
      scenarioId: signal.source.scenarioId,
      sessionId: signal.source.sessionId,
      activeRunId: signal.source.activeRunId,
      sourceRefs: signal.refs,
    })),
    createdAt: maxString([left.createdAt, right.createdAt]) ?? right.createdAt,
    source: right.source ?? left.source,
  });
  return {
    ...merged,
    todoCandidates: mergeTodoCandidates([...left.todoCandidates, ...right.todoCandidates, ...merged.todoCandidates]),
    diagnostics: uniqueStrings([...left.diagnostics, ...right.diagnostics, ...merged.diagnostics]),
    nextActions: uniqueStrings([...left.nextActions, ...right.nextActions, ...merged.nextActions]),
  };
}

export function userFeedbackConvergenceHasActionableTodos(plan: UserFeedbackConvergence): boolean {
  return plan.status === 'ready'
    && plan.todoCandidates.length > 0
    && plan.todoCandidates.every((todo) =>
      todo.sourceSignalIds.length > 0
      && todo.acceptanceCriteria.length > 0
      && todo.noHardcodeReview.status === 'pass'
      && todo.noHardcodeReview.appliesGenerally
    );
}

export function validateUserFeedbackConvergence(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ['UserFeedbackConvergence must be an object.'];
  if (value.schemaVersion !== USER_FEEDBACK_CONVERGENCE_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${USER_FEEDBACK_CONVERGENCE_SCHEMA_VERSION}.`);
  }
  if (value.contract !== USER_FEEDBACK_CONVERGENCE_CONTRACT_ID) {
    issues.push(`contract must be ${USER_FEEDBACK_CONVERGENCE_CONTRACT_ID}.`);
  }
  if (!Array.isArray(value.signals)) issues.push('signals must be an array.');
  if (!Array.isArray(value.todoCandidates)) issues.push('todoCandidates must be an array.');
  for (const [index, todo] of Array.isArray(value.todoCandidates) ? value.todoCandidates.entries() : []) {
    if (!isRecord(todo)) {
      issues.push(`todoCandidates[${index}] must be an object.`);
      continue;
    }
    if (!normalizedText(todo.todoId)) issues.push(`todoCandidates[${index}].todoId is required.`);
    if (!normalizedText(todo.dedupeKey)) issues.push(`todoCandidates[${index}].dedupeKey is required.`);
    if (!Array.isArray(todo.sourceSignalIds) || !todo.sourceSignalIds.length) issues.push(`todoCandidates[${index}].sourceSignalIds must be non-empty.`);
    if (!isRecord(todo.noHardcodeReview)) {
      issues.push(`todoCandidates[${index}].noHardcodeReview is required.`);
    } else if (todo.noHardcodeReview.status === 'pass' && todo.noHardcodeReview.appliesGenerally !== true) {
      issues.push(`todoCandidates[${index}].noHardcodeReview must apply generally when passing.`);
    }
  }
  return issues;
}

interface FeedbackEvidenceIndex {
  byKind: Map<UserFeedbackSignalKind, {
    taskRunCardRefs: string[];
    failureSignatureRefs: string[];
    sourceRefs: string[];
    ownerLayers: TaskAttributionLayer[];
  }>;
}

function convergeSignalsIntoTodos(signals: UserFeedbackSignal[], evidence: FeedbackEvidenceIndex): FeedbackTodoCandidate[] {
  const grouped = new Map<UserFeedbackSignalKind, UserFeedbackSignal[]>();
  for (const signal of signals) grouped.set(signal.kind, [...(grouped.get(signal.kind) ?? []), signal]);
  const todos = [...grouped.entries()].map(([kind, items]) => todoForSignalGroup(kind, items, evidence));
  return mergeTodoCandidates(todos).sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || left.signalKind.localeCompare(right.signalKind));
}

function todoForSignalGroup(kind: UserFeedbackSignalKind, signals: UserFeedbackSignal[], evidence: FeedbackEvidenceIndex): FeedbackTodoCandidate {
  const rule = FEEDBACK_CONVERGENCE_RULES.find((candidate) => candidate.kind === kind);
  const evidenceForKind = evidence.byKind.get(kind);
  const ownerLayer = ownerLayerForTodo(kind, evidenceForKind?.ownerLayers ?? [], rule?.ownerLayer ?? 'unknown');
  const sourceSignalIds = uniqueStrings(signals.map((signal) => signal.id));
  const signalRefs = uniqueStrings(signals.flatMap((signal) => signal.refs));
  const sourceRefs = uniqueStrings([...signalRefs, ...(evidenceForKind?.sourceRefs ?? [])]);
  const taskRunCardRefs = uniqueStrings([...(evidenceForKind?.taskRunCardRefs ?? []), ...sourceRefs.filter((ref) => ref.startsWith('task-card:'))]);
  const failureSignatureRefs = uniqueStrings([...(evidenceForKind?.failureSignatureRefs ?? []), ...sourceRefs.filter((ref) => ref.startsWith('failure:') || ref.startsWith('failure-registry:'))]);
  const dedupeKey = stableKey([kind, ownerLayer]);
  return {
    todoId: `todo.feedback.${kind}.${dedupeKey}`,
    title: rule?.title ?? 'Converge unclassified feedback into an owner-layer TODO',
    signalKind: kind,
    ownerLayer,
    severity: maxSeverity(signals.map((signal) => signal.severity)),
    dedupeKey,
    occurrenceCount: sourceSignalIds.length,
    sourceSignalIds,
    sourceRefs,
    taskRunCardRefs,
    failureSignatureRefs,
    acceptanceCriteria: rule?.acceptanceCriteria ?? [
      'Classify the user feedback with stable runtime evidence.',
      'Record owner layer, refs, and a no-hardcode review before repair.',
    ],
    nextStep: rule?.nextStep ?? 'Add missing runtime evidence, then classify the feedback into a generic owner layer.',
    noHardcodeReview: noHardcodeReviewForFeedback(ownerLayer, kind),
  };
}

function buildEvidenceIndex(taskRunCards: TaskRunCard[], registry: FailureSignatureRegistry | undefined): FeedbackEvidenceIndex {
  const byKind = new Map<UserFeedbackSignalKind, {
    taskRunCardRefs: string[];
    failureSignatureRefs: string[];
    sourceRefs: string[];
    ownerLayers: TaskAttributionLayer[];
  }>();
  const add = (
    kind: UserFeedbackSignalKind,
    input: {
      taskRunCardRefs?: string[];
      failureSignatureRefs?: string[];
      sourceRefs?: string[];
      ownerLayers?: TaskAttributionLayer[];
    },
  ) => {
    const current = byKind.get(kind) ?? { taskRunCardRefs: [], failureSignatureRefs: [], sourceRefs: [], ownerLayers: [] };
    byKind.set(kind, {
      taskRunCardRefs: uniqueStrings([...current.taskRunCardRefs, ...(input.taskRunCardRefs ?? [])]),
      failureSignatureRefs: uniqueStrings([...current.failureSignatureRefs, ...(input.failureSignatureRefs ?? [])]),
      sourceRefs: uniqueStrings([...current.sourceRefs, ...(input.sourceRefs ?? [])]),
      ownerLayers: uniqueLayers([...current.ownerLayers, ...(input.ownerLayers ?? [])]),
    });
  };

  for (const card of taskRunCards) {
    const cardRef = card.id.startsWith('task-card:') ? card.id : `task-card:${card.id}`;
    const cardRefs = [cardRef, ...card.refs.map((ref) => ref.ref), ...card.verificationRefs];
    const layers = uniqueLayers([card.genericAttributionLayer, ...card.ownershipLayerSuggestions.map((suggestion) => suggestion.layer)]);
    for (const kind of kindsForTaskRunCard(card)) {
      add(kind, {
        taskRunCardRefs: [cardRef],
        failureSignatureRefs: card.failureSignatures.map((signature) => signature.id),
        sourceRefs: cardRefs,
        ownerLayers: layers,
      });
    }
  }

  for (const entry of registry?.entries ?? []) {
    for (const kind of kindsForFailureRegistryEntry(entry)) {
      add(kind, {
        failureSignatureRefs: [entry.id, ...entry.signatureIds],
        sourceRefs: [...entry.refs, ...entry.runRefs.flatMap((runRef) => [runRef.runId, runRef.sessionBundleRef, ...runRef.refs].filter(isString))],
        ownerLayers: [entry.layer],
      });
    }
  }
  return { byKind };
}

function kindsForTaskRunCard(card: TaskRunCard): UserFeedbackSignalKind[] {
  const kinds = new Set<UserFeedbackSignalKind>();
  const layers = new Set([card.genericAttributionLayer, ...card.ownershipLayerSuggestions.map((suggestion) => suggestion.layer)]);
  if (card.failureSignatures.some((signature) => signature.kind === 'timeout')) kinds.add('latency');
  if (card.failureSignatures.some((signature) => signature.kind === 'repair-no-op')) kinds.add('duplicate-work');
  if (card.status === 'failed' || card.taskOutcome === 'blocked') kinds.add('crash');
  if (layers.has('presentation') || layers.has('ui')) kinds.add('unclear-result');
  if (layers.has('verification')) kinds.add('citation-mismatch');
  if (card.taskOutcome === 'needs-work' || card.status === 'needs-work') kinds.add('goal-miss');
  return [...kinds];
}

function kindsForFailureRegistryEntry(entry: FailureSignatureRegistryEntry): UserFeedbackSignalKind[] {
  if (entry.kind === 'timeout') return ['latency'];
  if (entry.kind === 'repair-no-op') return ['duplicate-work'];
  if (entry.kind === 'schema-drift') return ['crash', 'citation-mismatch'];
  if (entry.kind === 'external-transient') return ['latency', 'crash'];
  return [];
}

function mergeTodoCandidates(candidates: FeedbackTodoCandidate[]) {
  const byKey = new Map<string, FeedbackTodoCandidate>();
  for (const candidate of candidates) {
    const current = byKey.get(candidate.dedupeKey);
    if (!current) {
      byKey.set(candidate.dedupeKey, candidate);
      continue;
    }
    const sourceSignalIds = uniqueStrings([...current.sourceSignalIds, ...candidate.sourceSignalIds]);
    byKey.set(candidate.dedupeKey, {
      ...current,
      severity: maxSeverity([current.severity, candidate.severity]),
      occurrenceCount: sourceSignalIds.length,
      sourceSignalIds,
      sourceRefs: uniqueStrings([...current.sourceRefs, ...candidate.sourceRefs]),
      taskRunCardRefs: uniqueStrings([...current.taskRunCardRefs, ...candidate.taskRunCardRefs]),
      failureSignatureRefs: uniqueStrings([...current.failureSignatureRefs, ...candidate.failureSignatureRefs]),
      acceptanceCriteria: uniqueStrings([...current.acceptanceCriteria, ...candidate.acceptanceCriteria]),
    });
  }
  return [...byKey.values()];
}

function noHardcodeReviewForFeedback(ownerLayer: TaskAttributionLayer, kind: UserFeedbackSignalKind): NoHardcodeReview {
  return {
    schemaVersion: NO_HARDCODE_REVIEW_SCHEMA_VERSION,
    appliesGenerally: true,
    generalityStatement: `User feedback convergence maps normalized complaint kind (${kind}) plus stable runtime evidence refs to owner-layer TODOs; it is not tied to a specific milestone, exact phrase, file name, paper title, or backend.`,
    counterExamples: [
      'The same latency TODO must cover "slow", "stuck", "timeout", and equivalent localized wording.',
      'A citation mismatch must use evidence refs and not a paper-title-specific branch.',
      'Duplicate work complaints must converge by side-effect/resume evidence instead of one prompt string.',
    ],
    forbiddenSpecialCases: [
      'specific milestone phrase branch',
      'prompt-specific apology branch',
      'file-name-specific fix path',
      'paper-title-specific citation fix',
      'backend-specific success path',
    ],
    ownerLayer,
    status: 'pass',
  };
}

function strongestOwnerLayer(layers: TaskAttributionLayer[], fallback: TaskAttributionLayer): TaskAttributionLayer {
  const unique = uniqueLayers(layers.filter((layer) => layer !== 'unknown'));
  return unique[0] ?? fallback;
}

function ownerLayerForTodo(
  kind: UserFeedbackSignalKind,
  evidenceLayers: TaskAttributionLayer[],
  fallback: TaskAttributionLayer,
): TaskAttributionLayer {
  if (kind === 'duplicate-work') return 'resume';
  if (kind === 'unclear-result') return 'presentation';
  if (kind === 'citation-mismatch') return 'verification';
  return strongestOwnerLayer(evidenceLayers, fallback);
}

function normalizeSeverity(value: unknown): UserFeedbackSignalSeverity {
  if (value === 'low' || value === 'normal' || value === 'high' || value === 'urgent') return value;
  return 'normal';
}

function maxSeverity(values: UserFeedbackSignalSeverity[]) {
  return values.slice().sort((left, right) => severityRank(right) - severityRank(left))[0] ?? 'normal';
}

function severityRank(value: UserFeedbackSignalSeverity) {
  return ({ low: 0, normal: 1, high: 2, urgent: 3 } satisfies Record<UserFeedbackSignalSeverity, number>)[value];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function uniqueLayers(values: TaskAttributionLayer[]) {
  return Array.from(new Set(values.filter((value) => value && value !== 'unknown'))).sort();
}

function normalizedText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stableKey(parts: string[]) {
  return hashText(parts.map((part) => part.trim().toLowerCase()).join('|')).slice(0, 12);
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  return Math.abs(hash).toString(36);
}

function maxString(values: Array<string | undefined>) {
  return values.filter(isString).sort().at(-1);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

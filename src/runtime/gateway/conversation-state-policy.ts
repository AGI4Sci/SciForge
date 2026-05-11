export const CONVERSATION_STATE_POLICY_SCHEMA_VERSION = 'sciforge.conversation.state-policy.v1' as const;
export const CONVERSATION_STATE_DIGEST_SCHEMA_VERSION = 'sciforge.conversation.state-digest.v1' as const;
export const CONVERSATION_RESUME_PREFLIGHT_SCHEMA_VERSION = 'sciforge.conversation.resume-preflight.v1' as const;
export const CONVERSATION_HISTORY_BRANCH_SCHEMA_VERSION = 'sciforge.conversation.history-branch.v1' as const;
export const CONVERSATION_RECOVERY_PLAN_V2_SCHEMA_VERSION = 'sciforge.conversation.recovery-plan.v2' as const;
export const CONVERSATION_ORDER_GUARD_SCHEMA_VERSION = 'sciforge.conversation.order-guard.v1' as const;

type JsonMap = Record<string, unknown>;

export type ConversationTaskStatus = 'unknown' | 'active' | 'blocked' | 'failed' | 'completed' | 'cancelled';
export type WorkStatus = 'pending' | 'active' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'skipped';
export type ResumePreflightStatus = 'ready' | 'stale' | 'invalid' | 'needs-human';
export type TurnRelation = 'new-requirement' | 'follow-up' | 'failure-recovery' | 'background-revisit' | 'scope-change';
export type HistoryMutationMode = 'revert' | 'continue' | 'branch' | 'merge';
export type InterruptionKind = 'interrupted-output' | 'interrupted-tool' | 'interrupted-repair' | 'interrupted-background-job' | 'none' | 'unknown';
export type GuardDecision = 'allow' | 'serialize' | 'branch' | 'needs-human' | 'reject-stale';

export interface ConversationEvidenceRecord {
  id: string;
  kind: string;
  ref: string;
  status: string;
  summary?: string;
  stable: boolean;
}

export interface ConversationWorkItem {
  id: string;
  title: string;
  status: WorkStatus;
  refs: string[];
  reason?: string;
}

export interface ConversationFailureState {
  code: string;
  message: string;
  ref?: string;
  retryable: boolean;
  atTurnId?: string;
  atRunId?: string;
}

export interface ConversationRecoverableAction {
  id: string;
  action: 'resume' | 'repair' | 'rerun' | 'refresh' | 'skip' | 'ask-user' | 'background';
  label: string;
  refs: string[];
  sideEffectPolicy: 'none' | 'read-only' | 'idempotent' | 'requires-approval';
}

export interface ConversationBackgroundJob {
  id: string;
  status: string;
  title: string;
  refs: string[];
  lastEventTurnId?: string;
}

export interface ConversationTaskState {
  schemaVersion: typeof CONVERSATION_STATE_POLICY_SCHEMA_VERSION;
  taskId: string;
  status: ConversationTaskStatus;
  userGoal: string;
  currentSubgoals: ConversationWorkItem[];
  completedEvidence: ConversationEvidenceRecord[];
  pendingWork: ConversationWorkItem[];
  blockedWork: ConversationWorkItem[];
  lastFailure?: ConversationFailureState;
  recoverableActions: ConversationRecoverableAction[];
  backgroundJobs: ConversationBackgroundJob[];
  artifactRefs: string[];
  runRefs: string[];
  uncertainty: string[];
  updatedAtTurnId?: string;
}

export interface ConversationResumeState {
  schemaVersion: typeof CONVERSATION_STATE_POLICY_SCHEMA_VERSION;
  sessionId: string;
  threadId: string;
  lastDurableTurnId: string;
  lastStableCheckpointRef?: string;
  pendingRuns: string[];
  backgroundJobs: ConversationBackgroundJob[];
  artifactLineage: ConversationArtifactLineageRecord[];
  clientStateFreshness: 'fresh' | 'stale' | 'missing' | 'unknown';
  stateAuthority: 'persistent-store' | 'checkpoint' | 'client' | 'digest' | 'unknown';
  workspacePath?: string;
}

export interface ConversationArtifactLineageRecord {
  artifactRef: string;
  sourceTurnId?: string;
  sourceRunId?: string;
  parentRefs: string[];
  status: 'active' | 'stale' | 'discarded' | 'conflict' | 'unknown';
}

export interface HistoryMutationPolicy {
  schemaVersion: typeof CONVERSATION_STATE_POLICY_SCHEMA_VERSION;
  mode: HistoryMutationMode;
  inheritState: boolean;
  discardDerivedState: boolean;
  preserveRefs: string[];
  discardRefs: string[];
  conflictRefs: string[];
  affectedTurnIds: string[];
  sideEffectPolicy: 'block-unsafe-replay' | 'preserve-as-context' | 'isolate-branch' | 'merge-with-conflict-check';
  recommendedNext: 'rerun-from-edit' | 'continue-with-conflicts' | 'continue-on-branch' | 'merge-review';
  auditNotes: string[];
}

export interface ConversationStateDigest {
  schemaVersion: typeof CONVERSATION_STATE_DIGEST_SCHEMA_VERSION;
  taskId: string;
  relation: TurnRelation;
  summary: string;
  stateRefs: string[];
  completedRefs: string[];
  pendingWork: string[];
  blockedWork: string[];
  recoverableActions: string[];
  backgroundJobs: string[];
  carryForwardRefs: string[];
  invalidatedRefs: string[];
  uncertainty: string[];
  handoffPolicy: 'digest-and-refs-only';
}

export interface ResumePreflightCheck {
  name: string;
  status: ResumePreflightStatus;
  reason: string;
  refs: string[];
}

export interface ResumePreflightReport {
  schemaVersion: typeof CONVERSATION_RESUME_PREFLIGHT_SCHEMA_VERSION;
  status: ResumePreflightStatus;
  checks: ResumePreflightCheck[];
  reusableRefs: string[];
  invalidatedRefs: string[];
  staleRefs: string[];
  requiredActions: string[];
  sideEffectPolicy: 'no-side-effects' | 'read-only-refresh' | 'needs-human';
}

export interface RecoveryPlan {
  schemaVersion: typeof CONVERSATION_RECOVERY_PLAN_V2_SCHEMA_VERSION;
  status: 'ready' | 'blocked' | 'needs-human' | 'not-recoverable';
  reusableEvidenceRefs: string[];
  rerunWorkIds: string[];
  skippableWorkIds: string[];
  userOptions: ConversationRecoverableAction[];
  recommendedNext: string;
  sideEffectPolicy: 'none' | 'read-only' | 'idempotent' | 'requires-approval';
  reason: string;
}

export interface InterruptionClassification {
  schemaVersion: typeof CONVERSATION_STATE_POLICY_SCHEMA_VERSION;
  kind: InterruptionKind;
  recoveryStrategy: 'continue-stream' | 'poll-tool-result' | 'resume-repair' | 'reconcile-background-job' | 'none' | 'needs-human';
  sideEffectPolicy: 'none' | 'read-only' | 'idempotent' | 'requires-approval';
  refs: string[];
  reason: string;
}

export interface HistoryBranchRecord {
  schemaVersion: typeof CONVERSATION_HISTORY_BRANCH_SCHEMA_VERSION;
  branchId: string;
  mode: HistoryMutationMode;
  baseTurnId: string;
  beforeMessage: JsonMap;
  afterMessage: JsonMap;
  affectedTurnIds: string[];
  discardedRunRefs: string[];
  preservedRefs: string[];
  conflictRefs: string[];
  recommendedPolicy: HistoryMutationPolicy;
}

export interface ConflictOrderGuard {
  schemaVersion: typeof CONVERSATION_ORDER_GUARD_SCHEMA_VERSION;
  decision: GuardDecision;
  sessionId: string;
  threadId: string;
  expectedRevision?: string;
  actualRevision?: string;
  conflictingClientIds: string[];
  reason: string;
}

export function buildConversationTaskState(input: unknown = {}): ConversationTaskState {
  const data = recordValue(input) ?? {};
  const task = firstRecord(data.taskState, data.task, data);
  const runs = arrayValue(firstValue(data, 'runs', 'executionUnits', 'attempts'));
  const artifacts = arrayValue(firstValue(data, 'artifacts', 'artifactIndexEntries'));
  const workItems = workItemsFrom(task, runs);
  const completedEvidence = evidenceFrom(task, artifacts, runs);
  const lastFailure = failureFrom(task, runs);
  const backgroundJobs = backgroundJobsFrom(firstValue(task, 'backgroundJobs', 'jobs') ?? data.backgroundJobs);
  const pendingWork = workItems.filter((item) => item.status === 'pending' || item.status === 'active');
  const blockedWork = workItems.filter((item) => item.status === 'blocked' || item.status === 'failed');
  const status = taskStatus(task, pendingWork, blockedWork, lastFailure);
  const artifactRefs = dedupe([
    ...refsFrom(task),
    ...completedEvidence.map((item) => item.ref),
    ...artifacts.flatMap(refsFrom),
  ]);
  const runRefs = dedupe(runs.flatMap((run) => {
    const item = recordValue(run) ?? {};
    return [stringValue(item.id), stringValue(item.runId), ...refsFrom(item)].filter(isString);
  }));

  return {
    schemaVersion: CONVERSATION_STATE_POLICY_SCHEMA_VERSION,
    taskId: firstText(task.id, task.taskId, data.taskId) ?? stableId('task', firstText(task.userGoal, task.goal, data.prompt) ?? 'conversation'),
    status,
    userGoal: firstText(task.userGoal, task.goal, task.prompt, data.prompt) ?? '',
    currentSubgoals: workItems.filter((item) => item.status !== 'completed' && item.status !== 'skipped').slice(0, 12),
    completedEvidence,
    pendingWork,
    blockedWork,
    lastFailure,
    recoverableActions: recoverableActionsFrom(task, lastFailure, pendingWork, blockedWork),
    backgroundJobs,
    artifactRefs,
    runRefs,
    uncertainty: uncertaintyFrom(task, lastFailure, artifactRefs),
    updatedAtTurnId: firstText(task.updatedAtTurnId, data.turnId),
  };
}

export function buildConversationResumeState(input: unknown = {}): ConversationResumeState {
  const data = recordValue(input) ?? {};
  const session = firstRecord(data.resumeState, data.session, data);
  const thread = firstRecord(data.thread, data);
  const artifactLineage = lineageFrom(firstValue(session, 'artifactLineage', 'artifacts') ?? data.artifactLineage);
  return {
    schemaVersion: CONVERSATION_STATE_POLICY_SCHEMA_VERSION,
    sessionId: firstText(session.sessionId, session.id, data.sessionId) ?? 'unknown-session',
    threadId: firstText(thread.threadId, session.threadId, data.threadId) ?? 'unknown-thread',
    lastDurableTurnId: firstText(session.lastDurableTurnId, session.lastTurnId, data.lastDurableTurnId) ?? '',
    lastStableCheckpointRef: firstText(session.lastStableCheckpointRef, session.checkpointRef, data.lastStableCheckpointRef),
    pendingRuns: stringList(firstValue(session, 'pendingRuns', 'pendingRunRefs') ?? data.pendingRuns),
    backgroundJobs: backgroundJobsFrom(firstValue(session, 'backgroundJobs', 'jobs') ?? data.backgroundJobs),
    artifactLineage,
    clientStateFreshness: freshnessFrom(firstText(session.clientStateFreshness, data.clientStateFreshness), artifactLineage),
    stateAuthority: authorityFrom(firstText(session.stateAuthority, data.stateAuthority), session),
    workspacePath: firstText(session.workspacePath, data.workspacePath, recordValue(data.workspace)?.root),
  };
}

export function buildConversationStateDigest(input: unknown = {}): ConversationStateDigest {
  const data = recordValue(input) ?? {};
  const task = normalizeTaskState(firstValue(data, 'taskState', 'task') ?? data);
  const resume = recordValue(data.resumeState) ? buildConversationResumeState(data.resumeState) : undefined;
  const mutation = recordValue(data.historyMutation) ? buildHistoryMutationPolicy(data.historyMutation) : undefined;
  const preflight = recordValue(data.preflight) ? runResumePreflight(data.preflight) : undefined;
  const relation = classifyTurnRelation(data, task, preflight);
  const invalidatedRefs = dedupe([
    ...(mutation?.discardRefs ?? []),
    ...(mutation?.conflictRefs ?? []),
    ...(preflight?.invalidatedRefs ?? []),
  ]);
  const completedRefs = task.completedEvidence.map((item) => item.ref);
  const carryForwardRefs = dedupe([
    ...completedRefs,
    ...task.artifactRefs,
    ...(resume?.artifactLineage ?? []).filter((item) => item.status === 'active').map((item) => item.artifactRef),
  ]).filter((ref) => !invalidatedRefs.includes(ref));

  return {
    schemaVersion: CONVERSATION_STATE_DIGEST_SCHEMA_VERSION,
    taskId: task.taskId,
    relation,
    summary: digestSummary(task, relation),
    stateRefs: dedupe([
      task.taskId,
      resume?.lastStableCheckpointRef,
      resume?.lastDurableTurnId,
      ...task.runRefs,
    ].filter(isString)),
    completedRefs,
    pendingWork: task.pendingWork.map((item) => item.id),
    blockedWork: task.blockedWork.map((item) => item.id),
    recoverableActions: task.recoverableActions.map((item) => item.id),
    backgroundJobs: task.backgroundJobs.map((item) => item.id),
    carryForwardRefs,
    invalidatedRefs,
    uncertainty: dedupe([...(task.uncertainty ?? []), ...(preflight?.requiredActions ?? [])]),
    handoffPolicy: 'digest-and-refs-only',
  };
}

export function runResumePreflight(input: unknown = {}): ResumePreflightReport {
  const data = recordValue(input) ?? {};
  const checks = [
    checkWorkspacePath(data),
    checkSessionStore(data),
    checkArtifactRefs(data),
    checkExecutionUnits(data),
    checkCapabilityVersions(data),
    checkFileHashes(data),
    checkPermissions(data),
  ];
  const status = worstStatus(checks.map((check) => check.status));
  const invalidatedRefs = preflightRefsByStatus(data, 'invalid');
  const staleRefs = preflightRefsByStatus(data, 'stale');
  const reusableRefs = dedupe([
    ...stringList(data.reusableRefs),
    ...arrayValue(data.artifactRefs).flatMap((item) => {
      const record = recordValue(item) ?? {};
      return preflightItemStatus(record) === 'ready' ? refsFrom(record) : [];
    }),
  ]);
  return {
    schemaVersion: CONVERSATION_RESUME_PREFLIGHT_SCHEMA_VERSION,
    status,
    checks,
    reusableRefs,
    invalidatedRefs,
    staleRefs,
    requiredActions: requiredActionsForChecks(checks),
    sideEffectPolicy: status === 'needs-human' || status === 'invalid'
      ? 'needs-human'
      : status === 'stale'
        ? 'read-only-refresh'
        : 'no-side-effects',
  };
}

export function planRecoveryFromTaskState(input: unknown = {}): RecoveryPlan {
  const data = recordValue(input) ?? {};
  const task = normalizeTaskState(firstValue(data, 'taskState', 'task') ?? data);
  const preflight = recordValue(data.preflight) ? runResumePreflight(data.preflight) : undefined;
  const reusableEvidenceRefs = task.completedEvidence
    .filter((item) => item.stable && !(preflight?.invalidatedRefs ?? []).includes(item.ref))
    .map((item) => item.ref);
  const rerunWorkIds = dedupe([
    ...task.pendingWork,
    ...task.blockedWork.filter((item) => item.status === 'failed' || item.status === 'blocked'),
  ].map((item) => item.id));
  const skippableWorkIds = task.blockedWork
    .filter((item) => item.status === 'blocked' && item.refs.some((ref) => (preflight?.invalidatedRefs ?? []).includes(ref)))
    .map((item) => item.id);
  const userOptions = task.recoverableActions;
  const unsafe = userOptions.some((item) => item.sideEffectPolicy === 'requires-approval') || preflight?.status === 'needs-human';
  const hasRecoveryPath = Boolean(reusableEvidenceRefs.length || rerunWorkIds.length || userOptions.length);
  return {
    schemaVersion: CONVERSATION_RECOVERY_PLAN_V2_SCHEMA_VERSION,
    status: unsafe ? 'needs-human' : hasRecoveryPath ? 'ready' : 'not-recoverable',
    reusableEvidenceRefs,
    rerunWorkIds,
    skippableWorkIds,
    userOptions,
    recommendedNext: unsafe
      ? 'Ask the user to approve or choose the recovery action before side effects.'
      : rerunWorkIds.length
        ? 'Resume from reusable evidence and rerun only unfinished or invalidated work.'
        : reusableEvidenceRefs.length
          ? 'Answer from reusable evidence and record remaining uncertainty.'
          : 'Return the failure and ask for missing state.',
    sideEffectPolicy: unsafe ? 'requires-approval' : rerunWorkIds.length ? 'idempotent' : 'none',
    reason: task.lastFailure?.message ?? (preflight?.requiredActions.join('; ') || 'task state evaluated for recovery'),
  };
}

export function buildHistoryMutationPolicy(input: unknown = {}): HistoryMutationPolicy {
  const data = recordValue(input) ?? {};
  const mode = historyMode(firstText(data.mode, data.historyMutationMode));
  const affectedTurnIds = stringList(firstValue(data, 'affectedTurnIds', 'affectedTurns'));
  const discardRefs = mode === 'revert'
    ? dedupe([...stringList(data.discardRefs), ...stringList(data.derivedRefs), ...stringList(data.discardedRunRefs)])
    : stringList(data.discardRefs);
  const preserveRefs = mode === 'revert' ? stringList(data.explicitPreserveRefs) : stringList(firstValue(data, 'preserveRefs', 'retainedRefs'));
  const conflictRefs = mode === 'continue' || mode === 'merge' || mode === 'branch'
    ? dedupe([...stringList(data.conflictRefs), ...stringList(data.changedRefs), ...stringList(data.derivedRefs)])
    : stringList(data.conflictRefs);

  return {
    schemaVersion: CONVERSATION_STATE_POLICY_SCHEMA_VERSION,
    mode,
    inheritState: mode !== 'revert',
    discardDerivedState: mode === 'revert',
    preserveRefs,
    discardRefs,
    conflictRefs,
    affectedTurnIds,
    sideEffectPolicy: mutationSideEffectPolicy(mode),
    recommendedNext: mode === 'revert'
      ? 'rerun-from-edit'
      : mode === 'continue'
        ? 'continue-with-conflicts'
        : mode === 'branch'
          ? 'continue-on-branch'
          : 'merge-review',
    auditNotes: mutationAuditNotes(mode, affectedTurnIds, discardRefs, conflictRefs),
  };
}

export function classifyInterruption(input: unknown = {}): InterruptionClassification {
  const data = recordValue(input) ?? {};
  const text = [
    firstText(data.kind, data.type, data.phase, data.stage, data.status),
    firstText(data.message, data.reason, data.error),
  ].join(' ').toLowerCase();
  const refs = refsFrom(data);
  if (hasAny(text, ['tool', 'action', 'capability-call'])) {
    return interruption('interrupted-tool', 'poll-tool-result', 'requires-approval', refs, 'tool or action state may already have side effects');
  }
  if (hasAny(text, ['repair', 'patch', 'rerun'])) {
    return interruption('interrupted-repair', 'resume-repair', 'idempotent', refs, 'repair attempt was interrupted and should resume from last attempt state');
  }
  if (hasAny(text, ['background', 'job', 'continuation'])) {
    return interruption('interrupted-background-job', 'reconcile-background-job', 'read-only', refs, 'background job state must be reconciled before reporting progress');
  }
  if (hasAny(text, ['stream', 'output', 'generation', 'assistant'])) {
    return interruption('interrupted-output', 'continue-stream', 'none', refs, 'assistant output was interrupted before finalization');
  }
  if (hasAny(text, ['none', 'complete', 'completed', 'success'])) {
    return interruption('none', 'none', 'none', refs, 'no interrupted work was detected');
  }
  return interruption('unknown', 'needs-human', 'requires-approval', refs, 'interruption type is unknown');
}

export function createHistoryBranchRecord(input: unknown = {}): HistoryBranchRecord {
  const data = recordValue(input) ?? {};
  const policy = buildHistoryMutationPolicy(data);
  const baseTurnId = firstText(data.baseTurnId, data.editTurnId, data.turnId) ?? '';
  return {
    schemaVersion: CONVERSATION_HISTORY_BRANCH_SCHEMA_VERSION,
    branchId: firstText(data.branchId) ?? stableId('branch', baseTurnId, policy.mode, JSON.stringify(recordValue(data.afterMessage) ?? {})),
    mode: policy.mode,
    baseTurnId,
    beforeMessage: recordValue(data.beforeMessage) ?? {},
    afterMessage: recordValue(data.afterMessage) ?? {},
    affectedTurnIds: policy.affectedTurnIds,
    discardedRunRefs: stringList(firstValue(data, 'discardedRunRefs', 'discardRefs')),
    preservedRefs: policy.preserveRefs,
    conflictRefs: policy.conflictRefs,
    recommendedPolicy: policy,
  };
}

export function evaluateConflictOrderGuard(input: unknown = {}): ConflictOrderGuard {
  const data = recordValue(input) ?? {};
  const sessionId = firstText(data.sessionId, recordValue(data.session)?.id, recordValue(data.session)?.sessionId) ?? 'unknown-session';
  const threadId = firstText(data.threadId, recordValue(data.thread)?.id, recordValue(data.session)?.threadId) ?? 'unknown-thread';
  const expectedRevision = firstText(data.expectedRevision, data.baseRevision, data.clientRevision);
  const actualRevision = firstText(data.actualRevision, data.currentRevision, recordValue(data.session)?.revision);
  const activeWriter = firstText(data.activeWriterClientId, data.lockOwnerClientId);
  const clientId = firstText(data.clientId);
  const conflictClients = dedupe([
    ...stringList(data.conflictingClientIds),
    ...(activeWriter && clientId && activeWriter !== clientId ? [activeWriter, clientId] : []),
  ]);
  const mutation = historyMode(firstText(data.mutationMode, data.mode));

  if (expectedRevision && actualRevision && expectedRevision !== actualRevision) {
    return orderGuard('reject-stale', sessionId, threadId, expectedRevision, actualRevision, conflictClients, 'client revision is stale');
  }
  if (conflictClients.length > 1 && mutation === 'branch') {
    return orderGuard('branch', sessionId, threadId, expectedRevision, actualRevision, conflictClients, 'concurrent writers require an isolated branch');
  }
  if (conflictClients.length > 1 && mutation === 'merge') {
    return orderGuard('needs-human', sessionId, threadId, expectedRevision, actualRevision, conflictClients, 'concurrent merge requires explicit conflict review');
  }
  if (conflictClients.length > 1) {
    return orderGuard('serialize', sessionId, threadId, expectedRevision, actualRevision, conflictClients, 'same conversation has concurrent writers');
  }
  return orderGuard('allow', sessionId, threadId, expectedRevision, actualRevision, conflictClients, 'revision and writer guard passed');
}

export const buildTaskState = buildConversationTaskState;
export const buildResumeState = buildConversationResumeState;
export const buildStateDigest = buildConversationStateDigest;
export const resumePreflight = runResumePreflight;
export const planRecovery = planRecoveryFromTaskState;
export const historyMutationPolicy = buildHistoryMutationPolicy;
export const classifyConversationInterruption = classifyInterruption;
export const buildHistoryBranchRecord = createHistoryBranchRecord;
export const conflictOrderGuard = evaluateConflictOrderGuard;

function normalizeTaskState(value: unknown): ConversationTaskState {
  const record = recordValue(value) ?? {};
  if (record.schemaVersion === CONVERSATION_STATE_POLICY_SCHEMA_VERSION && typeof record.taskId === 'string') {
    return record as unknown as ConversationTaskState;
  }
  return buildConversationTaskState(record);
}

function workItemsFrom(task: JsonMap, runs: unknown[]): ConversationWorkItem[] {
  const explicit = [
    ...arrayValue(task.currentSubgoals),
    ...arrayValue(task.pendingWork),
    ...arrayValue(task.blockedWork),
    ...arrayValue(task.workItems),
  ].map(workItemFrom).filter(isDefined);
  if (explicit.length) return dedupeWorkItems(explicit);
  return runs.map((run, index) => {
    const item = recordValue(run) ?? {};
    return {
      id: firstText(item.id, item.runId, item.stageId) ?? `work-${index + 1}`,
      title: firstText(item.title, item.summary, item.stage, item.name) ?? `Work ${index + 1}`,
      status: workStatus(firstText(item.status, item.state)),
      refs: refsFrom(item),
      reason: firstText(item.failureReason, item.error, item.reason),
    };
  });
}

function workItemFrom(value: unknown): ConversationWorkItem | undefined {
  const item = recordValue(value);
  if (!item) return undefined;
  return {
    id: firstText(item.id, item.workId, item.runId, item.stageId) ?? stableId('work', JSON.stringify(item)),
    title: firstText(item.title, item.summary, item.name, item.description) ?? 'work item',
    status: workStatus(firstText(item.status, item.state)),
    refs: refsFrom(item),
    reason: firstText(item.reason, item.failureReason, item.error),
  };
}

function evidenceFrom(task: JsonMap, artifacts: unknown[], runs: unknown[]): ConversationEvidenceRecord[] {
  const explicit = arrayValue(task.completedEvidence).map(evidenceRecordFrom).filter(isDefined);
  const fromArtifacts = artifacts.map(evidenceRecordFrom).filter(isDefined);
  const fromRuns = runs.flatMap((run) => {
    const item = recordValue(run) ?? {};
    const status = workStatus(firstText(item.status, item.state));
    if (status !== 'completed') return [];
    return refsFrom(item).map((ref) => ({
      id: stableId('evidence', ref),
      kind: firstText(item.kind, item.type, item.stage) ?? 'run-output',
      ref,
      status: 'completed',
      summary: firstText(item.summary, item.message),
      stable: true,
    }));
  });
  return dedupeEvidence([...explicit, ...fromArtifacts, ...fromRuns]);
}

function evidenceRecordFrom(value: unknown): ConversationEvidenceRecord | undefined {
  const item = recordValue(value);
  if (!item) return undefined;
  const ref = firstText(item.ref, item.path, item.dataRef, item.artifactRef, item.outputRef, item.clickableRef);
  if (!ref) return undefined;
  return {
    id: firstText(item.id) ?? stableId('evidence', ref),
    kind: firstText(item.kind, item.type, item.artifactType) ?? 'artifact',
    ref,
    status: firstText(item.status, item.state) ?? 'unknown',
    summary: firstText(item.summary, item.title, item.name),
    stable: item.stable === false || item.status === 'stale' ? false : true,
  };
}

function failureFrom(task: JsonMap, runs: unknown[]): ConversationFailureState | undefined {
  const explicit = firstRecord(task.lastFailure, task.failure);
  const failure = Object.keys(explicit).length ? explicit : [...runs].reverse().map(recordValue).find((item) => {
    const status = workStatus(firstText(item?.status, item?.state));
    return status === 'failed' || status === 'blocked' || Boolean(item?.failureReason || item?.error);
  });
  if (!failure) return undefined;
  return {
    code: firstText(failure.code, failure.kind, failure.type) ?? 'unknown-failure',
    message: firstText(failure.message, failure.detail, failure.failureReason, failure.error, failure.reason) ?? 'Unknown failure',
    ref: firstText(failure.ref, failure.traceRef, failure.stderrRef, failure.outputRef),
    retryable: failure.retryable === false ? false : true,
    atTurnId: firstText(failure.turnId, failure.atTurnId),
    atRunId: firstText(failure.runId, failure.id),
  };
}

function recoverableActionsFrom(
  task: JsonMap,
  lastFailure: ConversationFailureState | undefined,
  pendingWork: ConversationWorkItem[],
  blockedWork: ConversationWorkItem[],
): ConversationRecoverableAction[] {
  const explicit = arrayValue(task.recoverableActions).map(recoverableActionFrom).filter(isDefined);
  if (explicit.length) return dedupeActions(explicit);
  const actions: ConversationRecoverableAction[] = [];
  if (pendingWork.length) {
    actions.push({
      id: 'resume-pending-work',
      action: 'resume',
      label: 'Resume pending work from the current checkpoint.',
      refs: dedupe(pendingWork.flatMap((item) => item.refs)),
      sideEffectPolicy: 'idempotent',
    });
  }
  if (blockedWork.length || lastFailure) {
    actions.push({
      id: 'repair-last-failure',
      action: 'repair',
      label: 'Repair the last failed or blocked step.',
      refs: dedupe([lastFailure?.ref, ...blockedWork.flatMap((item) => item.refs)].filter(isString)),
      sideEffectPolicy: lastFailure?.retryable === false ? 'requires-approval' : 'idempotent',
    });
  }
  return actions;
}

function recoverableActionFrom(value: unknown): ConversationRecoverableAction | undefined {
  const item = recordValue(value);
  if (!item) return undefined;
  return {
    id: firstText(item.id, item.action) ?? stableId('action', JSON.stringify(item)),
    action: recoverableAction(firstText(item.action, item.type)),
    label: firstText(item.label, item.title, item.description) ?? 'Recover',
    refs: refsFrom(item),
    sideEffectPolicy: sideEffectPolicy(firstText(item.sideEffectPolicy, item.sideEffects)),
  };
}

function backgroundJobsFrom(value: unknown): ConversationBackgroundJob[] {
  return arrayValue(value).map((job, index) => {
    const item = recordValue(job) ?? {};
    return {
      id: firstText(item.id, item.jobId, item.runId) ?? `background-${index + 1}`,
      status: firstText(item.status, item.state) ?? 'unknown',
      title: firstText(item.title, item.summary, item.name) ?? 'background job',
      refs: refsFrom(item),
      lastEventTurnId: firstText(item.lastEventTurnId, item.turnId),
    };
  });
}

function lineageFrom(value: unknown): ConversationArtifactLineageRecord[] {
  return arrayValue(value).map((entry) => {
    const item = recordValue(entry) ?? {};
    return {
      artifactRef: firstText(item.artifactRef, item.ref, item.path, item.dataRef) ?? 'unknown-artifact',
      sourceTurnId: firstText(item.sourceTurnId, item.turnId),
      sourceRunId: firstText(item.sourceRunId, item.runId),
      parentRefs: stringList(firstValue(item, 'parentRefs', 'parents')),
      status: lineageStatus(firstText(item.status, item.state)),
    };
  });
}

function classifyTurnRelation(data: JsonMap, task: ConversationTaskState, preflight?: ResumePreflightReport): TurnRelation {
  const explicit = firstText(data.turnRelation, data.relation, recordValue(data.turn)?.relation);
  if (explicit && ['new-requirement', 'follow-up', 'failure-recovery', 'background-revisit', 'scope-change'].includes(explicit)) {
    return explicit as TurnRelation;
  }
  const text = [
    firstText(data.prompt, recordValue(data.turn)?.text, recordValue(data.turn)?.prompt),
    firstText(data.intent, data.mode),
  ].join(' ').toLowerCase();
  if (hasAny(text, ['失败', '修复', '恢复', 'retry', 'repair', 'recover', 'failed', 'timeout']) || task.lastFailure) return 'failure-recovery';
  if (hasAny(text, ['后台', '进度', 'background', 'job', 'status']) || task.backgroundJobs.length) return 'background-revisit';
  if (hasAny(text, ['改成', '改范围', '范围', 'instead', 'change scope', 'exclude', 'only'])) return 'scope-change';
  if (hasAny(text, ['继续', '接着', '上一轮', 'follow up', 'continue', 'previous'])) return 'follow-up';
  if (preflight && preflight.status !== 'ready') return 'failure-recovery';
  return 'new-requirement';
}

function digestSummary(task: ConversationTaskState, relation: TurnRelation): string {
  const parts = [
    `relation=${relation}`,
    `status=${task.status}`,
    task.userGoal ? `goal=${clip(task.userGoal, 160)}` : '',
    `completed=${task.completedEvidence.length}`,
    `pending=${task.pendingWork.length}`,
    `blocked=${task.blockedWork.length}`,
  ].filter(Boolean);
  return parts.join('; ');
}

function checkWorkspacePath(data: JsonMap): ResumePreflightCheck {
  const workspace = firstRecord(data.workspace, data.workspaceState);
  const status = preflightItemStatus(firstRecord(workspace, { status: data.workspaceStatus }));
  return {
    name: 'workspace-path',
    status,
    reason: status === 'ready' ? 'workspace path matches resume state' : 'workspace path is missing, moved, or changed',
    refs: stringList(firstValue(workspace, 'path', 'root', 'workspacePath')),
  };
}

function checkSessionStore(data: JsonMap): ResumePreflightCheck {
  const session = firstRecord(data.sessionStore, data.session);
  const status = preflightItemStatus(firstRecord(session, { status: data.sessionStoreStatus }));
  return {
    name: 'session-store',
    status,
    reason: status === 'ready' ? 'session store is durable' : 'session store is missing, stale, or inconsistent',
    refs: stringList(firstValue(session, 'ref', 'path', 'sessionId')),
  };
}

function checkArtifactRefs(data: JsonMap): ResumePreflightCheck {
  return aggregatePreflight('artifact-refs', arrayValue(data.artifactRefs), 'artifact refs are reusable', 'one or more artifact refs are stale or invalid');
}

function checkExecutionUnits(data: JsonMap): ResumePreflightCheck {
  return aggregatePreflight('execution-units', arrayValue(firstValue(data, 'executionUnits', 'pendingRuns')), 'execution units are reusable', 'execution unit state is stale, missing, or unknown');
}

function checkCapabilityVersions(data: JsonMap): ResumePreflightCheck {
  return aggregatePreflight('capability-versions', arrayValue(data.capabilityVersions), 'capability versions match', 'capability version drift detected');
}

function checkFileHashes(data: JsonMap): ResumePreflightCheck {
  return aggregatePreflight('file-hashes', arrayValue(data.fileHashes), 'file hashes match', 'file hash drift detected');
}

function checkPermissions(data: JsonMap): ResumePreflightCheck {
  return aggregatePreflight('permissions', arrayValue(data.permissions), 'permissions still allow resume', 'permission state changed or is insufficient');
}

function aggregatePreflight(name: string, values: unknown[], okReason: string, badReason: string): ResumePreflightCheck {
  if (!values.length) return { name, status: 'ready', reason: 'no check inputs supplied', refs: [] };
  const statuses = values.map((value) => preflightItemStatus(recordValue(value) ?? { status: value }));
  const status = worstStatus(statuses);
  return {
    name,
    status,
    reason: status === 'ready' ? okReason : badReason,
    refs: dedupe(values.flatMap((value) => refsFrom(recordValue(value) ?? { ref: value }))),
  };
}

function preflightItemStatus(item: JsonMap): ResumePreflightStatus {
  const status = firstText(item.status, item.state, item.freshness, item.result)?.toLowerCase();
  if (item.valid === false || item.exists === false || status === 'missing' || status === 'invalid' || status === 'deleted') return 'invalid';
  if (item.requiresHuman === true || status === 'needs-human' || status === 'permission-denied' || status === 'blocked') return 'needs-human';
  if (item.stale === true || item.changed === true || status === 'stale' || status === 'changed' || status === 'drift') return 'stale';
  return 'ready';
}

function worstStatus(statuses: ResumePreflightStatus[]): ResumePreflightStatus {
  const rank: Record<ResumePreflightStatus, number> = { ready: 0, stale: 1, invalid: 2, 'needs-human': 3 };
  return statuses.reduce((worst, status) => (rank[status] > rank[worst] ? status : worst), 'ready' as ResumePreflightStatus);
}

function requiredActionsForChecks(checks: ResumePreflightCheck[]): string[] {
  return checks.filter((check) => check.status !== 'ready').map((check) => {
    if (check.status === 'stale') return `Refresh ${check.name} before reusing stale state.`;
    if (check.status === 'invalid') return `Rebuild or discard invalid ${check.name}.`;
    return `Ask the user to resolve ${check.name}.`;
  });
}

function preflightRefsByStatus(data: JsonMap, target: ResumePreflightStatus): string[] {
  const values = [
    data.workspace,
    data.workspaceState,
    data.sessionStore,
    data.session,
    ...arrayValue(data.artifactRefs),
    ...arrayValue(firstValue(data, 'executionUnits', 'pendingRuns')),
    ...arrayValue(data.capabilityVersions),
    ...arrayValue(data.fileHashes),
    ...arrayValue(data.permissions),
  ];
  return dedupe(values.flatMap((value) => {
    const record = recordValue(value) ?? { ref: value, status: value };
    return preflightItemStatus(record) === target ? refsFrom(record) : [];
  }));
}

function taskStatus(
  task: JsonMap,
  pendingWork: ConversationWorkItem[],
  blockedWork: ConversationWorkItem[],
  lastFailure?: ConversationFailureState,
): ConversationTaskStatus {
  const status = firstText(task.status, task.state)?.toLowerCase();
  if (status && ['unknown', 'active', 'blocked', 'failed', 'completed', 'cancelled'].includes(status)) return status as ConversationTaskStatus;
  if (lastFailure) return 'failed';
  if (blockedWork.length) return 'blocked';
  if (pendingWork.length) return 'active';
  return 'unknown';
}

function workStatus(value: string | undefined): WorkStatus {
  const status = (value ?? '').toLowerCase();
  if (['done', 'ok', 'success', 'succeeded', 'completed', 'passed'].includes(status)) return 'completed';
  if (['fail', 'failed', 'failure', 'error', 'timed-out', 'timeout'].includes(status)) return 'failed';
  if (['cancel', 'cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (['skip', 'skipped'].includes(status)) return 'skipped';
  if (['blocked', 'waiting', 'needs-human'].includes(status)) return 'blocked';
  if (['running', 'active', 'in-progress'].includes(status)) return 'active';
  return 'pending';
}

function recoverableAction(value: string | undefined): ConversationRecoverableAction['action'] {
  const action = (value ?? '').toLowerCase();
  if (['resume', 'repair', 'rerun', 'refresh', 'skip', 'ask-user', 'background'].includes(action)) return action as ConversationRecoverableAction['action'];
  return 'resume';
}

function sideEffectPolicy(value: string | undefined): ConversationRecoverableAction['sideEffectPolicy'] {
  const policy = (value ?? '').toLowerCase();
  if (policy.includes('approval') || policy.includes('unsafe')) return 'requires-approval';
  if (policy.includes('read')) return 'read-only';
  if (policy.includes('none')) return 'none';
  return 'idempotent';
}

function lineageStatus(value: string | undefined): ConversationArtifactLineageRecord['status'] {
  const status = (value ?? '').toLowerCase();
  if (['active', 'stale', 'discarded', 'conflict'].includes(status)) return status as ConversationArtifactLineageRecord['status'];
  return 'unknown';
}

function freshnessFrom(value: string | undefined, lineage: ConversationArtifactLineageRecord[]): ConversationResumeState['clientStateFreshness'] {
  if (value && ['fresh', 'stale', 'missing', 'unknown'].includes(value)) return value as ConversationResumeState['clientStateFreshness'];
  if (lineage.some((item) => item.status === 'stale' || item.status === 'conflict')) return 'stale';
  return 'unknown';
}

function authorityFrom(value: string | undefined, session: JsonMap): ConversationResumeState['stateAuthority'] {
  if (value && ['persistent-store', 'checkpoint', 'client', 'digest', 'unknown'].includes(value)) return value as ConversationResumeState['stateAuthority'];
  if (session.lastStableCheckpointRef || session.checkpointRef) return 'checkpoint';
  if (session.lastDurableTurnId || session.lastTurnId) return 'persistent-store';
  return 'unknown';
}

function historyMode(value: string | undefined): HistoryMutationMode {
  const mode = (value ?? '').toLowerCase();
  if (['revert', 'continue', 'branch', 'merge'].includes(mode)) return mode as HistoryMutationMode;
  return 'continue';
}

function mutationSideEffectPolicy(mode: HistoryMutationMode): HistoryMutationPolicy['sideEffectPolicy'] {
  if (mode === 'revert') return 'block-unsafe-replay';
  if (mode === 'branch') return 'isolate-branch';
  if (mode === 'merge') return 'merge-with-conflict-check';
  return 'preserve-as-context';
}

function mutationAuditNotes(mode: HistoryMutationMode, affectedTurnIds: string[], discardRefs: string[], conflictRefs: string[]): string[] {
  const notes = [`history mutation mode=${mode}`];
  if (affectedTurnIds.length) notes.push(`affected turns: ${affectedTurnIds.join(', ')}`);
  if (discardRefs.length) notes.push('derived refs must be discarded before rerun');
  if (conflictRefs.length) notes.push('conflict refs must be shown as uncertain context');
  return notes;
}

function interruption(
  kind: InterruptionKind,
  recoveryStrategy: InterruptionClassification['recoveryStrategy'],
  sideEffectPolicy: InterruptionClassification['sideEffectPolicy'],
  refs: string[],
  reason: string,
): InterruptionClassification {
  return {
    schemaVersion: CONVERSATION_STATE_POLICY_SCHEMA_VERSION,
    kind,
    recoveryStrategy,
    sideEffectPolicy,
    refs,
    reason,
  };
}

function orderGuard(
  decision: GuardDecision,
  sessionId: string,
  threadId: string,
  expectedRevision: string | undefined,
  actualRevision: string | undefined,
  conflictingClientIds: string[],
  reason: string,
): ConflictOrderGuard {
  return {
    schemaVersion: CONVERSATION_ORDER_GUARD_SCHEMA_VERSION,
    decision,
    sessionId,
    threadId,
    expectedRevision,
    actualRevision,
    conflictingClientIds,
    reason,
  };
}

function uncertaintyFrom(task: JsonMap, lastFailure: ConversationFailureState | undefined, artifactRefs: string[]): string[] {
  const values = stringList(firstValue(task, 'uncertainty', 'unknowns'));
  if (lastFailure) values.push(`last failure: ${lastFailure.code}`);
  if (!artifactRefs.length) values.push('no stable artifact refs recorded');
  return dedupe(values);
}

function refsFrom(value: unknown): string[] {
  const item = recordValue(value);
  if (!item) return typeof value === 'string' && value.trim() ? [value.trim()] : [];
  const refs: string[] = [];
  for (const key of ['refs', 'references', 'artifactRefs', 'resultRefs', 'traceRefs', 'parentRefs']) {
    refs.push(...stringList(item[key]));
  }
  for (const key of ['ref', 'path', 'dataRef', 'artifactRef', 'outputRef', 'stdoutRef', 'stderrRef', 'traceRef', 'clickableRef', 'id', 'runId']) {
    const text = stringValue(item[key]);
    if (text) refs.push(text);
  }
  return dedupe(refs);
}

function dedupeWorkItems(values: ConversationWorkItem[]): ConversationWorkItem[] {
  const seen = new Set<string>();
  const out: ConversationWorkItem[] = [];
  for (const item of values) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function dedupeEvidence(values: ConversationEvidenceRecord[]): ConversationEvidenceRecord[] {
  const seen = new Set<string>();
  const out: ConversationEvidenceRecord[] = [];
  for (const item of values) {
    const key = item.ref || item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function dedupeActions(values: ConversationRecoverableAction[]): ConversationRecoverableAction[] {
  const seen = new Set<string>();
  const out: ConversationRecoverableAction[] = [];
  for (const item of values) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function firstValue(data: JsonMap, ...keys: string[]): unknown {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) return data[key];
  }
  return undefined;
}

function firstRecord(...values: unknown[]): JsonMap {
  for (const value of values) {
    const record = recordValue(value);
    if (record && Object.keys(record).length) return record;
  }
  return {};
}

function recordValue(value: unknown): JsonMap | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonMap : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return dedupe(value.flatMap((item) => stringList(item)));
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text ? [text] : [];
  }
  const item = recordValue(value);
  if (!item) return [];
  const ref = firstText(item.ref, item.path, item.id, item.uri, item.name);
  return ref ? [ref] : [];
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function clip(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length <= limit ? compact : `${compact.slice(0, Math.max(0, limit - 14)).trimEnd()} [truncated]`;
}

function stableId(...parts: string[]): string {
  let hash = 0;
  const text = parts.join(':');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return `${parts[0] || 'id'}-${Math.abs(hash).toString(36)}`;
}

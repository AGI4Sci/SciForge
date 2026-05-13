import type {
  AgentStreamEvent,
  BackgroundCompletionRuntimeEvent,
  GuidanceQueueRecord,
  GuidanceQueueStatus,
  ObjectReference,
  NormalizedAgentResponse,
  RuntimeArtifact,
  RuntimeExecutionUnit,
  ScenarioInstanceId,
  ScenarioPackageRef,
  SciForgeMessage,
  SciForgeReference,
  SciForgeRun,
  SciForgeSession,
  UserGoalSnapshot,
} from '../../domain';
import { makeId, nowIso } from '../../domain';
import { mergeObjectReferences } from '../../../../../packages/support/object-references';
import { collectRuntimeRefsFromValue } from '@sciforge-ui/runtime-contract/references';
import { normalizeScenarioPromptTitle } from '@sciforge/scenario-core/scenario-routing-policy';
import {
  ACCEPTANCE_REPAIR_RERUN_TOOL_ID,
  BACKGROUND_COMPLETION_CONTRACT_ID,
  BACKGROUND_COMPLETION_TOOL_ID,
  CONVERSATION_PROJECTION_CONTINUATION_TOOL_ID,
  normalizeRunTermination,
  type RunTerminationRecord,
} from '@sciforge-ui/runtime-contract/events';
import {
  conversationProjectionArtifactRefs,
  conversationProjectionAuditRefs,
  conversationProjectionForRun,
  conversationProjectionPrimaryDiagnostic,
  conversationProjectionStatus,
  conversationProjectionVisibleText,
  type UiConversationProjection,
} from '../conversation-projection-view-model';
import { compactRunRawForRequestPayload } from './runRawCompaction';

const REQUEST_PAYLOAD_MESSAGE_LIMIT = 12;
const REQUEST_PAYLOAD_ARTIFACT_LIMIT = 16;
const REQUEST_PAYLOAD_EXECUTION_UNIT_LIMIT = 16;
const REQUEST_PAYLOAD_RUN_LIMIT = 8;
const REQUEST_PAYLOAD_MESSAGE_TEXT_LIMIT = 6_000;
const REQUEST_PAYLOAD_RUN_TEXT_LIMIT = 2_000;
const REQUEST_PAYLOAD_RAW_TEXT_LIMIT = 2_500;
const REQUEST_PAYLOAD_INLINE_DATA_LIMIT = 3_000;
const REQUEST_PAYLOAD_PROJECTION_LIMIT = 4;
const REQUEST_PAYLOAD_PROJECTION_TEXT_LIMIT = 360;
const REQUEST_PAYLOAD_SELECTED_REF_LIMIT = 8;
const REQUEST_PAYLOAD_AUDIT_REF_LIMIT = 24;
const HISTORY_EDIT_BRANCH_SCHEMA_VERSION = 'sciforge.history-edit-branch.v1';

export type HistoricalMessageEditMode = 'revert' | 'continue';

export interface HistoricalMessageEditRef {
  ref: string;
  source: 'message' | 'run' | 'artifact' | 'execution-unit' | 'claim' | 'notebook' | 'ui-manifest' | 'object-reference';
  sourceId?: string;
  title?: string;
  reason: 'invalidated-after-edit' | 'affected-by-edit';
}

export interface HistoricalMessageEditConflict {
  id: string;
  kind: 'downstream-result-after-edited-message';
  sourceMessageRef: string;
  affectedRefs: string[];
  affectedConclusionRefs: string[];
  detail: string;
}

export interface HistoricalMessageEditConclusion {
  ref: string;
  id: string;
  text: string;
  supportingRefs: string[];
  opposingRefs: string[];
  dependencyRefs: string[];
}

export interface HistoricalMessageEditBranch {
  schemaVersion: typeof HISTORY_EDIT_BRANCH_SCHEMA_VERSION;
  id: string;
  mode: HistoricalMessageEditMode;
  messageId: string;
  sourceMessageRef: string;
  originalContent: string;
  editedContent: string;
  editedAt: string;
  boundaryAt: string;
  invalidatedRefs: HistoricalMessageEditRef[];
  affectedRefs: HistoricalMessageEditRef[];
  affectedConclusions: HistoricalMessageEditConclusion[];
  conflicts: HistoricalMessageEditConflict[];
  requiresUserConfirmation: boolean;
  nextStep: string;
}

export type HistoricalMessageEditSession = SciForgeSession & {
  historyEditBranches?: HistoricalMessageEditBranch[];
};

export interface HistoricalMessageEditResult {
  session: HistoricalMessageEditSession;
  branch?: HistoricalMessageEditBranch;
}

export function titleFromPrompt(prompt: string) {
  return normalizeScenarioPromptTitle(prompt);
}

export function createOptimisticUserTurnSession({
  baseSession,
  prompt,
  references,
  goalSnapshot,
  targetInstanceLabel,
}: {
  baseSession: SciForgeSession;
  prompt: string;
  references: SciForgeReference[];
  goalSnapshot?: UserGoalSnapshot;
  targetInstanceLabel?: string;
}) {
  const now = nowIso();
  const userMessage: SciForgeMessage = {
    id: makeId('msg'),
    role: 'user',
    content: targetInstanceLabel ? `目标实例：${targetInstanceLabel}\n${prompt}` : prompt,
    createdAt: now,
    status: 'completed',
    references,
    goalSnapshot,
  };
  const nextSession: SciForgeSession = {
    ...baseSession,
    title: baseSession.runs.length || baseSession.messages.some((message) => message.id.startsWith('msg'))
      ? baseSession.title
      : titleFromPrompt(prompt),
    messages: [...baseSession.messages, userMessage],
    updatedAt: nowIso(),
  };
  return { session: nextSession, userMessage };
}

export function appendUploadMessageToSession({
  session,
  uploaded,
  references,
  objectReferences,
}: {
  session: SciForgeSession;
  uploaded: RuntimeArtifact[];
  references: SciForgeReference[];
  objectReferences: NonNullable<SciForgeMessage['objectReferences']>;
}) {
  const now = nowIso();
  const uploadMessage: SciForgeMessage = {
    id: makeId('msg'),
    role: 'system',
    content: `已上传 ${uploaded.length} 个文件到证据矩阵：${uploaded.map((artifact) => artifact.metadata?.title ?? artifact.id).join('、')}`,
    createdAt: now,
    status: 'completed',
    references,
    objectReferences,
  };
  return {
    ...session,
    messages: [...session.messages, uploadMessage],
    artifacts: mergeRuntimeArtifacts(uploaded, session.artifacts),
    updatedAt: now,
  };
}

export function appendRunningGuidance(session: SciForgeSession, prompt: string) {
  return appendRunningGuidanceRecord(session, createGuidanceQueueRecord(prompt)).session;
}

export function createGuidanceQueueRecord(
  prompt: string,
  overrides: Partial<Omit<GuidanceQueueRecord, 'id' | 'prompt' | 'receivedAt' | 'status'>> & {
    id?: string;
    receivedAt?: string;
    status?: GuidanceQueueStatus;
  } = {},
): GuidanceQueueRecord {
  const now = nowIso();
  return {
    id: overrides.id ?? makeId('guidance'),
    prompt,
    status: overrides.status ?? 'queued',
    receivedAt: overrides.receivedAt ?? now,
    updatedAt: overrides.updatedAt,
    activeRunId: overrides.activeRunId,
    handlingRunId: overrides.handlingRunId,
    reason: overrides.reason,
  };
}

export function appendRunningGuidanceRecord(session: SciForgeSession, guidance: GuidanceQueueRecord) {
  const guidanceMessage: SciForgeMessage = {
    id: makeId('msg'),
    role: 'user',
    content: `运行中引导：${guidance.prompt}`,
    createdAt: guidance.receivedAt,
    status: 'running',
    guidanceQueue: guidance,
  };
  return {
    session: {
      ...session,
      messages: [...session.messages, guidanceMessage],
      updatedAt: guidance.receivedAt,
    },
    guidance,
  };
}

export function updateGuidanceQueueRecords(
  session: SciForgeSession,
  guidanceIds: string[],
  patch: Partial<Omit<GuidanceQueueRecord, 'id' | 'prompt' | 'receivedAt'>>,
) {
  if (!guidanceIds.length) return session;
  const idSet = new Set(guidanceIds);
  const updatedAt = patch.updatedAt ?? nowIso();
  const updateRecord = (record: GuidanceQueueRecord): GuidanceQueueRecord => idSet.has(record.id)
    ? { ...record, ...patch, updatedAt }
    : record;
  const updateRawGuidanceQueue = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const record = raw as Record<string, unknown>;
    const queue = Array.isArray(record.guidanceQueue)
      ? record.guidanceQueue.map((item) => item && typeof item === 'object' && !Array.isArray(item)
        ? updateRecord(item as GuidanceQueueRecord)
        : item)
      : undefined;
    return queue ? { ...record, guidanceQueue: queue } : raw;
  };
  return {
    ...session,
    messages: session.messages.map((message) => message.guidanceQueue && idSet.has(message.guidanceQueue.id)
      ? {
          ...message,
          status: patch.status === 'rejected' || patch.status === 'merged' || patch.status === 'deferred' ? 'completed' : message.status,
          guidanceQueue: updateRecord(message.guidanceQueue),
        }
      : message),
    runs: session.runs.map((run) => ({
      ...run,
      guidanceQueue: run.guidanceQueue?.map(updateRecord),
      raw: updateRawGuidanceQueue(run.raw),
    })),
    updatedAt,
  };
}

export function resolveGuidanceQueueAfterRun(
  session: SciForgeSession,
  guidanceQueue: GuidanceQueueRecord[],
  options: { userCancelled?: boolean; runFailed?: boolean; runEndedReason?: string } = {},
): { session: SciForgeSession; remainingQueue: GuidanceQueueRecord[]; nextGuidance?: GuidanceQueueRecord } {
  if (!guidanceQueue.length) return { session, remainingQueue: [] };
  if (options.userCancelled) {
    return {
      session: updateGuidanceQueueRecords(session, guidanceQueue.map((item) => item.id), {
        status: 'rejected',
        reason: options.runEndedReason ?? '用户显式中断当前 run；排队引导已跨过 cancel boundary，不能自动恢复不可逆 side effect。',
      }),
      remainingQueue: [],
    };
  }
  if (options.runFailed) {
    const reason = options.runEndedReason ?? '当前 run 失败；排队引导保留为 deferred，等待用户确认、修复或重新运行后再合并。';
    const updatedQueue = guidanceQueue.map((item) => ({
      ...item,
      status: 'deferred' as const,
      reason,
      updatedAt: nowIso(),
    }));
    return {
      session: updateGuidanceQueueRecords(session, guidanceQueue.map((item) => item.id), {
        status: 'deferred',
        reason,
      }),
      remainingQueue: updatedQueue,
    };
  }
  const nextGuidance = guidanceQueue.find((item) => item.status === 'queued');
  if (!nextGuidance) {
    return {
      session,
      remainingQueue: guidanceQueue,
    };
  }
  const remainingQueue = guidanceQueue.filter((item) => item.id !== nextGuidance.id);
  return {
    session: updateGuidanceQueueRecords(session, [nextGuidance.id], {
      status: 'merged',
      reason: options.runEndedReason ?? '当前 run 已结束，已按 run orchestration contract 合并为下一轮用户引导。',
      handlingRunId: 'pending-next-run',
    }),
    remainingQueue,
    nextGuidance,
  };
}

export function attachGuidanceQueueToResponse(
  response: NormalizedAgentResponse,
  guidanceQueue: GuidanceQueueRecord[],
  status: GuidanceQueueStatus,
  reason: string,
): NormalizedAgentResponse {
  if (!guidanceQueue.length) return response;
  const updatedAt = nowIso();
  const records = guidanceQueue.map((record) => ({
    ...record,
    status,
    reason,
    updatedAt,
    activeRunId: record.activeRunId ?? response.run.id,
  }));
  const raw = typeof response.run.raw === 'object' && response.run.raw !== null ? response.run.raw : {};
  return {
    ...response,
    run: {
      ...response.run,
      guidanceQueue: records,
      raw: {
        ...raw,
        guidanceQueue: records,
      },
    },
  };
}

export function attachGuidanceQueueToSessionRun(
  session: SciForgeSession,
  runId: string,
  guidanceQueue: GuidanceQueueRecord[],
  status: GuidanceQueueStatus,
  reason: string,
): SciForgeSession {
  if (!guidanceQueue.length) return session;
  const updatedAt = nowIso();
  const records = guidanceQueue.map((record) => ({
    ...record,
    status,
    reason,
    updatedAt,
    activeRunId: record.activeRunId ?? runId,
  }));
  return {
    ...session,
    runs: session.runs.map((run) => {
      if (run.id !== runId) return run;
      const raw = typeof run.raw === 'object' && run.raw !== null ? run.raw : {};
      return {
        ...run,
        guidanceQueue: records,
        raw: {
          ...raw,
          guidanceQueue: records,
        },
      };
    }),
    updatedAt,
  };
}

export function mergeAgentResponseIntoSession({
  baseSession,
  response,
  scenarioPackageRef,
  skillPlanRef,
  uiPlanRef,
}: {
  baseSession: SciForgeSession;
  response: NormalizedAgentResponse;
  scenarioPackageRef: ScenarioPackageRef;
  skillPlanRef: string;
  uiPlanRef: string;
}): SciForgeSession {
  const versionedRun = {
    ...response.run,
    scenarioPackageRef: response.run.scenarioPackageRef ?? scenarioPackageRef,
    skillPlanRef: response.run.skillPlanRef ?? skillPlanRef,
    uiPlanRef: response.run.uiPlanRef ?? uiPlanRef,
  };
  return {
    ...baseSession,
    messages: [...baseSession.messages, response.message],
    runs: [...baseSession.runs, versionedRun],
    uiManifest: response.uiManifest.length ? response.uiManifest : baseSession.uiManifest,
    claims: [...response.claims, ...baseSession.claims].slice(0, 24),
    executionUnits: mergeExecutionUnits(response.executionUnits, baseSession.executionUnits),
    artifacts: mergeRuntimeArtifacts(response.artifacts, baseSession.artifacts),
    notebook: [...response.notebook, ...baseSession.notebook].slice(0, 24),
    updatedAt: nowIso(),
  };
}

export function applyBackgroundCompletionEventToSession(
  session: SciForgeSession,
  event: BackgroundCompletionRuntimeEvent,
): SciForgeSession {
  const updatedAt = event.updatedAt ?? event.completedAt ?? event.createdAt ?? nowIso();
  const run = backgroundRunForEvent(session, event, updatedAt);
  const previousRun = session.runs.find((item) => item.id === event.runId);
  const runObjectReference = objectReferenceForBackgroundRun(run, event);
  const eventObjectReferences = mergeObjectReferences(event.objectReferences ?? [], [runObjectReference]);
  const existingMessageId = backgroundMessageId(previousRun);
  const messageId = existingMessageId ?? `msg-${event.runId}`;
  const message = backgroundMessageForEvent(session, event, messageId, updatedAt, eventObjectReferences);
  const messages = mergeBackgroundMessage(session.messages, message);
  const runs = mergeBackgroundRun(session.runs, {
    ...run,
    objectReferences: mergeObjectReferences(eventObjectReferences, previousRun?.objectReferences ?? []),
    raw: mergeBackgroundRaw(previousRun?.raw, event, message.id, updatedAt),
  });
  const executionUnits = mergeExecutionUnits(normalizeBackgroundExecutionUnits(event, updatedAt), session.executionUnits);
  const artifacts = mergeRuntimeArtifacts(tagBackgroundArtifacts(event.artifacts ?? [], event), session.artifacts);
  return {
    ...session,
    messages,
    runs,
    executionUnits,
    artifacts,
    updatedAt,
  };
}

function backgroundRunForEvent(
  session: SciForgeSession,
  event: BackgroundCompletionRuntimeEvent,
  updatedAt: string,
): SciForgeRun {
  const previous = session.runs.find((item) => item.id === event.runId);
  const response = event.finalResponse ?? event.message ?? previous?.response ?? '';
  const completedAt = event.status === 'running'
    ? previous?.completedAt
    : event.completedAt ?? updatedAt;
  return {
    ...(previous ?? {
      id: event.runId,
      scenarioId: session.scenarioId,
      status: 'running',
      prompt: event.prompt ?? '',
      response,
      createdAt: event.createdAt ?? updatedAt,
    }),
    status: event.status,
    prompt: event.prompt ?? previous?.prompt ?? '',
    response,
    completedAt,
  };
}

function backgroundMessageForEvent(
  session: SciForgeSession,
  event: BackgroundCompletionRuntimeEvent,
  messageId: string,
  updatedAt: string,
  objectReferences: ObjectReference[],
): SciForgeMessage {
  const previous = session.messages.find((item) => item.id === messageId);
  const content = event.finalResponse ?? event.message ?? previous?.content ?? '';
  return {
    ...(previous ?? {
      id: messageId,
      role: 'scenario',
      createdAt: event.createdAt ?? updatedAt,
    }),
    content,
    status: event.status,
    updatedAt,
    objectReferences: mergeObjectReferences(objectReferences, previous?.objectReferences ?? []),
  };
}

function mergeBackgroundMessage(messages: SciForgeMessage[], message: SciForgeMessage) {
  const found = messages.some((item) => item.id === message.id);
  if (!found) return [...messages, message];
  return messages.map((item) => item.id === message.id ? { ...item, ...message } : item);
}

function mergeBackgroundRun(runs: SciForgeRun[], run: SciForgeRun) {
  const found = runs.some((item) => item.id === run.id);
  if (!found) return [...runs, run];
  return runs.map((item) => item.id === run.id ? { ...item, ...run } : item);
}

function normalizeBackgroundExecutionUnits(event: BackgroundCompletionRuntimeEvent, updatedAt: string): RuntimeExecutionUnit[] {
  const declared = event.executionUnits ?? [];
  const failureReason = event.failureReason ?? event.cancellationReason;
  if (!backgroundEventHasExecutionEvidence(event, failureReason)) return declared;
  const status = event.status === 'completed'
    ? 'done'
    : event.status === 'running'
      ? 'running'
      : 'failed-with-reason';
  const refs = backgroundEventRefs(event);
  const evidenceUnit: RuntimeExecutionUnit = {
    id: `EU-${event.runId}-${event.stageId ?? 'background'}`,
    tool: BACKGROUND_COMPLETION_TOOL_ID,
    params: `runId=${event.runId};stageId=${event.stageId ?? 'run'}`,
    status,
    hash: `${event.runId}:${event.stageId ?? 'run'}`.slice(0, 48),
    time: updatedAt,
    codeRef: refs.find((ref) => ref.kind === 'file')?.ref,
    outputRef: event.ref ?? refs.find((ref) => ref.kind === 'artifact' || ref.kind === 'work-evidence' || ref.kind === 'verification')?.ref,
    failureReason,
    recoverActions: event.recoverActions,
    nextStep: event.nextStep,
    artifacts: event.artifacts?.map((artifact) => artifact.id),
    outputArtifacts: event.artifacts?.map((artifact) => artifact.id),
    verificationRef: firstVerificationRef(event),
    verificationVerdict: firstVerificationVerdict(event),
  };
  return mergeExecutionUnits([evidenceUnit], declared);
}

function backgroundEventHasExecutionEvidence(event: BackgroundCompletionRuntimeEvent, failureReason?: string) {
  return Boolean(
    failureReason
    || event.workEvidence?.length
    || event.artifacts?.length
    || event.verificationResults?.length
    || event.refs?.length
    || event.objectReferences?.length
    || event.executionUnits?.length,
  );
}

function backgroundEventRefs(event: BackgroundCompletionRuntimeEvent) {
  return [
    ...(event.refs ?? []),
    ...((event.artifacts ?? []).map((artifact) => ({
      ref: `artifact:${artifact.id}`,
      kind: 'artifact' as const,
      runId: event.runId,
      stageId: event.stageId,
      title: artifact.metadata?.title ? String(artifact.metadata.title) : artifact.id,
    }))),
    ...((event.verificationResults ?? []).map((result, index) => ({
      ref: verificationRef(result, event, index),
      kind: 'verification' as const,
      runId: event.runId,
      stageId: event.stageId,
    }))),
    ...((event.workEvidence ?? []).map((evidence, index) => ({
      ref: workEvidenceRef(evidence, event, index),
      kind: 'work-evidence' as const,
      runId: event.runId,
      stageId: event.stageId,
    }))),
  ];
}

function tagBackgroundArtifacts(artifacts: RuntimeArtifact[], event: BackgroundCompletionRuntimeEvent) {
  return artifacts.map((artifact) => ({
    ...artifact,
    metadata: {
      ...(artifact.metadata ?? {}),
      runId: String(artifact.metadata?.runId ?? event.runId),
      stageId: String(artifact.metadata?.stageId ?? event.stageId ?? 'run'),
      backgroundCompletionRef: event.ref ?? `run:${event.runId}`,
    },
  }));
}

function mergeBackgroundRaw(raw: unknown, event: BackgroundCompletionRuntimeEvent, messageId: string, updatedAt: string) {
  const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const previousBackground = base.backgroundCompletion && typeof base.backgroundCompletion === 'object' && !Array.isArray(base.backgroundCompletion)
    ? base.backgroundCompletion as Record<string, unknown>
    : {};
  const stages = mergeBackgroundStages(previousBackground.stages, event, updatedAt);
  const termination = terminationForBackgroundEvent(event);
  return {
    ...base,
    backgroundCompletion: {
      ...previousBackground,
      contract: BACKGROUND_COMPLETION_CONTRACT_ID,
      runId: event.runId,
      messageId,
      status: event.status,
      updatedAt,
      completedAt: event.status === 'running' ? previousBackground.completedAt : event.completedAt ?? updatedAt,
      failureReason: event.failureReason ?? event.cancellationReason ?? previousBackground.failureReason,
      termination: termination ?? previousBackground.termination,
      recoverActions: event.recoverActions ?? previousBackground.recoverActions,
      nextStep: event.nextStep ?? previousBackground.nextStep,
      diagnostics: {
        ...(recordField(previousBackground.diagnostics)),
        ...(backgroundCompletionDurationMs(event, updatedAt) === undefined ? {} : {
          backgroundCompletionDurationMs: backgroundCompletionDurationMs(event, updatedAt),
        }),
      },
      refs: mergeBackgroundRefs(previousBackground.refs, event.refs),
      verificationResults: mergeRecordArray(previousBackground.verificationResults, event.verificationResults),
      workEvidence: mergeRecordArray(previousBackground.workEvidence, event.workEvidence),
      stages,
      finalResponse: event.finalResponse ?? previousBackground.finalResponse,
      lastEvent: event,
    },
  };
}

function terminationForBackgroundEvent(event: BackgroundCompletionRuntimeEvent): RunTerminationRecord | undefined {
  if (event.status !== 'cancelled' && !event.cancellationReason) return undefined;
  return normalizeRunTermination({
    cancellationReason: event.cancellationReason,
    detail: event.failureReason ?? event.cancellationReason ?? event.message,
  });
}

function backgroundCompletionDurationMs(event: BackgroundCompletionRuntimeEvent, updatedAt: string) {
  const startedAt = event.createdAt;
  const finishedAt = event.completedAt ?? (event.status === 'running' ? undefined : updatedAt);
  if (!startedAt || !finishedAt) return undefined;
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function recordField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mergeBackgroundStages(previous: unknown, event: BackgroundCompletionRuntimeEvent, updatedAt: string) {
  const stages = Array.isArray(previous) ? previous.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
  const stageId = event.stageId ?? 'run';
  const nextStage = {
    ...(stages.find((stage) => stage.stageId === stageId) ?? {}),
    stageId,
    status: event.status,
    ref: event.ref ?? `run:${event.runId}#${stageId}`,
    updatedAt,
    artifactRefs: event.artifacts?.map((artifact) => `artifact:${artifact.id}`),
    executionUnitRefs: event.executionUnits?.map((unit) => `execution-unit:${unit.id}`),
    verificationRefs: event.verificationResults?.map((result, index) => verificationRef(result, event, index)),
    workEvidenceRefs: event.workEvidence?.map((evidence, index) => workEvidenceRef(evidence, event, index)),
    failureReason: event.failureReason ?? event.cancellationReason,
    recoverActions: event.recoverActions,
    nextStep: event.nextStep,
  };
  return [...stages.filter((stage) => stage.stageId !== stageId), nextStage];
}

function mergeBackgroundRefs(previous: unknown, refs: BackgroundCompletionRuntimeEvent['refs']) {
  const existing = Array.isArray(previous) ? previous.filter((item) => item && typeof item === 'object') : [];
  const byRef = new Map<string, unknown>();
  for (const item of [...existing, ...(refs ?? [])]) {
    const key = typeof (item as { ref?: unknown }).ref === 'string' ? (item as { ref: string }).ref : JSON.stringify(item);
    byRef.set(key, { ...(byRef.get(key) as Record<string, unknown> | undefined), ...(item as Record<string, unknown>) });
  }
  return Array.from(byRef.values());
}

function mergeRecordArray(previous: unknown, next: Array<Record<string, unknown>> | undefined) {
  const existing = Array.isArray(previous) ? previous.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
  return [...existing, ...(next ?? [])];
}

function backgroundMessageId(run: SciForgeRun | undefined) {
  const raw = run?.raw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const background = (raw as Record<string, unknown>).backgroundCompletion;
  if (!background || typeof background !== 'object' || Array.isArray(background)) return undefined;
  const messageId = (background as Record<string, unknown>).messageId;
  return typeof messageId === 'string' ? messageId : undefined;
}

function objectReferenceForBackgroundRun(run: SciForgeRun, event: BackgroundCompletionRuntimeEvent): ObjectReference {
  return {
    id: `obj-run-${run.id}`,
    title: `run ${run.id}`,
    kind: 'run',
    ref: `run:${run.id}`,
    runId: run.id,
    status: 'available',
    summary: event.stageId ? `background stage ${event.stageId} · ${event.status}` : `background completion · ${event.status}`,
    provenance: {
      producer: BACKGROUND_COMPLETION_CONTRACT_ID,
    },
  };
}

function firstVerificationRef(event: BackgroundCompletionRuntimeEvent) {
  const first = event.verificationResults?.[0];
  return first ? verificationRef(first, event, 0) : undefined;
}

function firstVerificationVerdict(event: BackgroundCompletionRuntimeEvent): RuntimeExecutionUnit['verificationVerdict'] {
  const verdict = event.verificationResults?.[0]?.verdict;
  if (verdict === 'pass' || verdict === 'fail' || verdict === 'uncertain' || verdict === 'needs-human' || verdict === 'unverified') return verdict;
  return undefined;
}

function verificationRef(result: Record<string, unknown>, event: BackgroundCompletionRuntimeEvent, index: number) {
  return typeof result.id === 'string' ? `verification:${result.id}` : `verification:${event.runId}:${event.stageId ?? 'run'}:${index + 1}`;
}

function workEvidenceRef(evidence: Record<string, unknown>, event: BackgroundCompletionRuntimeEvent, index: number) {
  return typeof evidence.id === 'string' ? `work-evidence:${evidence.id}` : `work-evidence:${event.runId}:${event.stageId ?? 'run'}:${index + 1}`;
}

export function appendFailedRunToSession({
  optimisticSession,
  scenarioId,
  scenarioPackageRef,
  skillPlanRef,
  uiPlanRef,
  prompt,
  message,
  references,
  goalSnapshot,
  termination,
}: {
  optimisticSession: SciForgeSession;
  scenarioId: ScenarioInstanceId;
  scenarioPackageRef: ScenarioPackageRef;
  skillPlanRef: string;
  uiPlanRef: string;
  prompt: string;
  message: string;
  references: SciForgeReference[];
  goalSnapshot?: UserGoalSnapshot;
  termination?: RunTerminationRecord;
}) {
  const failedRunId = makeId('run');
  const failedAt = nowIso();
  const raw = termination ? { termination } : undefined;
  const failedRun: SciForgeRun = {
    id: failedRunId,
    scenarioId,
    scenarioPackageRef,
    skillPlanRef,
    uiPlanRef,
    status: termination?.sessionStatus ?? 'failed',
    prompt,
    response: message,
    createdAt: failedAt,
    completedAt: failedAt,
    references,
    goalSnapshot,
    raw,
  };
  const failedMessage: SciForgeMessage = {
    id: makeId('msg'),
    role: 'system',
    content: message,
    createdAt: nowIso(),
    status: termination?.sessionStatus ?? 'failed',
    goalSnapshot,
  };
  return {
    failedRunId,
    session: {
      ...optimisticSession,
      messages: [
        ...optimisticSession.messages,
        failedMessage,
      ],
      runs: [
        ...optimisticSession.runs,
        failedRun,
      ],
      updatedAt: nowIso(),
    },
  };
}

export function attachProcessRecoveryToFailedSession({
  session,
  failedRunId,
  transcript,
  events,
}: {
  session: SciForgeSession;
  failedRunId: string;
  transcript: string;
  events: Array<Pick<AgentStreamEvent, 'type' | 'label' | 'detail' | 'createdAt'>>;
}): SciForgeSession {
  if (!transcript) return session;
  const eventSummaries = events.slice(-24).map((event) => ({
    type: event.type,
    label: event.label,
    createdAt: event.createdAt,
    detailDigest: digestTextField(event.detail),
  }));
  return {
    ...session,
    runs: session.runs.map((run) => run.id === failedRunId
      ? {
          ...run,
          raw: {
            ...(typeof run.raw === 'object' && run.raw !== null ? run.raw : {}),
            streamProcess: {
              eventCount: events.length,
              summaryDigest: digestTextField(transcript),
              eventSummaries,
            },
          },
        }
      : run),
  };
}

function digestTextField(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return {
    omitted: 'text-body',
    chars: value.length,
    hash: stableTextHash(value),
  };
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function requestPayloadForTurn(session: SciForgeSession, userMessage: SciForgeMessage, references: SciForgeReference[]) {
  const hasExplicitReferences = references.length > 0;
  const priorMessages = session.messages.filter((message) => message.id !== userMessage.id);
  const hasRealPriorMessages = priorMessages.some((message) => !message.id.startsWith('seed'));
  const hasPriorWork = hasRealPriorMessages
    || session.runs.length > 0
    || session.artifacts.length > 0
    || session.executionUnits.length > 0;
  if (hasPriorWork || hasExplicitReferences) {
    const messages = compactMessagesForRequestPayload(session.messages, userMessage.id);
    const projectionContexts = projectionContinuationContexts(session.runs, references);
    return {
      messages,
      artifacts: session.artifacts.slice(-REQUEST_PAYLOAD_ARTIFACT_LIMIT).map(compactArtifactForRequestPayload),
      executionUnits: projectionContexts.length
        ? compactProjectionExecutionUnitsForRequestPayload(session.executionUnits, projectionContexts)
        : session.executionUnits.slice(-REQUEST_PAYLOAD_EXECUTION_UNIT_LIMIT).map(compactExecutionUnitForRequestPayload),
      runs: session.runs.slice(-REQUEST_PAYLOAD_RUN_LIMIT).map((run) => compactRunForRequestPayload(run, projectionContexts)),
    };
  }
  return {
    messages: [userMessage],
    artifacts: [],
    executionUnits: [],
    runs: [],
  };
}

interface ProjectionContinuationContext {
  sourceRunId: string;
  projection: UiConversationProjection;
  summary: ConversationProjectionContinuationSummary;
  auditRefs: string[];
}

interface ConversationProjectionContinuationSummary {
  schemaVersion: 'sciforge.conversation-projection-continuation.v1';
  source: 'conversation-projection';
  sourceRunId: string;
  status: string;
  currentTurnId?: string;
  visibleText?: string;
  diagnostic?: string;
  artifactRefs: string[];
  recoverActions: string[];
  backgroundState?: {
    status?: string;
    checkpointRefs?: string[];
    revisionPlan?: string;
  };
  verificationState?: {
    status?: string;
    verifierRef?: string;
    verdict?: string;
  };
  selectedRefs: Array<{
    id: string;
    kind: string;
    ref: string;
    title?: string;
    summary?: string;
  }>;
  auditRefs: string[];
}

function projectionContinuationContexts(runs: SciForgeRun[], references: SciForgeReference[]): ProjectionContinuationContext[] {
  const selectedRefs = compactSelectedRefsForProjectionContinuation(references);
  return runs
    .map((run) => {
      const projection = conversationProjectionForRun(run);
      if (!projection) return undefined;
      const auditRefs = uniqueStringRefs([
        ...conversationProjectionAuditRefs(projection),
        ...collectRuntimeRefsFromValue(run.raw, { maxDepth: 5, maxRefs: REQUEST_PAYLOAD_AUDIT_REF_LIMIT, includeIds: false }),
      ]).slice(0, REQUEST_PAYLOAD_AUDIT_REF_LIMIT);
      return {
        sourceRunId: run.id,
        projection,
        auditRefs,
        summary: compactConversationProjectionForRequestPayload(run.id, projection, selectedRefs, auditRefs),
      };
    })
    .filter((context): context is ProjectionContinuationContext => Boolean(context))
    .slice(-REQUEST_PAYLOAD_PROJECTION_LIMIT);
}

function compactConversationProjectionForRequestPayload(
  sourceRunId: string,
  projection: UiConversationProjection,
  selectedRefs: ConversationProjectionContinuationSummary['selectedRefs'],
  auditRefs: string[],
): ConversationProjectionContinuationSummary {
  return {
    schemaVersion: 'sciforge.conversation-projection-continuation.v1',
    source: 'conversation-projection',
    sourceRunId,
    status: conversationProjectionStatus(projection),
    currentTurnId: projection.currentTurn?.id,
    visibleText: clipOptionalText(conversationProjectionVisibleText(projection), REQUEST_PAYLOAD_PROJECTION_TEXT_LIMIT),
    diagnostic: clipOptionalText(conversationProjectionPrimaryDiagnostic(projection), 600),
    artifactRefs: conversationProjectionArtifactRefs(projection).slice(0, 12),
    recoverActions: projection.recoverActions.slice(0, 6).map((action) => clipText(action, 500)),
    backgroundState: projection.backgroundState ? {
      status: projection.backgroundState.status,
      checkpointRefs: projection.backgroundState.checkpointRefs?.slice(0, 8),
      revisionPlan: clipOptionalText(projection.backgroundState.revisionPlan, 600),
    } : undefined,
    verificationState: projection.verificationState ? {
      status: projection.verificationState.status,
      verifierRef: projection.verificationState.verifierRef,
      verdict: projection.verificationState.verdict,
    } : undefined,
    selectedRefs,
    auditRefs: auditRefs.slice(0, REQUEST_PAYLOAD_AUDIT_REF_LIMIT),
  };
}

function compactSelectedRefsForProjectionContinuation(references: SciForgeReference[]) {
  return references.slice(-REQUEST_PAYLOAD_SELECTED_REF_LIMIT).map((reference) => ({
    id: reference.id,
    kind: reference.kind,
    ref: reference.ref,
    title: clipOptionalText(reference.title, 160),
    summary: clipOptionalText(reference.summary, 360),
  }));
}

function compactMessagesForRequestPayload(messages: SciForgeMessage[], currentMessageId: string) {
  return messages
    .filter((message) => !message.id.startsWith('seed'))
    .slice(-REQUEST_PAYLOAD_MESSAGE_LIMIT)
    .map((message) => ({
      ...message,
      content: message.id === currentMessageId
        ? clipText(message.content, REQUEST_PAYLOAD_MESSAGE_TEXT_LIMIT)
        : omittedTextDigestLabel('previous-message', message.content),
      expandable: message.id === currentMessageId
        ? clipOptionalText(message.expandable, REQUEST_PAYLOAD_MESSAGE_TEXT_LIMIT)
        : undefined,
      contentDigest: message.id === currentMessageId ? undefined : digestTextField(message.content),
      references: message.references?.slice(-8),
      objectReferences: message.objectReferences?.slice(-12),
    }));
}

function compactProjectionExecutionUnitsForRequestPayload(
  units: RuntimeExecutionUnit[],
  contexts: ProjectionContinuationContext[],
): RuntimeExecutionUnit[] {
  const auditRefs = new Set(contexts.flatMap((context) => context.auditRefs));
  const sourceRunIds = new Set(contexts.map((context) => context.sourceRunId));
  const auditUnits = units
    .filter((unit) => executionUnitBelongsToProjectionAudit(unit, auditRefs, sourceRunIds))
    .slice(-(REQUEST_PAYLOAD_EXECUTION_UNIT_LIMIT - 1))
    .map(compactExecutionUnitAuditForRequestPayload);
  return [
    ...auditUnits,
    projectionContinuationExecutionUnit(contexts),
  ];
}

function projectionContinuationExecutionUnit(contexts: ProjectionContinuationContext[]): RuntimeExecutionUnit {
  const params = projectionContinuationParams(contexts);
  return {
    id: `projection-continuation-${contexts.at(-1)?.sourceRunId ?? 'session'}`,
    tool: CONVERSATION_PROJECTION_CONTINUATION_TOOL_ID,
    params,
    status: 'record-only',
    hash: stableTextHash(params),
    runId: contexts.at(-1)?.sourceRunId,
    sourceRunId: contexts.at(-1)?.sourceRunId,
  };
}

function projectionContinuationParams(contexts: ProjectionContinuationContext[]) {
  const build = (projections: ConversationProjectionContinuationSummary[]) => JSON.stringify({
    schemaVersion: 'sciforge.conversation-projection-continuation-set.v1',
    policy: 'projection-first; raw runs and execution units are audit refs only',
    projections,
  });
  const full = build(contexts.map((context) => context.summary));
  if (full.length <= 900) return full;
  const compact = build(contexts.slice(-1).map((context) => ({
    ...context.summary,
    visibleText: context.summary.visibleText ? omittedTextDigestLabel('projection-visible-text', context.summary.visibleText) : undefined,
    diagnostic: clipOptionalText(context.summary.diagnostic, 160),
    recoverActions: context.summary.recoverActions.map((action) => clipText(action, 160)).slice(0, 3),
    selectedRefs: context.summary.selectedRefs.map((ref) => ({
      ...ref,
      title: clipOptionalText(ref.title, 60),
      summary: undefined,
    })),
    auditRefs: context.summary.auditRefs.slice(0, 12),
  })));
  if (compact.length <= 900) return compact;
  return build(contexts.slice(-1).map((context) => ({
    schemaVersion: context.summary.schemaVersion,
    source: context.summary.source,
    sourceRunId: context.summary.sourceRunId,
    status: context.summary.status,
    currentTurnId: context.summary.currentTurnId,
    artifactRefs: context.summary.artifactRefs.slice(0, 4),
    recoverActions: [],
    selectedRefs: context.summary.selectedRefs.map((ref) => ({
      id: ref.id,
      kind: ref.kind,
      ref: ref.ref,
    })).slice(0, 4),
    auditRefs: context.summary.auditRefs.slice(0, 8),
  })));
}

function executionUnitBelongsToProjectionAudit(
  unit: RuntimeExecutionUnit,
  auditRefs: Set<string>,
  sourceRunIds: Set<string>,
) {
  if (sourceRunIds.has(unit.runId ?? '') || sourceRunIds.has(unit.sourceRunId ?? '') || sourceRunIds.has(unit.producerRunId ?? '')) return true;
  const candidateRefs = executionUnitAuditRefs(unit);
  return candidateRefs.some((ref) => auditRefs.has(ref) || auditRefs.has(`execution-unit:${unit.id}`));
}

function compactExecutionUnitAuditForRequestPayload(unit: RuntimeExecutionUnit): RuntimeExecutionUnit {
  return {
    id: unit.id,
    tool: unit.tool,
    params: omittedTextDigestLabel('execution-unit-params', unit.params),
    status: unit.status,
    hash: unit.hash,
    runId: unit.runId,
    sourceRunId: unit.sourceRunId,
    producerRunId: unit.producerRunId,
    agentServerRunId: unit.agentServerRunId,
    codeRef: unit.codeRef,
    stdoutRef: unit.stdoutRef,
    stderrRef: unit.stderrRef,
    outputRef: unit.outputRef,
    diffRef: unit.diffRef,
    artifacts: unit.artifacts?.slice(-8),
    outputArtifacts: unit.outputArtifacts?.slice(-8),
    verificationRef: unit.verificationRef,
    verificationVerdict: unit.verificationVerdict,
    scenarioPackageRef: unit.scenarioPackageRef,
    skillPlanRef: unit.skillPlanRef,
    uiPlanRef: unit.uiPlanRef,
  };
}

function compactArtifactForRequestPayload(artifact: RuntimeArtifact): RuntimeArtifact {
  const compacted: RuntimeArtifact = {
    ...artifact,
    metadata: compactRecord(artifact.metadata, 1_500),
  };
  if (artifact.data === undefined) return compacted;
  if (artifact.dataRef || artifact.path) {
    compacted.metadata = {
      ...(compacted.metadata ?? {}),
      inlineDataOmittedFromChatPayload: true,
    };
    delete compacted.data;
    return compacted;
  }
  const compactedData = compactInlineValue(artifact.data, REQUEST_PAYLOAD_INLINE_DATA_LIMIT);
  if (compactedData.omitted) {
    compacted.metadata = {
      ...(compacted.metadata ?? {}),
      inlineDataOmittedFromChatPayload: true,
      inlineDataApproxBytes: compactedData.approxBytes,
    };
    delete compacted.data;
    return compacted;
  }
  compacted.data = compactedData.value;
  return compacted;
}

function compactExecutionUnitForRequestPayload(unit: RuntimeExecutionUnit): RuntimeExecutionUnit {
  return {
    ...unit,
    params: clipText(unit.params, 1_500),
    code: clipOptionalText(unit.code, 2_000),
    selfHealReason: clipOptionalText(unit.selfHealReason, 1_000),
    patchSummary: clipOptionalText(unit.patchSummary, 1_000),
    failureReason: clipOptionalText(unit.failureReason, 1_500),
    nextStep: clipOptionalText(unit.nextStep, 1_000),
    recoverActions: unit.recoverActions?.map((action) => clipText(action, 600)).slice(-6),
  };
}

function compactRunForRequestPayload(run: SciForgeRun, projectionContexts: ProjectionContinuationContext[] = []): SciForgeRun {
  const raw = compactRunRawForRequestPayload(run.raw, {
    rawTextLimit: REQUEST_PAYLOAD_RAW_TEXT_LIMIT,
    runTextLimit: REQUEST_PAYLOAD_RUN_TEXT_LIMIT,
  });
  const cancelBoundary = cancelBoundaryForRun(run);
  const projectionContext = projectionContexts.find((context) => context.sourceRunId === run.id);
  const compactRaw = projectionContext
    ? compactRunRawAuditForProjectionPayload(raw, projectionContext)
    : raw;
  return {
    ...run,
    prompt: omittedTextDigestLabel('previous-run-prompt', run.prompt),
    response: omittedTextDigestLabel('previous-run-response', run.response),
    raw: cancelBoundary ? { ...(isCompactRecord(compactRaw) ? compactRaw : {}), cancelBoundary } : compactRaw,
    references: run.references?.slice(-8),
    objectReferences: run.objectReferences?.slice(-12),
  };
}

function compactRunRawAuditForProjectionPayload(
  raw: unknown,
  context: ProjectionContinuationContext,
) {
  const record = isCompactRecord(raw) ? raw : {};
  const backgroundCompletion = isCompactRecord(record.backgroundCompletion) ? record.backgroundCompletion : undefined;
  return {
    termination: record.termination,
    cancelBoundary: record.cancelBoundary,
    historicalEditConflict: record.historicalEditConflict,
    guidanceQueue: record.guidanceQueue,
    backgroundCompletion: backgroundCompletion ? {
      status: backgroundCompletion.status,
      stage: backgroundCompletion.stage,
      runId: backgroundCompletion.runId,
      termination: backgroundCompletion.termination,
      refs: uniqueStringRefs([
        ...(Array.isArray(backgroundCompletion.refs) ? backgroundCompletion.refs : []),
        ...context.auditRefs,
      ]).slice(0, 16),
    } : undefined,
    projectionAudit: {
      schemaVersion: 'sciforge.conversation-projection-audit.v1',
      source: 'conversation-projection',
      sourceRunId: context.sourceRunId,
      projectionDigest: stableTextHash(JSON.stringify(context.summary)),
      auditRefs: context.auditRefs.slice(0, REQUEST_PAYLOAD_AUDIT_REF_LIMIT),
      selectedRefs: context.summary.selectedRefs.map((ref) => ref.ref),
    },
    refs: uniqueStringRefs([
      ...(Array.isArray(record.refs) ? record.refs : []),
      ...context.auditRefs,
    ]).slice(0, REQUEST_PAYLOAD_AUDIT_REF_LIMIT),
    bodySummary: {
      omitted: 'run-raw-body',
      keys: Array.isArray((record.bodySummary as { keys?: unknown } | undefined)?.keys)
        ? ((record.bodySummary as { keys?: unknown[] }).keys ?? []).filter((key): key is string => typeof key === 'string').slice(0, 16)
        : Object.keys(record).slice(0, 16),
      projectionFirst: true,
    },
  };
}

function omittedTextDigestLabel(label: string, value: string) {
  const digest = digestTextField(value);
  return digest?.hash
    ? `[${label} omitted; digest=${digest.hash}; chars=${digest.chars ?? value.length}]`
    : `[${label} omitted]`;
}

function cancelBoundaryForRun(run: SciForgeRun) {
  if (run.status !== 'cancelled') return undefined;
  const reason = terminationReasonFromRaw(run.raw) ?? 'user-cancelled';
  return {
    schemaVersion: 'sciforge.cancel-boundary.v1',
    reason,
    sideEffectPolicy: reason === 'user-cancelled' ? 'do-not-auto-resume' : 'inspect-before-resume',
    nextStep: reason === 'user-cancelled'
      ? 'Ask the user to confirm whether to reuse partial refs or start a new run; do not automatically resume irreversible side effects.'
      : 'Inspect termination diagnostics and preserved refs before deciding whether continuation is safe.',
  };
}

function terminationReasonFromRaw(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const direct = record.termination;
  if (direct && typeof direct === 'object' && !Array.isArray(direct) && typeof (direct as Record<string, unknown>).reason === 'string') {
    return (direct as Record<string, unknown>).reason as string;
  }
  const background = record.backgroundCompletion;
  if (background && typeof background === 'object' && !Array.isArray(background)) {
    const termination = (background as Record<string, unknown>).termination;
    if (termination && typeof termination === 'object' && !Array.isArray(termination) && typeof (termination as Record<string, unknown>).reason === 'string') {
      return (termination as Record<string, unknown>).reason as string;
    }
  }
  return undefined;
}

function isCompactRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function executionUnitAuditRefs(unit: RuntimeExecutionUnit) {
  return uniqueStringRefs([
    `execution-unit:${unit.id}`,
    unit.codeRef,
    unit.stdoutRef,
    unit.stderrRef,
    unit.outputRef,
    unit.diffRef,
    unit.verificationRef,
    ...(unit.artifacts ?? []).map((id) => id.startsWith('artifact:') ? id : `artifact:${id}`),
    ...(unit.outputArtifacts ?? []).map((id) => id.startsWith('artifact:') ? id : `artifact:${id}`),
  ]);
}

function uniqueStringRefs(values: unknown[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function compactRecord(record: Record<string, unknown> | undefined, maxChars: number) {
  if (!record) return undefined;
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'data' || key === 'events') continue;
    compacted[key] = compactInlineValue(value, maxChars).value;
  }
  return compacted;
}

function compactInlineValue(value: unknown, maxChars: number): { value: unknown; omitted: boolean; approxBytes?: number } {
  if (typeof value === 'string') {
    return value.length > maxChars
      ? { value: clipText(value, maxChars), omitted: false, approxBytes: value.length }
      : { value, omitted: false };
  }
  if (value === undefined || value === null || typeof value === 'number' || typeof value === 'boolean') {
    return { value, omitted: false };
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxChars) return { value, omitted: false };
    return { value: `[omitted from chat payload: ${serialized.length} chars]`, omitted: true, approxBytes: serialized.length };
  } catch {
    return { value: '[omitted from chat payload: unserializable value]', omitted: true };
  }
}

function clipOptionalText(value: string | undefined, maxChars: number) {
  return value === undefined ? undefined : clipText(value, maxChars);
}

function clipText(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...[truncated]` : value;
}

export function rollbackSessionBeforeMessage(session: SciForgeSession, messageId: string): SciForgeSession {
  const index = session.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return session;
  const cutoff = session.messages[index]?.createdAt;
  const runs = cutoff ? session.runs.filter((run) => run.createdAt < cutoff) : [];
  const keptRunIds = new Set(runs.map((run) => run.id));
  return {
    ...session,
    messages: session.messages.slice(0, index),
    runs,
    uiManifest: [],
    claims: cutoff ? session.claims.filter((claim) => claim.updatedAt < cutoff) : [],
    executionUnits: session.executionUnits.filter((unit) => {
      const selectedAt = unit.routeDecision?.selectedAt;
      return selectedAt ? selectedAt < cutoff : keptRunIds.size > 0;
    }),
    artifacts: keptRunIds.size ? session.artifacts : [],
    notebook: cutoff ? session.notebook.filter((entry) => entry.time < cutoff) : [],
    updatedAt: nowIso(),
  };
}

export function applyHistoricalUserMessageEdit({
  session,
  messageId,
  content,
  mode,
  editedAt = nowIso(),
}: {
  session: SciForgeSession;
  messageId: string;
  content: string;
  mode: HistoricalMessageEditMode;
  editedAt?: string;
}): HistoricalMessageEditResult {
  const index = session.messages.findIndex((message) => message.id === messageId);
  const target = session.messages[index];
  if (index < 0 || !target || target.role !== 'user') {
    return { session: session as HistoricalMessageEditSession };
  }
  const impact = historicalEditImpact(session, index);
  const branchId = makeId('history-edit');
  const affectedRefs = impact.refs.map((ref) => ({ ...ref, reason: 'affected-by-edit' as const }));
  const invalidatedRefs = mode === 'revert'
    ? impact.refs.map((ref) => ({ ...ref, reason: 'invalidated-after-edit' as const }))
    : [];
  const sourceMessageRef = `message:${messageId}`;
  const branch: HistoricalMessageEditBranch = {
    schemaVersion: HISTORY_EDIT_BRANCH_SCHEMA_VERSION,
    id: branchId,
    mode,
    messageId,
    sourceMessageRef,
    originalContent: target.content,
    editedContent: content,
    editedAt,
    boundaryAt: impact.cutoff,
    invalidatedRefs,
    affectedRefs,
    affectedConclusions: impact.affectedConclusions,
    conflicts: mode === 'continue' ? historicalEditConflicts(sourceMessageRef, impact) : [],
    requiresUserConfirmation: mode === 'continue' && impact.refs.length > 0,
    nextStep: historicalEditNextStep(mode, impact.refs.length),
  };
  const editedMessage = updateHistoricalEditMessage(target, content, editedAt);
  const nextSession = mode === 'revert'
    ? revertHistoricalEditSession(session, index, editedMessage, impact, editedAt)
    : continueHistoricalEditSession(session, messageId, editedMessage, impact, branch, editedAt);
  return {
    session: appendHistoryEditBranch(nextSession, branch),
    branch,
  };
}

function updateHistoricalEditMessage(message: SciForgeMessage, content: string, updatedAt: string): SciForgeMessage {
  return { ...message, content, updatedAt, status: 'completed' };
}

interface HistoricalEditImpact {
  cutoff: string;
  refs: Array<Omit<HistoricalMessageEditRef, 'reason'>>;
  affectedRunIds: Set<string>;
  affectedArtifactIds: Set<string>;
  affectedExecutionUnitIds: Set<string>;
  affectedClaimIds: Set<string>;
  affectedConclusions: HistoricalMessageEditConclusion[];
  affectedRuns: SciForgeRun[];
}

function historicalEditImpact(session: SciForgeSession, messageIndex: number): HistoricalEditImpact {
  const target = session.messages[messageIndex];
  const cutoff = target?.createdAt ?? '';
  const downstreamMessages = session.messages.slice(messageIndex + 1);
  const affectedRuns = cutoff ? session.runs.filter((run) => run.createdAt >= cutoff) : session.runs;
  const affectedRunIds = new Set(affectedRuns.map((run) => run.id));
  const downstreamObjectRefs = [
    ...downstreamMessages.flatMap((message) => message.objectReferences ?? []),
    ...affectedRuns.flatMap((run) => run.objectReferences ?? []),
  ];
  const affectedArtifactIds = new Set<string>();
  for (const artifact of session.artifacts) {
    const runId = stringField(artifact.metadata?.runId);
    if (runId && affectedRunIds.has(runId)) affectedArtifactIds.add(artifact.id);
  }
  for (const reference of downstreamObjectRefs) {
    const artifactId = idFromPrefixedRef(reference.ref, 'artifact');
    if (artifactId) affectedArtifactIds.add(artifactId);
  }
  const affectedExecutionUnitIds = new Set<string>();
  for (const reference of downstreamObjectRefs) {
    const executionUnitId = reference.executionUnitId ?? idFromPrefixedRef(reference.ref, 'execution-unit');
    if (executionUnitId) affectedExecutionUnitIds.add(executionUnitId);
  }
  for (const unit of session.executionUnits) {
    if (executionUnitBelongsToEditImpact(unit, cutoff, affectedRunIds, affectedArtifactIds)) {
      affectedExecutionUnitIds.add(unit.id);
    }
  }
  const impactRefSet = new Set<string>([
    ...Array.from(affectedRunIds, (id) => `run:${id}`),
    ...Array.from(affectedArtifactIds, (id) => `artifact:${id}`),
    ...Array.from(affectedExecutionUnitIds, (id) => `execution-unit:${id}`),
    ...downstreamObjectRefs.map((reference) => reference.ref),
  ]);
  const affectedClaims = session.claims.filter((claim) => {
    if (cutoff && claim.updatedAt >= cutoff) return true;
    return claimRefs(claim).some((ref) => impactRefSet.has(ref));
  });
  const affectedClaimIds = new Set(affectedClaims.map((claim) => claim.id));
  const refs = uniqueHistoricalEditRefs([
    ...downstreamMessages.map((message) => ({
      ref: `message:${message.id}`,
      source: 'message' as const,
      sourceId: message.id,
      title: message.role,
    })),
    ...affectedRuns.map((run) => ({
      ref: `run:${run.id}`,
      source: 'run' as const,
      sourceId: run.id,
      title: run.prompt || run.id,
    })),
    ...session.artifacts.filter((artifact) => affectedArtifactIds.has(artifact.id)).map((artifact) => ({
      ref: `artifact:${artifact.id}`,
      source: 'artifact' as const,
      sourceId: artifact.id,
      title: stringField(artifact.metadata?.title) ?? artifact.id,
    })),
    ...session.executionUnits.filter((unit) => affectedExecutionUnitIds.has(unit.id)).map((unit) => ({
      ref: `execution-unit:${unit.id}`,
      source: 'execution-unit' as const,
      sourceId: unit.id,
      title: unit.tool || unit.id,
    })),
    ...affectedClaims.map((claim) => ({
      ref: `claim:${claim.id}`,
      source: 'claim' as const,
      sourceId: claim.id,
      title: claim.text,
    })),
    ...session.notebook.filter((entry) => cutoff && entry.time >= cutoff || refsIntersect(notebookRefs(entry), impactRefSet)).map((entry) => ({
      ref: `notebook:${entry.id}`,
      source: 'notebook' as const,
      sourceId: entry.id,
      title: entry.title,
    })),
    ...session.uiManifest.filter((slot) => uiManifestSlotRefs(slot).some((ref) => impactRefSet.has(ref))).map((slot, slotIndex) => ({
      ref: `ui-manifest:${slotIndex + 1}`,
      source: 'ui-manifest' as const,
      sourceId: slot.artifactRef ?? slot.componentId,
      title: slot.title ?? slot.componentId,
    })),
    ...downstreamObjectRefs.map((reference) => ({
      ref: reference.ref,
      source: 'object-reference' as const,
      sourceId: reference.id,
      title: reference.title,
    })),
  ]);
  return {
    cutoff,
    refs,
    affectedRunIds,
    affectedArtifactIds,
    affectedExecutionUnitIds,
    affectedClaimIds,
    affectedConclusions: affectedClaims.map((claim) => ({
      ref: `claim:${claim.id}`,
      id: claim.id,
      text: claim.text,
      supportingRefs: claim.supportingRefs,
      opposingRefs: claim.opposingRefs,
      dependencyRefs: claim.dependencyRefs ?? [],
    })),
    affectedRuns,
  };
}

function executionUnitBelongsToEditImpact(
  unit: RuntimeExecutionUnit,
  cutoff: string,
  affectedRunIds: Set<string>,
  affectedArtifactIds: Set<string>,
) {
  if (unit.routeDecision?.selectedAt && unit.routeDecision.selectedAt >= cutoff) return true;
  if (unit.time && unit.time >= cutoff) return true;
  if (refMentionsAnyRun(unit.outputRef, affectedRunIds) || refMentionsAnyRun(unit.codeRef, affectedRunIds)) return true;
  if (unit.artifacts?.some((id) => affectedArtifactIds.has(id))) return true;
  if (unit.outputArtifacts?.some((id) => affectedArtifactIds.has(id))) return true;
  return false;
}

function revertHistoricalEditSession(
  session: SciForgeSession,
  messageIndex: number,
  editedMessage: SciForgeMessage,
  impact: HistoricalEditImpact,
  updatedAt: string,
): HistoricalMessageEditSession {
  const impactRefs = new Set(impact.refs.map((ref) => ref.ref));
  return {
    ...(session as HistoricalMessageEditSession),
    messages: [...session.messages.slice(0, messageIndex), editedMessage],
    runs: session.runs.filter((run) => !impact.affectedRunIds.has(run.id)),
    uiManifest: session.uiManifest.filter((slot) => !uiManifestSlotRefs(slot).some((ref) => impactRefs.has(ref))),
    claims: session.claims.filter((claim) => !impact.affectedClaimIds.has(claim.id)),
    executionUnits: session.executionUnits.filter((unit) => !impact.affectedExecutionUnitIds.has(unit.id)),
    artifacts: session.artifacts.filter((artifact) => !impact.affectedArtifactIds.has(artifact.id)),
    notebook: session.notebook.filter((entry) => !impactRefs.has(`notebook:${entry.id}`) && !refsIntersect(notebookRefs(entry), impactRefs)),
    updatedAt,
  };
}

function continueHistoricalEditSession(
  session: SciForgeSession,
  messageId: string,
  editedMessage: SciForgeMessage,
  impact: HistoricalEditImpact,
  branch: HistoricalMessageEditBranch,
  updatedAt: string,
): HistoricalMessageEditSession {
  const conflict = {
    schemaVersion: HISTORY_EDIT_BRANCH_SCHEMA_VERSION,
    branchId: branch.id,
    sourceMessageRef: branch.sourceMessageRef,
    editedAt: branch.editedAt,
    requiresUserConfirmation: branch.requiresUserConfirmation,
    nextStep: branch.nextStep,
  };
  return {
    ...(session as HistoricalMessageEditSession),
    messages: session.messages.map((message) => message.id === messageId ? editedMessage : message),
    runs: session.runs.map((run) => impact.affectedRunIds.has(run.id)
      ? { ...run, raw: mergeHistoricalEditConflictRaw(run.raw, conflict) }
      : run),
    artifacts: session.artifacts.map((artifact) => impact.affectedArtifactIds.has(artifact.id)
      ? {
          ...artifact,
          metadata: {
            ...(artifact.metadata ?? {}),
            historicalEditConflict: conflict,
          },
        }
      : artifact),
    updatedAt,
  };
}

function appendHistoryEditBranch(session: HistoricalMessageEditSession, branch: HistoricalMessageEditBranch): HistoricalMessageEditSession {
  return {
    ...session,
    historyEditBranches: [...(session.historyEditBranches ?? []), branch].slice(-12),
  };
}

function mergeHistoricalEditConflictRaw(raw: unknown, conflict: Record<string, unknown>) {
  const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    ...base,
    historicalEditConflict: {
      ...(recordField(base.historicalEditConflict)),
      ...conflict,
    },
  };
}

function historicalEditConflicts(sourceMessageRef: string, impact: HistoricalEditImpact): HistoricalMessageEditConflict[] {
  const conclusionRefs = impact.affectedConclusions.map((claim) => claim.ref);
  return impact.affectedRuns.map((run) => {
    const affectedRefs = uniqueStrings([
      `run:${run.id}`,
      ...(run.objectReferences ?? []).map((reference) => reference.ref),
    ]);
    return {
      id: makeId('history-conflict'),
      kind: 'downstream-result-after-edited-message',
      sourceMessageRef,
      affectedRefs,
      affectedConclusionRefs: conclusionRefs,
      detail: `Run ${run.id} was produced after ${sourceMessageRef}; confirm whether to keep it with the edited message or rerun from the edit boundary.`,
    };
  });
}

function historicalEditNextStep(mode: HistoricalMessageEditMode, affectedRefCount: number) {
  if (mode === 'revert') {
    return affectedRefCount > 0
      ? 'Downstream derived refs were invalidated. Start the next run from the edited message boundary.'
      : 'No downstream derived refs were found; continue from the edited message.';
  }
  return affectedRefCount > 0
    ? 'Ask the user to confirm whether to keep the affected downstream results or rerun from the edited message boundary before using those refs as current conclusions.'
    : 'No downstream results conflict with the edit; continue normally.';
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function idFromPrefixedRef(ref: string | undefined, prefix: string) {
  if (!ref) return undefined;
  const marker = `${prefix}:`;
  return ref.startsWith(marker) ? ref.slice(marker.length).split(/[/?#]/, 1)[0] : undefined;
}

function refMentionsAnyRun(ref: string | undefined, runIds: Set<string>) {
  if (!ref) return false;
  for (const runId of runIds) {
    if (ref === `run:${runId}` || ref.startsWith(`run:${runId}/`) || ref.startsWith(`run:${runId}#`)) return true;
  }
  return false;
}

function claimRefs(claim: SciForgeSession['claims'][number]) {
  return [...claim.supportingRefs, ...claim.opposingRefs, ...(claim.dependencyRefs ?? [])];
}

function notebookRefs(entry: SciForgeSession['notebook'][number]) {
  return [
    ...(entry.artifactRefs ?? []).map((id) => id.includes(':') ? id : `artifact:${id}`),
    ...(entry.executionUnitRefs ?? []).map((id) => id.includes(':') ? id : `execution-unit:${id}`),
    ...(entry.beliefRefs ?? []),
    ...(entry.dependencyRefs ?? []),
  ];
}

function uiManifestSlotRefs(slot: SciForgeSession['uiManifest'][number]) {
  return [
    slot.artifactRef,
    ...(slot.compare?.artifactRefs ?? []),
  ].filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
    .map((ref) => ref.includes(':') ? ref : `artifact:${ref}`);
}

function refsIntersect(refs: string[], candidates: Set<string>) {
  return refs.some((ref) => candidates.has(ref));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueHistoricalEditRefs(refs: Array<Omit<HistoricalMessageEditRef, 'reason'>>) {
  const byRef = new Map<string, Omit<HistoricalMessageEditRef, 'reason'>>();
  for (const ref of refs) {
    if (!ref.ref || byRef.has(ref.ref)) continue;
    byRef.set(ref.ref, ref);
  }
  return Array.from(byRef.values());
}

export function mergeRuntimeArtifacts(primary: NormalizedAgentResponse['artifacts'], secondary: NormalizedAgentResponse['artifacts']) {
  const byKey = new Map<string, NormalizedAgentResponse['artifacts'][number]>();
  for (const artifact of [...secondary, ...primary]) {
    const key = artifact.id || artifact.path || artifact.dataRef || `${artifact.type}-${byKey.size}`;
    const previous = byKey.get(key);
    if (byKey.has(key)) byKey.delete(key);
    byKey.set(key, { ...previous, ...artifact });
  }
  return Array.from(byKey.values()).slice(-32);
}

export function mergeExecutionUnits(primary: NormalizedAgentResponse['executionUnits'], secondary: NormalizedAgentResponse['executionUnits']) {
  const byId = new Map<string, NormalizedAgentResponse['executionUnits'][number]>();
  for (const unit of [...secondary, ...primary]) {
    const key = unit.id || `${unit.tool}-${byId.size}`;
    const previous = byId.get(key);
    if (byId.has(key)) byId.delete(key);
    byId.set(key, { ...previous, ...unit });
  }
  return Array.from(byId.values()).slice(-32);
}

export function mergeRuns(primary: NormalizedAgentResponse['run'][], secondary: NormalizedAgentResponse['run'][]) {
  const byId = new Map<string, NormalizedAgentResponse['run']>();
  for (const run of [...primary, ...secondary]) byId.set(run.id, { ...byId.get(run.id), ...run });
  return Array.from(byId.values()).slice(-12);
}

export function mergeRepairSuccessResponse(
  original: NormalizedAgentResponse,
  repair: NormalizedAgentResponse,
  repairHistory: NonNullable<NonNullable<NormalizedAgentResponse['message']['acceptance']>['repairHistory']>,
): NormalizedAgentResponse {
  const objectReferences = mergeObjectReferences(repair.message.objectReferences ?? [], original.message.objectReferences ?? []);
  const acceptance = repair.message.acceptance ? {
    ...repair.message.acceptance,
    objectReferences,
    repairAttempt: repairHistory.length,
    repairHistory,
  } : undefined;
  return {
    ...repair,
    message: {
      ...repair.message,
      objectReferences,
      acceptance,
    },
    run: {
      ...repair.run,
      objectReferences,
      acceptance,
      raw: enrichRepairRaw(repair.run.raw, repairHistory, original.run.id),
    },
    uiManifest: repair.uiManifest.length ? repair.uiManifest : original.uiManifest,
    claims: [...repair.claims, ...original.claims].slice(0, 24),
    executionUnits: mergeExecutionUnits(repair.executionUnits, original.executionUnits),
    artifacts: mergeRuntimeArtifacts(repair.artifacts, original.artifacts),
    notebook: [...repair.notebook, ...original.notebook].slice(0, 24),
  };
}

export function failedAcceptanceRepairResponse(
  original: NormalizedAgentResponse,
  repair: NormalizedAgentResponse | undefined,
  action: string,
  startedAt: string,
  completedAt: string,
  baseHistory: NonNullable<NonNullable<NormalizedAgentResponse['message']['acceptance']>['repairHistory']>,
  reason: string,
): NormalizedAgentResponse {
  const failureUnit: RuntimeExecutionUnit = {
    id: makeId('EU-acceptance-repair'),
    tool: ACCEPTANCE_REPAIR_RERUN_TOOL_ID,
    params: `sourceRunId=${original.run.id}`,
    status: 'failed-with-reason',
    hash: original.run.id.slice(0, 10),
    attempt: baseHistory.length + 1,
    parentAttempt: 0,
    failureReason: reason,
    recoverActions: ['Review failureReason/stdoutRef/stderrRef/codeRef and rerun manually if needed.'],
    nextStep: 'Repair rerun failed; return failed-with-reason to the user instead of presenting partial success.',
  };
  const repairHistory = [...baseHistory, {
    attempt: baseHistory.length + 1,
    action,
    status: 'failed-with-reason' as const,
    startedAt,
    completedAt,
    sourceRunId: original.run.id,
    repairRunId: repair?.run.id,
    failureCodes: original.message.acceptance?.failures.map((failure) => failure.code) ?? [],
    reason,
  }];
  const objectReferences = mergeObjectReferences(repair?.message.objectReferences ?? [], original.message.objectReferences ?? []);
  const acceptance = original.message.acceptance ? {
    ...original.message.acceptance,
    pass: false,
    severity: 'failed' as const,
    checkedAt: completedAt,
    objectReferences,
    repairAttempt: repairHistory.length,
    repairHistory,
    failures: [
      ...original.message.acceptance.failures,
      {
        code: 'backend-repair-failed',
        detail: reason,
        repairAction: action,
      },
    ],
  } : undefined;
  const content = `failed-with-reason: 后台 artifact/execution repair 未能完成。${reason}`;
  return {
    ...original,
    message: {
      ...original.message,
      content,
      status: 'failed',
      objectReferences,
      acceptance,
    },
    run: {
      ...original.run,
      status: 'failed',
      response: content,
      completedAt,
      objectReferences,
      acceptance,
      raw: enrichRepairRaw(original.run.raw, repairHistory, original.run.id, reason),
    },
    uiManifest: repair?.uiManifest.length ? repair.uiManifest : original.uiManifest,
    claims: [...(repair?.claims ?? []), ...original.claims].slice(0, 24),
    executionUnits: mergeExecutionUnits([failureUnit, ...(repair?.executionUnits ?? [])], original.executionUnits),
    artifacts: mergeRuntimeArtifacts(repair?.artifacts ?? [], original.artifacts),
    notebook: [...(repair?.notebook ?? []), ...original.notebook].slice(0, 24),
  };
}

function enrichRepairRaw(raw: unknown, repairHistory: unknown, sourceRunId: string, failureReason?: string) {
  const repairMetadata = { acceptanceRepair: { sourceRunId, repairHistory, failureReason } };
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...raw, ...repairMetadata }
    : { raw, ...repairMetadata };
}

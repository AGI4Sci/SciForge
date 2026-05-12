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
import { normalizeScenarioPromptTitle } from '@sciforge/scenario-core/scenario-routing-policy';
import {
  ACCEPTANCE_REPAIR_RERUN_TOOL_ID,
  BACKGROUND_COMPLETION_CONTRACT_ID,
  BACKGROUND_COMPLETION_TOOL_ID,
  normalizeRunTermination,
  type RunTerminationRecord,
} from '@sciforge-ui/runtime-contract/events';

const REQUEST_PAYLOAD_MESSAGE_LIMIT = 12;
const REQUEST_PAYLOAD_ARTIFACT_LIMIT = 16;
const REQUEST_PAYLOAD_EXECUTION_UNIT_LIMIT = 16;
const REQUEST_PAYLOAD_RUN_LIMIT = 8;
const REQUEST_PAYLOAD_MESSAGE_TEXT_LIMIT = 6_000;
const REQUEST_PAYLOAD_RUN_TEXT_LIMIT = 2_000;
const REQUEST_PAYLOAD_RAW_TEXT_LIMIT = 2_500;
const REQUEST_PAYLOAD_INLINE_DATA_LIMIT = 3_000;

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
          status: patch.status === 'rejected' || patch.status === 'merged' ? 'completed' : message.status,
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
  return {
    ...session,
    runs: session.runs.map((run) => run.id === failedRunId
      ? {
          ...run,
          raw: {
            ...(typeof run.raw === 'object' && run.raw !== null ? run.raw : {}),
            streamProcess: {
              eventCount: events.length,
              summary: transcript,
              events,
            },
          },
        }
      : run),
  };
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
    const messages = compactMessagesForRequestPayload(session.messages);
    return {
      messages,
      artifacts: session.artifacts.slice(-REQUEST_PAYLOAD_ARTIFACT_LIMIT).map(compactArtifactForRequestPayload),
      executionUnits: session.executionUnits.slice(-REQUEST_PAYLOAD_EXECUTION_UNIT_LIMIT).map(compactExecutionUnitForRequestPayload),
      runs: session.runs.slice(-REQUEST_PAYLOAD_RUN_LIMIT).map(compactRunForRequestPayload),
    };
  }
  return {
    messages: [userMessage],
    artifacts: [],
    executionUnits: [],
    runs: [],
  };
}

function compactMessagesForRequestPayload(messages: SciForgeMessage[]) {
  return messages
    .filter((message) => !message.id.startsWith('seed'))
    .slice(-REQUEST_PAYLOAD_MESSAGE_LIMIT)
    .map((message) => ({
      ...message,
      content: clipText(message.content, REQUEST_PAYLOAD_MESSAGE_TEXT_LIMIT),
      expandable: clipOptionalText(message.expandable, REQUEST_PAYLOAD_MESSAGE_TEXT_LIMIT),
      references: message.references?.slice(-8),
      objectReferences: message.objectReferences?.slice(-12),
    }));
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

function compactRunForRequestPayload(run: SciForgeRun): SciForgeRun {
  return {
    ...run,
    prompt: clipText(run.prompt, REQUEST_PAYLOAD_RUN_TEXT_LIMIT),
    response: clipText(run.response, REQUEST_PAYLOAD_RUN_TEXT_LIMIT),
    raw: compactRunRaw(run.raw),
    references: run.references?.slice(-8),
    objectReferences: run.objectReferences?.slice(-12),
  };
}

function compactRunRaw(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return compactInlineValue(raw, REQUEST_PAYLOAD_RAW_TEXT_LIMIT).value;
  const record = raw as Record<string, unknown>;
  const streamProcess = record.streamProcess && typeof record.streamProcess === 'object' && !Array.isArray(record.streamProcess)
    ? record.streamProcess as Record<string, unknown>
    : undefined;
  return {
    ...compactRecord(record, REQUEST_PAYLOAD_RAW_TEXT_LIMIT),
    streamProcess: streamProcess
      ? {
          eventCount: streamProcess.eventCount,
          summary: clipOptionalText(typeof streamProcess.summary === 'string' ? streamProcess.summary : undefined, REQUEST_PAYLOAD_RUN_TEXT_LIMIT),
        }
      : undefined,
  };
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

export function mergeRuntimeArtifacts(primary: NormalizedAgentResponse['artifacts'], secondary: NormalizedAgentResponse['artifacts']) {
  const byKey = new Map<string, NormalizedAgentResponse['artifacts'][number]>();
  for (const artifact of [...secondary, ...primary]) {
    const key = artifact.id || artifact.path || artifact.dataRef || `${artifact.type}-${byKey.size}`;
    byKey.set(key, { ...byKey.get(key), ...artifact });
  }
  return Array.from(byKey.values()).slice(0, 32);
}

export function mergeExecutionUnits(primary: NormalizedAgentResponse['executionUnits'], secondary: NormalizedAgentResponse['executionUnits']) {
  const byId = new Map<string, NormalizedAgentResponse['executionUnits'][number]>();
  for (const unit of [...secondary, ...primary]) {
    const key = unit.id || `${unit.tool}-${byId.size}`;
    byId.set(key, { ...byId.get(key), ...unit });
  }
  return Array.from(byId.values()).slice(0, 32);
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

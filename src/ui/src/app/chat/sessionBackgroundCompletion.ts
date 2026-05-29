import type {
  BackgroundCompletionRuntimeEvent,
  ObjectReference,
  RuntimeArtifact,
  RuntimeExecutionUnit,
  SciForgeMessage,
  SciForgeRun,
  SciForgeSession,
} from '../../domain';
import { mergeObjectReferences } from '../../../../../packages/support/object-references';
import {
  BACKGROUND_COMPLETION_CONTRACT_ID,
  BACKGROUND_COMPLETION_TOOL_ID,
  normalizeRunTermination,
  type RunTerminationRecord,
} from '@sciforge-ui/runtime-contract/events';

export function backgroundRunForEvent(
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

export function backgroundMessageForEvent(
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
    provenance: event.status === 'completed' && event.finalResponse
      ? {
        kind: 'live-runtime-codex',
        source: `background-completion:${event.runId}`,
        runtimeRequestEligible: false,
        liveAcceptanceEligible: true,
      }
      : {
        kind: 'system-ui',
        source: `background-completion:${event.runId}`,
        runtimeRequestEligible: false,
        liveAcceptanceEligible: false,
      },
  };
}

export function mergeBackgroundMessage(messages: SciForgeMessage[], message: SciForgeMessage) {
  const found = messages.some((item) => item.id === message.id);
  if (!found) return [...messages, message];
  return messages.map((item) => item.id === message.id ? { ...item, ...message } : item);
}

export function mergeBackgroundRun(runs: SciForgeRun[], run: SciForgeRun) {
  const found = runs.some((item) => item.id === run.id);
  if (!found) return [...runs, run];
  return runs.map((item) => item.id === run.id ? { ...item, ...run } : item);
}

export function normalizeBackgroundExecutionUnits(event: BackgroundCompletionRuntimeEvent, updatedAt: string): RuntimeExecutionUnit[] {
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

export function tagBackgroundArtifacts(artifacts: RuntimeArtifact[], event: BackgroundCompletionRuntimeEvent) {
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

export function mergeBackgroundRaw(raw: unknown, event: BackgroundCompletionRuntimeEvent, messageId: string, updatedAt: string) {
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

export function backgroundMessageId(run: SciForgeRun | undefined) {
  const raw = run?.raw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const background = (raw as Record<string, unknown>).backgroundCompletion;
  if (!background || typeof background !== 'object' || Array.isArray(background)) return undefined;
  const messageId = (background as Record<string, unknown>).messageId;
  return typeof messageId === 'string' ? messageId : undefined;
}

export function objectReferenceForBackgroundRun(run: SciForgeRun, event: BackgroundCompletionRuntimeEvent): ObjectReference {
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

function mergeExecutionUnits(primary: RuntimeExecutionUnit[], secondary: RuntimeExecutionUnit[]) {
  const byId = new Map<string, RuntimeExecutionUnit>();
  for (const unit of [...secondary, ...primary]) {
    const key = unit.id || `${unit.tool}-${byId.size}`;
    const previous = byId.get(key);
    if (byId.has(key)) byId.delete(key);
    byId.set(key, { ...previous, ...unit });
  }
  return Array.from(byId.values()).slice(-32);
}

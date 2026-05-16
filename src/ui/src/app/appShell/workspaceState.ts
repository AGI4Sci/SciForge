import type { ScenarioId, ScenarioViewConfig } from '../../data';
import {
  makeId,
  nowIso,
  type RuntimeArtifact,
  type SciForgeRun,
  type SciForgeSession,
  type SciForgeWorkspaceState,
  type ScenarioInstanceId,
  type TimelineEventRecord,
} from '../../domain';
import {
  detectSessionWriteConflict,
  recordSessionWriteConflict,
  type SessionWriteConflictDiagnostic,
  type SessionWriteGuardOptions,
  versionSession,
} from '../../sessionStore';
import { applyArtifactHandoffToWorkspace } from '../../workspace/artifactHandoff';
import { handoffAutoRunPrompt } from '../results/autoRunPrompts';
import { artifactsForRun, auditExecutionUnitsForRun } from '../results/executionUnitsForRun';
import {
  conversationProjectionForSession,
  conversationProjectionStatus,
  conversationProjectionRecoverFocusSignal,
} from '../conversation-projection-view-model';
import type { HandoffAutoRunRequest } from '../results/viewPlanResolver';

const TIMELINE_EVENT_LIMIT = 200;

export interface ArtifactHandoffTransition {
  targetScenario: ScenarioId;
  autoRunRequest: HandoffAutoRunRequest;
  apply(state: SciForgeWorkspaceState): SciForgeWorkspaceState;
}

export interface WorkspaceRecoveryFocus {
  scenarioId: ScenarioInstanceId;
  sessionId: string;
  activeRunId: string;
  reason: 'failed-run' | 'repair-needed-run';
  updatedAt: string;
}

export type ApplySessionUpdateResult =
  | { ok: true; state: SciForgeWorkspaceState; diagnostic?: undefined }
  | { ok: false; state: SciForgeWorkspaceState; diagnostic: SessionWriteConflictDiagnostic };

export function touchWorkspaceUpdatedAt(state: SciForgeWorkspaceState, updatedAt: string): SciForgeWorkspaceState {
  return { ...state, updatedAt };
}

export function applySessionUpdateToWorkspace(
  state: SciForgeWorkspaceState,
  nextSession: SciForgeSession,
  reason = 'session update',
  options: SessionWriteGuardOptions = {},
): SciForgeWorkspaceState {
  return tryApplySessionUpdateToWorkspace(state, nextSession, reason, options).state;
}

export function tryApplySessionUpdateToWorkspace(
  state: SciForgeWorkspaceState,
  nextSession: SciForgeSession,
  reason = 'session update',
  options: SessionWriteGuardOptions = {},
): ApplySessionUpdateResult {
  const diagnostic = detectSessionWriteConflict(state.sessionsByScenario[nextSession.scenarioId], nextSession, {
    ...options,
    reason,
  });
  if (diagnostic) {
    return {
      ok: false,
      state: recordSessionWriteConflict(state, diagnostic),
      diagnostic,
    };
  }
  const nextState = {
    ...state,
    sessionsByScenario: {
      ...state.sessionsByScenario,
      [nextSession.scenarioId]: versionSession(nextSession, reason),
    },
    timelineEvents: mergeRunTimelineEvents(state.timelineEvents ?? [], state.sessionsByScenario[nextSession.scenarioId], nextSession),
  };
  return { ok: true, state: nextState };
}

export function recoverableRunFocusForSession(session: SciForgeSession): WorkspaceRecoveryFocus | undefined {
  let newerSatisfiedRunSeen = false;
  let candidate: { run: SciForgeRun; reason: WorkspaceRecoveryFocus['reason'] } | undefined;
  for (const run of [...session.runs].reverse()) {
    const focus = recoverableReasonForRun(session, run);
    if (focus && !newerSatisfiedRunSeen) {
      candidate = {
        run: runForProjectedActiveRun(session, run, focus.activeRunId),
        reason: focus.reason,
      };
      break;
    }
    if (!focus && runSupersedesOlderRecoverableFocus(session, run)) newerSatisfiedRunSeen = true;
  }
  if (!candidate) return undefined;
  return {
    scenarioId: session.scenarioId,
    sessionId: session.sessionId,
    activeRunId: candidate.run.id,
    reason: candidate.reason,
    updatedAt: runActivityTime(candidate.run, session),
  };
}

export function workspaceRecoveryFocusForState(state: SciForgeWorkspaceState): WorkspaceRecoveryFocus | undefined {
  const candidate = Object.values(state.sessionsByScenario)
    .map(recoverableRunFocusForSession)
    .filter((focus): focus is WorkspaceRecoveryFocus => Boolean(focus))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .at(0);
  if (!candidate) return undefined;
  const newestHealthyActivity = Object.values(state.sessionsByScenario)
    .filter((session) => session.scenarioId !== candidate.scenarioId || session.sessionId !== candidate.sessionId)
    .filter((session) => sessionActivityScoreForRecoveryFocus(session) > 0 && !recoverableRunFocusForSession(session))
    .map((session) => Date.parse(session.updatedAt || session.createdAt || ''))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)
    .at(0);
  if (newestHealthyActivity !== undefined && newestHealthyActivity > Date.parse(candidate.updatedAt)) return undefined;
  return candidate;
}

function sessionActivityScoreForRecoveryFocus(session: SciForgeSession) {
  return session.messages.length
    + session.runs.length
    + session.artifacts.length
    + session.executionUnits.length
    + session.claims.length
    + session.uiManifest.length
    + session.notebook.length;
}

export function mergeRunTimelineEvents(
  events: TimelineEventRecord[],
  previousSession: SciForgeSession | undefined,
  nextSession: SciForgeSession,
): TimelineEventRecord[] {
  const previousRunIds = new Set(previousSession?.runs.map((run) => run.id) ?? []);
  const existingEventIds = new Set(events.map((event) => event.id));
  const previousRuns = new Map(previousSession?.runs.map((run) => [run.id, run]) ?? []);
  const newEvents = nextSession.runs
    .flatMap((run) => {
      if (!previousRunIds.has(run.id)) return [timelineEventFromStoredRun(nextSession, run)];
      const previousRun = previousRuns.get(run.id);
      if (!previousRun || previousRun.status === run.status && previousRun.completedAt === run.completedAt && previousRun.response === run.response) return [];
      return [timelineEventFromStoredRun(nextSession, run, `timeline-${run.id}-${run.status}`)];
    })
    .filter((event) => !existingEventIds.has(event.id));
  return [...newEvents, ...events].slice(0, TIMELINE_EVENT_LIMIT);
}

function timelineEventFromStoredRun(session: SciForgeSession, run: SciForgeRun, eventId = `timeline-${run.id}`): TimelineEventRecord {
  const runArtifactRefs = timelineArtifactRefsForRun(session, run).slice(0, 8);
  const runUnitRefs = timelineExecutionUnitRefsForRun(session, run).slice(0, 8);
  const promptSummary = run.prompt ? ` · ${run.prompt.slice(0, 100)}` : '';
  const failureSummary = run.status === 'failed' && run.response ? ` · ${run.response.slice(0, 120)}` : '';
  return {
    id: eventId,
    actor: 'SciForge Runtime',
    action: `run.${run.status}`,
    subject: `${session.scenarioId}:${run.id}${promptSummary}${failureSummary}`,
    artifactRefs: runArtifactRefs,
    executionUnitRefs: Array.from(new Set(runUnitRefs)),
    beliefRefs: session.claims.slice(0, 8).map((claim) => claim.id),
    branchId: session.scenarioId,
    visibility: 'project-record',
    decisionStatus: 'not-a-decision',
    createdAt: run.completedAt ?? run.createdAt ?? nowIso(),
  };
}

function timelineArtifactRefsForRun(session: SciForgeSession, run: SciForgeRun) {
  const scoped = artifactsForRun(session, run)
    .map((artifact) => artifact.id)
    .filter((value): value is string => Boolean(value));
  if (scoped.length) return uniqueTimelineRefs(scoped);

  const explicit = (run.objectReferences ?? [])
    .filter((reference) => reference.kind === 'artifact')
    .map((reference) => stripTimelineRefPrefix(reference.ref, 'artifact'));
  if (explicit.length) return uniqueTimelineRefs(explicit);

  if (session.runs.length === 1) {
    return uniqueTimelineRefs(session.artifacts.map((artifact) => artifact.id));
  }
  return [];
}

function timelineExecutionUnitRefsForRun(session: SciForgeSession, run: SciForgeRun) {
  const scoped = auditExecutionUnitsForRun(session, run)
    .map((unit) => unit.id)
    .filter((value): value is string => Boolean(value));
  if (scoped.length) return uniqueTimelineRefs(scoped);

  const embedded = executionUnitRefsFromRunPayload(run);
  if (embedded.length) return uniqueTimelineRefs(embedded);

  const packageId = run.scenarioPackageRef?.id;
  if (packageId) {
    const packageScoped = session.executionUnits
      .filter((unit) => unit.scenarioPackageRef?.id === packageId)
      .map((unit) => unit.id)
      .filter((value): value is string => Boolean(value));
    if (packageScoped.length) return uniqueTimelineRefs(packageScoped);
  }

  if (session.runs.length === 1) {
    return uniqueTimelineRefs(session.executionUnits.map((unit) => unit.id));
  }
  return [];
}

function executionUnitRefsFromRunPayload(run: SciForgeRun) {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const payload = isRecord(raw?.payload) ? raw.payload : undefined;
  const output = isRecord(raw?.output) ? raw.output : undefined;
  const data = isRecord(raw?.data) ? raw.data : undefined;
  const candidates = [
    raw,
    payload,
    output,
    data,
    isRecord(output?.payload) ? output.payload : undefined,
    isRecord(data?.payload) ? data.payload : undefined,
  ];
  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.executionUnits)) return [];
    return candidate.executionUnits
      .filter(isRecord)
      .map((unit) => typeof unit.id === 'string' ? unit.id : undefined)
      .filter((value): value is string => Boolean(value));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripTimelineRefPrefix(value: string, prefix: 'artifact' | 'execution-unit') {
  return value.replace(new RegExp(`^${prefix}::?`, 'i'), '');
}

function uniqueTimelineRefs(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function recoverableReasonForRun(session: SciForgeSession, run: SciForgeRun): { reason: WorkspaceRecoveryFocus['reason']; activeRunId?: string } | undefined {
  const projection = conversationProjectionForSession(session, run);
  const focusSignal = conversationProjectionRecoverFocusSignal(projection);
  if (focusSignal) return { reason: 'repair-needed-run', activeRunId: focusSignal.activeRunId };
  return undefined;
}

function runSupersedesOlderRecoverableFocus(session: SciForgeSession, run: SciForgeRun) {
  const projection = conversationProjectionForSession(session, run);
  if (!projection || conversationProjectionRecoverFocusSignal(projection)) return false;
  return conversationProjectionStatus(projection) === 'satisfied'
    || conversationProjectionStatus(projection) === 'validated';
}

function runForProjectedActiveRun(session: SciForgeSession, carrierRun: SciForgeRun, projectedActiveRunId: string | undefined): SciForgeRun {
  const normalizedId = projectedActiveRunId ? stripRunRefPrefix(projectedActiveRunId) : undefined;
  if (!normalizedId) return carrierRun;
  return session.runs.find((run) => run.id === projectedActiveRunId || run.id === normalizedId) ?? carrierRun;
}

function stripRunRefPrefix(value: string) {
  return value.replace(/^run::?/i, '');
}

function runActivityTime(run: SciForgeRun, session: SciForgeSession) {
  return run.completedAt ?? run.createdAt ?? session.updatedAt;
}

export function appendTimelineEventToWorkspace(
  state: SciForgeWorkspaceState,
  event: TimelineEventRecord,
): SciForgeWorkspaceState {
  return {
    ...state,
    timelineEvents: [event, ...(state.timelineEvents ?? [])].slice(0, TIMELINE_EVENT_LIMIT),
  };
}

export function createArtifactHandoffTransition(
  scenarios: ScenarioViewConfig[],
  targetScenario: ScenarioId,
  artifact: RuntimeArtifact,
  options: { now: string; notebookTime: string; requestId?: string },
): ArtifactHandoffTransition {
  const sourceScenario = scenarios.find((item) => item.id === artifact.producerScenario);
  const target = scenarios.find((item) => item.id === targetScenario);
  const labels = {
    sourceScenarioName: sourceScenario?.name ?? artifact.producerScenario,
    targetScenarioName: target?.name ?? targetScenario,
  };
  return {
    targetScenario,
    autoRunRequest: {
      id: options.requestId ?? makeId('handoff-run'),
      targetScenario,
      prompt: handoffAutoRunPrompt(targetScenario, artifact, labels.sourceScenarioName, labels.targetScenarioName),
    },
    apply: (state) => applyArtifactHandoffToWorkspace(state, targetScenario, artifact, labels, {
      now: options.now,
      notebookTime: options.notebookTime,
    }),
  };
}

export function createPreviewPackageAutoRunRequest(
  targetScenario: ScenarioInstanceId,
  prompt: string,
  requestId = makeId('preview-package-run'),
): HandoffAutoRunRequest {
  return { id: requestId, targetScenario, prompt };
}

import type { ScenarioId, ScenarioViewConfig } from '../../data';
import {
  makeId,
  nowIso,
  type RuntimeArtifact,
  type RuntimeExecutionUnit,
  type SciForgeRun,
  type SciForgeSession,
  type SciForgeWorkspaceState,
  type ScenarioInstanceId,
  type TimelineEventRecord,
} from '../../domain';
import { versionSession } from '../../sessionStore';
import { applyArtifactHandoffToWorkspace } from '../../workspace/artifactHandoff';
import { handoffAutoRunPrompt } from '../results/autoRunPrompts';
import { artifactsForRun, executionUnitsForRun } from '../results/executionUnitsForRun';
import type { HandoffAutoRunRequest } from '../results/viewPlanResolver';

const TIMELINE_EVENT_LIMIT = 200;
const RECOVERABLE_RUN_STATUSES = new Set(['failed']);
const RECOVERABLE_EXECUTION_UNIT_STATUSES = new Set(['failed', 'failed-with-reason', 'repair-needed', 'needs-human']);
const RECOVERABLE_TASK_CARD_STATUSES = new Set(['partial', 'needs-work', 'needs-human', 'failed', 'cancelled']);

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

export function touchWorkspaceUpdatedAt(state: SciForgeWorkspaceState, updatedAt: string): SciForgeWorkspaceState {
  return { ...state, updatedAt };
}

export function applySessionUpdateToWorkspace(
  state: SciForgeWorkspaceState,
  nextSession: SciForgeSession,
  reason = 'session update',
): SciForgeWorkspaceState {
  return {
    ...state,
    sessionsByScenario: {
      ...state.sessionsByScenario,
      [nextSession.scenarioId]: versionSession(nextSession, reason),
    },
    timelineEvents: mergeRunTimelineEvents(state.timelineEvents ?? [], state.sessionsByScenario[nextSession.scenarioId], nextSession),
  };
}

export function recoverableRunFocusForSession(session: SciForgeSession): WorkspaceRecoveryFocus | undefined {
  const candidate = [...session.runs]
    .reverse()
    .find((run) => recoverableReasonForRun(session, run));
  if (!candidate) return undefined;
  return {
    scenarioId: session.scenarioId,
    sessionId: session.sessionId,
    activeRunId: candidate.id,
    reason: recoverableReasonForRun(session, candidate) ?? 'failed-run',
    updatedAt: runActivityTime(candidate, session),
  };
}

export function workspaceRecoveryFocusForState(state: SciForgeWorkspaceState): WorkspaceRecoveryFocus | undefined {
  return Object.values(state.sessionsByScenario)
    .map(recoverableRunFocusForSession)
    .filter((focus): focus is WorkspaceRecoveryFocus => Boolean(focus))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .at(0);
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
  const runArtifactRefs = artifactsForRun(session, run)
    .slice(0, 8)
    .map((artifact) => artifact.id);
  const runUnitRefs = [
    ...executionUnitsForRun(session, run)
      .slice(0, 8)
      .map((unit) => unit.id),
  ].filter((value): value is string => Boolean(value));
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

function recoverableReasonForRun(session: SciForgeSession, run: SciForgeRun): WorkspaceRecoveryFocus['reason'] | undefined {
  if (RECOVERABLE_RUN_STATUSES.has(run.status)) return 'failed-run';
  if (executionUnitsForRun(session, run).some(isRecoverableExecutionUnit)) return 'repair-needed-run';
  if (run.acceptance?.severity === 'failed' || run.acceptance?.severity === 'repairable') return 'repair-needed-run';
  if (rawHasRecoverableTaskState(run.raw) || rawHasRecoverableTaskState(parseJsonObject(run.response))) return 'repair-needed-run';
  return undefined;
}

function isRecoverableExecutionUnit(unit: RuntimeExecutionUnit) {
  return RECOVERABLE_EXECUTION_UNIT_STATUSES.has(unit.status);
}

function rawHasRecoverableTaskState(value: unknown): boolean {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (!record) return false;
  const status = typeof record.status === 'string' ? record.status : undefined;
  if (status && RECOVERABLE_EXECUTION_UNIT_STATUSES.has(status)) return true;
  if (status && isTaskRunCardLike(record) && RECOVERABLE_TASK_CARD_STATUSES.has(status)) return true;
  const taskRunCard = record.taskRunCard && typeof record.taskRunCard === 'object' && !Array.isArray(record.taskRunCard)
    ? record.taskRunCard as Record<string, unknown>
    : undefined;
  if (typeof taskRunCard?.status === 'string' && RECOVERABLE_TASK_CARD_STATUSES.has(taskRunCard.status)) return true;
  const resultPresentation = record.resultPresentation && typeof record.resultPresentation === 'object' && !Array.isArray(record.resultPresentation)
    ? record.resultPresentation as Record<string, unknown>
    : undefined;
  const displayIntent = record.displayIntent && typeof record.displayIntent === 'object' && !Array.isArray(record.displayIntent)
    ? record.displayIntent as Record<string, unknown>
    : undefined;
  return rawHasRecoverableTaskState(record.repairState)
    || rawHasRecoverableTaskState(record.backendRepair)
    || rawHasRecoverableTaskState(record.acceptanceRepair)
    || rawHasRecoverableTaskState(record.backgroundCompletion)
    || rawHasRecoverableTaskState(resultPresentation?.taskRunCard)
    || rawHasRecoverableTaskState(displayIntent?.taskRunCard);
}

function isTaskRunCardLike(record: Record<string, unknown>) {
  return record.schemaVersion === 'sciforge.task-run-card.v1'
    || Array.isArray(record.executionUnitRefs)
    || typeof record.protocolStatus === 'string'
    || typeof record.taskOutcome === 'string';
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
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

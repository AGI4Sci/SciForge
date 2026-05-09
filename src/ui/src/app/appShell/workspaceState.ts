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
import { versionSession } from '../../sessionStore';
import { applyArtifactHandoffToWorkspace } from '../../workspace/artifactHandoff';
import { handoffAutoRunPrompt } from '../results/autoRunPrompts';
import type { HandoffAutoRunRequest } from '../results/viewPlanResolver';

const TIMELINE_EVENT_LIMIT = 200;

export interface ArtifactHandoffTransition {
  targetScenario: ScenarioId;
  autoRunRequest: HandoffAutoRunRequest;
  apply(state: SciForgeWorkspaceState): SciForgeWorkspaceState;
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
  const runArtifactRefs = session.artifacts
    .filter((artifact) => artifact.producerScenario === session.scenarioId)
    .slice(0, 8)
    .map((artifact) => artifact.id);
  const runUnitRefs = [
    ...session.executionUnits.slice(0, 8).map((unit) => unit.id),
    run.skillPlanRef,
    run.uiPlanRef,
    run.scenarioPackageRef ? `${run.scenarioPackageRef.id}@${run.scenarioPackageRef.version}` : undefined,
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

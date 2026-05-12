import { nowIso, type SciForgeRun, type SciForgeSession, type TimelineEventRecord } from '../../domain';
import { artifactsForRun, executionUnitsForRun } from '../results/executionUnitsForRun';

export function mergeRunTimelineEvents(events: TimelineEventRecord[], previousSession: SciForgeSession | undefined, nextSession: SciForgeSession) {
  const previousRunIds = new Set(previousSession?.runs.map((run) => run.id) ?? []);
  const existingEventIds = new Set(events.map((event) => event.id));
  const newEvents = nextSession.runs
    .filter((run) => !previousRunIds.has(run.id))
    .map((run) => timelineEventFromStoredRun(nextSession, run))
    .filter((event) => !existingEventIds.has(event.id));
  return [...newEvents, ...events].slice(0, 200);
}

function timelineEventFromStoredRun(session: SciForgeSession, run: SciForgeRun): TimelineEventRecord {
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
    id: `timeline-${run.id}`,
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

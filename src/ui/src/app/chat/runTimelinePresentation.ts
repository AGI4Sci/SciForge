import { nowIso, type SciForgeRun, type SciForgeSession, type TimelineEventRecord } from '../../domain';

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
  const runArtifactRefs = session.artifacts
    .filter((artifact) => artifact.producerScenario === session.scenarioId)
    .slice(0, 8)
    .map((artifact) => artifact.id);
  const runUnitRefs = [
    ...session.executionUnits
      .filter((unit) => executionUnitBelongsToRun(unit, run))
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

function executionUnitBelongsToRun(unit: SciForgeSession['executionUnits'][number], run: SciForgeRun) {
  if (unit.outputRef?.includes(run.id) || unit.stdoutRef?.includes(run.id) || unit.stderrRef?.includes(run.id) || unit.codeRef?.includes(run.id)) return true;
  const runPackageKey = run.scenarioPackageRef ? `${run.scenarioPackageRef.id}@${run.scenarioPackageRef.version}` : '';
  const unitPackageKey = unit.scenarioPackageRef ? `${unit.scenarioPackageRef.id}@${unit.scenarioPackageRef.version}` : '';
  if (runPackageKey && unitPackageKey === runPackageKey) return true;
  return !runPackageKey;
}

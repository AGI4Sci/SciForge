import { makeId, type ReusableTaskCandidateRecord, type SciForgeWorkspaceState, type ScenarioInstanceId, type TimelineEventRecord } from '../domain';

const REUSABLE_CANDIDATE_LIMIT = 80;
const TIMELINE_EVENT_LIMIT = 200;

export function markReusableRunInWorkspace(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
  runId: string,
  createdAt: string,
  timelineId = makeId('timeline'),
): SciForgeWorkspaceState {
  const session = state.sessionsByScenario[scenarioId];
  const run = session?.runs.find((item) => item.id === runId);
  if (!run) return state;

  const candidate: ReusableTaskCandidateRecord = {
    id: `reusable.${run.scenarioPackageRef?.id ?? scenarioId}.${run.id}`,
    runId: run.id,
    scenarioId,
    scenarioPackageRef: run.scenarioPackageRef,
    skillPlanRef: run.skillPlanRef,
    uiPlanRef: run.uiPlanRef,
    prompt: run.prompt,
    status: run.status,
    promotionState: 'candidate',
    createdAt,
  };

  return {
    ...state,
    reusableTaskCandidates: [
      candidate,
      ...(state.reusableTaskCandidates ?? []).filter((item) => item.id !== candidate.id),
    ].slice(0, REUSABLE_CANDIDATE_LIMIT),
    timelineEvents: [
      buildReusableRunTimelineEvent(candidate, scenarioId, timelineId),
      ...(state.timelineEvents ?? []),
    ].slice(0, TIMELINE_EVENT_LIMIT),
  };
}

function buildReusableRunTimelineEvent(
  candidate: ReusableTaskCandidateRecord,
  scenarioId: ScenarioInstanceId,
  timelineId: string,
): TimelineEventRecord {
  return {
    id: timelineId,
    actor: 'SciForge Library',
    action: 'package.reusable-candidate',
    subject: `${candidate.scenarioPackageRef?.id ?? scenarioId}:${candidate.runId}`,
    artifactRefs: [],
    executionUnitRefs: [candidate.runId, candidate.skillPlanRef, candidate.uiPlanRef].filter((value): value is string => Boolean(value)),
    beliefRefs: [],
    branchId: scenarioId,
    visibility: 'project-record',
    decisionStatus: 'not-a-decision',
    createdAt: candidate.createdAt,
  };
}

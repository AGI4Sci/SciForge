import type {
  TaskProject,
  TaskProjectPlan,
  TaskProjectSummaryForHandoff,
  TaskStage,
} from './task-project-contracts.js';
import { TASK_PROJECT_HANDOFF_SCHEMA_VERSION } from './task-project-contracts.js';
import { clipText } from './task-project-state.js';
import { fileRef, stageRef, taskProjectRelativePaths } from './task-project-store.js';

export function buildTaskProjectHandoffSummary(params: {
  project: TaskProject;
  plan: TaskProjectPlan;
  stages: TaskStage[];
  maxStages: number;
  maxTextChars: number;
  maxRefsPerStage: number;
}): TaskProjectSummaryForHandoff {
  const { project, plan, stages, maxStages, maxTextChars, maxRefsPerStage } = params;
  const selected = stages.slice(-maxStages);
  let truncated = selected.length < stages.length;
  const stageRefById = new Map(plan.stages.map((entry) => [entry.id, entry.ref]));
  const paths = taskProjectRelativePaths(project.id);

  const summaryStages: TaskProjectSummaryForHandoff['stages'] = selected.map((stage) => {
    const goal = clipText(stage.goal, maxTextChars);
    const failureReason = clipText(stage.failureReason, maxTextChars);
    const nextStep = clipText(stage.nextStep, maxTextChars);
    const evidenceRefs = stage.evidenceRefs.slice(0, maxRefsPerStage);
    const artifactRefs = stage.artifactRefs.slice(0, maxRefsPerStage);
    const recoverActions = stage.recoverActions.slice(0, 8).map((action) => clipText(action, maxTextChars).text ?? '');
    const diagnostics = (stage.diagnostics ?? []).slice(0, 8).map((diagnostic) => clipText(diagnostic, maxTextChars).text ?? '');
    const workEvidence = stage.workEvidence?.slice(0, 8) ?? [];
    truncated ||= goal.truncated || failureReason.truncated || nextStep.truncated
      || evidenceRefs.length < stage.evidenceRefs.length
      || artifactRefs.length < stage.artifactRefs.length
      || recoverActions.length < stage.recoverActions.length
      || diagnostics.length < (stage.diagnostics ?? []).length
      || workEvidence.length < (stage.workEvidence?.length ?? 0);
    return {
      id: stage.id,
      index: stage.index,
      kind: stage.kind,
      status: stage.status,
      goal: goal.text ?? '',
      codeRef: stage.codeRef,
      inputRef: stage.inputRef,
      outputRef: stage.outputRef,
      stdoutRef: stage.stdoutRef,
      stderrRef: stage.stderrRef,
      workEvidence,
      evidenceRefs,
      artifactRefs,
      failureReason: failureReason.text,
      diagnostics,
      recoverActions,
      nextStep: nextStep.text,
      ref: stageRefById.get(stage.id) ?? stageRef(project.id, stage.id),
    };
  });
  const projectGoal = clipText(project.goal, maxTextChars);
  truncated ||= projectGoal.truncated;

  return {
    schemaVersion: TASK_PROJECT_HANDOFF_SCHEMA_VERSION,
    project: {
      id: project.id,
      title: project.title,
      goal: projectGoal.text ?? '',
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    refs: {
      projectRef: fileRef(paths.projectJson),
      planRef: fileRef(paths.planJson),
      stageRefs: plan.stageRefs,
      latestStageRef: plan.stageRefs.at(-1),
      dirs: {
        src: fileRef(paths.src),
        artifacts: fileRef(paths.artifacts),
        evidence: fileRef(paths.evidence),
        logs: fileRef(paths.logs),
      },
    },
    stages: summaryStages,
    omittedStageCount: stages.length - selected.length,
    truncated,
  };
}

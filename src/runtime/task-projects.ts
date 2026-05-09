import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GatewayRequest, SkillAvailability, SkillPromotionProposal, ToolPayload, WorkspaceTaskRunResult, WorkspaceTaskSpec } from './runtime-types.js';
import {
  TASK_PROJECT_HANDOFF_SCHEMA_VERSION,
  TASK_PROJECT_PLAN_SCHEMA_VERSION,
  TASK_PROJECT_SCHEMA_VERSION,
  TASK_PROJECT_STAGE_HANDOFF_SCHEMA_VERSION,
  TASK_STAGE_SCHEMA_VERSION,
} from './task-project-contracts.js';
import type {
  AppendTaskProjectGuidanceInit,
  AppendTaskStageInit,
  CreateTaskProjectInit,
  ListRecentTaskProjectsFilters,
  ResolveTaskProjectGuidancePatch,
  StageEvidenceInput,
  TaskProject,
  TaskProjectContinuationSelection,
  TaskProjectGuidance,
  TaskProjectGuidanceStatus,
  TaskProjectNextStageHandoffSummary,
  TaskProjectPaths,
  TaskProjectPlan,
  TaskProjectPlanStage,
  TaskProjectReadResult,
  TaskProjectStagePromotionOptions,
  TaskProjectStageRunOptions,
  TaskProjectStageRunResult,
  TaskProjectStatus,
  TaskProjectSummaryForHandoff,
  TaskStage,
  TaskStageKind,
  TaskStageStatus,
  UpdateTaskStagePatch,
} from './task-project-contracts.js';
import { isRecord, errorMessage } from './gateway-utils.js';
import { runWorkspaceTask } from './workspace-task-runner.js';
import { evaluateToolPayloadEvidence } from './gateway/work-evidence-guard.js';
import { collectWorkEvidence, parseWorkEvidence, type WorkEvidence } from './gateway/work-evidence-types.js';
import { maybeWriteSkillPromotionProposal } from './skill-promotion.js';
import { buildTaskProjectHandoffSummary } from './task-project-handoff.js';
import {
  assertWorkspaceRelative,
  fileRef,
  normalizeOptionalRef,
  normalizeRef,
  normalizeWorkspace,
  readJson,
  resolveWorkspacePath,
  stageEvidenceRef,
  stageRef,
  stripFileRef,
  taskProjectRelativePaths,
  writeJson,
} from './task-project-store.js';
import {
  clipText,
  findPlanStage,
  nextStageIndex,
  normalizeGuidanceId,
  normalizeProjectId,
  normalizeStageKind,
  safeToken,
  stableAppend,
  stableGuidanceQueue,
  stableRefList,
  stableStringList,
  stableWorkEvidence,
  syncProject,
} from './task-project-state.js';

export {
  TASK_PROJECT_HANDOFF_SCHEMA_VERSION,
  TASK_PROJECT_PLAN_SCHEMA_VERSION,
  TASK_PROJECT_SCHEMA_VERSION,
  TASK_PROJECT_STAGE_HANDOFF_SCHEMA_VERSION,
  TASK_STAGE_SCHEMA_VERSION,
} from './task-project-contracts.js';
export { taskProjectPathExists } from './task-project-store.js';
export type {
  AppendTaskProjectGuidanceInit,
  AppendTaskStageInit,
  CreateTaskProjectInit,
  ListRecentTaskProjectsFilters,
  ResolveTaskProjectGuidancePatch,
  StageEvidenceInput,
  TaskProject,
  TaskProjectContinuationSelection,
  TaskProjectGuidance,
  TaskProjectGuidanceStatus,
  TaskProjectNextStageHandoffSummary,
  TaskProjectPaths,
  TaskProjectPlan,
  TaskProjectPlanStage,
  TaskProjectReadResult,
  TaskProjectStagePromotionOptions,
  TaskProjectStageRunOptions,
  TaskProjectStageRunResult,
  TaskProjectStatus,
  TaskProjectSummaryForHandoff,
  TaskStage,
  TaskStageKind,
  TaskStageStatus,
  UpdateTaskStagePatch,
} from './task-project-contracts.js';

export async function createTaskProject(workspace: string, init: CreateTaskProjectInit): Promise<TaskProjectReadResult> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const id = normalizeProjectId(init.id);
  const now = init.createdAt ?? new Date().toISOString();
  const paths = taskProjectRelativePaths(id);

  await assertWorkspaceRelative(workspaceRoot, paths.root);
  for (const dir of [paths.root, paths.stages, paths.src, paths.artifacts, paths.evidence, paths.logs]) {
    await mkdir(resolveWorkspacePath(workspaceRoot, dir), { recursive: true });
  }

  const project: TaskProject = {
    schemaVersion: TASK_PROJECT_SCHEMA_VERSION,
    id,
    title: init.title ?? id,
    goal: init.goal,
    status: init.status ?? 'planned',
    createdAt: now,
    updatedAt: now,
    paths,
    stageRefs: [],
    guidanceQueue: [],
    metadata: init.metadata,
  };
  const plan: TaskProjectPlan = {
    schemaVersion: TASK_PROJECT_PLAN_SCHEMA_VERSION,
    projectId: id,
    stageRefs: [],
    stages: [],
    updatedAt: now,
  };

  await writeJson(resolveWorkspacePath(workspaceRoot, paths.projectJson), project);
  await writeJson(resolveWorkspacePath(workspaceRoot, paths.planJson), plan);
  return { project, plan, stages: [] };
}

export async function readTaskProject(workspace: string, projectId: string): Promise<TaskProjectReadResult> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const id = normalizeProjectId(projectId);
  const paths = taskProjectRelativePaths(id);
  const project = await readJson<TaskProject>(resolveWorkspacePath(workspaceRoot, paths.projectJson));
  const plan = await readJson<TaskProjectPlan>(resolveWorkspacePath(workspaceRoot, paths.planJson));
  const stages = await Promise.all(plan.stages.map((entry) => readJson<TaskStage>(resolveWorkspacePath(workspaceRoot, stripFileRef(entry.ref)))));
  return { project, plan, stages };
}

export async function appendTaskProjectGuidance(
  workspace: string,
  projectId: string,
  init: AppendTaskProjectGuidanceInit,
): Promise<TaskProjectReadResult & { guidance: TaskProjectGuidance }> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const id = normalizeProjectId(projectId);
  const paths = taskProjectRelativePaths(id);
  const project = await readJson<TaskProject>(resolveWorkspacePath(workspaceRoot, paths.projectJson));
  const message = init.message.trim();
  if (!message) throw new Error('Task project guidance message cannot be empty.');
  const queue = stableGuidanceQueue(project.guidanceQueue);
  const now = init.createdAt ?? new Date().toISOString();
  const guidance: TaskProjectGuidance = {
    id: init.id ? normalizeGuidanceId(init.id) : `${queue.length + 1}-${safeToken(now)}`,
    message,
    status: 'queued',
    source: init.source?.trim() || undefined,
    stageId: init.stageId?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    metadata: init.metadata,
  };
  project.guidanceQueue = [...queue.filter((entry) => entry.id !== guidance.id), guidance];
  project.updatedAt = now;
  await writeJson(resolveWorkspacePath(workspaceRoot, paths.projectJson), project);
  const read = await readTaskProject(workspaceRoot, id);
  return { ...read, guidance };
}

export async function resolveTaskProjectGuidance(
  workspace: string,
  projectId: string,
  guidanceId: string,
  patch: ResolveTaskProjectGuidancePatch,
): Promise<TaskProjectReadResult & { guidance: TaskProjectGuidance }> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const id = normalizeProjectId(projectId);
  const paths = taskProjectRelativePaths(id);
  const project = await readJson<TaskProject>(resolveWorkspacePath(workspaceRoot, paths.projectJson));
  const targetId = normalizeGuidanceId(guidanceId);
  const queue = stableGuidanceQueue(project.guidanceQueue);
  const current = queue.find((entry) => entry.id === targetId);
  if (!current) throw new Error(`Task project guidance not found: ${guidanceId}`);
  const now = patch.updatedAt ?? new Date().toISOString();
  const guidance: TaskProjectGuidance = {
    ...current,
    status: patch.status,
    decision: patch.decision?.trim() || current.decision,
    reason: patch.reason?.trim() || current.reason,
    updatedAt: now,
    metadata: patch.metadata ? { ...(current.metadata ?? {}), ...patch.metadata } : current.metadata,
  };
  project.guidanceQueue = queue.map((entry) => entry.id === targetId ? guidance : entry);
  project.updatedAt = now;
  await writeJson(resolveWorkspacePath(workspaceRoot, paths.projectJson), project);
  const read = await readTaskProject(workspaceRoot, id);
  return { ...read, guidance };
}

export async function appendTaskStage(workspace: string, projectId: string, stage: AppendTaskStageInit): Promise<TaskProjectReadResult & { stage: TaskStage }> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const id = normalizeProjectId(projectId);
  const kind = normalizeStageKind(stage.kind);
  const paths = taskProjectRelativePaths(id);
  const project = await readJson<TaskProject>(resolveWorkspacePath(workspaceRoot, paths.projectJson));
  const plan = await readJson<TaskProjectPlan>(resolveWorkspacePath(workspaceRoot, paths.planJson));
  const index = nextStageIndex(plan);
  const stageId = `${index}-${kind}`;
  const now = stage.createdAt ?? new Date().toISOString();
  const status = stage.status ?? 'planned';
  const ref = stageRef(id, stageId);
  const next: TaskStage = {
    schemaVersion: TASK_STAGE_SCHEMA_VERSION,
    id: stageId,
    projectId: id,
    index,
    kind,
    status,
    goal: stage.goal,
    codeRef: normalizeOptionalRef(workspaceRoot, stage.codeRef),
    inputRef: normalizeOptionalRef(workspaceRoot, stage.inputRef),
    outputRef: normalizeOptionalRef(workspaceRoot, stage.outputRef),
    stdoutRef: normalizeOptionalRef(workspaceRoot, stage.stdoutRef),
    stderrRef: normalizeOptionalRef(workspaceRoot, stage.stderrRef),
    workEvidence: stableWorkEvidence(stage.workEvidence),
    evidenceRefs: stableRefList(workspaceRoot, stage.evidenceRefs),
    artifactRefs: stableRefList(workspaceRoot, stage.artifactRefs),
    failureReason: stage.failureReason,
    diagnostics: stableStringList(stage.diagnostics),
    recoverActions: stableStringList(stage.recoverActions),
    nextStep: stage.nextStep,
    createdAt: now,
    updatedAt: now,
    startedAt: status === 'running' ? now : undefined,
    completedAt: status === 'done' ? now : undefined,
    failedAt: status === 'failed' ? now : undefined,
    metadata: stage.metadata,
  };

  await writeJson(resolveWorkspacePath(workspaceRoot, stripFileRef(ref)), next);
  plan.stageRefs = stableAppend(plan.stageRefs, ref);
  plan.stages = [...plan.stages, { id: next.id, index: next.index, kind: next.kind, status: next.status, goal: next.goal, ref }];
  plan.updatedAt = now;
  syncProject(project, plan, now);
  await writeJson(resolveWorkspacePath(workspaceRoot, paths.planJson), plan);
  await writeJson(resolveWorkspacePath(workspaceRoot, paths.projectJson), project);

  const read = await readTaskProject(workspaceRoot, id);
  return { ...read, stage: next };
}

export async function updateTaskStage(workspace: string, projectId: string, stageId: string | number, patch: UpdateTaskStagePatch): Promise<TaskProjectReadResult & { stage: TaskStage }> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const id = normalizeProjectId(projectId);
  const paths = taskProjectRelativePaths(id);
  const project = await readJson<TaskProject>(resolveWorkspacePath(workspaceRoot, paths.projectJson));
  const plan = await readJson<TaskProjectPlan>(resolveWorkspacePath(workspaceRoot, paths.planJson));
  const planStage = findPlanStage(plan, stageId);
  const stagePath = resolveWorkspacePath(workspaceRoot, stripFileRef(planStage.ref));
  const current = await readJson<TaskStage>(stagePath);
  const now = patch.updatedAt ?? new Date().toISOString();
  const status = patch.status ?? current.status;
  const next: TaskStage = {
    ...current,
    ...patch,
    id: current.id,
    projectId: current.projectId,
    index: current.index,
    kind: current.kind,
    status,
    codeRef: normalizeOptionalRef(workspaceRoot, patch.codeRef ?? current.codeRef),
    inputRef: normalizeOptionalRef(workspaceRoot, patch.inputRef ?? current.inputRef),
    outputRef: normalizeOptionalRef(workspaceRoot, patch.outputRef ?? current.outputRef),
    stdoutRef: normalizeOptionalRef(workspaceRoot, patch.stdoutRef ?? current.stdoutRef),
    stderrRef: normalizeOptionalRef(workspaceRoot, patch.stderrRef ?? current.stderrRef),
    workEvidence: patch.workEvidence ? stableWorkEvidence(patch.workEvidence) : current.workEvidence,
    evidenceRefs: patch.evidenceRefs ? stableRefList(workspaceRoot, patch.evidenceRefs) : current.evidenceRefs,
    artifactRefs: patch.artifactRefs ? stableRefList(workspaceRoot, patch.artifactRefs) : current.artifactRefs,
    diagnostics: patch.diagnostics ? stableStringList(patch.diagnostics) : current.diagnostics,
    recoverActions: patch.recoverActions ? stableStringList(patch.recoverActions) : current.recoverActions,
    updatedAt: now,
    startedAt: status === 'running' && !current.startedAt ? now : current.startedAt,
    completedAt: status === 'done' ? now : current.completedAt,
    failedAt: status === 'failed' ? now : current.failedAt,
  };

  await writeJson(stagePath, next);
  plan.stages = plan.stages.map((entry) => entry.id === current.id ? { ...entry, status: next.status, goal: next.goal } : entry);
  plan.updatedAt = now;
  syncProject(project, plan, now);
  await writeJson(resolveWorkspacePath(workspaceRoot, paths.planJson), plan);
  await writeJson(resolveWorkspacePath(workspaceRoot, paths.projectJson), project);

  const read = await readTaskProject(workspaceRoot, id);
  return { ...read, stage: next };
}

export async function recordStageEvidence(workspace: string, projectId: string, stageId: string | number, evidence: StageEvidenceInput): Promise<TaskProjectReadResult & { stage: TaskStage; evidenceRef: string }> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const id = normalizeProjectId(projectId);
  const paths = taskProjectRelativePaths(id);
  const plan = await readJson<TaskProjectPlan>(resolveWorkspacePath(workspaceRoot, paths.planJson));
  const planStage = findPlanStage(plan, stageId);
  const now = typeof evidence === 'string' ? new Date().toISOString() : evidence.createdAt ?? new Date().toISOString();
  const evidenceRef = typeof evidence === 'string'
    ? normalizeRef(workspaceRoot, evidence)
    : evidence.ref
      ? normalizeRef(workspaceRoot, evidence.ref)
      : stageEvidenceRef(id, planStage.id, evidence.id ?? now);

  if (typeof evidence !== 'string' && !evidence.ref) {
    await writeJson(resolveWorkspacePath(workspaceRoot, stripFileRef(evidenceRef)), {
      schemaVersion: 'sciforge.task-stage-evidence.v1',
      id: safeToken(evidence.id ?? now),
      projectId: id,
      stageId: planStage.id,
      kind: evidence.kind,
      title: evidence.title,
      summary: evidence.summary,
      data: evidence.data,
      metadata: evidence.metadata,
      createdAt: now,
    });
  }

  const current = await readJson<TaskStage>(resolveWorkspacePath(workspaceRoot, stripFileRef(planStage.ref)));
  const updated = await updateTaskStage(workspaceRoot, id, current.id, {
    evidenceRefs: stableAppend(current.evidenceRefs, evidenceRef),
    updatedAt: now,
  });
  return { ...updated, evidenceRef };
}

export async function runTaskProjectStage(
  workspace: string,
  projectId: string,
  stageId: string | number,
  options: TaskProjectStageRunOptions = {},
): Promise<TaskProjectStageRunResult> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const { project, plan } = await readTaskProject(workspaceRoot, projectId);
  const planStage = findPlanStage(plan, stageId);
  const stage = await readJson<TaskStage>(resolveWorkspacePath(workspaceRoot, stripFileRef(planStage.ref)));
  if (!stage.codeRef) throw new Error(`Task stage ${stage.id} has no codeRef.`);

  const now = options.now ?? (() => new Date().toISOString());
  await updateTaskStage(workspaceRoot, project.id, stage.id, {
    status: 'running',
    failureReason: undefined,
    updatedAt: now(),
  });

  const spec = await workspaceTaskSpecForStage(workspaceRoot, project, stage);
  const runner = options.runner ?? runWorkspaceTask;
  const run = await runner(workspaceRoot, spec);
  let output: ToolPayload | WorkEvidence | undefined;
  let outputKind: TaskProjectStageRunResult['outputKind'];
  let failureReason = run.exitCode !== 0 ? `Stage task exited with code ${run.exitCode}.` : undefined;
  const evidenceRefs: string[] = [];
  const artifactRefs: string[] = [];
  const workEvidence: WorkEvidence[] = [];
  const diagnostics: string[] = [];
  let nextStep: string | undefined;

  try {
    const parsed = await parseStageOutput(workspaceRoot, run.outputRef);
    output = parsed.output;
    outputKind = parsed.outputKind;
    evidenceRefs.push(...parsed.evidenceRefs);
    artifactRefs.push(...parsed.artifactRefs);
    workEvidence.push(...parsed.workEvidence);
    diagnostics.push(...parsed.diagnostics);
    failureReason ??= parsed.failureReason;
    nextStep = parsed.nextStep;

    if (parsed.outputKind === 'tool-payload') {
      const finding = evaluateToolPayloadEvidence(parsed.output, gatewayRequestForStage(workspaceRoot, project, stage, options.request));
      if (finding) {
        failureReason ??= `Evidence guard failed: ${finding.reason}`;
        nextStep ??= 'Create a focused repair stage that records the missing evidence or a failed-with-reason payload.';
        diagnostics.push(finding.reason);
      }
    }
  } catch (error) {
    failureReason ??= `Stage output parse failed: ${errorMessage(error)}`;
    nextStep ??= 'Create a repair stage that reruns the task and writes valid ToolPayload or WorkEvidence JSON.';
    diagnostics.push(failureReason);
  }

  const status: TaskStageStatus = failureReason ? 'failed' : 'done';
  const evidenceRecord = await recordStageEvidence(workspaceRoot, project.id, stage.id, {
    id: `${stage.id}-run`,
    kind: outputKind ?? 'stage-run',
    title: `Stage ${stage.id} run`,
    summary: failureReason ?? outputSummary(output),
    data: {
      exitCode: run.exitCode,
      outputKind,
      outputRef: fileRef(run.outputRef),
      stdoutRef: fileRef(run.stdoutRef),
      stderrRef: fileRef(run.stderrRef),
      failureReason,
      diagnostics,
      workEvidence,
    },
    createdAt: now(),
  });
  evidenceRefs.push(evidenceRecord.evidenceRef);

  const updated = await updateTaskStage(workspaceRoot, project.id, stage.id, {
    status,
    outputRef: fileRef(run.outputRef),
    stdoutRef: fileRef(run.stdoutRef),
    stderrRef: fileRef(run.stderrRef),
    workEvidence: stableWorkEvidence([...(stage.workEvidence ?? []), ...workEvidence]),
    evidenceRefs: stableStringList([...stage.evidenceRefs, ...evidenceRefs]),
    artifactRefs: stableStringList([...stage.artifactRefs, ...artifactRefs]),
    failureReason,
    diagnostics: stableStringList([...stage.diagnostics, ...diagnostics]),
    recoverActions: failureReason ? stableStringList([...stage.recoverActions, nextStep ?? 'Inspect stdout/stderr and repair the task output.']) : stage.recoverActions,
    nextStep,
    updatedAt: now(),
  });

  return {
    project: updated.project,
    plan: updated.plan,
    stage: updated.stage,
    run,
    output,
    outputKind,
    failureReason,
  };
}

export async function prepareNextStageHandoffSummary(
  workspace: string,
  projectId: string,
  stageId: string | number,
  budget: {
    maxTextChars?: number;
    maxEvidenceRefs?: number;
    maxEvidenceSummaries?: number;
    maxWorkEvidenceItems?: number;
    maxGuidanceItems?: number;
  } = {},
): Promise<TaskProjectNextStageHandoffSummary> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const maxTextChars = budget.maxTextChars ?? 600;
  const maxEvidenceRefs = budget.maxEvidenceRefs ?? 12;
  const maxEvidenceSummaries = budget.maxEvidenceSummaries ?? 6;
  const maxWorkEvidenceItems = budget.maxWorkEvidenceItems ?? 6;
  const maxGuidanceItems = budget.maxGuidanceItems ?? 8;
  const { project, plan } = await readTaskProject(workspaceRoot, projectId);
  const planStage = findPlanStage(plan, stageId);
  const stage = await readJson<TaskStage>(resolveWorkspacePath(workspaceRoot, stripFileRef(planStage.ref)));
  let truncated = false;
  const goal = clipText(stage.goal, maxTextChars);
  const failureReason = clipText(stage.failureReason, maxTextChars);
  const nextStep = clipText(stage.nextStep, maxTextChars);
  const outputSummaryText = clipText(await stageOutputSummaryFromRef(workspaceRoot, stage.outputRef), maxTextChars);
  const evidenceRefs = stage.evidenceRefs.slice(0, maxEvidenceRefs);
  const artifactRefs = stage.artifactRefs.slice(0, maxEvidenceRefs);
  const evidenceSummaries = await Promise.all(evidenceRefs.slice(0, maxEvidenceSummaries).map(async (ref) => {
    const summary = clipText(await evidenceSummaryFromRef(workspaceRoot, ref), maxTextChars);
    truncated ||= summary.truncated;
    return summary.text;
  }));
  truncated ||= goal.truncated || failureReason.truncated || nextStep.truncated || outputSummaryText.truncated
    || evidenceRefs.length < stage.evidenceRefs.length
    || artifactRefs.length < stage.artifactRefs.length
    || evidenceSummaries.length < evidenceRefs.length;
  const diagnostics = stage.diagnostics.slice(0, maxEvidenceSummaries).map((entry) => {
    const clipped = clipText(entry, maxTextChars);
    truncated ||= clipped.truncated;
    return clipped.text ?? '';
  }).filter(Boolean);
  const recoverActions = stage.recoverActions.slice(0, maxEvidenceSummaries).map((entry) => {
    const clipped = clipText(entry, maxTextChars);
    truncated ||= clipped.truncated;
    return clipped.text ?? '';
  }).filter(Boolean);
  truncated ||= diagnostics.length < stage.diagnostics.length || recoverActions.length < stage.recoverActions.length;
  const workEvidenceSummary = (stage.workEvidence ?? []).slice(-maxWorkEvidenceItems).map((evidence) => {
    const outputSummary = clipText(evidence.outputSummary, maxTextChars);
    const evidenceFailureReason = clipText(evidence.failureReason, maxTextChars);
    const evidenceNextStep = clipText(evidence.nextStep, maxTextChars);
    const evidenceDiagnostics = (evidence.diagnostics ?? []).slice(0, maxEvidenceSummaries).map((entry) => {
      const clipped = clipText(entry, maxTextChars);
      truncated ||= clipped.truncated;
      return clipped.text ?? '';
    }).filter(Boolean);
    truncated ||= outputSummary.truncated || evidenceFailureReason.truncated || evidenceNextStep.truncated
      || evidence.evidenceRefs.length > maxEvidenceRefs
      || evidence.recoverActions.length > maxEvidenceSummaries
      || (evidence.diagnostics?.length ?? 0) > maxEvidenceSummaries;
    return {
      kind: evidence.kind,
      status: evidence.status,
      provider: evidence.provider,
      resultCount: evidence.resultCount,
      outputSummary: outputSummary.text,
      failureReason: evidenceFailureReason.text,
      nextStep: evidenceNextStep.text,
      evidenceRefs: evidence.evidenceRefs.slice(0, maxEvidenceRefs),
      recoverActions: evidence.recoverActions.slice(0, maxEvidenceSummaries),
      diagnostics: evidenceDiagnostics,
      rawRef: evidence.rawRef,
    };
  });
  truncated ||= workEvidenceSummary.length < (stage.workEvidence?.length ?? 0);
  const activeGuidance = stableGuidanceQueue(project.guidanceQueue)
    .filter((entry) => entry.status === 'queued' || entry.status === 'deferred');
  const selectedGuidance = activeGuidance.slice(-maxGuidanceItems);
  truncated ||= selectedGuidance.length < activeGuidance.length;
  const userGuidanceQueue = selectedGuidance.map((entry) => {
    const message = clipText(entry.message, maxTextChars);
    const reason = clipText(entry.reason, maxTextChars);
    const decision = clipText(entry.decision, maxTextChars);
    truncated ||= message.truncated || reason.truncated || decision.truncated;
    return {
      id: entry.id,
      status: entry.status,
      message: message.text ?? '',
      source: entry.source,
      stageId: entry.stageId,
      decision: decision.text,
      reason: reason.text,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  });

  return {
    schemaVersion: TASK_PROJECT_STAGE_HANDOFF_SCHEMA_VERSION,
    project: {
      id: project.id,
      title: project.title,
      goal: clipText(project.goal, maxTextChars).text ?? '',
      status: project.status,
      updatedAt: project.updatedAt,
    },
    stage: {
      id: stage.id,
      index: stage.index,
      kind: stage.kind,
      status: stage.status,
      goal: goal.text ?? '',
      outputRef: stage.outputRef,
      stdoutRef: stage.stdoutRef,
      stderrRef: stage.stderrRef,
      failureReason: failureReason.text,
      nextStep: nextStep.text,
    },
    stageResult: {
      status: stage.status,
      outputKind: await stageOutputKindFromRef(workspaceRoot, stage.outputRef),
      outputSummary: outputSummaryText.text,
      exitCode: await stageExitCodeFromEvidence(workspaceRoot, stage.evidenceRefs),
    },
    evidenceSummary: {
      refs: evidenceRefs,
      summaries: evidenceSummaries.filter((entry): entry is string => Boolean(entry)),
    },
    workEvidenceSummary,
    artifactRefs,
    diagnostics,
    recoverActions,
    failureReason: failureReason.text,
    nextStep: nextStep.text ?? (stage.status === 'done' ? 'Proceed to the next planned stage.' : 'Create a repair stage before continuing.'),
    userGuidanceDecisionContract: {
      requiredStatuses: ['adopted', 'deferred', 'rejected'],
      outputFieldHint: 'For every userGuidanceQueue entry, the next stage plan/result must record guidanceDecisions[{id,status,reason}] using adopted, deferred, or rejected.',
    },
    userGuidanceQueue,
    truncated,
  };
}

export async function selectTaskProjectContinuationStage(
  workspace: string,
  projectId: string,
): Promise<TaskProjectContinuationSelection> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const read = await readTaskProject(workspaceRoot, projectId);
  const stageRefById = new Map(read.plan.stages.map((entry) => [entry.id, entry.ref]));
  const reversed = read.stages.slice().reverse();
  const failed = reversed.find((stage) => stage.status === 'failed');
  const repairNeeded = reversed.find((stage) => stage.status === 'repair-needed');
  const blocked = reversed.find((stage) => stage.status === 'blocked');
  const incomplete = reversed.find((stage) => stage.status === 'running' || stage.status === 'planned');
  const completed = reversed.find((stage) => stage.status === 'done' || stage.status === 'skipped');
  const selected = failed ?? repairNeeded ?? blocked ?? incomplete ?? completed;
  if (!selected) throw new Error(`Task project has no stages to continue: ${projectId}`);
  const reason: TaskProjectContinuationSelection['reason'] = failed === selected
    ? 'latest-failed-stage'
    : repairNeeded === selected
      ? 'latest-repair-needed-stage'
      : blocked === selected
        ? 'latest-blocked-stage'
        : incomplete === selected
          ? 'latest-incomplete-stage'
          : 'latest-completed-stage';
  return {
    ...read,
    stage: selected,
    stageRef: stageRefById.get(selected.id) ?? stageRef(read.project.id, selected.id),
    reason,
    shouldRepair: reason === 'latest-failed-stage' || reason === 'latest-repair-needed-stage' || reason === 'latest-blocked-stage',
    activeGuidance: stableGuidanceQueue(read.project.guidanceQueue)
      .filter((entry) => entry.status === 'queued' || entry.status === 'deferred'),
  };
}

export async function maybePromoteTaskProjectStageAdapter(
  workspace: string,
  projectId: string,
  stageId: string | number,
  options: TaskProjectStagePromotionOptions = {},
): Promise<SkillPromotionProposal | undefined> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const { project, plan } = await readTaskProject(workspaceRoot, projectId);
  const planStage = findPlanStage(plan, stageId);
  const stage = await readJson<TaskStage>(resolveWorkspacePath(workspaceRoot, stripFileRef(planStage.ref)));
  if (stage.status !== 'done' || stage.failureReason || !stage.codeRef || !stage.outputRef) return undefined;
  const minSuccessfulRuns = Math.max(1, options.minSuccessfulRuns ?? 1);
  const successfulRuns = stage.evidenceRefs.filter((ref) => /-run\.json$/i.test(ref)).length;
  if (successfulRuns < minSuccessfulRuns) return undefined;
  const parsed = await parseStageOutput(workspaceRoot, stripFileRef(stage.outputRef)).catch(() => undefined);
  if (!parsed || parsed.outputKind !== 'tool-payload') return undefined;
  const payloadFailureReason = toolPayloadFailureReason(parsed.output);
  if (payloadFailureReason) return undefined;
  const request: GatewayRequest = {
    skillDomain: options.request?.skillDomain ?? 'knowledge',
    prompt: options.request?.prompt ?? `${project.goal}\n\nPromote stable stage adapter ${stage.id}: ${stage.goal}`,
    workspacePath: options.request?.workspacePath ?? workspaceRoot,
    artifacts: options.request?.artifacts ?? [],
    ...options.request,
  };
  const skill = options.skill ?? defaultTaskProjectStageAdapterSkill(request.skillDomain);
  return maybeWriteSkillPromotionProposal({
    workspacePath: workspaceRoot,
    request,
    skill,
    taskId: options.taskId ?? `${project.id}-${stage.id}`,
    taskRel: stripFileRef(stage.codeRef),
    inputRef: stage.inputRef ? stripFileRef(stage.inputRef) : undefined,
    outputRef: stripFileRef(stage.outputRef),
    stdoutRef: stage.stdoutRef ? stripFileRef(stage.stdoutRef) : undefined,
    stderrRef: stage.stderrRef ? stripFileRef(stage.stderrRef) : undefined,
    payload: parsed.output,
    patchSummary: options.patchSummary ?? `Promote stable TaskProject stage adapter ${project.id}/${stage.id}.`,
  });
}

export async function summarizeTaskProjectForHandoff(workspace: string, projectId: string, budget: {
  maxStages?: number;
  maxTextChars?: number;
  maxRefsPerStage?: number;
} = {}): Promise<TaskProjectSummaryForHandoff> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const id = normalizeProjectId(projectId);
  const maxStages = budget.maxStages ?? 8;
  const maxTextChars = budget.maxTextChars ?? 600;
  const maxRefsPerStage = budget.maxRefsPerStage ?? 12;
  const { project, plan, stages } = await readTaskProject(workspaceRoot, id);
  return buildTaskProjectHandoffSummary({ project, plan, stages, maxStages, maxTextChars, maxRefsPerStage });
}

export async function listRecentTaskProjects(workspace: string, filters: ListRecentTaskProjectsFilters = {}): Promise<TaskProject[]> {
  const workspaceRoot = normalizeWorkspace(workspace);
  const root = resolveWorkspacePath(workspaceRoot, join('.sciforge', 'projects'));
  const statusFilter = Array.isArray(filters.status) ? new Set(filters.status) : filters.status ? new Set([filters.status]) : undefined;
  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const projects = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try {
      const projectId = normalizeProjectId(entry.name);
      return await readJson<TaskProject>(resolveWorkspacePath(workspaceRoot, taskProjectRelativePaths(projectId).projectJson));
    } catch {
      return undefined;
    }
  }));
  return projects
    .filter((project): project is TaskProject => project !== undefined && (!statusFilter || statusFilter.has(project.status)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.max(0, filters.limit ?? 20));
}

async function workspaceTaskSpecForStage(workspaceRoot: string, project: TaskProject, stage: TaskStage): Promise<WorkspaceTaskSpec> {
  const codeRel = stripFileRef(requiredStageRef(stage.codeRef, 'codeRef'));
  const input = await readStageInput(workspaceRoot, stage.inputRef);
  const safeStageId = safeToken(stage.id);
  return {
    id: `${project.id}-${safeStageId}`,
    language: languageForCodeRef(codeRel),
    entrypoint: codeRel,
    taskRel: codeRel,
    input,
    outputRel: stripFileRef(stage.outputRef ?? fileRef(join(project.paths.evidence, `${safeStageId}-output.json`))),
    stdoutRel: stripFileRef(stage.stdoutRef ?? fileRef(join(project.paths.logs, `${safeStageId}.stdout.log`))),
    stderrRel: stripFileRef(stage.stderrRef ?? fileRef(join(project.paths.logs, `${safeStageId}.stderr.log`))),
    retentionProtectedInputRels: stage.inputRef ? [stripFileRef(stage.inputRef)] : undefined,
  };
}

async function readStageInput(workspaceRoot: string, inputRef: string | undefined): Promise<Record<string, unknown>> {
  if (!inputRef) return {};
  const rel = stripFileRef(inputRef);
  const text = await readFile(resolveWorkspacePath(workspaceRoot, rel), 'utf8');
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return { inputRef, text };
  }
}

async function parseStageOutput(workspaceRoot: string, outputRel: string) {
  const outputRef = fileRef(outputRel);
  const text = await readFile(resolveWorkspacePath(workspaceRoot, outputRel), 'utf8');
  const value = JSON.parse(text) as unknown;
  const evidence = parseWorkEvidence(value);
  if (evidence.ok && evidence.value) {
    return {
      output: evidence.value,
      outputKind: 'work-evidence' as const,
      evidenceRefs: stableStringList([outputRef, ...evidence.value.evidenceRefs, evidence.value.rawRef].filter((entry): entry is string => Boolean(entry))),
      artifactRefs: [],
      workEvidence: [evidence.value],
      diagnostics: stableStringList(evidence.value.diagnostics),
      failureReason: workEvidenceFailureReason(evidence.value),
      nextStep: evidence.value.nextStep ?? evidence.value.recoverActions[0],
    };
  }
  if (isToolPayload(value)) {
    const workEvidence = collectWorkEvidence(value);
    return {
      output: value,
      outputKind: 'tool-payload' as const,
      evidenceRefs: stableStringList([outputRef, ...toolPayloadEvidenceRefs(value)]),
      artifactRefs: stableStringList(toolPayloadArtifactRefs(value)),
      workEvidence,
      diagnostics: stableStringList(workEvidence.flatMap((entry) => entry.diagnostics ?? [])),
      failureReason: toolPayloadFailureReason(value),
      nextStep: firstString(value.executionUnits.flatMap((unit) => isRecord(unit) ? [unit.nextStep, unit.repairHint, unit.recoverAction] : [])),
    };
  }
  const issues = evidence.issues.map((issue) => issue.path ? `${issue.path}: ${issue.reason}` : issue.reason).join('; ');
  throw new Error(`output is neither ToolPayload nor WorkEvidence${issues ? ` (${issues})` : ''}.`);
}

function isToolPayload(value: unknown): value is ToolPayload {
  if (!isRecord(value)) return false;
  return typeof value.message === 'string'
    && typeof value.confidence === 'number'
    && typeof value.claimType === 'string'
    && typeof value.evidenceLevel === 'string'
    && typeof value.reasoningTrace === 'string'
    && Array.isArray(value.claims)
    && Array.isArray(value.uiManifest)
    && Array.isArray(value.executionUnits)
    && Array.isArray(value.artifacts);
}

function gatewayRequestForStage(
  workspaceRoot: string,
  project: TaskProject,
  stage: TaskStage,
  request: Partial<GatewayRequest> | undefined,
): GatewayRequest {
  return {
    skillDomain: request?.skillDomain ?? 'knowledge',
    prompt: request?.prompt ?? `${project.goal}\n\nStage ${stage.id}: ${stage.goal}`,
    workspacePath: request?.workspacePath ?? workspaceRoot,
    artifacts: request?.artifacts ?? [],
    ...request,
  };
}

function workEvidenceFailureReason(evidence: WorkEvidence) {
  if (/failed|repair-needed/i.test(evidence.status)) return evidence.failureReason ?? `WorkEvidence status is ${evidence.status}.`;
  return evidence.failureReason;
}

function toolPayloadFailureReason(payload: ToolPayload) {
  const units = Array.isArray(payload.executionUnits) ? payload.executionUnits : [];
  const failedUnit = units.find((unit) => isRecord(unit) && /failed|error|repair-needed|needs-human/i.test(String(unit.status || '')));
  if (isRecord(failedUnit)) {
    return firstString([failedUnit.failureReason, failedUnit.reason, failedUnit.error, failedUnit.stderr]);
  }
  if (/failed|error|repair-needed|needs-human/i.test(payload.claimType)) return payload.message;
  return undefined;
}

function toolPayloadEvidenceRefs(payload: ToolPayload) {
  const refs = new Set<string>();
  for (const evidence of collectWorkEvidence(payload)) {
    for (const ref of evidence.evidenceRefs) refs.add(ref);
    if (evidence.rawRef) refs.add(evidence.rawRef);
  }
  for (const record of recordsInValue(payload)) {
    for (const key of ['evidenceRefs', 'sourceRefs', 'references']) {
      const value = record[key];
      if (Array.isArray(value)) {
        for (const ref of value) {
          if (typeof ref === 'string' && ref.trim()) refs.add(ref.trim());
        }
      }
    }
    for (const key of ['rawRef', 'dataRef', 'sourceRef']) {
      const ref = typeof record[key] === 'string' ? record[key].trim() : '';
      if (ref) refs.add(ref);
    }
  }
  return Array.from(refs);
}

function toolPayloadArtifactRefs(payload: ToolPayload) {
  const refs = new Set<string>();
  for (const artifact of Array.isArray(payload.artifacts) ? payload.artifacts : []) {
    if (!isRecord(artifact)) continue;
    for (const key of ['artifactRef', 'ref', 'dataRef']) {
      const ref = typeof artifact[key] === 'string' ? artifact[key].trim() : '';
      if (ref && ref.startsWith('file:')) refs.add(ref);
    }
    if (isRecord(artifact.metadata)) {
      const ref = typeof artifact.metadata.artifactRef === 'string' ? artifact.metadata.artifactRef.trim() : '';
      if (ref) refs.add(ref.startsWith('file:') ? ref : fileRef(ref));
    }
  }
  return Array.from(refs);
}

function outputSummary(output: ToolPayload | WorkEvidence | undefined) {
  if (!output) return undefined;
  if ('message' in output) return output.message;
  return output.outputSummary ?? output.failureReason ?? `WorkEvidence status: ${output.status}`;
}

async function stageOutputSummaryFromRef(workspaceRoot: string, outputRef: string | undefined) {
  if (!outputRef) return undefined;
  try {
    const parsed = await parseStageOutput(workspaceRoot, stripFileRef(outputRef));
    return outputSummary(parsed.output);
  } catch {
    return undefined;
  }
}

async function stageOutputKindFromRef(workspaceRoot: string, outputRef: string | undefined) {
  if (!outputRef) return undefined;
  try {
    return (await parseStageOutput(workspaceRoot, stripFileRef(outputRef))).outputKind;
  } catch {
    return undefined;
  }
}

async function stageExitCodeFromEvidence(workspaceRoot: string, evidenceRefs: string[]) {
  for (const ref of evidenceRefs.slice().reverse()) {
    try {
      const evidence = await readJson<Record<string, unknown>>(resolveWorkspacePath(workspaceRoot, stripFileRef(ref)));
      if (isRecord(evidence.data) && typeof evidence.data.exitCode === 'number') return evidence.data.exitCode;
    } catch {
      // Keep scanning older evidence.
    }
  }
  return undefined;
}

async function evidenceSummaryFromRef(workspaceRoot: string, ref: string) {
  try {
    const evidence = await readJson<Record<string, unknown>>(resolveWorkspacePath(workspaceRoot, stripFileRef(ref)));
    return firstString([evidence.summary, evidence.title, isRecord(evidence.data) ? evidence.data.failureReason : undefined]);
  } catch {
    return undefined;
  }
}

function recordsInValue(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => recordsInValue(entry, depth + 1));
  if (!isRecord(value)) return [];
  return [value, ...Object.values(value).flatMap((entry) => recordsInValue(entry, depth + 1))];
}

function firstString(values: unknown[]) {
  return values.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)?.trim();
}

function languageForCodeRef(codeRel: string): WorkspaceTaskSpec['language'] {
  if (/\.py$/i.test(codeRel)) return 'python';
  if (/\.(r|R)$/i.test(codeRel)) return 'r';
  if (/\.(sh|bash)$/i.test(codeRel)) return 'shell';
  return 'shell';
}

function defaultTaskProjectStageAdapterSkill(skillDomain: GatewayRequest['skillDomain']): SkillAvailability {
  return {
    id: `agentserver.generate.${skillDomain}.task-project-stage-adapter`,
    kind: 'installed',
    available: true,
    reason: 'TaskProject stable stage adapter promotion candidate.',
    checkedAt: new Date().toISOString(),
    manifestPath: 'agentserver://task-project-stage-adapter',
    manifest: {
      id: `agentserver.generate.${skillDomain}.task-project-stage-adapter`,
      kind: 'installed',
      description: 'Generic AgentServer TaskProject stage adapter generation fallback.',
      skillDomains: [skillDomain],
      inputContract: { prompt: 'string', projectId: 'string', stageId: 'string' },
      outputArtifactSchema: { type: 'runtime-artifact' },
      entrypoint: { type: 'agentserver-generation' },
      environment: { runtime: 'AgentServer', sourceRuntime: 'task-project' },
      validationSmoke: { mode: 'delegated-task-project-stage' },
      examplePrompts: [],
      promotionHistory: [],
    },
  };
}

function requiredStageRef(value: string | undefined, name: string) {
  if (!value) throw new Error(`Task stage is missing ${name}.`);
  return value;
}

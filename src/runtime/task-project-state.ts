import type {
  TaskProject,
  TaskProjectGuidance,
  TaskProjectPlan,
  TaskProjectPlanStage,
  TaskProjectStatus,
} from './task-project-contracts.js';
import type { WorkEvidence } from './gateway/work-evidence-types.js';
import { normalizeRef } from './task-project-store.js';

export function syncProject(project: TaskProject, plan: TaskProjectPlan, updatedAt: string) {
  project.stageRefs = plan.stageRefs;
  project.latestStageRef = plan.stageRefs.at(-1);
  project.status = projectStatusForStages(plan.stages);
  project.updatedAt = updatedAt;
}

export function projectStatusForStages(stages: TaskProjectPlanStage[]): TaskProjectStatus {
  if (stages.some((stage) => stage.status === 'failed')) return 'failed';
  if (stages.some((stage) => stage.status === 'repair-needed')) return 'repair-needed';
  if (stages.some((stage) => stage.status === 'blocked')) return 'blocked';
  if (stages.length > 0 && stages.every((stage) => stage.status === 'done' || stage.status === 'skipped')) return 'done';
  if (stages.some((stage) => stage.status === 'running' || stage.status === 'done')) return 'running';
  return 'planned';
}

export function findPlanStage(plan: TaskProjectPlan, stageId: string | number) {
  const stage = typeof stageId === 'number'
    ? plan.stages.find((entry) => entry.index === stageId)
    : plan.stages.find((entry) => entry.id === stageId);
  if (!stage) throw new Error(`Task stage not found: ${String(stageId)}`);
  return stage;
}

export function nextStageIndex(plan: TaskProjectPlan) {
  return plan.stages.reduce((max, stage) => Math.max(max, stage.index), 0) + 1;
}

export function stableRefList(workspaceRoot: string, values: string[] | undefined) {
  return stableStringList(values?.map((value) => normalizeRef(workspaceRoot, value)));
}

export function stableStringList(values: string[] | undefined) {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).sort();
}

export function stableGuidanceQueue(values: TaskProjectGuidance[] | undefined) {
  return (values ?? []).filter((entry) => entry && typeof entry.message === 'string').map((entry) => ({
    ...entry,
    id: normalizeGuidanceId(entry.id),
    message: entry.message.trim(),
    source: entry.source?.trim() || undefined,
    stageId: entry.stageId?.trim() || undefined,
    decision: entry.decision?.trim() || undefined,
    reason: entry.reason?.trim() || undefined,
  }));
}

export function stableWorkEvidence(values: WorkEvidence[] | undefined) {
  return (values ?? []).map((evidence) => ({
    ...evidence,
    evidenceRefs: stableStringList(evidence.evidenceRefs),
    recoverActions: stableStringList(evidence.recoverActions),
    diagnostics: evidence.diagnostics ? stableStringList(evidence.diagnostics) : undefined,
  }));
}

export function stableAppend(values: string[], value: string) {
  return values.includes(value) ? values : [...values, value];
}

export function normalizeProjectId(value: string) {
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new Error(`Invalid task project id: ${value}`);
  }
  return id;
}

export function normalizeStageKind(value: string) {
  const kind = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(kind)) {
    throw new Error(`Invalid task stage kind: ${value}`);
  }
  return kind;
}

export function normalizeGuidanceId(value: string) {
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new Error(`Invalid task project guidance id: ${value}`);
  }
  return id;
}

export function safeToken(value: string) {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'evidence';
}

export function clipText(value: string | undefined, maxChars: number) {
  if (value === undefined) return { text: undefined, truncated: false };
  if (value.length <= maxChars) return { text: value, truncated: false };
  const headLength = Math.max(0, maxChars - 32);
  return {
    text: `${value.slice(0, headLength)}\n...[truncated ${value.length - headLength} chars]`,
    truncated: true,
  };
}

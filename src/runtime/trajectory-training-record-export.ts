import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  auditTrajectoryTrainingRecord,
  buildTrajectoryTrainingRecordFromStoredAttempt,
  type BuildTrajectoryTrainingRecordInput,
  type StoredAttemptLike,
  type TrajectoryAuditIssue,
  type TrajectoryAuditResult,
} from '../../packages/skills/pipeline_skills/scientific-reproduction-loop/trajectory-export';
import type { ScientificReproductionTrajectory } from '../../packages/skills/pipeline_skills/scientific-reproduction-loop/trajectory-contract';
import type { TaskAttemptRecord } from './runtime-types.js';
import { fileExists } from './workspace-task-runner.js';

export const TRAJECTORY_TRAINING_RECORDS_RELATIVE_DIR = '.sciforge/trajectory-training-records';

export interface ExportTrajectoryTrainingRecordOptions
  extends Omit<BuildTrajectoryTrainingRecordInput, 'attempt' | 'taskResult'> {
  workspacePath: string;
  attempt: TaskAttemptRecord | StoredAttemptLike;
  taskResult?: unknown;
  outputDir?: string;
}

export interface ExportTrajectoryTrainingRecordResult {
  ref: string;
  path: string;
  record: ScientificReproductionTrajectory;
  audit: TrajectoryAuditResult;
}

export async function exportTrajectoryTrainingRecordForAttempt(
  options: ExportTrajectoryTrainingRecordOptions,
): Promise<ExportTrajectoryTrainingRecordResult> {
  const workspace = resolve(options.workspacePath || process.cwd());
  const taskResult = options.taskResult ?? await readAttemptTaskResult(workspace, options.attempt);
  const record = buildTrajectoryTrainingRecordFromStoredAttempt({
    ...options,
    workspaceRef: options.workspaceRef || 'workspace:.sciforge',
    attempt: options.attempt,
    taskResult,
  });
  const audit = await auditTrajectoryTrainingRecordForWorkspace(record, workspace);
  const ref = join(
    options.outputDir || TRAJECTORY_TRAINING_RECORDS_RELATIVE_DIR,
    `${safeName(options.attempt.id)}-attempt-${options.attempt.attempt || 1}.json`,
  ).replaceAll('\\', '/');
  const path = join(workspace, ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ record, audit }, null, 2), 'utf8');
  return { ref, path, record, audit };
}

export async function auditTrajectoryTrainingRecordForWorkspace(
  record: ScientificReproductionTrajectory,
  workspacePath: string,
): Promise<TrajectoryAuditResult> {
  const workspace = resolve(workspacePath || process.cwd());
  const baseAudit = auditTrajectoryTrainingRecord(record);
  const missingRefs: string[] = [];
  for (const ref of baseAudit.replayRefs) {
    if (!ref.startsWith('.sciforge/')) continue;
    if (!await fileExists(join(workspace, ref))) missingRefs.push(ref);
  }
  const issues: TrajectoryAuditIssue[] = [
    ...baseAudit.issues,
    ...missingRefs.map((ref): TrajectoryAuditIssue => ({
      severity: 'warning',
      code: 'missing-workspace-ref',
      message: `Workspace ref was not found on disk during export audit: ${ref}`,
      refs: [ref],
    })),
  ];
  return {
    ...baseAudit,
    issues,
    ok: issues.every((issue) => issue.severity !== 'error'),
  };
}

async function readAttemptTaskResult(workspace: string, attempt: TaskAttemptRecord | StoredAttemptLike): Promise<unknown | undefined> {
  if (!attempt.outputRef) return undefined;
  const path = join(workspace, attempt.outputRef);
  if (!await fileExists(path)) return undefined;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'trajectory';
}

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { TaskAttemptRecord } from './runtime-types.js';
import { summarizeWorkEvidenceForHandoff } from './gateway/work-evidence-types.js';
import { fileExists } from './workspace-task-runner.js';
import { resolveWorkspaceFileRefPath } from './workspace-paths.js';
import { isRecord } from './gateway-utils.js';
import {
  mergeValidationRepairAuditAttemptMetadata,
  validationRepairAuditAttemptMetadataFromPayload,
  type ValidationRepairAuditAttemptMetadata,
} from './gateway/validation-repair-audit-bridge.js';

export async function appendTaskAttempt(workspacePath: string, record: TaskAttemptRecord) {
  const workspace = resolve(workspacePath || process.cwd());
  const recordWithEvidence = await withWorkEvidenceSummary(workspace, record);
  const recordWithAudit = await withValidationRepairAuditMetadata(workspace, recordWithEvidence);
  const normalizedRecord = recordWithAudit.status === 'done'
    ? { ...recordWithAudit, failureReason: undefined }
    : recordWithAudit;
  const path = join(workspace, '.sciforge', 'task-attempts', `${safeName(record.id)}.json`);
  await mkdir(dirname(path), { recursive: true });
  const previous = await readAttempts(path);
  const attempts = [
    ...previous.filter((item) => item.attempt !== normalizedRecord.attempt),
    normalizedRecord,
  ].sort((left, right) => left.attempt - right.attempt);
  await writeFile(path, JSON.stringify({
    id: normalizedRecord.id,
    prompt: normalizedRecord.prompt,
    skillDomain: normalizedRecord.skillDomain,
    scenarioPackageRef: normalizedRecord.scenarioPackageRef,
    skillPlanRef: normalizedRecord.skillPlanRef,
    uiPlanRef: normalizedRecord.uiPlanRef,
    routeDecision: normalizedRecord.routeDecision,
    updatedAt: new Date().toISOString(),
    attempts,
  }, null, 2));
  return path;
}

export async function readTaskAttempts(workspacePath: string, id: string): Promise<TaskAttemptRecord[]> {
  const workspace = resolve(workspacePath || process.cwd());
  return withWorkEvidenceSummaries(workspace, await readAttempts(join(workspace, '.sciforge', 'task-attempts', `${safeName(id)}.json`)));
}

export async function readRecentTaskAttempts(
  workspacePath: string,
  skillDomain?: string,
  limit = 8,
  scope: { scenarioPackageId?: string; skillPlanRef?: string; prompt?: string } = {},
): Promise<TaskAttemptRecord[]> {
  const workspace = resolve(workspacePath || process.cwd());
  const dir = join(workspace, '.sciforge', 'task-attempts');
  if (!await fileExists(dir)) return [];
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const groups = await Promise.all(files
    .filter((file) => file.endsWith('.json'))
    .map((file) => readAttempts(join(dir, file))));
  const attempts = groups
    .flat()
    .filter((attempt) => !skillDomain || attempt.skillDomain === skillDomain)
    .filter((attempt) => matchesAttemptScope(attempt, scope))
    .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''))
    .slice(0, limit);
  return withWorkEvidenceSummaries(workspace, attempts);
}

function matchesAttemptScope(
  attempt: TaskAttemptRecord,
  scope: { scenarioPackageId?: string; skillPlanRef?: string; prompt?: string },
) {
  const scenarioPackageId = scope.scenarioPackageId?.trim();
  if (scenarioPackageId) {
    return attempt.scenarioPackageRef?.id === scenarioPackageId;
  }
  const skillPlanRef = scope.skillPlanRef?.trim();
  if (skillPlanRef && attempt.skillPlanRef && attempt.skillPlanRef !== skillPlanRef) {
    return false;
  }
  const prompt = scope.prompt?.trim();
  if (!prompt) return true;
  return promptSimilarity(prompt, attempt.prompt) >= 0.22;
}

function promptSimilarity(left: string, right: string) {
  const leftTokens = promptTokens(left);
  const rightTokens = promptTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function promptTokens(value: string) {
  return new Set(value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 80));
}

async function readAttempts(path: string): Promise<TaskAttemptRecord[]> {
  if (!await fileExists(path)) return [];
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(parsed.attempts) ? parsed.attempts : [];
  } catch {
    return [];
  }
}

async function withWorkEvidenceSummaries(workspace: string, attempts: TaskAttemptRecord[]) {
  return Promise.all(attempts.map((attempt) => withWorkEvidenceSummary(workspace, attempt)));
}

async function withWorkEvidenceSummary(workspace: string, record: TaskAttemptRecord): Promise<TaskAttemptRecord> {
  if (record.workEvidenceSummary || !record.outputRef) return record;
  const outputPath = workspaceSafePath(workspace, record.outputRef);
  if (!outputPath || !await fileExists(outputPath)) return record;
  try {
    const parsed = JSON.parse(await readFile(outputPath, 'utf8'));
    const workEvidenceSummary = summarizeWorkEvidenceForHandoff(parsed);
    return workEvidenceSummary ? { ...record, workEvidenceSummary } : record;
  } catch {
    return record;
  }
}

async function withValidationRepairAuditMetadata(workspace: string, record: TaskAttemptRecord): Promise<TaskAttemptRecord> {
  const fromAttempt = validationRepairAuditAttemptMetadataFromAttempt(record);
  const fromOutput = record.outputRef
    ? await validationRepairAuditAttemptMetadataFromOutput(workspace, record.outputRef)
    : undefined;
  const metadata = mergeValidationRepairAuditAttemptMetadata(fromAttempt, fromOutput);
  if (!metadata) return record;
  const current = record as TaskAttemptRecord & { refs?: Record<string, unknown> };
  return {
    ...record,
    refs: {
      ...(isRecord(current.refs) ? current.refs : {}),
      validationRepairAudit: metadata.auditRefs,
    },
    validationRepairAuditRecords: metadata.auditRecords,
  } as TaskAttemptRecord;
}

function validationRepairAuditAttemptMetadataFromAttempt(record: TaskAttemptRecord): ValidationRepairAuditAttemptMetadata | undefined {
  const current = record as TaskAttemptRecord & {
    refs?: Record<string, unknown>;
    validationRepairAuditRecords?: unknown;
  };
  const refs = isRecord(current.refs) && Array.isArray(current.refs.validationRepairAudit)
    ? current.refs.validationRepairAudit
    : [];
  const records = Array.isArray(current.validationRepairAuditRecords)
    ? current.validationRepairAuditRecords
    : [];
  return refs.length || records.length
    ? {
      auditRefs: refs as ValidationRepairAuditAttemptMetadata['auditRefs'],
      auditRecords: records as ValidationRepairAuditAttemptMetadata['auditRecords'],
    }
    : undefined;
}

async function validationRepairAuditAttemptMetadataFromOutput(
  workspace: string,
  outputRef: string,
): Promise<ValidationRepairAuditAttemptMetadata | undefined> {
  const outputPath = workspaceSafePath(workspace, outputRef);
  if (!outputPath || !await fileExists(outputPath)) return undefined;
  try {
    return validationRepairAuditAttemptMetadataFromPayload(JSON.parse(await readFile(outputPath, 'utf8')));
  } catch {
    return undefined;
  }
}

function workspaceSafePath(workspace: string, ref: string) {
  try {
    return resolveWorkspaceFileRefPath(ref, workspace);
  } catch {
    return undefined;
  }
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { TaskAttemptRecord } from './runtime-types.js';
import { summarizeWorkEvidenceForHandoff } from './gateway/work-evidence-types.js';
import { fileExists } from './workspace-task-runner.js';
import { resolveWorkspaceFileRefPath } from './workspace-paths.js';
import { isRecord } from './gateway-utils.js';
import {
  mergeValidationRepairAuditAttemptMetadata,
  projectValidationRepairAuditSink,
  validationRepairAuditAttemptMetadataFromPayload,
  type ValidationRepairAuditAttemptMetadata,
} from './gateway/validation-repair-audit-sink.js';
import {
  validationRepairTelemetryAttemptMetadataFromPayload,
  type ValidationRepairTelemetryAttemptMetadata,
} from './gateway/validation-repair-telemetry-sink.js';

export async function appendTaskAttempt(workspacePath: string, record: TaskAttemptRecord) {
  const workspace = resolve(workspacePath || process.cwd());
  const recordWithEvidence = await withWorkEvidenceSummary(workspace, record);
  const recordWithAudit = await withValidationRepairAuditMetadata(workspace, recordWithEvidence);
  const normalizedRecord = recordWithAudit.status === 'done'
    ? { ...recordWithAudit, failureReason: undefined }
    : recordWithAudit;
  const path = normalizedRecord.sessionBundleRef
    ? join(workspace, normalizedRecord.sessionBundleRef, 'records', 'task-attempts', `${safeName(record.id)}.json`)
    : join(workspace, '.sciforge', 'task-attempts', `${safeName(record.id)}.json`);
  const previous = await readAttempts(path);
  const attempts = [
    ...previous.filter((item) => item.attempt !== normalizedRecord.attempt),
    normalizedRecord,
  ].sort((left, right) => left.attempt - right.attempt);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    id: normalizedRecord.id,
    prompt: normalizedRecord.prompt,
    skillDomain: normalizedRecord.skillDomain,
    scenarioPackageRef: normalizedRecord.scenarioPackageRef,
    skillPlanRef: normalizedRecord.skillPlanRef,
    uiPlanRef: normalizedRecord.uiPlanRef,
    routeDecision: normalizedRecord.routeDecision,
    sessionId: normalizedRecord.sessionId,
    sessionBundleRef: normalizedRecord.sessionBundleRef,
    updatedAt: new Date().toISOString(),
    attempts,
  }, null, 2));
  return path;
}

export async function readTaskAttempts(workspacePath: string, id: string): Promise<TaskAttemptRecord[]> {
  const workspace = resolve(workspacePath || process.cwd());
  const rootAttempts = await readAttempts(join(workspace, '.sciforge', 'task-attempts', `${safeName(id)}.json`));
  if (rootAttempts.length) return withAttemptDerivedMetadata(workspace, rootAttempts);
  const sessionFiles = await sessionTaskAttemptFiles(workspace);
  const groups = await Promise.all(sessionFiles
    .filter((file) => file.endsWith(`/${safeName(id)}.json`))
    .map((file) => readAttempts(file)));
  return withAttemptDerivedMetadata(workspace, groups.flat());
}

export async function readRecentTaskAttempts(
  workspacePath: string,
  skillDomain?: string,
  limit = 8,
  scope: { scenarioPackageId?: string; skillPlanRef?: string; prompt?: string } = {},
): Promise<TaskAttemptRecord[]> {
  const workspace = resolve(workspacePath || process.cwd());
  const groups = await Promise.all((await taskAttemptFiles(workspace)).map((file) => readAttempts(file)));
  const attempts = groups
    .flat()
    .filter((attempt) => !skillDomain || attempt.skillDomain === skillDomain)
    .filter((attempt) => matchesAttemptScope(attempt, scope))
    .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''))
    .slice(0, limit);
  return withAttemptDerivedMetadata(workspace, attempts);
}

async function taskAttemptFiles(workspace: string) {
  const rootDir = join(workspace, '.sciforge', 'task-attempts');
  const rootFiles = await jsonFilesInDir(rootDir);
  return [...rootFiles, ...await sessionTaskAttemptFiles(workspace)];
}

async function sessionTaskAttemptFiles(workspace: string) {
  const sessionsDir = join(workspace, '.sciforge', 'sessions');
  let sessionDirs: string[];
  try {
    sessionDirs = await readdir(sessionsDir);
  } catch {
    return [];
  }
  const nested = await Promise.all(sessionDirs
    .filter((entry) => !entry.endsWith('.json'))
    .map((entry) => jsonFilesInDir(join(sessionsDir, entry, 'records', 'task-attempts'))));
  return nested.flat();
}

async function jsonFilesInDir(dir: string) {
  if (!await fileExists(dir)) return [];
  try {
    return (await readdir(dir))
      .filter((file) => file.endsWith('.json'))
      .map((file) => join(dir, file));
  } catch {
    return [];
  }
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

async function withAttemptDerivedMetadata(workspace: string, attempts: TaskAttemptRecord[]) {
  return Promise.all(attempts.map(async (attempt) => {
    const withEvidence = await withWorkEvidenceSummary(workspace, attempt);
    const withAudit = await withValidationRepairAuditMetadata(workspace, withEvidence);
    return withValidationRepairTelemetryMetadata(workspace, withAudit);
  }));
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
      validationRepairAuditSink: metadata.sinkRefs,
    },
    validationRepairAuditRecords: metadata.auditRecords,
    validationRepairAuditSinkRecords: metadata.sinkRecords,
  } as TaskAttemptRecord;
}

function validationRepairAuditAttemptMetadataFromAttempt(record: TaskAttemptRecord): ValidationRepairAuditAttemptMetadata | undefined {
  const current = record as TaskAttemptRecord & {
    refs?: Record<string, unknown>;
    validationRepairAuditRecords?: unknown;
    validationRepairAuditSinkRecords?: unknown;
  };
  const refs = isRecord(current.refs) && Array.isArray(current.refs.validationRepairAudit)
    ? current.refs.validationRepairAudit
    : [];
  const sinkRefs = isRecord(current.refs) && Array.isArray(current.refs.validationRepairAuditSink)
    ? current.refs.validationRepairAuditSink
    : [];
  const records = Array.isArray(current.validationRepairAuditRecords)
    ? current.validationRepairAuditRecords
    : [];
  const sinkRecords = Array.isArray(current.validationRepairAuditSinkRecords)
    ? current.validationRepairAuditSinkRecords
    : [];
  const projectedFromAuditRecords = records.length
    ? projectValidationRepairAuditSink(records.map((auditRecord) => ({ auditRecord }))).attemptMetadata
    : undefined;
  return refs.length || records.length || sinkRefs.length || sinkRecords.length || projectedFromAuditRecords
    ? mergeValidationRepairAuditAttemptMetadata(projectedFromAuditRecords, {
      auditRefs: refs as ValidationRepairAuditAttemptMetadata['auditRefs'],
      auditRecords: records as ValidationRepairAuditAttemptMetadata['auditRecords'],
      sinkRefs: sinkRefs as ValidationRepairAuditAttemptMetadata['sinkRefs'],
      sinkRecords: sinkRecords as ValidationRepairAuditAttemptMetadata['sinkRecords'],
    })
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

async function withValidationRepairTelemetryMetadata(workspace: string, record: TaskAttemptRecord): Promise<TaskAttemptRecord> {
  const fromAttempt = validationRepairTelemetryAttemptMetadataFromAttempt(record);
  const fromOutput = record.outputRef
    ? await validationRepairTelemetryAttemptMetadataFromOutput(workspace, record.outputRef)
    : undefined;
  const telemetryRefs = uniqueTelemetryRefs([
    ...(fromAttempt?.telemetryRefs ?? []),
    ...(fromOutput?.telemetryRefs ?? []),
  ]);
  if (!telemetryRefs.length) return record;
  const current = record as TaskAttemptRecord & { refs?: Record<string, unknown> };
  return {
    ...record,
    refs: {
      ...(isRecord(current.refs) ? current.refs : {}),
      validationRepairTelemetry: telemetryRefs,
    },
  } as TaskAttemptRecord;
}

function validationRepairTelemetryAttemptMetadataFromAttempt(record: TaskAttemptRecord): ValidationRepairTelemetryAttemptMetadata | undefined {
  const current = record as TaskAttemptRecord & { refs?: Record<string, unknown> };
  const telemetryRefs = isRecord(current.refs) && Array.isArray(current.refs.validationRepairTelemetry)
    ? current.refs.validationRepairTelemetry
    : [];
  return validationRepairTelemetryAttemptMetadataFromPayload({ refs: { validationRepairTelemetry: telemetryRefs } });
}

async function validationRepairTelemetryAttemptMetadataFromOutput(
  workspace: string,
  outputRef: string,
): Promise<ValidationRepairTelemetryAttemptMetadata | undefined> {
  const outputPath = workspaceSafePath(workspace, outputRef);
  if (!outputPath || !await fileExists(outputPath)) return undefined;
  try {
    return validationRepairTelemetryAttemptMetadataFromPayload(JSON.parse(await readFile(outputPath, 'utf8')));
  } catch {
    return undefined;
  }
}

function uniqueTelemetryRefs(refs: ValidationRepairTelemetryAttemptMetadata['telemetryRefs']) {
  const byKey = new Map<string, ValidationRepairTelemetryAttemptMetadata['telemetryRefs'][number]>();
  for (const ref of refs) {
    const key = `${ref.ref}:${ref.recordRefs.join('|')}:${ref.spanRefs.join('|')}`;
    if (byKey.has(key)) continue;
    byKey.set(key, ref);
  }
  return [...byKey.values()];
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

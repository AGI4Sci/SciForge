import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { artifactMatchesReferenceScope } from '@sciforge-ui/runtime-contract/artifact-reference-policy';
import type { GatewayRequest, TaskAttemptRecord } from '../runtime-types.js';
import { readRecentTaskAttempts } from '../task-attempt-history.js';
import { fileExists } from '../workspace-task-runner.js';
import { isRecord, safeWorkspaceRel, toRecordList, uniqueStrings } from '../gateway-utils.js';

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function artifactNeedsRepair(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const status = String(artifact.status || metadata.status || '').toLowerCase();
  const reason = String(artifact.failureReason || metadata.failureReason || '').toLowerCase();
  return status.includes('repair') || status.includes('fail') || /placeholder|missing|failed|repair/.test(reason);
}

export async function collectArtifactReferenceContext(request: GatewayRequest) {
  const workspace = resolve(request.workspacePath || process.cwd());
  const recentExecutionRefs = toRecordList(request.uiState?.recentExecutionRefs);
  let priorAttempts = await readRecentTaskAttempts(workspace, request.skillDomain, 8, {
    scenarioPackageId: request.scenarioPackageRef?.id,
    skillPlanRef: request.skillPlanRef,
  });
  if (!priorAttempts.length) {
    priorAttempts = await readRecentTaskAttempts(workspace, request.skillDomain, 8);
  }
  const sessionId = typeof request.uiState?.sessionId === 'string' ? request.uiState.sessionId : undefined;
  const artifactFiles = (await readRecentArtifactFiles(workspace, sessionId))
    .filter((entry) => artifactBelongsToRequest(entry.artifact, request));
  if (!request.artifacts.length && !recentExecutionRefs.length && !priorAttempts.length && !artifactFiles.length) return undefined;
  const latestAttempt = pickLatestReferenceAttempt(priorAttempts);
  const latestExecutionRef = pickLatestReferenceExecutionRef(recentExecutionRefs);
  const refs = {
    codeRef: await pickExistingReference(workspace, stringField(latestAttempt?.codeRef), stringField(latestExecutionRef?.codeRef)),
    inputRef: await pickExistingReference(workspace, stringField(latestAttempt?.inputRef), stringField(latestExecutionRef?.inputRef)),
    outputRef: await pickExistingReference(workspace, stringField(latestAttempt?.outputRef), stringField(latestExecutionRef?.outputRef)),
    stdoutRef: await pickExistingReference(workspace, stringField(latestAttempt?.stdoutRef), stringField(latestExecutionRef?.stdoutRef)),
    stderrRef: await pickExistingReference(workspace, stringField(latestAttempt?.stderrRef), stringField(latestExecutionRef?.stderrRef)),
  };
  const outputArtifacts = await readArtifactsFromOutputRef(workspace, refs.outputRef);
  const allReferenceArtifacts = mergeArtifactsForReference([
    ...request.artifacts,
    ...outputArtifacts,
  ], artifactFiles.map((entry) => ({
    ...entry.artifact,
    dataRef: stringField(entry.artifact.dataRef) ?? entry.rel,
  })));
  const hasCoreArtifacts = Boolean(
    findArtifactByType(allReferenceArtifacts, 'paper-list')
    || findArtifactByType(allReferenceArtifacts, 'research-report'),
  );
  const latestFailed = (isFailedReferenceAttempt(latestAttempt) || isFailedReferenceAttempt(latestExecutionRef)) && !hasCoreArtifacts;
  const combinedArtifacts = latestFailed ? mergeArtifactsForReference(
    request.artifacts.filter((artifact) => artifactMatchesExecutionRef(artifact, refs.outputRef)),
    [],
  ) : allReferenceArtifacts;
  return {
    combinedArtifacts,
  };
}

function artifactBelongsToRequest(artifact: Record<string, unknown>, request: GatewayRequest) {
  return artifactMatchesReferenceScope(artifact, { skillDomain: request.skillDomain });
}

function pickLatestReferenceAttempt(attempts: TaskAttemptRecord[]) {
  return attempts.find((attempt) => hasExecutionFileRefs(attempt)) ?? attempts[0];
}

function pickLatestReferenceExecutionRef(refs: Array<Record<string, unknown>>) {
  return refs.find((entry) => hasExecutionFileRefs(entry) && !isFailedReferenceAttempt(entry))
    ?? refs.find((entry) => hasExecutionFileRefs(entry));
}

function hasExecutionFileRefs(value: unknown) {
  if (!isRecord(value)) return false;
  return Boolean(value.codeRef || value.outputRef || value.stdoutRef || value.stderrRef);
}

async function pickExistingReference(workspace: string, ...refs: Array<string | undefined>) {
  const candidates = uniqueStrings(refs.filter((ref): ref is string => Boolean(ref)));
  for (const ref of candidates) {
    const path = workspaceRefPath(workspace, ref);
    if (path && await fileExists(path)) return ref;
  }
  return candidates[0];
}

function isFailedReferenceAttempt(value: unknown) {
  if (!isRecord(value)) return false;
  const status = String(value.status || '').toLowerCase();
  const exitCode = typeof value.exitCode === 'number' ? value.exitCode : undefined;
  return status === 'failed'
    || status === 'failed-with-reason'
    || status === 'repair-needed'
    || (typeof exitCode === 'number' && exitCode !== 0);
}

async function readRecentArtifactFiles(workspace: string, sessionId?: string) {
  const dir = join(workspace, '.sciforge', 'artifacts');
  if (!await fileExists(dir)) return [] as Array<{ rel: string; artifact: Record<string, unknown>; mtimeMs: number }>;
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const entries = await Promise.all(files
    .filter((file) => file.endsWith('.json'))
    .map(async (file) => {
      const rel = `.sciforge/artifacts/${file}`;
      const path = join(workspace, rel);
      try {
        const [stats, text] = await Promise.all([stat(path), readFile(path, 'utf8')]);
        const parsed = JSON.parse(text);
        return isRecord(parsed) ? { rel, artifact: parsed, mtimeMs: stats.mtimeMs } : undefined;
      } catch {
        return undefined;
      }
    }));
  return entries
    .filter((entry): entry is { rel: string; artifact: Record<string, unknown>; mtimeMs: number } => Boolean(entry))
    .filter((entry) => !sessionId || entry.rel.includes(sessionId) || String(entry.artifact.producerSessionId || entry.artifact.sessionId || '').includes(sessionId))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 24);
}

async function readArtifactsFromOutputRef(workspace: string, outputRef: string | undefined) {
  if (!outputRef || /^[a-z]+:\/\//i.test(outputRef)) return [] as Array<Record<string, unknown>>;
  const path = workspaceRefPath(workspace, outputRef);
  if (!path) return [];
  if (!await fileExists(path)) return [];
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    const artifacts = isRecord(parsed) && Array.isArray(parsed.artifacts)
      ? toRecordList(parsed.artifacts)
      : isRecord(parsed) && parsed.type ? [parsed] : [];
    return artifacts.map((artifact) => ({
      ...artifact,
      dataRef: stringField(artifact.dataRef) ?? outputRef,
      metadata: {
        ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
        outputRef,
      },
    }));
  } catch {
    return [];
  }
}

function workspaceRefPath(workspace: string, ref: string | undefined) {
  if (!ref || /^[a-z]+:\/\//i.test(ref)) return undefined;
  try {
    const root = resolve(workspace);
    const path = ref.startsWith('/')
      ? resolve(ref)
      : resolve(root, safeWorkspaceRel(ref));
    return path === root || path.startsWith(`${root}/`) ? path : undefined;
  } catch {
    return undefined;
  }
}

function mergeArtifactsForReference(left: Array<Record<string, unknown>>, right: Array<Record<string, unknown>>) {
  return [...left, ...right].filter((artifact) => isRecord(artifact));
}

function findArtifactByType(artifacts: Array<Record<string, unknown>>, type: string) {
  return artifacts.find((artifact) => String(artifact.type || artifact.id || '') === type && !artifactNeedsRepair(artifact))
    ?? artifacts.find((artifact) => String(artifact.type || artifact.id || '') === type);
}

function artifactMatchesExecutionRef(artifact: Record<string, unknown>, outputRef: string | undefined) {
  if (!outputRef) return false;
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return stringField(artifact.outputRef) === outputRef
    || stringField(artifact.dataRef) === outputRef
    || stringField(metadata.outputRef) === outputRef;
}

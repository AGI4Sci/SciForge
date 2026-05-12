import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  createFailureSignatureRegistry,
  mergeFailureSignaturesIntoRegistry,
  validateFailureSignatureRegistry,
  type FailureSignatureRegistry,
} from '@sciforge-ui/runtime-contract/task-run-card';
import type { TaskAttemptRecord } from './runtime-types.js';
import { fileExists } from './workspace-task-runner.js';

export async function recordTaskAttemptFailureSignatures(
  workspacePath: string,
  record: TaskAttemptRecord,
): Promise<FailureSignatureRegistry> {
  const workspace = resolve(workspacePath || process.cwd());
  const registry = mergeFailureSignaturesIntoRegistry(await readFailureSignatureRegistry(workspace), {
    runId: `task-attempt:${record.id}:${record.attempt}`,
    taskId: record.id,
    attempt: record.attempt,
    status: record.status,
    createdAt: record.createdAt,
    sessionId: record.sessionId,
    sessionBundleRef: record.sessionBundleRef,
    refs: [
      record.codeRef,
      record.inputRef,
      record.outputRef,
      record.stdoutRef,
      record.stderrRef,
      record.sessionBundleRef,
    ].filter((ref): ref is string => Boolean(ref)),
    failureSignatures: record.taskRunCard?.failureSignatures ?? [],
  });
  if (!registry.entries.length) return registry;
  const registryPath = failureSignatureRegistryPath(workspace);
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify(registry, null, 2));
  return registry;
}

export async function readFailureSignatureRegistry(workspacePath: string): Promise<FailureSignatureRegistry> {
  const workspace = resolve(workspacePath || process.cwd());
  const registryPath = failureSignatureRegistryPath(workspace);
  if (!await fileExists(registryPath)) return createFailureSignatureRegistry();
  try {
    const parsed = JSON.parse(await readFile(registryPath, 'utf8'));
    return validateFailureSignatureRegistry(parsed).length === 0
      ? createFailureSignatureRegistry(parsed)
      : createFailureSignatureRegistry();
  } catch {
    return createFailureSignatureRegistry();
  }
}

function failureSignatureRegistryPath(workspace: string) {
  return join(workspace, '.sciforge', 'failure-signatures', 'registry.json');
}

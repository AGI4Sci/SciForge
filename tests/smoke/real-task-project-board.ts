import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type RealTaskProjectBoardEntry = {
  taskId: string;
  checked: boolean;
  marker: string;
  lineNumber: number;
  sourceText: string;
};

export type RealTaskProjectBoardAssertOptions = {
  root?: string;
};

type RealTaskEvidenceManifest = {
  status?: unknown;
  releaseEligible?: unknown;
  releaseBlocking?: unknown;
  attemptScope?: unknown;
  currentRunEvidenceScope?: unknown;
};

const liveAttemptScopes = new Set(['task-specific-live-attempt', 'desktop-live-attempt']);

export function parseRealTaskProjectBoard(projectText: string): Map<string, RealTaskProjectBoardEntry> {
  const tasks = new Map<string, RealTaskProjectBoardEntry>();
  const taskLinePattern = /^\s*-\s+\[([ xX])\]\s+(R-[A-Z0-9-]+)\b/;

  for (const [index, line] of projectText.split(/\r?\n/).entries()) {
    const match = line.match(taskLinePattern);
    if (!match) continue;
    const [, marker, taskId] = match;
    tasks.set(taskId, {
      taskId,
      checked: marker.trim().toLowerCase() === 'x',
      marker,
      lineNumber: index + 1,
      sourceText: line,
    });
  }

  return tasks;
}

export function assertRealTaskProjectBoardTask(
  projectText: string,
  taskId: string,
  options: RealTaskProjectBoardAssertOptions = {},
): RealTaskProjectBoardEntry {
  const task = parseRealTaskProjectBoard(projectText).get(taskId);
  assert.ok(task, `${taskId}: must be present in PROJECT.md real task board`);
  if (task.checked) assertCheckedRealTaskHasPassedManifest(taskId, options);
  return task;
}

export function assertCheckedRealTaskHasPassedManifest(
  taskId: string,
  options: RealTaskProjectBoardAssertOptions = {},
): void {
  const root = options.root ?? process.cwd();
  const manifestPath = join(root, 'docs', 'test-artifacts', 'real-tasks', taskId, 'manifest.json');
  assert.ok(existsSync(manifestPath), `${taskId}: checked PROJECT.md task must have a real-task evidence manifest`);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RealTaskEvidenceManifest;
  assert.equal(manifest.status, 'passed', `${taskId}: checked PROJECT.md task must have status=passed evidence`);
  assert.equal(manifest.releaseEligible, true, `${taskId}: checked PROJECT.md task must be releaseEligible`);
  assert.equal(manifest.releaseBlocking, false, `${taskId}: checked PROJECT.md task must have releaseBlocking=false`);
  assert.ok(
    typeof manifest.attemptScope === 'string' && liveAttemptScopes.has(manifest.attemptScope),
    `${taskId}: checked PROJECT.md task must have attemptScope=task-specific-live-attempt or desktop-live-attempt`,
  );
  assert.equal(
    manifest.currentRunEvidenceScope,
    manifest.attemptScope,
    `${taskId}: checked PROJECT.md task must mirror currentRunEvidenceScope to attemptScope`,
  );
}

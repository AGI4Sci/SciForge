import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  captureRepairBoundarySnapshot,
  evaluateRepairBoundarySnapshot,
} from '../../src/runtime/gateway/repair-policy.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-repair-boundary-output-'));
const sessionBundleRel = '.sciforge/sessions/2026-05-17_literature_session-output-allowlist';
const taskRel = `${sessionBundleRel}/tasks/generated-literature-output-allowlist.py`;
const sourceRel = 'src/runtime/gateway/generated-task-runner.ts';

try {
  await mkdir(join(workspace, 'src/runtime/gateway'), { recursive: true });
  await mkdir(join(workspace, sessionBundleRel, 'tasks'), { recursive: true });
  await writeFile(join(workspace, 'PROJECT.md'), '# Project\n', 'utf8');
  await writeFile(join(workspace, sourceRel), 'export const fixture = true;\n', 'utf8');
  await writeFile(join(workspace, taskRel), 'print("repair task")\n', 'utf8');

  const before = await captureRepairBoundarySnapshot(workspace);

  await mkdir(join(workspace, '.sciforge/task-results'), { recursive: true });
  await mkdir(join(workspace, sessionBundleRel, 'task-results'), { recursive: true });
  await writeFile(join(workspace, '.sciforge/task-results/generated-literature-attempt-2.json'), '{"ok":true}\n', 'utf8');
  await writeFile(join(workspace, sessionBundleRel, 'task-results/generated-literature-session-attempt-2.json'), '{"ok":true}\n', 'utf8');
  await writeFile(join(workspace, 'PROJECT.md'), '# Out-of-bound edit\n', 'utf8');
  await writeFile(join(workspace, sourceRel), 'export const fixture = false;\n', 'utf8');

  const after = await captureRepairBoundarySnapshot(workspace);
  const violation = evaluateRepairBoundarySnapshot(before, after, { taskRel });

  assert.ok(violation);
  assert.deepEqual(violation.blockedPaths, ['PROJECT.md', sourceRel]);
  assert.deepEqual(violation.allowedPaths, [
    '.sciforge/sessions/2026-05-17_literature_session-output-allowlist/task-results/generated-literature-session-attempt-2.json',
    '.sciforge/task-results/generated-literature-attempt-2.json',
  ]);
  assert.ok(violation.allowedPrefixes.includes('.sciforge/task-results/'));
  assert.ok(violation.allowedPrefixes.includes(`${sessionBundleRel}/task-results/`));

  console.log('[ok] repair boundary allows generated task outputs while blocking repo source/config edits');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

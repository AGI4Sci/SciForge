import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  captureGeneratedTaskWorkspaceSideEffectSnapshot,
  workEvidenceFromGeneratedTaskWorkspaceSideEffects,
} from './generated-task-workspace-side-effects.js';

test('generated task workspace side-effect snapshot captures modified and created source files', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-side-effects-'));
  await writeFile(join(workspace, 'weighted_survival_auc.py'), 'def score():\n    return 0\n');
  await mkdir(join(workspace, '.sciforge'), { recursive: true });
  await mkdir(join(workspace, 'node_modules'), { recursive: true });
  await writeFile(join(workspace, '.sciforge', 'internal.json'), '{"debug":true}\n');
  await writeFile(join(workspace, 'node_modules', 'ignored.js'), 'throw new Error("ignored")\n');

  const before = await captureGeneratedTaskWorkspaceSideEffectSnapshot(workspace);

  await writeFile(join(workspace, 'weighted_survival_auc.py'), 'def score():\n    return 1\n');
  await writeFile(join(workspace, 'patch_summary.md'), '# Patch\n\nFixed IPCW pair weights.\n');
  await writeFile(join(workspace, '.sciforge', 'internal.json'), '{"debug":false}\n');
  await writeFile(join(workspace, 'node_modules', 'ignored.js'), 'console.log("still ignored")\n');

  const evidence = await workEvidenceFromGeneratedTaskWorkspaceSideEffects(before, workspace);
  const byPath = new Map(evidence.map((item) => [String(inputRecord(item.input).path), item]));

  assert.equal(evidence.length, 2);
  assert.equal(inputRecord(byPath.get('weighted_survival_auc.py')?.input).sideEffect, 'modified-existing-file');
  assert.equal(inputRecord(byPath.get('patch_summary.md')?.input).sideEffect, 'created-file');
  assert.deepEqual(byPath.get('weighted_survival_auc.py')?.evidenceRefs, ['weighted_survival_auc.py']);
  assert.equal(byPath.has('.sciforge/internal.json'), false);
  assert.equal(byPath.has('node_modules/ignored.js'), false);
});

function inputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

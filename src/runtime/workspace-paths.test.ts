import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { normalizeWorkspaceRootPath, resolveWorkspaceFilePreviewPath, resolveWorkspaceFileRefPath } from './workspace-paths';

test('workspace preview paths resolve logical artifact refs into managed .sciforge artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-paths-'));
  try {
    await mkdir(join(root, '.sciforge', 'artifacts'), { recursive: true });
    await writeFile(join(root, '.sciforge', 'artifacts', 'ai_virtual_cell_report.md'), '# report', 'utf8');

    assert.equal(
      resolveWorkspaceFilePreviewPath('artifacts/ai_virtual_cell_report.md', root),
      join(root, '.sciforge', 'artifacts', 'ai_virtual_cell_report.md'),
    );
    assert.equal(
      resolveWorkspaceFilePreviewPath('.sciforge/artifacts/ai_virtual_cell_report.md', root),
      join(root, '.sciforge', 'artifacts', 'ai_virtual_cell_report.md'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace file refs resolve file refs and managed shorthand inside the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-paths-'));
  try {
    await mkdir(join(root, '.sciforge', 'task-results'), { recursive: true });
    await writeFile(join(root, '.sciforge', 'task-results', 'run.json'), '{"ok":true}', 'utf8');

    assert.equal(
      resolveWorkspaceFileRefPath('file:.sciforge/task-results/run.json', root),
      join(root, '.sciforge', 'task-results', 'run.json'),
    );
    assert.equal(
      resolveWorkspaceFileRefPath('.sciforge/task-results/run.json', root),
      join(root, '.sciforge', 'task-results', 'run.json'),
    );
    assert.equal(
      resolveWorkspaceFileRefPath('task-results/run.json', root),
      join(root, '.sciforge', 'task-results', 'run.json'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace preview paths prefer real workspace files over managed fallbacks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-paths-'));
  try {
    await mkdir(join(root, 'artifacts'), { recursive: true });
    await mkdir(join(root, '.sciforge', 'artifacts'), { recursive: true });
    await writeFile(join(root, 'artifacts', 'report.md'), '# root report', 'utf8');
    await writeFile(join(root, '.sciforge', 'artifacts', 'report.md'), '# managed report', 'utf8');

    assert.equal(
      resolveWorkspaceFilePreviewPath('artifacts/report.md', root),
      join(root, 'artifacts', 'report.md'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace preview paths keep path traversal outside the workspace blocked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-paths-'));
  try {
    assert.throws(
      () => resolveWorkspaceFilePreviewPath('../outside.md', root),
      /outside the active workspace/,
    );
    assert.equal(normalizeWorkspaceRootPath(`${root}/.sciforge/artifacts`), root);
    assert.throws(
      () => resolveWorkspaceFileRefPath('file:../outside.md', root),
      /outside the active workspace/,
    );
    assert.throws(
      () => resolveWorkspaceFileRefPath(`file:${resolve(root, '..', 'outside.md')}`, root),
      /outside the active workspace/,
    );
    assert.throws(
      () => resolveWorkspaceFileRefPath('agentserver://run/output', root),
      /Unsupported workspace file ref/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

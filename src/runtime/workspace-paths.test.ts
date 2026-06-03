import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  ensureWorkspaceBrowserProfileDir,
  normalizeWorkspaceRootPath,
  resolveWorkspaceFilePreviewPath,
  resolveWorkspaceFileRefPath,
  WORKSPACE_BROWSER_PROFILE_REF,
  workspaceBrowserProfileState,
} from './workspace-paths';

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

test('workspace browser profile state is an ignored workspace-local runtime directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-browser-profile-'));
  const otherRoot = await mkdtemp(join(tmpdir(), 'sciforge-workspace-browser-profile-'));
  try {
    const state = workspaceBrowserProfileState(`${root}/.sciforge/sessions/run-1`);
    const otherState = workspaceBrowserProfileState(otherRoot);

    assert.equal(state.workspaceRoot, root);
    assert.equal(state.profileRef, WORKSPACE_BROWSER_PROFILE_REF);
    assert.equal(state.profileDir, join(root, '.sciforge', 'browser-host', 'profile'));
    assert.equal(state.ignoredRuntimeState, true);
    assert.equal(state.storageScope, 'workspace');
    assert.equal(state.reusesUserMainProfile, false);
    assert.notEqual(state.profileDir, otherState.profileDir);

    await ensureWorkspaceBrowserProfileDir(root);
    assert.equal((await stat(state.profileDir)).isDirectory(), true);

    const gitignore = await readFile(join(root, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.sciforge\/$/m);
    assert.doesNotMatch(gitignore, /token|secret|Authorization|api.?key/i);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(otherRoot, { recursive: true, force: true });
  }
});

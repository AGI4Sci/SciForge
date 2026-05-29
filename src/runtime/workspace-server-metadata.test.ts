import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { gitStrict } from './workspace-server-git.js';
import {
  buildWorkspaceInstanceManifest,
  buildWorkspaceStableVersionEnvironment,
  readWorkspaceConfig,
  readWorkspaceRepoInfo,
  WORKSPACE_INSTANCE_MANIFEST_CAPABILITIES,
  workspaceInstanceIdForRoot,
} from './workspace-server-metadata.js';

test('buildWorkspaceInstanceManifest preserves the public instance manifest shape', () => {
  const manifest = buildWorkspaceInstanceManifest({
    root: '/tmp/SciForge Workspace',
    state: { instanceId: ' persisted-instance ' },
    config: { name: ' Lab Workspace ' },
    localConfig: {
      workspaceWriterBaseUrl: 'http://127.0.0.1:4876',
      agentServerBaseUrl: 'http://127.0.0.1:3001',
    },
    repo: {
      detected: true,
      root: '/repo',
      branch: 'main',
      commit: 'abc123',
      remote: 'git@example.test:sciforge.git',
      dirty: false,
    },
    stableVersion: { version: 'v1' },
    agentId: 'default',
    role: 'worker-g',
    appPort: 5173,
    workspaceWriterPort: 4876,
    repoPath: '/repo',
    stateDir: '/state',
    logDir: '/state/logs',
    configLocalPath: '/repo/config/local.json',
    counterpart: { id: 'repair' },
    generatedAt: '2026-05-29T00:00:00.000Z',
  });

  assert.deepEqual(manifest, {
    schemaVersion: 1,
    agentId: 'default',
    role: 'worker-g',
    appPort: 5173,
    workspaceWriterPort: 4876,
    appUrl: 'http://127.0.0.1:5173',
    workspaceWriterUrl: 'http://127.0.0.1:4876',
    agentServerBaseUrl: 'http://127.0.0.1:3001',
    repoPath: '/repo',
    stateDir: '/state',
    logDir: '/state/logs',
    configLocalPath: '/repo/config/local.json',
    counterpart: { id: 'repair' },
    generatedAt: '2026-05-29T00:00:00.000Z',
    instance: {
      id: 'persisted-instance',
      name: 'Lab Workspace',
      role: 'worker-g',
    },
    workspacePath: '/tmp/SciForge Workspace',
    repo: {
      detected: true,
      root: '/repo',
      branch: 'main',
      commit: 'abc123',
      remote: 'git@example.test:sciforge.git',
      dirty: false,
    },
    stableVersion: { version: 'v1' },
    capabilities: [...WORKSPACE_INSTANCE_MANIFEST_CAPABILITIES],
  });
});

test('instance manifest chooses explicit agent id and falls back to hashed workspace ids', () => {
  const explicit = buildWorkspaceInstanceManifest({
    ...baseManifestInput('/tmp/work-explicit'),
    agentId: 'p3',
    state: { instanceId: 'state-id' },
  });
  assert.equal(explicit.instance.id, 'p3');

  const fallback = buildWorkspaceInstanceManifest(baseManifestInput('/tmp/work-fallback'));
  assert.equal(fallback.instance.id, workspaceInstanceIdForRoot('/tmp/work-fallback', undefined));
  assert.equal(fallback.instance.name, 'work-fallback');
});

test('buildWorkspaceStableVersionEnvironment mirrors manifest instance and repo selection rules', () => {
  assert.deepEqual(buildWorkspaceStableVersionEnvironment({
    root: '/workspace',
    state: { instanceId: ' state-instance ' },
    repo: { detected: false },
    instanceId: 'default',
    role: 'repair',
    stateDir: '/state',
  }), {
    instanceId: 'state-instance',
    role: 'repair',
    stateDir: '/state',
    repoRoot: '/workspace',
    branch: undefined,
    commit: undefined,
  });

  assert.deepEqual(buildWorkspaceStableVersionEnvironment({
    root: '/workspace',
    state: { instanceId: 'state-instance' },
    repo: { detected: true, root: '/repo', branch: 'main', commit: 'abc123', dirty: true },
    instanceId: 'p4',
    role: 'worker',
    stateDir: '/state',
  }), {
    instanceId: 'p4',
    role: 'worker',
    stateDir: '/state',
    repoRoot: '/repo',
    branch: 'main',
    commit: 'abc123',
  });
});

test('readWorkspaceConfig returns workspace config objects and ignores missing or invalid config files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-config-'));
  try {
    assert.deepEqual(await readWorkspaceConfig(root), {});

    await mkdir(join(root, '.sciforge'), { recursive: true });
    await writeFile(join(root, '.sciforge', 'config.json'), '["not", "an", "object"]');
    assert.deepEqual(await readWorkspaceConfig(root), {});

    await writeFile(join(root, '.sciforge', 'config.json'), JSON.stringify({ name: 'Configured Workspace' }));
    assert.deepEqual(await readWorkspaceConfig(root), { name: 'Configured Workspace' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('readWorkspaceRepoInfo detects git metadata and dirty worktrees', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'sciforge-workspace-repo-info-'));
  try {
    await gitStrict(repo, ['init']);
    await gitStrict(repo, ['config', 'user.email', 'sciforge@example.test']);
    await gitStrict(repo, ['config', 'user.name', 'SciForge Test']);
    await writeFile(join(repo, 'README.md'), '# SciForge\n');
    await gitStrict(repo, ['add', 'README.md']);
    await gitStrict(repo, ['commit', '-m', 'initial']);

    const clean = await readWorkspaceRepoInfo(repo);
    assert.equal(clean.detected, true);
    if (!clean.detected) throw new Error('expected repo metadata');
    assert.equal(clean.root, await realpath(repo));
    assert.match(clean.commit || '', /^[0-9a-f]{40}$/);
    assert.equal(clean.dirty, false);

    await writeFile(join(repo, 'dirty.txt'), 'dirty\n');
    const dirty = await readWorkspaceRepoInfo(repo);
    assert.equal(dirty.detected, true);
    if (!dirty.detected) throw new Error('expected dirty repo metadata');
    assert.equal(dirty.dirty, true);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

function baseManifestInput(root: string) {
  return {
    root,
    state: undefined,
    config: {},
    localConfig: {},
    repo: { detected: false } as const,
    stableVersion: undefined,
    agentId: 'default',
    role: 'worker',
    appPort: 5173,
    workspaceWriterPort: 4876,
    repoPath: '/repo',
    stateDir: '/state',
    logDir: '/state/logs',
    configLocalPath: '/repo/config/local.json',
    counterpart: undefined,
    generatedAt: '2026-05-29T00:00:00.000Z',
  };
}

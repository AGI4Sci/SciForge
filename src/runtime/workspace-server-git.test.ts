import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { gitOutput, gitStrict } from './workspace-server-git.js';

async function withGitRepo(run: (repo: string) => Promise<void>) {
  const repo = await mkdtemp(join(tmpdir(), 'sciforge-workspace-git-'));
  try {
    await gitStrict(repo, ['init']);
    await gitStrict(repo, ['config', 'user.email', 'sciforge@example.test']);
    await gitStrict(repo, ['config', 'user.name', 'SciForge Test']);
    await writeFile(join(repo, 'README.md'), '# SciForge\n');
    await gitStrict(repo, ['add', 'README.md']);
    await gitStrict(repo, ['commit', '-m', 'initial']);
    await run(repo);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

test('gitOutput returns trimmed stdout for successful commands', async () => {
  await withGitRepo(async (repo) => {
    const topLevel = await gitOutput(repo, ['rev-parse', '--show-toplevel']);

    assert.equal(topLevel, await realpath(repo));
  });
});

test('gitOutput returns an empty string for empty output and failed commands', async () => {
  await withGitRepo(async (repo) => {
    assert.equal(await gitOutput(repo, ['status', '--porcelain']), '');
    assert.equal(await gitOutput(repo, ['rev-parse', '--verify', 'missing-ref']), '');
  });
});

test('gitStrict returns stdout for successful commands', async () => {
  await withGitRepo(async (repo) => {
    const head = await gitStrict(repo, ['rev-parse', '--short', 'HEAD']);

    assert.match(head, /^[0-9a-f]{7,}$/);
  });
});

test('gitStrict rejects with command context for failed commands', async () => {
  await withGitRepo(async (repo) => {
    await assert.rejects(
      gitStrict(repo, ['rev-parse', '--verify', 'missing-ref']),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /git rev-parse --verify missing-ref failed in /);
        assert.match(error.message, /missing-ref|Needed a single revision/);
        return true;
      },
    );
  });
});

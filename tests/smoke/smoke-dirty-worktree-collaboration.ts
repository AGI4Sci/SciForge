import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  buildDirtyWorktreeCollaborationPlan,
  dirtyWorktreePlanAllowsWrite,
  parseGitPorcelainStatus,
  validateDirtyWorktreeCollaborationPlan,
} from '@sciforge-ui/runtime-contract/dirty-worktree-collaboration';

const exec = promisify(execFile);
const workspace = await mkdtemp(join(tmpdir(), 'sciforge-dirty-worktree-'));

await git(['-c', 'init.defaultBranch=main', 'init']);
await git(['config', 'user.email', 'smoke@sciforge.local']);
await git(['config', 'user.name', 'SciForge Smoke']);

await mkdir(join(workspace, 'docs'), { recursive: true });
await mkdir(join(workspace, 'src'), { recursive: true });
await writeFile(join(workspace, 'docs', 'user-notes.md'), '# User notes\n\nCommitted baseline.\n');
await writeFile(join(workspace, 'src', 'runtime.ts'), 'export const runtime = true;\n');
await git(['add', 'docs/user-notes.md', 'src/runtime.ts']);
await git(['commit', '-m', 'baseline']);

await writeFile(join(workspace, 'docs', 'user-notes.md'), '# User notes\n\nCommitted baseline.\n\nUser draft must survive.\n');
await mkdir(join(workspace, 'scratch'), { recursive: true });
await writeFile(join(workspace, 'scratch', 'local.csv'), 'sample,value\nA,1\n');

const dirtyStatus = await gitOutput(['status', '--porcelain']);
const userChanges = parseGitPorcelainStatus(dirtyStatus, 'user');
assert.ok(userChanges.some((change) => change.path === 'docs/user-notes.md' && change.owner === 'user'));
assert.ok(userChanges.some((change) => change.path.startsWith('scratch') && change.status === 'untracked'));

const safePlan = buildDirtyWorktreeCollaborationPlan({
  planId: 'smoke-safe-disjoint',
  repoRoot: workspace,
  currentBranch: 'main',
  baseRef: 'HEAD',
  userChanges,
  plannedChanges: [{
    path: 'src/agent-fix.ts',
    status: 'added',
    action: 'add',
    owner: 'agent',
    summary: 'Agent-owned disjoint runtime fix.',
  }],
  commands: [
    { command: 'git add src/agent-fix.ts', plannedPaths: ['src/agent-fix.ts'] },
  ],
  createdAt: '2026-05-13T00:00:00.000Z',
});

assert.deepEqual(validateDirtyWorktreeCollaborationPlan(safePlan), []);
assert.equal(safePlan.status, 'safe');
assert.equal(dirtyWorktreePlanAllowsWrite(safePlan), true);
assert.ok(safePlan.protectedPaths.includes('docs/user-notes.md'));
assert.ok(safePlan.protectedPaths.some((path) => path.startsWith('scratch')));
assert.equal(safePlan.allowedChanges[0]?.path, 'src/agent-fix.ts');
assert.equal(safePlan.noHardcodeReview.status, 'pass');

await writeFile(join(workspace, 'src', 'agent-fix.ts'), 'export const agentOwnedFix = true;\n');
const userFileAfterAgentWrite = await readFile(join(workspace, 'docs', 'user-notes.md'), 'utf8');
assert.match(userFileAfterAgentWrite, /User draft must survive/);

const overlapPlan = buildDirtyWorktreeCollaborationPlan({
  planId: 'smoke-overlap-blocked',
  repoRoot: workspace,
  currentBranch: 'main',
  userChanges,
  plannedChanges: [{
    path: 'docs/user-notes.md',
    status: 'modified',
    action: 'edit',
    owner: 'agent',
  }],
  commands: [{ command: 'git add docs/user-notes.md', plannedPaths: ['docs/user-notes.md'] }],
});
assert.equal(overlapPlan.status, 'blocked');
assert.equal(dirtyWorktreePlanAllowsWrite(overlapPlan), false);
assert.match(overlapPlan.pathConflicts[0]?.reason ?? '', /user-owned dirty path/);

const destructivePlan = buildDirtyWorktreeCollaborationPlan({
  planId: 'smoke-destructive-blocked',
  repoRoot: workspace,
  currentBranch: 'main',
  userChanges,
  plannedChanges: [{ path: 'src/agent-fix.ts', status: 'added', action: 'add' }],
  commands: [
    'git reset --hard HEAD',
    'git checkout -- docs/user-notes.md',
    'git clean -fd',
  ],
});
assert.equal(destructivePlan.status, 'blocked');
assert.equal(destructivePlan.prohibitedCommands.length, 3);
assert.match(destructivePlan.nextActions.join('\n'), /Remove destructive commands/);

const statusAfterAgentWrite = await gitOutput(['status', '--porcelain']);
assert.match(statusAfterAgentWrite, /docs\/user-notes\.md/);
assert.match(statusAfterAgentWrite, /src\/agent-fix\.ts/);

console.log('[ok] dirty worktree collaboration protects user-owned paths, allows disjoint agent writes, and blocks reset/revert/clean commands');

async function git(args: string[]) {
  await exec('git', args, { cwd: workspace });
}

async function gitOutput(args: string[]) {
  const { stdout } = await exec('git', args, { cwd: workspace });
  return stdout;
}

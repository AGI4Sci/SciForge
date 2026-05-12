import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DIRTY_WORKTREE_COLLABORATION_CONTRACT_ID,
  buildDirtyWorktreeCollaborationPlan,
  dirtyWorktreePlanAllowsWrite,
  parseGitPorcelainStatus,
  validateDirtyWorktreeCollaborationPlan,
} from './dirty-worktree-collaboration';

test('allows disjoint agent edits while protecting user-owned dirty paths', () => {
  const userChanges = parseGitPorcelainStatus(' M docs/user-notes.md\n?? scratch/local.csv\n');
  const plan = buildDirtyWorktreeCollaborationPlan({
    planId: 'safe-disjoint-edit',
    userChanges,
    plannedChanges: [{
      path: 'packages/contracts/runtime/safe-fix.ts',
      status: 'modified',
      action: 'edit',
      owner: 'agent',
    }],
    commands: ['git add packages/contracts/runtime/safe-fix.ts'],
    createdAt: '2026-05-13T00:00:00.000Z',
  });

  assert.equal(plan.contract, DIRTY_WORKTREE_COLLABORATION_CONTRACT_ID);
  assert.equal(plan.status, 'safe');
  assert.equal(dirtyWorktreePlanAllowsWrite(plan), true);
  assert.deepEqual(plan.pathConflicts, []);
  assert.deepEqual(plan.prohibitedCommands, []);
  assert.ok(plan.protectedPaths.includes('docs/user-notes.md'));
  assert.ok(plan.protectedPaths.includes('scratch/local.csv'));
  assert.match(plan.nextActions.join('\n'), /stage only intended files/);
  assert.equal(plan.noHardcodeReview.status, 'pass');
  assert.deepEqual(validateDirtyWorktreeCollaborationPlan(plan), []);
});

test('blocks planned writes that overlap user-owned dirty paths', () => {
  const plan = buildDirtyWorktreeCollaborationPlan({
    userChanges: [{
      path: 'src/runtime/gateway.ts',
      status: 'modified',
      owner: 'user',
    }],
    plannedChanges: [{
      path: 'src/runtime/gateway.ts',
      status: 'modified',
      action: 'edit',
      owner: 'agent',
    }],
  });

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.writeAllowed, false);
  assert.equal(dirtyWorktreePlanAllowsWrite(plan), false);
  assert.equal(plan.blockedChanges[0]?.path, 'src/runtime/gateway.ts');
  assert.match(plan.pathConflicts[0]?.reason ?? '', /user-owned dirty path/);
});

test('blocks destructive git commands even when planned paths are disjoint', () => {
  const plan = buildDirtyWorktreeCollaborationPlan({
    userChanges: parseGitPorcelainStatus(' M PROJECT.md\n'),
    plannedChanges: [{
      path: 'packages/contracts/runtime/new-contract.ts',
      status: 'added',
      action: 'add',
    }],
    commands: [
      'git reset --hard HEAD',
      'git checkout -- PROJECT.md',
      'git clean -fd',
      'git stash push',
    ],
  });

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.prohibitedCommands.length, 4);
  assert.ok(plan.prohibitedCommands.some((decision) => /reset --hard/.test(decision.command)));
  assert.ok(plan.prohibitedCommands.some((decision) => /checkout -- PROJECT.md/.test(decision.command)));
  assert.match(plan.nextActions.join('\n'), /Remove destructive commands/);
});

test('parses porcelain status rename, staged, unstaged, and conflict states', () => {
  const changes = parseGitPorcelainStatus([
    'R  old-name.ts -> new-name.ts',
    'MM src/edited.ts',
    'UU src/conflict.ts',
  ].join('\n'));

  assert.equal(changes[0]?.status, 'renamed');
  assert.equal(changes[0]?.previousPath, 'old-name.ts');
  assert.equal(changes[0]?.path, 'new-name.ts');
  assert.equal(changes[0]?.staged, true);
  assert.equal(changes[1]?.staged, true);
  assert.equal(changes[1]?.unstaged, true);
  assert.equal(changes[2]?.status, 'conflicted');

  const plan = buildDirtyWorktreeCollaborationPlan({
    userChanges: changes,
    plannedChanges: [{ path: 'docs/disjoint.md', status: 'modified' }],
  });
  assert.equal(plan.status, 'needs-review');
  assert.equal(plan.writeAllowed, false);
});

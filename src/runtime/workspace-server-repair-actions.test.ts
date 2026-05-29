import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  pathMatchesAnySafeModeScope,
  repairActionName,
  repairBrowserVerificationFromBody,
  repairControlSurfaceSafeMode,
  repairResultCommitBlocker,
  safeRepoRelativePath,
} from './workspace-server-repair-actions.js';

test('repairActionName accepts supported actions and rejects unknown actions', () => {
  for (const action of ['commit', 'push', 'pr', 'merge', 'browser-recheck'] as const) {
    assert.equal(repairActionName(action), action);
  }

  assert.throws(
    () => repairActionName('publish'),
    /repair action must be one of commit, push, pr, merge, browser-recheck/,
  );
});

test('repairBrowserVerificationFromBody normalizes status, actors, timestamps, and evidence refs', () => {
  const verification = repairBrowserVerificationFromBody({
    browserVerification: {
      status: 'passed',
      verifier: ' browser ',
      reviewer: ' reviewer ',
      conclusion: 'looks fixed',
      evidenceRefs: [' screenshots/after.png ', 'screenshots/after.png'],
      verifiedAt: ' 2026-05-29T00:00:00.000Z ',
      note: 'checked from focused test',
    },
    evidenceRefs: ['logs/browser.ndjson', 42, 'screenshots/after.png'],
  }, '2026-05-29T00:01:00.000Z');

  assert.deepEqual(verification, {
    status: 'passed',
    verifier: 'browser',
    reviewer: 'reviewer',
    conclusion: 'looks fixed',
    evidenceRefs: ['screenshots/after.png', 'logs/browser.ndjson'],
    verifiedAt: '2026-05-29T00:00:00.000Z',
    note: 'checked from focused test',
  });
});

test('repairBrowserVerificationFromBody keeps passing statuses pending until evidence exists', () => {
  assert.equal(
    repairBrowserVerificationFromBody({
      browserVerification: { status: 'verified' },
      conclusion: 'manual check passed',
    }, '2026-05-29T00:01:00.000Z').status,
    'pending',
  );

  assert.deepEqual(repairBrowserVerificationFromBody({
    status: 'unexpected',
    conclusion: 'manual check not run',
  }, '2026-05-29T00:01:00.000Z'), {
    status: 'pending',
    verifier: 'codex-in-app-browser',
    reviewer: 'feedback-inbox',
    conclusion: 'manual check not run',
    evidenceRefs: [],
    verifiedAt: '2026-05-29T00:01:00.000Z',
    note: undefined,
  });
});

test('repairControlSurfaceSafeMode detects control-surface paths and preserves existing matches', () => {
  const safeMode = repairControlSurfaceSafeMode({
    changedFiles: [
      './src/runtime/workspace-server.ts',
      'src/ui/src/feedback/components/InboxToolbar.tsx',
      'src/domain/unrelated.ts',
      'src/runtime/workspace-server.ts',
    ],
    metadata: {
      safeMode: {
        matchedPaths: ['previous/control-surface.ts', 12],
      },
    },
  });

  assert.deepEqual(safeMode, {
    active: true,
    reason: 'Repair touches the feedback inbox or repair backend/control surface.',
    matchedPaths: [
      'previous/control-surface.ts',
      './src/runtime/workspace-server.ts',
      'src/ui/src/feedback/components/InboxToolbar.tsx',
      'src/runtime/workspace-server.ts',
    ],
    requiresExternalControlSurface: true,
  });
});

test('repairControlSurfaceSafeMode honors existing active safe mode without new changed files', () => {
  assert.deepEqual(repairControlSurfaceSafeMode({
    changedFiles: ['src/domain/unrelated.ts'],
    metadata: { safeMode: { active: true } },
  }), {
    active: true,
    reason: 'Repair touches the feedback inbox or repair backend/control surface.',
    matchedPaths: [],
    requiresExternalControlSurface: true,
  });
});

test('pathMatchesAnySafeModeScope normalizes separators without broad prefix matches', () => {
  assert.equal(pathMatchesAnySafeModeScope('src\\runtime\\workspace-server.ts'), true);
  assert.equal(pathMatchesAnySafeModeScope('./src/ui/src/feedback/components/Item.tsx'), true);
  assert.equal(pathMatchesAnySafeModeScope('src/ui/src/feedbackish/components/Item.tsx'), false);
  assert.equal(pathMatchesAnySafeModeScope('src/runtime/workspace-server.test.ts'), false);
});

test('repairResultCommitBlocker returns the first policy blocker and allows clean fixed results', () => {
  assert.equal(repairResultCommitBlocker({
    verdict: 'needs-follow-up',
  }), 'Repair commit blocked: result verdict is needs-follow-up, not fixed.');

  assert.equal(repairResultCommitBlocker(cleanFixedResult({
    changedProtectedPaths: ['config/local.json'],
  })), 'Repair commit blocked: protected paths changed: config/local.json.');

  assert.equal(repairResultCommitBlocker({
    ...cleanFixedResult(),
    humanVerification: { status: 'rejected' },
  }), 'Repair commit blocked: human verification status is rejected.');

  assert.equal(repairResultCommitBlocker(cleanFixedResult()), '');
});

test('safeRepoRelativePath rejects traversal and git internals while allowing ordinary repo paths', () => {
  assert.equal(safeRepoRelativePath('src/runtime/workspace-server.ts'), true);
  assert.equal(safeRepoRelativePath('./src/runtime/workspace-server.ts'), true);
  assert.equal(safeRepoRelativePath('src\\runtime\\workspace-server.ts'), true);
  assert.equal(safeRepoRelativePath(''), false);
  assert.equal(safeRepoRelativePath('.'), false);
  assert.equal(safeRepoRelativePath('..'), false);
  assert.equal(safeRepoRelativePath('../outside.txt'), false);
  assert.equal(safeRepoRelativePath('src/../outside.txt'), false);
  assert.equal(safeRepoRelativePath('.git/config'), false);
});

function cleanFixedResult(dirtyOverrides: Record<string, unknown> = {}) {
  return {
    verdict: 'fixed',
    metadata: {
      dirtyWorktreeCollaboration: {
        status: 'passed',
        changedProtectedPaths: [],
        changedForbiddenPaths: [],
        changedOutsideAllowedPaths: [],
        executorRepairPlan: { exists: true },
        commitAudit: { created: false },
        ...dirtyOverrides,
      },
    },
    humanVerification: { status: 'passed' },
  };
}

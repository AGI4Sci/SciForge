import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  effectiveRepairVerdict,
  formatRepairResultGithubComment,
  syncRepairResultToGithubIssue,
} from './github-repair-sync';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('formats repair result comments without inline screenshots or token leaks', () => {
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  const markdown = formatRepairResultGithubComment({
    id: 'repair-1',
    issueId: 'feedback-1',
    repairRunId: 'run-1',
    verdict: 'fixed',
    summary: `Fixed chart legend. ${token} data:image/png;base64,${'a'.repeat(120)}`,
    changedFiles: ['src/runtime/workspace-server.ts'],
    evidenceRefs: ['workspace://screenshots/legend.png'],
    testResults: [{ command: 'npm test', status: 'passed', summary: `passed ${token}` }],
    humanVerification: { status: 'verified', verifier: 'human-reviewer', conclusion: 'Looks correct.', evidenceRefs: ['workspace://screenshots/legend.png'], verifiedAt: '2026-05-07T01:01:00.000Z' },
    refs: { commitSha: 'abc123', prUrl: 'https://github.com/org/repo/pull/7', patchRef: 'patches/repair-1.patch' },
    executorInstance: { id: 'repair-a', name: 'Repair A' },
    targetInstance: { id: 'target-b', name: 'Target B' },
    followUp: 'Maintainer should review and close manually.',
    completedAt: '2026-05-07T01:00:00.000Z',
  });

  assert.match(markdown, /## SciForge Repair Result/);
  assert.match(markdown, /Changed Files/);
  assert.match(markdown, /Commit \/ PR \/ Patch Ref/);
  assert.doesNotMatch(markdown, /data:image\/png;base64/);
  assert.doesNotMatch(markdown, new RegExp(token));
  assert.match(markdown, /\[redacted dataUrl\]/);
  assert.match(markdown, /\[redacted github token\]/);
  assert.match(markdown, /Tests Summary/);
  assert.match(markdown, /Human Verification/);
  assert.match(markdown, /evidenceRefs: `workspace:\/\/screenshots\/legend\.png`/);
  assert.match(markdown, /不会自动关闭 GitHub Issue/);
});

test('fixed verdict without tests is downgraded for GitHub markdown', () => {
  assert.equal(effectiveRepairVerdict('fixed', []), 'needs-human-verification');
  const markdown = formatRepairResultGithubComment({
    id: 'repair-no-tests',
    issueId: 'feedback-no-tests',
    verdict: 'fixed',
    summary: 'Looks fixed, but no test evidence was supplied.',
    changedFiles: ['src/ui/src/feedback/FeedbackRepairAuditPanel.tsx'],
    evidenceRefs: [],
    completedAt: '2026-05-07T01:03:00.000Z',
  });

  assert.match(markdown, /\*\*Final verdict\*\*: `needs-human-verification`/);
  assert.match(markdown, /`missing` 未记录测试结果/);
  assert.doesNotMatch(markdown, /\*\*Final verdict\*\*: `fixed`/);
});

test('failed tests prevent a fixed repair verdict in GitHub markdown', () => {
  const tests = [{ command: 'npm test', status: 'failed' as const, summary: '1 failing test' }];
  assert.equal(effectiveRepairVerdict('fixed', tests), 'failed');
  const markdown = formatRepairResultGithubComment({
    id: 'repair-2',
    issueId: 'feedback-2',
    verdict: 'fixed',
    summary: 'Attempted fix.',
    changedFiles: ['src/ui/src/app.tsx'],
    evidenceRefs: [],
    testResults: tests,
    completedAt: '2026-05-07T01:05:00.000Z',
  });
  assert.match(markdown, /\*\*Final verdict\*\*: `failed`/);
  assert.doesNotMatch(markdown, /\*\*Final verdict\*\*: `fixed`/);
});

test('sync posts a GitHub issue comment and never sends token inside the body', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ html_url: 'https://github.com/org/repo/issues/42#issuecomment-1' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const outcome = await syncRepairResultToGithubIssue({
    issue: { issueNumber: 42, issueUrl: 'https://github.com/org/repo/issues/42' },
    config: { token: 'ghp_abcdefghijklmnopqrstuvwxyz123456' },
    result: {
      id: 'repair-3',
      issueId: 'feedback-3',
      verdict: 'fixed',
      summary: 'Done.',
      changedFiles: ['src/runtime/github-repair-sync.ts'],
      evidenceRefs: [],
      testResults: [{ command: 'npm test', status: 'passed' }],
      humanVerification: { status: 'verified' },
      completedAt: '2026-05-07T01:10:00.000Z',
    },
  });

  assert.equal(outcome.status, 'synced');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.github.com/repos/org/repo/issues/42/comments');
  assert.equal((requests[0].init?.headers as Record<string, string>).Authorization, 'Bearer ghp_abcdefghijklmnopqrstuvwxyz123456');
  const body = JSON.parse(String(requests[0].init?.body)) as { body: string };
  assert.doesNotMatch(body.body, /ghp_abcdefghijklmnopqrstuvwxyz123456/);
  assert.match(body.body, /请维护者复核后手动关闭 Issue/);
});

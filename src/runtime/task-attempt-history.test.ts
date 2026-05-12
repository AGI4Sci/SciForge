import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { appendTaskAttempt, readRecentTaskAttempts, readTaskAttempts } from './task-attempt-history.js';
import type { TaskAttemptRecord } from './runtime-types.js';

test('task attempts with a session bundle stay inside that bundle', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-task-attempts-'));
  const sessionBundleRef = '.sciforge/sessions/2026-05-12_literature_session-1';
  try {
    const attempt: TaskAttemptRecord = {
      id: 'agentserver-generation-literature-abc',
      prompt: 'review arxiv agent papers',
      skillDomain: 'literature',
      skillId: 'literature-agent',
      attempt: 1,
      status: 'failed-with-reason',
      failureReason: 'guarded test failure',
      createdAt: '2026-05-12T00:00:00.000Z',
      sessionId: 'session-1',
      sessionBundleRef,
    } as TaskAttemptRecord;

    const writtenPath = await appendTaskAttempt(workspace, attempt);
    assert.ok(writtenPath.includes(`${sessionBundleRef}/records/task-attempts/agentserver-generation-literature-abc.json`));
    await assert.rejects(stat(join(workspace, '.sciforge/task-attempts/agentserver-generation-literature-abc.json')));

    const direct = await readTaskAttempts(workspace, attempt.id);
    assert.equal(direct.length, 1);
    assert.equal(direct[0].sessionBundleRef, sessionBundleRef);
    assert.equal(direct[0].taskRunCard?.schemaVersion, 'sciforge.task-run-card.v1');
    assert.equal(direct[0].taskRunCard?.status, 'partial');
    assert.equal(direct[0].taskRunCard?.taskOutcome, 'needs-work');
    assert.equal(direct[0].taskRunCard?.noHardcodeReview.status, 'pass');
    assert.ok(direct[0].taskRunCard?.refs.some((ref) => ref.kind === 'bundle' && ref.ref === sessionBundleRef));
    assert.ok(direct[0].taskRunCard?.failureSignatures.some((signature) => signature.kind === 'unknown'));

    const recent = await readRecentTaskAttempts(workspace, 'literature', 4, { prompt: attempt.prompt });
    assert.equal(recent.length, 1);
    assert.equal(recent[0].id, attempt.id);
    assert.equal(recent[0].taskRunCard?.id, `task-card:${attempt.id}:1`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('task run cards separate protocol success from task outcome and keep failure signatures generic', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-task-cards-'));
  try {
    const attempt: TaskAttemptRecord = {
      id: 'agentserver-generation-code-abc',
      prompt: 'fix bug, run tests, and sync GitHub',
      skillDomain: 'literature',
      skillId: 'code-repair',
      attempt: 1,
      status: 'repair-needed',
      failureReason: 'HTTP Error 429: rate limited while fetching external issue metadata',
      codeRef: '.sciforge/generated-tasks/task.py',
      outputRef: '.sciforge/task-results/task.json',
      stdoutRef: '.sciforge/debug/task/stdout.log',
      stderrRef: '.sciforge/debug/task/stderr.log',
      exitCode: 1,
      schemaErrors: ['missing required field artifacts[0].id'],
      createdAt: '2026-05-12T00:00:00.000Z',
    } as TaskAttemptRecord;

    await appendTaskAttempt(workspace, attempt);
    const [stored] = await readTaskAttempts(workspace, attempt.id);
    const card = stored?.taskRunCard;

    assert.equal(card?.protocolStatus, 'protocol-failed');
    assert.equal(card?.taskOutcome, 'needs-work');
    assert.equal(card?.status, 'partial');
    assert.equal(card?.genericAttributionLayer, 'external-provider');
    assert.ok(card?.refs.some((ref) => ref.kind === 'artifact' && ref.ref === attempt.outputRef));
    assert.ok(card?.failureSignatures.some((signature) => signature.kind === 'external-transient'));
    assert.ok(card?.failureSignatures.some((signature) => signature.kind === 'schema-drift'));
    assert.match(card?.nextStep ?? '', /provider backoff|cached evidence/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

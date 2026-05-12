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

    const recent = await readRecentTaskAttempts(workspace, 'literature', 4, { prompt: attempt.prompt });
    assert.equal(recent.length, 1);
    assert.equal(recent[0].id, attempt.id);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

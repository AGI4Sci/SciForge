import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { appendTaskAttempt, readRecentTaskAttempts, readTaskAttempts } from './task-attempt-history.js';
import { readFailureSignatureRegistry } from './failure-signature-registry.js';
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
    assert.equal(direct[0].sessionBundleAudit?.ready, false);
    assert.ok(direct[0].taskRunCard?.refs.some((ref) => ref.kind === 'bundle' && ref.ref === sessionBundleRef));
    assert.ok(direct[0].taskRunCard?.refs.some((ref) => ref.kind === 'verification' && ref.ref.endsWith('/records/session-bundle-audit.json')));
    assert.ok(direct[0].taskRunCard?.failureSignatures.some((signature) => signature.kind === 'unknown'));
    const audit = JSON.parse(await readFile(join(workspace, sessionBundleRef, 'records/session-bundle-audit.json'), 'utf8'));
    assert.equal(audit.bundleRel, sessionBundleRef);

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
      failureCode: 'rate-limit',
      httpStatus: 429,
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
    assert.ok(card?.ownershipLayerSuggestions.some((suggestion) => suggestion.layer === 'external-provider'));
    assert.ok(card?.ownershipLayerSuggestions.some((suggestion) => suggestion.layer === 'payload-normalization'));
    assert.ok(card?.refs.some((ref) => ref.kind === 'artifact' && ref.ref === attempt.outputRef));
    assert.ok(card?.failureSignatures.some((signature) => signature.kind === 'external-transient'));
    assert.ok(card?.failureSignatures.some((signature) => signature.kind === 'schema-drift'));
    assert.match(card?.nextStep ?? '', /provider backoff|cached evidence/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('task attempts suggest ownership layers from generic runtime metadata', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-task-ownership-'));
  try {
    const attempt: TaskAttemptRecord = {
      id: 'profiled-runtime-attempt',
      prompt: 'run a task and present the result',
      skillDomain: 'knowledge',
      skillId: 'generic-task',
      runtimeProfileId: 'debug-repair',
      uiPlanRef: '.sciforge/ui-plans/result.json',
      routeDecision: {
        selectedRuntime: 'agentserver',
        fallbackReason: 'primary runtime returned recoverable diagnostics',
        selectedAt: '2026-05-12T00:00:00.000Z',
      },
      attempt: 1,
      status: 'record-only',
      outputRef: '.sciforge/task-results/result.json',
      createdAt: '2026-05-12T00:00:00.000Z',
    } as TaskAttemptRecord;

    await appendTaskAttempt(workspace, attempt);
    const [stored] = await readTaskAttempts(workspace, attempt.id);
    const suggestions = stored?.taskRunCard?.ownershipLayerSuggestions ?? [];

    assert.ok(suggestions.some((suggestion) => suggestion.layer === 'harness' && suggestion.signals.includes('runtimeProfileId:debug-repair')));
    assert.ok(suggestions.some((suggestion) => suggestion.layer === 'presentation' && suggestion.signals.includes(`uiPlanRef:${attempt.uiPlanRef}`)));
    assert.ok(suggestions.some((suggestion) => suggestion.signals.some((signal) => signal.startsWith('routeFallback:'))));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('task attempt history records a run-level failure signature registry across runs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-failure-signature-registry-'));
  try {
    const base = {
      prompt: 'run a reusable task and preserve diagnostics',
      skillDomain: 'knowledge',
      skillId: 'generic-task-runner',
      status: 'repair-needed',
      outputRef: '.sciforge/task-results/task.json',
      stderrRef: '.sciforge/debug/task/stderr.log',
    } satisfies Partial<TaskAttemptRecord>;

    await appendTaskAttempt(workspace, {
      ...base,
      id: 'schema-run-a',
      attempt: 1,
      schemaErrors: ['missing required field artifacts[0].id'],
      createdAt: '2026-05-12T00:00:00.000Z',
    } as TaskAttemptRecord);
    await appendTaskAttempt(workspace, {
      ...base,
      id: 'schema-run-b',
      attempt: 1,
      schemaErrors: ['missing required field artifacts[9].id'],
      createdAt: '2026-05-12T00:01:00.000Z',
    } as TaskAttemptRecord);
    await appendTaskAttempt(workspace, {
      ...base,
      id: 'timeout-run',
      attempt: 1,
      failureCode: 'timeout',
      failureReason: 'AgentServer generation request timed out after 30000ms.',
      createdAt: '2026-05-12T00:02:00.000Z',
    } as TaskAttemptRecord);
    await appendTaskAttempt(workspace, {
      ...base,
      id: 'repair-noop-run',
      attempt: 1,
      failureCode: 'repair-no-op',
      failureReason: 'Repair no-op: repeated same failure with no change.',
      createdAt: '2026-05-12T00:03:00.000Z',
    } as TaskAttemptRecord);
    await appendTaskAttempt(workspace, {
      ...base,
      id: 'external-transient-run',
      attempt: 1,
      failureCode: 'rate-limit',
      httpStatus: 429,
      failureReason: 'HTTP Error 429: rate limited for request 12345.',
      createdAt: '2026-05-12T00:04:00.000Z',
    } as TaskAttemptRecord);
    await appendTaskAttempt(workspace, {
      ...base,
      id: 'external-transient-run',
      attempt: 1,
      failureCode: 'rate-limit',
      httpStatus: 429,
      failureReason: 'HTTP Error 429: rate limited for request 12345.',
      createdAt: '2026-05-12T00:04:00.000Z',
    } as TaskAttemptRecord);

    const registry = await readFailureSignatureRegistry(workspace);
    const schema = registry.entries.find((entry) => entry.kind === 'schema-drift');
    const external = registry.entries.find((entry) => entry.kind === 'external-transient');

    assert.equal(registry.schemaVersion, 'sciforge.failure-signature-registry.v1');
    assert.deepEqual(registry.entries.map((entry) => entry.kind).sort(), [
      'external-transient',
      'repair-no-op',
      'schema-drift',
      'timeout',
    ]);
    assert.equal(schema?.occurrenceCount, 2);
    assert.deepEqual(schema?.runRefs.map((ref) => ref.runId).sort(), [
      'task-attempt:schema-run-a:1',
      'task-attempt:schema-run-b:1',
    ]);
    assert.equal(external?.occurrenceCount, 1);
    assert.equal(external?.runRefs[0]?.runId, 'task-attempt:external-transient-run:1');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('task attempt history hydrates ConversationProjection summary from task output', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-task-conversation-projection-'));
  try {
    const outputRef = '.sciforge/task-results/failed-run.json';
    await mkdir(join(workspace, '.sciforge/task-results'), { recursive: true });
    await writeFile(join(workspace, outputRef), JSON.stringify({
      displayIntent: {
        conversationProjection: {
          schemaVersion: 'sciforge.conversation-projection.v1',
          conversationId: 'conversation:failed-run',
          visibleAnswer: {
            status: 'repair-needed',
            diagnostic: 'Verifier failed release gate for missing evidence.',
            artifactRefs: ['.sciforge/task-results/failed-run.json'],
          },
          activeRun: { id: 'run:failed-run', status: 'repair-needed' },
          recoverActions: ['Supplement verifier evidence before presenting as verified.'],
          verificationState: { status: 'failed', verifierRef: 'verification:release-gate', verdict: 'failed' },
          backgroundState: {
            status: 'running',
            checkpointRefs: ['.sciforge/checkpoints/failed-run.json'],
            revisionPlan: 'Continue verifier repair.',
          },
          diagnostics: [{
            severity: 'error',
            code: 'verification',
            message: 'Verifier failed release gate for missing evidence.',
            refs: [{ ref: '.sciforge/debug/failed-run.stderr.log' }],
          }],
          artifacts: [],
          executionProcess: [],
          auditRefs: [],
        },
      },
    }), 'utf8');

    const attempt: TaskAttemptRecord = {
      id: 'failed-run-with-conversation-projection',
      prompt: 'verify report and preserve recovery state',
      skillDomain: 'knowledge',
      skillId: 'generic-task',
      attempt: 1,
      status: 'repair-needed',
      outputRef,
      stderrRef: '.sciforge/debug/failed-run.stderr.log',
      createdAt: '2026-05-12T00:00:00.000Z',
    } as TaskAttemptRecord;

    await appendTaskAttempt(workspace, attempt);
    const [stored] = await readTaskAttempts(workspace, attempt.id);
    const summary = stored?.taskRunCard?.conversationProjectionSummary;

    assert.equal(stored?.taskRunCard?.conversationProjectionRef, `${outputRef}#displayIntent.conversationProjection`);
    assert.equal(summary?.failureOwner?.ownerLayer, 'verification');
    assert.equal(summary?.verificationState?.status, 'failed');
    assert.equal(summary?.backgroundState?.status, 'running');
    assert.ok(stored?.taskRunCard?.ownershipLayerSuggestions.some((suggestion) => suggestion.layer === 'verification' && suggestion.confidence === 'high'));
    assert.ok(stored?.taskRunCard?.failureSignatures.some((signature) => signature.layer === 'verification'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

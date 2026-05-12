import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildComplexMultiturnRuntimeReplayReport } from '../../tests/harness/complexMultiturnRuntimeReplay';
import { createRuntimeEventRecorder, normalizeRuntimeEventForRecord } from './runtime-event-recorder.js';
import type { WorkspaceRuntimeEvent } from './runtime-types';

test('normalizes runtime events with stable recorder metadata', () => {
  const normalized = normalizeRuntimeEventForRecord({
    type: 'resume-preflight',
    message: 'Resume-preflight completed.',
    raw: { refs: ['artifact:report', 'run:r1'] },
  }, {
    index: 3,
    now: () => new Date('2026-05-12T00:00:00.000Z'),
    runId: 'run:r1',
    sessionId: 'session-1',
    sessionBundleRef: '.sciforge/sessions/2026-05-12_demo_session-1',
  });

  assert.equal((normalized.raw as Record<string, unknown>).id, 'resume-preflight-3');
  assert.equal((normalized.raw as Record<string, unknown>).timestamp, '2026-05-12T00:00:00.000Z');
  assert.equal((normalized.raw as Record<string, unknown>).runId, 'run:r1');
  assert.equal((normalized.raw as Record<string, unknown>).sessionId, 'session-1');
});

test('records runtime events as session NDJSON consumable by complex multiturn replay', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-runtime-recorder-'));
  try {
    const forwarded: WorkspaceRuntimeEvent[] = [];
    const recorder = createRuntimeEventRecorder({
      onEvent: (event) => forwarded.push(event),
    }, {
      workspacePath: workspace,
      sessionBundleRef: '.sciforge/sessions/2026-05-12_demo_session-1',
      sessionId: 'session-1',
      runId: 'run:r1',
      now: () => new Date('2026-05-12T00:00:00.000Z'),
    });

    recorder.callbacks.onEvent?.(event('resume-preflight', 'Resume-preflight completed.', ['artifact:report', 'run:r1', 'execution-unit:resume'], 'completed'));
    recorder.callbacks.onEvent?.(event('first-readable-result', 'Partial first result.', ['artifact:report', 'trace:r1'], 'partial'));
    recorder.callbacks.onEvent?.(event('failure', 'Recoverable timeout failure.', ['run:r1', 'stderr:r1'], 'failed'));
    recorder.callbacks.onEvent?.(event('recovery-plan', 'Recovery-plan keeps writes idempotent.', ['artifact:report', 'raw:recovery'], 'completed'));
    recorder.callbacks.onEvent?.(event('history-branch-record', 'History branch record retained refs.', ['artifact:report', 'run:r1'], 'completed'));
    recorder.callbacks.onEvent?.(event('side-effect-guard', 'Side effect guard confirmed idempotent resume.', ['execution-unit:resume', 'trace:side-effect'], 'completed'));
    await recorder.flush();

    assert.equal(forwarded.length, 6);
    assert.equal(recorder.runtimeEventsRef, '.sciforge/sessions/2026-05-12_demo_session-1/records/runtime-events.ndjson');
    const content = await readFile(join(workspace, recorder.runtimeEventsRef), 'utf8');
    const events = content.trim().split('\n').map((line) => JSON.parse(line) as WorkspaceRuntimeEvent);
    assert.equal(events.length, 6);
    assert.equal((events[0]?.raw as Record<string, unknown>).sessionId, 'session-1');
    assert.equal((events[0]?.raw as Record<string, unknown>).runId, 'run:r1');

    const report = buildComplexMultiturnRuntimeReplayReport({
      events,
      generatedAt: '2026-05-12T00:00:00.000Z',
    });
    assert.equal(report.metrics.resumeCorrectness, true);
    assert.equal(report.metrics.recoverySuccess, true);
    assert.equal(report.metrics.historyMutationCorrectness, true);
    assert.equal(report.metrics.sideEffectDuplicationPrevented, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function event(type: string, message: string, refs: string[], status: string): WorkspaceRuntimeEvent {
  return {
    type,
    message,
    status,
    source: 'workspace-runtime',
    raw: { refs, status },
  };
}

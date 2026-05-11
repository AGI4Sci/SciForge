import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildComplexMultiturnRuntimeReplayReport,
  buildComplexMultiturnRuntimeReplayReportFromBundle,
} from '../../../tests/harness/complexMultiturnRuntimeReplay';
import type { GatewayRequest, WorkspaceRuntimeEvent } from '../runtime-types.js';
import { applyRuntimeReplayRecorder, runtimeReplayRecorderOptionsFromRequest } from './runtime-replay-recorder.js';

test('runtime replay recorder is disabled by default and does not write events', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-gateway-runtime-replay-disabled-'));
  try {
    const forwarded: WorkspaceRuntimeEvent[] = [];
    const callbacks = { onEvent: (runtimeEvent: WorkspaceRuntimeEvent) => forwarded.push(runtimeEvent) };
    const request = baseRequest({ workspacePath: workspace });
    const application = applyRuntimeReplayRecorder(callbacks, request);

    assert.equal(application.enabled, false);
    assert.deepEqual(application.plan, { enabled: false, reason: 'not-enabled' });
    assert.equal(application.reason, 'not-enabled');
    assert.equal(application.callbacks, callbacks);
    assert.equal(application.runtimeEventsRef, undefined);
    assert.equal(application.sessionBundleRef, undefined);
    assert.equal(application.flush, undefined);

    application.callbacks.onEvent?.(event('resume-preflight', 'Resume-preflight completed.', ['artifact:report'], 'completed'));
    assert.equal(forwarded.length, 1);
    await assert.rejects(access(join(workspace, '.sciforge')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runtime replay recorder requires a workspace path before writing events', () => {
  const request = baseRequest({
    workspacePath: undefined,
    uiState: {
      runtimeReplayRecorder: { enabled: true },
      sessionId: 'session-1',
    },
  });
  const application = applyRuntimeReplayRecorder({}, request);

  assert.equal(application.enabled, false);
  assert.deepEqual(application.plan, { enabled: false, reason: 'missing-workspace' });
  assert.equal(application.reason, 'missing-workspace');
  assert.equal(application.flush, undefined);
});

test('runtime replay recorder ignores request-supplied output refs', () => {
  const request = baseRequest({
    uiState: {
      sessionId: 'session-1',
      runtimeReplayRecorder: {
        enabled: true,
        sessionBundleRef: '../../outside',
        runtimeEventsRef: '../outside.ndjson',
        recordRel: '/tmp/outside.ndjson',
      },
    },
  });
  const options = runtimeReplayRecorderOptionsFromRequest(request);

  assert.equal(options.enabled, true);
  assert.equal(options.sessionBundleRef, undefined);
  assert.equal(options.runtimeEventsRef, undefined);
});

test('runtime replay recorder opt-in writes forwarded events to session NDJSON', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-gateway-runtime-replay-'));
  try {
    const forwarded: WorkspaceRuntimeEvent[] = [];
    const request = baseRequest({
      workspacePath: workspace,
      uiState: {
        sessionId: 'session-1',
        activeRunId: 'run:r1',
        sessionCreatedAt: '2026-05-12T00:00:00.000Z',
        runtimeReplayRecorder: { enabled: true },
      },
    });
    const options = runtimeReplayRecorderOptionsFromRequest(request);
    const application = applyRuntimeReplayRecorder({
      onEvent: (event) => forwarded.push(event),
    }, request, {
      ...options,
      now: () => new Date('2026-05-12T00:00:00.000Z'),
    });

    assert.equal(application.enabled, true);
    assert.deepEqual(application.plan, {
      enabled: true,
      sessionBundleRef: '.sciforge/sessions/2026-05-12_literature_session-1',
      runtimeEventsRef: '.sciforge/sessions/2026-05-12_literature_session-1/records/runtime-events.ndjson',
    });
    assert.equal(application.sessionBundleRef, '.sciforge/sessions/2026-05-12_literature_session-1');
    assert.equal(application.runtimeEventsRef, '.sciforge/sessions/2026-05-12_literature_session-1/records/runtime-events.ndjson');

    application.callbacks.onEvent?.(event('resume-preflight', 'Resume-preflight completed.', ['artifact:report', 'run:r1', 'execution-unit:resume'], 'completed'));
    application.callbacks.onEvent?.(event('first-readable-result', 'Partial first result.', ['artifact:report', 'trace:r1'], 'partial'));
    application.callbacks.onEvent?.(event('failure', 'Recoverable timeout failure.', ['run:r1', 'stderr:r1'], 'failed'));
    application.callbacks.onEvent?.(event('recovery-plan', 'Recovery-plan keeps writes idempotent.', ['artifact:report', 'raw:recovery'], 'completed'));
    application.callbacks.onEvent?.(event('history-branch-record', 'History branch record retained refs.', ['artifact:report', 'run:r1'], 'completed'));
    application.callbacks.onEvent?.(event('side-effect-guard', 'Side effect guard confirmed idempotent resume.', ['execution-unit:resume', 'trace:side-effect'], 'completed'));
    await application.flush?.();

    assert.equal(forwarded.length, 6);
    const content = await readFile(join(workspace, application.runtimeEventsRef ?? ''), 'utf8');
    const events = content.trim().split('\n').map((line) => JSON.parse(line) as WorkspaceRuntimeEvent);
    assert.equal(events.length, 6);
    assert.equal((events[0]?.raw as Record<string, unknown>).sessionId, 'session-1');
    assert.equal((events[0]?.raw as Record<string, unknown>).runId, 'run:r1');
    assert.equal((events[0]?.raw as Record<string, unknown>).sessionBundleRef, application.sessionBundleRef);

    const report = buildComplexMultiturnRuntimeReplayReport({
      events,
      generatedAt: '2026-05-12T00:00:00.000Z',
    });
    assert.equal(report.metrics.resumeCorrectness, true);
    assert.equal(report.metrics.recoverySuccess, true);
    assert.equal(report.metrics.historyMutationCorrectness, true);
    assert.equal(report.metrics.sideEffectDuplicationPrevented, true);

    const bundleReport = buildComplexMultiturnRuntimeReplayReportFromBundle({
      schemaVersion: 'sciforge.session-bundle.v1',
      sessionId: 'session-1',
      records: { runtimeEvents: events },
    }, {
      generatedAt: '2026-05-12T00:00:00.000Z',
      sourceKind: 'session-runtime-events',
    });
    assert.equal(bundleReport.source.kind, 'session-runtime-events');
    assert.equal(bundleReport.source.eventCount, events.length);
    assert.equal(bundleReport.metrics.artifactReferenceAccuracy, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function baseRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt: 'Continue the long research task.',
    workspacePath: '/tmp/sciforge-workspace',
    artifacts: [],
    uiState: {},
    ...overrides,
  };
}

function event(type: string, message: string, refs: string[], status: string): WorkspaceRuntimeEvent {
  return {
    type,
    message,
    status,
    source: 'workspace-runtime',
    raw: { refs, status },
  };
}

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildComplexMultiturnRuntimeReplayReport,
  buildComplexMultiturnRuntimeReplayReportFromBundle,
} from '../../../tests/harness/complexMultiturnRuntimeReplay';
import { runWorkspaceRuntimeGateway } from '../workspace-runtime-gateway.js';
import type { GatewayRequest, WorkspaceRuntimeEvent } from '../runtime-types.js';
import {
  RUNTIME_REPLAY_RECORDER_LOG_KIND,
  applyRuntimeReplayRecorder,
  attachRuntimeReplayRecorderRefs,
  runtimeReplayRecorderOptionsFromRequest,
} from './runtime-replay-recorder.js';

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

test('runtime replay recorder refs are attached to opted-in payloads', () => {
  const request = baseRequest({
    uiState: {
      sessionId: 'session-1',
      sessionCreatedAt: '2026-05-12T00:00:00.000Z',
      runtimeReplayRecorder: { enabled: true },
    },
  });
  const application = applyRuntimeReplayRecorder({}, request);
  const payload = attachRuntimeReplayRecorderRefs(basePayload(), application);

  assert.equal(payload.logs?.some((log) =>
    log.kind === RUNTIME_REPLAY_RECORDER_LOG_KIND
    && log.ref === '.sciforge/sessions/2026-05-12_literature_session-1/records/runtime-events.ndjson'
  ), true);
  assert.equal(payload.workEvidence?.some((entry) =>
    entry.provider === 'sciforge-runtime'
    && entry.rawRef === '.sciforge/sessions/2026-05-12_literature_session-1/records/runtime-events.ndjson'
  ), true);
});

test('workspace gateway records runtime replay events only when explicitly opted in', async () => {
  const disabledWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-gateway-runtime-replay-disabled-e2e-'));
  const enabledWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-gateway-runtime-replay-enabled-e2e-'));
  try {
    const disabled = await runWorkspaceRuntimeGateway(directContextGatewayBody(disabledWorkspace, {
      sessionId: 'session-gateway-disabled',
      sessionCreatedAt: '2026-05-12T00:00:00.000Z',
    }));
    assert.equal(disabled.logs?.some((log) => log.kind === RUNTIME_REPLAY_RECORDER_LOG_KIND), false);
    await assert.rejects(readFile(join(
      disabledWorkspace,
      '.sciforge/sessions/2026-05-12_literature_session-gateway-disabled/records/runtime-events.ndjson',
    ), 'utf8'));

    const forwarded: WorkspaceRuntimeEvent[] = [];
    const enabled = await runWorkspaceRuntimeGateway(directContextGatewayBody(enabledWorkspace, {
      sessionId: 'session-gateway-enabled',
      activeRunId: 'run:gateway-enabled',
      sessionCreatedAt: '2026-05-12T00:00:00.000Z',
      runtimeReplayRecorder: { enabled: true },
    }), { onEvent: (event) => forwarded.push(event) });

    const runtimeEventsRef = '.sciforge/sessions/2026-05-12_literature_session-gateway-enabled/records/runtime-events.ndjson';
    assert.equal(enabled.logs?.some((log) => log.kind === RUNTIME_REPLAY_RECORDER_LOG_KIND && log.ref === runtimeEventsRef), true);
    assert.equal(enabled.workEvidence?.some((entry) => entry.rawRef === runtimeEventsRef), true);
    assert.equal(forwarded.some((event) => event.type === 'gateway-request-received'), true);
    assert.equal(forwarded.some((event) => event.type === 'latency-diagnostics'), true);

    const content = await readFile(join(enabledWorkspace, runtimeEventsRef), 'utf8');
    const events = content.trim().split('\n').map((line) => JSON.parse(line) as WorkspaceRuntimeEvent);
    assert.equal(events.some((entry) => entry.type === 'gateway-request-received'), true);
    assert.equal(events.some((entry) => entry.type === 'latency-diagnostics'), true);
    assert.equal((events[0]?.raw as Record<string, unknown>).sessionId, 'session-gateway-enabled');
    assert.equal((events[0]?.raw as Record<string, unknown>).runId, 'run:gateway-enabled');
  } finally {
    await rm(disabledWorkspace, { recursive: true, force: true });
    await rm(enabledWorkspace, { recursive: true, force: true });
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

function basePayload() {
  return {
    message: 'ok',
    confidence: 0.8,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'direct',
    claims: [],
    uiManifest: [],
    executionUnits: [],
    artifacts: [],
  };
}

function directContextGatewayBody(workspacePath: string, uiState: Record<string, unknown>) {
  return {
    skillDomain: 'literature',
    prompt: 'Summarize the existing artifact without starting new work.',
    workspacePath,
    agentServerBaseUrl: 'http://agentserver.example.test',
    artifacts: [{
      id: 'summary-report',
      type: 'report',
      artifactType: 'report',
      producerScenario: 'literature',
      schemaVersion: '1',
      dataRef: '.sciforge/artifacts/summary-report.md',
      data: {
        markdown: 'Existing result: the benchmark already captured a stable partial answer.',
      },
    }],
    uiState: {
      ...uiState,
      agentHarness: {
        contract: {
          intentMode: 'audit',
          capabilityPolicy: {
            preferredCapabilityIds: ['runtime.direct-context-answer'],
          },
        },
      },
      executionModePlan: { executionMode: 'direct-context-answer' },
      responsePlan: { initialResponseMode: 'direct-context-answer' },
      latencyPolicy: { blockOnContextCompaction: false },
      recentExecutionRefs: [{
        id: 'unit-summary',
        status: 'done',
        outputRef: '.sciforge/task-results/summary.json',
      }],
    },
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

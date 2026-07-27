import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { deriveTraceId, type TraceEvent } from '@sciforge/full-trace';

import { createBuiltInPlanAdapterRegistry } from './adapters';
import type { PlanGatewayEvent } from './contract';
import { PlanGatewayTraceRecorder, createPlanGatewayTraceCapture } from './trace-sink';

const NOW = new Date('2026-07-19T08:00:00.000Z');

test('records concurrent Codex requests with Agent-compatible correlation and no cross-talk', async () => {
  const storageDirectory = await mkdtemp(path.join(tmpdir(), 'sciforge-plan-trace-'));
  try {
    const capture = await createPlanGatewayTraceCapture({
      adapterRegistry: createBuiltInPlanAdapterRegistry(),
      storageDirectory,
      now: () => NOW,
    });
    const requestA = codexRequestBody({
      runtimeId: 'codex',
      guiThreadId: 'gui-thread-a',
      nativeTurnId: 'native-turn-a',
      input: 'Use sk-live-0123456789abcdef without exposing it.',
      extraMetadata: {
        session_id: 'native-session-a',
        thread_id: 'native-thread-a',
        window_id: 'native-window-a',
        trace_id: 'ignored-custom-trace',
        gui_turn_id: 'ignored-custom-turn',
        authorization: 'Bearer metadata-auth-secret',
        cookie: 'session=metadata-cookie-secret',
        api_key: 'sk-metadata-0123456789abcdef',
      },
    });
    const requestB = codexRequestBody({
      runtimeId: 'codex',
      guiThreadId: 'gui-thread-b',
      nativeTurnId: 'native-turn-b',
      input: 'Second request',
    });

    await capture.recorder.record(requestStart(
      'request-a',
      'Bearer opaque-split-secret-a',
      {
        requestId: 'request-a',
        traceId: 'forged-header-trace',
        runtimeId: 'forged-header-runtime',
        threadId: 'forged-header-thread',
        turnId: 'forged-header-turn',
      },
    ));
    await capture.recorder.record(requestStart('request-b', 'Bearer opaque-split-secret-b'));
    await capture.recorder.record(requestChunk('request-a', requestA.subarray(0, 23), 1));
    await capture.recorder.record(requestChunk('request-b', requestB, 2));
    await capture.recorder.record(requestChunk('request-a', requestA.subarray(23), 3));
    await Promise.all([
      capture.recorder.record(requestEnd('request-a', 4)),
      capture.recorder.record(requestEnd('request-b', 5)),
    ]);

    await capture.recorder.record(responseStart('request-a', 6));
    await capture.recorder.record(responseStart('request-b', 7));
    await capture.recorder.record(responseChunk('request-a', 'echo opaque-split-', 8));
    await capture.recorder.record(responseChunk('request-b', 'second response', 9));
    await capture.recorder.record(responseChunk('request-a', 'secret-a complete session=stripped-secret', 10));
    await Promise.all([
      capture.recorder.record(responseEnd('request-a', 11)),
      capture.recorder.record(responseEnd('request-b', 12)),
    ]);

    const { events } = await capture.store.read({ order: 'asc' });
    const eventsA = events.filter((event) => event.requestId === 'request-a');
    const eventsB = events.filter((event) => event.requestId === 'request-b');
    const expectedTraceA = deriveTraceId({
      runtimeId: 'codex',
      threadId: 'gui-thread-a',
      turnId: 'native-turn-a',
    });
    const expectedTraceB = deriveTraceId({
      runtimeId: 'codex',
      threadId: 'gui-thread-b',
      turnId: 'native-turn-b',
    });

    assert.notEqual(expectedTraceA, expectedTraceB);
    assert.ok(eventsA.length > 0);
    assert.ok(eventsB.length > 0);
    assert.ok(eventsA.every((event) => event.traceId === expectedTraceA));
    assert.ok(eventsB.every((event) => event.traceId === expectedTraceB));
    assert.ok(eventsA.every((event) => event.runtimeId === 'codex'));
    assert.ok(eventsA.every((event) => event.threadId === 'gui-thread-a'));
    assert.ok(eventsA.every((event) => event.turnId === 'native-turn-a'));
    assert.ok(eventsB.every((event) => event.threadId === 'gui-thread-b'));
    assert.ok(eventsB.every((event) => event.turnId === 'native-turn-b'));

    const modelRequestA = onlyEvent(eventsA, 'model_request');
    const requestPayload = recordValue(modelRequestA.payload);
    const parsedBody = recordValue(requestPayload.body);
    const clientMetadata = recordValue(parsedBody.client_metadata);
    const turnMetadata = recordValue(clientMetadata['x-codex-turn-metadata']);
    assert.equal(turnMetadata.session_id, 'native-session-a');
    assert.equal(turnMetadata.thread_id, 'native-thread-a');
    assert.equal(turnMetadata.turn_id, 'native-turn-a');
    assert.equal(turnMetadata.window_id, 'native-window-a');
    assert.equal(turnMetadata.runtime_id, 'codex');
    assert.equal(turnMetadata.gui_thread_id, 'gui-thread-a');
    assert.equal(turnMetadata.trace_id, 'ignored-custom-trace');
    assert.equal(turnMetadata.gui_turn_id, 'ignored-custom-turn');
    assert.equal(turnMetadata.authorization, '[REDACTED]');
    assert.equal(turnMetadata.cookie, '[REDACTED]');
    assert.equal(turnMetadata.api_key, '[REDACTED]');
    assert.equal(recordValue(requestPayload.headers).authorization, '[REDACTED]');
    assert.equal(requestPayload.byteLength, requestA.byteLength);
    assert.deepEqual(requestPayload.chunkByteLengths, [23, requestA.byteLength - 23]);

    const responseBodies = eventsA
      .filter((event) => event.kind === 'model_response_chunk')
      .map((event) => String(recordValue(event.payload).body));
    assert.equal(responseBodies.length, 2);
    assert.match(responseBodies.join(''), /\[REDACTED\]/);
    assert.deepEqual(
      eventsA
        .filter((event) => event.kind === 'model_response_chunk')
        .map((event) => recordValue(event.payload).index),
      [0, 1],
    );

    const rawTrace = await readTraceSegments(storageDirectory);
    for (const forbidden of [
      'opaque-split-secret-a',
      'opaque-split-secret-b',
      'sk-live-0123456789abcdef',
      'upstream-private',
      'session=stripped-secret',
      'metadata-auth-secret',
      'metadata-cookie-secret',
      'sk-metadata-0123456789abcdef',
    ]) {
      assert.doesNotMatch(rawTrace, new RegExp(forbidden));
    }
    assert.deepEqual(capture.recorder.activeSensitiveValues(), []);
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

test('records a partial request and structured error while clearing request-scoped secrets', async () => {
  const storageDirectory = await mkdtemp(path.join(tmpdir(), 'sciforge-plan-error-trace-'));
  try {
    const capture = await createPlanGatewayTraceCapture({
      adapterRegistry: createBuiltInPlanAdapterRegistry(),
      storageDirectory,
      now: () => NOW,
    });
    const body = codexRequestBody({
      runtimeId: 'codex',
      guiThreadId: 'gui-error-thread',
      nativeTurnId: 'native-error-turn',
      input: 'partial body',
      encodedMetadata: '{invalid metadata containing private-value}',
    });
    await capture.recorder.record(requestStart('request-error', 'Bearer private-value'));
    await capture.recorder.record(requestChunk('request-error', body, 1));
    await capture.recorder.record({
      type: 'request.error',
      requestId: 'request-error',
      code: 'PLAN_REQUEST_ABORTED',
      durationMs: 17,
      at: time(2),
    });

    const { events } = await capture.store.read({ requestId: 'request-error', order: 'asc' });
    assert.equal(events.length, 2);
    const modelRequest = onlyEvent(events, 'model_request');
    assert.equal(recordValue(modelRequest.payload).partial, true);
    assert.doesNotMatch(String(recordValue(modelRequest.payload).body), /x-codex-turn-metadata|private-value/);
    const errorEvent = onlyEvent(events, 'error');
    assert.deepEqual(recordValue(errorEvent.payload), {
      name: 'PlanGatewayForwardError',
      message: 'Coding plan forwarding failed.',
      code: 'PLAN_REQUEST_ABORTED',
      stage: 'forward',
      retryable: false,
      durationMs: 17,
    });
    assert.deepEqual(capture.recorder.activeSensitiveValues(), []);
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

test('clears request-scoped secrets even when durable trace persistence fails', async () => {
  const failure = new Error('trace disk unavailable');
  const recorder = new PlanGatewayTraceRecorder({
    adapterRegistry: createBuiltInPlanAdapterRegistry(),
    store: {
      append: async () => { throw failure; },
      appendMany: async () => { throw failure; },
    },
  });
  await recorder.record(requestStart('request-failure', 'Bearer transient-secret'));
  await assert.rejects(
    recorder.record({
      type: 'request.error',
      requestId: 'request-failure',
      code: 'PLAN_UPSTREAM_UNAVAILABLE',
      durationMs: 1,
      at: time(1),
    }),
    failure,
  );
  assert.deepEqual(recorder.activeSensitiveValues(), []);
});

function requestStart(
  requestId: string,
  authorization: string,
  correlation: Extract<PlanGatewayEvent, { type: 'request.start' }>['correlation'] = { requestId },
): PlanGatewayEvent {
  return {
    type: 'request.start',
    requestId,
    adapterId: 'codex',
    method: 'POST',
    path: '/v1/responses?stream=true&cursor=next',
    headers: [
      ['authorization', authorization],
      ['content-type', 'application/json'],
    ],
    sensitiveValues: ['session=stripped-secret'],
    correlation,
    at: time(0),
  };
}

function requestChunk(requestId: string, chunk: Uint8Array, second: number): PlanGatewayEvent {
  return { type: 'request.chunk', requestId, chunk, at: time(second) };
}

function requestEnd(requestId: string, second: number): PlanGatewayEvent {
  return { type: 'request.end', requestId, at: time(second) };
}

function responseStart(requestId: string, second: number): PlanGatewayEvent {
  return {
    type: 'response.start',
    requestId,
    status: 200,
    headers: [
      ['content-type', 'text/event-stream'],
      ['set-cookie', 'session=upstream-private'],
    ],
    at: time(second),
  };
}

function responseChunk(requestId: string, body: string, second: number): PlanGatewayEvent {
  return { type: 'response.chunk', requestId, chunk: Buffer.from(body), at: time(second) };
}

function responseEnd(requestId: string, second: number): PlanGatewayEvent {
  return { type: 'response.end', requestId, durationMs: second * 10, at: time(second) };
}

function codexRequestBody(options: {
  runtimeId: string;
  guiThreadId: string;
  nativeTurnId: string;
  input: string;
  extraMetadata?: Record<string, string>;
  encodedMetadata?: string;
}): Buffer {
  const encodedMetadata = options.encodedMetadata ?? JSON.stringify({
    runtime_id: options.runtimeId,
    gui_thread_id: options.guiThreadId,
    turn_id: options.nativeTurnId,
    ...options.extraMetadata,
  });
  return Buffer.from(JSON.stringify({
    model: 'codex-model',
    input: options.input,
    client_metadata: { 'x-codex-turn-metadata': encodedMetadata },
  }));
}

function onlyEvent(events: TraceEvent[], kind: TraceEvent['kind']): TraceEvent {
  const matching = events.filter((event) => event.kind === kind);
  assert.equal(matching.length, 1, `expected one ${kind} event`);
  return matching[0];
}

function recordValue(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function time(second: number): string {
  return new Date(NOW.getTime() + second * 1_000).toISOString();
}

async function readTraceSegments(storageDirectory: string): Promise<string> {
  const files = (await readdir(storageDirectory)).filter((name) => name.endsWith('.ndjson'));
  return (await Promise.all(files.map((name) => readFile(path.join(storageDirectory, name), 'utf8')))).join('');
}

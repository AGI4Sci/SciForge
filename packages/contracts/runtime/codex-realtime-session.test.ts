import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODEX_REALTIME_SESSION_STREAM_KIND,
  assertCodexRealtimeSessionEnvelope,
  createCodexRealtimeClientControl,
  createCodexRealtimeControlAck,
  createCodexRealtimeSessionEnvelope,
  normalizeCodexRealtimeClientControl,
} from './codex-realtime-session';

test('Codex realtime session contract names structured events plus terminal-equivalent text, not raw terminal', () => {
  const envelope = createCodexRealtimeSessionEnvelope({
    commandId: 'codex-command-rt02',
    attemptId: 'codex-command-rt02-attempt-1',
    codexSessionId: '019e4332-4e6a-79a0-9a01-d35253a5614a',
  });

  assert.equal(envelope.streamKind, CODEX_REALTIME_SESSION_STREAM_KIND);
  assert.equal(envelope.eventTransport, 'sse');
  assert.equal(envelope.eventContract, 'structured-events');
  assert.equal(envelope.inputTextKind, 'terminal-equivalent-text');
  assert.equal(envelope.rawTerminal, false);
  assert.equal(envelope.resumeRequested, true);
  assert.equal(envelope.threadRef, 'codex-thread:019e4332-4e6a-79a0-9a01-d35253a5614a');
  assert.doesNotThrow(() => assertCodexRealtimeSessionEnvelope(envelope));
});

test('Codex realtime session contract admits WebSocket structured-event transport', () => {
  const envelope = createCodexRealtimeSessionEnvelope({
    commandId: 'codex-command-rt02',
    attemptId: 'codex-command-rt02-attempt-1',
    eventTransport: 'websocket',
  });

  assert.equal(envelope.eventTransport, 'websocket');
  assert.equal(envelope.eventContract, 'structured-events');
  assert.equal(envelope.inputTextKind, 'terminal-equivalent-text');
  assert.equal(envelope.rawTerminal, false);
  assert.doesNotThrow(() => assertCodexRealtimeSessionEnvelope(envelope));
});

test('Codex realtime session contract fails closed for raw terminal shaped bridges', () => {
  assert.throws(() => assertCodexRealtimeSessionEnvelope({
    schemaVersion: 'sciforge.codex-realtime-session.v1',
    bridge: 'codex-native-realtime-session',
    streamKind: 'raw-terminal',
    eventTransport: 'pty',
    eventContract: 'raw-bytes',
    inputTextKind: 'raw-terminal',
    rawTerminal: true,
    resumeRequested: false,
  }), /structured events plus terminal-equivalent text/);
});

test('Codex realtime control contract carries structured cancel and interrupt intents', () => {
  const cancel = createCodexRealtimeClientControl({
    controlType: 'cancel',
    commandId: 'codex-command-rt02',
    attemptId: 'codex-command-rt02-attempt-1',
    reason: 'user-interrupt',
  });
  const interrupt = createCodexRealtimeClientControl({
    controlType: 'interrupt',
    mode: 'queue-next-turn',
    commandId: 'codex-command-rt02',
    message: 'use this extra constraint next',
  });

  assert.equal(cancel.rawTerminal, false);
  assert.equal(interrupt.rawTerminal, false);
  assert.deepEqual(normalizeCodexRealtimeClientControl(cancel), { ...cancel, requestId: undefined });
  assert.deepEqual(normalizeCodexRealtimeClientControl(interrupt), { ...interrupt, attemptId: undefined, requestId: undefined, reason: undefined });
  assert.deepEqual(createCodexRealtimeControlAck({
    control: cancel,
    status: 'accepted',
    delivery: 'adapter-cancel',
    detail: 'accepted',
    createdAt: '2026-05-23T00:00:00.000Z',
  }), {
    schemaVersion: 'sciforge.codex-realtime-control.v1',
    type: 'realtime_control',
    controlType: 'cancel',
    status: 'accepted',
    delivery: 'adapter-cancel',
    detail: 'accepted',
    commandId: 'codex-command-rt02',
    attemptId: 'codex-command-rt02-attempt-1',
    requestId: undefined,
    rawTerminal: false,
    createdAt: '2026-05-23T00:00:00.000Z',
  });
});

test('Codex realtime control contract rejects raw terminal shaped control frames', () => {
  assert.throws(() => normalizeCodexRealtimeClientControl({
    schemaVersion: 'sciforge.codex-realtime-control.v1',
    controlType: 'interrupt',
    mode: 'cancel-current',
    message: 'raw bytes',
    inputTextKind: 'raw-terminal',
    rawTerminal: true,
  }), /structured control frames/);
});

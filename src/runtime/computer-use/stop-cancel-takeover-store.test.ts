import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createInMemoryStopCancelTakeoverStore,
  type StopCancelTakeoverCallbackContext,
} from './stop-cancel-takeover-store.js';

const now = '2026-06-06T00:00:00.000Z';

test('materializes BrowserHost stop and close refs through host callbacks only', async () => {
  const callbacks: StopCancelTakeoverCallbackContext[] = [];
  const store = createInMemoryStopCancelTakeoverStore({ now: () => now });

  const registration = store.registerBrowserHostControls({
    workspacePath: '/workspace/sciforge',
    sessionId: 'browser-session-1',
    stop: (context) => {
      callbacks.push(context);
      return { evidenceRefs: ['browser-host-session:browser-session-1/stopped'] };
    },
    close: (context) => {
      callbacks.push(context);
      return { evidenceRefs: ['browser-host-session:browser-session-1/closed'] };
    },
    evidenceRefs: [
      'browser-host-session:browser-session-1/state',
      'gui.present:fake-stop',
      'https://example.test/raw-url',
      'data:image/png;base64,AAAA',
      'token=secret-value',
    ],
  });

  assert.equal(registration.status, 'ready');
  assert.equal(registration.stopRef, 'stop:browser-host-session/browser-session-1/stop');
  assert.equal(registration.closeRef, 'stop:browser-host-session/browser-session-1/close');
  assert.deepEqual(registration.evidenceRefs, ['browser-host-session:browser-session-1/state']);

  const stop = await store.materialize(registration.stopRef, { requestedBy: 'agent-host', reason: 'user requested stop' });
  const close = await store.materialize(registration.closeRef, { requestedBy: 'agent-host', reason: 'cleanup' });

  assert.equal(stop.status, 'completed');
  assert.equal(stop.kind, 'browser-host.stop');
  assert.equal(close.status, 'completed');
  assert.equal(close.kind, 'browser-host.close');
  assert.deepEqual(
    callbacks.map((context) => [context.kind, context.action, context.target]),
    [
      ['browser-host.stop', 'stop', { type: 'browser-host-session', sessionId: 'browser-session-1', workspacePath: '/workspace/sciforge' }],
      ['browser-host.close', 'close', { type: 'browser-host-session', sessionId: 'browser-session-1', workspacePath: '/workspace/sciforge' }],
    ],
  );
  assert.doesNotMatch(JSON.stringify([stop, close]), /gui\.present|example\.test|base64|secret-value/i);
});

test('materializes Runtime Codex cancel ref and preserves bounded runtime-owned refs', async () => {
  const callbacks: StopCancelTakeoverCallbackContext[] = [];
  const store = createInMemoryStopCancelTakeoverStore({ now: () => now, maxEvidenceRefs: 3 });

  const registration = store.registerRuntimeCodexCancel({
    commandId: 'command-1',
    attemptId: 'attempt-1',
    cancel: (context) => {
      callbacks.push(context);
      return {
        evidenceRefs: [
          'cancel:runtime-codex/command-1/attempt-1/completed',
          'audit:runtime-codex/command-1/cancel',
          'ui:fake-cancel',
          'evidence:runtime-codex/command-1/cancel-proof',
        ],
      };
    },
    evidenceRefs: ['cancel:runtime-codex/command-1/attempt-1/registered'],
  });

  assert.equal(registration.status, 'ready');
  assert.equal(registration.cancelRef, 'cancel:runtime-codex/command-1/attempt-1');

  const result = await store.materialize(registration.cancelRef, { requestedBy: 'user-control' });

  assert.equal(result.status, 'completed');
  assert.equal(result.kind, 'runtime-codex.cancel');
  assert.deepEqual(callbacks.map((context) => context.target), [
    { type: 'runtime-codex-turn', commandId: 'command-1', attemptId: 'attempt-1' },
  ]);
  assert.deepEqual(result.evidenceRefs, [
    'cancel:runtime-codex/command-1/attempt-1/registered',
    'cancel:runtime-codex/command-1/attempt-1/completed',
    'audit:runtime-codex/command-1/cancel',
  ]);
});

test('materializes WindowAction stop pause and remove refs', async () => {
  const actions: string[] = [];
  const store = createInMemoryStopCancelTakeoverStore({ now: () => now });

  const registration = store.registerWindowActionControls({
    sessionId: 'window-session-1',
    windowRef: 'window:chrome-main',
    stop: (context) => {
      actions.push(context.action);
      return { evidenceRefs: ['window-action-session:window-session-1/stopped'] };
    },
    pause: (context) => {
      actions.push(context.action);
      return { evidenceRefs: ['window-action-session:window-session-1/paused'] };
    },
    remove: (context) => {
      actions.push(context.action);
      return { evidenceRefs: ['window-action-session:window-session-1/removed'] };
    },
  });

  assert.equal(registration.stopRef, 'stop:window-action-session/window-session-1/stop');
  assert.equal(registration.pauseRef, 'stop:window-action-session/window-session-1/pause');
  assert.equal(registration.removeRef, 'stop:window-action-session/window-session-1/remove');

  const stop = await store.materialize(registration.stopRef);
  const pause = await store.materialize(registration.pauseRef);
  const remove = await store.materialize(registration.removeRef);

  assert.deepEqual(actions, ['stop', 'pause', 'remove']);
  assert.deepEqual([stop.status, pause.status, remove.status], ['completed', 'completed', 'completed']);
  assert.deepEqual([stop.kind, pause.kind, remove.kind], [
    'window-action.stop',
    'window-action.pause',
    'window-action.remove',
  ]);
});

test('materializes NativeHost stop pause and close refs through host callbacks only', async () => {
  const callbacks: StopCancelTakeoverCallbackContext[] = [];
  const store = createInMemoryStopCancelTakeoverStore({ now: () => now });

  const registration = store.registerNativeHostControls({
    sessionId: 'native-host-session-1',
    sessionRef: 'computer-use:native-host/sessions/native-host-session-1/session.json',
    stop: (context) => {
      callbacks.push(context);
      return { evidenceRefs: ['computer-use:native-host/ledgers/native-host-session-1/evidence-ledger.json/events/0010-session.stopped.json'] };
    },
    pause: (context) => {
      callbacks.push(context);
      return { evidenceRefs: ['computer-use:native-host/ledgers/native-host-session-1/evidence-ledger.json/events/0011-agent.paused.json'] };
    },
    close: (context) => {
      callbacks.push(context);
      return { evidenceRefs: ['computer-use:native-host/ledgers/native-host-session-1/evidence-ledger.json/events/0012-session.closed.json'] };
    },
    evidenceRefs: [
      'computer-use:native-host/sessions/native-host-session-1/session.json',
      'gui.present:fake-native-host',
      'replay:old-native-host',
      'data:image/png;base64,AAAA',
    ],
  });

  assert.equal(registration.status, 'ready');
  assert.equal(registration.stopRef, 'stop:computer-use/native-host/native-host-session-1/stop');
  assert.equal(registration.pauseRef, 'lease:computer-use/native-host/native-host-session-1/pause');
  assert.equal(registration.closeRef, 'stop:computer-use/native-host/native-host-session-1/close');
  assert.deepEqual(registration.evidenceRefs, ['computer-use:native-host/sessions/native-host-session-1/session.json']);

  const stop = await store.materialize(registration.stopRef, { requestedBy: 'agent-host', reason: 'user requested stop' });
  const pause = await store.materialize(registration.pauseRef, { requestedBy: 'agent-host', reason: 'handoff' });
  const close = await store.materialize(registration.closeRef, { requestedBy: 'agent-host', reason: 'cleanup' });

  assert.deepEqual(
    callbacks.map((context) => [context.kind, context.action, context.target]),
    [
      ['native-host.stop', 'stop', {
        type: 'native-host-session',
        sessionId: 'native-host-session-1',
        sessionRef: 'computer-use:native-host/sessions/native-host-session-1/session.json',
      }],
      ['native-host.pause', 'pause', {
        type: 'native-host-session',
        sessionId: 'native-host-session-1',
        sessionRef: 'computer-use:native-host/sessions/native-host-session-1/session.json',
      }],
      ['native-host.close', 'close', {
        type: 'native-host-session',
        sessionId: 'native-host-session-1',
        sessionRef: 'computer-use:native-host/sessions/native-host-session-1/session.json',
      }],
    ],
  );
  assert.deepEqual([stop.status, pause.status, close.status], ['completed', 'completed', 'completed']);
  assert.deepEqual([stop.kind, pause.kind, close.kind], ['native-host.stop', 'native-host.pause', 'native-host.close']);
  assert.doesNotMatch(JSON.stringify([registration, stop, pause, close]), /gui\.present|replay:|base64/i);
});

test('materializes human takeover lease ref and rejects UI projection refs', async () => {
  const store = createInMemoryStopCancelTakeoverStore({ now: () => now });
  let callbackCalled = false;

  const rejectedRegistration = store.registerControl({
    kind: 'human-takeover.lease',
    ref: 'ui:takeover-fake',
    target: { type: 'human-takeover', leaseId: 'fake' },
    callback: () => {
      callbackCalled = true;
    },
  });
  const rejectedMaterialize = await store.materialize('gui.present:takeover-fake');
  const registration = store.registerHumanTakeoverLease({
    leaseId: 'lease-1',
    actorId: 'human-operator',
    takeover: (context) => {
      callbackCalled = true;
      return {
        evidenceRefs: [
          'lease:human-takeover/lease-1/acquired',
          'fixture:takeover-fake',
          'replay:takeover-fake',
          'Authorization: Bearer secret-token',
        ],
      };
    },
  });

  const result = await store.materialize(registration.leaseRef, { requestedBy: 'human-operator' });

  assert.equal(rejectedRegistration.status, 'blocked');
  assert.equal(rejectedRegistration.reason, 'ref-not-host-owned');
  assert.equal(rejectedMaterialize.status, 'blocked');
  assert.equal(rejectedMaterialize.reason, 'ref-not-host-owned');
  assert.equal(result.status, 'completed');
  assert.equal(result.kind, 'human-takeover.lease');
  assert.equal(callbackCalled, true);
  assert.deepEqual(result.evidenceRefs, [
    'lease:human-takeover/lease-1',
    'lease:human-takeover/lease-1/acquired',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /fixture|replay|secret-token|Authorization/i);
});

test('registers human takeover stop pause resume and takeover controls as runtime-owned refs', async () => {
  const callbacks: StopCancelTakeoverCallbackContext[] = [];
  const store = createInMemoryStopCancelTakeoverStore({ now: () => now });

  const registration = store.registerHumanTakeoverLease({
    leaseId: 'lease-control-1',
    actorId: 'human-operator',
    takeover: (context) => {
      callbacks.push(context);
      return { evidenceRefs: ['lease:human-takeover/lease-control-1/takeover-granted'] };
    },
    pause: (context) => {
      callbacks.push(context);
      return { evidenceRefs: ['lease:human-takeover/lease-control-1/agent-paused'] };
    },
    resume: (context) => {
      callbacks.push(context);
      return { evidenceRefs: ['lease:human-takeover/lease-control-1/agent-resumed'] };
    },
    stop: (context) => {
      callbacks.push(context);
      return { evidenceRefs: ['lease:human-takeover/lease-control-1/agent-stopped'] };
    },
    evidenceRefs: [
      'runtime-truth:human-takeover/lease-control-1',
      'gui.present:fake-takeover',
      'ui:fake-takeover',
      'fixture:fake-takeover',
      'replay:fake-takeover',
      'https://example.invalid/takeover',
      'data:image/png;base64,AAAA',
      'Authorization: Bearer secret-token',
    ],
  });

  assert.equal(registration.status, 'ready');
  assert.equal(registration.leaseRef, 'lease:human-takeover/lease-control-1');
  assert.equal(registration.pauseRef, 'lease:human-takeover/lease-control-1/pause');
  assert.equal(registration.resumeRef, 'lease:human-takeover/lease-control-1/resume');
  assert.equal(registration.stopRef, 'lease:human-takeover/lease-control-1/stop');
  assert.deepEqual(registration.evidenceRefs, ['runtime-truth:human-takeover/lease-control-1']);

  const takeover = await store.materialize(registration.leaseRef, { requestedBy: 'human-operator', reason: 'manual handoff' });
  const pause = await store.materialize(registration.pauseRef, { requestedBy: 'human-operator', reason: 'manual handoff' });
  const resume = await store.materialize(registration.resumeRef, { requestedBy: 'human-operator', reason: 'return to agent' });
  const stop = await store.materialize(registration.stopRef, { requestedBy: 'human-operator', reason: 'stop automation' });

  assert.deepEqual(
    callbacks.map((context) => [context.kind, context.action, context.target]),
    [
      ['human-takeover.lease', 'takeover', { type: 'human-takeover', leaseId: 'lease-control-1', actorId: 'human-operator' }],
      ['human-takeover.pause', 'pause', { type: 'human-takeover', leaseId: 'lease-control-1', actorId: 'human-operator' }],
      ['human-takeover.resume', 'resume', { type: 'human-takeover', leaseId: 'lease-control-1', actorId: 'human-operator' }],
      ['human-takeover.stop', 'stop', { type: 'human-takeover', leaseId: 'lease-control-1', actorId: 'human-operator' }],
    ],
  );
  assert.deepEqual([takeover.status, pause.status, resume.status, stop.status], ['completed', 'completed', 'completed', 'completed']);
  assert.deepEqual([takeover.action, pause.action, resume.action, stop.action], ['takeover', 'pause', 'resume', 'stop']);
  assert.doesNotMatch(JSON.stringify([registration, takeover, pause, resume, stop]), /gui(?:\.|:)|ui:|fixture:|replay:|https?:\/\/|base64|token|bearer/i);
});

test('rejects host-looking control refs when their action suffix is unsupported', async () => {
  const store = createInMemoryStopCancelTakeoverStore({ now: () => now });
  let callbackCalled = false;

  const takeoverRegistration = store.registerControl({
    kind: 'human-takeover.lease',
    ref: 'lease:human-takeover/lease-1/not-a-control',
    target: { type: 'human-takeover', leaseId: 'lease-1' },
    callback: () => {
      callbackCalled = true;
    },
  });
  const windowRegistration = store.registerControl({
    kind: 'window-action.stop',
    ref: 'stop:window-action-session/window-session-1/not-stop',
    target: { type: 'window-action-session', sessionId: 'window-session-1' },
    callback: () => {
      callbackCalled = true;
    },
  });
  const materialized = await store.materialize('lease:human-takeover/lease-1/not-a-control');

  assert.equal(takeoverRegistration.status, 'blocked');
  assert.equal(takeoverRegistration.reason, 'ref-not-host-owned');
  assert.equal(windowRegistration.status, 'blocked');
  assert.equal(windowRegistration.reason, 'ref-not-host-owned');
  assert.equal(materialized.status, 'blocked');
  assert.equal(materialized.reason, 'ref-not-host-owned');
  assert.equal(callbackCalled, false);
});

test('blocks materialization when callback is missing', async () => {
  const store = createInMemoryStopCancelTakeoverStore({ now: () => now });
  const registration = store.registerControl({
    kind: 'runtime-codex.cancel',
    ref: 'cancel:runtime-codex/command-missing/attempt-missing',
    target: { type: 'runtime-codex-turn', commandId: 'command-missing', attemptId: 'attempt-missing' },
  });

  assert.equal(registration.status, 'ready');

  const result = await store.materialize(registration.ref);

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'callback-missing');
  assert.deepEqual(result.evidenceRefs, ['cancel:runtime-codex/command-missing/attempt-missing']);
});

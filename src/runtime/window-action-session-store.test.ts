import assert from 'node:assert/strict';
import test from 'node:test';

import { createWindowActionSession } from './window-action-session.js';
import { createInMemoryWindowActionSessionStore } from './window-action-session-store.js';

const now = '2026-06-06T00:00:00.000Z';

test('WindowActionSessionStore materializes BrowserHost sessions with runtime-owned refs', () => {
  const store = createInMemoryWindowActionSessionStore({ now: () => new Date(now) });

  const materialized = store.materializeForBrowserHostSession({
    browserHostSession: {
      id: 'verified-browser',
      status: 'ready',
      title: 'Verified Browser',
      liveSurfaceRef: 'browser-host-session:verified-browser/live-surface',
      frameRef: 'browser-host-session:verified-browser/frame',
      screenshotRef: 'browser-host-session:verified-browser/screenshot',
      updatedAt: now,
    },
    sessionId: 'verified-browser',
    sessionRef: 'browser-host-session:verified-browser',
    commandId: 'codex-command-1',
    attemptId: 'codex-command-1-attempt-1',
    riskCategory: 'low-risk',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
  });

  assert.equal(materialized.status, 'ready');
  assert.equal(materialized.ready, true);
  assert.ok(materialized.refs.includes('window-action-session:browser-host-session/verified-browser'));
  assert.ok(materialized.refs.includes('action-ledger:browser-host-session/verified-browser/window-action-session'));
  assert.ok(materialized.refs.includes('lease:browser-host-session/verified-browser/agent-host'));
  assert.deepEqual(materialized.targetRefs, [
    'browser-host-session:verified-browser',
    'window-action-session:browser-host-session/verified-browser',
  ]);
  assert.deepEqual(materialized.observationRefs, [
    'browser-host-session:verified-browser/frame',
    'browser-host-session:verified-browser/screenshot',
  ]);

  const entry = store.getActiveByRef('window-action-session:browser-host-session/verified-browser');
  assert.equal(entry?.session.app.kind, 'browser');
  assert.equal(entry?.session.windowRef, 'browser-host-session:verified-browser/window');
  assert.deepEqual(entry?.refs, materialized.refs);
  assert.doesNotMatch(JSON.stringify(materialized), /gui\.|gui:|ui:|fixture:|replay:|https?:\/\/|data:image|base64|secret|token/i);
});

test('WindowActionSessionStore reuses BrowserHost WindowActionSession entries by runtime ref', () => {
  const store = createInMemoryWindowActionSessionStore({ now: () => new Date(now) });
  const input = {
    browserHostSession: {
      id: 'reuse-browser',
      status: 'ready' as const,
      title: 'Reusable Browser',
      liveSurfaceRef: 'browser-host-session:reuse-browser/live-surface',
      frameRef: 'browser-host-session:reuse-browser/frame',
      screenshotRef: 'browser-host-session:reuse-browser/screenshot',
      updatedAt: now,
    },
    sessionId: 'reuse-browser',
    sessionRef: 'browser-host-session:reuse-browser',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
  };

  const first = store.materializeForBrowserHostSession(input);
  const second = store.materializeForBrowserHostSession(input);

  assert.equal(first.status, 'ready');
  assert.equal(second.status, 'ready');
  assert.equal(second.session?.id, first.session?.id);
  assert.deepEqual(second.refs, first.refs);
  assert.deepEqual(second.targetRefs, first.targetRefs);
  assert.equal(store.getActiveByRef('browser-host-session:reuse-browser')?.session.id, first.session?.id);
});

test('WindowActionSessionStore materializes annotation manual and high-confidence auto bindings through store helpers', () => {
  const store = createInMemoryWindowActionSessionStore({ now: () => new Date(now) });

  const manual = store.materializeForAnnotationMetadata({
    annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/manual-window',
    screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/manual-window',
    windowBinding: {
      status: 'manual-bound',
      windowRef: 'desktop-window:app:paper-reader:window-42',
      bundleId: 'org.sciforge.paper-reader',
      appName: 'Paper Reader',
      appKind: 'ordinary-app',
      windowBounds: { x: 10, y: 20, width: 900, height: 600 },
    },
  }, {
    explicitActionFlowRef: 'window-action-flow:thread-1/manual-window',
    refs: ['action-ledger:annotation/manual-window'],
  });

  assert.equal(manual.status, 'ready');
  assert.equal(manual.session?.windowRef, 'desktop-window:app:paper-reader:window-42');
  assert.ok(manual.targetRefs.includes('desktop-window:app:paper-reader:window-42'));
  assert.ok(manual.refs.includes('action-ledger:annotation/manual-window'));

  const auto = store.materializeForAnnotationMetadata({
    annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/auto-region',
    screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/auto-region',
    windowBinding: {
      status: 'auto-bound',
      confidence: 0.96,
      windowRef: 'desktop-window:app:plotter:window-7',
      bundleId: 'org.sciforge.plotter',
      appName: 'Plotter',
      appKind: 'ordinary-app',
      windowBounds: { x: 20, y: 30, width: 1000, height: 700 },
      windowLocalBounds: { x: 240, y: 160, width: 260, height: 180 },
    },
  }, {
    explicitActionFlowRef: 'window-action-flow:thread-1/auto-region',
  });

  assert.equal(auto.status, 'ready');
  assert.equal(auto.session?.windowRef, 'desktop-window:app:plotter:window-7');
  assert.deepEqual(auto.session?.bounds, { x: 20, y: 30, width: 1000, height: 700 });
  assert.ok(auto.observationRefs.includes('desktop-annotation:workspace/workspace-a/session/session-a/screenshot/auto-region'));
  assert.doesNotMatch(JSON.stringify(auto), /data:image|base64|secret|token/i);
});

test('WindowActionSessionStore upserts explicit desktop/window sessions and filters unsafe refs', () => {
  const store = createInMemoryWindowActionSessionStore({ now: () => new Date(now) });
  const session = createWindowActionSession({
    id: 'desktop-window-main',
    windowRef: 'desktop-native:window/main',
    app: { id: 'com.example.App', name: 'Example App', kind: 'ordinary-app' },
    evidenceRefs: [
      { kind: 'desktop-native', ref: 'desktop-native:window/main' },
      { kind: 'fake-gui', ref: 'gui.present:window-main' },
      { kind: 'fake-ui', ref: 'ui:window-ready' },
      { kind: 'fixture', ref: 'fixture:window-main' },
      { kind: 'replay', ref: 'replay:window-main' },
      { kind: 'url', ref: 'window:https://example.com/private' },
      { kind: 'secret', ref: 'window-action-session:token-secret' },
      { kind: 'image', ref: 'data:image/png;base64,abcdef' },
    ],
    timestamp: now,
  });

  const upserted = store.upsert(session, {
    refs: ['action-ledger:desktop-window-main/upsert', 'ui:fake-upsert'],
  });

  assert.equal(upserted.status, 'ready');
  assert.ok(upserted.refs.includes('window-action-session:desktop-window-main'));
  assert.ok(upserted.refs.includes('action-ledger:window-action-session/desktop-window-main/upsert'));
  assert.ok(upserted.refs.includes('lease:window-action-session/desktop-window-main/agent-host'));
  assert.ok(upserted.refs.includes('desktop-native:window/main'));
  assert.doesNotMatch(JSON.stringify(upserted), /gui\.|gui:|ui:|fixture:|replay:|https?:\/\/|data:image|base64|secret|token/i);

  const entry = store.getActiveByRef('desktop-native:window/main');
  assert.equal(entry?.session.id, 'desktop-window-main');
  assert.deepEqual(entry?.session.evidenceRefs, [{ kind: 'desktop-native', ref: 'desktop-native:window/main' }]);
});

test('WindowActionSessionStore rejects UI-only refs as active session keys', () => {
  const store = createInMemoryWindowActionSessionStore({ now: () => new Date(now) });
  const session = createWindowActionSession({
    id: 'runtime-window',
    windowRef: 'window:runtime/main',
    evidenceRefs: [{ kind: 'window', ref: 'window:runtime/main' }],
    timestamp: now,
  });
  store.upsert(session);

  assert.equal(store.getActiveByRef('gui.present:runtime-window'), undefined);
  assert.equal(store.getActiveByRef('gui:runtime-window'), undefined);
  assert.equal(store.getActiveByRef('ui:runtime-window'), undefined);
  assert.equal(store.getActiveByRef('fixture:runtime-window'), undefined);
  assert.equal(store.getActiveByRef('replay:runtime-window'), undefined);
  assert.equal(store.getActiveByRef('window:https://example.com/private'), undefined);
  assert.equal(store.getActiveByRef('window-action-session:token-secret'), undefined);
  assert.equal(store.getActiveByRef('data:image/png;base64,abcdef'), undefined);
});

test('WindowActionSessionStore pause stop and remove produce runtime control evidence', () => {
  const store = createInMemoryWindowActionSessionStore({ now: () => new Date(now) });
  store.upsert(createWindowActionSession({
    id: 'control-window',
    windowRef: 'window:control/main',
    timestamp: now,
  }));

  const paused = store.pause('window-action-session:control-window', { reason: 'human-takeover' });
  assert.equal(paused.status, 'completed');
  assert.equal(paused.session?.status, 'paused');
  assert.ok(paused.refs.some((ref) => ref.startsWith('action-ledger:window-action-session/control-window/control/pause/')));
  assert.ok(paused.refs.includes('lease:window-action-session/control-window/control/pause'));
  assert.deepEqual(paused.session?.events.at(-1)?.evidenceRefs.map((item) => item.ref), paused.refs);

  const stopped = store.stop('window-action-session:control-window');
  assert.equal(stopped.status, 'completed');
  assert.equal(stopped.session?.status, 'stopped');
  assert.ok(stopped.refs.some((ref) => ref.startsWith('action-ledger:window-action-session/control-window/control/stop/')));
  assert.ok(stopped.refs.includes('lease:window-action-session/control-window/control/stop'));

  const removed = store.remove('window-action-session:control-window');
  assert.equal(removed.status, 'completed');
  assert.equal(removed.session?.status, 'removed');
  assert.ok(removed.refs.some((ref) => ref.startsWith('action-ledger:window-action-session/control-window/control/remove/')));
  assert.ok(removed.refs.includes('lease:window-action-session/control-window/control/remove'));
  assert.equal(store.getActiveByRef('window-action-session:control-window'), undefined);
});

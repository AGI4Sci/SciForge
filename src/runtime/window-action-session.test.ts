import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createActorCursor,
  createWindowActionSession,
  dispatchWindowAction,
  enterWindowActionSession,
  leaveWindowActionSession,
  pauseWindowActionSession,
  recordWindowAction,
  removeWindowActionSession,
  routeWindowAction,
  stopWindowActionSession,
} from './window-action-session.js';

const now = '2026-06-03T00:00:00.000Z';

test('WindowActionSession keeps a bounded cursor/action contract and routes actions through adapters', () => {
  const cursor = createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  });
  assert.deepEqual(cursor, {
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
    status: 'idle',
  });

  const session = createWindowActionSession({
    windowRef: 'window:chrome:main',
    process: {
      pid: 4210,
      name: 'Google Chrome',
      executablePath: '/Applications/Google Chrome.app',
    },
    app: {
      id: 'com.google.Chrome',
      name: 'Google Chrome',
      kind: 'browser',
    },
    bounds: { x: 80, y: 40, width: 1280, height: 900 },
    scale: 2,
    screenId: 'built-in-retina',
  });

  assert.equal(session.windowRef, 'window:chrome:main');
  assert.equal(session.process.pid, 4210);
  assert.equal(session.app.kind, 'browser');
  assert.deepEqual(session.bounds, { x: 80, y: 40, width: 1280, height: 900 });
  assert.equal(session.scale, 2);
  assert.equal(session.screenId, 'built-in-retina');
  assert.equal(session.status, 'active');

  const entered = enterWindowActionSession(session, cursor, { timestamp: now });
  assert.equal(entered.actorCursor?.agentId, 'agent-runtime-1');
  assert.equal(entered.actorCursor?.status, 'observing');
  assert.deepEqual(entered.actorCursor?.target, {
    type: 'window-action-session',
    sessionId: entered.id,
    windowRef: 'window:chrome:main',
  });

  const actionRefs = Array.from({ length: 12 }, (_, index) => ({
    kind: `artifact-${index}`,
    ref: `window-action-ref:artifact-${index}`,
    payload: `raw-${index}`,
  }));
  const observed = recordWindowAction(entered, {
    action: 'observe',
    status: 'completed',
    timestamp: now,
    evidenceRefs: actionRefs,
  });
  const clicked = recordWindowAction(observed, {
    action: 'click',
    status: 'completed',
    point: { x: 24, y: 36 },
    timestamp: now,
    evidenceRefs: [
      { kind: 'screenshot', ref: 'window-action-ref:screenshot-1', rawPayload: 'secret pixels' },
      { kind: 'dom', ref: '<button>raw dom</button>' },
    ],
  });
  const typed = recordWindowAction(clicked, { action: 'type', status: 'completed', textLength: 5, timestamp: now });
  const scrolled = recordWindowAction(typed, { action: 'scroll', status: 'completed', delta: { x: 0, y: 240 }, timestamp: now });
  const waited = recordWindowAction(scrolled, { action: 'wait', status: 'completed', durationMs: 500, timestamp: now });
  const left = leaveWindowActionSession(waited, { timestamp: now });
  const paused = pauseWindowActionSession(left, { timestamp: now });
  const actionAfterPause = recordWindowAction(paused, {
    action: 'click',
    status: 'completed',
    timestamp: now,
    evidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:after-pause' }],
  });
  const enterAfterPause = enterWindowActionSession(paused, cursor, { timestamp: now });
  const stopped = stopWindowActionSession(paused, { timestamp: now });
  const actionAfterStop = recordWindowAction(stopped, {
    action: 'type',
    status: 'completed',
    timestamp: now,
    evidenceRefs: [{ kind: 'text', ref: 'window-action-ref:after-stop' }],
  });
  const enterAfterStop = enterWindowActionSession(stopped, cursor, { timestamp: now });
  const removed = removeWindowActionSession(stopped, { timestamp: now });
  const actionAfterRemove = recordWindowAction(removed, {
    action: 'scroll',
    status: 'completed',
    timestamp: now,
    evidenceRefs: [{ kind: 'scroll', ref: 'window-action-ref:after-remove' }],
  });
  const enterAfterRemove = enterWindowActionSession(removed, cursor, { timestamp: now });

  assert.equal(clicked.actorCursor?.lastAction?.action, 'click');
  assert.equal(clicked.actorCursor?.lastAction?.status, 'completed');
  assert.deepEqual(clicked.actorCursor?.lastAction?.evidenceRefs, [
    { kind: 'screenshot', ref: 'window-action-ref:screenshot-1' },
  ]);
  assert.equal(observed.events.at(-1)?.evidenceRefs.length, 8);
  assert.deepEqual(
    removed.events.map((event) => event.type),
    ['actor-enter', 'observe', 'click', 'type', 'scroll', 'wait', 'actor-leave', 'pause', 'stop', 'remove-window'],
  );
  assert.equal(removed.status, 'removed');
  assert.deepEqual(actionAfterPause.events, paused.events);
  assert.deepEqual(enterAfterPause.events, paused.events);
  assert.equal(actionAfterPause.status, 'paused');
  assert.equal(enterAfterPause.status, 'paused');
  assert.deepEqual(actionAfterStop.events, stopped.events);
  assert.deepEqual(enterAfterStop.events, stopped.events);
  assert.equal(actionAfterStop.status, 'stopped');
  assert.equal(enterAfterStop.status, 'stopped');
  assert.deepEqual(actionAfterRemove.events, removed.events);
  assert.deepEqual(enterAfterRemove.events, removed.events);
  assert.equal(actionAfterRemove.status, 'removed');
  assert.equal(enterAfterRemove.status, 'removed');

  assert.deepEqual(
    routeWindowAction({
      target: {
        app: { id: 'com.google.Chrome', name: 'Chrome', kind: 'browser' },
        capabilities: { browserHostSession: true, appNativeCommand: true, accessibility: true },
      },
      action: 'click',
    }),
    {
      priority: 1,
      adapter: 'browser-host-session',
      owner: 'agent-host-adapter',
      guiExecutable: false,
      evidenceRefs: [],
    },
  );
  assert.equal(
    routeWindowAction({
      target: {
        app: { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', kind: 'editor' },
        capabilities: { appNativeCommand: true, accessibility: true },
      },
      action: 'type',
    }).adapter,
    'app-native-command',
  );
  assert.equal(
    routeWindowAction({
      target: {
        app: { id: 'com.apple.TextEdit', name: 'TextEdit', kind: 'ordinary-app' },
        capabilities: { accessibility: true },
      },
      action: 'scroll',
    }).adapter,
    'accessibility-ui-automation',
  );

  const systemInputRoute = routeWindowAction({
    target: {
      app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      capabilities: { systemInput: true },
    },
    action: 'click',
  });
  assert.equal(systemInputRoute.adapter, 'system-input');
  assert.deepEqual(systemInputRoute.evidenceRefs, [
    { kind: 'shared-system-input', ref: 'shared-system-input:legacy.canvas:click' },
  ]);
});

test('WindowActionSession dispatcher hands actions to Agent Host adapters instead of GUI execution', async () => {
  const cursor = createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  });
  const session = enterWindowActionSession(createWindowActionSession({
    windowRef: 'window:vscode:main',
    app: { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', kind: 'editor' },
    bounds: { x: 20, y: 30, width: 1200, height: 800 },
    scale: 2,
    screenId: 'screen:built-in',
  }), cursor, { timestamp: now });
  const calls: string[] = [];

  const dispatched = await dispatchWindowAction(session, {
    target: {
      app: { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', kind: 'editor' },
      capabilities: { appNativeCommand: true, accessibility: true, systemInput: true },
    },
    action: 'type',
    status: 'running',
    textLength: 6,
    timestamp: now,
  }, {
    'app-native-command': async ({ route, input }) => {
      calls.push(`${route.owner}:${route.adapter}:${route.guiExecutable}:${input.action}`);
      return {
        status: 'completed',
        evidenceRefs: [{ kind: 'command', ref: 'app-native-command:vscode:type-1' }],
      };
    },
  });

  assert.deepEqual(calls, ['agent-host-adapter:app-native-command:false:type']);
  assert.equal(dispatched.route.adapter, 'app-native-command');
  assert.equal(dispatched.route.owner, 'agent-host-adapter');
  assert.equal(dispatched.route.guiExecutable, false);
  assert.equal(dispatched.session.events.at(-1)?.type, 'type');
  assert.equal(dispatched.session.events.at(-1)?.status, 'completed');
  assert.deepEqual(dispatched.session.events.at(-1)?.evidenceRefs, [
    { kind: 'command', ref: 'app-native-command:vscode:type-1' },
  ]);

  const systemInput = await dispatchWindowAction(session, {
    target: {
      app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      capabilities: { systemInput: true },
    },
    action: 'click',
    status: 'running',
    timestamp: now,
  }, {
    'system-input': async () => ({
      status: 'completed',
      evidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:system-input-after' }],
    }),
  });

  assert.equal(systemInput.route.adapter, 'system-input');
  assert.deepEqual(systemInput.session.events.at(-1)?.evidenceRefs, [
    { kind: 'shared-system-input', ref: 'shared-system-input:legacy.canvas:click' },
    { kind: 'screenshot', ref: 'window-action-ref:system-input-after' },
  ]);
});

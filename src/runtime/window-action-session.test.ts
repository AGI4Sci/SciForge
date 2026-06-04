import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createActorCursor,
  createWindowActionSession,
  createWindowActionSessionFromAnnotationMetadata,
  dispatchWindowAction,
  enterWindowActionSession,
  leaveWindowActionSession,
  pauseWindowActionSession,
  recordWindowAction,
  removeWindowActionSession,
  routeWindowAction,
  stopWindowActionSession,
  windowActionCandidateFromAnnotationMetadata,
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

test('annotation manual-bound metadata becomes a candidate but needs explicit action flow to create a session', () => {
  const metadata = {
    annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed',
    screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed',
    cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-fixed',
    imageRef: 'desktop-annotation:workspace/workspace-a/session/session-a/image/capture-fixed',
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    windowBinding: {
      status: 'manual-bound',
      windowRef: 'desktop-window:app:paper-reader:window-42',
      appName: 'Paper Reader',
      bundleId: 'org.sciforge.paper-reader',
      pid: 4242,
      title: 'Paper Reader - Figure 1',
      appKind: 'ordinary-app',
      windowBounds: { x: 44, y: 80, width: 900, height: 640 },
      windowLocalBounds: { x: 120, y: 80, width: 200, height: 120 },
    },
  };

  const candidate = windowActionCandidateFromAnnotationMetadata(metadata);
  assert.equal(candidate.status, 'candidate');
  assert.equal(candidate.bindingStatus, 'manual-bound');
  assert.equal(candidate.target?.windowRef, 'desktop-window:app:paper-reader:window-42');
  assert.deepEqual(candidate.target?.windowLocalBounds, { x: 120, y: 80, width: 200, height: 120 });
  assert.equal(candidate.routeTarget?.app?.id, 'org.sciforge.paper-reader');
  assert.equal(candidate.routeTarget?.app?.kind, 'ordinary-app');
  assert.equal(candidate.requiresExplicitActionFlow, true);

  const withoutFlow = createWindowActionSessionFromAnnotationMetadata(metadata, { timestamp: now });
  assert.equal(withoutFlow.status, 'requires-explicit-action-flow');
  assert.equal(withoutFlow.session, undefined);

  const created = createWindowActionSessionFromAnnotationMetadata(metadata, {
    explicitActionFlowRef: 'window-action-flow:thread-1/enter-window',
    timestamp: now,
  });
  assert.equal(created.status, 'created');
  assert.equal(created.session?.windowRef, 'desktop-window:app:paper-reader:window-42');
  assert.equal(created.session?.process.pid, 4242);
  assert.equal(created.session?.app.id, 'org.sciforge.paper-reader');
  assert.equal(created.session?.app.name, 'Paper Reader');
  assert.equal(created.session?.app.kind, 'ordinary-app');
  assert.deepEqual(created.session?.bounds, { x: 44, y: 80, width: 900, height: 640 });
  assert.deepEqual(created.session?.evidenceRefs, [
    { kind: 'annotation', ref: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed' },
    { kind: 'screenshot', ref: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed' },
    { kind: 'crop', ref: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-fixed' },
    { kind: 'image', ref: 'desktop-annotation:workspace/workspace-a/session/session-a/image/capture-fixed' },
    { kind: 'action-flow', ref: 'window-action-flow:thread-1/enter-window' },
  ]);
});

test('annotation auto-bound metadata is explanatory until explicit action flow consumes high confidence binding', () => {
  const metadata = {
    annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/screen-region-1',
    screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/screen-region-1',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    windowBinding: {
      status: 'auto-bound',
      confidence: 0.94,
      reason: 'single containing window matched the selected region',
      windowRef: 'desktop-window:app:plotter:window-7',
      appName: 'Plotter',
      bundleId: 'org.sciforge.plotter',
      appKind: 'ordinary-app',
      windowBounds: { x: 20, y: 30, width: 1000, height: 700 },
      windowLocalBounds: { x: 240, y: 160, width: 260, height: 180 },
      candidates: [{
        windowRef: 'desktop-window:app:plotter:window-7',
        confidence: 0.94,
        reason: 'contains-region',
      }],
    },
  };

  const candidate = windowActionCandidateFromAnnotationMetadata(metadata);
  assert.equal(candidate.status, 'explanatory-target');
  assert.equal(candidate.bindingStatus, 'auto-bound');
  assert.equal(candidate.requiresExplicitActionFlow, true);
  assert.equal(candidate.target?.windowRef, 'desktop-window:app:plotter:window-7');

  const withoutFlow = createWindowActionSessionFromAnnotationMetadata(metadata, { timestamp: now });
  assert.equal(withoutFlow.status, 'requires-explicit-action-flow');
  assert.equal(withoutFlow.session, undefined);

  const created = createWindowActionSessionFromAnnotationMetadata(metadata, {
    explicitActionFlowRef: 'window-action-flow:thread-1/enter-auto-bound-window',
    timestamp: now,
  });
  assert.equal(created.status, 'created');
  assert.equal(created.session?.windowRef, 'desktop-window:app:plotter:window-7');
  assert.deepEqual(created.session?.bounds, { x: 20, y: 30, width: 1000, height: 700 });
});

test('annotation low-confidence, unbound, blocked, and screenshot-only metadata never become operation targets', () => {
  const rejectedInputs = [
    {
      annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/low-confidence',
      screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/low-confidence',
      sourceKind: 'screen-region',
      coordinateSpace: 'screen-global',
      windowBinding: {
        status: 'auto-bound',
        confidence: 0.61,
        windowRef: 'desktop-window:app:wrong:window-1',
        candidates: [{ windowRef: 'desktop-window:app:wrong:window-1', confidence: 0.61 }],
      },
    },
    {
      annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/unbound',
      screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/unbound',
      sourceKind: 'screen-region',
      coordinateSpace: 'screen-global',
      windowBinding: {
        status: 'unbound',
        reason: 'low-confidence',
        candidates: [{ windowRef: 'desktop-window:app:candidate:window-1', confidence: 0.55 }],
      },
    },
    {
      annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/blocked',
      screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/blocked',
      sourceKind: 'screen-region',
      coordinateSpace: 'screen-global',
      windowBinding: {
        status: 'blocked',
        reason: 'window-enumeration-blocked',
      },
    },
    {
      screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/screenshot-only',
      sourceKind: 'screenshot',
    },
  ];

  for (const input of rejectedInputs) {
    const candidate = windowActionCandidateFromAnnotationMetadata(input);
    assert.equal(candidate.status, 'blocked');
    assert.equal(candidate.target, undefined);

    const created = createWindowActionSessionFromAnnotationMetadata(input, {
      explicitActionFlowRef: 'window-action-flow:thread-1/enter-rejected',
      timestamp: now,
    });
    assert.equal(created.status, 'blocked');
    assert.equal(created.session, undefined);
  }
});

test('annotation window metadata feeds generic adapter routing with accessibility and shared-system fallback evidence', () => {
  const candidate = windowActionCandidateFromAnnotationMetadata({
    annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed',
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    windowBinding: {
      status: 'manual-bound',
      windowRef: 'desktop-window:app:legacy-canvas:main',
      appName: 'Legacy Canvas',
      bundleId: 'legacy.canvas',
      appKind: 'ordinary-app',
      windowBounds: { x: 0, y: 0, width: 800, height: 600 },
    },
  }, {
    capabilities: { accessibility: true, systemInput: true },
  });

  assert.equal(candidate.status, 'candidate');
  assert.deepEqual(candidate.routeTarget, {
    app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
    capabilities: { accessibility: true, systemInput: true },
  });
  const accessibilityRoute = routeWindowAction({ target: candidate.routeTarget!, action: 'click' });
  assert.equal(accessibilityRoute.adapter, 'accessibility-ui-automation');
  assert.deepEqual(accessibilityRoute.evidenceRefs, [
    { kind: 'accessibility-ui-automation', ref: 'accessibility-ui-automation:legacy.canvas:click' },
  ]);

  const fallback = windowActionCandidateFromAnnotationMetadata({
    annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed',
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    windowBinding: {
      status: 'manual-bound',
      windowRef: 'desktop-window:app:legacy-canvas:main',
      appName: 'Legacy Canvas',
      bundleId: 'legacy.canvas',
      appKind: 'ordinary-app',
      windowBounds: { x: 0, y: 0, width: 800, height: 600 },
    },
  }, {
    capabilities: { systemInput: true },
  });

  const route = routeWindowAction({
    target: fallback.routeTarget!,
    action: 'click',
    evidenceRefs: fallback.evidenceRefs,
  });
  assert.equal(route.adapter, 'system-input');
  assert.equal(route.owner, 'agent-host-adapter');
  assert.equal(route.guiExecutable, false);
  assert.deepEqual(route.evidenceRefs, [
    { kind: 'shared-system-input', ref: 'shared-system-input:legacy.canvas:click' },
    { kind: 'annotation', ref: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed' },
  ]);
});

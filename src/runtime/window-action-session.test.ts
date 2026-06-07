import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createActorCursor,
  createScopedInputAdapter,
  createWindowActionFocusLease,
  createWindowActionSession,
  createWindowActionSessionFromAnnotationMetadata,
  dispatchWindowAction,
  enterWindowActionSession,
  markWindowActionObservationStale,
  leaveWindowActionSession,
  planWindowActionFocusLease,
  projectWindowActionSessionForGui,
  pauseWindowActionSession,
  releaseWindowActionFocusLease,
  recordWindowAction,
  removeWindowActionSession,
  routeWindowAction,
  stopWindowActionSession,
  WINDOW_ACTION_OBSERVATION_STALE_REASONS,
  windowActionCandidateFromAnnotationMetadata,
  type WindowActionObserveBeforeMutateEvidence,
} from './window-action-session.js';

const now = '2026-06-03T00:00:00.000Z';

function windowObserveEvidence(
  overrides: Partial<WindowActionObserveBeforeMutateEvidence> = {},
): WindowActionObserveBeforeMutateEvidence {
  return {
    status: 'current',
    observedAt: now,
    freshnessCheckedAt: now,
    freshnessCheck: {
      status: 'current',
      observedAt: now,
      checkedAt: now,
      maxAgeMs: 30_000,
    },
    ...overrides,
  };
}

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
  const appiumTextEditSaveRoute = routeWindowAction({
    target: {
      app: { id: 'com.apple.TextEdit', name: 'TextEdit', kind: 'editor' },
      capabilities: { appiumMac2: true, accessibility: true },
    },
    action: 'save',
  });
  assert.equal(appiumTextEditSaveRoute.adapter, 'appium-mac2');
  assert.equal(appiumTextEditSaveRoute.evidence?.editorSaveRequiresInputEvent, true);
  assert.equal(appiumTextEditSaveRoute.evidence?.editorSaveRequiresArtifactValidator, true);
  assert.notEqual(appiumTextEditSaveRoute.evidence?.sharedSystemInput, true);
  assert.ok(appiumTextEditSaveRoute.evidenceRefs.some((item) => item.kind === 'appium-mac2-target-binding'));
  const appiumTextEditTypeRoute = routeWindowAction({
    target: {
      app: { id: 'com.apple.TextEdit', name: 'TextEdit', kind: 'editor' },
      capabilities: { appiumMac2: true, accessibility: true },
    },
    action: 'type',
  });
  assert.equal(appiumTextEditTypeRoute.adapter, 'appium-mac2');
  assert.notEqual(appiumTextEditTypeRoute.evidence?.sharedSystemInput, true);
  assert.ok(appiumTextEditTypeRoute.evidenceRefs.some((item) => item.kind === 'appium-mac2-target-binding'));
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
  assert.equal(
    routeWindowAction({
      target: {
        app: { id: 'terminal:local-shell', name: 'Local shell', kind: 'unknown' },
        capabilities: { terminal: true, systemInput: true },
      },
      action: 'type',
    }).adapter,
    'terminal',
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

test('WindowActionSession product schema owns refs-first target, leases, authorization, controls, and observation lifecycle', () => {
  const session = createWindowActionSession({
    id: 'product-window',
    windowRef: 'window:product/main',
    app: { id: 'org.sciforge.Product', name: 'Product Window', kind: 'ordinary-app' },
    bounds: { x: 4, y: 8, width: 640, height: 480 },
    screenId: 'screen-main',
    evidenceRefs: [
      { kind: 'evidence-ledger', ref: 'evidence:window-action-session/product-window/ledger' },
      { kind: 'raw', ref: 'data:image/png;base64,secret-pixels' },
    ],
    timestamp: now,
  });

  assert.deepEqual(session.targetSummary, {
    label: 'Product Window',
    appKind: 'ordinary-app',
    windowRef: 'window:product/main',
    screenId: 'screen-main',
    bounds: { x: 4, y: 8, width: 640, height: 480 },
  });
  assert.deepEqual(session.adapterRefs, []);
  assert.equal(session.inputLease.ref, 'input-lease:window-action-session/product-window');
  assert.equal(session.inputLease.status, 'available');
  assert.equal(session.authorizationProfile.status, 'authorized');
  assert.equal(session.authorizationProfile.profileRef, 'permission:window-action-session/product-window/authorization-profile');
  assert.deepEqual(session.permissionRefs, ['permission:window-action-session/product-window/act']);
  assert.deepEqual(session.controlRefs, {
    cancelRef: 'cancel:window-action-session/product-window',
    stopRef: 'stop:window-action-session/product-window',
  });
  assert.deepEqual(session.evidenceLedgerRefs, ['evidence:window-action-session/product-window/ledger']);
  assert.equal(session.observation.status, 'unknown');
  assert.deepEqual(session.observation.stale, {
    reasons: [],
    refreshRequired: true,
    evidenceRefs: [],
  });
  assert.doesNotMatch(JSON.stringify(session), /data:image|base64|secret-pixels/);
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
    actionId: 'codex-window-action-attempt-1',
    action: 'type',
    status: 'running',
    textLength: 6,
    timestamp: now,
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:vscode-before-type' }],
    observeBeforeMutate: windowObserveEvidence({ screenId: 'screen:built-in', windowRef: 'window:vscode:main' }),
  }, {
    'app-native-command': async ({ route, input }) => {
      calls.push(`${route.owner}:${route.adapter}:${route.guiExecutable}:${input.action}:${input.actionId}`);
      return {
        status: 'completed',
        evidenceRefs: [{ kind: 'command', ref: 'app-native-command:vscode:type-1' }],
      };
    },
  });

  assert.deepEqual(calls, ['agent-host-adapter:app-native-command:false:type:codex-window-action-attempt-1']);
  assert.equal(dispatched.route.adapter, 'app-native-command');
  assert.equal(dispatched.route.owner, 'agent-host-adapter');
  assert.equal(dispatched.route.guiExecutable, false);
  assert.equal(dispatched.session.events.at(-1)?.type, 'type');
  assert.equal(dispatched.session.events.at(-1)?.actionId, 'codex-window-action-attempt-1');
  assert.equal(dispatched.session.events.at(-1)?.status, 'completed');
  assert.deepEqual(dispatched.session.events.at(-1)?.evidenceRefs, [
    { kind: 'command', ref: 'app-native-command:vscode:type-1' },
  ]);

  const systemInput = await dispatchWindowAction(session, {
    target: {
      app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      capabilities: { systemInput: true, explicitHandoff: true },
    },
    action: 'click',
    status: 'running',
    timestamp: now,
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:system-input-before' }],
    observeBeforeMutate: windowObserveEvidence({ screenId: 'screen:built-in', windowRef: 'window:vscode:main' }),
  }, {
    'system-input': async () => ({
      status: 'completed',
      evidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:system-input-after' }],
    }),
  });

  assert.equal(systemInput.route.adapter, 'system-input');
  assert.deepEqual(systemInput.session.events.at(-1)?.evidenceRefs, [
    { kind: 'shared-system-input', ref: 'shared-system-input:legacy.canvas:click' },
    { kind: 'focus-lease', ref: 'focus-lease:screen:built-in/agent-runtime-1/2026-06-03t00:00:00.000z' },
    { kind: 'screenshot', ref: 'window-action-ref:system-input-after' },
  ]);
});

test('Accessibility scoped input adapter exposes only target hints, state snapshots, and non-private bindings', async () => {
  const session = enterWindowActionSession(createWindowActionSession({
    windowRef: 'window:legacy-canvas:main',
    app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
    screenId: 'screen:built-in',
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  }), { timestamp: now });
  const route = routeWindowAction({
    target: {
      app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      capabilities: { accessibility: true },
    },
    action: 'click',
  });
  assert.equal(route.adapter, 'accessibility-ui-automation');
  assert.equal(route.owner, 'agent-host-adapter');
  assert.equal(route.guiExecutable, false);
  assert.equal(route.evidence?.accessibilityTargetHintsOnly, true);
  assert.equal(route.evidence?.nonPrivateActionBindingOnly, true);
  assert.deepEqual(route.evidenceRefs, [
    { kind: 'target-hint', ref: 'accessibility-ui-automation:legacy.canvas:target-hints' },
    { kind: 'state-snapshot', ref: 'accessibility-ui-automation:legacy.canvas:state-snapshot' },
    { kind: 'non-private-action-binding', ref: 'accessibility-ui-automation:legacy.canvas:click:action-binding' },
  ]);

  let handlerCalls = 0;
  const dispatched = await dispatchWindowAction(session, {
    target: {
      app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      capabilities: { accessibility: true },
    },
    action: 'click',
    status: 'running',
    timestamp: now,
    targetDescription: 'visible search field',
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:accessibility-before-click' }],
    observeBeforeMutate: windowObserveEvidence({ screenId: 'screen:built-in', windowRef: 'window:legacy-canvas:main' }),
  }, {
    'accessibility-ui-automation': async ({ scopedInputAdapter }) => {
      handlerCalls += 1;
      assert.deepEqual(scopedInputAdapter.evidenceRefs, route.evidenceRefs);
      return {
        status: 'completed',
        evidenceRefs: [{ kind: 'executor-event', ref: 'accessibility-ui-automation:legacy.canvas/click/executor-event' }],
        afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:accessibility-after-click' }],
      };
    },
  }, {
    agentId: 'agent-runtime-1',
    actorCursorRef: 'actor-cursor:agent-runtime-1/cursor-runtime-1',
  });

  assert.equal(handlerCalls, 1);
  assert.equal(dispatched.adapterResult.status, 'completed');
  assert.equal(dispatched.session.events.at(-1)?.scopedInputAdapterRef, dispatched.scopedInputAdapter.ref);
  assert.equal(dispatched.scopedInputAdapter.adapter, 'accessibility-ui-automation');
});

test('Terminal scoped input adapter records PTY evidence and blocks shell artifacts outside explicit terminal workflows', async () => {
  const session = enterWindowActionSession(createWindowActionSession({
    windowRef: 'window:terminal:main',
    app: { id: 'com.apple.Terminal', name: 'Terminal', kind: 'terminal' },
    screenId: 'screen:built-in',
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  }), { timestamp: now });
  const terminalEvidence = {
    commandIntentRefs: [{ kind: 'command-intent', ref: 'terminal-pty:session-1/intent/echo-report' }],
    visibleTerminalSessionRefs: [{ kind: 'visible-terminal-session', ref: 'terminal-pty:session-1/visible' }],
    transcriptRefs: [{ kind: 'transcript', ref: 'terminal-pty:session-1/transcript/1' }],
    exitCode: 0,
    artifactRefs: [{ kind: 'artifact', ref: 'terminal-pty:session-1/artifacts/report.md' }],
  };
  let blockedHandlerCalls = 0;

  const blocked = await dispatchWindowAction(session, {
    target: {
      app: { id: 'com.apple.Terminal', name: 'Terminal', kind: 'terminal' },
      capabilities: { terminal: true },
    },
    action: 'type',
    status: 'running',
    timestamp: now,
    text: 'echo report > report.md',
    textLength: 23,
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:terminal-before-type' }],
    observeBeforeMutate: windowObserveEvidence({ screenId: 'screen:built-in', windowRef: 'window:terminal:main' }),
  }, {
    terminal: async () => {
      blockedHandlerCalls += 1;
      return {
        status: 'completed',
        evidenceRefs: [{ kind: 'executor-event', ref: 'terminal-pty:session-1/executor-event/1' }],
        afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:terminal-after-type' }],
        ...terminalEvidence,
      };
    },
  });

  assert.equal(blockedHandlerCalls, 1);
  assert.equal(blocked.adapterResult.status, 'blocked');
  assert.match(JSON.stringify(blocked.session.events.at(-1)?.evidenceRefs ?? []), /terminal-workflow-required|shell-artifact-not-gui/);

  const completed = await dispatchWindowAction(session, {
    target: {
      app: { id: 'com.apple.Terminal', name: 'Terminal', kind: 'terminal' },
      capabilities: { terminal: true, terminalWorkflow: true },
    },
    action: 'type',
    status: 'running',
    timestamp: now,
    text: 'echo report > report.md',
    textLength: 23,
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:terminal-before-type' }],
    observeBeforeMutate: windowObserveEvidence({ screenId: 'screen:built-in', windowRef: 'window:terminal:main' }),
  }, {
    terminal: async () => ({
      status: 'completed',
      evidenceRefs: [{ kind: 'executor-event', ref: 'terminal-pty:session-1/executor-event/1' }],
      afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:terminal-after-type' }],
      ...terminalEvidence,
    }),
  });

  assert.equal(completed.route.adapter, 'terminal');
  assert.equal(completed.adapterResult.status, 'completed');
  assert.deepEqual(completed.session.events.at(-1)?.evidenceRefs, [
    ...completed.route.evidenceRefs,
    { kind: 'executor-event', ref: 'terminal-pty:session-1/executor-event/1' },
    ...terminalEvidence.commandIntentRefs,
    ...terminalEvidence.visibleTerminalSessionRefs,
    ...terminalEvidence.transcriptRefs,
    { kind: 'exit-code', ref: 'terminal-pty:session-1/exit-code/0' },
    ...terminalEvidence.artifactRefs,
  ]);
  assert.doesNotMatch(JSON.stringify(completed.session.events.at(-1)), /echo report > report\.md/);
});

test('Editor save actions require visible input event and artifact validator refs', async () => {
  const session = enterWindowActionSession(createWindowActionSession({
    windowRef: 'window:vscode:main',
    app: { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', kind: 'editor' },
    screenId: 'screen:built-in',
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  }), { timestamp: now });

  const missingValidator = await dispatchWindowAction(session, {
    target: {
      app: { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', kind: 'editor' },
      capabilities: { appNativeCommand: true, accessibility: true },
    },
    action: 'save',
    status: 'running',
    timestamp: now,
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:editor-before-save' }],
    observeBeforeMutate: windowObserveEvidence({ screenId: 'screen:built-in', windowRef: 'window:vscode:main' }),
  }, {
    'app-native-command': async () => ({
      status: 'completed',
      evidenceRefs: [{ kind: 'executor-event', ref: 'app-native-command:vscode/save/executor-event' }],
      afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:editor-after-save' }],
    }),
  });

  assert.equal(missingValidator.adapterResult.status, 'blocked');
  assert.match(JSON.stringify(missingValidator.session.events.at(-1)?.evidenceRefs ?? []), /editor-save-validation/);

  const saved = await dispatchWindowAction(session, {
    target: {
      app: { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', kind: 'editor' },
      capabilities: { appNativeCommand: true, accessibility: true },
    },
    action: 'save',
    status: 'running',
    timestamp: now,
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:editor-before-save' }],
    observeBeforeMutate: windowObserveEvidence({ screenId: 'screen:built-in', windowRef: 'window:vscode:main' }),
  }, {
    'app-native-command': async () => ({
      status: 'completed',
      evidenceRefs: [
        { kind: 'executor-event', ref: 'app-native-command:vscode/save/executor-event' },
        { kind: 'input-event', ref: 'app-native-command:vscode/save/input-event' },
        { kind: 'artifact-validator', ref: 'window-action-session:vscode-main/artifact-validator/report.md' },
      ],
      afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:editor-after-save' }],
    }),
  });

  assert.equal(saved.adapterResult.status, 'completed');
  assert.match(JSON.stringify(saved.session.events.at(-1)?.evidenceRefs ?? []), /input-event/);
  assert.match(JSON.stringify(saved.session.events.at(-1)?.evidenceRefs ?? []), /artifact-validator/);
});

test('File manager adapter requires visible selection and directory evidence, and remote deletes hard-confirm first', async () => {
  const session = enterWindowActionSession(createWindowActionSession({
    windowRef: 'window:finder:main',
    app: { id: 'com.apple.finder', name: 'Finder', kind: 'file-manager' },
    screenId: 'screen:built-in',
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  }), { timestamp: now });
  let deleteHandlerCalls = 0;

  const deleteBlocked = await dispatchWindowAction(session, {
    target: {
      app: { id: 'com.apple.finder', name: 'Finder', kind: 'file-manager' },
      capabilities: { fileManager: true, remote: true },
    },
    action: 'delete',
    status: 'running',
    timestamp: now,
    targetDescription: 'remote report.csv',
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:file-manager-before-delete' }],
    observeBeforeMutate: windowObserveEvidence({ screenId: 'screen:built-in', windowRef: 'window:finder:main' }),
  }, {
    'file-manager': async () => {
      deleteHandlerCalls += 1;
      return { status: 'completed' };
    },
  });

  assert.equal(deleteHandlerCalls, 0);
  assert.equal(deleteBlocked.adapterResult.status, 'blocked');
  assert.match(JSON.stringify(deleteBlocked.session.events.at(-1)?.evidenceRefs ?? []), /hard-confirm/);

  const renamed = await dispatchWindowAction(session, {
    target: {
      app: { id: 'com.apple.finder', name: 'Finder', kind: 'file-manager' },
      capabilities: { fileManager: true },
    },
    action: 'rename',
    status: 'running',
    timestamp: now,
    targetDescription: 'report draft.md',
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:file-manager-before-rename' }],
    observeBeforeMutate: windowObserveEvidence({ screenId: 'screen:built-in', windowRef: 'window:finder:main' }),
  }, {
    'file-manager': async () => ({
      status: 'completed',
      evidenceRefs: [
        { kind: 'executor-event', ref: 'file-manager:finder/rename/executor-event' },
        { kind: 'visible-file-selection', ref: 'file-manager:finder/selection/report-draft' },
        { kind: 'directory-evidence', ref: 'file-manager:finder/directory/listing-after-rename' },
      ],
      afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:file-manager-after-rename' }],
    }),
  });

  assert.equal(renamed.route.adapter, 'file-manager');
  assert.equal(renamed.adapterResult.status, 'completed');
  assert.match(JSON.stringify(renamed.session.events.at(-1)?.evidenceRefs ?? []), /visible-file-selection/);
  assert.match(JSON.stringify(renamed.session.events.at(-1)?.evidenceRefs ?? []), /directory-evidence/);
});

test('Shared system input fallback is blocked by default and only runs for diagnostics or explicit handoff', async () => {
  const session = enterWindowActionSession(createWindowActionSession({
    windowRef: 'window:legacy-canvas:main',
    app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
    screenId: 'screen:built-in',
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  }), { timestamp: now });
  let blockedHandlerCalls = 0;

  const blocked = await dispatchWindowAction(session, {
    target: {
      app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      capabilities: { systemInput: true },
    },
    action: 'click',
    status: 'running',
    timestamp: now,
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:system-input-before' }],
    observeBeforeMutate: windowObserveEvidence({ screenId: 'screen:built-in', windowRef: 'window:legacy-canvas:main' }),
  }, {
    'system-input': async () => {
      blockedHandlerCalls += 1;
      return { status: 'completed' };
    },
  });

  assert.equal(blockedHandlerCalls, 0);
  assert.equal(blocked.adapterResult.status, 'blocked');
  assert.match(JSON.stringify(blocked.session.events.at(-1)?.evidenceRefs ?? []), /shared-system-input-default-blocked/);

  const diagnostic = await dispatchWindowAction(session, {
    target: {
      app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      capabilities: { systemInput: true, diagnostic: true },
    },
    action: 'click',
    status: 'running',
    timestamp: now,
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:system-input-before' }],
    observeBeforeMutate: windowObserveEvidence({ screenId: 'screen:built-in', windowRef: 'window:legacy-canvas:main' }),
  }, {
    'system-input': async () => ({
      status: 'completed',
      evidenceRefs: [{ kind: 'executor-event', ref: 'shared-system-input:legacy.canvas/click/executor-event' }],
      afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:system-input-after' }],
    }),
  });

  assert.equal(diagnostic.adapterResult.status, 'completed');
  assert.equal(diagnostic.route.evidence?.diagnosticOnly, true);
});

test('WindowActionSession creates scoped input adapter refs per agent session', async () => {
  const cursor = createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
    cursorId: 'cursor-runtime-1',
  });
  const session = enterWindowActionSession(createWindowActionSession({
    windowRef: 'window:vscode:main',
    app: { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', kind: 'editor' },
  }), cursor, { timestamp: now });
  let adapterRefFromHandler = '';

  const dispatched = await dispatchWindowAction(session, {
    target: {
      app: { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', kind: 'editor' },
      capabilities: { appNativeCommand: true, accessibility: true, systemInput: true },
    },
    action: 'type',
    status: 'running',
    textLength: 6,
    timestamp: now,
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:vscode-before-type' }],
    observeBeforeMutate: windowObserveEvidence({ windowRef: 'window:vscode:main' }),
  }, {
    'app-native-command': async ({ scopedInputAdapter }) => {
      adapterRefFromHandler = scopedInputAdapter.ref;
      return {
        status: 'completed',
        evidenceRefs: [{ kind: 'command', ref: 'app-native-command:vscode:type-1' }],
      };
    },
  }, {
    agentId: 'agent-runtime-1',
    actorCursorRef: 'actor-cursor:agent-runtime-1/cursor-runtime-1',
  });

  const event = dispatched.session.events.at(-1);
  assert.equal(dispatched.route.adapter, 'app-native-command');
  assert.equal(dispatched.scopedInputAdapter.ref, adapterRefFromHandler);
  assert.equal(dispatched.scopedInputAdapter.agentId, 'agent-runtime-1');
  assert.equal(dispatched.scopedInputAdapter.adapter, 'app-native-command');
  assert.equal(dispatched.scopedInputAdapter.focusMode, 'focus-free');
  assert.equal(event?.scopedInputAdapterRef, dispatched.scopedInputAdapter.ref);
  assert.equal(event?.actorCursor?.agentId, 'agent-runtime-1');
  assert.deepEqual(dispatched.session.scopedInputAdapters.map((adapter) => adapter.ref), [
    dispatched.scopedInputAdapter.ref,
  ]);
});

test('WindowActionSession action events keep source annotation and before/after evidence refs separate', async () => {
  const session = enterWindowActionSession(createWindowActionSession({
    windowRef: 'window:plotter:main',
    app: { id: 'org.sciforge.plotter', name: 'Plotter', kind: 'ordinary-app' },
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  }), { timestamp: now });

  const dispatched = await dispatchWindowAction(session, {
    target: {
      app: { id: 'org.sciforge.plotter', name: 'Plotter', kind: 'ordinary-app' },
      capabilities: { accessibility: true },
    },
    action: 'click',
    status: 'running',
    timestamp: now,
    sourceAnnotationRefs: [
      { kind: 'annotation', ref: 'desktop-annotation:workspace-a/session-a/annotation/plot-region' },
      { kind: 'screenshot', ref: 'desktop-annotation:workspace-a/session-a/screenshot/plot-region' },
      { kind: 'raw', ref: 'not a ref', payload: 'DO_NOT_KEEP' },
    ],
    beforeEvidenceRefs: [
      { kind: 'screenshot', ref: 'window-action-ref:before-click' },
    ],
    observeBeforeMutate: windowObserveEvidence({ windowRef: 'window:plotter:main' }),
  }, {
    'accessibility-ui-automation': async () => ({
      status: 'completed',
      afterEvidenceRefs: [
        { kind: 'screenshot', ref: 'window-action-ref:after-click' },
      ],
      evidenceRefs: [
        { kind: 'executor-event', ref: 'executor-event:accessibility/click-1' },
      ],
    }),
  }, {
    agentId: 'agent-runtime-1',
    actorCursorRef: 'actor-cursor:agent-runtime-1/cursor-runtime-1',
  });

  const event = dispatched.session.events.at(-1);
  assert.equal(event?.actorCursorRef, 'actor-cursor:agent-runtime-1/cursor-runtime-1');
  assert.deepEqual(event?.sourceAnnotationRefs, [
    { kind: 'annotation', ref: 'desktop-annotation:workspace-a/session-a/annotation/plot-region' },
    { kind: 'screenshot', ref: 'desktop-annotation:workspace-a/session-a/screenshot/plot-region' },
  ]);
  assert.deepEqual(event?.beforeEvidenceRefs, [
    { kind: 'screenshot', ref: 'window-action-ref:before-click' },
  ]);
  assert.deepEqual(event?.afterEvidenceRefs, [
    { kind: 'screenshot', ref: 'window-action-ref:after-click' },
  ]);
  assert.doesNotMatch(JSON.stringify(event), /DO_NOT_KEEP|payload/);
});

test('WindowActionSession blocks mutating dispatches without before evidence refs', async () => {
  const session = enterWindowActionSession(createWindowActionSession({
    windowRef: 'window:legacy-canvas:main',
    app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
    screenId: 'screen:built-in',
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  }), { timestamp: now });
  let handlerCalls = 0;

  const blocked = await dispatchWindowAction(session, {
    target: {
      app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      capabilities: { systemInput: true },
    },
    action: 'click',
    status: 'running',
    timestamp: now,
  }, {
    'system-input': async () => {
      handlerCalls += 1;
      return { status: 'completed' };
    },
  }, {
    agentId: 'agent-runtime-1',
  });

  assert.equal(handlerCalls, 0);
  assert.equal(blocked.adapterResult.status, 'blocked');
  assert.equal(blocked.session.events.at(-1)?.type, 'click');
  assert.equal(blocked.session.events.at(-1)?.status, 'blocked');
  assert.match(JSON.stringify(blocked.session.events.at(-1)?.evidenceRefs ?? []), /observe-before-mutate/);
});

test('WindowActionSession blocks mutating dispatches with stale observe-before-mutate evidence', async () => {
  const session = enterWindowActionSession(createWindowActionSession({
    windowRef: 'window:legacy-canvas:main',
    app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
    screenId: 'screen:built-in',
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  }), { timestamp: now });
  let handlerCalls = 0;

  const blocked = await dispatchWindowAction(session, {
    target: {
      app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      capabilities: { systemInput: true },
    },
    action: 'click',
    status: 'running',
    timestamp: now,
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:stale-before' }],
    observeBeforeMutate: windowObserveEvidence({
      observedAt: '2026-06-02T23:00:00.000Z',
      freshnessCheckedAt: '2026-06-02T23:00:00.000Z',
      screenId: 'screen:built-in',
      windowRef: 'window:legacy-canvas:main',
      freshnessCheck: {
        status: 'current',
        observedAt: '2026-06-02T23:00:00.000Z',
        checkedAt: '2026-06-02T23:00:00.000Z',
        maxAgeMs: 1_000,
      },
    }),
  }, {
    'system-input': async () => {
      handlerCalls += 1;
      return { status: 'completed' };
    },
  }, {
    agentId: 'agent-runtime-1',
  });

  assert.equal(handlerCalls, 0);
  assert.equal(blocked.adapterResult.status, 'blocked');
  assert.equal(blocked.session.events.at(-1)?.type, 'click');
  assert.equal(blocked.session.events.at(-1)?.status, 'blocked');
  assert.match(JSON.stringify(blocked.session.events.at(-1)?.evidenceRefs ?? []), /stale-observation|observe-before-mutate/);
});

test('WindowActionSession records structured stale lifecycle for refresh-forcing causes', () => {
  assert.deepEqual(WINDOW_ACTION_OBSERVATION_STALE_REASONS, [
    'focus-loss',
    'window-migration',
    'resize',
    'occlusion',
    'close',
    'navigation',
    'scroll',
    'input',
  ]);

  const session = createWindowActionSession({
    id: 'stale-window',
    windowRef: 'window:stale/main',
    screenId: 'screen-main',
    timestamp: now,
  });

  for (const reason of WINDOW_ACTION_OBSERVATION_STALE_REASONS) {
    const stale = markWindowActionObservationStale(session, reason, {
      timestamp: now,
      evidenceRefs: [{ kind: 'observation', ref: `evidence:window-action-session/stale-window/${reason}` }],
    });
    assert.deepEqual(stale.observation.stale.reasons, [reason]);
    assert.equal(stale.observation.stale.refreshRequired, reason !== 'close');
    assert.equal(stale.observation.status, reason === 'close' ? 'blocked' : 'stale');
  }

  const resized = markWindowActionObservationStale(session, 'resize', { timestamp: now });
  assert.equal(resized.observation.status, 'stale');
  assert.deepEqual(resized.observation.stale.reasons, ['resize']);

  const navigated = markWindowActionObservationStale(session, 'navigation', { timestamp: now });
  assert.equal(navigated.observation.status, 'stale');
  assert.deepEqual(navigated.observation.stale.reasons, ['navigation']);

  const inputStale = markWindowActionObservationStale(session, 'input', { timestamp: now });
  assert.equal(inputStale.observation.status, 'stale');
  assert.deepEqual(inputStale.observation.stale.reasons, ['input']);
});

test('dispatch evidence visibly ties actor cursor to the same WindowActionSession owner prefix', async () => {
  const session = enterWindowActionSession(createWindowActionSession({
    id: 'owned-window',
    windowRef: 'window:owned/main',
    app: { id: 'org.sciforge.Owned', name: 'Owned Window', kind: 'ordinary-app' },
    timestamp: now,
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
    cursorId: 'cursor-runtime-1',
  }), {
    timestamp: now,
    actorCursorRef: 'actor-cursor:window-action-session/owned-window/agent-runtime-1/cursor-runtime-1',
  });

  const dispatched = await dispatchWindowAction(session, {
    target: {
      app: { id: 'org.sciforge.Owned', name: 'Owned Window', kind: 'ordinary-app' },
      capabilities: { accessibility: true },
    },
    action: 'click',
    status: 'running',
    timestamp: now,
    beforeEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-ref:owned-before-click' }],
    observeBeforeMutate: windowObserveEvidence({ windowRef: 'window:owned/main' }),
  }, {
    'accessibility-ui-automation': async () => ({
      status: 'completed',
      evidenceRefs: [{ kind: 'executor-event', ref: 'accessibility-ui-automation:owned/click/executor-event' }],
    }),
  }, {
    agentId: 'agent-runtime-1',
    actorCursorRef: 'actor-cursor:window-action-session/owned-window/agent-runtime-1/cursor-runtime-1',
  });

  const event = dispatched.session.events.at(-1);
  assert.equal(event?.actorCursorRef, 'actor-cursor:window-action-session/owned-window/agent-runtime-1/cursor-runtime-1');
  assert.ok(event?.evidenceRefs.some((item) => (
    item.kind === 'actor-cursor'
    && item.ref === 'actor-cursor:window-action-session/owned-window/agent-runtime-1/cursor-runtime-1'
  )));
  assert.ok(event?.actorCursorRef?.startsWith(`actor-cursor:window-action-session/${dispatched.session.id}/`));
  assert.equal(dispatched.session.actorCursor?.target?.sessionId, dispatched.session.id);
});

test('GUI projection exposes only session status, actor cursor, confirmation, and stop/cancel controls', () => {
  const session = enterWindowActionSession(createWindowActionSession({
    id: 'gui-projected',
    windowRef: 'window:gui/main',
    app: { id: 'org.sciforge.Gui', name: 'GUI Window', kind: 'ordinary-app' },
    timestamp: now,
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
    cursorId: 'cursor-runtime-1',
  }), {
    timestamp: now,
    actorCursorRef: 'actor-cursor:window-action-session/gui-projected/agent-runtime-1/cursor-runtime-1',
  });

  const projection = projectWindowActionSessionForGui(session, {
    confirmationRef: 'approval:window-action-session/gui-projected/confirm-risk',
  });

  assert.deepEqual(Object.keys(projection).sort(), [
    'actorCursor',
    'confirmation',
    'controls',
    'schemaVersion',
    'sessionRef',
    'status',
  ]);
  assert.equal(projection.status, 'active');
  assert.equal(projection.actorCursor?.ref, 'actor-cursor:window-action-session/gui-projected/agent-runtime-1/cursor-runtime-1');
  assert.deepEqual(projection.controls, {
    cancelRef: 'cancel:window-action-session/gui-projected',
    stopRef: 'stop:window-action-session/gui-projected',
  });
  assert.deepEqual(projection.confirmation, {
    required: true,
    confirmationRef: 'approval:window-action-session/gui-projected/confirm-risk',
  });
  assert.equal('events' in projection, false);
  assert.equal('scopedInputAdapters' in projection, false);
  assert.equal('evidenceRefs' in projection, false);
  assert.equal('adapterRefs' in projection, false);
});

test('FocusLease serializes focused system input while focus-free adapters remain parallel', () => {
  const session = enterWindowActionSession(createWindowActionSession({
    windowRef: 'window:legacy-canvas:main',
    app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
    screenId: 'screen-main',
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  }), { timestamp: now });
  const systemRoute = routeWindowAction({
    target: {
      app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      capabilities: { systemInput: true },
    },
    action: 'click',
  });
  const systemAdapter = createScopedInputAdapter(session, systemRoute, {
    agentId: 'agent-runtime-1',
    actorCursorRef: 'actor-cursor:agent-runtime-1/cursor-runtime-1',
  });
  const acquired = planWindowActionFocusLease({
    session,
    scopedInputAdapter: systemAdapter,
    actionRef: 'window-action-event:click-1',
    timestamp: now,
  });
  assert.equal(acquired.status, 'acquired');
  assert.equal(acquired.lease?.actor.agentId, 'agent-runtime-1');
  assert.equal(acquired.lease?.target.windowRef, 'window:legacy-canvas:main');
  assert.equal(acquired.lease?.scopedInputAdapterRef, systemAdapter.ref);

  const queued = planWindowActionFocusLease({
    session,
    scopedInputAdapter: systemAdapter,
    actionRef: 'window-action-event:click-2',
    activeLeases: [acquired.lease!],
    timestamp: now,
  });
  assert.equal(queued.status, 'queued');
  assert.match(queued.reason ?? '', /waiting-for-focus-lease/);
  assert.equal(queued.conflictingLeaseRef, acquired.lease?.ref);

  const accessibilityRoute = routeWindowAction({
    target: {
      app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      capabilities: { accessibility: true, systemInput: true },
    },
    action: 'click',
  });
  const accessibilityAdapter = createScopedInputAdapter(session, accessibilityRoute, {
    agentId: 'agent-runtime-2',
  });
  const parallel = planWindowActionFocusLease({
    session,
    scopedInputAdapter: accessibilityAdapter,
    actionRef: 'window-action-event:accessibility-click',
    activeLeases: [acquired.lease!],
    timestamp: now,
  });
  assert.equal(accessibilityAdapter.focusMode, 'focus-free');
  assert.equal(parallel.status, 'not-required');

  const terminalRoute = routeWindowAction({
    target: {
      app: { id: 'terminal:local-shell', name: 'Local shell', kind: 'unknown' },
      capabilities: { terminal: true, systemInput: true },
    },
    action: 'type',
  });
  const terminalAdapter = createScopedInputAdapter(session, terminalRoute, {
    agentId: 'agent-runtime-3',
  });
  const terminalParallel = planWindowActionFocusLease({
    session,
    scopedInputAdapter: terminalAdapter,
    actionRef: 'window-action-event:terminal-type',
    activeLeases: [acquired.lease!],
    timestamp: now,
  });
  assert.equal(terminalAdapter.focusMode, 'focus-free');
  assert.equal(terminalParallel.status, 'not-required');

  const released = releaseWindowActionFocusLease(acquired.lease!, {
    actionRef: 'window-action-event:click-1',
    timestamp: '2026-06-03T00:00:01.000Z',
  });
  assert.equal(released.status, 'released');
  assert.equal(released.releasedAt, '2026-06-03T00:00:01.000Z');
  assert.deepEqual(released.actionRefs, ['window-action-event:click-1']);
});

test('focused system input dispatch records focus takeover and blocks conflicting active leases', async () => {
  const session = enterWindowActionSession(createWindowActionSession({
    windowRef: 'window:legacy-canvas:main',
    app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
    screenId: 'screen-main',
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  }), { timestamp: now });
  const activeLease = createWindowActionFocusLease({
    session,
    scopedInputAdapterRef: 'scoped-input-adapter:other-agent/system-input',
    agentId: 'other-agent',
    actionRef: 'window-action-event:other-click',
    timestamp: now,
  });
  let handlerCalls = 0;

  const blocked = await dispatchWindowAction(session, {
    target: {
      app: { id: 'legacy.canvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      capabilities: { systemInput: true },
    },
    action: 'click',
    status: 'running',
    timestamp: now,
  }, {
    'system-input': async () => {
      handlerCalls += 1;
      return { status: 'completed' };
    },
  }, {
    agentId: 'agent-runtime-1',
    activeFocusLeases: [activeLease],
  });

  assert.equal(handlerCalls, 0);
  assert.equal(blocked.adapterResult.status, 'blocked');
  assert.equal(blocked.focusLease?.status, 'queued');
  assert.equal(blocked.session.events.at(-1)?.status, 'blocked');
  assert.equal(blocked.session.events.at(-1)?.focusLeaseRef, blocked.focusLease?.ref);
  assert.equal(blocked.session.events.at(-1)?.scopedInputAdapterRef, blocked.scopedInputAdapter.ref);
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
    { kind: 'target-hint', ref: 'accessibility-ui-automation:legacy.canvas:target-hints' },
    { kind: 'state-snapshot', ref: 'accessibility-ui-automation:legacy.canvas:state-snapshot' },
    { kind: 'non-private-action-binding', ref: 'accessibility-ui-automation:legacy.canvas:click:action-binding' },
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

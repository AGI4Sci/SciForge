import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyVirtualScreenInputIntentCommandToConfig,
  parseVirtualScreenInputIntentCommand,
} from './input-intent-command.js';
import type { ComputerUseConfig } from './types.js';

test('VirtualAppScreen InputIntent command parses refs and projects click ratios to frame coordinates', () => {
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-canvas',
    '--kind click',
    '--session-ref "computer-use:session/input/session.json"',
    '--screen-ref "virtual-app-screen:input/screen-a"',
    '--target-app-ref "app:vscode"',
    '--target-window-ref "window:vscode/main"',
    '--frame-ref "computer-use:session/input/frames/current.png"',
    '--input-lease-ref "computer-use:session/input/leases/active.json"',
    '--action-adapter-ref "computer-use:session/input/adapters/native-window.json"',
    '--adapter-readiness-ref "computer-use:session/input/readiness/native-window.json"',
    '--evidence-ledger-ref "computer-use:session/input/evidence-ledger.json"',
    '--frame-width 1440',
    '--frame-height 900',
    '--x-ratio 0.125',
    '--y-ratio 0.5',
  ].join(' '));

  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') return;
  assert.deepEqual(parsed.command.refs, {
    sessionRef: 'computer-use:session/input/session.json',
    screenRef: 'virtual-app-screen:input/screen-a',
    targetAppRef: 'app:vscode',
    targetWindowRef: 'window:vscode/main',
    frameRef: 'computer-use:session/input/frames/current.png',
    inputLeaseRef: 'computer-use:session/input/leases/active.json',
    actionAdapterRef: 'computer-use:session/input/adapters/native-window.json',
    adapterReadinessRef: 'computer-use:session/input/readiness/native-window.json',
    evidenceLedgerRef: 'computer-use:session/input/evidence-ledger.json',
  });
  assert.deepEqual(parsed.command.action, {
    type: 'click',
    x: 180,
    y: 450,
    targetDescription: 'VirtualAppScreen input intent',
    riskLevel: 'low',
    screenId: 'virtual-app-screen:input/screen-a',
    windowId: 'window:vscode/main',
    grounding: {
      source: 'virtual-app-screen-canvas',
      intentKind: 'click',
      refs: parsed.command.refs,
      frame: { width: 1440, height: 900 },
      ratios: { 'x-ratio': 0.125, 'y-ratio': 0.5 },
      coordinateSpace: 'virtual-screen-frame',
    },
  });
});

test('VirtualAppScreen InputIntent command routes into a single fixture action config', () => {
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-canvas',
    '--kind type_text',
    '--session-ref "computer-use:session/input/session.json"',
    '--frame-ref "computer-use:session/input/frames/current.png"',
    '--input-lease-ref "computer-use:session/input/leases/active.json"',
    '--action-adapter-ref "computer-use:session/input/adapters/native-window.json"',
    '--adapter-readiness-ref "computer-use:session/input/readiness/native-window.json"',
    '--frame-width 1440',
    '--frame-height 900',
    '--text "hello screen"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') return;

  const config = baseConfig();
  applyVirtualScreenInputIntentCommandToConfig(config, parsed.command);

  assert.equal(config.testActionFixtureMode, true);
  assert.equal(config.maxSteps, 1);
  assert.deepEqual(config.testOnlyPlannedActions, [parsed.command.action]);
  assert.deepEqual(config.completionPolicy, {
    mode: 'one-successful-non-wait-action',
    reason: 'VirtualAppScreen InputIntent terminal-equivalent command',
  });
});

test('VirtualAppScreen lease control InputIntent parses refs without creating a GUI action', () => {
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-control',
    '--kind takeover',
    '--session-ref "computer-use:session/input/session.json"',
    '--screen-ref "virtual-app-screen:input/screen-a"',
    '--target-app-ref "app:vscode"',
    '--target-window-ref "window:vscode/main"',
    '--input-lease-ref "computer-use:session/input/leases/active.json"',
    '--user-lease-ref "computer-use:session/input/leases/user.json"',
    '--agent-lease-ref "computer-use:session/input/leases/agent.json"',
    '--active-lease-owner-ref "computer-use:session/input/leases/owner-agent.json"',
    '--active-lease-owner-role agent',
    '--lease-control-ref "computer-use:session/input/leases/takeover.json"',
    '--action-adapter-ref "computer-use:session/input/adapters/native-window.json"',
    '--adapter-readiness-ref "computer-use:session/input/readiness/native-window.json"',
    '--evidence-ledger-ref "computer-use:session/input/evidence-ledger.json"',
  ].join(' '));

  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') return;
  assert.equal(parsed.command.source, 'virtual-app-screen-control');
  assert.equal(parsed.command.intentKind, 'takeover');
  assert.equal(parsed.command.controlKind, 'takeover');
  assert.equal(parsed.command.action, undefined);
  assert.deepEqual(parsed.command.refs, {
    sessionRef: 'computer-use:session/input/session.json',
    screenRef: 'virtual-app-screen:input/screen-a',
    targetAppRef: 'app:vscode',
    targetWindowRef: 'window:vscode/main',
    inputLeaseRef: 'computer-use:session/input/leases/active.json',
    userLeaseRef: 'computer-use:session/input/leases/user.json',
    agentLeaseRef: 'computer-use:session/input/leases/agent.json',
    activeLeaseOwnerRef: 'computer-use:session/input/leases/owner-agent.json',
    activeLeaseOwnerRole: 'agent',
    leaseControlRef: 'computer-use:session/input/leases/takeover.json',
    actionAdapterRef: 'computer-use:session/input/adapters/native-window.json',
    adapterReadinessRef: 'computer-use:session/input/readiness/native-window.json',
    evidenceLedgerRef: 'computer-use:session/input/evidence-ledger.json',
  });
});

test('VirtualAppScreen InputIntent rejects unsafe refs and pointer intents without dimensions', () => {
  const unsafe = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-canvas',
    '--kind type_text',
    '--session-ref "computer-use:session/input/session.json"',
    '--frame-ref "data:image/png;base64,abc"',
    '--input-lease-ref "computer-use:session/input/leases/active.json"',
    '--action-adapter-ref "computer-use:session/input/adapters/native-window.json"',
    '--adapter-readiness-ref "computer-use:session/input/readiness/native-window.json"',
    '--text hello',
  ].join(' '));
  assert.deepEqual(unsafe, { kind: 'invalid', reason: 'InputIntent ref --frame-ref is unsafe.' });

  const missingDimensions = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-canvas',
    '--kind click',
    '--session-ref "computer-use:session/input/session.json"',
    '--frame-ref "computer-use:session/input/frames/current.png"',
    '--input-lease-ref "computer-use:session/input/leases/active.json"',
    '--action-adapter-ref "computer-use:session/input/adapters/native-window.json"',
    '--adapter-readiness-ref "computer-use:session/input/readiness/native-window.json"',
    '--x-ratio 0.5',
    '--y-ratio 0.5',
  ].join(' '));
  assert.deepEqual(missingDimensions, {
    kind: 'invalid',
    reason: 'Pointer InputIntent requires --frame-width and --frame-height so ratios can be projected safely.',
  });

  const unsafeLeaseControl = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-control',
    '--kind pause-agent',
    '--session-ref "computer-use:session/input/session.json"',
    '--input-lease-ref "computer-use:session/input/leases/active.json"',
    '--lease-control-ref "https://example.invalid/lease.json"',
  ].join(' '));
  assert.deepEqual(unsafeLeaseControl, {
    kind: 'invalid',
    reason: 'InputIntent ref --lease-control-ref is unsafe.',
  });

  const missingLeaseControl = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-control',
    '--kind stop-session',
    '--session-ref "computer-use:session/input/session.json"',
    '--input-lease-ref "computer-use:session/input/leases/active.json"',
  ].join(' '));
  assert.deepEqual(missingLeaseControl, {
    kind: 'invalid',
    reason: 'InputIntent requires --lease-control-ref.',
  });
});

function baseConfig(): ComputerUseConfig {
  return {
    desktopBridgeEnabled: true,
    dryRun: true,
    captureDisplays: [1],
    desktopPlatform: 'darwin',
    windowTarget: {
      enabled: false,
      required: false,
      mode: 'display',
      coordinateSpace: 'screen',
      inputIsolation: 'best-effort',
    },
    maxSteps: 8,
    allowHighRiskActions: false,
    planner: { allowOpenAiRuntime: false, timeoutMs: 120000, maxTokens: 512 },
    grounder: { timeoutMs: 30000, allowServiceLocalPaths: false },
    testActionFixtureMode: false,
    testOnlyPlannedActions: [],
  };
}

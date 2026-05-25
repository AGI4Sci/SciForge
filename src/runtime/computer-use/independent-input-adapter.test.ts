import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  executeIndependentInputAdapterAction,
  hasExecutableIndependentInputAdapter,
  SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER,
} from './independent-input-adapter.js';
import type { ComputerUseConfig, ResolvedWindowTarget } from './types.js';

test('remote-desktop simulated input adapter keeps virtual pointer and keyboard state without system input', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-independent-input-'));
  try {
    const config = baseConfig('independent-input-adapter-ok');
    const targetResolution = resolvedWindowTarget();
    const click = await executeIndependentInputAdapterAction({
      type: 'click',
      x: 42,
      y: 84,
      targetDescription: 'visible Save icon',
    }, config, targetResolution, {
      workspace,
      runDir: workspace,
      stepIndex: 0,
    });
    assert.equal(click.exitCode, 0);
    assert.match(click.stdout, /systemMouseEvents=not-sent/);

    const typed = await executeIndependentInputAdapterAction({
      type: 'type_text',
      text: 'SciForge virtual keyboard',
    }, config, targetResolution, {
      workspace,
      runDir: workspace,
      stepIndex: 1,
    });
    assert.equal(typed.exitCode, 0);

    const state = JSON.parse(await readFile(join(workspace, 'independent-input-adapter.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(state.pointerKeyboardOwnership, 'sciforge-independent-input-adapter');
    assert.equal(state.userDeviceImpact, 'none');
    assert.equal(state.systemMouseEvents, 'not-sent');
    assert.equal(state.systemKeyboardEvents, 'not-sent');
    assert.equal(((state.virtualPointer as Record<string, unknown>).x), 42);
    assert.equal(((state.virtualPointer as Record<string, unknown>).y), 84);
    const keyboard = state.virtualKeyboard as Record<string, unknown>;
    const typedTextLedger = keyboard.typedTextLedger as Array<Record<string, unknown>>;
    assert.equal(typedTextLedger[0]?.text, 'SciForge virtual keyboard');
    assert.equal(((state.actions as Array<Record<string, unknown>>)[0]?.systemMouseEvents), 'not-sent');
    assert.match(await readFile(join(workspace, 'independent-input-pointer.svg'), 'utf8'), /SciForge virtual input pointer/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('remote-desktop simulated input adapter maintains a virtual multi-app session and visible artifact', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-independent-input-session-'));
  try {
    const config = baseConfig('independent-input-adapter-session');
    const targetResolution = resolvedWindowTarget();
    const actions = [
      { type: 'open_app' as const, appName: 'Browser' },
      { type: 'type_text' as const, text: 'Visible source fact: independent input does not move the system mouse.' },
      { type: 'open_app' as const, appName: 'PowerPoint' },
      { type: 'type_text' as const, text: 'SciForge Computer Use L3\n- Browser source reviewed\n- Slide content created\n- Finder shows saved artifact' },
      { type: 'open_app' as const, appName: 'Finder' },
    ];
    for (const [index, action] of actions.entries()) {
      const result = await executeIndependentInputAdapterAction(action, config, targetResolution, {
        workspace,
        runDir: workspace,
        stepIndex: index,
      });
      assert.equal(result.exitCode, 0);
    }

    const adapterState = JSON.parse(await readFile(join(workspace, 'independent-input-adapter.json'), 'utf8')) as Record<string, any>;
    const session = JSON.parse(await readFile(join(workspace, 'virtual-remote-session.json'), 'utf8')) as Record<string, any>;
    assert.equal(adapterState.virtualRemoteSession.stateRef, 'virtual-remote-session.json');
    assert.equal(session.schemaVersion, 'sciforge.computer-use.virtual-remote-session.v1');
    assert.equal(session.activeAppId, 'file-manager-Finder');
    assert.ok(session.apps['browser-Browser']);
    assert.ok(session.apps['slide-editor-PowerPoint']);
    assert.ok(session.apps['file-manager-Finder']);
    assert.equal(session.visibleArtifacts[0]?.delivery, 'virtual-remote-session-artifact');
    assert.equal(session.visibleArtifacts[0]?.status, 'visible-and-saved');
    assert.equal(session.visibleArtifacts[0]?.artifactRef, 'virtual-slide-deck.md');
    assert.match(await readFile(join(workspace, 'virtual-slide-deck.md'), 'utf8'), /systemMouseEvents: not-sent/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('independent input adapter requires an executable provider registration', () => {
  assert.equal(hasExecutableIndependentInputAdapter({
    ...baseConfig('missing-provider'),
    independentInputAdapterProvider: undefined,
  }), false);
  assert.equal(hasExecutableIndependentInputAdapter({
    ...baseConfig('virtual-hid-unimplemented'),
    inputAdapter: 'virtual-hid',
  }), false);
});

function baseConfig(runId: string): ComputerUseConfig {
  return {
    desktopBridgeEnabled: true,
    dryRun: false,
    captureDisplays: [1],
    desktopPlatform: 'darwin',
    windowTarget: {
      enabled: true,
      required: true,
      mode: 'app-window',
      appName: 'Remote Session',
      coordinateSpace: 'window-local',
      inputIsolation: 'require-focused-target',
    },
    runId,
    maxSteps: 2,
    allowHighRiskActions: false,
    inputAdapter: 'remote-desktop',
    independentInputAdapterProvider: SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER,
    planner: { allowOpenAiRuntime: false, timeoutMs: 1000, maxTokens: 512 },
    grounder: { timeoutMs: 1000, allowServiceLocalPaths: false },
    testActionFixtureMode: true,
    testOnlyPlannedActions: [],
  };
}

function resolvedWindowTarget(): ResolvedWindowTarget {
  return {
    ok: true,
    target: {
      enabled: true,
      required: true,
      mode: 'app-window',
      appName: 'Remote Session',
      coordinateSpace: 'window-local',
      inputIsolation: 'require-focused-target',
    },
    captureKind: 'window',
    windowId: 101,
    appName: 'Remote Session',
    title: 'Independent session',
    displayId: 1,
    coordinateSpace: 'window-local',
    inputIsolation: 'require-focused-target',
    schedulerLockId: 'remote-session-101',
    source: 'config',
    diagnostics: [],
  };
}

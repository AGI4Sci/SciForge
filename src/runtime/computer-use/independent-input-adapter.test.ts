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
import type { ComputerUseConfig, ComputerUseObserveBeforeMutateEvidence, GenericVisionAction, ResolvedWindowTarget } from './types.js';

test('remote-desktop simulated input adapter keeps scoped executor state without system input', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-independent-input-'));
  try {
    const config = baseConfig('independent-input-adapter-ok');
    const targetResolution = resolvedWindowTarget();
    const click = await executeIndependentInputAdapterAction(withObserve({
      type: 'click',
      x: 42,
      y: 84,
      targetDescription: 'visible Save icon',
    }), config, targetResolution, {
      workspace,
      runDir: workspace,
      stepIndex: 0,
    });
    assert.equal(click.exitCode, 0);
    assert.match(click.stdout, /systemMouseEvents=not-sent/);

    const typed = await executeIndependentInputAdapterAction(withObserve({
      type: 'type_text',
      text: 'SciForge scoped executor input',
    }), config, targetResolution, {
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
    assert.deepEqual(state.isolationFlags, {
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      failClosedByDefault: true,
    });
    assert.equal(((state.virtualPointer as Record<string, unknown>).x), 42);
    assert.equal(((state.virtualPointer as Record<string, unknown>).y), 84);
    const keyboard = state.virtualKeyboard as Record<string, unknown>;
    const typedTextLedger = keyboard.typedTextLedger as Array<Record<string, unknown>>;
    assert.equal(typedTextLedger[0]?.text, 'SciForge scoped executor input');
    assert.equal(((state.actions as Array<Record<string, unknown>>)[0]?.systemMouseEvents), 'not-sent');
    assert.equal(((state.actions as Array<Record<string, unknown>>)[0]?.sharedSystemInputUsed), false);
    assert.equal(((state.actorCursorLog as Record<string, unknown>).appendOnly), true);
    assert.equal(((state.actorCursorLog as Record<string, unknown>).eventCount), 2);
    const actorCursors = state.actorCursors as Array<Record<string, unknown>>;
    assert.equal(actorCursors[0]?.actorId, 'actor-agent');
    assert.equal(actorCursors[0]?.cursorId, 'actor-agent-cursor');
    assert.equal(actorCursors[0]?.screenId, 'screen-1');
    const executorProjection = state.executorProjection as Record<string, any>;
    assert.equal(executorProjection.schemaVersion, 'sciforge.computer-use.executor-projection.v1');
    assert.equal(executorProjection.eventCount, 2);
    assert.equal(executorProjection.sharedSystemInputUsed, false);
    assert.equal(executorProjection.systemPointerMoved, false);
    assert.equal(executorProjection.systemKeyboardEventsSent, false);
    assert.equal(executorProjection.events[0]?.leaseScope?.kind, 'window-local');
    assert.equal(executorProjection.events[0]?.displayGroupId, 'display-group-1');
    assert.equal(executorProjection.events[0]?.screenId, 'screen-1');
    assert.equal(executorProjection.events[0]?.windowId, 'window-101');
    assert.equal(executorProjection.events[0]?.staleEvidenceInvalidation?.invalidatesVisibleState, true);
    const logLines = (await readFile(join(workspace, 'actor-cursors.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(logLines.length, 2);
    const firstCursorEvent = JSON.parse(logLines[0] ?? '{}') as Record<string, any>;
    assert.equal(firstCursorEvent.schemaVersion, 'sciforge.computer-use.actor-cursor-log.v1');
    assert.equal(firstCursorEvent.eventType, 'intent-proposal');
    assert.equal(firstCursorEvent.actorId, 'actor-agent');
    assert.equal(firstCursorEvent.cursorId, 'actor-agent-cursor');
    assert.equal(firstCursorEvent.sharedSystemInputUsed, false);
    const typedMetadata = ('independentInputAdapter' in typed ? typed.independentInputAdapter : undefined) as Record<string, any>;
    assert.equal(typedMetadata.actorCursorLogRef, 'actor-cursors.jsonl');
    assert.equal(typedMetadata.executorProjectionRef, 'executor-projection.json');
    assert.equal(typedMetadata.leaseScope.kind, 'window-local');
    assert.equal(typedMetadata.sharedSystemInputDiagnostic.failClosedByDefault, true);
    assert.match(await readFile(join(workspace, 'independent-input-pointer.svg'), 'utf8'), /SciForge virtual input pointer/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('remote-desktop simulated input adapter separates window-local pointer and screen executor coordinates', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-independent-input-coordinates-'));
  try {
    const config = baseConfig('independent-input-adapter-coordinates');
    const targetResolution = {
      ...resolvedWindowTarget(),
      bounds: { x: -887, y: -949, width: 1125, height: 763 },
      contentRect: { x: -887, y: -949, width: 1125, height: 763 },
    };
    const click = await executeIndependentInputAdapterAction(withObserve({
      type: 'click',
      x: -800,
      y: -900,
      targetDescription: 'visible file item',
    }), config, targetResolution, {
      workspace,
      runDir: workspace,
      stepIndex: 0,
    });
    assert.equal(click.exitCode, 0);

    const state = JSON.parse(await readFile(join(workspace, 'independent-input-adapter.json'), 'utf8')) as Record<string, any>;
    assert.equal(state.virtualPointer.coordinateSpace, 'window-local');
    assert.equal(state.virtualPointer.x, 87);
    assert.equal(state.virtualPointer.y, 49);
    assert.equal(state.virtualPointer.executorCoordinateSpace, 'screen');
    assert.equal(state.virtualPointer.executorX, -800);
    assert.equal(state.virtualPointer.executorY, -900);
    const action = state.actions[0] as Record<string, any>;
    assert.equal(action.pointer.coordinateSpace, 'window-local');
    assert.equal(action.pointer.x, 87);
    assert.equal(action.pointer.y, 49);
    assert.equal(action.pointer.executorX, -800);
    assert.equal(action.pointer.executorY, -900);
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
      withObserve({ type: 'type_text' as const, text: 'Visible source fact: independent input does not move the system mouse.' }),
      { type: 'open_app' as const, appName: 'PowerPoint' },
      withObserve({ type: 'type_text' as const, text: 'SciForge Computer Use L3\n- Browser source reviewed\n- Slide content created\n- Finder shows saved artifact' }),
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

test('remote-desktop simulated input adapter materializes summary prompts as visible artifacts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-independent-input-summary-artifact-'));
  try {
    const config = baseConfig('independent-input-adapter-summary-artifact');
    const targetResolution = resolvedWindowTarget();
    const taskText = '让 SciForge 总结每个字段/控件的视觉证据和对应 action，只引用 screenshot refs、窗口目标、坐标和 action ledger；过程证据 refs 包括 vision-trace.json。';
    const actions = [
      { type: 'open_app' as const, appName: 'Browser' },
      withObserve({ type: 'type_text' as const, text: '字段视觉证据总结\n- 控件 A: screenshot ref + action ledger ref\n- 控件 B: window-local coordinate evidence\n- Trace: vision-trace.json is process evidence, not the final artifact' }),
      { type: 'open_app' as const, appName: 'Finder' },
    ];
    for (const [index, action] of actions.entries()) {
      const result = await executeIndependentInputAdapterAction(action, config, targetResolution, {
        workspace,
        runDir: workspace,
        stepIndex: index,
        taskText,
      });
      assert.equal(result.exitCode, 0);
    }

    const session = JSON.parse(await readFile(join(workspace, 'virtual-remote-session.json'), 'utf8')) as Record<string, any>;
    assert.equal(session.visibleArtifacts[0]?.kind, 'virtual-document');
    assert.equal(session.visibleArtifacts[0]?.status, 'visible-and-saved');
    assert.equal(session.visibleArtifacts[0]?.artifactRef, 'report.md');
    assert.match(await readFile(join(workspace, 'report.md'), 'utf8'), /字段视觉证据总结/);
    await assert.rejects(readFile(join(workspace, 'vision-trace.json'), 'utf8'));
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

test('independent input adapter fails closed with diagnostic when provider is missing', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-independent-input-missing-provider-'));
  try {
    const result = await executeIndependentInputAdapterAction({
      type: 'type_text',
      text: 'do not use shared system input',
    }, {
      ...baseConfig('missing-provider-execute'),
      independentInputAdapterProvider: undefined,
      allowSharedSystemInput: false,
    }, resolvedWindowTarget(), {
      workspace,
      runDir: workspace,
      stepIndex: 0,
    });

    assert.equal(result.exitCode, 125);
    assert.match(result.stderr, /No executable independent input adapter provider/);
    const diagnostic = ('independentInputAdapter' in result ? result.independentInputAdapter : undefined) as Record<string, unknown>;
    assert.equal(diagnostic.status, 'blocked-no-independent-adapter');
    assert.equal(diagnostic.failClosedByDefault, true);
    assert.equal(diagnostic.sharedSystemInputUsed, false);
    assert.equal(diagnostic.systemPointerMoved, false);
    assert.equal(diagnostic.systemKeyboardEventsSent, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('independent input adapter refuses bare global pointer coordinates before projection', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-independent-input-bare-global-'));
  try {
    const target = {
      ...resolvedWindowTarget(),
      captureKind: 'display' as const,
      windowId: undefined,
      virtualWindowId: undefined,
      coordinateSpace: 'screen' as const,
      schedulerLockId: 'display-1',
    };
    const result = await executeIndependentInputAdapterAction({
      type: 'click',
      x: 200,
      y: 100,
      displayGroupId: 'display-group-1',
      screenId: 'screen-1',
      windowId: 'window-101',
      leaseScope: {
        kind: 'window-local',
        displayGroupId: 'display-group-1',
        screenId: 'screen-1',
        windowId: 'window-101',
      },
    }, baseConfig('bare-global'), target, {
      workspace,
      runDir: workspace,
      stepIndex: 0,
    });

    assert.equal(result.exitCode, 125);
    assert.match(result.stderr, /bare-global-coordinate-blocked/);
    const diagnostic = ('independentInputAdapter' in result ? result.independentInputAdapter : undefined) as Record<string, unknown>;
    assert.equal(diagnostic.status, 'blocked-scoped-scheduler');
    await assert.rejects(readFile(join(workspace, 'actor-cursors.jsonl'), 'utf8'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
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

function withObserve<T extends GenericVisionAction>(action: T): T {
  return {
    ...action,
    observeBeforeMutate: observeEvidence(),
  };
}

function observeEvidence(overrides: Partial<ComputerUseObserveBeforeMutateEvidence> = {}): ComputerUseObserveBeforeMutateEvidence {
  return {
    appStateRef: 'independent-input-before-app-state.json',
    screenshotRef: 'independent-input-before.png',
    captureRef: 'independent-input-before.png',
    accessibilitySnapshotRef: 'independent-input-before-accessibility-state.json',
    stateSnapshotRef: 'independent-input-before-app-state.json',
    groundingRef: 'independent-input-grounding.json',
    sourceObservationRef: 'independent-input-before.png',
    displayGroupId: 'display-group-1',
    screenId: 'screen-1',
    windowId: 'window-101',
    observedAt: '2026-05-31T10:00:00.000Z',
    capturedAt: '2026-05-31T10:00:00.000Z',
    freshnessCheckedAt: '2026-05-31T10:00:00.000Z',
    freshnessCheck: {
      status: 'current',
      observedAt: '2026-05-31T10:00:00.000Z',
      checkedAt: '2026-05-31T10:00:00.000Z',
      maxAgeMs: 300000,
    },
    ...overrides,
  };
}

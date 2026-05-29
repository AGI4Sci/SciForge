import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { capturePackageBridgePort } from './package-bridge-capture-port.js';
import type { HostPortCall } from './package-bridge-stdio.js';
import type { ComputerUseConfig, ScreenshotRef, WindowTargetResolution } from './types.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';

function baseConfig(runId: string): ComputerUseConfig {
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
    runId,
    maxSteps: 4,
    allowHighRiskActions: false,
    planner: { allowOpenAiRuntime: false, timeoutMs: 120000, maxTokens: 512 },
    grounder: {
      timeoutMs: 30000,
      allowServiceLocalPaths: false,
      upload: { strategy: 'inline' },
    },
    testActionFixtureMode: true,
    testOnlyPlannedActions: [],
  };
}

function targetResolution(): WindowTargetResolution {
  return {
    ok: true,
    target: {
      enabled: false,
      required: false,
      mode: 'display',
      coordinateSpace: 'screen',
      inputIsolation: 'best-effort',
    },
    captureKind: 'display',
    displayId: 1,
    coordinateSpace: 'screen',
    inputIsolation: 'best-effort',
    schedulerLockId: 'display-1',
    source: 'dry-run',
    diagnostics: [],
  };
}

function captureState(workspace: string, runId: string) {
  return {
    runDir: join(workspace, '.sciforge/vision-runs', runId),
    targetResolution: targetResolution(),
    screenshotLedger: [] as ScreenshotRef[],
    captureRefsByObservationRef: new Map<string, ScreenshotRef[]>(),
    actionQueue: [],
    captureIndex: 0,
    latestObservation: undefined as Record<string, unknown> | undefined,
    visibleArtifacts: [] as VirtualRemoteVisibleArtifact[],
  };
}

function hostPortCall(kwargs?: Record<string, unknown>, history: unknown[] = []): HostPortCall {
  return {
    type: 'hostPortCall',
    id: 'capture-1',
    port: 'capture',
    args: [{}, history],
    kwargs,
  };
}

test('capturePackageBridgePort materializes refs-first initial observation and updates capture state', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-capture-port-'));
  try {
    const runId = 'cu-capture-port';
    const state = captureState(workspace, runId);
    await mkdir(state.runDir, { recursive: true });

    const observation = await capturePackageBridgePort(hostPortCall(), {
      workspace,
      config: baseConfig(runId),
      state,
    });

    assert.equal(state.captureIndex, 1);
    assert.equal(state.screenshotLedger.length, 1);
    assert.equal(observation.ref, `.sciforge/vision-runs/${runId}/step-000-before-display-1.png`);
    assert.equal(state.captureRefsByObservationRef.get(observation.ref)?.[0]?.path, observation.ref);
    assert.equal(state.latestObservation, observation);
    assert.match(observation.summary, /before-action/);
    assert.match(observation.summary, /target=display:display-fallback/);
    assert.deepEqual(observation.visibleTexts, []);
    assert.equal(observation.artifacts.screenshotRefs[0]?.path, observation.ref);
    assert.equal(observation.metadata.screenshotRefs[0]?.path, observation.ref);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('capturePackageBridgePort preserves after-action naming from host history length', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-capture-port-after-'));
  try {
    const runId = 'cu-capture-port-after';
    const state = captureState(workspace, runId);
    state.captureIndex = 1;
    await mkdir(state.runDir, { recursive: true });

    const observation = await capturePackageBridgePort(hostPortCall({ query: 'after-action' }, [{}, {}]), {
      workspace,
      config: baseConfig(runId),
      state,
    });

    assert.equal(state.captureIndex, 2);
    assert.equal(observation.ref, `.sciforge/vision-runs/${runId}/step-003-after-display-1.png`);
    assert.equal(observation.metadata.query, 'after-action');
    assert.match(observation.summary, /after-action/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

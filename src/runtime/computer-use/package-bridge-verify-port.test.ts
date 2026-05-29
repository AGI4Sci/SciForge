import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { verifyPackageBridgePort } from './package-bridge-verify-port.js';
import type { HostPortCall } from './package-bridge-stdio.js';
import type { ComputerUseConfig, FocusRegion, GenericVisionAction, LoopStep, ScreenshotRef, WindowTargetResolution } from './types.js';
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

function verifyState(workspace: string, runId: string, action: GenericVisionAction) {
  return {
    runDir: join(workspace, '.sciforge/vision-runs', runId),
    targetResolution: targetResolution(),
    screenshotLedger: [] as ScreenshotRef[],
    captureRefsByObservationRef: new Map<string, ScreenshotRef[]>(),
    focusRegionByObservationRef: new Map<string, FocusRegion>(),
    beforeFocusRefsByObservationRef: new Map<string, ScreenshotRef[]>(),
    afterFocusRefsByObservationRef: new Map<string, ScreenshotRef[]>(),
    actionQueue: [] as GenericVisionAction[],
    activeAction: action,
    executedActions: [action],
    dynamicPlannerEnabled: false,
    plannerReportedDone: false,
    plannerAcceptanceContract: undefined as Record<string, unknown> | undefined,
    visionHistorySteps: [] as LoopStep[],
    visibleArtifacts: [] as VirtualRemoteVisibleArtifact[],
  };
}

function hostPortCall(args: unknown[] = []): HostPortCall {
  return {
    type: 'hostPortCall',
    id: 'verify-1',
    port: 'verify',
    args,
    kwargs: {},
  };
}

test('verifyPackageBridgePort accepts final fixture action and appends verifier history step', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-verify-port-'));
  try {
    const runId = 'cu-verify-port';
    const action: GenericVisionAction = {
      type: 'click',
      x: 12,
      y: 34,
      targetDescription: 'Settings button',
      riskLevel: 'low',
    };
    const state = verifyState(workspace, runId, action);

    const result = await verifyPackageBridgePort(hostPortCall([
      { task: 'Click the settings button' },
      { ref: 'before-observation' },
      { ref: 'after-observation' },
      { kind: 'click', target: { description: 'Settings button' } },
      { ok: true, metadata: { exitCode: 0, stdout: 'clicked' } },
    ]), {
      workspace,
      config: baseConfig(runId),
      state,
      packagePlanToGenericAction: () => action,
    });

    assert.equal(result.ok, true);
    assert.equal(result.done, true);
    const metadata = result.metadata as Record<string, unknown>;
    assert.equal(metadata.method, 'host-port-screenshot-ledger');
    assert.equal(metadata.queuedActionsRemaining, 0);
    assert.equal(state.visionHistorySteps.length, 1);
    assert.equal(state.visionHistorySteps[0]?.kind, 'gui-execution');
    assert.equal(state.visionHistorySteps[0]?.status, 'done');
    assert.equal(state.visionHistorySteps[0]?.execution?.executor, 'dry-run-generic-gui-executor');
    assert.equal(state.visionHistorySteps[0]?.verifier?.method, 'computer-use-package-host-port-verifier');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

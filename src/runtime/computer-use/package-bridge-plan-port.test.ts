import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { planPackageBridgePort } from './package-bridge-plan-port.js';
import type { HostPortCall } from './package-bridge-stdio.js';
import type { ComputerUseConfig, GenericVisionAction, LoopStep, ScreenshotRef, WindowTargetResolution } from './types.js';

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

function planState(workspace: string, runId: string, actionQueue: GenericVisionAction[] = []) {
  return {
    runDir: join(workspace, '.sciforge/vision-runs', runId),
    targetResolution: targetResolution(),
    screenshotLedger: [] as ScreenshotRef[],
    captureRefsByObservationRef: new Map<string, ScreenshotRef[]>(),
    actionQueue,
    activeAction: undefined as GenericVisionAction | undefined,
    executedActions: [] as GenericVisionAction[],
    dynamicPlannerEnabled: false,
    plannerReportedDone: false,
    plannerAcceptanceContract: undefined as Record<string, unknown> | undefined,
    latestObservation: undefined as Record<string, unknown> | undefined,
    plannerTraceSteps: [] as LoopStep[],
    visionHistorySteps: [] as LoopStep[],
    missingPlannerAfterCaptured: false,
  };
}

function hostPortCall(args: unknown[] = []): HostPortCall {
  return {
    type: 'hostPortCall',
    id: 'plan-1',
    port: 'plan',
    args,
    kwargs: {},
  };
}

test('planPackageBridgePort returns refs-stable package plan from queued generic action', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-plan-port-'));
  try {
    const runId = 'cu-plan-port';
    const state = planState(workspace, runId, [{
      type: 'click',
      x: 42,
      y: 24,
      targetDescription: 'Save button',
      targetRegionDescription: 'toolbar',
      riskLevel: 'low',
      requiresConfirmation: true,
      confirmationText: 'Click Save',
    }]);
    await mkdir(state.runDir, { recursive: true });

    const plan = await planPackageBridgePort(hostPortCall(), {
      workspace,
      config: baseConfig(runId),
      callbacks: {},
      state,
    });

    assert.equal(state.actionQueue.length, 0);
    assert.equal(state.activeAction?.type, 'click');
    assert.deepEqual(plan, {
      kind: 'click',
      target: {
        description: 'Save button',
        region_description: 'toolbar',
      },
      text: undefined,
      key: undefined,
      keys: undefined,
      direction: undefined,
      amount: undefined,
      appName: undefined,
      riskLevel: 'low',
      requiresConfirmation: true,
      metadata: {
        targetDescription: 'Save button',
        targetRegionDescription: 'toolbar',
        hasHostPlannedCoordinates: true,
        confirmationText: 'Click Save',
      },
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('planPackageBridgePort captures missing-planner after screenshot once when queue is exhausted', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-plan-port-empty-'));
  try {
    const runId = 'cu-plan-port-empty';
    const state = planState(workspace, runId);
    await mkdir(state.runDir, { recursive: true });

    const first = await planPackageBridgePort(hostPortCall(), {
      workspace,
      config: baseConfig(runId),
      callbacks: {},
      state,
    });
    const second = await planPackageBridgePort(hostPortCall(), {
      workspace,
      config: baseConfig(runId),
      callbacks: {},
      state,
    });

    assert.equal(first.done, false);
    assert.match(String(first.reason), /test-only fixture action queue is exhausted/);
    assert.equal(second.done, false);
    assert.equal(state.missingPlannerAfterCaptured, true);
    assert.equal(state.screenshotLedger.length, 1);
    assert.equal(state.screenshotLedger[0]?.path, `.sciforge/vision-runs/${runId}/step-000-after-display-1.png`);
    assert.equal(state.captureRefsByObservationRef.get(state.screenshotLedger[0]?.path ?? '')?.length, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

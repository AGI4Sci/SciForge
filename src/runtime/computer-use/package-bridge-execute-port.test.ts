import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  computerUseArtifactIntentText,
  executePackageBridgePort,
} from './package-bridge-execute-port.js';
import type { HostPortCall } from './package-bridge-stdio.js';
import type { ComputerUseConfig, GenericVisionAction, WindowTargetResolution } from './types.js';
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

function executeState(workspace: string, runId: string) {
  return {
    runDir: join(workspace, '.sciforge/vision-runs', runId),
    targetResolution: targetResolution(),
    activeAction: undefined as GenericVisionAction | undefined,
    executedActions: [] as GenericVisionAction[],
    latestObservation: {
      ref: '.sciforge/vision-runs/cu-execute-port/step-001-before-display-1.png',
      summary: 'Captured visible editor with empty document.',
      visibleTexts: ['Untitled document'],
      metadata: { visibleTexts: ['editor'] },
    },
    virtualRemoteSessionRef: undefined as string | undefined,
    visibleArtifacts: [] as VirtualRemoteVisibleArtifact[],
  };
}

function hostPortCall(args: unknown[] = []): HostPortCall {
  return {
    type: 'hostPortCall',
    id: 'execute-1',
    port: 'execute',
    args,
    kwargs: {},
  };
}

test('executePackageBridgePort runs dry-run action and preserves execution metadata shape', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-'));
  try {
    const runId = 'cu-execute-port';
    const action: GenericVisionAction = {
      type: 'type_text',
      text: 'Draft report',
      targetDescription: 'document body',
      riskLevel: 'low',
    };
    const state = executeState(workspace, runId);

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'type_text', text: 'Draft report' },
      { x: 10, y: 20 },
      { task: 'Create a report', metadata: { plannerAcceptanceContract: { finalArtifactRequired: true } } },
    ]), {
      workspace,
      config: baseConfig(runId),
      state,
      packagePlanToGenericAction: () => action,
    });

    assert.equal(result.ok, true);
    assert.equal(result.blocked, false);
    assert.equal(result.message, 'dry-run package bridge');
    assert.equal(state.activeAction, action);
    assert.deepEqual(state.executedActions, [action]);
    assert.equal(result.metadata.executor, 'dry-run-generic-gui-executor');
    assert.equal(result.metadata.exitCode, 0);
    assert.equal(result.metadata.stdout, 'dry-run package bridge');
    assert.ok(result.metadata.windowTarget);
    assert.equal(result.metadata.windowTarget.captureKind, 'display');
    assert.deepEqual(result.metadata.visibleArtifactRefs, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('computerUseArtifactIntentText includes task, text, and planner acceptance contract', () => {
  assert.equal(
    computerUseArtifactIntentText({
      task: 'Prepare a visible report',
      text: 'Use the editor body',
      metadata: { plannerAcceptanceContract: { finalArtifactRequired: true } },
    }),
    [
      'Prepare a visible report',
      'Use the editor body',
      '{"finalArtifactRequired":true}',
    ].join('\n'),
  );
});

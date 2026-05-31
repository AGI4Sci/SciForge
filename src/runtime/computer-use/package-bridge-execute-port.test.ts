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
      enabled: true,
      required: true,
      mode: 'app-window',
      displayGroupId: 'display-group-1',
      screenId: 'screen-1',
      virtualWindowId: 'window-101',
      appName: 'Editor',
      title: 'Draft',
      coordinateSpace: 'window-local',
      inputIsolation: 'require-focused-target',
    },
    captureKind: 'window',
    displayGroupId: 'display-group-1',
    screenId: 'screen-1',
    windowId: 101,
    virtualWindowId: 'window-101',
    appName: 'Editor',
    title: 'Draft',
    displayId: 1,
    coordinateSpace: 'window-local',
    inputIsolation: 'require-focused-target',
    schedulerLockId: 'window-101',
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
      metadata: {
        visibleTexts: ['editor'],
        screenshotRefs: [{ path: '.sciforge/vision-runs/cu-execute-port/step-001-before-display-1.png' }],
        appStateRef: '.sciforge/vision-runs/cu-execute-port/step-001-before-app-state.json',
        stateSnapshotRef: '.sciforge/vision-runs/cu-execute-port/step-001-before-app-state.json',
        accessibilitySnapshotRef: '.sciforge/vision-runs/cu-execute-port/step-001-before-accessibility-state.json',
        displayGroupId: 'display-group-1',
        screenId: 'screen-1',
        windowId: 'window-101',
        observedAt: '2026-05-31T10:00:00.000Z',
        freshnessCheck: {
          status: 'current',
          observedAt: '2026-05-31T10:00:00.000Z',
          checkedAt: '2026-05-31T10:00:00.000Z',
          maxAgeMs: 300000,
        },
      },
    } as Record<string, unknown> | undefined,
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
      { x: 10, y: 20, groundingRef: '.sciforge/vision-runs/cu-execute-port/step-001-grounding.json' },
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
    assert.equal(state.activeAction?.type, action.type);
    assert.ok(state.activeAction?.observeBeforeMutate?.appStateRef);
    assert.equal(state.executedActions.length, 1);
    assert.equal(state.executedActions[0]?.type, action.type);
    assert.equal(result.metadata.executor, 'dry-run-generic-gui-executor');
    assert.equal(result.metadata.exitCode, 0);
    assert.equal(result.metadata.stdout, 'dry-run package bridge');
    assert.ok(result.metadata.windowTarget);
    assert.equal(result.metadata.windowTarget.captureKind, 'window');
    assert.deepEqual(result.metadata.visibleArtifactRefs, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('executePackageBridgePort blocks mutating execution when current observation refs are missing', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-needs-observation-'));
  try {
    const runId = 'cu-execute-port-needs-observation';
    const action: GenericVisionAction = {
      type: 'click',
      x: 10,
      y: 20,
      targetDescription: 'Save',
      grounding: { coordinateSpace: 'window-local' },
    };
    const state = executeState(workspace, runId);
    state.latestObservation = undefined;
    const config = {
      ...baseConfig(runId),
      dryRun: false,
      inputAdapter: 'remote-desktop',
      independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
    };

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'click', target: { description: 'Save' } },
      { x: 10, y: 20 },
    ]), {
      workspace,
      config,
      state,
      packagePlanToGenericAction: () => action,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.match(result.message, /needs-observation/);
    const metadata = result.metadata as Record<string, any>;
    assert.equal(metadata.schedulerDecision.status, 'needs-observation');
    assert.equal(metadata.schedulerDecisionRefs.mutatingActionExecuted, false);
    assert.deepEqual(state.executedActions, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('executePackageBridgePort carries BrowserRuntime DOM/AX refs as grounding hints without completion authority', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-browser-runtime-'));
  try {
    const runId = 'cu-execute-port-browser-runtime';
    const action: GenericVisionAction = {
      type: 'click',
      x: 12,
      y: 16,
      targetDescription: 'Save button',
      riskLevel: 'low',
    };
    const state = executeState(workspace, runId);
    const metadata = (state.latestObservation?.metadata ?? {}) as Record<string, unknown>;
    Object.assign(metadata, {
      browserRuntimeObservationRef: `.sciforge/vision-runs/${runId}/step-001-before-browser-dom-ax-observation.json`,
      browserRuntimeVisibleDomRef: `.sciforge/vision-runs/${runId}/step-001-before-browser-visible-dom.json`,
      browserRuntimeAccessibilitySnapshotRef: `.sciforge/vision-runs/${runId}/step-001-before-browser-accessibility-snapshot.json`,
      browserRuntimePlaywrightEvaluateRef: `.sciforge/vision-runs/${runId}/step-001-before-browser-playwright-evaluate.json`,
      browserRuntimeStateSnapshotRef: `.sciforge/vision-runs/${runId}/step-001-before-browser-accessibility-snapshot.json`,
      browserRuntimeGroundingHintRef: `.sciforge/vision-runs/${runId}/step-001-before-browser-grounding-hints.json`,
      browserRuntimeGroundingHintRefs: [`.sciforge/vision-runs/${runId}/step-001-before-browser-grounding-hints.json`],
      browserRuntimeObservationUse: 'observe-before-mutate-hint',
      browserRuntimeTrust: 'untrusted-page-observation',
      browserRuntimeRefsFirst: true,
      browserRuntimeCurrentBundleOnly: true,
      browserRuntimeCompletionEvidenceEligible: false,
      browserRuntimeExecutorLeaseSubstitute: false,
      browserRuntimeGuiActionSubstitute: false,
      browserRuntimeArtifactCausalitySubstitute: false,
      browserRuntimeUserLevelCompletionSubstitute: false,
    });

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'click', target: { description: 'Save button' } },
      { groundingRef: `.sciforge/vision-runs/${runId}/step-001-grounding.json` },
    ]), {
      workspace,
      config: baseConfig(runId),
      state,
      packagePlanToGenericAction: () => action,
    });

    assert.equal(result.ok, true);
    assert.equal(state.activeAction?.observeBeforeMutate?.browserRuntimeObservationUse, 'observe-before-mutate-hint');
    assert.equal(state.activeAction?.observeBeforeMutate?.browserRuntimeCompletionEvidenceEligible, false);
    assert.equal(state.activeAction?.observeBeforeMutate?.browserRuntimeExecutorLeaseSubstitute, false);
    assert.equal(state.activeAction?.observeBeforeMutate?.browserRuntimeGuiActionSubstitute, false);
    assert.equal(state.activeAction?.observeBeforeMutate?.browserRuntimeArtifactCausalitySubstitute, false);
    assert.equal(state.activeAction?.observeBeforeMutate?.browserRuntimeUserLevelCompletionSubstitute, false);
    assert.ok(state.activeAction?.beforeEvidenceRefs?.includes(`.sciforge/vision-runs/${runId}/step-001-before-browser-dom-ax-observation.json`));
    assert.ok(state.activeAction?.beforeEvidenceRefs?.includes(`.sciforge/vision-runs/${runId}/step-001-before-browser-visible-dom.json`));
    assert.ok(state.activeAction?.beforeEvidenceRefs?.includes(`.sciforge/vision-runs/${runId}/step-001-before-browser-accessibility-snapshot.json`));
    assert.ok(state.activeAction?.groundingRefs?.includes(`.sciforge/vision-runs/${runId}/step-001-before-browser-grounding-hints.json`));
    assert.equal((state.activeAction?.grounding as Record<string, unknown>).browserRuntimeObservationUse, 'observe-before-mutate-hint');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('executePackageBridgePort omits BrowserRuntime DOM/AX refs when hint boundary flags are incomplete', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-browser-runtime-incomplete-'));
  try {
    const runId = 'cu-execute-port-browser-runtime-incomplete';
    const action: GenericVisionAction = {
      type: 'click',
      x: 12,
      y: 16,
      targetDescription: 'Save button',
      riskLevel: 'low',
    };
    const state = executeState(workspace, runId);
    const metadata = (state.latestObservation?.metadata ?? {}) as Record<string, unknown>;
    Object.assign(metadata, {
      browserRuntimeObservationRef: `.sciforge/vision-runs/${runId}/step-001-before-browser-dom-ax-observation.json`,
      browserRuntimeVisibleDomRef: `https://example.test/old-visible-dom.json`,
      browserRuntimeGroundingHintRefs: [`.sciforge/vision-runs/${runId}/step-001-before-browser-grounding-hints.json`],
      browserRuntimeObservationUse: 'observe-before-mutate-hint',
      browserRuntimeTrust: 'untrusted-page-observation',
      browserRuntimeRefsFirst: true,
      browserRuntimeCompletionEvidenceEligible: false,
      browserRuntimeExecutorLeaseSubstitute: false,
      browserRuntimeGuiActionSubstitute: false,
      browserRuntimeArtifactCausalitySubstitute: false,
      browserRuntimeUserLevelCompletionSubstitute: false,
    });

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'click', target: { description: 'Save button' } },
      { groundingRef: `.sciforge/vision-runs/${runId}/step-001-grounding.json` },
    ]), {
      workspace,
      config: baseConfig(runId),
      state,
      packagePlanToGenericAction: () => action,
    });

    assert.equal(result.ok, true);
    assert.equal(state.activeAction?.observeBeforeMutate?.browserRuntimeObservationUse, undefined);
    assert.equal(state.activeAction?.beforeEvidenceRefs?.includes(`https://example.test/old-visible-dom.json`), false);
    assert.equal(state.activeAction?.groundingRefs?.includes(`.sciforge/vision-runs/${runId}/step-001-before-browser-grounding-hints.json`), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('executePackageBridgePort converts stop signal into scheduler cancellation metadata', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-stop-signal-'));
  const controller = new AbortController();
  try {
    const runId = 'cu-execute-port-stop-signal';
    const action: GenericVisionAction = {
      type: 'type_text',
      text: 'do not continue',
    };
    const state = executeState(workspace, runId);
    controller.abort(new Error('user pressed Computer Use stop'));

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'type_text', text: 'do not continue' },
      { groundingRef: '.sciforge/vision-runs/cu-execute-port/step-001-grounding.json' },
    ]), {
      workspace,
      config: baseConfig(runId),
      callbacks: { signal: controller.signal },
      state,
      packagePlanToGenericAction: () => action,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.match(result.message, /user pressed Computer Use stop/);
    const metadata = result.metadata as Record<string, any>;
    assert.equal(metadata.schedulerDecision.status, 'cancelled');
    assert.equal(metadata.schedulerDecision.schedulerDecisionRefs.status, 'aborted');
    assert.equal(metadata.schedulerDecision.schedulerDecisionRefs.mutatingActionExecuted, false);
    assert.deepEqual(state.executedActions, []);
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

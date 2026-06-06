import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { isRecord } from '../gateway-utils.js';
import {
  computerUseArtifactIntentText,
  executePackageBridgePort,
} from './package-bridge-execute-port.js';
import { packagePlanToGenericAction } from './package-bridge-action-conversion.js';
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
          maxAgeMs: 30_000,
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

function matchingApprovalProvenance(approvalRef: string, actionKind: string, targetDescription: string) {
  return {
    schemaVersion: 'sciforge.computer-use.approval-provenance.v1',
    source: 'workspace-approval-sidecar',
    approvalRef,
    approvalRequestId: `${approvalRef}:request`,
    riskActionHash: `${approvalRef}:risk-action`,
    sourceApprovalRequestRef: '.sciforge/vision-runs/source-run/approval-request.json',
    sourceGuiAskUserRecordRef: '.sciforge/vision-runs/source-run/gui-ask-user.json',
    sourceRiskAuditRef: '.sciforge/vision-runs/source-run/risk-audit.json',
    approvalRequest: {
      approvalRef,
      riskActionHash: `${approvalRef}:risk-action`,
      action_kind: actionKind,
    },
    highRiskAction: {
      actionKind,
      targetDescription,
    },
  };
}

function weakInlineApprovalProvenance(approvalRef: string, actionKind: string, targetDescription: string) {
  return {
    schemaVersion: 'sciforge.computer-use.approval-provenance.v1',
    source: 'inline-unbacked-approval-provenance',
    approvalRef,
    approvalRequest: {
      approvalRef,
      riskActionHash: `${approvalRef}:risk-action`,
      action_kind: actionKind,
    },
    highRiskAction: {
      actionKind,
      targetDescription,
    },
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

    if (result.ok !== true) assert.fail(JSON.stringify(result, null, 2));
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

test('executePackageBridgePort keeps remote-desktop visual freshness on the generic cap', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-remote-freshness-'));
  try {
    const runId = 'cu-execute-port-remote-freshness';
    const config = baseConfig(runId);
    config.dryRun = false;
    config.inputAdapter = 'remote-desktop';
    config.independentInputAdapterProvider = 'sciforge-simulated-remote-desktop';
    const state = executeState(workspace, runId);
    if (state.targetResolution.ok) {
      state.targetResolution.virtualWindowId = `window-${runId}`;
      state.targetResolution.schedulerLockId = `window-${runId}`;
      state.targetResolution.target.virtualWindowId = `window-${runId}`;
    }
    await mkdir(state.runDir, { recursive: true });
    const observedAt = new Date(Date.now() - 60_000).toISOString();
    const metadata = state.latestObservation?.metadata as Record<string, any>;
    metadata.observedAt = observedAt;
    metadata.windowId = `window-${runId}`;
    metadata.freshnessCheck = {
      status: 'current',
      observedAt,
      checkedAt: observedAt,
      maxAgeMs: 30_000,
    };
    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'click', target: { description: 'blank editor body' } },
      { ok: true, x: 10, y: 10, groundingRef: '.sciforge/vision-runs/cu-execute-port-remote-freshness/grounding.json' },
      { task: 'Click the blank editor body' },
      [],
    ]), {
      workspace,
      config,
      state,
      packagePlanToGenericAction: () => ({ type: 'click', targetDescription: 'blank editor body' }),
    });

    if (result.ok !== true) assert.fail(JSON.stringify(result, null, 2));
    assert.equal(state.activeAction?.observeBeforeMutate?.freshnessCheck?.maxAgeMs, 30_000);
    assert.doesNotMatch(String(state.activeAction?.observeBeforeMutate?.freshnessCheck?.reason ?? ''), /remote-desktop/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('executePackageBridgePort blocks stale remote-desktop visual evidence before independent adapter execution', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-remote-stale-'));
  try {
    const runId = 'cu-execute-port-remote-stale';
    const config = baseConfig(runId);
    config.dryRun = false;
    config.testActionFixtureMode = false;
    config.inputAdapter = 'remote-desktop';
    config.independentInputAdapterProvider = 'sciforge-simulated-remote-desktop';
    const state = executeState(workspace, runId);
    if (state.targetResolution.ok) {
      state.targetResolution.virtualWindowId = `window-${runId}`;
      state.targetResolution.schedulerLockId = `window-${runId}`;
      state.targetResolution.target.virtualWindowId = `window-${runId}`;
    }
    await mkdir(state.runDir, { recursive: true });
    const observedAt = new Date(Date.now() - 60_000).toISOString();
    const metadata = state.latestObservation?.metadata as Record<string, any>;
    metadata.observedAt = observedAt;
    metadata.capturedAt = observedAt;
    metadata.windowId = `window-${runId}`;
    metadata.freshnessCheck = {
      status: 'current',
      observedAt,
      checkedAt: observedAt,
      maxAgeMs: 30_000,
    };

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'click', target: { description: 'blank editor body' } },
      { ok: true, x: 10, y: 10, groundingRef: '.sciforge/vision-runs/cu-execute-port-remote-stale/grounding.json' },
      { task: 'Click the blank editor body' },
      [],
    ]), {
      workspace,
      config,
      state,
      packagePlanToGenericAction: () => ({ type: 'click', targetDescription: 'blank editor body' }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.match(result.message, /needs-observation: observation is older than 30000ms/);
    assert.equal(state.executedActions.length, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('executePackageBridgePort blocks high-risk dry-run actions before executor metadata is recorded', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-high-risk-'));
  try {
    const runId = 'cu-execute-port-high-risk';
    const action: GenericVisionAction = {
      type: 'click',
      x: 10,
      y: 20,
      targetDescription: 'Submit payment',
      riskLevel: 'high',
      requiresConfirmation: true,
    };
    const state = executeState(workspace, runId);

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'click', target: { description: 'Submit payment' }, riskLevel: 'high', requiresConfirmation: true },
      { x: 10, y: 20, groundingRef: '.sciforge/vision-runs/cu-execute-port-high-risk/step-001-grounding.json' },
      { task: 'Submit payment' },
    ]), {
      workspace,
      config: baseConfig(runId),
      state,
      packagePlanToGenericAction: () => action,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.match(result.message, /approval-required/);
    assert.equal(result.metadata.exitCode, 125);
    assert.ok(isRecord(result.metadata.schedulerDecision));
    assert.equal(result.metadata.schedulerDecision.status, 'needs-confirmation');
    assert.equal(state.executedActions.length, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('executePackageBridgePort infers high-risk dry-run targets before executor metadata is recorded', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-high-risk-inferred-'));
  try {
    const runId = 'cu-execute-port-high-risk-inferred';
    const state = executeState(workspace, runId);

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'click', target: { description: 'Submit payment' } },
      { x: 10, y: 20, groundingRef: '.sciforge/vision-runs/cu-execute-port-high-risk-inferred/step-001-grounding.json' },
      { task: 'Submit payment' },
    ]), {
      workspace,
      config: baseConfig(runId),
      state,
      packagePlanToGenericAction,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.match(result.message, /approval-required/);
    assert.equal(result.metadata.exitCode, 125);
    assert.ok(isRecord(result.metadata.schedulerDecision));
    assert.equal(result.metadata.schedulerDecision.status, 'needs-confirmation');
    assert.equal(state.activeAction?.riskLevel, 'high');
    assert.equal(state.activeAction?.requiresConfirmation, true);
    assert.equal(state.executedActions.length, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('executePackageBridgePort does not approve high-risk actions from approvalRef alone', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-approval-ref-only-'));
  try {
    const runId = 'cu-execute-port-approval-ref-only';
    const action: GenericVisionAction = {
      type: 'click',
      x: 10,
      y: 20,
      targetDescription: 'Submit payment',
      riskLevel: 'high',
      requiresConfirmation: true,
    };
    const state = executeState(workspace, runId);

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'click', target: { description: 'Submit payment' }, riskLevel: 'high', requiresConfirmation: true },
      { x: 10, y: 20, groundingRef: '.sciforge/vision-runs/cu-execute-port-approval-ref-only/step-001-grounding.json' },
      {
        task: 'Submit payment',
        riskPolicy: 'allow-confirmed',
        approvalRef: 'approval://unbacked-confirmation',
      },
    ]), {
      workspace,
      config: baseConfig(runId),
      state,
      packagePlanToGenericAction: () => action,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.match(result.message, /approval-required/);
    assert.notEqual(state.activeAction?.approvalState, 'approved');
    assert.equal(state.executedActions.length, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('executePackageBridgePort approves snake_case confirmed requests with matching approval provenance', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-snake-approval-'));
  try {
    const runId = 'cu-execute-port-snake-approval';
    const approvalRef = 'approval:computer-use:snake-confirmed';
    const action: GenericVisionAction = {
      type: 'type_text',
      text: 'CONFIRMED',
      targetDescription: 'guarded editor field',
      riskLevel: 'high',
      requiresConfirmation: true,
    };
    const state = executeState(workspace, runId);
    const observedAt = new Date().toISOString();
    const metadata = state.latestObservation?.metadata as Record<string, any>;
    metadata.observedAt = observedAt;
    metadata.capturedAt = observedAt;
    metadata.freshnessCheck = {
      status: 'current',
      observedAt,
      checkedAt: observedAt,
      maxAgeMs: 300_000,
    };
    const approvalProvenance = matchingApprovalProvenance(approvalRef, 'type_text', 'guarded editor field');

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'type_text', text: 'CONFIRMED', target: { description: 'guarded editor field' } },
      { x: 10, y: 20, groundingRef: '.sciforge/vision-runs/cu-execute-port-snake-approval/step-001-grounding.json' },
      {
        task: 'Type approved guarded text',
        risk_policy: 'allow-confirmed',
        approval_ref: approvalRef,
        metadata: {
          approvalProvenance,
        },
      },
    ]), {
      workspace,
      config: baseConfig(runId),
      state,
      packagePlanToGenericAction: () => action,
    });

    if (result.ok !== true) assert.fail(JSON.stringify(result, null, 2));
    assert.equal(state.activeAction?.approvalState, 'approved');
    assert.equal(state.executedActions.length, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('executePackageBridgePort rejects weak inline approval provenance without source boundary refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-weak-approval-'));
  try {
    const runId = 'cu-execute-port-weak-approval';
    const approvalRef = 'approval:computer-use:weak-inline-confirmed';
    const action: GenericVisionAction = {
      type: 'click',
      x: 10,
      y: 20,
      targetDescription: 'Submit payment',
      riskLevel: 'high',
      requiresConfirmation: true,
    };
    const state = executeState(workspace, runId);
    const observedAt = new Date().toISOString();
    const metadata = state.latestObservation?.metadata as Record<string, any>;
    metadata.observedAt = observedAt;
    metadata.capturedAt = observedAt;
    metadata.freshnessCheck = {
      status: 'current',
      observedAt,
      checkedAt: observedAt,
      maxAgeMs: 300_000,
    };

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'click', target: { description: 'Submit payment' }, riskLevel: 'high', requiresConfirmation: true },
      { x: 10, y: 20, groundingRef: '.sciforge/vision-runs/cu-execute-port-weak-approval/step-001-grounding.json' },
      {
        task: 'Submit payment',
        riskPolicy: 'allow-confirmed',
        approvalRef,
        metadata: {
          approvalProvenance: weakInlineApprovalProvenance(approvalRef, 'click', 'Submit payment'),
        },
      },
    ]), {
      workspace,
      config: baseConfig(runId),
      state,
      packagePlanToGenericAction: () => action,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.match(result.message, /approval-required/);
    assert.notEqual(state.activeAction?.approvalState, 'approved');
    assert.equal(state.executedActions.length, 0);
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

test('executePackageBridgePort scopes display fallback mutations from observe-before-mutate evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-display-scope-'));
  try {
    const runId = 'cu-execute-port-display-scope';
    const action: GenericVisionAction = {
      type: 'open_app',
      appName: 'TextEdit',
      riskLevel: 'high',
      requiresConfirmation: true,
    };
    const approvalRef = 'approval://display-fallback-open-app';
    const state = executeState(workspace, runId);
    state.targetResolution = {
      ok: true,
      target: {
        enabled: false,
        required: false,
        mode: 'display',
        coordinateSpace: 'screen',
        inputIsolation: 'best-effort',
      },
      captureKind: 'display',
      coordinateSpace: 'screen',
      inputIsolation: 'best-effort',
      schedulerLockId: 'vision-window-display-display',
      source: 'display-fallback',
      diagnostics: ['window targeting is not configured; display capture is observation-only until open_app binds a target window'],
    };
    const observedAt = new Date().toISOString();
    const metadata = state.latestObservation?.metadata as Record<string, any>;
    metadata.displayGroupId = 'display-group-observed';
    metadata.screenId = 'screen-observed';
    metadata.windowId = 'window-observed';
    metadata.observedAt = observedAt;
    metadata.capturedAt = observedAt;
    metadata.freshnessCheck = {
      status: 'current',
      observedAt,
      checkedAt: observedAt,
      maxAgeMs: 300_000,
    };

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'open_app', appName: 'TextEdit', target: { description: 'TextEdit' } },
      { groundingRef: '.sciforge/vision-runs/cu-execute-port-display-scope/step-001-grounding.json' },
      {
        task: 'Open TextEdit',
        riskPolicy: 'allow-confirmed',
        approvalRef,
        metadata: {
          approvalProvenance: matchingApprovalProvenance(approvalRef, 'open_app', 'TextEdit'),
        },
      },
    ]), {
      workspace,
      config: baseConfig(runId),
      state,
      packagePlanToGenericAction: () => action,
    });

    if (result.ok !== true) assert.fail(JSON.stringify(result, null, 2));
    assert.equal(state.activeAction?.displayGroupId, 'display-group-observed');
    assert.equal(state.activeAction?.screenId, 'screen-observed');
    assert.equal(state.activeAction?.windowId, undefined);
    assert.equal(state.activeAction?.observeBeforeMutate?.windowId, 'window-observed');
    assert.equal(state.executedActions.length, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('executePackageBridgePort does not promote observation windowId onto window-local actions', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-execute-port-stale-window-scope-'));
  try {
    const runId = 'cu-execute-port-stale-window-scope';
    const action: GenericVisionAction = {
      type: 'type_text',
      text: 'Draft report',
      targetDescription: 'document body',
      riskLevel: 'high',
      requiresConfirmation: true,
    };
    const approvalRef = 'approval://window-local-type-text';
    const state = executeState(workspace, runId);
    const observedAt = new Date().toISOString();
    const metadata = state.latestObservation?.metadata as Record<string, any>;
    metadata.displayGroupId = 'display-group-1';
    metadata.screenId = 'screen-1';
    metadata.windowId = 'window-stale-observed';
    metadata.observedAt = observedAt;
    metadata.capturedAt = observedAt;
    metadata.freshnessCheck = {
      status: 'current',
      observedAt,
      checkedAt: observedAt,
      maxAgeMs: 300_000,
    };

    const result = await executePackageBridgePort(hostPortCall([
      { kind: 'type_text', text: 'Draft report', target: { description: 'document body' } },
      { x: 10, y: 20, groundingRef: '.sciforge/vision-runs/cu-execute-port-stale-window-scope/step-001-grounding.json' },
      {
        task: 'Type into the target editor',
        riskPolicy: 'allow-confirmed',
        approvalRef,
        metadata: {
          approvalProvenance: matchingApprovalProvenance(approvalRef, 'type_text', 'document body'),
        },
      },
    ]), {
      workspace,
      config: baseConfig(runId),
      state,
      packagePlanToGenericAction: () => action,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.match(result.message, /windowId window-stale-observed != window-101/);
    assert.notEqual(state.activeAction?.windowId, 'window-stale-observed');
    assert.equal(state.executedActions.length, 0);
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

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import {
  COMPUTER_USE_ACTION_PROVIDER_ID,
  COMPUTER_USE_REQUEST_SCHEMA,
  type ComputerUseActionProviderRequest,
} from './host-adapter.js';
import {
  materializePackageBridgeTrace,
  type PackageBridgeTraceState,
  writePackageBridgeTrace,
} from './package-bridge-trace.js';
import type { ComputerUseConfig, ScreenshotRef, WindowTargetResolution } from './types.js';
import { windowTargetTraceConfig } from './window-target.js';

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

function screenshotRef(workspace: string, runId: string, id: string): ScreenshotRef {
  return {
    id,
    path: `.sciforge/vision-runs/${runId}/${id}.png`,
    absPath: join(workspace, '.sciforge/vision-runs', runId, `${id}.png`),
    displayId: 1,
    width: 640,
    height: 480,
    sha256: `sha-${id}`,
    bytes: 42,
  };
}

function traceState(workspace: string, runId: string): PackageBridgeTraceState {
  const before = screenshotRef(workspace, runId, 'step-001-before');
  const after = screenshotRef(workspace, runId, 'step-001-after');
  return {
    runId,
    runDir: join(workspace, '.sciforge/vision-runs', runId),
    targetResolution: targetResolution(),
    screenshotLedger: [before, after],
    captureRefsByObservationRef: new Map([
      ['before-1', [before]],
      ['after-1', [after]],
    ]),
    focusRegionByObservationRef: new Map(),
    beforeFocusRefsByObservationRef: new Map(),
    afterFocusRefsByObservationRef: new Map(),
    actionQueue: [],
    executedActions: [],
    plannerTraceSteps: [],
    visionHistorySteps: [],
    missingPlannerAfterCaptured: false,
    visibleArtifacts: [{
      schemaVersion: 'sciforge.computer-use.virtual-remote-artifact.v1',
      id: 'artifact-final-report',
      kind: 'virtual-document',
      title: 'Final report',
      path: 'report.md',
      artifactRef: `.sciforge/vision-runs/${runId}/report.md`,
      dataRef: `.sciforge/vision-runs/${runId}/report.md`,
      appId: 'virtual-editor',
      delivery: 'virtual-remote-session-artifact',
      status: 'visible-and-saved',
      visibleTexts: ['final report visible'],
      sourceActionIds: ['step-001'],
      createdAt: '2026-05-29T00:00:00.000Z',
      updatedAt: '2026-05-29T00:00:00.000Z',
    }],
  };
}

function gatewayRequest(): GatewayRequest {
  return {
    skillDomain: 'knowledge',
    prompt: '/computer-use run summarize refs',
    handoffSource: 'ui-chat',
    workspacePath: '/tmp/sciforge-workspace',
    selectedToolIds: ['local.vision-sense'],
    artifacts: [],
    uiState: {
      computerUseLong: {
        cuNextTaskId: 'CU-NEXT-TRACE',
      },
    },
  };
}

function actionProviderRequest(): ComputerUseActionProviderRequest {
  return {
    schemaVersion: COMPUTER_USE_REQUEST_SCHEMA,
    task: '/computer-use run summarize refs',
    maxSteps: 4,
    riskPolicy: 'fail-closed',
    providers: {
      action: COMPUTER_USE_ACTION_PROVIDER_ID,
      executor: 'dry-run-generic-gui-executor',
    },
    windowTarget: windowTargetTraceConfig({
      enabled: false,
      required: false,
      mode: 'display',
      coordinateSpace: 'screen',
      inputIsolation: 'best-effort',
    }),
    metadata: { source: 'focused-trace-test' },
  };
}

test('package bridge trace materializer preserves request, refs-first artifacts, host ports, scheduler, and package result', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-bridge-trace-'));
  try {
    const runId = 'cu-package-bridge-trace-materializer';
    const state = traceState(workspace, runId);
    const packageResult = {
      status: 'completed',
      message: 'done',
      metrics: { actionCount: 1, stepCount: 1, observationCount: 2 },
      traceRefs: [],
      artifactRefs: [],
      steps: [{
        status: 'done',
        beforeRef: 'before-1',
        afterRef: 'after-1',
        action: { kind: 'click', target: 'Save report', x: 11, y: 22, riskLevel: 'low' },
        execution: { ok: true, metadata: { stdout: 'ok' } },
        verification: { ok: true, reason: 'visible result changed' },
      }],
    };

    const trace = materializePackageBridgeTrace({
      workspace,
      config: baseConfig(runId),
      state,
      request: gatewayRequest(),
      actionProviderRequest: actionProviderRequest(),
      packageResult,
      createdAt: '2026-05-29T00:00:00.000Z',
      completedAt: '2026-05-29T00:00:01.000Z',
    }) as Record<string, any>;

    assert.equal(trace.request.text, '/computer-use run summarize refs');
    assert.equal(trace.request.cuNextTaskId, 'CU-NEXT-TRACE');
    assert.deepEqual(trace.request.computerUseRequest, actionProviderRequest());
    assert.deepEqual(trace.finalArtifactRefs, [`.sciforge/vision-runs/${runId}/report.md`]);
    assert.deepEqual(trace.artifactRefs, [`.sciforge/vision-runs/${runId}/report.md`]);
    assert.equal(trace.cuUserAcceptance.finalArtifactRef, `.sciforge/vision-runs/${runId}/report.md`);
    assert.equal(trace.packageResult, packageResult);
    assert.equal(trace.validation.noInlineImages, true);
    assert.ok(trace.hostPorts.ports.capture);
    assert.equal(trace.genericComputerUse.actionProvider, COMPUTER_USE_ACTION_PROVIDER_ID);
    assert.equal(trace.scheduler.executorLock.provider, 'filesystem-lease');
    assert.ok(trace.windowLifecycle);
    assert.equal(trace.steps[0].plannedAction.type, 'click');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge trace writer writes vision-trace.json and flags inline image payloads', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-bridge-trace-writer-'));
  try {
    const runId = 'cu-package-bridge-trace-writer';
    const state = traceState(workspace, runId);
    await mkdir(state.runDir, { recursive: true });
    const tracePath = await writePackageBridgeTrace({
      workspace,
      config: baseConfig(runId),
      state,
      request: gatewayRequest(),
      actionProviderRequest: actionProviderRequest(),
      packageResult: {
        status: 'completed',
        message: 'done with inline image that must not pass validation',
        screenshot: 'data:image/png;base64,AAAA',
        steps: [],
      },
    });

    assert.equal(tracePath, join(state.runDir, 'vision-trace.json'));
    assert.equal(state.tracePath, tracePath);
    assert.equal((await stat(tracePath)).isFile(), true);
    const trace = JSON.parse(await readFile(tracePath, 'utf8')) as Record<string, any>;
    assert.equal(trace.packageResult.status, 'completed');
    assert.equal(trace.validation.noInlineImages, false);
    assert.deepEqual(trace.finalArtifactRefs, [`.sciforge/vision-runs/${runId}/report.md`]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

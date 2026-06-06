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
    assert.deepEqual(trace.packageResult, packageResult);
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

test('package bridge trace materializer registers observation cost tier usage without raw payloads', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-bridge-trace-cost-'));
  try {
    const runId = 'cu-package-bridge-trace-cost';
    const state = traceState(workspace, runId);
    const packageResult = {
      status: 'completed',
      message: 'done',
      observationCostTierUsage: [
        {
          ref: 'evidence:metadata-window',
          tier: 'T0',
          sourceKind: 'metadata',
          upgradeReason: 'window metadata was enough',
          latencyMs: 1,
          modelCallCount: 0,
          rawPayload: 'data:image/png;base64,SHOULD_NOT_PROJECT',
        },
        {
          ref: 'evidence:vision-upgrade',
          costTierRegistration: {
            tier: 'T4',
            fromTier: 'T2',
            upgradeReason: 'target-local crop was uncertain',
            latencyMs: 138,
            modelCallCount: 1,
            reasonCodes: ['uncertainty.requires-vision'],
          },
          source: { kind: 'vision' },
          payload: { image: 'data:image/png;base64,SHOULD_NOT_PROJECT' },
        },
      ],
      evidenceLedger: [
        {
          ref: 'evidence:structured-state',
          costTier: 'T1',
          source: { kind: 'structured' },
          observation: {
            costTierRegistration: {
              tier: 'T1',
              upgradeReason: 'read structured window state',
              latencyMs: 4,
              modelCallCount: 0,
            },
          },
        },
        {
          ref: 'evidence:target-crop',
          costTier: 'T2',
          source: { kind: 'ocr' },
          observation: {
            costTierRegistration: {
              tier: 'T2',
              fromTier: 'T1',
              upgradeReason: 'visible text required target crop OCR',
              latencyMs: 18,
              modelCallCount: 0,
            },
          },
        },
        {
          ref: 'evidence:fresh-window',
          costTier: 'T3',
          source: { kind: 'pixel' },
          observation: {
            costTierRegistration: {
              tier: 'T3',
              upgradeReason: 'fresh window screenshot was required',
              latencyMs: 24,
              modelCallCount: 0,
            },
          },
        },
        {
          ref: 'evidence:verifier-compare',
          costTier: 'T5',
          source: { kind: 'verifier' },
          observation: {
            costTierRegistration: {
              tier: 'T5',
              fromTier: 'T3',
              upgradeReason: 'before/after verifier needed semantic confirmation',
              latencyMs: 91,
              modelCallCount: 1,
            },
          },
        },
      ],
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
      packageResult,
      createdAt: '2026-05-29T00:00:00.000Z',
      completedAt: '2026-05-29T00:00:01.000Z',
    }) as Record<string, any>;

    assert.equal(trace.observationCostTierUsage.schemaVersion, 'sciforge.computer-use.observation-cost-tier-usage.v1');
    assert.deepEqual(
      trace.observationCostTierUsage.entries.map((entry: Record<string, unknown>) => entry.tier),
      ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'],
    );
    assert.deepEqual(trace.observationCostTierUsage.byTier.T4[0], {
      tier: 'T4',
      ref: 'evidence:vision-upgrade',
      sourceKind: 'vision',
      fromTier: 'T2',
      upgradeReason: 'target-local crop was uncertain',
      latencyMs: 138,
      modelCallCount: 1,
      reasonCodes: ['uncertainty.requires-vision'],
    });
    assert.equal(trace.observationCostTierUsage.byTier.T5[0].modelCallCount, 1);
    assert.doesNotMatch(JSON.stringify(trace.observationCostTierUsage), /data:image\/|;base64,|rawPayload|SHOULD_NOT_PROJECT/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge trace writer sanitizes provider payloads and inline images while preserving refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-bridge-trace-sanitize-'));
  try {
    const runId = 'cu-package-bridge-trace-sanitize';
    const state = traceState(workspace, runId);
    await mkdir(state.runDir, { recursive: true });
    const packageResult = {
      status: 'completed',
      message: 'done',
      traceRefs: ['trace:safe-package'],
      artifactRefs: [`.sciforge/vision-runs/${runId}/report.md`],
      rawProviderPayload: {
        request: 'data:image/png;base64,SECRET',
      },
      providerRequestBody: {
        input: [{
          type: 'input_image',
          image_base64: 'SECRET',
        }],
      },
      providerResponseBody: {
        output: [{
          content: 'SECRET',
        }],
      },
      nested: {
        observationRef: 'observation:safe-before',
        image_base64: 'SECRET',
        preview: 'data:image/png;base64,SECRET',
      },
      steps: [{
        status: 'done',
        beforeRef: 'before-1',
        afterRef: 'after-1',
        action: { kind: 'click', target: 'Save report', x: 11, y: 22, riskLevel: 'low' },
        grounding: {
          ref: 'grounding:safe-step',
          providerRequestBody: { image_base64: 'SECRET' },
        },
        execution: {
          ok: true,
          metadata: {
            stdout: 'ok',
            rawProviderPayload: { screenshot: 'data:image/png;base64,SECRET' },
          },
        },
        verification: {
          ok: true,
          reason: 'visible result changed',
          providerResponseBody: { content: 'SECRET' },
        },
      }],
    };

    await writePackageBridgeTrace({
      workspace,
      config: baseConfig(runId),
      state,
      packageResult,
      createdAt: '2026-05-29T00:00:00.000Z',
      completedAt: '2026-05-29T00:00:01.000Z',
    });

    const traceText = await readFile(join(state.runDir, 'vision-trace.json'), 'utf8');
    assert.doesNotMatch(
      traceText,
      /data:image|base64,SECRET|SECRET|rawProviderPayload|providerRequestBody|providerResponseBody|image_base64/,
    );
    const trace = JSON.parse(traceText) as Record<string, any>;
    assert.equal(trace.packageResult.status, 'completed');
    assert.deepEqual(trace.packageResult.traceRefs, ['trace:safe-package']);
    assert.equal(trace.packageResult.nested.observationRef, 'observation:safe-before');
    assert.equal(trace.steps[0].plannedAction.type, 'click');
    assert.equal(trace.steps[0].verifier.reason, 'visible result changed');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge trace cost tier projection ignores stale, debug, provider, and prior-run records', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-bridge-trace-cost-filter-'));
  try {
    const runId = 'cu-package-bridge-trace-cost-filter';
    const state = traceState(workspace, runId);
    const packageResult = {
      runId,
      status: 'completed',
      observationCostTierUsage: [
        { ref: 'evidence:current-metadata', tier: 'T0', sourceKind: 'metadata' },
        { ref: 'evidence:stale-metadata', tier: 'T5', stale: true, sourceKind: 'debug' },
      ],
      evidenceLedger: [
        {
          ref: 'evidence:current-structured',
          runId,
          source: { kind: 'structured' },
          observation: { costTierRegistration: { tier: 'T1', latencyMs: 3, modelCallCount: 0 } },
        },
        {
          ref: 'evidence:prior-run-vision',
          runId: 'prior-run',
          source: { kind: 'vision' },
          observation: { costTierRegistration: { tier: 'T4', upgradeReason: 'old run should not count' } },
        },
      ],
      debugDiagnostics: {
        ref: 'evidence:debug-cost',
        costTierRegistration: { tier: 'T3', upgradeReason: 'debug-only payload' },
      },
      providerTrace: {
        ref: 'evidence:provider-cost',
        costTierRegistration: { tier: 'T4', upgradeReason: 'provider debug payload' },
      },
      staleEvidence: {
        ref: 'evidence:stale-cost',
        costTierRegistration: { tier: 'T2', upgradeReason: 'stale payload' },
      },
      steps: [],
    };

    const trace = materializePackageBridgeTrace({
      workspace,
      config: baseConfig(runId),
      state,
      packageResult,
      createdAt: '2026-05-29T00:00:00.000Z',
      completedAt: '2026-05-29T00:00:01.000Z',
    }) as Record<string, any>;

    assert.deepEqual(
      trace.observationCostTierUsage.entries.map((entry: Record<string, unknown>) => entry.ref),
      ['evidence:current-metadata', 'evidence:current-structured'],
    );
    assert.doesNotMatch(
      JSON.stringify(trace.observationCostTierUsage),
      /debug-cost|provider-cost|stale-cost|prior-run-vision|stale-metadata/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge action steps expose refs-first causality and evidence scope', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-bridge-trace-causality-'));
  try {
    const runId = 'cu-package-bridge-trace-causality';
    const state = traceState(workspace, runId);
    const packageResult = {
      status: 'completed',
      message: 'done',
      steps: [
        {
          status: 'done',
          beforeRef: 'before-1',
          afterRef: 'after-1',
          beforeEvidenceRefs: ['evidence:before-dom', 'data:image/png;base64,SHOULD_NOT_PROJECT'],
          groundingRefs: ['grounding:step-1'],
          afterEvidenceRefs: ['evidence:after-dom'],
          verificationRefs: ['verification:step-1'],
          freshnessInvalidation: {
            refs: ['evidence:before-dom'],
            keys: ['visible-state:target:save-button'],
          },
          metadata: {
            targetRef: 'target:save-button',
            windowRef: 'window:editor-main',
            screenRef: 'screen:main',
          },
          action: {
            kind: 'click',
            target: 'Save report',
            x: 11,
            y: 22,
            riskLevel: 'low',
            metadata: {
              groundingRefs: ['grounding:action-metadata'],
            },
          },
          grounding: {
            metadata: {
              groundingRef: 'grounding:metadata-ref',
              targetRef: 'target:save-button',
              windowRef: 'window:editor-main',
            },
          },
          execution: {
            ok: true,
            metadata: {
              executorEventRef: 'executor-event:step-1.json',
              staleEvidenceInvalidation: {
                refs: ['observation:current'],
                keys: ['grounding:target:save-button'],
              },
            },
          },
          verification: {
            ok: true,
            metadata: {
              verificationRefs: ['verification:metadata-ref'],
            },
          },
        },
        {
          status: 'done',
          beforeEvidenceRefs: ['evidence:screen-before'],
          afterEvidenceRefs: ['evidence:screen-after'],
          verificationRefs: ['verification:window-switch'],
          metadata: {
            evidenceScope: {
              kind: 'cross-window',
              screenRef: 'screen:main',
              windowRefs: ['window:editor-main', 'window:preview'],
              reason: 'window switch needed full-screen continuity evidence',
            },
          },
          action: { kind: 'hotkey', keys: ['Meta', 'Tab'], riskLevel: 'medium' },
          execution: { ok: true, metadata: { executorEventRef: 'executor-event:window-switch.json' } },
          verification: { ok: true, reason: 'preview window is active' },
        },
      ],
    };

    const trace = materializePackageBridgeTrace({
      workspace,
      config: baseConfig(runId),
      state,
      packageResult,
      createdAt: '2026-05-29T00:00:00.000Z',
      completedAt: '2026-05-29T00:00:01.000Z',
    }) as Record<string, any>;

    const firstCausality = trace.steps[0].actionLedgerCausality;
    assert.equal(firstCausality.schemaVersion, 'sciforge.computer-use.action-ledger-causality.v1');
    assert.deepEqual(firstCausality.beforeEvidenceRefs, [
      `.sciforge/vision-runs/${runId}/step-001-before.png`,
      'evidence:before-dom',
    ]);
    assert.deepEqual(firstCausality.groundingRefs, [
      'grounding:step-1',
      'grounding:action-metadata',
      'grounding:metadata-ref',
    ]);
    assert.equal(firstCausality.executorEventRef, 'executor-event:step-1.json');
    assert.deepEqual(firstCausality.afterEvidenceRefs, [
      `.sciforge/vision-runs/${runId}/step-001-after.png`,
      'evidence:after-dom',
    ]);
    assert.deepEqual(firstCausality.verificationRefs, ['verification:step-1', 'verification:metadata-ref']);
    assert.deepEqual(firstCausality.freshnessInvalidationRefs, ['evidence:before-dom', 'observation:current']);
    assert.deepEqual(firstCausality.freshnessInvalidationKeys, [
      'visible-state:target:save-button',
      'grounding:target:save-button',
    ]);
    assert.deepEqual(firstCausality.evidenceScope, {
      kind: 'target',
      targetRef: 'target:save-button',
      windowRef: 'window:editor-main',
      screenRef: 'screen:main',
      reason: 'target/window refs present in trace metadata',
    });

    const secondCausality = trace.steps[1].actionLedgerCausality;
    assert.equal(secondCausality.evidenceScope.kind, 'cross-window');
    assert.deepEqual(secondCausality.evidenceScope.windowRefs, ['window:editor-main', 'window:preview']);
    assert.equal(secondCausality.evidenceScope.reason, 'window switch needed full-screen continuity evidence');
    assert.doesNotMatch(JSON.stringify(trace.steps.map((step: Record<string, unknown>) => step.actionLedgerCausality)), /data:image\/|;base64,|SHOULD_NOT_PROJECT/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge action causality rejects unsafe trace refs and falls through to safe alternatives', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-bridge-trace-safe-refs-'));
  try {
    const runId = 'cu-package-bridge-trace-safe-refs';
    const state = traceState(workspace, runId);
    const unsafeUrl = ['https', '://example.invalid/raw.png'].join('');
    const unsafeFileUri = ['file', ':///tmp/raw.png'].join('');
    const unsafeLocalPath = join(tmpdir(), 'raw-trace-ref.png');
    const packageResult = {
      status: 'completed',
      steps: [{
        status: 'done',
        beforeRef: 'before-1',
        afterRef: 'after-1',
        beforeEvidenceRefs: [
          'evidence:before-dom',
          unsafeUrl,
          unsafeFileUri,
          unsafeLocalPath,
          'random:unsafe',
          'data:image/png;base64,SHOULD_NOT_PROJECT',
        ],
        groundingRefs: ['grounding:step-1', 'random:grounding'],
        afterEvidenceRefs: ['evidence:after-dom', unsafeLocalPath],
        verificationRefs: ['verification:step-1', unsafeUrl],
        freshnessInvalidation: {
          refs: ['evidence:before-dom', unsafeFileUri, 'random:stale'],
          keys: ['visible-state:target:save-button'],
        },
        action: { kind: 'click', target: 'Save report', x: 11, y: 22, riskLevel: 'low' },
        grounding: {
          metadata: {
            targetRef: 'target:save-button',
            windowRef: 'window:editor-main',
            screenRef: unsafeLocalPath,
          },
        },
        execution: {
          ok: true,
          metadata: {
            executorEventRef: unsafeUrl,
            executeEventRef: 'executor-event:step-1.json',
          },
        },
        verification: { ok: true },
      }],
    };

    const trace = materializePackageBridgeTrace({
      workspace,
      config: baseConfig(runId),
      state,
      packageResult,
      createdAt: '2026-05-29T00:00:00.000Z',
      completedAt: '2026-05-29T00:00:01.000Z',
    }) as Record<string, any>;

    const causality = trace.steps[0].actionLedgerCausality;
    assert.equal(causality.executorEventRef, 'executor-event:step-1.json');
    assert.deepEqual(causality.beforeEvidenceRefs, [
      `.sciforge/vision-runs/${runId}/step-001-before.png`,
      'evidence:before-dom',
    ]);
    assert.deepEqual(causality.groundingRefs, ['grounding:step-1']);
    assert.deepEqual(causality.afterEvidenceRefs, [
      `.sciforge/vision-runs/${runId}/step-001-after.png`,
      'evidence:after-dom',
    ]);
    assert.deepEqual(causality.verificationRefs, ['verification:step-1']);
    assert.deepEqual(causality.freshnessInvalidationRefs, ['evidence:before-dom']);
    assert.equal(causality.evidenceScope.screenRef, undefined);
    assert.doesNotMatch(JSON.stringify(causality), /example\.invalid|file:\/\/|raw-trace-ref|random:|SHOULD_NOT_PROJECT/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge action causality marks incomplete records without required refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-bridge-trace-incomplete-causality-'));
  try {
    const runId = 'cu-package-bridge-trace-incomplete-causality';
    const state = traceState(workspace, runId);
    const packageResult = {
      status: 'completed',
      steps: [{
        status: 'done',
        beforeRef: 'before-1',
        afterRef: 'after-1',
        action: { kind: 'click', target: 'Save report', x: 11, y: 22, riskLevel: 'low' },
        execution: { ok: true },
        verification: { ok: true, reason: 'visible result changed' },
      }],
    };

    const trace = materializePackageBridgeTrace({
      workspace,
      config: baseConfig(runId),
      state,
      packageResult,
      createdAt: '2026-05-29T00:00:00.000Z',
      completedAt: '2026-05-29T00:00:01.000Z',
    }) as Record<string, any>;

    const causality = trace.steps[0].actionLedgerCausality;
    assert.equal(causality.status, 'incomplete');
    assert.equal(causality.complete, false);
    assert.deepEqual(causality.missingRequiredRefs, [
      'groundingRefs',
      'executorEventRef',
      'verificationRefs',
      'freshnessInvalidation',
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge action causality rejects full-screen scope without explicit reason', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-bridge-trace-fullscreen-scope-'));
  try {
    const runId = 'cu-package-bridge-trace-fullscreen-scope';
    const state = traceState(workspace, runId);
    const packageResult = {
      status: 'completed',
      steps: [{
        status: 'done',
        beforeRef: 'before-1',
        afterRef: 'after-1',
        beforeEvidenceRefs: ['evidence:before-screen'],
        groundingRefs: ['grounding:screen-action'],
        afterEvidenceRefs: ['evidence:after-screen'],
        verificationRefs: ['verification:screen-action'],
        freshnessInvalidation: { refs: ['evidence:before-screen'] },
        metadata: {
          evidenceScope: {
            kind: 'full-screen',
            screenRef: 'screen:main',
          },
        },
        action: { kind: 'hotkey', keys: ['Meta', 'Tab'], riskLevel: 'medium' },
        execution: { ok: true, metadata: { executorEventRef: 'executor-event:screen-action.json' } },
        verification: { ok: true, reason: 'active window changed' },
      }],
    };

    const trace = materializePackageBridgeTrace({
      workspace,
      config: baseConfig(runId),
      state,
      packageResult,
      createdAt: '2026-05-29T00:00:00.000Z',
      completedAt: '2026-05-29T00:00:01.000Z',
    }) as Record<string, any>;

    assert.equal(trace.steps[0].actionLedgerCausality.evidenceScope, undefined);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge trace writer writes vision-trace.json and sanitizes inline image payloads', async () => {
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
    const traceText = await readFile(tracePath, 'utf8');
    assert.doesNotMatch(traceText, /data:image\/|;base64,|AAAA/);
    const trace = JSON.parse(traceText) as Record<string, any>;
    assert.equal(trace.packageResult.status, 'completed');
    assert.equal(trace.packageResult.screenshot, '[redacted-inline-trace-payload]');
    assert.equal(trace.validation.noInlineImages, true);
    assert.deepEqual(trace.finalArtifactRefs, [`.sciforge/vision-runs/${runId}/report.md`]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

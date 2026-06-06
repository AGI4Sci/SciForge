import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { HostPortCall } from './package-bridge-stdio.js';
import { writePackageBridgeTracePort } from './package-bridge-write-trace-port.js';
import type { PackageBridgeTraceState } from './package-bridge-trace.js';
import type { ComputerUseConfig, WindowTargetResolution } from './types.js';

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

function traceState(workspace: string, runId: string): PackageBridgeTraceState {
  return {
    runId,
    runDir: join(workspace, '.sciforge/vision-runs', runId),
    targetResolution: targetResolution(),
    screenshotLedger: [],
    captureRefsByObservationRef: new Map(),
    focusRegionByObservationRef: new Map(),
    beforeFocusRefsByObservationRef: new Map(),
    afterFocusRefsByObservationRef: new Map(),
    actionQueue: [],
    executedActions: [],
    plannerTraceSteps: [],
    visionHistorySteps: [],
    missingPlannerAfterCaptured: false,
    visibleArtifacts: [],
  };
}

function hostPortCall(args?: unknown[]): HostPortCall {
  return {
    type: 'hostPortCall',
    id: 'write-trace-1',
    port: 'writeTrace',
    args,
  };
}

test('writePackageBridgeTracePort writes trace and promotes package final artifact refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-write-trace-port-'));
  try {
    const runId = 'cu-write-trace-port';
    const state = traceState(workspace, runId);
    await mkdir(state.runDir, { recursive: true });
    await writeFile(join(state.runDir, 'final-report.md'), '# Final report\n');

    const ref = `.sciforge/vision-runs/${runId}/final-report.md`;
    const result = await writePackageBridgeTracePort(hostPortCall([{
      status: 'completed',
      message: 'done',
      finalArtifactRefs: [ref],
      steps: [{
        status: 'done',
        verification: {
          ok: true,
          done: true,
          metadata: {
            finalArtifactRefs: [ref],
          },
        },
      }],
    }]), {
      workspace,
      config: baseConfig(runId),
      state,
    });

    assert.equal(result, `.sciforge/vision-runs/${runId}/vision-trace.json`);
    assert.equal(state.tracePath, join(state.runDir, 'vision-trace.json'));
    assert.equal(state.visibleArtifacts[0]?.artifactRef, ref);

    const trace = JSON.parse(await readFile(join(state.runDir, 'vision-trace.json'), 'utf8')) as Record<string, any>;
    assert.equal(trace.packageResult.status, 'completed');
    assert.deepEqual(trace.finalArtifactRefs, [ref]);
    assert.equal(trace.cuUserAcceptance.finalArtifactRef, ref);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writePackageBridgeTracePort treats malformed package results as an empty object', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-write-trace-port-empty-'));
  try {
    const runId = 'cu-write-trace-port-empty';
    const state = traceState(workspace, runId);
    await mkdir(state.runDir, { recursive: true });

    const result = await writePackageBridgeTracePort(hostPortCall(['not-a-record']), {
      workspace,
      config: baseConfig(runId),
      state,
    });

    assert.equal(result, `.sciforge/vision-runs/${runId}/vision-trace.json`);
    const trace = JSON.parse(await readFile(join(state.runDir, 'vision-trace.json'), 'utf8')) as Record<string, any>;
    assert.deepEqual(trace.packageResult, {});
    assert.deepEqual(trace.finalArtifactRefs, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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

test('capturePackageBridgePort materializes BrowserRuntime DOM/AX refs as observation hints only', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-capture-port-browser-runtime-'));
  try {
    const runId = 'cu-capture-port-browser-runtime';
    const state = captureState(workspace, runId);
    await mkdir(state.runDir, { recursive: true });

    const observation = await capturePackageBridgePort(hostPortCall({
      browserRuntimeObservation: {
        sessionRef: 'browser-session:1',
        tabRef: 'browser-tab:1',
        pageQuery: {
          select: { role: 'button', name: 'Save', visible: true },
          fields: ['role', 'ariaLabel', 'bbox', 'isVisible'],
          limit: 5,
        },
        stableRefs: [{
          role: 'button',
          accessibleName: 'Save',
          domPath: 'main button:nth-of-type(1)',
          bbox: { x: 12, y: 16, width: 90, height: 32 },
        }],
        visibleDom: [{ role: 'button', name: 'Save' }],
        accessibilitySnapshot: { role: 'button', name: 'Save' },
        playwrightEvaluate: { matches: 1 },
      },
    }), {
      workspace,
      config: baseConfig(runId),
      state,
    });

    const metadata = observation.metadata as Record<string, any>;
    assert.equal(metadata.browserRuntimeObservationUse, 'observe-before-mutate-hint');
    assert.equal(metadata.browserRuntimeCompletionEvidenceEligible, false);
    assert.equal(metadata.browserRuntimeExecutorLeaseSubstitute, false);
    assert.equal(metadata.browserRuntimeGuiActionSubstitute, false);
    assert.equal(metadata.browserRuntimeArtifactCausalitySubstitute, false);
    assert.equal(metadata.browserRuntimeUserLevelCompletionSubstitute, false);
    assert.match(metadata.browserRuntimeObservationRef, /browser-dom-ax-observation\.json$/);
    assert.match(metadata.browserRuntimeVisibleDomRef, /browser-visible-dom\.json$/);
    assert.match(metadata.browserRuntimeAccessibilitySnapshotRef, /browser-accessibility-snapshot\.json$/);
    assert.match(metadata.browserRuntimePlaywrightEvaluateRef, /browser-playwright-evaluate\.json$/);
    assert.deepEqual(metadata.browserRuntimeGroundingHintRefs, [metadata.browserRuntimeGroundingHintRef]);
    assert.equal(metadata.browserRuntimePageQuery.select.role, 'button');
    assert.equal(metadata.browserRuntimeStableRefs[0].signals.role, 'button');

    const browserObservation = JSON.parse(await readFile(join(workspace, metadata.browserRuntimeObservationRef), 'utf8'));
    assert.equal(browserObservation.schemaVersion, 'sciforge.computer-use.browser-runtime-dom-ax-observation.v1');
    assert.equal(browserObservation.observationId, 'step-000-before-browser-dom-ax-observation');
    assert.equal(browserObservation.observationRef, metadata.browserRuntimeObservationRef);
    assert.equal(browserObservation.stableElementRefs.length, 1);
    assert.equal(browserObservation.refsFirst, true);
    assert.equal(browserObservation.completionEvidenceEligible, false);
    assert.equal(browserObservation.executorLeaseSubstitute, false);
    assert.equal(browserObservation.guiActionSubstitute, false);
    assert.equal(browserObservation.artifactCausalitySubstitute, false);
    assert.equal(browserObservation.userLevelCompletionSubstitute, false);
    assert.equal(browserObservation.stableElementRefs[0].signals.role, 'button');
    assert.equal(browserObservation.stableElementRefs[0].signals.accessibleName, 'Save');
    assert.equal(browserObservation.stableElementRefs[0].signals.bbox.width, 90);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('capturePackageBridgePort sanitizes BrowserRuntime stable refs and page query token refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-capture-port-browser-runtime-hygiene-'));
  try {
    const runId = 'cu-capture-port-browser-runtime-hygiene';
    const state = captureState(workspace, runId);
    await mkdir(state.runDir, { recursive: true });

    const observation = await capturePackageBridgePort(hostPortCall({
      browserRuntimeObservation: {
        sessionRef: 'https://example.test/session.json',
        tabRef: '../tab.json',
        snapshotRef: '/tmp/old-snapshot.json',
        pageQuery: {
          select: { ref: 'https://example.test/old-dom-node.json' },
          fields: ['role', 'ariaLabel', 'bbox', 'isVisible'],
          limit: 5,
        },
        stableRefs: [
          {
            schemaVersion: 'sciforge.browser-runtime.stable-ref.v1',
            primary: 'button:Unsafe',
            resolveStrategy: 'best-match',
            signals: {
              role: 'button',
              accessibleName: 'Unsafe',
              domPath: 'main button:nth-of-type(1)',
              bbox: { x: 12, y: 16, width: 90, height: 32 },
            },
            refs: ['https://example.test/old-stable-ref.json'],
            rawDom: '<button>Unsafe</button>',
          },
          {
            schemaVersion: 'sciforge.browser-runtime.stable-ref.v1',
            primary: 'button:Save',
            resolveStrategy: 'best-match',
            signals: {
              role: 'button',
              accessibleName: 'Save',
              domPath: 'main button:nth-of-type(2)',
              bbox: { x: 24, y: 32, width: 90, height: 32 },
            },
            unknownDecorativeField: 'dropped by canonical rebuild',
          },
        ],
        visibleDom: [{ role: 'button', name: 'Save' }],
      },
    }), {
      workspace,
      config: baseConfig(runId),
      state,
    });

    const metadata = observation.metadata as Record<string, any>;
    assert.equal(metadata.browserRuntimeStableRefs.length, 1);
    assert.equal(metadata.browserRuntimeStableRefs[0].signals.accessibleName, 'Save');
    assert.equal(metadata.browserRuntimeStableRefs[0].unknownDecorativeField, undefined);
    assert.equal(metadata.browserRuntimePageQuery.select.role, 'button');
    assert.equal(metadata.browserRuntimePageQuery.select.ref, undefined);
    assert.ok(metadata.browserRuntimeDiagnostics.includes('browser-runtime-stable-ref-dropped:unsafe-inline-or-ref-payload'));
    assert.ok(metadata.browserRuntimeDiagnostics.includes('browser-runtime-stable-token-ref-dropped:pageQuery.select.ref'));
    assert.ok(metadata.browserRuntimeDiagnostics.includes('browser-runtime-ref-dropped:not-current-bundle:sessionRef'));
    assert.ok(metadata.browserRuntimeDiagnostics.includes('browser-runtime-ref-dropped:not-current-bundle:tabRef'));
    assert.ok(metadata.browserRuntimeDiagnostics.includes('browser-runtime-ref-dropped:not-current-bundle:snapshotRef'));

    const browserObservation = JSON.parse(await readFile(join(workspace, metadata.browserRuntimeObservationRef), 'utf8'));
    const serialized = JSON.stringify(browserObservation);
    assert.equal(serialized.includes('old-stable-ref'), false);
    assert.equal(serialized.includes('rawDom'), false);
    assert.equal(serialized.includes('unknownDecorativeField'), false);
    assert.equal(browserObservation.refsFirst, true);
    assert.equal(browserObservation.currentBundleOnly, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

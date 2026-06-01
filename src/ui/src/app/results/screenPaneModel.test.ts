import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeArtifact, SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import {
  rightPaneVirtualScreenPayload,
  virtualScreenPayloadFromArtifact,
} from './screenPaneModel';

test('screen pane model normalizes Computer Use artifacts into refs-first replay payloads', () => {
  const screenRef = 'computer-use:session/run-screen/virtual-screens.json#screen-1';
  const artifact: RuntimeArtifact = {
    id: 'computer-use-screen-run',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    metadata: { runId: 'run-screen' },
    data: {
      title: 'Live-looking legacy payload',
      status: 'ready',
      attachState: 'requires-user-handoff',
      surfaceMode: 'live',
      sessionRef: 'computer-use:session/run-screen/manifest.json',
      displayGroupRef: 'computer-use:session/run-screen/display-group.json',
      screenRef,
      screen: { width: 1440, height: 900, label: 'screen-1' },
      targetAppRef: 'app:vscode',
      targetWindowRef: 'window:vscode/main',
      frameStreamRef: 'computer-use:session/run-screen/frame-stream.json',
      visibleScreenRefs: [screenRef],
      visibleCursorRefs: ['computer-use:session/run-screen/cursors/agent.json'],
      frameRefs: [{
        ref: 'computer-use:session/run-screen/frames/after.png',
        screenRef,
        framePreviewUrl: 'data:image/png;base64,SHOULD_NOT_SURVIVE',
        safePreviewUrl: '/api/sciforge/preview/raw?ref=computer-use%3Asession%2Frun-screen%2Fframes%2Fafter.png',
        frameDataRef: 'computer-use:session/run-screen/frame-data/after.json',
        beforeEvidenceRef: 'computer-use:session/run-screen/evidence/before.json',
        afterEvidenceRef: 'computer-use:session/run-screen/evidence/after.json',
        cursorOverlayRefs: ['computer-use:session/run-screen/overlays/cursors.json'],
        leaseOwnerRefs: ['computer-use:session/run-screen/leases/screen-1.json'],
        proposalRef: 'computer-use:session/run-screen/proposals/click.json',
      }],
      replayRef: 'computer-use:session/run-screen/replay.json',
      validationRef: 'computer-use:session/run-screen/validation.json',
      evidenceBundleIndexRef: 'computer-use:session/run-screen/evidence/index.json',
      permissionRef: 'computer-use:permission/run-screen.json',
      sidecarBindingRef: 'computer-use:session/run-screen/sidecar/binding.json',
      sidecarCapabilitiesRef: 'computer-use:session/run-screen/sidecar/capabilities.json',
      sidecarDiscoveryRef: 'computer-use:session/run-screen/sidecar/discovery.json',
      rawScreenshot: 'data:image/png;base64,NOPE',
      providerRoute: 'https://provider.example.test/private',
      executorLease: { screenId: 'NOPE' },
    },
  };

  const payload = virtualScreenPayloadFromArtifact(artifact, testConfig());

  assert.ok(payload);
  assert.equal(payload.title, 'Live-looking legacy payload');
  assert.equal(payload.status, 'ready');
  assert.equal(payload.attachState, 'requires-handoff');
  assert.equal(payload.surfaceMode, 'replay');
  assert.equal(payload.displayGroupRef, 'computer-use:session/run-screen/display-group.json');
  assert.equal(payload.screenRef, screenRef);
  assert.deepEqual(payload.visibleScreenRefs, [screenRef]);
  assert.deepEqual(payload.screen, { width: 1440, height: 900, label: 'screen-1' });
  assert.equal(payload.targetAppRef, 'app:vscode');
  assert.equal(payload.targetWindowRef, 'window:vscode/main');
  assert.equal(payload.frameStreamRef, 'computer-use:session/run-screen/frame-stream.json');
  assert.equal(payload.currentFrameRef, 'computer-use:session/run-screen/frames/after.png');
  assert.equal(payload.frameRefs?.length, 1);
  assert.equal(payload.frameRefs?.[0]?.screenRef, screenRef);
  assert.equal(payload.frameRefs?.[0]?.framePreviewUrl, '/api/sciforge/preview/raw?ref=computer-use%3Asession%2Frun-screen%2Fframes%2Fafter.png');
  assert.deepEqual(payload.actorCursorRefs, ['computer-use:session/run-screen/cursors/agent.json']);
  assert.deepEqual(payload.annotationOverlayRefs, ['computer-use:session/run-screen/overlays/cursors.json']);
  assert.deepEqual(payload.annotationProposalRefs, ['computer-use:session/run-screen/proposals/click.json']);
  assert.equal(payload.inputLeaseRef, 'computer-use:session/run-screen/leases/screen-1.json');
  assert.equal(payload.actionAdapterRef, 'computer-use:session/run-screen/sidecar/binding.json');
  assert.equal(payload.adapterReadinessRef, 'computer-use:session/run-screen/sidecar/capabilities.json');
  assert.ok(payload.artifactRefs?.includes('computer-use:session/run-screen/display-group.json'));
  assert.ok(payload.verificationRefs?.includes('computer-use:session/run-screen/sidecar/discovery.json'));
  assert.ok(payload.verificationRefs?.includes('computer-use:permission/run-screen.json'));

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /rawScreenshot|providerRoute|executorLease|SHOULD_NOT_SURVIVE|data:image|base64|screenId/);
});

test('screen pane model uses the active run only and does not reuse stale session screen artifacts', () => {
  const oldArtifact: RuntimeArtifact = {
    id: 'old-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    metadata: { runId: 'run-old-screen' },
    data: {
      sessionRef: 'computer-use:session/run-old-screen/session.json',
      frameRefs: ['.sciforge/computer-use/run-old-screen/latest.png'],
      replayRef: 'computer-use:replay/run-old-screen/replay.json',
    },
  };
  const session = emptySession({ artifacts: [oldArtifact], runs: [run('run-old-screen'), run('run-current-no-screen')] });

  const payload = rightPaneVirtualScreenPayload(session, run('run-current-no-screen'), testConfig());

  assert.equal(payload.status, 'empty');
  assert.equal(payload.currentFrameRef, undefined);
  assert.equal(payload.replayRef, undefined);
  assert.equal(payload.sessionRef, undefined);
  assert.equal(JSON.stringify(payload).includes('run-old-screen'), false);
});

test('screen pane model extracts nested run artifacts and keeps static frames in replay mode', () => {
  const activeRun = run('run-nested-screen', {
    raw: {
      data: {
        output: {
          artifacts: [{
            id: 'nested-screen',
            type: 'computer-use-virtual-screen',
            data: {
              sessionRef: 'computer-use:session/run-nested-screen/session.json',
              frameRefs: ['.sciforge/computer-use/run-nested-screen/latest.png'],
              replayRef: 'computer-use:replay/run-nested-screen/replay.json',
              attachState: 'replay',
              isolationFlags: { diagnosticOnly: true, sharedSystemInputUsed: false },
            },
          }],
        },
      },
    },
  });
  const session = emptySession({ runs: [activeRun] });

  const payload = rightPaneVirtualScreenPayload(session, activeRun, testConfig());

  assert.equal(payload.status, 'ready');
  assert.equal(payload.attachState, 'replay');
  assert.equal(payload.surfaceMode, 'replay');
  assert.equal(payload.currentFrameRef, '.sciforge/computer-use/run-nested-screen/latest.png');
  assert.equal(payload.frameRefs?.[0]?.framePreviewUrl, '/api/sciforge/preview/raw?ref=.sciforge%2Fcomputer-use%2Frun-nested-screen%2Flatest.png&workspacePath=%2Ftmp%2Fsciforge');
  assert.equal(payload.replayRef, 'computer-use:replay/run-nested-screen/replay.json');
  assert.deepEqual(payload.isolationFlags, { diagnosticOnly: true, sharedSystemInputUsed: false });
});

test('screen pane model preserves host-owned live surface refs for attached screen artifacts', () => {
  const activeRun = run('run-live-vscode', {
    raw: {
      data: {
        output: {
          artifacts: [{
            id: 'live-vscode-screen',
            type: 'computer-use-virtual-screen',
            data: {
              title: 'VSCode live screen',
              status: 'ready',
              attachState: 'attached',
              surfaceMode: 'live',
              targetAppRef: 'app:run-live-vscode/vscode',
              targetWindowRef: 'window:run-live-vscode/vscode/main',
              sessionRef: 'computer-use:session/run-live-vscode/session.json',
              screenRef: 'virtual-app-screen:run-live-vscode/screen',
              liveSurfaceRef: 'computer-use:session/run-live-vscode/live-surface.json',
              surfaceTransport: 'webrtc',
              frameStreamRef: 'computer-use:session/run-live-vscode/frame-stream.json',
              currentFrameRef: 'computer-use:session/run-live-vscode/frames/current.png',
              isolationFlags: {
                backgroundRenderable: true,
                affectsPhysicalDisplay: false,
                requiresFocusSteal: false,
                sharedSystemInputUsed: false,
                systemPointerMoved: false,
                systemKeyboardEventsSent: false,
                singleInteractiveTruth: true,
                secondInteractiveSurfacePresent: false,
                diagnosticOnly: false,
              },
            },
          }],
        },
      },
    },
  });
  const session = emptySession({ runs: [activeRun] });

  const payload = rightPaneVirtualScreenPayload(session, activeRun, testConfig());

  assert.equal(payload.status, 'ready');
  assert.equal(payload.attachState, 'attached');
  assert.equal(payload.surfaceMode, 'live');
  assert.equal(payload.liveSurfaceRef, 'computer-use:session/run-live-vscode/live-surface.json');
  assert.equal(payload.surfaceTransport, 'webrtc');
  assert.equal(payload.frameStreamRef, 'computer-use:session/run-live-vscode/frame-stream.json');
  assert.deepEqual(payload.isolationFlags, {
    backgroundRenderable: true,
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    singleInteractiveTruth: true,
    secondInteractiveSurfacePresent: false,
    diagnosticOnly: false,
  });
});

test('screen pane model downgrades live-looking payloads when a second interactive surface is present', () => {
  const payload = virtualScreenPayloadFromArtifact({
    id: 'unsafe-live-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      status: 'ready',
      attachState: 'attached',
      surfaceMode: 'live',
      sessionRef: 'computer-use:session/unsafe-live/session.json',
      liveSurfaceRef: 'computer-use:session/unsafe-live/live-surface.json',
      frameStreamRef: 'computer-use:session/unsafe-live/frame-stream.json',
      currentFrameRef: 'computer-use:session/unsafe-live/frames/current.png',
      isolationFlags: {
        singleInteractiveTruth: false,
        secondInteractiveSurfacePresent: true,
      },
    },
  }, testConfig());

  assert.equal(payload?.surfaceMode, 'replay');
  assert.equal(payload?.liveSurfaceRef, 'computer-use:session/unsafe-live/live-surface.json');
});

function testConfig(): SciForgeConfig {
  return {
    workspacePath: '/tmp/sciforge',
    locale: 'en-US',
  } as SciForgeConfig;
}

function run(id: string, overrides: Partial<SciForgeRun> = {}): SciForgeRun {
  return {
    id,
    scenarioId: 'computer-use',
    status: 'completed',
    createdAt: '2026-06-01T00:00:00.000Z',
    completedAt: '2026-06-01T00:00:01.000Z',
    ...overrides,
  } as SciForgeRun;
}

function emptySession(overrides: Partial<SciForgeSession> = {}): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-empty',
    scenarioId: 'literature-evidence-review',
    title: 'empty',
    createdAt: '2026-06-01T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RuntimeArtifact, SciForgeConfig, SciForgeSession } from '../../domain';
import {
  RightPaneVirtualScreenTool,
  rightPaneVirtualScreenArtifact,
  rightPaneVirtualScreenSlot,
} from './screenPaneHostAdapter';

test('screen pane host adapter owns Screen wrapper extraction from ResultsRenderer', () => {
  const adapterSource = readFileSync(new URL('./screenPaneHostAdapter.tsx', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');
  const surfaceSource = readFileSync(new URL('./rightPaneSurfaceAdapter.tsx', import.meta.url), 'utf8');
  const viewerSource = readFileSync(new URL('../../../../../packages/presentation/components/virtual-screen-viewer/render.tsx', import.meta.url), 'utf8');
  const styleSource = readFileSync(new URL('../../styles/app-04.css', import.meta.url), 'utf8');

  assert.match(adapterSource, /export function RightPaneVirtualScreenTool/);
  assert.match(adapterSource, /renderVirtualScreenViewer/);
  assert.match(adapterSource, /rightPaneVirtualScreenPayload/);
  assert.match(viewerSource, /buildVirtualScreenInputIntentCommand/);
  assert.match(viewerSource, /virtual-screen-keyboard-input/);
  assert.match(viewerSource, /data-command-boundary="terminal-equivalent-input-intent"/);
  assert.match(viewerSource, /onPointerDown/);
  assert.match(viewerSource, /onWheel/);
  assert.match(styleSource, /\.virtual-screen-keyboard-input\s*\{[\s\S]*?caret-color: #fff/);
  assert.match(surfaceSource, /from '.\/screenPaneHostAdapter'/);
  assert.doesNotMatch(adapterSource, /sendBrowserHostSessionAction|startBrowserHostSession|executeScoped|runComputerUse/);
  assert.doesNotMatch(viewerSource, /sendBrowserHostSessionAction|startBrowserHostSession|executeScoped|runComputerUse/);
  assert.doesNotMatch(rendererSource, /function RightPaneVirtualScreenTool/);
  assert.doesNotMatch(rendererSource, /renderVirtualScreenViewer/);
  assert.doesNotMatch(rendererSource, /rightPaneVirtualScreenPayload/);
});

test('screen pane host adapter renders replay inspector without becoming a live owner', () => {
  const html = renderToStaticMarkup(createElement(RightPaneVirtualScreenTool, {
    config: configFixture(),
    session: sessionFixture({
      artifacts: [screenArtifactFixture()],
    }),
    locale: 'en-US',
    onCommandRequest: () => undefined,
  }));

  assert.match(html, /data-testid="right-pane-virtual-screen-tool"/);
  assert.match(html, /data-component-id="virtual-screen-viewer"/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /data-presentation-mode="replay-ref-inspector"/);
  assert.match(html, /data-status="ready"/);
  assert.match(html, /Replay\/ref inspector/);
  assert.match(html, /data-frame-stream-mode="ref-only"/);
  assert.match(html, /computer-use:session\/run-screen\/frames\/after\.png/);
  assert.doesNotMatch(html, /rawScreenshot|data:image|base64|providerRoute|executorLease|desktopBridge/);
});

test('screen pane host adapter exposes only terminal-equivalent command requests', () => {
  const captured: Array<{ commandText: string; label?: string; targetRef?: string }> = [];
  const slot = rightPaneVirtualScreenSlot({
    payload: {
      status: 'ready',
      surfaceMode: 'replay',
      sessionRef: 'computer-use:session/run-screen/session.json',
      replayRef: 'computer-use:replay/run-screen/replay.json',
    },
    locale: 'en-US',
    onCommandRequest: (commandText, label, targetRef) => {
      captured.push({ commandText, label, targetRef });
    },
  });

  slot.props.onTerminalEquivalentText({
    commandText: '/computer-use observe --session-ref "computer-use:session/run-screen/session.json"',
    label: 'Observe',
    targetRef: 'computer-use:session/run-screen/session.json',
  });

  assert.deepEqual(captured, [{
    commandText: '/computer-use observe --session-ref "computer-use:session/run-screen/session.json"',
    label: 'Observe',
    targetRef: 'computer-use:session/run-screen/session.json',
  }]);
  assert.equal(slot.componentId, 'virtual-screen-viewer');

  const artifact = rightPaneVirtualScreenArtifact(slot.props);
  assert.equal(artifact.type, 'computer-use-virtual-screen');
  assert.equal(artifact.producerScenario, 'computer-use');
});

test('screen pane host adapter forwards frame input intents as terminal-equivalent text', () => {
  const captured: Array<{ commandText: string; label?: string; targetRef?: string }> = [];
  const slot = rightPaneVirtualScreenSlot({
    payload: {
      status: 'ready',
      attachState: 'attached',
      screenRef: 'virtual-app-screen:run-screen/screen-a',
      targetAppRef: 'app:screen-browser',
      targetWindowRef: 'window:screen-browser/main',
      sessionRef: 'computer-use:session/run-screen/session.json',
      currentFrameRef: 'computer-use:session/run-screen/frames/after.png',
      inputLeaseRef: 'computer-use:session/run-screen/leases/active.json',
      actionAdapterRef: 'computer-use:session/run-screen/adapters/browser-window.json',
      adapterReadinessRef: 'computer-use:session/run-screen/readiness/browser-window.json',
      evidenceLedgerRef: 'computer-use:session/run-screen/evidence-ledger.json',
      isolationFlags: {
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        backgroundRenderable: true,
        diagnosticOnly: false,
      },
    },
    locale: 'en-US',
    onCommandRequest: (commandText, label, targetRef) => {
      captured.push({ commandText, label, targetRef });
    },
  });

  slot.props.onTerminalEquivalentText({
    commandText: '/computer-use input-intent --source virtual-app-screen-canvas --kind click --session-ref "computer-use:session/run-screen/session.json"',
    label: 'Screen click',
    targetRef: 'computer-use:session/run-screen/session.json',
  });

  assert.deepEqual(captured, [{
    commandText: '/computer-use input-intent --source virtual-app-screen-canvas --kind click --session-ref "computer-use:session/run-screen/session.json"',
    label: 'Screen click',
    targetRef: 'computer-use:session/run-screen/session.json',
  }]);
});

function configFixture(): SciForgeConfig {
  return {
    workspacePath: '/tmp/sciforge',
    locale: 'en-US',
  } as SciForgeConfig;
}

function screenArtifactFixture(): RuntimeArtifact {
  return {
    id: 'screen-host-adapter-artifact',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      sessionRef: 'computer-use:session/run-screen/session.json',
      frameRefs: ['computer-use:session/run-screen/frames/after.png'],
      replayRef: 'computer-use:replay/run-screen/replay.json',
      rawScreenshot: 'data:image/png;base64,SHOULD_NOT_RENDER',
    },
  };
}

function sessionFixture(overrides: Partial<SciForgeSession> = {}): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-screen-host-adapter',
    scenarioId: 'literature-evidence-review',
    title: 'Screen host adapter',
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

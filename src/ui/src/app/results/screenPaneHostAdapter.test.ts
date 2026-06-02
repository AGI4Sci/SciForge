import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VirtualScreenPayload } from '../../../../../packages/presentation/components';
import type { RuntimeArtifact, SciForgeConfig, SciForgeSession } from '../../domain';
import {
  RightPaneVirtualScreenTool,
  rightPaneVirtualScreenHostPresentationAttachRequest,
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
  assert.match(adapterSource, /attachVirtualAppScreenSurface/);
  assert.match(adapterSource, /presentVirtualAppScreenSurface/);
  assert.match(adapterSource, /detachVirtualAppScreenSurface/);
  assert.match(adapterSource, /ResizeObserver/);
  assert.match(adapterSource, /window\.addEventListener\('resize', syncPresentation\)/);
  assert.match(adapterSource, /data-host-presentation-boundary="virtual-app-screen-ref-bridge"/);
  assert.match(adapterSource, /rightPaneVirtualScreenHostPresentationAttachRequest/);
  assert.match(adapterSource, /visible: false/);
  assert.match(viewerSource, /buildVirtualScreenInputIntentCommand/);
  assert.match(viewerSource, /virtual-screen-keyboard-input/);
  assert.match(viewerSource, /data-command-boundary="terminal-equivalent-input-intent"/);
  assert.match(viewerSource, /onPointerDown/);
  assert.match(viewerSource, /onWheel/);
  assert.match(styleSource, /\.virtual-screen-keyboard-input\s*\{[\s\S]*?caret-color: #fff/);
  assert.match(surfaceSource, /from '.\/screenPaneHostAdapter'/);
  assert.doesNotMatch(adapterSource, /sendBrowserHostSessionAction|startBrowserHostSession|executeScoped|runComputerUse|attachVirtualAppScreenSession|registerVirtualAppScreenSessionExecutor/);
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

test('screen pane host adapter marks live refs as host-presentation ready without owning the session', () => {
  const html = renderToStaticMarkup(createElement(RightPaneVirtualScreenTool, {
    config: configFixture(),
    session: sessionFixture(),
    payload: attachedHostPresentationPayload(),
    locale: 'en-US',
    onCommandRequest: () => undefined,
  }));

  assert.match(html, /data-host-presentation-boundary="virtual-app-screen-ref-bridge"/);
  assert.match(html, /data-host-presentation-ready="true"/);
  assert.match(html, /data-presentation-mode="live-surface-ref"/);
  assert.match(html, /data-live-surface-ref="computer-use:session\/run-live\/live-surface\.json"/);
  assert.doesNotMatch(html, /startBrowserHostSession|attachVirtualAppScreenSession|runComputerUse|executorLease/);
});

test('screen pane host adapter builds refs-only live presentation attach requests', () => {
  const request = rightPaneVirtualScreenHostPresentationAttachRequest(attachedHostPresentationPayload(), {
    x: 12.4,
    y: 41.6,
    width: 1024.2,
    height: 768.7,
  }, true);

  assert.deepEqual(request, {
    kind: 'right-pane-virtual-app-screen-surface',
    sessionRef: 'computer-use:session/run-live/session.json',
    screenRef: 'virtual-app-screen:run-live/screen-a',
    liveSurfaceRef: 'computer-use:session/run-live/live-surface.json',
    frameStreamRef: 'computer-use:session/run-live/frame-stream.json',
    currentFrameRef: 'computer-use:session/run-live/frames/current.png',
    providerSessionOwnerRef: 'computer-use:provider-session/run-live/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/run-live/reconnect.json',
    liveBindingAttachGrantRef: 'computer-use:provider-session/run-live/live-binding-attach-grant.json',
    liveBindingAttachGrantStatus: 'validated',
    grantValidationRef: 'computer-use:provider-session/run-live/grant-validation.json',
    grantValidationStatus: 'validated',
    surfaceTransportRef: 'computer-use:session/run-live/surface-transport.json',
    surfaceTransport: 'native-frame-stream',
    platformDriverRef: 'computer-use:session/run-live/platform-driver.json',
    platformDriverStatus: 'ready',
    evidenceLedgerRef: 'computer-use:session/run-live/evidence-ledger.json',
    providerExecuted: true,
    surfaceTransportDescriptor: {
      owner: 'VirtualDisplayProvider',
      providerId: 'provider:run-live',
      transport: 'native-frame-stream',
      surfaceTransportRef: 'computer-use:session/run-live/surface-transport.json',
      liveSurfaceRef: 'computer-use:session/run-live/live-surface.json',
      frameStreamRef: 'computer-use:session/run-live/frame-stream.json',
      currentFrameRef: 'computer-use:session/run-live/frames/current.png',
      currentFrameSequence: 23,
      diagnosticOnly: false,
      productFallback: false,
      singleInteractiveTruth: true,
    },
    currentFrameSequence: {
      ref: 'computer-use:session/run-live/frame-sequence.json',
      sequence: 23,
    },
    bounds: { x: 12, y: 42, width: 1024, height: 769 },
    visible: true,
    focus: true,
  });
  assert.equal(JSON.stringify(request).includes('inputLeaseRef'), false);
  assert.equal(JSON.stringify(request).includes('actionAdapterRef'), false);
  assert.equal(JSON.stringify(request).includes('executor'), false);
});

test('screen pane host adapter accepts revalidated provider sessions without faking provider execution', () => {
  const payload = attachedHostPresentationPayload() as VirtualScreenPayload & {
    providerExecuted?: boolean;
    providerSessionRevalidated?: boolean;
  };
  delete payload.providerExecuted;
  payload.providerSessionRevalidated = true;

  const request = rightPaneVirtualScreenHostPresentationAttachRequest(payload, {
    x: 1,
    y: 2,
    width: 640,
    height: 480,
  });

  assert.equal(request?.providerExecuted, undefined);
  assert.equal(request?.providerSessionRevalidated, true);
  assert.equal(request?.visible, true);
});

test('screen pane host adapter fails closed without live complete safe refs', () => {
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    surfaceMode: 'replay',
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    attachState: 'blocked',
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    frameStreamRef: undefined,
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    providerSessionOwnerRef: undefined,
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    providerSessionReconnectRef: undefined,
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    liveBindingAttachGrantRef: undefined,
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    grantValidationRef: undefined,
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    surfaceTransportRef: undefined,
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    platformDriverStatus: undefined,
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    providerExecuted: undefined,
  } as VirtualScreenPayload, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    evidenceLedgerRef: undefined,
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    surfaceTransportDescriptor: undefined,
  } as VirtualScreenPayload, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    currentFrameSequence: undefined,
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    currentFrameSequence: {
      ref: 'computer-use:session/run-live/frame-sequence.json',
    },
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    liveSurfaceRef: 'https://provider.example/live-secret-token',
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest({
    ...attachedHostPresentationPayload(),
    currentFrameSequence: {
      ref: 'https://provider.example/frame-sequence-secret-token',
    },
  }, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  const unsafeIsolationPayload = attachedHostPresentationPayload();
  unsafeIsolationPayload.isolationFlags = {
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    backgroundRenderable: true,
    singleInteractiveTruth: true,
    secondInteractiveSurfacePresent: true,
    diagnosticOnly: false,
  };
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest(unsafeIsolationPayload, { x: 0, y: 0, width: 640, height: 480 }), undefined);
  assert.equal(rightPaneVirtualScreenHostPresentationAttachRequest(
    attachedHostPresentationPayload(),
    { x: 0, y: 0, width: 0, height: 480 },
  ), undefined);
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
      status: 'ready',
      attachState: 'replay',
      surfaceMode: 'replay',
      sessionRef: 'computer-use:session/run-screen/session.json',
      frameRefs: ['computer-use:session/run-screen/frames/after.png'],
      replayRef: 'computer-use:replay/run-screen/replay.json',
      rawScreenshot: 'data:image/png;base64,SHOULD_NOT_RENDER',
    },
  };
}

function attachedHostPresentationPayload(): VirtualScreenPayload {
  return {
    status: 'ready',
    attachState: 'attached',
    surfaceMode: 'live',
    platformDriverRef: 'computer-use:session/run-live/platform-driver.json',
    platformDriverStatus: 'ready',
    permissionStatus: 'granted',
    permissionGranted: true,
    sessionRef: 'computer-use:session/run-live/session.json',
    screenRef: 'virtual-app-screen:run-live/screen-a',
    liveSurfaceRef: 'computer-use:session/run-live/live-surface.json',
    frameStreamRef: 'computer-use:session/run-live/frame-stream.json',
    currentFrameRef: 'computer-use:session/run-live/frames/current.png',
    providerSessionOwnerRef: 'computer-use:provider-session/run-live/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/run-live/reconnect.json',
    liveBindingAttachGrantRef: 'computer-use:provider-session/run-live/live-binding-attach-grant.json',
    liveBindingAttachGrantStatus: 'validated',
    grantValidationRef: 'computer-use:provider-session/run-live/grant-validation.json',
    grantValidationStatus: 'validated',
    surfaceTransportRef: 'computer-use:session/run-live/surface-transport.json',
    surfaceTransport: 'native-frame-stream',
    evidenceLedgerRef: 'computer-use:session/run-live/evidence-ledger.json',
    providerExecuted: true,
    surfaceTransportDescriptor: {
      owner: 'VirtualDisplayProvider',
      providerId: 'provider:run-live',
      transport: 'native-frame-stream',
      surfaceTransportRef: 'computer-use:session/run-live/surface-transport.json',
      liveSurfaceRef: 'computer-use:session/run-live/live-surface.json',
      frameStreamRef: 'computer-use:session/run-live/frame-stream.json',
      currentFrameRef: 'computer-use:session/run-live/frames/current.png',
      currentFrameSequence: 23,
      diagnosticOnly: false,
      productFallback: false,
      singleInteractiveTruth: true,
    },
    currentFrameSequence: {
      ref: 'computer-use:session/run-live/frame-sequence.json',
      sequence: 23,
    },
    inputLeaseRef: 'computer-use:session/run-live/leases/active.json',
    actionAdapterRef: 'computer-use:session/run-live/adapters/native.json',
    adapterReadinessRef: 'computer-use:session/run-live/readiness/native.json',
    isolationFlags: {
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      backgroundRenderable: true,
      singleInteractiveTruth: true,
      secondInteractiveSurfacePresent: false,
      diagnosticOnly: false,
    },
  } as VirtualScreenPayload;
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

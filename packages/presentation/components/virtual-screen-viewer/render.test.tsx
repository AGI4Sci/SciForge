import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { basicVirtualScreenViewerFixture } from './fixtures/basic';
import { emptyVirtualScreenViewerFixture } from './fixtures/empty';
import { refsContractVirtualScreenViewerFixture } from './fixtures/refs-contract';
import { visualRegressionVirtualScreenViewerFixture } from './fixtures/visual-regression';
import { manifest } from './manifest';
import {
  buildVirtualScreenInputIntentCommand,
  renderVirtualScreenViewer,
  type VirtualScreenPayload,
} from './render';

function countMatches(html: string, pattern: RegExp) {
  return [...html.matchAll(pattern)].length;
}

function requireBlock(html: string, pattern: RegExp, label: string) {
  const match = html.match(pattern);
  assert.ok(match, `${label} should be present`);
  return match[0];
}

test('virtual-screen-viewer renders VirtualAppScreen refs-first state and actor cursors', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer(basicVirtualScreenViewerFixture));

  assert.equal(manifest.componentId, 'virtual-screen-viewer');
  assert.match(html, /virtual-screen-viewer/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /data-presentation-mode="replay-ref-inspector"/);
  assert.match(html, /data-screen-presentation-mode="replay-ref-inspector"/);
  assert.match(html, /Replay\/ref inspector/);
  assert.match(html, /data-attach-state="blocked"/);
  assert.match(html, /app:native-research-app/);
  assert.match(html, /window:native-research-app\/main/);
  assert.match(html, /computer-use:session\/basic\/app-screen-session\.json/);
  assert.match(html, /computer-use:session\/basic\/frame-stream\.json/);
  assert.match(html, /class="virtual-screen-frame-image"/);
  assert.match(html, /src="\/api\/sciforge\/preview\/raw\?ref=computer-use%3Asession%2Fbasic%2Fframes%2Flatest\.png"/);
  assert.match(html, /data-frame-ref="computer-use:session\/basic\/frames\/latest\.png"/);
  assert.match(html, /data-actor-cursor-ref="computer-use:session\/basic\/cursors\/user\.json"/);
  assert.match(html, /data-actor-cursor-ref="computer-use:session\/basic\/cursors\/agent-1\.json"/);
  assert.match(html, /data-annotation-overlay-ref="computer-use:session\/basic\/overlays\/user-highlight\.json"/);
  assert.match(html, /computer-use:session\/basic\/proposals\/agent-click\.json/);
  assert.match(html, /computer-use:session\/basic\/frames\/before\.png/);
  assert.match(html, /computer-use:session\/basic\/frames\/after\.png/);
  assert.match(html, /computer-use:session\/basic\/before-after\/observe\.json/);
  assert.match(html, /computer-use:session\/basic\/input-intents\/click-observe\.json/);
  assert.match(html, /computer-use:session\/basic\/executor-events\/click-observe\.json/);
  assert.match(html, /computer-use:session\/basic\/input-leases\/screen-1-active\.json/);
  assert.match(html, /computer-use:session\/basic\/action-adapters\/native-app-window\.json/);
  assert.match(html, /computer-use:session\/basic\/adapter-readiness\/native-app-window\.json/);
  assert.match(html, /computer-use:session\/basic\/evidence-ledger\.json/);
  assert.match(html, /artifact:research-note\.md/);
  assert.match(html, /gui:present\/basic-screen-pane/);
  assert.match(html, /data-isolation-flag="shared input" data-isolation-value="false"/);
  assert.match(html, /data-isolation-flag="background renderable" data-isolation-value="false"/);
  assert.match(html, /class="virtual-screen-timeline"/);
  assert.match(html, /data-timeline-kind="current-frame" data-active-frame="true"/);
  assert.match(html, /data-event="virtual-screen-terminal-equivalent-text"/);
  assert.match(html, /\/computer-use observe --session-ref/);
  assert.match(html, /\/computer-use replay --replay-ref/);
  assert.match(html, /\/computer-use stop --session-ref/);
  assert.match(html, /computer-use:session\/basic\/platform-driver\.json/);
  assert.match(html, /Platform virtual display driver missing/);
  assert.match(html, /data-platform-driver-status="missing"/);
  assert.match(html, /data-permission-status="denied"/);
  assert.doesNotMatch(html, /data:image|do-not-render|executeScoped|runComputerUse/);
});

test('virtual-screen-viewer keeps refs, overlays, timeline, and isolation flags visually materialized', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer(visualRegressionVirtualScreenViewerFixture));
  const stageHtml = requireBlock(html, /<section class="virtual-screen-stage"[\s\S]*?<\/section>/, 'screen stage');
  const footerHtml = requireBlock(html, /<footer class="virtual-screen-footer"[\s\S]*?<\/footer>/, 'screen footer');
  const imageMatch = stageHtml.match(/<img\b[^>]*class="virtual-screen-frame-image"[^>]*src="([^"]+)"[^>]*>/);

  assert.equal(countMatches(html, /class="virtual-screen-stage"/g), 1);
  assert.equal(countMatches(stageHtml, /class="virtual-screen-frame-image"/g), 1);
  assert.ok(imageMatch, 'active frame preview image should render');
  assert.equal(
    imageMatch?.[1],
    '/api/sciforge/preview/raw?ref=computer-use%3Asession%2Fvisual-regression%2Fframes%2Factive.png',
  );
  assert.match(imageMatch?.[0] ?? '', /alt="VirtualAppScreen current frame"/);
  assert.match(imageMatch?.[0] ?? '', /data-frame-ref="computer-use:session\/visual-regression\/frames\/active\.png"/);
  assert.match(imageMatch?.[0] ?? '', /data-frame-stream-ref="computer-use:session\/visual-regression\/frame-stream\.json"/);
  assert.match(imageMatch?.[0] ?? '', /data-frame-stream-mode="ref-only"/);
  assert.match(imageMatch?.[0] ?? '', /data-live-surface-ref="computer-use:session\/visual-regression\/live-surface\.json"/);
  assert.match(imageMatch?.[0] ?? '', /data-surface-transport="native-frame-stream"/);
  assert.match(imageMatch?.[0] ?? '', /data-platform-driver-ref="computer-use:session\/visual-regression\/platform-driver\.json"/);
  assert.match(html, /data-presentation-mode="live-surface-ref"/);
  assert.match(html, /data-screen-surface-mode="live"/);
  assert.match(imageMatch?.[0] ?? '', /data-target-app-ref="app:native-research-app"/);
  assert.match(stageHtml, /data-command-boundary="terminal-equivalent-input-intent"/);
  assert.match(stageHtml, /data-input-intent-ready="true"/);
  assert.match(imageMatch?.[0] ?? '', /data-event="virtual-screen-input-intent-request"/);
  assert.match(imageMatch?.[0] ?? '', /role="application"/);
  assert.match(imageMatch?.[0] ?? '', /tabindex="0"/);
  assert.match(stageHtml, /class="virtual-screen-keyboard-input"/);
  assert.doesNotMatch(imageMatch?.[1] ?? '', /^computer-use:session\//);

  assert.equal(countMatches(stageHtml, /class="virtual-screen-cursor"/g), 2);
  assert.equal(countMatches(stageHtml, /class="virtual-screen-annotation-overlay"/g), 2);
  assert.match(stageHtml, /data-cursor-state="ref-only"/);
  assert.match(footerHtml, /data-attach-state="attached"/);
  assert.match(html, /data-screen-presentation-mode="live-surface-ref"/);
  assert.doesNotMatch(html, /data-screen-presentation-mode="replay-ref-inspector"/);
  assert.match(footerHtml, /computer-use:session\/visual-regression\/overlays\/cursors-active\.json/);
  assert.match(footerHtml, /computer-use:session\/visual-regression\/proposals\/click-confirm\.json/);
  assert.match(footerHtml, /computer-use:session\/visual-regression\/input-leases\/main-held\.json/);
  assert.match(footerHtml, /computer-use:session\/visual-regression\/action-adapters\/native-app-window\.json/);
  assert.match(footerHtml, /computer-use:session\/visual-regression\/adapter-readiness\/native-app-window\.json/);
  assert.match(footerHtml, /computer-use:session\/visual-regression\/permissions\/platform-capture\.json/);
  assert.match(footerHtml, /computer-use:session\/visual-regression\/evidence-ledger\.json/);
  assert.match(footerHtml, /data-isolation-flag="affects physical display" data-isolation-value="false"/);
  assert.match(footerHtml, /data-isolation-flag="requires focus steal" data-isolation-value="false"/);
  assert.match(footerHtml, /data-isolation-flag="background renderable" data-isolation-value="true"/);
  assert.match(footerHtml, /class="virtual-screen-timeline"/);
  assert.match(footerHtml, /data-timeline-kind="before"/);
  assert.match(footerHtml, /data-timeline-kind="after"/);
  assert.match(footerHtml, /data-timeline-kind="input-intent"/);
  assert.match(footerHtml, /data-timeline-kind="executor-event"/);

  assert.doesNotMatch(html, /Virtual screen refs are not attached|Frame preview unavailable|data:image|base64/);
  assert.doesNotMatch(html, /rawScreenshot|screenshotBase64|rawTrace|providerRoute|executorLease|schedulerParams/);
});

test('virtual-screen-viewer builds terminal-equivalent InputIntent commands for attached safe screens only', () => {
  const payload = attachedInputIntentPayload();
  const command = buildVirtualScreenInputIntentCommand(payload, {
    kind: 'click',
    xRatio: 0.125,
    yRatio: 0.5,
    button: 'left',
  });

  assert.equal(
    command,
    '/computer-use input-intent --source virtual-app-screen-canvas --kind click --session-ref "computer-use:session/input/session.json" --screen-ref "virtual-app-screen:input/screen-a" --target-app-ref "app:input-native-app" --target-window-ref "window:input-native-app/main" --frame-ref "computer-use:session/input/frames/current.png" --input-lease-ref "computer-use:session/input/leases/active.json" --action-adapter-ref "computer-use:session/input/adapters/native-app-window.json" --adapter-readiness-ref "computer-use:session/input/readiness/native-app-window.json" --evidence-ledger-ref "computer-use:session/input/evidence-ledger.json" --frame-width 1440 --frame-height 900 --x-ratio 0.1250 --y-ratio 0.5000 --button left',
  );
  assert.doesNotMatch(command ?? '', /executeScoped|runComputerUse|executorLease|schedulerParams/);

  assert.equal(buildVirtualScreenInputIntentCommand({
    ...payload,
    inputLeaseRef: undefined,
  }, { kind: 'click', xRatio: 0.5, yRatio: 0.5 }), undefined);
  assert.equal(buildVirtualScreenInputIntentCommand({
    ...payload,
    isolationFlags: { ...payload.isolationFlags, requiresFocusSteal: true },
  }, { kind: 'click', xRatio: 0.5, yRatio: 0.5 }), undefined);
  assert.equal(buildVirtualScreenInputIntentCommand({
    ...payload,
    isolationFlags: { ...payload.isolationFlags, backgroundRenderable: undefined },
  }, { kind: 'click', xRatio: 0.5, yRatio: 0.5 }), undefined);
});

test('virtual-screen-viewer appends finite positive frame dimensions to screen input intent commands', () => {
  const payload = attachedInputIntentPayload();
  const actions = [
    { kind: 'click', xRatio: 0.2, yRatio: 0.4 },
    { kind: 'drag', startXRatio: 0.2, startYRatio: 0.4, endXRatio: 0.3, endYRatio: 0.5 },
    { kind: 'scroll', xRatio: 0.2, yRatio: 0.4, deltaY: 80 },
    { kind: 'hotkey', key: 'Enter' },
    { kind: 'type_text', text: 'hello' },
  ] as const;

  for (const action of actions) {
    const command = buildVirtualScreenInputIntentCommand(payload, action);

    assert.match(command ?? '', /--frame-width 1440 --frame-height 900/, action.kind);
  }

  assert.doesNotMatch(
    buildVirtualScreenInputIntentCommand({
      ...payload,
      screen: { width: Number.POSITIVE_INFINITY, height: 900 },
    }, { kind: 'click', xRatio: 0.2, yRatio: 0.4 }) ?? '',
    /--frame-width|--frame-height/,
  );
  assert.doesNotMatch(
    buildVirtualScreenInputIntentCommand(payload, { kind: 'menu_command', menuCommand: 'File>Open' }) ?? '',
    /--frame-width|--frame-height/,
  );
});

test('virtual-screen-viewer declares mouse keyboard capture without importing executors', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.match(source, /virtual-screen-keyboard-input/);
  assert.match(source, /onPointerDown/);
  assert.match(source, /onPointerUp/);
  assert.match(source, /onDoubleClick/);
  assert.match(source, /onWheel/);
  assert.match(source, /onKeyDown/);
  assert.match(source, /buildVirtualScreenInputIntentCommand/);
  assert.match(source, /terminal-equivalent-input-intent/);
  assert.doesNotMatch(source, /sendRemoteHostSessionAction|startRemoteHostSession|executeScoped|runComputerUse|executor\.invoke|module\.invoke/);
});

test('virtual-screen-viewer shows no-session attach state without fabricating frame evidence', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer(emptyVirtualScreenViewerFixture));

  assert.match(html, /data-status="empty"/);
  assert.match(html, /data-presentation-mode="empty"/);
  assert.match(html, /data-attach-state="no-session"/);
  assert.match(html, /VirtualAppScreen attach state: no-session/);
  assert.match(html, /data-placeholder-evidence="false"/);
  assert.doesNotMatch(html, /virtual-screen-frame-image|data-frame-ref=/);
});

test('virtual-screen-viewer renders replay frame refs without pretending to own a live stream', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer({
    slot: { componentId: 'virtual-screen-viewer', title: 'Replay frame' },
    artifact: {
      id: 'replay-frame',
      type: 'computer-use-virtual-screen',
      producerScenario: 'computer-use',
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      data: {
        title: 'Replay frame',
        surfaceMode: 'live',
        frameRefs: ['computer-use:session/replay/frames/current.png'],
        replayRef: 'computer-use:session/replay/replay.json',
        evidenceLedgerRef: 'computer-use:session/replay/evidence-ledger.json',
      },
    },
  }));

  assert.match(html, /data-attach-state="replay"/);
  assert.match(html, /data-screen-surface-mode="replay"/);
  assert.match(html, /VirtualAppScreen replay/);
  assert.match(html, /evidence, not an alternate control path/);
  assert.doesNotMatch(html, /data-screen-surface-mode="live"/);
  assert.match(html, /class="virtual-screen-frame-image"/);
  assert.match(html, /src="\/api\/sciforge\/preview\/raw\?ref=computer-use%3Asession%2Freplay%2Fframes%2Fcurrent\.png"/);
  assert.doesNotMatch(html, /data-frame-stream-ref="computer-use/);
});

test('virtual-screen-viewer renders host-owned live surface refs without provider payloads', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer({
    slot: { componentId: 'virtual-screen-viewer', title: 'Live VSCode screen' },
    artifact: {
      id: 'live-vscode-screen',
      type: 'computer-use-virtual-screen',
      producerScenario: 'computer-use',
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      data: {
        title: 'VSCode VirtualAppScreen',
        status: 'ready',
        attachState: 'attached',
        surfaceMode: 'live',
        targetAppRef: 'app:vscode',
        targetWindowRef: 'window:vscode/main',
        sessionRef: 'computer-use:session/vscode/session.json',
        screenRef: 'virtual-app-screen:vscode/screen',
        liveSurfaceRef: 'computer-use:session/vscode/live-surface.json',
        surfaceTransport: 'native-frame-stream',
        platformDriverRef: 'computer-use:session/vscode/platform-driver.json',
        platformDriverStatus: 'ready',
        frameStreamRef: 'computer-use:session/vscode/frame-stream.json',
        currentFrameRef: 'computer-use:session/vscode/frames/current.png',
        inputLeaseRef: 'computer-use:session/vscode/input-lease.json',
        actionAdapterRef: 'computer-use:session/vscode/action-adapter.json',
        adapterReadinessRef: 'computer-use:session/vscode/adapter-readiness.json',
        permissionRef: 'computer-use:session/vscode/permissions/platform-capture.json',
        permissionStatus: 'granted',
        permissionRequired: true,
        permissionGranted: true,
        sharedInputAllowed: false,
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
      },
    },
  }));

  assert.match(html, /data-presentation-mode="live-surface-ref"/);
  assert.match(html, /data-screen-surface-mode="live"/);
  assert.match(html, /data-live-surface-ref="computer-use:session\/vscode\/live-surface\.json"/);
  assert.match(html, /data-surface-transport="native-frame-stream"/);
  assert.match(html, /data-platform-driver-status="ready"/);
  assert.match(html, /data-permission-status="granted"/);
  assert.match(html, /data-screen-presentation-mode="live-surface-ref"/);
  assert.match(html, /Live surface/);
  assert.match(html, /data-isolation-flag="single interactive truth" data-isolation-value="true"/);
  assert.match(html, /data-isolation-flag="second interactive surface" data-isolation-value="false"/);
  assert.doesNotMatch(html, /providerRoute|streamUrl|iceCandidates|data:image|base64/);
});

test('virtual-screen-viewer fails closed for missing platform driver and incomplete isolation', () => {
  const blockedHtml = renderToStaticMarkup(renderVirtualScreenViewer({
    slot: { componentId: 'virtual-screen-viewer', title: 'Driver missing' },
    artifact: {
      id: 'driver-missing',
      type: 'computer-use-virtual-screen',
      producerScenario: 'computer-use',
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      data: {
        status: 'ready',
        attachState: 'attached',
        targetAppRef: 'app:driver-missing-native-app',
        sessionRef: 'computer-use:session/driver-missing/session.json',
        liveSurfaceRef: 'computer-use:session/driver-missing/live-surface.json',
        surfaceTransport: 'native-frame-stream',
        platformDriverRef: 'computer-use:session/driver-missing/platform-driver.json',
        platformDriverStatus: 'missing',
        currentFrameRef: 'computer-use:session/driver-missing/frames/current.png',
        inputLeaseRef: 'computer-use:session/driver-missing/input-lease.json',
        actionAdapterRef: 'computer-use:session/driver-missing/action-adapter.json',
        adapterReadinessRef: 'computer-use:session/driver-missing/adapter-readiness.json',
        permissionStatus: 'granted',
        permissionGranted: true,
        sharedInputAllowed: false,
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
      },
    },
  }));

  assert.match(blockedHtml, /data-attach-state="blocked"/);
  assert.match(blockedHtml, /data-platform-driver-status="missing"/);
  assert.match(blockedHtml, /data-input-intent-ready="false"/);

  const observeOnlyHtml = renderToStaticMarkup(renderVirtualScreenViewer({
    slot: { componentId: 'virtual-screen-viewer', title: 'Isolation incomplete' },
    artifact: {
      id: 'isolation-incomplete',
      type: 'computer-use-virtual-screen',
      producerScenario: 'computer-use',
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      data: {
        status: 'ready',
        attachState: 'attached',
        targetAppRef: 'app:observe-native-app',
        sessionRef: 'computer-use:session/isolation-incomplete/session.json',
        liveSurfaceRef: 'computer-use:session/isolation-incomplete/live-surface.json',
        surfaceTransport: 'native-frame-stream',
        platformDriverRef: 'computer-use:session/isolation-incomplete/platform-driver.json',
        platformDriverStatus: 'ready',
        currentFrameRef: 'computer-use:session/isolation-incomplete/frames/current.png',
        inputLeaseRef: 'computer-use:session/isolation-incomplete/input-lease.json',
        actionAdapterRef: 'computer-use:session/isolation-incomplete/action-adapter.json',
        adapterReadinessRef: 'computer-use:session/isolation-incomplete/adapter-readiness.json',
        permissionStatus: 'granted',
        permissionGranted: true,
        sharedInputAllowed: false,
        isolationFlags: {
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
    },
  }));

  assert.match(observeOnlyHtml, /data-attach-state="observe-only"/);
  assert.match(observeOnlyHtml, /data-screen-surface-mode="live"/);
  assert.match(observeOnlyHtml, /data-input-intent-ready="false"/);
});

test('virtual-screen-viewer rejects non-platform live transports without enabling input', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer({
    slot: { componentId: 'virtual-screen-viewer', title: 'Unsupported transport' },
    artifact: {
      id: 'unsupported-transport',
      type: 'computer-use-virtual-screen',
      producerScenario: 'computer-use',
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      data: {
        status: 'ready',
        attachState: 'attached',
        targetAppRef: 'app:unsupported-transport-native-app',
        sessionRef: 'computer-use:session/unsupported-transport/session.json',
        liveSurfaceRef: 'computer-use:session/unsupported-transport/live-surface.json',
        surfaceTransport: 'remote-frame-stream',
        platformDriverRef: 'computer-use:session/unsupported-transport/platform-driver.json',
        platformDriverStatus: 'ready',
        currentFrameRef: 'computer-use:session/unsupported-transport/frames/current.png',
        inputLeaseRef: 'computer-use:session/unsupported-transport/input-lease.json',
        actionAdapterRef: 'computer-use:session/unsupported-transport/action-adapter.json',
        adapterReadinessRef: 'computer-use:session/unsupported-transport/adapter-readiness.json',
        permissionStatus: 'granted',
        permissionGranted: true,
        sharedInputAllowed: false,
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
      },
    },
  }));

  assert.match(html, /data-attach-state="observe-only"/);
  assert.match(html, /data-rejection-kind="unsupported-transport" data-rejected-field="surfaceTransport"/);
  assert.match(html, /data-input-intent-ready="false"/);
  assert.doesNotMatch(html, /data-screen-surface-mode="live"/);
});

test('virtual-screen-viewer distinguishes acceptance-oriented attach states', () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['adapter-unavailable', {
      targetAppRef: 'app:blocked-native-app',
      sessionRef: 'computer-use:session/attach/adapter-unavailable.json',
      liveSurfaceRef: 'computer-use:session/attach/live-surface.json',
      surfaceTransport: 'native-frame-stream',
      platformDriverRef: 'computer-use:session/attach/platform-driver.json',
      platformDriverStatus: 'ready',
      frameStreamRef: 'computer-use:session/attach/frame-stream.json',
      currentFrameRef: 'computer-use:session/attach/frames/current.png',
      permissionStatus: 'granted',
      permissionGranted: true,
      sharedInputAllowed: false,
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
    }, /Adapter unavailable/],
    ['observe-only', {
      attachState: 'observe-only',
      targetAppRef: 'app:observe-native-app',
      sessionRef: 'computer-use:session/attach/observe-only.json',
      adapterReadinessRef: 'computer-use:session/attach/adapter-readiness/observe-only.json',
      currentFrameRef: 'computer-use:session/attach/frames/observe-only.png',
    }, /Observe-only/],
    ['blocked', {
      targetAppRef: 'app:blocked-native-app',
      sessionRef: 'computer-use:session/attach/blocked.json',
      adapterReadinessRef: 'computer-use:session/attach/adapter-readiness/blocked.json',
      blockedRef: 'computer-use:session/attach/blocked/permission.json',
    }, /VirtualAppScreen blocked/],
    ['requires-handoff', {
      attachState: 'requires-handoff',
      targetAppRef: 'app:handoff-native-app',
      sessionRef: 'computer-use:session/attach/requires-handoff.json',
      adapterReadinessRef: 'computer-use:session/attach/adapter-readiness/focus-steal.json',
      handoffRef: 'computer-use:session/attach/handoff.json',
      platformDriverRef: 'computer-use:session/attach/platform-driver.json',
      platformDriverStatus: 'ready',
      permissionStatus: 'granted',
      permissionGranted: true,
      sharedInputAllowed: false,
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
    }, /User handoff required/],
  ];

  for (const [state, data, copy] of cases) {
    const html = renderToStaticMarkup(renderVirtualScreenViewer({
      slot: { componentId: 'virtual-screen-viewer', title: state },
      artifact: {
        id: `attach-${state}`,
        type: 'computer-use-virtual-screen',
        producerScenario: 'computer-use',
        schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
        data,
      },
    }));
    assert.match(html, new RegExp(`data-attach-state="${state}"`), state);
    assert.match(html, copy, state);
    assert.match(html, /data-placeholder-evidence="false"/, state);
    assert.doesNotMatch(html, /<form|executeScoped|runComputerUse/, state);
  }
});

test('virtual-screen-viewer supports refs contract and rejects raw screenshot/base64/provider/executor inputs', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer(refsContractVirtualScreenViewerFixture));

  assert.match(html, /data-attach-state="error"/);
  assert.match(html, /src="\/api\/sciforge\/preview\/raw\?ref=computer-use%3Asession%2Fcontract%2Fframes%2Fafter\.png"/);
  assert.match(html, /computer-use:session\/contract\/frames\/before\.png/);
  assert.match(html, /computer-use:session\/contract\/before-after\/click\.json/);
  assert.match(html, /computer-use:session\/contract\/overlays\/cursors\.json/);
  assert.match(html, /computer-use:session\/contract\/input-leases\/screen-a\.json/);
  assert.match(html, /computer-use:session\/contract\/action-adapters\/native-app-window\.json/);
  assert.match(html, /computer-use:session\/contract\/adapter-readiness\/native-app-window\.json/);
  assert.match(html, /computer-use:session\/contract\/proposals\/click\.json/);
  assert.match(html, /computer-use:session\/contract\/evidence-ledger\.json/);
  assert.match(html, /computer-use:session\/contract\/blocked\/permission\.json/);
  assert.match(html, /computer-use:session\/contract\/errors\/latest\.json/);
  assert.match(html, /data-unsafe-input-rejected="true"/);
  assert.match(html, /data-rejection-kind="inline-screenshot" data-rejected-field="rawScreenshot"/);
  assert.match(html, /data-rejection-kind="inline-image" data-rejected-field="screenshotBase64"/);
  assert.match(html, /data-rejection-kind="raw-trace" data-rejected-field="rawTrace"/);
  assert.match(html, /data-rejection-kind="raw-json" data-rejected-field="rawJson"/);
  assert.match(html, /data-rejection-kind="provider-route" data-rejected-field="providerRoute"/);
  assert.match(html, /data-rejection-kind="provider-params" data-rejected-field="providerParams"/);
  assert.match(html, /data-rejection-kind="executor-params" data-rejected-field="executorParams"/);
  assert.match(html, /data-rejection-kind="executor-params" data-rejected-field="executorLeaseParams"/);
  assert.match(html, /computer-use:session\/contract\/frames\/legacy\.png/);
  assert.match(html, /data-rejection-kind="unsafe-ref" data-rejected-field="frameRefs\[0\]\.framePreviewUrl"/);
  assert.match(html, /inline screenshot/);
  assert.match(html, /base64 image payload/);
  assert.match(html, /provider parameters/);
  assert.match(html, /executor parameters/);
  assert.doesNotMatch(html, /https:\/\/preview\.invalid|data:image|blocked&quot;|do-not-render|\/private\/provider|sk-do-not-render/);
});

test('virtual-screen-viewer drops unsafe ref values instead of rendering provider or inline screenshots', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer({
    slot: { componentId: 'virtual-screen-viewer', title: 'Unsafe Frame' },
    artifact: {
      id: 'unsafe-frame',
      type: 'computer-use-virtual-screen',
      producerScenario: 'computer-use',
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      data: {
        targetAppRef: 'app:unsafe-native-app',
        sessionRef: 'computer-use:session/unsafe/app-screen-session.json',
        adapterReadinessRef: 'computer-use:session/unsafe/adapter-readiness/native-app-window.json',
        currentFrameRef: 'data:image/png;base64,abc',
        frameStreamRef: 'https://provider.example.test/stream?api_key=abc123',
        providerParams: { apiKey: 'sk-secret' },
        executorParams: { action: 'click' },
      },
    },
  }));

  assert.match(html, /data-rejection-kind="unsafe-ref" data-rejected-field="currentFrameRef"/);
  assert.match(html, /data-rejection-kind="unsafe-ref" data-rejected-field="frameStreamRef"/);
  assert.match(html, /data-rejection-kind="provider-params" data-rejected-field="providerParams"/);
  assert.match(html, /data-rejection-kind="executor-params" data-rejected-field="executorParams"/);
  assert.match(html, /data-frame-evidence="none"/);
  assert.doesNotMatch(html, /<img|data:image|base64,abc|provider\.example|api_key=abc123|sk-secret/);
});

test('virtual-screen-viewer imports no Computer Use executor modules', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /packages\/actions\/computer-use|observe\/vision|src\/runtime\/computer-use|executeScoped|runComputerUse|executor\.invoke|module\.invoke/);
});

function attachedInputIntentPayload(): VirtualScreenPayload {
  return {
    title: 'InputIntent Screen',
    status: 'ready',
    attachState: 'attached',
    screenRef: 'virtual-app-screen:input/screen-a',
    targetAppRef: 'app:input-native-app',
    targetWindowRef: 'window:input-native-app/main',
    sessionRef: 'computer-use:session/input/session.json',
    liveSurfaceRef: 'computer-use:session/input/live-surface.json',
    surfaceTransport: 'native-frame-stream',
    platformDriverRef: 'computer-use:session/input/platform-driver.json',
    platformDriverStatus: 'ready',
    currentFrameRef: 'computer-use:session/input/frames/current.png',
    screen: { width: 1440, height: 900 },
    inputLeaseRef: 'computer-use:session/input/leases/active.json',
    actionAdapterRef: 'computer-use:session/input/adapters/native-app-window.json',
    adapterReadinessRef: 'computer-use:session/input/readiness/native-app-window.json',
    evidenceLedgerRef: 'computer-use:session/input/evidence-ledger.json',
    permissionRef: 'computer-use:session/input/permissions/platform-capture.json',
    permissionStatus: 'granted',
    permissionRequired: true,
    permissionGranted: true,
    sharedInputAllowed: false,
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
  };
}

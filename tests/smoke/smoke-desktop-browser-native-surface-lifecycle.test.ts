import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDesktopBrowserHostSurfaceController,
  type DesktopBrowserHostSurfaceBounds,
  type DesktopBrowserHostSurfaceState,
  type DesktopBrowserHostSurfaceViewLike,
  type DesktopBrowserHostSurfaceWebContentsLike,
} from '../../src/desktop/browser-host-surface.js';

test('desktop BrowserHostSession native surface lifecycle contract covers resize detach reattach focus and cleanup', async () => {
  const events: string[] = [];
  const fakeViews: FakeWebContentsView[] = [];
  const windowA = createFakeWindow('window-a', events);
  const windowB = createFakeWindow('window-b', events);

  class FakeWebContentsView implements DesktopBrowserHostSurfaceViewLike {
    bounds: DesktopBrowserHostSurfaceBounds = { x: 0, y: 0, width: 1, height: 1 };
    visible = false;
    webContents: DesktopBrowserHostSurfaceWebContentsLike = {
      close: () => {
        events.push(`webContents.close:${fakeViews.indexOf(this)}`);
      },
      focus: () => {
        events.push(`webContents.focus:${fakeViews.indexOf(this)}`);
      },
      getTitle: () => 'contract-only fake native surface',
      getURL: () => 'about:blank',
      executeJavaScript: async <T = unknown>() => {
        events.push(`webContents.executeJavaScript:${fakeViews.indexOf(this)}`);
        return {
          activeEditable: true,
          caretVisible: true,
          blurred: true,
          restored: true,
          rawUrl: 'https://example.invalid/private',
          dom: '<input value="secret">',
          payload: { secret: 'do-not-record' },
        } as T;
      },
      stop: () => {
        events.push(`webContents.stop:${fakeViews.indexOf(this)}`);
      },
    };

    constructor() {
      fakeViews.push(this);
      events.push(`view.construct:${fakeViews.length - 1}`);
    }

    setBounds(bounds: DesktopBrowserHostSurfaceBounds): void {
      this.bounds = bounds;
      events.push(`view.setBounds:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`);
    }

    getBounds(): DesktopBrowserHostSurfaceBounds {
      return this.bounds;
    }

    setVisible(visible: boolean): void {
      this.visible = visible;
      events.push(`view.setVisible:${visible}`);
    }
  }

  const controller = createDesktopBrowserHostSurfaceController({
    WebContentsView: FakeWebContentsView,
  });

  controller.setMainWindow(windowA);
  const started = controller.startSession({ sessionId: 'native-lifecycle', width: 1024, height: 768 });
  assertNativeContractState(started, { embeddedPassClaim: false });
  assert.equal(started.embedded, false);
  assert.equal(started.visible, false);
  assert.equal(fakeViews.length, 1);

  const attached = controller.attach({
    sessionId: 'native-lifecycle',
    bounds: { x: 320.4, y: 24.6, width: 640.2, height: 480.8 },
    visible: true,
    focus: true,
  });
  assertNativeContractState(attached, { embeddedPassClaim: true });
  assert.equal(attached.embedded, true);
  assert.equal(attached.visible, true);
  assert.deepEqual(attached.bounds, { x: 320, y: 25, width: 640, height: 481 });
  assert.deepEqual(windowA.contentView.views, [fakeViews[0]]);

  const focusCaretProof = await controller.action('native-lifecycle', {
    action: 'native-os-ui-proof',
    proofGroup: 'cursorCaret',
    probe: 'focus-caret',
    expectedProofNames: ['input-caret-visible', 'focus-blur-restore'],
    actionId: 'focus-input-caret',
    capture: 'none',
  });
  assertNativeContractState(focusCaretProof, { embeddedPassClaim: true });
  assert.equal(focusCaretProof.nativeOsUiProof?.schemaVersion, 'sciforge.browser-host-session.native-os-ui-proof.v1');
  assert.equal(focusCaretProof.nativeOsUiProof?.boundedEvidenceOnly, true);
  assert.equal(focusCaretProof.nativeOsUiProof?.rawDomRecorded, false);
  assert.equal(focusCaretProof.nativeOsUiProof?.rawTextRecorded, false);
  assert.equal(focusCaretProof.nativeOsUiProof?.rawUrlRecorded, false);
  assert.equal(focusCaretProof.nativeOsUiProof?.rawTitleRecorded, false);
  assert.equal(focusCaretProof.nativeOsUiProof?.rawSelectorRecorded, false);
  assert.equal(focusCaretProof.nativeOsUiProof?.rawCoordsRecorded, false);
  assert.equal(focusCaretProof.nativeOsUiProof?.rawPayloadRecorded, false);
  assert.equal(focusCaretProof.nativeOsUiProof?.source, 'native-embedded-action-state');
  assert.equal(focusCaretProof.nativeOsUiProof?.proofGroup, 'cursorCaret');
  assert.equal(focusCaretProof.nativeOsUiProof?.actionId, 'focus-input-caret');
  assert.deepEqual(focusCaretProof.nativeOsUiProof?.observedProofNames, ['input-caret-visible', 'focus-blur-restore']);
  assert.ok(focusCaretProof.nativeOsUiProof?.evidenceTokens.includes('proof:input-caret-visible:observed'));
  assert.ok(focusCaretProof.nativeOsUiProof?.evidenceTokens.includes('proof:focus-blur-restore:observed'));
  assert.doesNotMatch(
    JSON.stringify(focusCaretProof.nativeOsUiProof),
    /secret|<input|https?:|selector:|coords:|payload:|"x"|"y"|"url"|"title"|"rawUrl"/i,
  );

  const executeJavaScriptCallsBeforeKeyboardProof = events.filter((event) => event === 'webContents.executeJavaScript:0').length;
  const keyboardProof = await controller.action('native-lifecycle', {
    action: 'native-os-ui-proof',
    proofGroup: 'keyboardImeClipboardSelection',
    probe: 'bounded-keyboard-ime-clipboard-selection',
    expectedProofNames: ['keyboard-enter-owner'],
    actionId: 'url:https://example.invalid/payload:secret',
    capture: 'none',
  });
  const executeJavaScriptCallsAfterKeyboardProof = events.filter((event) => event === 'webContents.executeJavaScript:0').length;
  assertNativeContractState(keyboardProof, { embeddedPassClaim: true });
  assert.equal(executeJavaScriptCallsAfterKeyboardProof, executeJavaScriptCallsBeforeKeyboardProof);
  assert.equal(keyboardProof.nativeOsUiProof?.proofGroup, 'keyboardImeClipboardSelection');
  assert.equal(keyboardProof.nativeOsUiProof?.actionId, 'native-os-ui-proof');
  assert.deepEqual(keyboardProof.nativeOsUiProof?.observedProofNames, []);
  assert.doesNotMatch(JSON.stringify(keyboardProof.nativeOsUiProof), /https?:|secret/i);

  const resizedHidden = controller.attach({
    sessionId: 'native-lifecycle',
    bounds: { x: -20, y: -4, width: 0, height: 0 },
    visible: false,
  });
  assertNativeContractState(resizedHidden, { embeddedPassClaim: true });
  assert.equal(resizedHidden.embedded, true);
  assert.equal(resizedHidden.visible, false);
  assert.deepEqual(resizedHidden.bounds, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(windowA.contentView.views, [fakeViews[0]]);

  const detached = controller.detach('native-lifecycle');
  assertNativeContractState(detached, { embeddedPassClaim: false });
  assert.equal(detached.embedded, false);
  assert.equal(detached.visible, false);
  assert.deepEqual(windowA.contentView.views, []);
  assert.equal(fakeViews[0].visible, false);

  controller.setMainWindow(windowB);
  const reattached = controller.attach({
    sessionId: 'native-lifecycle',
    bounds: { x: 12, y: 34, width: 800, height: 600 },
    visible: true,
    focus: true,
  });
  assertNativeContractState(reattached, { embeddedPassClaim: true });
  assert.equal(reattached.embedded, true);
  assert.equal(reattached.visible, true);
  assert.deepEqual(reattached.bounds, { x: 12, y: 34, width: 800, height: 600 });
  assert.deepEqual(windowA.contentView.views, []);
  assert.deepEqual(windowB.contentView.views, [fakeViews[0]]);
  assert.equal(fakeViews.length, 1, 'reattach must reuse the same BrowserHostSession native surface');

  const closed = await controller.action('native-lifecycle', { action: 'close' });
  assertNativeContractState(closed, { embeddedPassClaim: false });
  assert.equal(closed.visible, false);
  assert.equal(controller.state('native-lifecycle').reason, 'native-embedded-session-not-found');
  assert.deepEqual(windowB.contentView.views, []);
  assert.equal(fakeViews[0].visible, false);

  const server = await controller.startServer();
  assert.equal(server.ok, true);
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const health = await fetchJson(`${server.url}/health`);
  assert.equal(health.ok, true);
  assert.equal(health.service, 'sciforge-desktop-browser-host-surface');
  assert.equal(health.owner, 'BrowserHostSession');
  assert.equal(health.liveSurfaceTransport, 'native-embedded');
  assert.equal(health.secondTruthSource, false);
  assert.equal(health.ready, true);
  assert.equal(health.nativeBridge, true);
  assert.equal(health.rightPaneBridge, true);
  assert.equal(health.attachAvailable, true);
  assert.equal(health.stateAvailable, true);
  assert.equal(health.passClaim, true);

  controller.startSession({ sessionId: 'native-server-cleanup' });
  controller.attach({
    sessionId: 'native-server-cleanup',
    bounds: { x: 1, y: 2, width: 300, height: 200 },
    visible: true,
  });
  await controller.stopServer();
  assert.equal(controller.serverUrl(), undefined);
  assert.equal(controller.state('native-server-cleanup').reason, 'native-embedded-session-not-found');

  const eventText = events.join('\n');
  assert.match(eventText, /view\.setBounds:320,25,640,481/);
  assert.match(eventText, /view\.setBounds:0,0,1,1/);
  assert.match(eventText, /window\.focus:window-a/);
  assert.match(eventText, /window\.focus:window-b/);
  assert.equal(countEvents(events, 'contentView.addChildView:window-a'), 1);
  assert.equal(countEvents(events, 'contentView.removeChildView:window-a'), 1);
  assert.equal(countEvents(events, 'contentView.addChildView:window-b'), 2);
  assert.equal(countEvents(events, 'contentView.removeChildView:window-b'), 2);
  assert.equal(countEvents(events, 'webContents.close:0'), 1);
  assert.equal(countEvents(events, 'webContents.close:1'), 1);
});

function createFakeWindow(name: string, events: string[]) {
  const views: DesktopBrowserHostSurfaceViewLike[] = [];
  return {
    contentView: {
      views,
      addChildView(view: DesktopBrowserHostSurfaceViewLike): void {
        if (!views.includes(view)) views.push(view);
        events.push(`contentView.addChildView:${name}`);
      },
      removeChildView(view: DesktopBrowserHostSurfaceViewLike): void {
        const index = views.indexOf(view);
        if (index >= 0) views.splice(index, 1);
        events.push(`contentView.removeChildView:${name}`);
      },
    },
    focus(): void {
      events.push(`window.focus:${name}`);
    },
  };
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return await response.json() as Record<string, unknown>;
}

function assertNativeContractState(
  state: DesktopBrowserHostSurfaceState,
  options: { embeddedPassClaim: boolean },
): void {
  assert.equal(state.owner, 'BrowserHostSession');
  assert.equal(state.adapterRole, 'display-input-adapter');
  assert.equal(state.surface, 'electron-web-contents-view');
  assert.equal(state.liveSurfaceTransport, 'native-embedded');
  assert.equal(state.singleInteractiveTruth, true);
  assert.equal(state.secondTruthSource, false);
  assert.equal(state.ready, state.ok);
  assert.equal(state.nativeBridge, true);
  assert.equal(state.rightPaneBridge, true);
  assert.equal(state.attachAvailable, true);
  assert.equal(state.stateAvailable, true);
  assert.equal(state.passClaim, options.embeddedPassClaim);
}

function countEvents(events: string[], value: string): number {
  return events.filter((event) => event === value).length;
}

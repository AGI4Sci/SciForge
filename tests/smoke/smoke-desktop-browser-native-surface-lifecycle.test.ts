import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createDesktopBrowserHostSurfaceController,
  type DesktopBrowserHostSurfaceBounds,
  type DesktopBrowserHostSurfaceState,
  type DesktopBrowserHostSurfaceViewLike,
  type DesktopBrowserHostSurfaceWebContentsLike,
} from '../../src/desktop/browser-host-surface.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

test('desktop BrowserHostSession native surface uses workspace profile partition without exposing the profile path', async () => {
  const constructedOptions: unknown[] = [];

  class FakeWebContentsView implements DesktopBrowserHostSurfaceViewLike {
    webContents: DesktopBrowserHostSurfaceWebContentsLike = {};

    constructor(options?: unknown) {
      constructedOptions.push(options);
    }
  }

  const controller = createDesktopBrowserHostSurfaceController({
    WebContentsView: FakeWebContentsView,
  });
  const workspaceAProfile = '/private/workspaces/alpha/.sciforge/browser-host/profile';
  const workspaceBProfile = '/private/workspaces/beta/.sciforge/browser-host/profile';

  const alphaOne = controller.startSession({
    sessionId: 'native-alpha-1',
    workspaceProfileDir: workspaceAProfile,
  });
  const alphaTwo = controller.startSession({
    sessionId: 'native-alpha-2',
    workspaceProfileDir: workspaceAProfile,
  });
  controller.startSession({
    sessionId: 'native-beta',
    workspaceProfileDir: workspaceBProfile,
  });
  controller.startSession({
    sessionId: 'native-ephemeral',
  });

  const partitions = constructedOptions.map((option) => {
    const webPreferences = (option as { webPreferences?: { partition?: unknown } } | undefined)?.webPreferences;
    return typeof webPreferences?.partition === 'string' ? webPreferences.partition : '';
  });
  assert.match(partitions[0], /^persist:sciforge-browser-host-[a-f0-9]{16}$/);
  assert.equal(partitions[0], partitions[1]);
  assert.notEqual(partitions[0], partitions[2]);
  assert.match(partitions[3], /^sciforge-browser-host-[a-f0-9]{16}$/);
  assert.doesNotMatch(partitions[3], /^persist:/);
  assert.doesNotMatch(JSON.stringify(constructedOptions), /\/private\/workspaces|\.sciforge|browser-host\/profile|alpha|beta/);
  assert.doesNotMatch(JSON.stringify([alphaOne, alphaTwo]), /partition|profile|\/private\/workspaces|\.sciforge/i);

  await controller.stopServer();
});

test('desktop BrowserHostSession native surface keeps window-open navigations in the current embedded tab', async () => {
  type WindowOpenHandler = (details: { url?: string }) => { action: 'allow' | 'deny' };
  const events: string[] = [];
  let windowOpenHandler: WindowOpenHandler | undefined;

  class FakeWebContentsView implements DesktopBrowserHostSurfaceViewLike {
    currentUrl = 'about:blank';
    webContents: DesktopBrowserHostSurfaceWebContentsLike & {
      setWindowOpenHandler(handler: WindowOpenHandler): void;
    } = {
      setWindowOpenHandler: (handler) => {
        windowOpenHandler = handler;
        events.push('setWindowOpenHandler');
      },
      loadURL: async (url) => {
        this.currentUrl = url;
        events.push(`loadURL:${url}`);
      },
      getURL: () => this.currentUrl,
    };
  }

  const controller = createDesktopBrowserHostSurfaceController({
    WebContentsView: FakeWebContentsView,
  });

  const started = controller.startSession({ sessionId: 'native-window-open-policy' });
  assertNativeContractState(started, { embeddedPassClaim: false });
  assert.equal(typeof windowOpenHandler, 'function');
  assert.deepEqual(events, ['setWindowOpenHandler']);

  await controller.navigate('native-window-open-policy', { url: 'https://example.com/base' });
  assert.equal(events.filter((event) => event === 'setWindowOpenHandler').length, 1);

  const result = windowOpenHandler?.({ url: 'https://example.com/new' });
  assert.deepEqual(result, { action: 'deny' });
  assert.deepEqual(events, [
    'setWindowOpenHandler',
    'loadURL:https://example.com/base',
    'loadURL:https://example.com/new',
  ]);

  const state = controller.state('native-window-open-policy');
  assert.equal(state.url, 'https://example.com/new');
  assert.equal(state.loading, true);
  assert.ok(state.diagnostics?.includes('native embedded window open denied and redirected in-place'));

  await controller.stopServer();
});

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

test('desktop BrowserHostSession native surface loopback writes evidence files without raw bridge payloads', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'sciforge-native-evidence-'));
  const sessionId = 'native-evidence-bounded';

  class FakeWebContentsView implements DesktopBrowserHostSurfaceViewLike {
    webContents: DesktopBrowserHostSurfaceWebContentsLike = {
      getTitle: () => 'Native evidence title secret-token',
      getURL: () => 'https://secret.example/path?token=secret-token',
      capturePage: async () => ({
        toDataURL: () => `data:image/png;base64,${PNG_1X1.toString('base64')}`,
        toPNG: () => PNG_1X1,
      }),
      executeJavaScript: async <T = unknown>(code: string) => {
        if (code.includes('outerHTML')) {
          return '<html><body data-provider="provider-payload">secret-token DOM</body></html>' as T;
        }
        if (code.includes("role: 'document'")) {
          return {
            role: 'document',
            name: 'AX secret-token title',
            text: 'raw ax text provider-payload',
          } as T;
        }
        if (code.includes('innerText')) {
          return 'raw page text secret-token provider-payload' as T;
        }
        return '' as T;
      },
    };
  }

  const controller = createDesktopBrowserHostSurfaceController({
    WebContentsView: FakeWebContentsView,
  });

  try {
    controller.startSession({ sessionId });
    const server = await controller.startServer();

    for (const route of ['screenshot', 'content', 'text', 'ax']) {
      const response = await fetch(`${server.url}/sessions/${encodeURIComponent(sessionId)}/${route}`);
      const serialized = await response.text();
      assert.notEqual(response.status, 200, `raw GET /${route} must be blocked`);
      assertNoRawNativeEvidencePayload(serialized, `GET /${route}`);
    }

    const outputs = [
      { route: 'screenshot', outputKind: 'screenshot', path: join(outputDir, 'frame.png') },
      { route: 'content', outputKind: 'dom', path: join(outputDir, 'dom.html') },
      { route: 'text', outputKind: 'text', path: join(outputDir, 'text.txt') },
      { route: 'ax', outputKind: 'ax', path: join(outputDir, 'ax.json') },
    ] as const;

    for (const output of outputs) {
      const json = await postJson(`${server.url}/sessions/${encodeURIComponent(sessionId)}/${output.route}`, {
        outputPath: output.path,
      });
      assert.equal(json.ok, true, output.route);
      assert.equal(json.sessionId, sessionId, output.route);
      assert.equal(json.outputKind, output.outputKind, output.route);
      assert.equal(typeof json.bytesWritten, 'number', output.route);
      assert.match(String(json.sha256), /^[a-f0-9]{64}$/i, output.route);
      assert.equal(Object.hasOwn(json, 'outputPath'), false, output.route);
      assertNoRawNativeEvidencePayload(JSON.stringify(json), `POST /${output.route}`);
    }

    assert.equal((await readFile(join(outputDir, 'frame.png'))).length, PNG_1X1.length);
    assert.match(await readFile(join(outputDir, 'dom.html'), 'utf8'), /secret-token DOM/);
    assert.match(await readFile(join(outputDir, 'text.txt'), 'utf8'), /raw page text secret-token/);
    assert.match(await readFile(join(outputDir, 'ax.json'), 'utf8'), /raw ax text provider-payload/);
  } finally {
    await controller.stopServer();
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('desktop BrowserHostSession native surface derives toolbar action state from WebContentsView events', async () => {
  type Listener = (...args: unknown[]) => void;
  const listeners = new Map<string, Listener[]>();
  const events: string[] = [];

  class FakeWebContentsView implements DesktopBrowserHostSurfaceViewLike {
    webContents: DesktopBrowserHostSurfaceWebContentsLike = {
      on: (event, listener) => {
        const current = listeners.get(event) ?? [];
        current.push(listener);
        listeners.set(event, current);
      },
      loadURL: async (url) => {
        events.push(`loadURL:${url}`);
      },
      goBack: () => {
        events.push('goBack');
        emit('did-navigate-in-page', {}, 'https://example.test/back', true);
      },
      goForward: () => {
        events.push('goForward');
        emit('did-navigate-in-page', {}, 'https://example.test/forward', false);
      },
      reload: () => {
        events.push('reload');
        emit('did-start-loading');
      },
      stop: () => {
        events.push('stop');
        emit('did-stop-loading');
      },
    };
  }

  function emit(event: string, ...args: unknown[]): void {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  }

  const controller = createDesktopBrowserHostSurfaceController({
    WebContentsView: FakeWebContentsView,
  });

  const started = controller.startSession({ sessionId: 'native-toolbar-events' });
  assertNativeContractState(started, { embeddedPassClaim: false });

  await controller.navigate('native-toolbar-events', { url: 'example.test/research' });
  emit('did-start-navigation', {}, 'https://example.test/research', false, true);
  emit('did-start-loading');
  let state = controller.state('native-toolbar-events');
  assertNativeContractState(state, { embeddedPassClaim: false });
  assert.equal(state.loading, true);
  assert.equal(state.url, 'https://example.test/research');
  assert.equal(state.canGoBack, false);
  assert.equal(state.canGoForward, false);
  assert.deepEqual(state.diagnostics, []);

  emit('page-title-updated', {}, 'Research Home');
  emit('did-navigate', {}, 'https://example.test/research');
  emit('did-finish-load');
  emit('did-stop-loading');
  state = controller.state('native-toolbar-events');
  assert.equal(state.loading, false);
  assert.equal(state.title, 'Research Home');
  assert.equal(state.url, 'https://example.test/research');
  assert.equal(state.canGoBack, true);
  assert.equal(state.canGoForward, false);
  assert.deepEqual(state.diagnostics, []);

  await controller.navigate('native-toolbar-events', { url: 'https://example.test/details' });
  emit('did-start-navigation', {}, 'https://example.test/details', false, true);
  emit('did-navigate', {}, 'https://example.test/details');
  emit('did-finish-load');
  state = controller.state('native-toolbar-events');
  assert.equal(state.url, 'https://example.test/details');
  assert.equal(state.canGoBack, true);
  assert.equal(state.canGoForward, false);

  const backState = await controller.action('native-toolbar-events', { action: 'back' });
  assert.equal(backState.url, 'https://example.test/back');
  assert.equal(backState.canGoBack, true);
  assert.equal(backState.canGoForward, true);

  const forwardState = await controller.action('native-toolbar-events', { action: 'forward' });
  assert.equal(forwardState.url, 'https://example.test/forward');
  assert.equal(forwardState.canGoBack, true);
  assert.equal(forwardState.canGoForward, false);

  const reloadState = await controller.action('native-toolbar-events', { action: 'reload' });
  assert.equal(reloadState.loading, true);

  const stopState = await controller.action('native-toolbar-events', { action: 'stop' });
  assert.equal(stopState.loading, false);

  emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://example.test/missing', true);
  state = controller.state('native-toolbar-events');
  assert.equal(state.loading, false);
  assert.equal(state.url, 'https://example.test/missing');
  assert.ok(state.diagnostics?.includes('native embedded load failed: NAME_NOT_RESOLVED (-105)'));
  assertNativeContractState(state, { embeddedPassClaim: false });

  assert.deepEqual(events, [
    'loadURL:https://example.test/research',
    'loadURL:https://example.test/details',
    'goBack',
    'goForward',
    'reload',
    'stop',
  ]);
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

async function postJson(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json() as Record<string, unknown>;
  if (response.status !== 200) assert.fail(JSON.stringify(json));
  return json;
}

function assertNoRawNativeEvidencePayload(serialized: string, label: string): void {
  assert.doesNotMatch(
    serialized,
    /data:image|;base64|iVBORw0KGgo|<\s*(?:!doctype|html|body|input)\b|secret-token|provider-payload|raw page text|raw ax text|https:\/\/secret\.example/i,
    label,
  );
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

import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import test from 'node:test';

import { createDesktopBrowserHostSurfaceController } from './browser-host-surface.js';

test('desktop BrowserHost surface emits refs-first product visibility evidence only when embedded and visible', () => {
  const mainWindow = new FakeSurfaceWindow();
  const controller = createDesktopBrowserHostSurfaceController({
    WebContentsView: FakeWebContentsView as never,
  }, {
    mainWindow: () => mainWindow,
  });

  const started = controller.startSession({ sessionId: 'surface-claim-session' });
  assert.equal(started.ready, false);
  assert.equal(started.passClaim, false);
  assert.equal(started.diagnosticOnly, true);
  assert.equal(started.claimScope, 'hidden-or-diagnostic');
  assert.equal(started.surfaceRef, 'browser-host-session:surface-claim-session/surface/electron-web-contents-view');
  assert.equal(started.visibleEvidenceRef, 'browser-host-session:surface-claim-session/surface/visibility');
  assert.equal(started.readinessEvidenceRef, 'browser-host-session:surface-claim-session/surface/readiness');
  assert.equal(started.passClaimRef, 'browser-host-session:surface-claim-session/surface/pass-claim');
  assert.equal(started.surfaceEvidence?.refsFirst, true);
  assert.equal(started.surfaceEvidence?.boundedEvidenceOnly, true);
  assert.equal(started.surfaceEvidence?.visible, false);
  assert.equal(started.surfaceEvidence?.embedded, false);
  assert.equal(started.surfaceEvidence?.passClaim, false);

  const visible = controller.attach({
    sessionId: 'surface-claim-session',
    bounds: { x: 12, y: 24, width: 640, height: 360 },
    visible: true,
  });
  assert.equal(visible.ok, true);
  assert.equal(visible.ready, true);
  assert.equal(visible.passClaim, true);
  assert.equal(visible.visible, true);
  assert.equal(visible.embedded, true);
  assert.equal(visible.diagnosticOnly, false);
  assert.equal(visible.claimScope, 'visible-product-surface');
  assert.equal(visible.surfaceEvidence?.visible, true);
  assert.equal(visible.surfaceEvidence?.embedded, true);
  assert.equal(visible.surfaceEvidence?.productSurface, true);
  assert.equal(visible.surfaceEvidence?.passClaim, true);
  assert.deepEqual(visible.surfaceEvidence?.evidenceRefs, [
    'browser-host-session:surface-claim-session/surface/electron-web-contents-view',
    'browser-host-session:surface-claim-session/live-surface',
    'browser-host-session:surface-claim-session/surface/visibility',
    'browser-host-session:surface-claim-session/surface/readiness',
    'browser-host-session:surface-claim-session/surface/pass-claim',
  ]);
  assert.doesNotMatch(JSON.stringify(visible), /data:image|base64|screenshotDataUrl/i);

  const hidden = controller.attach({
    sessionId: 'surface-claim-session',
    bounds: { x: 12, y: 24, width: 640, height: 360 },
    visible: false,
  });
  assert.equal(hidden.ok, true);
  assert.equal(hidden.ready, false);
  assert.equal(hidden.passClaim, false);
  assert.equal(hidden.visible, false);
  assert.equal(hidden.embedded, true);
  assert.equal(hidden.diagnosticOnly, true);
  assert.equal(hidden.claimScope, 'hidden-or-diagnostic');
  assert.equal(hidden.diagnosticRef, 'browser-host-session:surface-claim-session/surface/diagnostics');
  assert.ok(hidden.surfaceEvidence?.diagnostics.includes('native-embedded-surface-hidden'));
  assert.doesNotMatch(JSON.stringify(hidden), /data:image|base64|screenshotDataUrl/i);
});

test('desktop BrowserHost surface fails closed for missing native surface and bounds diagnostics', async () => {
  const missingNative = createDesktopBrowserHostSurfaceController({});
  const missing = missingNative.startSession({ sessionId: 'missing-native-surface' });
  assert.equal(missing.ok, false);
  assert.equal(missing.ready, false);
  assert.equal(missing.passClaim, false);
  assert.equal(missing.diagnosticOnly, true);
  assert.equal(missing.claimScope, 'hidden-or-diagnostic');
  assert.equal(missing.reason, 'native-embedded-web-contents-view-unavailable');
  assert.equal(missing.surfaceRef, 'browser-host-session:missing-native-surface/surface/electron-web-contents-view');
  assert.equal(missing.surfaceEvidence?.missingNativeSurface, true);
  assert.ok(missing.surfaceEvidence?.diagnostics.includes('native-embedded-web-contents-view-unavailable'));

  const controller = createDesktopBrowserHostSurfaceController({
    WebContentsView: RawDiagnosticWebContentsView as never,
  }, {
    mainWindow: () => new FakeSurfaceWindow(),
  });
  controller.startSession({ sessionId: 'bounded-diagnostics-session' });
  const navigated = await controller.navigate('bounded-diagnostics-session', {
    url: 'https://example.test/diagnostics',
    timeoutMs: 1,
  });

  assert.equal(navigated.passClaim, false);
  assert.equal(navigated.diagnosticOnly, true);
  assert.ok(navigated.diagnostics?.length);
  assert.ok(navigated.diagnostics?.every((entry) => entry.length <= 180));
  assert.doesNotMatch(JSON.stringify(navigated), /data:image|base64|SECRET_SCREENSHOT|screenshotDataUrl/i);
});

test('desktop BrowserHost surface honors a requested loopback adapter URL', async () => {
  const port = await freePort();
  const controller = createDesktopBrowserHostSurfaceController({
    WebContentsView: FakeWebContentsView as never,
  });

  try {
    const started = await controller.startServer({ url: `http://localhost:${port}/native/` });
    assert.equal(started.url, `http://127.0.0.1:${port}`);

    const response = await fetch(`${started.url}/health`);
    assert.equal(response.status, 200);
    const body = await response.json() as { ready?: boolean; liveSurfaceTransport?: string };
    assert.equal(body.ready, true);
    assert.equal(body.liveSurfaceTransport, 'native-embedded');
  } finally {
    await controller.stopServer();
  }
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

class FakeSurfaceWindow {
  readonly contentView = {
    addChildView: (view: unknown) => {
      this.children.add(view);
    },
    removeChildView: (view: unknown) => {
      this.children.delete(view);
    },
  };
  readonly children = new Set<unknown>();
}

class FakeWebContentsView {
  visible = false;
  bounds = { x: 0, y: 0, width: 1, height: 1 };
  webContents = {
    getURL: () => 'about:blank',
    getTitle: () => '',
    canGoBack: () => false,
    canGoForward: () => false,
    isLoading: () => false,
    isLoadingMainFrame: () => false,
    on: () => undefined,
    setWindowOpenHandler: () => undefined,
  };
  setVisible(visible: boolean) {
    this.visible = visible;
  }
  setBounds(bounds: { x: number; y: number; width: number; height: number }) {
    this.bounds = bounds;
  }
  getBounds() {
    return this.bounds;
  }
}

class RawDiagnosticWebContentsView extends FakeWebContentsView {
  override webContents = {
    ...this.webContents,
    getURL: () => 'about:blank',
    loadURL: async () => {
      throw new Error(`capture failed data:image/png;base64,SECRET_SCREENSHOT_${'x'.repeat(256)}`);
    },
  };
}

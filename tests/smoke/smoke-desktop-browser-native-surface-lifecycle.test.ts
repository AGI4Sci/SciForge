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
  assertNativeContractState(started);
  assert.equal(started.embedded, false);
  assert.equal(started.visible, false);
  assert.equal(fakeViews.length, 1);

  const attached = controller.attach({
    sessionId: 'native-lifecycle',
    bounds: { x: 320.4, y: 24.6, width: 640.2, height: 480.8 },
    visible: true,
    focus: true,
  });
  assertNativeContractState(attached);
  assert.equal(attached.embedded, true);
  assert.equal(attached.visible, true);
  assert.deepEqual(attached.bounds, { x: 320, y: 25, width: 640, height: 481 });
  assert.deepEqual(windowA.contentView.views, [fakeViews[0]]);

  const resizedHidden = controller.attach({
    sessionId: 'native-lifecycle',
    bounds: { x: -20, y: -4, width: 0, height: 0 },
    visible: false,
  });
  assertNativeContractState(resizedHidden);
  assert.equal(resizedHidden.embedded, true);
  assert.equal(resizedHidden.visible, false);
  assert.deepEqual(resizedHidden.bounds, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(windowA.contentView.views, [fakeViews[0]]);

  const detached = controller.detach('native-lifecycle');
  assertNativeContractState(detached);
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
  assertNativeContractState(reattached);
  assert.equal(reattached.embedded, true);
  assert.equal(reattached.visible, true);
  assert.deepEqual(reattached.bounds, { x: 12, y: 34, width: 800, height: 600 });
  assert.deepEqual(windowA.contentView.views, []);
  assert.deepEqual(windowB.contentView.views, [fakeViews[0]]);
  assert.equal(fakeViews.length, 1, 'reattach must reuse the same BrowserHostSession native surface');

  const closed = await controller.action('native-lifecycle', { action: 'close' });
  assertNativeContractState(closed);
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

function assertNativeContractState(state: DesktopBrowserHostSurfaceState): void {
  assert.equal(state.owner, 'BrowserHostSession');
  assert.equal(state.adapterRole, 'display-input-adapter');
  assert.equal(state.surface, 'electron-web-contents-view');
  assert.equal(state.liveSurfaceTransport, 'native-embedded');
  assert.equal(state.singleInteractiveTruth, true);
  assert.equal(state.secondTruthSource, false);
}

function countEvents(events: string[], value: string): number {
  return events.filter((event) => event === value).length;
}

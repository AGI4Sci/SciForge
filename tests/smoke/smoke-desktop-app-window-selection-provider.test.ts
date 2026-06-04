import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDesktopAnnotationAppWindowSelectionProvider,
  type DesktopAnnotationAppWindowSelectionProvider,
} from '../../src/desktop/index.js';
import type { ScreenRegionBindingPermissionStatus } from '../../src/desktop/screen-region-auto-binding.js';

test('desktop app-window selection provider selects a deterministic windowRef without raw payloads', async () => {
  const provider = createProvider({
    permissionStatus: 'granted',
    windows: [{
      windowRef: 'desktop-window:macos-cg-window-id:92817:pid:4242',
      id: 92817,
      pid: 4242,
      processId: 4242,
      appName: 'Paper Reader',
      bundleId: 'com.example.paper-reader',
      title: 'Paper Reader - Figure 1',
      bounds: { x: 80, y: 40, width: 900, height: 640 },
      rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
      screenshotDataUrl: 'data:image/png;base64,RAW_WINDOW_SCREENSHOT',
      providerPayload: { token: 'RAW_PROVIDER_TOKEN_SHOULD_NOT_LEAK' },
    }],
  });

  const result = asRecord(await provider.select({
    schemaVersion: 'sciforge.desktop.annotation.app-window-selection-request.v1',
    mode: 'app-window',
    refsOnly: true,
    owner: { workspaceId: 'workspace-a', sessionId: 'session-a' },
    windowRef: 'desktop-window:macos-cg-window-id:92817:pid:4242',
  }));

  assert.equal(result.schemaVersion, 'sciforge.desktop.annotation.app-window-selection-result.v1');
  assert.equal(result.status, 'selected');
  assert.equal(result.windowRef, 'desktop-window:macos-cg-window-id:92817:pid:4242');
  assert.equal(result.targetRef, 'desktop-window:macos-cg-window-id:92817:pid:4242');
  assert.deepEqual(result.windowBounds, { x: 80, y: 40, width: 900, height: 640 });
  assert.deepEqual(result.windowSummary, {
    appName: 'Paper Reader',
    bundleId: 'com.example.paper-reader',
    pid: 4242,
    title: 'Paper Reader - Figure 1',
  });
  assert.deepEqual(result.refs, ['desktop-window:macos-cg-window-id:92817:pid:4242']);
  assert.equal(asRecord(result.metadata).refsOnly, true);
  assertNoRawPayload(result);
});

test('desktop app-window selection provider resolves deterministic candidate ids', async () => {
  const provider = createProvider({
    permissionStatus: 'granted',
    windows: [{
      windowRef: 'desktop-window:macos-cg-window-id:78123:pid:777',
      id: 78123,
      pid: 777,
      appName: 'Plotter',
      title: 'Plotter - Figure 2',
      bounds: { x: 300, y: 100, width: 700, height: 500 },
    }],
  });

  const result = asRecord(await provider.select({ candidateId: 78123 }));

  assert.equal(result.status, 'selected');
  assert.equal(result.windowRef, 'desktop-window:macos-cg-window-id:78123:pid:777');
  assert.deepEqual(result.windowBounds, { x: 300, y: 100, width: 700, height: 500 });
});

test('desktop app-window selection provider blocks with refs-only diagnostics when user choice is unavailable', async () => {
  const provider = createProvider({
    permissionStatus: 'granted',
    windows: [{
      windowRef: 'desktop-window:macos-cg-window-id:101:pid:202',
      id: 101,
      pid: 202,
      appName: 'Notes',
      bounds: { x: 0, y: 0, width: 500, height: 400 },
    }],
  });

  const result = asRecord(await provider.select({}));
  const diagnostic = asRecord(result.diagnostics[0]);
  const metadata = asRecord(result.metadata);

  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'desktop.annotation.app-window-selection-user-choice-unavailable');
  assert.equal(diagnostic.refsOnly, true);
  assert.deepEqual(diagnostic.refs, ['desktop-window:macos-cg-window-id:101:pid:202']);
  assert.equal(metadata.refsOnly, true);
  assert.equal(metadata.candidateCount, 1);
  assert.equal(metadata.windowListPayloadReturned, false);
  assert.equal(metadata.screenshotPayloadReturned, false);
  assert.equal(metadata.providerPayloadReturned, false);
  assertNoRawPayload(result);
});

test('desktop app-window selection provider reports cancelled chooser results as blocked', async () => {
  const provider = createProvider({
    permissionStatus: 'granted',
    windows: [{
      windowRef: 'desktop-window:macos-cg-window-id:222:pid:333',
      id: 222,
      pid: 333,
      appName: 'Reader',
      bounds: { x: 20, y: 20, width: 640, height: 480 },
    }],
    chooseWindow: () => ({ status: 'cancelled' }),
  });

  const result = asRecord(await provider.select({}));

  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'desktop.annotation.app-window-selection-cancelled');
  assertNoRawPayload(result);
});

test('desktop app-window selection provider blocks invalid refs, permission failures, and empty inventories', async () => {
  const invalidRefProvider = createProvider({
    permissionStatus: 'granted',
    windows: [{
      windowRef: 'desktop-window:macos-cg-window-id:1:pid:2',
      id: 1,
      pid: 2,
      appName: 'Reader',
      bounds: { x: 0, y: 0, width: 640, height: 480 },
    }],
  });
  const permissionProvider = createProvider({
    permissionStatus: 'denied',
    windows: [],
  });
  const noCandidatesProvider = createProvider({
    permissionStatus: 'granted',
    windows: [],
  });

  assert.equal(
    asRecord(await invalidRefProvider.select({ windowRef: 'desktop-window:missing' })).code,
    'desktop.annotation.app-window-selection-invalid-window-ref',
  );
  assert.equal(
    asRecord(await permissionProvider.select({ windowRef: 'desktop-window:any' })).code,
    'desktop.annotation.app-window-selection-permission-failure',
  );
  assert.equal(
    asRecord(await noCandidatesProvider.select({ windowRef: 'desktop-window:any' })).code,
    'desktop.annotation.app-window-selection-no-candidates',
  );
});

function createProvider(options: {
	  permissionStatus: ScreenRegionBindingPermissionStatus;
	  windows: Array<Record<string, unknown>>;
	  chooseWindow?: NonNullable<Parameters<typeof createDesktopAnnotationAppWindowSelectionProvider>[0]>['chooseWindow'];
	}): DesktopAnnotationAppWindowSelectionProvider {
  return createDesktopAnnotationAppWindowSelectionProvider({
    windowInventory: {
      screenRegionBindingPermissionStatus: () => options.permissionStatus,
      screenRegionBindingWindows: () => options.windows,
    },
    ...(options.chooseWindow ? { chooseWindow: options.chooseWindow } : {}),
  });
}

function asRecord(value: unknown): Record<string, any> {
  assert.ok(value && typeof value === 'object');
  return value as Record<string, any>;
}

function assertNoRawPayload(value: unknown): void {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /rawWindowList/i);
  assert.doesNotMatch(text, /SECRET_WINDOW/i);
  assert.doesNotMatch(text, /data:image\//i);
  assert.doesNotMatch(text, /base64/i);
  assert.doesNotMatch(text, /RAW_WINDOW/i);
  assert.doesNotMatch(text, /"providerPayload"\s*:/i);
  assert.doesNotMatch(text, /RAW_PROVIDER/i);
}

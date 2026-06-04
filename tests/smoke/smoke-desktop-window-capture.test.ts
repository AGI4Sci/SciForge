import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  DESKTOP_WINDOW_CAPTURE_SCHEMA,
  MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID,
  MACOS_SCREENCAPTUREKIT_PROVIDER_ID,
  captureSelectedDesktopWindowTarget,
  createMacOSScreencaptureFallbackDesktopWindowCaptureProvider,
  selectDesktopWindowCaptureProvider,
  type DesktopWindowCaptureProvider,
} from '../../src/desktop/window-capture.js';

const selectedWindow = {
  kind: 'window' as const,
  selectionSource: 'user' as const,
  windowRef: 'desktop-window:app:paper-reader:window-42',
  process: { pid: 4242, name: 'Paper Reader', executablePath: '/Applications/Paper Reader.app' },
  app: { id: 'org.sciforge.paper-reader', name: 'Paper Reader', kind: 'ordinary-app' as const },
  screenId: 'screen:built-in',
  bounds: { x: 44, y: 80, width: 900, height: 640 },
  scale: 2,
};

test('Desktop Window Capture prefers injected ScreenCaptureKit window-region provider on macOS', async () => {
  const calls: string[] = [];
  const fallback = fakeCaptureProvider({
    providerId: MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID,
    priority: 10,
    calls,
  });
  const screenCaptureKit = fakeCaptureProvider({
    providerId: MACOS_SCREENCAPTUREKIT_PROVIDER_ID,
    priority: 100,
    calls,
  });

  const selected = await selectDesktopWindowCaptureProvider({
    platform: 'darwin',
    providers: [fallback, screenCaptureKit],
  });

  assert.equal(selected?.providerId, 'macos-screencapturekit-window-region');
  assert.equal(selected?.providerId, MACOS_SCREENCAPTUREKIT_PROVIDER_ID);

  const result = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-alpha',
    sessionId: 'session-window-capture',
    selection: selectedWindow,
  }, {
    platform: 'darwin',
    providers: [fallback, screenCaptureKit],
    now: () => '2026-06-03T00:00:00.000Z',
  });

  assert.equal(result.schemaVersion, DESKTOP_WINDOW_CAPTURE_SCHEMA);
  assert.equal(result.status, 'captured');
  assert.equal(result.providerId, MACOS_SCREENCAPTUREKIT_PROVIDER_ID);
  assert.deepEqual(calls, [MACOS_SCREENCAPTUREKIT_PROVIDER_ID]);
  assert.equal(result.targetRef, selectedWindow.windowRef);
  assert.equal(result.windowRef, selectedWindow.windowRef);
  assert.equal(result.regionRef, null);
  assert.equal(result.screenId, selectedWindow.screenId);
  assert.deepEqual(result.bounds, selectedWindow.bounds);
  assert.equal(result.scale, selectedWindow.scale);
  assert.equal(result.capturedAt, '2026-06-03T00:00:00.000Z');
  assert.equal(result.captureTime, '2026-06-03T00:00:00.000Z');
  assert.equal(result.hash, hashFor(`${MACOS_SCREENCAPTUREKIT_PROVIDER_ID}:window`));
  assert.equal(result.captureRef, 'capture:macos-screencapturekit:window');
  assert.equal(result.imageRef, 'image:macos-screencapturekit:window');
  assert.equal(result.privacy.refsOnly, true);
  assert.equal(result.privacy.explicitSelection, true);
  assert.equal(result.privacy.unrelatedRegionsIncluded, false);
  assert.equal(result.privacy.rawPayloadReturned, false);
  assert.equal(result.windowActionSessionRef, `window-action-session:${result.windowActionSession?.id}`);
  assert.equal(result.windowActionSession?.schemaVersion, 'sciforge.window-action-session.v1');
  assert.equal(result.windowActionSession?.windowRef, selectedWindow.windowRef);
  assert.equal(result.windowActionSession?.process.pid, selectedWindow.process.pid);
  assert.equal(result.windowActionSession?.app.kind, selectedWindow.app.kind);
  assert.deepEqual(result.windowActionSession?.bounds, selectedWindow.bounds);
  assert.equal(result.windowActionSession?.scale, selectedWindow.scale);
  assert.equal(result.windowActionSession?.screenId, selectedWindow.screenId);
  assert.deepEqual(result.windowActionSession?.evidenceRefs, [
    { kind: 'capture', ref: result.captureRef },
    { kind: 'image', ref: result.imageRef },
  ]);
});

test('Desktop Window Capture falls back when ScreenCaptureKit is unavailable', async () => {
  const fallback = fakeCaptureProvider({
    providerId: MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID,
    priority: 10,
  });
  const unavailableScreenCaptureKit = fakeCaptureProvider({
    providerId: MACOS_SCREENCAPTUREKIT_PROVIDER_ID,
    priority: 100,
    available: false,
  });

  const selected = await selectDesktopWindowCaptureProvider({
    platform: 'darwin',
    providers: [fallback, unavailableScreenCaptureKit],
  });

  assert.equal(selected?.providerId, MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID);
});

test('macOS screencapture fallback captures explicit regions with execFile argv only', async () => {
  const bytes = new TextEncoder().encode('fake-screencapture-region-png');
  const fake = fakeMacOSScreencaptureFallback({ bytes });
  const provider = createMacOSScreencaptureFallbackDesktopWindowCaptureProvider(fake.dependencies);

  const result = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-alpha',
    sessionId: 'session-region-fallback',
    selection: {
      kind: 'region',
      selectionSource: 'user',
      regionRef: 'desktop-region:user-selected:region-8',
      screenId: 'screen:built-in',
      bounds: { x: 10.4, y: 20.5, width: 30.6, height: 40.1 },
      scale: 2,
    },
  }, {
    platform: 'darwin',
    providers: [provider],
    now: () => '2026-06-03T00:03:00.000Z',
  });

  assert.equal(result.status, 'captured');
  assert.equal(result.providerId, MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID);
  assert.equal(result.hash, hashFor(bytes));
  assert.equal(result.captureRef, 'capture:macos-screencapture:region');
  assert.equal(result.imageRef, 'image:macos-screencapture:region');
  assert.equal(Object.hasOwn(result, 'bytes'), false);
  assert.deepEqual(fake.commandExistsCalls, ['screencapture']);
  assert.deepEqual(fake.execFileCalls, [{
    command: 'screencapture',
    args: ['-x', '-R', '10,21,31,40', fake.outputPath],
  }]);
});

test('macOS screencapture fallback preserves rounded negative region coordinates', async () => {
  const fake = fakeMacOSScreencaptureFallback({
    bytes: new TextEncoder().encode('fake-negative-region-png'),
    outputPath: '/tmp/sciforge-window-capture-negative-region.png',
  });
  const provider = createMacOSScreencaptureFallbackDesktopWindowCaptureProvider(fake.dependencies);

  const result = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-alpha',
    sessionId: 'session-negative-region-fallback',
    selection: {
      kind: 'region',
      selectionSource: 'user',
      regionRef: 'desktop-region:user-selected:negative-region',
      screenId: 'screen:left-of-primary',
      bounds: { x: -25.6, y: -7.2, width: 100.49, height: 80.51 },
      scale: 1,
    },
  }, {
    platform: 'darwin',
    providers: [provider],
  });

  assert.equal(result.status, 'captured');
  assert.deepEqual(fake.execFileCalls, [{
    command: 'screencapture',
    args: ['-x', '-R', '-26,-7,100,81', fake.outputPath],
  }]);
});

test('macOS screencapture fallback is unavailable when screencapture is missing', async () => {
  const fake = fakeMacOSScreencaptureFallback({ commandAvailable: false });
  const provider = createMacOSScreencaptureFallbackDesktopWindowCaptureProvider(fake.dependencies);

  const selected = await selectDesktopWindowCaptureProvider({
    platform: 'darwin',
    providers: [provider],
  });

  assert.equal(selected, null);
  assert.deepEqual(fake.commandExistsCalls, ['screencapture']);
  assert.deepEqual(fake.execFileCalls, []);
});

test('macOS screencapture fallback blocks window capture without a safe explicit window id', async () => {
  const fake = fakeMacOSScreencaptureFallback();
  const provider = createMacOSScreencaptureFallbackDesktopWindowCaptureProvider(fake.dependencies);

  const result = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-alpha',
    sessionId: 'session-window-fallback-unsafe',
    selection: selectedWindow,
  }, {
    platform: 'darwin',
    providers: [provider],
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.providerId, MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID);
  assert.deepEqual(fake.execFileCalls, []);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'desktop.window-capture.window-id-required'));
});

test('macOS screencapture fallback uses -l only for a safe explicit window id', async () => {
  const bytes = new TextEncoder().encode('fake-window-id-png');
  const fake = fakeMacOSScreencaptureFallback({ bytes });
  const provider = createMacOSScreencaptureFallbackDesktopWindowCaptureProvider(fake.dependencies);

  const result = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-alpha',
    sessionId: 'session-window-fallback-safe',
    selection: {
      ...selectedWindow,
      metadata: { macosWindowId: 92817 },
    } as never,
  }, {
    platform: 'darwin',
    providers: [provider],
    now: () => '2026-06-03T00:04:00.000Z',
  });

  assert.equal(result.status, 'captured');
  assert.equal(result.hash, hashFor(bytes));
  assert.deepEqual(fake.execFileCalls, [{
    command: 'screencapture',
    args: ['-x', '-l', '92817', fake.outputPath],
  }]);
});

test('Desktop Window Capture can suppress action session creation for annotation-only capture', async () => {
  const provider = fakeCaptureProvider({
    providerId: MACOS_SCREENCAPTUREKIT_PROVIDER_ID,
    priority: 100,
  });

  const result = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-alpha',
    sessionId: 'session-window-capture',
    selection: selectedWindow,
  }, {
    platform: 'darwin',
    providers: [provider],
    now: () => '2026-06-03T00:00:00.000Z',
    createWindowActionSession: false,
  });

  assert.equal(result.status, 'captured');
  assert.equal(result.windowRef, selectedWindow.windowRef);
  assert.equal(result.windowActionSessionRef, null);
  assert.equal(result.windowActionSession, null);
});

test('Desktop Window Capture fails closed without an explicit selection', async () => {
  const calls: string[] = [];
  const provider = fakeCaptureProvider({
    providerId: MACOS_SCREENCAPTUREKIT_PROVIDER_ID,
    priority: 100,
    calls,
  });

  const result = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-alpha',
    sessionId: 'session-window-capture',
  }, {
    platform: 'darwin',
    providers: [provider],
    now: () => '2026-06-03T00:01:00.000Z',
  });

  assert.equal(result.status, 'blocked');
  assert.deepEqual(calls, []);
  assert.equal(result.providerId, null);
  assert.equal(result.captureRef, null);
  assert.equal(result.imageRef, null);
  assert.equal(result.windowActionSessionRef, null);
  assert.equal(result.windowActionSession, null);
  assert.equal(result.hash, null);
  assert.equal(result.privacy.refsOnly, true);
  assert.equal(result.privacy.explicitSelection, false);
  assert.equal(result.privacy.defaultAmbientCaptureBlocked, true);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'desktop.window-capture.selection-required'));
});

test('Desktop Window Capture blocks provider-selected ambient targets', async () => {
  const calls: string[] = [];
  const provider = fakeCaptureProvider({
    providerId: MACOS_SCREENCAPTUREKIT_PROVIDER_ID,
    priority: 100,
    calls,
  });

  const result = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-alpha',
    sessionId: 'session-ambient-capture',
    selection: {
      ...selectedWindow,
      selectionSource: 'provider',
      windowRef: 'desktop-window:provider-selected:frontmost',
    } as never,
  }, {
    platform: 'darwin',
    providers: [provider],
  });

  assert.equal(result.status, 'blocked');
  assert.deepEqual(calls, []);
  assert.equal(result.privacy.explicitSelection, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'desktop.window-capture.user-selection-required'));
});

test('Desktop Window Capture blocks display fallback as unselected ambient capture', async () => {
  const provider = fakeCaptureProvider({
    providerId: MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID,
    priority: 10,
  });

  const result = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-alpha',
    sessionId: 'session-display-fallback',
    selection: {
      kind: 'display',
      selectionSource: 'user',
      screenId: 'screen:built-in',
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      scale: 2,
    } as never,
  }, {
    platform: 'darwin',
    providers: [provider],
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.captureRef, null);
  assert.equal(result.privacy.includedRefScope, 'none');
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'desktop.window-capture.selection-kind-invalid'));
});

test('Desktop Window Capture returns refs and metadata without raw screenshot payloads', async () => {
  const regionSelection = {
    kind: 'region' as const,
    selectionSource: 'user' as const,
    regionRef: 'desktop-region:user-selected:region-7',
    screenId: 'screen:external-1',
    bounds: { x: 100, y: 120, width: 320, height: 180 },
    scale: 1,
  };
  const provider = fakeCaptureProvider({
    providerId: MACOS_SCREENCAPTUREKIT_PROVIDER_ID,
    priority: 100,
    leakedFields: {
      dataUrl: 'data:image/png;base64,SHOULD_NOT_LEAK',
      unrelatedRegionRefs: ['desktop-region:ambient:full-screen'],
    },
  });

  const result = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-alpha',
    sessionId: 'session-region-capture',
    selection: regionSelection,
  }, {
    platform: 'darwin',
    providers: [provider],
    now: () => '2026-06-03T00:02:00.000Z',
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.status, 'captured');
  assert.equal(result.targetRef, regionSelection.regionRef);
  assert.equal(result.windowRef, null);
  assert.equal(result.regionRef, regionSelection.regionRef);
  assert.equal(result.screenId, regionSelection.screenId);
  assert.equal(result.windowActionSessionRef, null);
  assert.equal(result.windowActionSession, null);
  assert.equal(result.privacy.includedRefScope, 'selected-region-only');
  assert.equal(result.privacy.unrelatedRegionsIncluded, false);
  assert.equal(Object.hasOwn(result, 'bytes'), false);
  assert.equal(Object.hasOwn(result, 'dataUrl'), false);
  assert.doesNotMatch(serialized, /SHOULD_NOT_LEAK/);
  assert.doesNotMatch(serialized, /desktop-region:ambient:full-screen/);
});

function fakeCaptureProvider(options: {
  providerId: string;
  priority: number;
  available?: boolean;
  calls?: string[];
  leakedFields?: Record<string, unknown>;
}): DesktopWindowCaptureProvider {
  return {
    providerId: options.providerId,
    priority: options.priority,
    supportedPlatforms: ['darwin'],
    async isAvailable() {
      return options.available ?? true;
    },
    async captureSelectedTarget(input) {
      options.calls?.push(options.providerId);
      const bytes = new TextEncoder().encode(`${options.providerId}:${input.selection.kind}`);
      return {
        captureRef: `capture:${options.providerId}:${input.selection.kind}`,
        imageRef: `image:${options.providerId}:${input.selection.kind}`,
        bytes,
        ...options.leakedFields,
      } as Awaited<ReturnType<DesktopWindowCaptureProvider['captureSelectedTarget']>>;
    },
  };
}

function fakeMacOSScreencaptureFallback(options: {
  bytes?: Uint8Array;
  commandAvailable?: boolean;
  outputPath?: string;
} = {}) {
  const outputPath = options.outputPath ?? '/tmp/sciforge-window-capture-fallback.png';
  const bytesByPath = new Map<string, Uint8Array>();
  const commandExistsCalls: string[] = [];
  const execFileCalls: { command: string; args: string[] }[] = [];
  const bytes = options.bytes ?? new TextEncoder().encode('fake-screencapture-png');

  return {
    outputPath,
    commandExistsCalls,
    execFileCalls,
    dependencies: {
      commandExists(command: string) {
        commandExistsCalls.push(command);
        return options.commandAvailable ?? command === 'screencapture';
      },
      createTempFile() {
        return { path: outputPath };
      },
      async readFile(path: string) {
        const output = bytesByPath.get(path);
        if (!output) throw new Error(`missing fake screencapture output for ${path}`);
        return output;
      },
      async unlink() {},
      runner: {
        async execFile(command: string, args: string[]) {
          execFileCalls.push({ command, args: [...args] });
          const path = args.at(-1);
          if (typeof path === 'string') bytesByPath.set(path, bytes);
          return { stdout: '', stderr: '' };
        },
      },
    },
  };
}

function hashFor(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

import assert from 'node:assert/strict';
import test from 'node:test';

type Bounds = { x: number; y: number; width: number; height: number };
type ControllerFactory = (deps: unknown, options?: unknown) => {
  create(): unknown;
  show(): unknown;
  setClickThrough(enabled: boolean): unknown;
  beginSelection(input: unknown): unknown;
  updateSelection(input: unknown): unknown;
  submitComment(input: unknown): unknown;
  cancel(): unknown;
  captureSelectionToRefs(input?: unknown): Promise<unknown>;
  getState(): unknown;
};

test('desktop annotation overlay creates a transparent topmost click-through Electron overlay', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness();
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    defaultClickThrough: true,
  });

  controller.create();
  controller.show();
  controller.setClickThrough(false);
  controller.setClickThrough(true);

  assert.equal(harness.windows.length, 1);
  const window = harness.windows[0];
  assert.ok(window);
  assert.deepEqual(window.options.bounds, { x: 0, y: 0, width: 1440, height: 900 });
  assert.equal(window.options.transparent, true);
  assert.equal(window.options.frame, false);
  assert.equal(window.options.alwaysOnTop, true);
  assert.equal(window.options.skipTaskbar, true);
  assert.equal(window.options.focusable, false);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.ok(window.calls.includes('setAlwaysOnTop:true:screen-saver'));
  assert.deepEqual(window.calls.filter((call) => call.startsWith('setIgnoreMouseEvents')), [
    'setIgnoreMouseEvents:true:forward',
    'setIgnoreMouseEvents:false:none',
    'setIgnoreMouseEvents:true:forward',
  ]);
  assert.ok(window.calls.includes('show'));
});

test('desktop annotation overlay supports cancel, reselect, and non-empty comment submit flow', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness();
  const controller = createDesktopAnnotationOverlayController(harness.deps);

  assert.throws(
    () => controller.beginSelection({
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      windowBounds: { x: 10, y: 20, width: 800, height: 600 },
    }),
    /windowRef or targetRef/,
  );

  controller.beginSelection({
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    windowRef: 'window:alpha',
    windowBounds: { x: 10, y: 20, width: 800, height: 600 },
  });
  controller.updateSelection({
    bounds: { x: 110, y: 80, width: 200, height: 120 },
  });
  assert.throws(() => controller.submitComment({ comment: '   ' }), /comment/i);
  assert.deepEqual(asRecord(controller.cancel()).status, 'cancelled');

  controller.beginSelection({
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    targetRef: 'window-target:alpha',
    windowRef: 'window:alpha',
    windowBounds: { x: 10, y: 20, width: 800, height: 600 },
  });
  const selection = asRecord(controller.updateSelection({
    bounds: { x: 410, y: 320, width: -160, height: -90 },
  }));
  assert.deepEqual(selection.bounds, { x: 240, y: 210, width: 160, height: 90 });
  assert.deepEqual(selection.normalizedBounds, { x: 0.3, y: 0.35, width: 0.2, height: 0.15 });

  const submitted = asRecord(controller.submitComment({
    comment: 'Check the highlighted western blot band.',
    threadId: 'thread-1',
    messageDraftId: 'draft-1',
  }));
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.comment, 'Check the highlighted western blot band.');
  assert.equal(submitted.workspaceId, 'workspace-a');
  assert.equal(submitted.sessionId, 'session-a');
  assert.equal(submitted.windowRef, 'window:alpha');
  assert.equal(submitted.targetRef, 'window-target:alpha');
});

test('desktop annotation overlay hides and restores itself while capturing selected crop refs', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness();
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    captureIdFactory: () => 'capture-fixed',
    now: () => '2026-06-03T00:00:00.000Z',
  });

  controller.create();
  controller.show();
  controller.setClickThrough(false);
  controller.beginSelection({
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    windowRef: 'window:alpha',
    targetRef: 'window-target:alpha',
    windowBounds: { x: 10, y: 20, width: 800, height: 600 },
  });
  controller.updateSelection({
    bounds: { x: 110, y: 80, width: 200, height: 120 },
  });
  controller.submitComment({
    comment: 'Annotate this crop.',
    threadId: 'thread-1',
    messageDraftId: 'draft-1',
  });

  const output = asRecord(await controller.captureSelectionToRefs());
  const window = harness.windows[0];
  assert.ok(window);
  assert.deepEqual(harness.captureObservations, [{
    overlayVisible: false,
    ignoreMouseEvents: true,
  }]);
  assert.equal(window.visible, true);
  assert.equal(window.ignoreMouseEvents, false);
  assert.deepEqual(window.calls.slice(-4), [
    'hide',
    'setIgnoreMouseEvents:true:forward',
    'setIgnoreMouseEvents:false:none',
    'show',
  ]);
  assert.equal(output.schemaVersion, 'sciforge.desktop.annotation-overlay.capture.v1');
  assert.equal(output.displayModel, 'sciforge.annotation-reference.v1');
  assert.equal(output.workspaceId, 'workspace-a');
  assert.equal(output.sessionId, 'session-a');
  assert.equal(output.windowRef, 'window:alpha');
  assert.equal(output.targetRef, 'window-target:alpha');
  assert.deepEqual(output.bounds, { x: 100, y: 60, width: 200, height: 120 });
  assert.deepEqual(output.normalizedBounds, { x: 0.125, y: 0.1, width: 0.25, height: 0.2 });
  assert.equal(output.metadata.overlayExcluded, true);
  assert.deepEqual(harness.captureInputs.map((input) => ({
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    windowRef: input.windowRef,
    targetRef: input.targetRef,
    bounds: input.bounds,
    normalizedBounds: input.normalizedBounds,
  })), [{
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    windowRef: 'window:alpha',
    targetRef: 'window-target:alpha',
    bounds: { x: 100, y: 60, width: 200, height: 120 },
    normalizedBounds: { x: 0.125, y: 0.1, width: 0.25, height: 0.2 },
  }]);
});

test('desktop annotation overlay returns owned refs only and rejects raw screenshot payloads', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness();
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    captureIdFactory: () => 'capture-fixed',
    now: () => '2026-06-03T00:00:00.000Z',
  });
  beginSubmitReadySelection(controller);

  const output = asRecord(await controller.captureSelectionToRefs());
  assert.equal(
    output.annotationRef,
    'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed',
  );
  assert.equal(
    output.screenshotRef,
    'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed',
  );
  assert.equal(
    output.cropRef,
    'desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-fixed',
  );
  assert.equal(
    output.imageRef,
    'desktop-annotation:workspace/workspace-a/session/session-a/image/capture-fixed',
  );
  assert.deepEqual(output.owner, {
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    windowRef: 'window:alpha',
    targetRef: 'window-target:alpha',
  });
  assert.equal(output.sourceKind, 'window');
  assert.equal(output.coordinateSpace, 'window-local');
  assert.equal(output.threadId, 'thread-1');
  assert.equal(output.messageDraftId, 'draft-1');
  assertNoRawImagePayload(output);

  const rawHarness = createOverlayHarness({
    captureResult: {
      screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/raw',
      cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/raw',
      dataUrl: 'data:image/png;base64,AAAA',
    },
  });
  const rawController = createDesktopAnnotationOverlayController(rawHarness.deps);
  beginSubmitReadySelection(rawController);
  await assert.rejects(() => rawController.captureSelectionToRefs(), /raw screenshot payload/i);
});

async function loadControllerFactory(): Promise<ControllerFactory> {
  const desktop = await import('../../src/desktop/index.js') as Record<string, unknown>;
  const factory = desktop.createDesktopAnnotationOverlayController;
  assert.equal(typeof factory, 'function', 'src/desktop/index.js should export createDesktopAnnotationOverlayController');
  return factory as ControllerFactory;
}

function beginSubmitReadySelection(controller: ReturnType<ControllerFactory>): void {
  controller.beginSelection({
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    windowRef: 'window:alpha',
    targetRef: 'window-target:alpha',
    windowBounds: { x: 10, y: 20, width: 800, height: 600 },
  });
  controller.updateSelection({ bounds: { x: 110, y: 80, width: 200, height: 120 } });
  controller.submitComment({
    comment: 'Annotate this crop.',
    threadId: 'thread-1',
    messageDraftId: 'draft-1',
  });
}

function createOverlayHarness(options: { captureResult?: Record<string, unknown> } = {}): {
  deps: unknown;
  windows: FakeOverlayWindow[];
  captureInputs: Array<Record<string, unknown>>;
  captureObservations: Array<{ overlayVisible: boolean; ignoreMouseEvents: boolean }>;
} {
  const windows: FakeOverlayWindow[] = [];
  const captureInputs: Array<Record<string, unknown>> = [];
  const captureObservations: Array<{ overlayVisible: boolean; ignoreMouseEvents: boolean }> = [];
  const deps = {
    screen: {
      getPrimaryDisplay() {
        return {
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          scaleFactor: 2,
        };
      },
    },
    createBrowserWindow(windowOptions: Record<string, unknown>) {
      const window = new FakeOverlayWindow(windowOptions);
      windows.push(window);
      return window;
    },
    captureProvider: {
      async captureSelection(input: Record<string, unknown>) {
        captureInputs.push(input);
        const overlayWindow = windows[0];
        captureObservations.push({
          overlayVisible: overlayWindow?.visible ?? false,
          ignoreMouseEvents: overlayWindow?.ignoreMouseEvents ?? false,
        });
        return options.captureResult ?? {
          screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed',
          cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-fixed',
          imageRef: 'desktop-annotation:workspace/workspace-a/session/session-a/image/capture-fixed',
          hash: 'sha256:crop-fixed',
        };
      },
    },
  };
  return { deps, windows, captureInputs, captureObservations };
}

class FakeOverlayWindow {
  visible = false;
  ignoreMouseEvents = false;
  readonly calls: string[] = [];

  constructor(readonly options: Record<string, any>) {}

  show(): void {
    this.visible = true;
    this.calls.push('show');
  }

  hide(): void {
    this.visible = false;
    this.calls.push('hide');
  }

  isVisible(): boolean {
    return this.visible;
  }

  setAlwaysOnTop(flag: boolean, level?: string): void {
    this.calls.push(`setAlwaysOnTop:${flag}:${level ?? 'none'}`);
  }

  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void {
    this.ignoreMouseEvents = ignore;
    this.calls.push(`setIgnoreMouseEvents:${ignore}:${options?.forward ? 'forward' : 'none'}`);
  }

  setBounds(bounds: Bounds): void {
    this.calls.push(`setBounds:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`);
  }
}

function asRecord(value: unknown): Record<string, any> {
  assert.ok(value && typeof value === 'object');
  return value as Record<string, any>;
}

function assertNoRawImagePayload(value: unknown): void {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /data:image\//i);
  assert.doesNotMatch(text, /base64/i);
  assert.doesNotMatch(text, /rawScreenshot/i);
  assert.doesNotMatch(text, /screenshotBytes/i);
}

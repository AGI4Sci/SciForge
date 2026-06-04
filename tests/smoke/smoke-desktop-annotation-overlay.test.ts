import assert from 'node:assert/strict';
import test from 'node:test';
import { Script, createContext } from 'node:vm';

type Bounds = { x: number; y: number; width: number; height: number };
type ControllerFactory = (deps: unknown, options?: unknown) => {
  create(): unknown;
  show(): unknown;
  setClickThrough(enabled: boolean): unknown;
  beginSelection(input: unknown): unknown;
  updateSelection(input: unknown): unknown;
  submitComment(input: unknown): unknown;
  setActiveDisplay(input: unknown): unknown;
  setDragState(input: unknown): unknown;
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
  assert.equal(window.options.enableLargerThanScreen, true);
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

test('desktop annotation overlay loads the trusted screen-region renderer when preload is configured', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness({
    display: {
      id: 'display-left',
      bounds: { x: -1440, y: 0, width: 1440, height: 900 },
      scaleFactor: 2,
    },
  });
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    overlayPreloadPath: '/app/dist-desktop/src/desktop/annotation-overlay-preload.cjs',
  });

  controller.create();

  assert.equal(harness.windows.length, 1);
  const window = harness.windows[0];
  assert.ok(window);
  assert.equal(window.options.focusable, true);
  assert.equal(window.options.webPreferences.preload, '/app/dist-desktop/src/desktop/annotation-overlay-preload.cjs');
  assert.equal(window.loadedUrls.length, 1);
  assert.match(window.loadedUrls[0], /^data:text\/html;charset=utf-8,/);
  const html = decodeURIComponent(window.loadedUrls[0].replace(/^data:text\/html;charset=utf-8,/, ''));
  assert.match(html, /sciforgeAnnotationOverlay/);
  assert.match(html, /submitSelection/);
  assert.match(html, /"x":-1440/);
  assert.match(html, /"y":0/);
});

test('desktop annotation overlay creates one native overlay per connected display to cover the display union', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness({
    cursorPoint: { x: 720, y: 500 },
    displays: [
      {
        id: 'display-left',
        bounds: { x: -1280, y: 0, width: 1024, height: 768 },
        scaleFactor: 2,
      },
      {
        id: 'display-right',
        bounds: { x: 0, y: 160, width: 1440, height: 900 },
        scaleFactor: 1,
      },
    ],
  });
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    overlayPreloadPath: '/app/dist-desktop/src/desktop/annotation-overlay-preload.cjs',
  });

  controller.create();

  assert.equal(harness.windows.length, 2);
  assert.deepEqual(harness.windows.map((window) => window.options.bounds), [
    { x: -1280, y: 0, width: 1024, height: 768 },
    { x: 0, y: 160, width: 1440, height: 900 },
  ]);
  assert.ok(harness.windows[0]?.calls.includes('setBounds:-1280,0,1024,768'));
  assert.ok(harness.windows[1]?.calls.includes('setBounds:0,160,1440,900'));
  const html = harness.windows
    .map((window) => decodeURIComponent(window.loadedUrls[0].replace(/^data:text\/html;charset=utf-8,/, '')));
  assert.match(html[0] ?? '', /display-left/);
  assert.match(html[0] ?? '', /display-right/);
  assert.match(html[0] ?? '', /"windowDisplayId":"display-left"/);
  assert.match(html[1] ?? '', /"windowDisplayId":"display-right"/);
  assert.match(html.join('\n'), /active-display/);
});

test('desktop annotation overlay shows only the display under the cursor', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness({
    cursorPoint: { x: 720, y: 500 },
    displays: [
      {
        id: 'display-left',
        bounds: { x: -1280, y: 0, width: 1024, height: 768 },
        scaleFactor: 2,
      },
      {
        id: 'display-right',
        bounds: { x: 0, y: 160, width: 1440, height: 900 },
        scaleFactor: 1.25,
      },
    ],
  });
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    overlayPreloadPath: '/app/dist-desktop/src/desktop/annotation-overlay-preload.cjs',
  });

  controller.create();
  controller.show();

  assert.deepEqual(harness.windows.map((window) => window.visible), [false, true]);
  assert.equal(harness.windows[0]?.calls.includes('show'), false);
  assert.ok(harness.windows[1]?.calls.includes('show'));
  assert.equal(harness.windows[0]?.calls.includes('focus'), false);
  assert.ok(harness.windows[1]?.calls.includes('focus'));
  controller.cancel();
});

test('desktop annotation overlay switches the only visible overlay when the cursor changes displays', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness({
    cursorPoint: { x: -900, y: 300 },
    displays: [
      {
        id: 'display-left',
        bounds: { x: -1280, y: 0, width: 1024, height: 768 },
        scaleFactor: 2,
      },
      {
        id: 'display-right',
        bounds: { x: 0, y: 160, width: 1440, height: 900 },
        scaleFactor: 1.25,
      },
    ],
  });
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    overlayPreloadPath: '/app/dist-desktop/src/desktop/annotation-overlay-preload.cjs',
  });

  controller.create();
  controller.show();
  assert.deepEqual(harness.windows.map((window) => window.visible), [true, false]);

  harness.setCursorPoint({ x: -60, y: 20 });
  await wait(90);
  assert.deepEqual(harness.windows.map((window) => window.visible), [true, false]);

  harness.setCursorPoint({ x: 720, y: 500 });
  await wait(120);
  assert.deepEqual(harness.windows.map((window) => window.visible), [false, true]);
  assert.deepEqual(
    harness.windows[0]?.sentMessages.slice(-1)[0],
    {
      channel: 'desktop:annotation-overlay:active-display',
      value: {
        id: 'display-right',
        bounds: { x: 0, y: 160, width: 1440, height: 900 },
        scaleFactor: 1.25,
      },
    },
  );
  assert.ok(harness.windows[1]?.calls.includes('focus'));
  controller.cancel();
});

test('desktop annotation overlay keeps the locked display visible while dragging across screens', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness({
    cursorPoint: { x: -900, y: 300 },
    displays: [
      {
        id: 'display-left',
        bounds: { x: -1280, y: 0, width: 1024, height: 768 },
        scaleFactor: 2,
      },
      {
        id: 'display-right',
        bounds: { x: 0, y: 160, width: 1440, height: 900 },
        scaleFactor: 1.25,
      },
    ],
  });
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    overlayPreloadPath: '/app/dist-desktop/src/desktop/annotation-overlay-preload.cjs',
  });

  controller.create();
  controller.show();
  controller.setDragState({
    active: true,
    display: {
      id: 'display-left',
      bounds: { x: -1280, y: 0, width: 1024, height: 768 },
      scaleFactor: 2,
    },
  });
  assert.deepEqual(harness.windows.map((window) => window.visible), [true, false]);

  harness.setCursorPoint({ x: 720, y: 500 });
  await wait(120);
  assert.deepEqual(harness.windows.map((window) => window.visible), [true, false]);

  controller.setDragState({ active: false });
  await wait(120);
  assert.deepEqual(harness.windows.map((window) => window.visible), [false, true]);
  controller.cancel();
});

test('desktop annotation overlay sets per-display bounds before show and skips visible macOS reasserts', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness({
    cursorPoint: { x: 720, y: 450 },
    displays: [
      {
        id: 'display-left',
        bounds: { x: -1280, y: -900, width: 1280, height: 900 },
        scaleFactor: 1,
      },
      {
        id: 'display-main',
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        scaleFactor: 2,
      },
    ],
  });
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    overlayPreloadPath: '/app/dist-desktop/src/desktop/annotation-overlay-preload.cjs',
  });

  controller.create();
  controller.show();
  await new Promise((resolve) => setTimeout(resolve, 180));

  assert.equal(harness.windows.length, 2);
  for (const window of harness.windows) {
    const showIndex = window.calls.indexOf('show');
    if (window.visible) {
      assert.ok(showIndex > 0, 'visible overlay should set bounds before becoming visible');
      assert.ok(window.calls.slice(0, showIndex).some((call) => call.startsWith('setBounds:')));
    } else {
      assert.equal(showIndex, -1, 'inactive display overlay should stay hidden');
      assert.ok(window.calls.some((call) => call.startsWith('setBounds:')));
    }
    if (showIndex >= 0) {
      assert.deepEqual(
        window.calls.slice(showIndex + 1).filter((call) => call.startsWith('setBounds:')),
        [],
        'visible setBounds reasserts can drift transparent overlays on macOS mixed displays',
      );
    }
  }
});

test('desktop annotation overlay canonicalizes active display updates against current topology', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness({
    cursorPoint: { x: 720, y: 500 },
    displays: [
      {
        id: 'display-left',
        bounds: { x: -1280, y: 0, width: 1024, height: 768 },
        scaleFactor: 2,
      },
      {
        id: 'display-right',
        bounds: { x: 0, y: 160, width: 1440, height: 900 },
        scaleFactor: 1.25,
      },
    ],
  });
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    overlayPreloadPath: '/app/dist-desktop/src/desktop/annotation-overlay-preload.cjs',
  });

  controller.create();
  controller.show();
  controller.setActiveDisplay({
    display: {
      bounds: { x: 0, y: 160, width: 1440, height: 900 },
      scaleFactor: 1.25,
    },
  });

  assert.deepEqual(harness.windows.map((window) => window.sentMessages.slice(-1)), [
    [{
      channel: 'desktop:annotation-overlay:active-display',
      value: {
        id: 'display-right',
        bounds: { x: 0, y: 160, width: 1440, height: 900 },
        scaleFactor: 1.25,
      },
    }],
    [{
      channel: 'desktop:annotation-overlay:active-display',
      value: {
        id: 'display-right',
        bounds: { x: 0, y: 160, width: 1440, height: 900 },
        scaleFactor: 1.25,
      },
    }],
  ]);
  assert.ok(harness.windows[1]?.calls.includes('focus'));
  assert.equal(harness.windows[0]?.calls.includes('focus'), false);
  controller.cancel();
});

test('desktop annotation overlay renderer data URL is refs-only UI code without raw payload hooks', async () => {
  const desktop = await import('../../src/desktop/index.js') as Record<string, unknown>;
  const dataUrl = (desktop.desktopAnnotationOverlayRendererDataUrl as (html: string) => string)('<main>safe</main>');
  const htmlFactory = desktop.desktopAnnotationOverlayRendererHtml as (bounds: Bounds) => string;
  const html = htmlFactory({ x: 10, y: 20, width: 800, height: 600 });

  assert.match(dataUrl, /^data:text\/html;charset=utf-8,/);
  assert.equal(decodeURIComponent(dataUrl.replace(/^data:text\/html;charset=utf-8,/, '')), '<main>safe</main>');
  assert.match(html, /submitSelection/);
  assert.match(html, /cancelSelection/);
  assert.match(html, /screenRect/);
  assert.doesNotMatch(html, /screenshotBase64|rawWindowList|providerPayload|data:image/i);
});

test('desktop annotation overlay renderer supports keyboard submit, cancel, focus, and multiline comments', async () => {
  const desktop = await import('../../src/desktop/index.js') as Record<string, unknown>;
  const htmlFactory = desktop.desktopAnnotationOverlayRendererHtml as (
    bounds: Bounds,
    displays?: Array<Record<string, unknown>>,
  ) => string;
  const renderer = createRendererHarness(htmlFactory(
    { x: 0, y: 0, width: 1440, height: 900 },
    [{ id: 'display-main', bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }],
  ));

  renderer.dispatchKey('Enter', renderer.comment);
  assert.deepEqual(renderer.submittedSelections, []);

  renderer.dispatchPointer('pointerdown', 100, 100);
  renderer.dispatchPointer('pointermove', 260, 220);
  renderer.dispatchPointer('pointerup', 260, 220);
  assert.equal(renderer.document.activeElement, renderer.comment);

  renderer.dispatchKey('Enter', renderer.comment);
  assert.deepEqual(renderer.submittedSelections, []);
  assert.equal(renderer.document.activeElement, renderer.comment);

  renderer.comment.value = 'First line';
  renderer.dispatchKey('Enter', renderer.comment, { shiftKey: true });
  if (!renderer.lastKeyEvent?.defaultPrevented) renderer.comment.value += '\n';
  renderer.comment.value += 'Second line';
  assert.equal(renderer.comment.value, 'First line\nSecond line');
  assert.deepEqual(renderer.submittedSelections, []);

  renderer.dispatchKey('Enter', renderer.comment);
  assert.equal(renderer.submittedSelections.length, 1);
  assert.deepEqual(renderer.submittedSelections[0], {
    bounds: { x: 100, y: 100, width: 160, height: 120 },
    comment: 'First line\nSecond line',
    display: {
      id: 'display-main',
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      scaleFactor: 2,
    },
  });

  renderer.dispatchKey('Escape', renderer.body);
  assert.equal(renderer.cancelledSelections, 1);
});

test('desktop annotation overlay renderer tracks active display, retains it in gaps, and clips locked selections', async () => {
  const desktop = await import('../../src/desktop/index.js') as Record<string, unknown>;
  const htmlFactory = desktop.desktopAnnotationOverlayRendererHtml as (
    bounds: Bounds,
    displays?: Array<Record<string, unknown>>,
  ) => string;
  const renderer = createRendererHarness(htmlFactory(
    { x: -1280, y: 0, width: 2720, height: 1060 },
    [
      {
        id: 'display-left',
        bounds: { x: -1280, y: 0, width: 1024, height: 768 },
        scaleFactor: 2,
      },
      {
        id: 'display-right',
        bounds: { x: 0, y: 160, width: 1440, height: 900 },
        scaleFactor: 1.25,
      },
    ],
  ));

  renderer.dispatchPointer('pointermove', 200, 100);
  assert.equal(renderer.activeDisplay.dataset.displayId, 'display-left');
  assert.deepEqual(pickStyle(renderer.activeDisplay, ['display', 'left', 'top', 'width', 'height']), {
    display: 'block',
    left: '0px',
    top: '0px',
    width: '1024px',
    height: '768px',
  });

  renderer.dispatchPointer('pointermove', 1180, 80);
  assert.equal(renderer.activeDisplay.dataset.displayId, 'display-left');

  renderer.dispatchPointer('pointermove', 1380, 200);
  assert.equal(renderer.activeDisplay.dataset.displayId, 'display-right');

  renderer.dispatchPointer('pointerdown', 1380, 200);
  renderer.dispatchPointer('pointermove', 780, 100);
  assert.deepEqual(pickStyle(renderer.selection, ['display', 'left', 'top', 'width', 'height']), {
    display: 'block',
    left: '1280px',
    top: '160px',
    width: '100px',
    height: '40px',
  });
  renderer.dispatchPointer('pointerup', 780, 100);
  renderer.comment.value = 'Clip to the locked display.';
  renderer.dispatchKey('Enter', renderer.comment);

  assert.deepEqual(renderer.dragStates, [
    {
      active: true,
      display: {
        id: 'display-right',
        bounds: { x: 0, y: 160, width: 1440, height: 900 },
        scaleFactor: 1.25,
      },
    },
    {
      active: false,
      display: {
        id: 'display-right',
        bounds: { x: 0, y: 160, width: 1440, height: 900 },
        scaleFactor: 1.25,
      },
    },
  ]);
  assert.deepEqual(renderer.submittedSelections, [{
    bounds: { x: 0, y: 160, width: 100, height: 40 },
    comment: 'Clip to the locked display.',
    display: {
      id: 'display-right',
      bounds: { x: 0, y: 160, width: 1440, height: 900 },
      scaleFactor: 1.25,
    },
  }]);
});

test('desktop annotation overlay renderer anchors the comment panel inside the active display', async () => {
  const desktop = await import('../../src/desktop/index.js') as Record<string, unknown>;
  const htmlFactory = desktop.desktopAnnotationOverlayRendererHtml as (
    bounds: Bounds,
    displays?: Array<Record<string, unknown>>,
  ) => string;
  const renderer = createRendererHarness(htmlFactory(
    { x: -1840, y: -1440, width: 5120, height: 2422 },
    [
      {
        id: 'display-primary',
        bounds: { x: 0, y: 0, width: 1512, height: 982 },
        scaleFactor: 2,
      },
      {
        id: 'display-left-large',
        bounds: { x: -1840, y: -1440, width: 2560, height: 1440 },
        scaleFactor: 1,
      },
    ],
  ));

  assert.deepEqual(pickStyle(renderer.document.panel, ['left', 'top', 'width', 'bottom']), {
    left: '2596px',
    top: '2344px',
    width: '620px',
    bottom: '',
  });

  renderer.dispatchPointer('pointermove', 100, 100);
  assert.equal(renderer.activeDisplay.dataset.displayId, 'display-left-large');
  assert.equal(renderer.document.activeElement, renderer.comment);
  assert.deepEqual(pickStyle(renderer.document.panel, ['left', 'top', 'width', 'bottom']), {
    left: '1280px',
    top: '1362px',
    width: '620px',
    bottom: '',
  });
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

test('desktop annotation overlay hides the native overlay when cancelling selection', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness();
  const controller = createDesktopAnnotationOverlayController(harness.deps);

  controller.create();
  controller.show();
  controller.setClickThrough(false);
  controller.beginSelection({
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    targetRef: 'screen-region:workspace-a/session-a/region-1',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
  });

  const cancelled = asRecord(controller.cancel());
  const window = harness.windows[0];
  assert.ok(window);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(window.visible, false);
  assert.equal(window.ignoreMouseEvents, true);
  assert.deepEqual(window.calls.slice(-2), [
    'setIgnoreMouseEvents:true:forward',
    'hide',
  ]);
});

test('desktop annotation overlay locks screen-region capture metadata to the selected display', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness({
    display: {
      id: 'display-left',
      bounds: { x: -1280, y: 0, width: 1024, height: 768 },
      scaleFactor: 2,
    },
    displays: [
      {
        id: 'display-left',
        bounds: { x: -1280, y: 0, width: 1024, height: 768 },
        scaleFactor: 2,
      },
      {
        id: 'display-right',
        bounds: { x: 0, y: 160, width: 1440, height: 900 },
        scaleFactor: 1.25,
      },
    ],
  });
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    captureIdFactory: () => 'capture-fixed',
    now: () => '2026-06-04T00:00:00.000Z',
  });

  controller.beginSelection({
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    targetRef: 'screen-region:workspace-a/session-a/right-display-region',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
  });
  const selection = asRecord(controller.updateSelection({
    bounds: { x: -500, y: 100, width: 620, height: 120 },
    display: {
      id: 'display-right',
      bounds: { x: 0, y: 160, width: 1440, height: 900 },
      scaleFactor: 1.25,
    },
  }));
  assert.deepEqual(selection.screenBounds, { x: 0, y: 160, width: 120, height: 60 });
  assert.deepEqual(selection.bounds, { x: 0, y: 160, width: 120, height: 60 });
  assert.deepEqual(selection.display, {
    id: 'display-right',
    bounds: { x: 0, y: 160, width: 1440, height: 900 },
    scaleFactor: 1.25,
  });

  controller.submitComment({ comment: 'Right display only.' });
  const output = asRecord(await controller.captureSelectionToRefs());
  assert.deepEqual(harness.captureInputs.map((input) => ({
    displayId: input.displayId,
    screenId: input.screenId,
    scale: input.scale,
    display: input.display,
    screenBounds: input.screenBounds,
    bounds: input.bounds,
    normalizedBounds: input.normalizedBounds,
  })), [{
    displayId: 'display-right',
    screenId: 'display-right',
    scale: 1.25,
    display: {
      id: 'display-right',
      bounds: { x: 0, y: 160, width: 1440, height: 900 },
      scaleFactor: 1.25,
    },
    screenBounds: { x: 0, y: 160, width: 120, height: 60 },
    bounds: { x: 0, y: 160, width: 120, height: 60 },
    normalizedBounds: { x: 0, y: 0, width: 0.083333, height: 0.066667 },
  }]);
  assert.equal(output.metadata.displayId, 'display-right');
  assert.equal(output.metadata.screenId, 'display-right');
  assert.equal(output.metadata.scale, 1.25);
  assert.deepEqual(output.metadata.screenBounds, { x: 0, y: 160, width: 120, height: 60 });
  assert.deepEqual(output.metadata.windowBinding.screenBounds, { x: 0, y: 160, width: 120, height: 60 });
  assert.equal(output.metadata.windowBinding.displayId, 'display-right');
  assert.equal(output.metadata.windowBinding.screenId, 'display-right');
  assert.equal(output.metadata.windowBinding.scale, 1.25);
  assertNoRawImagePayload(output);
  assertNoRawProviderPayload(output);
});

test('desktop annotation overlay exits after capturing selected crop refs', async () => {
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
  assert.equal(window.visible, false);
  assert.equal(window.ignoreMouseEvents, true);
  assert.deepEqual(window.calls.slice(-2), [
    'setIgnoreMouseEvents:true:forward',
    'hide',
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
  assert.equal(output.metadata.refsOnly, true);
  assert.deepEqual(output.metadata.screenBounds, { x: 110, y: 80, width: 200, height: 120 });
  assert.deepEqual(output.metadata.windowBounds, { x: 10, y: 20, width: 800, height: 600 });
  assert.deepEqual(output.metadata.windowLocalBounds, { x: 100, y: 60, width: 200, height: 120 });
  assert.equal(output.metadata.hash, 'sha256:crop-fixed');
  assert.deepEqual(output.metadata.dimensions, { width: 200, height: 120 });
  assert.equal(output.metadata.width, 200);
  assert.equal(output.metadata.height, 120);
  assert.deepEqual(output.metadata.windowBinding, {
    status: 'manual-bound',
    reason: 'App window annotation was explicitly selected by the user.',
    windowRef: 'window:alpha',
    targetRef: 'window-target:alpha',
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    windowBounds: { x: 10, y: 20, width: 800, height: 600 },
    windowLocalBounds: { x: 100, y: 60, width: 200, height: 120 },
  });
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

  const rawMetadataHarness = createOverlayHarness({
    captureResult: {
      screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/metadata-raw',
      cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/metadata-raw',
      imageRef: 'desktop-annotation:workspace/workspace-a/session/session-a/image/metadata-raw',
      hash: 'sha256:metadata-raw',
      metadata: {
        refsOnly: true,
        screenshotBase64: 'SHOULD_NOT_LEAK_BASE64',
        providerPayload: { token: 'SHOULD_NOT_LEAK_TOKEN' },
        windowBindingCandidates: [{
          windowRef: 'desktop-window:candidate:safe',
          rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
          providerPayload: { html: '<secret-window-html>' },
          windowBounds: { x: 0, y: 0, width: 100, height: 100 },
        }],
      },
      diagnostics: [{
        code: 'desktop.annotation.raw-diagnostic',
        level: 'warning',
        screenshotBase64: 'DIAGNOSTIC_BASE64_SHOULD_NOT_LEAK',
        providerPayload: { token: 'DIAGNOSTIC_TOKEN_SHOULD_NOT_LEAK' },
      }],
    },
  });
  const rawMetadataController = createDesktopAnnotationOverlayController(rawMetadataHarness.deps);
  beginSubmitReadySelection(rawMetadataController);
  const sanitizedOutput = asRecord(await rawMetadataController.captureSelectionToRefs());
  assertNoRawImagePayload(sanitizedOutput);
  assertNoRawProviderPayload(sanitizedOutput);
});

test('desktop annotation overlay supports unbound screen-region selections without window bounds', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const bindingCandidates = Array.from({ length: 7 }, (_, index) => ({
    windowRef: `desktop-window:candidate:window-${index}`,
    confidence: 0.45 + index / 100,
    reason: 'low-confidence-overlap',
    windowBounds: { x: -120 + index, y: 40, width: 500, height: 320 },
    rawDom: `SECRET_WINDOW_DOM_${index}`,
  }));
  const harness = createOverlayHarness({
    display: {
      id: 'display:left-retina',
      bounds: { x: -1440, y: 0, width: 2880, height: 900 },
      scaleFactor: 2,
    },
    captureResult: {
      screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed',
      cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-fixed',
      imageRef: 'desktop-annotation:workspace/workspace-a/session/session-a/image/capture-fixed',
      hash: 'sha256:screen-region-fixed',
      metadata: {
        windowBinding: {
          status: 'unbound',
          reason: 'low-confidence',
          candidates: bindingCandidates,
        },
        windowBindingCandidates: bindingCandidates,
        diagnostics: [{
          code: 'desktop.screen-region-binding.low-confidence',
          message: 'No high confidence app window binding was available.',
        }],
        rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
      },
    },
  });
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    captureIdFactory: () => 'capture-fixed',
    now: () => '2026-06-04T00:00:00.000Z',
  });

  controller.beginSelection({
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    targetRef: 'screen-region:workspace-a/session-a/region-1',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
  });
  const selection = asRecord(controller.updateSelection({
    bounds: { x: -100, y: 50, width: 200, height: 100 },
  }));
  assert.equal(selection.windowRef, undefined);
  assert.equal(selection.windowBounds, undefined);
  assert.equal(selection.windowLocalBounds, undefined);
  assert.equal(selection.windowBinding, 'unbound');
  assert.equal(selection.sourceKind, 'screen-region');
  assert.equal(selection.coordinateSpace, 'screen-global');
  assert.equal(selection.targetRef, 'screen-region:workspace-a/session-a/region-1');
  assert.deepEqual(selection.screenBounds, { x: -100, y: 50, width: 200, height: 100 });
  assert.deepEqual(selection.bounds, { x: -100, y: 50, width: 200, height: 100 });
  assert.deepEqual(selection.normalizedBounds, {
    x: 0.465278,
    y: 0.055556,
    width: 0.069444,
    height: 0.111111,
  });
  assert.deepEqual(selection.display, {
    id: 'display:left-retina',
    bounds: { x: -1440, y: 0, width: 2880, height: 900 },
    scaleFactor: 2,
  });

  controller.submitComment({
    comment: 'This screen region is not tied to an app window.',
    threadId: 'thread-1',
    messageDraftId: 'draft-1',
  });
  const output = asRecord(await controller.captureSelectionToRefs());
  assert.equal(output.windowRef, undefined);
  assert.equal(output.windowBounds, undefined);
  assert.equal(output.windowLocalBounds, undefined);
  assert.equal(output.windowBinding, 'unbound');
  assert.equal(output.sourceKind, 'screen-region');
  assert.equal(output.coordinateSpace, 'screen-global');
  assert.deepEqual(output.screenBounds, { x: -100, y: 50, width: 200, height: 100 });
  assert.deepEqual(output.bounds, { x: -100, y: 50, width: 200, height: 100 });
  assert.deepEqual(output.display, {
    id: 'display:left-retina',
    bounds: { x: -1440, y: 0, width: 2880, height: 900 },
    scaleFactor: 2,
  });
  assert.deepEqual(output.owner, {
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    targetRef: 'screen-region:workspace-a/session-a/region-1',
  });
  assert.equal(output.metadata.windowBinding.status, 'unbound');
  assert.equal(output.metadata.windowBinding.reason, 'low-confidence');
  assert.equal(output.metadata.windowBinding.candidates.length, 5);
  assert.equal(output.metadata.windowBindingCandidates.length, 5);
  assert.match(JSON.stringify(output.metadata.diagnostics), /desktop\.screen-region-binding\.low-confidence/);
  assertNoRawProviderPayload(output);
  assertNoRawImagePayload(output);

  assert.deepEqual(harness.captureInputs.map((input) => ({
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    windowRef: input.windowRef,
    targetRef: input.targetRef,
    sourceKind: input.sourceKind,
    coordinateSpace: input.coordinateSpace,
    windowBounds: input.windowBounds,
    screenBounds: input.screenBounds,
    bounds: input.bounds,
    normalizedBounds: input.normalizedBounds,
    display: input.display,
  })), [{
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    windowRef: undefined,
    targetRef: 'screen-region:workspace-a/session-a/region-1',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    windowBounds: undefined,
    screenBounds: { x: -100, y: 50, width: 200, height: 100 },
    bounds: { x: -100, y: 50, width: 200, height: 100 },
    normalizedBounds: { x: 0.465278, y: 0.055556, width: 0.069444, height: 0.111111 },
    display: {
      id: 'display:left-retina',
      bounds: { x: -1440, y: 0, width: 2880, height: 900 },
      scaleFactor: 2,
    },
  }]);
});

test('desktop annotation overlay keeps app-window selections manually bound and clipped to the target window', async () => {
  const createDesktopAnnotationOverlayController = await loadControllerFactory();
  const harness = createOverlayHarness();
  const controller = createDesktopAnnotationOverlayController(harness.deps, {
    captureIdFactory: () => 'capture-fixed',
    now: () => '2026-06-04T00:00:00.000Z',
  });
  const windowBounds = { x: 10, y: 20, width: 800, height: 600 };

  assert.throws(
    () => controller.beginSelection({
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      sourceKind: 'window',
      targetRef: 'window-target:alpha',
    }),
    /windowRef and windowBounds/,
  );

  controller.beginSelection({
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    windowRef: 'window:alpha',
    targetRef: 'window-target:alpha',
    windowBounds,
    sourceKind: 'window',
    coordinateSpace: 'window-local',
  });
  const selection = asRecord(controller.updateSelection({
    bounds: { x: -20, y: 50, width: 200, height: 120 },
  }));
  assert.equal(selection.windowBinding, 'manual-bound');
  assert.equal(selection.coordinateSpace, 'window-local');
  assert.deepEqual(selection.windowBounds, windowBounds);
  assert.deepEqual(selection.screenBounds, { x: 10, y: 50, width: 170, height: 120 });
  assert.deepEqual(selection.bounds, { x: 0, y: 30, width: 170, height: 120 });
  assert.deepEqual(selection.windowLocalBounds, { x: 0, y: 30, width: 170, height: 120 });
  assert.deepEqual(selection.normalizedBounds, { x: 0, y: 0.05, width: 0.2125, height: 0.2 });

  controller.submitComment({
    comment: 'This app window crop must stay manually bound.',
    threadId: 'thread-1',
    messageDraftId: 'draft-1',
  });
  const output = asRecord(await controller.captureSelectionToRefs());
  assert.equal(output.windowBinding, 'manual-bound');
  assert.equal(output.windowRef, 'window:alpha');
  assert.equal(output.targetRef, 'window-target:alpha');
  assert.deepEqual(output.windowBounds, windowBounds);
  assert.deepEqual(output.windowLocalBounds, { x: 0, y: 30, width: 170, height: 120 });
  assert.deepEqual(output.bounds, { x: 0, y: 30, width: 170, height: 120 });
  assert.deepEqual(output.screenBounds, { x: 10, y: 50, width: 170, height: 120 });
  assert.equal(output.metadata.windowBinding.status, 'manual-bound');
  assert.equal(output.metadata.windowBinding.windowRef, 'window:alpha');
  assert.equal(output.metadata.windowBinding.targetRef, 'window-target:alpha');
  assert.deepEqual(output.metadata.windowBinding.windowBounds, windowBounds);
  assert.deepEqual(output.metadata.windowBinding.windowLocalBounds, { x: 0, y: 30, width: 170, height: 120 });
  assert.deepEqual(harness.captureInputs.map((input) => ({
    windowRef: input.windowRef,
    targetRef: input.targetRef,
    sourceKind: input.sourceKind,
    coordinateSpace: input.coordinateSpace,
    windowBounds: input.windowBounds,
    screenBounds: input.screenBounds,
    bounds: input.bounds,
    windowLocalBounds: input.windowLocalBounds,
  })), [{
    windowRef: 'window:alpha',
    targetRef: 'window-target:alpha',
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    windowBounds,
    screenBounds: { x: 10, y: 50, width: 170, height: 120 },
    bounds: { x: 0, y: 30, width: 170, height: 120 },
    windowLocalBounds: { x: 0, y: 30, width: 170, height: 120 },
  }]);
  assertNoRawImagePayload(output);
});

test('desktop annotation window capture provider maps window-capture privacy results into refs-only annotation refs', async () => {
  const desktop = await import('../../src/desktop/index.js') as Record<string, any>;
  assert.equal(typeof desktop.createDesktopAnnotationWindowCaptureProvider, 'function');

  const provider = desktop.createDesktopAnnotationWindowCaptureProvider({
    platform: 'darwin',
    screenId: 'display-1',
    scale: 2,
    providers: [{
      providerId: 'test-window-capture-provider',
      priority: 100,
      supportedPlatforms: ['darwin'],
      isAvailable: () => true,
      captureSelectedTarget: async () => ({
        captureRef: 'capture:test-window-capture-provider:window',
        imageRef: 'image:test-window-capture-provider:window',
        hash: 'sha256:' + 'a'.repeat(64),
        capturedAt: '2026-06-04T00:00:00.000Z',
      }),
    }],
  });

  const output = await provider.captureSelection(annotationCaptureInput());
  assert.equal(output.screenshotRef, 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed');
  assert.equal(output.cropRef, 'desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-fixed');
  assert.equal(output.imageRef, 'desktop-annotation:workspace/workspace-a/session/session-a/image/capture-fixed');
  assert.equal(output.hash, 'sha256:' + 'a'.repeat(64));
  assert.equal(output.capturedAt, '2026-06-04T00:00:00.000Z');
  assert.equal(output.metadata?.refsOnly, true);
  assert.equal(output.metadata?.status, 'captured');
  assert.equal(output.metadata?.screenId, 'display-1');
  assert.equal(output.metadata?.displayId, 'display-1');
  assert.equal(output.metadata?.scale, 2);
  assert.deepEqual(output.metadata?.screenBounds, { x: 110, y: 80, width: 200, height: 120 });
  assert.deepEqual(output.metadata?.windowBounds, { x: 10, y: 20, width: 800, height: 600 });
  assert.deepEqual(output.metadata?.windowLocalBounds, { x: 100, y: 60, width: 200, height: 120 });
  assert.deepEqual(output.metadata?.dimensions, { width: 200, height: 120 });
  assert.equal(output.metadata?.width, 200);
  assert.equal(output.metadata?.height, 120);
  assert.equal(output.metadata?.hash, 'sha256:' + 'a'.repeat(64));
  assert.deepEqual(output.metadata?.provenanceRefs, [
    'capture:desktop-window-capture:test-window-capture-provider:window',
    'image:desktop-window-capture:test-window-capture-provider:window',
  ]);
  assert.equal(output.metadata?.windowActionSessionRef, undefined);
  assert.equal(output.metadata?.windowActionSession, undefined);
  assert.deepEqual(output.metadata?.windowBinding, {
    status: 'manual-bound',
    reason: 'App window annotation was explicitly selected by the user.',
    windowRef: 'window:alpha',
    targetRef: 'window:alpha',
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    windowBounds: { x: 10, y: 20, width: 800, height: 600 },
    windowLocalBounds: { x: 100, y: 60, width: 200, height: 120 },
    displayId: 'display-1',
    screenId: 'display-1',
    scale: 2,
  });
  assert.equal(asRecord(output.metadata?.privacy).rawPayloadReturned, false);
  assertNoRawImagePayload(output);

  const blockedProvider = desktop.createDesktopAnnotationWindowCaptureProvider({
    platform: 'darwin',
    screenId: 'display-1',
    scale: 2,
    providers: [],
  });
  const blocked = await blockedProvider.captureSelection(annotationCaptureInput());
  assert.equal(blocked.screenshotRef, 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed');
  assert.equal(blocked.cropRef, 'desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-fixed');
  assert.equal(blocked.imageRef, 'desktop-annotation:workspace/workspace-a/session/session-a/image/capture-fixed');
  assert.equal(blocked.hash, undefined);
  assert.equal(blocked.metadata?.refsOnly, true);
  assert.equal(blocked.metadata?.status, 'blocked');
  assert.deepEqual(blocked.metadata?.windowBinding, {
    status: 'blocked',
    reason: 'Selected window capture could not be evaluated or captured.',
    windowRef: 'window:alpha',
    targetRef: 'window:alpha',
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    windowBounds: { x: 10, y: 20, width: 800, height: 600 },
    windowLocalBounds: { x: 100, y: 60, width: 200, height: 120 },
    displayId: 'display-1',
    screenId: 'display-1',
    scale: 2,
  });
  assert.deepEqual(blocked.metadata?.provenanceRefs, [
    'desktop-annotation:workspace/workspace-a/session/session-a/window-capture/blocked/capture-fixed',
    'desktop-annotation:workspace/workspace-a/session/session-a/window-capture/blocked/capture-fixed/diagnostics',
  ]);
  assert.deepEqual(asRecord(blocked.metadata?.privacy), {
    refsOnly: true,
    explicitSelectionRequired: true,
    explicitSelection: true,
    defaultAmbientCaptureBlocked: true,
    unrelatedRegionsIncluded: false,
    rawPayloadReturned: false,
    includedRefScope: 'selected-window-only',
  });
  assert.match(JSON.stringify(blocked.metadata?.diagnostics), /desktop\.window-capture\.provider-unavailable/);
  assertNoRawImagePayload(blocked);

  const region = await provider.captureSelection({
    ...annotationCaptureInput(),
    windowRef: undefined,
    targetRef: 'screen-region:selection-1',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    windowBounds: { x: 0, y: 0, width: 1440, height: 900 },
    screenBounds: { x: 320, y: 180, width: 360, height: 240 },
    bounds: { x: 320, y: 180, width: 360, height: 240 },
    normalizedBounds: { x: 0.222222, y: 0.2, width: 0.25, height: 0.266667 },
  });
  assert.equal(region.metadata?.windowActionSessionRef, undefined);
  assert.equal(region.metadata?.windowActionSession, undefined);
  assert.equal(region.metadata?.windowBinding.status, 'unbound');
  assert.equal(region.metadata?.windowBinding.reason, 'desktop-region');
  assert.equal(region.metadata?.windowBinding.windowRef, undefined);
  assert.deepEqual(region.metadata?.windowBinding.candidates, undefined);
  assert.equal(region.metadata?.windowBinding.targetRef, 'screen-region:selection-1');
  assert.equal(region.metadata?.windowBinding.sourceKind, 'screen-region');
  assert.equal(region.metadata?.windowBinding.coordinateSpace, 'screen-global');
  assert.deepEqual(region.metadata?.windowBinding.screenBounds, { x: 320, y: 180, width: 360, height: 240 });
  assert.equal(region.metadata?.windowBinding.displayId, 'display-1');
  assert.equal(region.metadata?.windowBinding.screenId, 'display-1');
  assert.equal(region.metadata?.windowBinding.scale, 2);
  assert.match(JSON.stringify(region.metadata?.windowBinding.diagnostics), /desktop\.screen-region-binding\.desktop-region/);
  assertNoRawImagePayload(region);

  const autoBoundCaptureSelections: Array<Record<string, any>> = [];
  const autoBoundProvider = desktop.createDesktopAnnotationWindowCaptureProvider({
    platform: 'darwin',
    screenId: 'display-1',
    scale: 2,
    providers: [{
      providerId: 'test-window-capture-provider',
      priority: 100,
      supportedPlatforms: ['darwin'],
      isAvailable: () => true,
      captureSelectedTarget: async (request: Record<string, unknown>) => {
        autoBoundCaptureSelections.push(asRecord(request.selection));
        return {
          captureRef: 'capture:test-window-capture-provider:auto-bound-region',
          imageRef: 'image:test-window-capture-provider:auto-bound-region',
          hash: 'sha256:' + 'b'.repeat(64),
          capturedAt: '2026-06-04T00:00:00.000Z',
        };
      },
    }],
    screenRegionBindingWindows: [{
      windowRef: 'desktop-window:app:plotter:window-7',
      appName: 'Plotter',
      bundleId: 'org.sciforge.plotter',
      pid: 777,
      title: 'Plotter - Figure 1',
      bounds: { x: 300, y: 100, width: 700, height: 500 },
      screenId: 'display-1',
      scale: 2,
      rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
    }],
  } as Record<string, unknown>);
  const autoBoundRegion = await autoBoundProvider.captureSelection({
    ...annotationCaptureInput(),
    windowRef: undefined,
    targetRef: 'screen-region:selection-auto-bound',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    windowBounds: { x: 0, y: 0, width: 1440, height: 900 },
    screenBounds: { x: 320, y: 180, width: 360, height: 240 },
    bounds: { x: 320, y: 180, width: 360, height: 240 },
    normalizedBounds: { x: 0.222222, y: 0.2, width: 0.25, height: 0.266667 },
  });
  assert.equal(autoBoundRegion.metadata?.windowBinding.status, 'auto-bound');
  assert.equal(autoBoundRegion.metadata?.windowBinding.windowRef, 'desktop-window:app:plotter:window-7');
  assert.equal(autoBoundRegion.metadata?.windowBinding.appName, 'Plotter');
  assert.equal(autoBoundRegion.metadata?.windowBinding.bundleId, 'org.sciforge.plotter');
  assert.equal(autoBoundRegion.metadata?.windowBinding.pid, 777);
  assert.equal(autoBoundRegion.metadata?.windowBinding.title, 'Plotter - Figure 1');
  assert.deepEqual(autoBoundRegion.metadata?.windowBinding.windowBounds, { x: 300, y: 100, width: 700, height: 500 });
  assert.deepEqual(autoBoundRegion.metadata?.windowBinding.windowLocalBounds, { x: 20, y: 80, width: 360, height: 240 });
  assert.equal(autoBoundRegion.metadata?.windowRef, 'desktop-window:app:plotter:window-7');
  assert.deepEqual(autoBoundRegion.metadata?.windowBounds, { x: 300, y: 100, width: 700, height: 500 });
  assert.deepEqual(autoBoundRegion.metadata?.windowLocalBounds, { x: 20, y: 80, width: 360, height: 240 });
  assert.deepEqual(autoBoundCaptureSelections.map((selection) => ({
    kind: selection.kind,
    regionRef: selection.regionRef,
    windowRef: selection.windowRef,
    bounds: selection.bounds,
  })), [{
    kind: 'region',
    regionRef: 'screen-region:selection-auto-bound',
    windowRef: undefined,
    bounds: { x: 320, y: 180, width: 360, height: 240 },
  }]);
  assertNoRawImagePayload(autoBoundRegion);
  assertNoRawProviderPayload(autoBoundRegion);

  const seventyPercentProvider = desktop.createDesktopAnnotationWindowCaptureProvider({
    platform: 'darwin',
    screenId: 'display-1',
    scale: 2,
    providers: [{
      providerId: 'test-window-capture-provider',
      priority: 100,
      supportedPlatforms: ['darwin'],
      isAvailable: () => true,
      captureSelectedTarget: async () => ({
        captureRef: 'capture:test-window-capture-provider:seventy-five-percent-region',
        imageRef: 'image:test-window-capture-provider:seventy-five-percent-region',
        hash: 'sha256:' + 'e'.repeat(64),
        capturedAt: '2026-06-04T00:00:00.000Z',
      }),
    }],
    screenRegionBindingWindows: [{
      windowRef: 'desktop-window:app:wide-plotter:window-8',
      appName: 'Wide Plotter',
      bounds: { x: 50, y: 100, width: 200, height: 100 },
      screenId: 'display-1',
      scale: 2,
    }],
  } as Record<string, unknown>);
  const seventyFivePercentRegion = await seventyPercentProvider.captureSelection({
    ...annotationCaptureInput(),
    windowRef: undefined,
    targetRef: 'screen-region:selection-seventy-five-percent',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    windowBounds: { x: 0, y: 0, width: 1440, height: 900 },
    screenBounds: { x: 100, y: 100, width: 200, height: 100 },
    bounds: { x: 100, y: 100, width: 200, height: 100 },
    normalizedBounds: { x: 0.069444, y: 0.111111, width: 0.138889, height: 0.111111 },
  });
  assert.equal(seventyFivePercentRegion.metadata?.windowBinding.status, 'auto-bound');
  assert.equal(seventyFivePercentRegion.metadata?.windowBinding.windowRef, 'desktop-window:app:wide-plotter:window-8');
  assert.equal(seventyFivePercentRegion.metadata?.windowBinding.confidence, 0.75);
  assert.deepEqual(seventyFivePercentRegion.metadata?.windowBinding.windowLocalBounds, { x: 50, y: 0, width: 200, height: 100 });
  assertNoRawImagePayload(seventyFivePercentRegion);
  assertNoRawProviderPayload(seventyFivePercentRegion);

  const lowConfidenceProvider = desktop.createDesktopAnnotationWindowCaptureProvider({
    platform: 'darwin',
    screenId: 'display-1',
    scale: 2,
    providers: [{
      providerId: 'test-window-capture-provider',
      priority: 100,
      supportedPlatforms: ['darwin'],
      isAvailable: () => true,
      captureSelectedTarget: async () => ({
        captureRef: 'capture:test-window-capture-provider:low-confidence-region',
        imageRef: 'image:test-window-capture-provider:low-confidence-region',
        hash: 'sha256:' + 'c'.repeat(64),
        capturedAt: '2026-06-04T00:00:00.000Z',
      }),
    }],
    screenRegionBindingWindows: Array.from({ length: 8 }, (_, index) => ({
      windowRef: `desktop-window:low-confidence:window-${index}`,
      appName: `Candidate ${index}`,
      bounds: { x: 190 + index, y: 140, width: 60, height: 50 },
      screenId: 'display-1',
      scale: 2,
      rawDom: `SECRET_WINDOW_DOM_${index}`,
    })),
  } as Record<string, unknown>);
  const lowConfidenceRegion = await lowConfidenceProvider.captureSelection({
    ...annotationCaptureInput(),
    windowRef: undefined,
    targetRef: 'screen-region:selection-low-confidence',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    windowBounds: { x: 0, y: 0, width: 1440, height: 900 },
    screenBounds: { x: 100, y: 100, width: 200, height: 120 },
    bounds: { x: 100, y: 100, width: 200, height: 120 },
    normalizedBounds: { x: 0.069444, y: 0.111111, width: 0.138889, height: 0.133333 },
  });
  assert.equal(lowConfidenceRegion.metadata?.windowBinding.status, 'unbound');
  assert.equal(lowConfidenceRegion.metadata?.windowBinding.reason, 'low-confidence');
  assert.equal(lowConfidenceRegion.metadata?.windowBinding.windowRef, undefined);
  assert.equal(lowConfidenceRegion.metadata?.windowRef, undefined);
  assert.equal(lowConfidenceRegion.metadata?.windowBinding.candidates.length, 5);
  assert.equal(lowConfidenceRegion.metadata?.windowBindingCandidates.length, 5);
  assert.ok(lowConfidenceRegion.metadata?.windowBinding.diagnostics.length <= 5);
  assert.match(JSON.stringify(lowConfidenceRegion.metadata?.windowBinding.diagnostics), /desktop\.screen-region-binding\.low-confidence/);
  assertNoRawImagePayload(lowConfidenceRegion);
  assertNoRawProviderPayload(lowConfidenceRegion);

  const permissionBlockedProvider = desktop.createDesktopAnnotationWindowCaptureProvider({
    platform: 'darwin',
    screenId: 'display-1',
    scale: 2,
    providers: [{
      providerId: 'test-window-capture-provider',
      priority: 100,
      supportedPlatforms: ['darwin'],
      isAvailable: () => true,
      captureSelectedTarget: async () => ({
        captureRef: 'capture:test-window-capture-provider:permission-blocked-region',
        imageRef: 'image:test-window-capture-provider:permission-blocked-region',
        hash: 'sha256:' + 'd'.repeat(64),
        capturedAt: '2026-06-04T00:00:00.000Z',
      }),
    }],
    screenRegionBindingPermissionStatus: 'denied',
    screenRegionBindingWindows: [{
      windowRef: 'desktop-window:secret:window',
      title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK',
      bounds: { x: 0, y: 0, width: 1000, height: 800 },
    }],
  } as Record<string, unknown>);
  const permissionBlockedRegion = await permissionBlockedProvider.captureSelection({
    ...annotationCaptureInput(),
    windowRef: undefined,
    targetRef: 'screen-region:selection-permission-blocked',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    windowBounds: { x: 0, y: 0, width: 1440, height: 900 },
    screenBounds: { x: 320, y: 180, width: 360, height: 240 },
    bounds: { x: 320, y: 180, width: 360, height: 240 },
    normalizedBounds: { x: 0.222222, y: 0.2, width: 0.25, height: 0.266667 },
  });
  assert.equal(permissionBlockedRegion.metadata?.windowBinding.status, 'blocked');
  assert.equal(permissionBlockedRegion.metadata?.windowBinding.reason, 'permission-failure');
  assert.equal(permissionBlockedRegion.metadata?.windowBinding.windowRef, undefined);
  assert.deepEqual(permissionBlockedRegion.metadata?.windowBinding.candidates, undefined);
  assert.deepEqual(permissionBlockedRegion.metadata?.windowBindingCandidates, undefined);
  assert.ok(permissionBlockedRegion.metadata?.windowBinding.diagnostics.length <= 5);
  assert.match(JSON.stringify(permissionBlockedRegion.metadata?.windowBinding.diagnostics), /desktop\.screen-region-binding\.permission-failure/);
  assertNoRawImagePayload(permissionBlockedRegion);
  assertNoRawProviderPayload(permissionBlockedRegion);
});

async function loadControllerFactory(): Promise<ControllerFactory> {
  const desktop = await import('../../src/desktop/index.js') as Record<string, unknown>;
  const factory = desktop.createDesktopAnnotationOverlayController;
  assert.equal(typeof factory, 'function', 'src/desktop/index.js should export createDesktopAnnotationOverlayController');
  return factory as ControllerFactory;
}

function annotationCaptureInput(): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.desktop.annotation-overlay.capture.v1',
    captureId: 'capture-fixed',
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    windowRef: 'window:alpha',
    targetRef: 'window-target:alpha',
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    windowBounds: { x: 10, y: 20, width: 800, height: 600 },
    screenBounds: { x: 110, y: 80, width: 200, height: 120 },
    bounds: { x: 100, y: 60, width: 200, height: 120 },
    normalizedBounds: { x: 0.125, y: 0.1, width: 0.25, height: 0.2 },
    overlayExclusion: {
      hidden: true,
      clickThrough: true,
    },
  };
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

function createOverlayHarness(options: {
  captureResult?: Record<string, unknown>;
  cursorPoint?: { x: number; y: number };
  display?: {
    id?: string | number;
    bounds: Bounds;
    scaleFactor?: number;
  };
  displays?: Array<{
    id?: string | number;
    bounds: Bounds;
    scaleFactor?: number;
  }>;
} = {}): {
  deps: unknown;
  windows: FakeOverlayWindow[];
  captureInputs: Array<Record<string, unknown>>;
  captureObservations: Array<{ overlayVisible: boolean; ignoreMouseEvents: boolean }>;
  setCursorPoint(point: { x: number; y: number }): void;
} {
  const windows: FakeOverlayWindow[] = [];
  const captureInputs: Array<Record<string, unknown>> = [];
  const captureObservations: Array<{ overlayVisible: boolean; ignoreMouseEvents: boolean }> = [];
  let cursorPoint = options.cursorPoint ?? { x: 0, y: 0 };
  const deps = {
    screen: {
      getPrimaryDisplay() {
        return options.display ?? {
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          scaleFactor: 2,
        };
      },
      getAllDisplays() {
        return options.displays ?? [options.display ?? {
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          scaleFactor: 2,
        }];
      },
      getCursorScreenPoint() {
        return cursorPoint;
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
          metadata: {
            dimensions: { width: 200, height: 120 },
          },
        };
      },
    },
  };
  return {
    deps,
    windows,
    captureInputs,
    captureObservations,
    setCursorPoint(point: { x: number; y: number }) {
      cursorPoint = point;
    },
  };
}

class FakeOverlayWindow {
  visible = false;
  ignoreMouseEvents = false;
  readonly calls: string[] = [];
  readonly loadedUrls: string[] = [];
  readonly sentMessages: Array<{ channel: string; value: unknown }> = [];
  readonly webContents = {
    send: (channel: string, value: unknown): void => {
      this.sentMessages.push({ channel, value });
      this.calls.push(`send:${channel}`);
    },
  };

  constructor(readonly options: Record<string, any>) {}

  show(): void {
    this.visible = true;
    this.calls.push('show');
  }

  loadURL(url: string): void {
    this.loadedUrls.push(url);
    this.calls.push(`loadURL:${url.slice(0, 32)}`);
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

  focus(): void {
    this.calls.push('focus');
  }
}

function asRecord(value: unknown): Record<string, any> {
  assert.ok(value && typeof value === 'object');
  return value as Record<string, any>;
}

function createRendererHarness(html: string): {
  body: FakeRendererElement;
  comment: FakeRendererElement;
  selection: FakeRendererElement;
  activeDisplay: FakeRendererElement;
  document: FakeRendererDocument;
  submittedSelections: Array<Record<string, unknown>>;
  cancelledSelections: number;
  dragStates: Array<Record<string, unknown>>;
  lastKeyEvent?: FakeRendererEvent;
  dispatchPointer(type: string, clientX: number, clientY: number, target?: FakeRendererElement): FakeRendererEvent;
  dispatchKey(key: string, target: FakeRendererElement, options?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): FakeRendererEvent;
} {
  const document = new FakeRendererDocument();
  const submittedSelections: Array<Record<string, unknown>> = [];
  const dragStates: Array<Record<string, unknown>> = [];
  let cancelledSelections = 0;
  const windowListeners = new Map<string, Array<(event: FakeRendererEvent) => void>>();
  const fakeWindow = {
    sciforgeAnnotationOverlay: {
      submitSelection(input: Record<string, unknown>) {
        submittedSelections.push(JSON.parse(JSON.stringify(input)));
      },
      cancelSelection() {
        cancelledSelections += 1;
      },
      setDragState(input: Record<string, unknown>) {
        dragStates.push(JSON.parse(JSON.stringify(input)));
      },
    },
    addEventListener(type: string, listener: (event: FakeRendererEvent) => void) {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]);
    },
    getSelection() {
      return { removeAllRanges() {} };
    },
  };
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, 'renderer HTML should include an inline script');
  new Script(script).runInContext(createContext({
    window: fakeWindow,
    document,
  }));

  let lastKeyEvent: FakeRendererEvent | undefined;
  function dispatchWindowEvent(type: string, event: FakeRendererEvent): FakeRendererEvent {
    event.type = type;
    for (const listener of windowListeners.get(type) ?? []) listener(event);
    return event;
  }
  return {
    body: document.body,
    comment: document.comment,
    selection: document.selection,
    activeDisplay: document.activeDisplay,
    document,
    submittedSelections,
    dragStates,
    get cancelledSelections() {
      return cancelledSelections;
    },
    get lastKeyEvent() {
      return lastKeyEvent;
    },
    dispatchPointer(type: string, clientX: number, clientY: number, target = document.body) {
      return dispatchWindowEvent(type, new FakeRendererEvent({
        button: 0,
        clientX,
        clientY,
        target,
      }));
    },
    dispatchKey(key: string, target: FakeRendererElement, options = {}) {
      lastKeyEvent = dispatchWindowEvent('keydown', new FakeRendererEvent({
        key,
        target,
        shiftKey: options.shiftKey === true,
        ctrlKey: options.ctrlKey === true,
        metaKey: options.metaKey === true,
      }));
      return lastKeyEvent;
    },
  };
}

function pickStyle(element: FakeRendererElement, keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, element.style[key]]));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeRendererDocument {
  readonly body = new FakeRendererElement('body');
  readonly selection = new FakeRendererElement('selection');
  readonly activeDisplay = new FakeRendererElement('active-display');
  readonly panel = new FakeRendererElement('panel');
  readonly comment = new FakeRendererElement('comment');
  readonly save = new FakeRendererElement('save');
  readonly cancel = new FakeRendererElement('cancel');
  activeElement: FakeRendererElement | undefined;
  private readonly elements = new Map<string, FakeRendererElement>();

  constructor() {
    for (const element of [
      this.selection,
      this.activeDisplay,
      this.panel,
      this.comment,
      this.save,
      this.cancel,
    ]) {
      this.elements.set(element.id, element);
      element.ownerDocument = this;
    }
    this.panel.children.push(this.comment, this.cancel, this.save);
    this.comment.parent = this.panel;
    this.cancel.parent = this.panel;
    this.save.parent = this.panel;
  }

  getElementById(id: string): FakeRendererElement | null {
    return this.elements.get(id) ?? null;
  }
}

class FakeRendererElement {
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly children: FakeRendererElement[] = [];
  readonly classList = {
    classes: new Set<string>(),
    add: (...classes: string[]) => classes.forEach((className) => this.classList.classes.add(className)),
    remove: (...classes: string[]) => classes.forEach((className) => this.classList.classes.delete(className)),
    contains: (className: string) => this.classList.classes.has(className),
  };
  ownerDocument: FakeRendererDocument | undefined;
  parent: FakeRendererElement | undefined;
  value = '';
  disabled = false;
  private readonly listeners = new Map<string, Array<(event: FakeRendererEvent) => void>>();

  constructor(readonly id: string) {}

  contains(target: unknown): boolean {
    if (target === this) return true;
    return this.children.some((child) => child.contains(target));
  }

  focus(): void {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  addEventListener(type: string, listener: (event: FakeRendererEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatchEvent(event: FakeRendererEvent): void {
    for (const listener of this.listeners.get(event.type ?? '') ?? []) listener(event);
  }
}

class FakeRendererEvent {
  type?: string;
  defaultPrevented = false;
  button: number;
  clientX: number;
  clientY: number;
  key: string;
  target: FakeRendererElement;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;

  constructor(input: {
    button?: number;
    clientX?: number;
    clientY?: number;
    key?: string;
    target: FakeRendererElement;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }) {
    this.button = input.button ?? 0;
    this.clientX = input.clientX ?? 0;
    this.clientY = input.clientY ?? 0;
    this.key = input.key ?? '';
    this.target = input.target;
    this.shiftKey = input.shiftKey === true;
    this.ctrlKey = input.ctrlKey === true;
    this.metaKey = input.metaKey === true;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

function assertNoRawImagePayload(value: unknown): void {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /data:image\//i);
  assert.doesNotMatch(text, /base64/i);
  assert.doesNotMatch(text, /rawScreenshot/i);
  assert.doesNotMatch(text, /screenshotBytes/i);
}

function assertNoRawProviderPayload(value: unknown): void {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /rawWindowList/i);
  assert.doesNotMatch(text, /SECRET_WINDOW/i);
  assert.doesNotMatch(text, /rawDom/i);
}

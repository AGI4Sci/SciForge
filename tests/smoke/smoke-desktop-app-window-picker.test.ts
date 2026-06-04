import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_CHANNEL,
  DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_SCHEMA,
  createDesktopAnnotationAppWindowChooser,
  desktopAnnotationAppWindowPickerRendererDataUrl,
  desktopAnnotationAppWindowPickerRendererHtml,
  type DesktopAnnotationAppWindowCandidate,
} from '../../src/desktop/index.js';

test('desktop app-window picker renderer lists sanitized refs-only candidates', () => {
  const html = desktopAnnotationAppWindowPickerRendererHtml({
    pickerId: 'picker-1',
    candidates: [{
      windowRef: 'desktop-window:macos-cg-window-id:101:pid:202',
      targetRef: 'desktop-window:macos-cg-window-id:101:pid:202',
      id: '101',
      windowBounds: { x: 80, y: 40, width: 900, height: 640 },
      windowSummary: {
        appName: 'Paper Reader',
        title: 'SECRET_WINDOW_TITLE_SHOULD_NOT_LEAK',
        pid: 202,
      },
      rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
      screenshotBase64: 'RAW_BASE64_SHOULD_NOT_LEAK',
      providerPayload: { token: 'RAW_PROVIDER_SHOULD_NOT_LEAK' },
    } as DesktopAnnotationAppWindowCandidate],
  });
  const dataUrl = desktopAnnotationAppWindowPickerRendererDataUrl('<main>safe</main>');

  assert.match(dataUrl, /^data:text\/html;charset=utf-8,/);
  assert.equal(decodeURIComponent(dataUrl.replace(/^data:text\/html;charset=utf-8,/, '')), '<main>safe</main>');
  assert.match(html, /sciforgeAppWindowPicker/);
  assert.match(html, /desktop-window:macos-cg-window-id:101:pid:202/);
  assert.match(html, /80, 40 · 900x640/);
  assertNoRawPayload(html);
});

test('desktop app-window chooser resolves a user-selected candidate through internal IPC', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const windows: FakePickerWindow[] = [];
  const chooser = createDesktopAnnotationAppWindowChooser({
    BrowserWindow: class extends FakePickerWindow {
      constructor(options: Record<string, unknown>) {
        super(options);
        windows.push(this);
      }
    },
    ipcMain: {
      handle(channel: string, listener: (...args: unknown[]) => unknown) {
        handlers.set(channel, listener);
      },
    },
  } as never, {
    preloadPath: '/app/dist-desktop/src/desktop/app-window-picker-preload.cjs',
    pickerIdFactory: () => 'picker-fixed',
  });
  const candidate: DesktopAnnotationAppWindowCandidate = {
    windowRef: 'desktop-window:macos-cg-window-id:101:pid:202',
    targetRef: 'desktop-window:macos-cg-window-id:101:pid:202',
    id: '101',
    windowBounds: { x: 80, y: 40, width: 900, height: 640 },
    windowSummary: {
      appName: 'Paper Reader',
      title: 'Figure 1',
      pid: 202,
    },
  };

  const pendingChoice = chooser({
    request: { refsOnly: true },
    candidates: [candidate],
    candidateRefs: [candidate.windowRef],
    refsOnly: true,
  });
  await Promise.resolve();
  assert.equal(windows.length, 1);
  assert.equal(windows[0].options.webPreferences.preload, '/app/dist-desktop/src/desktop/app-window-picker-preload.cjs');
  assert.equal(windows[0].shown, true);
  assert.equal(windows[0].focused, true);
  assert.equal(windows[0].loadedUrls.length, 1);
  const html = decodeURIComponent(windows[0].loadedUrls[0].replace(/^data:text\/html;charset=utf-8,/, ''));
  assert.match(html, /picker-fixed/);
  assert.match(html, /desktop-window:macos-cg-window-id:101:pid:202/);

  const handler = handlers.get(DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_CHANNEL);
  assert.equal(typeof handler, 'function');
  const internalResult = asRecord(await handler?.({}, {
    schemaVersion: DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_SCHEMA,
    event: 'app-window-selection-selected',
    pickerId: 'picker-fixed',
    windowRef: candidate.windowRef,
    rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
    screenshotBase64: 'RAW_SCREENSHOT_BASE64_SHOULD_NOT_LEAK',
  }));
  const choice = asRecord(await pendingChoice);

  assert.equal(internalResult.status, 'selected');
  assert.deepEqual(internalResult.refs, [candidate.windowRef]);
  assert.equal(choice.status, 'selected');
  assert.equal(choice.windowRef, candidate.windowRef);
  assert.equal(windows[0].closed, true);
  assertNoRawPayload(internalResult);
  assertNoRawPayload(choice);
});

test('desktop app-window picker preload sends only sanitized selection and cancel events', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'desktop', 'app-window-picker-preload.cjs'), 'utf8');
  const exposed: Record<string, Record<string, (input?: unknown) => Promise<unknown>>> = {};
  const invoked: Array<{ channel: string; payload: Record<string, unknown> }> = [];

  runInNewContext(source, {
    require(name: string) {
      assert.equal(name, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld(apiKey: string, api: Record<string, (input?: unknown) => Promise<unknown>>) {
            exposed[apiKey] = api;
          },
        },
        ipcRenderer: {
          async invoke(channel: string, payload: Record<string, unknown>) {
            invoked.push({ channel, payload });
            return { ok: true };
          },
        },
      };
    },
  });

  const api = exposed.sciforgeAppWindowPicker;
  assert.equal(typeof api.chooseWindow, 'function');
  assert.equal(typeof api.cancel, 'function');
  await api.chooseWindow({
    pickerId: ' picker-1 ',
    windowRef: ' desktop-window:macos-cg-window-id:101:pid:202 ',
    rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
    screenshotBase64: 'RAW_SCREENSHOT_BASE64_SHOULD_NOT_LEAK',
    providerPayload: { token: 'RAW_PROVIDER_SHOULD_NOT_LEAK' },
  });
  await api.cancel({ pickerId: ' picker-1 ' });

  assert.deepEqual(jsonRoundTrip(invoked), [
    {
      channel: DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_CHANNEL,
      payload: {
        schemaVersion: DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_SCHEMA,
        event: 'app-window-selection-selected',
        pickerId: 'picker-1',
        windowRef: 'desktop-window:macos-cg-window-id:101:pid:202',
      },
    },
    {
      channel: DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_CHANNEL,
      payload: {
        schemaVersion: DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_SCHEMA,
        event: 'app-window-selection-cancelled',
        pickerId: 'picker-1',
      },
    },
  ]);
  assertNoRawPayload(invoked);
});

class FakePickerWindow {
  shown = false;
  focused = false;
  closed = false;
  readonly loadedUrls: string[] = [];
  readonly listeners = new Map<string, (...args: unknown[]) => void>();

  constructor(readonly options: Record<string, any>) {}

  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
  }

  show(): void {
    this.shown = true;
  }

  focus(): void {
    this.focused = true;
  }

  close(): void {
    this.closed = true;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.set(event, listener);
  }

  isDestroyed(): boolean {
    return this.closed;
  }
}

function asRecord(value: unknown): Record<string, any> {
  assert.ok(value && typeof value === 'object');
  return value as Record<string, any>;
}

function assertNoRawPayload(value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.doesNotMatch(text, /data:image/i);
  assert.doesNotMatch(text, /base64/i);
  assert.doesNotMatch(text, /rawWindowList/i);
  assert.doesNotMatch(text, /"providerPayload"\s*:/i);
  assert.doesNotMatch(text, /SECRET_WINDOW/i);
  assert.doesNotMatch(text, /RAW_SCREENSHOT/i);
  assert.doesNotMatch(text, /RAW_PROVIDER/i);
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  DESKTOP_ANNOTATION_OVERLAY_INTERNAL_EVENT_CHANNEL,
  DESKTOP_ANNOTATION_OVERLAY_INTERNAL_EVENT_SCHEMA,
  createTrustedDesktopAnnotationScreenRegionOverlayBridge,
} from '../../src/desktop/index.js';

test('desktop screen-region overlay bridge exposes the trusted production marker', () => {
  assert.deepEqual(createTrustedDesktopAnnotationScreenRegionOverlayBridge(), { trusted: true });
});

test('desktop screen-region overlay preload routes sanitized submit and cancel internal events', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'desktop', 'annotation-overlay-preload.cjs'), 'utf8');
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
            return { ok: true, channel };
          },
        },
      };
    },
  });

  const api = exposed.sciforgeAnnotationOverlay;
  assert.equal(typeof api?.submitSelection, 'function');
  assert.equal(typeof api?.cancelSelection, 'function');

  await api.submitSelection({
    bounds: { x: '120.4', y: 140.6, width: 240.2, height: 160.8 },
    comment: '  Please   inspect this region.  ',
    threadId: ' thread-1 ',
    messageDraftId: ' draft-1 ',
    rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
    screenshotBase64: 'RAW_SCREENSHOT_BASE64_SHOULD_NOT_LEAK',
    providerPayload: { token: 'RAW_PROVIDER_TOKEN_SHOULD_NOT_LEAK' },
  });
  await api.cancelSelection();

  assert.deepEqual(jsonRoundTrip(invoked), [
    {
      channel: DESKTOP_ANNOTATION_OVERLAY_INTERNAL_EVENT_CHANNEL,
      payload: {
        schemaVersion: DESKTOP_ANNOTATION_OVERLAY_INTERNAL_EVENT_SCHEMA,
        event: 'screen-region-selection-submitted',
        bounds: { x: 120, y: 141, width: 240, height: 161 },
        comment: 'Please inspect this region.',
        threadId: 'thread-1',
        messageDraftId: 'draft-1',
      },
    },
    {
      channel: DESKTOP_ANNOTATION_OVERLAY_INTERNAL_EVENT_CHANNEL,
      payload: {
        schemaVersion: DESKTOP_ANNOTATION_OVERLAY_INTERNAL_EVENT_SCHEMA,
        event: 'screen-region-selection-cancelled',
      },
    },
  ]);
  assertNoRawPayload(invoked);
});

test('desktop screen-region overlay preload rejects invalid bounds before IPC', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'desktop', 'annotation-overlay-preload.cjs'), 'utf8');
  const exposed: Record<string, Record<string, (input?: unknown) => Promise<unknown>>> = {};
  const invoked: unknown[] = [];

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
            return { ok: true, channel };
          },
        },
      };
    },
  });

  await assert.rejects(
    () => exposed.sciforgeAnnotationOverlay.submitSelection({
      bounds: { x: 0, y: 0, width: Number.NaN, height: 20 },
      comment: 'invalid',
    }),
    /valid bounds/,
  );
  assert.deepEqual(invoked, []);
});

function assertNoRawPayload(value: unknown): void {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /data:image/i);
  assert.doesNotMatch(text, /base64/i);
  assert.doesNotMatch(text, /rawWindowList/i);
  assert.doesNotMatch(text, /providerPayload/i);
  assert.doesNotMatch(text, /SECRET_WINDOW/i);
  assert.doesNotMatch(text, /RAW_SCREENSHOT/i);
  assert.doesNotMatch(text, /RAW_PROVIDER/i);
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { materializeFeedbackScreenshotRefs } from './workspace-file-api';

test('materializeFeedbackScreenshotRefs writes screenshot blobs and strips dataUrl from workspace state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-feedback-screenshot-'));
  try {
    const dataUrl = `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`;
    const next = await materializeFeedbackScreenshotRefs(root, {
      feedbackComments: [{
        id: 'feedback-1',
        schemaVersion: 1,
        screenshot: {
          schemaVersion: 1,
          dataUrl,
          mediaType: 'image/jpeg',
          width: 10,
          height: 8,
          capturedAt: '2026-05-24T00:00:00.000Z',
          targetRect: { x: 1, y: 2, width: 3, height: 4 },
        },
      }],
    });

    const comment = (next.feedbackComments as Array<Record<string, unknown>>)[0]!;
    const screenshot = comment.screenshot as Record<string, unknown>;
    const screenshotRef = String(comment.screenshotRef);
    const rel = screenshotRef.replace(/^file:/, '');

    assert.match(screenshotRef, /^file:\.sciforge\/feedback\/screenshots\/feedback-1-[a-f0-9]+\.jpg$/);
    assert.equal(screenshot.dataUrl, undefined);
    assert.equal(screenshot.screenshotRef, screenshotRef);
    assert.equal(screenshot.mediaType, 'image/jpeg');
    assert.equal(typeof screenshot.sha256, 'string');
    assert.equal(screenshot.bytes, Buffer.byteLength('jpeg-bytes'));
    assert.equal((await stat(join(root, rel))).isFile(), true);
    assert.equal(await readFile(join(root, rel), 'utf8'), 'jpeg-bytes');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

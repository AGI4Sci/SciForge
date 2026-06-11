import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { RuntimeInputObject } from './agent-cli-adapter.js';
import { preextractVisionDescriptors } from './vision-preextract.js';

const SERVICE_ENV = { SCIFORGE_VISION_SERVICE_URL: 'http://vision.test' };
// Small timeout so the abort test doesn't lean on the 30-min production safety net.
const FAST_TIMEOUT_ENV = { ...SERVICE_ENV, SCIFORGE_VISION_SERVICE_TIMEOUT_MS: '50' };

async function workspaceWithImage(ref: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-'));
  const target = join(workspace, ref);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // tiny PNG-ish bytes
  return workspace;
}

function imageObject(ref: string): RuntimeInputObject {
  return {
    schemaVersion: 'sciforge.runtime.input-object.v1',
    ref,
    source: 'explicit-reference',
    mimeType: 'image/png',
    title: 'uploaded chart',
    visionDescriptor: {
      schemaVersion: 'sciforge.runtime.input-object.vision-descriptor.v1',
      status: 'pending',
      source: 'upload-preextract',
    },
  };
}

function okFetch(summary: string): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    assert.ok(String(input).endsWith('/vision/translate'));
    const body = JSON.parse(String(init?.body));
    assert.ok(body.image?.base64, 'image bytes must be forwarded as base64');
    assert.equal(body.image.mime, 'image/png');
    return new Response(JSON.stringify({ ok: true, data: { summary, model: 'Qwen3.7-Plus' } }), { status: 200 });
  }) as unknown as typeof fetch;
}

test('disabled without service url (no-op)', async () => {
  const objects = [imageObject('.sciforge/uploads/s/1-a.png')];
  const result = await preextractVisionDescriptors(objects, { workspacePath: '/tmp', env: {} });
  assert.equal(result, objects);
});

test('pending image descriptor becomes ready with the translation', async () => {
  const ref = '.sciforge/uploads/s/1-chart.png';
  const workspace = await workspaceWithImage(ref);
  const result = await preextractVisionDescriptors([imageObject(ref)], {
    workspacePath: workspace,
    instruction: 'what does this chart show?',
    env: SERVICE_ENV,
    fetchImpl: okFetch('A bar chart titled Q3 Revenue with three ascending bars.'),
  });

  const descriptor = result![0]!.visionDescriptor!;
  assert.equal(descriptor.status, 'ready');
  assert.match(descriptor.summary ?? '', /Q3 Revenue/);
  assert.equal(descriptor.source, 'upload-preextract');
});

test('already-ready descriptor is left untouched (no second call)', async () => {
  const ref = '.sciforge/uploads/s/1-chart.png';
  const workspace = await workspaceWithImage(ref);
  const object = imageObject(ref);
  object.visionDescriptor = {
    schemaVersion: 'sciforge.runtime.input-object.vision-descriptor.v1',
    status: 'ready',
    source: 'upload-preextract',
    summary: 'already described',
  };
  const failIfCalled = (async () => {
    throw new Error('vision service must not be called for a ready descriptor');
  }) as unknown as typeof fetch;
  const result = await preextractVisionDescriptors([object], {
    workspacePath: workspace,
    env: SERVICE_ENV,
    fetchImpl: failIfCalled,
  });
  assert.equal(result![0]!.visionDescriptor!.summary, 'already described');
});

test('every pending image is sent to the service (no inference is skipped/faked)', async () => {
  const refs = ['.sciforge/uploads/s/1-a.png', '.sciforge/uploads/s/2-b.jpg'];
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-'));
  for (const ref of refs) {
    const target = join(workspace, ref);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  const seen: string[] = [];
  const trackingFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    seen.push(body.objectId);
    return new Response(JSON.stringify({ ok: true, data: { summary: `desc of ${body.objectId}`, model: 'Qwen3.7-Plus' } }), { status: 200 });
  }) as unknown as typeof fetch;
  const objects = refs.map((ref) => ({ ...imageObject(ref), ref }));
  const result = await preextractVisionDescriptors(objects, {
    workspacePath: workspace,
    env: SERVICE_ENV,
    fetchImpl: trackingFetch,
  });
  assert.deepEqual(seen.sort(), refs.slice().sort(), 'the service was invoked for every image');
  assert.equal(result!.filter((o) => o.visionDescriptor?.status === 'ready').length, 2);
});

test('service failure marks the descriptor failed (no useful image fallback)', async () => {
  const ref = '.sciforge/uploads/s/1-chart.png';
  const workspace = await workspaceWithImage(ref);
  const errFetch = (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch;
  const result = await preextractVisionDescriptors([imageObject(ref)], {
    workspacePath: workspace,
    env: SERVICE_ENV,
    fetchImpl: errFetch,
  });
  assert.equal(result![0]!.visionDescriptor!.status, 'failed');
});

test('an aborted turn stops the call', async () => {
  const ref = '.sciforge/uploads/s/1-chart.png';
  const workspace = await workspaceWithImage(ref);
  const controller = new AbortController();
  const hangingFetch = (async (_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      // Never resolves; only the abort signal ends it (like a slow service the user cancels).
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    })) as unknown as typeof fetch;
  const promise = preextractVisionDescriptors([imageObject(ref)], {
    workspacePath: workspace,
    env: FAST_TIMEOUT_ENV,
    fetchImpl: hangingFetch,
    abortSignal: controller.signal,
  });
  controller.abort();
  const result = await promise;
  assert.equal(result![0]!.visionDescriptor!.status, 'failed');
});

test('non-image input objects are ignored', async () => {
  const pdf: RuntimeInputObject = {
    schemaVersion: 'sciforge.runtime.input-object.v1',
    ref: '.sciforge/uploads/s/2-paper.pdf',
    source: 'explicit-reference',
    mimeType: 'application/pdf',
  };
  const result = await preextractVisionDescriptors([pdf], {
    workspacePath: '/tmp',
    env: SERVICE_ENV,
    fetchImpl: okFetch('should not be used'),
  });
  assert.equal(result![0], pdf);
});

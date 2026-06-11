import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { createVisionRouterServer } from './server.js';
import type { QwenConfig } from './qwen.js';
import type { ServiceResult, VisionTranslation } from './types.js';

const qwen: QwenConfig = {
  baseUrl: 'http://provider.test/v1',
  apiKey: 'test-key',
  model: 'Qwen3.7-Plus',
  timeoutMs: 5_000,
  maxAttempts: 1,
  retryBaseMs: 1,
};

// A fake OpenAI-compatible chat/completions provider.
function stubFetch(reply: { status?: number; content?: unknown }): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    assert.ok(url.endsWith('/chat/completions'), `unexpected upstream url: ${url}`);
    const status = reply.status ?? 200;
    const payload = { choices: [{ message: { content: reply.content ?? 'A bar chart titled Q3 Revenue.' } }] };
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

async function withServer(
  fetchImpl: typeof fetch,
  run: (base: string) => Promise<void>,
  cfg: QwenConfig = qwen,
): Promise<void> {
  const server = createVisionRouterServer({ qwen: cfg, fetchImpl });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('health and version respond', async () => {
  await withServer(stubFetch({}), async (base) => {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);
    const version = await (await fetch(`${base}/version`)).json();
    assert.equal(version.service, 'sciforge.vision-router');
    assert.equal(version.model, 'Qwen3.7-Plus');
  });
});

test('translate returns a template ServiceResult with the description', async () => {
  await withServer(stubFetch({ content: 'A bar chart titled Q3 Revenue with three bars.' }), async (base) => {
    const res = await fetch(`${base}/vision/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instruction: 'what does this show?', image: { base64: 'AAAA', mime: 'image/png' } }),
    });
    assert.equal(res.status, 200);
    const result = (await res.json()) as ServiceResult<VisionTranslation>;
    assert.ok(result.ok);
    assert.match(result.data.summary, /bar chart titled Q3 Revenue/);
    assert.equal(result.data.model, 'Qwen3.7-Plus');
    assert.equal(result.provenance?.serviceId, 'sciforge.vision-router');
    assert.equal(result.provenance?.operation, 'vision_translate');
  });
});

test('missing image is rejected with INVALID_ARGUMENT', async () => {
  await withServer(stubFetch({}), async (base) => {
    const res = await fetch(`${base}/vision/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instruction: 'no image here' }),
    });
    assert.equal(res.status, 400);
    const result = (await res.json()) as ServiceResult<never>;
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error.code, 'INVALID_ARGUMENT');
  });
});

test('upstream auth failure maps to UNAUTHENTICATED', async () => {
  await withServer(stubFetch({ status: 401 }), async (base) => {
    const res = await fetch(`${base}/vision/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: { url: 'https://example.test/x.png' } }),
    });
    assert.equal(res.status, 502);
    const result = (await res.json()) as ServiceResult<never>;
    assert.equal(result.ok === false && result.error.code, 'UNAUTHENTICATED');
  });
});

// A stateful provider that fails the first `failures` calls with `status`, then succeeds.
function flakyFetch(failures: number, status: number): { fetch: typeof fetch; calls: () => number } {
  let calls = 0;
  const impl = (async () => {
    calls++;
    if (calls <= failures) return new Response('upstream busy', { status });
    const payload = { choices: [{ message: { content: 'A bar chart titled Q3 Revenue.' } }] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls: () => calls };
}

test('retries transient 5xx then succeeds (service owns robustness)', async () => {
  const flaky = flakyFetch(2, 503);
  await withServer(flaky.fetch, async (base) => {
    const res = await fetch(`${base}/vision/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: { base64: 'AAAA', mime: 'image/png' } }),
    });
    assert.equal(res.status, 200);
    const result = (await res.json()) as ServiceResult<VisionTranslation>;
    assert.ok(result.ok && /Q3 Revenue/.test(result.data.summary));
  }, { ...qwen, maxAttempts: 4, retryBaseMs: 1 });
  assert.equal(flaky.calls(), 3, 'retried twice, succeeded on the third attempt');
});

test('does NOT retry auth failures (non-retryable)', async () => {
  const flaky = flakyFetch(99, 403);
  await withServer(flaky.fetch, async (base) => {
    const res = await fetch(`${base}/vision/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: { base64: 'AAAA', mime: 'image/png' } }),
    });
    assert.equal(res.status, 502);
  }, { ...qwen, maxAttempts: 5, retryBaseMs: 1 });
  assert.equal(flaky.calls(), 1, 'auth failure is not retried');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolClient } from '../../../contracts/tool-worker/src/index';
import { startWebWorkerServer } from './server';
import { createWebWorker } from './worker';

test('web worker manifest exposes web_search and web_fetch', () => {
  const worker = createWebWorker();
  assert.deepEqual(
    worker.manifest.tools.map((tool) => tool.id),
    ['web_search', 'web_fetch'],
  );
});

test('web worker validates unknown tools through invoke', async () => {
  const response = await createWebWorker().invoke({ toolId: 'missing', input: {} });
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'tool_not_found');
  }
});

test('web worker can be served through the protocol SDK', async () => {
  const server = await startWebWorkerServer();
  try {
    const client = createToolClient(server.url);
    assert.equal((await client.manifest()).workerId, 'sciforge.web-worker');
    assert.equal((await client.health()).status, 'ok');
  } finally {
    await server.close();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolClient, startToolWorkerServer } from './index';
import type { ToolWorker } from './types';

test('serves manifest, health, and invoke over HTTP', async () => {
  const worker: ToolWorker = {
    manifest: {
      protocolVersion: 'sciforge.tools.v1',
      workerId: 'test-worker',
      workerVersion: '0.1.0',
      description: 'Test worker',
      tools: [
        {
          id: 'echo',
          name: 'Echo',
          version: '0.1.0',
          description: 'Echo input',
          inputSchema: { text: { type: 'string', required: true } },
          sideEffects: ['none'],
        },
      ],
    },
    health() {
      return { status: 'ok', checkedAt: new Date().toISOString() };
    },
    invoke(request) {
      return { ok: true, requestId: request.requestId, output: request.input };
    },
  };

  const server = await startToolWorkerServer(worker);
  try {
    const client = createToolClient(server.url);
    assert.equal((await client.manifest()).workerId, 'test-worker');
    assert.equal((await client.health()).status, 'ok');
    assert.deepEqual(await client.invoke({ toolId: 'echo', requestId: 'r1', input: { text: 'hello' } }), {
      ok: true,
      requestId: 'r1',
      output: { text: 'hello' },
    });
  } finally {
    await server.close();
  }
});

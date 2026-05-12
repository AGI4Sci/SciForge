import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

import { createDetachedStreamResponse } from '../../src/runtime/server/detached-stream';

let completed = false;
let signalAbortedAtCompletion: boolean | undefined;
let clientConnectedAtCompletion: boolean | undefined;
let finalWriteAccepted: boolean | undefined;

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/stream') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
    return;
  }

  const stream = createDetachedStreamResponse(res);
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  stream.write({ event: { type: 'background-initial-response', status: 'running' } });

  for (let attempt = 0; attempt < 20 && stream.clientConnected; attempt += 1) {
    await delay(10);
  }

  await delay(25);
  signalAbortedAtCompletion = stream.signal.aborted;
  clientConnectedAtCompletion = stream.clientConnected;
  finalWriteAccepted = stream.write({
    event: {
      type: 'background-finalization',
      status: 'completed',
      revision: 2,
    },
  });
  completed = true;
  stream.end();
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');

try {
  let firstChunk = '';
  await new Promise<void>((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: address.port,
      path: '/stream',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        firstChunk += chunk;
        if (firstChunk.includes('background-initial-response')) {
          res.destroy();
          resolve();
        }
      });
      res.on('error', () => resolve());
    });
    req.on('error', reject);
    req.end(JSON.stringify({ prompt: 'long task that outlives the foreground stream' }));
  });

  const deadline = Date.now() + 1_000;
  while (!completed && Date.now() < deadline) await delay(10);

  assert.match(firstChunk, /background-initial-response/);
  assert.equal(completed, true, 'runtime work completed after the client disconnected');
  assert.equal(signalAbortedAtCompletion, false, 'passive disconnect must not abort runtime work');
  assert.equal(clientConnectedAtCompletion, false, 'server observed the detached client before finalization');
  assert.equal(finalWriteAccepted, false, 'late stream writes are dropped instead of throwing after detach');

  console.log('[ok] background stream continuation survives passive frontend disconnect and drops late writes without aborting runtime work');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

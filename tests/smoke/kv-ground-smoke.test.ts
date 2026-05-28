import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('KV-Ground smoke CLI calls health and predict with an inline image and writes a redacted manifest', async () => {
  const requests: Array<{
    method?: string;
    url?: string;
    authorization?: string;
    body?: Record<string, unknown>;
  }> = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/kv-ground/health') {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
      });
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ok: true, model_dir: '/models/kv-ground' }));
      return;
    }

    if (request.url === '/kv-ground/predict/') {
      const body = JSON.parse(await requestBody(request)) as Record<string, unknown>;
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        coordinates: [101, 62],
        text: 'red target square',
        raw_text: "click(start_box='[101, 62]')",
        image_size: { width: 200, height: 120 },
      }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });
  await listenLocal(server);

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-kv-ground-smoke-'));
  try {
    const outPath = join(workspace, 'kv-ground-smoke.json');
    const endpoint = `http://kvuser-redact:kvpass-redact@127.0.0.1:${address.port}/kv-ground?token=kvtoken-redact&apiKey=kvapikey-redact#kvhash-redact`;

    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/kv-ground-smoke.ts',
      '--endpoint',
      endpoint,
      '--out',
      outPath,
      '--text',
      'red target square',
    ]);

    assert.match(stdout, /\[passed\] wrote sciforge\.kv-ground-smoke\.v1/);
    assert.deepEqual(requests.map((request) => [request.method, request.url]), [
      ['GET', '/kv-ground/health'],
      ['POST', '/kv-ground/predict/'],
    ]);
    assert.equal(requests[0]?.authorization, 'Basic a3Z1c2VyLXJlZGFjdDprdnBhc3MtcmVkYWN0');
    assert.equal(requests[1]?.authorization, 'Basic a3Z1c2VyLXJlZGFjdDprdnBhc3MtcmVkYWN0');
    const predictBody = requests[1]?.body ?? {};
    assert.equal(typeof predictBody.image_base64, 'string');
    assert.ok(String(predictBody.image_base64).length > 50);
    assert.equal(predictBody.image_mime_type, 'image/png');
    assert.equal(predictBody.text_prompt, 'red target square');
    assert.equal(predictBody.coordinate_space, 'window-local');

    const manifestText = await readFile(outPath, 'utf8');
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;
    assert.equal(manifest.schemaVersion, 'sciforge.kv-ground-smoke.v1');
    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.endpoint, `http://127.0.0.1:${address.port}/kv-ground`);
    assert.deepEqual((manifest.checks as Record<string, Record<string, unknown>>).health.ok, true);
    assert.deepEqual((manifest.checks as Record<string, Record<string, unknown>>).predict.coordinates, [101, 62]);

    const predictRequest = manifest.predictRequest as Record<string, unknown>;
    assert.equal(predictRequest.textPrompt, 'red target square');
    assert.equal(predictRequest.coordinateSpace, 'window-local');
    const requestImage = predictRequest.image as Record<string, unknown>;
    assert.equal(requestImage.inline, true);
    assert.equal(requestImage.source, 'default-inline-image');
    assert.equal(requestImage.mimeType, 'image/png');
    assert.equal(typeof requestImage.sha256, 'string');
    assert.equal(typeof requestImage.bytes, 'number');

    assert.doesNotMatch(manifestText, /kvuser-redact|kvpass-redact|kvtoken-redact|kvapikey-redact|kvhash-redact/);
    assert.doesNotMatch(stdout, /kvuser-redact|kvpass-redact|kvtoken-redact|kvapikey-redact|kvhash-redact/);
    assert.doesNotMatch(manifestText, /image_base64/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise());
    });
  }
});

async function listenLocal(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
}

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

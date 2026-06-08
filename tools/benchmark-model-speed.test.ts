import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

test('benchmark posts streaming responses requests to the Model Router env endpoint', async () => {
  const requests: Array<{ url: string; authorization?: string; body: Record<string, unknown> }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      requests.push({
        url: request.url ?? '',
        authorization: String(request.headers.authorization ?? ''),
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      });
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      response.write('event: response.output_text.delta\n');
      response.write('data: {"type":"response.output_text.delta","delta":"hello"}\n\n');
      response.write('event: response.completed\n');
      response.write('data: {"type":"response.completed","response":{"usage":{"output_tokens":1}}}\n\n');
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert.ok(typeof address === 'object' && address !== null && 'port' in address);
    const routerBaseUrl = `http://127.0.0.1:${address.port}/v1`;
    const result = await runNode([
      '--import',
      'tsx',
      'tools/benchmark-model-speed.ts',
      '--config',
      '.missing-model-router-benchmark-config.json',
      '--rounds',
      '1',
      '--max-tokens',
      '4',
      '--case',
      'router-env',
      '--prompt',
      'Say hi.',
    ], {
      SCIFORGE_MODEL_ROUTER_BASE_URL: routerBaseUrl,
      SCIFORGE_RUNTIME_API_KEY: 'runtime-router-secret',
      SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS: 'router-alias',
      SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE: 'router-profile',
      LLM_BASE_URL: 'http://127.0.0.1:1/v1',
      LLM_API_KEY: 'legacy-direct-secret',
      LLM_MODELS: 'legacy-direct-model',
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, '/v1/responses');
    assert.equal(requests[0]?.authorization, 'Bearer runtime-router-secret');
    assert.equal(requests[0]?.body.model, 'router-alias');
    assert.equal(requests[0]?.body.input, 'Say hi.');
    assert.equal(requests[0]?.body.stream, true);
    assert.deepEqual(requests[0]?.body.metadata, { profile: 'router-profile' });
    assert.doesNotMatch(JSON.stringify(requests[0]?.body), /legacy-direct-model|legacy-direct-secret/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

function runNode(args: string[], extraEnv: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`benchmark process timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 10_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

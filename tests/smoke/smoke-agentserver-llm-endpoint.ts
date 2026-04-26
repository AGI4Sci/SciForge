import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-agentserver-llm-endpoint-'));
const localConfig = JSON.parse(await readFile('config.local.json', 'utf8')) as { llm?: { provider?: string; baseUrl?: string; apiKey?: string; model?: string } };
let requestBody: Record<string, unknown> | undefined;

const server = createServer(async (req, res) => {
  if (req.url !== '/api/agent-server/runs' || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  requestBody = JSON.parse(await readBody(req));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-llm-endpoint-run',
        status: 'completed',
        output: {
          taskFiles: [{
            path: 'tasks/report.py',
            language: 'python',
            content: [
              'import json, sys',
              'json.dump({"message":"ok","confidence":0.8,"claimType":"evidence-summary","evidenceLevel":"mock","reasoningTrace":"mock","claims":[],"uiManifest":[],"executionUnits":[],"artifacts":[]}, open(sys.argv[2], "w"))',
            ].join('\n'),
          }],
          entrypoint: { language: 'python', path: 'tasks/report.py' },
          expectedArtifacts: [],
        },
      },
    },
  }));
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const nativeOnlyResult = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'native-only config should not override server fallback',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    modelProvider: 'native',
    llmEndpoint: { provider: 'native', apiKey: 'stale-key' },
    uiState: { forceAgentServerGeneration: true },
    artifacts: [],
  });
  assert.equal(nativeOnlyResult.message, 'ok');
  requestBody = undefined;

  await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: '帮我搜索arxiv论文并写报告',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    modelProvider: 'openai-compatible',
    modelName: 'qwen-test',
    llmEndpoint: {
      provider: 'openai-compatible',
      baseUrl: 'http://llm.example.test/v1',
      apiKey: 'test-secret',
      modelName: 'qwen-test',
    },
    uiState: { forceAgentServerGeneration: true },
    artifacts: [],
  });

  assert.ok(requestBody);
  const capturedRequest = requestBody as Record<string, unknown>;
  const runtime = isRecord(capturedRequest.runtime) ? capturedRequest.runtime : {};
  const endpoint = isRecord(runtime.llmEndpoint) ? runtime.llmEndpoint : {};
  assert.equal(runtime.modelProvider, localConfig.llm?.provider);
  assert.equal(runtime.modelName, localConfig.llm?.model);
  assert.equal(endpoint.provider, localConfig.llm?.provider);
  assert.equal(endpoint.baseUrl, localConfig.llm?.baseUrl?.replace(/\/+$/, ''));
  assert.equal(endpoint.apiKey, localConfig.llm?.apiKey);
  assert.equal(endpoint.modelName, localConfig.llm?.model);
  console.log('[ok] BioAgent forwards user-configured LLM endpoint to AgentServer runs');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function readBody(req: AsyncIterable<Buffer | string>) {
  return new Promise<string>(async (resolve) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    resolve(Buffer.concat(chunks).toString('utf8'));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

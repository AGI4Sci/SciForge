import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-agentserver-llm-endpoint-'));
const configLocalPath = 'config.local.json';
const originalConfigLocal = await readFile(configLocalPath, 'utf8').catch(() => '');
const localConfig = {
  llm: {
    provider: 'openai-compatible',
    baseUrl: 'http://llm.local.test/v1',
    apiKey: 'test-local-secret',
    model: 'qwen-local-test',
  },
};
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
  await writeFile(configLocalPath, JSON.stringify(localConfig, null, 2));
  const nativeOnlyResult = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'request native config should override local config and server fallback',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    modelProvider: 'native',
    modelName: 'native-request-model',
    llmEndpoint: {
      provider: 'native',
      baseUrl: 'http://native-request.example.test/v1',
      apiKey: 'native-request-secret',
      modelName: 'native-request-model',
    },
    uiState: { forceAgentServerGeneration: true },
    artifacts: [],
  });
  assert.equal(nativeOnlyResult.message, 'ok');
  assert.ok(requestBody);
  {
    const capturedRequest = requestBody as Record<string, unknown>;
    const runtime = isRecord(capturedRequest.runtime) ? capturedRequest.runtime : {};
    const endpoint = isRecord(runtime.llmEndpoint) ? runtime.llmEndpoint : {};
    assert.equal(runtime.backend, 'openteam_agent');
    assert.equal(runtime.modelProvider, 'native');
    assert.equal(runtime.modelName, 'native-request-model');
    assert.equal(endpoint.provider, 'native');
    assert.equal(endpoint.baseUrl, 'http://native-request.example.test/v1');
    assert.equal(endpoint.apiKey, 'native-request-secret');
    assert.equal(endpoint.modelName, 'native-request-model');
    assert.equal(isRecord(runtime.metadata) ? runtime.metadata.llmEndpointSource : undefined, 'request');
  }
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
  assert.equal(runtime.backend, 'openteam_agent');
  assert.equal(runtime.modelProvider, 'openai-compatible');
  assert.equal(runtime.modelName, 'qwen-test');
  assert.equal(endpoint.provider, 'openai-compatible');
  assert.equal(endpoint.baseUrl, 'http://llm.example.test/v1');
  assert.equal(endpoint.apiKey, 'test-secret');
  assert.equal(endpoint.modelName, 'qwen-test');
  assert.equal(isRecord(runtime.metadata) ? runtime.metadata.llmEndpointSource : undefined, 'request');

  requestBody = undefined;
  const explicitEmptyUserModelResult = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'explicit empty user model config must override non-empty local defaults',
    workspacePath: workspace,
    agentServerBaseUrl: 'http://127.0.0.1:18080',
    modelProvider: 'native',
    uiState: { forceAgentServerGeneration: true },
    artifacts: [],
  });
  assert.match(explicitEmptyUserModelResult.message, /User-side model configuration is required/i);
  assert.match(explicitEmptyUserModelResult.message, /will not fall back to AgentServer openteam\.json defaults/i);
  assert.equal(requestBody, undefined);

  await writeFile(configLocalPath, JSON.stringify({
    llm: { provider: 'native', baseUrl: '', apiKey: '', model: '' },
  }, null, 2));
  const missingUserModelResult = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'default local AgentServer must not silently use openteam defaults',
    workspacePath: workspace,
    agentServerBaseUrl: 'http://127.0.0.1:18080',
    modelProvider: 'native',
    uiState: { forceAgentServerGeneration: true },
    artifacts: [],
  });
  assert.match(missingUserModelResult.message, /User-side model configuration is required/i);
  assert.match(missingUserModelResult.message, /will not fall back to AgentServer openteam\.json defaults/i);
  const missingUnit = missingUserModelResult.executionUnits.find((unit) => isRecord(unit) && unit.status === 'repair-needed') as Record<string, unknown> | undefined;
  assert.ok(missingUnit);
  assert.ok((missingUnit.requiredInputs as string[] | undefined)?.includes('modelBaseUrl'));
  assert.ok((missingUnit.requiredInputs as string[] | undefined)?.includes('modelName'));
  assert.ok((missingUnit.recoverActions as string[] | undefined)?.some((action) => /fill Model Provider, Model Base URL, Model Name, and API Key/.test(action)));
  assert.match(String(missingUnit.nextStep), /Configure the user-side model endpoint/i);
  assert.equal(requestBody, undefined);
  console.log('[ok] BioAgent forwards request-selected LLM endpoint to AgentServer runs before local/server defaults');
} finally {
  if (originalConfigLocal) await writeFile(configLocalPath, originalConfigLocal);
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

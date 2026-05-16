import assert from 'node:assert/strict';

import { startScriptableAgentServerMock } from './scriptable-agentserver-mock.js';
import type { JsonRecord, ScriptableAgentServerToolPayload } from './types.js';

const payload: ScriptableAgentServerToolPayload = {
  message: 'scripted tool payload completed',
  confidence: 0.9,
  claimType: 'fact',
  evidenceLevel: 'mock-agentserver',
  claims: [],
  uiManifest: [],
  executionUnits: [{ id: 'EU-scripted', tool: 'agentserver.mock', status: 'done' }],
  artifacts: [],
};

const server = await startScriptableAgentServerMock({
  seed: 'scriptable-agentserver-mock-test',
  script: {
    runId: 'fixed-run',
    steps: [
      { kind: 'status', message: 'started' },
      { kind: 'usage', usage: { input: 10, output: 2, total: 12, provider: 'mock' } },
      { kind: 'contextWindow', state: { status: 'watch', contextWindowTokens: 12000, contextWindowLimit: 200000, contextWindowRatio: 0.06 } },
      { kind: 'textDelta', delta: '{"message":"streamed"}' },
      { kind: 'toolPayload', payload },
    ],
  },
});

try {
  const discovery = await fetchJson(`${server.baseUrl}/api/agent-server/tools/manifest`);
  assert.ok(Array.isArray(discovery.providers));
  assert.match(String(discovery.digest), /^sha256:/);

  const context = await fetchJson(`${server.baseUrl}/api/agent-server/agents/web-e2e/context`);
  assert.equal((context.data as JsonRecord).session && ((context.data as JsonRecord).session as JsonRecord).status, 'active');

  const compact = await fetchJson(`${server.baseUrl}/api/agent-server/agents/web-e2e/compact`, { method: 'POST', body: '{}' });
  assert.equal((compact.contextCompaction as JsonRecord).status, 'completed');

  const firstRun = await fetchRun(server.baseUrl, { prompt: 'same request' });
  const secondRun = await fetchRun(server.baseUrl, { prompt: 'same request' });
  assert.equal(firstRun.events[0]?.id, secondRun.events[0]?.id, 'fixed run script should emit deterministic event ids');
  assert.equal(firstRun.events[0]?.digest, secondRun.events[0]?.digest, 'fixed run script should emit deterministic event digests');
  assert.equal(firstRun.resultRun.status, 'completed');
  assert.deepEqual(((firstRun.resultRun.output as JsonRecord).toolPayload as JsonRecord).executionUnits, payload.executionUnits);

  server.setScript([{ kind: 'failure', message: 'scripted failure', code: 'mock-failure', recoverActions: ['retry with refs'] }]);
  const failed = await fetchRun(server.baseUrl, { prompt: 'fail' });
  assert.equal(failed.error, 'scripted failure');
  assert.equal(failed.resultRun.status, 'failed');

  server.setScript([{ kind: 'degraded', message: 'scripted degraded', reason: 'provider-empty', recoverActions: ['expand query'] }]);
  const degraded = await fetchRun(server.baseUrl, { prompt: 'degraded' });
  const degradedPayload = (degraded.resultRun.output as JsonRecord).toolPayload as JsonRecord;
  assert.match(JSON.stringify(degradedPayload), /degraded-result/);

  server.setScript([{ kind: 'backgroundCheckpoint', checkpointRefs: ['checkpoint:alpha', 'checkpoint:beta'] }]);
  const background = await fetchRun(server.baseUrl, { prompt: 'background' });
  const backgroundPayload = (background.resultRun.output as JsonRecord).toolPayload as JsonRecord;
  assert.match(JSON.stringify(backgroundPayload), /checkpoint:alpha/);

  assert.equal(server.requests.discovery.length, 1);
  assert.equal(server.requests.context.length, 1);
  assert.equal(server.requests.compact.length, 1);
  assert.equal(server.requests.runs.length, 5);
  console.log('[ok] scriptable AgentServer mock supports discovery/context/compact/run stream scripts with deterministic event ids');
} finally {
  await server.close();
}

async function fetchJson(url: string, init?: RequestInit): Promise<JsonRecord> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  assert.equal(response.ok, true, `${url} should return 2xx`);
  return await response.json() as JsonRecord;
}

async function fetchRun(baseUrl: string, body: JsonRecord) {
  const response = await fetch(`${baseUrl}/api/agent-server/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true);
  const text = await response.text();
  const envelopes = text.trim().split('\n').map((line) => JSON.parse(line) as JsonRecord);
  const resultEnvelope = envelopes.find((envelope) => envelope.result) as JsonRecord | undefined;
  assert.ok(resultEnvelope, 'run stream should include a final result envelope');
  const result = resultEnvelope.result as JsonRecord;
  const data = result.data as JsonRecord;
  return {
    envelopes,
    events: envelopes.map((envelope) => envelope.event).filter(Boolean) as JsonRecord[],
    error: resultEnvelope.error ? String(resultEnvelope.error) : undefined,
    resultRun: data.run as JsonRecord,
  };
}

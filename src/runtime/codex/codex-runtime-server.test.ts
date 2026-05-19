import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { handleCodexRuntimeRoutes } from './codex-runtime-server.js';
import type { AgentCliAdapter, AgentCliStartTurnInput } from './agent-cli-adapter.js';
import type { NormalizedAgentEvent } from './codex-event-normalizer.js';

test('HTTP/SSE endpoint streams normalized runtime events without raw JSONL as main text', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'say hello',
        workspacePath: '/tmp/workspace',
        codexSessionId: '019e3e82-164d-79b2-a5d4-b16241620b10',
      }),
    });
    assert.equal(response.headers.get('content-type')?.startsWith('text/event-stream'), true);
    const text = await response.text();

    assert.match(text, /event: turn/);
    assert.match(text, /event: run_started/);
    assert.match(text, /event: message/);
    assert.match(text, /event: done/);
    assert.equal(adapter.lastInput?.commandText, 'say hello');
    assert.equal(adapter.lastInput?.workspacePath, '/tmp/workspace');
    assert.equal(adapter.lastInput?.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

class FakeAdapter implements AgentCliAdapter {
  lastInput?: AgentCliStartTurnInput;

  async startTurn(input: AgentCliStartTurnInput) {
    this.lastInput = input;
    return {
      turnId: 'codex-test-turn',
      codexSessionId: input.codexSessionId,
      events: this.events(),
    };
  }

  async cancel() {}

  private async *events(): AsyncIterable<NormalizedAgentEvent> {
    const base = {
      schemaVersion: 'sciforge.codex.normalized-event.v1' as const,
      timestamp: new Date().toISOString(),
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      profile: 'sciforge-runtime-deepseek',
      workspace: '/tmp/workspace',
      commandId: 'codex-test-turn',
    };
    yield { ...base, type: 'run_started', message: 'started' };
    yield { ...base, type: 'message', text: 'hello' };
    yield { ...base, type: 'done', status: 'done' };
  }
}

import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { handleCodexRuntimeRoutes } from './codex-runtime-server.js';
import type { AgentCliAdapter, AgentCliStartTurnInput } from './agent-cli-adapter.js';
import type { NormalizedAgentEvent } from './codex-event-normalizer.js';

test('Runtime Codex forwards Browser-like ordinary turns to upstream adapter', async () => {
  const adapter = new OwnerRoutingAdapter();
  const text = await postRuntimeTurn(adapter, {
    commandText: '搜索一下今天 arxiv 上 agentic rl 相关的文章',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-owner-browser',
    attemptId: 'codex-command-owner-browser-attempt-1',
    agentHostInput: readyAgentHostInput('搜索一下今天 arxiv 上 agentic rl 相关的文章'),
  });

  assert.equal(adapter.lastInput?.commandText, '搜索一下今天 arxiv 上 agentic rl 相关的文章');
  assert.match(text, /event: turn/);
  assert.match(text, /event: run_started/);
  assert.match(text, /event: done/);
  assert.doesNotMatch(text, /event: agent_host_turn_loop/);
  assert.doesNotMatch(text, /基于本轮 Browser bounded operation|module\.invoke|browser\.search_read/);
});

test('Runtime Codex forwards artifact requests to upstream adapter instead of creating local artifacts', async () => {
  const adapter = new OwnerRoutingAdapter();
  const text = await postRuntimeTurn(adapter, {
    commandText: '做一页 PPT，主题是 bounded operation contract',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-owner-artifact',
    attemptId: 'codex-command-owner-artifact-attempt-1',
    agentHostInput: readyAgentHostInput('做一页 PPT，主题是 bounded operation contract'),
  });

  assert.equal(adapter.lastInput?.commandText, '做一页 PPT，主题是 bounded operation contract');
  assert.match(text, /event: turn/);
  assert.match(text, /event: run_started/);
  assert.match(text, /event: done/);
  assert.doesNotMatch(text, /event: agent_host_turn_loop/);
  assert.doesNotMatch(text, /agent-host-artifact-generator|one-page-presentation\.pptx/);
});

async function postRuntimeTurn(adapter: AgentCliAdapter, body: Record<string, unknown>): Promise<string> {
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
      body: JSON.stringify(body),
    });
    return await response.text();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function readyAgentHostInput(intentText: string) {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'ui-normal-composer-transport',
    intentText,
    authorizationProfileId: 'high-autonomy',
    policyOwner: 'codex-agent-host-runtime',
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    target: {
      bound: true,
      summary: 'Current browser window',
      refs: ['browser-host-session:current'],
    },
    observation: {
      fresh: true,
      refs: ['browser-host-session:current/frame.png'],
    },
    permissions: {
      refs: ['permission:turn/gui-action'],
      scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
      stopCancelPath: true,
    },
  };
}

class OwnerRoutingAdapter implements AgentCliAdapter {
  lastInput?: AgentCliStartTurnInput;

  async startTurn(input: AgentCliStartTurnInput) {
    this.lastInput = input;
    return {
      turnId: input.commandId ?? 'codex-owner-routing-test-turn',
      attemptId: input.attemptId ?? 'codex-owner-routing-test-turn-attempt-1',
      codexSessionId: input.codexSessionId,
      events: this.events(input),
    };
  }

  async cancel() {}

  private async *events(input: AgentCliStartTurnInput): AsyncIterable<NormalizedAgentEvent> {
    const commandId = input.commandId ?? 'codex-owner-routing-test-turn';
    const attemptId = input.attemptId ?? 'codex-owner-routing-test-turn-attempt-1';
    const base = {
      schemaVersion: 'sciforge.codex.normalized-event.v1' as const,
      timestamp: new Date().toISOString(),
      provider: 'codex-app-server',
      model: 'app-server-native',
      profile: 'codex-app-server',
      workspace: input.workspacePath,
      commandId,
      attemptId,
      evidenceRefs: [`audit:codex-app-server:${commandId}:${attemptId}:normalized-events`],
    };
    yield { ...base, type: 'run_started', message: 'started' };
    yield { ...base, type: 'message', text: 'adapter-owned response' };
    yield { ...base, type: 'done', status: 'done' };
  }
}

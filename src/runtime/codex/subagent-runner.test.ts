import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AgentCliAdapter, AgentCliStartTurnInput, AgentCliTurn } from './agent-cli-adapter.js';
import type { NormalizedAgentEvent, NormalizedAgentEventType } from './codex-event-normalizer.js';
import { createAgentHostSubagentRunner } from './subagent-runner.js';

test('Agent Host sub-agent runner starts a bounded Runtime Codex child turn and collects safe refs', async () => {
  let started: AgentCliStartTurnInput | undefined;
  const adapter: AgentCliAdapter = {
    async startTurn(input) {
      started = input;
      return turn([
        event('message', {
          text: 'Reviewed safe refs. Provider URL https://provider.example/v1 and sk-secret-value stayed private.',
        }),
        event('tool_completed', {
          ref: 'artifact:subagent-result-abc123',
          transcriptRef: 'artifact:subagent-transcript-abc123',
          refs: [
            'file:PROJECT.md',
            'trace:unsafe',
            '/Applications/private/workspace/raw.json',
          ],
        }),
        event('done', { exitCode: 0, message: 'Runtime Codex completed successfully.' }),
      ]);
    },
    async cancel() {},
  };

  const result = await createAgentHostSubagentRunner({ adapter }).spawn({
    workspace: '/workspace/sciforge',
    prompt: 'Inspect PROJECT.md without exposing private transport details.',
    refs: ['file:PROJECT.md'],
    agentId: 'worker-abc123',
    parentAgentId: 'parent-command-1',
    agentType: 'worker',
    profile: 'sciforge-runtime-deepseek',
    codexCommand: 'codex',
    approvalPolicy: 'on-request',
    sandbox: 'read-only',
  });

  assert.equal(started?.workspacePath, '/workspace/sciforge');
  assert.equal(started?.commandId, 'subagent-parent-command-1-worker-abc123');
  assert.equal(started?.profile, 'sciforge-runtime-deepseek');
  assert.equal(started?.approvalPolicy, 'on-request');
  assert.equal(started?.sandbox, 'read-only');
  assert.deepEqual(started?.guiExtension, { enabled: false });
  assert.match(started?.commandText ?? '', /Agent Host ownership/);
  assert.match(started?.commandText ?? '', /file:PROJECT\.md/);
  assert.doesNotMatch(started?.commandText ?? '', /\/Applications|sk-secret/i);

  assert.equal(result.status, 'completed');
  assert.equal(result.exitCode, 0);
  assert.match(result.resultSummary, /Reviewed safe refs/);
  assert.doesNotMatch(result.resultSummary, /provider\.example|sk-secret|\/Applications/i);
  assert.deepEqual(result.inspectedRefs, [
    'artifact:subagent-result-abc123',
    'artifact:subagent-transcript-abc123',
    'file:PROJECT.md',
  ]);
});

test('Agent Host sub-agent runner fails closed when child execution is unavailable', async () => {
  const adapter: AgentCliAdapter = {
    async startTurn() {
      throw new Error('provider https://provider.example/v1 failed under /Applications/private workspace');
    },
    async cancel() {},
  };

  const result = await createAgentHostSubagentRunner({ adapter }).spawn({
    workspace: '/workspace/sciforge',
    prompt: 'Delegate verification.',
    refs: [],
    agentId: 'worker-abc123',
    parentAgentId: 'parent-command-1',
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.exitCode, null);
  assert.match(result.resultSummary, /Agent Host execution unavailable/);
  assert.doesNotMatch(result.resultSummary, /provider\.example|\/Applications/i);
  assert.deepEqual(result.inspectedRefs, []);
});

test('Agent Host sub-agent runner default path stays on app-server Agent Host adapter', () => {
  const source = readFileSync(new URL('./subagent-runner.ts', import.meta.url), 'utf8');

  assert.match(source, /createDefaultAgentHostSubagentAdapter/);
  assert.match(source, /CodexAppServerAdapter/);
  assert.match(source, /createCodexAppServerClient/);
  assert.doesNotMatch(source, /CodexExecJsonAdapter|codex-exec-json-adapter|exec --json/);
});

function turn(events: NormalizedAgentEvent[]): AgentCliTurn {
  return {
    turnId: 'turn-1',
    attemptId: 'attempt-1',
    events: (async function* () {
      for (const item of events) yield item;
    })(),
  };
}

function event(type: NormalizedAgentEventType, fields: Partial<NormalizedAgentEvent> = {}): NormalizedAgentEvent {
  return {
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type,
    timestamp: '2026-06-04T00:00:00.000Z',
    provider: 'public-provider',
    model: 'public-model',
    profile: 'sciforge-runtime-deepseek',
    workspace: '/workspace/sciforge',
    commandId: 'subagent-parent-command-1-worker-abc123',
    attemptId: 'attempt-1',
    ...fields,
  };
}

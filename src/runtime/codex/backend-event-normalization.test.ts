import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBackendEvents,
  redactBackendEventValue,
} from './backend-event-normalization.js';
import {
  normalizeCodexJsonlEvent,
  type CodexRuntimeMetadata,
} from './codex-event-normalizer.js';

const fixedNow = () => '2026-05-29T00:00:00.000Z';

test('normalizes Codex app-server delta, tool, approval, and done events into neutral events and trace', () => {
  const normalized = normalizeBackendEvents([
    {
      type: 'thread.created',
      thread_id: 'thread-1',
      provider: 'https://provider.example/v1?api_key=provider-secret-123456',
      model: 'private-model-name',
    },
    { type: 'turn.started', thread_id: 'thread-1', turn_id: 'turn-1' },
    { type: 'item.started', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'message-1', type: 'message', role: 'assistant' } },
    { type: 'response.output_text.delta', thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'message-1', delta: 'Working' },
    {
      type: 'tool.started',
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      item: {
        id: 'tool-1',
        name: 'module.invoke',
        input: {
          moduleId: 'browser',
          intent: 'open',
          input: { url: 'https://example.test/search?token=browser-secret-123456' },
        },
      },
    },
    {
      type: 'approval.requested',
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      approval: {
        id: 'approval-1',
        moduleId: 'browser',
        intent: 'open',
        reason: 'external navigation',
        url: 'https://example.test/approve?api_key=approval-secret-123456',
      },
    },
    {
      type: 'tool.completed',
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      item: {
        id: 'tool-1',
        name: 'module.invoke',
        input: { moduleId: 'browser', intent: 'open' },
        result: { ok: true, refs: ['browser:tab-1'], operationRef: 'operation:browser:1' },
      },
      durationMs: 12,
    },
    {
      type: 'operation.progress',
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      progress: { phase: 'execute', title: 'Opening tab', detail: 'Waiting for browser operation' },
      status: 'running',
    },
    { type: 'turn.done', thread_id: 'thread-1', turn_id: 'turn-1', status: 'done' },
  ], { backend: 'codex-app-server', now: fixedNow });

  assert.deepEqual(normalized.events.map((event) => event.type), [
    'thread_started',
    'turn_started',
    'item_started',
    'message_delta',
    'tool_started',
    'approval_requested',
    'tool_completed',
    'operation_progress',
    'done',
  ]);
  assert.equal(normalized.events[3]?.text, 'Working');
  assert.equal(normalized.events[7]?.status, 'running');
  assert.match(normalized.events[0]?.provider ?? '', /^\[redacted-provider:sha256:/);
  assert.match(normalized.events[0]?.model ?? '', /^\[redacted-model:sha256:/);

  const startedStep = normalized.traceSteps.find((step) => step.status === 'started');
  assert.equal(startedStep?.moduleId, 'browser');
  assert.equal(startedStep?.functionName, 'invoke');
  assert.equal(startedStep?.intent, 'open');

  const approvalStep = normalized.traceSteps.find((step) => step.status === 'approval-required');
  assert.equal(approvalStep?.moduleId, 'browser');
  assert.equal(approvalStep?.approval?.id, 'approval-1');

  const completedStep = normalized.traceSteps.find((step) => step.status === 'completed');
  assert.equal(completedStep?.refs?.[0], 'browser:tab-1');
  assert.equal(completedStep?.operationRef, 'operation:browser:1');
  assert.equal(completedStep?.timing?.durationMs, 12);

  const serialized = JSON.stringify({ events: normalized.events, traceSteps: normalized.traceSteps });
  assert.doesNotMatch(serialized, /provider-secret|browser-secret|approval-secret|provider\.example|example\.test|private-model-name/);
  assert.match(serialized, /\[redacted-url:sha256:/);
});

test('normalizes Claude partial messages and control request/response events', () => {
  const normalized = normalizeBackendEvents([
    {
      type: 'assistant',
      partial: true,
      session_id: 'claude-session-1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Partial answer' }] },
      provider: 'anthropic-provider-private',
      model: 'claude-private-model',
    },
    {
      type: 'control_request',
      id: 'control-1',
      request: {
        name: 'module.invoke',
        input: {
          moduleId: 'actions',
          intent: 'execute',
          input: { authorization: 'Bearer claude-secret-token-123456789' },
        },
      },
    },
    {
      type: 'control_response',
      id: 'control-1',
      response: { approved: false, status: 'rejected', reason: 'user denied' },
    },
  ], { backend: 'claude-stream-json', now: fixedNow });

  assert.equal(normalized.events[0]?.type, 'message_delta');
  assert.equal(normalized.events[0]?.text, 'Partial answer');
  assert.match(normalized.events[0]?.provider ?? '', /^\[redacted-provider:sha256:/);
  assert.match(normalized.events[0]?.model ?? '', /^\[redacted-model:sha256:/);

  assert.equal(normalized.events[1]?.type, 'approval_requested');
  assert.equal(normalized.events[1]?.approvalId, 'control-1');
  assert.equal(normalized.traceSteps[0]?.moduleId, 'actions');
  assert.equal(normalized.traceSteps[0]?.intent, 'execute');
  assert.equal(normalized.traceSteps[0]?.status, 'approval-required');

  assert.equal(normalized.events[2]?.type, 'approval_resolved');
  assert.equal(normalized.traceSteps[1]?.status, 'cancelled');

  const serialized = JSON.stringify(normalized);
  assert.doesNotMatch(serialized, /claude-secret-token|anthropic-provider-private|claude-private-model/);
});

test('preserves backend command lifecycle fields for native shell execution', () => {
  const normalized = normalizeBackendEvents([
    {
      type: 'item.started',
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      item: {
        id: 'cmd-1',
        type: 'command_execution',
        command: "/bin/zsh -lc 'npm run typecheck --silent'",
        status: 'in_progress',
      },
    },
    {
      type: 'item.completed',
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      item: {
        id: 'cmd-1',
        type: 'command_execution',
        command: "/bin/zsh -lc 'npm run typecheck --silent'",
        aggregated_output: 'Typecheck finished\nhttps://provider.example/private-log',
        exit_code: 0,
        status: 'completed',
      },
    },
  ], { backend: 'codex-app-server', now: fixedNow });

  assert.deepEqual(normalized.events.map((event) => event.type), ['tool_started', 'tool_completed']);
  assert.equal(normalized.events[0]?.toolName, 'shell');
  assert.equal(normalized.events[0]?.command, "/bin/zsh -lc 'npm run typecheck --silent'");
  assert.equal(normalized.events[0]?.status, 'in_progress');
  assert.equal(normalized.events[1]?.toolName, 'shell');
  assert.equal(normalized.events[1]?.exitCode, 0);
  assert.match(normalized.events[1]?.outputSummary ?? '', /Typecheck finished/);
  assert.doesNotMatch(normalized.events[1]?.outputSummary ?? '', /provider\.example/);
});

test('passes Codex exec JSONL normalized events through the backend-neutral stream', () => {
  const metadata: CodexRuntimeMetadata = {
    provider: 'sciforge-private-provider',
    model: 'private-runtime-model',
    profile: 'sciforge-runtime-test',
    workspace: '/tmp/sciforge-workspace',
    commandId: 'codex-test',
    attemptId: 'codex-test-attempt-1',
    evidenceRefs: ['audit:codex-runtime:codex-test:codex-test-attempt-1:normalized-events'],
    resumeRequested: false,
  };
  const codexEvents = normalizeCodexJsonlEvent({
    type: 'agent_message_delta',
    delta: 'hello',
    endpoint: 'https://provider.example/v1/responses?token=stdout-secret-123456',
  }, metadata);

  const normalized = normalizeBackendEvents(codexEvents, { backend: 'codex-exec-json', now: fixedNow });

  assert.deepEqual(normalized.events.map((event) => event.type), ['audit', 'message_delta']);
  assert.equal(normalized.events[1]?.backend, 'codex-exec-json');
  assert.equal(normalized.events[1]?.text, 'hello');
  assert.equal(normalized.events[1]?.turnId, 'codex-test');
  assert.match(normalized.events[1]?.provider ?? '', /^\[redacted-provider:sha256:/);
  assert.match(normalized.events[1]?.model ?? '', /^\[redacted-model:sha256:/);

  const serialized = JSON.stringify(normalized);
  assert.doesNotMatch(serialized, /stdout-secret|provider\.example|sciforge-private-provider|private-runtime-model/);
});

test('redacts secret, url, provider, and model fields in nested backend payloads', () => {
  const redacted = redactBackendEventValue({
    provider: 'provider-name',
    model: 'model-name',
    endpointUrl: 'https://provider.example/v1?api_key=secret-123456789',
    nested: { authorization: 'Bearer nested-secret-token-123456789' },
  });
  const serialized = JSON.stringify(redacted);

  assert.match(serialized, /\[redacted-provider:sha256:/);
  assert.match(serialized, /\[redacted-model:sha256:/);
  assert.match(serialized, /\[redacted-url:sha256:/);
  assert.match(serialized, /\[redacted-secret:sha256:/);
  assert.doesNotMatch(serialized, /provider-name|model-name|provider\.example|nested-secret-token/);
});

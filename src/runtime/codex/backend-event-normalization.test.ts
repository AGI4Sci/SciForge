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

test('uses app-server call ids to merge command lifecycles and preserves full diff output over summaries', () => {
  const normalized = normalizeBackendEvents([
    {
      type: 'item.started',
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      payload: {
        item: {
          call_id: 'call-diff-1',
          type: 'command_execution',
          command: "/bin/zsh -lc 'diff -u old.ts new.ts'",
          status: 'in_progress',
        },
      },
    },
    {
      type: 'item.completed',
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      payload: {
        item: {
          call_id: 'call-diff-1',
          type: 'command_execution',
          outputSummary: 'diff exited 1',
          output: [
            '--- old.ts',
            '+++ new.ts',
            '@@ -1 +1 @@',
            '-before',
            '+after',
          ].join('\n'),
          exit_code: 1,
          status: 'failed',
        },
      },
    },
  ], { backend: 'codex-app-server', now: fixedNow });

  assert.deepEqual(normalized.events.map((event) => event.type), ['tool_started', 'tool_completed']);
  assert.equal(normalized.events[0]?.itemId, 'call-diff-1');
  assert.equal(normalized.events[1]?.itemId, 'call-diff-1');
  assert.equal(normalized.events[1]?.outputSummary, 'diff exited 1');
  assert.match(normalized.events[1]?.diff ?? '', /@@ -1 \+1 @@/);
});

test('promotes app-server sub-agent refs from result payloads before input refs', () => {
  const normalized = normalizeBackendEvents([
    {
      type: 'tool.completed',
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      item: {
        id: 'subagent-tool-1',
        name: 'multi_agent_v1.spawn_agent',
        input: {
          agentId: '019e7649-worker',
          ref: 'artifact:input-placeholder',
          transcriptRef: '.sciforge/raw/input-transcript.json',
        },
        result: {
          agentId: '019e7649-worker',
          parentAgentId: 'root-agent',
          ref: 'artifact:subagent-result',
          transcriptRef: 'transcript:worker-1',
          resultSummary: 'Sub-agent audit completed.',
          refs: ['artifact:subagent-result', 'trace:unsafe-ref'],
        },
      },
    },
  ], { backend: 'codex-app-server', now: fixedNow });

  const event = normalized.events[0];
  assert.equal(event?.type, 'tool_completed');
  assert.equal(event?.ref, 'artifact:subagent-result');
  assert.equal(event?.agentId, '019e7649-worker');
  assert.equal(event?.parentAgentId, 'root-agent');
  assert.equal(event?.transcriptRef, 'transcript:worker-1');
  assert.equal(event?.resultSummary, 'Sub-agent audit completed.');
  assert.deepEqual(event?.refs, ['artifact:subagent-result', 'transcript:worker-1']);
  assert.doesNotMatch(JSON.stringify({ ref: event?.ref, transcriptRef: event?.transcriptRef, refs: event?.refs }), /\.sciforge\/raw|trace:unsafe-ref|input-placeholder/);
});

test('promotes app-server read file tool inputs into trusted file preview refs', () => {
  const normalized = normalizeBackendEvents([
    {
      method: 'item/completed',
      params: {
        threadId: 'thread-app-1',
        turnId: 'turn-app-1',
        item: {
          id: 'dyn-read-1',
          type: 'dynamicToolCall',
          tool: 'read_file',
          arguments: { path: 'PROJECT.md' },
          status: 'completed',
        },
      },
    },
    {
      type: 'tool.completed',
      thread_id: 'thread-app-1',
      turn_id: 'turn-app-1',
      item: {
        id: 'unsafe-read-1',
        name: 'read_file',
        input: { path: '/tmp/private-note.md', fileRef: 'file:.sciforge/raw/private.json' },
        status: 'completed',
      },
    },
  ], { backend: 'codex-app-server', now: fixedNow });

  const trusted = normalized.events[0];
  assert.equal(trusted?.type, 'tool_completed');
  assert.equal(trusted?.toolName, 'read_file');
  assert.equal(trusted?.filePath, 'PROJECT.md');
  assert.equal(trusted?.fileRef, 'file:PROJECT.md');

  const unsafe = normalized.events[1];
  assert.equal(unsafe?.type, 'tool_completed');
  assert.equal(unsafe?.toolName, 'read_file');
  assert.equal(unsafe?.filePath, undefined);
  assert.equal(unsafe?.fileRef, undefined);
});

test('normalizes Codex app-server slash-form rich client events and structured dynamic tool output', () => {
  const structuredContent = {
    agentId: '019e7649-worker',
    parentAgentId: 'root-agent',
    ref: 'artifact:subagent-result',
    transcriptRef: 'transcript:worker-1',
    resultSummary: 'Sub-agent audit completed.',
    refs: ['artifact:subagent-result', 'transcript:worker-1'],
  };
  const normalized = normalizeBackendEvents([
    { method: 'thread/started', params: { thread: { id: 'thread-app-1', cwd: '/tmp/sciforge-workspace' } } },
    { method: 'turn/started', params: { threadId: 'thread-app-1', turn: { id: 'turn-app-1' } } },
    { method: 'item/started', params: { threadId: 'thread-app-1', turnId: 'turn-app-1', item: { id: 'user-message-1', type: 'userMessage', text: 'Prompt' } } },
    { method: 'item/completed', params: { threadId: 'thread-app-1', turnId: 'turn-app-1', item: { id: 'user-message-1', type: 'userMessage', text: 'Prompt' } } },
    { method: 'item/started', params: { threadId: 'thread-app-1', turnId: 'turn-app-1', item: { id: 'message-1', type: 'agentMessage', text: '' } } },
    { method: 'item/agentMessage/delta', params: { threadId: 'thread-app-1', turnId: 'turn-app-1', itemId: 'message-1', delta: 'Working' } },
    {
      method: 'item/completed',
      params: {
        threadId: 'thread-app-1',
        turnId: 'turn-app-1',
        item: {
          id: 'dyn-subagent-1',
          type: 'dynamicToolCall',
          namespace: 'multi_agent_v1',
          tool: 'spawn_agent',
          arguments: { message: 'inspect PROJECT.md' },
          status: 'completed',
          success: true,
          contentItems: [{ type: 'inputText', text: JSON.stringify({ structuredContent }) }],
          durationMs: 4,
        },
      },
    },
    { method: 'turn/completed', params: { threadId: 'thread-app-1', turn: { id: 'turn-app-1', status: 'completed' } } },
  ], { backend: 'codex-app-server', now: fixedNow });

  assert.deepEqual(normalized.events.map((event) => event.type), [
    'thread_started',
    'turn_started',
    'item_started',
    'item_completed',
    'item_started',
    'message_delta',
    'tool_completed',
    'done',
  ]);
  assert.equal(normalized.events[5]?.text, 'Working');
  const subagent = normalized.events[6];
  assert.equal(subagent?.toolName, 'multi_agent_v1.spawn_agent');
  assert.equal(subagent?.agentId, '019e7649-worker');
  assert.equal(subagent?.parentAgentId, 'root-agent');
  assert.equal(subagent?.ref, 'artifact:subagent-result');
  assert.equal(subagent?.transcriptRef, 'transcript:worker-1');
  assert.deepEqual(subagent?.refs, ['artifact:subagent-result', 'transcript:worker-1']);
  assert.match(subagent?.resultSummary ?? '', /Sub-agent audit/);
});

test('promotes app-server GUI module completions into GUI events', () => {
  const normalized = normalizeBackendEvents([
    {
      type: 'tool.completed',
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      item: {
        id: 'gui-present-1',
        name: 'module.invoke',
        input: { moduleId: 'gui', intent: 'present', input: { text: 'Shown in GUI' } },
        result: { ok: true, refs: ['artifact:gui-present'] },
      },
    },
    {
      type: 'tool.completed',
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      item: {
        id: 'gui-ask-1',
        name: 'gui.ask_user',
        input: { title: 'Confirm', message: 'Continue?' },
        result: { ok: false },
      },
    },
  ], { backend: 'codex-app-server', now: fixedNow });

  assert.deepEqual(normalized.events.map((event) => event.type), ['gui_present', 'gui_ask_user']);
  assert.equal(normalized.traceSteps[0]?.moduleId, 'gui');
  assert.equal(normalized.traceSteps[0]?.intent, 'present');
  assert.equal(normalized.traceSteps[1]?.moduleId, 'gui');
  assert.equal(normalized.traceSteps[1]?.intent, 'ask_user');
});

test('maps unknown app-server dynamic tools to actions trace intent', () => {
  const normalized = normalizeBackendEvents([
    {
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'dyn-web-1',
          type: 'dynamicToolCall',
          namespace: 'web',
          tool: 'search',
          arguments: { query: 'agentic research' },
          status: 'inProgress',
        },
      },
    },
  ], { backend: 'codex-app-server', now: fixedNow });

  assert.equal(normalized.events[0]?.type, 'tool_started');
  assert.equal(normalized.events[0]?.toolName, 'web.search');
  assert.equal(normalized.traceSteps[0]?.moduleId, 'actions');
  assert.equal(normalized.traceSteps[0]?.functionName, 'invoke');
  assert.equal(normalized.traceSteps[0]?.intent, 'web.search');
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

test('passes Codex exec JSONL structured diff through the backend-neutral stream', () => {
  const normalized = normalizeBackendEvents([{
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type: 'tool_completed',
    toolName: 'shell',
    command: "/bin/zsh -lc 'diff -u old.ts new.ts'",
    itemId: 'item-diff',
    status: 'failed',
    exitCode: 1,
    outputSummary: 'diff exited 1',
    diff: [
      '--- old.ts',
      '+++ new.ts',
      '@@ -1 +1 @@',
      '-before',
      '+after',
    ].join('\n'),
  }], { backend: 'codex-exec-json', now: fixedNow });

  assert.equal(normalized.events[0]?.type, 'tool_completed');
  assert.match(normalized.events[0]?.diff ?? '', /@@ -1 \+1 @@/);
  assert.equal(normalized.events[0]?.outputSummary, 'diff exited 1');
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

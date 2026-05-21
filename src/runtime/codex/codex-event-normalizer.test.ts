import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codexSessionIdFromRaw,
  exitEvent,
  normalizeCodexJsonlEvent,
  stderrAuditEvent,
  type CodexRuntimeMetadata,
} from './codex-event-normalizer.js';

const metadata: CodexRuntimeMetadata = {
  provider: 'sciforge-deepseek-proxy',
  model: 'bailian/deepseek-v4-flash',
  profile: 'sciforge-runtime-deepseek',
  workspace: '/tmp/sciforge-workspace',
  commandId: 'codex-test',
  attemptId: 'codex-test-attempt-1',
  evidenceRefs: ['audit:codex-runtime:codex-test:codex-test-attempt-1:normalized-events'],
  resumeRequested: false,
};

test('normalizes stdout JSONL into stable GUI-facing events with runtime metadata', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'agent_message_delta',
    delta: 'hello',
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[0]?.status, 'raw-jsonl');
  assert.equal(events[1]?.type, 'message_delta');
  assert.equal(events[1]?.text, 'hello');
  assert.equal(events[1]?.provider, metadata.provider);
  assert.equal(events[1]?.model, metadata.model);
  assert.equal(events[1]?.profile, metadata.profile);
  assert.equal(events[1]?.workspace, metadata.workspace);
  assert.equal(events[1]?.commandId, metadata.commandId);
});

test('maps Codex tool activity into normalized tool lifecycle events', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.started',
    item: { id: 'item-1', name: 'exec_command' },
  }, metadata);

  assert.equal(events.at(-1)?.type, 'tool_started');
  assert.equal(events.at(-1)?.toolName, 'exec_command');
  assert.equal(events.at(-1)?.itemId, 'item-1');
});

test('maps Codex item.completed agent_message into a visible message event', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'item-2',
      type: 'agent_message',
      text: 'SCIFORGE-MT-5173',
    },
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[1]?.type, 'message');
  assert.equal(events[1]?.text, 'SCIFORGE-MT-5173');
  assert.equal(events[1]?.itemId, 'item-2');
});

test('maps native Codex response_item payload messages into visible message events', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Report written to tasks/output/report.md' }],
    },
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[1]?.type, 'message');
  assert.equal(events[1]?.text, 'Report written to tasks/output/report.md');
});

test('keeps native Codex reconnecting provider errors as retry audit instead of failed', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'error',
    message: 'Reconnecting... 1/5 (unexpected status 502 Bad Gateway: Unknown error, url: http://127.0.0.1:3891/v1/responses)',
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[0]?.status, 'raw-jsonl');
  assert.equal(events[1]?.type, 'audit');
  assert.equal(events[1]?.status, 'provider-retry');
  assert.equal(events.some((event) => event.type === 'failed'), false);
});

test('maps terminal native Codex error payload messages into failed events', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'turn.failed',
    error: {
      message: 'unexpected status 502 Bad Gateway: Unknown error, url: http://127.0.0.1:3891/v1/responses',
    },
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[1]?.type, 'failed');
  assert.match(events[1]?.message ?? '', /502 Bad Gateway/);
});

test('maps completed gui.present tool calls into explicit completion events', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.completed',
    item: {
      id: 'item-gui-present',
      type: 'function_call',
      name: 'gui.present',
      arguments: JSON.stringify({
        intent: 'show-result',
        title: 'Runtime answer',
        content: { kind: 'markdown', value: 'VISIBLE_GUI_PRESENT_RESULT' },
        hint: 'markdown',
      }),
      result: JSON.stringify({
        ok: true,
        placement: { panel: 'chat', viewId: 'runtime-answer' },
      }),
    },
  }, metadata);

  assert.equal(events[0]?.type, 'audit');
  assert.equal(events[1]?.type, 'gui_present');
  assert.equal(events[1]?.text, 'VISIBLE_GUI_PRESENT_RESULT');
  assert.equal(events[1]?.message, 'VISIBLE_GUI_PRESENT_RESULT');
  assert.equal((events[1]?.raw as { boundary?: string }).boundary, 'gui-present-completion');
  assert.equal(((events[1]?.raw as { presentation?: { source?: string } }).presentation)?.source, 'gui.present:codex-test');
  assert.equal(((events[1]?.raw as { presentation?: { hint?: string } }).presentation)?.hint, 'markdown');
});

test('does not treat gui.present start as completion', () => {
  const events = normalizeCodexJsonlEvent({
    type: 'item.started',
    item: {
      id: 'item-gui-present-start',
      type: 'function_call',
      name: 'gui.present',
      arguments: JSON.stringify({
        intent: 'show-result',
        content: { kind: 'markdown', value: 'SHOULD_NOT_COMPLETE_FROM_STARTED_TOOL' },
      }),
    },
  }, metadata);

  assert.equal(events.some((event) => event.type === 'gui_present'), false);
});

test('extracts native Codex session ids from session metadata', () => {
  const sessionMetadata = {
    type: 'session_meta',
    payload: { id: '019e3e82-164d-79b2-a5d4-b16241620b10' },
  };

  assert.equal(codexSessionIdFromRaw(sessionMetadata), '019e3e82-164d-79b2-a5d4-b16241620b10');

  const turnMetadata = { ...metadata };
  const events = normalizeCodexJsonlEvent(sessionMetadata, turnMetadata);

  assert.equal(turnMetadata.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
  assert.equal(events[0]?.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
});

test('includes native Codex session id on terminal events', () => {
  const event = exitEvent({
    ...metadata,
    codexSessionId: '019e3e82-164d-79b2-a5d4-b16241620b10',
  }, { exitCode: 0, signal: null });

  assert.equal(event.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
});

test('keeps stderr as audit/debug only', () => {
  const event = stderrAuditEvent(metadata, 'warning from codex\n');

  assert.equal(event.type, 'audit');
  assert.equal(event.status, 'stderr');
  assert.match(event.message ?? '', /warning/);
  assert.deepEqual(event.raw, { stream: 'stderr', chunk: 'warning from codex\n' });
});

test('maps exit code zero to done and nonzero to failed', () => {
  assert.equal(exitEvent(metadata, { exitCode: 0, signal: null }).type, 'done');
  const failed = exitEvent(metadata, { exitCode: 2, signal: null });
  assert.equal(failed.type, 'failed');
  assert.equal(failed.exitCode, 2);
});

test('maps signal exits to cancelled', () => {
  const event = exitEvent(metadata, { exitCode: null, signal: 'SIGTERM' });

  assert.equal(event.type, 'cancelled');
  assert.equal(event.signal, 'SIGTERM');
});

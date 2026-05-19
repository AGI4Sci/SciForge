import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkspaceRuntimeEvent, readWorkspaceToolStream } from './runtimeEvents';

test('SSE reader promotes Runtime Codex message events without synthesizing GUI projection', async () => {
  const body = [
    'event: message',
    'data: {"type":"message","text":"SCIFORGE-MT-FIXED-5173"}',
    '',
    'event: done',
    'data: {"type":"done","status":"done","message":"Runtime Codex completed successfully."}',
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.equal(seen.length, 2);
  assert.equal((stream.result as { message?: string }).message, 'SCIFORGE-MT-FIXED-5173');
  assert.equal((stream.result as { output?: { message?: string } }).output?.message, 'SCIFORGE-MT-FIXED-5173');
  assert.equal('displayIntent' in (stream.result as Record<string, unknown>), false);
});

test('Runtime Codex raw JSONL and stderr warnings normalize to folded audit summaries', () => {
  const rawJsonl = normalizeWorkspaceRuntimeEvent({
    type: 'raw_jsonl',
    rawJsonl: '{"secret":"RAW_JSONL_SHOULD_NOT_RENDER"}',
    presentationRole: 'audit',
  });
  const stderr = normalizeWorkspaceRuntimeEvent({
    type: 'audit',
    status: 'stderr',
    message: 'Plugin manifest warning: failed to load plugin manifest from /tmp/plugin.json',
    raw: { stream: 'stderr', chunk: 'Plugin manifest warning: failed to load plugin manifest from /tmp/plugin.json' },
  });

  assert.match(rawJsonl.detail ?? '', /raw JSONL recorded/i);
  assert.match(stderr.detail ?? '', /plugin manifest warning recorded/i);
  assert.doesNotMatch(rawJsonl.detail ?? '', /RAW_JSONL_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(stderr.detail ?? '', /failed to load plugin|\/tmp\/plugin\.json/);
});

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import {
  chatCompletionToResponse,
  responsesToChatCompletions,
} from './response-compat';
import { startCodexResponsesProxyServer } from './proxy';

test('converts Responses input into Chat Completions messages and tools', () => {
  const request = responsesToChatCompletions({
    model: 'bailian/deepseek-v4-flash',
    instructions: 'Be concise.',
    input: [
      { role: 'user', content: [{ type: 'input_text', text: 'Search TODOs' }] },
      { type: 'function_call_output', call_id: 'call_1', output: 'done' },
    ],
    tools: [
      {
        type: 'function',
        name: 'shell',
        description: 'Run a shell command',
        parameters: { type: 'object', properties: { command: { type: 'string' } } },
      },
    ],
    stream: true,
    max_output_tokens: 128,
  });

  assert.equal(request.model, 'bailian/deepseek-v4-flash');
  assert.equal(request.stream, true);
  assert.equal(request.max_tokens, 128);
  assert.deepEqual(request.messages.slice(0, 2), [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'Search TODOs' },
  ]);
  assert.deepEqual(request.messages[2], { role: 'tool', tool_call_id: 'call_1', content: 'done' });
  assert.equal(Array.isArray(request.tools), true);
});

test('converts Chat Completions text into a Responses object', () => {
  const response = chatCompletionToResponse({
    id: 'chatcmpl_1',
    created: 1716100000,
    model: 'deepseek-v4-flash',
    choices: [{ message: { role: 'assistant', content: 'SCIFORGE_BACKEND_OK' } }],
    usage: { total_tokens: 5 },
  });

  assert.equal(response.id, 'chatcmpl_1');
  assert.equal(response.status, 'completed');
  assert.equal(response.output_text, 'SCIFORGE_BACKEND_OK');
  assert.deepEqual(response.usage, { total_tokens: 5 });
});

test('serves streaming Chat Completions as Responses SSE', async () => {
  const upstream = createServer((request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write('data: {"choices":[{"delta":{"content":"SCI"}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"content":"FORGE"}}]}\n\n');
    response.write('data: [DONE]\n\n');
    response.end();
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    port: 0,
  });

  try {
    const response = await fetch(`${proxy.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify({
        model: 'bailian/deepseek-v4-flash',
        input: 'Reply with OK',
        stream: true,
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /response\.output_text\.delta/);
    assert.match(text, /response\.completed/);
    assert.match(text, /SCIFORGE/);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});

test('preserves streaming tool call name across empty DeepSeek deltas', async () => {
  const upstream = createServer((request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"exec_command","arguments":""}}]}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"","function":{"name":"","arguments":"{\\"cmd\\":\\"printf OK\\"}"}}]}}]}\n\n');
    response.write('data: [DONE]\n\n');
    response.end();
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    port: 0,
  });

  try {
    const response = await fetch(`${proxy.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify({
        model: 'bailian/deepseek-v4-flash',
        input: 'Use a tool',
        stream: true,
        tools: [{ type: 'function', name: 'exec_command', parameters: { type: 'object', properties: {} } }],
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /"call_id":"call_1"/);
    assert.match(text, /"name":"exec_command"/);
    assert.doesNotMatch(text, /"call_id":""/);
    assert.doesNotMatch(text, /"name":""/);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});

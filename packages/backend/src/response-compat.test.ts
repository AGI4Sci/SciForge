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

test('can serve Responses SSE while forcing non-streaming upstream Chat Completions', async () => {
  const upstream = createServer(async (request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean };
    assert.equal(body.stream, false);
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      id: 'chatcmpl_nonstream_1',
      created: 1716100000,
      model: 'bailian/deepseek-v4-flash',
      choices: [{ message: { role: 'assistant', content: 'NONSTREAM_OK' }, finish_reason: 'stop', index: 0 }],
      usage: { total_tokens: 12 },
    }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    forceNonStreamingUpstream: true,
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
    assert.match(text, /NONSTREAM_OK/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});

test('retries streaming Responses bridge as non-streaming Chat Completions after upstream shape rejection', async () => {
  let attempts = 0;
  const upstream = createServer(async (request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    attempts += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean; tools?: unknown[] };
    if (attempts === 1) {
      assert.equal(body.stream, true);
      assert.equal(Array.isArray(body.tools), true);
      response.writeHead(400, { 'content-type': 'text/event-stream; charset=utf-8' });
      response.end('event: error\ndata: {"error":{"message":"streaming tools are not accepted by this provider"}}\n\n');
      return;
    }
    assert.equal(body.stream, false);
    assert.equal(Array.isArray(body.tools), true);
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      id: 'chatcmpl_retry_nonstream_1',
      created: 1716100000,
      model: 'portable-model',
      choices: [{ message: { role: 'assistant', content: 'RETRY_NONSTREAM_OK' }, finish_reason: 'stop', index: 0 }],
    }));
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
        model: 'portable-model',
        input: 'Reply with OK',
        stream: true,
        tools: [{
          type: 'function',
          name: 'shell',
          description: 'run command',
          parameters: { type: 'object', properties: { cmd: { type: 'string' } } },
        }],
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(attempts, 2);
    assert.match(text, /response\.output_text\.delta/);
    assert.match(text, /RETRY_NONSTREAM_OK/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});

test('relaxes tool_choice to auto when provider rejects strict tool forcing', async () => {
  let attempts = 0;
  const upstream = createServer(async (request, response) => {
    attempts += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean; tool_choice?: unknown };
    if (attempts === 1) {
      assert.equal(body.stream, true);
      assert.equal(body.tool_choice, 'required');
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end('{}');
      return;
    }
    if (attempts === 2) {
      assert.equal(body.stream, false);
      assert.equal(body.tool_choice, 'required');
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end('{}');
      return;
    }
    assert.equal(body.stream, false);
    assert.equal(body.tool_choice, 'auto');
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      id: 'chatcmpl_relaxed_tool_choice_1',
      created: 1716100000,
      model: 'portable-model',
      choices: [{ message: { role: 'assistant', content: 'RELAXED_TOOL_CHOICE_OK' }, finish_reason: 'stop', index: 0 }],
    }));
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
        model: 'portable-model',
        input: 'Reply with OK',
        stream: true,
        tool_choice: 'required',
        tools: [{
          type: 'function',
          name: 'shell',
          description: 'run command',
          parameters: { type: 'object', properties: { cmd: { type: 'string' } } },
        }],
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(attempts, 3);
    assert.match(text, /RELAXED_TOOL_CHOICE_OK/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});

test('lowers Responses tool requests to the Chat Completions subset accepted by configured providers', async () => {
  const supportedModels = [
    'bailian/deepseek-v4-pro',
    'bailian/deepseek-v4-flash',
    'qwen3.6-plus',
  ];
  const acceptedBodies: Array<{ model?: string; stream?: boolean; tool_choice?: unknown; parallel_tool_calls?: unknown; tools?: unknown[] }> = [];
  const attemptsByModel = new Map<string, number>();
  const upstream = createServer(async (request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      model?: string;
      stream?: boolean;
      tool_choice?: unknown;
      parallel_tool_calls?: unknown;
      tools?: unknown[];
    };
    assert.ok(body.model && supportedModels.includes(body.model));
    attemptsByModel.set(body.model, (attemptsByModel.get(body.model) ?? 0) + 1);
    if (body.stream === true && Array.isArray(body.tools) && body.tools.length > 0) {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { message: 'streaming tools are not supported' } }));
      return;
    }
    if (body.tool_choice === 'required' || (body.tool_choice && typeof body.tool_choice === 'object')) {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { message: 'strict tool choice is not supported' } }));
      return;
    }
    if (body.parallel_tool_calls !== undefined) {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { message: 'parallel tool calls are not supported' } }));
      return;
    }
    acceptedBodies.push(body);
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      id: `chatcmpl_${body.model?.replace(/[^a-z0-9]+/gi, '_')}`,
      created: 1716100000,
      model: body.model,
      choices: [{ message: { role: 'assistant', content: `COMPAT_OK ${body.model}` }, finish_reason: 'stop', index: 0 }],
    }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    port: 0,
  });

  try {
    for (const model of supportedModels) {
      const response = await fetch(`${proxy.url}/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
        body: JSON.stringify({
          model,
          input: 'Use the shell tool only if needed.',
          stream: true,
          tool_choice: 'required',
          parallel_tool_calls: true,
          tools: [{
            type: 'function',
            name: 'shell',
            description: 'run command',
            parameters: { type: 'object', properties: { cmd: { type: 'string' } } },
          }],
        }),
      });
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.match(text, new RegExp(`COMPAT_OK ${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.match(text, /data: \[DONE\]/);
    }

    assert.equal(acceptedBodies.length, supportedModels.length);
    for (const body of acceptedBodies) {
      assert.equal(body.stream, false);
      assert.equal(body.tool_choice, 'auto');
      assert.equal(body.parallel_tool_calls, undefined);
      assert.equal(Array.isArray(body.tools), true);
    }
    for (const model of supportedModels) {
      assert.equal(attemptsByModel.get(model), 4);
    }
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});

test('simplifies object tool_choice by filtering to the selected function before relaxing to auto', async () => {
  let acceptedBody: { tool_choice?: unknown; tools?: Array<{ function?: { name?: string } }> } | undefined;
  let attempts = 0;
  const upstream = createServer(async (request, response) => {
    attempts += 1;
    assert.equal(request.url, '/v1/chat/completions');
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      tool_choice?: unknown;
      tools?: Array<{ function?: { name?: string } }>;
    };
    if (body.tool_choice && typeof body.tool_choice === 'object') {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end('{}');
      return;
    }
    if (body.tool_choice === 'required') {
      assert.deepEqual(body.tools?.map((tool) => tool.function?.name), ['exec_command']);
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end('{}');
      return;
    }
    acceptedBody = body;
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      id: 'chatcmpl_object_tool_choice_1',
      created: 1716100000,
      model: 'portable-model',
      choices: [{ message: { role: 'assistant', content: 'OBJECT_TOOL_CHOICE_OK' }, finish_reason: 'stop', index: 0 }],
    }));
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
        model: 'portable-model',
        input: 'Use exec command.',
        stream: false,
        tool_choice: { type: 'function', function: { name: 'exec_command' } },
        tools: [
          { type: 'function', name: 'exec_command', parameters: { type: 'object', properties: {} } },
          { type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } },
        ],
      }),
    });
    const payload = await response.json() as { output_text?: string };
    assert.equal(response.status, 200);
    assert.equal(payload.output_text, 'OBJECT_TOOL_CHOICE_OK');
    assert.equal(attempts, 3);
    assert.ok(acceptedBody);
    assert.equal(acceptedBody.tool_choice, 'auto');
    assert.deepEqual(acceptedBody.tools?.map((tool) => tool.function?.name), ['exec_command']);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});

test('keeps proxy process alive when upstream Responses fetch rejects', async () => {
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: 'http://127.0.0.1:1/v1',
    port: 0,
    fetchImpl: (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch,
  });

  try {
    const response = await fetch(`${proxy.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify({
        model: 'bailian/deepseek-v4-flash',
        input: 'This upstream call will fail',
        stream: true,
      }),
    });
    const payload = await response.json() as { error?: { code?: string; message?: string } };
    assert.equal(response.status, 500);
    assert.equal(payload.error?.code, 'sciforge_proxy_error');
    assert.match(payload.error?.message ?? '', /fetch failed/);

    const health = await fetch(`${proxy.url}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { ok?: boolean }).ok, true);
  } finally {
    await proxy.close();
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

test('does not emit an empty streaming tool call name when DeepSeek sends metadata late', async () => {
  const upstream = createServer((request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"","type":"function","function":{"name":"","arguments":"{\\"cmd\\":\\"printf "}}]}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_late","function":{"name":"exec_command","arguments":"OK\\"}"}}]}}]}\n\n');
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
    assert.match(text, /"call_id":"call_late"/);
    assert.match(text, /"name":"exec_command"/);
    assert.doesNotMatch(text, /"name":""/);
    assert.doesNotMatch(text, /"call_id":""/);
    assert.match(text, /printf OK/);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});

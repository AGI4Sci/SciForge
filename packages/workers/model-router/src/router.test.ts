import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { startModelRouterServer, type ModelRouterConfig } from './router';

const pngDataUrl = `data:image/png;base64,${Buffer.from('tiny-png').toString('base64')}`;
const forbiddenPublicSurfacePattern =
  /text-secret|vision-secret|Authorization|Bearer|baseUrl|apiKeyEnv|SCIFORGE_TEXT_API_KEY|SCIFORGE_VISION_API_KEY|text-model|vision-model|text-provider|vision-provider|https:\/\/text\.example|https:\/\/vision\.example/i;

test('public manifest exposes only the Model Router worker contract', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-public-manifest-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: 'public-router-alias' }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/manifest`);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.workerId, 'sciforge.model-router');
    assert.match(serialized, /refs_first_trace/);
    assert.match(serialized, /refs-first/);
    assert.match(serialized, /\/v1\/responses/);
    assert.match(serialized, /sciforge\.model-router\.responses/);
    assert.doesNotMatch(serialized, forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('public model list exposes only the configured public alias', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-public-models-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: 'public-router-alias' }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/v1/models`, { headers: runtimeHeaders() });
    assert.equal(response.status, 200);
    const body = await response.json();
    const publicModel = {
      slug: 'public-router-alias',
      display_name: 'public-router-alias',
      id: 'public-router-alias',
      object: 'model',
      owned_by: 'sciforge',
    };
    assert.deepEqual(body, {
      object: 'list',
      data: [publicModel],
      models: [publicModel],
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('runtime model routes require the configured bearer token', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-runtime-auth-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const missing = await fetch(`${server.url}/v1/models`);
    assert.equal(missing.status, 401);
    const invalid = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(invalid.status, 401);
    assert.match(await invalid.text(), /unauthorized/i);
  } finally {
    await server.close();
  }
});

test('runtime model routes accept Anthropic x-api-key auth', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-runtime-x-api-key-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/v1/models`, {
      headers: { 'x-api-key': 'runtime-secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal((body.data as Array<Record<string, unknown>>)[0]?.id, 'sciforge-router');
  } finally {
    await server.close();
  }
});

test('openai-compatible provider bases are normalized to v1 chat completions', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-provider-base-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  config.profiles.default.textReasoner.baseUrl = 'https://text.example';
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The normalized base URL works.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'hello',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
  } finally {
    await server.close();
  }
});

test('anthropic messages route through the configured text reasoner', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The Claude-compatible answer.'),
    ]),
  });

  try {
    const missing = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'sciforge-router', messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(missing.status, 401);

    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.type, 'message');
    assert.equal(body.role, 'assistant');
    assert.deepEqual(body.content, [{ type: 'text', text: 'The Claude-compatible answer.' }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    assert.deepEqual(calls[0]?.body.messages, [
      { role: 'user', content: 'hello' },
    ]);
  } finally {
    await server.close();
  }
});

test('anthropic messages can stream text response events', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-stream-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The streamed Claude-compatible answer.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    const events = parseSseEvents(await response.text());
    assert.equal(events[0]?.type, 'message_start');
    assert.deepEqual(events.find((event) => event.type === 'content_block_delta')?.delta, {
      type: 'text_delta',
      text: 'The streamed Claude-compatible answer.',
    });
    assert.equal(events.at(-1)?.type, 'message_stop');
    assert.equal(calls.length, 1);
  } finally {
    await server.close();
  }
});

test('anthropic messages accepts Claude Code model aliases as router public alias', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-claude-model-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'Routed through the local Model Router.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sonnet',
        max_tokens: 256,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.model, 'sonnet');
    assert.deepEqual(body.content, [{ type: 'text', text: 'Routed through the local Model Router.' }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
  } finally {
    await server.close();
  }
});

test('anthropic messages map tool use through the router provider path', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-tools-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-tools', '', [{
        id: 'tool-call-1',
        type: 'function',
        function: {
          name: 'Edit',
          arguments: JSON.stringify({ path: 'README.md', old_string: 'old', new_string: 'new' }),
        },
      }]),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        tools: [{
          name: 'Edit',
          description: 'Edit a file',
          input_schema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              old_string: { type: 'string' },
              new_string: { type: 'string' },
            },
          },
        }],
        messages: [
          {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'previous-tool',
              name: 'Edit',
              input: { path: 'README.md', old_string: 'before', new_string: 'after' },
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'previous-tool',
              content: 'Previous edit completed.',
            }],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.stop_reason, 'tool_use');
    assert.deepEqual(body.content, [{
      type: 'tool_use',
      id: 'tool-call-1',
      name: 'Edit',
      input: { path: 'README.md', old_string: 'old', new_string: 'new' },
    }]);
    assert.deepEqual(calls[0]?.body.tools, [{
      type: 'function',
      function: {
        name: 'Edit',
        description: 'Edit a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_string: { type: 'string' },
            new_string: { type: 'string' },
          },
        },
      },
    }]);
    assert.deepEqual(calls[0]?.body.messages, [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'previous-tool',
          type: 'function',
          function: {
            name: 'Edit',
            arguments: JSON.stringify({ path: 'README.md', old_string: 'before', new_string: 'after' }),
          },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'previous-tool',
        content: 'Previous edit completed.',
      },
    ]);
  } finally {
    await server.close();
  }
});

test('healthz reports provider readiness without leaking private bindings', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.ok, true);
    assert.deepEqual(body.upstream, {
      category: 'ready',
      ok: true,
      retryable: false,
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(serialized, forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('healthz blocks missing provider credentials without leaking binding names', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-missing-auth-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: {},
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.ok, false);
    assert.deepEqual(body.upstream, {
      category: 'provider-auth',
      ok: false,
      retryable: false,
      httpStatus: 401,
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(serialized, forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('pure text responses are routed only to the configured text reasoner', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The text answer.', undefined, {}, {
        prompt_tokens: 120,
        completion_tokens: 20,
        total_tokens: 145,
        prompt_tokens_details: { cached_tokens: 90 },
        completion_tokens_details: { reasoning_tokens: 5 },
      }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge in one sentence.',
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The text answer.');
    assert.deepEqual(body.usage, {
      input_tokens: 120,
      output_tokens: 20,
      total_tokens: 145,
      input_tokens_details: { cached_tokens: 90 },
      output_tokens_details: { reasoning_tokens: 5 },
      prompt_tokens: 120,
      completion_tokens: 20,
      cached_input_tokens: 90,
      reasoning_output_tokens: 5,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    assert.equal(calls[0]?.headers.authorization, 'Bearer text-secret');
    assert.equal(calls[0]?.body.model, 'text-model');
    assert.deepEqual(calls[0]?.body.messages, [
      { role: 'user', content: 'Explain SciForge in one sentence.' },
    ]);

    const traceText = await readSingleTraceFile(workspaceRoot, 'trace.json');
    assert.match(traceText, /"profileId":\s*"default"/);
    assert.doesNotMatch(traceText, /text-secret|vision-secret|Authorization|data:image|base64/i);
    assert.doesNotMatch(traceText, /text-provider|vision-provider|text-model|vision-model/i);
    assert.match(traceText, /"providerBindingSha256":\s*"sha256:[a-f0-9]{64}"/);
    assert.match(traceText, /"providerAliasSha256":\s*"sha256:[a-f0-9]{64}"/);
    assert.match(traceText, /"modelAliasSha256":\s*"sha256:[a-f0-9]{64}"/);
    assert.match(traceText, /"wireRequest":\s*\{/);
    assert.match(traceText, /"endpointRoute":\s*"chat\.completions"/);
    assert.match(traceText, /"messageCount":\s*1/);
    assert.match(traceText, /"toolCount":\s*0/);
    assert.match(traceText, /"stopReason":\s*"stop"/);
    assert.match(traceText, /"latencyMs":\s*\d+/);
  } finally {
    await server.close();
  }
});

test('anthropic messages route through the text reasoner', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-anthropic-message-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: 'deepseek-gui-router' }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'pong', undefined, {}, {
        prompt_tokens: 12,
        completion_tokens: 3,
        total_tokens: 15,
      }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/api/cc/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'runtime-secret' },
      body: JSON.stringify({
        model: 'deepseek-gui-router',
        system: 'Answer tersely.',
        messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
        max_tokens: 64,
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.type, 'message');
    assert.equal(body.model, 'deepseek-gui-router');
    assert.deepEqual(body.content, [{ type: 'text', text: 'pong' }]);
    assert.deepEqual(body.usage, {
      input_tokens: 12,
      output_tokens: 3,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    assert.equal(calls[0]?.headers.authorization, 'Bearer text-secret');
    assert.deepEqual(calls[0]?.body.messages, [
      { role: 'user', content: 'Answer tersely.\nReply with exactly: pong' },
    ]);
  } finally {
    await server.close();
  }
});

test('anthropic messages stream emits Claude-compatible SSE events', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-anthropic-stream-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: 'deepseek-gui-router' }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'pong', undefined, {}, {
        prompt_tokens: 12,
        completion_tokens: 3,
        total_tokens: 15,
      }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'deepseek-gui-router',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: pong' }] }],
        max_tokens: 64,
        stream: true,
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    const events = parseSseEvents(await response.text());
    assert.deepEqual(events.map((event) => event.type), [
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    assert.deepEqual(events[2]?.delta, { type: 'text_delta', text: 'pong' });
    assert.equal(calls.length, 1);
  } finally {
    await server.close();
  }
});

test('vision responses translate refs first, then ask the text reasoner for the final answer', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the chart label is ATP concentration.'),
      chatCompletion('vision-initial-ref', 'Observation: the microscopy panel is attached as context.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The chart label is ATP concentration.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What does the axis label say?' },
            { type: 'input_image', image_url: pngDataUrl, mime_type: 'image/png' },
            { type: 'input_image', ref: 'artifact:microscopy-panel', mime_type: 'image/jpeg' },
          ],
        }],
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The chart label is ATP concentration.');
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/chat/completions');
    assert.equal(calls[0]?.headers.authorization, 'Bearer vision-secret');
    assert.equal(calls[0]?.body.model, 'vision-model');
    assert.match(JSON.stringify(calls[0]?.body), /data:image\/png;base64/);
    assert.doesNotMatch(JSON.stringify(calls[0]?.body), /artifact:microscopy-panel/);
    assert.equal(calls[1]?.url, 'https://vision.example/v1/chat/completions');
    assert.match(JSON.stringify(calls[1]?.body), /artifact:microscopy-panel/);
    assert.doesNotMatch(JSON.stringify(calls[1]?.body), /data:image|base64|tiny-png/i);
    assert.equal(calls[2]?.url, 'https://text.example/v1/chat/completions');
    assert.doesNotMatch(JSON.stringify(calls[2]?.body), /data:image|base64|tiny-png/i);
    assert.match(JSON.stringify(calls[2]?.body), /Observation: the chart label is ATP concentration/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"source":\s*"inline"/);
    assert.match(traceText, /"source":\s*"ref"/);
    assert.match(traceText, /"sha256":\s*"sha256:[a-f0-9]{64}"/);
    assert.doesNotMatch(traceText, /text-secret|vision-secret|data:image|base64|tiny-png/i);
    assert.doesNotMatch(traceText, /text-provider|vision-provider|text-model|vision-model/i);
    assert.match(traceText, /"roleAlias":\s*"translators\.vision"/);
  } finally {
    await server.close();
  }
});

test('responses tool calls pass through the Model Router API without becoming text answers', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-tool-call-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-tool-call', '', [{
        id: 'call_gui_present_1',
        type: 'function',
        function: {
          name: 'gui_present',
          arguments: JSON.stringify({
            intent: 'show-result',
            content: { kind: 'markdown', value: 'Visible answer.' },
          }),
        },
      }], { reasoning_content: 'Need to present the answer through the GUI tool.' }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Answer through gui.present.',
        tools: [{
          type: 'function',
          name: 'gui_present',
          description: 'Present the final answer.',
          parameters: { type: 'object', properties: {} },
        }],
        tool_choice: 'auto',
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { output?: Array<Record<string, unknown>>; output_text?: string };
    assert.equal(body.output_text, '');
    assert.deepEqual(body.output, [{
      id: body.output?.[0]?.id,
      type: 'function_call',
      status: 'completed',
      call_id: 'call_gui_present_1',
      name: 'gui_present',
      arguments: JSON.stringify({
        intent: 'show-result',
        content: { kind: 'markdown', value: 'Visible answer.' },
      }),
      reasoning_content: 'Need to present the answer through the GUI tool.',
    }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.body.tool_choice, 'auto');
    assert.equal((calls[0]?.body.tools as Array<{ function?: { name?: string } }> | undefined)?.[0]?.function?.name, 'gui_present');
  } finally {
    await server.close();
  }
});

test('responses tool outputs are forwarded to chat providers as tool messages', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-tool-output-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-tool-output-final', '工具输出时间是 Mon Jun 15 17:01:38 CST 2026。'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Run date and answer.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_date_1',
            name: 'local_shell',
            arguments: '{"cmd":"date"}',
            reasoning_content: 'Need to run date before answering.',
          },
          {
            type: 'function_call_output',
            call_id: 'call_date_1',
            output: 'Mon Jun 15 17:01:38 CST 2026\n',
          },
        ],
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { output_text?: string };
    assert.equal(body.output_text, '工具输出时间是 Mon Jun 15 17:01:38 CST 2026。');
    assert.deepEqual(calls[0]?.body.messages, [
      {
        role: 'user',
        content: 'Run date and answer.',
      },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'Need to run date before answering.',
        tool_calls: [{
          id: 'call_date_1',
          type: 'function',
          function: {
            name: 'local_shell',
            arguments: '{"cmd":"date"}',
          },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'call_date_1',
        content: 'Mon Jun 15 17:01:38 CST 2026\n',
      },
    ]);
  } finally {
    await server.close();
  }
});

test('responses developer messages are replayed as chat-compatible system messages', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-developer-replay-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-developer-final', 'Developer instructions were preserved.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'developer',
            content: [
              { type: 'input_text', text: 'Always answer briefly.' },
              { type: 'input_text', text: 'Never call extra tools.' },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Say hello.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_date_developer',
            name: 'local_shell',
            arguments: '{"cmd":"date"}',
            reasoning_content: 'Need one date call before answering.',
          },
          {
            type: 'function_call_output',
            call_id: 'call_date_developer',
            output: 'Mon Jun 15 17:01:38 CST 2026\n',
          },
        ],
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls[0]?.body.messages, [
      {
        role: 'system',
        content: 'Always answer briefly.\nNever call extra tools.',
      },
      {
        role: 'user',
        content: 'Say hello.',
      },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'Need one date call before answering.',
        tool_calls: [{
          id: 'call_date_developer',
          type: 'function',
          function: {
            name: 'local_shell',
            arguments: '{"cmd":"date"}',
          },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'call_date_developer',
        content: 'Mon Jun 15 17:01:38 CST 2026\n',
      },
    ]);
  } finally {
    await server.close();
  }
});

test('responses tool outputs restore cached function calls stripped by app-server clients', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-tool-reasoning-cache-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-tool-call-with-reasoning', '', [{
        id: 'call_date_cached',
        type: 'function',
        function: {
          name: 'local_shell',
          arguments: '{"cmd":"date"}',
        },
      }], { reasoning_content: 'Need to run date before answering.' }),
      chatCompletion('text-tool-output-final', '工具输出时间是 Mon Jun 15 17:01:38 CST 2026。'),
    ]),
  });

  try {
    const first = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Run date and answer.',
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(first.status, 200);
    const firstBody = await first.json() as { output?: Array<Record<string, unknown>> };
    assert.equal(firstBody.output?.[0]?.reasoning_content, 'Need to run date before answering.');

    const second = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Run date and answer.' }],
          },
          {
            type: 'function_call_output',
            call_id: 'call_date_cached',
            output: 'Mon Jun 15 17:01:38 CST 2026\n',
          },
        ],
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(second.status, 200);
    assert.equal(
      (calls[1]?.body.messages as Array<Record<string, unknown>> | undefined)?.[1]?.reasoning_content,
      'Need to run date before answering.'
    );
  } finally {
    await server.close();
  }
});

test('responses tool outputs retry once when thinking providers require reasoning content replay', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-tool-reasoning-retry-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({
        error: {
          message: 'The `reasoning_content` in the thinking mode must be passed back to the API.',
        },
      }, { status: 400 }),
      chatCompletion('text-tool-output-final', '工具输出时间是 Mon Jun 15 17:01:38 CST 2026。'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Run date and answer.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_date_retry',
            name: 'local_shell',
            arguments: '{"cmd":"date"}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_date_retry',
            output: 'Mon Jun 15 17:01:38 CST 2026\n',
          },
        ],
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(
      (calls[0]?.body.messages as Array<Record<string, unknown>> | undefined)?.[1]?.reasoning_content,
      undefined
    );
    assert.equal(
      (calls[1]?.body.messages as Array<Record<string, unknown>> | undefined)?.[1]?.reasoning_content,
      'Tool call issued by the assistant.'
    );
  } finally {
    await server.close();
  }
});

test('responses routing drops non-function Codex tools before chat provider calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-codex-tools-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-codex-tools', 'Plain answer.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Use plain text.',
        tools: [
          { type: 'local_shell' },
          { type: 'apply_patch' },
          { type: 'function', name: 'gui_present', parameters: { type: 'object', properties: {} } },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls[0]?.body.tools, [{
      type: 'function',
      function: {
        name: 'gui_present',
        parameters: { type: 'object', properties: {} },
      },
    }]);
  } finally {
    await server.close();
  }
});

test('responses routing exposes namespaced dynamic tools as provider-safe chat functions', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-dynamic-tools-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-dynamic-tools', 'Plain answer.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Use the configured dynamic tool if needed.',
        tools: [
          { type: 'local_shell' },
          {
            namespace: 'mcp_gui_research',
            name: 'research_search',
            description: 'Search scientific literature.',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          },
          {
            type: 'namespace',
            name: 'mcp_lab',
            tools: [{
              type: 'function',
              name: 'inspect.dataset',
              description: 'Inspect a dataset.',
              input_schema: { type: 'object', properties: { id: { type: 'string' } } },
            }],
          },
        ],
        tool_choice: {
          type: 'function',
          function: { name: 'mcp_gui_research.research_search' },
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls[0]?.body.tools, [
      {
        type: 'function',
        function: {
          name: 'mcp_gui_research_research_search',
          description: 'Search scientific literature.',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      },
      {
        type: 'function',
        function: {
          name: 'mcp_lab_inspect_dataset',
          description: 'Inspect a dataset.',
          parameters: { type: 'object', properties: { id: { type: 'string' } } },
        },
      },
    ]);
    assert.deepEqual(calls[0]?.body.tool_choice, {
      type: 'function',
      function: { name: 'mcp_gui_research_research_search' },
    });
  } finally {
    await server.close();
  }
});

test('responses routing maps provider dynamic tool calls back to namespaced Responses items', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-dynamic-tool-call-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-dynamic-tool-call', '', [{
        id: 'call_research_search_1',
        type: 'function',
        function: {
          name: 'mcp_gui_research_research_search',
          arguments: JSON.stringify({ query: 'agentic RL', maxResults: 1 }),
        },
      }]),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Search with the configured dynamic tool.',
        tools: [{
          namespace: 'mcp_gui_research',
          name: 'research_search',
          description: 'Search scientific literature.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { output?: Array<Record<string, unknown>>; output_text?: string };
    assert.equal(body.output_text, '');
    assert.equal(body.output?.[0]?.type, 'function_call');
    assert.equal(body.output?.[0]?.call_id, 'call_research_search_1');
    assert.equal(body.output?.[0]?.name, 'mcp_gui_research.research_search');
    assert.equal(body.output?.[0]?.arguments, JSON.stringify({ query: 'agentic RL', maxResults: 1 }));
    assert.equal((calls[0]?.body.tools as Array<{ function?: { name?: string } }> | undefined)?.[0]?.function?.name, 'mcp_gui_research_research_search');
  } finally {
    await server.close();
  }
});

test('streaming responses emit function_call items when the text reasoner chooses a tool', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-stream-tool-call-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-tool-call-stream', '', [{
        id: 'call_gui_present_stream',
        type: 'function',
        function: {
          name: 'gui_present',
          arguments: '{"intent":"show-result","content":{"kind":"markdown","value":"Stream visible answer."}}',
        },
      }], {}, {
        prompt_tokens: 42,
        completion_tokens: 3,
        total_tokens: 45,
        prompt_tokens_details: { cached_tokens: 30 },
      }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        stream: true,
        input: 'Answer through gui.present.',
        tools: [{ type: 'function', name: 'gui_present', parameters: { type: 'object', properties: {} } }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.text();
    const events = parseSseEvents(body);
    assert.deepEqual(events.map((event) => event.type), [
      'response.created',
      'response.output_item.added',
      'response.output_item.done',
      'response.completed',
    ]);
    assert.equal(events[1]?.item?.type, 'function_call');
    assert.equal(events[1]?.item?.name, 'gui_present');
    assert.equal(events[1]?.item?.call_id, 'call_gui_present_stream');
    assert.deepEqual(events.find((event) => event.type === 'response.completed')?.response?.usage, {
      input_tokens: 42,
      output_tokens: 3,
      total_tokens: 45,
      input_tokens_details: { cached_tokens: 30 },
      output_tokens_details: { reasoning_tokens: 0 },
      prompt_tokens: 42,
      completion_tokens: 3,
      cached_input_tokens: 30,
      reasoning_output_tokens: 0,
    });
    assert.doesNotMatch(body, /response\.output_text\.delta/);
  } finally {
    await server.close();
  }
});

test('workspace image refs are materialized only as transient provider image payloads', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-ref-materialization-'));
  const imageBytes = Buffer.from('local-ref-pixels');
  await mkdir(join(workspaceRoot, 'images'), { recursive: true });
  await writeFile(join(workspaceRoot, 'images', 'panel.png'), imageBytes);
  const expectedDataUrl = `data:image/png;base64,${imageBytes.toString('base64')}`;
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the local file image is visible.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The local file image is visible.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is shown?' },
            { type: 'input_image', ref: 'images/panel.png', mime_type: 'image/png' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    const visionBody = JSON.stringify(calls[0]?.body);
    assert.match(visionBody, /data:image\/png;base64/);
    assert.match(visionBody, new RegExp(expectedDataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(visionBody, /SciForge visual ref image_1: images\/panel\.png/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"source":\s*"ref"/);
    assert.match(traceText, /"ref":\s*"images\/panel\.png"/);
    assert.doesNotMatch(traceText, /data:image|base64|local-ref-pixels/i);
    assert.doesNotMatch(traceText, /text-secret|vision-secret|text-provider|vision-provider|text-model|vision-model/i);
  } finally {
    await server.close();
  }
});

test('local_image inputs are normalized as visual objects inside the Model Router', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-local-image-object-'));
  const imageBytes = Buffer.from('local-image-pixels');
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-local'), { recursive: true });
  const imagePath = join(workspaceRoot, '.sciforge', 'uploads', 'session-local', 'hotel.jpg');
  await writeFile(imagePath, imageBytes);
  const expectedDataUrl = `data:image/jpeg;base64,${imageBytes.toString('base64')}`;
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the local image object is a hotel voucher.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'It is a hotel voucher.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is this local image?' },
            { type: 'local_image', path: imagePath, mime_type: 'image/jpeg', title: '酒店凭证.jpg' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'It is a hotel voucher.');
    assert.equal(calls.length, 2);
    const visionBody = JSON.stringify(calls[0]?.body);
    assert.match(visionBody, new RegExp(expectedDataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"title":\s*"酒店凭证\.jpg"/);
    assert.match(traceText, /"ref":\s*"\.sciforge\/uploads\/session-local\/hotel\.jpg"/);
    assert.doesNotMatch(traceText, /data:image|base64|local-image-pixels/i);
  } finally {
    await server.close();
  }
});

test('input_object refs are detected and translated inside the Model Router', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-input-object-'));
  const imageBytes = Buffer.from('input-object-pixels');
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-test'), { recursive: true });
  await writeFile(join(workspaceRoot, '.sciforge', 'uploads', 'session-test', 'hotel.jpg'), imageBytes);
  const expectedDataUrl = `data:image/jpeg;base64,${imageBytes.toString('base64')}`;
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the hotel voucher total is 421.15 yuan.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The hotel voucher total is 421.15 yuan.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: '解释这张图' },
            {
              type: 'input_object',
              ref: '.sciforge/uploads/session-test/hotel.jpg',
              mimeType: 'image/jpeg',
              title: '酒店凭证.jpg',
            },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The hotel voucher total is 421.15 yuan.');
    assert.equal(calls.length, 2);
    const visionBody = JSON.stringify(calls[0]?.body);
    assert.match(visionBody, new RegExp(expectedDataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const textReasonerBody = JSON.stringify(calls[1]?.body);
    assert.doesNotMatch(textReasonerBody, /data:image|base64|input-object-pixels/i);
    assert.match(textReasonerBody, /Do not tell the user you cannot directly access or see the image/i);
    assert.match(textReasonerBody, /Do not mention modality observations, visual observations, translators, or router internals/i);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"source":\s*"ref"/);
    assert.match(traceText, /"ref":\s*"\.sciforge\/uploads\/session-test\/hotel\.jpg"/);
    assert.doesNotMatch(traceText, /data:image|base64|input-object-pixels/i);
  } finally {
    await server.close();
  }
});

test('scientific file uploads are translated to evidence via the standalone sci-modality service', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-scimodality-'));
  const fasta = '>sp|P0CG48|UBC_HUMAN\nMQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG\n';
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-sci'), { recursive: true });
  await writeFile(join(workspaceRoot, '.sciforge', 'uploads', 'session-sci', 'ubiquitin.fasta'), fasta);
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: { ...testEnv(), SCIFORGE_SCIMODALITY_SERVICE_URL: 'http://sci-modality.example:3898' },
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      // 1) standalone sci-modality service translate (real text-output expert model, here stubbed).
      Response.json({
        ok: true,
        summary: '[esm2text-protein] Generated by Esm2Text. A 76-residue ubiquitin protein.',
        data: {
          modality: 'protein',
          model: 'esm2text-protein',
          summary: '[esm2text-protein] Generated by habdine/Esm2Text-Base. This is a 76-residue ubiquitin protein that signals protein degradation.',
        },
        provenance: {},
      }),
      // 2) the text reasoner produces the final answer from the injected evidence observation.
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'It is a 76-residue ubiquitin protein.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What protein is this?' },
            { type: 'input_object', ref: '.sciforge/uploads/session-sci/ubiquitin.fasta', mimeType: 'text/plain', title: 'ubiquitin.fasta' },
          ],
        }],
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    const outputText = String(body.output_text);
    // Transparency: the answer surfaces the expert's RAW output verbatim, names the expert model,
    // AND keeps the reasoner's final answer.
    assert.match(outputText, /SciForge Model Router — expert translation/);
    assert.match(outputText, /esm2text-protein/);
    assert.match(outputText, /76-residue ubiquitin protein that signals protein degradation/);
    assert.match(outputText, /It is a 76-residue ubiquitin protein\./);
    assert.equal(calls.length, 2);
    // The sci-modality service was called with the file content as payload (translate-only contract).
    assert.match(calls[0]?.url ?? '', /\/modality\/translate$/);
    assert.match(String(calls[0]?.body.payload ?? ''), /MQIFVKTLTGK/);
    // The text reasoner received the real expert evidence as an observation (no cheating, no raw fallback).
    const textBody = JSON.stringify(calls[1]?.body);
    assert.equal(calls[1]?.url, 'https://text.example/v1/chat/completions');
    assert.match(textBody, /source=sci-modality:protein\/esm2text-protein/);
    assert.doesNotMatch(textBody, /status=unsupported/);
  } finally {
    await server.close();
  }
});

test('input_object vision observations are cached across repeated Model Router requests for the same object', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-input-object-cache-'));
  const imageBytes = Buffer.from('repeated-input-object-pixels');
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-test'), { recursive: true });
  await writeFile(join(workspaceRoot, '.sciforge', 'uploads', 'session-test', 'desktop.png'), imageBytes);
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the screenshot shows a browser window and map UI.'),
      chatCompletion('text-final-first', JSON.stringify({ type: 'final_answer', content: 'It shows a browser window and map UI.' })),
      chatCompletion('text-final-second', JSON.stringify({ type: 'final_answer', content: 'The cached observation says it shows a browser window and map UI.' })),
    ]),
  });

  const requestBody = {
    model: 'sciforge-router',
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: '介绍这张截图' },
        {
          type: 'input_object',
          ref: '.sciforge/uploads/session-test/desktop.png',
          mimeType: 'image/png',
          title: 'desktop.png',
        },
      ],
    }],
  };

  try {
    const first = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(requestBody),
    });
    const second = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(requestBody),
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls.filter((call) => call.url === 'https://vision.example/v1/chat/completions').length, 1);
    assert.equal(calls.filter((call) => call.url === 'https://text.example/v1/chat/completions').length, 2);
    const secondTextReasonerBody = JSON.stringify(calls[2]?.body);
    assert.match(secondTextReasonerBody, /cached/i);
    assert.match(secondTextReasonerBody, /browser window and map UI/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"cacheStatus":\s*"hit"/);
    assert.match(traceText, /"cacheStatus":\s*"stored"/);
  } finally {
    await server.close();
  }
});

test('inline image vision observations are cached across repeated Model Router requests for the same image sha', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-inline-image-cache-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the hotel voucher total is 421.15 yuan.'),
      chatCompletion('text-final-first', JSON.stringify({ type: 'final_answer', content: 'It is a hotel voucher.' })),
      chatCompletion('text-final-second', JSON.stringify({ type: 'final_answer', content: 'The cached observation says the total is 421.15 yuan.' })),
    ]),
  });

  const requestBody = {
    model: 'sciforge-router',
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: '介绍图中内容' },
        { type: 'input_image', image_url: pngDataUrl, mime_type: 'image/png' },
      ],
    }],
  };

  try {
    const first = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(requestBody),
    });
    const second = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(requestBody),
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls.filter((call) => call.url === 'https://vision.example/v1/chat/completions').length, 1);
    assert.equal(calls.filter((call) => call.url === 'https://text.example/v1/chat/completions').length, 2);
    const secondTextReasonerBody = JSON.stringify(calls[2]?.body);
    assert.match(secondTextReasonerBody, /cache_status=hit/);
    assert.match(secondTextReasonerBody, /421\.15 yuan/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"cacheStatus":\s*"hit"/);
    assert.match(traceText, /"cacheStatus":\s*"stored"/);
    assert.doesNotMatch(traceText, /data:image|base64|tiny-png/i);
  } finally {
    await server.close();
  }
});

test('textual ask refs route through vision translator before text reasoner', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-textual-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the uploaded image shows a cell culture plate.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'It shows a cell culture plate.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'ask --ref .sciforge/uploads/img.png "What is shown?"',
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'It shows a cell culture plate.');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/chat/completions');
    assert.match(JSON.stringify(calls[0]?.body), /\.sciforge\/uploads\/img\.png/);
    assert.equal(calls[1]?.url, 'https://text.example/v1/chat/completions');
    assert.match(JSON.stringify(calls[1]?.body), /What is shown\?/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"source":\s*"ref"/);
    assert.match(traceText, /"ref":\s*"\.sciforge\/uploads\/img\.png"/);
    assert.doesNotMatch(traceText, /text-secret|vision-secret|text-provider|vision-provider|text-model|vision-model/i);
  } finally {
    await server.close();
  }
});

test('textual ask refs do not route non-visual artifacts through the vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-nonvisual-artifact-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The report ref needs a document-capable translator.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'ask --ref artifact:research-report "Summarize the report."',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    assert.doesNotMatch(JSON.stringify(calls[0]?.body), /vision-model|SciForge visual ref/i);
    const traceText = await readTraceBundle(workspaceRoot);
    assert.doesNotMatch(traceText, /"kind":\s*"vision\.image"/);
  } finally {
    await server.close();
  }
});

test('structured textual ref metadata beats chart and figure title keywords', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-textual-metadata-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'I could not inspect the referenced modality.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Summarize the attached notes.' },
            {
              ref: 'artifact:chart-figure-notes',
              title: 'Chart and figure notes',
              mime_type: 'text/plain',
            },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    assert.doesNotMatch(JSON.stringify(calls[0]?.body), /vision-model|SciForge visual ref/i);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"kind":\s*"document"/);
    assert.match(traceText, /"degraded":\s*true/);
    assert.doesNotMatch(traceText, /"kind":\s*"vision\.image"/);
  } finally {
    await server.close();
  }
});

test('structured image metadata routes opaque refs through the vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-opaque-image-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the opaque ref is an image.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The opaque ref is an image.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is shown?' },
            { ref: 'artifact:opaque-asset', media_type: 'image' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/chat/completions');
    assert.match(JSON.stringify(calls[0]?.body), /artifact:opaque-asset/);
    assert.equal(calls[1]?.url, 'https://text.example/v1/chat/completions');

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"kind":\s*"vision\.image"/);
    assert.match(traceText, /"source":\s*"ref"/);
  } finally {
    await server.close();
  }
});

test('unsupported explicit modality refs degrade without using the vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-unsupported-modality-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'I could not inspect the referenced audio modality.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'SciForge audio ref: artifacts/interview.wav\nTranscribe it.',
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'I could not inspect the referenced audio modality.');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    assert.match(JSON.stringify(calls[0]?.body), /status=unsupported/);
    assert.match(JSON.stringify(calls[0]?.body), /kind=audio/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"kind":\s*"audio"/);
    assert.match(traceText, /"degraded":\s*true/);
    assert.doesNotMatch(traceText, /text-secret|vision-secret|text-provider|vision-provider|text-model|vision-model/i);
  } finally {
    await server.close();
  }
});

test('textual ask refs route through vision translator when prefixed by continuation guidance', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-prefixed-textual-ref-'));
  await mkdir(join(workspaceRoot, '.sciforge/uploads/session-a'), { recursive: true });
  await writeFile(join(workspaceRoot, '.sciforge/uploads/session-a/panel.png'), Buffer.from('image-bytes'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the prefixed image shows a macOS desktop.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The prefixed image is visible.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          'Continue the active Runtime Codex session. Interpret relative references against the previous turn.\n\nask --ref ".sciforge/uploads/session-a/panel.png" "Describe it."',
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The prefixed image is visible.');
    assert.equal(calls[0]?.body.model, 'vision-model');
    assert.equal(calls[1]?.body.model, 'text-model');
  } finally {
    await server.close();
  }
});

test('unsafe textual refs are not routed or leaked upstream', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-unsafe-textual-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'I need a safe uploaded ref to inspect an image.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'ask --config .sciforge/uploads/not-a-ref.png --ref /Users/alice/private.png --ref https://private.example.test/secret.png "What is shown?"',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    assert.doesNotMatch(JSON.stringify(calls[0]?.body), /\/Users|private\.example|secret\.png|private\.png/i);
    assert.match(JSON.stringify(calls[0]?.body), /What is shown\?/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.doesNotMatch(traceText, /"source":\s*"ref"/);
    assert.doesNotMatch(traceText, /\/Users|private\.example|secret\.png|private\.png/i);
  } finally {
    await server.close();
  }
});

test('absolute trace roots do not leak local paths in public metadata trace refs', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-absolute-trace-workspace-'));
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-absolute-trace-root-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ traceRoot }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The text answer.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain trace refs.',
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      metadata?: { traceRef?: string };
    };
    assert.ok(body.metadata?.traceRef);
    assert.doesNotMatch(body.metadata.traceRef, /\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\//i);
    assert.doesNotMatch(body.metadata.traceRef, /^[A-Za-z]:\\/);
    assert.match(body.metadata.traceRef, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await server.close();
  }
});

test('profile and provider configuration failures fail closed before upstream calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-fail-closed-'));
  const calls: CapturedFetch[] = [];
  const rawPrivateProfile = 'https://private-profile.example/v1?token=secret-token';
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: {
      DEEPSEEK_GUI_MODEL_ROUTER_RUNTIME_API_KEY: 'runtime-secret',
      SCIFORGE_TEXT_API_KEY: 'text-secret',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, []),
  });

  try {
    const unknownProfile = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json', 'x-sciforge-model-router-profile': 'unknown' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(unknownProfile.status, 400);
    assert.match(await unknownProfile.text(), /unknown_profile/);

    const unsafeProfile = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json', 'x-sciforge-model-router-profile': rawPrivateProfile }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(unsafeProfile.status, 400);
    const unsafeProfileText = await unsafeProfile.text();
    assert.match(unsafeProfileText, /unknown_profile/);
    assert.doesNotMatch(unsafeProfileText, /private-profile|secret-token|https:\/\//i);

    const missingSecret = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello', metadata: { profile: 'default' } }),
    });
    assert.equal(missingSecret.status, 400);
    assert.match(await missingSecret.text(), /missing_secret/);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test('default public model alias rejects unregistered request models', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-default-alias-'));
  const calls: CapturedFetch[] = [];
  const rawPrivateModel = 'https://private-provider.example/v1/models/raw-model?token=secret-token';
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: null }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, []),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: rawPrivateModel, input: 'hello', metadata: { profile: 'default' } }),
    });

    assert.equal(response.status, 400);
    const text = await response.text();
    assert.match(text, /unregistered_model/);
    assert.doesNotMatch(text, /private-provider|raw-model|secret-token|https:\/\//i);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test('streaming vision responses expose only the final answer events', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-stream-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: private internal observation.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'Only the final answer.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        stream: true,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Describe it.' }, { type: 'input_image', image_url: pngDataUrl }] }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type')?.startsWith('text/event-stream'), true);
    const body = await response.text();
    assert.match(body, /Only the final answer/);
    assert.doesNotMatch(body, /private internal observation|data:image|base64/i);
    const events = parseSseEvents(body);
    const eventTypes = events.map((event) => event.type);
    assert.deepEqual(eventTypes, [
      'response.created',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    const messageItemId = events.find((event) => event.type === 'response.output_item.added')?.item?.id;
    assert.equal(events.find((event) => event.type === 'response.output_text.delta')?.item_id, messageItemId);
    assert.equal(events.find((event) => event.type === 'response.content_part.added')?.item_id, messageItemId);
  } finally {
    await server.close();
  }
});

test('streaming responses send response.created before upstream completion', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-stream-first-byte-'));
  const calls: CapturedFetch[] = [];
  let resolveProvider: (response: Response) => void = () => {};
  const providerResponse = new Promise<Response>((resolve) => {
    resolveProvider = resolve;
  });
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return providerResponse;
    },
  });

  const responsePromise = fetch(`${server.url}/v1/responses`, {
    method: 'POST',
    headers: runtimeHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      model: 'sciforge-router',
      stream: true,
      input: 'Return quickly.',
    }),
  });
  const firstChunkPromise = responsePromise.then(async (response) => {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type')?.startsWith('text/event-stream'), true);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const { value } = await reader.read();
    reader.releaseLock();
    return new TextDecoder().decode(value);
  });

  try {
    const firstChunk = await Promise.race([
      firstChunkPromise,
      new Promise<string>((resolve) => setTimeout(() => resolve('__timeout__'), 500)),
    ]);
    assert.notEqual(firstChunk, '__timeout__');
    assert.match(firstChunk, /response\.created/);
    assert.equal(calls.length, 1);
  } finally {
    resolveProvider(chatCompletion('text-first-byte', 'Late answer.'));
    await firstChunkPromise.catch(() => undefined);
    await server.close();
  }
});

test('image URL inputs are usable upstream but only hashed in traces', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-url-'));
  const privateImageUrl = 'https://private.example.test/figure.png?token=secret-token';
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the image URL resolved to a figure.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The figure is visible.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Describe it.' }, { type: 'input_image', image_url: privateImageUrl }] }],
      }),
    });

    assert.equal(response.status, 200);
    assert.match(JSON.stringify(calls[0]?.body), /private\.example\.test\/figure\.png/);
    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"source":\s*"url"/);
    assert.match(traceText, /"urlSha256":\s*"sha256:[a-f0-9]{64}"/);
    assert.doesNotMatch(traceText, /private\.example|secret-token|figure\.png/i);
    assert.doesNotMatch(traceText, /text-provider|vision-provider|text-model|vision-model/i);
  } finally {
    await server.close();
  }
});

test('text reasoner HTTP failures still write sanitized refs-first trace summaries', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-http-failure-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the referenced image is a plot.'),
      chatCompletion('vision-initial-absolute-ref', 'Observation: the absolute private ref was unavailable.'),
      chatCompletion('vision-initial-private-url-ref', 'Observation: the private URL ref was unavailable.'),
      Response.json({
        error: {
          message: 'provider failed with text-secret and raw prompt payload',
          request: { model: 'text-model', secret: 'text-secret' },
        },
      }, { status: 503 }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Explain the private figure.' },
            { type: 'input_image', ref: 'artifact:workspace/plots/figure-1.png', mime_type: 'image/png' },
            { type: 'input_image', ref: 'artifact:/Users/alice/private/absolute-secret.png', mime_type: 'image/png' },
            { type: 'input_image', ref: 'ref:https://private.example.test/private-panel.png', mime_type: 'image/png' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 500);
    assert.equal(calls.length, 4);
    const visionPrompt = calls.slice(0, 3).map((call) => JSON.stringify(call.body)).join('\n');
    assert.match(visionPrompt, /artifact:workspace\/plots\/figure-1\.png/);
    assert.match(visionPrompt, /sha256:[a-f0-9]{64}/);
    assert.doesNotMatch(visionPrompt, /\/Users|private\.example|absolute-secret|private-panel/i);

    const inputTrace = JSON.parse(await readSingleTraceFile(workspaceRoot, 'input-modalities.json')) as {
      modalities: Array<Record<string, unknown>>;
    };
    assert.equal(inputTrace.modalities[0]?.ref, 'artifact:workspace/plots/figure-1.png');
    assert.match(String(inputTrace.modalities[1]?.ref), /^sha256:[a-f0-9]{64}$/);
    assert.match(String(inputTrace.modalities[2]?.ref), /^sha256:[a-f0-9]{64}$/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"phase":\s*"text-control-or-final"/);
    assert.match(traceText, /"status":\s*"failed"/);
    assert.match(traceText, /"errorSummary":\s*"provider_http_503"/);
    assert.match(traceText, /"schemaVersion":\s*"sciforge\.model-router\.final-routing-summary\.v1"/);
    assert.doesNotMatch(traceText, /text-secret|vision-secret|raw prompt payload|text-provider|vision-provider|text-model|vision-model/i);
    assert.doesNotMatch(traceText, /\/Users|private\.example|absolute-secret|private-panel/i);
  } finally {
    await server.close();
  }
});

test('text reasoner exceptions still write sanitized failure traces', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-exception-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      throw new Error('socket exposed text-secret raw-payload-private prompt Explain SciForge');
    },
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge.',
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 500);
    assert.equal(calls.length, 1);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"phase":\s*"text-direct"/);
    assert.match(traceText, /"status":\s*"failed"/);
    assert.match(traceText, /"errorSummary":\s*"provider_exception"/);
    assert.match(traceText, /"schemaVersion":\s*"sciforge\.model-router\.final-routing-summary\.v1"/);
    assert.doesNotMatch(traceText, /text-secret|raw-payload-private|Explain SciForge|text-provider|text-model/i);
  } finally {
    await server.close();
  }
});

test('vision translator failures force an explicit image unavailable final answer', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-failure-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ error: { message: 'translator timeout with sk-should-not-leak' } }, { status: 504 }),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'Based on the text prompt, there is not enough information.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'What is in the image?' }, { type: 'input_image', image_url: pngDataUrl }] }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.match(String(body.output_text), /could not inspect the image/i);
    assert.doesNotMatch(String(body.output_text), /sk-should-not-leak|data:image|base64/i);
    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"degraded":\s*true/);
    assert.doesNotMatch(traceText, /sk-should-not-leak|data:image|base64/i);
    assert.doesNotMatch(traceText, /text-provider|vision-provider|text-model|vision-model/i);
  } finally {
    await server.close();
  }
});

type CapturedFetch = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

function testConfig(options: { traceRoot?: string; publicModelAlias?: string | null } = {}): ModelRouterConfig {
  const config: ModelRouterConfig = {
    defaultProfile: 'default',
    publicModelAlias: options.publicModelAlias === undefined ? 'sciforge-router' : undefined,
    profiles: {
      default: {
        traceRoot: options.traceRoot ?? '.sciforge/model-router-traces',
        textReasoner: {
          provider: 'text-provider',
          baseUrl: 'https://text.example/v1',
          apiKeyEnv: 'SCIFORGE_TEXT_API_KEY',
          model: 'text-model',
        },
        translators: {
          vision: {
            provider: 'vision-provider',
            baseUrl: 'https://vision.example/v1',
            apiKeyEnv: 'SCIFORGE_VISION_API_KEY',
            model: 'vision-model',
          },
        },
      },
    },
  };
  if (typeof options.publicModelAlias === 'string') config.publicModelAlias = options.publicModelAlias;
  return config;
}

function testEnv() {
  return {
    DEEPSEEK_GUI_MODEL_ROUTER_RUNTIME_API_KEY: 'runtime-secret',
    SCIFORGE_TEXT_API_KEY: 'text-secret',
    SCIFORGE_VISION_API_KEY: 'vision-secret',
  };
}

function runtimeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: 'Bearer runtime-secret',
    ...extra,
  };
}

function captureFetch(calls: CapturedFetch[], responses: Response[]): typeof fetch {
  return async (url, init) => {
    calls.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    const response = responses.shift();
    assert.ok(response, `Unexpected fetch call to ${url}`);
    return response;
  };
}

function parseSseEvents(body: string): Array<Record<string, any>> {
  return body
    .split(/\n\n+/)
    .map((chunk) => chunk.split(/\n/).find((line) => line.startsWith('data: '))?.slice('data: '.length))
    .filter((payload): payload is string => Boolean(payload) && payload !== '[DONE]')
    .map((payload) => JSON.parse(payload) as Record<string, any>);
}

function chatCompletion(
  id: string,
  content: string,
  toolCalls?: Array<Record<string, unknown>>,
  messageExtras: Record<string, unknown> = {},
  usage: Record<string, unknown> = {},
) {
  return Response.json({
    id,
    object: 'chat.completion',
    created: 1_717_171_717,
    model: id.includes('vision') ? 'vision-model' : 'text-model',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
        ...messageExtras,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls ? 'tool_calls' : 'stop',
    }],
    ...(Object.keys(usage).length ? { usage } : {}),
  });
}

async function readTraceBundle(workspaceRoot: string) {
  const root = join(workspaceRoot, '.sciforge/model-router-traces');
  const days = await readdir(root);
  const contents: string[] = [];
  for (const day of days.sort()) {
    const runs = await readdir(join(root, day));
    for (const run of runs.sort()) {
      const files = await readdir(join(root, day, run));
      contents.push(...await Promise.all(files.sort().map((file) => readFile(join(root, day, run, file), 'utf8'))));
    }
  }
  return contents.join('\n');
}

async function readSingleTraceFile(workspaceRoot: string, fileName: string) {
  const root = join(workspaceRoot, '.sciforge/model-router-traces');
  const days = await readdir(root);
  const runs = await readdir(join(root, days[0] ?? 'missing'));
  return await readFile(join(root, days[0] ?? 'missing', runs[0] ?? 'missing', fileName), 'utf8');
}

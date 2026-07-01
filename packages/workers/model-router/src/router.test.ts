import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_MODEL_ROUTER_TRACE_ROOT,
  startModelRouterServer as startModelRouterServerRaw,
  type ModelRouterConfig,
} from './router';

const pngDataUrl = `data:image/png;base64,${Buffer.from('tiny-png').toString('base64')}`;
const forbiddenPublicSurfacePattern =
  /text-secret|vision-secret|Authorization|Bearer|baseUrl|apiKeyEnv|SCIFORGE_TEXT_API_KEY|SCIFORGE_VISION_API_KEY|text-model|vision-model|text-provider|vision-provider|https:\/\/text\.example|https:\/\/vision\.example/i;

function startModelRouterServer(options: Parameters<typeof startModelRouterServerRaw>[0]) {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  return startModelRouterServerRaw({
    ...options,
    traceDataRoot: options.traceDataRoot ?? traceDataRootForWorkspace(workspaceRoot),
  });
}

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
    assert.equal(body.workerVersion, '0.1.0');
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

test('openai-compatible provider bases preserve query and hash suffixes when normalized', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-provider-base-query-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  config.profiles.default.textReasoner.baseUrl = 'https://text.example/openai/deployments/deepseek?api-version=2026-01-01#stable';
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The normalized base URL keeps its suffix.'),
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
    assert.equal(
      calls[0]?.url,
      'https://text.example/openai/deployments/deepseek/v1/chat/completions?api-version=2026-01-01#stable'
    );
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

test('public text preserves workspace-local paths while redacting external local paths', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-workspace-paths-'));
  const workspaceDataPath = join(workspaceRoot, 'data', 'input.h5ad');
  const privatePath = '/Users/alice/private/input.h5ad';
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', `Read ${workspaceDataPath} but never read ${privatePath}.`),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [{ role: 'user', content: 'generate code for the local dataset' }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.content?.[0]?.text, `Read ${workspaceDataPath} but never read [redacted-path].`);
    assert.doesNotMatch(String(body.content?.[0]?.text ?? ''), /\/Users\/alice/);
    assert.equal(calls.length, 1);
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

test('chat completions compatibility route returns OpenAI-shaped text choices', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-chat-compat-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The chat-compatible answer.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'hello' },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.object, 'chat.completion');
    assert.equal(body.choices?.[0]?.message?.role, 'assistant');
    assert.equal(body.choices?.[0]?.message?.content, 'The chat-compatible answer.');
    assert.equal(body.choices?.[0]?.finish_reason, 'stop');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    assert.equal(calls[0]?.body.messages?.[0]?.role, 'user');
    assert.match(JSON.stringify(calls[0]?.body.messages), /Be concise/);
    assert.match(JSON.stringify(calls[0]?.body.messages), /hello/);
  } finally {
    await server.close();
  }
});

test('chat completions compatibility route sends image_url inputs through vision routing', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-chat-vision-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the figure has readable labels.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The figure is readable.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Can this figure be read?' },
            { type: 'image_url', image_url: { url: pngDataUrl } },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.object, 'chat.completion');
    assert.equal(body.choices?.[0]?.message?.content, 'The figure is readable.');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/chat/completions');
    assert.match(JSON.stringify(calls[0]?.body), /data:image\/png;base64/);
    assert.equal(calls[1]?.url, 'https://text.example/v1/chat/completions');
    assert.equal(calls[1]?.body.max_tokens, 1024);
    assert.doesNotMatch(JSON.stringify(calls[1]?.body), /data:image|base64|tiny-png/i);
  } finally {
    await server.close();
  }
});

test('vision routing strips attachment base64 text fallbacks from provider prompts', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-fallback-strip-'));
  const calls: CapturedFetch[] = [];
  const secondImageUrl = `data:image/png;base64,${Buffer.from('second-image').toString('base64')}`;
  const fallbackBase64 = 'A'.repeat(8192);
  const fallbackText = [
    '[Attached image as base64 text]',
    'Name: duplicate-fallback.png',
    'MIME: image/png',
    'Dimensions: 100x80',
    'Bytes: 6144',
    'Base64:',
    '```base64',
    fallbackBase64,
    '```',
    '[/Attached image]',
  ].join('\n');
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial-a', 'Observation: first image.'),
      chatCompletion('vision-initial-b', 'Observation: second image.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'Both images were inspected.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect these images.' },
            { type: 'image_url', image_url: { url: pngDataUrl } },
            { type: 'image_url', image_url: { url: secondImageUrl } },
            { type: 'text', text: fallbackText },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.choices?.[0]?.message?.content, 'Both images were inspected.');
    assert.equal(calls.length, 3);
    assert.equal(imagePartCount(calls[0]?.body.messages), 1);
    assert.equal(imagePartCount(calls[1]?.body.messages), 1);
    assert.equal(imagePartCount(calls[2]?.body.messages), 0);
    assert.doesNotMatch(textOnlyJson(calls[0]?.body.messages), new RegExp(fallbackBase64));
    assert.doesNotMatch(textOnlyJson(calls[1]?.body.messages), new RegExp(fallbackBase64));
    assert.doesNotMatch(textOnlyJson(calls[2]?.body.messages), new RegExp(fallbackBase64));
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

test('anthropic messages request hygiene folds long tool argument arrays before provider calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-hygiene-args-'));
  const longIds = Array.from({ length: 80 }, (_, index) => `sample-${index}-${'z'.repeat(12)}`);
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-hygiene-args-final', 'Batch lookup already completed.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [
          {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'previous-batch',
              name: 'batch_lookup',
              input: { ids: longIds, mode: 'full' },
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'previous-batch',
              content: 'Lookup complete.',
            }],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const messages = calls[0]?.body.messages as Array<Record<string, any>>;
    const toolCall = messages[0]?.tool_calls?.[0] as Record<string, any>;
    const args = JSON.parse(String(toolCall.function.arguments)) as Record<string, any>;
    assert.equal(args.mode, 'full');
    assert.equal(Array.isArray(args.ids), false);
    assert.equal(args.ids.__sciforge_request_hygiene__.source, 'tool_call.arguments.ids');
    assert.equal(args.ids.__sciforge_request_hygiene__.reason, 'long_array');
    assert.equal(args.ids.__sciforge_request_hygiene__.originalItems, 80);
    assert.match(args.ids.__sciforge_request_hygiene__.digest, /^sha256:/);
    assert.ok(!JSON.stringify(calls[0]?.body).includes('sample-79-'));
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
    assert.equal(body.version, '0.1.0');
    assert.equal(body.transport, 'http');
    assert.deepEqual(body.health, {
      status: 'healthy',
      available: true,
    });
    assert.equal(body.recentError, null);
    assert.deepEqual(body.capabilities, [
      'model_router_responses',
      'model_router_messages',
      'text_reasoning',
      'vision_translation',
      'scientific_translation',
      'refs_first_trace',
    ]);
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
    assert.equal(body.version, '0.1.0');
    assert.equal(body.transport, 'http');
    assert.deepEqual(body.health, {
      status: 'unhealthy',
      available: false,
      reason: 'provider-auth',
    });
    assert.equal(body.recentError, 'provider-auth');
    assert.deepEqual(body.capabilities, [
      'model_router_responses',
      'model_router_messages',
      'text_reasoning',
      'vision_translation',
      'scientific_translation',
      'refs_first_trace',
    ]);
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

test('healthz reports recent provider auth failures after a routed request fails', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-recent-auth-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ error: { message: 'upstream key rejected' } }, { status: 401 }),
    ]),
  });

  try {
    const failed = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(failed.status, 401);
    const failedBody = await failed.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(failedBody.error?.code, 'provider_http_401');
    assert.match(failedBody.error?.message ?? '', /upstream provider credentials were rejected/i);
    assert.match(failedBody.error?.message ?? '', /Update the upstream API key in SciForge Model Router settings/i);
    assert.doesNotMatch(JSON.stringify(failedBody), forbiddenPublicSurfacePattern);

    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.ok, false);
    assert.deepEqual(body.health, {
      status: 'unhealthy',
      available: false,
      reason: 'provider-auth',
    });
    assert.equal(body.recentError, 'provider-auth');
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

test('healthz reports recent provider network failures after a routed request fails', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-network-'));
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
      throw new Error('network socket reset');
    },
  });

  try {
    const failed = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(failed.status, 500);
    const failedBody = await failed.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(failedBody.error?.code, 'provider_exception_network');

    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;

    assert.equal(body.recentError, 'provider-network');
    assert.deepEqual(body.upstream, {
      category: 'provider-network',
      ok: false,
      retryable: true,
      httpStatus: 500,
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('healthz reports recent provider bad responses after invalid upstream JSON', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-bad-response-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], [
      new Response('not json', { status: 200 }),
    ]),
  });

  try {
    const failed = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(failed.status, 500);
    const failedBody = await failed.json() as Record<string, { code?: string }>;
    assert.equal(failedBody.error?.code, 'provider_invalid_json');

    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;

    assert.equal(body.recentError, 'provider-bad-response');
    assert.deepEqual(body.upstream, {
      category: 'provider-bad-response',
      ok: false,
      retryable: false,
      httpStatus: 500,
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('healthz reports recent provider errors after non-auth upstream HTTP failures', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-provider-error-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], [
      Response.json({ error: { message: 'temporary upstream failure with sk-should-not-leak' } }, { status: 500 }),
    ]),
  });

  try {
    const failed = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(failed.status, 500);
    const failedBody = await failed.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(failedBody.error?.code, 'provider_http_500');
    assert.doesNotMatch(JSON.stringify(failedBody), /sk-should-not-leak/i);

    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;

    assert.equal(body.recentError, 'provider-error');
    assert.deepEqual(body.upstream, {
      category: 'provider-error',
      ok: false,
      retryable: true,
      httpStatus: 500,
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('healthz blocks missing vision translator credentials', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-missing-vision-auth-'));
  const env = testEnv();
  delete (env as Partial<typeof env>).SCIFORGE_VISION_API_KEY;
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env,
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.ok, false);
    assert.equal(body.recentError, 'provider-auth');
    assert.deepEqual(body.upstream, {
      category: 'provider-auth',
      ok: false,
      retryable: false,
      httpStatus: 401,
      role: 'visionTranslator',
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

test('relative trace roots resolve under trace data root instead of workspace symlinks', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-workspace-'));
  const symlinkTarget = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-symlink-target-'));
  await symlink(symlinkTarget, join(workspaceRoot, '.sciforge'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ traceRoot: '.sciforge/model-router-traces' }),
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
        input: 'Explain SciForge in one sentence.',
      }),
    });

    assert.equal(response.status, 200);
    await access(join(traceDataRootForWorkspace(workspaceRoot), '.sciforge/model-router-traces'));
    await assert.rejects(access(join(symlinkTarget, 'model-router-traces')));
  } finally {
    await server.close();
  }
});

test('trace roots inside the workspace are rejected', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-workspace-trace-root-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ traceRoot: join(workspaceRoot, 'model-router-traces') }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, []),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge in one sentence.',
      }),
    });

    assert.equal(response.status, 500);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, 'invalid_trace_root');
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test('pure text responses expose upstream reasoning content as a Responses reasoning item', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-reasoning-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion(
        'text-reasoner-answer',
        'The text answer.',
        undefined,
        { reasoning_content: 'Need a concise one sentence answer.' },
      ),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge in one sentence.',
        reasoning: { effort: 'high', summary: 'detailed' },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { output?: Array<Record<string, unknown>>; output_text?: string };
    assert.equal(body.output_text, 'The text answer.');
    assert.deepEqual(body.output?.map((item) => item.type), ['reasoning', 'message']);
    assert.deepEqual(body.output?.[0]?.summary, [{
      type: 'summary_text',
      text: 'Need a concise one sentence answer.',
    }]);
    assert.deepEqual(calls[0]?.body.reasoning, { effort: 'high', summary: 'detailed' });
    assert.equal(calls[0]?.body.reasoning_effort, 'high');
    assert.equal(calls[0]?.body.include_reasoning, true);
  } finally {
    await server.close();
  }
});

test('responses trace records sanitized handoff audit metadata without owning runtime lifecycle', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-handoff-audit-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-handoff-audit-final', 'The handoff continued through the router.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Continue from the runtime handoff packet.',
        metadata: {
          schemaVersion: 'sciforge.model-router.request-audit.v1',
          route: 'model-router.responses',
          source: 'agent-runtime-host',
          operation: 'runtime_handoff',
          runtimeId: 'claude',
          threadId: 'claude-thread-private-123',
          sourceRuntimeId: 'codex',
          sourceThreadId: 'codex-thread-private-456',
          targetRuntimeId: 'claude',
          targetThreadId: 'claude-thread-private-123',
          packetDigest: `sha256:${'a'.repeat(64)}`,
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"schemaVersion":\s*"sciforge\.model-router\.request-audit\.v1"/);
    assert.match(traceText, /"operation":\s*"runtime_handoff"/);
    assert.match(traceText, /"runtimeId":\s*"claude"/);
    assert.match(traceText, /"threadIdSha256":\s*"sha256:[a-f0-9]{64}"/);
    assert.match(traceText, /"sourceThreadIdSha256":\s*"sha256:[a-f0-9]{64}"/);
    assert.match(traceText, /"targetThreadIdSha256":\s*"sha256:[a-f0-9]{64}"/);
    assert.match(traceText, /"packetDigest":\s*"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/);
    assert.doesNotMatch(traceText, /claude-thread-private-123|codex-thread-private-456/);
    assert.doesNotMatch(traceText, /activeTurn|runtimeSession|threadLifecycle/i);
  } finally {
    await server.close();
  }
});

test('anthropic messages route through the text reasoner', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-anthropic-message-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: 'sciforge-router' }),
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
        model: 'sciforge-router',
        system: 'Answer tersely.',
        messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
        max_tokens: 64,
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.type, 'message');
    assert.equal(body.model, 'sciforge-router');
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
    config: testConfig({ publicModelAlias: 'sciforge-router' }),
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
        model: 'sciforge-router',
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

test('vision inputs fall back to text when the active profile has no vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-no-vision-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfigWithoutVision(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'I only have the text prompt.' })),
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
            { type: 'input_text', text: 'What is in this image?' },
            { type: 'input_image', image_url: pngDataUrl, mime_type: 'image/png' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.match(String(body.output_text), /image.*not sent/i);
    assert.match(String(body.output_text), /could not inspect the image/i);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    const textReasonerBody = JSON.stringify(calls[0]?.body);
    assert.match(textReasonerBody, /status=not_sent/);
    assert.match(textReasonerBody, /image payload was not sent/i);
    assert.doesNotMatch(textReasonerBody, /data:image|base64|tiny-png/i);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"status":\s*"not_sent"/);
    assert.match(traceText, /"degraded":\s*true/);
    assert.doesNotMatch(traceText, /text-secret|vision-secret|data:image|base64|tiny-png/i);
    assert.doesNotMatch(traceText, /text-provider|vision-provider|text-model|vision-model/i);
  } finally {
    await server.close();
  }
});

test('tool result screenshots fall back to safe text and are not sent without vision support', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-no-vision-tool-image-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfigWithoutVision(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'I can use the screenshot metadata only.' })),
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
            content: [{ type: 'input_text', text: 'Take a screenshot and tell me what you can.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_screenshot_1',
            name: 'computer_use',
            arguments: '{"action":"screenshot"}',
            reasoning_content: 'Need the current screen.',
          },
          {
            type: 'function_call_output',
            call_id: 'call_screenshot_1',
            output: JSON.stringify({
              kind: 'computer_screenshot',
              action: 'screenshot',
              screen: { width: 800, height: 600 },
              note: 'Screenshot captured at 800x600.',
              images: [{ mime_type: 'image/png', data_base64: Buffer.from('tiny-png').toString('base64'), width: 800, height: 600 }],
            }),
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.match(String(body.output_text), /image.*not sent/i);
    assert.equal(calls.length, 1);
    const textReasonerBody = JSON.stringify(calls[0]?.body);
    assert.match(textReasonerBody, /Screenshot captured at 800x600/);
    assert.match(textReasonerBody, /images_omitted/);
    assert.match(textReasonerBody, /status=not_sent/);
    assert.doesNotMatch(textReasonerBody, /data:image|base64|tiny-png/i);
    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"kind":\s*"vision\.image"/);
    assert.doesNotMatch(traceText, /data:image|base64|tiny-png/i);
  } finally {
    await server.close();
  }
});

test('standard MCP screenshot tool result routes through the vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-tool-result-vision-'));
  const imageData = Buffer.from('mcp-screen-pixels').toString('base64');
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the screenshot shows a settings window.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The screenshot shows a settings window.' })),
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
            content: [{ type: 'input_text', text: 'Inspect the screenshot from the tool.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_screenshot_2',
            name: 'computer_use',
            arguments: '{"action":"screenshot"}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_screenshot_2',
            output: {
              content: [
                { type: 'text', text: 'Screenshot captured at 1024x768.' },
                { type: 'image', data: imageData, mimeType: 'image/png' },
              ],
              structuredContent: {
                kind: 'computer_screenshot',
                action: 'screenshot',
                note: 'Screenshot captured at 1024x768.',
                images: [{ mime_type: 'image/png', width: 1024, height: 768 }],
                images_omitted: 1,
              },
            },
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The screenshot shows a settings window.');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/chat/completions');
    const visionBody = JSON.stringify(calls[0]?.body);
    assert.match(visionBody, new RegExp(`data:image/png;base64,${imageData}`));
    const textReasonerBody = JSON.stringify(calls[1]?.body);
    assert.match(textReasonerBody, /settings window/);
    assert.doesNotMatch(textReasonerBody, /mcp-screen-pixels|data:image|base64/i);
    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"kind":\s*"vision\.image"/);
    assert.doesNotMatch(traceText, /mcp-screen-pixels|data:image|base64/i);
  } finally {
    await server.close();
  }
});

test('Codex dynamic tool inputImage results route through the vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-codex-input-image-'));
  const imageData = Buffer.from('codex-dynamic-screen-pixels').toString('base64');
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the screenshot shows arXiv search results.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The screenshot shows arXiv search results.' })),
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
            content: [{ type: 'input_text', text: 'Inspect the screenshot from the dynamic tool.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_dynamic_screenshot_1',
            name: 'computer_use',
            arguments: '{"action":"screenshot"}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_dynamic_screenshot_1',
            output: {
              contentItems: [
                { type: 'inputText', text: 'Screenshot is 1280x831px.' },
                { type: 'inputImage', imageUrl: `data:image/png;base64,${imageData}` },
              ],
              success: true,
            },
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The screenshot shows arXiv search results.');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/chat/completions');
    const visionBody = JSON.stringify(calls[0]?.body);
    assert.match(visionBody, new RegExp(`data:image/png;base64,${imageData}`));
    const textReasonerBody = JSON.stringify(calls[1]?.body);
    assert.match(textReasonerBody, /arXiv search results/);
    assert.doesNotMatch(textReasonerBody, /codex-dynamic-screen-pixels|data:image|base64/i);
    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"kind":\s*"vision\.image"/);
    assert.doesNotMatch(traceText, /codex-dynamic-screen-pixels|data:image|base64/i);
  } finally {
    await server.close();
  }
});

test('Anthropic tool_result images route through the vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-anthropic-tool-image-'));
  const imageData = Buffer.from('claude-mcp-screen-pixels').toString('base64');
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the screenshot shows arXiv search results.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The screenshot shows arXiv search results.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Inspect the screenshot from computer_use.' }],
          },
          {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'toolu_screenshot_1',
              name: 'computer_use',
              input: { action: 'screenshot' },
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'toolu_screenshot_1',
              content: [
                { type: 'text', text: 'Screenshot is 1280x831px.' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: imageData,
                  },
                },
              ],
            }],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(body.content, [{ type: 'text', text: 'The screenshot shows arXiv search results.' }]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/chat/completions');
    assert.match(JSON.stringify(calls[0]?.body), new RegExp(`data:image/png;base64,${imageData}`));
    const textReasonerBody = JSON.stringify(calls[1]?.body);
    assert.match(textReasonerBody, /arXiv search results/);
    assert.doesNotMatch(textReasonerBody, /claude-mcp-screen-pixels|data:image|base64/i);
    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"kind":\s*"vision\.image"/);
    assert.doesNotMatch(traceText, /claude-mcp-screen-pixels|data:image|base64/i);
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
    const reasoning = body.output?.find((item) => item.type === 'reasoning');
    const toolCall = body.output?.find((item) => item.type === 'function_call');
    assert.deepEqual(reasoning?.summary, [{
      type: 'summary_text',
      text: 'Need to present the answer through the GUI tool.',
    }]);
    assert.deepEqual(toolCall, {
      id: toolCall?.id,
      type: 'function_call',
      status: 'completed',
      call_id: 'call_gui_present_1',
      name: 'gui_present',
      arguments: JSON.stringify({
        intent: 'show-result',
        content: { kind: 'markdown', value: 'Visible answer.' },
      }),
      reasoning_content: 'Need to present the answer through the GUI tool.',
    });
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

test('responses request hygiene folds pasted image data and giant tool outputs before provider calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-request-hygiene-tool-output-'));
  const imagePayload = Buffer.from('ordinary-text-image-payload'.repeat(80)).toString('base64');
  const pastedImage = `data:image/png;base64,${imagePayload}`;
  const giantToolOutput = [
    'BEGIN_GIANT_TOOL_OUTPUT',
    '<rows>',
    ...Array.from({ length: 180 }, (_, index) => `<row id="${index}">${'x'.repeat(90)}</row>`),
    '</rows>',
    pastedImage,
    'END_GIANT_TOOL_OUTPUT',
  ].join('\n');
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-hygiene-tool-output-final', 'Large tool output was summarized safely.'),
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
            content: [{ type: 'input_text', text: `Treat this pasted payload as plain text only: ${pastedImage}` }],
          },
          {
            type: 'function_call',
            call_id: 'call_giant_output',
            name: 'local_shell',
            arguments: '{"cmd":"emit-large-report"}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_giant_output',
            output: giantToolOutput,
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const serializedProviderBody = JSON.stringify(calls[0]?.body);
    assert.doesNotMatch(serializedProviderBody, /data:image\/png;base64/i);
    assert.ok(!serializedProviderBody.includes(imagePayload.slice(0, 80)));
    assert.ok(!serializedProviderBody.includes(giantToolOutput));
    assert.match(serializedProviderBody, /sciforge request_hygiene/);
    assert.match(serializedProviderBody, /source=user_message\.content/);
    assert.match(serializedProviderBody, /source=tool_message\.content/);
    assert.match(serializedProviderBody, /reason=large_tool_output/);
    assert.match(serializedProviderBody, /digest=sha256:/);

    const messages = calls[0]?.body.messages as Array<Record<string, unknown>>;
    const toolContent = String(messages[2]?.content ?? '');
    assert.ok(toolContent.length < 1_000, `expected folded tool content, got ${toolContent.length} chars`);
  } finally {
    await server.close();
  }
});

test('responses adjacent tool calls are forwarded as one assistant message', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-adjacent-tool-calls-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-tool-output-final', 'Both commands finished.'),
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
            content: [{ type: 'input_text', text: 'Run pwd and git status.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_pwd_1',
            name: 'local_shell',
            arguments: '{"cmd":"pwd"}',
            reasoning_content: 'Need the current directory.',
          },
          {
            type: 'function_call',
            call_id: 'call_git_status_1',
            name: 'local_shell',
            arguments: '{"cmd":"git status --short"}',
            reasoning_content: 'Need the worktree status.',
          },
          {
            type: 'function_call_output',
            call_id: 'call_pwd_1',
            output: '/tmp/workspace\n',
          },
          {
            type: 'function_call_output',
            call_id: 'call_git_status_1',
            output: ' M package.json\n',
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
        role: 'user',
        content: 'Run pwd and git status.',
      },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'Need the current directory.\nNeed the worktree status.',
        tool_calls: [
          {
            id: 'call_pwd_1',
            type: 'function',
            function: {
              name: 'local_shell',
              arguments: '{"cmd":"pwd"}',
            },
          },
          {
            id: 'call_git_status_1',
            type: 'function',
            function: {
              name: 'local_shell',
              arguments: '{"cmd":"git status --short"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_pwd_1',
        content: '/tmp/workspace\n',
      },
      {
        role: 'tool',
        tool_call_id: 'call_git_status_1',
        content: ' M package.json\n',
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

test('responses tool transcript drops orphan tool outputs before provider calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-orphan-tool-output-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-orphan-output-final', 'Ignored orphan tool output and answered the user.'),
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
            content: [{ type: 'input_text', text: 'Continue safely.' }],
          },
          {
            type: 'function_call_output',
            call_id: 'call_missing',
            output: 'This output has no matching function_call.',
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Answer from valid context only.' }],
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
        role: 'user',
        content: 'Continue safely.',
      },
      {
        role: 'user',
        content: 'Answer from valid context only.',
      },
    ]);
  } finally {
    await server.close();
  }
});

test('responses assistant output text history is normalized for chat providers', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-output-text-history-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-output-text-history', 'Continued after assistant history.'),
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
            content: [{ type: 'input_text', text: 'First prompt.' }],
          },
          {
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Earlier answer.' }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Continue.' }],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const providerPayload = JSON.stringify(calls[0]?.body.messages);
    assert.doesNotMatch(providerPayload, /output_text/);
    assert.match(providerPayload, /First prompt\.\\nEarlier answer\.\\nContinue\./);
  } finally {
    await server.close();
  }
});

test('responses tool transcript removes bridge items between tool calls and outputs', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-tool-bridge-repair-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-tool-bridge-final', 'Tool transcript remained provider-compatible.'),
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
            content: [{ type: 'input_text', text: 'Run pwd.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_pwd_bridge',
            name: 'local_shell',
            arguments: '{"cmd":"pwd"}',
          },
          {
            role: 'assistant',
            content: [{ type: 'output_text', text: 'GUI-only bridge text should not split tool messages.' }],
          },
          {
            type: 'approval',
            id: 'approval_bridge',
            status: 'allowed',
          },
          {
            type: 'function_call_output',
            call_id: 'call_pwd_bridge',
            output: '/tmp/workspace\n',
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
        role: 'user',
        content: 'Run pwd.',
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_pwd_bridge',
          type: 'function',
          function: {
            name: 'local_shell',
            arguments: '{"cmd":"pwd"}',
          },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'call_pwd_bridge',
        content: '/tmp/workspace\n',
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
    const firstFunctionCall = firstBody.output?.find((item) => item.type === 'function_call');
    assert.equal(firstFunctionCall?.reasoning_content, 'Need to run date before answering.');

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

test('responses assistant text history preserves reasoning_content for thinking providers', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-assistant-reasoning-history-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final-after-clarification', JSON.stringify({
        type: 'final_answer',
        content: 'Use a small demo reproduction.'
      })),
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
            content: [{ type: 'input_text', text: 'Plan the DeepSeek-R1 reproduction.' }],
          },
          {
            role: 'assistant',
            content: 'What scale should the reproduction target?',
            reasoning_content: 'Need to clarify reproduction scope before planning.',
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Make it a small demo.' }],
          },
        ],
        reasoning: { effort: 'high' },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(
      (calls[0]?.body.messages as Array<Record<string, unknown>> | undefined)?.[1]?.reasoning_content,
      'Need to clarify reproduction scope before planning.'
    );
  } finally {
    await server.close();
  }
});

test('responses tool outputs expose provider 400 bodies without retry-side request mutation', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-tool-http-400-'));
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

    assert.equal(response.status, 400);
    const body = await response.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(body.error?.code, 'provider_http_400');
    assert.match(body.error?.message ?? '', /reasoning_content/);
    assert.equal(calls.length, 1);
    assert.equal(
      (calls[0]?.body.messages as Array<Record<string, unknown>> | undefined)?.[1]?.reasoning_content,
      undefined
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

test('streaming text responses emit reasoning items before final answer text', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-stream-reasoning-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], [
      chatCompletion(
        'text-reasoning-stream',
        'The streamed answer.',
        undefined,
        { reasoning_content: 'Need to answer briefly.' },
      ),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        stream: true,
        input: 'Answer briefly.',
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.text();
    const events = parseSseEvents(body);
    assert.deepEqual(events.map((event) => event.type), [
      'response.created',
      'response.output_item.added',
      'response.output_item.done',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    assert.equal(events[1]?.item?.type, 'reasoning');
    assert.deepEqual(events[1]?.item?.summary, [{
      type: 'summary_text',
      text: 'Need to answer briefly.',
    }]);
    assert.equal(events[5]?.output_index, 1);
    assert.equal(events[5]?.delta, 'The streamed answer.');
    assert.deepEqual(events.find((event) => event.type === 'response.completed')?.response?.output?.map((item: Record<string, unknown>) => item.type), [
      'reasoning',
      'message',
    ]);
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

test('scientific file uploads are translated to evidence via the managed sci-modality worker', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-scimodality-'));
  const fasta = '>sp|P0CG48|UBC_HUMAN\nMQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG\n';
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-sci'), { recursive: true });
  await writeFile(join(workspaceRoot, '.sciforge', 'uploads', 'session-sci', 'ubiquitin.fasta'), fasta);
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: {
      ...testEnv(),
      SCIFORGE_SCIMODALITY_SERVICE_URL: 'http://sci-modality.example:3898',
      SCIFORGE_SCIMODALITY_SERVICE_TOKEN: 'sci-modality-runtime-token',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      // 1) managed sci-modality worker translate (stubbed in this unit test).
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
    assert.equal(calls[0]?.headers.authorization, 'Bearer sci-modality-runtime-token');
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

test('workspace file materialization rejects symlink escapes before provider calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-symlink-'));
  const outsideRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-outside-'));
  const outsideSecretPath = join(outsideRoot, 'secret.fasta');
  await writeFile(outsideSecretPath, '>secret\nSHOULD_NOT_LEAK_TO_PROVIDER\n');
  const uploadDir = join(workspaceRoot, '.sciforge', 'uploads', 'session-sci');
  await mkdir(uploadDir, { recursive: true });
  await symlink(outsideSecretPath, join(uploadDir, 'secret.fasta'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: {
      ...testEnv(),
      SCIFORGE_SCIMODALITY_SERVICE_URL: 'http://sci-modality.example:3898',
      SCIFORGE_SCIMODALITY_SERVICE_TOKEN: 'sci-modality-runtime-token',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'No readable in-workspace evidence.' })),
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
            { type: 'input_object', ref: '.sciforge/uploads/session-sci/secret.fasta', mimeType: 'text/plain', title: 'secret.fasta' },
          ],
        }],
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    assert.doesNotMatch(JSON.stringify(calls[0]?.body), /SHOULD_NOT_LEAK_TO_PROVIDER/);
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
      SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'runtime-secret',
      SCIFORGE_VISION_API_KEY: 'vision-secret',
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

    assert.equal(response.status, 503);
    const responseBody = await response.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(responseBody.error?.code, 'provider_http_503');
    assert.match(responseBody.error?.message ?? '', /Provider returned HTTP 503/);
    assert.doesNotMatch(responseBody.error?.message ?? '', /text-secret|text-model/i);
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
    assert.match(traceText, /"errorSummary":\s*"provider_exception_(?:fetch_failed|network)"/);
    assert.match(traceText, /"schemaVersion":\s*"sciforge\.model-router\.final-routing-summary\.v1"/);
    assert.doesNotMatch(traceText, /text-secret|raw-payload-private|Explain SciForge|text-provider|text-model/i);
  } finally {
    await server.close();
  }
});

test('text reasoner invalid JSON failures preserve safe provider diagnostics', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-invalid-json-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      new Response('not json with text-secret raw prompt payload', { status: 200 }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge.',
      }),
    });

    assert.equal(response.status, 500);
    const responseBody = await response.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(responseBody.error?.code, 'provider_invalid_json');
    assert.match(responseBody.error?.message ?? '', /non-JSON response/);
    assert.doesNotMatch(responseBody.error?.message ?? '', /text-secret|raw prompt payload|Explain SciForge|text-model/i);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"phase":\s*"text-direct"/);
    assert.match(traceText, /"status":\s*"failed"/);
    assert.match(traceText, /"errorSummary":\s*"provider_invalid_json"/);
    assert.doesNotMatch(traceText, /text-secret|raw prompt payload|Explain SciForge|text-provider|text-model/i);
  } finally {
    await server.close();
  }
});

test('text reasoner provider error payloads are classified without leaking body text', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-error-payload-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({
        error: {
          message: 'provider returned text-secret raw prompt payload for Explain SciForge',
          request: { model: 'text-model' },
        },
      }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge.',
      }),
    });

    assert.equal(response.status, 500);
    const responseBody = await response.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(responseBody.error?.code, 'provider_error_payload');
    assert.match(responseBody.error?.message ?? '', /error payload/);
    assert.doesNotMatch(responseBody.error?.message ?? '', /text-secret|raw prompt payload|Explain SciForge|text-model/i);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"phase":\s*"text-direct"/);
    assert.match(traceText, /"status":\s*"failed"/);
    assert.match(traceText, /"errorSummary":\s*"provider_error_payload"/);
    assert.doesNotMatch(traceText, /text-secret|raw prompt payload|Explain SciForge|text-provider|text-model/i);
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

test('vision translator auth failures are visible in healthz after text fallback', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-auth-failure-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ error: { message: 'vision key rejected with sk-should-not-leak' } }, { status: 401 }),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'Based on the text prompt, there is not enough information.' })),
    ]),
  });

  try {
    const routed = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'What is in the image?' }, { type: 'input_image', image_url: pngDataUrl }] }],
      }),
    });

    assert.equal(routed.status, 200);
    const routedBody = await routed.json() as Record<string, unknown>;
    assert.match(String(routedBody.output_text), /could not inspect the image/i);
    assert.doesNotMatch(String(routedBody.output_text), /sk-should-not-leak|data:image|base64/i);

    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.ok, false);
    assert.equal(body.recentError, 'provider-auth');
    assert.deepEqual(body.upstream, {
      category: 'provider-auth',
      ok: false,
      retryable: false,
      httpStatus: 401,
      role: 'visionTranslator',
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(serialized, forbiddenPublicSurfacePattern);
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
        traceRoot: options.traceRoot ?? DEFAULT_MODEL_ROUTER_TRACE_ROOT,
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

function testConfigWithoutVision(options: { traceRoot?: string; publicModelAlias?: string | null } = {}): ModelRouterConfig {
  const config = testConfig(options);
  config.profiles.default.translators = {};
  return config;
}

function testEnv() {
  return {
    SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'runtime-secret',
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

function imagePartCount(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + imagePartCount(item), 0);
  if (!value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const ownImagePart = record.type === 'image_url' || record.image_url !== undefined ? 1 : 0;
  return ownImagePart + Object.values(record).reduce((sum, item) => sum + imagePartCount(item), 0);
}

function textOnlyJson(value: unknown): string {
  return JSON.stringify(stripImagePayloads(value));
}

function stripImagePayloads(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripImagePayloads);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.type === 'image_url' || record.image_url !== undefined) return { type: 'image_url', image_url: '[omitted]' };
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, stripImagePayloads(entry)]));
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
  const root = defaultTraceRootForWorkspace(workspaceRoot);
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
  const root = defaultTraceRootForWorkspace(workspaceRoot);
  const days = await readdir(root);
  const runs = await readdir(join(root, days[0] ?? 'missing'));
  return await readFile(join(root, days[0] ?? 'missing', runs[0] ?? 'missing', fileName), 'utf8');
}

function traceDataRootForWorkspace(workspaceRoot: string): string {
  return join(dirname(workspaceRoot), `${basename(workspaceRoot)}-model-router-data`);
}

function defaultTraceRootForWorkspace(workspaceRoot: string): string {
  return join(traceDataRootForWorkspace(workspaceRoot), DEFAULT_MODEL_ROUTER_TRACE_ROOT);
}

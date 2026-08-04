import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  UpstreamProtocolNegotiator,
  UpstreamRequestError,
  buildUpstreamEndpointUrl,
  isDefinitiveProtocolRejection,
  type UpstreamWireProtocol,
  type UpstreamTraceAttemptStart,
} from './upstream-drivers';

const request = {
  model: 'configured-model',
  input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
  tools: [{
    type: 'function',
    name: 'lookup',
    description: 'Look something up.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  }],
  tool_choice: 'auto',
  max_tokens: 128,
};

test('prefers the incoming Responses wire and caches it by base URL plus model', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const fetchImpl = captureFetch(calls, [responsesResult('first'), responsesResult('second')]);

  const first = await negotiator.request({
    request,
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl,
    preferredProtocol: 'responses',
  });
  const second = await negotiator.request({
    request,
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl,
    preferredProtocol: 'anthropic-messages',
  });

  assert.equal(first.protocol, 'responses');
  assert.equal(second.protocol, 'responses');
  assert.equal(negotiator.cachedProtocol('https://models.example/v1', 'configured-model'), 'responses');
  assert.deepEqual(calls.map((call) => call.url), [
    'https://models.example/v1/responses',
    'https://models.example/v1/responses',
  ]);
  assert.equal(calls[0]?.body.model, 'configured-model');
  assert.equal(calls[0]?.body.max_output_tokens, 128);
  assert.equal(calls[0]?.body.max_tokens, undefined);
  assert.equal(calls[0]?.headers.authorization, 'Bearer secret');
});

test('falls back only after a definitive rejection and reuses the successful driver', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const fetchImpl = captureFetch(calls, [
    Response.json({ error: { type: 'unsupported_endpoint', message: 'Responses endpoint is unsupported.' } }, { status: 404 }),
    chatResult('chat-first'),
    chatResult('chat-cached'),
  ]);

  const first = await negotiator.request({
    request,
    baseUrl: 'https://models.example',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl,
    preferredProtocol: 'responses',
  });
  const second = await negotiator.request({
    request,
    baseUrl: 'https://models.example',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl,
    preferredProtocol: 'responses',
  });

  assert.equal(first.protocol, 'chat-completions');
  assert.equal(second.protocol, 'chat-completions');
  assert.deepEqual(calls.map((call) => call.url), [
    'https://models.example/v1/responses',
    'https://models.example/v1/chat/completions',
    'https://models.example/v1/chat/completions',
  ]);
  assert.equal(Array.isArray(calls[1]?.body.messages), true);
  assert.equal((calls[1]?.body.tools as Array<Record<string, unknown>>)[0]?.type, 'function');
});

test('probes protocols before the first automatic request and caches the supported route', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const fetchImpl = captureFetch(calls, [
    Response.json({
      error: {
        message: 'not implemented',
        type: 'new_api_error',
        code: 'convert_request_failed',
      },
    }, { status: 500 }),
    chatResult('chat-probe'),
    chatResult('chat-first'),
    chatResult('chat-cached'),
  ]);

  const first = await negotiator.request({
    request,
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    compatibility: { probeBeforeUse: true },
    fetchImpl,
    preferredProtocol: 'responses',
  });
  const second = await negotiator.request({
    request,
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    compatibility: { probeBeforeUse: true },
    fetchImpl,
    preferredProtocol: 'responses',
  });

  assert.equal(first.protocol, 'chat-completions');
  assert.equal(second.protocol, 'chat-completions');
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    '/v1/responses',
    '/v1/chat/completions',
    '/v1/chat/completions',
    '/v1/chat/completions',
  ]);
  assert.equal(calls[0]?.body.max_output_tokens, 1);
  assert.equal(calls[1]?.body.max_tokens, 1);
  assert.equal(calls[2]?.body.max_tokens, 128);
  assert.doesNotMatch(JSON.stringify(calls.slice(0, 2).map((call) => call.body)), /hello/u);
});

test('times out an upstream request at the protocol boundary', async () => {
  const negotiator = new UpstreamProtocolNegotiator();
  const fetchImpl: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });
  const keepAlive = setTimeout(() => undefined, 100);
  try {
    await assert.rejects(
      negotiator.request({
        request,
        baseUrl: 'https://models.example/v1',
        apiKey: 'secret',
        model: 'configured-model',
        fetchImpl,
        preferredProtocol: 'responses',
        timeoutMs: 10,
      }),
      (error: unknown) => error instanceof UpstreamRequestError && error.code === 'upstream_timeout',
    );
  } finally {
    clearTimeout(keepAlive);
  }
});

test('falls back after a structured conversion failure before model output', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const conversionFailure = Response.json({
    error: {
      message: 'not implemented',
      type: 'new_api_error',
      code: 'convert_request_failed',
    },
  }, { status: 500 });
  const result = await negotiator.request({
    request,
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl: captureFetch(calls, [conversionFailure, chatResult('fallback')]),
    preferredProtocol: 'responses',
  });
  assert.equal(result.protocol, 'chat-completions');
  assert.deepEqual(calls.map((call) => call.url), [
    'https://models.example/v1/responses',
    'https://models.example/v1/chat/completions',
  ]);
});

test('observes every actual fallback attempt with prepared request and raw response bytes', async () => {
  const attempts: Array<{
    request: UpstreamTraceAttemptStart;
    status?: number;
    chunks: Uint8Array[];
    error?: unknown;
    ended?: { status?: number; durationMs: number };
  }> = [];
  const negotiator = new UpstreamProtocolNegotiator();
  await negotiator.request({
    request,
    baseUrl: 'https://models.example',
    apiKey: 'opaque-secret',
    model: 'configured-model',
    fetchImpl: captureFetch([], [
      Response.json({ error: { message: 'unsupported endpoint' } }, { status: 404 }),
      chatResult('fallback-success'),
    ]),
    preferredProtocol: 'responses',
    traceAttempt: (prepared) => {
      const attempt = { request: prepared, chunks: [] as Uint8Array[] };
      attempts.push(attempt);
      return {
        responseHeaders(status) {
          attempt.status = status;
        },
        responseChunk(_index, chunk) {
          attempt.chunks.push(Uint8Array.from(chunk));
        },
        error(error) {
          attempt.error = error;
        },
        end(result) {
          attempt.ended = result;
        },
      };
    },
  });

  assert.deepEqual(attempts.map((attempt) => attempt.request.protocol), [
    'responses',
    'chat-completions',
  ]);
  assert.deepEqual(attempts.map((attempt) => attempt.status), [404, 200]);
  assert.equal(attempts[0]?.request.headers.authorization, 'Bearer opaque-secret');
  assert.equal(attempts[1]?.request.body.model, 'configured-model');
  assert.match(Buffer.concat(attempts[0]?.chunks.map((chunk) => Buffer.from(chunk)) ?? []).toString(), /unsupported endpoint/);
  assert.match(Buffer.concat(attempts[1]?.chunks.map((chunk) => Buffer.from(chunk)) ?? []).toString(), /fallback-success/);
  assert.ok(attempts[0]?.error instanceof UpstreamRequestError);
  assert.equal(attempts[1]?.error, undefined);
  assert.deepEqual(attempts.map((attempt) => attempt.ended?.status), [404, 200]);
});

test('invalidates a cached protocol only on definitive incompatibility', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const fetchImpl = captureFetch(calls, [
    Response.json({ error: { message: 'route not found' } }, { status: 404 }),
    chatResult('chat'),
    Response.json({ error: { message: 'unsupported media type' } }, { status: 415 }),
    anthropicResult('anthropic'),
  ]);

  await negotiator.request({
    request,
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl,
    preferredProtocol: 'responses',
  });
  const result = await negotiator.request({
    request,
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl,
    preferredProtocol: 'anthropic-messages',
  });

  assert.equal(result.protocol, 'anthropic-messages');
  assert.equal(negotiator.cachedProtocol('https://models.example/v1', 'configured-model'), 'anthropic-messages');
  assert.deepEqual(calls.map((call) => call.url), [
    'https://models.example/v1/responses',
    'https://models.example/v1/chat/completions',
    'https://models.example/v1/chat/completions',
    'https://models.example/v1/messages',
  ]);
});

test('never resubmits a prompt after auth, quota, rate-limit, timeout, 5xx, or ambiguous 400 failures', async (context) => {
  const cases: Array<{
    name: string;
    response?: Response;
    error?: Error;
    expectedCode: string;
  }> = [
    { name: 'auth', response: Response.json({ error: { message: 'invalid API key' } }, { status: 401 }), expectedCode: 'upstream_http_401' },
    { name: 'quota', response: Response.json({ error: { message: 'quota exhausted' } }, { status: 402 }), expectedCode: 'upstream_http_402' },
    { name: 'rate limit', response: Response.json({ error: { message: 'too many requests' } }, { status: 429 }), expectedCode: 'upstream_http_429' },
    { name: 'server failure', response: Response.json({ error: { message: 'temporary failure' } }, { status: 503 }), expectedCode: 'upstream_http_503' },
    { name: 'ordinary bad parameter', response: Response.json({ error: { message: 'invalid parameter temperature' } }, { status: 400 }), expectedCode: 'upstream_http_400' },
    { name: 'timeout', error: new Error('request timed out'), expectedCode: 'upstream_timeout' },
  ];

  for (const entry of cases) {
    await context.test(entry.name, async () => {
      let callCount = 0;
      const negotiator = new UpstreamProtocolNegotiator();
      const fetchImpl: typeof fetch = async () => {
        callCount += 1;
        if (entry.error) throw entry.error;
        return entry.response as Response;
      };
      await assert.rejects(
        negotiator.request({
          request,
          baseUrl: 'https://models.example/v1',
          apiKey: 'secret',
          model: 'configured-model',
          fetchImpl,
          preferredProtocol: 'responses',
        }),
        (error: unknown) => error instanceof UpstreamRequestError && error.code === entry.expectedCode,
      );
      assert.equal(callCount, 1);
    });
  }
});

test('classifies protocol rejection from status and structured conversion errors', () => {
  assert.equal(isDefinitiveProtocolRejection(404), true);
  assert.equal(isDefinitiveProtocolRejection(405), true);
  assert.equal(isDefinitiveProtocolRejection(415), true);
  assert.equal(isDefinitiveProtocolRejection(400), false);
  assert.equal(isDefinitiveProtocolRejection(422), false);
  assert.equal(isDefinitiveProtocolRejection(500), false);
  assert.equal(isDefinitiveProtocolRejection(500, JSON.stringify({
    error: {
      code: 'convert_request_failed',
      message: 'not implemented',
    },
  })), true);
  assert.equal(isDefinitiveProtocolRejection(500, JSON.stringify({
    error: {
      code: 'provider_failure',
      message: 'temporary failure',
    },
  })), false);
});

test('preserves versioned API roots when appending protocol paths', () => {
  assert.equal(
    buildUpstreamEndpointUrl(
      'https://api.example/v1beta/gateway',
      'chat/completions',
    ),
    'https://api.example/v1beta/gateway/chat/completions',
  );
  assert.equal(
    buildUpstreamEndpointUrl(
      'https://api.example/v1beta/gateway/responses?key=opaque',
      'chat/completions',
    ),
    'https://api.example/v1beta/gateway/chat/completions?key=opaque',
  );
});

test('allowedProtocols is the only wire-negotiation boundary', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  await assert.rejects(
    negotiator.request({
      request,
      baseUrl: 'https://models.example/v1',
      apiKey: 'secret',
      model: 'configured-model',
      compatibility: {
        preferredProtocol: 'chat-completions',
        allowedProtocols: ['chat-completions', 'responses'],
      },
      fetchImpl: captureFetch(calls, [
        Response.json({ error: { code: 'route_not_found' } }, { status: 404 }),
        Response.json({ error: { code: 'route_not_found' } }, { status: 404 }),
      ]),
      preferredProtocol: 'anthropic-messages',
    }),
    (error: unknown) => error instanceof UpstreamRequestError && error.definitiveRejection,
  );

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    '/v1/chat/completions',
    '/v1/responses',
  ]);
});

test('explicit protocol profiles control negotiation and isolate cache entries', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const chatCompatibility = {
    preferredProtocol: 'chat-completions' as const,
    allowedProtocols: ['chat-completions' as const],
  };
  const responsesCompatibility = {
    preferredProtocol: 'responses' as const,
    allowedProtocols: ['responses' as const],
  };

  const chat = await negotiator.request({
    request,
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: chatCompatibility,
    fetchImpl: captureFetch(calls, [chatResult('chat')]),
    preferredProtocol: 'responses',
  });
  const responses = await negotiator.request({
    request,
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: responsesCompatibility,
    fetchImpl: captureFetch(calls, [responsesResult('responses')]),
    preferredProtocol: 'chat-completions',
  });

  assert.equal(chat.protocol, 'chat-completions');
  assert.equal(responses.protocol, 'responses');
  assert.equal(
    negotiator.cachedProtocol('https://models.example/v1', 'neutral-model', chatCompatibility),
    'chat-completions',
  );
  assert.equal(
    negotiator.cachedProtocol('https://models.example/v1', 'neutral-model', responsesCompatibility),
    'responses',
  );
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    '/v1/chat/completions',
    '/v1/responses',
  ]);
});

test('structured 2xx Responses errors fall back only before any output or ambiguous data', async () => {
  const cleanError = sse([['response.failed', {
    type: 'response.failed',
    error: { code: 'unsupported_endpoint', message: '任意文案' },
  }]]);
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const result = await negotiator.request({
    request: { ...request, stream: true },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    fetchImpl: captureFetch(calls, [cleanError, chatResult('fallback')]),
    preferredProtocol: 'responses',
  });
  assert.equal(result.protocol, 'chat-completions');
  assert.equal(calls.length, 2);

  for (const firstEvent of [
    ['response.output_text.delta', { type: 'response.output_text.delta', delta: 'partial' }],
    ['provider.unknown', { type: 'provider.unknown', data: 'opaque' }],
  ] as Array<[string, Record<string, unknown>]>) {
    let attempts = 0;
    const terminal = new UpstreamProtocolNegotiator();
    await assert.rejects(
      terminal.request({
        request: { ...request, stream: true },
        baseUrl: 'https://models.example/v1',
        apiKey: 'secret',
        model: 'neutral-model',
        fetchImpl: async () => {
          attempts += 1;
          return sse([
            firstEvent,
            ['response.failed', {
              type: 'response.failed',
              error: { code: 'unsupported_endpoint', message: '任意文案' },
            }],
          ]);
        },
        preferredProtocol: 'responses',
      }),
      (error: unknown) => error instanceof UpstreamRequestError
        && error.code === 'upstream_error_payload'
        && !error.definitiveRejection,
    );
    assert.equal(attempts, 1);
  }
});

test('completed Responses payloads with error null remain successful in non-stream and stream modes', async () => {
  const completed = {
    id: 'resp_visual_evidence',
    object: 'response',
    created_at: 1_775_000_000,
    status: 'completed',
    error: null,
    incomplete_details: null,
    model: 'configured-model',
    output: [
      {
        id: 'msg_visual_evidence',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{
          type: 'output_text',
          annotations: [],
          text: '{"summary":"Grounded visual evidence","claims":[{"artifactId":"source"}]}',
        }],
      },
    ],
    output_text: '{"summary":"Grounded visual evidence","claims":[{"artifactId":"source"}]}',
    usage: {
      input_tokens: 128,
      output_tokens: 32,
      total_tokens: 160,
    },
  };

  for (const stream of [false, true]) {
    let calls = 0;
    const result = await new UpstreamProtocolNegotiator().request({
      request: { ...request, stream },
      baseUrl: `https://responses-null-error-${stream ? 'stream' : 'json'}.example/v1`,
      apiKey: 'secret',
      model: 'configured-model',
      compatibility: {
        preferredProtocol: 'responses',
        allowedProtocols: ['responses'],
      },
      fetchImpl: async () => {
        calls += 1;
        return stream
          ? sse([['response.completed', {
            type: 'response.completed',
            response: completed,
          }]])
          : Response.json(completed);
      },
      preferredProtocol: 'responses',
    });

    assert.equal(result.protocol, 'responses');
    assert.equal(result.response.status, 'completed');
    assert.equal(result.response.error, null);
    assert.equal(result.response.output_text, completed.output_text);
    assert.equal(calls, 1);
  }
});

test('Responses payloads with real error objects remain explicit failures', async () => {
  const failed = {
    id: 'resp_failed',
    object: 'response',
    status: 'failed',
    error: {
      code: 'provider_error',
      message: 'The provider rejected the request.',
    },
    output: [],
  };

  for (const stream of [false, true]) {
    let calls = 0;
    await assert.rejects(
      new UpstreamProtocolNegotiator().request({
        request: { ...request, stream },
        baseUrl: `https://responses-real-error-${stream ? 'stream' : 'json'}.example/v1`,
        apiKey: 'secret',
        model: 'configured-model',
        compatibility: {
          preferredProtocol: 'responses',
          allowedProtocols: ['responses'],
        },
        fetchImpl: async () => {
          calls += 1;
          return stream
            ? sse([['response.completed', {
              type: 'response.completed',
              response: failed,
            }]])
            : Response.json(failed);
        },
        preferredProtocol: 'responses',
      }),
      (error: unknown) => error instanceof UpstreamRequestError
        && error.code === 'upstream_error_payload',
    );
    assert.equal(calls, 1);
  }
});

test('tool-schema incompatibility fails closed before sending any provider request', async () => {
  let calls = 0;
  const negotiator = new UpstreamProtocolNegotiator();
  await assert.rejects(
    negotiator.request({
      request: {
        ...request,
        tools: [{
          type: 'function',
          name: 'lookup',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', pattern: '^[a-z]+$' } },
          },
        }],
      },
      baseUrl: 'https://models.example/v1',
      apiKey: 'secret',
      model: 'configured-model',
      compatibility: {
        preferredProtocol: 'chat-completions',
        allowedProtocols: ['chat-completions', 'responses'],
        schemaPatternPolicy: 'reject',
      },
      fetchImpl: async () => {
        calls += 1;
        return chatResult('must-not-send');
      },
      preferredProtocol: 'responses',
    }),
    (error: unknown) => error instanceof UpstreamRequestError
      && error.code === 'upstream_protocol_capability_unsupported',
  );
  assert.equal(calls, 0);
});

test('Chat preparation preserves allOf-root required constraints in the transmitted schema', async () => {
  const calls: CapturedCall[] = [];
  await new UpstreamProtocolNegotiator().request({
    request: {
      ...request,
      tools: [{
        type: 'function',
        name: 'lookup',
        parameters: {
          type: 'object',
          allOf: [{ properties: { query: { type: 'string' } } }],
          required: ['query'],
        },
      }],
    },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: {
      preferredProtocol: 'chat-completions',
      allowedProtocols: ['chat-completions'],
    },
    fetchImpl: captureFetch(calls, [chatResult('done')]),
    preferredProtocol: 'responses',
  });
  const tools = calls[0]?.body.tools as Array<Record<string, unknown>>;
  const fn = tools[0]?.function as Record<string, unknown>;
  const parameters = fn.parameters as Record<string, unknown>;
  assert.deepEqual(parameters.required, ['query']);
});

test('Chat preparation accepts deeply nested schemas within the structural resource budget', async () => {
  let nested: Record<string, unknown> = { type: 'string' };
  for (let depth = 0; depth < 64; depth += 1) {
    nested = { type: 'array', items: nested };
  }
  const calls: CapturedCall[] = [];
  await new UpstreamProtocolNegotiator().request({
    request: {
      ...request,
      tools: [{
        type: 'function',
        name: 'render',
        parameters: {
          type: 'object',
          properties: { plan: nested },
        },
      }],
    },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: {
      preferredProtocol: 'chat-completions',
      allowedProtocols: ['chat-completions'],
    },
    fetchImpl: captureFetch(calls, [chatResult('done')]),
    preferredProtocol: 'responses',
  });

  assert.equal(calls.length, 1);
  const tools = calls[0]?.body.tools as Array<Record<string, unknown>>;
  const fn = tools[0]?.function as Record<string, unknown>;
  assert.equal((fn.parameters as Record<string, unknown>).type, 'object');
});

test('Anthropic Messages driver preserves tools, tool results, usage, and stop reason', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const result = await negotiator.request({
    request: {
      ...request,
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'look up x' }] },
        { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"query":"x"}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'found x' },
      ],
    },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl: captureFetch(calls, [anthropicToolResult()]),
    preferredProtocol: 'anthropic-messages',
  });

  assert.equal(result.protocol, 'anthropic-messages');
  assert.equal(calls[0]?.url, 'https://models.example/v1/messages');
  assert.equal(calls[0]?.headers['x-api-key'], 'secret');
  assert.equal(calls[0]?.headers.authorization, undefined);
  assert.match(JSON.stringify(calls[0]?.body.messages), /tool_use/);
  assert.match(JSON.stringify(calls[0]?.body.messages), /tool_result/);
  assert.deepEqual(result.response.usage, {
    input_tokens: 7,
    output_tokens: 3,
    total_tokens: 10,
    input_tokens_details: { cached_tokens: 2 },
    output_tokens_details: { reasoning_tokens: 0 },
  });
  assert.equal((result.response.output as Array<Record<string, unknown>>)[0]?.type, 'function_call');
});

test('Codex-shaped Responses reasoning maps to bounded Anthropic thinking with tool and usage roundtrip', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const result = await negotiator.request({
    request: {
      ...request,
      max_tokens: 4096,
      reasoning: { effort: 'high', summary: 'detailed' },
      reasoning_effort: 'high',
    },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl: captureFetch(calls, [Response.json({
      id: 'msg_thinking_tool',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Need the lookup tool.', signature: 'signed-thinking' },
        { type: 'tool_use', id: 'toolu_3', name: 'lookup', input: { query: 'x' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 9, output_tokens: 5, cache_read_input_tokens: 3 },
    })]),
    preferredProtocol: 'anthropic-messages',
  });

  assert.equal(calls[0]?.body.max_tokens, 4096);
  assert.deepEqual(calls[0]?.body.thinking, { type: 'enabled', budget_tokens: 3072 });
  assert.equal(Array.isArray(calls[0]?.body.tools), true);
  const output = result.response.output as Array<Record<string, unknown>>;
  assert.deepEqual(output.map((item) => item.type), ['reasoning', 'function_call']);
  assert.equal(output[0]?.signature, 'signed-thinking');
  assert.deepEqual(result.response.usage, {
    input_tokens: 9,
    output_tokens: 5,
    total_tokens: 14,
    input_tokens_details: { cached_tokens: 3 },
    output_tokens_details: { reasoning_tokens: 0 },
  });
});

test('Anthropic thinking and stop sequences roundtrip directly without synthetic protocol loss', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  await negotiator.request({
    request: {
      ...request,
      max_tokens: 4096,
      thinking: { type: 'enabled', budget_tokens: 2048 },
      stop: ['END'],
    },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl: captureFetch(calls, [anthropicResult('done')]),
    preferredProtocol: 'anthropic-messages',
  });

  assert.deepEqual(calls[0]?.body.thinking, { type: 'enabled', budget_tokens: 2048 });
  assert.deepEqual(calls[0]?.body.stop_sequences, ['END']);
});

test('native adaptive Anthropic thinking passes through unchanged only to the Messages driver', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const attempts: Array<{ protocol: string; status: string }> = [];
  await negotiator.request({
    request: {
      ...request,
      thinking: { type: 'adaptive', display: 'summarized' },
    },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl: captureFetch(calls, [anthropicResult('done')]),
    preferredProtocol: 'responses',
    onAttempt(attempt) {
      attempts.push({ protocol: attempt.protocol, status: attempt.status });
    },
  });

  assert.deepEqual(attempts.slice(0, 2), [
    { protocol: 'responses', status: 'incompatible' },
    { protocol: 'chat-completions', status: 'incompatible' },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://models.example/v1/messages');
  assert.deepEqual(calls[0]?.body.thinking, { type: 'adaptive', display: 'summarized' });
});

test('canonical responses preserve non-streaming Chat and Anthropic terminal metadata', async () => {
  for (const finishReason of ['stop', 'length', 'content_filter'] as const) {
    const negotiator = new UpstreamProtocolNegotiator();
    const result = await negotiator.request({
      request,
      baseUrl: `https://chat-${finishReason}.example/v1`,
      apiKey: 'secret',
      model: 'configured-model',
      fetchImpl: async () => Response.json({
        id: `chat_${finishReason}`,
        object: 'chat.completion',
        choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: finishReason }],
      }),
      preferredProtocol: 'chat-completions',
    });
    assert.deepEqual(result.response.terminal_details, {
      protocol: 'chat-completions',
      finish_reason: finishReason,
    });
  }

  for (const [stopReason, stopSequence] of [
    ['max_tokens', null],
    ['tool_use', null],
    ['stop_sequence', 'END'],
    ['end_turn', null],
  ] as const) {
    const negotiator = new UpstreamProtocolNegotiator();
    const result = await negotiator.request({
      request,
      baseUrl: `https://messages-${stopReason}.example/v1`,
      apiKey: 'secret',
      model: 'configured-model',
      fetchImpl: async () => Response.json({
        id: `msg_${stopReason}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        stop_reason: stopReason,
        stop_sequence: stopSequence,
      }),
      preferredProtocol: 'anthropic-messages',
    });
    assert.deepEqual(result.response.terminal_details, {
      protocol: 'anthropic-messages',
      stop_reason: stopReason,
      stop_sequence: stopSequence,
    });
  }
});

test('invalid Anthropic thinking budget fails explicitly without sending a candidate request', async () => {
  let calls = 0;
  const negotiator = new UpstreamProtocolNegotiator();
  await assert.rejects(
    negotiator.request({
      request: {
        ...request,
        max_tokens: 1024,
        thinking: { type: 'enabled', budget_tokens: 1024 },
      },
      baseUrl: 'https://models.example/v1',
      apiKey: 'secret',
      model: 'configured-model',
      fetchImpl: async () => {
        calls += 1;
        throw new Error('must not fetch');
      },
      preferredProtocol: 'anthropic-messages',
    }),
    (error: unknown) => error instanceof UpstreamRequestError
      && error.code === 'upstream_protocol_capability_unsupported',
  );
  assert.equal(calls, 0);
});

test('every driver treats a 2xx wrong-wire schema as terminal without fallback or cache eviction', async () => {
  for (const protocol of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
    const calls: CapturedCall[] = [];
    const negotiator = new UpstreamProtocolNegotiator();
    const baseUrl = `https://wrong-schema-${protocol}.example/v1`;
    const valid = protocol === 'responses'
      ? responsesResult('valid')
      : protocol === 'chat-completions'
        ? chatResult('valid')
        : anthropicResult('valid');
    const wrongWire = protocol === 'responses'
      ? anthropicResult('wrong')
      : protocol === 'chat-completions'
        ? responsesResult('wrong')
        : chatResult('wrong');
    const fetchImpl = captureFetch(calls, [valid, wrongWire]);

    await negotiator.request({
      request,
      baseUrl,
      apiKey: 'secret',
      model: 'configured-model',
      fetchImpl,
      preferredProtocol: protocol,
    });
    await assert.rejects(
      negotiator.request({
        request,
        baseUrl,
        apiKey: 'secret',
        model: 'configured-model',
        fetchImpl,
        preferredProtocol: protocol,
      }),
      (error: unknown) => error instanceof UpstreamRequestError
        && error.code === 'upstream_invalid_response',
    );

    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.url, calls[0]?.url);
    assert.equal(negotiator.cachedProtocol(baseUrl, 'configured-model'), protocol);
  }
});

test('every driver rejects a 2xx response shell missing its required terminal structure', async () => {
  const shells: Record<UpstreamWireProtocol, Record<string, unknown>> = {
    responses: { object: 'response' },
    'chat-completions': { object: 'chat.completion', choices: [] },
    'anthropic-messages': { type: 'message', content: [] },
  };
  for (const protocol of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
    let calls = 0;
    const negotiator = new UpstreamProtocolNegotiator();
    await assert.rejects(
      negotiator.request({
        request,
        baseUrl: `https://empty-shell-${protocol}.example/v1`,
        apiKey: 'secret',
        model: 'configured-model',
        fetchImpl: async () => {
          calls += 1;
          return Response.json(shells[protocol]);
        },
        preferredProtocol: protocol,
      }),
      (error: unknown) => error instanceof UpstreamRequestError
        && error.code === 'upstream_invalid_response',
    );
    assert.equal(calls, 1);
  }
});

test('every streaming driver rejects an invalid 2xx terminal frame without fallback', async () => {
  const invalidStreams: Record<UpstreamWireProtocol, () => Response> = {
    responses: () => sse([['response.completed', {
      type: 'response.completed',
      response: { id: 'resp_shell', object: 'response', status: 'completed' },
    }]]),
    'chat-completions': () => sse([[undefined, {
      id: 'chat_shell',
      object: 'chat.completion.chunk',
      choices: [{ delta: { content: 'partial without a terminal reason' } }],
    }]]),
    'anthropic-messages': () => sse([
      ['message_start', { type: 'message_start', message: { id: 'msg_shell', type: 'message', role: 'assistant', content: [] } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial without a terminal reason' } }],
    ]),
  };
  for (const protocol of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
    let calls = 0;
    const negotiator = new UpstreamProtocolNegotiator();
    await assert.rejects(
      negotiator.request({
        request: { ...request, stream: true },
        baseUrl: `https://invalid-stream-${protocol}.example/v1`,
        apiKey: 'secret',
        model: 'configured-model',
        fetchImpl: async () => {
          calls += 1;
          return invalidStreams[protocol]();
        },
        preferredProtocol: protocol,
      }),
      (error: unknown) => error instanceof UpstreamRequestError
        && error.code === 'upstream_invalid_response',
    );
    assert.equal(calls, 1);
  }
});

test('schema-valid empty and usage-only terminal responses remain valid for every driver', async () => {
  const emptyStreams: Record<UpstreamWireProtocol, () => Response> = {
    responses: () => sse([['response.completed', {
      type: 'response.completed',
      response: { id: 'resp_empty', object: 'response', status: 'completed', output: [] },
    }]]),
    'chat-completions': () => sse([
      [undefined, { id: 'chat_empty', object: 'chat.completion.chunk', choices: [{ delta: {}, finish_reason: 'stop' }] }],
      [undefined, { id: 'chat_empty', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 } }],
    ]),
    'anthropic-messages': () => sse([
      ['message_start', { type: 'message_start', message: { id: 'msg_empty', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 0 } } }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } }],
    ]),
  };
  for (const protocol of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
    const negotiator = new UpstreamProtocolNegotiator();
    const result = await negotiator.request({
      request: { ...request, stream: true },
      baseUrl: `https://valid-empty-${protocol}.example/v1`,
      apiKey: 'secret',
      model: 'configured-model',
      fetchImpl: async () => emptyStreams[protocol](),
      preferredProtocol: protocol,
    });
    assert.equal(result.protocol, protocol);
    assert.deepEqual(result.response.output, []);
  }
});

for (const protocol of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
  test(`${protocol} driver consumes ordered streaming output and terminal usage`, async () => {
    const negotiator = new UpstreamProtocolNegotiator();
    const result = await negotiator.request({
      request: { ...request, stream: true },
      baseUrl: 'https://models.example/v1',
      apiKey: 'secret',
      model: 'configured-model',
      fetchImpl: async () => streamingResult(protocol),
      preferredProtocol: protocol,
    });
    assert.equal(result.protocol, protocol);
    assert.equal(result.response.output_text, 'hello');
    const usage = result.response.usage as Record<string, unknown>;
    assert.equal(usage.input_tokens, 4);
    assert.equal(usage.output_tokens, 2);
    if (protocol === 'chat-completions') {
      assert.deepEqual(result.response.terminal_details, {
        protocol: 'chat-completions',
        finish_reason: 'length',
      });
    }
    if (protocol === 'anthropic-messages') {
      assert.deepEqual(result.response.terminal_details, {
        protocol: 'anthropic-messages',
        stop_reason: 'stop_sequence',
        stop_sequence: 'END',
      });
    }
  });
}

type CapturedCall = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

function captureFetch(calls: CapturedCall[], responses: Response[]): typeof fetch {
  return async (url, init) => {
    calls.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    const response = responses.shift();
    assert.ok(response, `Unexpected request to ${url}`);
    return response;
  };
}

function responsesResult(text: string): Response {
  return Response.json({
    id: `resp_${text}`,
    object: 'response',
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
    output_text: text,
    usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
  });
}

function chatResult(text: string): Response {
  return Response.json({
    id: `chat_${text}`,
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
  });
}

function anthropicResult(text: string): Response {
  return Response.json({
    id: `msg_${text}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 4, output_tokens: 2 },
  });
}

function anthropicToolResult(): Response {
  return Response.json({
    id: 'msg_tool',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_2', name: 'lookup', input: { query: 'y' } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2 },
  });
}

function streamingResult(protocol: UpstreamWireProtocol): Response {
  if (protocol === 'responses') {
    return sse([
      ['response.output_text.delta', { type: 'response.output_text.delta', delta: 'hel' }],
      ['response.output_text.delta', { type: 'response.output_text.delta', delta: 'lo' }],
      ['response.completed', {
        type: 'response.completed',
        response: {
          id: 'resp_stream',
          object: 'response',
          status: 'completed',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] }],
          output_text: 'hello',
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        },
      }],
    ]);
  }
  if (protocol === 'chat-completions') {
    return sse([
      [undefined, { id: 'chat_stream', object: 'chat.completion.chunk', choices: [{ delta: { content: 'hel' } }] }],
      [undefined, { id: 'chat_stream', object: 'chat.completion.chunk', choices: [{ delta: { content: 'lo' }, finish_reason: 'length' }] }],
      [undefined, { id: 'chat_stream', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }],
    ]);
  }
  return sse([
    ['message_start', { type: 'message_start', message: { id: 'msg_stream', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 4, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hel' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'stop_sequence', stop_sequence: 'END' }, usage: { output_tokens: 2 } }],
  ]);
}

function sse(events: Array<[string | undefined, Record<string, unknown>]>): Response {
  return new Response(events.map(([event, data]) => (
    `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`
  )).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

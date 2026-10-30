import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  UpstreamProtocolNegotiator,
  UpstreamRequestError,
  buildUpstreamEndpointUrl,
  isDefinitiveProtocolRejection,
  type UpstreamAttempt,
  type UpstreamWireProtocol,
  type UpstreamTraceAttemptStart,
} from './upstream-drivers';
import { CapabilityCorrections } from './capability-corrections';

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

test('Responses image requests default detail without overriding explicit image detail or mutating input', async () => {
  const calls: CapturedCall[] = [];
  const content = [
    { type: 'input_text', text: 'Inspect these images.' },
    { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' },
    { type: 'input_image', image_url: 'https://example.test/image.png', detail: 'high' },
  ];
  await new UpstreamProtocolNegotiator().request({
    request: { model: 'configured-model', input: [{ role: 'user', content }] },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl: captureFetch(calls, [responsesResult('Image inspected.')]),
    preferredProtocol: 'responses',
  });
  assert.deepEqual(calls[0]?.body.input, [{ role: 'user', content: [
    content[0], { ...content[1], detail: 'auto' }, content[2],
  ] }]);
  assert.equal(content[1]?.detail, undefined);
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

test('applies the configured upstream timeout when the profile sets none', async (context) => {
  // The mocked fetch has no socket to keep Node alive for AbortSignal.timeout.
  const keepAlive = setTimeout(() => undefined, 1_000);
  context.after(() => clearTimeout(keepAlive));
  const previous = process.env.SCIFORGE_UPSTREAM_TIMEOUT_MS;
  process.env.SCIFORGE_UPSTREAM_TIMEOUT_MS = '40';
  context.after(() => {
    if (previous === undefined) delete process.env.SCIFORGE_UPSTREAM_TIMEOUT_MS;
    else process.env.SCIFORGE_UPSTREAM_TIMEOUT_MS = previous;
  });

  const negotiator = new UpstreamProtocolNegotiator();
  const fetchImpl: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });
  await assert.rejects(
    negotiator.request({
      request,
      baseUrl: 'https://models.example/v1',
      apiKey: 'secret',
      model: 'configured-model',
      fetchImpl,
      preferredProtocol: 'responses',
    }),
    (error: unknown) => error instanceof UpstreamRequestError && error.code === 'upstream_timeout',
  );
});

test('streamed chat-completions requests ask for usage in the terminal chunk', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  await negotiator.request({
    request: { ...request, stream: true },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl: captureFetch(calls, [streamingResult('chat-completions')]),
    preferredProtocol: 'chat-completions',
  });

  assert.equal(calls[0]?.body.stream, true);
  assert.deepEqual(calls[0]?.body.stream_options, { include_usage: true });
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
    { name: 'structured schema validation', response: Response.json({ error: { message: 'invalid request schema: additionalProperties must be false' } }, { status: 400 }), expectedCode: 'upstream_http_400' },
    { name: 'structured schema field path', response: Response.json({ error: { message: 'invalid value at path response_format.json_schema.schema.additionalProperties' } }, { status: 400 }), expectedCode: 'upstream_http_400' },
    { name: 'structured content media type', response: Response.json({ error: { message: 'unsupported media type in JSON Schema contentMediaType' } }, { status: 422 }), expectedCode: 'upstream_http_422' },
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
  assert.equal(isDefinitiveProtocolRejection(400, JSON.stringify({
    error: { message: 'invalid request schema: additionalProperties must be false' },
  })), false);
  assert.equal(isDefinitiveProtocolRejection(422, JSON.stringify({
    error: { message: 'request body invalid at path text.format.schema' },
  })), false);
  assert.equal(isDefinitiveProtocolRejection(422, JSON.stringify({
    error: { message: 'unsupported media type in JSON Schema contentMediaType' },
  })), false);
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

test('system instructions use one Chat prefix without changing native Responses or Anthropic messages', async () => {
  const input = [
    { role: 'developer', content: [{ type: 'input_text', text: 'Developer instructions.' }] },
    { role: 'user', content: 'Question.' },
    { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'Result.' },
    { role: 'system', content: 'Additional instructions.' },
    { role: 'user', content: 'Follow-up.' },
  ];
  const original = { instructions: 'Base instructions.', input };
  const calls: CapturedCall[] = [];
  for (const protocol of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
    await new UpstreamProtocolNegotiator().request({
      request: structuredClone(original),
      baseUrl: 'https://models.example/v1',
      apiKey: 'secret',
      model: 'neutral-model',
      compatibility: { preferredProtocol: protocol, allowedProtocols: [protocol] },
      fetchImpl: captureFetch(calls, [protocol === 'responses' ? responsesResult('ok')
        : protocol === 'chat-completions' ? chatResult('ok') : anthropicResult('ok')]),
      preferredProtocol: protocol,
    });
  }
  assert.equal(calls[0]?.body.instructions, original.instructions);
  assert.deepEqual(calls[0]?.body.input, input);
  const chat = calls[1]?.body.messages as Record<string, unknown>[];
  assert.deepEqual(chat.map((message) => message.role), ['system', 'user', 'assistant', 'tool', 'user']);
  assert.equal(chat[0]?.content, 'Base instructions.\n\nDeveloper instructions.\n\nAdditional instructions.');
  assert.equal(chat[3]?.tool_call_id, 'call_1');
  assert.deepEqual(calls[2]?.body.system, [
    { type: 'text', text: 'Base instructions.' },
    { type: 'text', text: 'Developer instructions.' },
    { type: 'text', text: 'Additional instructions.' },
  ]);
  assert.deepEqual((calls[2]?.body.messages as Record<string, unknown>[]).map((message) => message.role),
    ['user', 'assistant', 'user', 'user']);
});

test('native Responses output schemas are transmitted on every supported upstream wire', async () => {
  const outputSchema = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  };
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();

  await negotiator.request({
    request: { ...request, outputSchema },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: {
      preferredProtocol: 'responses',
      allowedProtocols: ['responses'],
    },
    fetchImpl: captureFetch(calls, [responsesResult('responses')]),
    preferredProtocol: 'responses',
  });
  await negotiator.request({
    request: { ...request, outputSchema },
    baseUrl: 'https://chat.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: {
      preferredProtocol: 'chat-completions',
      allowedProtocols: ['chat-completions'],
    },
    fetchImpl: captureFetch(calls, [chatResult('chat')]),
    preferredProtocol: 'chat-completions',
  });
  await negotiator.request({
    request: { ...request, outputSchema },
    baseUrl: 'https://anthropic.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: {
      preferredProtocol: 'anthropic-messages',
      allowedProtocols: ['anthropic-messages'],
    },
    fetchImpl: captureFetch(calls, [anthropicResult('anthropic')]),
    preferredProtocol: 'anthropic-messages',
  });

  assert.deepEqual(calls[0]?.body.text, {
    format: {
      type: 'json_schema',
      name: 'sciforge_output',
      strict: true,
      schema: outputSchema,
    },
  });
  assert.equal(calls[0]?.body.outputSchema, undefined);
  assert.deepEqual(calls[1]?.body.response_format, {
    type: 'json_schema',
    json_schema: {
      name: 'sciforge_output',
      strict: true,
      schema: outputSchema,
    },
  });
  assert.equal(calls[1]?.body.outputSchema, undefined);
  assert.deepEqual(calls[2]?.body.output_config, {
    format: {
      type: 'json_schema',
      schema: outputSchema,
    },
  });
  assert.equal(calls[2]?.body.outputSchema, undefined);
});

const requirementsLikeSchema = {
  type: 'object',
  properties: {
    workModules: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        properties: {
          planItemId: { type: 'string', pattern: '^item_[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])$' },
          title: { type: 'string', minLength: 1, maxLength: 500 },
        },
        required: ['planItemId', 'title'],
        additionalProperties: false,
      },
    },
    target: { anyOf: [{ type: 'string', pattern: '^item_' }, { type: 'string', const: '$project' }] },
  },
  required: ['workModules', 'target'],
  additionalProperties: false,
};
const jsonObjectChatCompatibility = {
  preferredProtocol: 'chat-completions',
  allowedProtocols: ['chat-completions'],
  chatStructuredOutputMode: 'json_object',
} as const;

test('json_object Chat upstreams receive the schema contract in instructions instead of json_schema', async () => {
  const calls: CapturedCall[] = [];
  const valid = JSON.stringify({ workModules: [{ planItemId: 'item_a1', title: 'Collect data' }], target: '$project' });
  const result = await new UpstreamProtocolNegotiator().request({
    request: { ...request, instructions: 'Base instructions.', outputSchema: requirementsLikeSchema },
    baseUrl: 'https://json-mode.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: jsonObjectChatCompatibility,
    fetchImpl: captureFetch(calls, [chatResult(valid)]),
    preferredProtocol: 'responses',
  });

  assert.equal(result.protocol, 'chat-completions');
  assert.equal(result.response.output_text, valid);
  assert.deepEqual(calls[0]?.body.response_format, { type: 'json_object' });
  assert.doesNotMatch(JSON.stringify(calls[0]?.body), /json_schema/u);
  const messages = calls[0]?.body.messages as Array<{ role: string; content: string }>;
  assert.equal(messages.filter((message) => message.role === 'system').length, 1);
  const system = messages[0]!.content;
  assert.match(system, /^Base instructions\.\n\n/u);
  assert.match(system, /json object/u);
  assert.match(system, /"sciforge_output"/u);
  assert.ok(system.includes(JSON.stringify(requirementsLikeSchema)));
  assert.ok(system.includes(JSON.stringify({ workModules: [{ planItemId: 'string', title: 'string' }], target: 'string' })));
});

test('json_object Chat upstream output that violates the schema fails as structured_output_invalid', async (context) => {
  const cases = [
    { name: 'not JSON', text: 'Here is the plan: ...' },
    { name: 'missing required', text: JSON.stringify({ workModules: [{ planItemId: 'item_a1', title: 'x' }] }) },
    { name: 'undeclared property', text: JSON.stringify({ workModules: [{ planItemId: 'item_a1', title: 'x', extra: 1 }], target: '$project' }) },
    { name: 'pattern', text: JSON.stringify({ workModules: [{ planItemId: 'bad', title: 'x' }], target: '$project' }) },
    { name: 'minItems', text: JSON.stringify({ workModules: [], target: '$project' }) },
    { name: 'anyOf', text: JSON.stringify({ workModules: [{ planItemId: 'item_a1', title: 'x' }], target: 'other' }) },
  ];
  for (const entry of cases) {
    await context.test(entry.name, async () => {
      const calls: CapturedCall[] = [];
      await assert.rejects(
        new UpstreamProtocolNegotiator().request({
          request: { ...request, outputSchema: requirementsLikeSchema },
          baseUrl: 'https://json-mode.example/v1',
          apiKey: 'secret',
          model: 'neutral-model',
          compatibility: jsonObjectChatCompatibility,
          fetchImpl: captureFetch(calls, [chatResult(entry.text)]),
          preferredProtocol: 'chat-completions',
        }),
        (error: unknown) => (
          error instanceof UpstreamRequestError
          && error.code === 'structured_output_invalid'
          && error.status === 502
          && !error.message.includes(entry.text)
        ),
      );
      assert.equal(calls.length, 1);
    });
  }
});

test('json_object Chat upstreams fail closed before sending a schema the Router cannot enforce', async () => {
  const calls: CapturedCall[] = [];
  await assert.rejects(
    new UpstreamProtocolNegotiator().request({
      request: { ...request, outputSchema: { type: 'object', properties: { n: { type: 'number', minimum: 1 } } } },
      baseUrl: 'https://json-mode.example/v1',
      apiKey: 'secret',
      model: 'neutral-model',
      compatibility: jsonObjectChatCompatibility,
      fetchImpl: captureFetch(calls, [chatResult('must-not-run')]),
      preferredProtocol: 'chat-completions',
    }),
    (error: unknown) => (
      error instanceof UpstreamRequestError
      && error.code === 'upstream_protocol_capability_unsupported'
      && /"minimum"/u.test(error.message)
    ),
  );
  assert.equal(calls.length, 0);
});

test('json_object declaration leaves Responses and Anthropic structured output native', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  for (const [protocol, result] of [
    ['responses', responsesResult('not validated locally')],
    ['anthropic-messages', anthropicResult('not validated locally')],
  ] as const) {
    await negotiator.request({
      request: { ...request, outputSchema: requirementsLikeSchema },
      baseUrl: `https://${protocol}.example/v1`,
      apiKey: 'secret',
      model: 'neutral-model',
      compatibility: { preferredProtocol: protocol, allowedProtocols: [protocol], chatStructuredOutputMode: 'json_object' },
      fetchImpl: captureFetch(calls, [result]),
      preferredProtocol: protocol,
    });
  }
  assert.equal((calls[0]?.body.text as { format: { type: string } }).format.type, 'json_schema');
  assert.equal((calls[1]?.body.output_config as { format: { type: string } }).format.type, 'json_schema');
});

test('invalid provider-neutral outputSchema never degrades to an unconstrained request', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();

  await assert.rejects(
    negotiator.request({
      request: { ...request, outputSchema: [] },
      baseUrl: 'https://models.example/v1',
      apiKey: 'secret',
      model: 'neutral-model',
      compatibility: {
        preferredProtocol: 'responses',
        allowedProtocols: ['responses'],
      },
      fetchImpl: captureFetch(calls, [responsesResult('must-not-run')]),
      preferredProtocol: 'responses',
    }),
    (error: unknown) => (
      error instanceof UpstreamRequestError
      && error.code === 'upstream_protocol_capability_unsupported'
      && /outputSchema JSON Schema must be an object/u.test(error.message)
    ),
  );
  assert.equal(calls.length, 0);
});

test('json_object mode is preserved in both directions across OpenAI upstream wires', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const jsonObjectRequest = {
    ...request,
    text: { format: { type: 'json_object' } },
  };

  await negotiator.request({
    request: jsonObjectRequest,
    baseUrl: 'https://responses.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: {
      preferredProtocol: 'responses',
      allowedProtocols: ['responses'],
    },
    fetchImpl: captureFetch(calls, [responsesResult('{}')]),
    preferredProtocol: 'responses',
  });
  await negotiator.request({
    request: jsonObjectRequest,
    baseUrl: 'https://chat.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: {
      preferredProtocol: 'chat-completions',
      allowedProtocols: ['chat-completions'],
    },
    fetchImpl: captureFetch(calls, [chatResult('{}')]),
    preferredProtocol: 'chat-completions',
  });
  await negotiator.request({
    request: {
      ...request,
      response_format: { type: 'json_object' },
    },
    baseUrl: 'https://chat-ingress.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: {
      preferredProtocol: 'responses',
      allowedProtocols: ['responses'],
    },
    fetchImpl: captureFetch(calls, [responsesResult('{}')]),
    preferredProtocol: 'responses',
  });

  assert.deepEqual(calls[0]?.body.text, { format: { type: 'json_object' } });
  assert.deepEqual(calls[1]?.body.response_format, { type: 'json_object' });
  assert.deepEqual(calls[2]?.body.text, { format: { type: 'json_object' } });
});

test('Responses text controls map only to protocols that can represent them', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const text = {
    verbosity: 'low',
    format: { type: 'json_object' },
  };

  await negotiator.request({
    request: { ...request, text },
    baseUrl: 'https://responses.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: {
      preferredProtocol: 'responses',
      allowedProtocols: ['responses'],
    },
    fetchImpl: captureFetch(calls, [responsesResult('{}')]),
    preferredProtocol: 'responses',
  });
  await negotiator.request({
    request: { ...request, text },
    baseUrl: 'https://chat.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: {
      preferredProtocol: 'chat-completions',
      allowedProtocols: ['chat-completions'],
    },
    fetchImpl: captureFetch(calls, [chatResult('{}')]),
    preferredProtocol: 'chat-completions',
  });
  await assert.rejects(
    negotiator.request({
      request: { ...request, text },
      baseUrl: 'https://anthropic.example/v1',
      apiKey: 'secret',
      model: 'neutral-model',
      compatibility: {
        preferredProtocol: 'anthropic-messages',
        allowedProtocols: ['anthropic-messages'],
      },
      fetchImpl: captureFetch(calls, []),
      preferredProtocol: 'anthropic-messages',
    }),
    (error: unknown) => (
      error instanceof UpstreamRequestError
      && error.code === 'upstream_protocol_capability_unsupported'
      && /Responses text controls/u.test(error.message)
    ),
  );

  assert.deepEqual(calls[0]?.body.text, text);
  assert.deepEqual(calls[1]?.body.response_format, { type: 'json_object' });
  assert.equal(calls[1]?.body.verbosity, 'low');
  assert.equal(calls.length, 2);
});

test('Chat-only optional JSON Schema fields survive the real negotiation path', async () => {
  const calls: CapturedCall[] = [];
  await new UpstreamProtocolNegotiator().request({
    request: {
      ...request,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer', strict: null },
      },
    },
    baseUrl: 'https://chat.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: {
      preferredProtocol: 'chat-completions',
      allowedProtocols: ['chat-completions'],
    },
    fetchImpl: captureFetch(calls, [chatResult('{}')]),
    preferredProtocol: 'chat-completions',
  });

  assert.deepEqual(calls[0]?.body.response_format, {
    type: 'json_schema',
    json_schema: { name: 'answer', strict: false },
  });
});

test('structured-output descriptions survive request hygiene and OpenAI fallback', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const description = 'AbCd0123_+'.repeat(60);
  const schema = {
    type: 'object',
    properties: { answer: { type: 'string' } },
  };

  await negotiator.request({
    request: {
      ...request,
      text: {
        format: {
          type: 'json_schema',
          name: 'answer_contract',
          description,
          strict: true,
          schema,
        },
      },
    },
    baseUrl: 'https://chat.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    compatibility: {
      preferredProtocol: 'chat-completions',
      allowedProtocols: ['chat-completions'],
    },
    fetchImpl: captureFetch(calls, [chatResult('{"answer":"ok"}')]),
    preferredProtocol: 'chat-completions',
  });

  const responseFormat = calls[0]?.body.response_format as Record<string, unknown>;
  const jsonSchema = responseFormat.json_schema as Record<string, unknown>;
  assert.equal(jsonSchema.description, description);
});

test('non-JSON schema values fail closed instead of deleting constraints', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();

  await assert.rejects(
    negotiator.request({
      request: {
        ...request,
        text: {
          format: {
            type: 'json_schema',
            name: 'bounded_number',
            strict: true,
            schema: { type: 'number', maximum: Number.POSITIVE_INFINITY },
          },
        },
      },
      baseUrl: 'https://models.example/v1',
      apiKey: 'secret',
      model: 'neutral-model',
      compatibility: {
        preferredProtocol: 'responses',
        allowedProtocols: ['responses'],
      },
      fetchImpl: captureFetch(calls, [responsesResult('must-not-run')]),
      preferredProtocol: 'responses',
    }),
    (error: unknown) => (
      error instanceof UpstreamRequestError
      && error.code === 'upstream_protocol_capability_unsupported'
      && /finite JSON numbers/u.test(error.message)
    ),
  );
  assert.equal(calls.length, 0);
});

test('Anthropic explicit plain-text defaults remain native and can fall back to OpenAI wires', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const result = await negotiator.request({
    request: {
      ...request,
      output_config: { type: 'text' },
    },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'neutral-model',
    fetchImpl: captureFetch(calls, [
      Response.json({ error: { message: 'Messages endpoint is unsupported.' } }, { status: 404 }),
      Response.json({ error: { message: 'Responses endpoint is unsupported.' } }, { status: 404 }),
      chatResult('plain-text-fallback'),
    ]),
    preferredProtocol: 'anthropic-messages',
  });

  assert.equal(result.protocol, 'chat-completions');
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    '/v1/messages',
    '/v1/responses',
    '/v1/chat/completions',
  ]);
  assert.deepEqual(calls[0]?.body.output_config, { type: 'text' });
  assert.equal(calls[1]?.body.output_config, undefined);
  assert.equal(calls[2]?.body.output_config, undefined);
});

test('Anthropic output_config controls never disappear into an OpenAI fallback', async () => {
  const calls: CapturedCall[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  const outputSchema = {
    type: 'object',
    properties: { answer: { type: 'string' } },
  };

  for (const outputConfig of [
    {
      effort: 'high',
      format: { type: 'json_schema', schema: outputSchema },
    },
    {
      type: 'text',
      effort: 'high',
    },
  ]) {
    await assert.rejects(
      negotiator.request({
        request: {
          ...request,
          output_config: outputConfig,
        },
        baseUrl: 'https://models.example/v1',
        apiKey: 'secret',
        model: 'neutral-model',
        compatibility: {
          preferredProtocol: 'responses',
          allowedProtocols: ['responses', 'chat-completions'],
        },
        fetchImpl: captureFetch(calls, []),
        preferredProtocol: 'responses',
      }),
      (error: unknown) => (
        error instanceof UpstreamRequestError
        && error.code === 'upstream_protocol_capability_unsupported'
        && /output_config controls/u.test(error.message)
      ),
    );
  }
  assert.equal(calls.length, 0);
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

test('streaming Responses incomplete terminal events preserve partial output and status', async () => {
  const incomplete = {
    id: 'resp_incomplete',
    object: 'response',
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    model: 'configured-model',
    output: [{
      id: 'msg_partial',
      type: 'message',
      status: 'incomplete',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Partial answer', annotations: [] }],
    }],
    output_text: 'Partial answer',
  };
  const result = await new UpstreamProtocolNegotiator().request({
    request: { ...request, stream: true },
    baseUrl: 'https://responses-incomplete.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    compatibility: { preferredProtocol: 'responses', allowedProtocols: ['responses'] },
    fetchImpl: async () => sse([['response.incomplete', {
      type: 'response.incomplete',
      response: incomplete,
    }]]),
    preferredProtocol: 'responses',
  });

  assert.equal(result.protocol, 'responses');
  assert.equal(result.response.status, 'incomplete');
  assert.deepEqual(result.response.incomplete_details, { reason: 'max_output_tokens' });
  assert.equal(result.response.output_text, 'Partial answer');
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

test('trace attempts carry the real model and the reasoning handling summary outside the body', async () => {
  const calls: CapturedCall[] = [];
  const attempts: UpstreamTraceAttemptStart[] = [];
  const negotiator = new UpstreamProtocolNegotiator();
  await negotiator.request({
    request: {
      ...request,
      max_tokens: 4096,
      reasoning: { effort: 'high' },
      reasoning_effort: 'high',
    },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl: captureFetch(calls, [anthropicToolResult()]),
    preferredProtocol: 'anthropic-messages',
    traceAttempt: (attempt) => {
      attempts.push(attempt);
      return {};
    },
  });

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.upstreamModel, 'configured-model');
  assert.deepEqual(attempts[0]?.reasoning, {
    requested: 'high',
    disposition: 'converted',
    forwarded: 'thinking(budget_tokens=3072)',
  });

  // With no explicit level, neither the wire nor the trace invents one.
  const calls2: CapturedCall[] = [];
  const attempts2: UpstreamTraceAttemptStart[] = [];
  const negotiator2 = new UpstreamProtocolNegotiator();
  await negotiator2.request({
    request: { ...request },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl: captureFetch(calls2, [anthropicToolResult()]),
    preferredProtocol: 'anthropic-messages',
    traceAttempt: (attempt) => {
      attempts2.push(attempt);
      return {};
    },
  });

  assert.equal(calls2[0]?.body.reasoning_effort, undefined);
  assert.equal(calls2[0]?.body.thinking, undefined);
  assert.deepEqual(attempts2[0]?.reasoning, {
    requested: null,
    disposition: 'not-requested',
    forwarded: null,
  });
});

test('an explicit upstream rejection is remembered and blocks the repeat pre-send until it expires', async () => {
  let now = 1_000;
  const corrections = new CapabilityCorrections({ now: () => now, ttlMs: 3_600_000 });
  const negotiator = new UpstreamProtocolNegotiator({ corrections });
  const attempts: UpstreamAttempt[] = [];
  const compatibility = {
    preferredProtocol: 'responses' as const,
    allowedProtocols: ['responses' as const],
    reasoningEfforts: ['max'],
  };
  const calls: CapturedCall[] = [];
  await assert.rejects(
    negotiator.request({
      request: { ...request, reasoning_effort: 'max' },
      baseUrl: 'https://models.example/v1',
      apiKey: 'secret',
      model: 'configured-model',
      fetchImpl: captureFetch(calls, [
        Response.json({ error: { message: 'Unsupported reasoning effort "max" for this model' } }, { status: 400 }),
      ]),
      compatibility,
      onAttempt: (attempt) => attempts.push(attempt),
    }),
    (error: UpstreamRequestError) => error.code === 'upstream_http_400',
  );
  assert.equal(calls.length, 1);
  const negative = corrections.negative({
    model: 'configured-model',
    baseUrl: 'https://models.example/v1',
    protocol: 'responses',
    level: 'max',
  });
  assert.ok(negative);
  assert.equal(negative?.upstreamStatus, 400);

  // The repeat fails fast without touching the wire.
  const repeatCalls: CapturedCall[] = [];
  await assert.rejects(
    negotiator.request({
      request: { ...request, reasoning_effort: 'max' },
      baseUrl: 'https://models.example/v1',
      apiKey: 'secret',
      model: 'configured-model',
      fetchImpl: captureFetch(repeatCalls, []),
      compatibility,
      onAttempt: (attempt) => attempts.push(attempt),
    }),
    (error: UpstreamRequestError) =>
      error.code === 'unsupported_reasoning_effort'
      && error.status === 422
      && /temporarily unsupported/u.test(error.message),
  );
  assert.equal(repeatCalls.length, 0);
  assert.equal(attempts.at(-1)?.status, 'rejected');

  // Recovery by TTL: after expiry the request reaches the wire again.
  now += 3_600_000 + 1;
  const recoveredCalls: CapturedCall[] = [];
  const result = await negotiator.request({
    request: { ...request, reasoning_effort: 'max' },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl: captureFetch(recoveredCalls, [responsesResult('recovered')]),
    compatibility,
    onAttempt: (attempt) => attempts.push(attempt),
  });
  assert.equal(result.protocol, 'responses');
  assert.equal(recoveredCalls.length, 1);
});

test('rate limits never create negatives, and a success clears an existing one', async () => {
  const corrections = new CapabilityCorrections({ now: () => 5_000, ttlMs: 3_600_000 });
  const negotiator = new UpstreamProtocolNegotiator({ corrections });
  const compatibility = {
    preferredProtocol: 'responses' as const,
    allowedProtocols: ['responses' as const],
    reasoningEfforts: ['max'],
  };
  const negativeQuery = {
    model: 'configured-model',
    baseUrl: 'https://models.example/v1',
    protocol: 'responses',
    level: 'max',
  };

  await assert.rejects(
    negotiator.request({
      request: { ...request, reasoning_effort: 'max' },
      baseUrl: 'https://models.example/v1',
      apiKey: 'secret',
      model: 'configured-model',
      fetchImpl: captureFetch([], [Response.json({ error: 'rate limited' }, { status: 429 })]),
      compatibility,
    }),
    (error: UpstreamRequestError) => error.code === 'upstream_http_429',
  );
  assert.equal(corrections.negative(negativeQuery), null);

  // Race: a concurrent request records the negative while this one is in flight;
  // the success that follows is the recovery signal and clears it.
  let fetched = 0;
  const racingFetch = async (): Promise<Response> => {
    fetched += 1;
    corrections.record(negativeQuery, { reason: 'racing evidence', upstreamStatus: 400 });
    return responsesResult('accepted again');
  };
  const result = await negotiator.request({
    request: { ...request, reasoning_effort: 'max' },
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret',
    model: 'configured-model',
    fetchImpl: racingFetch,
    compatibility,
  });
  assert.equal(result.protocol, 'responses');
  assert.equal(fetched, 1);
  assert.equal(corrections.negative(negativeQuery), null);
});

function sse(events: Array<[string | undefined, Record<string, unknown>]>): Response {
  return new Response(events.map(([event, data]) => (
    `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`
  )).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}


test('does not retry a stream failure after delivering public reasoning', async () => {
  const calls: CapturedCall[] = [];
  const deltas: string[] = [];
  const body = [
    { type: 'response.reasoning_summary_text.delta', delta: 'Read the selected report.' },
    { type: 'error', error: { message: 'not implemented', code: 'convert_request_failed' } },
  ].map(payload => `data: ${JSON.stringify(payload)}\n\n`).join('');
  const negotiator = new UpstreamProtocolNegotiator();
  await assert.rejects(negotiator.request({
    request: { ...request, stream: true }, baseUrl: 'https://models.example/v1',
    apiKey: 'secret', model: 'configured-model', preferredProtocol: 'responses',
    fetchImpl: captureFetch(calls, [new Response(body, { headers: { 'content-type': 'text/event-stream' } })]),
    onReasoningDelta: text => deltas.push(text),
  }), (error: unknown) => error instanceof UpstreamRequestError && !error.definitiveRejection);
  assert.deepEqual(deltas, ['Read the selected report.']);
  assert.equal(calls.length, 1);
});

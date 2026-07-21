import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeProviderChatCompletionsBody,
  normalizeProviderJsonSchema,
  normalizeProviderResponsesRequest,
  resolveProviderCompatibility,
} from './provider-compat';
import {
  responsesToAnthropicMessages,
  responsesToChatCompletions,
  type JsonObject,
  type ResponsesRequest,
} from './response-compat';

test('provider compatibility is capability-driven and independent of provider identity', () => {
  const explicit = resolveProviderCompatibility({
    preferredProtocol: 'chat-completions',
    allowedProtocols: ['chat-completions'],
    chatMaxTokensField: 'max_completion_tokens',
    preserveChatReasoningContent: true,
  });
  assert.equal(explicit.preferredProtocol, 'chat-completions');
  assert.deepEqual(explicit.allowedProtocols, ['chat-completions']);
  assert.equal(explicit.chatMaxTokensField, 'max_completion_tokens');

  const requested = resolveProviderCompatibility(undefined, 'anthropic-messages');
  assert.equal(requested.preferredProtocol, 'anthropic-messages');
  assert.deepEqual(requested.allowedProtocols, [
    'responses',
    'chat-completions',
    'anthropic-messages',
  ]);
  assert.throws(
    () => resolveProviderCompatibility({
      preferredProtocol: 'responses',
      allowedProtocols: ['chat-completions'],
    }),
    /preferredProtocol must be present/u,
  );
  assert.throws(
    () => resolveProviderCompatibility('not-an-object' as never),
    /must be an object/u,
  );
  assert.throws(
    () => resolveProviderCompatibility({ providerFamily: 'example' } as never),
    /unknown compatibility setting/u,
  );
});

test('non-Responses conversion ignores opaque continuation items without adding empty messages', () => {
  const encryptedContent = 'opaque-encrypted-continuation-state';
  const request: ResponsesRequest = {
    model: 'neutral-model',
    input: [
      { role: 'user', content: [{ type: 'input_text', text: 'Inspect.' }] },
      {
        id: 'rs_1',
        type: 'reasoning',
        encrypted_content: encryptedContent,
        summary: [{ type: 'summary_text', text: 'Need the tool.' }],
      },
      { id: 'cmp_1', type: 'compaction', encrypted_content: encryptedContent },
      { type: 'function_call', call_id: 'call_1', name: 'inspect', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'done' },
    ],
  };

  const chat = responsesToChatCompletions(request);
  const chatMessages = chat.messages as JsonObject[];
  assert.deepEqual(chatMessages.map((message) => message.role), ['user', 'assistant', 'tool']);
  assert.equal(chatMessages[1]?.reasoning_content, 'Need the tool.');
  assert.doesNotMatch(JSON.stringify(chat), new RegExp(encryptedContent, 'u'));

  const anthropic = responsesToAnthropicMessages(request);
  const anthropicMessages = anthropic.messages as JsonObject[];
  assert.deepEqual(anthropicMessages.map((message) => message.role), ['user', 'assistant', 'user']);
  assert.doesNotMatch(JSON.stringify(anthropic), new RegExp(encryptedContent, 'u'));
});

test('Responses normalization removes only explicitly incompatible chat extension fields', () => {
  const request: ResponsesRequest & Record<string, unknown> = {
    model: 'neutral-model',
    reasoning_effort: 'high',
    reasoning_content: 'top-level legacy value',
    input: [
      {
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: 'prior answer',
          reasoning_content: 'nested legacy value',
        }],
        reasoning_content: 'message legacy value',
      },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'lookup',
        arguments: '{"reasoning_content":"business data"}',
        reasoning_content: 'call legacy value',
      },
    ],
    tools: [{
      type: 'function',
      name: 'lookup',
      parameters: {
        type: 'object',
        properties: { reasoning_content: { type: 'string' } },
        required: ['reasoning_content'],
      },
    }],
  };
  const normalized = normalizeProviderResponsesRequest(
    request,
    resolveProviderCompatibility(undefined, 'responses'),
  );
  const input = normalized.input as JsonObject[];
  const content = input[0]?.content as JsonObject[];
  const tools = normalized.tools as JsonObject[];

  assert.equal(input[0]?.reasoning_content, undefined);
  assert.equal(content[0]?.reasoning_content, undefined);
  assert.equal(input[1]?.reasoning_content, undefined);
  assert.equal(input[1]?.arguments, '{"reasoning_content":"business data"}');
  assert.equal(
    Object.hasOwn((tools[0]?.parameters as JsonObject).properties as JsonObject, 'reasoning_content'),
    true,
  );
  assert.deepEqual(normalized.reasoning, { effort: 'high' });
  assert.equal(normalized.reasoning_effort, undefined);
  assert.equal(request.reasoning_content, 'top-level legacy value');
});

test('Responses extension preservation is an explicit capability', () => {
  const request: ResponsesRequest = {
    input: [{
      role: 'assistant',
      content: 'prior answer',
      reasoning_content: 'opaque gateway continuation state',
    }],
  };
  const defaultProfile = resolveProviderCompatibility(undefined, 'responses');
  const stripped = normalizeProviderResponsesRequest(request, defaultProfile);
  assert.equal((stripped.input as JsonObject[])[0]?.reasoning_content, undefined);

  const extensionProfile = resolveProviderCompatibility({
    preserveResponsesReasoningContent: true,
  }, 'responses');
  const preserved = normalizeProviderResponsesRequest(request, extensionProfile);
  assert.equal((preserved.input as JsonObject[])[0]?.reasoning_content, 'opaque gateway continuation state');
});

test('Chat normalization applies configured protocol capabilities', () => {
  const body: JsonObject = {
    model: 'neutral-model',
    messages: [{
      role: 'assistant',
      content: '',
      reasoning_content: 'opaque provider continuation state',
    }],
    max_tokens: 4096,
  };
  const normalized = normalizeProviderChatCompletionsBody(
    body,
    resolveProviderCompatibility({
      preserveChatReasoningContent: true,
      chatMaxTokensField: 'max_completion_tokens',
    }, 'chat-completions'),
  );

  assert.equal((normalized.messages as JsonObject[])[0]?.reasoning_content, 'opaque provider continuation state');
  assert.equal(normalized.max_tokens, undefined);
  assert.equal(normalized.max_completion_tokens, 4096);
  assert.notEqual(normalized.messages, body.messages);
});

test('schema normalization preserves cross-schema required constraints through Responses-to-Chat conversion', () => {
  const schema = {
    type: 'object',
    allOf: [{
      properties: {
        path: { type: 'string' },
      },
    }],
    required: ['path'],
    additionalProperties: false,
  };
  const direct = normalizeProviderJsonSchema(schema) as JsonObject;
  assert.deepEqual(direct.required, ['path']);

  const chat = responsesToChatCompletions({
    model: 'neutral-model',
    input: 'inspect',
    tools: [{
      type: 'function',
      name: 'inspect_path',
      parameters: schema,
    }],
  });
  const normalized = normalizeProviderChatCompletionsBody(
    chat,
    resolveProviderCompatibility(undefined, 'chat-completions'),
  );
  const tools = normalized.tools as JsonObject[];
  const fn = tools[0]?.function as JsonObject;
  const parameters = fn.parameters as JsonObject;

  assert.deepEqual(parameters.required, ['path']);
  assert.deepEqual(parameters.allOf, direct.allOf);
  assert.deepEqual(schema.required, ['path']);
});

test('schema normalization preserves prototype-shaped names without polluting prototypes', () => {
  const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"constructor":{"type":"string"},"prototype":{"type":"string"}},"required":["__proto__","constructor","prototype"]}') as JsonObject;
  const normalized = normalizeProviderJsonSchema(schema) as JsonObject;
  const properties = normalized.properties as JsonObject;

  assert.equal(Object.hasOwn(properties, '__proto__'), true);
  assert.deepEqual(Object.keys(properties), ['__proto__', 'constructor', 'prototype']);
  assert.deepEqual(normalized.required, ['__proto__', 'constructor', 'prototype']);
  assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);
});

test('schema pattern constraints are retained or rejected, never silently weakened', () => {
  const portable = normalizeProviderJsonSchema({
    type: 'string',
    pattern: '^[A-Za-z0-9_-]+$',
  }) as JsonObject;
  assert.equal(portable.pattern, '^[A-Za-z0-9_-]+$');

  const advanced = normalizeProviderJsonSchema({
    type: 'string',
    pattern: '^(?!unsafe).+$',
  }) as JsonObject;
  assert.equal(advanced.pattern, '^(?!unsafe).+$');

  assert.throws(
    () => normalizeProviderJsonSchema({ type: 'string', pattern: '[' }),
    /invalid pattern/u,
  );
  assert.throws(
    () => normalizeProviderJsonSchema({ type: 'string', pattern: '^[a-z]+$' }, 'reject'),
    /disabled by configuration/u,
  );
  assert.throws(
    () => normalizeProviderJsonSchema({
      type: 'object',
      patternProperties: { '[': { type: 'string' } },
    }),
    /invalid pattern/u,
  );
  assert.throws(
    () => normalizeProviderJsonSchema({
      type: 'object',
      dependencies: {
        mode: {
          properties: { value: { type: 'string', pattern: '^(?!unsafe)' } },
        },
      },
    }, 'reject'),
    /disabled by configuration/u,
  );
});

test('schema traversal treats instance literals as data and fails closed on unsafe structure', () => {
  const normalized = normalizeProviderJsonSchema({
    type: 'object',
    properties: {
      payload: {
        type: 'object',
        const: {
          required: ['literal-required'],
          pattern: '^(?!literal-pattern)',
        },
      },
    },
  }) as JsonObject;
  const payload = (normalized.properties as JsonObject).payload as JsonObject;
  assert.deepEqual(payload.const, {
    required: ['literal-required'],
    pattern: '^(?!literal-pattern)',
  });

  const cyclic: Record<string, unknown> = { type: 'object', properties: {} };
  (cyclic.properties as Record<string, unknown>).self = cyclic;
  assert.throws(() => normalizeProviderJsonSchema(cyclic), /acyclic JSON tree/u);
  assert.throws(
    () => normalizeProviderJsonSchema({ type: 'number', maximum: Number.POSITIVE_INFINITY }),
    /finite numbers/u,
  );
  assert.throws(
    () => normalizeProviderJsonSchema({
      type: 'object',
      properties: { ['x'.repeat(4_097)]: { type: 'string' } },
    }),
    /property name exceeds/u,
  );

  let nested: JsonObject = { type: 'string' };
  for (let depth = 0; depth < 32; depth += 1) nested = { type: 'array', items: nested };
  assert.throws(() => normalizeProviderJsonSchema(nested), /maximum depth/u);
});

test('Responses-to-Chat conversion rejects non-object tool parameter roots', () => {
  assert.throws(
    () => responsesToChatCompletions({
      input: 'inspect',
      tools: [{
        type: 'function',
        name: 'inspect',
        parameters: { type: 'string' },
      }],
    }),
    /object root schema/u,
  );
  assert.throws(
    () => responsesToChatCompletions({
      input: 'inspect',
      tools: [{
        type: 'function',
        name: 'inspect',
        parameters: [],
      }],
    }),
    /JSON Schema object or boolean/u,
  );
});

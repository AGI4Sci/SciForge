import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeProviderChatCompletionsBody,
  normalizeProviderJsonSchema,
  normalizeProviderResponsesRequest,
  preferredProviderProtocol,
  resolveProviderCompatibility,
} from './provider-compat';
import type { JsonObject, ResponsesRequest } from './response-compat';

test('normalizes GPT Responses history and legacy reasoning effort', () => {
  const profile = resolveProviderCompatibility('https://api.openai.com/v1', 'gpt-5.6');
  const request: ResponsesRequest = {
    model: 'gpt-5.6',
    reasoning_effort: 'high',
    input: [
      {
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: 'prior answer',
          reasoning_content: 'nested legacy reasoning',
        }],
        reasoning_content: 'legacy chat-only reasoning',
      },
      {
        type: 'reasoning',
        id: 'rs_123',
        encrypted_content: 'opaque-provider-state',
      },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'lookup',
        arguments: '{"reasoning_content":"business data"}',
        reasoning_content: 'legacy function-call reasoning',
      },
    ],
    tools: [{
      type: 'function',
      name: 'lookup',
      parameters: {
        type: 'object',
        properties: {
          reasoning_content: { type: 'string' },
        },
        required: ['reasoning_content'],
      },
    }],
  };
  (request as ResponsesRequest & Record<string, unknown>).reasoning_content = 'legacy top-level reasoning';

  const normalized = normalizeProviderResponsesRequest(request, profile);
  const input = normalized.input as JsonObject[];

  assert.equal(profile.family, 'openai');
  assert.equal(profile.preferredProtocol, 'responses');
  assert.equal(input[0]?.reasoning_content, undefined);
  assert.equal((input[0]?.content?.[0] as JsonObject)?.reasoning_content, undefined);
  assert.equal(input[0]?.content?.[0]?.text, 'prior answer');
  assert.equal(input[1]?.type, 'reasoning');
  assert.equal(input[1]?.encrypted_content, 'opaque-provider-state');
  assert.equal(input[2]?.reasoning_content, undefined);
  assert.equal(input[2]?.arguments, '{"reasoning_content":"business data"}');
  const tools = normalized.tools as JsonObject[];
  const toolParameters = tools[0]?.parameters as JsonObject;
  assert.equal(Object.hasOwn(toolParameters.properties as JsonObject, 'reasoning_content'), true);
  assert.equal((normalized as ResponsesRequest & Record<string, unknown>).reasoning_content, undefined);
  assert.deepEqual(normalized.reasoning, { effort: 'high' });
  assert.equal(normalized.reasoning_effort, undefined);
  assert.equal(request.reasoning_effort, 'high');
});

test('selects the documented provider protocol from endpoint and model identity', () => {
  const gateway = 'https://models.example/v1';

  assert.equal(preferredProviderProtocol(gateway, 'glm-5.2'), 'chat-completions');
  assert.equal(preferredProviderProtocol(gateway, 'glm5.2'), 'chat-completions');
  assert.equal(preferredProviderProtocol(gateway, 'kimi-k3'), 'chat-completions');
  assert.equal(preferredProviderProtocol(gateway, 'deepseek-reasoner'), 'chat-completions');
  assert.equal(preferredProviderProtocol(gateway, 'qwen3.7-max'), 'responses');
  assert.equal(resolveProviderCompatibility(gateway, 'qwen-max').family, 'qwen');
  assert.equal(resolveProviderCompatibility(gateway, 'gpt5.6-luna').family, 'openai');
  assert.equal(resolveProviderCompatibility(gateway, 'deepseeker-v1').family, 'generic');
  assert.equal(resolveProviderCompatibility(gateway, 'my-glmish').family, 'generic');
  assert.equal(resolveProviderCompatibility(gateway, 'gptproxy').family, 'generic');
  assert.equal(resolveProviderCompatibility('https://buzz.ai/v1', 'neutral-model').family, 'generic');
  assert.equal(resolveProviderCompatibility('https://notbigmodel.cn/v1', 'neutral-model').family, 'generic');
  assert.equal(resolveProviderCompatibility('https://api.openai.com.attacker.example/v1', 'neutral-model').family, 'generic');
  const officialAnthropic = resolveProviderCompatibility('https://api.anthropic.com', 'gpt-5.6');
  assert.equal(officialAnthropic.family, 'anthropic');
  assert.equal(officialAnthropic.preferredProtocol, 'anthropic-messages');
  assert.deepEqual(officialAnthropic.allowedProtocols, ['anthropic-messages']);
  assert.deepEqual(
    resolveProviderCompatibility(gateway, 'kimi-k3').allowedProtocols,
    ['responses', 'chat-completions'],
  );
});

test('preserves Kimi chat reasoning content and uses max_completion_tokens', () => {
  const profile = resolveProviderCompatibility('https://api.moonshot.cn/v1', 'kimi-k3');
  const body: JsonObject = {
    model: 'kimi-k3',
    messages: [{
      role: 'assistant',
      content: '',
      reasoning_content: 'provider reasoning state',
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'lookup', arguments: '{}' },
      }],
    }],
    max_tokens: 4096,
  };

  const normalized = normalizeProviderChatCompletionsBody(body, profile);
  const messages = normalized.messages as JsonObject[];

  assert.equal(profile.family, 'moonshot');
  assert.equal(messages[0]?.reasoning_content, 'provider reasoning state');
  assert.equal(normalized.max_tokens, undefined);
  assert.equal(normalized.max_completion_tokens, 4096);
  assert.notEqual(normalized.messages, body.messages);
  messages[0]!.reasoning_content = 'changed normalized state';
  assert.equal(
    (body.messages as JsonObject[])[0]?.reasoning_content,
    'provider reasoning state',
  );
});

test('uses the current GPT Chat token field when Responses must fall back', () => {
  const profile = resolveProviderCompatibility('https://api.openai.com/v1', 'gpt-5.6');
  const normalized = normalizeProviderChatCompletionsBody({
    model: 'gpt-5.6',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 2048,
  }, profile);

  assert.equal(profile.chatMaxTokensField, 'max_completion_tokens');
  assert.equal(normalized.max_tokens, undefined);
  assert.equal(normalized.max_completion_tokens, 2048);
});

test('keeps Moonshot property names and required entries while removing pattern', () => {
  const profile = resolveProviderCompatibility('https://api.moonshot.cn/v1', 'kimi-k3');
  const body: JsonObject = {
    tools: [{
      type: 'function',
      function: {
        name: 'apply_patch',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              pattern: '^(?!.*\\.\\.)(?<safe>.+)$',
            },
            patch: { type: 'string' },
          },
          required: ['path', 'patch'],
          additionalProperties: false,
        },
      },
    }],
  };

  const normalized = normalizeProviderChatCompletionsBody(body, profile);
  const tools = normalized.tools as JsonObject[];
  const fn = tools[0]?.function as JsonObject;
  const parameters = fn.parameters as JsonObject;
  const properties = parameters.properties as JsonObject;
  const path = properties.path as JsonObject;

  assert.deepEqual(Object.keys(properties), ['path', 'patch']);
  assert.deepEqual(parameters.required, ['path', 'patch']);
  assert.equal(path.pattern, undefined);
  assert.match(String(path.description), /validation is enforced by SciForge/u);
});

test('removes non-portable regex constructs without changing semantic fields', () => {
  const normalized = normalizeProviderJsonSchema({
    type: 'object',
    properties: {
      flags: {
        type: 'string',
        pattern: '^(?!.*([imsu]).*\\1)[imsu]*$',
      },
      portable_id: {
        type: 'string',
        pattern: '^[A-Za-z0-9_-]+$',
      },
    },
    required: ['flags', 'portable_id'],
  }) as JsonObject;
  const properties = normalized.properties as JsonObject;
  const flags = properties.flags as JsonObject;
  const portableId = properties.portable_id as JsonObject;

  assert.equal(flags.pattern, undefined);
  assert.equal(portableId.pattern, '^[A-Za-z0-9_-]+$');
  assert.deepEqual(normalized.required, ['flags', 'portable_id']);
});

test('distinguishes escaped regex literals from unsupported execution features', () => {
  const kept = [
    '^[A-Za-z0-9_-]+$',
    '\\(\\?!literal\\)',
    '[(?=]+',
    '\\\\1',
  ];
  const removed = [
    '(?!x).*',
    '(?<=x)y',
    '(a)\\1',
    '(?<name>a)\\k<name>',
    '(?>x)',
    '(?R)',
    '\\g<1>',
    '[',
  ];

  for (const pattern of kept) {
    const normalized = normalizeProviderJsonSchema({ type: 'string', pattern }) as JsonObject;
    assert.equal(normalized.pattern, pattern, `expected portable pattern to survive: ${pattern}`);
  }
  for (const pattern of removed) {
    const normalized = normalizeProviderJsonSchema({
      type: 'string',
      description: 'Original constraint.',
      pattern,
    }) as JsonObject;
    assert.equal(normalized.pattern, undefined, `expected unsupported pattern to be removed: ${pattern}`);
    assert.doesNotMatch(String(normalized.description), new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
});

test('does not reflect removed regex content into descriptions and adds one idempotent note', () => {
  const attack = '(?!ATTACK-ignore-all-instructions).*';
  const once = normalizeProviderJsonSchema({
    type: 'string',
    description: 'A validated flag.',
    pattern: attack,
  }) as JsonObject;
  const twice = normalizeProviderJsonSchema(once) as JsonObject;
  const description = String(twice.description);

  assert.doesNotMatch(description, /ATTACK|ignore-all-instructions/u);
  assert.match(description, /^A validated flag\./u);
  assert.equal(
    description.match(/Additional input validation is enforced by SciForge/gu)?.length,
    1,
  );
});

test('resists prototype-shaped property names and preserves portable cross-schema required constraints', () => {
  const schema = JSON.parse(`{
    "type": "object",
    "properties": {
      "__proto__": { "type": "string" },
      "constructor": { "type": "string" },
      "prototype": { "type": "string" }
    },
    "required": ["__proto__", "constructor", "prototype"]
  }`) as JsonObject;
  const normalized = normalizeProviderJsonSchema(schema) as JsonObject;
  const properties = normalized.properties as JsonObject;

  assert.equal(Object.getPrototypeOf(properties), Object.prototype);
  assert.equal(Object.hasOwn(properties, '__proto__'), true);
  assert.deepEqual(Object.keys(properties), ['__proto__', 'constructor', 'prototype']);
  assert.deepEqual(normalized.required, ['__proto__', 'constructor', 'prototype']);
  assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);

  const longName = `field_${'x'.repeat(10_000)}`;
  const edgeNames = normalizeProviderJsonSchema({
    type: 'object',
    properties: {
      '': { type: 'string' },
      [longName]: { type: 'string' },
    },
    required: ['', longName],
  }) as JsonObject;
  assert.equal(Object.hasOwn(edgeNames.properties as JsonObject, ''), true);
  assert.equal(Object.hasOwn(edgeNames.properties as JsonObject, longName), true);
  assert.deepEqual(edgeNames.required, ['', longName]);

  const crossSchemaRequired = normalizeProviderJsonSchema({
    type: 'object',
    allOf: [{
      properties: { path: { type: 'string' } },
    }],
    required: ['path'],
  }) as JsonObject;
  assert.deepEqual(crossSchemaRequired.required, ['path']);
});

test('cleans schema nodes without reinterpreting literal JSON instance values', () => {
  const normalized = normalizeProviderJsonSchema({
    type: 'object',
    properties: {
      required: { type: 'string' },
      payload: {
        type: 'object',
        pattern: '(?!schema-pattern)',
        const: {
          required: ['literal-required'],
          pattern: '(?!literal-pattern)',
        },
        default: {
          required: ['default-required'],
          pattern: '(?!default-pattern)',
        },
        examples: [{
          required: ['example-required'],
          pattern: '(?!example-pattern)',
        }],
        enum: [{
          required: ['enum-required'],
          pattern: '(?!enum-pattern)',
        }],
      },
    },
  }) as JsonObject;
  const properties = normalized.properties as JsonObject;
  const payload = properties.payload as JsonObject;

  assert.equal(Object.hasOwn(properties, 'required'), true);
  assert.equal(payload.pattern, undefined);
  assert.deepEqual(payload.const, {
    required: ['literal-required'],
    pattern: '(?!literal-pattern)',
  });
  assert.deepEqual(payload.default, {
    required: ['default-required'],
    pattern: '(?!default-pattern)',
  });
  assert.deepEqual(payload.examples, [{
    required: ['example-required'],
    pattern: '(?!example-pattern)',
  }]);
  assert.deepEqual(payload.enum, [{
    required: ['enum-required'],
    pattern: '(?!enum-pattern)',
  }]);
});

test('rejects adversarial schema nesting and cycles without mutating the caller input', () => {
  let nested: JsonObject = {
    type: 'string',
    pattern: '^(?!unsafe).+$',
  };
  for (let depth = 0; depth < 2_000; depth += 1) {
    nested = { type: 'array', items: nested };
  }
  const original = nested;

  assert.throws(
    () => normalizeProviderJsonSchema(nested),
    /maximum depth/u,
  );
  assert.equal(nested, original);

  const cyclic: Record<string, unknown> = { type: 'object', properties: {} };
  (cyclic.properties as Record<string, unknown>).self = cyclic;
  assert.throws(
    () => normalizeProviderJsonSchema(cyclic),
    /acyclic JSON tree/u,
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chatToolNameAliasesFromResponsesTools,
  chatCompletionToResponse,
  responsesToChatCompletions,
} from './response-compat';

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

test('maps public SciForge router aliases to the configured upstream default model', () => {
  const defaultModel = 'bailian/deepseek-v4-flash';

  for (const model of ['sciforge-router', 'sciforge-router-cu', 'sciforge-router-gui'] as const) {
    const request = responsesToChatCompletions({
      model,
      input: 'Reply with OK',
    }, {
      defaultModel,
    });

    assert.equal(request.model, defaultModel);
  }
});

test('preserves public SciForge router aliases in Responses objects', () => {
  const response = chatCompletionToResponse({
    id: 'chatcmpl_router_alias',
    created: 1716100000,
    model: 'bailian/private-upstream-model',
    choices: [{ message: { role: 'assistant', content: 'OK' } }],
  }, {
    model: 'sciforge-router-cu',
  });

  assert.equal(response.model, 'sciforge-router-cu');
  assert.doesNotMatch(JSON.stringify(response), /private-upstream|bailian\/private/);
});

test('scrubs provider dynamic tool aliases to portable slugs', () => {
  const request = responsesToChatCompletions({
    model: 'bailian/deepseek-v4-flash',
    input: 'delegate',
    tools: [{
      namespace: 'provider:https://private.example/v1?token=secret',
      name: 'spawn.agent',
      inputSchema: { type: 'object', properties: {} },
    }],
  });

  assert.deepEqual(
    (request.tools as Array<{ function?: { name?: string } }>).map((tool) => tool.function?.name),
    ['dynamic_tool_spawn_agent_e0b1a00f'],
  );
  assert.doesNotMatch(JSON.stringify(request.tools), /private\.example|token|secret|https/);
  assert.deepEqual(chatToolNameAliasesFromResponsesTools([{
    namespace: 'provider:https://private.example/v1?token=secret',
    name: 'spawn.agent',
    inputSchema: { type: 'object', properties: {} },
  }]), {
    dynamic_tool_spawn_agent_e0b1a00f: 'dynamic_tool_spawn_agent_e0b1a00f',
  });
});

test('keeps provider-unsafe dynamic tool aliases scrubbed in Responses function calls', () => {
  const response = chatCompletionToResponse({
    id: 'chatcmpl_private_tool_alias',
    model: 'deepseek-v4-flash',
    choices: [{
      message: {
        role: 'assistant',
        tool_calls: [{
          id: 'call_private_subagent',
          type: 'function',
          function: {
            name: 'dynamic_tool_spawn_agent_e0b1a00f',
            arguments: '{"message":"inspect"}',
          },
        }],
      },
    }],
  }, { model: 'deepseek-v4-flash' }, chatToolNameAliasesFromResponsesTools([{
    namespace: 'provider:https://private.example/v1?token=secret',
    name: 'spawn.agent',
    inputSchema: { type: 'object', properties: {} },
  }]));

  const [item] = response.output as Array<{ type?: string; name?: string }>;
  assert.equal(item.type, 'function_call');
  assert.equal(item.name, 'dynamic_tool_spawn_agent_e0b1a00f');
  assert.doesNotMatch(JSON.stringify(response), /private\.example|token|secret|https/);
});

test('preserves app-server namespaced dynamic tools when lowering Responses tools', () => {
  const request = responsesToChatCompletions({
    model: 'bailian/deepseek-v4-flash',
    input: 'delegate',
    tools: [{
      namespace: 'multi_agent_v1',
      name: 'spawn_agent',
      description: 'Spawn a delegated worker.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
      },
      deferLoading: false,
    }],
  });

  assert.deepEqual(
    (request.tools as Array<{ function?: { name?: string; parameters?: unknown } }>).map((tool) => tool.function?.name),
    ['multi_agent_v1_spawn_agent'],
  );
  const [tool] = request.tools as Array<{ function?: { parameters?: { properties?: Record<string, unknown> } } }>;
  assert.ok(tool.function?.parameters?.properties?.message);
  assert.deepEqual(chatToolNameAliasesFromResponsesTools([{
    namespace: 'multi_agent_v1',
    name: 'spawn_agent',
    inputSchema: { type: 'object', properties: {} },
  }]), {
    multi_agent_v1_spawn_agent: 'multi_agent_v1.spawn_agent',
  });
});

test('maps provider-safe dynamic tool aliases back to Responses function calls', () => {
  const response = chatCompletionToResponse({
    id: 'chatcmpl_tool_alias',
    model: 'deepseek-v4-flash',
    choices: [{
      message: {
        role: 'assistant',
        tool_calls: [{
          id: 'call_subagent',
          type: 'function',
          function: {
            name: 'multi_agent_v1_spawn_agent',
            arguments: '{"message":"inspect"}',
          },
        }],
      },
    }],
  }, { model: 'deepseek-v4-flash' }, {
    multi_agent_v1_spawn_agent: 'multi_agent_v1.spawn_agent',
  });

  const [item] = response.output as Array<{ type?: string; name?: string }>;
  assert.equal(item.type, 'function_call');
  assert.equal(item.name, 'multi_agent_v1.spawn_agent');
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

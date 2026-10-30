import assert from 'node:assert/strict';
import { test } from 'node:test';

import { responsesToChatCompletions } from './response-compat';

type ChatTool = {
  type: string;
  function: { name: string; description?: string; parameters?: unknown };
};

function tool(name: string, description: string): Record<string, unknown> {
  return {
    type: 'function',
    name,
    description,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look up.' } },
      required: ['query'],
    },
  };
}

test('keeps tool descriptions when the chat request stays small', () => {
  const body = responsesToChatCompletions({
    model: 'configured-model',
    input: 'hello',
    tools: [tool('lookup', 'Look something up.')],
  });

  const tools = body.tools as ChatTool[];
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.function.name, 'lookup');
  assert.equal(tools[0]?.function.description, 'Look something up.');
});

test('strips verbose tool schema text once the request grows past the threshold', () => {
  const verbose = 'x'.repeat(1_900);
  const tools = Array.from({ length: 40 }, (_value, index) => tool(`tool_${index}`, verbose));

  const body = responsesToChatCompletions({
    model: 'configured-model',
    input: 'hello',
    tools,
  });

  const compacted = body.tools as ChatTool[];
  assert.equal(compacted.length, 40);
  assert.equal(JSON.stringify(compacted).includes(verbose), false);
  for (const [index, entry] of compacted.entries()) {
    assert.equal(entry.type, 'function');
    assert.equal(entry.function.name, `tool_${index}`);
    assert.equal(entry.function.description, undefined);
    assert.equal(JSON.stringify(entry.function.parameters).includes('What to look up.'), false);
  }
  assert.ok(JSON.stringify(compacted).length < 20_000);
});

test('rewrites a Responses tool_choice into the chat-completions shape without aliases', () => {
  const body = responsesToChatCompletions({
    model: 'configured-model',
    input: 'hello',
    tool_choice: { type: 'function', name: 'lookup' },
  });

  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'lookup' } });
});

test('keeps the plain string tool_choice modes unchanged', () => {
  const body = responsesToChatCompletions({
    model: 'configured-model',
    input: 'hello',
    tools: [tool('lookup', 'Look something up.')],
    tool_choice: 'auto',
  });

  assert.equal(body.tool_choice, 'auto');
});
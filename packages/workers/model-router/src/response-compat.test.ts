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
    tools: [tool('lookup', 'Look something up.')],
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

test('omits optional tool choice when no callable Chat tools remain and preserves structured output', () => {
  for (const tools of [undefined, [], [{ type: 'custom', name: 'apply_patch', format: { type: 'grammar' } }],
    [{ type: 'web_search' }], [{ type: 'namespace', name: 'empty', tools: [] }]]) {
    for (const tool_choice of [undefined, null, 'auto', 'none']) {
      const request = {
        input: 'Return an answer.', tools, tool_choice,
        outputSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false },
      };
      const before = JSON.stringify(request);
      const body = responsesToChatCompletions(request);
      assert.equal(Object.hasOwn(body, 'tools'), false);
      assert.equal(Object.hasOwn(body, 'tool_choice'), false);
      assert.equal((body.response_format as { type: string }).type, 'json_schema');
      assert.equal(JSON.stringify(request), before);
    }
  }
});

test('rejects required or named choices instead of silently dropping an unsatisfiable tool obligation', () => {
  for (const tools of [undefined, [], [{ type: 'custom', name: 'apply_patch' }], [{ type: 'web_search' }]]) {
    for (const tool_choice of ['required', { type: 'function', name: 'lookup' },
      { type: 'function', function: { name: 'lookup' } }, { type: 'custom', name: 'lookup' }]) {
      assert.throws(() => responsesToChatCompletions({ input: 'hello', tools, tool_choice }),
        /cannot honor required or selected tool_choice without any usable tools/);
    }
  }
});

test('retains none, required and named tool choices when callable tools are available', () => {
  const tools = [tool('lookup', 'Look something up.')];
  for (const tool_choice of ['none', 'required']) {
    assert.equal(responsesToChatCompletions({ input: 'hello', tools, tool_choice }).tool_choice, tool_choice);
  }
  const body = responsesToChatCompletions({ input: 'hello', tools, tool_choice: { type: 'function', name: 'lookup' } });
  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'lookup' } });
  assert.equal((body.tools as ChatTool[]).length, 1);
});

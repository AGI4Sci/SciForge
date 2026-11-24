import assert from 'node:assert/strict';
import { test } from 'node:test';

import { anthropicMessageToResponse, responseToAnthropicMessage, responsesToAnthropicMessages, responsesToChatCompletions } from './response-compat';

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

test('explicit final answers delimit independent assistant reasoning turns', () => {
  const body = responsesToChatCompletions({ input: [
    { role: 'user', content: 'question' },
    { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'first reasoning' }], summary: [] },
    { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'first answer' }] },
    { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'second reasoning' }], summary: [] },
    { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'second answer' }] },
  ] });
  assert.deepEqual((body.messages as Array<Record<string, unknown>>).slice(1).map(item => [item.content, item.reasoning_content]),
    [['first answer', 'first reasoning'], ['second answer', 'second reasoning']]);
});

test('display summaries never become full provider reasoning on protocol conversion', () => {
  const body = responsesToChatCompletions({ input: [
    { type: 'reasoning', summary: [{ type: 'summary_text', text: 'display summary only' }] },
    { type: 'function_call', name: 'inspect', call_id: 'call_a', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call_a', output: 'result' },
  ] });
  assert.equal((body.messages as Array<Record<string, unknown>>)[0]?.reasoning_content, undefined);
});


test('empty signed thinking retains its exact signature through canonical conversion and replay', () => {
  for (const signature of ['opaque-signature', '']) {
    const thinking = { type: 'thinking', thinking: '', signature };
    const response = anthropicMessageToResponse({ content: [thinking], stop_reason: 'end_turn' });
    assert.deepEqual(responseToAnthropicMessage(response).content, [thinking]);
    const replay = responsesToAnthropicMessages({ input: response.output });
    assert.deepEqual((replay.messages as Array<{ content: unknown }>)[0]?.content, [thinking]);
    assert.throws(() => responsesToChatCompletions({ input: response.output }), /cannot represent opaque/);
  }
});


test('message protocols explicitly reject native client tool calls and results', () => {
  const items = [
    { type: 'custom_tool_call', call_id: 'custom', name: 'edit', input: 'raw source' },
    { type: 'custom_tool_call_output', call_id: 'custom', output: 'done' },
    { type: 'tool_search_call', execution: 'client', call_id: 'search', arguments: { query: 'tools' } },
    { type: 'tool_search_output', execution: 'client', call_id: 'search', tools: [] },
  ];
  for (const item of items) {
    for (const convert of [responsesToChatCompletions, responsesToAnthropicMessages]) {
      assert.throws(() => convert({ input: [item] }), /cannot represent native Responses client tool transcripts/);
    }
  }
});

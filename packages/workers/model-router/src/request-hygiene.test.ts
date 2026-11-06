import assert from 'node:assert/strict';
import test from 'node:test';
import { hygienizeModelRequestBody } from './request-hygiene';

const HISTORY_ONLY_SHELL_ARGUMENT =
  'false # sciforge history metadata only; prior shell command omitted; do not execute or reuse; create a fresh smaller command';

test('request hygiene replaces long shell-command argument fields with an explicit failing history sentinel', () => {
  for (const key of ['cmd', 'command', 'shell_command', 'shellCommand']) {
    const body = toolCallBody({ [key]: `python3 <<'PY'\n${'print("work")\n'.repeat(700)}PY` });
    const args = hygienizedArguments(body);

    assert.equal(args[key], HISTORY_ONLY_SHELL_ARGUMENT);
  }
});

test('request hygiene does not assume a generic script field is executable shell', () => {
  const script = 'draw();\n'.repeat(1_000);
  const args = hygienizedArguments(toolCallBody({ script }));

  assert.notEqual(args.script, HISTORY_ONLY_SHELL_ARGUMENT);
  assert.match(String(args.script), /reason=large_argument_string/u);
});

test('request hygiene upgrades persisted shell placeholders instead of preserving replayable no-ops', () => {
  const oldPlaceholders = [
    ': # sciforge request hygiene omitted prior shell command; inspect paired tool result',
    ': # sciforge history omitted prior bash command; inspect paired tool result',
    '[sciforge request_hygiene source=tool_call.arguments.command reason=large_argument_string digest=sha256:abc original_chars=7000]',
  ];

  for (const command of oldPlaceholders) {
    const args = hygienizedArguments(toolCallBody({ cmd: command }));
    assert.equal(args.cmd, HISTORY_ONLY_SHELL_ARGUMENT);
  }
});

test('request hygiene does not rewrite ordinary short commands that mention marker text as data', () => {
  const command = `rg -n 'sciforge request hygiene omitted prior shell command' src`;
  const args = hygienizedArguments(toolCallBody({ cmd: command }));

  assert.equal(args.cmd, command);
});

test('request hygiene preserves prototype-shaped JSON keys without prototype mutation', () => {
  const body = JSON.parse('{"__proto__":{"polluted":"no"},"messages":[{"role":"user","content":"hello","constructor":{"prototype":{"polluted":"no"}}}]}') as Record<string, unknown>;
  const hygienized = hygienizeModelRequestBody(body);
  const messages = hygienized.messages as Array<Record<string, unknown>>;

  assert.equal(Object.hasOwn(hygienized, '__proto__'), true);
  assert.equal(Object.hasOwn(messages[0] ?? {}, 'constructor'), true);
  assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);
});

test('request hygiene preserves structured-output schema subtrees as contract data', () => {
  const opaqueConst = 'AbCd0123_+'.repeat(60);
  const opaqueDescription = 'EfGh4567_+'.repeat(60);
  const schema = {
    type: 'object',
    properties: {
      value: { type: 'string', const: opaqueConst },
    },
    required: ['value'],
    additionalProperties: false,
  };
  const body = {
    outputSchema: schema,
    text: {
      format: {
        type: 'json_schema',
        name: 'responses_contract',
        description: opaqueDescription,
        schema,
      },
    },
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'chat_contract',
        description: opaqueDescription,
        schema,
      },
    },
    output_config: { format: { type: 'json_schema', schema } },
  };

  assert.deepEqual(hygienizeModelRequestBody(body), body);
});

test('request hygiene does not exempt schema-shaped fields without a structured-output discriminator', () => {
  const opaquePayload = 'AbCd0123_+'.repeat(60);
  const hygienized = hygienizeModelRequestBody({
    'text.format.schema': opaquePayload,
    text: { format: { type: 'plain_text', schema: opaquePayload } },
  });
  const text = hygienized.text as Record<string, unknown>;
  const format = text.format as Record<string, unknown>;

  assert.match(String(hygienized['text.format.schema']), /reason=encoded_payload/u);
  assert.match(String(format.schema), /reason=encoded_payload/u);
});

test('request hygiene preserves opaque state only for native Responses continuation items', () => {
  const encryptedContent = 'AbCd0123_+'.repeat(80);
  const hygienized = hygienizeModelRequestBody({
    input: [
      { type: 'reasoning', encrypted_content: encryptedContent },
      { type: 'compaction', encrypted_content: encryptedContent },
      { type: 'message', encrypted_content: encryptedContent },
    ],
  });
  const input = hygienized.input as Array<Record<string, unknown>>;

  assert.equal(input[0]?.encrypted_content, encryptedContent);
  assert.equal(input[1]?.encrypted_content, encryptedContent);
  assert.match(String(input[2]?.encrypted_content), /reason=encoded_payload/u);
});

function toolCallBody(args: Record<string, unknown>): Record<string, unknown> {
  return {
    messages: [{
      role: 'assistant',
      tool_calls: [{
        id: 'call-1',
        type: 'function',
        function: {
          name: 'exec_command',
          arguments: JSON.stringify(args),
        },
      }],
    }],
  };
}

function hygienizedArguments(body: Record<string, unknown>): Record<string, unknown> {
  const hygienized = hygienizeModelRequestBody(body);
  const messages = hygienized.messages as Array<Record<string, unknown>>;
  const toolCalls = messages[0]?.tool_calls as Array<Record<string, unknown>>;
  const fn = toolCalls[0]?.function as Record<string, unknown>;
  return JSON.parse(String(fn.arguments)) as Record<string, unknown>;
}

test('tool results remain lossless across native protocol envelopes and repeated recovery pages', () => {
  const text = JSON.stringify({ content: '"\\'.repeat(5000), nextOffset: 10000, artifactRef: 'stable-result' });
  const body = {
    input: [
      { type: 'function_call_output', call_id: 'one', output: text },
      { type: 'function_call_output', call_id: 'two', output: JSON.stringify([{ type: 'inputText', text }]) },
    ],
    messages: [
      { role: 'tool', tool_call_id: 'one', content: text },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'two', content: [{ type: 'text', text }] }] },
    ],
  };
  assert.deepEqual(hygienizeModelRequestBody(body), body);
});

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

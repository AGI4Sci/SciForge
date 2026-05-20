import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  GUI_ACTION_COMMAND_TRACE_CASE_ID,
  assertGuiActionCommandTraceCase,
  runGuiActionCommandTraceCase,
  type GuiActionCommandTraceCaseResult,
} from './gui-action-command-trace.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-28-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-28 reduces visible GUI actions to commandText with refs and audit trace', async () => {
  const result = await runGuiActionCommandTraceCase({ baseDir });

  assert.equal(result.fixture.caseId, GUI_ACTION_COMMAND_TRACE_CASE_ID);
  assertGuiActionCommandTraceCase(result);
  assert.deepEqual(result.actions.map((event) => event.action), ['open', 'retry', 'export', 'recover', 'delete']);
  assert.deepEqual(result.actions.map((event) => event.dispatchRoute), [
    'runtime-dispatch',
    'runtime-dispatch',
    'runtime-dispatch',
    'runtime-dispatch',
    'runtime-dispatch',
  ]);
});

test('SA-WEB-28 fails focused verification if a GUI action carries hidden business payload', async () => {
  const result = await runGuiActionCommandTraceCase({ baseDir });
  const polluted = structuredClone(result) as GuiActionCommandTraceCaseResult & {
    actions: Array<GuiActionCommandTraceCaseResult['actions'][number] & { businessPayload?: unknown }>;
  };
  (polluted.actions as unknown as Array<Record<string, unknown>>)[0] = {
    ...polluted.actions[0]!,
    businessPayload: { artifactBody: 'SHOULD_NOT_BE_SENT_BY_GUI' },
  };

  assert.throws(
    () => assertGuiActionCommandTraceCase(polluted),
    /hidden business payload must be absent/,
  );
});

test('SA-WEB-28 fails focused verification if a GUI action executes local business logic', async () => {
  const result = await runGuiActionCommandTraceCase({ baseDir });
  const polluted = structuredClone(result) as GuiActionCommandTraceCaseResult & {
    actions: Array<GuiActionCommandTraceCaseResult['actions'][number] & { localBusinessExecution?: unknown }>;
  };
  (polluted.actions as unknown as Array<Record<string, unknown>>)[3] = {
    ...polluted.actions[3]!,
    commandText: 'triggerRecover({ runId: "run-sa-web-28-current" })',
    localBusinessExecution: 'triggerRecover',
  };

  assert.throws(
    () => assertGuiActionCommandTraceCase(polluted),
    /commandText must not contain GUI business function calls|local GUI business execution must be absent/,
  );
});

test('SA-WEB-28 fails focused verification if refs or audit trace are missing', async () => {
  const result = await runGuiActionCommandTraceCase({ baseDir });
  const polluted = structuredClone(result) as GuiActionCommandTraceCaseResult;
  polluted.actions[2] = {
    ...polluted.actions[2]!,
    refs: [],
    auditTraceRef: '',
  };

  assert.throws(
    () => assertGuiActionCommandTraceCase(polluted),
    /refs must accompany commandText/,
  );
});

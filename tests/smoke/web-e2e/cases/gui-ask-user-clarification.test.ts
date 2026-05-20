import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  GUI_ASK_USER_CLARIFICATION_CASE_ID,
  assertGuiAskUserClarificationCase,
  runGuiAskUserClarificationCase,
  type GuiAskUserClarificationCaseResult,
  type GuiAskUserClarificationEvent,
} from './gui-ask-user-clarification.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-24-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-24 turns a gui.ask_user visible prompt and user confirmation into terminal-equivalent commandText', async () => {
  const result = await runGuiAskUserClarificationCase({ baseDir });

  assert.equal(result.fixture.caseId, GUI_ASK_USER_CLARIFICATION_CASE_ID);
  assertGuiAskUserClarificationCase(result);
  assert.equal(result.commandText, result.userText);
  assert.equal(result.transcript[1]?.type, 'gui.ask_user');
  assert.equal(result.transcript[4]?.type, 'dispatch');
});

test('SA-WEB-24 fails focused verification if user text is not returned as commandText', async () => {
  const result = await runGuiAskUserClarificationCase({ baseDir });
  const polluted: GuiAskUserClarificationCaseResult = {
    ...result,
    transcript: result.transcript.map((event) => ({ ...event })) as GuiAskUserClarificationEvent[],
  };
  polluted.transcript[3] = {
    step: 4,
    type: 'commandText',
    commandText: 'Apply q_value change locally.',
    terminalEquivalent: true,
  };

  assert.throws(
    () => assertGuiAskUserClarificationCase(polluted),
    /user text confirmation must return as commandText/,
  );
});

test('SA-WEB-24 fails focused verification if a GUI local business function runs', async () => {
  const result = await runGuiAskUserClarificationCase({ baseDir });
  const polluted: GuiAskUserClarificationCaseResult = {
    ...result,
    transcript: result.transcript.map((event) => ({ ...event })) as GuiAskUserClarificationEvent[],
  };
  polluted.transcript[4] = {
    step: 5,
    type: 'dispatch',
    route: 'runtime-dispatch',
    commandText: result.commandText,
    localBusinessFunction: 'business.rerunDifferentialExpression',
  } as unknown as GuiAskUserClarificationEvent;

  assert.throws(
    () => assertGuiAskUserClarificationCase(polluted),
    /GUI local business function must not run/,
  );
});

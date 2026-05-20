import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  LONG_CONTEXT_CONSTRAINT_STABILITY_CASE_ID,
  LONG_CONTEXT_FINAL_ANSWER,
  LONG_CONTEXT_FINAL_PROMPT,
  LONG_CONTEXT_ORIGINAL_CONSTRAINT,
  LONG_CONTEXT_UNRELATED_ARTIFACT_REFS,
  assertLongContextConstraintStabilityCase,
  runLongContextConstraintStabilityCase,
  type LongContextConstraintStabilityResult,
} from './long-context-constraint-stability.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-r-mem-01-long-context-constraint-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('R-MEM-01 recovers the original constraint after unrelated long-context artifact noise', async () => {
  const result = await runLongContextConstraintStabilityCase({
    baseDir,
    outputRoot: join(baseDir, 'evidence'),
    now: '2026-05-20T00:00:00.000Z',
  });

  assert.equal(result.fixture.caseId, LONG_CONTEXT_CONSTRAINT_STABILITY_CASE_ID);
  assert.equal(result.turns[0]?.prompt, LONG_CONTEXT_ORIGINAL_CONSTRAINT);
  assert.equal(result.turns[2]?.prompt, LONG_CONTEXT_FINAL_PROMPT);
  assert.equal(result.turns[2]?.recoveredConstraint, LONG_CONTEXT_ORIGINAL_CONSTRAINT);
  assert.equal(result.browserVisibleState.visibleAnswerText, LONG_CONTEXT_FINAL_ANSWER);
  assert.deepEqual(result.browserVisibleState.visibleArtifactRefs, []);
  assert.ok(result.runAudit.refs.length <= 6);
  assertLongContextConstraintStabilityCase(result);
});

test('R-MEM-01 guard fails if the final turn forgets the original constraint', async () => {
  const result = await runLongContextConstraintStabilityCase({ baseDir });
  const polluted: LongContextConstraintStabilityResult = {
    ...result,
    turns: result.turns.map((turn) => ({ ...turn, generatedArtifactRefs: [...turn.generatedArtifactRefs], auditRefs: [...turn.auditRefs] })),
  };
  const finalTurn = polluted.turns[2];
  assert.ok(finalTurn);
  finalTurn.recoveredConstraint = 'Use whichever formatting the unrelated literature report used.';

  assert.throws(
    () => assertLongContextConstraintStabilityCase(polluted),
    /final turn must recover the original constraint verbatim/,
  );
});

test('R-MEM-01 guard fails if unrelated artifact refs pollute the final answer', async () => {
  const result = await runLongContextConstraintStabilityCase({ baseDir });
  const polluted: LongContextConstraintStabilityResult = {
    ...result,
    browserVisibleState: {
      ...result.browserVisibleState,
      visibleAnswerText: `${result.browserVisibleState.visibleAnswerText} See ${LONG_CONTEXT_UNRELATED_ARTIFACT_REFS[0]}.`,
    },
  };

  assert.throws(
    () => assertLongContextConstraintStabilityCase(polluted),
    /unrelated artifact refs must not pollute the final visible answer/,
  );
});

test('R-MEM-01 guard fails if final refs or audit evidence become unbounded', async () => {
  const result = await runLongContextConstraintStabilityCase({ baseDir });
  const polluted: LongContextConstraintStabilityResult = {
    ...result,
    turns: result.turns.map((turn) => ({ ...turn, generatedArtifactRefs: [...turn.generatedArtifactRefs], auditRefs: [...turn.auditRefs] })),
    runAudit: {
      ...result.runAudit,
      refs: [
        ...result.runAudit.refs,
        'audit:r-mem-01-extra-1',
        'audit:r-mem-01-extra-2',
        'audit:r-mem-01-extra-3',
      ],
    },
  };
  const finalTurn = polluted.turns[2];
  assert.ok(finalTurn);
  finalTurn.auditRefs = [
    ...finalTurn.auditRefs,
    'audit:r-mem-01-extra-1',
    'audit:r-mem-01-extra-2',
    'audit:r-mem-01-extra-3',
  ];

  assert.throws(
    () => assertLongContextConstraintStabilityCase(polluted),
    /audit refs must remain bounded|run audit evidence must remain bounded/,
  );
});

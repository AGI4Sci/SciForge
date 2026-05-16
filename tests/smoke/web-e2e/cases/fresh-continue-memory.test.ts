import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertFreshContinueMemoryEvidence,
  freshContinueMemoryCaseId,
  freshContinueMemoryCurrentArtifactRef,
  freshContinueMemoryOldArtifactRef,
  freshContinueMemoryRound2Prompt,
  freshContinueMemoryRound3Prompt,
  freshContinueMemoryStableGoalRef,
  runFreshContinueMemoryCase,
  type FreshContinueMemoryCaseResult,
} from './fresh-continue-memory.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-02-fresh-continue-memory-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-02 keeps the initial research goal stable through continue and format-change turns', async () => {
  const result = await runFreshContinueMemoryCase({
    baseDir,
    outputRoot: join(baseDir, 'evidence'),
    now: '2026-05-16T00:00:00.000Z',
  });

  assert.equal(result.fixture.caseId, freshContinueMemoryCaseId);
  assert.equal(result.recordedRunRequests[1]?.body.prompt, freshContinueMemoryRound2Prompt);
  assert.equal(result.recordedRunRequests[2]?.body.prompt, freshContinueMemoryRound3Prompt);
  assert.equal(result.rounds[0]?.contextRequest.currentTask.stableGoalRef, undefined);
  assert.equal(result.rounds[1]?.contextRequest.currentTask.stableGoalRef?.ref, freshContinueMemoryStableGoalRef);
  assert.equal(result.rounds[2]?.contextRequest.currentTask.stableGoalRef?.ref, freshContinueMemoryStableGoalRef);
  assert.deepEqual(result.evidenceBundle.extra?.stableGoalSources, ['none', 'backend-proposal', 'backend-proposal']);
  assert.deepEqual(result.browserVisibleState.primaryArtifactRefs, [freshContinueMemoryCurrentArtifactRef]);
  assertFreshContinueMemoryEvidence(result);
});

test('SA-WEB-02 guard fails when a stale artifact replaces the current turn', async () => {
  const result = await runFreshContinueMemoryCase({ baseDir });
  const drifted = structuredClone(result) as FreshContinueMemoryCaseResult;
  const round2 = drifted.rounds[1]!;

  round2.contextRequest.currentTask.currentTurnRef = {
    ref: freshContinueMemoryOldArtifactRef,
    kind: 'artifact',
    digest: 'sha256:old-artifact-current-turn',
    sizeBytes: 256,
  };

  assert.throws(
    () => assertFreshContinueMemoryEvidence(drifted),
    /currentTurnRef must remain the current user turn/,
  );
});

test('SA-WEB-02 guard fails when stableGoalRef is inferred from stale artifact context', async () => {
  const result = await runFreshContinueMemoryCase({ baseDir });
  const drifted = structuredClone(result) as FreshContinueMemoryCaseResult;
  const round3 = drifted.rounds[2]!;

  round3.stableGoalSource = 'context-index';
  round3.contextRequest.currentTask.stableGoalRef = {
    ref: freshContinueMemoryOldArtifactRef,
    kind: 'artifact',
    digest: 'sha256:old-artifact-stable-goal',
    sizeBytes: 256,
  };

  assert.throws(
    () => assertFreshContinueMemoryEvidence(drifted),
    /stableGoalRef source must be explicit or Backend proposal|stableGoalRef must not be a stale artifact/,
  );
});

test('SA-WEB-02 guard fails when old artifact leaks into selected currentTask refs', async () => {
  const result = await runFreshContinueMemoryCase({ baseDir });
  const drifted = structuredClone(result) as FreshContinueMemoryCaseResult;
  const round2 = drifted.rounds[1]!;

  round2.contextRequest.currentTask.selectedRefs = [
    ...round2.contextRequest.currentTask.selectedRefs,
    {
      ref: freshContinueMemoryOldArtifactRef,
      kind: 'artifact',
      digest: 'sha256:old-artifact-selected',
      sizeBytes: 256,
      source: 'context-index',
      priority: 99,
    },
  ];

  assert.throws(
    () => assertFreshContinueMemoryEvidence(drifted),
    /currentTask/,
  );
});

console.log('[ok] SA-WEB-02 fresh/continue memory stability case covers current-turn and stableGoalRef guards');

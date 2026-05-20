import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertWebE2eContract } from '../contract-verifier.js';
import {
  R_CODE_01_CASE_ID,
  R_CODE_02_CASE_ID,
  assertDirtyWorktreeCollaborationContract,
  assertNoOutputArtifactFakeSourceFix,
  assertNoResetRevertBehavior,
  assertTargetedCodeRepairContract,
  buildDirtyWorktreeCollaborationCase,
  buildTargetedCodeRepairCase,
} from './code-repair-collaboration.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-web-e2e-code-repair-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('R-CODE-01 models targeted failure root cause generic source fix rerun and no artifact fake fix', async () => {
  const result = await buildTargetedCodeRepairCase({ baseDir });

  assertWebE2eContract(result.verifierInput);
  assert.equal(result.fixture.caseId, R_CODE_01_CASE_ID);
  assertTargetedCodeRepairContract(result.contract);
  assertNoOutputArtifactFakeSourceFix(result.contract);

  assert.deepEqual(result.contract.minimalSourceFix.changedFiles, ['src/runtime/code-repair-target.ts']);
  assert.equal(result.contract.fileDigests.find((entry) => entry.owner === 'agent')?.changed, true);
  assert.equal(result.contract.fileDigests.find((entry) => entry.owner === 'artifact')?.changed, false);
  assert.ok(
    result.contract.turns.map((turn) => turn.kind).join('>').includes('failure>diagnosis>repair>rerun>final'),
    'fixture must preserve the required mult-turn repair sequence',
  );
});

test('R-CODE-02 models dirty worktree protected files diff proof and no reset revert behavior', async () => {
  const result = await buildDirtyWorktreeCollaborationCase({ baseDir });

  assertWebE2eContract(result.verifierInput);
  assert.equal(result.fixture.caseId, R_CODE_02_CASE_ID);
  assertDirtyWorktreeCollaborationContract(result.contract);
  assertNoResetRevertBehavior(result.contract);

  assert.deepEqual(result.contract.agentChangedFiles, ['src/runtime/repairable-router.ts']);
  assert.deepEqual(result.contract.forbiddenCommandsObserved, []);
  assert.ok(result.contract.changedConstraints.protectedFiles.includes('src/runtime/protected-contract.ts'));
  assert.ok(result.contract.userChangeProof.untouchedFiles.includes('src/user-owned/experiment-notes.ts'));
  assert.ok(
    result.contract.commandsRun.some((command) => command.command === 'git status --short'),
    'fixture must explicitly inspect dirty worktree state before repair',
  );
});

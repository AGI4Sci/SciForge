import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertWebE2eContract } from './web-e2e/contract-verifier.js';
import {
  assertDirtyWorktreeCollaborationContract,
  assertTargetedCodeRepairContract,
  buildDirtyWorktreeCollaborationCase,
  buildTargetedCodeRepairCase,
} from './web-e2e/cases/code-repair-collaboration.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-real-task-code-gates-'));

try {
  const [code01Runbook, code02Runbook] = await Promise.all([
    readText('docs/test-artifacts/real-tasks/R-CODE-01/live-runbook.md'),
    readText('docs/test-artifacts/real-tasks/R-CODE-02/live-runbook.md'),
  ]);

  const targetedRepair = await buildTargetedCodeRepairCase({ baseDir });
  assertWebE2eContract(targetedRepair.verifierInput);
  assertTargetedCodeRepairContract(targetedRepair.contract);
  assertRunbookConcepts('R-CODE-01 live runbook', code01Runbook, [
    /Status before live attempt:\s*`not-run`/i,
    /SA-WEB-33 offline fixture alone/i,
    /web port `5175` and runtime\/backend port `6175`/i,
    /Codex in-app browser default chat/i,
    /real failing targeted test or browser failure/i,
    /generic minimal source fix/i,
    /task-specific-live-attempt/i,
    /provider`, `model`, `profile`/i,
    /Editing generated output artifacts cannot count as the source fix/i,
  ]);

  const dirtyWorktree = await buildDirtyWorktreeCollaborationCase({ baseDir });
  assertWebE2eContract(dirtyWorktree.verifierInput);
  assertDirtyWorktreeCollaborationContract(dirtyWorktree.contract);
  assertRunbookConcepts('R-CODE-02 live runbook', code02Runbook, [
    /Status before live attempt:\s*`not-run`/i,
    /SA-WEB-34 offline fixture alone/i,
    /web port `5175` and runtime\/backend port `6175`/i,
    /Codex in-app browser default chat/i,
    /current dirty worktree/i,
    /before\/after proof/i,
    /task-specific-live-attempt/i,
    /provider`, `model`, `profile`/i,
    /git reset`, `git revert`, `git checkout --`, or `git restore`/i,
  ]);

  console.log('[ok] real-task code gates cover R-CODE-01 and R-CODE-02 offline contracts');
} finally {
  await rm(baseDir, { recursive: true, force: true });
}

async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

function assertRunbookConcepts(label: string, source: string, patterns: RegExp[]): void {
  for (const pattern of patterns) {
    assert.match(source, pattern, `${label}: source must include ${pattern}`);
  }
}

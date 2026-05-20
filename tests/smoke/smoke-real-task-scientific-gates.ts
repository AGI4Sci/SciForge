import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertScientificLiveVerificationPlan,
  assertScientificReviewerVerifierLoopCase,
  buildScientificReviewerVerifierLoopCases,
  type ScientificLiveVerificationPlan,
} from './web-e2e/cases/scientific-reviewer-verifier-loop.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-real-task-scientific-gates-'));

try {
  const cases = await buildScientificReviewerVerifierLoopCases({ baseDir });
  for (const entry of cases) {
    assertScientificReviewerVerifierLoopCase(entry);
    const planPath = join(
      process.cwd(),
      'docs',
      'test-artifacts',
      'real-tasks',
      entry.requirementId,
      'live-verification-plan.json',
    );
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as ScientificLiveVerificationPlan;
    assertScientificLiveVerificationPlan(plan, entry);
  }

  console.log('[ok] real-task scientific gates cover R-METHOD-01, R-KG-01, R-BIO-01, and R-VERIFY-01 offline contracts and live verification plans');
} finally {
  await rm(baseDir, { recursive: true, force: true });
}

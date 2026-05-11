import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  validateScientificReproductionArtifact,
  validateScientificReproductionRefsFirst,
} from '@sciforge-ui/runtime-contract';
import { verifyScientificReproduction } from '../../packages/verifiers/scientific-reproduction/index.js';

const fixtureDir = join(process.cwd(), 'tests/fixtures/scientific-reproduction/real-paper-raw-pilot');
const files = (await readdir(fixtureDir)).filter((file) => file.endsWith('.json'));

assert.ok(files.length >= 6, 'raw BED domain pilot should emit readiness, notebook, figure, matrix, verdict, and inventory artifacts');

const artifacts = await Promise.all(files.map(async (file) => ({
  id: file.replace(/\.json$/, ''),
  data: JSON.parse(await readFile(join(fixtureDir, file), 'utf8')) as Record<string, unknown>,
})));

for (const artifact of artifacts) {
  const validation = validateScientificReproductionArtifact(artifact.data);
  assert.equal(validation.ok, true, `${artifact.id} should validate: ${JSON.stringify(validation.issues)}`);
  const refsFirst = validateScientificReproductionRefsFirst(artifact.data);
  assert.equal(refsFirst.ok, true, `${artifact.id} should remain refs-first: ${JSON.stringify(refsFirst.issues)}`);
}

const readyDossier = artifacts.find((artifact) => artifact.data.artifactType === 'raw-data-readiness-dossier')?.data as Record<string, unknown> | undefined;
assert.equal(readyDossier?.rawExecutionStatus, 'ready');
assert.equal(readyDossier?.approvalStatus, 'approved');
assert.equal((readyDossier?.rawExecutionGate as Record<string, unknown> | undefined)?.allowed, true);

const verifierResult = verifyScientificReproduction({
  goal: 'Verify raw BED domain pilot artifacts.',
  artifacts,
  providerHints: {
    requireAccessionVerification: true,
    requireFigureReproduction: true,
    requireRawDataReadiness: true,
    allowRawDataExecution: true,
  },
});

assert.equal(verifierResult.verdict, 'pass');
assert.ok(verifierResult.criterionResults.find((criterion) => criterion.id === 'raw-data-readiness-gate' && criterion.passed));
assert.ok(verifierResult.criterionResults.find((criterion) => criterion.id === 'figure-reproduction-evidence' && criterion.passed));

const combined = JSON.stringify(artifacts.map((artifact) => artifact.data));
assert.ok(combined.includes('RS4_WT: 21080 input intervals, 20613 merged domains, 2876 selected domains.'));
assert.ok(combined.includes('RS4_Setd1bKO: 13810 input intervals, 13737 merged domains, 83 selected domains.'));
assert.ok(combined.includes('not full raw FASTQ/BAM alignment'));

console.log('[ok] raw BED domain pilot artifacts validate, pass raw readiness gate, and preserve bounded verdict semantics');

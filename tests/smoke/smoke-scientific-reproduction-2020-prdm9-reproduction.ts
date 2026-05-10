import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  validateScientificReproductionArtifact,
  validateScientificReproductionRefsFirst,
} from '@sciforge-ui/runtime-contract';

const fixtureDir = new URL('../fixtures/scientific-reproduction/real-paper-reproduction/', import.meta.url);
const files = (await readdir(fixtureDir))
  .filter((file) => file.startsWith('2020-prdm9-dsb-fate.') && file.endsWith('.json'))
  .sort();

assert.deepEqual(files, [
  '2020-prdm9-dsb-fate.analysis-notebook.json',
  '2020-prdm9-dsb-fate.claim-verdict.json',
  '2020-prdm9-dsb-fate.evidence-matrix.json',
  '2020-prdm9-dsb-fate.figure-reproduction-report.json',
]);

const artifacts = new Map<string, Record<string, unknown>>();
for (const file of files) {
  const artifact = JSON.parse(await readFile(new URL(file, fixtureDir), 'utf8'));
  assert.equal(validateScientificReproductionArtifact(artifact).ok, true, `${file} should validate`);
  assert.equal(validateScientificReproductionRefsFirst(artifact).ok, true, `${file} should remain refs-first`);
  artifacts.set(file, artifact);
}

const figureReport = artifact('2020-prdm9-dsb-fate.figure-reproduction-report.json');
assert.equal(figureReport.verdict, 'partially-reproduced');
assert.ok(
  JSON.stringify(figureReport).includes('No GEO raw FASTQ'),
  'figure report should make the no-large-download boundary explicit',
);

const stageSummary = arrayField(recordField(figureReport, 'statistics'), 'stagePeakSummary');
assert.deepEqual(
  stageSummary.map((row) => {
    assert.ok(isRecord(row), 'stage summary rows should be records');
    return [row.stage, row.peaks, row.dsbHotspotYes];
  }),
  [
    ['Leptotene', 3358, 2773],
    ['Early-zygotene', 13490, 9440],
    ['Mid-zygotene', 16540, 10137],
    ['Late-zygotene', 8880, 7681],
    ['Early 1-pachytene', 8187, 7375],
  ],
  'stage count fixture should preserve the bounded Supplementary Table S3 reproduction result',
);

const evidenceMatrix = artifact('2020-prdm9-dsb-fate.evidence-matrix.json');
const rowVerdicts = arrayField(evidenceMatrix, 'rows').map((row) => {
  assert.ok(isRecord(row), 'evidence rows should be records');
  return row.verdict;
});
assert.ok(rowVerdicts.includes('partially-reproduced'), 'at least one bounded table-level claim should be partial');
assert.ok(rowVerdicts.includes('insufficient-evidence'), 'broader fate claims should remain insufficient');
assert.equal(rowVerdicts.includes('reproduced'), false, 'first-pass report must not overclaim full reproduction');
assert.equal(rowVerdicts.includes('contradicted'), false, 'no contradiction is established from missing data alone');

const claimVerdict = artifact('2020-prdm9-dsb-fate.claim-verdict.json');
assert.equal(claimVerdict.verdict, 'partially-reproduced');
assert.ok(arrayField(claimVerdict, 'missingEvidence').length >= 3, 'claim verdict should preserve missing evidence boundaries');

console.log('[ok] 2020 PRDM9/DSB fate reproduction fixtures validate schema, refs-first discipline, and conservative partial verdicts');

function artifact(name: string): Record<string, unknown> {
  const value = artifacts.get(name);
  assert.ok(value, `missing ${path.join(fixtureDir.pathname, name)}`);
  return value;
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const field = value[key];
  assert.ok(isRecord(field), `${key} should be a record`);
  return field;
}

function arrayField(value: Record<string, unknown>, key: string): unknown[] {
  const field = value[key];
  assert.ok(Array.isArray(field), `${key} should be an array`);
  return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

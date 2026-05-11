import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

import {
  validateScientificReproductionArtifact,
  validateScientificReproductionRefsFirst,
} from '@sciforge-ui/runtime-contract';

const reproductionDir = new URL('../fixtures/scientific-reproduction/real-paper-reproduction/', import.meta.url);
const files = (await readdir(reproductionDir)).filter((file) =>
  file.startsWith('2025-setd1b-broad-h3k4me3.') && file.endsWith('.json'),
);

assert.ok(files.length >= 6, '2025 SETD1B reproduction draft should include plan, reports, matrix, and verdict');

const artifacts = await Promise.all(files.map(async (file) => ({
  file,
  value: JSON.parse(await readFile(new URL(file, reproductionDir), 'utf8')) as Record<string, unknown>,
})));

for (const artifact of artifacts) {
  const validation = validateScientificReproductionArtifact(artifact.value);
  assert.equal(validation.ok, true, `${artifact.file} should validate: ${JSON.stringify(validation.issues)}`);
  const refsFirst = validateScientificReproductionRefsFirst(artifact.value);
  assert.equal(refsFirst.ok, true, `${artifact.file} should remain refs-first: ${JSON.stringify(refsFirst.issues)}`);
}

const combined = JSON.stringify(artifacts.map((artifact) => artifact.value));
for (const requiredTerm of [
  'broad-domain',
  'H3K27ac',
  'Setd1b',
  'Rfx2',
  'gene length',
  'baseline expression',
  'stage-composition',
  'insufficient-evidence',
  'partially-reproduced',
]) {
  assert.ok(combined.includes(requiredTerm), `2025 reproduction drafts should cover ${requiredTerm}`);
}

const verdict = artifacts.find((artifact) => artifact.file.endsWith('.claim-verdict.json'))?.value;
assert.ok(verdict, '2025 claim verdict draft should exist');
assert.equal(verdict.verdict, 'insufficient-evidence');

console.log('[ok] 2025 SETD1B reproduction draft artifacts validate and preserve partial/insufficient-evidence boundaries');

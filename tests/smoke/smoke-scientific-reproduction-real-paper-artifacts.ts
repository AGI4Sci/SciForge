import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  isScientificReproductionArtifactType,
  validateScientificReproductionArtifact,
  validateScientificReproductionRefsFirst,
} from '@sciforge-ui/runtime-contract';

const fixtureRoot = new URL('../fixtures/scientific-reproduction/', import.meta.url);
const understandingDir = new URL('real-paper-understanding/', fixtureRoot);
const evidenceDir = new URL('real-paper-evidence/', fixtureRoot);

const artifacts = await readJsonArtifacts([understandingDir, evidenceDir]);
const scientificArtifacts = artifacts.filter((artifact) =>
  isScientificReproductionArtifactType(artifact.value.artifactType),
);

assert.ok(scientificArtifacts.length >= 8, 'real-paper fixtures should preserve the first research artifact batch');

for (const artifact of scientificArtifacts) {
  const validation = validateScientificReproductionArtifact(artifact.value);
  assert.equal(validation.ok, true, `${artifact.name} should validate: ${JSON.stringify(validation.issues)}`);
  const refsFirst = validateScientificReproductionRefsFirst(artifact.value);
  assert.equal(refsFirst.ok, true, `${artifact.name} should remain refs-first: ${JSON.stringify(refsFirst.repairHints)}`);
}

const prdm9ClaimGraph = artifactNamed('paper-claim-graph-2020-prdm9-dsb-fate.json');
const setd1bClaimGraph = artifactNamed('paper-claim-graph-2025-setd1b-broad-h3k4me3.json');
assert.equal(arrayField(prdm9ClaimGraph, 'claims').length >= 5, true, '2020 claim graph should contain at least 5 claims');
assert.equal(arrayField(setd1bClaimGraph, 'claims').length >= 5, true, '2025 claim graph should contain at least 5 claims');

for (const graph of [prdm9ClaimGraph, setd1bClaimGraph]) {
  for (const claim of arrayField(graph, 'claims')) {
    assert.ok(isRecord(claim), 'claims should be objects');
    assert.ok(arrayField(claim, 'locatorRefs').length > 0, 'each real-paper claim needs PDF/page/section locators');
    assert.ok(arrayField(claim, 'risks').length > 0, 'each real-paper claim should carry reproduction risk notes');
  }
}

const datasetInventory = artifactNamed('dataset-inventory-draft.json');
const datasets = arrayField(datasetInventory, 'datasets');
assert.ok(datasets.some((dataset) => JSON.stringify(dataset).includes('GSE132446')), '2020 GEO source should be recorded');
assert.ok(datasets.some((dataset) => JSON.stringify(dataset).includes('GSE242515')), '2025 GEO source should be recorded');

const claimVerdict = artifactNamed('claim-verdict-draft.json');
assert.equal(stringField(claimVerdict, 'verdict'), 'insufficient-evidence');
assert.ok(
  JSON.stringify(claimVerdict).includes('operational'),
  'draft verdict should separate operational access/tool gaps from scientific contradiction',
);

const missingDataDraft = artifactNamed('missing-data-report-draft.json');
assert.equal(stringField(missingDataDraft, 'artifactType'), 'missing-data-report');
assert.equal(
  validateScientificReproductionArtifact(missingDataDraft).ok,
  false,
  'missing-data-report is intentionally a draft until promoted into the runtime artifact type set',
);

console.log('[ok] real paper scientific reproduction artifacts validate claim graphs, inventories, verdict conservatism, and refs-first discipline');

async function readJsonArtifacts(dirs: URL[]) {
  const records: Array<{ name: string; value: Record<string, unknown> }> = [];
  for (const dir of dirs) {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const value = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
      assert.ok(isRecord(value), `${path.join(dir.pathname, file)} should be a JSON object`);
      records.push({ name: file, value });
    }
  }
  return records;
}

function artifactNamed(name: string) {
  const artifact = artifacts.find((candidate) => candidate.name === name)?.value;
  assert.ok(artifact, `missing fixture ${name}`);
  return artifact;
}

function arrayField(value: Record<string, unknown>, key: string): unknown[] {
  const field = value[key];
  assert.ok(Array.isArray(field), `${key} should be an array`);
  return field;
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  assert.equal(typeof field, 'string', `${key} should be a string`);
  return field as string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

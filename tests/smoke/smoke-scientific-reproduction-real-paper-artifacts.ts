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
const reproductionDir = new URL('real-paper-reproduction/', fixtureRoot);

const artifacts = await readJsonArtifacts([understandingDir, evidenceDir, reproductionDir]);
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
const histoneRubricClaimGraph = artifactNamed('paper-claim-graph-2022-histone-ptm-causal-rubric.json');
const setd1bClaimGraph = artifactNamed('paper-claim-graph-2025-setd1b-broad-h3k4me3.json');
assert.equal(arrayField(prdm9ClaimGraph, 'claims').length >= 5, true, '2020 claim graph should contain at least 5 claims');
assert.equal(arrayField(histoneRubricClaimGraph, 'claims').length >= 8, true, '2022 review rubric claim graph should contain reusable causal criteria');
assert.equal(arrayField(setd1bClaimGraph, 'claims').length >= 5, true, '2025 claim graph should contain at least 5 claims');

for (const graph of [prdm9ClaimGraph, histoneRubricClaimGraph, setd1bClaimGraph]) {
  for (const claim of arrayField(graph, 'claims')) {
    assert.ok(isRecord(claim), 'claims should be objects');
    assert.ok(arrayField(claim, 'locatorRefs').length > 0, 'each real-paper claim needs PDF/page/section locators');
    assert.ok(arrayField(claim, 'risks').length > 0, 'each real-paper claim should carry reproduction risk notes');
  }
}

const histoneRubricText = JSON.stringify(histoneRubricClaimGraph);
for (const term of ['cause', 'consequence', 'memory', 'reinforcement', 'writer-reader-eraser', 'perturbation', 'confounders']) {
  assert.ok(histoneRubricText.includes(term), `2022 review rubric claim graph should cover ${term}`);
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
  isScientificReproductionArtifactType('missing-data-report'),
  false,
  'missing-data-report should remain a derived draft rather than a formal runtime artifact type',
);
assert.equal(
  validateScientificReproductionArtifact(missingDataDraft).ok,
  false,
  'missing-data-report is intentionally a draft derived from dataset-inventory.missingDatasets and claim-verdict.missingEvidence',
);
assert.ok(arrayField(datasetInventory, 'missingDatasets').length > 0, 'missing data belongs in dataset-inventory.missingDatasets');
assert.ok(arrayField(datasetInventory, 'notes').length > 0, 'dataset-inventory notes should carry missing-data handling guidance');
assert.ok(arrayField(claimVerdict, 'missingEvidence').length > 0, 'claim verdicts should carry downstream missing evidence');

const prdm9FigureReproduction = artifactNamed('2020-prdm9-dsb-fate.figure-reproduction-report.json');
assert.equal(stringField(prdm9FigureReproduction, 'verdict'), 'partially-reproduced');
assert.ok(
  JSON.stringify(prdm9FigureReproduction).includes('unsupportedByThisRun'),
  '2020 reproduction report should make unsupported PRDM9/NOMe/fate components explicit',
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

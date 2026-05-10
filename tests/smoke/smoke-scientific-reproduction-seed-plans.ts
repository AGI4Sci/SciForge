import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../fixtures/scientific-reproduction/seed-papers/generic-plans');
const expectedSchemaVersion = 'sciforge.scientific-reproduction.seed-plan.v1';
const expectedFixtureKind = 'scientific-reproduction-seed-plan';
const verdictEnum = ['reproduced', 'partially-reproduced', 'not-reproduced', 'contradicted'];
const sharedArtifactTypes = ['evidence-matrix', 'claim-verdict', 'negative-result-report'];

const fixtureFiles = readdirSync(fixtureDir)
  .filter((file) => file.endsWith('.json'))
  .sort();

assert.deepEqual(fixtureFiles, [
  '2020-prdm9-dsb-fate.json',
  '2022-histone-ptm-causal-rubric.json',
  '2025-setd1b-broad-h3k4me3.json',
]);

for (const fixtureFile of fixtureFiles) {
  const fixturePath = path.join(fixtureDir, fixtureFile);
  const plan = JSON.parse(readFileSync(fixturePath, 'utf8'));

  assert.equal(plan.schemaVersion, expectedSchemaVersion, `${fixtureFile} schemaVersion`);
  assert.equal(plan.fixtureKind, expectedFixtureKind, `${fixtureFile} fixtureKind`);
  assert.equal(typeof plan.sourcePaper.id, 'string', `${fixtureFile} source id`);
  assert.equal(typeof plan.sourcePaper.title, 'string', `${fixtureFile} title`);
  assert.match(plan.sourcePaper.sourcePdf, /^workspace\/cell_papers\/.+\.pdf$/, `${fixtureFile} source PDF path`);
  assert.equal(plan.sourcePaper.extractionMethod, 'pdftotext pages 1-2', `${fixtureFile} extraction method`);
  assert.ok(Number.isInteger(plan.sourcePaper.year), `${fixtureFile} year`);
  assert.ok(plan.sourcePaper.topicTags.length >= 4, `${fixtureFile} topic tags`);

  assert.equal(typeof plan.boundedMetadata.mainClaimHint, 'string', `${fixtureFile} main claim hint`);
  assert.ok(plan.boundedMetadata.mainClaimHint.length <= 220, `${fixtureFile} keeps claim hint bounded`);
  assert.ok(plan.boundedMetadata.evidenceModeHints.length >= 4, `${fixtureFile} evidence hints`);
  assert.match(plan.boundedMetadata.copyrightBoundary, /no abstract or body text/i, `${fixtureFile} copyright boundary`);

  const attempt = plan.reproductionAttempt;
  assert.match(attempt.attemptId, /^attempt-\d{4}-/, `${fixtureFile} attempt id`);
  assert.ok(attempt.claimCategory.length > 0, `${fixtureFile} claim category`);
  assert.deepEqual(attempt.verdictEnum, verdictEnum, `${fixtureFile} verdict enum`);
  for (const artifactType of sharedArtifactTypes) {
    assert.ok(attempt.requiredArtifactTypes.includes(artifactType), `${fixtureFile} requires ${artifactType}`);
  }
  assert.ok(attempt.minimumInputs.length >= 5, `${fixtureFile} minimum inputs`);
  assert.ok(attempt.planChecklist.length >= 6, `${fixtureFile} plan checklist`);
  assert.ok(attempt.sensitivityChecks.length >= 4, `${fixtureFile} sensitivity checks`);
  assert.ok(attempt.negativeResultChecks.length >= 3, `${fixtureFile} negative checks`);
  assert.ok(attempt.rubricPrompts.length >= 3, `${fixtureFile} rubric prompts`);

  assertNoLongCopyrightLikeText(plan, fixtureFile);
  console.log(`[ok] ${fixtureFile} scientific reproduction seed plan`);
}

function assertNoLongCopyrightLikeText(value: unknown, context: string): void {
  if (typeof value === 'string') {
    assert.ok(value.length <= 260, `${context} has bounded string: ${value.slice(0, 80)}`);
    assert.doesNotMatch(value, /\bAbstract\s*\|/i, `${context} must not embed abstract text`);
    assert.doesNotMatch(value, /\bINTRODUCTION\b/, `${context} must not embed body section text`);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoLongCopyrightLikeText(item, `${context}[${index}]`));
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assertNoLongCopyrightLikeText(child, `${context}.${key}`);
    }
  }
}

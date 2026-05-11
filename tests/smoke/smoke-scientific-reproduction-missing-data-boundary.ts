import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES,
  scientificReproductionArtifactSchemas,
  isScientificReproductionArtifactType,
} from '@sciforge-ui/runtime-contract';

const root = process.cwd();
const skillDir = path.join(root, 'packages/skills/domain_skills/scientific-reproduction');
const manifestPath = path.join(skillDir, 'capability.manifest.json');
const skillPath = path.join(skillDir, 'SKILL.md');
const fixturePath = path.join(root, 'tests/fixtures/scientific-reproduction/mock-dataset-discovery-cases.json');

const manifestPayload = JSON.parse(await readFile(manifestPath, 'utf8')) as {
  manifest: {
    outputSchema?: { properties?: { artifactTypes?: { items?: { enum?: string[] } } } };
    metadata?: Record<string, unknown>;
  };
};
const manifest = manifestPayload.manifest;
const skillText = await readFile(skillPath, 'utf8');
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8')) as {
  cases: Array<{
    id: string;
    expectedArtifacts: Array<{ type: string; status: string; requiredFields?: string[] }>;
  }>;
};

assert.equal(
  isScientificReproductionArtifactType('missing-data-report'),
  false,
  'missing-data-report should remain outside the formal scientific reproduction artifact type set',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(scientificReproductionArtifactSchemas, 'missing-data-report'),
  false,
  'missing-data-report should not receive a runtime schema while dataset-inventory and negative-result-report cover the contract',
);
assert.equal(SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES.includes('dataset-inventory'), true);
assert.equal(SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES.includes('negative-result-report'), true);

const reusableOutputs = new Set(manifest.metadata?.reusableOutputs as string[]);
const outputEnum = new Set(manifest.outputSchema?.properties?.artifactTypes?.items?.enum ?? []);
assert.equal(reusableOutputs.has('missing-data-report'), false);
assert.equal(outputEnum.has('missing-data-report'), false);
assert.deepEqual(manifest.metadata?.derivedDraftOutputs, ['missing-data-report']);
assert.match(String(manifest.metadata?.derivedDraftPolicy), /dataset-inventory\.missingDatasets/);
assert.match(String(manifest.metadata?.derivedDraftPolicy), /claim-verdict\.missingEvidence/);

assert.match(skillText, /not a formal runtime artifact type/);
assert.match(skillText, /dataset-inventory\.missingDatasets/);
assert.match(skillText, /negative-result-report/);

for (const entry of fixtures.cases) {
  assert.equal(
    entry.expectedArtifacts.some((artifact) => artifact.type === 'missing-data-report'),
    false,
    `${entry.id} should encode missing-data expectations through formal runtime artifacts`,
  );
}

const missing = fixtures.cases.find((entry) => entry.id === 'dataset-discovery-missing');
assert.ok(missing);
assert.ok(
  missing.expectedArtifacts.some((artifact) =>
    artifact.type === 'dataset-inventory' &&
    artifact.status === 'missing-data' &&
    artifact.requiredFields?.includes('missingDatasets')
  ),
);

const timeout = fixtures.cases.find((entry) => entry.id === 'dataset-discovery-timeout');
assert.ok(timeout);
assert.ok(
  timeout.expectedArtifacts.some((artifact) =>
    artifact.type === 'dataset-inventory' &&
    artifact.status === 'timeout' &&
    artifact.requiredFields?.includes('missingDatasets')
  ),
);

console.log('[ok] scientific reproduction missing-data-report stays a derived draft over dataset-inventory/negative-result semantics');

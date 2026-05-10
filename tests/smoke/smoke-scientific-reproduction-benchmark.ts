import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  validateCapabilityManifestShape,
  type CapabilityManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';
import { discoverPackageCapabilityManifestsFromFiles } from '../../src/runtime/capability-manifest-file-discovery.js';

const root = process.cwd();
const skillDir = path.join(root, 'packages/skills/domain_skills/scientific-reproduction');
const manifestPath = path.join(skillDir, 'capability.manifest.json');
const fixturePath = path.join(root, 'tests/fixtures/scientific-reproduction/mock-dataset-discovery-cases.json');
const skillPath = path.join(skillDir, 'SKILL.md');

const manifestPayload = JSON.parse(await readFile(manifestPath, 'utf8')) as { manifest: CapabilityManifest };
const manifest = manifestPayload.manifest;
const skillText = await readFile(skillPath, 'utf8');
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8')) as MockDatasetDiscoveryFixtures;

assert.deepEqual(validateCapabilityManifestShape(manifest), []);
assert.equal(manifest.id, 'skill.scientific-reproduction.profile');
assert.equal(manifest.kind, 'skill');
assert.deepEqual(manifest.sideEffects, ['none']);
assert.equal(manifest.providers[0]?.id, 'provider.scientific-reproduction.mock-dataset-discovery');
assert.equal(manifest.metadata?.profileContract, 'sciforge.scientific-reproduction-profile.v1');

const outputTypes = new Set(manifest.metadata?.reusableOutputs as string[]);
for (const requiredType of [
  'dataset-inventory',
  'missing-data-report',
  'analysis-plan',
  'figure-reproduction-report',
  'evidence-matrix',
  'claim-verdict',
  'negative-result-report',
]) {
  assert.equal(outputTypes.has(requiredType), true, `${requiredType} must be declared as reusable output`);
}

const toolClasses = new Set(manifest.metadata?.toolClasses as string[]);
for (const requiredToolClass of [
  'fastq-qc',
  'read-alignment',
  'peak-calling',
  'bed-overlap',
  'bigwig-signal-summary',
  'gene-annotation',
  'table-statistics',
  'plot-generation',
]) {
  assert.equal(toolClasses.has(requiredToolClass), true, `${requiredToolClass} must be declared as a common tool class`);
}

const budgetPolicy = manifest.metadata?.budgetPolicy as Record<string, unknown>;
assert.equal(budgetPolicy.maxDownloadBytes, 50000000);
assert.equal(budgetPolicy.largeRawDataPolicy, 'metadata-only-or-missing-data');
assert.deepEqual(manifest.metadata?.degradationPolicy, [
  'raw-data-within-budget',
  'processed-table-or-supplement',
  'tiny-schema-preserving-fixture',
  'metadata-only-inventory',
  'missing-data-report',
]);

assert.match(skillText, /Never replace missing experimental data with paper prose/);
assert.match(skillText, /dataset-discovery-missing/);
assert.match(skillText, /dataset-discovery-available/);
assert.match(skillText, /dataset-discovery-timeout/);

assert.equal(fixtures.contract, 'sciforge.scientific-reproduction.mock-dataset-discovery-cases.v1');
assert.deepEqual(fixtures.cases.map((entry) => entry.id).sort(), [
  'dataset-discovery-available',
  'dataset-discovery-missing',
  'dataset-discovery-timeout',
]);

for (const entry of fixtures.cases) {
  assert.equal(entry.network, 'disabled', `${entry.id} must not require live network`);
  assert.equal(entry.mockResponse.downloadedBytes, 0, `${entry.id} must not download data`);
  assert.equal(JSON.stringify(entry).includes('http://'), false, `${entry.id} must avoid live URL dependencies`);
  assert.equal(JSON.stringify(entry).includes('https://'), false, `${entry.id} must avoid live URL dependencies`);
  assert.ok(entry.expectedArtifacts.length > 0, `${entry.id} must define expected artifacts`);
}

const missing = caseById('dataset-discovery-missing');
assert.equal(missing.mockResponse.status, 'missing');
assert.ok(missing.expectedArtifacts.some((artifact) => artifact.type === 'missing-data-report' && artifact.status === 'missing-data'));
assert.ok(missing.expectedArtifacts.some((artifact) => artifact.type === 'claim-verdict' && artifact.status === 'unverified'));

const available = caseById('dataset-discovery-available');
assert.equal(available.mockResponse.status, 'available');
assert.ok(available.mockResponse.datasetInventory?.every((row) => row.sizeBytes > 0 && row.sizeBytes < 50000));
assert.ok(available.expectedArtifacts.some((artifact) => artifact.type === 'dataset-inventory' && artifact.status === 'ready'));
assert.ok(available.expectedArtifacts.some((artifact) => artifact.type === 'analysis-plan' && artifact.status === 'ready'));

const timeout = caseById('dataset-discovery-timeout');
assert.equal(timeout.mockResponse.status, 'timeout');
assert.equal(timeout.mockResponse.degradationAction, 'metadata-only-or-missing-data');
assert.ok(timeout.mockResponse.timeoutMs && timeout.mockResponse.timeoutMs <= timeout.mockResponse.providerLatencyMs);
assert.ok(timeout.expectedArtifacts.some((artifact) => artifact.type === 'missing-data-report' && artifact.status === 'timeout'));

const discovery = await discoverPackageCapabilityManifestsFromFiles({
  rootDir: skillDir,
  maxDepth: 2,
});
assert.equal(discovery.audit.manifestCount, 1);
assert.equal(discovery.packages[0]?.manifests[0]?.id, 'skill.scientific-reproduction.profile');
const discoveredProvider = discovery.packages[0]?.providerAvailability?.[0];
assert.equal(
  typeof discoveredProvider === 'string' ? discoveredProvider : discoveredProvider?.id,
  'provider.scientific-reproduction.mock-dataset-discovery',
);

console.log('[ok] scientific reproduction benchmark profile and mock dataset discovery fixtures are contract-shaped and network-free');

function caseById(id: string): MockDatasetDiscoveryCase {
  const entry = fixtures.cases.find((candidate) => candidate.id === id);
  assert.ok(entry, `missing fixture case ${id}`);
  return entry;
}

interface MockDatasetDiscoveryFixtures {
  contract: string;
  cases: MockDatasetDiscoveryCase[];
}

interface MockDatasetDiscoveryCase {
  id: string;
  provider: string;
  network: 'disabled';
  input: {
    paperRef: string;
    claimRefs: string[];
    discoveryHints: Record<string, unknown>;
    budget: Record<string, unknown>;
  };
  mockResponse: {
    status: 'missing' | 'available' | 'timeout';
    providerLatencyMs: number;
    timeoutMs?: number;
    attemptedSources?: Array<Record<string, unknown>>;
    datasetInventory?: Array<{ sizeBytes: number } & Record<string, unknown>>;
    degradationAction?: string;
    downloadedBytes: number;
  };
  expectedArtifacts: Array<{
    type: string;
    status: string;
    requiredFields: string[];
  }>;
}

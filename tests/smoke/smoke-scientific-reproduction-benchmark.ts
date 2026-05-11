import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { isScientificReproductionArtifactType } from '@sciforge-ui/runtime-contract';
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
  'analysis-plan',
  'figure-reproduction-report',
  'evidence-matrix',
  'claim-verdict',
  'negative-result-report',
]) {
  assert.equal(outputTypes.has(requiredType), true, `${requiredType} must be declared as reusable output`);
}
assert.equal(outputTypes.has('missing-data-report'), false, 'missing-data-report is a derived draft, not a reusable runtime output');
assert.equal(isScientificReproductionArtifactType('missing-data-report'), false, 'missing-data-report must not be promoted into runtime artifact types');
assert.deepEqual(manifest.metadata?.derivedDraftOutputs, ['missing-data-report']);
assert.match(String(manifest.metadata?.derivedDraftPolicy), /not a formal runtime artifact type/);

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
assert.deepEqual(manifest.metadata?.milestones, ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7']);
const n6EscalationPolicy = manifest.metadata?.n6EscalationPolicy as Record<string, unknown>;
assert.equal(n6EscalationPolicy.defaultMode, 'metadata-only-preflight');
assert.equal(n6EscalationPolicy.artifactType, 'raw-data-readiness-dossier');
assert.equal(n6EscalationPolicy.metadataField, 'n6Escalation');
assert.equal(n6EscalationPolicy.rawExecutionGateDefaultAllowed, false);
assert.deepEqual(n6EscalationPolicy.allowedPreflightVerdicts, ['insufficient-evidence', 'not-tested']);
const n7ExecutionAttestationPolicy = manifest.metadata?.n7ExecutionAttestationPolicy as Record<string, unknown>;
assert.equal(n7ExecutionAttestationPolicy.defaultMode, 'execute-approved-attestation');
assert.equal(n7ExecutionAttestationPolicy.artifactType, 'raw-data-readiness-dossier');
assert.equal(n7ExecutionAttestationPolicy.metadataField, 'executionAttestations');
assert.equal(n7ExecutionAttestationPolicy.requiresReadyDossier, true);
assert.equal(n7ExecutionAttestationPolicy.requiresApprovedScopeBinding, true);
assert.equal(n7ExecutionAttestationPolicy.observedBudgetsMustNotExceedApprovedBudgets, true);
assert.deepEqual(n7ExecutionAttestationPolicy.successVerdictsRequiringAttestation, ['reproduced', 'partially-reproduced']);
assert.deepEqual(manifest.metadata?.degradationPolicy, [
  'raw-data-within-budget',
  'processed-table-or-supplement',
  'tiny-schema-preserving-fixture',
  'metadata-only-inventory',
  'metadata-only-inventory-with-missingDatasets',
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
  'raw-reanalysis-escalation-preflight',
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
assert.ok(missing.expectedArtifacts.some((artifact) => artifact.type === 'dataset-inventory' && artifact.status === 'missing-data'));
assert.ok(missing.expectedArtifacts.some((artifact) => artifact.type === 'claim-verdict' && artifact.status === 'insufficient-evidence'));

const available = caseById('dataset-discovery-available');
assert.equal(available.mockResponse.status, 'available');
assert.ok(available.mockResponse.datasetInventory?.every((row) => row.sizeBytes > 0 && row.sizeBytes < 50000));
assert.ok(available.expectedArtifacts.some((artifact) => artifact.type === 'dataset-inventory' && artifact.status === 'ready'));
assert.ok(available.expectedArtifacts.some((artifact) => artifact.type === 'analysis-plan' && artifact.status === 'ready'));

const timeout = caseById('dataset-discovery-timeout');
assert.equal(timeout.mockResponse.status, 'timeout');
assert.equal(timeout.mockResponse.degradationAction, 'metadata-only-or-missing-data');
assert.ok(timeout.mockResponse.timeoutMs && timeout.mockResponse.timeoutMs <= timeout.mockResponse.providerLatencyMs);
assert.ok(timeout.expectedArtifacts.some((artifact) => artifact.type === 'dataset-inventory' && artifact.status === 'timeout'));

const rawEscalation = caseById('raw-reanalysis-escalation-preflight');
assert.equal(rawEscalation.mockResponse.status, 'preflight-blocked');
assert.equal(rawEscalation.input.environmentProfile?.network, 'disabled');
assert.equal(rawEscalation.mockResponse.preflight?.rawExecutionGateAllowed, false);
assert.equal(rawEscalation.mockResponse.preflight?.stopBeforeExecutionUnlessReady, true);
const rawEscalationFileClasses = rawEscalation.input.discoveryHints.fileClasses;
assert.ok(Array.isArray(rawEscalationFileClasses));
assert.ok(rawEscalationFileClasses.includes('FASTQ'));
assert.ok(rawEscalationFileClasses.includes('BAM'));
assert.ok(rawEscalation.expectedArtifacts.some((artifact) => artifact.type === 'raw-data-readiness-dossier' && artifact.status === 'blocked' && artifact.requiredFields.includes('n6Escalation')));
assert.ok(rawEscalation.expectedArtifacts.some((artifact) => artifact.type === 'claim-verdict' && artifact.status === 'insufficient-evidence'));

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
    environmentProfile?: {
      network: 'disabled' | 'mock-only' | 'metadata-only' | 'full';
      availableToolClasses?: string[];
      genomeCaches?: string[];
      annotationCaches?: string[];
    };
  };
  mockResponse: {
    status: 'missing' | 'available' | 'timeout' | 'preflight-blocked';
    providerLatencyMs: number;
    timeoutMs?: number;
    attemptedSources?: Array<Record<string, unknown>>;
    datasetInventory?: Array<{ sizeBytes: number } & Record<string, unknown>>;
    degradationAction?: string;
    downloadedBytes: number;
    preflight?: {
      rawExecutionGateAllowed: boolean;
      approvalStatus: string;
      rawExecutionStatus: string;
      requestedFileClasses: string[];
      reanalysisIntent: string;
      stopBeforeExecutionUnlessReady: boolean;
      reason: string;
    };
  };
  expectedArtifacts: Array<{
    type: string;
    status: string;
    requiredFields: string[];
  }>;
}

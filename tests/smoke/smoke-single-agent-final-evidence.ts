import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import {
  assertRealBrowserEvidenceManifest,
  defaultRealBrowserEvidenceManifestPath,
  readRealBrowserEvidenceManifest,
} from './web-e2e/real-browser-evidence.js';

type FinalManifest = {
  schemaVersion?: string;
  completionGate?: string;
  command?: string;
  contractEvidence?: {
    command?: string;
    contractIds?: string[];
    result?: string;
  };
  noLegacyGuard?: {
    command?: string;
    result?: string;
  };
  selectedCases?: string[];
  webEvidenceRoot?: string;
  realBrowserEvidence?: {
    manifestPath?: string;
    source?: string;
    requiredCategories?: string[];
    releaseBlocker?: boolean;
  };
  caseManifests?: Array<{
    caseId?: string;
    manifestPath?: string;
    tags?: string[];
    migratedLegacyScripts?: string[];
    migratedLegacySteps?: string[];
  }>;
  legacyMigration?: Array<{
    legacyScript?: string;
    delegatedTo?: string;
    representedByCases?: string[];
    migratedSteps?: string[];
  }>;
  evidenceRequirements?: {
    requiresCaseManifests?: boolean;
    requiresConsoleLogs?: boolean;
    requiresNetworkSummaries?: boolean;
    requiresScreenshots?: boolean;
    requiresFailureOrImprovementNotes?: boolean;
    requiresRealInAppBrowserEvidence?: boolean;
  };
};

type CaseManifest = {
  schemaVersion?: string;
  caseId?: string;
  runIds?: string[];
  eventIds?: string[];
  projectionVersion?: string;
  projection?: Record<string, unknown>;
  runs?: Array<{
    runId?: string;
    eventIds?: string[];
    status?: string;
  }>;
  screenshots?: unknown[];
  consoleLogs?: unknown[];
  networkSummaries?: unknown[];
  note?: {
    status?: string;
    summary?: string;
    failureReason?: string;
    improvement?: string;
  };
  extra?: Record<string, unknown>;
};

const root = process.cwd();
const finalManifestPath = resolve(root, 'docs', 'test-artifacts', 'single-agent-final', 'manifest.json');
const contractIds = Array.from({ length: 18 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`);
const requiredLegacyScripts = ['smoke:browser', 'smoke:browser-multiturn', 'smoke:browser-provider-preflight'];

const manifest = JSON.parse(await readFile(finalManifestPath, 'utf8')) as FinalManifest;

assert.equal(manifest.schemaVersion, 'sciforge.single-agent-final.manifest.v1', 'final manifest schema');
assert.equal(manifest.completionGate, 'smoke:web-multiturn-final', 'final manifest completion gate');
assert.ok(manifest.command?.includes('tests/smoke/smoke-web-multiturn-final.ts'), 'final manifest command must reference web multiturn final smoke');
assert.deepEqual(manifest.contractEvidence?.contractIds, contractIds, 'final manifest must reference C01-C18 results');
assert.equal(manifest.contractEvidence?.command, 'npm run smoke:single-agent-runtime-contract', 'final manifest contract command');
assert.equal(manifest.contractEvidence?.result, 'covered-by-final-gate', 'final manifest contract result');
assert.equal(manifest.noLegacyGuard?.command, 'npm run smoke:no-legacy-paths', 'final manifest no-legacy guard command');
assert.equal(manifest.noLegacyGuard?.result, 'covered-by-final-gate', 'final manifest no-legacy guard result');
assert.equal(manifest.evidenceRequirements?.requiresCaseManifests, true, 'case manifest requirement');
assert.equal(manifest.evidenceRequirements?.requiresConsoleLogs, true, 'console log requirement');
assert.equal(manifest.evidenceRequirements?.requiresNetworkSummaries, true, 'network summary requirement');
assert.equal(manifest.evidenceRequirements?.requiresScreenshots, true, 'screenshot requirement');
assert.equal(manifest.evidenceRequirements?.requiresFailureOrImprovementNotes, true, 'failure/improvement note requirement');
assert.equal(manifest.evidenceRequirements?.requiresRealInAppBrowserEvidence, true, 'real in-app browser evidence requirement');

assert.ok(manifest.realBrowserEvidence?.manifestPath, 'final manifest must reference real in-app browser evidence');
assert.equal(manifest.realBrowserEvidence?.source, 'codex-in-app-browser', 'final manifest real browser source');
assert.equal(manifest.realBrowserEvidence?.releaseBlocker, true, 'real browser evidence must be a release blocker');
assert.deepEqual(
  manifest.realBrowserEvidence?.requiredCategories,
  ['projection-restore', 'artifact-selection', 'provider-tool-latency'],
  'final manifest real browser required categories',
);
const realBrowserManifestPath = manifest.realBrowserEvidence.manifestPath ?? defaultRealBrowserEvidenceManifestPath;
const realBrowserManifest = await readRealBrowserEvidenceManifest(realBrowserManifestPath);
await assertRealBrowserEvidenceManifest(realBrowserManifest, { manifestPath: realBrowserManifestPath, requireFiles: true });

const selectedCases = new Set(assertStringArray(manifest.selectedCases, 'selectedCases'));
const caseManifests = manifest.caseManifests ?? [];
assert.ok(selectedCases.size > 0, 'final manifest must select at least one Web E2E case');
assert.equal(caseManifests.length, selectedCases.size, 'final manifest must reference every selected Web E2E case manifest');

for (const entry of caseManifests) {
  assert.ok(entry.caseId && selectedCases.has(entry.caseId), `unexpected case manifest entry ${entry.caseId ?? '<missing>'}`);
  assert.ok(entry.manifestPath, `${entry.caseId}: manifestPath is required`);
  assert.ok((entry.tags ?? []).includes('SA-WEB-01'), `${entry.caseId}: case manifest ref must carry final web root tag`);
  const caseManifest = await readCaseManifest(entry.manifestPath);
  assert.equal(caseManifest.schemaVersion, 'sciforge.web-e2e.evidence-bundle.v1', `${entry.caseId}: web evidence schema`);
  assert.equal(caseManifest.caseId, entry.caseId, `${entry.caseId}: case id mismatch`);
  assert.ok(assertStringArray(caseManifest.runIds, `${entry.caseId}.runIds`).length > 0, `${entry.caseId}: run ids`);
  assert.ok(assertStringArray(caseManifest.eventIds, `${entry.caseId}.eventIds`).length > 0, `${entry.caseId}: event ids`);
  assert.ok(caseManifest.projectionVersion, `${entry.caseId}: projection version`);
  assert.ok(caseManifest.projection, `${entry.caseId}: projection evidence`);
  assert.ok((caseManifest.runs ?? []).some((run) => run.runId && (run.eventIds ?? []).length > 0), `${entry.caseId}: run event evidence`);
  assert.ok(Array.isArray(caseManifest.screenshots), `${entry.caseId}: screenshot evidence array is required`);
  assert.ok(Array.isArray(caseManifest.consoleLogs), `${entry.caseId}: console log evidence array is required`);
  assert.ok(Array.isArray(caseManifest.networkSummaries), `${entry.caseId}: network summary evidence array is required`);
  assert.ok(caseManifest.note?.summary?.trim(), `${entry.caseId}: failure/improvement note summary is required`);
  if (caseManifest.note?.status === 'failed') {
    assert.ok(caseManifest.note.failureReason?.trim(), `${entry.caseId}: failed note must include failureReason`);
  }
  if (caseManifest.note?.status === 'improvement-needed') {
    assert.ok(caseManifest.note.improvement?.trim(), `${entry.caseId}: improvement note must include improvement`);
  }
  assert.equal(caseManifest.extra?.completionGate, 'smoke:web-multiturn-final', `${entry.caseId}: completion gate extra`);
}

for (const legacyScript of requiredLegacyScripts) {
  const migration = (manifest.legacyMigration ?? []).find((entry) => entry.legacyScript === legacyScript);
  assert.ok(migration, `${legacyScript}: migration entry is required`);
  assert.equal(migration.delegatedTo, 'smoke:web-multiturn-final', `${legacyScript}: must delegate to final web smoke`);
  assert.ok((migration.representedByCases ?? []).length > 0, `${legacyScript}: represented cases are required`);
  assert.ok((migration.migratedSteps ?? []).length > 0, `${legacyScript}: migrated steps are required`);
}

console.log(`[ok] single-agent final evidence manifest references C01-C18, no-legacy guard, ${caseManifests.length} Web E2E case manifest(s), and real in-app browser evidence`);

async function readCaseManifest(path: string): Promise<CaseManifest> {
  const resolved = isAbsolute(path) ? path : join(root, path);
  return JSON.parse(await readFile(resolved, 'utf8')) as CaseManifest;
}

function assertStringArray(value: unknown, label: string): string[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(value.every((item) => typeof item === 'string' && item.trim()), `${label} must contain non-empty strings`);
  return value as string[];
}

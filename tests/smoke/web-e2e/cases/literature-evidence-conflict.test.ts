import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  LITERATURE_CONFLICT_REQUIREMENT_ID,
  LITERATURE_EVIDENCE_CONFLICT_CASE_ID,
  DYNAMIC_WEB_BLOCKED_REQUIREMENT_ID,
  assertDynamicWebFindings,
  assertLiteratureEvidenceConflictCase,
  assertLiteratureFindings,
  assertNoFabricatedBlockedContent,
  runLiteratureEvidenceConflictCase,
  type DynamicWebEvidenceFinding,
} from './literature-evidence-conflict.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-web-e2e-literature-evidence-conflict-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-32 models offline R-LIT-02 and R-WEB-01 evidence contracts without claiming live pass', async () => {
  const result = await runLiteratureEvidenceConflictCase(baseDir);

  assert.equal(result.manifest.caseId, LITERATURE_EVIDENCE_CONFLICT_CASE_ID);
  assert.equal(result.manifest.extra?.fixtureMode, 'offline-contract-not-live-pass');
  assert.deepEqual(result.manifest.extra?.requirementIds, [
    LITERATURE_CONFLICT_REQUIREMENT_ID,
    DYNAMIC_WEB_BLOCKED_REQUIREMENT_ID,
  ]);
  assertLiteratureEvidenceConflictCase(result);
  assert.equal(result.runResults.length, 6);
  assert.ok(result.routeTrace.some((entry) => entry.status === 'blocked'));
  assert.ok(result.routeTrace.some((entry) => entry.status === 'cached'));
});

test('SA-WEB-32 literature verification fails if contradictory PubMed evidence is flattened away', async () => {
  const result = await runLiteratureEvidenceConflictCase(baseDir);
  const flattened = result.literatureFindings.map((finding) => ({
    ...finding,
    direction: finding.direction === 'contradicts' ? 'supports' as const : finding.direction,
  }));

  assert.throws(
    () => assertLiteratureFindings(flattened),
    /contradictory evidence/,
  );
});

test('SA-WEB-32 dynamic web verification fails if blocked pages fabricate extracted content', async () => {
  const result = await runLiteratureEvidenceConflictCase(baseDir);
  const fabricated: DynamicWebEvidenceFinding[] = result.dynamicWebFindings.map((finding) => finding.status === 'blocked-cloudflare'
    ? {
      ...finding,
      extractedContent: 'Fabricated blocked page claim.',
      claimContribution: 'usable',
    }
    : finding);

  assertDynamicWebFindings(fabricated);
  assert.throws(
    () => assertNoFabricatedBlockedContent(fabricated),
    /blocked-cloudflare/,
  );
});

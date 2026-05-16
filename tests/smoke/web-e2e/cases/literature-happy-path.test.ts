import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  LITERATURE_HAPPY_PATH_CASE_ID,
  assertLiteratureHappyPathCase,
  runLiteratureHappyPathCase,
} from './literature-happy-path.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-web-e2e-literature-happy-path-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-15 completes literature search fetch/read Chinese report citation repair and audit export', async () => {
  const result = await runLiteratureHappyPathCase(baseDir);

  assert.equal(result.manifest.caseId, LITERATURE_HAPPY_PATH_CASE_ID);
  assertLiteratureHappyPathCase(result);
  assert.ok(result.providerRouteTrace.some((entry) => entry.capabilityId === 'web_search'));
  assert.ok(result.providerRouteTrace.some((entry) => entry.capabilityId === 'web_fetch'));
  assert.ok(result.providerRouteTrace.some((entry) => entry.capabilityId === 'read_ref'));
  assert.ok(result.artifactLineage.some((entry) => entry.artifactRef === 'artifact:sa-web-15-corrected-report'));
  assert.ok(result.evidenceRefs.includes('agentserver://mock/read_ref/sa-web-15/paper-one-fulltext.txt'));
  assert.ok(result.manifest.eventIds.includes('ledger:audit-export'));
});

test('SA-WEB-15 verification fails when citation repair drops read evidence refs', async () => {
  const result = await runLiteratureHappyPathCase(baseDir);
  const broken = {
    ...result,
    evidenceRefs: result.evidenceRefs.filter((ref) => ref !== 'agentserver://mock/read_ref/sa-web-15/paper-one-fulltext.txt'),
  };

  assert.throws(
    () => assertLiteratureHappyPathCase(broken),
    /paper-one-fulltext/,
  );
});

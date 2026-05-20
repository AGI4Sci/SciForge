import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  TWO_TABLE_LINEAGE_CASE_ID,
  assertTwoTableLineageCase,
  closeTwoTableLineageCase,
  runTwoTableLineageCase,
  type TwoTableLineageCaseResult,
} from './two-table-lineage.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-22-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-22 exports cleaned data, mapping artifact, lineage manifest, and reproducibility command after mapping/filter changes', async () => {
  const result = await runTwoTableLineageCase({ baseDir });
  try {
    assert.equal(result.fixture.caseId, TWO_TABLE_LINEAGE_CASE_ID);
    await assertTwoTableLineageCase(result);
    assert.equal(result.evidenceBundle.caseId, TWO_TABLE_LINEAGE_CASE_ID);
    assert.equal(result.evidenceBundle.extra?.lineageManifestRef, result.lineageManifestRef);
    assert.equal(result.evidenceBundle.extra?.reproduceCommand, result.reproduceCommand);
  } finally {
    await closeTwoTableLineageCase(result);
  }
});

test('SA-WEB-22 fails focused verification if raw source table data enters the prompt request', async () => {
  const result = await runTwoTableLineageCase({ baseDir });
  try {
    const polluted: TwoTableLineageCaseResult = {
      ...result,
      recordedRunRequests: result.recordedRunRequests.map((request) => structuredClone(request)),
      readRefCalls: result.readRefCalls.map((call) => structuredClone(call)),
    };
    polluted.recordedRunRequests[0] = {
      ...polluted.recordedRunRequests[0],
      prompt: `${polluted.recordedRunRequests[0]?.prompt ?? ''}\n${polluted.subjectsTable.sentinel}`,
    };

    await assert.rejects(
      () => assertTwoTableLineageCase(polluted),
      /raw runtime-dispatch requests must not contain subjects table contents/,
    );
  } finally {
    await closeTwoTableLineageCase(result);
  }
});

test('SA-WEB-22 fails focused verification if the updated mapping/filter plan loses lineage requirements', async () => {
  const result = await runTwoTableLineageCase({ baseDir });
  try {
    const polluted: TwoTableLineageCaseResult = {
      ...result,
      recordedRunRequests: result.recordedRunRequests.map((request) => structuredClone(request)),
      readRefCalls: result.readRefCalls.map((call) => structuredClone(call)),
    };
    polluted.recordedRunRequests[1] = {
      ...polluted.recordedRunRequests[1],
      mergePlan: {
        ...(typeof polluted.recordedRunRequests[1]?.mergePlan === 'object' && polluted.recordedRunRequests[1]?.mergePlan !== null
          ? polluted.recordedRunRequests[1]?.mergePlan
          : {}),
        requiredLineage: ['final_column_sources'],
      },
    };

    await assert.rejects(
      () => assertTwoTableLineageCase(polluted),
      /merge plan must include mapping_changes/,
    );
  } finally {
    await closeTwoTableLineageCase(result);
  }
});

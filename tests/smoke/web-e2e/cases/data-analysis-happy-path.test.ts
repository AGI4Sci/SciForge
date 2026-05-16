import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DATA_ANALYSIS_HAPPY_PATH_CASE_ID,
  assertDataAnalysisHappyPath,
  closeDataAnalysisHappyPathCase,
  runDataAnalysisHappyPathCase,
  type DataAnalysisHappyPathResult,
} from './data-analysis-happy-path.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-16-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-16 completes CSV summary regroup outlier explanation and exports markdown plus code refs', async () => {
  const result = await runDataAnalysisHappyPathCase({ baseDir });
  try {
    assert.equal(result.fixture.caseId, DATA_ANALYSIS_HAPPY_PATH_CASE_ID);
    await assertDataAnalysisHappyPath(result);
    assert.equal(result.evidenceBundle.caseId, DATA_ANALYSIS_HAPPY_PATH_CASE_ID);
    assert.equal(result.evidenceBundle.extra?.markdownExportRef, result.markdownExportRef);
    assert.deepEqual(result.evidenceBundle.extra?.codeRefs, result.codeRefs);
  } finally {
    await closeDataAnalysisHappyPathCase(result);
  }
});

test('SA-WEB-16 fails focused verification if large CSV data is placed in the raw prompt request', async () => {
  const result = await runDataAnalysisHappyPathCase({ baseDir });
  try {
    const polluted: DataAnalysisHappyPathResult = {
      ...result,
      recordedRunRequests: result.recordedRunRequests.map((request) => structuredClone(request)),
      readRefCalls: result.readRefCalls.map((call) => structuredClone(call)),
    };
    polluted.recordedRunRequests[0] = {
      ...polluted.recordedRunRequests[0],
      prompt: `${polluted.recordedRunRequests[0]?.prompt ?? ''}\n${polluted.largeCsv.sentinel}`,
    };

    await assert.rejects(
      () => assertDataAnalysisHappyPath(polluted),
      /raw AgentServer requests must not contain large CSV contents/,
    );
  } finally {
    await closeDataAnalysisHappyPathCase(result);
  }
});

test('SA-WEB-16 fails focused verification if a turn skips read_ref for the large CSV', async () => {
  const result = await runDataAnalysisHappyPathCase({ baseDir });
  try {
    const polluted: DataAnalysisHappyPathResult = {
      ...result,
      recordedRunRequests: result.recordedRunRequests.map((request) => structuredClone(request)),
      readRefCalls: result.readRefCalls.map((call) => structuredClone(call)),
    };
    polluted.readRefCalls = polluted.readRefCalls.slice(0, 2);

    await assert.rejects(
      () => assertDataAnalysisHappyPath(polluted),
      /each round must read the large CSV through read_ref/,
    );
  } finally {
    await closeDataAnalysisHappyPathCase(result);
  }
});

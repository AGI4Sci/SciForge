import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  LONGITUDINAL_MESSY_CSV_CASE_ID,
  assertLongitudinalMessyCsvCase,
  closeLongitudinalMessyCsvCase,
  runLongitudinalMessyCsvCase,
  type LongitudinalMessyCsvCaseResult,
} from './longitudinal-messy-csv.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-20-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-20 cleans long-format messy CSV, adjusts for batch/timepoint, compares coefficients, and exports rerun artifacts', async () => {
  const result = await runLongitudinalMessyCsvCase({ baseDir });
  try {
    assert.equal(result.fixture.caseId, LONGITUDINAL_MESSY_CSV_CASE_ID);
    await assertLongitudinalMessyCsvCase(result);
    assert.equal(result.evidenceBundle.caseId, LONGITUDINAL_MESSY_CSV_CASE_ID);
    assert.equal(result.evidenceBundle.extra?.reportRef, result.reportRef);
    assert.equal(result.evidenceBundle.extra?.coefficientComparisonRef, result.coefficientComparisonRef);
    assert.equal(result.evidenceBundle.extra?.codeFileRef, 'file:.sciforge/tasks/sa-web-20-rerun-analysis.ts');
  } finally {
    await closeLongitudinalMessyCsvCase(result);
  }
});

test('SA-WEB-20 fails focused verification if raw messy CSV data enters the prompt request', async () => {
  const result = await runLongitudinalMessyCsvCase({ baseDir });
  try {
    const polluted: LongitudinalMessyCsvCaseResult = {
      ...result,
      recordedRunRequests: result.recordedRunRequests.map((request) => structuredClone(request)),
      readRefCalls: result.readRefCalls.map((call) => structuredClone(call)),
    };
    polluted.recordedRunRequests[0] = {
      ...polluted.recordedRunRequests[0],
      prompt: `${polluted.recordedRunRequests[0]?.prompt ?? ''}\n${polluted.messyCsv.sentinel}`,
    };

    await assert.rejects(
      () => assertLongitudinalMessyCsvCase(polluted),
      /raw runtime-dispatch requests must not contain messy CSV contents/,
    );
  } finally {
    await closeLongitudinalMessyCsvCase(result);
  }
});

test('SA-WEB-20 fails focused verification if the covariate model drops batch or timepoint', async () => {
  const result = await runLongitudinalMessyCsvCase({ baseDir });
  try {
    const polluted: LongitudinalMessyCsvCaseResult = {
      ...result,
      recordedRunRequests: result.recordedRunRequests.map((request) => structuredClone(request)),
      readRefCalls: result.readRefCalls.map((call) => structuredClone(call)),
    };
    polluted.recordedRunRequests[1] = {
      ...polluted.recordedRunRequests[1],
      analysisPlan: {
        ...(typeof polluted.recordedRunRequests[1]?.analysisPlan === 'object' && polluted.recordedRunRequests[1]?.analysisPlan !== null
          ? polluted.recordedRunRequests[1]?.analysisPlan
          : {}),
        requiredCovariates: ['timepoint'],
      },
    };

    await assert.rejects(
      () => assertLongitudinalMessyCsvCase(polluted),
      /batch\/timepoint covariates/,
    );
  } finally {
    await closeLongitudinalMessyCsvCase(result);
  }
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  SCHEMA_DRIFT_CONFOUNDER_CASE_ID,
  assertSchemaDriftConfounderCase,
  closeSchemaDriftConfounderCase,
  runSchemaDriftConfounderCase,
  type SchemaDriftConfounderCaseResult,
} from './schema-drift-confounder.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-21-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-21 reinterprets schema drift confounder and separates stale from valid refs', async () => {
  const result = await runSchemaDriftConfounderCase({ baseDir });
  try {
    assert.equal(result.fixture.caseId, SCHEMA_DRIFT_CONFOUNDER_CASE_ID);
    await assertSchemaDriftConfounderCase(result);
    assert.equal(result.evidenceBundle.caseId, SCHEMA_DRIFT_CONFOUNDER_CASE_ID);
    assert.equal(result.evidenceBundle.extra?.staleAnalysisRef, result.staleAnalysisRef);
    assert.equal(result.evidenceBundle.extra?.validRefsManifestRef, result.validRefsManifestRef);
  } finally {
    await closeSchemaDriftConfounderCase(result);
  }
});

test('SA-WEB-21 fails focused verification if raw schema-drift data enters the prompt request', async () => {
  const result = await runSchemaDriftConfounderCase({ baseDir });
  try {
    const polluted: SchemaDriftConfounderCaseResult = {
      ...result,
      recordedRunRequests: result.recordedRunRequests.map((request) => structuredClone(request)),
      readRefCalls: result.readRefCalls.map((call) => structuredClone(call)),
    };
    polluted.recordedRunRequests[0] = {
      ...polluted.recordedRunRequests[0],
      prompt: `${polluted.recordedRunRequests[0]?.prompt ?? ''}\n${polluted.dataTable.sentinel}`,
    };

    await assert.rejects(
      () => assertSchemaDriftConfounderCase(polluted),
      /raw runtime-dispatch requests must not contain schema-drift table contents/,
    );
  } finally {
    await closeSchemaDriftConfounderCase(result);
  }
});

test('SA-WEB-21 fails focused verification if stale interpretation refs are read as analysis inputs', async () => {
  const result = await runSchemaDriftConfounderCase({ baseDir });
  try {
    const polluted: SchemaDriftConfounderCaseResult = {
      ...result,
      recordedRunRequests: result.recordedRunRequests.map((request) => structuredClone(request)),
      readRefCalls: result.readRefCalls.map((call) => structuredClone(call)),
    };
    const firstCall = polluted.readRefCalls[0];
    assert.ok(firstCall);
    firstCall.input = {
      ...(typeof firstCall.input === 'object' && firstCall.input !== null && !Array.isArray(firstCall.input) ? firstCall.input : {}),
      ref: result.staleAnalysisRef,
    };

    await assert.rejects(
      () => assertSchemaDriftConfounderCase(polluted),
      /stale refs must not be used as analysis inputs/,
    );
  } finally {
    await closeSchemaDriftConfounderCase(result);
  }
});

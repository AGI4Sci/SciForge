import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  LARGE_FILE_DIAGNOSTICS_CASE_ID,
  assertLargeFileDiagnosticsCase,
  closeLargeFileDiagnosticsCase,
  runLargeFileDiagnosticsCase,
  type LargeFileDiagnosticsCaseResult,
} from './large-file-diagnostics.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-19-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-19 indexes a large log, inspects a bounded anomaly snippet, and exports diagnostics plus read-fragment manifest', async () => {
  const result = await runLargeFileDiagnosticsCase({ baseDir });
  try {
    assert.equal(result.fixture.caseId, LARGE_FILE_DIAGNOSTICS_CASE_ID);
    await assertLargeFileDiagnosticsCase(result);
    assert.equal(result.evidenceBundle.caseId, LARGE_FILE_DIAGNOSTICS_CASE_ID);
    assert.equal(result.evidenceBundle.extra?.diagnosticReportRef, result.diagnosticReportRef);
    assert.equal(result.evidenceBundle.extra?.readFragmentsRef, result.readFragmentsRef);
  } finally {
    await closeLargeFileDiagnosticsCase(result);
  }
});

test('SA-WEB-19 fails focused verification if large log data enters the raw prompt request', async () => {
  const result = await runLargeFileDiagnosticsCase({ baseDir });
  try {
    const polluted: LargeFileDiagnosticsCaseResult = {
      ...result,
      recordedRunRequests: result.recordedRunRequests.map((request) => structuredClone(request)),
      readRefCalls: result.readRefCalls.map((call) => structuredClone(call)),
    };
    polluted.recordedRunRequests[0] = {
      ...polluted.recordedRunRequests[0],
      prompt: `${polluted.recordedRunRequests[0]?.prompt ?? ''}\n${polluted.largeLog.sentinel}`,
    };

    await assert.rejects(
      () => assertLargeFileDiagnosticsCase(polluted),
      /raw runtime-dispatch requests must not contain large log contents/,
    );
  } finally {
    await closeLargeFileDiagnosticsCase(result);
  }
});

test('SA-WEB-19 fails focused verification if a read_ref call asks for full text', async () => {
  const result = await runLargeFileDiagnosticsCase({ baseDir });
  try {
    const polluted: LargeFileDiagnosticsCaseResult = {
      ...result,
      recordedRunRequests: result.recordedRunRequests.map((request) => structuredClone(request)),
      readRefCalls: result.readRefCalls.map((call) => structuredClone(call)),
    };
    const firstCall = polluted.readRefCalls[0];
    assert.ok(firstCall);
    firstCall.input = {
      ...(typeof firstCall.input === 'object' && firstCall.input !== null && !Array.isArray(firstCall.input) ? firstCall.input : {}),
      mode: 'full',
      includeFullText: true,
      maxBytes: 100_000,
      byteRange: [0, 100_000],
    };

    await assert.rejects(
      () => assertLargeFileDiagnosticsCase(polluted),
      /read_ref mode must be bounded/,
    );
  } finally {
    await closeLargeFileDiagnosticsCase(result);
  }
});

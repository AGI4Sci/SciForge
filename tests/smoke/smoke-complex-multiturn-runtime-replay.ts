import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { WorkspaceRuntimeEvent } from '../../src/runtime/runtime-types';
import {
  COMPLEX_MULTITURN_RUNTIME_REPLAY_SCHEMA_VERSION,
  COMPLEX_MULTITURN_RUNTIME_REPLAY_SUMMARY_SCHEMA_VERSION,
  assertComplexMultiturnRuntimeReplayReport,
  buildComplexMultiturnRuntimeReplayReportFromBundle,
  buildComplexMultiturnRuntimeReplayReport,
  extractWorkspaceRuntimeEventsFromReplayBundle,
  writeComplexMultiturnRuntimeReplayReport,
  type ComplexMultiturnRuntimeReplayReport,
} from '../harness/complexMultiturnRuntimeReplay';

const execFileAsync = promisify(execFile);
const fixtureUrl = new URL('../fixtures/complex-multiturn/m16-workspace-runtime-events.json', import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8')) as {
  schemaVersion?: string;
  fixtureId?: string;
  session?: {
    runtimeEvents?: WorkspaceRuntimeEvent[];
  };
};

assert.equal(fixture.schemaVersion, 'sciforge.workspace-runtime-events.fixture.v1');
assert.equal(fixture.fixtureId, 'm16-workspace-runtime-event-replay-export');
const runtimeEvents = fixture.session?.runtimeEvents;
assert.ok(runtimeEvents, 'fixture should include session.runtimeEvents');

const report = buildComplexMultiturnRuntimeReplayReport({
  events: runtimeEvents,
  generatedAt: '2026-05-12T00:00:00.000Z',
  benchmarkId: 'smoke-complex-multiturn-m16-runtime-replay',
  sourceKind: 'session-runtime-events',
});

assertComplexMultiturnRuntimeReplayReport(report);
assert.equal(report.schemaVersion, COMPLEX_MULTITURN_RUNTIME_REPLAY_SCHEMA_VERSION);
assert.equal(report.source.kind, 'session-runtime-events');
assert.equal(report.source.eventCount, runtimeEvents.length);
assert.equal(report.benchmarkReport.schemaVersion, 'sciforge.complex-dialogue-benchmark-report.v1');
assert.equal(report.replaySummary.schemaVersion, COMPLEX_MULTITURN_RUNTIME_REPLAY_SUMMARY_SCHEMA_VERSION);
assert.equal(report.replaySummary.eventCount, runtimeEvents.length);
assert.equal(report.replaySummary.artifactRefCount, report.coverage.artifactRefs.length);
assert.equal(report.replaySummary.runRefCount, report.coverage.runRefs.length);
assert.equal(report.benchmarkReport.gateEvaluation?.passed, true);
assert.equal(report.coverage.firstVisibleResponseMs, 120);
assert.ok(report.coverage.artifactRefs.includes('artifact:m16-report-draft'));
assert.ok(report.coverage.artifactRefs.includes('artifact:m16-report-final'));
assert.ok(report.coverage.runRefs.includes('run:m16-runtime-replay-001'));
assert.ok(report.coverage.executionUnitRefs.includes('execution-unit:download-evidence'));
assert.ok(report.coverage.diagnosticRefs.includes('raw:m16-agentserver-response.json'));
assert.ok(report.coverage.rawDiagnosticRefs.includes('stderr:m16-verifier.stderr'));
assert.ok(report.coverage.rawDiagnosticRefs.includes('log:m16-runtime-debug.log'));
assert.ok(!report.coverage.primaryOutputRefs.some((ref) => report.coverage.rawDiagnosticRefs.includes(ref)), 'raw diagnostics must not be primary output refs');
assert.equal(report.coverage.resumePreflightSeen, true);
assert.equal(report.coverage.historyBranchRecordSeen, true);
assert.equal(report.coverage.recoveryPlanSeen, true);
assert.equal(report.coverage.rawDiagnosticsFoldedByContract, true);
assert.equal(report.metrics.artifactReferenceAccuracy, true);
assert.equal(report.metrics.runReferenceAccuracy, true);
assert.equal(report.metrics.resumeCorrectness, true);
assert.equal(report.metrics.historyMutationCorrectness, true);
assert.equal(report.metrics.recoverySuccess, true);
assert.equal(report.metrics.sideEffectDuplicationPrevented, true);
assert.equal(report.benchmarkReport.timeline.summary.failureCount, 1);
assert.equal(report.benchmarkReport.timeline.summary.recoveryEventCount, 1);
assert.equal(report.benchmarkReport.timeline.summary.repeatedWorkCount, 0);
assert.ok(report.replaySummary.resumeCount > 0, 'replay summary should include resume-preflight metrics');
assert.ok(report.replaySummary.historyMutationCount > 0, 'replay summary should include history branch metrics');
assert.equal(report.replaySummary.recoveryEventCount, 1);
assert.equal(report.replaySummary.repeatedWorkCount, 0);
assert.equal(report.replaySummary.lifecycleRecoveryRate, 1);
assert.equal(report.replaySummary.metrics.sideEffectDuplicationPrevented, true);

const rawDiagnosticEvents = report.benchmarkReport.timeline.events.filter((event) =>
  event.refs?.some((ref) => report.coverage.rawDiagnosticRefs.includes(ref))
);
assert.ok(rawDiagnosticEvents.length > 0, 'fixture should replay raw diagnostics events');
assert.ok(rawDiagnosticEvents.every((event) => event.category === 'diagnostic'), 'raw diagnostics should remain diagnostic events');
assert.ok(rawDiagnosticEvents.every((event) => event.qualitySignals?.userVisible !== true), 'raw diagnostics should stay folded from visible output');
assert.ok(rawDiagnosticEvents.every((event) => event.qualitySignals?.finalResult !== true), 'raw diagnostics should not be final output');

const bundleReport = buildComplexMultiturnRuntimeReplayReportFromBundle({
  schemaVersion: 'sciforge.session-bundle.v1',
  session: {
    sessionId: 'session-runtime-replay-001',
    runtimeEvents: runtimeEvents.map((runtimeEvent) => ({ event: runtimeEvent })),
  },
}, {
  generatedAt: '2026-05-12T00:00:00.000Z',
  benchmarkId: 'smoke-complex-multiturn-runtime-replay-bundle',
});
assertComplexMultiturnRuntimeReplayReport(bundleReport);
assert.equal(bundleReport.source.kind, 'session-runtime-events');
assert.equal(bundleReport.source.bundleSchemaVersion, 'sciforge.session-bundle.v1');
assert.equal(bundleReport.source.sessionId, 'session-runtime-replay-001');

const extracted = extractWorkspaceRuntimeEventsFromReplayBundle({ runtime: { events: runtimeEvents } });
assert.equal(extracted.sourceKind, 'workspace-runtime-events');
assert.equal(extracted.events.length, runtimeEvents.length);

const dir = await mkdtemp(join(tmpdir(), 'sciforge-complex-runtime-replay-'));
try {
  const outPath = join(dir, 'runtime-replay.json');
  await writeComplexMultiturnRuntimeReplayReport(outPath, report);
  const loaded = JSON.parse(await readFile(outPath, 'utf8')) as ComplexMultiturnRuntimeReplayReport;
  assertComplexMultiturnRuntimeReplayReport(loaded);

  await execFileAsync(process.execPath, [
    '--import',
    'tsx',
    'tools/export-complex-multiturn-runtime-replay.ts',
    '--events',
    fixturePath,
    '--out',
    outPath,
    '--generated-at',
    '2026-05-12T00:00:00.000Z',
    '--source-kind',
    'session-runtime-events',
  ], { cwd: process.cwd() });
  const cliReport = JSON.parse(await readFile(outPath, 'utf8')) as ComplexMultiturnRuntimeReplayReport;
  assertComplexMultiturnRuntimeReplayReport(cliReport);
  assert.equal(cliReport.source.kind, 'session-runtime-events');
  assert.equal(cliReport.coverage.rawDiagnosticsFoldedByContract, true);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`[ok] complex multiturn runtime replay covered ${report.source.eventCount} runtime events with ${report.coverage.artifactRefs.length} artifact refs`);

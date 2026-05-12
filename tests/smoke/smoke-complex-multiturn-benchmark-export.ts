import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { complexMultiTurnFixtures } from '../fixtures/complex-multiturn/suite';
import {
  COMPLEX_MULTITURN_BENCHMARK_EXPORT_SCHEMA_VERSION,
  assertComplexMultiturnBenchmarkExport,
  buildComplexMultiturnBenchmarkExport,
  writeComplexMultiturnBenchmarkExport,
  type ComplexMultiturnBenchmarkExport,
} from '../harness/complexMultiturnBenchmarkExport';

const report = buildComplexMultiturnBenchmarkExport(complexMultiTurnFixtures, {
  generatedAt: '2026-05-12T00:00:00.000Z',
  benchmarkId: 'smoke-complex-multiturn-benchmark',
});

assertComplexMultiturnBenchmarkExport(report);
assert.equal(report.schemaVersion, COMPLEX_MULTITURN_BENCHMARK_EXPORT_SCHEMA_VERSION);
assert.equal(report.fixtureCount, 67);
assert.equal(report.totalTurns, 620);
assert.deepEqual(report.countsByTier, {
  'five-turn': 10,
  'ten-turn': 12,
  'twenty-turn': 15,
  lifecycle: 30,
});
assert.equal(report.aggregateReport.schemaVersion, 'sciforge.complex-dialogue-benchmark-report.v1');
assert.equal(report.contractSummary.schemaVersion, 'sciforge.complex-multiturn-contract-replay-summary.v1');
assert.equal(report.replaySummary.schemaVersion, 'sciforge.complex-multiturn-replay.v1');
assert.equal(report.contractSummary.totalStateDigestCheckpoints, 620);
assert.ok(report.contractSummary.totalFailureInjections > 67);
assert.equal(report.contractSummary.totalExpectedRecoveryEvents, report.contractSummary.totalFailureInjections);
assert.equal(report.replaySummary.missingRequiredEventFixtures.length, 0);

const aggregateSummary = report.aggregateReport.timeline.summary;
const gateEvaluation = report.aggregateReport.gateEvaluation;
assert.ok(report.aggregateReport.gates, 'benchmark export should include configured gates');
assert.ok(gateEvaluation, 'benchmark export should include a gate summary');
assert.equal(gateEvaluation.passed, true);
assert.deepEqual(report.aggregateReport.gates, {
  maxRepeatedWorkCount: 0,
  maxFailureCount: report.contractSummary.totalFailureInjections,
  maxBlockingVerifyRate: 0,
  minBackgroundVerifyFailureRecoveryRate: 1,
  minProgressEventCount: 620,
  minRecoveryEventCount: report.contractSummary.totalFailureInjections,
  minLifecycleRecoveryRate: 0.95,
  minQualityScore: 0.25,
});

const gatesByName = new Map(gateEvaluation.results.map((gate) => [gate.name, gate]));
for (const gateName of [
  'maxRepeatedWorkCount',
  'maxFailureCount',
  'maxBlockingVerifyRate',
  'minBackgroundVerifyFailureRecoveryRate',
  'minProgressEventCount',
  'minRecoveryEventCount',
  'minLifecycleRecoveryRate',
  'minQualityScore',
] as const) {
  const gate = gatesByName.get(gateName);
  assert.ok(gate, `missing gate result ${gateName}`);
  assert.equal(gate.passed, true, `${gateName} should pass`);
  assert.equal(typeof gate.message, 'string', `${gateName} should include a readable summary`);
}
assert.equal(gatesByName.get('minProgressEventCount')?.actual, 620);
assert.equal(gatesByName.get('minRecoveryEventCount')?.actual, report.contractSummary.totalFailureInjections);
assert.equal(gatesByName.get('minLifecycleRecoveryRate')?.actual, aggregateSummary.lifecycle.lifecycleRecoveryRate);
assert.equal(gatesByName.get('maxBlockingVerifyRate')?.actual, aggregateSummary.verify.blockingRate);
assert.equal(gatesByName.get('minBackgroundVerifyFailureRecoveryRate')?.actual, aggregateSummary.verify.backgroundFailureRecoveryRate);

assert.equal(aggregateSummary.turnCount, 620);
assert.equal(aggregateSummary.progressEventCount, 620);
assert.equal(aggregateSummary.repeatedWorkCount, 0);
assert.equal(aggregateSummary.failureCount, report.contractSummary.totalFailureInjections);
assert.equal(aggregateSummary.recoveryEventCount, report.contractSummary.totalFailureInjections);
assert.ok(aggregateSummary.verify.latencyMs > 0, 'verify metrics should include sidecar verify latency');
assert.equal(aggregateSummary.verify.blockingRate, 0);
assert.equal(aggregateSummary.verify.backgroundFailureRecoveryRate, 1);
assert.ok(aggregateSummary.lifecycle.resumeCount > 0, 'lifecycle metrics should include resume events');
assert.ok(aggregateSummary.lifecycle.historyEditCount > 0, 'lifecycle metrics should include history edits');
assert.ok(aggregateSummary.lifecycle.branchCount > 0, 'lifecycle metrics should include branches');
assert.ok(aggregateSummary.lifecycle.mergeCount > 0, 'lifecycle metrics should include merges');
assert.ok(aggregateSummary.lifecycle.lifecycleRecoveryRate >= 0.95);

assert.ok(report.fixtureSummaries.every((fixture) => fixture.gatePassed));
assert.ok(report.fixtureSummaries.every((fixture) => fixture.metrics.recoverySuccess));
assert.ok(report.fixtureSummaries.every((fixture) => fixture.metrics.artifactReferenceAccuracy));
assert.ok(report.fixtureSummaries.every((fixture) => fixture.metrics.sideEffectDuplicationPrevented));
assert.ok(report.fixtureSummaries.every((fixture) => fixture.metrics.blockingVerifyRate === 0));
assert.ok(report.fixtureSummaries.every((fixture) => fixture.metrics.backgroundVerifyFailureRecoveryRate === 1));
assert.ok(report.fixtureSummaries.some((fixture) => fixture.tier === 'lifecycle' && fixture.metrics.resumeCorrectness));
assert.ok(report.fixtureSummaries.some((fixture) => fixture.metrics.historyMutationCorrectness));
assert.ok(report.fixtureSummaries.filter((fixture) => fixture.recoveryEventCount > 0).length > 50);

const dir = await mkdtemp(join(tmpdir(), 'sciforge-complex-multiturn-benchmark-'));
try {
  const outPath = join(dir, 'report.json');
  await writeComplexMultiturnBenchmarkExport(outPath, report);
  const loaded = JSON.parse(await readFile(outPath, 'utf8')) as ComplexMultiturnBenchmarkExport;
  assertComplexMultiturnBenchmarkExport(loaded);
  assert.equal(loaded.schemaVersion, COMPLEX_MULTITURN_BENCHMARK_EXPORT_SCHEMA_VERSION);
  assert.equal(loaded.fixtureCount, 67);
  assert.equal(loaded.totalTurns, 620);
  assert.equal(loaded.aggregateReport.gateEvaluation?.passed, true);
  assert.equal(loaded.aggregateReport.timeline.summary.lifecycle.lifecycleRecoveryRate, aggregateSummary.lifecycle.lifecycleRecoveryRate);
  assert.equal(loaded.aggregateReport.benchmarkId, 'smoke-complex-multiturn-benchmark');
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`[ok] complex multiturn benchmark export covered ${report.fixtureCount} fixtures, ${report.totalTurns} turns, ${report.contractSummary.totalFailureInjections} recovery injections`);

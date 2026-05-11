import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  aggregateComplexDialogueTimeline,
  buildComplexDialogueBenchmarkReport,
  compareComplexDialogueBenchmarkReports,
  complexDialogueEventFromRuntimeEvent,
  evaluateComplexDialoguePerformanceGates,
  evaluateComplexDialogueRegressionGuard,
  validateComplexDialogueBenchmarkReport,
  writeComplexDialogueBenchmarkReport,
  type ComplexDialogueTimelineEvent,
} from './complex-dialogue-metrics';

test('aggregates event timeline speed, waits, lifecycle, refs, and quality signals', () => {
  const summary = aggregateComplexDialogueTimeline([
    event('turn-1', 'user-turn', 'user', 0, { turnIndex: 1 }),
    event('progress-1', 'process-progress', 'progress', 120, { turnIndex: 1, qualitySignals: { userVisible: true } }),
    event('backend-1', 'backend-event', 'backend', 180, { tokens: { input: 10, output: 4 } }),
    event('compact-start', 'context-compaction', 'compaction', 200, { status: 'started', phase: 'context' }),
    event('compact-end', 'context-compaction', 'compaction', 260, { status: 'completed', phase: 'context' }),
    event('verify', 'verification', 'verification', 270, { durationMs: 30 }),
    event('failure', 'tool-failed', 'failure', 320, { qualitySignals: { failure: true, recoverable: true } }),
    event('resume', 'resume-after-restart', 'lifecycle', 360, { qualitySignals: { lifecycleKind: 'resume' } }),
    event('recovery', 'recovery-plan', 'recovery', 390),
    event('artifact', 'artifact-produced', 'artifact', 450, { refs: ['file:.sciforge/artifacts/report.md'], qualitySignals: { artifactRefs: 1, evidenceRefs: 2, finalResult: true } }),
  ]);

  assert.equal(summary.eventCount, 10);
  assert.equal(summary.firstVisibleResponseMs, 120);
  assert.equal(summary.firstBackendEventMs, 180);
  assert.equal(summary.waits.compactionWaitMs, 60);
  assert.equal(summary.waits.verificationWaitMs, 30);
  assert.equal(summary.failureCount, 1);
  assert.equal(summary.recoveryEventCount, 1);
  assert.equal(summary.lifecycle.resumeCount, 1);
  assert.equal(summary.lifecycle.lifecycleRecoveryRate, 1);
  assert.equal(summary.artifactRefCount, 1);
  assert.equal(summary.evidenceRefCount, 2);
  assert.equal(summary.tokenUsage.total, 14);
  assert.ok(summary.qualityScore > 0.6);
});

test('evaluates performance gates as pure pass/fail findings', () => {
  const report = buildComplexDialogueBenchmarkReport({
    benchmarkId: 'h020-gates',
    variant: 'candidate',
    generatedAt: '2026-05-12T00:00:00.000Z',
    events: [
      event('user', 'user-turn', 'user', 0),
      event('visible', 'process-progress', 'progress', 900),
      event('final', 'assistant-final', 'assistant', 1200, { qualitySignals: { finalResult: true, userVisible: true } }),
    ],
    gates: {
      maxFirstVisibleMs: 500,
      maxTotalDurationMs: 1500,
      minProgressEventCount: 1,
      minQualityScore: 0.5,
    },
  });

  assert.equal(report.gateEvaluation?.passed, false);
  assert.ok(report.gateEvaluation?.results.some((result) => result.name === 'maxFirstVisibleMs' && !result.passed));
  assert.ok(report.gateEvaluation?.results.some((result) => result.name === 'maxTotalDurationMs' && result.passed));

  const direct = evaluateComplexDialoguePerformanceGates(report.timeline.summary, { maxFirstVisibleMs: 1000 });
  assert.equal(direct.passed, true);
});

test('compares baseline and optimized reports and flags regressions without side effects', () => {
  const baseline = buildComplexDialogueBenchmarkReport({
    benchmarkId: 'h020-compare',
    variant: 'baseline',
    generatedAt: '2026-05-12T00:00:00.000Z',
    events: [
      event('b-user', 'user-turn', 'user', 0),
      event('b-visible', 'process-progress', 'progress', 1000),
      event('b-final', 'assistant-final', 'assistant', 3000, { qualitySignals: { finalResult: true, userVisible: true, evidenceRefs: 1 } }),
    ],
  });
  const optimized = buildComplexDialogueBenchmarkReport({
    benchmarkId: 'h020-compare',
    variant: 'optimized',
    generatedAt: '2026-05-12T00:01:00.000Z',
    events: [
      event('o-user', 'user-turn', 'user', 0),
      event('o-visible', 'process-progress', 'progress', 400),
      event('o-final', 'assistant-final', 'assistant', 1200, { qualitySignals: { finalResult: true, userVisible: true, evidenceRefs: 2 } }),
    ],
  });

  const comparison = compareComplexDialogueBenchmarkReports(baseline, optimized, '2026-05-12T00:02:00.000Z');
  assert.equal(comparison.speedups.firstVisibleResponsePercent, 60);
  assert.equal(comparison.speedups.totalDurationPercent, 60);
  assert.ok(comparison.deltas.qualityScore >= 0);
  const guard = evaluateComplexDialogueRegressionGuard(comparison);
  assert.equal(guard.passed, true);
  assert.ok(guard.improvements.some((item) => item.includes('first visible response')));

  const slower = compareComplexDialogueBenchmarkReports(optimized, baseline, '2026-05-12T00:03:00.000Z');
  const slowerGuard = evaluateComplexDialogueRegressionGuard(slower, { maxFirstVisibleSlowdownPercent: 10 });
  assert.equal(slowerGuard.passed, false);
  assert.ok(slowerGuard.regressions.some((item) => item.includes('first visible response')));
});

test('normalizes workspace runtime events into benchmark timeline events', () => {
  const runtimeEvent = complexDialogueEventFromRuntimeEvent({
    type: 'contextCompaction',
    status: 'completed',
    message: 'Context compaction completed.',
    usage: { input: 8, output: 2 },
    raw: {
      id: 'raw-compact',
      durationMs: 44,
      outputRef: 'file:.sciforge/logs/compact.json',
    },
  }, 3);

  assert.equal(runtimeEvent.id, 'raw-compact');
  assert.equal(runtimeEvent.category, 'compaction');
  assert.equal(runtimeEvent.durationMs, 44);
  assert.equal(runtimeEvent.tokens?.total, undefined);
  assert.deepEqual(runtimeEvent.refs, ['file:.sciforge/logs/compact.json']);
});

test('validates and writes debug benchmark reports as JSON', async () => {
  const report = buildComplexDialogueBenchmarkReport({
    benchmarkId: 'h020-writer',
    variant: 'candidate',
    generatedAt: '2026-05-12T00:00:00.000Z',
    events: [
      event('user', 'user-turn', 'user', 0),
      event('progress', 'process-progress', 'progress', 50),
      event('final', 'assistant-final', 'assistant', 100, { qualitySignals: { finalResult: true } }),
    ],
  });
  const validation = validateComplexDialogueBenchmarkReport(report);
  assert.equal(validation.ok, true);

  const dir = await mkdtemp(join(tmpdir(), 'sciforge-h020-metrics-'));
  try {
    const path = join(dir, 'nested', 'report.json');
    await writeComplexDialogueBenchmarkReport(path, report);
    const written = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    assert.equal(written.schemaVersion, 'sciforge.complex-dialogue-benchmark-report.v1');
    assert.equal(written.benchmarkId, 'h020-writer');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validation rejects malformed reports', () => {
  const validation = validateComplexDialogueBenchmarkReport({
    schemaVersion: 'wrong',
    timeline: { events: [] },
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.path === 'schemaVersion'));
  assert.ok(validation.issues.some((issue) => issue.path === 'benchmarkId'));
  assert.ok(validation.issues.some((issue) => issue.path === 'timeline.summary'));
});

function event(
  id: string,
  type: string,
  category: ComplexDialogueTimelineEvent['category'],
  timeMs: number,
  overrides: Partial<ComplexDialogueTimelineEvent> = {},
): ComplexDialogueTimelineEvent {
  return {
    id,
    type,
    category,
    timeMs,
    ...overrides,
  };
}

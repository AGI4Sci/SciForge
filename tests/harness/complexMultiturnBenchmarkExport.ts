import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  buildComplexDialogueBenchmarkReport,
  type ComplexDialogueBenchmarkReport,
  type ComplexDialogueTimelineSummary,
  type ComplexDialogueTimelineEvent,
} from '../../src/runtime/gateway/complex-dialogue-metrics';
import type { ComplexMultiTurnFixture } from '../fixtures/complex-multiturn/contract';
import {
  COMPLEX_MULTITURN_CONTRACT_REPLAY_SUMMARY_SCHEMA_VERSION,
  replayComplexMultiturnFixture,
  summarizeComplexMultiturnReplayContracts,
  summarizeComplexMultiturnReplayFixtures,
  type ComplexMultiturnReplayResult,
} from './complexMultiturnReplay';

export const COMPLEX_MULTITURN_BENCHMARK_EXPORT_SCHEMA_VERSION = 'sciforge.complex-multiturn-benchmark-export.v1' as const;

export interface ComplexMultiturnBenchmarkExport {
  schemaVersion: typeof COMPLEX_MULTITURN_BENCHMARK_EXPORT_SCHEMA_VERSION;
  generatedAt: string;
  fixtureCount: number;
  totalTurns: number;
  countsByTier: Record<ComplexMultiTurnFixture['tier'], number>;
  aggregateReport: ComplexDialogueBenchmarkReport;
  replaySummary: ComplexMultiturnReplayAggregateSummary;
  contractSummary: ReturnType<typeof summarizeComplexMultiturnReplayContracts>;
  fixtureSummaries: ComplexMultiturnBenchmarkFixtureSummary[];
}

export interface ComplexMultiturnReplayAggregateSummary {
  schemaVersion: string;
  fixtureCount: number;
  missingRequiredEventFixtures: string[];
  averageQualityScore: number;
  totalEventCount: number;
  totalFailureCount: number;
  totalRecoveryEventCount: number;
  verifyLatencyMs: number;
  blockingVerifyRate: number;
  backgroundVerifyFailureRecoveryRate: number;
  aggregateTimeline: ComplexDialogueTimelineSummary;
}

export interface ComplexMultiturnBenchmarkFixtureSummary {
  id: string;
  sourceTaskId: string;
  tier: ComplexMultiTurnFixture['tier'];
  turnCount: number;
  eventCount: number;
  failureCount: number;
  recoveryEventCount: number;
  qualityScore: number;
  firstVisibleResponseMs?: number;
  verifyLatencyMs: number;
  blockingVerifyRate: number;
  backgroundVerifyFailureRecoveryRate: number;
  gatePassed: boolean;
  missingRequiredEvents: string[];
  metrics: ComplexMultiturnReplayResult['metrics'];
}

export function buildComplexMultiturnBenchmarkExport(
  fixtures: ComplexMultiTurnFixture[],
  options: { generatedAt?: string; benchmarkId?: string } = {},
): ComplexMultiturnBenchmarkExport {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const results = fixtures.map((fixture) => replayComplexMultiturnFixture(fixture));
  const contractSummary = summarizeComplexMultiturnReplayContracts(fixtures);
  const aggregateEvents = aggregateEventsForReplayResults(results);
  const aggregateReport = buildComplexDialogueBenchmarkReport({
    benchmarkId: options.benchmarkId ?? 'complex-multiturn-benchmark',
    variant: 'candidate',
    generatedAt,
    events: aggregateEvents,
    gates: {
      maxRepeatedWorkCount: 0,
      maxFailureCount: contractSummary.totalFailureInjections,
      maxBlockingVerifyRate: 0,
      minBackgroundVerifyFailureRecoveryRate: 1,
      minProgressEventCount: contractSummary.totalTurns,
      minRecoveryEventCount: contractSummary.totalFailureInjections,
      minLifecycleRecoveryRate: 0.95,
      minQualityScore: 0.25,
    },
    metadata: {
      source: 'complex-multiturn-fixture-replay',
      fixtureCount: fixtures.length,
      aggregateEventCount: aggregateEvents.length,
      fixtureTurnIndexesRebased: true,
      contractSummarySchemaVersion: COMPLEX_MULTITURN_CONTRACT_REPLAY_SUMMARY_SCHEMA_VERSION,
    },
  });

  return {
    schemaVersion: COMPLEX_MULTITURN_BENCHMARK_EXPORT_SCHEMA_VERSION,
    generatedAt,
    fixtureCount: fixtures.length,
    totalTurns: contractSummary.totalTurns,
    countsByTier: contractSummary.countsByTier,
    aggregateReport,
    replaySummary: summarizeComplexMultiturnReplayFixtures(fixtures) as unknown as ComplexMultiturnReplayAggregateSummary,
    contractSummary,
    fixtureSummaries: results.map(summaryForReplayResult),
  };
}

export async function writeComplexMultiturnBenchmarkExport(path: string, report: ComplexMultiturnBenchmarkExport): Promise<void> {
  assertComplexMultiturnBenchmarkExport(report);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function assertComplexMultiturnBenchmarkExport(report: ComplexMultiturnBenchmarkExport): void {
  const issues: string[] = [];
  if (report.schemaVersion !== COMPLEX_MULTITURN_BENCHMARK_EXPORT_SCHEMA_VERSION) issues.push('schemaVersion');
  if (report.fixtureCount !== report.fixtureSummaries.length) issues.push('fixtureCount');
  if (report.totalTurns <= 0) issues.push('totalTurns');
  if (report.aggregateReport.timeline.summary.turnCount !== report.totalTurns) issues.push('aggregate turnCount');
  if (report.aggregateReport.gateEvaluation?.passed !== true) issues.push('aggregate gates');
  if (report.replaySummary.missingRequiredEventFixtures.length !== 0) issues.push('missing required events');
  if (report.fixtureSummaries.some((fixture) => fixture.missingRequiredEvents.length > 0)) issues.push('fixture missing required events');
  if (report.fixtureSummaries.some((fixture) => !fixture.gatePassed)) issues.push('fixture gates');
  if (issues.length) throw new Error(`Invalid complex multiturn benchmark export: ${issues.join('; ')}`);
}

function summaryForReplayResult(result: ComplexMultiturnReplayResult): ComplexMultiturnBenchmarkFixtureSummary {
  const summary = result.report.timeline.summary;
  return {
    id: result.fixtureId,
    sourceTaskId: result.sourceTaskId,
    tier: result.tier,
    turnCount: result.turnCount,
    eventCount: summary.eventCount,
    failureCount: summary.failureCount,
    recoveryEventCount: summary.recoveryEventCount,
    qualityScore: summary.qualityScore,
    firstVisibleResponseMs: summary.firstVisibleResponseMs,
    verifyLatencyMs: summary.verify.latencyMs,
    blockingVerifyRate: summary.verify.blockingRate,
    backgroundVerifyFailureRecoveryRate: summary.verify.backgroundFailureRecoveryRate,
    gatePassed: result.report.gateEvaluation?.passed === true,
    missingRequiredEvents: result.coverage.missingRequiredEvents,
    metrics: result.metrics,
  };
}

function aggregateEventsForReplayResults(results: ComplexMultiturnReplayResult[]): ComplexDialogueTimelineEvent[] {
  let turnOffset = 0;
  let timeOffset = 0;
  const events: ComplexDialogueTimelineEvent[] = [];

  for (const result of results) {
    const resultEndMs = result.events.reduce(
      (max, event) => Math.max(max, event.timeMs + Math.max(0, event.durationMs ?? 0)),
      0,
    );
    for (const event of result.events) {
      events.push({
        ...event,
        id: `${result.fixtureId}:${event.id}`,
        timeMs: event.timeMs + timeOffset,
        turnIndex: event.turnIndex === undefined ? undefined : event.turnIndex + turnOffset,
        raw: {
          ...(event.raw ?? {}),
          fixtureId: result.fixtureId,
          sourceTaskId: result.sourceTaskId,
          originalTurnIndex: event.turnIndex,
        },
      });
    }
    turnOffset += result.turnCount;
    timeOffset += resultEndMs + 1000;
  }

  return events;
}

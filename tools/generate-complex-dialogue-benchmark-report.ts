import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  buildComplexDialogueBenchmarkReport,
  compareComplexDialogueBenchmarkReports,
  complexDialogueEventFromRuntimeEvent,
  evaluateComplexDialogueRegressionGuard,
  validateComplexDialogueBenchmarkReport,
  writeComplexDialogueBenchmarkReport,
  type ComplexDialogueBenchmarkReport,
  type ComplexDialoguePerformanceGates,
  type ComplexDialogueTimelineEvent,
} from '../src/runtime/gateway/complex-dialogue-metrics.js';
import type { WorkspaceRuntimeEvent } from '../src/runtime/runtime-types.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = resolve(String(args.out || '.sciforge/reports/complex-dialogue-benchmark-report.json'));
  if (args.baseline || args.optimized) {
    if (!args.baseline || !args.optimized) throw new Error('Both --baseline and --optimized are required for comparison mode.');
    const baseline = await readReport(String(args.baseline));
    const optimized = await readReport(String(args.optimized));
    const comparison = compareComplexDialogueBenchmarkReports(baseline, optimized);
    const guard = evaluateComplexDialogueRegressionGuard(comparison, {
      maxFirstVisibleSlowdownPercent: numberArg(args.maxFirstVisibleSlowdownPercent),
      maxTotalSlowdownPercent: numberArg(args.maxTotalSlowdownPercent),
      maxQualityScoreDrop: numberArg(args.maxQualityScoreDrop),
    });
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify({ comparison, guard }, null, 2)}\n`, 'utf8');
    printComparison(comparison, guard, outPath);
    if (!guard.passed && args.failOnRegression) process.exitCode = 1;
    return;
  }

  if (!args.events) throw new Error('Missing --events <json>. Use --baseline/--optimized for comparison mode.');
  const events = await readEvents(String(args.events));
  const report = buildComplexDialogueBenchmarkReport({
    benchmarkId: String(args.benchmarkId || 'complex-dialogue-benchmark'),
    variant: String(args.variant || 'candidate') as ComplexDialogueBenchmarkReport['variant'],
    events,
    gates: readGates(args),
    metadata: { sourceEvents: resolve(String(args.events)) },
  });
  await writeComplexDialogueBenchmarkReport(outPath, report);
  printReport(report, outPath);
  if (report.gateEvaluation?.passed === false && args.failOnGate) process.exitCode = 1;
}

async function readReport(path: string): Promise<ComplexDialogueBenchmarkReport> {
  const value = JSON.parse(await readFile(resolve(path), 'utf8')) as unknown;
  const validation = validateComplexDialogueBenchmarkReport(value);
  if (!validation.ok) throw new Error(`Invalid report ${path}: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  return value as ComplexDialogueBenchmarkReport;
}

async function readEvents(path: string): Promise<ComplexDialogueTimelineEvent[]> {
  const value = JSON.parse(await readFile(resolve(path), 'utf8')) as unknown;
  const rawEvents = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.events)
      ? value.events
      : isRecord(value) && isRecord(value.timeline) && Array.isArray(value.timeline.events)
        ? value.timeline.events
        : undefined;
  if (!rawEvents) throw new Error(`Event file ${path} must be an array, { events }, or { timeline: { events } }.`);
  const startedAtMs = firstTimestamp(rawEvents);
  return rawEvents.map((event, index) => {
    if (isComplexDialogueTimelineEvent(event)) return event;
    return complexDialogueEventFromRuntimeEvent(event as WorkspaceRuntimeEvent, index, { startedAtMs });
  });
}

function readGates(args: Record<string, unknown>): ComplexDialoguePerformanceGates | undefined {
  const gates: ComplexDialoguePerformanceGates = {
    maxFirstVisibleMs: numberArg(args.maxFirstVisibleMs),
    maxFirstBackendMs: numberArg(args.maxFirstBackendMs),
    maxTotalDurationMs: numberArg(args.maxTotalDurationMs),
    maxP95InterEventGapMs: numberArg(args.maxP95InterEventGapMs),
    maxRepeatedWorkCount: numberArg(args.maxRepeatedWorkCount),
    maxFailureCount: numberArg(args.maxFailureCount),
    minProgressEventCount: numberArg(args.minProgressEventCount),
    minRecoveryEventCount: numberArg(args.minRecoveryEventCount),
    minQualityScore: numberArg(args.minQualityScore),
  };
  return Object.values(gates).some((value) => value !== undefined) ? gates : undefined;
}

function parseArgs(argv: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index]!;
    if (!entry.startsWith('--')) continue;
    const key = entry.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function numberArg(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstTimestamp(events: unknown[]): number | undefined {
  for (const event of events) {
    if (!isRecord(event)) continue;
    const raw = isRecord(event.raw) ? event.raw : event;
    const timestamp = stringField(raw.timestamp) ?? stringField(raw.createdAt) ?? stringField(raw.startedAt);
    if (!timestamp) continue;
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isComplexDialogueTimelineEvent(value: unknown): value is ComplexDialogueTimelineEvent {
  return isRecord(value) && typeof value.id === 'string' && typeof value.type === 'string' && typeof value.category === 'string' && typeof value.timeMs === 'number';
}

function printReport(report: ComplexDialogueBenchmarkReport, outPath: string): void {
  const summary = report.timeline.summary;
  console.log(`Complex dialogue benchmark report: ${outPath}`);
  console.log(`  first visible: ${summary.firstVisibleResponseMs ?? 'n/a'} ms`);
  console.log(`  total duration: ${summary.totalDurationMs} ms`);
  console.log(`  quality score: ${summary.qualityScore}`);
  console.log(`  gates: ${report.gateEvaluation?.passed ?? 'not configured'}`);
}

function printComparison(comparison: ReturnType<typeof compareComplexDialogueBenchmarkReports>, guard: ReturnType<typeof evaluateComplexDialogueRegressionGuard>, outPath: string): void {
  console.log(`Complex dialogue comparison: ${outPath}`);
  console.log(`  first visible speedup: ${comparison.speedups.firstVisibleResponsePercent ?? 'n/a'}%`);
  console.log(`  total duration speedup: ${comparison.speedups.totalDurationPercent}%`);
  console.log(`  quality delta: ${comparison.deltas.qualityScore}`);
  console.log(`  regression guard: ${guard.passed ? 'passed' : 'failed'}`);
  for (const regression of guard.regressions) console.log(`  regression: ${regression}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

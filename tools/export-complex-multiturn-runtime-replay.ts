import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildComplexMultiturnRuntimeReplayReportFromBundle,
  readComplexMultiturnRuntimeReplayBundle,
  writeComplexMultiturnRuntimeReplayReport,
} from '../tests/harness/complexMultiturnRuntimeReplay';

interface CliOptions {
  events?: string;
  out?: string;
  generatedAt?: string;
  benchmarkId?: string;
  sourceKind?: 'workspace-runtime-events' | 'session-runtime-events';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (!options.events) throw new Error('Missing --events <json>');
  const bundle = await readComplexMultiturnRuntimeReplayBundle(options.events);
  const outPath = resolve(options.out ?? '.sciforge/reports/complex-multiturn-runtime-replay.json');
  const report = buildComplexMultiturnRuntimeReplayReportFromBundle({
    schemaVersion: bundle.bundleSchemaVersion,
    sessionId: bundle.sessionId,
    runtimeEvents: bundle.events,
  }, {
    generatedAt: options.generatedAt,
    benchmarkId: options.benchmarkId,
    sourceKind: options.sourceKind ?? bundle.sourceKind,
  });
  await writeComplexMultiturnRuntimeReplayReport(outPath, report);
  console.log(`[ok] wrote ${outPath}`);
  console.log(`[ok] runtimeEvents=${report.source.eventCount} timelineEvents=${report.benchmarkReport.timeline.summary.eventCount}`);
  console.log(`[ok] firstVisible=${report.coverage.firstVisibleResponseMs ?? 'n/a'}ms quality=${report.benchmarkReport.timeline.summary.qualityScore} gates=${report.benchmarkReport.gateEvaluation?.passed ?? 'not-configured'}`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--events') {
      options.events = readValue(args, index, arg);
      index += 1;
    } else if (arg === '--out') {
      options.out = readValue(args, index, arg);
      index += 1;
    } else if (arg === '--generated-at') {
      options.generatedAt = readValue(args, index, arg);
      index += 1;
    } else if (arg === '--benchmark-id') {
      options.benchmarkId = readValue(args, index, arg);
      index += 1;
    } else if (arg === '--source-kind') {
      options.sourceKind = readSourceKind(readValue(args, index, arg));
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function readSourceKind(value: string): CliOptions['sourceKind'] {
  if (value === 'workspace-runtime-events' || value === 'session-runtime-events') return value;
  throw new Error(`Unsupported --source-kind ${value}`);
}

function printHelp(): void {
  console.log(`Usage: tsx tools/export-complex-multiturn-runtime-replay.ts --events <json> [options]

Exports a complex multiturn replay report from real-shaped WorkspaceRuntimeEvent JSON.

Options:
  --events <path>              Runtime event JSON: array, { events }, { runtimeEvents }, or { session: { runtimeEvents } }.
  --out <path>                 Output path. Defaults to .sciforge/reports/complex-multiturn-runtime-replay.json.
  --generated-at <iso>         Stable timestamp override.
  --benchmark-id <id>          Benchmark id. Defaults to complex-multiturn-runtime-replay.
  --source-kind <kind>         workspace-runtime-events or session-runtime-events.
`);
}

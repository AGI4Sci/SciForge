import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { complexMultiTurnFixtures } from '../tests/fixtures/complex-multiturn/suite';
import {
  buildComplexMultiturnBenchmarkExport,
  writeComplexMultiturnBenchmarkExport,
} from '../tests/harness/complexMultiturnBenchmarkExport';

interface CliOptions {
  out?: string;
  tier?: 'five-turn' | 'ten-turn' | 'twenty-turn' | 'lifecycle';
  generatedAt?: string;
  benchmarkId?: string;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const outPath = resolve(options.out ?? '.sciforge/reports/complex-multiturn-benchmark-export.json');
  const fixtures = options.tier
    ? complexMultiTurnFixtures.filter((fixture) => fixture.tier === options.tier)
    : complexMultiTurnFixtures;
  const report = buildComplexMultiturnBenchmarkExport(fixtures, {
    generatedAt: options.generatedAt,
    benchmarkId: options.benchmarkId,
  });
  await writeComplexMultiturnBenchmarkExport(outPath, report);
  const summary = report.aggregateReport.timeline.summary;
  console.log(`[ok] wrote ${outPath}`);
  console.log(`[ok] fixtures=${report.fixtureCount} turns=${report.totalTurns} events=${summary.eventCount}`);
  console.log(`[ok] quality=${summary.qualityScore} gates=${report.aggregateReport.gateEvaluation?.passed ?? 'not-configured'}`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out') {
      options.out = readValue(args, index, arg);
      index += 1;
    } else if (arg === '--tier') {
      options.tier = readTier(readValue(args, index, arg));
      index += 1;
    } else if (arg === '--generated-at') {
      options.generatedAt = readValue(args, index, arg);
      index += 1;
    } else if (arg === '--benchmark-id') {
      options.benchmarkId = readValue(args, index, arg);
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

function readTier(value: string): CliOptions['tier'] {
  if (value === 'five-turn' || value === 'ten-turn' || value === 'twenty-turn' || value === 'lifecycle') return value;
  throw new Error(`Unsupported --tier ${value}`);
}

function printHelp(): void {
  console.log(`Usage: tsx tools/export-complex-multiturn-benchmark.ts [options]

Exports the M13/M14 complex multiturn fixture replay benchmark into a debug JSON artifact.

Options:
  --out <path>             Output JSON path. Defaults to .sciforge/reports/complex-multiturn-benchmark-export.json.
  --tier <tier>            Optional tier filter: five-turn, ten-turn, twenty-turn, lifecycle.
  --generated-at <iso>     Stable timestamp override for reproducible reports.
  --benchmark-id <id>      Aggregate benchmark id. Defaults to complex-multiturn-benchmark.
`);
}

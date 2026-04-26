import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { generateDeepTestReport } from './deep-test-manifest';

interface CliOptions {
  scenario?: string;
  rootDir?: string;
  outDir?: string;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const result = await generateDeepTestReport({
    rootDir: options.rootDir ? resolve(options.rootDir) : undefined,
    outDir: options.outDir ? resolve(options.outDir) : undefined,
    scenario: options.scenario,
  });

  const scope = options.scenario ? ` for ${options.scenario}` : '';
  console.log(`[ok] wrote ${result.markdownPath}${scope}`);
  console.log(`[ok] wrote ${result.htmlPath}${scope}`);
  console.log(`[ok] loaded ${result.manifests.length} deep manifest(s)`);

  if (result.hasValidationErrors) {
    for (const entry of result.manifests.filter((manifest) => manifest.issues.length > 0)) {
      console.error(`[schema] ${entry.path}`);
      for (const issue of entry.issues) console.error(`  - ${issue}`);
    }
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--scenario') {
      options.scenario = readValue(args, index, arg);
      index += 1;
    } else if (arg === '--root-dir') {
      options.rootDir = readValue(args, index, arg);
      index += 1;
    } else if (arg === '--out-dir') {
      options.outDir = readValue(args, index, arg);
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

function readValue(args: string[], index: number, name: string) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function printHelp() {
  console.log(`Usage: tsx tools/generate-deep-test-report.ts [--scenario <id>] [--root-dir <dir>] [--out-dir <dir>]

Reads docs/test-artifacts/deep-scenarios/**/manifest.json, validates the deep run manifest schema,
and writes:
  - docs/test-artifacts/deep-scenarios/deep-test-report.md
  - docs/test-artifacts/deep-scenarios/index.html
With --scenario, writes scenario-filtered deep-test-report.<id>.md and index.<id>.html.
`);
}

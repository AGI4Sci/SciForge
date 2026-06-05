#!/usr/bin/env node
import {
  auditModelRouterTraceBundle,
  type ModelRouterTraceAuditReport,
} from '../packages/workers/model-router/src/trace-audit.js';

type CliArgs = {
  traceRoot: string;
  outPath?: string;
  knownSecretEnv: string[];
  maxFileBytes?: number;
  requireNonEmpty: boolean;
  json: boolean;
};

try {
  const args = parseArgs(process.argv.slice(2));
  const knownSecretEnv = secretsFromEnv(args.knownSecretEnv);
  const report = await auditModelRouterTraceBundle({
    traceRoot: args.traceRoot,
    outPath: args.outPath,
    knownSecrets: knownSecretEnv.knownSecrets,
    missingKnownSecretEnvNames: knownSecretEnv.missingKnownSecretEnvNames,
    maxFileBytes: args.maxFileBytes,
    requireNonEmpty: args.requireNonEmpty,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(summaryText(report));
  }

  if (report.status !== 'pass') process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'model-router-trace-audit failed'}\n`);
  process.exitCode = 1;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: Partial<CliArgs> & { knownSecretEnv: string[] } = {
    knownSecretEnv: [],
    requireNonEmpty: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--trace-root') {
      parsed.traceRoot = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--out') {
      parsed.outPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--known-secret-env') {
      parsed.knownSecretEnv.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === '--max-file-bytes') {
      parsed.maxFileBytes = positiveIntegerValue(argv, index, arg);
      index += 1;
    } else if (arg === '--require-non-empty') {
      parsed.requireNonEmpty = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(helpText());
      process.exit(0);
    } else {
      throw new Error('Unknown model-router trace audit argument');
    }
  }
  if (!parsed.traceRoot) {
    throw new Error('--trace-root is required');
  }
  return parsed as CliArgs;
}

function secretsFromEnv(explicitNames: string[]) {
  const names = explicitNames.length > 0
    ? explicitNames
    : Object.keys(process.env).filter((name) => /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)/i.test(name));
  const knownSecrets: string[] = [];
  const missingKnownSecretEnvNames: string[] = [];
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && value.length >= 6) knownSecrets.push(value);
    else if (explicitNames.length > 0) missingKnownSecretEnvNames.push(name);
  }
  return { knownSecrets, missingKnownSecretEnvNames };
}

function requiredValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function positiveIntegerValue(argv: string[], index: number, flag: string) {
  const raw = requiredValue(argv, index, flag);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function summaryText(report: ModelRouterTraceAuditReport) {
  const lines = [
    `Model Router trace audit: ${report.status}`,
    `Scanned files: ${report.scannedFiles}`,
    `Findings: ${report.findings.length}`,
  ];
  for (const finding of report.findings.slice(0, 12)) {
    lines.push(`- ${finding.kind} ${finding.fileRef} ${finding.path} (${finding.digest.slice(0, 12)})`);
  }
  if (report.findings.length > 12) lines.push(`- ... ${report.findings.length - 12} more findings`);
  return `${lines.join('\n')}\n`;
}

function helpText() {
  return [
    'Usage: node --import tsx tools/model-router-trace-audit.ts --trace-root .sciforge/model-router-traces [--out report.json]',
    '',
    'Scans Model Router trace bundles for raw provider payloads, secrets, Authorization headers,',
    'inline image/base64 payloads, raw URLs, and local absolute paths. Findings contain only',
    'file refs, JSON paths, finding kinds, and hashes; matched secret values are not printed.',
    '',
    'Options:',
    '  --trace-root <dir>          Trace root or bundle directory to scan.',
    '  --out <file>               Write JSON audit report.',
    '  --known-secret-env <name>  Include a secret env var value in the exact-match scan.',
    '  --max-file-bytes <bytes>   Per-file scan budget; oversized files fail closed.',
    '  --require-non-empty        Fail if the trace root contains no auditable files.',
    '  --json                     Print full JSON report to stdout.',
  ].join('\n');
}

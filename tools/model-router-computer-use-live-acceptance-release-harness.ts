#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  buildModelRouterComputerUseLiveAcceptancePreflightManifest,
  type ModelRouterComputerUseLiveAcceptancePreflightManifest,
} from './model-router-computer-use-live-acceptance-preflight.js';
import type {
  ModelRouterComputerUseLiveAcceptanceMatrixManifest,
} from './model-router-computer-use-live-acceptance-matrix.js';

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RELEASE_HARNESS_SCHEMA_VERSION =
  'sciforge.model-router.computer-use.live-acceptance-release-harness.v1' as const;

export type ModelRouterComputerUseLiveAcceptanceReleaseHarnessOptions = {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  routerUrl?: string;
  matrixInputPath?: string;
  traceAuditReportPath?: string;
  expectedKnownSecretsChecked?: number;
  requestDisallowSharedSystemInput?: boolean;
  outPath?: string;
};

export type ModelRouterComputerUseLiveAcceptanceReleaseHarnessManifest = {
  schemaVersion: typeof MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RELEASE_HARNESS_SCHEMA_VERSION;
  checkedAt: string;
  status: 'completed' | 'blocked';
  releaseAcceptance: 'live-current-run' | 'not-evaluated';
  evidenceMode: 'release-harness-external-artifact-gate';
  stages: {
    preflight: {
      status: ModelRouterComputerUseLiveAcceptancePreflightManifest['status'];
      missingRequirements: string[];
      policyViolations: string[];
      valuePrinted: false;
    };
    matrix: {
      status: 'passed' | 'blocked' | 'not-run';
      releaseAcceptance: 'live-current-run' | 'not-evaluated';
      issueCount: number;
      issueRefs: string[];
      valuePrinted: false;
    };
  };
  outputs: {
    matrixInputRef?: string;
    traceAuditReportRef?: string;
    valuePrinted: false;
  };
  issues: string[];
  nextActions: Array<{
    label: string;
    command?: string;
    writesRepo: false;
  }>;
};

type CliArgs = {
  routerUrl?: string;
  matrixInputPath?: string;
  traceAuditReportPath?: string;
  expectedKnownSecretsChecked: number;
  requestDisallowSharedSystemInput: boolean;
  outPath?: string;
  strict: boolean;
  json: boolean;
};

const execFileAsync = promisify(execFile);
const forbiddenDiagnosticPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|Bearer|api[_-]?key|secret|token|credential|password|baseUrl|endpoint|requestBody|responseBody|https?:\/\/|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)|qwen3\.7-plus|deepseek-v4-flash|raw-private-model/i;

export async function runModelRouterComputerUseLiveAcceptanceReleaseHarness(
  options: ModelRouterComputerUseLiveAcceptanceReleaseHarnessOptions = {},
): Promise<ModelRouterComputerUseLiveAcceptanceReleaseHarnessManifest> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const matrixInputRef = options.matrixInputPath ? publicPathRef(options.matrixInputPath) : undefined;
  const traceAuditReportRef = options.traceAuditReportPath ? publicPathRef(options.traceAuditReportPath) : undefined;
  const preflight = await buildModelRouterComputerUseLiveAcceptancePreflightManifest({
    env: options.env,
    now: () => new Date(checkedAt),
    routerUrl: options.routerUrl,
    requestDisallowSharedSystemInput: options.requestDisallowSharedSystemInput === true,
  });

  if (preflight.status !== 'ready') {
    return writeOptionalManifest(options.outPath, {
      schemaVersion: MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RELEASE_HARNESS_SCHEMA_VERSION,
      checkedAt,
      status: 'blocked',
      releaseAcceptance: 'not-evaluated',
      evidenceMode: 'release-harness-external-artifact-gate',
      stages: {
        preflight: publicPreflightStage(preflight),
        matrix: notRunMatrixStage(),
      },
      outputs: {
        matrixInputRef,
        traceAuditReportRef,
        valuePrinted: false,
      },
      issues: ['preflight-blocked'],
      nextActions: nextActions(matrixInputRef, traceAuditReportRef),
    });
  }

  const matrix = await runMatrixCli({
    matrixInputPath: options.matrixInputPath,
    traceAuditReportPath: options.traceAuditReportPath,
    expectedKnownSecretsChecked: options.expectedKnownSecretsChecked ?? 2,
  });
  const matrixStage = matrixManifestToStage(matrix.manifest);
  const matrixPassed = matrix.exitCode === 0
    && matrix.manifest?.status === 'passed'
    && matrix.manifest.releaseAcceptance === 'live-current-run';
  const issues = [
    matrixPassed ? undefined : 'matrix-blocked',
    ...matrix.issues,
  ].filter((item): item is string => Boolean(item));

  return writeOptionalManifest(options.outPath, {
    schemaVersion: MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RELEASE_HARNESS_SCHEMA_VERSION,
    checkedAt,
    status: issues.length === 0 ? 'completed' : 'blocked',
    releaseAcceptance: issues.length === 0 ? 'live-current-run' : 'not-evaluated',
    evidenceMode: 'release-harness-external-artifact-gate',
    stages: {
      preflight: publicPreflightStage(preflight),
      matrix: matrixStage,
    },
    outputs: {
      matrixInputRef,
      traceAuditReportRef,
      valuePrinted: false,
    },
    issues: uniqueStrings(issues.map(safeIssueLabel)),
    nextActions: nextActions(matrixInputRef, traceAuditReportRef),
  });
}

export async function runModelRouterComputerUseLiveAcceptanceReleaseHarnessCli(argv = process.argv): Promise<void> {
  const args = parseArgs(argv.slice(2));
  const manifest = await runModelRouterComputerUseLiveAcceptanceReleaseHarness({
    routerUrl: args.routerUrl,
    matrixInputPath: args.matrixInputPath,
    traceAuditReportPath: args.traceAuditReportPath,
    expectedKnownSecretsChecked: args.expectedKnownSecretsChecked,
    requestDisallowSharedSystemInput: args.requestDisallowSharedSystemInput,
    outPath: args.outPath,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[${manifest.status}] Model Router Computer Use live acceptance release harness; releaseAcceptance=${manifest.releaseAcceptance}; issues=${manifest.issues.length}\n`,
    );
    for (const action of manifest.nextActions) {
      process.stdout.write(`  - ${action.label}${action.command ? ` (${action.command})` : ''}\n`);
    }
  }
  if (args.strict && manifest.status !== 'completed') process.exitCode = 1;
}

async function runMatrixCli(input: {
  matrixInputPath?: string;
  traceAuditReportPath?: string;
  expectedKnownSecretsChecked: number;
}) {
  if (!input.matrixInputPath || !input.traceAuditReportPath) {
    return {
      exitCode: 1,
      manifest: undefined,
      issues: ['missing-matrix-input-or-trace-audit-report'],
    };
  }
  try {
    const result = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/model-router-computer-use-live-acceptance-matrix.ts',
      '--input',
      input.matrixInputPath,
      '--trace-audit-report',
      input.traceAuditReportPath,
      '--expected-known-secrets-checked',
      String(input.expectedKnownSecretsChecked),
      '--strict',
      '--json',
    ], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    });
    return {
      exitCode: 0,
      manifest: parseMatrixManifest(String(result.stdout)),
      issues: [],
    };
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
    const manifest = parseMatrixManifest(stdout);
    return {
      exitCode: error && typeof error === 'object' && 'code' in error && typeof error.code === 'number'
        ? error.code
        : 1,
      manifest,
      issues: manifest ? [] : ['matrix-cli-output-unavailable'],
    };
  }
}

function parseMatrixManifest(stdout: string): ModelRouterComputerUseLiveAcceptanceMatrixManifest | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return isRecord(parsed) && parsed.schemaVersion === 'sciforge.model-router.computer-use-live-acceptance-matrix.v1'
      ? parsed as ModelRouterComputerUseLiveAcceptanceMatrixManifest
      : undefined;
  } catch {
    return undefined;
  }
}

function publicPreflightStage(preflight: ModelRouterComputerUseLiveAcceptancePreflightManifest): ModelRouterComputerUseLiveAcceptanceReleaseHarnessManifest['stages']['preflight'] {
  return {
    status: preflight.status,
    missingRequirements: preflight.missingRequirements.map(safeIssueLabel),
    policyViolations: preflight.policyViolations.map(safeIssueLabel),
    valuePrinted: false,
  };
}

function notRunMatrixStage(): ModelRouterComputerUseLiveAcceptanceReleaseHarnessManifest['stages']['matrix'] {
  return {
    status: 'not-run',
    releaseAcceptance: 'not-evaluated',
    issueCount: 0,
    issueRefs: [],
    valuePrinted: false,
  };
}

function matrixManifestToStage(
  manifest: ModelRouterComputerUseLiveAcceptanceMatrixManifest | undefined,
): ModelRouterComputerUseLiveAcceptanceReleaseHarnessManifest['stages']['matrix'] {
  if (!manifest) {
    return {
      status: 'blocked',
      releaseAcceptance: 'not-evaluated',
      issueCount: 1,
      issueRefs: [issueRef('matrix-manifest-missing')],
      valuePrinted: false,
    };
  }
  return {
    status: manifest.status,
    releaseAcceptance: manifest.releaseAcceptance,
    issueCount: manifest.issues.length,
    issueRefs: manifest.issues.map(issueRef),
    valuePrinted: false,
  };
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    expectedKnownSecretsChecked: 2,
    requestDisallowSharedSystemInput: false,
    strict: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--router-url') {
      parsed.routerUrl = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--matrix-input') {
      parsed.matrixInputPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--trace-audit-report') {
      parsed.traceAuditReportPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--expected-known-secrets-checked') {
      parsed.expectedKnownSecretsChecked = positiveIntegerValue(argv, index, arg);
      index += 1;
    } else if (arg === '--request-disallow-shared-system-input') {
      parsed.requestDisallowSharedSystemInput = true;
    } else if (arg === '--out') {
      parsed.outPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--strict') {
      parsed.strict = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(helpText());
      process.exit(0);
    } else {
      throw new Error('Unknown Model Router Computer Use live acceptance release harness argument');
    }
  }
  return parsed;
}

async function writeOptionalManifest<T extends ModelRouterComputerUseLiveAcceptanceReleaseHarnessManifest>(
  outPath: string | undefined,
  manifest: T,
): Promise<T> {
  if (outPath) {
    await mkdir(dirname(resolve(outPath)), { recursive: true });
    await writeFile(resolve(outPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return manifest;
}

function nextActions(matrixInputRef: string | undefined, traceAuditReportRef: string | undefined): ModelRouterComputerUseLiveAcceptanceReleaseHarnessManifest['nextActions'] {
  return [{
    label: 'Run or materialize the five current-run Computer Use cases, refresh trace audit, then rerun this release harness.',
    command: matrixInputRef && traceAuditReportRef
      ? `node --import tsx tools/model-router-computer-use-live-acceptance-release-harness.ts --matrix-input ${matrixInputRef} --trace-audit-report ${traceAuditReportRef} --expected-known-secrets-checked 2 --strict`
      : undefined,
    writesRepo: false,
  }];
}

function publicPathRef(path: string) {
  const absolute = resolve(path);
  const rel = relative(process.cwd(), absolute).split(sep).join('/');
  if (rel && !rel.startsWith('..') && !isAbsolute(rel) && /^(?:docs|artifacts|\.sciforge)\//u.test(rel)) return rel;
  return `path:${sha256Hex(absolute).slice(0, 16)}`;
}

function safeIssueLabel(value: string) {
  if (!value || forbiddenDiagnosticPattern.test(value)) return `issue:${sha256Hex(value).slice(0, 16)}`;
  return value.replace(/[^a-z0-9_.:-]/gi, '-').slice(0, 120) || `issue:${sha256Hex(value).slice(0, 16)}`;
}

function issueRef(value: string) {
  return `issue:${sha256Hex(value).slice(0, 16)}`;
}

function requiredValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function positiveIntegerValue(argv: string[], index: number, flag: string) {
  const raw = requiredValue(argv, index, flag);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} must be a positive integer`);
  return value;
}

function helpText() {
  return [
    'Usage: tsx tools/model-router-computer-use-live-acceptance-release-harness.ts --matrix-input input.json --trace-audit-report report.json [--router-url url] [--strict] [--json]',
    '',
    'Fail-closed release harness for the Computer Use live acceptance chain.',
    'It checks preflight readiness first, then requires the strict matrix gate to return live-current-run.',
  ].join('\n');
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

if (process.argv[1]?.endsWith('model-router-computer-use-live-acceptance-release-harness.ts')) {
  await runModelRouterComputerUseLiveAcceptanceReleaseHarnessCli(process.argv).catch((error) => {
    process.stderr.write(`${safeIssueLabel(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  });
}

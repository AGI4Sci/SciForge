import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_AGGREGATE_SCHEMA,
  COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES,
  aggregateComputerUseChatLiveComplexMatrixManifests,
  type ComputerUseChatLiveComplexMatrixAggregateCase,
  type ComputerUseChatLiveComplexMatrixAggregateManifest,
} from './computer-use-chat-live-complex-matrix.js';
import {
  runComputerUseChatLiveResourceDiagnostics,
  type ComputerUseChatLiveResourceDiagnostics,
} from './computer-use-chat-live-resource-diagnostics.js';

export const COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_RELEASE_REPORT_SCHEMA =
  'sciforge.computer-use.chat-live-complex-matrix.release-report.v1' as const;

export interface ComputerUseChatLiveComplexMatrixReleaseReportOptions {
  aggregateManifestPath?: string;
  aggregateFrom?: string[];
  monolithicManifestPath?: string;
  resourceManifestPaths?: string[];
  resourceNotePaths?: string[];
  resourceNoteJson?: string[];
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

export interface ComputerUseChatLiveComplexMatrixReleaseReport {
  schemaVersion: typeof COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_RELEASE_REPORT_SCHEMA;
  checkedAt: string;
  status: 'passed' | 'failed';
  releaseAcceptance: 'opt-in-only';
  evidenceMode: 'monolithic-diagnostic-plus-split-aggregate';
  monolithicStatus: DiagnosticManifestStatus;
  aggregateStatus: AggregateManifestStatus;
  caseCoverage: ReleaseCaseCoverage;
  resourceDiagnostics: ComputerUseChatLiveResourceDiagnostics;
  resourceSourceComparison: ReleaseResourceSourceComparison;
  residualStabilityNotes: string[];
  issues: string[];
}

export interface DiagnosticManifestStatus {
  manifestRef?: string;
  status: 'passed' | 'failed' | 'blocked' | 'missing' | 'invalid' | 'not-provided';
  checkedAt?: string;
  caseCount: number;
  passedCaseCount: number;
  issues: string[];
  diagnosticOnly: true;
}

export interface AggregateManifestStatus {
  manifestRef?: string;
  source: 'manifest' | 'aggregate-from' | 'missing' | 'invalid';
  status: 'passed' | 'failed' | 'missing' | 'invalid';
  checkedAt?: string;
  caseCount: number;
  passedCaseCount: number;
  missingCaseIds: string[];
  failedCaseIds: string[];
  issues: string[];
}

export interface ReleaseCaseCoverage {
  requiredCaseCount: number;
  coveredCaseCount: number;
  passedCaseCount: number;
  missingCaseIds: string[];
  failedCaseIds: string[];
  cases: ReleaseCaseCoverageItem[];
}

export interface ReleaseCaseCoverageItem {
  id: string;
  label: string;
  taskId: string;
  scenarioId: string;
  expectedStatus: string;
  status: 'passed' | 'failed' | 'blocked' | 'missing';
  sourceManifestRef?: string;
  evidenceKind?: string;
  requestSubmitted: boolean;
  liveAcceptanceCandidate: boolean;
  acceptanceRefs: ComputerUseChatLiveComplexMatrixAggregateCase['acceptanceRefs'];
  residualStabilityNotes: string[];
  issues: string[];
}

export interface ReleaseResourceSourceComparison {
  caseIsolationAndCleanup: {
    source: 'isolated-matrix-case-cleanup-manifest';
    isolationSourceRefs: string[];
    cleanupManifestRefs: string[];
    runDirRefs: string[];
    finalArtifactRefs: string[];
    guiReceiptRefs: string[];
    summary: string;
  };
  lifecycleAutoRead: {
    source: 'dev-service-lifecycle-auto-read';
    pidfileSources: string[];
    portOwnershipNoteSources: string[];
    cleanupNoteSources: string[];
    lsofPortOwnerSources: string[];
    envPortSources: string[];
    summary: string;
  };
  differences: string[];
}

interface ReleaseResourceInput {
  manifestRefs: string[];
  manifests: unknown[];
  processNotes: unknown[];
}

interface CliArgs {
  aggregate?: string;
  aggregateFrom: string[];
  monolithic?: string;
  resourceManifestPaths: string[];
  resourceNotePaths: string[];
  resourceNoteJson: string[];
  out?: string;
  strict: boolean;
  json: boolean;
}

export async function buildComputerUseChatLiveComplexMatrixReleaseReport(
  options: ComputerUseChatLiveComplexMatrixReleaseReportOptions,
): Promise<ComputerUseChatLiveComplexMatrixReleaseReport> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const monolithicStatus = await readDiagnosticManifestStatus(options.monolithicManifestPath);
  const aggregateResult = await readAggregateManifest(options, checkedAt);
  const caseCoverage = buildCaseCoverage(aggregateResult.manifest);
  const aggregateStatus = buildAggregateStatus(aggregateResult, caseCoverage);
  const resourceInput = await collectReleaseResourceInput({
    options,
    monolithicStatus,
    aggregateResult,
  });
  const resourceDiagnostics = await buildReleaseResourceDiagnostics(resourceInput, options, checkedAt);
  const resourceSourceComparison = buildResourceSourceComparison(resourceInput, resourceDiagnostics);
  const residualStabilityNotes = buildResidualStabilityNotes(monolithicStatus, caseCoverage);
  const issues = uniqueStrings([
    ...aggregateStatus.issues,
    ...caseCoverage.missingCaseIds.map((id) => `${id}:missing-from-aggregate`),
    ...caseCoverage.failedCaseIds.map((id) => `${id}:aggregate-case-not-passed`),
  ]);

  return sanitizeReleaseReport({
    schemaVersion: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_RELEASE_REPORT_SCHEMA,
    checkedAt,
    status: aggregateStatus.status === 'passed' && issues.length === 0 ? 'passed' : 'failed',
    releaseAcceptance: 'opt-in-only',
    evidenceMode: 'monolithic-diagnostic-plus-split-aggregate',
    monolithicStatus,
    aggregateStatus,
    caseCoverage,
    resourceDiagnostics,
    resourceSourceComparison,
    residualStabilityNotes,
    issues,
  });
}

export function releaseReportHasStrictFailures(report: ComputerUseChatLiveComplexMatrixReleaseReport): boolean {
  return (
    report.aggregateStatus.status !== 'passed'
    || report.caseCoverage.missingCaseIds.length > 0
    || report.caseCoverage.failedCaseIds.length > 0
  );
}

export async function runComputerUseChatLiveComplexMatrixReleaseReportCli(argv = process.argv): Promise<void> {
  const args = parseArgs(argv.slice(2));
  const report = await buildComputerUseChatLiveComplexMatrixReleaseReport({
    aggregateManifestPath: args.aggregate,
    aggregateFrom: args.aggregateFrom,
    monolithicManifestPath: args.monolithic,
    resourceManifestPaths: args.resourceManifestPaths,
    resourceNotePaths: args.resourceNotePaths,
    resourceNoteJson: args.resourceNoteJson,
  });
  const outputPath = args.out ? resolve(args.out) : undefined;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[${report.status}] Computer Use chat live complex matrix opt-in release report; `
      + `aggregate=${report.aggregateStatus.status}; `
      + `coverage=${report.caseCoverage.passedCaseCount}/${report.caseCoverage.requiredCaseCount}; `
      + `monolithic=${report.monolithicStatus.status}; `
      + `resources=${report.resourceDiagnostics.status}; issues=${report.issues.length}\n`,
    );
    if (outputPath) process.stdout.write(`  report: ${outputPath}\n`);
    for (const item of report.caseCoverage.cases) {
      process.stdout.write(`  - ${item.id}: ${item.status} evidence=${item.evidenceKind ?? 'missing'} source=${item.sourceManifestRef ?? 'missing'}\n`);
      for (const note of item.residualStabilityNotes) process.stdout.write(`    note: ${note}\n`);
      for (const issue of item.issues) process.stdout.write(`    issue: ${issue}\n`);
    }
  }

  if (args.strict && releaseReportHasStrictFailures(report)) process.exitCode = 1;
}

async function collectReleaseResourceInput(input: {
  options: ComputerUseChatLiveComplexMatrixReleaseReportOptions;
  monolithicStatus: DiagnosticManifestStatus;
  aggregateResult: Awaited<ReturnType<typeof readAggregateManifest>>;
}): Promise<ReleaseResourceInput> {
  const explicitManifests = await readJsonFiles(input.options.resourceManifestPaths ?? []);
  const sourceManifests = await readOptionalJsonFiles(uniqueStrings([
    input.options.monolithicManifestPath ?? '',
    input.options.aggregateManifestPath ?? '',
    ...(input.options.aggregateFrom ?? []),
  ]));
  const explicitNotes = [
    ...await readJsonFiles(input.options.resourceNotePaths ?? []),
    ...(input.options.resourceNoteJson ?? []).map((value) => JSON.parse(value) as unknown),
  ];
  const manifestRefs = uniqueStrings([
    input.options.monolithicManifestPath ?? '',
    input.options.aggregateManifestPath ?? '',
    ...(input.options.aggregateFrom ?? []),
    ...(input.options.resourceManifestPaths ?? []),
    input.monolithicStatus.manifestRef ?? '',
    input.aggregateResult.manifestRef ?? '',
    ...(input.aggregateResult.manifest?.sourceManifestRefs ?? []),
    ...(input.aggregateResult.manifest?.cases.flatMap((item) => [
      item.sourceManifestRef ?? '',
      item.acceptanceRefs.runDirRef ?? '',
      item.acceptanceRefs.acceptanceManifestRef ?? '',
      item.acceptanceRefs.completionEvidenceRef ?? '',
      ...item.acceptanceRefs.finalArtifactRefs,
      ...item.acceptanceRefs.guiPresentRefs,
    ]) ?? []),
  ]);
  return {
    manifestRefs,
    manifests: [
      input.aggregateResult.manifest,
      ...sourceManifests,
      ...explicitManifests,
    ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
    processNotes: explicitNotes,
  };
}

async function buildReleaseResourceDiagnostics(
  resourceInput: ReleaseResourceInput,
  options: ComputerUseChatLiveComplexMatrixReleaseReportOptions,
  checkedAt: string,
): Promise<ComputerUseChatLiveResourceDiagnostics> {
  return runComputerUseChatLiveResourceDiagnostics({
    env: options.env ?? process.env,
    manifestRefs: resourceInput.manifestRefs,
    manifests: resourceInput.manifests,
    processNotes: resourceInput.processNotes,
    now: () => new Date(checkedAt),
  });
}

function buildResourceSourceComparison(
  resourceInput: ReleaseResourceInput,
  diagnostics: ComputerUseChatLiveResourceDiagnostics,
): ReleaseResourceSourceComparison {
  const cleanupManifestRefs = uniqueStrings([
    ...collectStringFields(resourceInput.manifests, 'cleanupManifestRef'),
    ...resourceInput.manifestRefs.filter((ref) => /(?:^|\/)case-cleanup-manifest\.json$/i.test(ref)),
  ]);
  const isolationSourceRefs = uniqueStrings(collectCaseIsolationRefs(resourceInput.manifests));
  const runDirRefs = uniqueStrings([
    ...diagnostics.refs.runDirRefs,
    ...collectStringFields(resourceInput.manifests, 'runDirRef'),
    ...collectStringArrayFields(resourceInput.manifests, 'runDirRefs'),
  ]);
  const finalArtifactRefs = uniqueStrings([
    ...collectStringArrayFields(resourceInput.manifests, 'finalArtifactRefs'),
    ...collectStringArrayFields(resourceInput.manifests, 'artifactRefs'),
  ]);
  const guiReceiptRefs = uniqueStrings([
    ...collectStringArrayFields(resourceInput.manifests, 'guiReceiptRefs'),
    ...collectStringArrayFields(resourceInput.manifests, 'guiPresentRefs'),
    ...collectStringArrayFields(resourceInput.manifests, 'displayedRefs'),
  ]);
  const processSources = diagnostics.resources.processes.map((item) => item.source);
  const cleanupSources = diagnostics.resources.cleanup.map((item) => item.source);
  const portSources = diagnostics.resources.ports.map((item) => item.source);
  const lifecycleSources = uniqueStrings([...processSources, ...cleanupSources, ...portSources]);
  const pidfileSources = lifecycleSources.filter((source) => /(?:^|[-.])pid\.json$|pidfile/i.test(source));
  const lsofPortOwnerSources = lifecycleSources.filter((source) => /^port-ownership:\d+$/i.test(source));
  const portOwnershipNoteSources = lifecycleSources.filter((source) => (
    /port[-_.]?ownership|host[-_.]?ports/i.test(source) && !/^port-ownership:\d+$/i.test(source)
  ));
  const cleanupNoteSources = lifecycleSources.filter((source) => (
    /cleanup|stale/i.test(source) && !/(?:^|\/)case-cleanup-manifest\.json/i.test(source)
  ));
  const envPortSources = diagnostics.resources.ports
    .filter((item) => item.source === 'env')
    .map((item) => `${item.kind}:${item.port}`);

  return {
    caseIsolationAndCleanup: {
      source: 'isolated-matrix-case-cleanup-manifest',
      isolationSourceRefs,
      cleanupManifestRefs,
      runDirRefs,
      finalArtifactRefs,
      guiReceiptRefs,
      summary: [
        `${isolationSourceRefs.length} case isolation source(s)`,
        `${cleanupManifestRefs.length} case cleanup manifest ref(s)`,
        `${runDirRefs.length} run dir ref(s)`,
      ].join('; '),
    },
    lifecycleAutoRead: {
      source: 'dev-service-lifecycle-auto-read',
      pidfileSources,
      portOwnershipNoteSources,
      cleanupNoteSources,
      lsofPortOwnerSources,
      envPortSources,
      summary: [
        `${pidfileSources.length} pidfile source(s)`,
        `${portOwnershipNoteSources.length + lsofPortOwnerSources.length} port owner source(s)`,
        `${cleanupNoteSources.length} cleanup note source(s)`,
        `${envPortSources.length} env port source(s)`,
      ].join('; '),
    },
    differences: [
      'isolated matrix/case cleanup sources identify per-case session, turn, workspace seed, run-dir, final artifact, and GUI receipt evidence.',
      'lifecycle auto-read sources identify dev/service process lifecycle evidence from pidfiles, port ownership notes, cleanup notes, lsof listener owners, and configured port env.',
      'case cleanup manifests do not prove shared service port ownership; lifecycle pidfile/port-owner evidence does not prove a case produced final artifacts or GUI receipts.',
    ],
  };
}

async function readDiagnosticManifestStatus(path: string | undefined): Promise<DiagnosticManifestStatus> {
  if (!path) {
    return {
      status: 'not-provided',
      caseCount: 0,
      passedCaseCount: 0,
      issues: [],
      diagnosticOnly: true,
    };
  }
  try {
    const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
    return {
      manifestRef: path,
      status: parseDiagnosticStatus(manifest.status),
      checkedAt: typeof manifest.checkedAt === 'string' ? manifest.checkedAt : undefined,
      caseCount: cases.length,
      passedCaseCount: cases.filter((item) => isRecord(item) && item.status === 'passed').length,
      issues: stringArray(manifest.issues),
      diagnosticOnly: true,
    };
  } catch (error) {
    return {
      manifestRef: path,
      status: 'invalid',
      caseCount: 0,
      passedCaseCount: 0,
      issues: [`monolithic-manifest-read-failed:${errorMessage(error)}`],
      diagnosticOnly: true,
    };
  }
}

async function readAggregateManifest(
  options: ComputerUseChatLiveComplexMatrixReleaseReportOptions,
  checkedAt: string,
): Promise<{
  manifest?: ComputerUseChatLiveComplexMatrixAggregateManifest;
  manifestRef?: string;
  source: AggregateManifestStatus['source'];
  issues: string[];
}> {
  if (options.aggregateFrom?.length) {
    try {
      return {
        manifest: await aggregateComputerUseChatLiveComplexMatrixManifests(options.aggregateFrom, {
          now: () => new Date(checkedAt),
        }),
        source: 'aggregate-from',
        issues: [],
      };
    } catch (error) {
      return {
        source: 'invalid',
        issues: [`aggregate-from-read-failed:${errorMessage(error)}`],
      };
    }
  }

  if (!options.aggregateManifestPath) {
    return {
      source: 'missing',
      issues: ['aggregate-manifest-required'],
    };
  }

  try {
    const manifest = JSON.parse(await readFile(options.aggregateManifestPath, 'utf8')) as ComputerUseChatLiveComplexMatrixAggregateManifest;
    const schemaIssues = manifest.schemaVersion === COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_AGGREGATE_SCHEMA
      ? []
      : [`aggregate-schema-unexpected:${String((manifest as { schemaVersion?: unknown }).schemaVersion ?? 'missing')}`];
    return {
      manifest,
      manifestRef: options.aggregateManifestPath,
      source: schemaIssues.length ? 'invalid' : 'manifest',
      issues: schemaIssues,
    };
  } catch (error) {
    return {
      manifestRef: options.aggregateManifestPath,
      source: 'invalid',
      issues: [`aggregate-manifest-read-failed:${errorMessage(error)}`],
    };
  }
}

function buildAggregateStatus(
  aggregateResult: Awaited<ReturnType<typeof readAggregateManifest>>,
  caseCoverage: ReleaseCaseCoverage,
): AggregateManifestStatus {
  const manifestStatus = aggregateResult.manifest?.status;
  const status = aggregateResult.manifest
    ? (aggregateResult.source === 'invalid' ? 'invalid' : parseAggregateStatus(manifestStatus))
    : (aggregateResult.source === 'missing' ? 'missing' : 'invalid');
  const aggregateIssues = aggregateResult.manifest?.issues ?? [];
  return {
    manifestRef: aggregateResult.manifestRef,
    source: aggregateResult.source,
    status,
    checkedAt: aggregateResult.manifest?.checkedAt,
    caseCount: aggregateResult.manifest?.cases?.length ?? 0,
    passedCaseCount: caseCoverage.passedCaseCount,
    missingCaseIds: caseCoverage.missingCaseIds,
    failedCaseIds: caseCoverage.failedCaseIds,
    issues: uniqueStrings([
      ...aggregateResult.issues,
      ...aggregateIssues,
      ...(status === 'passed' ? [] : [`aggregate-status-${status}`]),
    ]),
  };
}

function buildCaseCoverage(
  aggregateManifest: ComputerUseChatLiveComplexMatrixAggregateManifest | undefined,
): ReleaseCaseCoverage {
  const byCase = new Map((aggregateManifest?.cases ?? []).map((item) => [item.id, item]));
  const cases: ReleaseCaseCoverageItem[] = COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.map((requiredCase) => {
    const item = byCase.get(requiredCase.id);
    if (!item) {
      return {
        id: requiredCase.id,
        label: requiredCase.label,
        taskId: requiredCase.taskId,
        scenarioId: requiredCase.scenarioId,
        expectedStatus: requiredCase.expectedStatus,
        status: 'missing',
        requestSubmitted: false,
        liveAcceptanceCandidate: false,
        acceptanceRefs: { finalArtifactRefs: [], guiPresentRefs: [] },
        residualStabilityNotes: ['No aggregate case entry was present for this required case.'],
        issues: ['missing-from-aggregate'],
      };
    }
    return {
      id: item.id,
      label: item.label,
      taskId: item.taskId,
      scenarioId: item.scenarioId,
      expectedStatus: item.expectedStatus,
      status: item.status,
      sourceManifestRef: item.sourceManifestRef,
      evidenceKind: item.evidenceKind,
      requestSubmitted: item.requestSubmitted,
      liveAcceptanceCandidate: item.liveAcceptanceCandidate,
      acceptanceRefs: item.acceptanceRefs,
      residualStabilityNotes: item.residualStabilityNotes,
      issues: item.issues,
    };
  });
  const missingCaseIds = cases.filter((item) => item.status === 'missing').map((item) => item.id);
  const failedCaseIds = cases.filter((item) => item.status !== 'passed' && item.status !== 'missing').map((item) => item.id);
  return {
    requiredCaseCount: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.length,
    coveredCaseCount: cases.length - missingCaseIds.length,
    passedCaseCount: cases.filter((item) => item.status === 'passed').length,
    missingCaseIds,
    failedCaseIds,
    cases,
  };
}

function buildResidualStabilityNotes(
  monolithicStatus: DiagnosticManifestStatus,
  caseCoverage: ReleaseCaseCoverage,
): string[] {
  return uniqueStrings([
    ...(monolithicStatus.status === 'not-provided'
      ? []
      : [`Monolithic diagnostic status is ${monolithicStatus.status}; release acceptance remains based on split aggregate coverage.`]),
    ...caseCoverage.cases.flatMap((item) => item.residualStabilityNotes.map((note) => `${item.id}: ${note}`)),
  ]);
}

function parseDiagnosticStatus(value: unknown): DiagnosticManifestStatus['status'] {
  if (value === 'passed' || value === 'failed' || value === 'blocked' || value === 'missing') return value;
  return 'invalid';
}

function parseAggregateStatus(value: unknown): AggregateManifestStatus['status'] {
  if (value === 'passed' || value === 'failed' || value === 'missing' || value === 'invalid') return value;
  return 'invalid';
}

function parseArgs(args: string[]): CliArgs {
  const parsed: CliArgs = {
    aggregateFrom: [],
    resourceManifestPaths: [],
    resourceNotePaths: [],
    resourceNoteJson: [],
    strict: false,
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--aggregate') parsed.aggregate = readArgValue(args, index += 1, arg);
    else if (arg === '--aggregate-from') parsed.aggregateFrom.push(readArgValue(args, index += 1, arg));
    else if (arg === '--monolithic') parsed.monolithic = readArgValue(args, index += 1, arg);
    else if (arg === '--resource-manifest') parsed.resourceManifestPaths.push(readArgValue(args, index += 1, arg));
    else if (arg === '--resource-note') parsed.resourceNotePaths.push(readArgValue(args, index += 1, arg));
    else if (arg === '--resource-note-json') parsed.resourceNoteJson.push(readArgValue(args, index += 1, arg));
    else if (arg === '--out') parsed.out = readArgValue(args, index += 1, arg);
    else if (arg === '--strict') parsed.strict = true;
    else if (arg === '--json') parsed.json = true;
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return parsed;
}

function readArgValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function readJsonFiles(paths: string[]): Promise<unknown[]> {
  const records: unknown[] = [];
  for (const path of paths) records.push(JSON.parse(await readFile(path, 'utf8')) as unknown);
  return records;
}

async function readOptionalJsonFiles(paths: string[]): Promise<unknown[]> {
  const records: unknown[] = [];
  for (const path of paths) {
    try {
      records.push(JSON.parse(await readFile(path, 'utf8')) as unknown);
    } catch {
      // Release report already records manifest read errors in aggregate/monolithic status.
    }
  }
  return records;
}

function collectStringFields(values: unknown[], key: string): string[] {
  const results: string[] = [];
  visitUnknown(values, (record) => {
    const value = record[key];
    if (typeof value === 'string') results.push(value);
  });
  return results;
}

function collectStringArrayFields(values: unknown[], key: string): string[] {
  const results: string[] = [];
  visitUnknown(values, (record) => {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'string') results.push(item);
    }
  });
  return results;
}

function collectCaseIsolationRefs(values: unknown[]): string[] {
  const results: string[] = [];
  visitUnknown(values, (record) => {
    if (record.schemaVersion !== 'sciforge.computer-use.chat-live-complex-matrix.case-isolation.v1') return;
    const caseRunId = typeof record.caseRunId === 'string' ? record.caseRunId : undefined;
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
    const currentTurnId = typeof record.currentTurnId === 'string' ? record.currentTurnId : undefined;
    results.push([
      'case-isolation',
      caseRunId ? `caseRunId=${caseRunId}` : '',
      sessionId ? `sessionId=${sessionId}` : '',
      currentTurnId ? `currentTurnId=${currentTurnId}` : '',
    ].filter(Boolean).join(':'));
  });
  return results;
}

function visitUnknown(value: unknown, visit: (record: Record<string, unknown>) => void) {
  const queue: unknown[] = [value];
  const seen = new Set<unknown>();
  while (queue.length) {
    const current = queue.shift();
    if (!isRecord(current) && !Array.isArray(current)) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    visit(current);
    queue.push(...Object.values(current));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function sanitizeReleaseReport<T>(report: T): T {
  return sanitizeUnknown(report) as T;
}

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeDiagnosticText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeUnknown(item)]));
  return value;
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, 'sk-[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)=([^,\s;]+)/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]');
}

if (process.argv[1]?.endsWith('computer-use-chat-live-complex-matrix-release-report.ts')) {
  await runComputerUseChatLiveComplexMatrixReleaseReportCli();
}

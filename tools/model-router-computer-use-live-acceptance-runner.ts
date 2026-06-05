#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  modelRouterComputerUseLiveAcceptanceCases,
} from './model-router-computer-use-live-acceptance-cases.js';
import {
  buildModelRouterComputerUseLiveAcceptanceMatrixManifest,
  type ModelRouterComputerUseLiveAcceptanceExecutorKind,
  type ModelRouterComputerUseLiveAcceptanceMatrixResult,
} from './model-router-computer-use-live-acceptance-matrix.js';

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RUNNER_SCHEMA_VERSION =
  'sciforge.model-router.computer-use.live-acceptance-runner.v1' as const;

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RUNNER_PLAN_SCHEMA_VERSION =
  'sciforge.model-router.computer-use.live-acceptance-runner-plan.v1' as const;

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RUNNER_DEFAULT_OUT_INPUT =
  'docs/test-artifacts/model-router-computer-use-live-matrix/input.json' as const;

type ExecFileResult = {
  stdout: string;
  stderr: string;
};

export interface ModelRouterComputerUseLiveAcceptanceRunnerPlan {
  schemaVersion: typeof MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RUNNER_PLAN_SCHEMA_VERSION;
  cases: Array<{
    caseId: string;
    command: string;
    args?: string[];
    timeoutMs?: number;
  }>;
}

export interface ModelRouterComputerUseLiveAcceptanceRunnerOptions {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  plan?: ModelRouterComputerUseLiveAcceptanceRunnerPlan;
  planPath?: string;
  outInputPath?: string;
  execFileImpl?: (command: string, args: string[], options: { timeout: number; maxBuffer: number; cwd: string }) => Promise<ExecFileResult>;
}

export interface ModelRouterComputerUseLiveAcceptanceRunnerManifest {
  schemaVersion: typeof MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RUNNER_SCHEMA_VERSION;
  checkedAt: string;
  status: 'completed' | 'blocked';
  releaseAcceptance: 'not-evaluated';
  evidenceMode: 'external-runner-structural-input-only';
  source: {
    kind: 'plan-file' | 'inline-plan' | 'missing-plan';
    ref?: string;
    valuePrinted: false;
  };
  caseRuns: Array<{
    caseId: string;
    status: 'collected' | 'blocked' | 'failed' | 'not-run';
    commandRef: string;
    resultRef?: string;
    issues: string[];
    issueRefs: string[];
    valuePrinted: false;
  }>;
  matrixPrecheck: {
    status: 'passed' | 'blocked';
    issues: string[];
    releaseAcceptance: 'not-evaluated';
  };
  outputs: {
    matrixInputRef: string;
    valuePrinted: false;
  };
  issues: string[];
  policyViolations: string[];
  nextActions: Array<{
    label: string;
    command?: string;
    writesRepo: false;
  }>;
}

type CliArgs = {
  planPath?: string;
  outInputPath?: string;
  strict: boolean;
  json: boolean;
};

const execFileAsync = promisify(execFile);
const requiredCaseIds = modelRouterComputerUseLiveAcceptanceCases.map((item) => item.id);
const requiredCaseIdSet: ReadonlySet<string> = new Set(requiredCaseIds);
const defaultTimeoutMs = 10 * 60 * 1000;
const childMaxBuffer = 1024 * 1024;
const forbiddenDiagnosticPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|api[_-]?key|secret|token|credential|password|https?:\/\/|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)/i;

export async function runModelRouterComputerUseLiveAcceptanceRunner(
  options: ModelRouterComputerUseLiveAcceptanceRunnerOptions = {},
): Promise<ModelRouterComputerUseLiveAcceptanceRunnerManifest> {
  const env = options.env ?? process.env;
  const sourcePlan = options.plan ?? await loadPlan(options.planPath);
  const source = sourceFor(options.plan, options.planPath, sourcePlan);
  const policyViolations = policyViolationsFor(env);
  const optIn = env.SCIFORGE_REQUIRE_MODEL_ROUTER_CU_LIVE_ACCEPTANCE === '1';
  const planIssues = planIssuesFor(sourcePlan);
  const outInputPath = options.outInputPath ?? MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RUNNER_DEFAULT_OUT_INPUT;
  const shouldExecute = optIn && policyViolations.length === 0 && planIssues.length === 0 && sourcePlan;
  const results: ModelRouterComputerUseLiveAcceptanceMatrixResult[] = [];
  const caseRuns: ModelRouterComputerUseLiveAcceptanceRunnerManifest['caseRuns'] = [];
  const execImpl = options.execFileImpl ?? defaultExecFileImpl;

  for (const caseId of requiredCaseIds) {
    const plannedCase = sourcePlan?.cases.find((item) => item.caseId === caseId);
    if (!plannedCase) {
    caseRuns.push(notRunCase(caseId, 'missing-case-plan'));
      continue;
    }
    const commandRef = commandDigestRef(plannedCase.command, plannedCase.args ?? []);
    if (!shouldExecute) {
      caseRuns.push({
        caseId,
        status: 'not-run',
        commandRef,
        issues: [],
        issueRefs: [],
        valuePrinted: false,
      });
      continue;
    }
    try {
      const child = await execImpl(plannedCase.command, plannedCase.args ?? [], {
        timeout: plannedCase.timeoutMs ?? defaultTimeoutMs,
        maxBuffer: childMaxBuffer,
        cwd: process.cwd(),
      });
      const parsed = parseChildResult(child.stdout);
      if (!parsed) {
        caseRuns.push({
          caseId,
          status: 'failed',
          commandRef,
          issues: [`case-result-parse-failed:${caseId}`],
          issueRefs: [issueRef(`parse:${child.stdout}:${child.stderr}`)],
          valuePrinted: false,
        });
        continue;
      }
      const caseIssues = resultIssuesFor(caseId, parsed);
      caseRuns.push({
        caseId,
        status: caseIssues.length === 0 ? 'collected' : 'blocked',
        commandRef,
        resultRef: `result:${sha256Hex(JSON.stringify(sanitizeResultForInput(parsed))).slice(0, 16)}`,
        issues: caseIssues.map(safeIssueLabel),
        issueRefs: caseIssues.map(issueRef),
        valuePrinted: false,
      });
      if (caseIssues.length === 0) results.push(sanitizeResultForInput(parsed));
    } catch (error) {
      caseRuns.push({
        caseId,
        status: 'failed',
        commandRef,
        issues: [`case-result-failed:${caseId}`],
        issueRefs: [issueRef(error instanceof Error ? error.message : String(error))],
        valuePrinted: false,
      });
    }
  }

  const matrixInput = {
    checkedAt: (options.now ?? (() => new Date()))().toISOString(),
    results,
  };
  if (results.length > 0) {
    await mkdir(dirname(resolve(outInputPath)), { recursive: true });
    await writeFile(resolve(outInputPath), `${JSON.stringify(matrixInput, null, 2)}\n`, 'utf8');
  }
  const matrix = buildModelRouterComputerUseLiveAcceptanceMatrixManifest(matrixInput);
  const matrixIssues = matrix.issues.map((issue) => safeIssueLabel(issue));
  const issues = [
    optIn ? undefined : 'missing-live-opt-in',
    ...policyViolations.map((issue) => `policy:${issue}`),
    ...planIssues,
    ...caseRuns.flatMap((item) => issueLabelsForCaseRun(item)),
    ...(matrix.status === 'passed' ? [] : ['matrix-precheck-blocked']),
  ].filter((item): item is string => Boolean(item));
  const status = issues.length === 0 ? 'completed' : 'blocked';
  return {
    schemaVersion: MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RUNNER_SCHEMA_VERSION,
    checkedAt: matrixInput.checkedAt,
    status,
    releaseAcceptance: 'not-evaluated',
    evidenceMode: 'external-runner-structural-input-only',
    source,
    caseRuns,
    matrixPrecheck: {
      status: matrix.status === 'passed' ? 'passed' : 'blocked',
      issues: matrixIssues,
      releaseAcceptance: 'not-evaluated',
    },
    outputs: {
      matrixInputRef: publicPathRef(outInputPath),
      valuePrinted: false,
    },
    issues: uniqueStrings(issues),
    policyViolations,
    nextActions: nextActions(outInputPath),
  };
}

export async function runModelRouterComputerUseLiveAcceptanceRunnerCli(argv = process.argv): Promise<void> {
  const args = parseArgs(argv.slice(2));
  const manifest = await runModelRouterComputerUseLiveAcceptanceRunner({
    planPath: args.planPath,
    outInputPath: args.outInputPath,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[${manifest.status}] Model Router Computer Use live acceptance runner; collected=${manifest.caseRuns.filter((item) => item.status === 'collected').length}/${manifest.caseRuns.length}; issues=${manifest.issues.length}\n`,
    );
    for (const action of manifest.nextActions) {
      process.stdout.write(`  - ${action.label}${action.command ? ` (${action.command})` : ''}\n`);
    }
  }
  if (args.strict && manifest.status !== 'completed') process.exitCode = 1;
}

function parseChildResult(stdout: string): ModelRouterComputerUseLiveAcceptanceMatrixResult | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const record = isRecord(parsed) && isRecord(parsed.result) ? parsed.result : parsed;
    if (!isRecord(record)) return undefined;
    const status = record.status === 'passed' || record.status === 'blocked' || record.status === 'not-evaluated'
      ? record.status
      : undefined;
    return {
      caseId: stringValue(record.caseId) ?? '',
      status: status ?? 'not-evaluated',
      publicModelAlias: stringValue(record.publicModelAlias),
      routerProfile: stringValue(record.routerProfile),
      routerTraceRefs: stringArray(record.routerTraceRefs),
      capabilityIds: stringArray(record.capabilityIds),
      executor: isRecord(record.executor) ? {
        kind: stringValue(record.executor.kind) as ModelRouterComputerUseLiveAcceptanceExecutorKind,
        currentRunRef: stringValue(record.executor.currentRunRef),
        executorRef: stringValue(record.executor.executorRef),
        appWindowRef: stringValue(record.executor.appWindowRef),
        sessionRef: stringValue(record.executor.sessionRef),
        nativeHostRef: stringValue(record.executor.nativeHostRef),
        refs: stringArray(record.executor.refs),
      } : undefined,
      evidenceRefs: isRecord(record.evidenceRefs) ? {
        screenshotRefs: stringArray(record.evidenceRefs.screenshotRefs),
        fileRefs: stringArray(record.evidenceRefs.fileRefs),
        artifactRefs: stringArray(record.evidenceRefs.artifactRefs),
        terminalRefs: stringArray(record.evidenceRefs.terminalRefs),
        verifierRefs: stringArray(record.evidenceRefs.verifierRefs),
        blockedRefs: stringArray(record.evidenceRefs.blockedRefs),
        repairRefs: stringArray(record.evidenceRefs.repairRefs),
      } : undefined,
      gui: isRecord(record.gui) ? {
        presentRef: stringValue(record.gui.presentRef),
        blockedRef: stringValue(record.gui.blockedRef),
        repairRef: stringValue(record.gui.repairRef),
      } : undefined,
      issues: stringArray(record.issues).map((issue) => `issue:${sha256Hex(issue).slice(0, 16)}`),
    };
  } catch {
    return undefined;
  }
}

function resultIssuesFor(caseId: string, result: ModelRouterComputerUseLiveAcceptanceMatrixResult) {
  const issues = [
    result.caseId === caseId ? undefined : `case-result-mismatch:${caseId}`,
    requiredCaseIdSet.has(result.caseId) ? undefined : `case-result-unknown:${caseId}`,
    hasForbiddenString(result) ? `case-result-forbidden-payload:${caseId}` : undefined,
  ].filter((item): item is string => Boolean(item));
  return issues;
}

function sanitizeResultForInput(result: ModelRouterComputerUseLiveAcceptanceMatrixResult): ModelRouterComputerUseLiveAcceptanceMatrixResult {
  return {
    ...result,
    publicModelAlias: safePublicValue(result.publicModelAlias),
    routerProfile: safePublicValue(result.routerProfile),
    routerTraceRefs: safePublicValues(result.routerTraceRefs),
    capabilityIds: safePublicValues(result.capabilityIds),
    executor: result.executor ? {
      kind: result.executor.kind,
      currentRunRef: safePublicValue(result.executor.currentRunRef),
      executorRef: safePublicValue(result.executor.executorRef),
      appWindowRef: safePublicValue(result.executor.appWindowRef),
      sessionRef: safePublicValue(result.executor.sessionRef),
      nativeHostRef: safePublicValue(result.executor.nativeHostRef),
      refs: safePublicValues(result.executor.refs),
    } : undefined,
    evidenceRefs: result.evidenceRefs ? {
      screenshotRefs: safePublicValues(result.evidenceRefs.screenshotRefs),
      fileRefs: safePublicValues(result.evidenceRefs.fileRefs),
      artifactRefs: safePublicValues(result.evidenceRefs.artifactRefs),
      terminalRefs: safePublicValues(result.evidenceRefs.terminalRefs),
      verifierRefs: safePublicValues(result.evidenceRefs.verifierRefs),
      blockedRefs: safePublicValues(result.evidenceRefs.blockedRefs),
      repairRefs: safePublicValues(result.evidenceRefs.repairRefs),
    } : undefined,
    gui: result.gui ? {
      presentRef: safePublicValue(result.gui.presentRef),
      blockedRef: safePublicValue(result.gui.blockedRef),
      repairRef: safePublicValue(result.gui.repairRef),
    } : undefined,
    issues: safePublicValues(result.issues),
  };
}

async function loadPlan(path: string | undefined): Promise<ModelRouterComputerUseLiveAcceptanceRunnerPlan | undefined> {
  if (!path) return undefined;
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.cases)) return undefined;
    return {
      schemaVersion: MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RUNNER_PLAN_SCHEMA_VERSION,
      cases: parsed.cases.map((item) => {
        const record = isRecord(item) ? item : {};
        return {
          caseId: stringValue(record.caseId) ?? '',
          command: stringValue(record.command) ?? '',
          args: stringArray(record.args),
          timeoutMs: typeof record.timeoutMs === 'number' ? record.timeoutMs : undefined,
        };
      }),
    };
  } catch {
    return undefined;
  }
}

function sourceFor(
  inlinePlan: ModelRouterComputerUseLiveAcceptanceRunnerPlan | undefined,
  planPath: string | undefined,
  loadedPlan: ModelRouterComputerUseLiveAcceptanceRunnerPlan | undefined,
): ModelRouterComputerUseLiveAcceptanceRunnerManifest['source'] {
  if (inlinePlan) return { kind: 'inline-plan', valuePrinted: false };
  if (planPath) return { kind: 'plan-file', ref: loadedPlan ? publicPathRef(planPath) : `plan-file:${sha256Hex(resolve(planPath)).slice(0, 16)}`, valuePrinted: false };
  return { kind: 'missing-plan', valuePrinted: false };
}

function planIssuesFor(plan: ModelRouterComputerUseLiveAcceptanceRunnerPlan | undefined) {
  if (!plan) return ['missing-runner-plan'];
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const caseId of requiredCaseIds) {
    const matches = plan.cases.filter((item) => item.caseId === caseId);
    if (matches.length === 0) issues.push(`missing-case-plan:${caseId}`);
    if (matches.length > 1) issues.push(`duplicate-case-plan:${caseId}`);
  }
  for (const item of plan.cases) {
    if (!requiredCaseIdSet.has(item.caseId)) issues.push(`unknown-case-plan:${safeIssueLabel(item.caseId)}`);
    if (seen.has(item.caseId)) continue;
    seen.add(item.caseId);
    if (!item.command.trim()) issues.push(`missing-command:${safeIssueLabel(item.caseId)}`);
  }
  return uniqueStrings(issues);
}

function policyViolationsFor(env: Record<string, string | undefined>) {
  return [
    truthy(env.SCIFORGE_CU_LIVE_USE_FIXTURES) ? 'fixture-mode-cannot-satisfy-live-acceptance' : undefined,
    truthy(env.SCIFORGE_VISION_TEST_ACTION_FIXTURES) ? 'test-action-fixtures-cannot-satisfy-live-acceptance' : undefined,
    truthy(env.SCIFORGE_CU_LIVE_DRY_RUN) ? 'dry-run-cannot-satisfy-live-acceptance' : undefined,
    truthy(env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN) ? 'desktop-bridge-dry-run-cannot-satisfy-live-acceptance' : undefined,
    truthy(env.SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT) ? 'shared-system-input-cannot-satisfy-live-acceptance' : undefined,
  ].filter((item): item is string => Boolean(item));
}

function issueLabelsForCaseRun(item: ModelRouterComputerUseLiveAcceptanceRunnerManifest['caseRuns'][number]) {
  if (item.issues.length > 0) return item.issues;
  if (item.status === 'collected') return [];
  if (item.status === 'failed') return [`case-result-failed:${item.caseId}`];
  if (item.status === 'blocked') return [`case-result-blocked:${item.caseId}`];
  if (item.status === 'not-run') return [`case-not-run:${item.caseId}`];
  return [];
}

function notRunCase(caseId: string, issue: string): ModelRouterComputerUseLiveAcceptanceRunnerManifest['caseRuns'][number] {
  return {
    caseId,
    status: 'not-run',
    commandRef: 'command:missing',
    issues: [safeIssueLabel(issue)],
    issueRefs: [issueRef(issue)],
    valuePrinted: false,
  };
}

function nextActions(inputRef: string): ModelRouterComputerUseLiveAcceptanceRunnerManifest['nextActions'] {
  const matrixInputRef = publicPathRef(inputRef);
  return [{
    label: 'Validate collected refs-first results with the matrix gate and a fresh external trace audit report.',
    command: `node --import tsx tools/model-router-computer-use-live-acceptance-matrix.ts --input ${matrixInputRef} --trace-audit-report docs/test-artifacts/model-router-live-trace-audit/report.json --expected-known-secrets-checked 2 --strict`,
    writesRepo: false,
  }];
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { strict: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') {
      parsed.planPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--out-input') {
      parsed.outInputPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--strict') {
      parsed.strict = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(helpText());
      process.exit(0);
    } else {
      throw new Error('Unknown Model Router Computer Use live acceptance runner argument');
    }
  }
  return parsed;
}

function requiredValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function helpText() {
  return [
    'Usage: tsx tools/model-router-computer-use-live-acceptance-runner.ts --plan plan.json [--out-input input.json] [--strict] [--json]',
    '',
    'Runs the external five-case Computer Use live acceptance plan and writes refs-first matrix input.',
    'This runner never grants release acceptance; it must be followed by trace audit and matrix gate validation.',
    `Default matrix input convention: ${MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_RUNNER_DEFAULT_OUT_INPUT}`,
  ].join('\n');
}

async function defaultExecFileImpl(command: string, args: string[], options: { timeout: number; maxBuffer: number; cwd: string }): Promise<ExecFileResult> {
  const result = await execFileAsync(command, args, options);
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

function commandDigestRef(command: string, args: string[]) {
  return `command:${sha256Hex(JSON.stringify([command, ...args])).slice(0, 16)}`;
}

function publicPathRef(path: string) {
  const absolute = resolve(path);
  const rel = relative(process.cwd(), absolute).split(sep).join('/');
  if (rel && !rel.startsWith('..') && !isAbsolute(rel) && /^(?:docs|artifacts|\.sciforge)\//u.test(rel)) return rel;
  return `path:${sha256Hex(absolute).slice(0, 16)}`;
}

function safeIssueLabel(value: string) {
  if (!value || forbiddenDiagnosticPattern.test(value)) return `issue:${sha256Hex(value).slice(0, 16)}`;
  return value.replace(/[^a-z0-9_.:-]/gi, '-').slice(0, 96) || `issue:${sha256Hex(value).slice(0, 16)}`;
}

function safePublicValues(values: string[] | undefined) {
  return (values ?? []).map(safePublicValue).filter((value): value is string => Boolean(value));
}

function safePublicValue(value: string | undefined) {
  if (!value || forbiddenDiagnosticPattern.test(value)) return undefined;
  return value;
}

function hasForbiddenString(value: unknown): boolean {
  if (typeof value === 'string') return forbiddenDiagnosticPattern.test(value);
  if (Array.isArray(value)) return value.some(hasForbiddenString);
  if (isRecord(value)) return Object.values(value).some(hasForbiddenString);
  return false;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function issueRef(value: string) {
  return `issue:${sha256Hex(value).slice(0, 16)}`;
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function truthy(value: string | undefined) {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? '');
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

if (process.argv[1]?.endsWith('model-router-computer-use-live-acceptance-runner.ts')) {
  await runModelRouterComputerUseLiveAcceptanceRunnerCli(process.argv).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

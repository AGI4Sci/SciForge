import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type ComputerUseLongScenarioRunResult,
  type PreparedComputerUseLongRun,
  preflightComputerUseLong,
  prepareComputerUseLongRun,
  runComputerUseLongMatrix,
  runComputerUseLongScenario,
  validateComputerUseLongRun,
} from './computer-use-long-task-pool/internal.js';
import {
  getCuNextTaskMapping,
  isCuNextTaskId,
  loadValidatedCuNextTaskMap,
  scenarioIdsForCuNextTask,
  type CuNextTaskMapping,
  type CuNextTaskId,
} from './computer-use-next/task-map.js';
import {
  buildCuNextReadinessManifest,
  writeCuNextReadinessManifest,
} from './cu-next-readiness-manifest.js';
import { runCuL3IndependentInputAcceptanceHarness } from './cu-l3-independent-input-acceptance-harness.js';

type CuNextCommand =
  | 'list'
  | 'preflight'
  | 'prepare'
  | 'run-scenario'
  | 'run-matrix'
  | 'validate-run'
  | 'readiness';

interface CuNextRunCliArgs {
  command: CuNextCommand;
  taskId?: CuNextTaskId;
  allScenarios?: boolean;
  outRoot?: string;
  out?: string;
  runId?: string;
  workspacePath?: string;
  appUrl?: string;
  backend?: string;
  operator?: string;
  dryRun?: boolean;
  maxSteps?: number;
  rounds?: number;
  actionsJson?: string;
  manifestPath?: string;
  targetAppName?: string;
  targetTitle?: string;
  targetMode?: 'active-window' | 'app-window' | 'window-id' | 'display';
  projectPath?: string;
  runtimeBrowserManifestPath?: string;
  searchDirs?: string[];
  userAcceptanceManifestPaths?: string[];
  kvGroundSmokePaths?: string[];
  taskMapPath?: string;
}

interface CuNextAcceptanceProjection {
  status: 'projected' | 'skipped' | 'failed';
  reason?: string;
  manifestStatus?: string;
  paths?: {
    verifier: string;
    input: string;
    manifest: string;
  };
}

export async function runCuNextCli(argv = process.argv): Promise<void> {
  const args = parseCuNextRunArgs(argv.slice(2));
  await hydrateCuNextRuntimeEnvFromLocalConfig(args.workspacePath);
  const map = await loadValidatedCuNextTaskMap(args.taskMapPath);

  if (args.command === 'list') {
    for (const task of [...map.tasks].sort((a, b) => a.priority - b.priority)) {
      process.stdout.write(`${task.taskId} -> ${task.primaryScenarioId} (${task.longScenarioIds.join(', ')}) ${task.slug}\n`);
    }
    return;
  }

  if (args.command === 'readiness') {
    const manifest = await buildCuNextReadinessManifest({
      projectPath: args.projectPath,
      runtimeBrowserManifestPath: args.runtimeBrowserManifestPath,
      searchDirs: args.searchDirs,
      userAcceptanceManifestPaths: args.userAcceptanceManifestPaths,
      kvGroundSmokePaths: args.kvGroundSmokePaths,
      taskMapPath: args.taskMapPath,
    });
    if (args.out) await writeCuNextReadinessManifest(args.out, manifest);
    process.stdout.write(`[${manifest.status}] CU-NEXT readiness ${manifest.tasks.filter((task) => task.status === 'passed').length}/${manifest.tasks.length} passed; completionEligible=${manifest.completionEligible}\n`);
    if (args.out) process.stdout.write(`  manifest: ${args.out}\n`);
    return;
  }

  const taskId = requireTask(args);
  const mapping = getCuNextTaskMapping(map, taskId);
  const scenarioIds = scenarioIdsForCuNextTask(mapping, args.allScenarios ? 'all' : 'primary');

  if (args.command === 'validate-run') {
    if (!args.manifestPath) throw new Error('validate-run requires --manifest <manifest.json>');
    const validation = await validateComputerUseLongRun({
      manifestPath: args.manifestPath,
      requirePassed: true,
    });
    const issues = [...validation.issues];
    if (!scenarioIds.includes(validation.scenarioId)) {
      issues.push(`${validation.scenarioId} is not mapped to ${taskId}; expected ${scenarioIds.join(', ')}.`);
    }
    const acceptanceValidation = await validateProjectedCuNextAcceptance({
      taskId,
      manifestPath: args.manifestPath,
      longRunPassed: validation.ok,
    });
    issues.push(...acceptanceValidation.issues);
    const ok = validation.ok && issues.length === 0;
    process.stdout.write(`[${ok ? 'ok' : 'repair-needed'}] validate-run ${taskId} -> ${validation.scenarioId}\n`);
    for (const issue of issues) process.stdout.write(`  - ${issue}\n`);
    return;
  }

  if (args.command === 'preflight') {
    const result = await preflightComputerUseLong({
      scenarioIds,
      workspacePath: args.workspacePath,
      dryRun: args.dryRun,
      actionsJson: args.actionsJson,
      out: args.out,
    });
    process.stdout.write(`[${result.ok ? 'ok' : 'repair-needed'}] ${taskId} preflight -> ${scenarioIds.join(', ')}\n`);
    if (args.out) process.stdout.write(`  report: ${args.out}\n`);
    for (const check of result.checks.filter((check) => check.status !== 'pass')) {
      process.stdout.write(`  - [${check.status}] ${check.id}: ${check.message}\n`);
      if (check.repairAction) process.stdout.write(`    repair: ${check.repairAction}\n`);
    }
    return;
  }

  if (args.command === 'prepare') {
    const prepared = await prepareComputerUseLongRun({
      scenarioId: mapping.primaryScenarioId,
      outRoot: args.outRoot,
      runId: args.runId,
      workspacePath: args.workspacePath,
      appUrl: args.appUrl,
      backend: args.backend,
      operator: args.operator,
    });
      await bindPreparedRunToCuNextTask(prepared.manifestPath, mapping);
    process.stdout.write(`[ok] prepared ${taskId} via ${prepared.scenario.id}\n`);
    process.stdout.write(`  manifest: ${prepared.manifestPath}\n`);
    process.stdout.write(`  checklist: ${prepared.checklistPath}\n`);
    process.stdout.write(`  evidence: ${prepared.evidenceDir}\n`);
    return;
  }

  if (args.command === 'run-scenario') {
    const prepared = await prepareComputerUseLongRun({
      scenarioId: mapping.primaryScenarioId,
      outRoot: args.outRoot,
      runId: args.runId,
      workspacePath: args.workspacePath,
      appUrl: args.appUrl,
      backend: args.backend,
      operator: args.operator,
    });
      await bindPreparedRunToCuNextTask(prepared.manifestPath, mapping);
    const result = await runComputerUseLongScenario({
      manifestPath: prepared.manifestPath,
      rounds: args.rounds,
      dryRun: args.dryRun,
      maxSteps: args.maxSteps ?? mapping.recommendedMaxSteps,
      actionsJson: args.actionsJson,
      targetAppName: args.targetAppName ?? mapping.recommendedTargetApp,
      targetTitle: args.targetTitle,
      targetMode: args.targetMode ?? mapping.recommendedTargetMode,
    });
    const acceptance = await projectCuNextAcceptanceForScenarioRun({
      taskId,
      result,
      dryRun: args.dryRun === true,
    });
    const diagnosticPath = await writeCuNextDiagnosticSummaryIfNeeded({
      taskId,
      result,
      dryRun: args.dryRun === true,
      acceptance,
    });
    process.stdout.write(`[${result.status}] ran ${taskId} via ${result.scenarioId}\n`);
    process.stdout.write(`  manifest: ${result.manifestPath}\n`);
    process.stdout.write(`  summary: ${result.summaryPath}\n`);
    if (acceptance.status === 'projected' && acceptance.paths) {
      process.stdout.write(`  acceptance: ${acceptance.paths.manifest} (${acceptance.manifestStatus})\n`);
      process.stdout.write(`  verifier: ${acceptance.paths.verifier}\n`);
    } else if (acceptance.reason) {
      process.stdout.write(`  acceptance: ${acceptance.status} (${acceptance.reason})\n`);
    }
    if (diagnosticPath) process.stdout.write(`  diagnostic: ${diagnosticPath}\n`);
    return;
  }

  if (args.command === 'run-matrix') {
    const result = await runComputerUseLongMatrix({
      scenarioIds,
      outRoot: args.outRoot,
      workspacePath: args.workspacePath,
      appUrl: args.appUrl,
      backend: args.backend,
      operator: args.operator,
      dryRun: args.dryRun,
      skipPreflight: false,
      maxSteps: args.maxSteps ?? mapping.recommendedMaxSteps,
      actionsJson: args.actionsJson,
      targetAppName: args.targetAppName ?? mapping.recommendedTargetApp,
      targetTitle: args.targetTitle,
      targetMode: args.targetMode ?? mapping.recommendedTargetMode,
    });
    process.stdout.write(`[${result.status}] ran ${taskId} matrix -> ${scenarioIds.join(', ')}\n`);
    process.stdout.write(`  summary: ${result.summaryPath}\n`);
    return;
  }
}

async function bindPreparedRunToCuNextTask(manifestPath: string, mapping: CuNextTaskMapping): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  manifest.cuNextTaskId = mapping.taskId;
  manifest.cuNextTask = {
    taskId: mapping.taskId,
    title: mapping.title,
    slug: mapping.slug,
    primaryScenarioId: mapping.primaryScenarioId,
    longScenarioIds: mapping.longScenarioIds,
    requirements: mapping.requirements,
    recommendedTargetMode: mapping.recommendedTargetMode,
    recommendedTargetApp: mapping.recommendedTargetApp,
    recommendedMaxSteps: mapping.recommendedMaxSteps,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export async function projectCuNextAcceptanceForScenarioRun(options: {
  taskId: CuNextTaskId;
  result: ComputerUseLongScenarioRunResult;
  dryRun: boolean;
}): Promise<CuNextAcceptanceProjection> {
  if (options.dryRun) {
    return {
      status: 'skipped',
      reason: 'dry-run diagnostics are not projected into cu-user-acceptance-manifest.json',
    };
  }
  if (options.result.status !== 'passed') {
    return {
      status: 'skipped',
      reason: `scenario status is ${options.result.status}, not passed`,
    };
  }

  const manifest = JSON.parse(await readFile(options.result.manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  const traceRef = [...manifest.rounds].reverse().find((round) => (
    round.status === 'passed' && typeof round.visionTraceRef === 'string' && round.visionTraceRef.trim().length > 0
  ))?.visionTraceRef;
  if (!traceRef) {
    return {
      status: 'failed',
      reason: 'passed CU-LONG run has no passed round visionTraceRef to project',
    };
  }

  const tracePath = resolve(dirname(options.result.manifestPath), traceRef);
  try {
    const projection = await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      taskId: options.taskId,
      outDir: dirname(tracePath),
    });
    return {
      status: 'projected',
      manifestStatus: projection.manifest.status,
      paths: projection.paths,
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function validateProjectedCuNextAcceptance(options: {
  taskId: CuNextTaskId;
  manifestPath: string;
  longRunPassed: boolean;
}): Promise<{ issues: string[] }> {
  if (!options.longRunPassed) return { issues: [] };
  const longManifestPath = resolve(options.manifestPath);
  const longManifest = JSON.parse(await readFile(longManifestPath, 'utf8')) as PreparedComputerUseLongRun;
  const traceRef = [...longManifest.rounds].reverse().find((round) => (
    round.status === 'passed' && typeof round.visionTraceRef === 'string' && round.visionTraceRef.trim().length > 0
  ))?.visionTraceRef;
  const acceptancePath = traceRef
    ? join(dirname(resolve(dirname(longManifestPath), traceRef)), 'cu-user-acceptance-manifest.json')
    : join(dirname(longManifestPath), 'cu-user-acceptance-manifest.json');
  try {
    const manifest = JSON.parse(await readFile(acceptancePath, 'utf8')) as Record<string, unknown>;
    const issues: string[] = [];
    if (manifest.schemaVersion !== 'sciforge.computer-use.user-acceptance-manifest.v1') {
      issues.push(`${acceptancePath} is not a CU user acceptance manifest.`);
    }
    if (manifest.taskId !== options.taskId) {
      issues.push(`${acceptancePath} taskId must be ${options.taskId}, got ${String(manifest.taskId ?? 'missing')}.`);
    }
    if (manifest.level !== 'L3') issues.push(`${acceptancePath} level must be L3.`);
    if (manifest.status !== 'multi-app-workflow-passed') {
      issues.push(`${acceptancePath} status must be multi-app-workflow-passed for CU-NEXT readiness.`);
    }
    return { issues };
  } catch {
    return {
      issues: [`cu-user-acceptance-manifest.json is missing for passed ${options.taskId} run; run computer-use-next:run-scenario to project L3 evidence.`],
    };
  }
}

async function writeCuNextDiagnosticSummaryIfNeeded(options: {
  taskId: CuNextTaskId;
  result: ComputerUseLongScenarioRunResult;
  dryRun: boolean;
  acceptance: CuNextAcceptanceProjection;
}): Promise<string | undefined> {
  const acceptancePassed = options.acceptance.status === 'projected'
    && options.acceptance.manifestStatus === 'multi-app-workflow-passed';
  if (!options.dryRun && options.result.status === 'passed' && acceptancePassed) return undefined;

  const diagnosticPath = join(dirname(options.result.manifestPath), 'cu-next-diagnostic-summary.json');
  await mkdir(dirname(diagnosticPath), { recursive: true });
  const baseTaskId = await readManifestTaskId(options.result.manifestPath);
  const reasons = [
    options.dryRun ? 'dry-run diagnostics are never readiness evidence' : undefined,
    options.result.status !== 'passed' ? `scenario status is ${options.result.status}` : undefined,
    !acceptancePassed ? `acceptance projection is ${options.acceptance.status}${options.acceptance.manifestStatus ? `/${options.acceptance.manifestStatus}` : ''}` : undefined,
    options.acceptance.reason,
  ].filter((reason): reason is string => Boolean(reason));
  const summary = {
    schemaVersion: 'sciforge.computer-use.cu-next-diagnostic-summary.v1',
    createdAt: new Date().toISOString(),
    cuNextTaskId: options.taskId,
    baseTaskId,
    scenarioId: options.result.scenarioId,
    diagnosticOnly: true,
    acceptanceEligible: false,
    readinessEligible: false,
    dryRun: options.dryRun,
    manifestPath: options.result.manifestPath,
    scenarioSummaryPath: options.result.summaryPath,
    runStatus: options.result.status,
    attemptedRounds: options.result.attemptedRounds,
    passedRounds: options.result.passedRounds,
    repairNeededRound: options.result.repairNeededRound,
    acceptanceProjection: options.acceptance,
    diagnosis: reasons,
  };
  await writeFile(diagnosticPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return diagnosticPath;
}

async function readManifestTaskId(manifestPath: string) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<PreparedComputerUseLongRun>;
    return typeof manifest.taskId === 'string' && manifest.taskId.trim() ? manifest.taskId : undefined;
  } catch {
    return undefined;
  }
}

export function parseCuNextRunArgs(args: string[]): CuNextRunCliArgs {
  const command = args[0] as CuNextCommand | undefined;
  if (!command || !['list', 'preflight', 'prepare', 'run-scenario', 'run-matrix', 'validate-run', 'readiness'].includes(command)) {
    throw new Error('Usage: tsx tools/cu-next-run.ts <list|preflight|prepare|run-scenario|run-matrix|validate-run|readiness> [options]');
  }
  const parsed: CuNextRunCliArgs = { command };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--task') {
      const value = readArg(args, index, arg);
      if (!isCuNextTaskId(value)) throw new Error(`Unknown CU-NEXT task: ${value}`);
      parsed.taskId = value;
      index += 1;
    } else if (arg === '--all-scenarios') {
      parsed.allScenarios = true;
    } else if (arg === '--out-root') {
      parsed.outRoot = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--out') {
      parsed.out = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--run-id') {
      parsed.runId = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--workspace-path') {
      parsed.workspacePath = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--app-url') {
      parsed.appUrl = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--backend') {
      parsed.backend = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--operator') {
      parsed.operator = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--real') {
      parsed.dryRun = false;
    } else if (arg === '--max-steps') {
      parsed.maxSteps = Number(readArg(args, index, arg));
      index += 1;
    } else if (arg === '--rounds') {
      parsed.rounds = Number(readArg(args, index, arg));
      index += 1;
    } else if (arg === '--actions-json') {
      parsed.actionsJson = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--manifest') {
      parsed.manifestPath = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--target-app') {
      parsed.targetAppName = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--target-title') {
      parsed.targetTitle = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--target-mode') {
      parsed.targetMode = normalizeTargetMode(readArg(args, index, arg));
      index += 1;
    } else if (arg === '--project') {
      parsed.projectPath = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--browser-manifest') {
      parsed.runtimeBrowserManifestPath = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--search-dir') {
      parsed.searchDirs = [...(parsed.searchDirs ?? []), readArg(args, index, arg)];
      index += 1;
    } else if (arg === '--acceptance-manifest') {
      parsed.userAcceptanceManifestPaths = [...(parsed.userAcceptanceManifestPaths ?? []), readArg(args, index, arg)];
      index += 1;
    } else if (arg === '--kv-ground-smoke') {
      parsed.kvGroundSmokePaths = [...(parsed.kvGroundSmokePaths ?? []), readArg(args, index, arg)];
      index += 1;
    } else if (arg === '--task-map') {
      parsed.taskMapPath = readArg(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function hydrateCuNextRuntimeEnvFromLocalConfig(workspacePath?: string): Promise<void> {
  const localConfigPath = process.env.SCIFORGE_CONFIG_PATH?.trim()
    ? resolve(process.env.SCIFORGE_CONFIG_PATH)
    : resolve('config.local.json');
  const configs = (await Promise.all([
    readOptionalLocalJson(localConfigPath),
    workspacePath ? readOptionalLocalJson(resolve(workspacePath, '.sciforge', 'config.json')) : undefined,
    workspacePath ? readOptionalLocalJson(resolve(workspacePath, '.sciforge', 'config.local.json')) : undefined,
  ])).filter(isRecord);
  if (!configs.length) return;

  const apiKey = firstConfigString(configs, [
    ['apiKey'],
    ['llm', 'apiKey'],
    ['llm', 'upstreamApiKey'],
    ['codexProxy', 'apiKey'],
    ['runtimeCodexProxy', 'apiKey'],
  ]);
  const upstreamBaseUrl = stripTrailingSlash(firstConfigString(configs, [
    ['modelBaseUrl'],
    ['llm', 'baseUrl'],
    ['llm', 'upstreamBaseUrl'],
    ['codexProxy', 'upstreamBaseUrl'],
    ['codexProxy', 'baseUrl'],
    ['runtimeCodexProxy', 'upstreamBaseUrl'],
    ['runtimeCodexProxy', 'baseUrl'],
  ]));
  const model = firstConfigString(configs, [
    ['modelName'],
    ['llm', 'model'],
    ['llm', 'modelName'],
    ['codexProxy', 'defaultModel'],
    ['codexProxy', 'model'],
    ['runtimeCodexProxy', 'defaultModel'],
    ['runtimeCodexProxy', 'model'],
  ]);
  const provider = firstConfigString(configs, [
    ['runtimeProvider'],
    ['codexProxy', 'runtimeProvider'],
    ['codexProxy', 'provider'],
    ['runtimeCodexProxy', 'runtimeProvider'],
    ['runtimeCodexProxy', 'provider'],
  ]) ?? (upstreamBaseUrl ? 'sciforge-deepseek-proxy' : undefined);
  const plannerProfile = firstConfigString(configs, [
    ['computerUse', 'plannerProfile'],
    ['visionSense', 'plannerProfile'],
  ]);
  const grounderBaseUrl = stripTrailingSlash(firstConfigString(configs, [
    ['visionSense', 'grounderBaseUrl'],
  ]));
  const inputAdapter = firstConfigString(configs, [
    ['visionSense', 'inputAdapter'],
    ['visionSense', 'independentInputAdapter'],
    ['computerUse', 'inputAdapter'],
  ]);
  const inputAdapterProvider = firstConfigString(configs, [
    ['visionSense', 'independentInputAdapterProvider'],
    ['visionSense', 'inputAdapterProvider'],
    ['computerUse', 'independentInputAdapterProvider'],
    ['computerUse', 'inputAdapterProvider'],
  ]);
  const grounderUploadStrategy = firstConfigString(configs, [
    ['visionSense', 'grounderUploadStrategy'],
  ]);
  const visionVlmModel = firstConfigString(configs, [
    ['visionSense', 'vlmModel'],
    ['visionSense', 'visionModel'],
  ]);

  setEnvIfMissing('SCIFORGE_RUNTIME_API_KEY', apiKey);
  setEnvIfMissing('SCIFORGE_RUNTIME_PROVIDER', provider);
  setEnvIfMissing('SCIFORGE_RUNTIME_BASE_URL', upstreamBaseUrl);
  setEnvIfMissing('SCIFORGE_PROXY_UPSTREAM_BASE_URL', upstreamBaseUrl);
  setEnvIfMissing('SCIFORGE_RUNTIME_MODEL', model);
  setEnvIfMissing('SCIFORGE_PROXY_DEFAULT_MODEL', model);
  setEnvIfMissing('SCIFORGE_COMPUTER_USE_PLANNER_PROFILE', plannerProfile);
  setEnvIfMissing('SCIFORGE_VISION_KV_GROUND_URL', grounderBaseUrl);
  setEnvIfMissing('SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY', grounderUploadStrategy);
  setEnvIfMissing('SCIFORGE_VISION_INPUT_ADAPTER', inputAdapter);
  setEnvIfMissing('SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER', inputAdapterProvider);
  setEnvIfMissing('SCIFORGE_VISION_VLM_MODEL', visionVlmModel);
}

async function readOptionalLocalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function firstConfigString(configs: Record<string, unknown>[], paths: string[][]): string | undefined {
  for (const path of paths) {
    for (const config of configs) {
      const value = getConfigString(config, path);
      if (value) return value;
    }
  }
  return undefined;
}

function getConfigString(config: Record<string, unknown>, path: string[]): string | undefined {
  let cursor: unknown = config;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  if (typeof cursor === 'string' && cursor.trim()) return cursor.trim();
  if (typeof cursor === 'number' && Number.isFinite(cursor)) return String(cursor);
  if (typeof cursor === 'boolean') return cursor ? 'true' : 'false';
  return undefined;
}

function setEnvIfMissing(key: string, value: string | undefined): void {
  if (process.env[key] !== undefined) return;
  if (value) process.env[key] = value;
}

function stripTrailingSlash(value: string | undefined): string | undefined {
  return value?.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireTask(args: CuNextRunCliArgs): CuNextTaskId {
  if (!args.taskId) throw new Error(`${args.command} requires --task <CU-NEXT-##>`);
  return args.taskId;
}

function readArg(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function normalizeTargetMode(value: string): CuNextRunCliArgs['targetMode'] {
  if (value === 'active-window' || value === 'app-window' || value === 'window-id' || value === 'display') return value;
  throw new Error(`Invalid --target-mode ${value}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runCuNextCli(process.argv);
}

import { writeFile } from 'node:fs/promises';

import {
  loadComputerUseLongTaskPool,
  preflightComputerUseLong,
  prepareComputerUseLongRun,
  renderComputerUseLongMatrixReport,
  renderComputerUseLongRepairPlan,
  renderComputerUseLongRunbook,
  runComputerUseLongMatrix,
  runComputerUseLongRound,
  runComputerUseLongScenario,
  validateComputerUseLongMatrix,
  validateComputerUseLongRun,
  validateComputerUseLongTaskPool,
  validateComputerUseLongTrace,
} from './internal.js';

export async function runComputerUseLongTaskPoolCli(argv = process.argv) {
  if (argv.includes('prepare')) {
    const args = parsePrepareArgs(argv.slice(2));
    const prepared = await prepareComputerUseLongRun(args);
    process.stdout.write(`[ok] prepared ${prepared.scenario.id}\n`);
    process.stdout.write(`  manifest: ${prepared.manifestPath}\n`);
    process.stdout.write(`  checklist: ${prepared.checklistPath}\n`);
    process.stdout.write(`  evidence: ${prepared.evidenceDir}\n`);
  } else if (argv.includes('validate-trace')) {
    const args = parseValidateTraceArgs(argv.slice(2));
    const result = await validateComputerUseLongTrace(args);
    if (!result.ok) {
      process.stdout.write(`[failed] ${result.scenarioId} trace validation failed\n`);
      for (const issue of result.issues) process.stdout.write(`- ${issue}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`[ok] ${result.scenarioId} trace validation passed\n`);
      process.stdout.write(`  screenshots: ${result.metrics.screenshotCount}\n`);
      process.stdout.write(`  actions: ${result.metrics.actionCount}\n`);
    }
  } else if (argv.includes('run-round')) {
    const args = parseRunRoundArgs(argv.slice(2));
    const result = await runComputerUseLongRound(args);
    if (result.status !== 'passed') {
      process.stdout.write(`[repair-needed] ${result.scenarioId} round ${result.round}\n`);
      process.stdout.write(`  message: ${result.payloadMessage}\n`);
      if (result.tracePath) process.stdout.write(`  trace: ${result.tracePath}\n`);
      if (result.validation && !result.validation.ok) {
        for (const issue of result.validation.issues) process.stdout.write(`- ${issue}\n`);
      }
      process.exitCode = 1;
    } else {
      process.stdout.write(`[ok] ${result.scenarioId} round ${result.round} passed\n`);
      if (result.tracePath) process.stdout.write(`  trace: ${result.tracePath}\n`);
      process.stdout.write(`  actions: ${result.validation?.metrics.actionCount ?? 0}\n`);
      process.stdout.write(`  screenshots: ${result.validation?.metrics.screenshotCount ?? 0}\n`);
    }
  } else if (argv.includes('run-scenario')) {
    const args = parseRunScenarioArgs(argv.slice(2));
    const result = await runComputerUseLongScenario(args);
    if (result.status !== 'passed') {
      process.stdout.write(`[repair-needed] ${result.scenarioId} scenario run stopped\n`);
      process.stdout.write(`  attempted rounds: ${result.attemptedRounds.join(', ')}\n`);
      if (result.repairNeededRound) process.stdout.write(`  repair-needed round: ${result.repairNeededRound}\n`);
      process.stdout.write(`  summary: ${result.summaryPath}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`[ok] ${result.scenarioId} scenario run passed\n`);
      process.stdout.write(`  passed rounds: ${result.passedRounds.join(', ')}\n`);
      process.stdout.write(`  summary: ${result.summaryPath}\n`);
    }
  } else if (argv.includes('validate-run')) {
    const args = parseValidateRunArgs(argv.slice(2));
    const result = await validateComputerUseLongRun(args);
    if (!result.ok) {
      process.stdout.write(`[failed] ${result.scenarioId} run validation failed\n`);
      for (const issue of result.issues) process.stdout.write(`- ${issue}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`[ok] ${result.scenarioId} run validation passed\n`);
      process.stdout.write(`  passed rounds: ${result.metrics.passedRounds}\n`);
      process.stdout.write(`  traces: ${result.metrics.traceCount}\n`);
      process.stdout.write(`  screenshots: ${result.metrics.screenshotRefCount}\n`);
    }
  } else if (argv.includes('run-matrix')) {
    const args = parseRunMatrixArgs(argv.slice(2));
    const result = await runComputerUseLongMatrix(args);
    if (result.status !== 'passed') {
      process.stdout.write('[repair-needed] CU-LONG matrix stopped\n');
      process.stdout.write(`  passed scenarios: ${result.passedScenarioIds.join(', ')}\n`);
      process.stdout.write(`  repair-needed scenarios: ${result.repairNeededScenarioIds.join(', ')}\n`);
      process.stdout.write(`  summary: ${result.summaryPath}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write('[ok] CU-LONG matrix passed\n');
      process.stdout.write(`  passed scenarios: ${result.passedScenarioIds.join(', ')}\n`);
      process.stdout.write(`  summary: ${result.summaryPath}\n`);
    }
  } else if (argv.includes('matrix-report')) {
    const args = parseMatrixReportArgs(argv.slice(2));
    const result = await renderComputerUseLongMatrixReport(args);
    process.stdout.write('[ok] CU-LONG matrix report written\n');
    process.stdout.write(`  report: ${result.reportPath}\n`);
    if (!result.ok) process.stdout.write(`  issue categories: ${JSON.stringify(result.issueCategories)}\n`);
  } else if (argv.includes('validate-matrix')) {
    const args = parseValidateMatrixArgs(argv.slice(2));
    const result = await validateComputerUseLongMatrix(args);
    if (!result.ok) {
      process.stdout.write('[failed] CU-LONG matrix validation failed\n');
      for (const issue of result.issues) process.stdout.write(`- ${issue}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write('[ok] CU-LONG matrix validation passed\n');
      process.stdout.write(`  scenarios: ${result.scenarioIds.join(', ')}\n`);
      process.stdout.write(`  validated runs: ${result.metrics.validatedRuns}\n`);
    }
  } else if (argv.includes('repair-plan')) {
    const args = parseRepairPlanArgs(argv.slice(2));
    const result = await renderComputerUseLongRepairPlan(args);
    process.stdout.write('[ok] CU-LONG repair plan written\n');
    process.stdout.write(`  plan: ${result.planPath}\n`);
    process.stdout.write(`  actions: ${result.actionCount}\n`);
  } else if (argv.includes('preflight')) {
    const args = parsePreflightArgs(argv.slice(2));
    const result = await preflightComputerUseLong(args);
    if (!result.ok) {
      process.stdout.write('[failed] CU-LONG preflight failed\n');
      for (const check of result.checks.filter((item) => item.status === 'fail')) {
        process.stdout.write(`- [${check.category}] ${check.message}\n`);
      }
      if (result.reportPath) process.stdout.write(`  report: ${result.reportPath}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write('[ok] CU-LONG preflight passed\n');
      const warnings = result.checks.filter((item) => item.status === 'warn');
      if (warnings.length) process.stdout.write(`  warnings: ${warnings.length}\n`);
      if (result.reportPath) process.stdout.write(`  report: ${result.reportPath}\n`);
    }
  } else {
    const pool = await loadComputerUseLongTaskPool();
    const issues = validateComputerUseLongTaskPool(pool);
    if (issues.length) throw new Error(`Invalid T084 Computer Use task pool:\n${issues.join('\n')}`);
    const outIndex = argv.indexOf('--out');
    if (outIndex >= 0) {
      const outPath = argv[outIndex + 1];
      if (!outPath) throw new Error('--out requires a path');
      await writeFile(outPath, renderComputerUseLongRunbook(pool));
    } else {
      process.stdout.write(renderComputerUseLongRunbook(pool));
    }
  }
}

function parsePrepareArgs(args: string[]) {
  const options: Parameters<typeof prepareComputerUseLongRun>[0] = { scenarioId: '' };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === 'prepare') continue;
    if (arg === '--scenario') {
      options.scenarioId = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--out-root') {
      options.outRoot = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--run-id') {
      options.runId = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--workspace-path') {
      options.workspacePath = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--app-url') {
      options.appUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--backend') {
      options.backend = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--operator') {
      options.operator = readArgValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.scenarioId) throw new Error('prepare requires --scenario <CU-LONG-###>');
  return options;
}

function parseValidateTraceArgs(args: string[]) {
  const options: Parameters<typeof validateComputerUseLongTrace>[0] = { scenarioId: '', tracePath: '' };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === 'validate-trace') continue;
    if (arg === '--scenario') {
      options.scenarioId = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--trace') {
      options.tracePath = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--workspace-path') {
      options.workspacePath = readArgValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.scenarioId) throw new Error('validate-trace requires --scenario <CU-LONG-###>');
  if (!options.tracePath) throw new Error('validate-trace requires --trace <path>');
  return options;
}

function parseValidateRunArgs(args: string[]) {
  const options: Parameters<typeof validateComputerUseLongRun>[0] = { manifestPath: '' };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === 'validate-run') continue;
    if (arg === '--manifest') {
      options.manifestPath = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--allow-repair-needed') {
      options.requirePassed = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.manifestPath) throw new Error('validate-run requires --manifest <manifest.json>');
  return options;
}

function parseRunRoundArgs(args: string[]) {
  const options: Parameters<typeof runComputerUseLongRound>[0] = { manifestPath: '', round: 0 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === 'run-round') continue;
    if (arg === '--manifest') {
      options.manifestPath = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--round') {
      options.round = Number(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--real') {
      options.dryRun = false;
    } else if (arg === '--max-steps') {
      options.maxSteps = Number(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === '--run-id') {
      options.runId = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--target-app') {
      options.targetAppName = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--target-title') {
      options.targetTitle = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--target-mode') {
      options.targetMode = normalizeCliTargetMode(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === '--actions-json') {
      options.actionsJson = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--prompt-suffix') {
      options.promptSuffix = readArgValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.manifestPath) throw new Error('run-round requires --manifest <manifest.json>');
  if (!Number.isInteger(options.round) || options.round < 1) throw new Error('run-round requires --round <positive integer>');
  return options;
}

function parseRunScenarioArgs(args: string[]) {
  const options: Parameters<typeof runComputerUseLongScenario>[0] = { manifestPath: '' };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === 'run-scenario') continue;
    if (arg === '--manifest') {
      options.manifestPath = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--rounds') {
      options.rounds = Number(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--real') {
      options.dryRun = false;
    } else if (arg === '--max-steps') {
      options.maxSteps = Number(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === '--target-app') {
      options.targetAppName = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--target-title') {
      options.targetTitle = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--target-mode') {
      options.targetMode = normalizeCliTargetMode(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === '--actions-json') {
      options.actionsJson = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--prompt-suffix') {
      options.promptSuffix = readArgValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.manifestPath) throw new Error('run-scenario requires --manifest <manifest.json>');
  if (options.rounds !== undefined && (!Number.isInteger(options.rounds) || options.rounds < 1)) {
    throw new Error('run-scenario --rounds must be a positive integer');
  }
  return options;
}

function parseRunMatrixArgs(args: string[]) {
  const options: Parameters<typeof runComputerUseLongMatrix>[0] = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === 'run-matrix') continue;
    if (arg === '--scenarios') {
      options.scenarioIds = readArgValue(args, index, arg).split(',').map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (arg === '--out-root') {
      options.outRoot = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--workspace-path') {
      options.workspacePath = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--app-url') {
      options.appUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--backend') {
      options.backend = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--operator') {
      options.operator = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--real') {
      options.dryRun = false;
    } else if (arg === '--skip-preflight') {
      options.skipPreflight = true;
    } else if (arg === '--max-steps') {
      options.maxSteps = Number(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === '--max-concurrency') {
      options.maxConcurrency = Number(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === '--actions-json') {
      options.actionsJson = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--target-app') {
      options.targetAppName = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--target-title') {
      options.targetTitle = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--target-mode') {
      options.targetMode = normalizeCliTargetMode(readArgValue(args, index, arg));
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.scenarioIds && !options.scenarioIds.length) throw new Error('run-matrix --scenarios must include at least one scenario id');
  if (options.maxSteps !== undefined && (!Number.isInteger(options.maxSteps) || options.maxSteps < 1)) {
    throw new Error('run-matrix --max-steps must be a positive integer');
  }
  if (options.maxConcurrency !== undefined && (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1)) {
    throw new Error('run-matrix --max-concurrency must be a positive integer');
  }
  return options;
}

function parseMatrixReportArgs(args: string[]) {
  const options: Parameters<typeof renderComputerUseLongMatrixReport>[0] = { summaryPath: '' };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === 'matrix-report') continue;
    if (arg === '--summary') {
      options.summaryPath = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--out') {
      options.out = readArgValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.summaryPath) throw new Error('matrix-report requires --summary <matrix-summary.json>');
  return options;
}

function parseValidateMatrixArgs(args: string[]) {
  const options: Parameters<typeof validateComputerUseLongMatrix>[0] = { summaryPath: '' };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === 'validate-matrix') continue;
    if (arg === '--summary') {
      options.summaryPath = readArgValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.summaryPath) throw new Error('validate-matrix requires --summary <matrix-summary.json>');
  return options;
}

function parseRepairPlanArgs(args: string[]) {
  const options: Parameters<typeof renderComputerUseLongRepairPlan>[0] = { summaryPath: '' };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === 'repair-plan') continue;
    if (arg === '--summary') {
      options.summaryPath = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--out') {
      options.out = readArgValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.summaryPath) throw new Error('repair-plan requires --summary <matrix-summary.json>');
  return options;
}

function parsePreflightArgs(args: string[]) {
  const options: Parameters<typeof preflightComputerUseLong>[0] = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === 'preflight') continue;
    if (arg === '--scenarios') {
      options.scenarioIds = readArgValue(args, index, arg).split(',').map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (arg === '--workspace-path') {
      options.workspacePath = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--real') {
      options.dryRun = false;
    } else if (arg === '--actions-json') {
      options.actionsJson = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === '--out') {
      options.out = readArgValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.scenarioIds && !options.scenarioIds.length) throw new Error('preflight --scenarios must include at least one scenario id');
  return options;
}

function readArgValue(args: string[], index: number, name: string) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function normalizeCliTargetMode(value: string): 'active-window' | 'app-window' | 'window-id' | 'display' {
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized === 'active' || normalized === 'active-window' || normalized === 'frontmost') return 'active-window';
  if (normalized === 'app' || normalized === 'app-window' || normalized === 'application') return 'app-window';
  if (normalized === 'window' || normalized === 'window-id' || normalized === 'id') return 'window-id';
  if (normalized === 'display' || normalized === 'screen') return 'display';
  throw new Error(`Unsupported --target-mode: ${value}`);
}

function sanitizeRunId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'cu-long-run';
}


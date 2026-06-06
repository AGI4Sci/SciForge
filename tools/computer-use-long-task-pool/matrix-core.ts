import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type {
  ComputerUseLongMatrixReport,
  ComputerUseLongMatrixRepairManifest,
  ComputerUseLongMatrixRunResult,
  ComputerUseLongMatrixValidation,
  ComputerUseLongPreflightResult,
  ComputerUseLongRepairPlan,
} from './contracts.js';
import { loadComputerUseLongTaskPool, prepareComputerUseLongRun, validateComputerUseLongTaskPool } from './task-pool.js';
import { runComputerUseLongScenario, validateComputerUseLongRun } from './run-core.js';
import { localProviderSettings } from '../../packages/backend/src/local-provider-config.js';
import {
  executableIndependentInputAdapter,
  independentInputAdapterExecutionBoundary,
} from '../../src/runtime/computer-use/independent-input-adapter.js';
import {
  categorizeComputerUseIssue,
  collectRefsFirstManifestPayloadIssues,
  collectScenarioRunIssues,
  firstString,
  getConfigString,
  isRecord,
  mapWithConcurrency,
  matrixExecutionPlanFromVisionSense,
  readOptionalJson,
  renderMatrixReportMarkdown,
  renderPreflightReport,
  renderRepairPlanMarkdown,
  repairActionsForIssues,
  writeMatrixSummary,
} from './support.js';

export async function runComputerUseLongMatrix(options: {
  scenarioIds?: string[];
  outRoot?: string;
  workspacePath?: string;
  appUrl?: string;
  backend?: string;
  operator?: string;
  dryRun?: boolean;
  skipPreflight?: boolean;
  maxSteps?: number;
  maxConcurrency?: number;
  actionsJson?: string;
  targetAppName?: string;
  targetTitle?: string;
  targetMode?: 'active-window' | 'app-window' | 'window-id' | 'display';
  now?: Date;
}): Promise<ComputerUseLongMatrixRunResult> {
  const pool = await loadComputerUseLongTaskPool();
  const poolIssues = validateComputerUseLongTaskPool(pool);
  if (poolIssues.length) throw new Error(`Invalid T084 Computer Use task pool:\n${poolIssues.join('\n')}`);
  const scenarioIds = (options.scenarioIds?.length ? options.scenarioIds : pool.scenarios.map((item) => item.id));
  const unknown = scenarioIds.filter((id) => !pool.scenarios.some((scenario) => scenario.id === id));
  if (unknown.length) throw new Error(`Unknown CU-LONG scenarios: ${unknown.join(', ')}`);
  const now = options.now ?? new Date();
  const outRoot = resolve(options.outRoot || join('docs', 'test-artifacts', 'computer-use-long-matrix'));
  const matrixId = `matrix-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const matrixDir = join(outRoot, matrixId);
  await mkdir(matrixDir, { recursive: true });
  const executionPlan = await matrixExecutionPlanFromVisionSense(Boolean(options.dryRun), scenarioIds.length, options.maxConcurrency);
  const preflight = options.skipPreflight ? undefined : await preflightComputerUseLong({
    scenarioIds,
    workspacePath: options.workspacePath,
    dryRun: options.dryRun,
    actionsJson: options.actionsJson,
    out: join(matrixDir, 'preflight.md'),
  });
  const results: ComputerUseLongMatrixRunResult['results'] = [];

  if (preflight && !preflight.ok) {
    const summaryPath = join(matrixDir, 'matrix-summary.json');
    let summary: ComputerUseLongMatrixRunResult = {
      summaryPath,
      status: 'repair-needed',
      scenarioIds,
      passedScenarioIds: [],
      repairNeededScenarioIds: scenarioIds,
      executionPlan,
      preflight,
      results,
    };
    summary = await writeRepairManifestForMatrix(matrixDir, matrixId, summary);
    await writeMatrixSummary(summaryPath, matrixId, summary);
    return summary;
  }

  const runScenario = async (scenarioId: string) => {
    const prepared = await prepareComputerUseLongRun({
      scenarioId,
      outRoot: matrixDir,
      runId: `${scenarioId.toLowerCase()}-${matrixId}`,
      workspacePath: options.workspacePath,
      appUrl: options.appUrl,
      backend: options.backend,
      operator: options.operator,
      now,
    });
    const scenarioRun = await runComputerUseLongScenario({
      manifestPath: prepared.manifestPath,
      dryRun: options.dryRun,
      maxSteps: options.maxSteps,
      actionsJson: options.actionsJson,
      targetAppName: options.targetAppName,
      targetTitle: options.targetTitle,
      targetMode: options.targetMode,
      now,
    });
    const validation = scenarioRun.validation ?? await validateComputerUseLongRun({
      manifestPath: prepared.manifestPath,
      requirePassed: scenarioRun.status === 'passed',
    });
    const issues = await collectScenarioRunIssues(scenarioRun, validation);
    const nextRepairFocus = issues.length ? repairActionsForIssues(issues) : [];
    return {
      scenarioId,
      manifestPath: prepared.manifestPath,
      runStatus: scenarioRun.status,
      validationOk: validation.ok,
      summaryPath: scenarioRun.summaryPath,
      issues,
      repairDiagnostics: {
        ...validation.repairDiagnostics,
        nextRepairFocus,
      },
      nextRepairFocus,
    };
  };
  if (executionPlan.mode === 'parallel-analysis') {
    results.push(...await mapWithConcurrency(scenarioIds, executionPlan.maxConcurrency, runScenario));
  } else {
    for (const scenarioId of scenarioIds) {
      const result = await runScenario(scenarioId);
      results.push(result);
      if (result.runStatus !== 'passed' || !result.validationOk) break;
    }
  }

  const passedScenarioIds = results
    .filter((item) => item.runStatus === 'passed' && item.validationOk)
    .map((item) => item.scenarioId);
  const repairNeededScenarioIds = results
    .filter((item) => item.runStatus !== 'passed' || !item.validationOk)
    .map((item) => item.scenarioId);
  const status: ComputerUseLongMatrixRunResult['status'] = repairNeededScenarioIds.length ? 'repair-needed' : 'passed';
  const summaryPath = join(matrixDir, 'matrix-summary.json');
  let summary: ComputerUseLongMatrixRunResult = {
    summaryPath,
    status,
    scenarioIds,
    passedScenarioIds,
    repairNeededScenarioIds,
    executionPlan,
    preflight,
    results,
  };
  if (status === 'repair-needed') {
    summary = await writeRepairManifestForMatrix(matrixDir, matrixId, summary);
  }
  await writeMatrixSummary(summaryPath, matrixId, summary);
  return summary;
}

async function writeRepairManifestForMatrix(
  matrixDir: string,
  matrixId: string,
  summary: ComputerUseLongMatrixRunResult,
): Promise<ComputerUseLongMatrixRunResult> {
  const repairManifestPath = join(matrixDir, 'repair-manifest.json');
  const repairManifest = renderRepairManifest(matrixId, summary);
  await writeFile(repairManifestPath, `${JSON.stringify(repairManifest, null, 2)}\n`);
  return {
    ...summary,
    repairManifestPath,
  };
}

function renderRepairManifest(matrixId: string, summary: ComputerUseLongMatrixRunResult): ComputerUseLongMatrixRepairManifest {
  const failedPreflightChecks = (summary.preflight?.checks ?? [])
    .filter((check) => check.status === 'fail')
    .map((check) => ({
      id: check.id,
      category: check.category,
      message: check.message,
      repairAction: check.repairAction,
    }));
  const preflightFocus = failedPreflightChecks.map((check) => (
    `[preflight/${check.category}] ${check.repairAction || check.message || 'Fix the failed preflight check and rerun the matrix.'}`
  ));
  const scenarioRepairs = summary.results
    .filter((result) => result.runStatus !== 'passed' || !result.validationOk || result.issues.length > 0)
    .map((result) => {
      const nextRepairFocus = dedupeStrings([
        ...(result.nextRepairFocus ?? []),
        ...(result.repairDiagnostics?.nextRepairFocus ?? []),
        ...repairActionsForIssues(result.issues),
      ]);
      return {
        scenarioId: result.scenarioId,
        manifestPath: result.manifestPath,
        summaryPath: result.summaryPath,
        issues: result.issues,
        nextRepairFocus,
      };
    });
  const nextRepairFocus = dedupeStrings([
    ...preflightFocus,
    ...scenarioRepairs.flatMap((repair) => repair.nextRepairFocus),
  ]);
  return {
    schemaVersion: 'sciforge.computer-use-long.repair-manifest.v1',
    taskId: 'T084',
    matrixId,
    status: 'repair-needed',
    scenarioIds: summary.scenarioIds,
    repairNeededScenarioIds: summary.repairNeededScenarioIds,
    preflightReportPath: summary.preflight?.reportPath,
    failedPreflightChecks,
    scenarioRepairs,
    nextRepairFocus: nextRepairFocus.length
      ? nextRepairFocus
      : ['Inspect matrix preflight/results, repair the first blocking CU-LONG issue, then rerun validate-matrix.'],
  };
}

export async function renderComputerUseLongMatrixReport(options: {
  summaryPath?: string;
  outRoot?: string;
  out?: string;
}): Promise<ComputerUseLongMatrixReport> {
  const summaryPath = await resolveComputerUseLongMatrixSummaryPath(options);
  const summary = await readOptionalJson(summaryPath);
  if (!isRecord(summary)) throw new Error(`matrix summary is missing or invalid: ${summaryPath}`);
  const results = Array.isArray(summary.results) ? summary.results.filter(isRecord) : [];
  const issueCategories: Record<string, number> = {};
  const preflight = isRecord(summary.preflight) ? summary.preflight : undefined;
  const preflightChecks = preflight && Array.isArray(preflight.checks) ? preflight.checks.filter(isRecord) : [];
  for (const check of preflightChecks.filter((item) => item.status === 'fail')) {
    const category = categorizeComputerUseIssue(`${String(check.category || '')} ${String(check.id || '')} ${String(check.message || '')}`);
    issueCategories[category] = (issueCategories[category] ?? 0) + 1;
  }
  for (const result of results) {
    const issues = Array.isArray(result.issues) ? result.issues.map(String) : [];
    for (const issue of issues) {
      const category = categorizeComputerUseIssue(issue);
      issueCategories[category] = (issueCategories[category] ?? 0) + 1;
    }
  }
  const markdown = renderMatrixReportMarkdown(summaryPath, summary, results, issueCategories);
  const reportPath = resolve(options.out || join(dirname(summaryPath), 'matrix-report.md'));
  await writeFile(reportPath, markdown);
  return {
    ok: String(summary.status) === 'passed' && Object.keys(issueCategories).length === 0,
    summaryPath,
    reportPath,
    markdown,
    issueCategories,
  };
}

export async function validateComputerUseLongMatrix(options: {
  summaryPath?: string;
  outRoot?: string;
  requirePassed?: boolean;
}): Promise<ComputerUseLongMatrixValidation> {
  const summaryPath = await resolveComputerUseLongMatrixSummaryPath(options);
  const summary = await readOptionalJson(summaryPath);
  const issues: string[] = [];
  if (!isRecord(summary)) {
    return {
      ok: false,
      summaryPath,
      scenarioIds: [],
      issues: [`matrix summary is missing or invalid: ${summaryPath}`],
      metrics: { resultCount: 0, passedScenarios: 0, repairNeededScenarios: 0, preflightFailedChecks: 0, validatedRuns: 0 },
    };
  }
  issues.push(...collectRefsFirstManifestPayloadIssues(summary, 'matrix summary'));
  if (summary.schemaVersion !== 'sciforge.computer-use-long.matrix-summary.v1') issues.push('matrix summary schemaVersion is invalid');
  if (summary.taskId !== 'T084') issues.push('matrix summary taskId must be T084');
  const executionPlan = isRecord(summary.executionPlan) ? summary.executionPlan : undefined;
  if (!executionPlan) {
    issues.push('matrix summary missing executionPlan');
  } else {
    const mode = String(executionPlan.mode || '');
    if (mode !== 'parallel-analysis' && mode !== 'serialized-real-gui') issues.push('matrix executionPlan.mode is invalid');
    if (typeof executionPlan.maxConcurrency !== 'number' || executionPlan.maxConcurrency < 1) issues.push('matrix executionPlan.maxConcurrency must be positive');
    if (mode === 'serialized-real-gui' && executionPlan.realGuiSerialized !== true) issues.push('real GUI matrix execution must be serialized');
  }
  const scenarioIds = Array.isArray(summary.scenarioIds) ? summary.scenarioIds.map(String) : [];
  const passedScenarioIds = Array.isArray(summary.passedScenarioIds) ? summary.passedScenarioIds.map(String) : [];
  const repairNeededScenarioIds = Array.isArray(summary.repairNeededScenarioIds) ? summary.repairNeededScenarioIds.map(String) : [];
  const status = String(summary.status || '');
  if (status !== 'passed' && status !== 'repair-needed') issues.push('matrix summary status must be passed or repair-needed');
  if (options.requirePassed !== false && status !== 'passed') {
    issues.push('matrix.status must be passed; use --allow-repair-needed only for structural inspection of blocked repair manifests');
  }
  const unknown = scenarioIds.filter((id) => !/^CU-LONG-\d{3}$/.test(id));
  if (unknown.length) issues.push(`matrix summary contains invalid scenario ids: ${unknown.join(', ')}`);
  for (const id of passedScenarioIds) {
    if (!scenarioIds.includes(id)) issues.push(`passedScenarioIds contains unselected scenario ${id}`);
  }
  for (const id of repairNeededScenarioIds) {
    if (!scenarioIds.includes(id)) issues.push(`repairNeededScenarioIds contains unselected scenario ${id}`);
  }
  if (status === 'passed' && repairNeededScenarioIds.length) issues.push('passed matrix must not include repairNeededScenarioIds');
  if (status === 'repair-needed' && !repairNeededScenarioIds.length) issues.push('repair-needed matrix must include repairNeededScenarioIds');
  if (status === 'passed') {
    const missingPassedScenarioIds = scenarioIds.filter((id) => !passedScenarioIds.includes(id));
    if (missingPassedScenarioIds.length) issues.push(`passed matrix missing passedScenarioIds: ${missingPassedScenarioIds.join(', ')}`);
  }

  const preflight = isRecord(summary.preflight) ? summary.preflight : undefined;
  const preflightChecks = preflight && Array.isArray(preflight.checks) ? preflight.checks.filter(isRecord) : [];
  const preflightFailedChecks = preflightChecks.filter((check) => check.status === 'fail').length;
  if (preflight && preflight.ok === false && status !== 'repair-needed') issues.push('failed preflight must force matrix status repair-needed');
  if (preflight && preflight.ok === false && Array.isArray(summary.results) && summary.results.length > 0) {
    issues.push('failed preflight matrix must not execute scenario results');
  }
  if (preflight && preflight.ok === false && preflightFailedChecks === 0) issues.push('failed preflight must include failed checks');

  if (status === 'repair-needed') {
    const repairManifestPath = typeof summary.repairManifestPath === 'string'
      ? resolve(dirname(summaryPath), summary.repairManifestPath)
      : '';
    if (!repairManifestPath) {
      issues.push('repair-needed matrix must include repair manifest path and next repair focus');
    } else {
      const repairManifest = await readOptionalJson(repairManifestPath);
      if (!isRecord(repairManifest)) {
        issues.push(`repair manifest is missing or invalid: ${repairManifestPath}`);
      } else {
        issues.push(...collectRefsFirstManifestPayloadIssues(repairManifest, 'repair manifest'));
        if (repairManifest.schemaVersion !== 'sciforge.computer-use-long.repair-manifest.v1') {
          issues.push('repair manifest schemaVersion is invalid');
        }
        if (repairManifest.taskId !== 'T084') issues.push('repair manifest taskId must be T084');
        if (repairManifest.status !== 'repair-needed') issues.push('repair manifest status must be repair-needed');
        const manifestScenarioIds = Array.isArray(repairManifest.scenarioIds) ? repairManifest.scenarioIds.map(String) : [];
        const manifestRepairNeededScenarioIds = Array.isArray(repairManifest.repairNeededScenarioIds)
          ? repairManifest.repairNeededScenarioIds.map(String)
          : [];
        if (scenarioIds.some((id) => !manifestScenarioIds.includes(id))) {
          issues.push('repair manifest scenarioIds must cover selected matrix scenarios');
        }
        if (repairNeededScenarioIds.some((id) => !manifestRepairNeededScenarioIds.includes(id))) {
          issues.push('repair manifest repairNeededScenarioIds must cover repair-needed matrix scenarios');
        }
        const nextRepairFocus = Array.isArray(repairManifest.nextRepairFocus)
          ? repairManifest.nextRepairFocus.map(String).filter(Boolean)
          : [];
        if (!nextRepairFocus.length) issues.push('repair manifest next repair focus is missing');
      }
    }
  }

  const results = Array.isArray(summary.results) ? summary.results.filter(isRecord) : [];
  const resultScenarioIds = results.map((result) => String(result.scenarioId || ''));
  const duplicateResultScenarioIds = resultScenarioIds.filter((id, index) => id && resultScenarioIds.indexOf(id) !== index);
  if (duplicateResultScenarioIds.length) issues.push(`matrix summary contains duplicate result scenarios: ${Array.from(new Set(duplicateResultScenarioIds)).join(', ')}`);
  if (status === 'passed') {
    const missingResultScenarioIds = scenarioIds.filter((id) => !resultScenarioIds.includes(id));
    if (missingResultScenarioIds.length) issues.push(`passed matrix missing result scenarios: ${missingResultScenarioIds.join(', ')}`);
  }
  let validatedRuns = 0;
  for (const result of results) {
    const scenarioId = String(result.scenarioId || '');
    if (!scenarioIds.includes(scenarioId)) issues.push(`result scenario ${scenarioId || '<missing>'} was not selected`);
    const runStatus = String(result.runStatus || '');
    if (status === 'passed' && runStatus !== 'passed') {
      issues.push(`passed matrix result ${scenarioId || '<missing>'} runStatus must be passed`);
    }
    if (status === 'passed' && result.validationOk !== true) {
      issues.push(`passed matrix result ${scenarioId || '<missing>'} validationOk must be true`);
    }
    const scenarioSummaryPath = typeof result.summaryPath === 'string' ? resolve(dirname(summaryPath), result.summaryPath) : '';
    if (status === 'passed' && !scenarioSummaryPath) {
      issues.push(`passed matrix result ${scenarioId || '<missing>'} missing summaryPath for scenario summary validator evidence`);
    }
    const manifestPath = typeof result.manifestPath === 'string' ? result.manifestPath : '';
    if (!manifestPath) {
      issues.push(`result ${scenarioId || '<missing>'} missing manifestPath`);
      continue;
    }
    const validation = await validateComputerUseLongRun({
      manifestPath,
      requirePassed: status === 'passed' || result.runStatus === 'passed',
    });
    validatedRuns += 1;
    if (scenarioSummaryPath && validation.summaryPath && resolve(scenarioSummaryPath) !== resolve(validation.summaryPath)) {
      issues.push(`result ${scenarioId} summaryPath does not match current-run scenario summary`);
    }
    if (Boolean(result.validationOk) !== validation.ok) issues.push(`result ${scenarioId} validationOk does not match validate-run result`);
    if (validation.scenarioId !== scenarioId) issues.push(`result ${scenarioId} manifest scenario mismatch: ${validation.scenarioId}`);
    if (!validation.ok) {
      for (const issue of validation.issues) issues.push(`result ${scenarioId}: ${issue}`);
    }
  }
  if (status === 'passed' && results.length !== scenarioIds.length) issues.push('passed matrix must include one result per selected scenario');

  return {
    ok: issues.length === 0,
    summaryPath,
    scenarioIds,
    issues,
    metrics: {
      resultCount: results.length,
      passedScenarios: passedScenarioIds.length,
      repairNeededScenarios: repairNeededScenarioIds.length,
      preflightFailedChecks,
      validatedRuns,
    },
  };
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim())));
}

export async function renderComputerUseLongRepairPlan(options: {
  summaryPath?: string;
  outRoot?: string;
  out?: string;
}): Promise<ComputerUseLongRepairPlan> {
  const summaryPath = await resolveComputerUseLongMatrixSummaryPath(options);
  const summary = await readOptionalJson(summaryPath);
  if (!isRecord(summary)) throw new Error(`matrix summary is missing or invalid: ${summaryPath}`);
  const markdown = renderRepairPlanMarkdown(summaryPath, summary);
  const planPath = resolve(options.out || join(dirname(summaryPath), 'repair-plan.md'));
  await writeFile(planPath, markdown);
  const actionCount = markdown.split('\n').filter((line) => /^\d+\. /.test(line)).length;
  return {
    ok: String(summary.status) === 'passed' && actionCount === 0,
    summaryPath,
    planPath,
    markdown,
    actionCount,
  };
}

export async function resolveComputerUseLongMatrixSummaryPath(options: {
  summaryPath?: string;
  outRoot?: string;
} = {}): Promise<string> {
  if (options.summaryPath) return resolve(options.summaryPath);
  const outRoot = resolve(options.outRoot || join('docs', 'test-artifacts', 'computer-use-long-matrix'));
  const candidates: Array<{ path: string; mtimeMs: number; name: string }> = [];

  const addCandidate = async (summaryPath: string, name: string) => {
    try {
      const summaryStat = await stat(summaryPath);
      if (summaryStat.isFile()) candidates.push({ path: summaryPath, mtimeMs: summaryStat.mtimeMs, name });
    } catch {
      // Missing candidate paths are expected while scanning a matrix artifact root.
    }
  };

  await addCandidate(join(outRoot, 'matrix-summary.json'), 'matrix-summary.json');
  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try {
    entries = await readdir(outRoot, { withFileTypes: true });
  } catch {
    throw new Error(`No CU-LONG matrix summary found under ${outRoot}; run npm run computer-use-long:run-matrix or pass --summary <matrix-summary.json>.`);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await addCandidate(join(outRoot, entry.name, 'matrix-summary.json'), entry.name);
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
  const latest = candidates[0]?.path;
  if (!latest) {
    throw new Error(`No CU-LONG matrix summary found under ${outRoot}; run npm run computer-use-long:run-matrix or pass --summary <matrix-summary.json>.`);
  }
  return latest;
}

export async function preflightComputerUseLong(options: {
  scenarioIds?: string[];
  workspacePath?: string;
  dryRun?: boolean;
  actionsJson?: string;
  out?: string;
} = {}): Promise<ComputerUseLongPreflightResult> {
  const pool = await loadComputerUseLongTaskPool();
  const poolIssues = validateComputerUseLongTaskPool(pool);
  const scenarioIds = options.scenarioIds?.length ? options.scenarioIds : pool.scenarios.map((item) => item.id);
  const dryRun = options.dryRun ?? false;
  const workspacePath = resolve(options.workspacePath || 'workspace');
  const localConfigPath = process.env.SCIFORGE_CONFIG_PATH?.trim()
    ? resolve(process.env.SCIFORGE_CONFIG_PATH)
    : resolve('config.local.json');
  const configCandidates = [
    await readOptionalJson(localConfigPath),
    await readOptionalJson(resolve(workspacePath, '.sciforge', 'config.json')),
    await readOptionalJson(resolve(workspacePath, '.sciforge', 'config.local.json')),
  ].filter(isRecord);
  const localProviderCandidates = configCandidates.map((config) => localProviderSettings(config));
  const checks: ComputerUseLongPreflightResult['checks'] = [];
  for (const issue of poolIssues) {
    checks.push({
      id: 'task-pool',
      status: 'fail',
      category: 'task-pool',
      message: issue,
      repairAction: 'Fix tests/computer-use-long/task-pool.json before running CU-LONG tasks.',
    });
  }
  const unknown = scenarioIds.filter((id) => !pool.scenarios.some((scenario) => scenario.id === id));
  if (unknown.length) {
    checks.push({
      id: 'scenario-selection',
      status: 'fail',
      category: 'task-pool',
      message: `Unknown CU-LONG scenarios: ${unknown.join(', ')}`,
      repairAction: 'Choose scenario ids from tests/computer-use-long/task-pool.json.',
    });
  } else {
    checks.push({
      id: 'scenario-selection',
      status: 'pass',
      category: 'task-pool',
      message: `Selected ${scenarioIds.length} scenario(s): ${scenarioIds.join(', ')}`,
    });
  }

  const desktopBridge = firstString(process.env.SCIFORGE_VISION_DESKTOP_BRIDGE, ...configCandidates.map((config) => getConfigString(config, ['visionSense', 'desktopBridgeEnabled'])));
  const desktopEnabled = desktopBridge === undefined ? process.platform === 'darwin' : /^1|true|yes$/i.test(desktopBridge);
  checks.push(desktopEnabled ? {
    id: 'desktop-bridge',
    status: 'pass',
    category: 'executor',
    message: dryRun ? 'Desktop bridge is available for dry-run routing.' : 'Desktop bridge is enabled for generic Computer Use.',
  } : {
    id: 'desktop-bridge',
    status: 'fail',
    category: 'executor',
    message: 'Desktop bridge is disabled.',
    repairAction: 'Set SCIFORGE_VISION_DESKTOP_BRIDGE=1 or visionSense.desktopBridgeEnabled=true.',
  });

  checks.push(dryRun || process.platform === 'darwin' ? {
    id: 'screenshot-capture',
    status: 'pass',
    category: 'image-memory',
    message: dryRun ? 'Dry-run screenshot provider can generate file-ref-only PNG evidence.' : 'macOS screenshot capture is available for real runs.',
  } : {
    id: 'screenshot-capture',
    status: 'fail',
    category: 'image-memory',
    message: `Real screenshot capture is not configured for platform ${process.platform}.`,
    repairAction: 'Run on macOS or add a generic screenshot provider before starting real CU-LONG runs.',
  });

  const independentInputAdapter = firstString(
    process.env.SCIFORGE_VISION_INPUT_ADAPTER,
    ...configCandidates.flatMap((config) => [
      getConfigString(config, ['visionSense', 'inputAdapter']),
      getConfigString(config, ['visionSense', 'independentInputAdapter']),
      getConfigString(config, ['computerUse', 'inputAdapter']),
    ]),
  );
  const independentInputAdapterProvider = firstString(
    process.env.SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER,
    ...configCandidates.flatMap((config) => [
      getConfigString(config, ['visionSense', 'independentInputAdapterProvider']),
      getConfigString(config, ['visionSense', 'inputAdapterProvider']),
      getConfigString(config, ['computerUse', 'independentInputAdapterProvider']),
      getConfigString(config, ['computerUse', 'inputAdapterProvider']),
    ]),
  );
  const allowSharedSystemInput = /^1|true|yes$/i.test(process.env.SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT || '');
  const independentInputReady = Boolean(independentInputAdapter && /virtual-hid|remote-desktop/i.test(independentInputAdapter));
  const independentInputExecutable = resolveExecutableIndependentInputAdapter(
    independentInputAdapter,
    independentInputAdapterProvider,
  );
  const nativeHostEvidence = desktopNativeHostEvidence(configCandidates);
  const desktopNativeHostReady = Boolean(desktopEnabled && nativeHostEvidence);
  checks.push(dryRun ? {
    id: 'desktop-product-path',
    status: 'pass',
    category: 'executor',
    message: 'Dry-run is diagnostic-only and records file-ref evidence without claiming a real Desktop product pass.',
  } : desktopNativeHostReady ? {
    id: 'desktop-product-path',
    status: 'pass',
    category: 'executor',
    message: `Desktop native host evidence is configured for real CU-LONG runs: ${nativeHostEvidence}.`,
  } : independentInputExecutable ? {
    id: 'desktop-product-path',
    status: 'pass',
    category: 'executor',
    message: `Executable independent input adapter is configured for real CU-LONG runs: ${independentInputExecutable.adapter} via ${independentInputExecutable.provider}.`,
  } : {
    id: 'desktop-product-path',
    status: 'fail',
    category: 'executor',
    message: 'Real CU-LONG preflight requires Desktop native host evidence or an executable independent input adapter provider; bridge or adapter names alone are diagnostic-only.',
    repairAction: 'Run from SciForge Desktop with native host evidence, or configure SCIFORGE_VISION_INPUT_ADAPTER=remote-desktop plus SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER=sciforge-simulated-remote-desktop.',
  });
  checks.push(dryRun ? {
    id: 'input-isolation',
    status: 'pass',
    category: 'scheduler',
    message: 'Dry-run uses a virtual input channel and cannot move the user pointer or type on the user keyboard.',
  } : independentInputExecutable ? {
    id: 'input-isolation',
    status: 'pass',
    category: 'scheduler',
    message: `Independent input adapter is configured and executable: ${independentInputExecutable.adapter} via ${independentInputExecutable.provider}.`,
  } : independentInputReady ? {
    id: 'input-isolation',
    status: 'fail',
    category: 'scheduler',
    message: `Independent input adapter is configured (${independentInputAdapter}), but this runtime has no executable provider registered for it.`,
    repairAction: 'Register a real input adapter provider before running full real CU-LONG matrices; do not mark adapter names as no-impact unless the executor routes through that adapter.',
  } : allowSharedSystemInput ? {
    id: 'input-isolation',
    status: 'warn',
    category: 'scheduler',
    message: 'Real run will use shared system mouse/keyboard input with explicit override; window focus checks and executor locks remain required.',
    repairAction: 'Prefer SCIFORGE_VISION_INPUT_ADAPTER=virtual-hid or remote-desktop before running full real CU-LONG matrices.',
  } : {
    id: 'input-isolation',
    status: 'fail',
    category: 'scheduler',
    message: 'Real run has no independent input adapter and shared system input is not explicitly allowed.',
    repairAction: 'Configure SCIFORGE_VISION_INPUT_ADAPTER=virtual-hid|remote-desktop, or set SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT=1 for an explicitly acknowledged focused-window real smoke only.',
  });

  const hasTestActionFixtures = Boolean(options.actionsJson?.trim());
  if (hasTestActionFixtures) {
    checks.push({
      id: 'test-action-fixtures',
      status: 'warn',
      category: 'planner',
      message: '--actions-json is set for test-only fixture actions; this is useful for smoke but bypasses live Runtime Codex text planner calls.',
      repairAction: 'Omit --actions-json for real CU-LONG matrix runs.',
    });
  }
  const plannerProfile = firstString(
    process.env.SCIFORGE_COMPUTER_USE_PLANNER_PROFILE,
    ...configCandidates.flatMap((config) => [
      getConfigString(config, ['computerUse', 'plannerProfile']),
      getConfigString(config, ['visionSense', 'plannerProfile']),
    ]),
  );
  const runtimeApiKeyReady = Boolean(runtimeCodexApiKey(localProviderCandidates));
  const runtimeUpstreamBaseUrlReady = Boolean(runtimeCodexUpstreamBaseUrl(configCandidates, localProviderCandidates));
  const missingRuntimePlannerConfig = [
    runtimeApiKeyReady ? undefined : 'SCIFORGE_RUNTIME_API_KEY',
    runtimeUpstreamBaseUrlReady ? undefined : 'SCIFORGE_PROXY_UPSTREAM_BASE_URL or SCIFORGE_RUNTIME_BASE_URL',
  ].filter((item): item is string => Boolean(item));
  const runtimeCodexReady = runtimeApiKeyReady && runtimeUpstreamBaseUrlReady;
  checks.push(runtimeCodexReady ? {
    id: 'runtime-codex-planner',
    status: hasTestActionFixtures ? 'warn' : 'pass',
    category: 'planner',
    message: hasTestActionFixtures
      ? 'Runtime Codex planner config exists, but test-only fixture actions will bypass it.'
      : `Runtime Codex text planner config is present${plannerProfile ? ` with profile ${plannerProfile}` : ''}.`,
  } : {
    id: 'runtime-codex-planner',
    status: hasTestActionFixtures ? 'warn' : 'fail',
    category: 'planner',
    message: `Runtime Codex text planner config is incomplete: missing ${missingRuntimePlannerConfig.join(', ')}.`,
    repairAction: [
      'Set SCIFORGE_RUNTIME_API_KEY in the service environment or ignored local config.',
      'Set SCIFORGE_PROXY_UPSTREAM_BASE_URL or SCIFORGE_RUNTIME_BASE_URL in the service environment or ignored local config.',
      'Start or verify the provider proxy with SCIFORGE_PROXY_PORT=3891.',
      'Then rerun computer-use-next:preflight without --actions-json before attempting a real CU-NEXT scenario.',
    ].join(' '),
  });

  checks.push({
    id: 'grounding-translator',
    status: hasTestActionFixtures ? 'warn' : 'pass',
    category: 'grounding-translator',
    message: hasTestActionFixtures
      ? 'Model Router grounding translator is the default; test-only fixture actions bypass live grounding.'
      : 'Model Router grounding translator capability is the default Computer Use grounding path.',
  });

  const highRiskAllowed = /^(?:1|true|yes)$/i.test(firstString(process.env.SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS, ...configCandidates.map((config) => getConfigString(config, ['visionSense', 'allowHighRiskActions']))) || '');
  checks.push(highRiskAllowed ? {
    id: 'high-risk-boundary',
    status: 'fail',
    category: 'safety-boundary',
    message: 'High-risk actions are globally allowed, which violates CU-LONG fail-closed defaults.',
    repairAction: 'Unset SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS for T084 runs unless an explicit confirmation test requires it.',
  } : {
    id: 'high-risk-boundary',
    status: 'pass',
    category: 'safety-boundary',
    message: 'High-risk actions default to fail-closed.',
  });

  const ok = checks.every((check) => check.status !== 'fail');
  const report = renderPreflightReport({ ok, scenarioIds, dryRun, workspacePath, checks });
  const reportPath = options.out ? resolve(options.out) : undefined;
  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, report);
  }
  return { ok, scenarioIds, dryRun, checks, reportPath };
}

function runtimeCodexApiKey(localProviderCandidates: Array<ReturnType<typeof localProviderSettings>>) {
  if (process.env.SCIFORGE_RUNTIME_API_KEY !== undefined) {
    return firstString(process.env.SCIFORGE_RUNTIME_API_KEY);
  }
  return firstString(...localProviderCandidates.map((settings) => settings.apiKey));
}

function runtimeCodexUpstreamBaseUrl(
  configCandidates: Array<Record<string, unknown>>,
  localProviderCandidates: Array<ReturnType<typeof localProviderSettings>>,
) {
  if (process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL !== undefined) {
    return firstString(process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL);
  }
  if (process.env.SCIFORGE_RUNTIME_BASE_URL !== undefined) {
    return firstString(process.env.SCIFORGE_RUNTIME_BASE_URL);
  }
  return firstString(
    ...configCandidates.flatMap((config) => [
      getConfigString(config, ['llm', 'baseUrl']),
      getConfigString(config, ['llm', 'upstreamBaseUrl']),
      getConfigString(config, ['codexProxy', 'upstreamBaseUrl']),
      getConfigString(config, ['codexProxy', 'baseUrl']),
      getConfigString(config, ['runtimeCodexProxy', 'upstreamBaseUrl']),
      getConfigString(config, ['runtimeCodexProxy', 'baseUrl']),
    ]),
    ...localProviderCandidates.map((settings) => settings.baseUrl),
  );
}

function desktopNativeHostEvidence(configCandidates: Array<Record<string, unknown>>) {
  const evidence = firstString(
    process.env.SCIFORGE_VISION_DESKTOP_NATIVE_HOST,
    process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL,
    process.env.SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL,
    process.env.SCIFORGE_VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_MANIFEST,
    ...configCandidates.flatMap((config) => [
      getConfigString(config, ['visionSense', 'desktopNativeHost']),
      getConfigString(config, ['visionSense', 'nativeHostEvidence']),
      getConfigString(config, ['computerUse', 'desktopNativeHost']),
      getConfigString(config, ['computerUse', 'nativeHostEvidence']),
      getConfigString(config, ['desktop', 'nativeHost']),
    ]),
  );
  if (!evidence || /^(?:0|false|no|disabled)$/i.test(evidence)) return undefined;
  return sanitizeDiagnosticUrl(evidence);
}

function sanitizeDiagnosticUrl(value: string) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return stripTrailingSlash(url.toString()) ?? url.toString();
  } catch {
    return redactSensitiveAssignments(redactBearerTokens(stripUrlTail(redactUrlUserinfo(value))));
  }
}

function sanitizeDiagnosticText(value: string) {
  return redactSensitiveAssignments(redactBearerTokens(value.replace(/\bhttps?:\/\/[^\s<>"'`]+/gi, (url) => sanitizeDiagnosticUrl(url))));
}

function redactBearerTokens(value: string) {
  return value.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]');
}

function redactSensitiveAssignments(value: string) {
  return value.replace(/\b(?:token|apiKey|api_key|api-key|secret|password)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;&]+)/gi, '[redacted]');
}

function redactUrlUserinfo(value: string) {
  return value.replace(/\/\/[^/@\s]+@/g, '//');
}

function stripUrlTail(value: string) {
  return value.replace(/[?#].*$/, '');
}

function stripTrailingSlash(value: string | undefined) {
  return value?.replace(/\/+$/, '');
}

function resolveExecutableIndependentInputAdapter(adapter: string | undefined, provider: string | undefined) {
  const config = {
    inputAdapter: adapter,
    independentInputAdapterProvider: provider,
  } as Parameters<typeof executableIndependentInputAdapter>[0];
  const executableAdapter = executableIndependentInputAdapter(config);
  const executionBoundary = independentInputAdapterExecutionBoundary(config);
  return executableAdapter && executionBoundary
    ? {
        adapter: executableAdapter,
        provider: executionBoundary.replace(/-input-adapter$/, ''),
        executionBoundary,
      }
    : undefined;
}

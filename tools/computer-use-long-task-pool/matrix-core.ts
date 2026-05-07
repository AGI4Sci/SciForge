import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type {
  ComputerUseLongMatrixReport,
  ComputerUseLongMatrixRunResult,
  ComputerUseLongMatrixValidation,
  ComputerUseLongPreflightResult,
  ComputerUseLongRepairPlan,
} from './contracts.js';
import { loadComputerUseLongTaskPool, prepareComputerUseLongRun, validateComputerUseLongTaskPool } from './task-pool.js';
import { runComputerUseLongScenario, validateComputerUseLongRun } from './run-core.js';
import {
  categorizeComputerUseIssue,
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
  visionModelConfigIssue,
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
    const summary: ComputerUseLongMatrixRunResult = {
      summaryPath,
      status: 'repair-needed',
      scenarioIds,
      passedScenarioIds: [],
      repairNeededScenarioIds: scenarioIds,
      executionPlan,
      preflight,
      results,
    };
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
    const validation = await validateComputerUseLongRun({
      manifestPath: prepared.manifestPath,
      requirePassed: scenarioRun.status === 'passed',
    });
    const issues = await collectScenarioRunIssues(scenarioRun, validation);
    return {
      scenarioId,
      manifestPath: prepared.manifestPath,
      runStatus: scenarioRun.status,
      validationOk: validation.ok,
      summaryPath: scenarioRun.summaryPath,
      issues,
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
  const summary: ComputerUseLongMatrixRunResult = {
    summaryPath,
    status,
    scenarioIds,
    passedScenarioIds,
    repairNeededScenarioIds,
    executionPlan,
    preflight,
    results,
  };
  await writeMatrixSummary(summaryPath, matrixId, summary);
  return summary;
}

export async function renderComputerUseLongMatrixReport(options: {
  summaryPath: string;
  out?: string;
}): Promise<ComputerUseLongMatrixReport> {
  const summaryPath = resolve(options.summaryPath);
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
  summaryPath: string;
}): Promise<ComputerUseLongMatrixValidation> {
  const summaryPath = resolve(options.summaryPath);
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

  const preflight = isRecord(summary.preflight) ? summary.preflight : undefined;
  const preflightChecks = preflight && Array.isArray(preflight.checks) ? preflight.checks.filter(isRecord) : [];
  const preflightFailedChecks = preflightChecks.filter((check) => check.status === 'fail').length;
  if (preflight && preflight.ok === false && status !== 'repair-needed') issues.push('failed preflight must force matrix status repair-needed');
  if (preflight && preflight.ok === false && Array.isArray(summary.results) && summary.results.length > 0) {
    issues.push('failed preflight matrix must not execute scenario results');
  }
  if (preflight && preflight.ok === false && preflightFailedChecks === 0) issues.push('failed preflight must include failed checks');

  const results = Array.isArray(summary.results) ? summary.results.filter(isRecord) : [];
  let validatedRuns = 0;
  for (const result of results) {
    const scenarioId = String(result.scenarioId || '');
    if (!scenarioIds.includes(scenarioId)) issues.push(`result scenario ${scenarioId || '<missing>'} was not selected`);
    const manifestPath = typeof result.manifestPath === 'string' ? result.manifestPath : '';
    if (!manifestPath) {
      issues.push(`result ${scenarioId || '<missing>'} missing manifestPath`);
      continue;
    }
    const validation = await validateComputerUseLongRun({
      manifestPath,
      requirePassed: result.runStatus === 'passed',
    });
    validatedRuns += 1;
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

export async function renderComputerUseLongRepairPlan(options: {
  summaryPath: string;
  out?: string;
}): Promise<ComputerUseLongRepairPlan> {
  const summaryPath = resolve(options.summaryPath);
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
  const configCandidates = [
    await readOptionalJson(resolve('config.local.json')),
    await readOptionalJson(resolve(workspacePath, '.sciforge', 'config.json')),
  ].filter(isRecord);
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
  const allowSharedSystemInput = /^1|true|yes$/i.test(process.env.SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT || '');
  const independentInputReady = Boolean(independentInputAdapter && /virtual-hid|remote-desktop|browser-sandbox|accessibility-per-window/i.test(independentInputAdapter));
  const independentInputExecutable = false;
  checks.push(dryRun ? {
    id: 'input-isolation',
    status: 'pass',
    category: 'scheduler',
    message: 'Dry-run uses a virtual input channel and cannot move the user pointer or type on the user keyboard.',
  } : independentInputReady && independentInputExecutable ? {
    id: 'input-isolation',
    status: 'pass',
    category: 'scheduler',
    message: `Independent input adapter is configured: ${independentInputAdapter}.`,
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
    repairAction: 'Prefer SCIFORGE_VISION_INPUT_ADAPTER=virtual-hid, remote-desktop, browser-sandbox, or accessibility-per-window before running full real CU-LONG matrices.',
  } : {
    id: 'input-isolation',
    status: 'fail',
    category: 'scheduler',
    message: 'Real run has no independent input adapter and shared system input is not explicitly allowed.',
    repairAction: 'Configure SCIFORGE_VISION_INPUT_ADAPTER=virtual-hid|remote-desktop|browser-sandbox|accessibility-per-window, or set SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT=1 for an explicitly acknowledged focused-window real smoke only.',
  });

  const hasStaticActions = Boolean(options.actionsJson?.trim());
  if (hasStaticActions) {
    checks.push({
      id: 'static-actions',
      status: 'warn',
      category: 'planner',
      message: '--actions-json is set; this is useful for smoke but bypasses real VisionPlanner behavior.',
      repairAction: 'Omit --actions-json for real CU-LONG matrix runs.',
    });
  }
  const plannerBaseUrl = firstString(
    process.env.SCIFORGE_VISION_PLANNER_BASE_URL,
    ...configCandidates.flatMap((config) => [
      getConfigString(config, ['visionSense', 'plannerBaseUrl']),
      getConfigString(config, ['modelBaseUrl']),
      getConfigString(config, ['llm', 'baseUrl']),
      getConfigString(config, ['llmEndpoint', 'baseUrl']),
    ]),
  );
  const plannerApiKey = firstString(
    process.env.SCIFORGE_VISION_PLANNER_API_KEY,
    ...configCandidates.flatMap((config) => [
      getConfigString(config, ['visionSense', 'plannerApiKey']),
      getConfigString(config, ['apiKey']),
      getConfigString(config, ['llm', 'apiKey']),
      getConfigString(config, ['llmEndpoint', 'apiKey']),
    ]),
  );
  const plannerModel = firstString(
    process.env.SCIFORGE_VISION_PLANNER_MODEL,
    ...configCandidates.flatMap((config) => [
      getConfigString(config, ['visionSense', 'plannerModel']),
      getConfigString(config, ['visionSense', 'visionPlannerModel']),
      getConfigString(config, ['visionSense', 'vlmModel']),
      getConfigString(config, ['visionSense', 'visionModel']),
      getConfigString(config, ['plannerModel']),
      getConfigString(config, ['visionPlannerModel']),
      getConfigString(config, ['vlmModel']),
      getConfigString(config, ['visionModel']),
    ]),
  );
  const plannerReady = Boolean(plannerBaseUrl && plannerApiKey && plannerModel);
  const plannerModelIssue = visionModelConfigIssue(plannerModel);
  checks.push(plannerReady ? {
    id: 'vision-planner',
    status: plannerModelIssue ? 'fail' : hasStaticActions ? 'warn' : 'pass',
    category: 'planner',
    message: plannerModelIssue ? `VisionPlanner model is not vision-capable: ${plannerModelIssue}` : hasStaticActions ? 'VisionPlanner config exists, but static actions will bypass it.' : 'OpenAI-compatible VisionPlanner config is present.',
    repairAction: plannerModelIssue ? 'Set visionSense.plannerModel or SCIFORGE_VISION_PLANNER_MODEL to a VLM such as qwen3.6-plus.' : undefined,
  } : {
    id: 'vision-planner',
    status: hasStaticActions ? 'warn' : 'fail',
    category: 'planner',
    message: 'VisionPlanner config is incomplete.',
    repairAction: 'Set SCIFORGE_VISION_PLANNER_BASE_URL/API_KEY/MODEL or configure llm.baseUrl/apiKey/model.',
  });

  const kvGrounderUrl = firstString(process.env.SCIFORGE_VISION_KV_GROUND_URL, ...configCandidates.map((config) => getConfigString(config, ['visionSense', 'grounderBaseUrl'])));
  const visualGrounderBaseUrl = firstString(
    process.env.SCIFORGE_VISION_GROUNDER_LLM_BASE_URL,
    ...configCandidates.map((config) => getConfigString(config, ['visionSense', 'visualGrounderBaseUrl'])),
    plannerBaseUrl,
  );
  const visualGrounderModel = firstString(
    process.env.SCIFORGE_VISION_GROUNDER_LLM_MODEL,
    ...configCandidates.flatMap((config) => [
      getConfigString(config, ['visionSense', 'visualGrounderModel']),
      getConfigString(config, ['visionSense', 'grounderVisionModel']),
      getConfigString(config, ['visualGrounderModel']),
      getConfigString(config, ['grounderVisionModel']),
    ]),
    plannerModel,
  );
  const visualGrounderApiKey = firstString(
    process.env.SCIFORGE_VISION_GROUNDER_LLM_API_KEY,
    ...configCandidates.map((config) => getConfigString(config, ['visionSense', 'visualGrounderApiKey'])),
    plannerApiKey,
  );
  const grounderReady = Boolean(kvGrounderUrl || (visualGrounderBaseUrl && visualGrounderApiKey && visualGrounderModel));
  const visualGrounderModelIssue = kvGrounderUrl ? '' : visionModelConfigIssue(visualGrounderModel);
  checks.push(grounderReady ? {
    id: 'grounder',
    status: visualGrounderModelIssue ? 'fail' : hasStaticActions ? 'warn' : 'pass',
    category: 'grounder',
    message: visualGrounderModelIssue ? `Visual Grounder fallback model is not vision-capable: ${visualGrounderModelIssue}` : kvGrounderUrl ? 'KV-Ground-compatible endpoint is configured.' : 'OpenAI-compatible visual Grounder fallback is configured.',
    repairAction: visualGrounderModelIssue ? 'Prefer SCIFORGE_VISION_KV_GROUND_URL for your self-hosted KV-Ground, or set SCIFORGE_VISION_GROUNDER_LLM_MODEL to a VLM such as qwen3.6-plus.' : undefined,
  } : {
    id: 'grounder',
    status: hasStaticActions ? 'warn' : 'fail',
    category: 'grounder',
    message: 'No Grounder config was found.',
    repairAction: 'Set SCIFORGE_VISION_KV_GROUND_URL or SCIFORGE_VISION_GROUNDER_LLM_BASE_URL/API_KEY/MODEL.',
  });

  const highRiskAllowed = /^1|true|yes$/i.test(firstString(process.env.SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS, ...configCandidates.map((config) => getConfigString(config, ['visionSense', 'allowHighRiskActions']))) || '');
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

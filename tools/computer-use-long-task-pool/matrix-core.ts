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
  const localConfigPath = process.env.SCIFORGE_CONFIG_PATH?.trim()
    ? resolve(process.env.SCIFORGE_CONFIG_PATH)
    : resolve('config.local.json');
  const configCandidates = [
    await readOptionalJson(localConfigPath),
    await readOptionalJson(resolve(workspacePath, '.sciforge', 'config.json')),
    await readOptionalJson(resolve(workspacePath, '.sciforge', 'config.local.json')),
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
  const independentInputExecutable = isExecutableIndependentInputAdapter(independentInputAdapter, independentInputAdapterProvider);
  checks.push(dryRun ? {
    id: 'input-isolation',
    status: 'pass',
    category: 'scheduler',
    message: 'Dry-run uses a virtual input channel and cannot move the user pointer or type on the user keyboard.',
  } : independentInputReady && independentInputExecutable ? {
    id: 'input-isolation',
    status: 'pass',
    category: 'scheduler',
    message: `Independent input adapter is configured and executable: ${independentInputAdapter} via ${independentInputAdapterProvider}.`,
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
  const runtimeApiKeyReady = Boolean(firstString(process.env.SCIFORGE_RUNTIME_API_KEY));
  const runtimeUpstreamBaseUrlReady = Boolean(runtimeCodexUpstreamBaseUrl(configCandidates));
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
      'Set SCIFORGE_RUNTIME_API_KEY in the service environment, not via config-file secret fallback.',
      'Set SCIFORGE_PROXY_UPSTREAM_BASE_URL or SCIFORGE_RUNTIME_BASE_URL in the service environment or ignored local config.',
      'Start or verify the provider proxy with SCIFORGE_PROXY_PORT=3891.',
      'Then rerun computer-use-next:preflight without --actions-json before attempting a real CU-NEXT scenario.',
    ].join(' '),
  });

  const kvGrounderUrl = stripTrailingSlash(firstString(process.env.SCIFORGE_VISION_KV_GROUND_URL, ...configCandidates.map((config) => getConfigString(config, ['visionSense', 'grounderBaseUrl']))));
  if (!kvGrounderUrl) {
    checks.push({
      id: 'grounder',
      status: hasTestActionFixtures ? 'warn' : 'pass',
      category: 'grounder',
      message: 'Model Router grounding translator capability is the default; no legacy KV-Ground config is required.',
    });
  } else if (dryRun || hasTestActionFixtures) {
    checks.push({
      id: 'grounder',
      status: hasTestActionFixtures ? 'warn' : 'pass',
      category: 'grounder',
      message: 'Legacy KV-Ground-compatible endpoint is configured; live health is not required for dry-run or fixture actions.',
    });
  } else {
    const health = await checkKvGroundHealth(kvGrounderUrl);
    checks.push(health.ok ? {
      id: 'grounder',
      status: 'pass',
      category: 'grounder',
      message: `Legacy KV-Ground health check passed at ${health.healthUrl}.`,
    } : {
      id: 'grounder',
      status: 'fail',
      category: 'grounder',
      message: `Legacy KV-Ground health check failed at ${health.healthUrl}: ${health.reason}.`,
      repairAction: 'Unset SCIFORGE_VISION_KV_GROUND_URL to use the default Model Router grounding translator, or start the explicit legacy KV-Ground endpoint and verify its /health route.',
    });
  }

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

function runtimeCodexUpstreamBaseUrl(configCandidates: Array<Record<string, unknown>>) {
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
  );
}

async function checkKvGroundHealth(baseUrl: string): Promise<{ ok: true; healthUrl: string } | { ok: false; healthUrl: string; reason: string }> {
  const healthUrl = kvGroundHealthUrl(baseUrl);
  const diagnosticHealthUrl = sanitizeDiagnosticUrl(healthUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const fail = (reason: string) => ({
    ok: false as const,
    healthUrl: diagnosticHealthUrl,
    reason: sanitizeDiagnosticText(reason),
  });
  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    if (!response.ok) return fail(`HTTP ${response.status}`);
    const text = await response.text();
    const payload = parseJson(text);
    if (!isRecord(payload)) return fail('response was not JSON');
    if (payload.ok !== true) return fail(`response ok=${String(payload.ok)}`);
    return { ok: true, healthUrl: diagnosticHealthUrl };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

function kvGroundHealthUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/health`;
    return url.toString();
  } catch {
    return `${baseUrl}/health`;
  }
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

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isExecutableIndependentInputAdapter(adapter: string | undefined, provider: string | undefined) {
  const normalizedAdapter = adapter?.trim().toLowerCase().replace(/[_\s]+/g, '-');
  const normalizedProvider = provider?.trim().toLowerCase().replace(/[_\s]+/g, '-');
  return normalizedAdapter === 'remote-desktop'
    && (normalizedProvider === 'sciforge-simulated-remote-desktop' || normalizedProvider === 'simulated-remote-desktop');
}

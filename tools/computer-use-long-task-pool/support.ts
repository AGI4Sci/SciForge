import { spawn } from 'node:child_process';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type {
  ComputerUseLongMatrixRunResult,
  ComputerUseLongPreflightResult,
  ComputerUseLongRoundRunResult,
  ComputerUseLongRunValidation,
  ComputerUseLongScenario,
  ComputerUseLongScenarioRunResult,
  ComputerUseLongTraceValidation,
  PreparedComputerUseLongRun,
} from './contracts.js';

export async function withTaskPoolHardTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function renderScenarioSummary(
  manifest: PreparedComputerUseLongRun,
  scenario: ComputerUseLongScenario,
  roundResults: ComputerUseLongRoundRunResult[],
) {
  return {
    schemaVersion: 'sciforge.computer-use-long.scenario-summary.v1',
    taskId: manifest.taskId,
    scenarioId: manifest.scenarioId,
    title: manifest.title,
    status: manifest.status,
    minRounds: scenario.minRounds,
    requiredPipeline: manifest.universalPipeline,
    validationContract: manifest.validationContract,
    safetyBoundary: manifest.safetyBoundary,
    acceptance: manifest.acceptance,
    attemptedRounds: roundResults.map((item) => item.round),
    passedRounds: roundResults.filter((item) => item.status === 'passed').map((item) => item.round),
    repairNeededRound: roundResults.find((item) => item.status !== 'passed')?.round,
    rounds: manifest.rounds.map((round) => ({
      round: round.round,
      status: round.status,
      visionTraceRef: round.visionTraceRef,
      screenshotCount: round.screenshotRefs.length,
      actionLedgerRefs: round.actionLedgerRefs,
      failureDiagnosticsRefs: round.failureDiagnosticsRefs,
      observedBehavior: round.observedBehavior,
    })),
  };
}

export async function writeMatrixSummary(summaryPath: string, matrixId: string, summary: ComputerUseLongMatrixRunResult) {
  await writeFile(summaryPath, `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use-long.matrix-summary.v1',
    taskId: 'T084',
    matrixId,
    status: summary.status,
    scenarioIds: summary.scenarioIds,
    passedScenarioIds: summary.passedScenarioIds,
    repairNeededScenarioIds: summary.repairNeededScenarioIds,
    executionPlan: summary.executionPlan,
    preflight: summary.preflight ? {
      ok: summary.preflight.ok,
      dryRun: summary.preflight.dryRun,
      scenarioIds: summary.preflight.scenarioIds,
      reportPath: summary.preflight.reportPath,
      checks: summary.preflight.checks,
    } : undefined,
    results: summary.results,
  }, null, 2)}\n`);
}

function matrixExecutionPlan(dryRun: boolean, scenarioCount: number, requestedMaxConcurrency: number | undefined): NonNullable<ComputerUseLongMatrixRunResult['executionPlan']> {
  if (!dryRun) {
    return {
      mode: 'serialized-real-gui',
      maxConcurrency: 1,
      realGuiSerialized: true,
      reason: 'Real GUI execution may share displays and input devices, so scenarios run one at a time behind window locks.',
    };
  }
  const maxConcurrency = Math.max(1, Math.min(scenarioCount || 1, requestedMaxConcurrency ?? Math.min(4, scenarioCount || 1)));
  return {
    mode: 'parallel-analysis',
    maxConcurrency,
    realGuiSerialized: true,
    reason: 'Dry-run scenarios produce file-ref evidence without touching real GUI input, so planner/grounder/verifier analysis can run concurrently.',
  };
}

export async function matrixExecutionPlanFromVisionSense(dryRun: boolean, scenarioCount: number, requestedMaxConcurrency: number | undefined): Promise<NonNullable<ComputerUseLongMatrixRunResult['executionPlan']>> {
  const result = await runVisionSensePythonJson('sciforge_vision_sense.computer_use_policy', {
    mode: 'matrix-execution-plan',
    dryRun,
    scenarioCount,
    requestedMaxConcurrency,
  });
  if (isRecord(result) && typeof result.mode === 'string' && typeof result.maxConcurrency === 'number') {
    return result as NonNullable<ComputerUseLongMatrixRunResult['executionPlan']>;
  }
  return matrixExecutionPlan(dryRun, scenarioCount, requestedMaxConcurrency);
}

export async function mapWithConcurrency<T, R>(items: T[], maxConcurrency: number, run: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(maxConcurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await run(items[index], index);
    }
  }));
  return results;
}

export function renderMatrixReportMarkdown(
  summaryPath: string,
  summary: Record<string, unknown>,
  results: Record<string, unknown>[],
  issueCategories: Record<string, number>,
) {
  const status = String(summary.status || 'unknown');
  const scenarioIds = Array.isArray(summary.scenarioIds) ? summary.scenarioIds.map(String) : [];
  const passedScenarioIds = Array.isArray(summary.passedScenarioIds) ? summary.passedScenarioIds.map(String) : [];
  const repairNeededScenarioIds = Array.isArray(summary.repairNeededScenarioIds) ? summary.repairNeededScenarioIds.map(String) : [];
  const preflight = isRecord(summary.preflight) ? summary.preflight : undefined;
  const lines = [
    '# T084 Computer Use Matrix Report',
    '',
    `Summary: ${manifestRel(process.cwd(), summaryPath)}`,
    `Status: ${status}`,
    `Scenarios: ${scenarioIds.join(', ') || 'none'}`,
    `Passed: ${passedScenarioIds.join(', ') || 'none'}`,
    `Repair needed: ${repairNeededScenarioIds.join(', ') || 'none'}`,
    '',
    '## Preflight',
  ];
  if (!preflight) {
    lines.push('- not recorded');
  } else {
    lines.push(`- ok: ${Boolean(preflight.ok)}`);
    lines.push(`- dryRun: ${Boolean(preflight.dryRun)}`);
    const checks = Array.isArray(preflight.checks) ? preflight.checks.filter(isRecord) : [];
    const failed = checks.filter((check) => check.status === 'fail');
    const warned = checks.filter((check) => check.status === 'warn');
    lines.push(`- failed checks: ${failed.length}`);
    lines.push(`- warnings: ${warned.length}`);
    for (const check of failed) lines.push(`  - [${String(check.category || 'unknown')}] ${String(check.message || '')}`);
  }
  lines.push(
    '',
    '## Genericity Rules Rechecked',
    '- All evidence must come from WindowTarget -> VisionPlanner -> Grounder -> GuiExecutor -> Verifier -> vision-trace.',
    '- WindowTarget must select a concrete target window before planning, and all coordinates must be window-local.',
    '- Screenshot refs must be window screenshots with window identity, bounds, dimensions, and sha256 metadata.',
    '- GUI execution must record the generic input channel and serialized scheduler metadata.',
    '- Screenshot memory must remain file-ref-only; no base64/dataUrl payloads.',
    '- DOM/accessibility/app-private shortcuts are invalid for this matrix.',
    '- High-risk actions must fail closed unless explicit upstream confirmation is recorded.',
    '',
    '## Issue Categories',
  );
  if (!Object.keys(issueCategories).length) {
    lines.push('- none');
  } else {
    for (const [category, count] of Object.entries(issueCategories).sort()) lines.push(`- ${category}: ${count}`);
  }
  lines.push('', '## Scenario Results');
  for (const result of results) {
    const scenarioId = String(result.scenarioId || 'unknown');
    const runStatus = String(result.runStatus || 'unknown');
    const validationOk = Boolean(result.validationOk);
    const manifestPath = typeof result.manifestPath === 'string' ? result.manifestPath : '';
    const scenarioSummaryPath = typeof result.summaryPath === 'string' ? result.summaryPath : '';
    const issues = Array.isArray(result.issues) ? result.issues.map(String) : [];
    lines.push(`### ${scenarioId}`);
    lines.push(`- runStatus: ${runStatus}`);
    lines.push(`- validationOk: ${validationOk}`);
    if (manifestPath) lines.push(`- manifest: ${manifestPath}`);
    if (scenarioSummaryPath) lines.push(`- scenarioSummary: ${scenarioSummaryPath}`);
    if (!issues.length) {
      lines.push('- issues: none');
    } else {
      lines.push('- issues:');
      for (const issue of issues) lines.push(`  - [${categorizeComputerUseIssue(issue)}] ${issue}`);
      lines.push('- next repair focus:');
      for (const action of repairActionsForIssues(issues)) lines.push(`  - ${action}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderPreflightReport(params: {
  ok: boolean;
  scenarioIds: string[];
  dryRun: boolean;
  workspacePath: string;
  checks: ComputerUseLongPreflightResult['checks'];
}) {
  const lines = [
    '# T084 Computer Use Preflight',
    '',
    `Status: ${params.ok ? 'passed' : 'failed'}`,
    `Mode: ${params.dryRun ? 'dry-run' : 'real'}`,
    `Workspace: ${params.workspacePath}`,
    `Scenarios: ${params.scenarioIds.join(', ') || 'none'}`,
    '',
    '## Checks',
  ];
  for (const check of params.checks) {
    lines.push(`- [${check.status}] ${check.category}/${check.id}: ${check.message}`);
    if (check.repairAction) lines.push(`  repair: ${check.repairAction}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderRepairPlanMarkdown(summaryPath: string, summary: Record<string, unknown>) {
  const lines = [
    '# T084 Computer Use Repair Plan',
    '',
    `Summary: ${summaryPath}`,
    `Status: ${String(summary.status || 'unknown')}`,
    '',
  ];
  const actions: string[] = [];
  const preflight = isRecord(summary.preflight) ? summary.preflight : undefined;
  const failedChecks = preflight && Array.isArray(preflight.checks)
    ? preflight.checks.filter(isRecord).filter((check) => check.status === 'fail')
    : [];
  for (const check of failedChecks) {
    actions.push(`[preflight/${String(check.category || 'unknown')}] ${String(check.message || '')} Repair: ${String(check.repairAction || 'Fix the failed preflight check and rerun the matrix.')}`);
  }
  const results = Array.isArray(summary.results) ? summary.results.filter(isRecord) : [];
  for (const result of results) {
    const scenarioId = String(result.scenarioId || 'unknown');
    const manifestPath = typeof result.manifestPath === 'string' ? result.manifestPath : '';
    const issues = Array.isArray(result.issues) ? result.issues.map(String) : [];
    const byCategory = new Map<string, string[]>();
    for (const issue of issues) {
      const category = categorizeComputerUseIssue(issue);
      byCategory.set(category, [...(byCategory.get(category) ?? []), issue]);
    }
    for (const [category, categoryIssues] of byCategory) {
      const repair = repairActionsForIssues(categoryIssues).join(' ');
      const firstIssue = categoryIssues[0];
      actions.push(`[${scenarioId}/${category}] ${firstIssue} Repair: ${repair}${manifestPath ? ` Then rerun: npm run computer-use-long:validate-run -- --manifest ${manifestPath}` : ''}`);
    }
  }
  if (!actions.length) {
    lines.push('No repair actions are required. The matrix is passed and evidence is self-consistent.', '');
    return `${lines.join('\n').trimEnd()}\n`;
  }
  lines.push('## Ordered Actions');
  actions.forEach((action, index) => lines.push(`${index + 1}. ${action}`));
  lines.push('', '## Rerun Commands');
  lines.push(`- npm run computer-use-long:validate-matrix -- --summary ${summaryPath}`);
  lines.push(`- npm run computer-use-long:matrix-report -- --summary ${summaryPath}`);
  const repairNeededScenarioIds = Array.isArray(summary.repairNeededScenarioIds) ? summary.repairNeededScenarioIds.map(String) : [];
  if (repairNeededScenarioIds.length) lines.push(`- npm run computer-use-long:run-matrix -- --scenarios ${repairNeededScenarioIds.join(',')}`);
  return `${lines.join('\n').trimEnd()}\n`;
}

export function categorizeComputerUseIssue(issue: string) {
  if (/planner|planning|VisionPlanner/i.test(issue)) return 'planner';
  if (/windowTarget|window target|target window|window-local|window screenshot|displayId|window bounds/i.test(issue)) return 'window-target';
  if (/ground|coordinate|targetDescription|KV-Ground/i.test(issue)) return 'grounder';
  if (/executor|execution|mouse|keyboard|click|drag|scroll|type_text|System Events|CGEvent|osascript|Swift/i.test(issue)) return 'executor';
  if (/input-channel|inputChannel|scheduler|serialized|ordered/i.test(issue)) return 'scheduler';
  if (/verifier|pixel|checked/i.test(issue)) return 'verifier';
  if (/trace|vision-trace|schemaVersion|action schema|plannedAction/i.test(issue)) return 'trace';
  if (/screenshot|png|image|base64|dataUrl|file-ref|image memory/i.test(issue)) return 'image-memory';
  if (/DOM|accessibility|selector|aria|xpath|css|private/i.test(issue)) return 'genericity-boundary';
  if (/high-risk|confirmation|blocked|send|delete|pay|authorize|publish|submit/i.test(issue)) return 'safety-boundary';
  if (/ledger|diagnostic|manifest|summary|runtime prompt|evidence/i.test(issue)) return 'evidence-ledger';
  return 'other';
}

export async function collectScenarioRunIssues(
  scenarioRun: ComputerUseLongScenarioRunResult,
  validation: ComputerUseLongRunValidation,
) {
  const issues = dedupeStrings(validation.issues);
  for (const round of scenarioRun.roundResults) {
    if (round.status === 'passed') continue;
    const diagnostics = await readOptionalJson(round.failureDiagnosticsPath);
    const diagnosticIssue = scenarioRoundDiagnosticIssue(round, diagnostics);
    if (diagnosticIssue) issues.push(diagnosticIssue);
    for (const issue of round.validation?.issues ?? []) issues.push(`round ${round.round} trace: ${issue}`);
  }
  if (scenarioRun.status !== 'passed' && !issues.length) {
    issues.push(`scenario ${scenarioRun.scenarioId} ended with status ${scenarioRun.status}`);
  }
  return dedupeStrings(issues);
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim())));
}

function scenarioRoundDiagnosticIssue(round: ComputerUseLongRoundRunResult, diagnostics: unknown) {
  if (!isRecord(diagnostics)) {
    return `round ${round.round} ${round.status}: failure diagnostics missing or unreadable at ${round.failureDiagnosticsPath}`;
  }
  const failureReason = firstString(diagnostics.failureReason);
  const status = firstString(diagnostics.status) || round.status;
  const message = firstString(diagnostics.message, round.payloadMessage);
  const executionFailure = firstExecutionFailure(diagnostics);
  const detail = firstString(failureReason, executionFailure, message, `round ended with status ${status}`);
  return `round ${round.round} ${status}: ${detail}`;
}

function firstExecutionFailure(diagnostics: Record<string, unknown>) {
  const units = Array.isArray(diagnostics.executionUnits) ? diagnostics.executionUnits.filter(isRecord) : [];
  for (const unit of units) {
    const failureReason = firstString(unit.failureReason);
    if (failureReason) return failureReason;
    const records = Array.isArray(unit.traceRecords) ? unit.traceRecords.filter(isRecord) : [];
    for (const record of records) {
      const execution = isRecord(record.execution) ? record.execution : undefined;
      const stderr = firstString(execution?.stderr, execution?.stdout);
      if (stderr) return stderr;
    }
  }
  return undefined;
}

function repairActionsForIssues(issues: string[]) {
  const categories = new Set(issues.map(categorizeComputerUseIssue));
  const actions: string[] = [];
  if (categories.has('window-target')) actions.push('Ensure WindowTarget selects the concrete app/window first, captures window screenshots, and maps every point in window-local coordinates.');
  if (categories.has('planner')) actions.push('Inspect planner prompt/output JSON and ensure it emits generic action schema without coordinates or app-private fields.');
  if (categories.has('grounder')) actions.push('Check KV-Ground or visual Grounder configuration and ensure screenshot paths are readable by the Grounder.');
  if (categories.has('executor')) actions.push('Verify the generic mouse/keyboard executor, coordinate scale, display selection, and dry-run/real-run mode.');
  if (categories.has('scheduler')) actions.push('Record generic input-channel metadata and serialize window actions with before/after screenshot boundaries.');
  if (categories.has('verifier')) actions.push('Strengthen step verifier evidence so every GUI action has after-screenshot and pixel/state validation.');
  if (categories.has('trace')) actions.push('Fix vision-trace schema emission before updating manifests or summaries.');
  if (categories.has('image-memory')) actions.push('Repair screenshot file refs, PNG metadata, sha256, and remove any inline image payloads.');
  if (categories.has('genericity-boundary')) actions.push('Remove DOM/accessibility/app-private fields and route through screenshot-based Computer Use only.');
  if (categories.has('safety-boundary')) actions.push('Keep high-risk actions blocked unless explicit confirmation is represented before executor runs.');
  if (categories.has('evidence-ledger')) actions.push('Regenerate action ledger, failure diagnostics, runtime prompt, and scenario summary from real run artifacts.');
  if (!actions.length) actions.push('Inspect the scenario manifest and trace validator issues, then repair the first failed round before continuing.');
  return actions;
}

export function firstString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export function getConfigString(config: Record<string, unknown>, path: string[]) {
  let cursor: unknown = config;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return firstString(cursor);
}

export function visionModelConfigIssue(model: string | undefined) {
  if (!model) return 'missing explicit vision model';
  const normalized = model.trim().toLowerCase();
  if (/deepseek[-_/]?v?4|deepseek[-_/]?v?3|deepseek[-_/]?r1/.test(normalized) && !/vision|vl|qwen-vl/.test(normalized)) {
    return `model "${model}" appears to be text-only`;
  }
  return '';
}

export async function renderRoundRuntimePrompt(
  manifest: PreparedComputerUseLongRun,
  round: PreparedComputerUseLongRun['rounds'][number],
  manifestDir: string,
  suffix?: string,
) {
  const priorEvidence = await renderPriorRoundEvidence(manifest, round.round, manifestDir);
  return [
    `[T084 ${manifest.scenarioId} round ${round.round}] ${round.prompt}`,
    '',
    'You must use the generic Computer Use pipeline only: WindowTarget -> VisionPlanner -> Grounder -> GuiExecutor -> Verifier -> vision-trace.',
    'WindowTarget must select the target window first; every screenshot ref must be a window screenshot with window id/title, bounds, sha256, width, and height.',
    'Grounding and executor coordinates must be window-local, and every GUI action must record the generic mouse/keyboard input channel plus serialized scheduler metadata.',
    'Do not inspect DOM, accessibility trees, application private APIs, files, source code, or app-specific shortcuts to complete the GUI task.',
    'Use screenshots as visual input, generic target descriptions for visual targets, and only generic mouse/keyboard actions.',
    'Store image memory as screenshot file refs only; never put base64/dataUrl screenshots into the trace or multi-turn memory.',
    'Fail closed before any high-risk send/delete/pay/authorize/publish/submit action unless explicit upstream confirmation is present.',
    priorEvidence,
    `Expected trace evidence: ${round.expectedTrace.join('; ')}`,
    suffix ? `Additional operator note: ${suffix}` : '',
  ].filter(Boolean).join('\n');
}

async function renderPriorRoundEvidence(manifest: PreparedComputerUseLongRun, currentRound: number, manifestDir: string) {
  const priorRounds = manifest.rounds.filter((item) => item.round < currentRound && item.status === 'passed');
  if (!priorRounds.length) return '';
  const lines = [
    'Vision temporary memory policy: file-ref-only.',
    'Compact prior-round file refs for follow-up image memory. Reuse the vision-sense visual memory block as context only; do not inline image bytes:',
  ];
  const memoryBlock = await buildVisualMemoryBlockFromVisionSense(priorRounds, manifestDir);
  if (memoryBlock) lines.push(memoryBlock);
  if (!memoryBlock) lines.push(await buildFallbackVisualMemoryBlock(priorRounds, manifestDir));
  for (const prior of priorRounds) {
    if (prior.visionTraceRef) lines.push(`- round ${prior.round} trace=${prior.visionTraceRef}`);
    for (const ref of prior.actionLedgerRefs) lines.push(`- round ${prior.round} actionLedger: ${ref}`);
    for (const ref of prior.failureDiagnosticsRefs) lines.push(`- round ${prior.round} failureDiagnostics: ${ref}`);
  }
  return lines.join('\n');
}

async function buildFallbackVisualMemoryBlock(priorRounds: PreparedComputerUseLongRun['rounds'], manifestDir: string) {
  const lines = [
    'Vision temporary memory policy: file-ref-only',
    'Memory mode: cross-round-followup',
  ];
  for (const prior of priorRounds.filter((item) => item.visionTraceRef)) {
    const trace = await readOptionalJson(resolveManifestRef(manifestDir, prior.visionTraceRef as string));
    if (!isRecord(trace)) continue;
    const steps = Array.isArray(trace.steps) ? trace.steps.filter(isRecord) : [];
    const guiSteps = steps.filter((step) => step.kind === 'gui-execution');
    const nonWait = guiSteps.filter((step) => !isRecord(step.plannedAction) || step.plannedAction.type !== 'wait');
    const lifecycle = isRecord(trace.windowLifecycle) ? trace.windowLifecycle : {};
    const displayIds = Array.isArray(lifecycle.observedDisplayIds) ? lifecycle.observedDisplayIds.map(String).join(',') : '';
    const firstGui = guiSteps[0];
    const scheduler = firstGui && isRecord(firstGui.scheduler) ? firstGui.scheduler : {};
    const verifier = firstGui && isRecord(firstGui.verifier) ? firstGui.verifier : {};
    const pixel = isRecord(verifier.pixelDiff) ? verifier.pixelDiff : {};
    const window = isRecord(verifier.windowConsistency) ? verifier.windowConsistency : {};
    const refs = isRecord(trace.imageMemory) && Array.isArray(trace.imageMemory.refs)
      ? trace.imageMemory.refs.filter(isRecord)
      : [];
    const firstRef = refs[0];
    lines.push(`- round ${prior.round} trace=${prior.visionTraceRef} actions=${guiSteps.length}; nonWait=${nonWait.length}`);
    lines.push(`  windowTarget: ${String(lifecycle.targetIdentity || 'unknown')} observedDisplayIds=${displayIds}`);
    lines.push(`  scheduler: mode=${String(scheduler.mode || 'unknown')} lockId=${String(scheduler.lockId || '')}`);
    lines.push(`  verifierFeedback: pixel=${String(pixel.method || 'unknown')} noEffect=${String(pixel.possiblyNoEffect ?? '')}`);
    lines.push(`  verifierFeedback: window=${String(window.status || 'unknown')} sameWindow=${String(window.sameWindow ?? '')}`);
    if (firstRef) {
      lines.push(`  screenshotMeta: ref=${String(firstRef.path || '')} sha256=${String(firstRef.sha256 || '')} size=${String(firstRef.width || '')}x${String(firstRef.height || '')} displayId=${String(firstRef.displayId || '')}`);
    }
  }
  return lines.join('\n');
}

async function buildVisualMemoryBlockFromVisionSense(priorRounds: PreparedComputerUseLongRun['rounds'], manifestDir: string) {
  const traces = priorRounds
    .filter((prior) => prior.visionTraceRef)
    .map((prior) => ({
      label: `round ${prior.round}`,
      ref: prior.visionTraceRef,
      path: resolveManifestRef(manifestDir, prior.visionTraceRef as string),
    }));
  if (!traces.length) return '';
  const result = await runVisionSensePythonJson('sciforge_vision_sense.visual_memory', {
    mode: 'cross-round-followup',
    traces,
    maxScreenshotRefsPerTrace: 5,
    maxFocusRefsPerTrace: 4,
    maxVerifierFeedbackPerTrace: 5,
    charBudget: 6000,
  });
  const block = isRecord(result) ? result : {};
  return typeof block.text === 'string' ? block.text : '';
}

export async function validateTraceContractWithVisionSense(options: { tracePath: string; workspacePath: string; rawText: string }) {
  const result = await runVisionSensePythonJson('sciforge_vision_sense.trace_contract', {
    tracePath: options.tracePath,
    workspacePath: options.workspacePath,
    rawText: options.rawText,
  });
  if (!isRecord(result)) return undefined;
  const metrics = isRecord(result.metrics) ? result.metrics : {};
  const issues = Array.isArray(result.issues) ? result.issues.map(String) : [];
  return {
    checkedScreenshotRefs: Array.isArray(result.checkedScreenshotRefs) ? result.checkedScreenshotRefs.map(String) : [],
    issues,
    metrics: {
      stepCount: typeof metrics.stepCount === 'number' ? metrics.stepCount : 0,
      actionCount: typeof metrics.actionCount === 'number' ? metrics.actionCount : 0,
      nonWaitActionCount: typeof metrics.nonWaitActionCount === 'number' ? metrics.nonWaitActionCount : 0,
      effectiveNonWaitActionCount: typeof metrics.effectiveNonWaitActionCount === 'number' ? metrics.effectiveNonWaitActionCount : 0,
      screenshotCount: typeof metrics.screenshotCount === 'number' ? metrics.screenshotCount : 0,
      blockedCount: typeof metrics.blockedCount === 'number' ? metrics.blockedCount : 0,
      failedCount: typeof metrics.failedCount === 'number' ? metrics.failedCount : 0,
    },
  };
}

export function findPayloadTraceRef(payload: { artifacts?: Array<Record<string, unknown>>; executionUnits?: Array<Record<string, unknown>> }) {
  const artifact = payload.artifacts?.find((item) => item.id === 'vision-sense-trace' || item.type === 'vision-trace');
  const direct = artifact?.path ?? artifact?.dataRef;
  if (typeof direct === 'string' && direct.trim()) return direct;
  for (const unit of payload.executionUnits ?? []) {
    const outputRef = unit.outputRef;
    if (typeof outputRef === 'string' && outputRef.endsWith('vision-trace.json')) return outputRef;
    const artifacts = Array.isArray(unit.artifacts) ? unit.artifacts : [];
    const trace = artifacts.find((item) => typeof item === 'string' && item.endsWith('vision-trace.json'));
    if (typeof trace === 'string') return trace;
  }
  return undefined;
}

export async function runVisionSensePythonJson(moduleName: string, request: Record<string, unknown>) {
  const python = process.env.SCIFORGE_VISION_SENSE_PYTHON || 'python3';
  const packageRoot = resolve('packages/senses/vision-sense');
  const requestJson = JSON.stringify(request);
  const requestFile = requestJson.length > 100_000
    ? join('/tmp', `sciforge-vision-sense-request-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
    : undefined;
  if (requestFile) await writeFile(requestFile, requestJson, 'utf8');
  const code = [
    'import sys',
    `sys.path.insert(0, ${JSON.stringify(packageRoot)})`,
    `from ${moduleName} import main`,
    'arg = sys.argv[1]',
    'arg = open(arg[1:], "r", encoding="utf-8").read() if arg.startswith("@") else arg',
    'raise SystemExit(main([arg]))',
  ].join('; ');
  const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolvePromise) => {
    const child = spawn(python, ['-c', code, requestFile ? `@${requestFile}` : requestJson], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGTERM'), 10000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolvePromise({ exitCode: 127, stdout, stderr: stderr || error.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolvePromise({ exitCode: code ?? (signal ? 143 : 1), stdout, stderr });
    });
  });
  if (requestFile) await unlink(requestFile).catch(() => undefined);
  if (result.exitCode !== 0) return undefined;
  const parsed = extractJsonObject(result.stdout.trim());
  return isRecord(parsed) && parsed.ok === true ? parsed.result : undefined;
}

export function resolveTraceArtifactPath(traceRef: string, workspacePath: string) {
  if (isAbsolute(traceRef)) return traceRef;
  return resolve(workspacePath, traceRef);
}

export function resolveManifestRef(manifestDir: string, refPath: string) {
  if (isAbsolute(refPath)) return refPath;
  return resolve(manifestDir, refPath);
}

export async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export async function readOptionalText(path: string) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

export async function screenshotRefsFromTrace(tracePath: string) {
  const trace = JSON.parse(await readFile(tracePath, 'utf8')) as unknown;
  if (!isRecord(trace) || !isRecord(trace.imageMemory) || !Array.isArray(trace.imageMemory.refs)) return [];
  return trace.imageMemory.refs
    .filter(isRecord)
    .map((ref) => typeof ref.path === 'string' ? ref.path : '')
    .filter(Boolean);
}

export function renderActionLedger(
  payload: { message: string; executionUnits?: Array<Record<string, unknown>> },
  validation?: ComputerUseLongTraceValidation,
  runtimePromptRef?: string,
) {
  return {
    schemaVersion: 'sciforge.computer-use-long.action-ledger.v1',
    message: payload.message,
    runtimePromptRef,
    executionUnits: payload.executionUnits ?? [],
    validationMetrics: validation?.metrics,
    checkedScreenshotRefs: validation?.checkedScreenshotRefs ?? [],
  };
}

export function renderFailureDiagnostics(
  payload: { message: string; reasoningTrace?: string; executionUnits?: Array<Record<string, unknown>> },
  validation?: ComputerUseLongTraceValidation,
  tracePath?: string,
) {
  const unit = payload.executionUnits?.[0] ?? {};
  return {
    schemaVersion: 'sciforge.computer-use-long.failure-diagnostics.v1',
    status: unit.status ?? 'unknown',
    message: payload.message,
    reasoningTrace: payload.reasoningTrace,
    failureReason: unit.failureReason,
    tracePath,
    traceValidation: validation ? {
      ok: validation.ok,
      issues: validation.issues,
      metrics: validation.metrics,
    } : { ok: false, issues: ['vision-trace artifact was not produced'] },
    recoverActions: unit.recoverActions,
    requiredInputs: unit.requiredInputs,
  };
}

export function isRealGuiTrace(trace: Record<string, unknown>) {
  const config = isRecord(trace.config) ? trace.config : {};
  return config.dryRun === false;
}

export function traceWindowTargetFromTrace(trace: Record<string, unknown>) {
  const config = isRecord(trace.config) ? trace.config : {};
  return isRecord(trace.windowTarget)
    ? trace.windowTarget
    : isRecord(trace.windowTargeting)
      ? trace.windowTargeting
      : isRecord(config.windowTarget)
        ? config.windowTarget
        : undefined;
}

export function minimumAcceptanceCount(acceptance: string[], pattern: RegExp) {
  const candidates: number[] = [];
  for (const item of acceptance) {
    if (!pattern.test(item)) continue;
    const chinese = item.match(/至少\s*(\d+)/);
    const english = item.match(/at least\s*(\d+)/i);
    const numeric = Number(chinese?.[1] ?? english?.[1]);
    if (Number.isFinite(numeric)) candidates.push(numeric);
  }
  return candidates.length ? Math.max(...candidates) : undefined;
}

export function scenarioExpectsBrowserTarget(scenario: ComputerUseLongScenario) {
  const text = [
    scenario.title,
    scenario.goal,
    ...scenario.rounds.map((round) => round.prompt),
    ...scenario.acceptance,
  ].join('\n');
  return /浏览器|browser/i.test(text);
}

export function isBrowserWindowTarget(target: Record<string, unknown>) {
  const text = [
    firstString(target.appName, target.bundleId, target.title),
  ].filter(Boolean).join(' ');
  return /Microsoft Edge|Safari|Google Chrome|Firefox|Arc|Brave|com\.microsoft\.edgemac|com\.apple\.Safari|com\.google\.Chrome|org\.mozilla\.firefox|浏览器/i.test(text);
}

export function manifestRel(root: string, path: string) {
  return relative(root, path).replace(/\\/g, '/');
}

export async function defaultWindowTargetForRound(
  manifest: PreparedComputerUseLongRun,
  round: number,
  dryRun: boolean,
  targetOverride: { appName?: string; title?: string; mode?: 'active-window' | 'app-window' | 'window-id' | 'display' } = {},
) {
  const result = await runVisionSensePythonJson('sciforge_vision_sense.computer_use_policy', {
    mode: 'default-window-target',
    scenarioId: manifest.scenarioId,
    runId: manifest.run.id,
    round,
    dryRun,
    appName: targetOverride.appName,
    title: targetOverride.title,
    targetMode: targetOverride.mode,
  });
  if (isRecord(result) && result.enabled === true && result.required === true) return result;
  if (!dryRun) {
    return {
      enabled: true,
      required: true,
      mode: targetOverride.mode ?? (targetOverride.appName || targetOverride.title ? 'app-window' : 'active-window'),
      appName: targetOverride.appName,
      title: targetOverride.title,
      coordinateSpace: 'window',
      inputIsolation: 'require-focused-target',
    };
  }
  return {
    enabled: true,
    required: true,
    mode: 'window-id',
    windowId: 84000 + round,
    appName: 'SciForge T084 Harness',
    title: `${manifest.scenarioId} ${manifest.run.id} round ${round}`,
    bounds: { x: 0, y: 0, width: 1280, height: 800 },
    coordinateSpace: 'window',
    inputIsolation: 'require-focused-target',
  };
}

export function emptyTraceValidation(scenarioId: string, tracePath: string, issues: string[]): ComputerUseLongTraceValidation {
  return {
    ok: false,
    scenarioId,
    tracePath,
    checkedScreenshotRefs: [],
    issues,
    metrics: {
      stepCount: 0,
      actionCount: 0,
      nonWaitActionCount: 0,
      effectiveNonWaitActionCount: 0,
      screenshotCount: 0,
      blockedCount: 0,
      failedCount: 0,
    },
  };
}

export async function validatePngRef(path: string, label: string) {
  const issues: string[] = [];
  try {
    const info = await stat(path);
    if (!info.isFile()) issues.push(`screenshot ref ${label} is not a file`);
    const bytes = await readFile(path);
    if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) {
      issues.push(`screenshot ref ${label} is not a readable PNG`);
    }
  } catch (error) {
    issues.push(`screenshot ref ${label} missing: ${error instanceof Error ? error.message : String(error)}`);
  }
  return issues;
}

export function resolveTraceRefPath(refPath: string, workspacePath: string, traceDir: string) {
  if (isAbsolute(refPath)) return refPath;
  const workspaceCandidate = resolve(workspacePath, refPath);
  if (workspacePath && refPath.startsWith('.sciforge/')) return workspaceCandidate;
  return resolve(traceDir, refPath);
}

export function inferWorkspacePathFromTracePath(tracePath: string) {
  const normalized = tracePath.replace(/\\/g, '/');
  const marker = '/.sciforge/vision-runs/';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 1) return undefined;
  return normalized.slice(0, markerIndex);
}

export function hasWindowBounds(value: Record<string, unknown>) {
  const bounds = isRecord(value.bounds) ? value.bounds : isRecord(value.windowBounds) ? value.windowBounds : value;
  return ['x', 'y', 'width', 'height'].every((key) => typeof bounds[key] === 'number')
    || ['left', 'top', 'right', 'bottom'].every((key) => typeof bounds[key] === 'number');
}

export function screenshotRefHasWindowMetadata(value: unknown) {
  if (!isRecord(value)) return false;
  const nestedWindowTarget = isRecord(value.windowTarget) ? value.windowTarget : undefined;
  if (nestedWindowTarget) {
    return Boolean(firstString(nestedWindowTarget.windowId, nestedWindowTarget.windowTitle, nestedWindowTarget.title, nestedWindowTarget.appName, nestedWindowTarget.bundleId))
      && hasWindowBounds(nestedWindowTarget);
  }
  const scope = firstString(value.scope, value.captureScope, value.screenshotScope, value.kind, value.type);
  const hasWindowScope = Boolean(scope && /window/i.test(scope));
  const hasWindowId = Boolean(firstString(value.windowId, value.windowTitle, value.appName, value.bundleId));
  return hasWindowScope && hasWindowId && hasWindowBounds(value);
}

export function screenshotStepRefs(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function hasWindowLocalCoordinates(value: unknown) {
  if (!isRecord(value)) return false;
  const coordinateSpace = firstString(value.coordinateSpace, value.coordinates, value.frame);
  const directPoint = (typeof value.localX === 'number' && typeof value.localY === 'number')
    || (typeof value.windowX === 'number' && typeof value.windowY === 'number');
  const point = isRecord(value.point) ? value.point : isRecord(value.start) ? value.start : undefined;
  const nestedPoint = Boolean(point && (
    (typeof point.localX === 'number' && typeof point.localY === 'number')
    || (typeof point.x === 'number' && typeof point.y === 'number')
  ));
  const dragEnd = !isRecord(value.end) || (
    typeof value.end.x === 'number'
    || typeof value.end.localX === 'number'
    || typeof value.end.windowX === 'number'
  );
  return Boolean(coordinateSpace && /window(?:-local)?/i.test(coordinateSpace)) && (directPoint || nestedPoint) && dragEnd;
}

export function hasInputChannelMetadata(execution: Record<string, unknown>, action: Record<string, unknown> | undefined) {
  const inputChannel = firstString(execution.inputChannel, execution.channel, action?.inputChannel, action?.channel);
  return Boolean(inputChannel && /generic|mouse|keyboard|desktop/i.test(inputChannel));
}

export function hasStepWindowTarget(step: Record<string, unknown>, traceWindowTarget: Record<string, unknown> | undefined) {
  const windowTarget = isRecord(step.windowTarget) ? step.windowTarget : traceWindowTarget;
  if (!windowTarget) return false;
  return Boolean(firstString(windowTarget.windowId, windowTarget.id, windowTarget.handle, windowTarget.title, windowTarget.appName, windowTarget.bundleId))
    && hasWindowBounds(windowTarget);
}

export function hasSchedulerMetadata(step: Record<string, unknown>, traceScheduler: Record<string, unknown> | undefined) {
  const scheduler = isRecord(step.scheduler) ? step.scheduler : traceScheduler;
  if (!scheduler) return false;
  const mode = firstString(scheduler.mode, scheduler.policy, scheduler.queue);
  const lockId = firstString(scheduler.lockId, scheduler.schedulerLockId);
  const focusPolicy = firstString(scheduler.focusPolicy, scheduler.focus);
  const interferenceRisk = firstString(scheduler.interferenceRisk, scheduler.risk);
  return Boolean(mode && /serial|ordered|single|window/i.test(mode) && lockId && focusPolicy && interferenceRisk);
}

export function hasWindowVerifierMetadata(verifier: Record<string, unknown>) {
  const consistency = isRecord(verifier.windowConsistency) ? verifier.windowConsistency : verifier;
  const status = firstString(consistency.status, consistency.scope, consistency.requiredScope);
  return Boolean(status && /window|target|display/i.test(status));
}

export function verifierReportsNoVisibleEffect(verifier: Record<string, unknown>) {
  const pixelDiff = isRecord(verifier.pixelDiff) ? verifier.pixelDiff : undefined;
  if (pixelDiff?.possiblyNoEffect === true) return true;
  const pairs = Array.isArray(pixelDiff?.pairs) ? pixelDiff.pairs.filter(isRecord) : [];
  return pairs.length > 0 && pairs.every((pair) => pair.possiblyNoEffect === true);
}

export function hasForbiddenPrivateFields(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return collectKeys(value).some((key) => /dom|selector|accessibility|aria|xpath|css|appApi|privateShortcut/i.test(key));
}

export function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export function renderPreparedRunChecklist(scenario: ComputerUseLongScenario, manifest: PreparedComputerUseLongRun) {
  const lines = [
    `# ${scenario.id} ${scenario.title}`,
    '',
    `Run: ${manifest.run.id}`,
    `Workspace: ${manifest.run.workspacePath}`,
    '',
    '## Non-Negotiable Genericity Rules',
    '- Use only the shared WindowTarget -> VisionPlanner -> Grounder -> GuiExecutor -> Verifier -> vision-trace path.',
    '- Select a concrete target window before planning; record window id/title, app identity, bounds, displayId, and window-local coordinate space.',
    '- Store only window screenshot refs with path, sha256, width/height, window identity, displayId, and bounds.',
    '- Record generic mouse/keyboard input-channel metadata and serialized scheduler metadata for every executed GUI action.',
    '- Do not read DOM/accessibility data, call app-private APIs, generate files directly for an app, or scan the repository to fake GUI success.',
    '- Missing dependencies must produce failed-with-reason plus real screenshot refs.',
    '- Multi-turn memory must be file refs and compact summaries only; never inline base64/dataUrl screenshots.',
    '',
    '## Rounds',
    ...scenario.rounds.flatMap((round) => [
      `### Round ${round.round}`,
      round.prompt,
      '',
      `Expected trace: ${round.expectedTrace.join('; ')}`,
      `Record trace at: .sciforge/vision-runs/${manifest.run.id}/vision-trace.json or the actual run-specific trace path.`,
      '',
    ]),
    '## Acceptance',
    ...scenario.acceptance.map((item) => `- ${item}`),
    '',
    '## Failure Record',
    ...scenario.failureRecord.map((item) => `- ${item}`),
    '',
    '## Required Evidence',
    ...scenario.requiredEvidence.map((item) => `- ${item}`),
    '',
  ];
  return lines.join('\n');
}

export function sanitizeRunId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'cu-long-run';
}

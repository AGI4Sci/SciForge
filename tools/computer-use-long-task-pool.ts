import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const allowedActionTypes = new Set(['click', 'double_click', 'drag', 'type_text', 'press_key', 'hotkey', 'scroll', 'wait']);
const requiredPipeline = ['WindowTarget', 'VisionPlanner', 'Grounder', 'GuiExecutor', 'Verifier', 'vision-trace'];
const requiredTraceMetadata = [
  'windowTarget',
  'window screenshot refs',
  'window-local coordinates',
  'input channel',
  'scheduler metadata',
];

export interface ComputerUseLongTaskPool {
  schemaVersion: '1.0';
  taskId: 'T084';
  title: string;
  commonPrinciples: string[];
  scenarios: ComputerUseLongScenario[];
}

export interface ComputerUseLongScenario {
  id: string;
  title: string;
  goal: string;
  minRounds: number;
  requiredPipeline: string[];
  safetyBoundary: {
    noDomAccessibility: boolean;
    fileRefOnlyImageMemory: boolean;
    failClosedHighRiskActions: boolean;
    appSpecificShortcutsAllowed: false;
  };
  rounds: ComputerUseLongRound[];
  acceptance: string[];
  failureRecord: string[];
  requiredEvidence: string[];
}

export interface ComputerUseLongRound {
  round: number;
  prompt: string;
  expectedTrace: string[];
}

export interface ComputerUseLongTraceValidation {
  ok: boolean;
  scenarioId: string;
  tracePath: string;
  checkedScreenshotRefs: string[];
  issues: string[];
  metrics: {
    stepCount: number;
    actionCount: number;
    nonWaitActionCount: number;
    screenshotCount: number;
    blockedCount: number;
    failedCount: number;
  };
}

export interface PreparedComputerUseLongRun {
  schemaVersion: '1.0';
  taskId: 'T084';
  scenarioId: string;
  title: string;
  status: 'not-run' | 'running' | 'passed' | 'repair-needed' | 'failed';
  run: {
    id: string;
    startedAt: string;
    workspacePath: string;
    appUrl?: string;
    backend?: string;
    operator?: string;
    windowTarget: {
      mode: 'required';
      expectedScope: 'active-window-or-selected-window';
      coordinateSpace: 'window-local';
    };
    inputChannel: {
      mode: 'generic-mouse-keyboard';
      allowedActionTypes: string[];
    };
    scheduler: {
      mode: 'serialized-window-actions';
      requiresBeforeAfterScreenshots: true;
    };
  };
  universalPipeline: string[];
  validationContract: {
    requiredTraceMetadata: string[];
    screenshotScope: 'window';
    coordinateSpace: 'window-local';
    inputChannel: 'generic-mouse-keyboard';
    scheduler: 'serialized-window-actions';
  };
  safetyBoundary: ComputerUseLongScenario['safetyBoundary'];
  rounds: Array<{
    round: number;
    prompt: string;
    expectedTrace: string[];
    status: 'not-run' | 'passed' | 'repair-needed' | 'failed';
    visionTraceRef?: string;
    screenshotRefs: string[];
    actionLedgerRefs: string[];
    failureDiagnosticsRefs: string[];
    observedBehavior?: string;
  }>;
  acceptance: string[];
  failureRecord: string[];
  requiredEvidence: string[];
  notes: string;
}

export interface ComputerUseLongRoundRunResult {
  manifestPath: string;
  scenarioId: string;
  round: number;
  status: PreparedComputerUseLongRun['rounds'][number]['status'];
  tracePath?: string;
  validation?: ComputerUseLongTraceValidation;
  actionLedgerPath: string;
  failureDiagnosticsPath: string;
  payloadMessage: string;
}

export interface ComputerUseLongScenarioRunResult {
  manifestPath: string;
  scenarioId: string;
  status: PreparedComputerUseLongRun['status'];
  attemptedRounds: number[];
  passedRounds: number[];
  repairNeededRound?: number;
  summaryPath: string;
  roundResults: ComputerUseLongRoundRunResult[];
}

export interface ComputerUseLongRunValidation {
  ok: boolean;
  manifestPath: string;
  scenarioId: string;
  summaryPath?: string;
  checkedRounds: number[];
  issues: string[];
  metrics: {
    passedRounds: number;
    traceCount: number;
    screenshotRefCount: number;
    actionLedgerCount: number;
    failureDiagnosticsCount: number;
  };
}

export interface ComputerUseLongMatrixRunResult {
  summaryPath: string;
  status: 'passed' | 'repair-needed';
  scenarioIds: string[];
  passedScenarioIds: string[];
  repairNeededScenarioIds: string[];
  preflight?: ComputerUseLongPreflightResult;
  results: Array<{
    scenarioId: string;
    manifestPath: string;
    runStatus: PreparedComputerUseLongRun['status'];
    validationOk: boolean;
    summaryPath?: string;
    issues: string[];
  }>;
}

export interface ComputerUseLongMatrixReport {
  ok: boolean;
  summaryPath: string;
  reportPath: string;
  markdown: string;
  issueCategories: Record<string, number>;
}

export interface ComputerUseLongMatrixValidation {
  ok: boolean;
  summaryPath: string;
  scenarioIds: string[];
  issues: string[];
  metrics: {
    resultCount: number;
    passedScenarios: number;
    repairNeededScenarios: number;
    preflightFailedChecks: number;
    validatedRuns: number;
  };
}

export interface ComputerUseLongRepairPlan {
  ok: boolean;
  summaryPath: string;
  planPath: string;
  markdown: string;
  actionCount: number;
}

export interface ComputerUseLongPreflightResult {
  ok: boolean;
  scenarioIds: string[];
  dryRun: boolean;
  checks: Array<{
    id: string;
    status: 'pass' | 'warn' | 'fail';
    category: string;
    message: string;
    repairAction?: string;
  }>;
  reportPath?: string;
}

export function validateComputerUseLongTaskPool(pool: ComputerUseLongTaskPool): string[] {
  const issues: string[] = [];
  if (pool.schemaVersion !== '1.0') issues.push('schemaVersion must be "1.0"');
  if (pool.taskId !== 'T084') issues.push('taskId must be T084');
  if (!Array.isArray(pool.scenarios) || pool.scenarios.length !== 10) {
    issues.push('T084 Computer Use task pool must define exactly 10 CU-LONG scenarios');
  }

  const scenarioIds = new Set<string>();
  for (const scenario of pool.scenarios ?? []) {
    if (!/^CU-LONG-\d{3}$/.test(scenario.id)) issues.push(`${scenario.id} must use CU-LONG-### id format`);
    if (scenarioIds.has(scenario.id)) issues.push(`${scenario.id} is duplicated`);
    scenarioIds.add(scenario.id);
    if (scenario.minRounds < 3) issues.push(`${scenario.id} minRounds must be at least 3`);
    if (scenario.rounds.length < scenario.minRounds) issues.push(`${scenario.id} must define minRounds worth of rounds`);
    if (JSON.stringify(scenario.requiredPipeline) !== JSON.stringify(requiredPipeline)) {
      issues.push(`${scenario.id} requiredPipeline must be ${requiredPipeline.join(' -> ')}`);
    }
    if (!scenario.safetyBoundary.noDomAccessibility) issues.push(`${scenario.id} must forbid DOM/accessibility reads`);
    if (!scenario.safetyBoundary.fileRefOnlyImageMemory) issues.push(`${scenario.id} must require file-ref-only image memory`);
    if (!scenario.safetyBoundary.failClosedHighRiskActions) issues.push(`${scenario.id} must fail closed for high-risk actions`);
    if (scenario.safetyBoundary.appSpecificShortcutsAllowed !== false) issues.push(`${scenario.id} must forbid app-specific shortcuts`);
    if (!scenario.acceptance.some((item) => /base64|dataUrl/i.test(item))) issues.push(`${scenario.id} acceptance must check base64/dataUrl absence`);
    if (!scenario.acceptance.some((item) => /DOM|accessibility/i.test(item))) issues.push(`${scenario.id} acceptance must check DOM/accessibility absence`);
    if (!scenario.requiredEvidence.includes('vision-trace.json')) issues.push(`${scenario.id} must require vision-trace.json evidence`);
    if (!scenario.requiredEvidence.includes('before/after screenshots')) issues.push(`${scenario.id} must require before/after screenshots`);
    if (!scenario.requiredEvidence.includes('action ledger')) issues.push(`${scenario.id} must require action ledger evidence`);
    if (!scenario.requiredEvidence.includes('failure diagnostics')) issues.push(`${scenario.id} must require failure diagnostics`);
    for (const required of requiredTraceMetadata) {
      const haystack = [
        scenario.goal,
        ...scenario.acceptance,
        ...scenario.requiredEvidence,
        ...scenario.failureRecord,
        ...scenario.rounds.flatMap((round) => [round.prompt, ...round.expectedTrace]),
      ].join(' ');
      if (!new RegExp(escapeRegExp(required), 'i').test(haystack)) {
        issues.push(`${scenario.id} must require ${required} trace/run metadata`);
      }
    }

    const roundNumbers = scenario.rounds.map((round) => round.round);
    const expectedRoundNumbers = Array.from({ length: scenario.rounds.length }, (_, index) => index + 1);
    if (roundNumbers.join(',') !== expectedRoundNumbers.join(',')) {
      issues.push(`${scenario.id} rounds must be sequential from 1`);
    }
    for (const round of scenario.rounds) {
      if (!round.prompt.trim()) issues.push(`${scenario.id} round ${round.round} prompt is empty`);
      if (hasUndefinedGuiSubtaskPlaceholder(round.prompt)) issues.push(`${scenario.id} round ${round.round} prompt uses an undefined GUI subtask placeholder`);
      if (!round.expectedTrace.length) issues.push(`${scenario.id} round ${round.round} must declare expected trace evidence`);
    }
  }

  return issues;
}

function hasUndefinedGuiSubtaskPlaceholder(prompt: string) {
  return /GUI\s*子任务\s*[A-ZＡ-Ｚ]|GUI\s*sub-?task\s*[A-Z]/i.test(prompt);
}

export async function loadComputerUseLongTaskPool(path = resolve('tests', 'computer-use-long', 'task-pool.json')) {
  return JSON.parse(await readFile(path, 'utf8')) as ComputerUseLongTaskPool;
}

export async function prepareComputerUseLongRun(options: {
  scenarioId: string;
  outRoot?: string;
  runId?: string;
  workspacePath?: string;
  appUrl?: string;
  backend?: string;
  operator?: string;
  now?: Date;
}) {
  const pool = await loadComputerUseLongTaskPool();
  const issues = validateComputerUseLongTaskPool(pool);
  if (issues.length) throw new Error(`Invalid T084 Computer Use task pool:\n${issues.join('\n')}`);
  const scenario = pool.scenarios.find((item) => item.id === options.scenarioId);
  if (!scenario) throw new Error(`Unknown CU-LONG scenario: ${options.scenarioId}`);
  const now = options.now ?? new Date();
  const runId = sanitizeRunId(options.runId || `${scenario.id.toLowerCase()}-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`);
  const outRoot = resolve(options.outRoot || join('docs', 'test-artifacts', 'computer-use-long'));
  const runDir = join(outRoot, scenario.id, runId);
  const manifestPath = join(runDir, 'manifest.json');
  const checklistPath = join(runDir, 'run-checklist.md');
  const evidenceDir = join(runDir, 'evidence');
  const manifest: PreparedComputerUseLongRun = {
    schemaVersion: '1.0',
    taskId: 'T084',
    scenarioId: scenario.id,
    title: scenario.title,
    status: 'not-run',
    run: {
      id: runId,
      startedAt: now.toISOString(),
      workspacePath: options.workspacePath || resolve('workspace'),
      appUrl: options.appUrl,
      backend: options.backend,
      operator: options.operator || 'Codex',
      windowTarget: {
        mode: 'required',
        expectedScope: 'active-window-or-selected-window',
        coordinateSpace: 'window-local',
      },
      inputChannel: {
        mode: 'generic-mouse-keyboard',
        allowedActionTypes: Array.from(allowedActionTypes),
      },
      scheduler: {
        mode: 'serialized-window-actions',
        requiresBeforeAfterScreenshots: true,
      },
    },
    universalPipeline: scenario.requiredPipeline,
    validationContract: {
      requiredTraceMetadata,
      screenshotScope: 'window',
      coordinateSpace: 'window-local',
      inputChannel: 'generic-mouse-keyboard',
      scheduler: 'serialized-window-actions',
    },
    safetyBoundary: scenario.safetyBoundary,
    rounds: scenario.rounds.map((round) => ({
      round: round.round,
      prompt: round.prompt,
      expectedTrace: round.expectedTrace,
      status: 'not-run',
      screenshotRefs: [],
      actionLedgerRefs: [],
      failureDiagnosticsRefs: [],
    })),
    acceptance: scenario.acceptance,
    failureRecord: scenario.failureRecord,
    requiredEvidence: scenario.requiredEvidence,
    notes: [
      'This run must validate generic Computer Use behavior only.',
      'Do not add app-specific patches, DOM reads, accessibility reads, repository scans, or synthetic success artifacts.',
      'If any WindowTarget, VisionPlanner, Grounder, GuiExecutor, or Verifier dependency is missing, record failed-with-reason with real window screenshot refs.',
    ].join(' '),
  };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(checklistPath, renderPreparedRunChecklist(scenario, manifest));
  return { scenario, runDir, manifestPath, checklistPath, evidenceDir, manifest };
}

export async function validateComputerUseLongTrace(options: {
  scenarioId: string;
  tracePath: string;
  workspacePath?: string;
}): Promise<ComputerUseLongTraceValidation> {
  const pool = await loadComputerUseLongTaskPool();
  const scenario = pool.scenarios.find((item) => item.id === options.scenarioId);
  if (!scenario) throw new Error(`Unknown CU-LONG scenario: ${options.scenarioId}`);
  const tracePath = resolve(options.tracePath);
  const workspacePath = resolve(options.workspacePath || dirname(tracePath));
  const rawText = await readFile(tracePath, 'utf8');
  const issues: string[] = [];
  if (/data:image|;base64,/i.test(rawText)) issues.push('trace must not include inline image dataUrl/base64 payloads');
  const trace = JSON.parse(rawText) as unknown;
  if (!isRecord(trace)) {
    return emptyTraceValidation(options.scenarioId, tracePath, ['trace must be a JSON object']);
  }

  if (trace.schemaVersion !== 'sciforge.vision-trace.v1') issues.push('trace.schemaVersion must be sciforge.vision-trace.v1');
  const traceConfig = isRecord(trace.config) ? trace.config : {};
  const traceWindowTarget = isRecord(trace.windowTarget)
    ? trace.windowTarget
    : isRecord(trace.windowTargeting)
      ? trace.windowTargeting
      : isRecord(traceConfig.windowTarget)
        ? traceConfig.windowTarget
        : undefined;
  if (!traceWindowTarget) {
    issues.push('trace.windowTarget must record selected target window metadata');
  } else {
    const targetId = firstString(traceWindowTarget.windowId, traceWindowTarget.id, traceWindowTarget.handle, traceWindowTarget.title, traceWindowTarget.appName, traceWindowTarget.bundleId);
    if (!targetId) issues.push('trace.windowTarget missing stable window identity');
    if (!hasWindowBounds(traceWindowTarget)) issues.push('trace.windowTarget missing window bounds');
    const coordinateSpace = firstString(traceWindowTarget.coordinateSpace, traceWindowTarget.coordinates);
    if (!coordinateSpace || !/window(?:-local)?/i.test(coordinateSpace)) issues.push('trace.windowTarget.coordinateSpace must be window-local');
  }
  const traceScheduler = isRecord(trace.scheduler) ? trace.scheduler : undefined;
  if (!traceScheduler) {
    issues.push('trace.scheduler must record serialized GUI action scheduling metadata');
  } else {
    const schedulerMode = firstString(traceScheduler.mode, traceScheduler.policy, traceScheduler.queue);
    if (!schedulerMode || !/serial|ordered|single|window/i.test(schedulerMode)) {
      issues.push('trace.scheduler must declare serialized/ordered window action scheduling');
    }
  }
  const genericComputerUse = isRecord(trace.genericComputerUse) ? trace.genericComputerUse : {};
  const appSpecificShortcuts = Array.isArray(genericComputerUse.appSpecificShortcuts) ? genericComputerUse.appSpecificShortcuts : undefined;
  if (!appSpecificShortcuts || appSpecificShortcuts.length !== 0) issues.push('genericComputerUse.appSpecificShortcuts must be []');
  const traceInputChannel = firstString(genericComputerUse.inputChannel, genericComputerUse.inputChannelMode, trace.inputChannel);
  if (!traceInputChannel || !/generic|mouse|keyboard|desktop/i.test(traceInputChannel)) {
    issues.push('genericComputerUse.inputChannel must declare generic mouse/keyboard input');
  }
  const actionSchema = new Set(Array.isArray(genericComputerUse.actionSchema) ? genericComputerUse.actionSchema.map(String) : []);
  for (const action of allowedActionTypes) {
    if (!actionSchema.has(action)) issues.push(`genericComputerUse.actionSchema missing ${action}`);
  }

  const imageMemory = isRecord(trace.imageMemory) ? trace.imageMemory : {};
  if (imageMemory.policy !== 'file-ref-only') issues.push('imageMemory.policy must be file-ref-only');
  const screenshotRefs = Array.isArray(imageMemory.refs) ? imageMemory.refs.filter(isRecord) : [];
  if (!screenshotRefs.length) issues.push('imageMemory.refs must include screenshot refs');
  const checkedScreenshotRefs: string[] = [];
  for (const ref of screenshotRefs) {
    const refPath = typeof ref.path === 'string' ? ref.path : '';
    if (!refPath) {
      issues.push('screenshot ref missing path');
      continue;
    }
    checkedScreenshotRefs.push(refPath);
    const resolved = resolveTraceRefPath(refPath, workspacePath, dirname(tracePath));
    const fileIssues = await validatePngRef(resolved, refPath);
    issues.push(...fileIssues);
    if (typeof ref.sha256 !== 'string' || ref.sha256.length !== 64) issues.push(`screenshot ref ${refPath} missing sha256`);
    if (typeof ref.width !== 'number' || typeof ref.height !== 'number') issues.push(`screenshot ref ${refPath} missing width/height`);
    if (!screenshotRefHasWindowMetadata(ref)) issues.push(`screenshot ref ${refPath} missing window screenshot metadata`);
  }

  const steps = Array.isArray(trace.steps) ? trace.steps.filter(isRecord) : [];
  if (!steps.length) issues.push('trace.steps must include step records');
  let actionCount = 0;
  let nonWaitActionCount = 0;
  let blockedCount = 0;
  let failedCount = 0;
  let plannerOnlyDone = false;
  for (const [index, step] of steps.entries()) {
    const status = String(step.status || '');
    if (status === 'blocked') blockedCount += 1;
    if (status === 'failed') failedCount += 1;
    if (step.kind === 'gui-execution') {
      actionCount += 1;
      const action = isRecord(step.plannedAction) ? step.plannedAction : undefined;
      const type = typeof action?.type === 'string' ? action.type : '';
      if (!allowedActionTypes.has(type)) issues.push(`steps[${index}].plannedAction.type is not a generic action`);
      if (type && type !== 'wait') nonWaitActionCount += 1;
      if (hasForbiddenPrivateFields(action)) issues.push(`steps[${index}].plannedAction contains DOM/accessibility/private-app fields`);
      if (!Array.isArray(step.beforeScreenshotRefs) || !step.beforeScreenshotRefs.length) issues.push(`steps[${index}] missing beforeScreenshotRefs`);
      if (!Array.isArray(step.afterScreenshotRefs) || !step.afterScreenshotRefs.length) issues.push(`steps[${index}] missing afterScreenshotRefs`);
      for (const ref of [...screenshotStepRefs(step.beforeScreenshotRefs), ...screenshotStepRefs(step.afterScreenshotRefs)]) {
        if (!screenshotRefHasWindowMetadata(ref)) issues.push(`steps[${index}] screenshot ref missing window metadata`);
      }
      if (!isRecord(step.execution)) issues.push(`steps[${index}] missing execution record`);
      if (isRecord(step.execution) && !hasInputChannelMetadata(step.execution, action)) issues.push(`steps[${index}] execution missing input-channel metadata`);
      if (!isRecord(step.verifier)) issues.push(`steps[${index}] missing verifier record`);
      if ((type === 'click' || type === 'double_click' || type === 'drag') && status === 'done' && !isRecord(step.grounding)) {
        issues.push(`steps[${index}] ${type} action missing grounding record`);
      }
      if ((type === 'click' || type === 'double_click' || type === 'drag') && status === 'done') {
        if (!hasWindowLocalCoordinates(action) && !hasWindowLocalCoordinates(step.localCoordinate)) issues.push(`steps[${index}].plannedAction missing window-local coordinates`);
        if (isRecord(step.grounding) && !hasWindowLocalCoordinates(step.grounding) && !hasWindowLocalCoordinates(step.localCoordinate)) issues.push(`steps[${index}].grounding missing window-local coordinates`);
      }
      if (!hasStepWindowTarget(step, traceWindowTarget)) issues.push(`steps[${index}] missing windowTarget metadata`);
      if (!hasSchedulerMetadata(step, traceScheduler)) issues.push(`steps[${index}] missing scheduler metadata`);
    }
    if (step.kind === 'planning' && !isRecord(step.execution)) {
      issues.push(`steps[${index}] planning step missing planner execution record`);
    }
    if (step.kind === 'planning' && step.status === 'done' && plannerStepReportedDoneWithoutActions(step)) {
      plannerOnlyDone = true;
    }
  }

  const requestText = isRecord(trace.request) && typeof trace.request.text === 'string' ? trace.request.text : '';
  const allowsPlannerOnlyTrace = plannerOnlyDone && isPlannerOnlyEvidenceTask(requestText);
  if (actionCount === 0 && !allowsPlannerOnlyTrace) issues.push('trace must include at least one gui-execution step for CU-LONG validation');
  if (nonWaitActionCount === 0 && !allowsPlannerOnlyTrace) issues.push('trace must include at least one non-wait generic GUI action');
  const serializedKeys = collectKeys(trace).map((key) => key.toLowerCase());
  for (const forbidden of ['domselector', 'selector', 'accessibilitylabel', 'aria', 'xpath', 'cssselector', 'appapi', 'privateshortcut']) {
    if (serializedKeys.includes(forbidden.toLowerCase())) issues.push(`trace contains forbidden private field key: ${forbidden}`);
  }

  return {
    ok: issues.length === 0,
    scenarioId: scenario.id,
    tracePath,
    checkedScreenshotRefs,
    issues,
    metrics: {
      stepCount: steps.length,
      actionCount,
      nonWaitActionCount,
      screenshotCount: screenshotRefs.length,
      blockedCount,
      failedCount,
    },
  };
}

function plannerStepReportedDoneWithoutActions(step: Record<string, unknown>) {
  const execution = isRecord(step.execution) ? step.execution : undefined;
  const rawResponse = isRecord(execution?.rawResponse) ? execution.rawResponse : undefined;
  const choices = Array.isArray(rawResponse?.choices) ? rawResponse.choices.filter(isRecord) : [];
  for (const choice of choices) {
    const message = isRecord(choice.message) ? choice.message : undefined;
    const content = typeof message?.content === 'string' ? message.content : '';
    const parsed = extractJsonObject(content);
    if (isRecord(parsed) && parsed.done === true && Array.isArray(parsed.actions) && parsed.actions.length === 0) return true;
  }
  return false;
}

function isPlannerOnlyEvidenceTask(text: string) {
  return /trace refs?|trace paths?|image memory|artifact|action ledger|failure diagnostics|sha256|displayId|尺寸|文件引用|截图引用|复盘|总结|汇总|回答|报告|handoff|refs?|summary|report/i.test(text);
}

function extractJsonObject(text: string): unknown {
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

export async function runComputerUseLongRound(options: {
  manifestPath: string;
  round: number;
  dryRun?: boolean;
  maxSteps?: number;
  runId?: string;
  actionsJson?: string;
  promptSuffix?: string;
  now?: Date;
}): Promise<ComputerUseLongRoundRunResult> {
  const manifestPath = resolve(options.manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  if (manifest.schemaVersion !== '1.0' || manifest.taskId !== 'T084') {
    throw new Error('run-round requires a prepared T084 Computer Use manifest');
  }
  const round = manifest.rounds.find((item) => item.round === options.round);
  if (!round) throw new Error(`Round ${options.round} is not present in ${manifestPath}`);

  const workspacePath = resolve(manifest.run.workspacePath);
  const evidenceDir = join(dirname(manifestPath), 'evidence', `round-${String(options.round).padStart(2, '0')}`);
  await mkdir(evidenceDir, { recursive: true });
  const now = options.now ?? new Date();
  const runId = sanitizeRunId(options.runId || `${manifest.run.id}-round-${String(options.round).padStart(2, '0')}-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`);
  const prompt = renderRoundRuntimePrompt(manifest, round, options.promptSuffix);
  const runtimePromptPath = join(evidenceDir, 'runtime-prompt.md');
  await writeFile(runtimePromptPath, `${prompt}\n`);

  manifest.status = 'running';
  round.status = 'repair-needed';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const { runWorkspaceRuntimeGateway } = await import('../src/runtime/workspace-runtime-gateway.js');
  const payload = await withScopedVisionRuntimeEnv({
    SCIFORGE_VISION_DESKTOP_BRIDGE: '1',
    SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN: (options.dryRun ?? false) ? '1' : '0',
    SCIFORGE_VISION_RUN_ID: runId,
    SCIFORGE_VISION_MAX_STEPS: String(options.maxSteps ?? 8),
    SCIFORGE_VISION_ACTIONS_JSON: options.actionsJson,
    SCIFORGE_VISION_WINDOW_TARGET_JSON: JSON.stringify(defaultWindowTargetForRound(manifest, options.round)),
  }, () => runWorkspaceRuntimeGateway({
      skillDomain: 'knowledge',
      prompt,
      workspacePath,
      selectedToolIds: ['local.vision-sense'],
      uiState: {
        selectedToolIds: ['local.vision-sense'],
        visionSenseConfig: {
          desktopBridgeEnabled: true,
          dryRun: options.dryRun ?? false,
          maxSteps: options.maxSteps ?? 8,
          runId,
          windowTarget: defaultWindowTargetForRound(manifest, options.round),
        },
        computerUseLong: {
          scenarioId: manifest.scenarioId,
          runId: manifest.run.id,
          round: options.round,
          requiredPipeline: manifest.universalPipeline,
          safetyBoundary: manifest.safetyBoundary,
        },
      },
      artifacts: [],
    }));

  const traceRef = findPayloadTraceRef(payload);
  const tracePath = traceRef ? resolveTraceArtifactPath(traceRef, workspacePath) : undefined;
  const actionLedgerPath = join(evidenceDir, 'action-ledger.json');
  const failureDiagnosticsPath = join(evidenceDir, 'failure-diagnostics.json');
  const screenshotRefs = tracePath ? await screenshotRefsFromTrace(tracePath) : [];
  const traceEvidencePath = tracePath ? join(evidenceDir, 'vision-trace.json') : undefined;
  if (tracePath && traceEvidencePath && tracePath !== traceEvidencePath) {
    await copyFile(tracePath, traceEvidencePath);
  }

  let validation: ComputerUseLongTraceValidation | undefined;
  if (tracePath) {
    validation = await validateComputerUseLongTrace({
      scenarioId: manifest.scenarioId,
      tracePath,
      workspacePath,
    });
  }

  const unit = payload.executionUnits[0] ?? {};
  const payloadStatus = typeof unit.status === 'string' ? unit.status : '';
  const passed = validation?.ok === true && (payloadStatus === 'done' || isExpectedFailClosedRound(round, payloadStatus, validation));
  const failed = payloadStatus === 'failed' || payloadStatus === 'failed-with-reason' || validation?.ok === false || !tracePath;
  round.status = passed ? 'passed' : failed ? 'repair-needed' : 'repair-needed';
  round.visionTraceRef = traceEvidencePath ? manifestRel(dirname(manifestPath), traceEvidencePath) : traceRef;
  round.screenshotRefs = screenshotRefs;
  round.actionLedgerRefs = [manifestRel(dirname(manifestPath), actionLedgerPath)];
  round.failureDiagnosticsRefs = [manifestRel(dirname(manifestPath), failureDiagnosticsPath)];
  round.observedBehavior = payload.message;
  manifest.status = manifest.rounds.every((item) => item.status === 'passed')
    ? 'passed'
    : manifest.rounds.some((item) => item.status === 'repair-needed' || item.status === 'failed')
      ? 'repair-needed'
      : 'not-run';

  await writeFile(actionLedgerPath, `${JSON.stringify(renderActionLedger(payload, validation, manifestRel(dirname(manifestPath), runtimePromptPath)), null, 2)}\n`);
  await writeFile(failureDiagnosticsPath, `${JSON.stringify(renderFailureDiagnostics(payload, validation, tracePath), null, 2)}\n`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    manifestPath,
    scenarioId: manifest.scenarioId,
    round: options.round,
    status: round.status,
    tracePath,
    validation,
    actionLedgerPath,
    failureDiagnosticsPath,
    payloadMessage: payload.message,
  };
}

function isExpectedFailClosedRound(
  round: PreparedComputerUseLongRun['rounds'][number],
  payloadStatus: string,
  validation: ComputerUseLongTraceValidation | undefined,
) {
  if (payloadStatus !== 'failed-with-reason' || validation?.ok !== true) return false;
  const text = `${round.prompt} ${round.expectedTrace.join(' ')}`;
  return /fail\s*closed|blocked|risk|confirmation|高风险|确认|阻断|删除|发送|提交|授权|外发/i.test(text)
    && validation.metrics.blockedCount > 0
    && validation.metrics.nonWaitActionCount > 0;
}

export async function runComputerUseLongScenario(options: {
  manifestPath: string;
  rounds?: number;
  dryRun?: boolean;
  maxSteps?: number;
  actionsJson?: string;
  promptSuffix?: string;
  now?: Date;
}): Promise<ComputerUseLongScenarioRunResult> {
  const manifestPath = resolve(options.manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  if (manifest.schemaVersion !== '1.0' || manifest.taskId !== 'T084') {
    throw new Error('run-scenario requires a prepared T084 Computer Use manifest');
  }
  const pool = await loadComputerUseLongTaskPool();
  const scenario = pool.scenarios.find((item) => item.id === manifest.scenarioId);
  if (!scenario) throw new Error(`Unknown CU-LONG scenario: ${manifest.scenarioId}`);
  const requestedRounds = options.rounds ?? scenario.minRounds;
  if (!Number.isInteger(requestedRounds) || requestedRounds < 1) throw new Error('run-scenario rounds must be a positive integer');
  const roundsToRun = manifest.rounds.slice(0, requestedRounds);
  if (roundsToRun.length < requestedRounds) {
    throw new Error(`Manifest only defines ${roundsToRun.length} rounds, cannot run ${requestedRounds}`);
  }

  const roundResults: ComputerUseLongRoundRunResult[] = [];
  for (const round of roundsToRun) {
    const result = await runComputerUseLongRound({
      manifestPath,
      round: round.round,
      dryRun: options.dryRun,
      maxSteps: options.maxSteps,
      runId: `${manifest.run.id}-round-${String(round.round).padStart(2, '0')}`,
      actionsJson: options.actionsJson,
      promptSuffix: options.promptSuffix,
      now: options.now,
    });
    roundResults.push(result);
    if (result.status !== 'passed') break;
  }

  const latestManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  const attemptedRounds = roundResults.map((item) => item.round);
  const passedRounds = roundResults.filter((item) => item.status === 'passed').map((item) => item.round);
  const repairNeededRound = roundResults.find((item) => item.status !== 'passed')?.round;
  latestManifest.status = repairNeededRound
    ? 'repair-needed'
    : passedRounds.length >= scenario.minRounds
      ? 'passed'
      : 'repair-needed';
  await writeFile(manifestPath, `${JSON.stringify(latestManifest, null, 2)}\n`);

  const summaryPath = join(dirname(manifestPath), 'scenario-summary.json');
  await writeFile(summaryPath, `${JSON.stringify(renderScenarioSummary(latestManifest, scenario, roundResults), null, 2)}\n`);
  return {
    manifestPath,
    scenarioId: latestManifest.scenarioId,
    status: latestManifest.status,
    attemptedRounds,
    passedRounds,
    repairNeededRound,
    summaryPath,
    roundResults,
  };
}

export async function validateComputerUseLongRun(options: {
  manifestPath: string;
  requirePassed?: boolean;
}): Promise<ComputerUseLongRunValidation> {
  const manifestPath = resolve(options.manifestPath);
  const manifestDir = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  const issues: string[] = [];
  if (manifest.schemaVersion !== '1.0') issues.push('manifest.schemaVersion must be 1.0');
  if (manifest.taskId !== 'T084') issues.push('manifest.taskId must be T084');
  const pool = await loadComputerUseLongTaskPool();
  const scenario = pool.scenarios.find((item) => item.id === manifest.scenarioId);
  if (!scenario) {
    issues.push(`Unknown CU-LONG scenario: ${manifest.scenarioId}`);
  } else {
    if (manifest.title !== scenario.title) issues.push('manifest title does not match task pool scenario');
    if (manifest.rounds.length !== scenario.rounds.length) issues.push('manifest rounds length does not match task pool scenario');
    if (JSON.stringify(manifest.universalPipeline) !== JSON.stringify(scenario.requiredPipeline)) {
      issues.push('manifest universalPipeline does not match scenario requiredPipeline');
    }
    if (JSON.stringify(manifest.safetyBoundary) !== JSON.stringify(scenario.safetyBoundary)) {
      issues.push('manifest safetyBoundary does not match scenario safetyBoundary');
    }
    if (options.requirePassed !== false && manifest.status !== 'passed') issues.push('manifest.status must be passed');
  }
  if (!isRecord(manifest.run.windowTarget)) {
    issues.push('manifest.run.windowTarget must require window-targeted Computer Use');
  } else {
    if (manifest.run.windowTarget.mode !== 'required') issues.push('manifest.run.windowTarget.mode must be required');
    if (manifest.run.windowTarget.coordinateSpace !== 'window-local') issues.push('manifest.run.windowTarget.coordinateSpace must be window-local');
  }
  if (!isRecord(manifest.run.inputChannel)) {
    issues.push('manifest.run.inputChannel must describe generic mouse/keyboard input');
  } else {
    if (manifest.run.inputChannel.mode !== 'generic-mouse-keyboard') issues.push('manifest.run.inputChannel.mode must be generic-mouse-keyboard');
    const manifestActions = new Set(Array.isArray(manifest.run.inputChannel.allowedActionTypes) ? manifest.run.inputChannel.allowedActionTypes.map(String) : []);
    for (const action of allowedActionTypes) {
      if (!manifestActions.has(action)) issues.push(`manifest.run.inputChannel.allowedActionTypes missing ${action}`);
    }
  }
  if (!isRecord(manifest.run.scheduler)) {
    issues.push('manifest.run.scheduler must describe serialized window action scheduling');
  } else {
    if (manifest.run.scheduler.mode !== 'serialized-window-actions') issues.push('manifest.run.scheduler.mode must be serialized-window-actions');
    if (manifest.run.scheduler.requiresBeforeAfterScreenshots !== true) issues.push('manifest.run.scheduler.requiresBeforeAfterScreenshots must be true');
  }
  if (!isRecord(manifest.validationContract)) {
    issues.push('manifest.validationContract is missing');
  } else {
    if (manifest.validationContract.screenshotScope !== 'window') issues.push('manifest.validationContract.screenshotScope must be window');
    if (manifest.validationContract.coordinateSpace !== 'window-local') issues.push('manifest.validationContract.coordinateSpace must be window-local');
    if (manifest.validationContract.inputChannel !== 'generic-mouse-keyboard') issues.push('manifest.validationContract.inputChannel must be generic-mouse-keyboard');
    if (manifest.validationContract.scheduler !== 'serialized-window-actions') issues.push('manifest.validationContract.scheduler must be serialized-window-actions');
    const required = Array.isArray(manifest.validationContract.requiredTraceMetadata) ? manifest.validationContract.requiredTraceMetadata.map(String) : [];
    for (const item of requiredTraceMetadata) {
      if (!required.includes(item)) issues.push(`manifest.validationContract.requiredTraceMetadata missing ${item}`);
    }
  }

  const summaryPath = join(manifestDir, 'scenario-summary.json');
  const summary = await readOptionalJson(summaryPath);
  if (!summary) {
    issues.push('scenario-summary.json is missing');
  } else if (!isRecord(summary)) {
    issues.push('scenario-summary.json must be a JSON object');
  } else {
    if (summary.schemaVersion !== 'sciforge.computer-use-long.scenario-summary.v1') issues.push('scenario-summary schemaVersion is invalid');
    if (summary.scenarioId !== manifest.scenarioId) issues.push('scenario-summary scenarioId does not match manifest');
    if (summary.status !== manifest.status) issues.push('scenario-summary status does not match manifest');
  }

  const checkedRounds: number[] = [];
  let passedRounds = 0;
  let traceCount = 0;
  let screenshotRefCount = 0;
  let actionLedgerCount = 0;
  let failureDiagnosticsCount = 0;
  for (const round of manifest.rounds) {
    if (round.status !== 'passed') continue;
    checkedRounds.push(round.round);
    passedRounds += 1;
    if (!round.visionTraceRef) {
      issues.push(`round ${round.round} missing visionTraceRef`);
    } else {
      const tracePath = resolveManifestRef(manifestDir, round.visionTraceRef);
      const traceValidation = await validateComputerUseLongTrace({
        scenarioId: manifest.scenarioId,
        tracePath,
        workspacePath: manifest.run.workspacePath,
      });
      if (!traceValidation.ok) {
        for (const issue of traceValidation.issues) issues.push(`round ${round.round} trace: ${issue}`);
      }
      traceCount += 1;
    }
    if (!round.screenshotRefs.length) issues.push(`round ${round.round} missing screenshotRefs`);
    screenshotRefCount += round.screenshotRefs.length;
    for (const ref of round.screenshotRefs) {
      const resolved = resolveTraceRefPath(ref, resolve(manifest.run.workspacePath), manifestDir);
      const fileIssues = await validatePngRef(resolved, ref);
      for (const issue of fileIssues) issues.push(`round ${round.round}: ${issue}`);
    }
    if (!round.actionLedgerRefs.length) issues.push(`round ${round.round} missing actionLedgerRefs`);
    for (const ref of round.actionLedgerRefs) {
      actionLedgerCount += 1;
      const ledger = await readOptionalJson(resolveManifestRef(manifestDir, ref));
      if (!isRecord(ledger)) {
        issues.push(`round ${round.round} action ledger ${ref} is missing or invalid`);
      } else {
        if (ledger.schemaVersion !== 'sciforge.computer-use-long.action-ledger.v1') issues.push(`round ${round.round} action ledger schemaVersion is invalid`);
        const runtimePromptRef = typeof ledger.runtimePromptRef === 'string' ? ledger.runtimePromptRef : '';
        if (!runtimePromptRef) {
          issues.push(`round ${round.round} action ledger missing runtimePromptRef`);
        } else {
          const promptText = await readOptionalText(resolveManifestRef(manifestDir, runtimePromptRef));
          if (!promptText) issues.push(`round ${round.round} runtime prompt is missing`);
          if (promptText && /data:image|;base64,/i.test(promptText)) issues.push(`round ${round.round} runtime prompt contains inline image payload`);
        }
      }
    }
    if (!round.failureDiagnosticsRefs.length) issues.push(`round ${round.round} missing failureDiagnosticsRefs`);
    for (const ref of round.failureDiagnosticsRefs) {
      failureDiagnosticsCount += 1;
      const diagnostics = await readOptionalJson(resolveManifestRef(manifestDir, ref));
      if (!isRecord(diagnostics)) {
        issues.push(`round ${round.round} failure diagnostics ${ref} is missing or invalid`);
      } else {
        if (diagnostics.schemaVersion !== 'sciforge.computer-use-long.failure-diagnostics.v1') issues.push(`round ${round.round} failure diagnostics schemaVersion is invalid`);
        if (!isRecord(diagnostics.traceValidation)) issues.push(`round ${round.round} failure diagnostics missing traceValidation`);
      }
    }
  }
  if (scenario && options.requirePassed !== false && passedRounds < scenario.minRounds) {
    issues.push(`passed rounds ${passedRounds} is below scenario minRounds ${scenario.minRounds}`);
  }

  return {
    ok: issues.length === 0,
    manifestPath,
    scenarioId: manifest.scenarioId,
    summaryPath,
    checkedRounds,
    issues,
    metrics: {
      passedRounds,
      traceCount,
      screenshotRefCount,
      actionLedgerCount,
      failureDiagnosticsCount,
    },
  };
}

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
  actionsJson?: string;
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
      preflight,
      results,
    };
    await writeMatrixSummary(summaryPath, matrixId, summary);
    return summary;
  }

  for (const scenarioId of scenarioIds) {
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
      now,
    });
    const validation = await validateComputerUseLongRun({
      manifestPath: prepared.manifestPath,
      requirePassed: scenarioRun.status === 'passed',
    });
    const issues = await collectScenarioRunIssues(scenarioRun, validation);
    results.push({
      scenarioId,
      manifestPath: prepared.manifestPath,
      runStatus: scenarioRun.status,
      validationOk: validation.ok,
      summaryPath: scenarioRun.summaryPath,
      issues,
    });
    if (scenarioRun.status !== 'passed' || !validation.ok) break;
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
      getConfigString(config, ['modelName']),
      getConfigString(config, ['llm', 'model']),
      getConfigString(config, ['llm', 'modelName']),
      getConfigString(config, ['llmEndpoint', 'modelName']),
    ]),
  );
  const plannerReady = Boolean(plannerBaseUrl && plannerApiKey && plannerModel);
  checks.push(plannerReady ? {
    id: 'vision-planner',
    status: hasStaticActions ? 'warn' : 'pass',
    category: 'planner',
    message: hasStaticActions ? 'VisionPlanner config exists, but static actions will bypass it.' : 'OpenAI-compatible VisionPlanner config is present.',
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
    ...configCandidates.map((config) => getConfigString(config, ['visionSense', 'visualGrounderModel'])),
    plannerModel,
  );
  const visualGrounderApiKey = firstString(
    process.env.SCIFORGE_VISION_GROUNDER_LLM_API_KEY,
    ...configCandidates.map((config) => getConfigString(config, ['visionSense', 'visualGrounderApiKey'])),
    plannerApiKey,
  );
  const grounderReady = Boolean(kvGrounderUrl || (visualGrounderBaseUrl && visualGrounderApiKey && visualGrounderModel));
  checks.push(grounderReady ? {
    id: 'grounder',
    status: hasStaticActions ? 'warn' : 'pass',
    category: 'grounder',
    message: kvGrounderUrl ? 'KV-Ground-compatible endpoint is configured.' : 'OpenAI-compatible visual Grounder fallback is configured.',
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
  if (reportPath) await writeFile(reportPath, report);
  return { ok, scenarioIds, dryRun, checks, reportPath };
}

export function renderComputerUseLongRunbook(pool: ComputerUseLongTaskPool): string {
  const lines: string[] = [
    `# ${pool.taskId} ${pool.title}`,
    '',
    '## Common Principles',
    ...pool.commonPrinciples.map((item) => `- ${item}`),
    '',
  ];

  for (const scenario of pool.scenarios) {
    lines.push(`## ${scenario.id} ${scenario.title}`);
    lines.push('');
    lines.push(`Goal: ${scenario.goal}`);
    lines.push('');
    lines.push(`Pipeline: ${scenario.requiredPipeline.join(' -> ')}`);
    lines.push('');
    lines.push('Rounds:');
    for (const round of scenario.rounds) {
      lines.push(`${round.round}. ${round.prompt}`);
      lines.push(`   Expected trace: ${round.expectedTrace.join('; ')}`);
    }
    lines.push('');
    lines.push(`Acceptance: ${scenario.acceptance.join('; ')}`);
    lines.push(`Failure record: ${scenario.failureRecord.join('; ')}`);
    lines.push(`Required evidence: ${scenario.requiredEvidence.join('; ')}`);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('prepare')) {
    const args = parsePrepareArgs(process.argv.slice(2));
    const prepared = await prepareComputerUseLongRun(args);
    process.stdout.write(`[ok] prepared ${prepared.scenario.id}\n`);
    process.stdout.write(`  manifest: ${prepared.manifestPath}\n`);
    process.stdout.write(`  checklist: ${prepared.checklistPath}\n`);
    process.stdout.write(`  evidence: ${prepared.evidenceDir}\n`);
  } else if (process.argv.includes('validate-trace')) {
    const args = parseValidateTraceArgs(process.argv.slice(2));
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
  } else if (process.argv.includes('run-round')) {
    const args = parseRunRoundArgs(process.argv.slice(2));
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
  } else if (process.argv.includes('run-scenario')) {
    const args = parseRunScenarioArgs(process.argv.slice(2));
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
  } else if (process.argv.includes('validate-run')) {
    const args = parseValidateRunArgs(process.argv.slice(2));
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
  } else if (process.argv.includes('run-matrix')) {
    const args = parseRunMatrixArgs(process.argv.slice(2));
    const result = await runComputerUseLongMatrix(args);
    if (result.status !== 'passed') {
      process.stdout.write(`[repair-needed] CU-LONG matrix stopped\n`);
      process.stdout.write(`  passed scenarios: ${result.passedScenarioIds.join(', ')}\n`);
      process.stdout.write(`  repair-needed scenarios: ${result.repairNeededScenarioIds.join(', ')}\n`);
      process.stdout.write(`  summary: ${result.summaryPath}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`[ok] CU-LONG matrix passed\n`);
      process.stdout.write(`  passed scenarios: ${result.passedScenarioIds.join(', ')}\n`);
      process.stdout.write(`  summary: ${result.summaryPath}\n`);
    }
  } else if (process.argv.includes('matrix-report')) {
    const args = parseMatrixReportArgs(process.argv.slice(2));
    const result = await renderComputerUseLongMatrixReport(args);
    process.stdout.write(`[ok] CU-LONG matrix report written\n`);
    process.stdout.write(`  report: ${result.reportPath}\n`);
    if (!result.ok) {
      process.stdout.write(`  issue categories: ${JSON.stringify(result.issueCategories)}\n`);
    }
  } else if (process.argv.includes('validate-matrix')) {
    const args = parseValidateMatrixArgs(process.argv.slice(2));
    const result = await validateComputerUseLongMatrix(args);
    if (!result.ok) {
      process.stdout.write(`[failed] CU-LONG matrix validation failed\n`);
      for (const issue of result.issues) process.stdout.write(`- ${issue}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`[ok] CU-LONG matrix validation passed\n`);
      process.stdout.write(`  scenarios: ${result.scenarioIds.join(', ')}\n`);
      process.stdout.write(`  validated runs: ${result.metrics.validatedRuns}\n`);
    }
  } else if (process.argv.includes('repair-plan')) {
    const args = parseRepairPlanArgs(process.argv.slice(2));
    const result = await renderComputerUseLongRepairPlan(args);
    process.stdout.write(`[ok] CU-LONG repair plan written\n`);
    process.stdout.write(`  plan: ${result.planPath}\n`);
    process.stdout.write(`  actions: ${result.actionCount}\n`);
  } else if (process.argv.includes('preflight')) {
    const args = parsePreflightArgs(process.argv.slice(2));
    const result = await preflightComputerUseLong(args);
    if (!result.ok) {
      process.stdout.write(`[failed] CU-LONG preflight failed\n`);
      for (const check of result.checks.filter((item) => item.status === 'fail')) {
        process.stdout.write(`- [${check.category}] ${check.message}\n`);
      }
      if (result.reportPath) process.stdout.write(`  report: ${result.reportPath}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`[ok] CU-LONG preflight passed\n`);
      const warnings = result.checks.filter((item) => item.status === 'warn');
      if (warnings.length) process.stdout.write(`  warnings: ${warnings.length}\n`);
      if (result.reportPath) process.stdout.write(`  report: ${result.reportPath}\n`);
    }
  } else {
    const pool = await loadComputerUseLongTaskPool();
    const issues = validateComputerUseLongTaskPool(pool);
    if (issues.length) {
      throw new Error(`Invalid T084 Computer Use task pool:\n${issues.join('\n')}`);
    }
    const outIndex = process.argv.indexOf('--out');
    if (outIndex >= 0) {
      const outPath = process.argv[outIndex + 1];
      if (!outPath) throw new Error('--out requires a path');
      await writeFile(outPath, renderComputerUseLongRunbook(pool));
    } else {
      process.stdout.write(renderComputerUseLongRunbook(pool));
    }
  }
}

function renderScenarioSummary(
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

async function writeMatrixSummary(summaryPath: string, matrixId: string, summary: ComputerUseLongMatrixRunResult) {
  await writeFile(summaryPath, `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use-long.matrix-summary.v1',
    taskId: 'T084',
    matrixId,
    status: summary.status,
    scenarioIds: summary.scenarioIds,
    passedScenarioIds: summary.passedScenarioIds,
    repairNeededScenarioIds: summary.repairNeededScenarioIds,
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

function renderMatrixReportMarkdown(
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

function renderPreflightReport(params: {
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

function renderRepairPlanMarkdown(summaryPath: string, summary: Record<string, unknown>) {
  const status = String(summary.status || 'unknown');
  const scenarioIds = Array.isArray(summary.scenarioIds) ? summary.scenarioIds.map(String) : [];
  const results = Array.isArray(summary.results) ? summary.results.filter(isRecord) : [];
  const preflight = isRecord(summary.preflight) ? summary.preflight : undefined;
  const preflightChecks = preflight && Array.isArray(preflight.checks) ? preflight.checks.filter(isRecord) : [];
  const failedPreflight = preflightChecks.filter((check) => check.status === 'fail');
  const lines = [
    '# T084 Computer Use Repair Plan',
    '',
    `Summary: ${manifestRel(process.cwd(), summaryPath)}`,
    `Status: ${status}`,
    `Scenarios: ${scenarioIds.join(', ') || 'none'}`,
    '',
  ];
  const actions: string[] = [];
  for (const check of failedPreflight) {
    const category = categorizeComputerUseIssue(`${String(check.category || '')} ${String(check.id || '')} ${String(check.message || '')}`);
    const repairAction = typeof check.repairAction === 'string' ? check.repairAction : repairActionsForIssues([String(check.message || '')])[0];
    actions.push(`[preflight/${category}] ${String(check.message || '')} Repair: ${repairAction}`);
  }
  for (const result of results) {
    const scenarioId = String(result.scenarioId || 'unknown');
    const manifestPath = typeof result.manifestPath === 'string' ? result.manifestPath : '';
    const issues = Array.isArray(result.issues) ? result.issues.map(String) : [];
    if (!issues.length && result.runStatus !== 'passed') {
      actions.push(`[${scenarioId}/other] Scenario did not pass but recorded no validation issues. Repair: inspect ${manifestPath || 'manifest'} and rerun validate-run.`);
      continue;
    }
    const categories = new Map<string, string[]>();
    for (const issue of issues) {
      const category = categorizeComputerUseIssue(issue);
      categories.set(category, [...(categories.get(category) ?? []), issue]);
    }
    for (const [category, categoryIssues] of categories) {
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

function categorizeComputerUseIssue(issue: string) {
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

async function collectScenarioRunIssues(
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

function firstString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function getConfigString(config: Record<string, unknown>, path: string[]) {
  let cursor: unknown = config;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return firstString(cursor);
}

function renderRoundRuntimePrompt(
  manifest: PreparedComputerUseLongRun,
  round: PreparedComputerUseLongRun['rounds'][number],
  suffix?: string,
) {
  const priorEvidence = renderPriorRoundEvidence(manifest, round.round);
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

function renderPriorRoundEvidence(manifest: PreparedComputerUseLongRun, currentRound: number) {
  const priorRounds = manifest.rounds.filter((item) => item.round < currentRound && item.status === 'passed');
  if (!priorRounds.length) return '';
  const lines = [
    'Compact prior-round file refs for follow-up image memory. Reuse these refs as context only; do not inline image bytes:',
  ];
  for (const prior of priorRounds) {
    lines.push(`- round ${prior.round} trace: ${prior.visionTraceRef || 'missing'}`);
    for (const ref of prior.screenshotRefs.slice(0, 8)) lines.push(`  screenshot: ${ref}`);
    for (const ref of prior.actionLedgerRefs) lines.push(`  actionLedger: ${ref}`);
    for (const ref of prior.failureDiagnosticsRefs) lines.push(`  failureDiagnostics: ${ref}`);
    if (prior.screenshotRefs.length > 8) lines.push(`  screenshotRefsOmitted: ${prior.screenshotRefs.length - 8}`);
  }
  return lines.join('\n');
}

function findPayloadTraceRef(payload: { artifacts?: Array<Record<string, unknown>>; executionUnits?: Array<Record<string, unknown>> }) {
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

function resolveTraceArtifactPath(traceRef: string, workspacePath: string) {
  if (isAbsolute(traceRef)) return traceRef;
  return resolve(workspacePath, traceRef);
}

function resolveManifestRef(manifestDir: string, refPath: string) {
  if (isAbsolute(refPath)) return refPath;
  return resolve(manifestDir, refPath);
}

async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

async function readOptionalText(path: string) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function screenshotRefsFromTrace(tracePath: string) {
  const trace = JSON.parse(await readFile(tracePath, 'utf8')) as unknown;
  if (!isRecord(trace) || !isRecord(trace.imageMemory) || !Array.isArray(trace.imageMemory.refs)) return [];
  return trace.imageMemory.refs
    .filter(isRecord)
    .map((ref) => typeof ref.path === 'string' ? ref.path : '')
    .filter(Boolean);
}

function renderActionLedger(
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

function renderFailureDiagnostics(
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

function manifestRel(root: string, path: string) {
  return relative(root, path).replace(/\\/g, '/');
}

function defaultWindowTargetForRound(manifest: PreparedComputerUseLongRun, round: number) {
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

async function withScopedVisionRuntimeEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function emptyTraceValidation(scenarioId: string, tracePath: string, issues: string[]): ComputerUseLongTraceValidation {
  return {
    ok: false,
    scenarioId,
    tracePath,
    checkedScreenshotRefs: [],
    issues,
    metrics: { stepCount: 0, actionCount: 0, nonWaitActionCount: 0, screenshotCount: 0, blockedCount: 0, failedCount: 0 },
  };
}

async function validatePngRef(path: string, label: string) {
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

function resolveTraceRefPath(refPath: string, workspacePath: string, traceDir: string) {
  if (isAbsolute(refPath)) return refPath;
  const workspaceCandidate = resolve(workspacePath, refPath);
  if (workspacePath && refPath.startsWith('.sciforge/')) return workspaceCandidate;
  return resolve(traceDir, refPath);
}

function hasWindowBounds(value: Record<string, unknown>) {
  const bounds = isRecord(value.bounds) ? value.bounds : isRecord(value.windowBounds) ? value.windowBounds : value;
  return ['x', 'y', 'width', 'height'].every((key) => typeof bounds[key] === 'number')
    || ['left', 'top', 'right', 'bottom'].every((key) => typeof bounds[key] === 'number');
}

function screenshotRefHasWindowMetadata(value: unknown) {
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

function screenshotStepRefs(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function hasWindowLocalCoordinates(value: unknown) {
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

function hasInputChannelMetadata(execution: Record<string, unknown>, action: Record<string, unknown> | undefined) {
  const inputChannel = firstString(execution.inputChannel, execution.channel, action?.inputChannel, action?.channel);
  return Boolean(inputChannel && /generic|mouse|keyboard|desktop/i.test(inputChannel));
}

function hasStepWindowTarget(step: Record<string, unknown>, traceWindowTarget: Record<string, unknown> | undefined) {
  const windowTarget = isRecord(step.windowTarget) ? step.windowTarget : traceWindowTarget;
  if (!windowTarget) return false;
  return Boolean(firstString(windowTarget.windowId, windowTarget.id, windowTarget.handle, windowTarget.title, windowTarget.appName, windowTarget.bundleId))
    && hasWindowBounds(windowTarget);
}

function hasSchedulerMetadata(step: Record<string, unknown>, traceScheduler: Record<string, unknown> | undefined) {
  const scheduler = isRecord(step.scheduler) ? step.scheduler : traceScheduler;
  if (!scheduler) return false;
  const mode = firstString(scheduler.mode, scheduler.policy, scheduler.queue);
  return Boolean(mode && /serial|ordered|single|window/i.test(mode));
}

function hasForbiddenPrivateFields(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return collectKeys(value).some((key) => /dom|selector|accessibility|aria|xpath|css|appApi|privateShortcut/i.test(key));
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderPreparedRunChecklist(scenario: ComputerUseLongScenario, manifest: PreparedComputerUseLongRun) {
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
    } else if (arg === '--actions-json') {
      options.actionsJson = readArgValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.scenarioIds && !options.scenarioIds.length) throw new Error('run-matrix --scenarios must include at least one scenario id');
  if (options.maxSteps !== undefined && (!Number.isInteger(options.maxSteps) || options.maxSteps < 1)) {
    throw new Error('run-matrix --max-steps must be a positive integer');
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

function sanitizeRunId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'cu-long-run';
}

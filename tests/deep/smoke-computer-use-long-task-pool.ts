import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadComputerUseLongTaskPool,
  prepareComputerUseLongRun,
  preflightComputerUseLong,
  renderComputerUseLongRepairPlan,
  renderComputerUseLongRunbook,
  renderComputerUseLongMatrixReport,
  runComputerUseLongMatrix,
  runComputerUseLongRound,
  runComputerUseLongScenario,
  validateComputerUseLongMatrix,
  validateComputerUseLongRun,
  validateComputerUseLongTrace,
  validateComputerUseLongTaskPool,
} from '../../tools/computer-use-long-task-pool';
import { toolPackageManifests } from '../../packages/tools';

const pool = await loadComputerUseLongTaskPool();
const visionSenseTool = toolPackageManifests.find((tool) => tool.id === 'local.vision-sense');
assert.ok(visionSenseTool);
assert.equal(visionSenseTool.toolType, 'sense-plugin');
const visionRequiredConfig = [...(visionSenseTool.requiredConfig ?? [])] as string[];
const visionOutputFormats = [...(visionSenseTool.sensePlugin?.outputContract.formats ?? [])] as string[];
const visionOutputContract = visionSenseTool.sensePlugin?.outputContract as Record<string, unknown> | undefined;
assert.deepEqual(visionSenseTool.sensePlugin?.inputContract.acceptedModalities, ['screenshot', 'image']);
assert.equal(visionSenseTool.sensePlugin?.outputContract.kind, 'text');
assert.ok(visionOutputFormats.includes('text/plain'));
assert.ok(!visionRequiredConfig.includes('gui-executor'));
assert.ok(!visionOutputFormats.includes('text/x-computer-use-command'));
assert.equal(visionOutputContract?.commandSchema, undefined);
const issues = validateComputerUseLongTaskPool(pool);
assert.deepEqual(issues, []);
assert.equal(pool.scenarios.length, 10);
assert.equal(pool.scenarios[0].id, 'CU-LONG-001');
assert.equal(pool.scenarios.at(-1)?.id, 'CU-LONG-010');

for (const scenario of pool.scenarios) {
  const scenarioContract = [
    scenario.goal,
    ...scenario.acceptance,
    ...scenario.requiredEvidence,
    ...scenario.failureRecord,
    ...scenario.rounds.flatMap((round) => [round.prompt, ...round.expectedTrace]),
  ].join(' ');
  assert.ok(scenario.rounds.length >= 3, `${scenario.id} has 3+ rounds`);
  assert.ok(scenario.acceptance.some((item) => /base64|dataUrl|data:image/i.test(item)), `${scenario.id} checks base64/dataUrl`);
  assert.ok(scenario.acceptance.some((item) => /DOM|accessibility/i.test(item)), `${scenario.id} checks DOM/accessibility`);
  assert.match(scenarioContract, /windowTarget|window target|window-local|window screenshot/i, `${scenario.id} checks window-target trace metadata`);
  assert.match(scenarioContract, /input channel|mouse\/keyboard|generic mouse|keyboard/i, `${scenario.id} checks generic input channel`);
  assert.match(scenarioContract, /scheduler|serialized|ordered/i, `${scenario.id} checks serialized scheduling`);
  assert.equal(scenario.safetyBoundary.appSpecificShortcutsAllowed, false, `${scenario.id} forbids app-specific shortcuts`);
}

const runbook = renderComputerUseLongRunbook(pool);
assert.match(runbook, /T084/);
assert.match(runbook, /CU-LONG-006 SciForge 自举测试/);
assert.match(runbook, /WindowTarget -> VisionPlanner -> Grounder -> GuiExecutor -> Verifier -> vision-trace/);

const outDir = await mkdtemp(join(tmpdir(), 'sciforge-cu-long-'));
const outPath = join(outDir, 'runbook.md');
await import('../../tools/computer-use-long-task-pool').then(async ({ renderComputerUseLongRunbook }) => {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(outPath, renderComputerUseLongRunbook(pool));
});
assert.equal((await stat(outPath)).isFile(), true);
assert.match(await readFile(outPath, 'utf8'), /Required evidence: vision-trace\.json/);

const preparedRoot = await mkdtemp(join(tmpdir(), 'sciforge-cu-long-prepare-'));
const prepared = await prepareComputerUseLongRun({
  scenarioId: 'CU-LONG-006',
  outRoot: preparedRoot,
  runId: 'cu-long-fixture',
  workspacePath: '/tmp/sciforge-cu-workspace',
  appUrl: 'http://localhost:5173/',
  backend: 'codex',
  operator: 'Codex smoke',
  now: new Date('2026-05-04T12:00:00.000Z'),
});
assert.equal((await stat(prepared.manifestPath)).isFile(), true);
assert.equal((await stat(prepared.checklistPath)).isFile(), true);
const manifest = JSON.parse(await readFile(prepared.manifestPath, 'utf8')) as Record<string, unknown>;
assert.equal(manifest.taskId, 'T084');
assert.equal(manifest.scenarioId, 'CU-LONG-006');
assert.equal((manifest.rounds as unknown[]).length, 5);
assert.equal((((manifest.run as Record<string, unknown>).windowTarget as Record<string, unknown>).mode), 'required');
assert.equal((((manifest.run as Record<string, unknown>).windowTarget as Record<string, unknown>).coordinateSpace), 'window-local');
assert.equal((((manifest.run as Record<string, unknown>).inputChannel as Record<string, unknown>).mode), 'generic-mouse-keyboard');
assert.equal((((manifest.run as Record<string, unknown>).scheduler as Record<string, unknown>).mode), 'serialized-window-actions');
assert.match(await readFile(prepared.checklistPath, 'utf8'), /Non-Negotiable Genericity Rules/);

const previousBridge = process.env.SCIFORGE_VISION_DESKTOP_BRIDGE;
const previousDryRun = process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN;
const previousRunId = process.env.SCIFORGE_VISION_RUN_ID;
const previousDisplays = process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS;
const previousActions = process.env.SCIFORGE_VISION_ACTIONS_JSON;
const previousPlannerBaseUrl = process.env.SCIFORGE_VISION_PLANNER_BASE_URL;
const previousPlannerApiKey = process.env.SCIFORGE_VISION_PLANNER_API_KEY;
const previousPlannerModel = process.env.SCIFORGE_VISION_PLANNER_MODEL;
const previousGrounderBaseUrl = process.env.SCIFORGE_VISION_GROUNDER_LLM_BASE_URL;
const previousGrounderApiKey = process.env.SCIFORGE_VISION_GROUNDER_LLM_API_KEY;
const previousGrounderModel = process.env.SCIFORGE_VISION_GROUNDER_LLM_MODEL;
const previousHighRisk = process.env.SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS;
try {
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE = '1';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '1';
  process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS = '1';
  delete process.env.SCIFORGE_VISION_RUN_ID;
  process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([{ type: 'wait', ms: 1 }]);
  process.env.SCIFORGE_VISION_PLANNER_BASE_URL = 'http://127.0.0.1:9999/v1';
  process.env.SCIFORGE_VISION_PLANNER_API_KEY = 'preflight-key';
  process.env.SCIFORGE_VISION_PLANNER_MODEL = 'preflight-model';
  process.env.SCIFORGE_VISION_GROUNDER_LLM_BASE_URL = 'http://127.0.0.1:9999/v1';
  process.env.SCIFORGE_VISION_GROUNDER_LLM_API_KEY = 'preflight-key';
  process.env.SCIFORGE_VISION_GROUNDER_LLM_MODEL = 'preflight-model';
  delete process.env.SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS;
  const smokeActionsJson = JSON.stringify([{ type: 'type_text', text: 'T084 generic window CU round smoke' }]);
  const preflight = await preflightComputerUseLong({
    scenarioIds: ['CU-LONG-001', 'CU-LONG-006'],
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: true,
    out: join(preparedRoot, 'preflight.md'),
  });
  assert.equal(preflight.ok, true);
  assert.equal((await stat(String(preflight.reportPath))).isFile(), true);
  assert.ok(preflight.checks.some((check) => check.id === 'vision-planner' && check.status === 'pass'));
  const staticPreflight = await preflightComputerUseLong({
    scenarioIds: ['CU-LONG-001'],
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: true,
    actionsJson: smokeActionsJson,
  });
  assert.equal(staticPreflight.ok, true);
  assert.ok(staticPreflight.checks.some((check) => check.id === 'static-actions' && check.status === 'warn'));
  process.env.SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS = '1';
  const unsafePreflight = await preflightComputerUseLong({
    scenarioIds: ['CU-LONG-001'],
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: true,
  });
  assert.equal(unsafePreflight.ok, false);
  assert.ok(unsafePreflight.checks.some((check) => check.id === 'high-risk-boundary' && check.status === 'fail'));
  delete process.env.SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS;
  const roundRun = await runComputerUseLongRound({
    manifestPath: prepared.manifestPath,
    round: 1,
    dryRun: true,
    maxSteps: 1,
    runId: 'cu-long-fixture-round-01',
    actionsJson: smokeActionsJson,
    now: new Date('2026-05-04T12:10:00.000Z'),
  });
  assert.equal(roundRun.status, 'passed');
  assert.equal(roundRun.validation?.ok, true);
  assert.equal(roundRun.validation?.metrics.actionCount, 1);
  assert.equal(roundRun.validation?.metrics.nonWaitActionCount, 1);
  assert.equal((await stat(roundRun.actionLedgerPath)).isFile(), true);
  assert.equal((await stat(roundRun.failureDiagnosticsPath)).isFile(), true);
  const updatedManifest = JSON.parse(await readFile(prepared.manifestPath, 'utf8')) as Record<string, unknown>;
  const updatedRounds = updatedManifest.rounds as Array<Record<string, unknown>>;
  assert.equal(updatedRounds[0].status, 'passed');
  assert.match(String(updatedRounds[0].visionTraceRef), /evidence\/round-01\/vision-trace\.json/);
  assert.ok((updatedRounds[0].screenshotRefs as unknown[]).length >= 2);
  assert.match(await readFile(roundRun.actionLedgerPath, 'utf8'), /sciforge\.computer-use-long\.action-ledger\.v1/);
  assert.match(await readFile(roundRun.actionLedgerPath, 'utf8'), /runtime-prompt\.md/);
  const round2Run = await runComputerUseLongRound({
    manifestPath: prepared.manifestPath,
    round: 2,
    dryRun: true,
    maxSteps: 1,
    runId: 'cu-long-fixture-round-02',
    actionsJson: smokeActionsJson,
    now: new Date('2026-05-04T12:20:00.000Z'),
  });
  assert.equal(round2Run.status, 'passed');
  const round2Prompt = await readFile(join(prepared.runDir, 'evidence/round-02/runtime-prompt.md'), 'utf8');
  assert.match(round2Prompt, /Compact prior-round file refs/);
  assert.match(round2Prompt, /round 1 trace: evidence\/round-01\/vision-trace\.json/);
  assert.doesNotMatch(round2Prompt, /data:image|;base64,/i);

  const preparedScenario = await prepareComputerUseLongRun({
    scenarioId: 'CU-LONG-006',
    outRoot: preparedRoot,
    runId: 'cu-long-scenario-fixture',
    workspacePath: '/tmp/sciforge-cu-workspace',
    appUrl: 'http://localhost:5173/',
    backend: 'codex',
    operator: 'Codex smoke',
    now: new Date('2026-05-04T12:30:00.000Z'),
  });
  const scenarioRun = await runComputerUseLongScenario({
    manifestPath: preparedScenario.manifestPath,
    rounds: 5,
    dryRun: true,
    maxSteps: 1,
    actionsJson: smokeActionsJson,
    now: new Date('2026-05-04T12:40:00.000Z'),
  });
  assert.equal(scenarioRun.status, 'passed');
  assert.deepEqual(scenarioRun.attemptedRounds, [1, 2, 3, 4, 5]);
  assert.deepEqual(scenarioRun.passedRounds, [1, 2, 3, 4, 5]);
  assert.equal((await stat(scenarioRun.summaryPath)).isFile(), true);
  const scenarioSummary = await readFile(scenarioRun.summaryPath, 'utf8');
  assert.match(scenarioSummary, /sciforge\.computer-use-long\.scenario-summary\.v1/);
  assert.doesNotMatch(scenarioSummary, /data:image|;base64,/i);
  const runValidation = await validateComputerUseLongRun({ manifestPath: preparedScenario.manifestPath });
  assert.deepEqual(runValidation.issues, []);
  assert.equal(runValidation.metrics.passedRounds, 5);
  assert.equal(runValidation.metrics.traceCount, 5);
  assert.equal(runValidation.metrics.actionLedgerCount, 5);
  assert.equal(runValidation.metrics.failureDiagnosticsCount, 5);
  const brokenManifestPath = join(preparedScenario.runDir, 'broken-manifest.json');
  await copyFile(preparedScenario.manifestPath, brokenManifestPath);
  const brokenManifest = JSON.parse(await readFile(brokenManifestPath, 'utf8')) as Record<string, unknown>;
  const brokenRounds = brokenManifest.rounds as Array<Record<string, unknown>>;
  brokenRounds[0].actionLedgerRefs = [];
  await writeFile(brokenManifestPath, `${JSON.stringify(brokenManifest, null, 2)}\n`);
  const brokenValidation = await validateComputerUseLongRun({ manifestPath: brokenManifestPath });
  assert.equal(brokenValidation.ok, false);
  assert.ok(brokenValidation.issues.some((issue) => /round 1 missing actionLedgerRefs/.test(issue)));

  const matrixRun = await runComputerUseLongMatrix({
    scenarioIds: ['CU-LONG-001', 'CU-LONG-006'],
    outRoot: preparedRoot,
    workspacePath: '/tmp/sciforge-cu-workspace',
    appUrl: 'http://localhost:5173/',
    backend: 'codex',
    operator: 'Codex smoke',
    dryRun: true,
    maxSteps: 1,
    maxConcurrency: 2,
    actionsJson: smokeActionsJson,
    now: new Date('2026-05-04T13:00:00.000Z'),
  });
  assert.equal(matrixRun.status, 'passed');
  assert.equal(matrixRun.executionPlan?.mode, 'parallel-analysis');
  assert.equal(matrixRun.executionPlan?.maxConcurrency, 2);
  assert.equal(matrixRun.executionPlan?.realGuiSerialized, true);
  assert.equal(matrixRun.preflight?.ok, true);
  assert.deepEqual(matrixRun.passedScenarioIds, ['CU-LONG-001', 'CU-LONG-006']);
  assert.deepEqual(matrixRun.repairNeededScenarioIds, []);
  assert.equal((await stat(matrixRun.summaryPath)).isFile(), true);
  const matrixSummary = await readFile(matrixRun.summaryPath, 'utf8');
  assert.match(matrixSummary, /sciforge\.computer-use-long\.matrix-summary\.v1/);
  assert.match(matrixSummary, /parallel-analysis/);
  assert.match(matrixSummary, /CU-LONG-001/);
  assert.match(matrixSummary, /CU-LONG-006/);
  assert.doesNotMatch(matrixSummary, /data:image|;base64,/i);
  const matrixValidation = await validateComputerUseLongMatrix({ summaryPath: matrixRun.summaryPath });
  assert.deepEqual(matrixValidation.issues, []);
  assert.equal(matrixValidation.metrics.validatedRuns, 2);
  const matrixReport = await renderComputerUseLongMatrixReport({ summaryPath: matrixRun.summaryPath });
  assert.equal(matrixReport.ok, true);
  assert.equal((await stat(matrixReport.reportPath)).isFile(), true);
  assert.match(matrixReport.markdown, /T084 Computer Use Matrix Report/);
  assert.match(matrixReport.markdown, /## Preflight/);
  assert.match(matrixReport.markdown, /Genericity Rules Rechecked/);
  assert.doesNotMatch(matrixReport.markdown, /data:image|;base64,/i);
  const passedRepairPlan = await renderComputerUseLongRepairPlan({ summaryPath: matrixRun.summaryPath });
  assert.equal(passedRepairPlan.ok, true);
  assert.equal(passedRepairPlan.actionCount, 0);

  process.env.SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS = '1';
  const blockedMatrix = await runComputerUseLongMatrix({
    scenarioIds: ['CU-LONG-001'],
    outRoot: preparedRoot,
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: true,
    maxSteps: 1,
    actionsJson: smokeActionsJson,
    now: new Date('2026-05-04T13:10:00.000Z'),
  });
  assert.equal(blockedMatrix.status, 'repair-needed');
  assert.equal(blockedMatrix.executionPlan?.mode, 'parallel-analysis');
  assert.equal(blockedMatrix.preflight?.ok, false);
  assert.deepEqual(blockedMatrix.results, []);
  assert.deepEqual(blockedMatrix.repairNeededScenarioIds, ['CU-LONG-001']);
  const blockedMatrixSummary = await readFile(blockedMatrix.summaryPath, 'utf8');
  assert.match(blockedMatrixSummary, /high-risk-boundary/);
  const blockedMatrixValidation = await validateComputerUseLongMatrix({ summaryPath: blockedMatrix.summaryPath });
  assert.deepEqual(blockedMatrixValidation.issues, []);
  assert.equal(blockedMatrixValidation.metrics.preflightFailedChecks, 1);
  const blockedMatrixReport = await renderComputerUseLongMatrixReport({ summaryPath: blockedMatrix.summaryPath });
  assert.equal(blockedMatrixReport.ok, false);
  assert.equal(blockedMatrixReport.issueCategories['safety-boundary'], 1);
  assert.match(blockedMatrixReport.markdown, /failed checks: 1/);
  const blockedRepairPlan = await renderComputerUseLongRepairPlan({ summaryPath: blockedMatrix.summaryPath });
  assert.equal(blockedRepairPlan.ok, false);
  assert.equal(blockedRepairPlan.actionCount, 1);
  assert.match(blockedRepairPlan.markdown, /preflight\/safety-boundary/);
  assert.match(blockedRepairPlan.markdown, /Unset SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS/);
  delete process.env.SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS;

  const brokenMatrixSummaryPath = join(preparedRoot, 'broken-matrix-summary.json');
  const brokenMatrixSummary = JSON.parse(matrixSummary) as Record<string, unknown>;
  const brokenResults = brokenMatrixSummary.results as Array<Record<string, unknown>>;
  brokenMatrixSummary.status = 'repair-needed';
  brokenMatrixSummary.repairNeededScenarioIds = ['CU-LONG-001'];
  brokenResults[0].validationOk = false;
  brokenResults[0].issues = ['round 1 missing screenshotRefs', 'round 1 action ledger missing runtimePromptRef'];
  await writeFile(brokenMatrixSummaryPath, `${JSON.stringify(brokenMatrixSummary, null, 2)}\n`);
  const brokenMatrixReport = await renderComputerUseLongMatrixReport({ summaryPath: brokenMatrixSummaryPath });
  assert.equal(brokenMatrixReport.ok, false);
  assert.equal(brokenMatrixReport.issueCategories['image-memory'], 1);
  assert.equal(brokenMatrixReport.issueCategories['evidence-ledger'], 1);
  assert.match(brokenMatrixReport.markdown, /Repair screenshot file refs/);
  const brokenRepairPlan = await renderComputerUseLongRepairPlan({ summaryPath: brokenMatrixSummaryPath });
  assert.equal(brokenRepairPlan.ok, false);
  assert.ok(brokenRepairPlan.actionCount >= 2);
  assert.match(brokenRepairPlan.markdown, /CU-LONG-001\/image-memory/);
  assert.match(brokenRepairPlan.markdown, /CU-LONG-001\/evidence-ledger/);
} finally {
  restoreEnv('SCIFORGE_VISION_DESKTOP_BRIDGE', previousBridge);
  restoreEnv('SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN', previousDryRun);
  restoreEnv('SCIFORGE_VISION_RUN_ID', previousRunId);
  restoreEnv('SCIFORGE_VISION_CAPTURE_DISPLAYS', previousDisplays);
  restoreEnv('SCIFORGE_VISION_ACTIONS_JSON', previousActions);
  restoreEnv('SCIFORGE_VISION_PLANNER_BASE_URL', previousPlannerBaseUrl);
  restoreEnv('SCIFORGE_VISION_PLANNER_API_KEY', previousPlannerApiKey);
  restoreEnv('SCIFORGE_VISION_PLANNER_MODEL', previousPlannerModel);
  restoreEnv('SCIFORGE_VISION_GROUNDER_LLM_BASE_URL', previousGrounderBaseUrl);
  restoreEnv('SCIFORGE_VISION_GROUNDER_LLM_API_KEY', previousGrounderApiKey);
  restoreEnv('SCIFORGE_VISION_GROUNDER_LLM_MODEL', previousGrounderModel);
  restoreEnv('SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS', previousHighRisk);
}

const traceWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-long-trace-'));
const runDir = join(traceWorkspace, '.sciforge/vision-runs/cu-long-fixture');
await import('node:fs/promises').then(({ mkdir }) => mkdir(runDir, { recursive: true }));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADgwGOSyRGjgAAAABJRU5ErkJggg==',
  'base64',
);
await writeFile(join(runDir, 'step-001-before-window-42.png'), png);
await writeFile(join(runDir, 'step-001-after-window-42.png'), png);
const sha = createHash('sha256').update(png).digest('hex');
const fixtureWindowTarget = {
  windowId: 42,
  title: 'Generic target window',
  appName: 'Generic desktop app',
  coordinateSpace: 'window-local',
  bounds: { x: 100, y: 200, width: 800, height: 600 },
};
const fixtureScheduler = {
  mode: 'serialized-window-actions',
  lockId: 'window-42-lock',
  lockScope: 'target-window',
  actionConcurrency: 'one-real-gui-action-at-a-time-per-window',
  analysisConcurrency: 'parallel-allowed',
  focusPolicy: 'require-focused-target-before-action',
  interferenceRisk: 'low-when-focused-target-verified',
  failClosedIsolation: true,
};
const beforeWindowRef = {
  path: '.sciforge/vision-runs/cu-long-fixture/step-001-before-window-42.png',
  scope: 'window-screenshot',
  windowId: 42,
  windowTitle: 'Generic target window',
  bounds: fixtureWindowTarget.bounds,
  sha256: sha,
  width: 1,
  height: 1,
};
const afterWindowRef = {
  path: '.sciforge/vision-runs/cu-long-fixture/step-001-after-window-42.png',
  scope: 'window-screenshot',
  windowId: 42,
  windowTitle: 'Generic target window',
  bounds: fixtureWindowTarget.bounds,
  sha256: sha,
  width: 1,
  height: 1,
};
const trace = {
  schemaVersion: 'sciforge.vision-trace.v1',
  windowTarget: fixtureWindowTarget,
  scheduler: fixtureScheduler,
  genericComputerUse: {
    actionSchema: ['click', 'double_click', 'drag', 'type_text', 'press_key', 'hotkey', 'scroll', 'wait'],
    appSpecificShortcuts: [],
    inputChannel: 'generic-mouse-keyboard',
    inputChannelContract: {
      type: 'generic-mouse-keyboard',
      pointerKeyboardOwnership: 'virtual-dry-run-channel',
      pointerMode: 'virtual-no-user-pointer-movement',
      keyboardMode: 'virtual-no-user-keyboard-events',
      userDeviceImpact: 'none',
      highRiskConfirmationRequired: true,
    },
    coordinateContract: {
      planner: 'target descriptions only',
      grounderOutput: 'target-window screenshot coordinates',
      executorInput: 'window-local',
      localCoordinateFrame: 'window screenshot pixels before executor mapping',
    },
    verifierContract: {
      screenshotScope: 'target-window',
      beforeAfterWindowConsistency: 'required-or-structured-window-lifecycle-diagnostics',
    },
  },
  windowLifecycle: {
    status: 'stable-or-single-window',
    recoveryPolicy: 're-resolve target window by id/app/title when displayId, bounds, focus, minimized, or occlusion state changes',
  },
  imageMemory: {
    policy: 'file-ref-only',
    refs: [beforeWindowRef, afterWindowRef],
  },
  steps: [{
    id: 'step-001-execute-click',
    kind: 'gui-execution',
    status: 'done',
    windowTarget: fixtureWindowTarget,
    scheduler: fixtureScheduler,
    beforeScreenshotRefs: [beforeWindowRef],
    afterScreenshotRefs: [afterWindowRef],
    plannedAction: {
      type: 'click',
      targetDescription: 'generic target',
      coordinateSpace: 'window-local',
      localX: 1,
      localY: 1,
      mappedX: 101,
      mappedY: 201,
    },
    grounding: {
      status: 'ok',
      provider: 'kv-ground',
      targetDescription: 'generic target',
      coordinateSpace: 'window-local',
      localX: 1,
      localY: 1,
      mappedX: 101,
      mappedY: 201,
    },
    execution: {
      status: 'done',
      executor: 'dry-run-generic-gui-executor',
      inputChannel: 'generic-mouse-keyboard',
    },
    verifier: {
      status: 'checked',
      method: 'window-pixel-diff',
      windowConsistency: {
        status: 'same-target-window',
        sameWindow: true,
        requiredScope: 'window',
      },
    },
  }],
};
const tracePath = join(runDir, 'vision-trace.json');
await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`);
const traceValidation = await validateComputerUseLongTrace({
  scenarioId: 'CU-LONG-001',
  tracePath,
  workspacePath: traceWorkspace,
});
assert.deepEqual(traceValidation.issues, []);
assert.equal(traceValidation.metrics.actionCount, 1);
assert.equal(traceValidation.metrics.screenshotCount, 2);

const realGuiTracePath = join(runDir, 'real-gui-vision-trace.json');
await writeFile(realGuiTracePath, `${JSON.stringify({
  ...trace,
  config: { dryRun: false },
  scheduler: {
    ...fixtureScheduler,
    executorLock: {
      provider: 'filesystem-lease',
      pathRoot: '/tmp/sciforge-computer-use-locks',
      timeoutMs: 60000,
      staleLockMs: 120000,
      appliesTo: 'real-gui-executor',
    },
  },
  genericComputerUse: {
    ...(trace.genericComputerUse as Record<string, unknown>),
    inputChannelContract: {
      type: 'generic-mouse-keyboard',
      pointerKeyboardOwnership: 'shared-system-pointer-keyboard',
      pointerMode: 'system-cursor-events',
      keyboardMode: 'system-key-events',
      userDeviceImpact: 'may-use-system-input-after-focused-target-verification',
      highRiskConfirmationRequired: true,
    },
  },
  steps: [{
    ...(trace.steps[0] as Record<string, unknown>),
    scheduler: {
      ...fixtureScheduler,
      executorLease: {
        mode: 'real-gui-executor-lock',
        lockId: 'window-42-lock',
        lockPath: '/tmp/sciforge-computer-use-locks/window-42-lock.lock',
        acquiredAt: '2026-05-04T12:00:00.000Z',
        releasedAt: '2026-05-04T12:00:00.100Z',
        waitMs: 0,
      },
    },
  }],
}, null, 2)}\n`);
const realGuiValidation = await validateComputerUseLongTrace({
  scenarioId: 'CU-LONG-001',
  tracePath: realGuiTracePath,
  workspacePath: traceWorkspace,
});
assert.deepEqual(realGuiValidation.issues, []);

await writeFile(join(runDir, 'step-000-planner-window-42.png'), png);
const plannerWindowRef = {
  path: '.sciforge/vision-runs/cu-long-fixture/step-000-planner-window-42.png',
  scope: 'window-screenshot',
  windowId: 42,
  windowTitle: 'Generic target window',
  bounds: fixtureWindowTarget.bounds,
  sha256: sha,
  width: 1,
  height: 1,
};
const plannerOnlyTrace = {
  schemaVersion: 'sciforge.vision-trace.v1',
  windowTarget: fixtureWindowTarget,
  scheduler: fixtureScheduler,
  request: {
    text: '[T084 fixture] Summarize prior trace refs, image memory, windowTarget, sha256, dimensions, scheduler metadata, and action ledger only.',
  },
  genericComputerUse: {
    actionSchema: ['click', 'double_click', 'drag', 'type_text', 'press_key', 'hotkey', 'scroll', 'wait'],
    appSpecificShortcuts: [],
    inputChannel: 'generic-mouse-keyboard',
    inputChannelContract: {
      type: 'generic-mouse-keyboard',
      pointerKeyboardOwnership: 'virtual-dry-run-channel',
      pointerMode: 'virtual-no-user-pointer-movement',
      keyboardMode: 'virtual-no-user-keyboard-events',
      userDeviceImpact: 'none',
      highRiskConfirmationRequired: true,
    },
    coordinateContract: {
      planner: 'target descriptions only',
      grounderOutput: 'target-window screenshot coordinates',
      executorInput: 'window-local',
      localCoordinateFrame: 'window screenshot pixels before executor mapping',
    },
    verifierContract: {
      screenshotScope: 'target-window',
      beforeAfterWindowConsistency: 'required-or-structured-window-lifecycle-diagnostics',
    },
  },
  windowLifecycle: {
    status: 'stable-or-single-window',
    recoveryPolicy: 're-resolve target window by id/app/title when displayId, bounds, focus, minimized, or occlusion state changes',
  },
  imageMemory: {
    policy: 'file-ref-only',
    refs: [plannerWindowRef],
  },
  steps: [{
    id: 'step-000-plan',
    kind: 'planning',
    status: 'done',
    windowTarget: fixtureWindowTarget,
    scheduler: fixtureScheduler,
    beforeScreenshotRefs: [plannerWindowRef],
    verifier: { status: 'checked', reason: 'planner-only evidence summary' },
    execution: {
      planner: 'openai-compatible-vision-planner',
      status: 'done',
      rawResponse: {
        choices: [{
          message: {
            content: JSON.stringify({
              done: true,
              reason: 'Prior trace refs and image memory evidence are sufficient; no GUI action is required.',
              actions: [],
            }),
          },
        }],
      },
    },
  }],
};
const plannerOnlyTracePath = join(runDir, 'planner-only-vision-trace.json');
await writeFile(plannerOnlyTracePath, `${JSON.stringify(plannerOnlyTrace, null, 2)}\n`);
const plannerOnlyValidation = await validateComputerUseLongTrace({
  scenarioId: 'CU-LONG-003',
  tracePath: plannerOnlyTracePath,
  workspacePath: traceWorkspace,
});
assert.deepEqual(plannerOnlyValidation.issues, []);
assert.equal(plannerOnlyValidation.metrics.actionCount, 0);
assert.equal(plannerOnlyValidation.metrics.nonWaitActionCount, 0);

const missingWindowTracePath = join(runDir, 'missing-window-vision-trace.json');
await writeFile(missingWindowTracePath, `${JSON.stringify({
  ...trace,
  windowTarget: undefined,
  scheduler: undefined,
  imageMemory: {
    policy: 'file-ref-only',
    refs: [
      { path: beforeWindowRef.path, sha256: sha, width: 1, height: 1 },
      { path: afterWindowRef.path, sha256: sha, width: 1, height: 1 },
    ],
  },
  genericComputerUse: {
    actionSchema: ['click', 'double_click', 'drag', 'type_text', 'press_key', 'hotkey', 'scroll', 'wait'],
    appSpecificShortcuts: [],
  },
}, null, 2)}\n`);
const missingWindowValidation = await validateComputerUseLongTrace({
  scenarioId: 'CU-LONG-001',
  tracePath: missingWindowTracePath,
  workspacePath: traceWorkspace,
});
assert.equal(missingWindowValidation.ok, false);
assert.ok(missingWindowValidation.issues.some((issue) => /windowTarget/.test(issue)));
assert.ok(missingWindowValidation.issues.some((issue) => /scheduler/.test(issue)));
assert.ok(missingWindowValidation.issues.some((issue) => /inputChannel|input-channel/.test(issue)));
assert.ok(missingWindowValidation.issues.some((issue) => /window screenshot metadata/.test(issue)));

console.log('[ok] T084 Computer Use long task pool smoke passed');

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  computerUseLongRoundTimeoutMs,
  computerUsePlannerStepTimeoutMs,
  CU_LONG_ABORT_GRACE_MS,
  CU_LONG_DEFAULT_DRY_RUN_ROUND_TIMEOUT_MS,
  CU_LONG_DEFAULT_REAL_MAX_STEPS,
  CU_LONG_FINALIZATION_GRACE_MS,
  loadComputerUseLongTaskPool,
  prepareComputerUseLongRun,
  preflightComputerUseLong,
  renderComputerUseLongRepairPlan,
  renderComputerUseLongRunbook,
  renderComputerUseLongMatrixReport,
  resolveComputerUseLongMatrixSummaryPath,
  runComputerUseLongTaskPoolCli,
  runComputerUseLongMatrix,
  runComputerUseLongRound,
  runComputerUseLongScenario,
  validateComputerUseLongMatrix,
  validateComputerUseLongRun,
  validateComputerUseLongTrace,
  validateComputerUseLongTaskPool,
} from '../../tools/computer-use-long-task-pool';
import { toolPackageManifests } from '../../packages/skills/tool_skills';

const inlineImagePayloadPattern = /data:image\/[a-z0-9.+-]+;base64,|;base64,[A-Za-z0-9+/=]{16,}/i;

async function captureStdout(fn: () => Promise<void>) {
  const originalWrite = process.stdout.write;
  const originalExitCode = process.exitCode;
  let output = '';
  process.exitCode = undefined;
  process.stdout.write = ((chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
    output += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    done?.();
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
    return { output, exitCode: process.exitCode };
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExitCode;
  }
}

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
const releaseReadinessContract = pool.scenarios.map((scenario) => [
  scenario.id,
  scenario.title,
  scenario.goal,
  ...scenario.acceptance,
  ...scenario.requiredEvidence,
  ...scenario.failureRecord,
  ...scenario.rounds.flatMap((round) => [round.prompt, ...round.expectedTrace]),
].join(' ')).join('\n');
const releaseReadinessCoverage = [
  [/browser research report|browser report|research report artifact/i, 'browser report refs'],
  [/form hard-confirm|hard-confirm.*form|确认.*表单|表单.*确认/i, 'form hard-confirm refs'],
  [/CSV\/table validator refs|CSV|table validator|表格.*validator/i, 'CSV/table validator refs'],
  [/file manager evidence|file manager screenshots|文件管理器.*evidence/i, 'file manager evidence'],
  [/terminal\/notebook|terminal workflow|notebook workflow|终端|notebook/i, 'terminal/notebook workflow'],
  [/cross-app document|source reader.*editor.*file preview|源.*编辑.*文件预览/i, 'cross-app document evidence'],
  [/visual disambiguation|crop\/OCR\/vision translator|OCR|语义歧义/i, 'visual disambiguation evidence'],
  [/viewport recovery|viewport state refs|滚动恢复|viewport/i, 'viewport recovery evidence'],
  [/fresh re-observation|repair fresh re-observation|重新观察|re-observation/i, 'repair fresh re-observation'],
  [/high-risk confirmation|Cancel.*Confirm|Confirm.*Cancel|当前 action\/type\/turn|高风险.*确认/i, 'high-risk confirmation evidence'],
] as const;
for (const [pattern, label] of releaseReadinessCoverage) {
  assert.match(releaseReadinessContract, pattern, `CU-LONG task pool covers ${label}`);
}

const runbook = renderComputerUseLongRunbook(pool);
assert.match(runbook, /T084/);
assert.match(runbook, /CU-LONG-006 SciForge 自举测试/);
assert.match(runbook, /WindowTarget -> RuntimeCodexPlanner -> Grounder -> GuiExecutor -> Verifier -> vision-trace/);

const defaultRealRoundTimeoutMs = computerUseLongRoundTimeoutMs({ env: {} });
const defaultPlannerStepTimeoutMs = computerUsePlannerStepTimeoutMs();
assert.ok(
  defaultRealRoundTimeoutMs >= defaultPlannerStepTimeoutMs * CU_LONG_DEFAULT_REAL_MAX_STEPS + CU_LONG_ABORT_GRACE_MS + CU_LONG_FINALIZATION_GRACE_MS,
  'real CU-LONG round timeout must leave room for each RuntimeCodexPlanner step plus abort/finalization grace',
);
assert.ok(
  computerUseLongRoundTimeoutMs({ maxSteps: 3, env: {} }) >= defaultPlannerStepTimeoutMs * 3 + CU_LONG_ABORT_GRACE_MS + CU_LONG_FINALIZATION_GRACE_MS,
  'real CU-LONG round timeout scales with configured maxSteps',
);
assert.equal(computerUseLongRoundTimeoutMs({ dryRun: true, env: {} }), CU_LONG_DEFAULT_DRY_RUN_ROUND_TIMEOUT_MS);
assert.equal(computerUseLongRoundTimeoutMs({ env: { SCIFORGE_CU_LONG_ROUND_TIMEOUT_MS: '12345' } }), 12345);

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
const previousTestFixtures = process.env.SCIFORGE_VISION_TEST_ACTION_FIXTURES;
const previousActions = process.env.SCIFORGE_VISION_TEST_ACTIONS_JSON;
const previousConfigPath = process.env.SCIFORGE_CONFIG_PATH;
const previousRuntimeApiKey = process.env.SCIFORGE_RUNTIME_API_KEY;
const previousProxyUpstreamBaseUrl = process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL;
const previousRuntimeBaseUrl = process.env.SCIFORGE_RUNTIME_BASE_URL;
const previousModelRouterBaseUrl = process.env.SCIFORGE_MODEL_ROUTER_BASE_URL;
const previousModelRouterUrl = process.env.SCIFORGE_MODEL_ROUTER_URL;
const previousModelRouterPort = process.env.SCIFORGE_MODEL_ROUTER_PORT;
const previousPlannerProfile = process.env.SCIFORGE_COMPUTER_USE_PLANNER_PROFILE;
const previousHighRisk = process.env.SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS;
const previousInputAdapter = process.env.SCIFORGE_VISION_INPUT_ADAPTER;
const previousInputAdapterProvider = process.env.SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER;
const previousAllowSharedInput = process.env.SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT;
const previousDesktopNativeHost = process.env.SCIFORGE_VISION_DESKTOP_NATIVE_HOST;
const previousBrowserHostNativeAdapterUrl = process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
const previousRightPaneNativeActionChannel = process.env.SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL;
try {
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE = '1';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '1';
  process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS = '1';
  process.env.SCIFORGE_CONFIG_PATH = join(preparedRoot, 'empty-config.local.json');
  delete process.env.SCIFORGE_VISION_RUN_ID;
  process.env.SCIFORGE_VISION_TEST_ACTION_FIXTURES = '1';
  process.env.SCIFORGE_VISION_TEST_ACTIONS_JSON = JSON.stringify([{ type: 'wait', ms: 1 }]);
  process.env.SCIFORGE_RUNTIME_API_KEY = 'preflight-key';
  process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1';
  delete process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL;
  delete process.env.SCIFORGE_RUNTIME_BASE_URL;
  delete process.env.SCIFORGE_MODEL_ROUTER_URL;
  delete process.env.SCIFORGE_MODEL_ROUTER_PORT;
  process.env.SCIFORGE_COMPUTER_USE_PLANNER_PROFILE = 'preflight-profile';
  delete process.env.SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS;
  delete process.env.SCIFORGE_VISION_INPUT_ADAPTER;
  delete process.env.SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER;
  delete process.env.SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT;
  delete process.env.SCIFORGE_VISION_DESKTOP_NATIVE_HOST;
  delete process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
  delete process.env.SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL;
  const smokeActionsJson = JSON.stringify([{ type: 'type_text', text: 'T084 generic window CU round smoke' }]);
  const preflight = await preflightComputerUseLong({
    scenarioIds: ['CU-LONG-001', 'CU-LONG-006'],
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: true,
    out: join(preparedRoot, 'preflight.md'),
  });
  assert.equal(preflight.ok, true);
  assert.equal((await stat(String(preflight.reportPath))).isFile(), true);
  assert.ok(preflight.checks.some((check) => check.id === 'runtime-codex-planner' && check.status === 'pass'));
  assert.ok(preflight.checks.some((check) => check.id === 'input-isolation' && check.status === 'pass'));
  process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = '';
  delete process.env.SCIFORGE_MODEL_ROUTER_URL;
  delete process.env.SCIFORGE_MODEL_ROUTER_PORT;
  const missingRouterPreflight = await preflightComputerUseLong({
    scenarioIds: ['CU-LONG-001'],
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: true,
  });
  const missingRouterPlannerCheck = missingRouterPreflight.checks.find((check) => check.id === 'runtime-codex-planner');
  assert.equal(missingRouterPreflight.ok, false);
  assert.equal(missingRouterPlannerCheck?.status, 'fail');
  assert.match(String(missingRouterPlannerCheck?.message), /SCIFORGE_MODEL_ROUTER_BASE_URL or SCIFORGE_MODEL_ROUTER_URL or SCIFORGE_MODEL_ROUTER_PORT/);
  delete process.env.SCIFORGE_RUNTIME_API_KEY;
  delete process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL;
  delete process.env.SCIFORGE_RUNTIME_BASE_URL;
  delete process.env.SCIFORGE_MODEL_ROUTER_BASE_URL;
  delete process.env.SCIFORGE_MODEL_ROUTER_URL;
  delete process.env.SCIFORGE_MODEL_ROUTER_PORT;
  const configOnlyPath = join(preparedRoot, 'runtime-config-only.local.json');
  await writeFile(configOnlyPath, JSON.stringify({
    llm: {
      apiKey: 'config-only-secret',
      baseUrl: 'http://127.0.0.1:3888/v1',
      model: 'config-only-model',
    },
    runtimeCodex: {
      apiKey: 'config-only-runtime-router-key',
    },
    modelRouter: {
      baseUrl: 'http://127.0.0.1:3892/v1',
    },
    computerUse: {
      plannerProfile: 'config-only-profile',
    },
  }), 'utf8');
  process.env.SCIFORGE_CONFIG_PATH = configOnlyPath;
  const configOnlyPreflight = await preflightComputerUseLong({
    scenarioIds: ['CU-LONG-001'],
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: true,
  });
  const configOnlyPlannerCheck = configOnlyPreflight.checks.find((check) => check.id === 'runtime-codex-planner');
  assert.equal(configOnlyPlannerCheck?.status, 'pass');
  assert.equal(configOnlyPreflight.ok, true);
  assert.doesNotMatch(JSON.stringify(configOnlyPreflight), /config-only-secret/);
  process.env.SCIFORGE_CONFIG_PATH = join(preparedRoot, 'empty-config.local.json');
  process.env.SCIFORGE_RUNTIME_API_KEY = 'preflight-key';
  process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1';
  const realInputBlockedPreflight = await preflightComputerUseLong({
    scenarioIds: ['CU-LONG-001'],
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: false,
    actionsJson: smokeActionsJson,
  });
  assert.equal(realInputBlockedPreflight.ok, false);
  assert.ok(realInputBlockedPreflight.checks.some((check) => check.id === 'input-isolation' && check.status === 'fail'));
  const realInputBlockedMatrixCli = await captureStdout(() => runComputerUseLongTaskPoolCli([
    'node',
    'tools/computer-use-long-task-pool.ts',
    'run-matrix',
    '--real',
    '--scenarios',
    'CU-LONG-001',
    '--workspace-path',
    '/tmp/sciforge-cu-workspace',
    '--out-root',
    join(preparedRoot, 'cli-real-input-blocked-matrix'),
    '--max-steps',
    '1',
  ]));
  assert.equal(realInputBlockedMatrixCli.exitCode, 1);
  assert.match(realInputBlockedMatrixCli.output, /desktop-product-path/);
  assert.match(realInputBlockedMatrixCli.output, /input-isolation/);
  assert.match(realInputBlockedMatrixCli.output, /Desktop native host evidence|executable independent input adapter/i);
  assert.doesNotMatch(realInputBlockedMatrixCli.output, /runtime-codex-planner.*incomplete/i);
  process.env.SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT = '1';
  const realSharedInputPreflight = await preflightComputerUseLong({
    scenarioIds: ['CU-LONG-001'],
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: false,
    actionsJson: smokeActionsJson,
  });
  assert.equal(realSharedInputPreflight.checks.find((check) => check.id === 'input-isolation')?.status, 'warn');
  assert.equal(realSharedInputPreflight.ok, false);
  const sharedInputProductPathCheck = realSharedInputPreflight.checks.find((check) => check.id === 'desktop-product-path');
  assert.equal(sharedInputProductPathCheck?.status, 'fail');
  assert.match(String(sharedInputProductPathCheck?.message), /Desktop native host|executable independent input adapter/i);
  const independentInputAdapters = ['remote-desktop', 'virtual-hid'] as const;
  for (const inputAdapter of independentInputAdapters) {
    process.env.SCIFORGE_VISION_INPUT_ADAPTER = inputAdapter;
    delete process.env.SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT;
    const realIndependentInputPreflight = await preflightComputerUseLong({
      scenarioIds: ['CU-LONG-001'],
      workspacePath: '/tmp/sciforge-cu-workspace',
      dryRun: false,
      actionsJson: smokeActionsJson,
    });
    const inputIsolationCheck = realIndependentInputPreflight.checks.find((check) => check.id === 'input-isolation');
    assert.equal(inputIsolationCheck?.status, 'fail', `${inputAdapter} fails closed when no provider is registered`);
    assert.match(String(inputIsolationCheck?.message), new RegExp(inputAdapter));
    assert.match(String(inputIsolationCheck?.message), /no executable provider/i);
  }
  process.env.SCIFORGE_VISION_INPUT_ADAPTER = 'remote-desktop';
  process.env.SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER = 'sciforge-simulated-remote-desktop';
  delete process.env.SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT;
  const executableIndependentInputPreflight = await preflightComputerUseLong({
    scenarioIds: ['CU-LONG-001'],
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: false,
    actionsJson: smokeActionsJson,
  });
  const executableInputIsolationCheck = executableIndependentInputPreflight.checks.find((check) => check.id === 'input-isolation');
  assert.equal(executableInputIsolationCheck?.status, 'pass');
  assert.match(String(executableInputIsolationCheck?.message), /remote-desktop/);
  assert.match(String(executableInputIsolationCheck?.message), /sciforge-simulated-remote-desktop/);
  assert.equal(executableIndependentInputPreflight.checks.find((check) => check.id === 'desktop-product-path')?.status, 'pass');
  process.env.SCIFORGE_VISION_INPUT_ADAPTER = 'remote-desktop-session';
  process.env.SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER = 'simulated_remote_desktop';
  const executableIndependentInputAliasPreflight = await preflightComputerUseLong({
    scenarioIds: ['CU-LONG-001'],
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: false,
    actionsJson: smokeActionsJson,
  });
  const executableInputAliasIsolationCheck = executableIndependentInputAliasPreflight.checks.find((check) => check.id === 'input-isolation');
  assert.equal(executableInputAliasIsolationCheck?.status, 'pass');
  assert.match(String(executableInputAliasIsolationCheck?.message), /remote-desktop/);
  assert.match(String(executableInputAliasIsolationCheck?.message), /sciforge-simulated-remote-desktop/);
  assert.equal(executableIndependentInputAliasPreflight.checks.find((check) => check.id === 'desktop-product-path')?.status, 'pass');
  delete process.env.SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER;
  delete process.env.SCIFORGE_VISION_INPUT_ADAPTER;
  const fixturePreflight = await preflightComputerUseLong({
    scenarioIds: ['CU-LONG-001'],
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: true,
    actionsJson: smokeActionsJson,
  });
  assert.equal(fixturePreflight.ok, true);
  assert.ok(fixturePreflight.checks.some((check) => check.id === 'test-action-fixtures' && check.status === 'warn'));
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
  assert.match(round2Prompt, /trace=evidence\/round-01\/vision-trace\.json/);
  assert.doesNotMatch(round2Prompt, inlineImagePayloadPattern);

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
  assert.doesNotMatch(scenarioSummary, inlineImagePayloadPattern);
  const runValidation = await validateComputerUseLongRun({ manifestPath: preparedScenario.manifestPath });
  assert.deepEqual(runValidation.issues, []);
  assert.equal(runValidation.metrics.passedRounds, 5);
  assert.equal(runValidation.metrics.traceCount, 5);
  assert.equal(runValidation.metrics.actionLedgerCount, 5);
  assert.equal(runValidation.metrics.failureDiagnosticsCount, 5);
  const round2RuntimePrompt = await readFile(join(preparedScenario.runDir, 'evidence', 'round-02', 'runtime-prompt.md'), 'utf8');
  assert.match(round2RuntimePrompt, /Vision temporary memory policy: file-ref-only/);
  assert.match(round2RuntimePrompt, /Memory mode: cross-round-followup/);
  assert.match(round2RuntimePrompt, /actions=1; nonWait=1/);
  assert.match(round2RuntimePrompt, /windowTarget: .*observedDisplayIds=/);
  assert.match(round2RuntimePrompt, /scheduler: .*lockId=/);
  assert.match(round2RuntimePrompt, /verifierFeedback: .*pixel=/);
  assert.match(round2RuntimePrompt, /verifierFeedback: .*window=/);
  assert.match(round2RuntimePrompt, /screenshotMeta: .*sha256=.*size=.*displayId=/);
  assert.doesNotMatch(round2RuntimePrompt, inlineImagePayloadPattern);
  const brokenManifestPath = join(preparedScenario.runDir, 'broken-manifest.json');
  await copyFile(preparedScenario.manifestPath, brokenManifestPath);
  const brokenManifest = JSON.parse(await readFile(brokenManifestPath, 'utf8')) as Record<string, unknown>;
  const brokenRounds = brokenManifest.rounds as Array<Record<string, unknown>>;
  brokenRounds[0].actionLedgerRefs = [];
  await writeFile(brokenManifestPath, `${JSON.stringify(brokenManifest, null, 2)}\n`);
  const brokenValidation = await validateComputerUseLongRun({ manifestPath: brokenManifestPath });
  assert.equal(brokenValidation.ok, false);
  assert.ok(brokenValidation.issues.some((issue) => /round 1 missing actionLedgerRefs/.test(issue)));
  const rawPayloadManifestPath = join(preparedScenario.runDir, 'raw-payload-manifest.json');
  await copyFile(preparedScenario.manifestPath, rawPayloadManifestPath);
  const rawPayloadManifest = JSON.parse(await readFile(rawPayloadManifestPath, 'utf8')) as Record<string, unknown>;
  rawPayloadManifest.providerPayload = {
    screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
  };
  await writeFile(rawPayloadManifestPath, `${JSON.stringify(rawPayloadManifest, null, 2)}\n`);
  const rawPayloadManifestValidation = await validateComputerUseLongRun({ manifestPath: rawPayloadManifestPath });
  assert.equal(rawPayloadManifestValidation.ok, false);
  assert.ok(rawPayloadManifestValidation.issues.some((issue) => /raw|provider payload|inline image|base64/i.test(issue)));

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
  assert.doesNotMatch(matrixSummary, inlineImagePayloadPattern);
  const matrixValidation = await validateComputerUseLongMatrix({ summaryPath: matrixRun.summaryPath });
  assert.deepEqual(matrixValidation.issues, []);
  assert.equal(matrixValidation.metrics.validatedRuns, 2);
  assert.equal(await resolveComputerUseLongMatrixSummaryPath({ outRoot: preparedRoot }), matrixRun.summaryPath);
  const implicitMatrixValidation = await validateComputerUseLongMatrix({ outRoot: preparedRoot });
  assert.deepEqual(implicitMatrixValidation.issues, []);
  assert.equal(implicitMatrixValidation.summaryPath, matrixRun.summaryPath);
  const matrixSummaryJson = JSON.parse(matrixSummary) as Record<string, unknown>;
  const matrixSummaryResults = matrixSummaryJson.results as Array<Record<string, unknown>>;
  assert.ok(matrixSummaryResults.every((result) => typeof result.summaryPath === 'string' && result.summaryPath), 'matrix results record scenario summary refs');
  const missingSummaryPathSummary = JSON.parse(matrixSummary) as Record<string, unknown>;
  delete ((missingSummaryPathSummary.results as Array<Record<string, unknown>>)[0]).summaryPath;
  const missingSummaryPathSummaryPath = join(preparedRoot, 'matrix-missing-summary-path.json');
  await writeFile(missingSummaryPathSummaryPath, `${JSON.stringify(missingSummaryPathSummary, null, 2)}\n`);
  const missingSummaryPathValidation = await validateComputerUseLongMatrix({ summaryPath: missingSummaryPathSummaryPath });
  assert.equal(missingSummaryPathValidation.ok, false);
  assert.ok(missingSummaryPathValidation.issues.some((issue) => /summaryPath|scenario summary/i.test(issue)));
  const mismatchedRunStatusSummary = JSON.parse(matrixSummary) as Record<string, unknown>;
  ((mismatchedRunStatusSummary.results as Array<Record<string, unknown>>)[0]).runStatus = 'repair-needed';
  const mismatchedRunStatusSummaryPath = join(preparedRoot, 'matrix-mismatched-run-status.json');
  await writeFile(mismatchedRunStatusSummaryPath, `${JSON.stringify(mismatchedRunStatusSummary, null, 2)}\n`);
  const mismatchedRunStatusValidation = await validateComputerUseLongMatrix({ summaryPath: mismatchedRunStatusSummaryPath });
  assert.equal(mismatchedRunStatusValidation.ok, false);
  assert.ok(mismatchedRunStatusValidation.issues.some((issue) => /passed matrix|runStatus/i.test(issue)));
  const scenarioSummaryPath = String(matrixSummaryResults[0].summaryPath);
  const originalScenarioSummary = await readFile(scenarioSummaryPath, 'utf8');
  const scenarioSummaryWithoutValidatorEvidence = JSON.parse(originalScenarioSummary) as Record<string, unknown>;
  delete scenarioSummaryWithoutValidatorEvidence.validation;
  try {
    await writeFile(scenarioSummaryPath, `${JSON.stringify(scenarioSummaryWithoutValidatorEvidence, null, 2)}\n`);
    const missingValidatorEvidenceValidation = await validateComputerUseLongMatrix({ summaryPath: matrixRun.summaryPath });
    assert.equal(missingValidatorEvidenceValidation.ok, false);
    assert.ok(missingValidatorEvidenceValidation.issues.some((issue) => /validator evidence|scenario-summary validation/i.test(issue)));
  } finally {
    await writeFile(scenarioSummaryPath, originalScenarioSummary);
  }
  const rawPayloadMatrixSummary = JSON.parse(matrixSummary) as Record<string, unknown>;
  ((rawPayloadMatrixSummary.results as Array<Record<string, unknown>>)[0]).providerPayload = {
    screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
  };
  const rawPayloadMatrixSummaryPath = join(preparedRoot, 'matrix-raw-payload-summary.json');
  await writeFile(rawPayloadMatrixSummaryPath, `${JSON.stringify(rawPayloadMatrixSummary, null, 2)}\n`);
  const rawPayloadMatrixValidation = await validateComputerUseLongMatrix({ summaryPath: rawPayloadMatrixSummaryPath });
  assert.equal(rawPayloadMatrixValidation.ok, false);
  assert.ok(rawPayloadMatrixValidation.issues.some((issue) => /raw|provider payload|inline image|base64/i.test(issue)));
  const matrixReport = await renderComputerUseLongMatrixReport({ summaryPath: matrixRun.summaryPath });
  assert.equal(matrixReport.ok, true);
  assert.equal((await stat(matrixReport.reportPath)).isFile(), true);
  assert.match(matrixReport.markdown, /T084 Computer Use Matrix Report/);
  assert.match(matrixReport.markdown, /## Preflight/);
  assert.match(matrixReport.markdown, /Genericity Rules Rechecked/);
  assert.doesNotMatch(matrixReport.markdown, inlineImagePayloadPattern);
  const implicitMatrixReport = await renderComputerUseLongMatrixReport({
    outRoot: preparedRoot,
    out: join(preparedRoot, 'implicit-matrix-report.md'),
  });
  assert.equal(implicitMatrixReport.ok, true);
  assert.equal(implicitMatrixReport.summaryPath, matrixRun.summaryPath);
  const passedRepairPlan = await renderComputerUseLongRepairPlan({ summaryPath: matrixRun.summaryPath });
  assert.equal(passedRepairPlan.ok, true);
  assert.equal(passedRepairPlan.actionCount, 0);
  const implicitPassedRepairPlan = await renderComputerUseLongRepairPlan({
    outRoot: preparedRoot,
    out: join(preparedRoot, 'implicit-repair-plan.md'),
  });
  assert.equal(implicitPassedRepairPlan.ok, true);
  assert.equal(implicitPassedRepairPlan.summaryPath, matrixRun.summaryPath);

  process.env.SCIFORGE_RUNTIME_API_KEY = 'runtime-codex-text-planner-key';
  process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1';
  process.env.SCIFORGE_COMPUTER_USE_PLANNER_PROFILE = 'runtime-codex-text-planner-profile';
  process.env.SCIFORGE_VISION_TEST_ACTION_FIXTURES = '1';
  process.env.SCIFORGE_VISION_TEST_ACTIONS_JSON = smokeActionsJson;
  const fixtureActionMatrix = await runComputerUseLongMatrix({
    outRoot: preparedRoot,
    workspacePath: '/tmp/sciforge-cu-workspace',
    dryRun: true,
    maxSteps: 1,
    maxConcurrency: 3,
    actionsJson: smokeActionsJson,
    now: new Date('2026-05-04T13:05:00.000Z'),
  });
  assert.equal(fixtureActionMatrix.status, 'passed');
  assert.equal(fixtureActionMatrix.passedScenarioIds.length, 10);
  assert.deepEqual(fixtureActionMatrix.repairNeededScenarioIds, []);
  assert.equal(fixtureActionMatrix.preflight?.checks.find((check) => check.id === 'test-action-fixtures')?.status, 'warn');
  assert.equal(fixtureActionMatrix.preflight?.checks.find((check) => check.id === 'runtime-codex-planner')?.status, 'warn');
  const fixtureMatrixValidation = await validateComputerUseLongMatrix({ summaryPath: fixtureActionMatrix.summaryPath });
  assert.deepEqual(fixtureMatrixValidation.issues, []);
  assert.equal(fixtureMatrixValidation.metrics.validatedRuns, 10);
  const oldPlannerPattern = /openai-compatible-vision-planner|vision-sense-policy-planner|computer-use-action-loop|fallbackActions|image_url|data:image\/[a-z0-9.+-]+;base64,|;base64,[A-Za-z0-9+/=]{16,}/i;
  for (const result of fixtureActionMatrix.results) {
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as Record<string, unknown>;
    const round = (manifest.rounds as Array<Record<string, unknown>>)[0];
    const tracePath = join(dirname(result.manifestPath), String(round.visionTraceRef));
    const traceText = await readFile(tracePath, 'utf8');
    assert.doesNotMatch(traceText, oldPlannerPattern, `${result.scenarioId} trace must not contain legacy visual/server planner evidence`);
    const trace = JSON.parse(traceText) as Record<string, unknown>;
    const config = trace.config as Record<string, unknown>;
    assert.equal(config.testActionFixtureMode, true, `${result.scenarioId} records test-only fixture mode`);
    assert.equal(config.testOnlyPlannedActionCount, 1, `${result.scenarioId} records one test-only fixture action`);
    const steps = trace.steps as Array<Record<string, unknown>>;
    assert.ok(steps.some((step) => step.kind === 'gui-execution'), `${result.scenarioId} includes fixture-backed GUI evidence`);
    assert.ok(steps.every((step) => step.kind !== 'planning'), `${result.scenarioId} does not make dynamic planner calls in fixture smoke`);
  }
  process.env.SCIFORGE_RUNTIME_API_KEY = 'preflight-key';
  process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1';
  process.env.SCIFORGE_COMPUTER_USE_PLANNER_PROFILE = 'preflight-profile';
  process.env.SCIFORGE_VISION_TEST_ACTION_FIXTURES = '1';
  process.env.SCIFORGE_VISION_TEST_ACTIONS_JSON = JSON.stringify([{ type: 'wait', ms: 1 }]);

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
  assert.doesNotMatch(blockedMatrixSummary, inlineImagePayloadPattern);
  const blockedMatrixSummaryJson = JSON.parse(blockedMatrixSummary) as Record<string, unknown>;
  assert.equal(typeof blockedMatrixSummaryJson.repairManifestPath, 'string');
  const blockedRepairManifestText = await readFile(String(blockedMatrixSummaryJson.repairManifestPath), 'utf8');
  assert.match(blockedRepairManifestText, /sciforge\.computer-use-long\.repair-manifest\.v1/);
  assert.doesNotMatch(blockedRepairManifestText, inlineImagePayloadPattern);
  const blockedRepairManifest = JSON.parse(blockedRepairManifestText) as Record<string, unknown>;
  assert.ok(Array.isArray(blockedRepairManifest.nextRepairFocus) && blockedRepairManifest.nextRepairFocus.length > 0);
  const blockedMatrixValidation = await validateComputerUseLongMatrix({ summaryPath: blockedMatrix.summaryPath });
  assert.equal(blockedMatrixValidation.ok, false);
  assert.ok(blockedMatrixValidation.issues.some((issue) => /matrix.status must be passed/i.test(issue)));
  assert.equal(blockedMatrixValidation.metrics.preflightFailedChecks, 1);
  const blockedMatrixInspectionValidation = await validateComputerUseLongMatrix({
    summaryPath: blockedMatrix.summaryPath,
    requirePassed: false,
  });
  assert.deepEqual(blockedMatrixInspectionValidation.issues, []);
  assert.equal(blockedMatrixInspectionValidation.metrics.preflightFailedChecks, 1);
  const blockedMatrixInspectionCli = await captureStdout(() => runComputerUseLongTaskPoolCli([
    'node',
    'tools/computer-use-long-task-pool.ts',
    'validate-matrix',
    '--summary',
    blockedMatrix.summaryPath,
    '--allow-repair-needed',
  ]));
  assert.equal(blockedMatrixInspectionCli.exitCode, undefined);
  assert.match(blockedMatrixInspectionCli.output, /CU-LONG matrix repair-needed structural inspection passed/);
  assert.doesNotMatch(blockedMatrixInspectionCli.output, /CU-LONG matrix validation passed/);
  const blockedWithoutRepairManifestPath = join(preparedRoot, 'blocked-matrix-no-repair-manifest.json');
  delete blockedMatrixSummaryJson.repairManifestPath;
  await writeFile(blockedWithoutRepairManifestPath, `${JSON.stringify(blockedMatrixSummaryJson, null, 2)}\n`);
  const blockedWithoutRepairManifestValidation = await validateComputerUseLongMatrix({ summaryPath: blockedWithoutRepairManifestPath });
  assert.equal(blockedWithoutRepairManifestValidation.ok, false);
  assert.ok(blockedWithoutRepairManifestValidation.issues.some((issue) => /repair manifest|next repair focus/i.test(issue)));
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
  restoreEnv('SCIFORGE_VISION_TEST_ACTION_FIXTURES', previousTestFixtures);
  restoreEnv('SCIFORGE_VISION_TEST_ACTIONS_JSON', previousActions);
  restoreEnv('SCIFORGE_CONFIG_PATH', previousConfigPath);
  restoreEnv('SCIFORGE_RUNTIME_API_KEY', previousRuntimeApiKey);
  restoreEnv('SCIFORGE_PROXY_UPSTREAM_BASE_URL', previousProxyUpstreamBaseUrl);
  restoreEnv('SCIFORGE_RUNTIME_BASE_URL', previousRuntimeBaseUrl);
  restoreEnv('SCIFORGE_MODEL_ROUTER_BASE_URL', previousModelRouterBaseUrl);
  restoreEnv('SCIFORGE_MODEL_ROUTER_URL', previousModelRouterUrl);
  restoreEnv('SCIFORGE_MODEL_ROUTER_PORT', previousModelRouterPort);
  restoreEnv('SCIFORGE_COMPUTER_USE_PLANNER_PROFILE', previousPlannerProfile);
  restoreEnv('SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS', previousHighRisk);
  restoreEnv('SCIFORGE_VISION_INPUT_ADAPTER', previousInputAdapter);
  restoreEnv('SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER', previousInputAdapterProvider);
  restoreEnv('SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT', previousAllowSharedInput);
  restoreEnv('SCIFORGE_VISION_DESKTOP_NATIVE_HOST', previousDesktopNativeHost);
  restoreEnv('SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL', previousBrowserHostNativeAdapterUrl);
  restoreEnv('SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL', previousRightPaneNativeActionChannel);
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
    actionSchema: ['open_app', 'click', 'double_click', 'drag', 'type_text', 'press_key', 'hotkey', 'scroll', 'wait'],
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
      provider: 'model-router.capability.computer-use.grounding-translator',
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
      pixelDiff: {
        method: 'sha256-and-byte-diff',
        possiblyNoEffect: false,
        pairs: [{ displayId: 1, changedByteRatio: 0.25, possiblyNoEffect: false }],
      },
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
  config: { dryRun: false, showVisualCursor: true },
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
      visualPointer: 'sciforge-distinct-overlay-cursor',
      visualPointerShape: 'cyan-diamond-magenta-outline-white-crosshair',
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
    actionSchema: ['open_app', 'click', 'double_click', 'drag', 'type_text', 'press_key', 'hotkey', 'scroll', 'wait'],
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
      planner: 'model-router.capability.computer-use.planner',
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
    actionSchema: ['open_app', 'click', 'double_click', 'drag', 'type_text', 'press_key', 'hotkey', 'scroll', 'wait'],
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

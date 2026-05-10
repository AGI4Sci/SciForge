import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { CAPABILITY_BUDGET_DEBIT_CONTRACT_ID } from '@sciforge-ui/runtime-contract/capability-budget';
import { CaptureProviderError, captureDisplays } from '../../src/runtime/computer-use/capture.js';
import { normalizePlatformAction, platformActionIssue } from '../../src/runtime/computer-use/actions.js';
import { executeGenericDesktopAction } from '../../src/runtime/computer-use/executor.js';
import type { ComputerUseConfig, WindowTargetResolution } from '../../src/runtime/computer-use/types.js';
import { inputChannelContract } from '../../src/runtime/computer-use/window-target.js';
import {
  closeServer,
  createJsonPostServer,
  createVisionWorkspace,
  findVisionTraceArtifact,
  listenLocal,
  readVisionTraceJson,
  restoreVisionSenseEnv,
  runVisionSenseGateway,
  saveVisionSenseEnv,
} from './vision-sense-runtime-bridge-helpers.js';

const savedEnv = saveVisionSenseEnv();

try {
  const darwinHotkeyConfig = { desktopPlatform: 'darwin' } as ComputerUseConfig;
  const canonicalSwitch = normalizePlatformAction({ type: 'hotkey', keys: ['Alt', 'Tab'] }, darwinHotkeyConfig);
  assert.deepEqual(canonicalSwitch, { type: 'hotkey', keys: ['command', 'tab'] });
  assert.equal(platformActionIssue(canonicalSwitch, darwinHotkeyConfig), '');

  const blockedWorkspace = await createVisionWorkspace('bridge-blocked');
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE = '0';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '0';
  const blocked = await runVisionSenseGateway({
    skillDomain: 'literature',
    prompt: 'Open the desktop presentation app and create a GUI Agent slide through computer use.',
    workspacePath: blockedWorkspace,
  });

  assert.equal(blocked.executionUnits.length, 1);
  assert.equal(blocked.executionUnits[0].tool, 'local.vision-sense');
  assert.equal(blocked.executionUnits[0].status, 'failed-with-reason');
  assert.match(String(blocked.executionUnits[0].failureReason || blocked.message), /desktop bridge is disabled/i);
  assert.doesNotMatch(blocked.message, /AgentServer task generation/i);

  const missingPlannerWorkspace = await createVisionWorkspace('missing-planner');
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE = '1';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '1';
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-missing-planner-smoke';
  process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS = '1,2';
  delete process.env.SCIFORGE_VISION_ACTIONS_JSON;
  const missingPlanner = await runVisionSenseGateway({
    skillDomain: 'literature',
    prompt: 'Open any desktop app and complete a GUI Agent task using computer use.',
    workspacePath: missingPlannerWorkspace,
  });

  assert.equal(missingPlanner.executionUnits.length, 1);
  assert.equal(missingPlanner.executionUnits[0].tool, 'local.vision-sense');
  assert.equal(missingPlanner.executionUnits[0].status, 'failed-with-reason');
  assert.match(String(missingPlanner.executionUnits[0].failureReason || missingPlanner.message), /no planner\/grounder actions/i);
  assert.doesNotMatch(missingPlanner.message, /Word|PowerPoint|adapter/i);
  const missingTraceArtifact = findVisionTraceArtifact(missingPlanner);
  assert.equal(missingTraceArtifact.path, '.sciforge/vision-runs/generic-cu-missing-planner-smoke/vision-trace.json');
  await stat(join(missingPlannerWorkspace, '.sciforge/vision-runs/generic-cu-missing-planner-smoke/step-000-before-display-1.png'));
  await stat(join(missingPlannerWorkspace, '.sciforge/vision-runs/generic-cu-missing-planner-smoke/step-000-after-display-2.png'));
  delete process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS;

  const autoDisplaysWorkspace = await createVisionWorkspace('auto-displays');
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-auto-displays-smoke';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '1';
  process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([{ type: 'wait', ms: 1 }]);
  const autoDisplays = await runVisionSenseGateway({
    skillDomain: 'literature',
    prompt: 'Use generic computer use with automatically detected displays.',
    workspacePath: autoDisplaysWorkspace,
  });
  const { trace: autoDisplaysTrace } = await readVisionTraceJson(autoDisplaysWorkspace, autoDisplays);
  const autoCaptureDisplays = (autoDisplaysTrace.config as Record<string, unknown>).captureDisplays as unknown[];
  assert.ok(Array.isArray(autoCaptureDisplays) && autoCaptureDisplays.length >= 1);
  assert.ok(autoCaptureDisplays.every((displayId) => Number.isInteger(displayId) && Number(displayId) > 0));

  const appWindowBindWorkspace = await createVisionWorkspace('app-window-bind');
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-app-window-bind-smoke';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '1';
  process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([
    { type: 'open_app', appName: 'Generic Research Workbench' },
    { type: 'wait', ms: 1 },
  ]);
  const appWindowBind = await runVisionSenseGateway({
    skillDomain: 'literature',
    prompt: 'Use generic computer use to open the requested app and observe its window on whichever display contains it.',
    workspacePath: appWindowBindWorkspace,
  });
  assert.equal(appWindowBind.executionUnits[0].status, 'done');
  const { trace: appWindowBindTrace } = await readVisionTraceJson(appWindowBindWorkspace, appWindowBind);
  const appWindowBindTarget = (appWindowBindTrace.config as Record<string, unknown>).windowTarget as Record<string, unknown>;
  assert.equal(appWindowBindTarget.mode, 'app-window');
  assert.equal(appWindowBindTarget.appName, 'Generic Research Workbench');
  assert.equal(appWindowBindTarget.captureKind, 'window');
  assert.equal(appWindowBindTarget.coordinateSpace, 'window-local');
  const appWindowBindSteps = appWindowBindTrace.steps as Array<Record<string, unknown>>;
  assert.ok(appWindowBindSteps.some((step) => step.id === 'step-001-execute-open_app'));
  assert.ok(appWindowBindSteps.some((step) => step.id === 'step-002-execute-wait' && ((step.windowTarget as Record<string, unknown>)?.captureKind) === 'window'));

  const dryRunWorkspace = await createVisionWorkspace('generic-dryrun');
    process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS = '1,2';
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-actions-smoke';
    process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([
      { type: 'wait', ms: 1 },
      { type: 'hotkey', keys: ['command', 'n'] },
      { actionType: 'hotkey', hotkey: 'command+tab' },
      { actionType: 'scroll', scrollAmount: 300 },
      { type: 'type_text', text: 'GUI Agent generic action smoke' },
    ]);
  const completed = await runVisionSenseGateway({
    skillDomain: 'literature',
    prompt: 'Use generic computer use actions in whichever app is active; do not use app-specific shortcuts.',
    workspacePath: dryRunWorkspace,
  });

  assert.equal(completed.executionUnits.length, 1);
  assert.equal(completed.executionUnits[0].tool, 'local.vision-sense');
  assert.equal(completed.executionUnits[0].status, 'done');
  const completedBudgetDebit = completed.budgetDebits?.[0];
  assert.ok(completedBudgetDebit, 'Computer Use generic loop should emit a budget debit record');
  assert.equal(completedBudgetDebit.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
  assert.equal(completedBudgetDebit.capabilityId, 'action.sciforge.computer-use');
  assert.deepEqual(completed.executionUnits[0].budgetDebitRefs, [completedBudgetDebit.debitId]);
  assert.deepEqual(completed.workEvidence?.[0]?.budgetDebitRefs, [completedBudgetDebit.debitId]);
  assert.equal(completedBudgetDebit.sinkRefs.executionUnitRef, completed.executionUnits[0].id);
  assert.deepEqual(completedBudgetDebit.sinkRefs.workEvidenceRefs, [completed.workEvidence?.[0]?.id]);
  assert.ok(completedBudgetDebit.sinkRefs.auditRefs.includes('audit:vision-sense-computer-use-loop'));
  assert.ok(completed.logs?.some((entry) => entry.ref === 'audit:vision-sense-computer-use-loop' && Array.isArray(entry.budgetDebitRefs)));
  assert.ok(completedBudgetDebit.debitLines.some((line) => line.dimension === 'actionSteps' && line.amount === 5));
  assert.ok(completedBudgetDebit.debitLines.some((line) => line.dimension === 'observeCalls' && line.amount === 20));
  const traceArtifact = findVisionTraceArtifact(completed);
  assert.equal(traceArtifact.path, '.sciforge/vision-runs/generic-cu-actions-smoke/vision-trace.json');
  assert.deepEqual((traceArtifact.metadata as { budgetDebitRefs?: string[] } | undefined)?.budgetDebitRefs, [completedBudgetDebit.debitId]);
  assert.equal(completed.artifacts.filter((artifact) => artifact.id === 'vision-sense-trace').length, 1);
  assert.ok(completed.artifacts.some((artifact) => artifact.type === 'verification-result'));

  const { text: traceText, trace } = await readVisionTraceJson(dryRunWorkspace, completed);
  assert.doesNotMatch(traceText, /base64|data:image/i);
  assert.equal(trace.runtime, 'sciforge.workspace-runtime.vision-sense-generic-loop');
  assert.equal((trace.imageMemory as Record<string, unknown>).policy, 'file-ref-only');
  const genericComputerUse = trace.genericComputerUse as Record<string, unknown>;
  assert.deepEqual(genericComputerUse.appSpecificShortcuts, []);
  assert.deepEqual(genericComputerUse.requires, ['WindowTargetProvider', 'VisionPlanner', 'Grounder', 'GuiExecutor', 'Verifier']);
  const refs = (trace.imageMemory as Record<string, unknown>).refs as Array<Record<string, unknown>>;
  assert.equal(refs.length, 20);
  assert.deepEqual(refs.map((ref) => ref.displayId), [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2]);
  assert.ok((trace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-001-execute-wait'));
  assert.ok((trace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-002-execute-hotkey'));
  assert.ok((trace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-003-execute-hotkey'));
  assert.ok((trace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-004-execute-scroll'));
  assert.ok((trace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-005-execute-type_text'));
  await stat(join(dryRunWorkspace, '.sciforge/vision-runs/generic-cu-actions-smoke/step-001-before-display-1.png'));
  await stat(join(dryRunWorkspace, '.sciforge/vision-runs/generic-cu-actions-smoke/step-005-after-display-2.png'));

  const prematureCreationWorkspace = await createVisionWorkspace('premature-creation');
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-premature-creation-smoke';
  process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([
    { type: 'open_app', appName: 'Microsoft PowerPoint' },
  ]);
  const prematureCreation = await runVisionSenseGateway({
    skillDomain: 'literature',
    prompt: 'Use generic computer use to create one presentation slide with visible text about a virtual cell.',
    workspacePath: prematureCreationWorkspace,
  });
  assert.equal(prematureCreation.executionUnits[0].status, 'failed-with-reason');
  assert.match(String(prematureCreation.executionUnits[0].failureReason), /Visible artifact task did not satisfy completion acceptance/i);
  const { trace: prematureTrace } = await readVisionTraceJson(prematureCreationWorkspace, prematureCreation);
  const prematureLastStep = (prematureTrace.steps as Array<Record<string, unknown>>).at(-1);
  assert.match(String(prematureLastStep?.failureReason), /visible content entry|structure-edit/i);

  const highRiskWorkspace = await createVisionWorkspace('high-risk');
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-high-risk-smoke';
  process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([
    { type: 'click', x: 10, y: 10, targetDescription: 'final submit button', riskLevel: 'high', requiresConfirmation: true },
  ]);
  const blockedHighRisk = await runVisionSenseGateway({
    skillDomain: 'literature',
    prompt: 'Use computer use to click a high-risk submit action without confirmation.',
    workspacePath: highRiskWorkspace,
  });
  assert.equal(blockedHighRisk.executionUnits[0].status, 'failed-with-reason');
  assert.match(String(blockedHighRisk.executionUnits[0].failureReason), /High-risk Computer Use action blocked/i);
  const { trace: highRiskTrace } = await readVisionTraceJson(highRiskWorkspace, blockedHighRisk);
  assert.ok((highRiskTrace.steps as Array<Record<string, unknown>>).some((step) => step.status === 'blocked'));
  assert.doesNotMatch(JSON.stringify(highRiskTrace), /base64|data:image/i);

  const grounderServer = createJsonPostServer('/predict/', (body) => {
    assert.match(String(body.text_prompt), /click coordinates/i);
    assert.match(String(body.text_prompt), /the generic search box/);
    assert.match(String(body.image_path), /step-001-before-display-1\.png$/);
    return { coordinates: [42, 24], image_size: { width: 100, height: 80 }, text: 'click' };
  });
  const grounderBaseUrl = await listenLocal(grounderServer);
  try {
    const groundedWorkspace = await createVisionWorkspace('grounder');
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-grounder-smoke';
    process.env.SCIFORGE_VISION_KV_GROUND_URL = grounderBaseUrl;
    process.env.SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS = '1';
    process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([
      { type: 'click', targetDescription: 'the generic search box' },
    ]);
    const grounded = await runVisionSenseGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use to click a visually described target.',
      workspacePath: groundedWorkspace,
    });
    assert.equal(grounded.executionUnits[0].status, 'done');
    const { trace: groundedTrace } = await readVisionTraceJson(groundedWorkspace, grounded);
    const groundedStep = (groundedTrace.steps as Array<Record<string, unknown>>).find((step) => step.id === 'step-001-execute-click');
    assert.ok(groundedStep);
    assert.equal(((groundedStep.plannedAction as Record<string, unknown>)?.x), 42);
    assert.equal(((groundedStep.grounding as Record<string, unknown>)?.provider), 'coarse-to-fine');
    assert.equal((((groundedStep.grounding as Record<string, unknown>)?.fineGrounding as Record<string, unknown>)?.stage), 'fine');
    assert.equal((((groundedStep.verifier as Record<string, unknown>)?.regionSemantic as Record<string, unknown>)?.schemaVersion), 'sciforge.vision-sense.region-semantic-verifier.v1');
  } finally {
    await closeServer(grounderServer);
  }

  const visualGrounderServer = createJsonPostServer('/chat/completions', (body, raw) => {
    assert.equal(body.model, 'visual-grounder-smoke-model');
    assert.match(raw, /visually described fallback target/);
    return {
      choices: [{
        message: {
          content: JSON.stringify({ coordinates: [66, 77], confidence: 0.8, reason: 'target center' }),
        },
      }],
    };
  });
  const visualGrounderBaseUrl = await listenLocal(visualGrounderServer);
  try {
    const visualGrounderWorkspace = await createVisionWorkspace('visual-grounder');
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-visual-grounder-smoke';
    process.env.SCIFORGE_VISION_KV_GROUND_URL = 'http://127.0.0.1:1';
    process.env.SCIFORGE_VISION_GROUNDER_LLM_BASE_URL = visualGrounderBaseUrl;
    process.env.SCIFORGE_VISION_GROUNDER_LLM_API_KEY = 'visual-grounder-key';
    process.env.SCIFORGE_VISION_GROUNDER_LLM_MODEL = 'visual-grounder-smoke-model';
    process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([
      { type: 'click', targetDescription: 'visually described fallback target' },
    ]);
    const visuallyGrounded = await runVisionSenseGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use to click a target through visual grounder fallback.',
      workspacePath: visualGrounderWorkspace,
    });
    assert.equal(visuallyGrounded.executionUnits[0].status, 'done');
    const { trace: visualTrace } = await readVisionTraceJson(visualGrounderWorkspace, visuallyGrounded);
    const visualStep = (visualTrace.steps as Array<Record<string, unknown>>).find((step) => step.id === 'step-001-execute-click');
    assert.ok(visualStep);
    assert.equal(((visualStep.plannedAction as Record<string, unknown>)?.x), 66);
    assert.equal(((visualStep.grounding as Record<string, unknown>)?.provider), 'coarse-to-fine');
    assert.equal(((visualStep.grounding as Record<string, unknown>)?.fallbackFrom), 'kv-ground');
    assert.equal(((visualStep.grounding as Record<string, unknown>)?.kvGroundUrl), 'http://127.0.0.1:1/predict/');
    assert.equal((((visualStep.grounding as Record<string, unknown>)?.fineGrounding as Record<string, unknown>)?.stage), 'fine');
  } finally {
    await closeServer(visualGrounderServer);
  }

  let plannerCalls = 0;
  const plannerRawRequests: string[] = [];
  const plannerServer = createJsonPostServer('/chat/completions', (body, raw) => {
    plannerCalls += 1;
    plannerRawRequests.push(raw);
    assert.equal(body.model, 'vision-planner-smoke-model');
    return {
      choices: [{
        message: {
          content: plannerCalls === 1
            ? JSON.stringify({
                done: false,
                reason: 'click target first',
                actions: [
                  { actionType: 'click', target_description: 'the generic planner target' },
                ],
              })
            : JSON.stringify({ done: true, reason: 'target clicked', actions: [] }),
        },
      }],
    };
  });
  const plannerGrounderServer = createJsonPostServer('/predict/', (body) => {
    assert.match(String(body.text_prompt), /click coordinates/i);
    assert.match(String(body.text_prompt), /the generic planner target/);
    return { coordinates: [12, 34], image_size: { width: 100, height: 80 } };
  });
  const plannerBaseUrl = await listenLocal(plannerServer);
  const plannerGrounderBaseUrl = await listenLocal(plannerGrounderServer);
  try {
    const plannerWorkspace = await createVisionWorkspace('planner');
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-planner-smoke';
    delete process.env.SCIFORGE_VISION_ACTIONS_JSON;
    process.env.SCIFORGE_VISION_PLANNER_BASE_URL = plannerBaseUrl;
    process.env.SCIFORGE_VISION_PLANNER_API_KEY = 'planner-test-key';
    process.env.SCIFORGE_VISION_PLANNER_MODEL = 'vision-planner-smoke-model';
    process.env.SCIFORGE_VISION_KV_GROUND_URL = plannerGrounderBaseUrl;
    process.env.SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS = '1';
    const planned = await runVisionSenseGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use planner to click the visible target.',
      workspacePath: plannerWorkspace,
    });
    assert.equal(planned.executionUnits[0].status, 'done');
    const { trace: plannedTrace } = await readVisionTraceJson(plannerWorkspace, planned);
    assert.ok((plannedTrace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-000-plan'));
    assert.ok((plannedTrace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-001-replan'));
    const executeStep = (plannedTrace.steps as Array<Record<string, unknown>>).find((step) => step.id === 'step-001-execute-click');
    assert.ok(executeStep);
    assert.equal(((executeStep.plannedAction as Record<string, unknown>)?.x), 12);
    assert.match(String((executeStep.verifier as Record<string, unknown>)?.planningFeedback), /pixel=.*window=.*grounding=/);
    assert.match(plannerRawRequests[1] ?? '', /verifierFeedback=.*pixel=/);
    assert.match(plannerRawRequests[1] ?? '', /no-visible-effect=true/);
    assert.deepEqual((plannedTrace.genericComputerUse as Record<string, unknown>).appSpecificShortcuts, []);
  } finally {
    await closeServer(plannerServer);
    await closeServer(plannerGrounderServer);
  }

  let maxStepsPlannerCalls = 0;
  const maxStepsPlannerServer = createJsonPostServer('/chat/completions', (_body, raw) => {
    maxStepsPlannerCalls += 1;
    assert.match(raw, /Execution environment:/);
    assert.match(raw, /Set done=true only when the supplied screenshot shows/);
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            done: false,
            reason: 'task still needs more GUI work',
            actions: [{ actionType: 'press_key', key: 'Escape' }],
          }),
        },
      }],
    };
  });
  const maxStepsPlannerBaseUrl = await listenLocal(maxStepsPlannerServer);
  try {
    const maxStepsWorkspace = await createVisionWorkspace('maxsteps');
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-maxsteps-smoke';
    delete process.env.SCIFORGE_VISION_ACTIONS_JSON;
    delete process.env.SCIFORGE_VISION_KV_GROUND_URL;
    process.env.SCIFORGE_VISION_MAX_STEPS = '1';
    process.env.SCIFORGE_VISION_PLANNER_BASE_URL = maxStepsPlannerBaseUrl;
    process.env.SCIFORGE_VISION_PLANNER_API_KEY = 'planner-test-key';
    process.env.SCIFORGE_VISION_PLANNER_MODEL = 'vision-planner-maxsteps-model';
    const maxSteps = await runVisionSenseGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use planner and keep going until the visible task is complete.',
      workspacePath: maxStepsWorkspace,
    });
    assert.equal(maxStepsPlannerCalls, 1);
    assert.equal(maxSteps.executionUnits[0].status, 'failed-with-reason');
    assert.match(String(maxSteps.executionUnits[0].failureReason), /maxSteps=1/i);
    const { trace: maxStepsTrace } = await readVisionTraceJson(maxStepsWorkspace, maxSteps);
    assert.ok((maxStepsTrace.steps as Array<Record<string, unknown>>).some((step) => /maxSteps exhausted/.test(String((step.verifier as Record<string, unknown>)?.reason))));
  } finally {
    await closeServer(maxStepsPlannerServer);
    delete process.env.SCIFORGE_VISION_MAX_STEPS;
  }

  let platformRetryPlannerCalls = 0;
  const platformRetryPlannerServer = createJsonPostServer('/chat/completions', (_body, raw) => {
    platformRetryPlannerCalls += 1;
    if (platformRetryPlannerCalls === 1) assert.match(raw, /desktopPlatform=\\?"darwin\\?"/);
    if (platformRetryPlannerCalls === 2) assert.match(raw, /cannot be executed in the current operating system/);
    return {
      choices: [{
        message: {
          content: platformRetryPlannerCalls === 1
            ? JSON.stringify({
                done: false,
                reason: 'bad key plan for configured platform',
                actions: [{ actionType: 'press_key', key: 'Win' }],
              })
            : JSON.stringify({
                done: false,
                reason: 'rewrite with configured-platform key',
                actions: [{ actionType: 'press_key', key: 'Escape' }],
              }),
        },
      }],
    };
  });
  const platformRetryPlannerBaseUrl = await listenLocal(platformRetryPlannerServer);
  try {
    const platformRetryWorkspace = await createVisionWorkspace('platform-retry');
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-platform-retry-smoke';
    delete process.env.SCIFORGE_VISION_ACTIONS_JSON;
    process.env.SCIFORGE_VISION_DESKTOP_PLATFORM = 'darwin';
    process.env.SCIFORGE_VISION_MAX_STEPS = '1';
    process.env.SCIFORGE_VISION_PLANNER_BASE_URL = platformRetryPlannerBaseUrl;
    process.env.SCIFORGE_VISION_PLANNER_API_KEY = 'planner-test-key';
    process.env.SCIFORGE_VISION_PLANNER_MODEL = 'vision-planner-platform-retry-model';
    const platformRetry = await runVisionSenseGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use planner with platform-compatible keys.',
      workspacePath: platformRetryWorkspace,
    });
    assert.equal(platformRetryPlannerCalls, 2);
    const { trace: platformTrace } = await readVisionTraceJson(platformRetryWorkspace, platformRetry);
    assert.equal(((platformTrace.config as Record<string, unknown>)?.desktopPlatform), 'darwin');
    assert.ok((platformTrace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-001-execute-press_key'));
    assert.doesNotMatch(JSON.stringify(platformTrace), /"key": "Win"/);
  } finally {
    await closeServer(platformRetryPlannerServer);
    delete process.env.SCIFORGE_VISION_MAX_STEPS;
    delete process.env.SCIFORGE_VISION_DESKTOP_PLATFORM;
  }

  let waitRetryPlannerCalls = 0;
  const waitRetryPlannerServer = createJsonPostServer('/chat/completions', (body, raw) => {
    waitRetryPlannerCalls += 1;
    assert.equal(body.model, 'vision-planner-wait-retry-model');
    if (waitRetryPlannerCalls === 2) assert.match(raw, /Do not return an empty action list or wait as the only action/);
    return {
      choices: [{
        message: {
          content: waitRetryPlannerCalls === 1
            ? JSON.stringify({
                done: false,
                reason: 'need another observation before acting',
                actions: [{ actionType: 'wait', ms: 100 }],
              })
            : waitRetryPlannerCalls === 2
              ? JSON.stringify({
                  done: false,
                  reason: 'act on the supplied screenshot',
                  actions: [{ actionType: 'click', targetDescription: 'the retry target' }],
                })
              : JSON.stringify({ done: true, reason: 'retry target clicked', actions: [] }),
        },
      }],
    };
  });
  const waitRetryGrounderServer = createJsonPostServer('/predict/', (body) => {
    assert.match(String(body.text_prompt), /click coordinates/i);
    assert.match(String(body.text_prompt), /the retry target/);
    return { coordinates: [22, 44], image_size: { width: 100, height: 80 } };
  });
  const waitRetryPlannerBaseUrl = await listenLocal(waitRetryPlannerServer);
  const waitRetryGrounderBaseUrl = await listenLocal(waitRetryGrounderServer);
  try {
    const waitRetryWorkspace = await createVisionWorkspace('wait-retry');
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-wait-retry-smoke';
    delete process.env.SCIFORGE_VISION_ACTIONS_JSON;
    process.env.SCIFORGE_VISION_PLANNER_BASE_URL = waitRetryPlannerBaseUrl;
    process.env.SCIFORGE_VISION_PLANNER_API_KEY = 'planner-test-key';
    process.env.SCIFORGE_VISION_PLANNER_MODEL = 'vision-planner-wait-retry-model';
    process.env.SCIFORGE_VISION_KV_GROUND_URL = waitRetryGrounderBaseUrl;
    process.env.SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS = '1';
    const waitRetry = await runVisionSenseGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use planner to avoid wait-only planning.',
      workspacePath: waitRetryWorkspace,
    });
    assert.equal(waitRetryPlannerCalls, 3);
    assert.equal(waitRetry.executionUnits[0].status, 'done');
    const { trace: waitRetryTrace } = await readVisionTraceJson(waitRetryWorkspace, waitRetry);
    assert.ok((waitRetryTrace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-001-execute-click'));
    assert.ok(!(waitRetryTrace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-001-execute-wait'));
  } finally {
    await closeServer(waitRetryPlannerServer);
    await closeServer(waitRetryGrounderServer);
  }

  const settingsFormWorkspace = await createVisionWorkspace('settings-form-ledger');
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-settings-form-ledger-smoke';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '1';
  process.env.SCIFORGE_VISION_MAX_STEPS = '12';
  process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([
    { type: 'click', x: 12, y: 12, targetDescription: 'visible settings search text input' },
    { type: 'type_text', text: 'test', targetDescription: 'visible settings search text input' },
    { type: 'click', x: 20, y: 20, targetDescription: 'visible preferences dropdown menu' },
    { type: 'click', x: 30, y: 30, targetDescription: 'visible checkbox control' },
    { type: 'click', x: 40, y: 40, targetDescription: 'visible toggle switch control' },
    { type: 'click', x: 50, y: 50, targetDescription: 'visible cancel button' },
    { type: 'scroll', direction: 'down', amount: 3, targetDescription: 'visible form controls panel' },
    { type: 'click', x: 60, y: 60, targetDescription: 'visible close button' },
    { type: 'click', x: 70, y: 70, targetDescription: 'unrelated extra control that should not run' },
  ]);
  delete process.env.SCIFORGE_VISION_PLANNER_BASE_URL;
  delete process.env.SCIFORGE_VISION_PLANNER_API_KEY;
  delete process.env.SCIFORGE_VISION_PLANNER_MODEL;
  delete process.env.SCIFORGE_VISION_KV_GROUND_URL;
  const settingsForm = await runVisionSenseGateway({
    skillDomain: 'literature',
    prompt: 'Use generic computer use for a low-risk settings/preferences form-control coverage task; do not submit or save.',
    workspacePath: settingsFormWorkspace,
  });
  assert.equal(settingsForm.executionUnits[0].status, 'done');
  const { trace: settingsFormTrace } = await readVisionTraceJson(settingsFormWorkspace, settingsForm);
  const settingsFormSteps = (settingsFormTrace.steps as Array<Record<string, unknown>>)
    .filter((step) => step.kind === 'gui-execution');
  assert.equal(settingsFormSteps.length, 8);
  assert.match(JSON.stringify(settingsFormSteps.at(-1)?.verifier ?? {}), /settings\/form control workflow/);

  let coordinateRetryPlannerCalls = 0;
  const coordinateRetryPlannerServer = createJsonPostServer('/chat/completions', (body, raw) => {
    coordinateRetryPlannerCalls += 1;
    assert.equal(body.model, 'vision-planner-coordinate-retry-model');
    if (coordinateRetryPlannerCalls === 2) assert.match(raw, /violated the planner contract by including screen coordinates/);
    return {
      choices: [{
        message: {
          content: coordinateRetryPlannerCalls === 1
            ? JSON.stringify({
                done: false,
                reason: 'bad coordinate plan',
                actions: [{ actionType: 'drag', fromX: 0, fromY: 0, toX: 10, toY: 10 }],
              })
            : coordinateRetryPlannerCalls === 2
              ? JSON.stringify({
                  done: false,
                  reason: 'rewrite with visual descriptions',
                  actions: [{
                    actionType: 'drag',
                    sourceDescription: 'the generic window title bar',
                    destinationDescription: 'the visible destination area',
                  }],
                })
              : JSON.stringify({ done: true, reason: 'drag completed', actions: [] }),
        },
      }],
    };
  });
  const coordinateRetryGrounderServer = createJsonPostServer('/predict/', (body) => {
    const textPrompt = String(body.text_prompt);
    assert.match(textPrompt, /generic window title bar|visible destination area/);
    return {
      coordinates: textPrompt.includes('title bar') ? [10, 20] : [80, 90],
      image_size: { width: 100, height: 100 },
    };
  });
  const coordinateRetryPlannerBaseUrl = await listenLocal(coordinateRetryPlannerServer);
  const coordinateRetryGrounderBaseUrl = await listenLocal(coordinateRetryGrounderServer);
  try {
    const coordinateRetryWorkspace = await createVisionWorkspace('coordinate-retry');
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-coordinate-retry-smoke';
    delete process.env.SCIFORGE_VISION_ACTIONS_JSON;
    process.env.SCIFORGE_VISION_PLANNER_BASE_URL = coordinateRetryPlannerBaseUrl;
    process.env.SCIFORGE_VISION_PLANNER_API_KEY = 'planner-test-key';
    process.env.SCIFORGE_VISION_PLANNER_MODEL = 'vision-planner-coordinate-retry-model';
    process.env.SCIFORGE_VISION_KV_GROUND_URL = coordinateRetryGrounderBaseUrl;
    process.env.SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS = '1';
    const coordinateRetry = await runVisionSenseGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use planner to rewrite coordinate actions through the grounder.',
      workspacePath: coordinateRetryWorkspace,
    });
    assert.equal(coordinateRetryPlannerCalls, 3);
    assert.equal(coordinateRetry.executionUnits[0].status, 'done');
    const { trace: coordinateRetryTrace } = await readVisionTraceJson(coordinateRetryWorkspace, coordinateRetry);
    const dragStep = (coordinateRetryTrace.steps as Array<Record<string, unknown>>).find((step) => step.id === 'step-001-execute-drag');
    assert.ok(dragStep);
    assert.equal(((dragStep.plannedAction as Record<string, unknown>)?.fromX), 10);
    assert.equal(((dragStep.plannedAction as Record<string, unknown>)?.toX), 80);
  } finally {
    await closeServer(coordinateRetryPlannerServer);
    await closeServer(coordinateRetryGrounderServer);
  }

  const windowTargetWorkspace = await createVisionWorkspace('window-target');
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-window-target-smoke';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '1';
  process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS = '1,2';
  process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([{ type: 'click', targetDescription: 'generic window-local target' }]);
  process.env.SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS = '1';
  const windowGrounderServer = createJsonPostServer('/predict/', (body) => {
    assert.match(String(body.text_prompt), /click coordinates/i);
    assert.match(String(body.text_prompt), /generic window-local target/);
    assert.match(String(body.image_path), /step-001-before-window-/);
    return { coordinates: [80, 40], image_size: { width: 160, height: 80 } };
  });
  const windowGrounderBaseUrl = await listenLocal(windowGrounderServer);
  try {
    process.env.SCIFORGE_VISION_KV_GROUND_URL = windowGrounderBaseUrl;
    const windowTarget = await runVisionSenseGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use inside the target window only.',
      workspacePath: windowTargetWorkspace,
      uiState: {
        visionSenseConfig: {
          dryRun: true,
          executorCoordinateScale: 2,
          schedulerLockTimeoutMs: 1234,
          schedulerStaleLockMs: 5678,
          inputAdapter: 'remote-desktop',
          windowTarget: {
            enabled: true,
            required: true,
            mode: 'active-window',
            coordinateSpace: 'window-local',
            inputIsolation: 'require-focused-target',
          },
        },
      },
    });
    assert.equal(windowTarget.executionUnits[0].status, 'done');
    const { trace: windowTrace } = await readVisionTraceJson(windowTargetWorkspace, windowTarget);
    const traceConfig = windowTrace.config as Record<string, unknown>;
    assert.deepEqual((traceConfig.windowTarget as Record<string, unknown>)?.mode, 'active-window');
    assert.deepEqual((traceConfig.windowTarget as Record<string, unknown>)?.captureKind, 'window');
    assert.deepEqual((traceConfig.windowTarget as Record<string, unknown>)?.coordinateSpace, 'window-local');
    assert.deepEqual((traceConfig.windowTarget as Record<string, unknown>)?.inputIsolation, 'require-focused-target');
    assert.equal(traceConfig.inputAdapter, 'remote-desktop');
    const allWindowRefs = (windowTrace.imageMemory as Record<string, unknown>).refs as Array<Record<string, unknown>>;
    const windowRefs = allWindowRefs.filter((ref) => ref.captureScope === 'window');
    const focusRefs = allWindowRefs.filter((ref) => ref.captureScope === 'focus-region');
    assert.ok(windowRefs.length >= 2);
    assert.ok(focusRefs.length >= 2);
    assert.ok(windowRefs.every((ref) => /-window-/.test(String(ref.path))));
    assert.ok(focusRefs.every((ref) => /-focus-/.test(String(ref.path))));
    assert.ok(windowRefs.every((ref) => ref.captureProvider === 'dry-run-window-png'));
    assert.ok(windowRefs.every((ref) => typeof ref.captureTimestamp === 'string' && String(ref.captureTimestamp).length > 0));
    assert.ok(windowRefs.every((ref) => Array.isArray(ref.captureDiagnostics) && (ref.captureDiagnostics as unknown[]).length >= 1));
    assert.ok(windowRefs.every((ref) => (ref.captureDiagnostics as Array<Record<string, unknown>>).some((item) => item.code === 'capture.window.dry-run')));
    assert.ok(allWindowRefs.every((ref) => ((ref.windowTarget as Record<string, unknown>)?.captureKind) === 'window'));
    const generic = windowTrace.genericComputerUse as Record<string, unknown>;
    assert.equal(((generic.coordinateContract as Record<string, unknown>)?.grounderOutput), 'target-window screenshot coordinates');
    assert.equal(((generic.coordinateContract as Record<string, unknown>)?.executorInput), 'window-local');
    assert.equal(((generic.coordinateContract as Record<string, unknown>)?.localCoordinateFrame), 'window screenshot pixels before executor mapping');
    assert.equal(((generic.verifierContract as Record<string, unknown>)?.beforeAfterWindowConsistency), 'required-or-structured-window-lifecycle-diagnostics');
    assert.equal(generic.inputIsolation, 'require-focused-target');
    const inputContract = generic.inputChannelContract as Record<string, unknown>;
    assert.equal(inputContract.pointerKeyboardOwnership, 'virtual-dry-run-channel');
    assert.equal(inputContract.pointerMode, 'virtual-no-user-pointer-movement');
    assert.equal(inputContract.keyboardMode, 'virtual-no-user-keyboard-events');
    assert.equal(inputContract.userDeviceImpact, 'none');
    assert.equal(inputContract.independentAdapterRequiredForNoUserImpact, false);
    const lifecycle = windowTrace.windowLifecycle as Record<string, unknown>;
    assert.equal(lifecycle.status, 'stable-or-single-window');
    assert.ok(Array.isArray(lifecycle.samples));
    const scheduler = windowTrace.scheduler as Record<string, unknown>;
    assert.equal(scheduler.lockScope, 'target-window');
    assert.equal(scheduler.actionConcurrency, 'one-real-gui-action-at-a-time-per-window');
    assert.equal(scheduler.analysisConcurrency, 'parallel-allowed');
    assert.equal(scheduler.focusPolicy, 'require-focused-target-before-action');
    assert.equal(scheduler.interferenceRisk, 'low-when-focused-target-verified');
    assert.equal(((scheduler.executorLock as Record<string, unknown>)?.provider), 'filesystem-lease');
    assert.equal(((scheduler.executorLock as Record<string, unknown>)?.appliesTo), 'none-dry-run');
    assert.equal(((scheduler.executorLock as Record<string, unknown>)?.timeoutMs), 1234);
    assert.equal(((scheduler.executorLock as Record<string, unknown>)?.staleLockMs), 5678);
    const windowStep = (windowTrace.steps as Array<Record<string, unknown>>).find((step) => step.id === 'step-001-execute-click');
    assert.ok(windowStep);
    assert.equal(((windowStep.plannedAction as Record<string, unknown>)?.x), 40);
    assert.equal(((windowStep.plannedAction as Record<string, unknown>)?.y), 20);
    assert.equal(((windowStep.grounding as Record<string, unknown>)?.screenshotX), 80);
    assert.equal(((windowStep.grounding as Record<string, unknown>)?.screenshotY), 40);
    assert.equal(((windowStep.grounding as Record<string, unknown>)?.localX), 80);
    assert.equal(((windowStep.grounding as Record<string, unknown>)?.localY), 40);
    assert.equal(((windowStep.grounding as Record<string, unknown>)?.executorX), 40);
    assert.equal(((windowStep.grounding as Record<string, unknown>)?.executorY), 20);
    assert.equal(((windowStep.grounding as Record<string, unknown>)?.executorCoordinateScale), 2);
    assert.equal(((windowStep.windowTarget as Record<string, unknown>)?.captureKind), 'window');
    assert.equal(((windowStep.localCoordinate as Record<string, unknown>)?.space), 'window');
    assert.equal(((windowStep.localCoordinate as Record<string, unknown>)?.coordinateSpace), 'window-local');
    assert.equal(((windowStep.localCoordinate as Record<string, unknown>)?.localX), 80);
    assert.equal(((windowStep.localCoordinate as Record<string, unknown>)?.localY), 40);
    assert.equal(((windowStep.mappedCoordinate as Record<string, unknown>)?.space), 'executor');
    assert.equal(((windowStep.inputChannel as Record<string, unknown>)?.type), 'generic-mouse-keyboard');
    assert.equal(((windowStep.inputChannel as Record<string, unknown>)?.pointerKeyboardOwnership), 'virtual-dry-run-channel');
    assert.equal(((windowStep.inputChannel as Record<string, unknown>)?.userDeviceImpact), 'none');
    assert.equal(((windowStep.scheduler as Record<string, unknown>)?.mode), 'serialized-window-actions');
    assert.equal(((windowStep.scheduler as Record<string, unknown>)?.lockScope), 'target-window');
    assert.equal(((windowStep.scheduler as Record<string, unknown>)?.focusPolicy), 'require-focused-target-before-action');
    assert.equal(((windowStep.scheduler as Record<string, unknown>)?.interferenceRisk), 'low-when-focused-target-verified');
    assert.equal(((windowStep.scheduler as Record<string, unknown>)?.failClosedIsolation), true);
    assert.equal((((windowStep.verifier as Record<string, unknown>)?.windowConsistency as Record<string, unknown>)?.status), 'same-target-window');
    assert.equal((((windowStep.verifier as Record<string, unknown>)?.windowConsistency as Record<string, unknown>)?.sameWindow), true);
  } finally {
    await closeServer(windowGrounderServer);
  }

  const providerFailureWorkspace = await createVisionWorkspace('window-provider-failure');
  const providerFailureTarget = {
    enabled: true,
    required: true,
    mode: 'window-id',
    windowId: 99_999,
    coordinateSpace: 'window-local',
    inputIsolation: 'require-focused-target',
  } satisfies ComputerUseConfig['windowTarget'];
  const providerFailureResolution: WindowTargetResolution = {
    ok: true,
    target: providerFailureTarget,
    captureKind: 'window',
    windowId: 99_999,
    coordinateSpace: 'window-local',
    inputIsolation: 'require-focused-target',
    schedulerLockId: 'window:99999',
    source: 'config',
    diagnostics: ['unit-smoke resolved generic window target'],
  };
  const providerFailureConfig: ComputerUseConfig = {
    desktopBridgeEnabled: true,
    dryRun: false,
    captureDisplays: [7],
    desktopPlatform: 'linux',
    windowTarget: providerFailureTarget,
    maxSteps: 1,
    allowHighRiskActions: false,
    planner: { timeoutMs: 1, maxTokens: 1 },
    grounder: { timeoutMs: 1, allowServiceLocalPaths: false, visionTimeoutMs: 1, visionMaxTokens: 1 },
    plannedActions: [],
  };
  await assert.rejects(
    () => captureDisplays(providerFailureWorkspace, providerFailureWorkspace, 'step-structured-failure', providerFailureConfig, providerFailureResolution),
    (error) => {
      assert.ok(error instanceof CaptureProviderError);
      assert.equal(error.failure.ok, false);
      assert.equal(error.failure.captureScope, 'window');
      assert.equal(error.failure.provider, 'linux-window-provider-unavailable');
      assert.equal(error.failure.displayId, 7);
      assert.equal(error.failure.windowId, 99_999);
      assert.ok(error.failure.diagnostics.some((item) => item.code === 'capture.window.unsupported-provider' && item.level === 'error'));
      return true;
    },
  );
  const realExecutorLockResult = await executeGenericDesktopAction({ type: 'wait', ms: 1 }, {
    ...providerFailureConfig,
    runId: 'scheduler-lock-smoke',
    desktopPlatform: 'linux',
  }, {
    ...providerFailureResolution,
    captureKind: 'display',
    schedulerLockId: 'smoke-real-gui-lock-424242',
  });
  assert.equal(realExecutorLockResult.exitCode, 126);
  assert.equal((realExecutorLockResult.schedulerLease as Record<string, unknown>)?.mode, 'real-gui-executor-lock');
  assert.equal((realExecutorLockResult.schedulerLease as Record<string, unknown>)?.lockId, 'smoke-real-gui-lock-424242');
  assert.equal(typeof (realExecutorLockResult.schedulerLease as Record<string, unknown>)?.acquiredAt, 'string');
  assert.equal(typeof (realExecutorLockResult.schedulerLease as Record<string, unknown>)?.releasedAt, 'string');
  assert.match(String((realExecutorLockResult.schedulerLease as Record<string, unknown>)?.lockPath), /sciforge-computer-use-locks/);
  const openAppNoPointerResult = await executeGenericDesktopAction({ type: 'open_app', appName: 'Example App' }, {
    ...providerFailureConfig,
    runId: 'open-app-no-pointer-smoke',
    desktopPlatform: 'linux',
    allowSharedSystemInput: false,
  }, {
    ...providerFailureResolution,
    captureKind: 'display',
    schedulerLockId: 'smoke-open-app-lock-424242',
  });
  assert.equal(openAppNoPointerResult.exitCode, 126);
  assert.match(openAppNoPointerResult.stderr, /No real generic GUI executor is configured/i);
  assert.doesNotMatch(openAppNoPointerResult.stderr, /shared system mouse\/keyboard input was not explicitly allowed/i);
  assert.equal((openAppNoPointerResult.schedulerLease as Record<string, unknown>)?.lockId, 'smoke-open-app-lock-424242');
  const independentInputContract = inputChannelContract({
    ...providerFailureConfig,
    dryRun: false,
    desktopPlatform: 'darwin',
    inputAdapter: 'remote-desktop',
  }, {
    ...providerFailureResolution,
    captureKind: 'window',
    inputIsolation: 'require-focused-target',
  });
  assert.equal(independentInputContract.currentIndependentAdapter, 'remote-desktop');
  assert.equal(independentInputContract.independentAdapterStatus, 'configured-unimplemented');
  assert.equal(independentInputContract.pointerKeyboardOwnership, 'unavailable');
  assert.equal(independentInputContract.userDeviceImpact, 'fail-closed-unimplemented-independent-adapter');
  assert.equal(independentInputContract.independentAdapterRequiredForNoUserImpact, true);
  assert.equal(independentInputContract.failClosed, true);
  const independentExecutorResult = await executeGenericDesktopAction({ type: 'click', x: 5, y: 5 }, {
    ...providerFailureConfig,
    dryRun: false,
    desktopPlatform: 'darwin',
    inputAdapter: 'remote-desktop',
  }, {
    ...providerFailureResolution,
    captureKind: 'window',
    inputIsolation: 'require-focused-target',
    appName: 'Finder',
  });
  assert.equal(independentExecutorResult.exitCode, 125);
  assert.match(independentExecutorResult.stderr, /no executable adapter provider|Failing closed/i);
  assert.equal((independentExecutorResult.schedulerLease as Record<string, unknown> | undefined), undefined);
  const sharedInputContract = inputChannelContract({
    ...providerFailureConfig,
    dryRun: false,
    desktopPlatform: 'darwin',
    allowSharedSystemInput: true,
    showVisualCursor: true,
  }, {
    ...providerFailureResolution,
    captureKind: 'window',
    inputIsolation: 'require-focused-target',
  });
  assert.equal(sharedInputContract.pointerKeyboardOwnership, 'shared-system-pointer-keyboard');
  assert.equal(sharedInputContract.visualPointer, 'sciforge-distinct-overlay-cursor');
  assert.equal(sharedInputContract.executorLockScope, 'global-shared-system-input');
  assert.equal(sharedInputContract.executorLockId, 'shared-system-input');
  assert.equal(sharedInputContract.sharedSystemInputExplicitlyAllowed, true);
  assert.equal(sharedInputContract.failClosed, false);

  const isolatedWindowWorkspace = await createVisionWorkspace('window-isolation');
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-window-isolation-smoke';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '0';
  process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([{ type: 'click', x: 5, y: 5 }]);
  delete process.env.SCIFORGE_VISION_KV_GROUND_URL;
  const isolatedWindow = await runVisionSenseGateway({
    skillDomain: 'literature',
    prompt: 'Use generic computer use only if the requested target window can be isolated.',
    workspacePath: isolatedWindowWorkspace,
    uiState: {
      visionSenseConfig: {
        dryRun: false,
        desktopPlatform: 'linux',
        windowTarget: {
          enabled: true,
          required: true,
          mode: 'window-id',
          windowId: 424242,
          coordinateSpace: 'window-local',
          inputIsolation: 'require-focused-target',
        },
      },
    },
  });
  assert.equal(isolatedWindow.executionUnits[0].status, 'failed-with-reason');
  assert.match(String(isolatedWindow.executionUnits[0].failureReason), /window|target|isolation|focus|failed-with-reason/i);
  const { trace: isolatedTrace } = await readVisionTraceJson(isolatedWindowWorkspace, isolatedWindow);
  assert.equal(((isolatedTrace.config as Record<string, unknown>).windowTarget as Record<string, unknown>)?.status, 'unresolved');
  assert.ok((isolatedTrace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-000-blocked-window-target' && step.status === 'blocked'));
  assert.doesNotMatch(JSON.stringify(isolatedTrace), /step-001-execute-click/);

  console.log('[ok] vision-sense runtime uses the generic window-based Computer Use loop without app-specific shortcuts');
} finally {
  restoreVisionSenseEnv(savedEnv);
}

import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CaptureProviderError, captureDisplays } from '../../src/runtime/computer-use/capture.js';
import { normalizePlatformAction, platformActionIssue } from '../../src/runtime/computer-use/actions.js';
import { executeGenericDesktopAction } from '../../src/runtime/computer-use/executor.js';
import type { ComputerUseConfig, WindowTargetResolution } from '../../src/runtime/computer-use/types.js';
import { inputChannelContract } from '../../src/runtime/computer-use/window-target.js';
import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const previousBridge = process.env.SCIFORGE_VISION_DESKTOP_BRIDGE;
const previousDryRun = process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN;
const previousRunId = process.env.SCIFORGE_VISION_RUN_ID;
const previousDisplays = process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS;
const previousActions = process.env.SCIFORGE_VISION_ACTIONS_JSON;
const previousGrounderUrl = process.env.SCIFORGE_VISION_KV_GROUND_URL;
const previousGrounderAllowLocal = process.env.SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS;
const previousPlannerBaseUrl = process.env.SCIFORGE_VISION_PLANNER_BASE_URL;
const previousPlannerApiKey = process.env.SCIFORGE_VISION_PLANNER_API_KEY;
const previousPlannerModel = process.env.SCIFORGE_VISION_PLANNER_MODEL;
const previousVisualGrounderBaseUrl = process.env.SCIFORGE_VISION_GROUNDER_LLM_BASE_URL;
const previousVisualGrounderApiKey = process.env.SCIFORGE_VISION_GROUNDER_LLM_API_KEY;
const previousVisualGrounderModel = process.env.SCIFORGE_VISION_GROUNDER_LLM_MODEL;
const previousMaxSteps = process.env.SCIFORGE_VISION_MAX_STEPS;
const previousDesktopPlatform = process.env.SCIFORGE_VISION_DESKTOP_PLATFORM;

try {
  const darwinHotkeyConfig = { desktopPlatform: 'darwin' } as ComputerUseConfig;
  const canonicalSwitch = normalizePlatformAction({ type: 'hotkey', keys: ['Alt', 'Tab'] }, darwinHotkeyConfig);
  assert.deepEqual(canonicalSwitch, { type: 'hotkey', keys: ['command', 'tab'] });
  assert.equal(platformActionIssue(canonicalSwitch, darwinHotkeyConfig), '');

  const blockedWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-bridge-blocked-'));
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE = '0';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '0';
  const blocked = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Open the desktop presentation app and create a GUI Agent slide through computer use.',
    workspacePath: blockedWorkspace,
    selectedToolIds: ['local.vision-sense'],
    uiState: { selectedToolIds: ['local.vision-sense'] },
  });

  assert.equal(blocked.executionUnits.length, 1);
  assert.equal(blocked.executionUnits[0].tool, 'local.vision-sense');
  assert.equal(blocked.executionUnits[0].status, 'failed-with-reason');
  assert.match(String(blocked.executionUnits[0].failureReason || blocked.message), /desktop bridge is disabled/i);
  assert.doesNotMatch(blocked.message, /AgentServer task generation/i);

  const missingPlannerWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-missing-planner-'));
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE = '1';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '1';
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-missing-planner-smoke';
  process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS = '1,2';
  delete process.env.SCIFORGE_VISION_ACTIONS_JSON;
  const missingPlanner = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Open any desktop app and complete a GUI Agent task using computer use.',
    workspacePath: missingPlannerWorkspace,
    selectedToolIds: ['local.vision-sense'],
    uiState: { selectedToolIds: ['local.vision-sense'] },
  });

  assert.equal(missingPlanner.executionUnits.length, 1);
  assert.equal(missingPlanner.executionUnits[0].tool, 'local.vision-sense');
  assert.equal(missingPlanner.executionUnits[0].status, 'failed-with-reason');
  assert.match(String(missingPlanner.executionUnits[0].failureReason || missingPlanner.message), /no planner\/grounder actions/i);
  assert.doesNotMatch(missingPlanner.message, /Word|PowerPoint|adapter/i);
  const missingTraceArtifact = missingPlanner.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
  assert.ok(missingTraceArtifact);
  assert.equal(missingTraceArtifact.path, '.sciforge/vision-runs/generic-cu-missing-planner-smoke/vision-trace.json');
  await stat(join(missingPlannerWorkspace, '.sciforge/vision-runs/generic-cu-missing-planner-smoke/step-000-before-display-1.png'));
  await stat(join(missingPlannerWorkspace, '.sciforge/vision-runs/generic-cu-missing-planner-smoke/step-000-after-display-2.png'));
  delete process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS;

  const autoDisplaysWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-auto-displays-'));
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-auto-displays-smoke';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '1';
  process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([{ type: 'wait', ms: 1 }]);
  const autoDisplays = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Use generic computer use with automatically detected displays.',
    workspacePath: autoDisplaysWorkspace,
    selectedToolIds: ['local.vision-sense'],
    uiState: { selectedToolIds: ['local.vision-sense'] },
  });
  const autoDisplaysTraceArtifact = autoDisplays.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
  assert.ok(autoDisplaysTraceArtifact);
  const autoDisplaysTrace = JSON.parse(await readFile(join(autoDisplaysWorkspace, String(autoDisplaysTraceArtifact.path)), 'utf8')) as Record<string, unknown>;
  const autoCaptureDisplays = (autoDisplaysTrace.config as Record<string, unknown>).captureDisplays as unknown[];
  assert.ok(Array.isArray(autoCaptureDisplays) && autoCaptureDisplays.length >= 1);
  assert.ok(autoCaptureDisplays.every((displayId) => Number.isInteger(displayId) && Number(displayId) > 0));

  const dryRunWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-generic-dryrun-'));
    process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS = '1,2';
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-actions-smoke';
    process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([
      { type: 'wait', ms: 1 },
      { type: 'hotkey', keys: ['command', 'n'] },
      { actionType: 'hotkey', hotkey: 'command+tab' },
      { actionType: 'scroll', scrollAmount: 300 },
      { type: 'type_text', text: 'GUI Agent generic action smoke' },
    ]);
  const completed = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Use generic computer use actions in whichever app is active; do not use app-specific shortcuts.',
    workspacePath: dryRunWorkspace,
    selectedToolIds: ['local.vision-sense'],
    uiState: { selectedToolIds: ['local.vision-sense'] },
  });

  assert.equal(completed.executionUnits.length, 1);
  assert.equal(completed.executionUnits[0].tool, 'local.vision-sense');
  assert.equal(completed.executionUnits[0].status, 'done');
  const traceArtifact = completed.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
  assert.ok(traceArtifact);
  assert.equal(traceArtifact.path, '.sciforge/vision-runs/generic-cu-actions-smoke/vision-trace.json');
  assert.equal(completed.artifacts.length, 1);

  const tracePath = join(dryRunWorkspace, String(traceArtifact.path));
  const traceText = await readFile(tracePath, 'utf8');
  assert.doesNotMatch(traceText, /base64|data:image/i);
  const trace = JSON.parse(traceText) as Record<string, unknown>;
  assert.equal((trace.imageMemory as Record<string, unknown>).policy, 'file-ref-only');
  assert.deepEqual((trace.genericComputerUse as Record<string, unknown>).appSpecificShortcuts, []);
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

  const highRiskWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-high-risk-'));
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-high-risk-smoke';
  process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([
    { type: 'click', x: 10, y: 10, targetDescription: 'final submit button', riskLevel: 'high', requiresConfirmation: true },
  ]);
  const blockedHighRisk = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Use computer use to click a high-risk submit action without confirmation.',
    workspacePath: highRiskWorkspace,
    selectedToolIds: ['local.vision-sense'],
    uiState: { selectedToolIds: ['local.vision-sense'] },
  });
  assert.equal(blockedHighRisk.executionUnits[0].status, 'failed-with-reason');
  assert.match(String(blockedHighRisk.executionUnits[0].failureReason), /High-risk Computer Use action blocked/i);
  const highRiskTraceArtifact = blockedHighRisk.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
  assert.ok(highRiskTraceArtifact);
  const highRiskTrace = JSON.parse(await readFile(join(highRiskWorkspace, String(highRiskTraceArtifact.path)), 'utf8')) as Record<string, unknown>;
  assert.ok((highRiskTrace.steps as Array<Record<string, unknown>>).some((step) => step.status === 'blocked'));
  assert.doesNotMatch(JSON.stringify(highRiskTrace), /base64|data:image/i);

  const grounderServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/predict/') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      assert.match(String(body.text_prompt), /click coordinates/i);
      assert.match(String(body.text_prompt), /the generic search box/);
      assert.match(String(body.image_path), /step-001-before-display-1\.png$/);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ coordinates: [42, 24], image_size: { width: 100, height: 80 }, text: 'click' }));
    });
  });
  await new Promise<void>((resolve) => grounderServer.listen(0, '127.0.0.1', resolve));
  try {
    const address = grounderServer.address();
    assert.ok(address && typeof address === 'object');
    const groundedWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-grounder-'));
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-grounder-smoke';
    process.env.SCIFORGE_VISION_KV_GROUND_URL = `http://127.0.0.1:${address.port}`;
    process.env.SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS = '1';
    process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([
      { type: 'click', targetDescription: 'the generic search box' },
    ]);
    const grounded = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use to click a visually described target.',
      workspacePath: groundedWorkspace,
      selectedToolIds: ['local.vision-sense'],
      uiState: { selectedToolIds: ['local.vision-sense'] },
    });
    assert.equal(grounded.executionUnits[0].status, 'done');
    const groundedTraceArtifact = grounded.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
    assert.ok(groundedTraceArtifact);
    const groundedTrace = JSON.parse(await readFile(join(groundedWorkspace, String(groundedTraceArtifact.path)), 'utf8')) as Record<string, unknown>;
    const groundedStep = (groundedTrace.steps as Array<Record<string, unknown>>).find((step) => step.id === 'step-001-execute-click');
    assert.ok(groundedStep);
    assert.equal(((groundedStep.plannedAction as Record<string, unknown>)?.x), 42);
    assert.equal(((groundedStep.grounding as Record<string, unknown>)?.provider), 'coarse-to-fine');
    assert.equal((((groundedStep.grounding as Record<string, unknown>)?.fineGrounding as Record<string, unknown>)?.stage), 'fine');
    assert.equal((((groundedStep.verifier as Record<string, unknown>)?.regionSemantic as Record<string, unknown>)?.schemaVersion), 'sciforge.vision-sense.region-semantic-verifier.v1');
  } finally {
    await new Promise<void>((resolve) => grounderServer.close(() => resolve()));
  }

  const visualGrounderServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/chat/completions') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      assert.equal(body.model, 'visual-grounder-smoke-model');
      assert.match(raw, /visually described fallback target/);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({ coordinates: [66, 77], confidence: 0.8, reason: 'target center' }),
          },
        }],
      }));
    });
  });
  await new Promise<void>((resolve) => visualGrounderServer.listen(0, '127.0.0.1', resolve));
  try {
    const address = visualGrounderServer.address();
    assert.ok(address && typeof address === 'object');
    const visualGrounderWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-visual-grounder-'));
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-visual-grounder-smoke';
    delete process.env.SCIFORGE_VISION_KV_GROUND_URL;
    process.env.SCIFORGE_VISION_GROUNDER_LLM_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.SCIFORGE_VISION_GROUNDER_LLM_API_KEY = 'visual-grounder-key';
    process.env.SCIFORGE_VISION_GROUNDER_LLM_MODEL = 'visual-grounder-smoke-model';
    process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([
      { type: 'click', targetDescription: 'visually described fallback target' },
    ]);
    const visuallyGrounded = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use to click a target through visual grounder fallback.',
      workspacePath: visualGrounderWorkspace,
      selectedToolIds: ['local.vision-sense'],
      uiState: { selectedToolIds: ['local.vision-sense'] },
    });
    assert.equal(visuallyGrounded.executionUnits[0].status, 'done');
    const visualTraceArtifact = visuallyGrounded.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
    assert.ok(visualTraceArtifact);
    const visualTrace = JSON.parse(await readFile(join(visualGrounderWorkspace, String(visualTraceArtifact.path)), 'utf8')) as Record<string, unknown>;
    const visualStep = (visualTrace.steps as Array<Record<string, unknown>>).find((step) => step.id === 'step-001-execute-click');
    assert.ok(visualStep);
    assert.equal(((visualStep.plannedAction as Record<string, unknown>)?.x), 66);
    assert.equal(((visualStep.grounding as Record<string, unknown>)?.provider), 'coarse-to-fine');
    assert.equal((((visualStep.grounding as Record<string, unknown>)?.fineGrounding as Record<string, unknown>)?.stage), 'fine');
  } finally {
    await new Promise<void>((resolve) => visualGrounderServer.close(() => resolve()));
  }

  let plannerCalls = 0;
  const plannerRawRequests: string[] = [];
  const plannerServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/chat/completions') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      plannerCalls += 1;
      plannerRawRequests.push(raw);
      const body = JSON.parse(raw) as Record<string, unknown>;
      assert.equal(body.model, 'vision-planner-smoke-model');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
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
      }));
    });
  });
  const plannerGrounderServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/predict/') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      assert.match(String(body.text_prompt), /click coordinates/i);
      assert.match(String(body.text_prompt), /the generic planner target/);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ coordinates: [12, 34], image_size: { width: 100, height: 80 } }));
    });
  });
  await new Promise<void>((resolve) => plannerServer.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => plannerGrounderServer.listen(0, '127.0.0.1', resolve));
  try {
    const plannerAddress = plannerServer.address();
    const plannerGrounderAddress = plannerGrounderServer.address();
    assert.ok(plannerAddress && typeof plannerAddress === 'object');
    assert.ok(plannerGrounderAddress && typeof plannerGrounderAddress === 'object');
    const plannerWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-planner-'));
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-planner-smoke';
    delete process.env.SCIFORGE_VISION_ACTIONS_JSON;
    process.env.SCIFORGE_VISION_PLANNER_BASE_URL = `http://127.0.0.1:${plannerAddress.port}`;
    process.env.SCIFORGE_VISION_PLANNER_API_KEY = 'planner-test-key';
    process.env.SCIFORGE_VISION_PLANNER_MODEL = 'vision-planner-smoke-model';
    process.env.SCIFORGE_VISION_KV_GROUND_URL = `http://127.0.0.1:${plannerGrounderAddress.port}`;
    process.env.SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS = '1';
    const planned = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use planner to click the visible target.',
      workspacePath: plannerWorkspace,
      selectedToolIds: ['local.vision-sense'],
      uiState: { selectedToolIds: ['local.vision-sense'] },
    });
    assert.equal(planned.executionUnits[0].status, 'done');
    const plannedTraceArtifact = planned.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
    assert.ok(plannedTraceArtifact);
    const plannedTrace = JSON.parse(await readFile(join(plannerWorkspace, String(plannedTraceArtifact.path)), 'utf8')) as Record<string, unknown>;
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
    await new Promise<void>((resolve) => plannerServer.close(() => resolve()));
    await new Promise<void>((resolve) => plannerGrounderServer.close(() => resolve()));
  }

  let maxStepsPlannerCalls = 0;
  const maxStepsPlannerServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/chat/completions') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      maxStepsPlannerCalls += 1;
      assert.match(raw, /Execution environment:/);
      assert.match(raw, /Set done=true only when the supplied screenshot shows/);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              done: false,
              reason: 'task still needs more GUI work',
              actions: [{ actionType: 'press_key', key: 'Escape' }],
            }),
          },
        }],
      }));
    });
  });
  await new Promise<void>((resolve) => maxStepsPlannerServer.listen(0, '127.0.0.1', resolve));
  try {
    const address = maxStepsPlannerServer.address();
    assert.ok(address && typeof address === 'object');
    const maxStepsWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-maxsteps-'));
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-maxsteps-smoke';
    delete process.env.SCIFORGE_VISION_ACTIONS_JSON;
    delete process.env.SCIFORGE_VISION_KV_GROUND_URL;
    process.env.SCIFORGE_VISION_MAX_STEPS = '1';
    process.env.SCIFORGE_VISION_PLANNER_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.SCIFORGE_VISION_PLANNER_API_KEY = 'planner-test-key';
    process.env.SCIFORGE_VISION_PLANNER_MODEL = 'vision-planner-maxsteps-model';
    const maxSteps = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use planner and keep going until the visible task is complete.',
      workspacePath: maxStepsWorkspace,
      selectedToolIds: ['local.vision-sense'],
      uiState: { selectedToolIds: ['local.vision-sense'] },
    });
    assert.equal(maxStepsPlannerCalls, 1);
    assert.equal(maxSteps.executionUnits[0].status, 'failed-with-reason');
    assert.match(String(maxSteps.executionUnits[0].failureReason), /maxSteps=1/i);
    const maxStepsTraceArtifact = maxSteps.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
    assert.ok(maxStepsTraceArtifact);
    const maxStepsTrace = JSON.parse(await readFile(join(maxStepsWorkspace, String(maxStepsTraceArtifact.path)), 'utf8')) as Record<string, unknown>;
    assert.ok((maxStepsTrace.steps as Array<Record<string, unknown>>).some((step) => /maxSteps exhausted/.test(String((step.verifier as Record<string, unknown>)?.reason))));
  } finally {
    await new Promise<void>((resolve) => maxStepsPlannerServer.close(() => resolve()));
    delete process.env.SCIFORGE_VISION_MAX_STEPS;
  }

  let platformRetryPlannerCalls = 0;
  const platformRetryPlannerServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/chat/completions') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      platformRetryPlannerCalls += 1;
      if (platformRetryPlannerCalls === 1) assert.match(raw, /desktopPlatform=\\?"darwin\\?"/);
      if (platformRetryPlannerCalls === 2) assert.match(raw, /cannot be executed in the current operating system/);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
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
      }));
    });
  });
  await new Promise<void>((resolve) => platformRetryPlannerServer.listen(0, '127.0.0.1', resolve));
  try {
    const address = platformRetryPlannerServer.address();
    assert.ok(address && typeof address === 'object');
    const platformRetryWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-platform-retry-'));
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-platform-retry-smoke';
    delete process.env.SCIFORGE_VISION_ACTIONS_JSON;
    process.env.SCIFORGE_VISION_DESKTOP_PLATFORM = 'darwin';
    process.env.SCIFORGE_VISION_MAX_STEPS = '1';
    process.env.SCIFORGE_VISION_PLANNER_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.SCIFORGE_VISION_PLANNER_API_KEY = 'planner-test-key';
    process.env.SCIFORGE_VISION_PLANNER_MODEL = 'vision-planner-platform-retry-model';
    const platformRetry = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use planner with platform-compatible keys.',
      workspacePath: platformRetryWorkspace,
      selectedToolIds: ['local.vision-sense'],
      uiState: { selectedToolIds: ['local.vision-sense'] },
    });
    assert.equal(platformRetryPlannerCalls, 2);
    const platformTraceArtifact = platformRetry.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
    assert.ok(platformTraceArtifact);
    const platformTrace = JSON.parse(await readFile(join(platformRetryWorkspace, String(platformTraceArtifact.path)), 'utf8')) as Record<string, unknown>;
    assert.equal(((platformTrace.config as Record<string, unknown>)?.desktopPlatform), 'darwin');
    assert.ok((platformTrace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-001-execute-press_key'));
    assert.doesNotMatch(JSON.stringify(platformTrace), /"key": "Win"/);
  } finally {
    await new Promise<void>((resolve) => platformRetryPlannerServer.close(() => resolve()));
    delete process.env.SCIFORGE_VISION_MAX_STEPS;
    delete process.env.SCIFORGE_VISION_DESKTOP_PLATFORM;
  }

  let waitRetryPlannerCalls = 0;
  const waitRetryPlannerServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/chat/completions') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      waitRetryPlannerCalls += 1;
      const body = JSON.parse(raw) as Record<string, unknown>;
      assert.equal(body.model, 'vision-planner-wait-retry-model');
      if (waitRetryPlannerCalls === 2) assert.match(raw, /Do not return an empty action list or wait as the only action/);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
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
      }));
    });
  });
  const waitRetryGrounderServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/predict/') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      assert.match(String(body.text_prompt), /click coordinates/i);
      assert.match(String(body.text_prompt), /the retry target/);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ coordinates: [22, 44], image_size: { width: 100, height: 80 } }));
    });
  });
  await new Promise<void>((resolve) => waitRetryPlannerServer.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => waitRetryGrounderServer.listen(0, '127.0.0.1', resolve));
  try {
    const plannerAddress = waitRetryPlannerServer.address();
    const grounderAddress = waitRetryGrounderServer.address();
    assert.ok(plannerAddress && typeof plannerAddress === 'object');
    assert.ok(grounderAddress && typeof grounderAddress === 'object');
    const waitRetryWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-wait-retry-'));
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-wait-retry-smoke';
    delete process.env.SCIFORGE_VISION_ACTIONS_JSON;
    process.env.SCIFORGE_VISION_PLANNER_BASE_URL = `http://127.0.0.1:${plannerAddress.port}`;
    process.env.SCIFORGE_VISION_PLANNER_API_KEY = 'planner-test-key';
    process.env.SCIFORGE_VISION_PLANNER_MODEL = 'vision-planner-wait-retry-model';
    process.env.SCIFORGE_VISION_KV_GROUND_URL = `http://127.0.0.1:${grounderAddress.port}`;
    process.env.SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS = '1';
    const waitRetry = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use planner to avoid wait-only planning.',
      workspacePath: waitRetryWorkspace,
      selectedToolIds: ['local.vision-sense'],
      uiState: { selectedToolIds: ['local.vision-sense'] },
    });
    assert.equal(waitRetryPlannerCalls, 3);
    assert.equal(waitRetry.executionUnits[0].status, 'done');
    const waitRetryTraceArtifact = waitRetry.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
    assert.ok(waitRetryTraceArtifact);
    const waitRetryTrace = JSON.parse(await readFile(join(waitRetryWorkspace, String(waitRetryTraceArtifact.path)), 'utf8')) as Record<string, unknown>;
    assert.ok((waitRetryTrace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-001-execute-click'));
    assert.ok(!(waitRetryTrace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-001-execute-wait'));
  } finally {
    await new Promise<void>((resolve) => waitRetryPlannerServer.close(() => resolve()));
    await new Promise<void>((resolve) => waitRetryGrounderServer.close(() => resolve()));
  }

  let coordinateRetryPlannerCalls = 0;
  const coordinateRetryPlannerServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/chat/completions') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      coordinateRetryPlannerCalls += 1;
      const body = JSON.parse(raw) as Record<string, unknown>;
      assert.equal(body.model, 'vision-planner-coordinate-retry-model');
      if (coordinateRetryPlannerCalls === 2) assert.match(raw, /violated the planner contract by including screen coordinates/);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
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
      }));
    });
  });
  const coordinateRetryGrounderServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/predict/') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      const textPrompt = String(body.text_prompt);
      assert.match(textPrompt, /generic window title bar|visible destination area/);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        coordinates: textPrompt.includes('title bar') ? [10, 20] : [80, 90],
        image_size: { width: 100, height: 100 },
      }));
    });
  });
  await new Promise<void>((resolve) => coordinateRetryPlannerServer.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => coordinateRetryGrounderServer.listen(0, '127.0.0.1', resolve));
  try {
    const plannerAddress = coordinateRetryPlannerServer.address();
    const grounderAddress = coordinateRetryGrounderServer.address();
    assert.ok(plannerAddress && typeof plannerAddress === 'object');
    assert.ok(grounderAddress && typeof grounderAddress === 'object');
    const coordinateRetryWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-coordinate-retry-'));
    process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-coordinate-retry-smoke';
    delete process.env.SCIFORGE_VISION_ACTIONS_JSON;
    process.env.SCIFORGE_VISION_PLANNER_BASE_URL = `http://127.0.0.1:${plannerAddress.port}`;
    process.env.SCIFORGE_VISION_PLANNER_API_KEY = 'planner-test-key';
    process.env.SCIFORGE_VISION_PLANNER_MODEL = 'vision-planner-coordinate-retry-model';
    process.env.SCIFORGE_VISION_KV_GROUND_URL = `http://127.0.0.1:${grounderAddress.port}`;
    process.env.SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS = '1';
    const coordinateRetry = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use planner to rewrite coordinate actions through the grounder.',
      workspacePath: coordinateRetryWorkspace,
      selectedToolIds: ['local.vision-sense'],
      uiState: { selectedToolIds: ['local.vision-sense'] },
    });
    assert.equal(coordinateRetryPlannerCalls, 3);
    assert.equal(coordinateRetry.executionUnits[0].status, 'done');
    const coordinateRetryTraceArtifact = coordinateRetry.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
    assert.ok(coordinateRetryTraceArtifact);
    const coordinateRetryTrace = JSON.parse(await readFile(join(coordinateRetryWorkspace, String(coordinateRetryTraceArtifact.path)), 'utf8')) as Record<string, unknown>;
    const dragStep = (coordinateRetryTrace.steps as Array<Record<string, unknown>>).find((step) => step.id === 'step-001-execute-drag');
    assert.ok(dragStep);
    assert.equal(((dragStep.plannedAction as Record<string, unknown>)?.fromX), 10);
    assert.equal(((dragStep.plannedAction as Record<string, unknown>)?.toX), 80);
  } finally {
    await new Promise<void>((resolve) => coordinateRetryPlannerServer.close(() => resolve()));
    await new Promise<void>((resolve) => coordinateRetryGrounderServer.close(() => resolve()));
  }

  const windowTargetWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-window-target-'));
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-window-target-smoke';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '1';
  process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS = '1,2';
  process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([{ type: 'click', targetDescription: 'generic window-local target' }]);
  process.env.SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS = '1';
  const windowGrounderServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/predict/') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      assert.match(String(body.text_prompt), /click coordinates/i);
      assert.match(String(body.text_prompt), /generic window-local target/);
      assert.match(String(body.image_path), /step-001-before-window-/);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ coordinates: [80, 40], image_size: { width: 160, height: 80 } }));
    });
  });
  await new Promise<void>((resolve) => windowGrounderServer.listen(0, '127.0.0.1', resolve));
  try {
    const address = windowGrounderServer.address();
    assert.ok(address && typeof address === 'object');
    process.env.SCIFORGE_VISION_KV_GROUND_URL = `http://127.0.0.1:${address.port}`;
    const windowTarget = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use generic computer use inside the target window only.',
      workspacePath: windowTargetWorkspace,
      selectedToolIds: ['local.vision-sense'],
      uiState: {
        selectedToolIds: ['local.vision-sense'],
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
    const windowTraceArtifact = windowTarget.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
    assert.ok(windowTraceArtifact);
    const windowTrace = JSON.parse(await readFile(join(windowTargetWorkspace, String(windowTraceArtifact.path)), 'utf8')) as Record<string, unknown>;
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
    await new Promise<void>((resolve) => windowGrounderServer.close(() => resolve()));
  }

  const providerFailureWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-window-provider-failure-'));
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

  const isolatedWindowWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-window-isolation-'));
  process.env.SCIFORGE_VISION_RUN_ID = 'generic-cu-window-isolation-smoke';
  process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN = '0';
  process.env.SCIFORGE_VISION_ACTIONS_JSON = JSON.stringify([{ type: 'click', x: 5, y: 5 }]);
  delete process.env.SCIFORGE_VISION_KV_GROUND_URL;
  const isolatedWindow = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Use generic computer use only if the requested target window can be isolated.',
    workspacePath: isolatedWindowWorkspace,
    selectedToolIds: ['local.vision-sense'],
    uiState: {
      selectedToolIds: ['local.vision-sense'],
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
  const isolatedTraceArtifact = isolatedWindow.artifacts.find((artifact) => artifact.id === 'vision-sense-trace');
  assert.ok(isolatedTraceArtifact);
  const isolatedTrace = JSON.parse(await readFile(join(isolatedWindowWorkspace, String(isolatedTraceArtifact.path)), 'utf8')) as Record<string, unknown>;
  assert.equal(((isolatedTrace.config as Record<string, unknown>).windowTarget as Record<string, unknown>)?.status, 'unresolved');
  assert.ok((isolatedTrace.steps as Array<Record<string, unknown>>).some((step) => step.id === 'step-000-blocked-window-target' && step.status === 'blocked'));
  assert.doesNotMatch(JSON.stringify(isolatedTrace), /step-001-execute-click/);

  console.log('[ok] vision-sense runtime uses the generic window-based Computer Use loop without app-specific shortcuts');
} finally {
  restoreEnv('SCIFORGE_VISION_DESKTOP_BRIDGE', previousBridge);
  restoreEnv('SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN', previousDryRun);
  restoreEnv('SCIFORGE_VISION_RUN_ID', previousRunId);
  restoreEnv('SCIFORGE_VISION_CAPTURE_DISPLAYS', previousDisplays);
  restoreEnv('SCIFORGE_VISION_ACTIONS_JSON', previousActions);
  restoreEnv('SCIFORGE_VISION_KV_GROUND_URL', previousGrounderUrl);
  restoreEnv('SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS', previousGrounderAllowLocal);
  restoreEnv('SCIFORGE_VISION_PLANNER_BASE_URL', previousPlannerBaseUrl);
  restoreEnv('SCIFORGE_VISION_PLANNER_API_KEY', previousPlannerApiKey);
  restoreEnv('SCIFORGE_VISION_PLANNER_MODEL', previousPlannerModel);
  restoreEnv('SCIFORGE_VISION_GROUNDER_LLM_BASE_URL', previousVisualGrounderBaseUrl);
  restoreEnv('SCIFORGE_VISION_GROUNDER_LLM_API_KEY', previousVisualGrounderApiKey);
  restoreEnv('SCIFORGE_VISION_GROUNDER_LLM_MODEL', previousVisualGrounderModel);
  restoreEnv('SCIFORGE_VISION_MAX_STEPS', previousMaxSteps);
  restoreEnv('SCIFORGE_VISION_DESKTOP_PLATFORM', previousDesktopPlatform);
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

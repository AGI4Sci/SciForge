import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { AgentCliAdapter, AgentCliStartTurnInput, AgentCliTurn } from '../codex/agent-cli-adapter.js';
import type { NormalizedAgentEvent } from '../codex/codex-event-normalizer.js';
import type { ComputerUseConfig, LoopStep, ScreenshotRef } from '../computer-use/types.js';
import { appendPlannerStep, compactComputerUsePlannerObservation } from './computer-use-plan.js';
import { visionSenseModelRouterCapabilities } from '../../../packages/observe/vision/computer-use-runtime-policy.js';

function baseConfig(): ComputerUseConfig {
  return {
    desktopBridgeEnabled: true,
    dryRun: true,
    captureDisplays: [1],
    desktopPlatform: 'darwin',
    windowTarget: {
      enabled: false,
      required: false,
      mode: 'display',
      coordinateSpace: 'screen',
      inputIsolation: 'best-effort',
    },
    runId: 'text-planner-test',
    maxSteps: 4,
    allowHighRiskActions: false,
    planner: { allowOpenAiRuntime: false, timeoutMs: 1000, maxTokens: 512 },
    grounder: { timeoutMs: 1000, allowServiceLocalPaths: false },
    testActionFixtureMode: false,
    testOnlyPlannedActions: [],
  };
}

function screenshotRef(): ScreenshotRef {
  return {
    id: 'screen-1',
    path: '.sciforge/vision-runs/text-planner-test/step-000-before.png',
    absPath: '/private/tmp/secret-absolute-before.png',
    displayId: 1,
    captureScope: 'display',
    captureProvider: 'test-capture',
    width: 800,
    height: 600,
    sha256: 'abc123',
    bytes: 1234,
  };
}

test('text planner consumes compact observation without DOM/accessibility/private file data', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'click the visible search field',
      actions: [{ type: 'click', targetDescription: 'Search field' }],
    }),
  ]);
  const steps: LoopStep[] = [];
  const result = await appendPlannerStep({
    id: 'step-000-plan',
    task: 'click the search field',
    observation: {
      ref: 'screen-ref',
      summary: 'A local app window is visible.',
      visibleTexts: ['Search', 'Cancel'],
      metadata: {
        query: 'before-action',
        dom: 'DOM_SHOULD_NOT_LEAK',
        accessibilityTree: 'AX_SHOULD_NOT_LEAK',
      },
    },
    screenshotRefs: [screenshotRef()],
    steps,
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0]?.type, 'click');
  assert.equal('x' in result.actions[0]!, false);
  assert.match(adapter.commandTexts[0] ?? '', /Compact observation JSON/);
  assert.match(adapter.commandTexts[0] ?? '', /"visibleTexts": \[/);
  assert.doesNotMatch(adapter.commandTexts[0] ?? '', /DOM_SHOULD_NOT_LEAK|AX_SHOULD_NOT_LEAK|secret-absolute-before/);
  assert.equal(steps[0]?.execution?.planner, visionSenseModelRouterCapabilities.computerUsePlanner);
});

test('text planner receives structured acceptance contract without private GUI sources', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'advance the next required evidence item',
      actions: [{ type: 'scroll', direction: 'down' }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-000-plan',
    task: 'collect refs-first trace evidence',
    observation: { ref: 'screen-ref', summary: 'A file list is visible.', visibleTexts: ['Documents'] },
    plannerAcceptanceContract: {
      schemaVersion: 'sciforge.computer-use.planner-acceptance-contract.v1',
      source: 'gateway-ui-state',
      scenarioId: 'CU-LONG-999',
      expectedTrace: ['scroll action ledger', 'before/after screenshot refs'],
      acceptance: ['at least one non-wait generic action'],
      requirements: ['l3-workflow-refs'],
    },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.match(adapter.commandTexts[0] ?? '', /Planner acceptance contract JSON/);
  assert.match(adapter.commandTexts[0] ?? '', /scroll action ledger/);
  assert.doesNotMatch(adapter.commandTexts[0] ?? '', /DOM_SHOULD_NOT_LEAK|AX_SHOULD_NOT_LEAK|data:image/);
});

test('text planner receives the current runtime provider proxy env instead of falling back to defaults', async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'sciforge-planner-env-'));
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-planner-workspace-'));
  const config = baseConfig();
  config.planner.env = {
    SCIFORGE_RUNTIME_ROOT: runtimeRoot,
    SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
    SCIFORGE_PROXY_BASE_URL: 'http://127.0.0.1:5175/v1',
    SCIFORGE_RUNTIME_MODEL: 'sciforge-router',
    SCIFORGE_CODEX_APP_SERVER_COMMAND: '/bin/false',
  };

  const result = await appendPlannerStep({
    id: 'step-000-plan',
    task: 'inspect the visible pane',
    observation: { ref: 'screen-ref', summary: 'A visible app pane.', visibleTexts: ['Overview'] },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config,
    workspace,
  });

  assert.equal(result.ok, false);
  const runtimeConfig = await readFile(join(runtimeRoot, 'codex-home', 'config.toml'), 'utf8');
  assert.match(runtimeConfig, /base_url = "http:\/\/127\.0\.0\.1:5175\/v1"/);
  assert.doesNotMatch(runtimeConfig, /127\.0\.0\.1:3892/);
});

test('text planner rejects coordinate output instead of passing it to executor', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'bad coordinate action',
      actions: [{ type: 'click', targetDescription: 'Search field', x: 12, y: 24 }],
    }),
    JSON.stringify({
      done: false,
      reason: 'bad coordinate action again',
      actions: [{ type: 'click', targetDescription: 'Search field', x: 13, y: 25 }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-000-plan',
    task: 'click the search field',
    observation: { ref: 'screen-ref', summary: 'Search is visible.', visibleTexts: ['Search'] },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail('coordinate planner output should fail closed');
  assert.match(result.reason, /forbidden field "x"|coordinates/i);
  assert.equal(adapter.commandTexts.length, 2);
});

test('text planner repairs platform-incompatible hotkey output to a generic visible action', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'select everything in the visible file list',
      actions: [{ type: 'hotkey', keys: ['command', 'a'] }],
    }),
    JSON.stringify({
      done: false,
      reason: 'click the visible file list item instead of using an app shortcut',
      actions: [{ type: 'click', targetDescription: 'first visible item in the file list' }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-004-plan',
    task: 'perform the next generic visible GUI action that advances the trace evidence',
    observation: {
      ref: 'screen-ref',
      summary: 'A file list is visible with several selectable items.',
      visibleTexts: ['Documents', 'Downloads'],
      windowTarget: { appName: 'Finder' },
    },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'click');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /platform-level recovery/);
  assert.match(adapter.commandTexts[1] ?? '', /Command\/Ctrl\+A/);
  assert.doesNotMatch(adapter.commandTexts[1] ?? '', /CU-NEXT-04/);
});

test('text planner preserves retry diagnostics when platform hotkey repair still fails', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'select everything in the visible file list',
      actions: [{ type: 'hotkey', keys: ['command', 'a'] }],
    }),
    JSON.stringify({
      done: false,
      reason: 'save with a keyboard shortcut',
      actions: [{ type: 'hotkey', keys: ['command', 's'] }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-004-plan',
    task: 'perform the next generic visible GUI action that advances the trace evidence',
    observation: {
      ref: 'screen-ref',
      summary: 'A file list is visible with several selectable items.',
      visibleTexts: ['Documents', 'Downloads'],
      windowTarget: { appName: 'Finder' },
    },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail('platform-incompatible retry should fail closed');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(result.reason, /Initial failure:/);
  assert.match(result.reason, /Retry failure:/);
  const rawResponse = result.rawResponse as Record<string, unknown>;
  assert.equal(rawResponse.schemaVersion, 'sciforge.computer-use.text-planner-retry-result.v1');
  assert.equal(rawResponse.attemptCount, 2);
  assert.equal(rawResponse.initialContractIssue, 'platform-incompatible-action');
  assert.equal(rawResponse.retryContractIssue, 'platform-incompatible-action');
  assert.ok(rawResponse.initial);
  assert.ok(rawResponse.retry);
  assert.match(JSON.stringify(rawResponse.retry), /command.*s/);
});

test('text planner repairs open_app output to the final appName contract', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'open Safari using the old visual target field',
      actions: [{ type: 'open_app', targetDescription: 'Safari' }],
    }),
    JSON.stringify({
      done: false,
      reason: 'open Safari using the final appName contract',
      actions: [{ type: 'open_app', appName: 'Safari' }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-000-plan',
    task: 'open Safari',
    observation: { ref: 'screen-ref', summary: 'Desktop is visible.', visibleTexts: ['Safari'] },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'open_app');
  if (result.actions[0]?.type === 'open_app') assert.equal(result.actions[0].appName, 'Safari');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /For open_app, use exactly/);
  assert.match(adapter.commandTexts[1] ?? '', /appName/);
  assert.doesNotMatch(JSON.stringify(result.actions[0]), /targetDescription/);
});

test('text planner repairs type_text output that omits required text', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'address bar is focused; type the URL next',
      actions: [{ type: 'type_text', targetDescription: 'Safari address bar' }],
    }),
    JSON.stringify({
      done: false,
      reason: 'type the literal URL into the focused address bar',
      actions: [{ type: 'type_text', text: 'file:///tmp/source-page.html' }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-002-plan',
    task: 'navigate Safari to file:///tmp/source-page.html',
    observation: { ref: 'screen-ref', summary: 'Safari address bar is focused.', visibleTexts: ['Search or enter website name'] },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'type_text');
  if (result.actions[0]?.type === 'type_text') assert.equal(result.actions[0].text, 'file:///tmp/source-page.html');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /For type_text, use exactly/);
  assert.match(adapter.commandTexts[1] ?? '', /literal text to type/);
});

test('text planner repairs visual click output that omits required targetDescription', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'click visible field',
      actions: [{ type: 'click' }],
    }),
    JSON.stringify({
      done: false,
      reason: 'click the visible search field',
      actions: [{ type: 'click', targetDescription: 'Search field' }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-001-plan',
    task: 'click the search field',
    observation: { ref: 'screen-ref', summary: 'Search field is visible.', visibleTexts: ['Search'] },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'click');
  assert.equal(result.actions[0]?.targetDescription, 'Search field');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /For click\/double_click, include targetDescription/);
});

test('text planner repairs multi-action output to the next unexecuted action after text entry', async () => {
  const url = 'file:///tmp/source-page.html';
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'type the URL and press Enter',
      actions: [
        { type: 'type_text', text: url },
        { type: 'press_key', key: 'Enter' },
      ],
    }),
    JSON.stringify({
      done: false,
      reason: 'the URL was already typed, so press Enter only',
      actions: [{ type: 'press_key', key: 'Enter' }],
    }),
  ]);
  const steps: LoopStep[] = [{
    id: 'step-003-execute-type_text',
    kind: 'gui-execution',
    status: 'done',
    plannedAction: { type: 'type_text', text: url },
    verifier: { status: 'checked', reason: 'focused target reacted' },
  } as LoopStep];
  const result = await appendPlannerStep({
    id: 'step-004-plan',
    task: `navigate Safari to ${url}`,
    observation: { ref: 'screen-ref', summary: 'Safari address bar contains the URL.', visibleTexts: [url] },
    screenshotRefs: [screenshotRef()],
    steps,
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'press_key');
  if (result.actions[0]?.type === 'press_key') assert.equal(result.actions[0].key, 'Enter');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[0] ?? '', /type_text text="file:\/\/\/tmp\/source-page\.html"/);
  assert.match(adapter.commandTexts[1] ?? '', /single next action that has not already appeared in Recent actions/);
  assert.match(adapter.commandTexts[1] ?? '', /return only \{"type":"press_key","key":"Enter"\}/);
});

test('text planner retries and blocks repeated app switch cycles', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'switch back to Edge',
      actions: [{ type: 'open_app', appName: 'Microsoft Edge' }],
    }),
    JSON.stringify({
      done: false,
      reason: 'switch back to Edge again',
      actions: [{ type: 'open_app', appName: 'Microsoft Edge' }],
    }),
  ]);
  const steps: LoopStep[] = [
    {
      id: 'step-001-execute-open_app',
      kind: 'gui-execution',
      status: 'done',
      plannedAction: { type: 'open_app', appName: 'Microsoft Edge' },
      execution: { stdout: 'frontmost=Microsoft Edge bundle=com.microsoft.edgemac' },
      verifier: { status: 'checked', reason: 'app opened' },
    },
    {
      id: 'step-002-execute-open_app',
      kind: 'gui-execution',
      status: 'done',
      plannedAction: { type: 'open_app', appName: 'Microsoft PowerPoint' },
      execution: { stdout: 'frontmost=Microsoft PowerPoint bundle=com.microsoft.Powerpoint' },
      verifier: { status: 'checked', reason: 'app opened' },
    },
    {
      id: 'step-003-execute-open_app',
      kind: 'gui-execution',
      status: 'done',
      plannedAction: { type: 'open_app', appName: 'Microsoft Edge' },
      execution: { stdout: 'frontmost=Microsoft Edge bundle=com.microsoft.edgemac' },
      verifier: { status: 'checked', reason: 'app opened' },
    },
    {
      id: 'step-004-execute-open_app',
      kind: 'gui-execution',
      status: 'done',
      plannedAction: { type: 'open_app', appName: 'Microsoft PowerPoint' },
      execution: { stdout: 'frontmost=Microsoft PowerPoint bundle=com.microsoft.Powerpoint' },
      verifier: { status: 'checked', reason: 'app opened' },
    },
  ];
  const result = await appendPlannerStep({
    id: 'step-003-plan',
    task: 'Create one PowerPoint slide from the visible Edge source facts.',
    observation: {
      ref: 'screen-ref',
      summary: 'PowerPoint start screen is visible.',
      visibleTexts: ['Microsoft PowerPoint', '空白演示文稿'],
      windowTarget: { appName: 'Microsoft PowerPoint' },
    },
    screenshotRefs: [screenshotRef()],
    steps,
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail('repeated app switch should fail closed');
  assert.match(result.reason, /repeated an app-switch cycle/i);
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /Do not emit open_app/);
});

test('text planner switches to Enter when chooser confirmation click repeats no-visible-effect', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'click the visible Create button',
      actions: [{ type: 'click', targetDescription: '创建 (Create) button in the template chooser' }],
    }),
    JSON.stringify({
      done: false,
      reason: 'the blank presentation template is selected, so confirm with Enter',
      actions: [{ type: 'press_key', key: 'Enter' }],
    }),
  ]);
  const steps: LoopStep[] = [
    {
      id: 'step-004-execute-click',
      kind: 'gui-execution',
      status: 'done',
      plannedAction: { type: 'click', targetDescription: '创建 (Create) button in the template chooser' },
      verifier: {
        status: 'checked',
        pixelDiff: { possiblyNoEffect: true },
        planningFeedback: 'pixel=no-visible-effect ratios=0.0000 | grounding=provided target="创建 (Create) button in the template chooser"',
      },
    } as LoopStep,
  ];
  const result = await appendPlannerStep({
    id: 'step-005-plan',
    task: 'Create one PowerPoint slide from the visible Edge source facts.',
    observation: {
      ref: 'screen-ref',
      summary: 'PowerPoint template chooser is visible with blank presentation selected.',
      visibleTexts: ['Microsoft PowerPoint', '空白演示文稿', '创建'],
      windowTarget: { appName: 'Microsoft PowerPoint' },
    },
    screenshotRefs: [screenshotRef()],
    steps,
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'press_key');
  if (result.actions[0]?.type === 'press_key') assert.equal(result.actions[0].key, 'Enter');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /document\/template\/gallery chooser/);
  assert.match(adapter.commandTexts[1] ?? '', /\{"type":"press_key","key":"Enter"\}/);
});

test('text planner repairs ambiguous Save icon target that names AutoSave as positive context', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'click the visible Save icon',
      actions: [{
        type: 'click',
        targetDescription: 'Save floppy-disk icon near AutoSave in PowerPoint title bar',
        targetRegionDescription: 'PowerPoint title bar region with AutoSave and Save icon',
      }],
    }),
    JSON.stringify({
      done: false,
      reason: 'click the actual Save icon while avoiding AutoSave',
      actions: [{
        type: 'click',
        targetDescription: 'small floppy-disk Save icon immediately to the right of the Home/house icon',
        targetRegionDescription: 'PowerPoint title bar region from Home/house icon through undo controls, excluding AutoSave toggle',
      }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-014-plan',
    task: 'Save the visible PowerPoint slide artifact using in-window controls.',
    observation: {
      ref: 'screen-ref',
      summary: 'PowerPoint slide editor is visible with the title bar and ribbon; no file dialog is visible.',
      visibleTexts: ['自动保存', '开始', '插入', '绘图', '设计', '切换', '动画'],
      windowTarget: { appName: 'Microsoft PowerPoint', title: '演示文稿 2' },
    },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'click');
  assert.equal(result.actions[0]?.targetDescription, 'small floppy-disk Save icon immediately to the right of the Home/house icon');
  assert.match(result.actions[0]?.targetRegionDescription ?? '', /excluding AutoSave/);
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /nearby non-target control/);
  assert.match(adapter.commandTexts[1] ?? '', /exclude adjacent non-target controls/);
});

test('text planner records protocol drift when recovering fenced JSON', async () => {
  const adapter = new FakePlannerAdapter([
    [
      '```json',
      JSON.stringify({
        done: false,
        reason: 'click visible field',
        actions: [{ type: 'click', targetDescription: 'Search field' }],
      }),
      '```',
    ].join('\n'),
  ]);
  const steps: LoopStep[] = [];
  const result = await appendPlannerStep({
    id: 'step-000-plan',
    task: 'click the search field',
    observation: { ref: 'screen-ref', summary: 'Search is visible.', visibleTexts: ['Search'] },
    screenshotRefs: [screenshotRef()],
    steps,
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'click');
  const rawResponse = steps[0]?.execution?.rawResponse as Record<string, any>;
  assert.equal(rawResponse.protocolDrift.protocolDrift, true);
  assert.equal(rawResponse.protocolDrift.recovery, 'fenced-json');
  assert.equal(rawResponse.protocolDrift.textLooksWrapped, true);
});

test('text planner retries tool-call-like wrapper output instead of executing nested arguments', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      type: 'tool_call',
      name: 'computer_use_plan',
      arguments: {
        done: false,
        reason: 'nested tool call should not execute',
        actions: [{ type: 'click', targetDescription: 'Search field' }],
      },
    }),
    JSON.stringify({
      done: false,
      reason: 'emit a direct top-level planner JSON object',
      actions: [{ type: 'click', targetDescription: 'Search field' }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-000-plan',
    task: 'click the search field',
    observation: { ref: 'screen-ref', summary: 'Search is visible.', visibleTexts: ['Search'] },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'click');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /tool calls, function calls, or nested tool arguments/);
});

test('text planner rejects done before current-round action quota is met', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: true,
      reason: 'the visible task looks done after four actions',
      actions: [],
    }),
    JSON.stringify({
      done: false,
      reason: 'one more low-risk focus action is needed for quota evidence',
      actions: [{ type: 'click', targetDescription: 'blank content area in the visible settings page' }],
    }),
  ]);
  const steps: LoopStep[] = Array.from({ length: 4 }, (_, index) => ({
    id: `step-${String(index + 1).padStart(3, '0')}-execute-click`,
    kind: 'gui-execution',
    status: 'done',
    plannedAction: { type: 'click', targetDescription: `low-risk visible control ${index + 1}` },
    verifier: { status: 'checked', reason: 'visible evidence recorded' },
  } as LoopStep));
  const result = await appendPlannerStep({
    id: 'step-004-plan',
    task: 'collect low-risk visual evidence until the round quota is met',
    observation: { ref: 'screen-ref', summary: 'Settings page is visible.', visibleTexts: ['Settings', 'Search'] },
    plannerAcceptanceContract: {
      schemaVersion: 'sciforge.computer-use.planner-acceptance-contract.v1',
      acceptanceProgress: {
        schemaVersion: 'sciforge.computer-use-long.acceptance-progress.v1',
        suggestedCurrentRoundActionTarget: 5,
        suggestedCurrentRoundNonWaitActionTarget: 5,
      },
    },
    screenshotRefs: [screenshotRef()],
    steps,
    config: { ...baseConfig(), maxSteps: 6 },
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'click');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /current round action quota/);
  assert.match(adapter.commandTexts[1] ?? '', /one additional safe low-risk generic visible GUI action/);
});

test('text planner rejects done before current round has non-wait GUI evidence', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: true,
      reason: 'prior rounds already contain the refs-first summary evidence',
      actions: [],
    }),
    JSON.stringify({
      done: false,
      reason: 'focus the target window once before summarizing refs',
      actions: [{ type: 'click', targetDescription: 'visible target window content area' }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-000-plan',
    task: 'Summarize field evidence refs and action mapping from prior traces.',
    observation: { ref: 'screen-ref', summary: 'Safari target window is visible.', visibleTexts: ['Safari', 'report.md'] },
    plannerAcceptanceContract: {
      schemaVersion: 'sciforge.computer-use.planner-acceptance-contract.v1',
      taskId: 'T084',
      scenarioId: 'CU-LONG-004',
      round: 4,
      roundPrompt: 'Summarize field evidence refs and action mapping.',
      acceptanceProgress: {
        schemaVersion: 'sciforge.computer-use-long.acceptance-progress.v1',
        currentRoundActionQuotaEligible: false,
        remainingActionQuotaRounds: 0,
        observedScenarioActionCount: 20,
        remainingScenarioActionCount: 0,
      },
    },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: { ...baseConfig(), maxSteps: 4 },
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'click');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /before this round produced any non-wait GUI execution evidence/);
  assert.match(adapter.commandTexts[1] ?? '', /refs-first summary\/report rounds/);
});

test('text planner rejects done for report artifact intent before visible artifact evidence exists', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: true,
      reason: 'the evidence summary is conceptually complete',
      actions: [],
    }),
    JSON.stringify({
      done: false,
      reason: 'type the report artifact content into the visible editor',
      actions: [{ type: 'type_text', text: '# Evidence summary\n- screenshot refs\n- action mapping' }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-001-plan',
    task: 'Write an evidence summary report with action mapping and field/control evidence refs.',
    observation: { ref: 'screen-ref', summary: 'Text editor is visible.', visibleTexts: ['Text editor'] },
    screenshotRefs: [screenshotRef()],
    steps: [{
      id: 'step-000-execute-click',
      kind: 'gui-execution',
      status: 'done',
      plannedAction: { type: 'click', targetDescription: 'document body' },
    }],
    config: { ...baseConfig(), maxSteps: 4 },
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'type_text');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /visible final artifact\/report ref/);
  assert.match(adapter.commandTexts[1] ?? '', /field\/control evidence/);
  assert.match(adapter.commandTexts[1] ?? '', /do not type raw JSON, filesystem paths, filenames, or evidence ref strings/i);
});

test('text planner does not treat inline text entry as final artifact intent', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: true,
      reason: 'the comment field now contains the requested summary',
      actions: [],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-001-plan',
    task: 'write a short summary in the comment box',
    observation: { ref: 'screen-ref', summary: 'Comment box contains the summary.', visibleTexts: ['Summary sent to comment box'] },
    screenshotRefs: [screenshotRef()],
    steps: [{
      id: 'step-000-execute-type_text',
      kind: 'gui-execution',
      status: 'done',
      plannedAction: { type: 'type_text', text: 'Short summary' },
    }],
    config: { ...baseConfig(), maxSteps: 3 },
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.done, true);
  assert.equal(adapter.commandTexts.length, 1);
});

test('text planner ignores diagnostic artifact refs when final artifact evidence is required', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: true,
      reason: 'the evidence summary is conceptually complete',
      actions: [],
    }),
    JSON.stringify({
      done: false,
      reason: 'produce the current visible report artifact',
      actions: [{ type: 'type_text', text: '# Evidence summary\n- visible artifact refs' }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-001-plan',
    task: 'Write an evidence summary report with action mapping and field/control evidence refs.',
    observation: {
      ref: 'screen-ref',
      summary: 'Text editor is visible.',
      visibleTexts: ['Text editor'],
      metadata: {
        artifactRefs: ['previous-report.md'],
        payload: { path: 'diagnostics.json' },
        visibleArtifactRefs: ['diagnostics.json'],
      },
    },
    screenshotRefs: [screenshotRef()],
    steps: [{
      id: 'step-000-execute-type_text',
      kind: 'gui-execution',
      status: 'done',
      plannedAction: { type: 'type_text', text: 'draft evidence text' },
    }],
    config: { ...baseConfig(), maxSteps: 4 },
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'type_text');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /visible final artifact\/report ref/);
});

test('text planner accepts current visible saved artifact evidence for report intent', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: true,
      reason: 'the evidence report artifact is visible and saved',
      actions: [],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-002-plan',
    task: 'Write an evidence summary report with action mapping and field/control evidence refs.',
    observation: {
      ref: 'screen-ref',
      summary: 'Report editor shows saved report.md.',
      metadata: {
        visibleArtifacts: [{ artifactRef: 'report.md', status: 'visible-and-saved', kind: 'markdown-report' }],
      },
    },
    screenshotRefs: [screenshotRef()],
    steps: [{
      id: 'step-001-execute-type_text',
      kind: 'gui-execution',
      status: 'done',
      plannedAction: { type: 'type_text', text: '# Evidence summary\n- action mapping' },
    }],
    config: { ...baseConfig(), maxSteps: 4 },
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.done, true);
  assert.equal(adapter.commandTexts.length, 1);
});

test('text planner allows text entry after a later visible context change', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'now type into the newly visible slide title',
      actions: [{ type: 'type_text', text: 'SciForge L3 Computer Use Acceptance' }],
    }),
  ]);
  const steps: LoopStep[] = [
    {
      id: 'step-003-execute-type_text',
      kind: 'gui-execution',
      status: 'done',
      plannedAction: { type: 'type_text', text: 'SciForge L3 Computer Use Acceptance' },
      verifier: { status: 'checked', pixelDiff: { possiblyNoEffect: true } },
    },
    {
      id: 'step-006-execute-press_key',
      kind: 'gui-execution',
      status: 'done',
      plannedAction: { type: 'press_key', key: 'Enter' },
      verifier: { status: 'checked', pixelDiff: { possiblyNoEffect: false } },
    },
  ];
  const result = await appendPlannerStep({
    id: 'step-007-plan',
    task: 'Create one PowerPoint slide with source facts.',
    observation: {
      ref: 'screen-ref',
      summary: 'A new PowerPoint slide editor is visible.',
      visibleTexts: ['单击此处添加标题'],
      windowTarget: { appName: 'Microsoft PowerPoint', title: '演示文稿 2' },
    },
    screenshotRefs: [screenshotRef()],
    steps,
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'type_text');
  assert.equal(adapter.commandTexts.length, 1);
});

test('text planner rejects done when required visible marker is absent from compact observation', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: true,
      reason: 'pixel changed after pressing Enter',
      actions: [],
    }),
    JSON.stringify({
      done: false,
      reason: 'the required page title is not visible yet',
      actions: [{ type: 'wait', ms: 1000 }],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-005-plan',
    task: 'stop when the page title "SciForge L3 Computer Use Source" is visible',
    observation: {
      ref: 'screen-ref',
      summary: 'Safari start page is still visible.',
      visibleTexts: ['个人收藏'],
      windowTarget: { title: '起始页' },
    },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actions[0]?.type, 'wait');
  assert.equal(adapter.commandTexts.length, 2);
  assert.match(adapter.commandTexts[1] ?? '', /done=true without compact-observation evidence/);
});

test('text planner only extracts visible completion markers from the stop clause', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: true,
      reason: 'the browser is open',
      actions: [],
    }),
    JSON.stringify({
      done: true,
      reason: 'the browser is still open',
      actions: [],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-005-plan',
    task: 'Open Microsoft Edge with appName "Microsoft Edge" and navigate to the source page; stop only when page title "SciForge L3 Computer Use Source" is visible',
    observation: {
      ref: 'screen-ref',
      summary: 'Microsoft Edge is visible, but the new tab page is still loaded.',
      visibleTexts: ['Microsoft Edge', 'New tab'],
      windowTarget: { title: 'New tab' },
    },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail('done should fail until the stop-clause title is visible');
  assert.match(result.reason, /SciForge L3 Computer Use Source/);
  assert.doesNotMatch(result.reason, /Microsoft Edge/);
  assert.equal(adapter.commandTexts.length, 2);
});

test('text planner accepts done when required visible marker is present in window title', async () => {
  const adapter = new FakePlannerAdapter([
    JSON.stringify({
      done: true,
      reason: 'the requested source page title is visible',
      actions: [],
    }),
  ]);
  const result = await appendPlannerStep({
    id: 'step-005-plan',
    task: 'stop when the page title "SciForge L3 Computer Use Source" is visible',
    observation: {
      ref: 'screen-ref',
      summary: 'Source page loaded.',
      visibleTexts: [],
      windowTarget: { title: 'SciForge L3 Computer Use Source' },
    },
    screenshotRefs: [screenshotRef()],
    steps: [],
    config: baseConfig(),
    workspace: '/tmp',
    codexPlannerAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.done, true);
  assert.equal(result.actions.length, 0);
  assert.equal(adapter.commandTexts.length, 1);
});

test('text planner timeout fails closed instead of using a direct chat fallback', async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (url, init) => {
    fetchCalls.push({
      url: String(url),
      body: init?.body,
    });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    const config = baseConfig();
    config.planner.timeoutMs = -9_995;
    const steps: LoopStep[] = [];

    const result = await appendPlannerStep({
      id: 'step-000-plan',
      task: 'focus the visible file list',
      observation: { ref: 'screen-ref', summary: 'A Finder file list is visible.', visibleTexts: ['Downloads'] },
      screenshotRefs: [screenshotRef()],
      steps,
      config,
      workspace: '/tmp',
      codexPlannerAdapter: new HangingPlannerAdapter(),
    });

    assert.equal(result.ok, false);
    if (result.ok) assert.fail('planner timeout should fail closed without direct chat fallback');
    assert.match(result.reason, /Model Router provider\/capability path|Direct OpenAI-compatible chat fallback is disabled/);
    assert.equal(fetchCalls.length, 0);
    assert.equal(steps[0]?.execution?.planner, visionSenseModelRouterCapabilities.computerUsePlanner);
    assert.match(JSON.stringify(steps[0]?.execution?.rawResponse), /model-router-planner-required/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('compact planner observation keeps refs and visible text but not raw private observation metadata', () => {
  const compact = compactComputerUsePlannerObservation({
    ref: 'screen-ref',
    summary: 'Window visible.',
    visibleTexts: ['Alpha', 'Beta'],
    metadata: {
      query: 'before-action',
      html: '<button>Alpha</button>',
      selector: '#alpha',
    },
  }, [screenshotRef()], baseConfig());
  const serialized = JSON.stringify(compact);

  assert.match(serialized, /Alpha/);
  assert.match(serialized, /step-000-before\.png/);
  assert.doesNotMatch(serialized, /<button>|#alpha|secret-absolute-before/);
});

class FakePlannerAdapter implements AgentCliAdapter {
  readonly commandTexts: string[] = [];
  private index = 0;

  constructor(private readonly outputs: string[]) {}

  async startTurn(input: AgentCliStartTurnInput): Promise<AgentCliTurn> {
    this.commandTexts.push(input.commandText);
    const text = this.outputs[Math.min(this.index, this.outputs.length - 1)] ?? '';
    this.index += 1;
    const turnId = input.commandId ?? `turn-${this.index}`;
    const attemptId = input.attemptId ?? `attempt-${this.index}`;
    return {
      turnId,
      attemptId,
      events: eventsForText(text, input.workspacePath, turnId, attemptId),
    };
  }

  async cancel(): Promise<void> {}
}

class HangingPlannerAdapter implements AgentCliAdapter {
  async startTurn(input: AgentCliStartTurnInput): Promise<AgentCliTurn> {
    return {
      turnId: input.commandId ?? 'hanging-turn',
      attemptId: input.attemptId ?? 'hanging-attempt',
      events: hangingEvents(input),
    };
  }

  async cancel(): Promise<void> {}
}

async function* hangingEvents(input: AgentCliStartTurnInput): AsyncIterable<NormalizedAgentEvent> {
  yield event('run_started', {
    message: 'Runtime Codex started.',
    workspace: input.workspacePath,
    commandId: input.commandId ?? 'hanging-turn',
    attemptId: input.attemptId ?? 'hanging-attempt',
  });
  await new Promise<void>((resolve) => {
    if (input.abortSignal?.aborted) {
      resolve();
      return;
    }
    input.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
    setTimeout(resolve, 250);
  });
}

async function* eventsForText(
  text: string,
  workspace: string,
  commandId: string,
  attemptId: string,
): AsyncIterable<NormalizedAgentEvent> {
  yield event('message', { text, message: text, workspace, commandId, attemptId });
  yield event('done', { message: 'done', workspace, commandId, attemptId, exitCode: 0, signal: null });
}

function event(
  type: NormalizedAgentEvent['type'],
  extra: Partial<NormalizedAgentEvent>,
): NormalizedAgentEvent {
  return {
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type,
    timestamp: '2026-05-25T00:00:00.000Z',
    provider: 'test',
    model: 'test',
    profile: 'test',
    workspace: extra.workspace ?? '/tmp',
    commandId: extra.commandId ?? 'cmd',
    attemptId: extra.attemptId ?? 'attempt',
    evidenceRefs: [],
    ...extra,
  };
}

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { AgentCliAdapter, AgentCliStartTurnInput, AgentCliTurn } from '../codex/agent-cli-adapter.js';
import type { NormalizedAgentEvent } from '../codex/codex-event-normalizer.js';
import type { WorkspaceRuntimeEvent } from '../runtime-types.js';
import { SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER } from './independent-input-adapter.js';
import { runComputerUsePackageBridge } from './package-bridge.js';
import type { ComputerUseConfig } from './types.js';

function baseConfig(runId: string, actions: ComputerUseConfig['testOnlyPlannedActions']): ComputerUseConfig {
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
    runId,
    maxSteps: 4,
    allowHighRiskActions: false,
    planner: { allowOpenAiRuntime: false, timeoutMs: 120000, maxTokens: 512 },
    grounder: {
      timeoutMs: 30000,
      allowServiceLocalPaths: false,
      upload: { strategy: 'inline' },
    },
    testActionFixtureMode: true,
    testOnlyPlannedActions: actions,
  };
}

test('package bridge calls Python run_task through stdio host ports and writes refs-first trace', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-bridge-'));
  const events: WorkspaceRuntimeEvent[] = [];
  try {
    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run type low risk local smoke text',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, baseConfig('cu-package-bridge-ok', [
      { type: 'type_text', text: 'SciForge package bridge smoke' },
    ]), {
      onEvent: (event) => events.push(event),
    });

    assert.equal(payload.executionUnits[0]?.status, 'done');
    assert.equal(payload.executionUnits[0]?.tool, 'local.vision-sense');
    const tracePath = join(workspace, '.sciforge/vision-runs/cu-package-bridge-ok/vision-trace.json');
    assert.equal((await stat(tracePath)).isFile(), true);
    const trace = JSON.parse(await readFile(tracePath, 'utf8')) as Record<string, unknown>;
    assert.equal(trace.schemaVersion, 'sciforge.vision-trace.v1');
    assert.equal((trace.packageBridge as Record<string, unknown>).schemaVersion, 'sciforge.computer-use.package-bridge-trace.v1');
    assert.equal((trace.packageResult as Record<string, unknown>).status, 'completed');
    assert.doesNotMatch(JSON.stringify(trace), /data:image\/|;base64,|fallbackActions|computer-use-action-loop/);
    assert.ok(payload.objectReferences?.some((ref) => ref.id === 'ref:computer-use-tui-host-actions'));
    assert.ok(events.some((event) => event.type === 'computer-use.tui-host-actions'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge fails closed without legacy fallbackActions when no planner action is available', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-no-fallback-'));
  try {
    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run complete a desktop task only if the planner returns a generic action',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, baseConfig('cu-package-bridge-no-fallback-actions', []), {});

    assert.equal(payload.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(String(payload.executionUnits[0]?.failureReason || payload.message), /test-only fixture action queue is exhausted/i);
    const tracePath = join(workspace, '.sciforge/vision-runs/cu-package-bridge-no-fallback-actions/vision-trace.json');
    const traceText = await readFile(tracePath, 'utf8');
    assert.doesNotMatch(traceText, /fallbackActions|computer-use-action-loop|runComputerUseActionLoop/);
    const trace = JSON.parse(traceText) as Record<string, unknown>;
    assert.equal((trace.packageResult as Record<string, unknown>).status, 'failed-with-reason');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge blocks file path text entry in editor windows', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-path-entry-'));
  try {
    const config = baseConfig('cu-package-bridge-path-entry-blocked', [
      { type: 'type_text', text: '/tmp/sciforge/acceptance-slide.pptx' },
    ]);
    config.windowTarget = {
      enabled: true,
      required: false,
      mode: 'app-window',
      appName: 'Microsoft PowerPoint',
      title: '演示文稿2',
      coordinateSpace: 'window-local',
      inputIsolation: 'best-effort',
    };

    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run save the PowerPoint artifact only after opening the visible Save As dialog',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, config, {});

    assert.equal(payload.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(String(payload.executionUnits[0]?.failureReason || payload.message), /does not look like a save\/open\/file dialog/);
    const trace = JSON.parse(await readFile(join(workspace, '.sciforge/vision-runs/cu-package-bridge-path-entry-blocked/vision-trace.json'), 'utf8')) as Record<string, unknown>;
    assert.match(JSON.stringify(trace.packageResult), /document or slide editor canvases/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge blocks file/save click targets that are absent from the current observation', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-target-evidence-'));
  try {
    const config = baseConfig('cu-package-bridge-target-evidence-blocked', [
      {
        type: 'click',
        targetDescription: 'the Browse button in the visible Save As file dialog',
        x: 10,
        y: 10,
      },
    ]);
    config.visibleTextExtraction = { enabled: true, maxItems: 20 };
    config.windowTarget = {
      enabled: true,
      required: false,
      mode: 'app-window',
      appName: 'Microsoft PowerPoint',
      title: '演示文稿2',
      coordinateSpace: 'window-local',
      inputIsolation: 'best-effort',
    };

    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run save the PowerPoint artifact using only visible save dialog controls',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, config, {});

    assert.equal(payload.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(String(payload.executionUnits[0]?.failureReason || payload.message), /current compact observation does not show that target/);
    const trace = JSON.parse(await readFile(join(workspace, '.sciforge/vision-runs/cu-package-bridge-target-evidence-blocked/vision-trace.json'), 'utf8')) as Record<string, unknown>;
    assert.match(JSON.stringify(trace.packageResult), /Do not infer File, Save As, Browse/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge routes registered remote-desktop adapter through independent virtual input state', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-independent-input-'));
  try {
    const config = baseConfig('cu-package-bridge-independent-input', [
      { type: 'type_text', text: 'SciForge independent input smoke' },
    ]);
    config.dryRun = false;
    config.inputAdapter = 'remote-desktop';
    config.independentInputAdapterProvider = SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER;
    config.allowSharedSystemInput = false;
    config.completionPolicy = { mode: 'one-successful-non-wait-action' };

    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run type low risk text using independent input adapter',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, config, {});

    assert.equal(payload.executionUnits[0]?.status, 'done');
    const runDir = join(workspace, '.sciforge/vision-runs/cu-package-bridge-independent-input');
    const adapterState = JSON.parse(await readFile(join(runDir, 'independent-input-adapter.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(adapterState.pointerKeyboardOwnership, 'sciforge-independent-input-adapter');
    assert.equal(adapterState.userDeviceImpact, 'none');
    assert.equal(adapterState.systemMouseEvents, 'not-sent');
    assert.equal(adapterState.systemKeyboardEvents, 'not-sent');
    const traceText = await readFile(join(runDir, 'vision-trace.json'), 'utf8');
    const trace = JSON.parse(traceText) as Record<string, unknown>;
    assert.equal(trace.executionBoundary, `${SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER}-input-adapter`);
    assert.match(traceText, /independent-input-adapter\.json/);
    assert.match(traceText, /sciforge-independent-input-adapter/);
    assert.doesNotMatch(traceText, /macos-cgevent-system-events|swift-cgevent|System Events executor|shared-system-pointer-keyboard/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge projects independent virtual remote session artifacts into payload and trace', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-independent-session-'));
  try {
    const config = baseConfig('cu-package-bridge-independent-session', [
      { type: 'open_app', appName: 'Browser' },
      { type: 'click', targetDescription: 'visible source facts card', x: 140, y: 120 },
      { type: 'type_text', text: 'Source fact: independent adapter uses a virtual pointer and keyboard.' },
      { type: 'open_app', appName: 'PowerPoint' },
      { type: 'type_text', text: 'SciForge Computer Use L3\n- Browser source reviewed\n- Slide content created\n- Finder shows saved artifact' },
      { type: 'open_app', appName: 'Finder' },
      { type: 'click', targetDescription: 'virtual-slide-deck.md saved artifact', x: 180, y: 160 },
    ]);
    config.maxSteps = 8;
    config.dryRun = false;
    config.inputAdapter = 'remote-desktop';
    config.independentInputAdapterProvider = SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER;
    config.allowSharedSystemInput = false;

    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run create a slide deck with three facts from a browser source and save it in Finder',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, config, {});

    assert.equal(payload.executionUnits[0]?.status, 'done');
    assert.ok(payload.artifacts.some((artifact) => artifact.path === '.sciforge/vision-runs/cu-package-bridge-independent-session/virtual-slide-deck.md'));
    const outputArtifacts = Array.isArray(payload.executionUnits[0]?.outputArtifacts)
      ? payload.executionUnits[0]?.outputArtifacts
      : [];
    assert.ok(outputArtifacts.includes('.sciforge/vision-runs/cu-package-bridge-independent-session/virtual-slide-deck.md'));
    const hostActionsRef = payload.objectReferences?.find((ref) => ref.id === 'ref:computer-use-tui-host-actions');
    assert.ok(hostActionsRef);
    assert.match(JSON.stringify(hostActionsRef.data), /virtual-slide-deck\.md/);

    const runDir = join(workspace, '.sciforge/vision-runs/cu-package-bridge-independent-session');
    const traceText = await readFile(join(runDir, 'vision-trace.json'), 'utf8');
    const trace = JSON.parse(traceText) as Record<string, any>;
    assert.equal((trace.virtualRemoteSession as Record<string, unknown>).sessionRef, '.sciforge/vision-runs/cu-package-bridge-independent-session/virtual-remote-session.json');
    assert.match(traceText, /virtual-slide-deck\.md/);
    assert.match(traceText, /capture\.virtual-remote-session\.rendered/);
    assert.doesNotMatch(traceText, /macos-cgevent-system-events|swift-cgevent|System Events executor|shared-system-pointer-keyboard/);
    const session = JSON.parse(await readFile(join(runDir, 'virtual-remote-session.json'), 'utf8')) as Record<string, any>;
    assert.equal(session.visibleArtifacts[0]?.status, 'visible-and-saved');
    assert.ok((trace.steps as Array<Record<string, unknown>>).some((step) => JSON.stringify(step).includes('-focus-')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge defaults to Runtime Codex text planner when no test fixture actions are enabled', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-codex-planner-'));
  const planner = new FakePlannerAdapter([
    JSON.stringify({
      done: false,
      reason: 'type visible smoke text',
      actions: [{ type: 'type_text', text: 'SciForge Codex text planner smoke' }],
    }),
    JSON.stringify({
      done: true,
      reason: 'smoke text was typed',
      actions: [],
    }),
  ]);
  try {
    const config = baseConfig('cu-package-bridge-codex-planner', []);
    config.testActionFixtureMode = false;
    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run type low risk local smoke text using the default planner',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, config, {}, {
      codexPlannerAdapter: planner,
    });

    assert.equal(payload.executionUnits[0]?.status, 'done');
    assert.ok(planner.commandTexts.length >= 1);
    assert.match(planner.commandTexts[0] ?? '', /Compact observation JSON/);
    assert.doesNotMatch(planner.commandTexts[0] ?? '', /image_url|data:image|accessibilityTree|DOMSnapshot/);
    const traceText = await readFile(join(workspace, '.sciforge/vision-runs/cu-package-bridge-codex-planner/vision-trace.json'), 'utf8');
    assert.match(traceText, /runtime-codex-tui-text-planner/);
    assert.doesNotMatch(traceText, /openai-compatible-vision-planner|fallbackActions|computer-use-action-loop/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge preserves approvalRequest as gui.ask_user host action metadata', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-approval-'));
  try {
    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run click Submit payment button without approval',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, baseConfig('cu-package-bridge-approval', [
      {
        type: 'click',
        targetDescription: 'Submit payment button',
        riskLevel: 'high',
        requiresConfirmation: true,
      },
    ]), {});

    assert.equal(payload.executionUnits[0]?.status, 'failed-with-reason');
    const hostActionsRef = payload.objectReferences?.find((ref) => ref.id === 'ref:computer-use-tui-host-actions');
    assert.ok(hostActionsRef);
    const actions = ((hostActionsRef.data as Record<string, unknown>).actions as Array<Record<string, unknown>>);
    assert.ok(actions.some((action) => action.port === 'gui.present'));
    assert.ok(actions.some((action) => action.port === 'gui.ask_user'));
    const trace = JSON.parse(await readFile(join(workspace, '.sciforge/vision-runs/cu-package-bridge-approval/vision-trace.json'), 'utf8')) as Record<string, unknown>;
    const packageResult = trace.packageResult as Record<string, unknown>;
    const packageSteps = packageResult.steps as Array<Record<string, unknown>>;
    const projectedSteps = trace.steps as Array<Record<string, unknown>>;
    assert.equal(packageResult.status, 'needs-confirmation');
    assert.ok(packageResult.approvalRequest);
    assert.equal(packageSteps[0]?.status, 'blocked');
    assert.equal(packageSteps[0]?.execution, null);
    assert.equal(packageSteps[0]?.afterRef, null);
    assert.equal(projectedSteps[0]?.status, 'blocked');
    assert.equal(projectedSteps[0]?.execution, undefined);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge confirmed retry carries approvalRef and executes guarded dry-run action', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-confirmed-'));
  try {
    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use approve --approval-ref "approval:computer-use:cu-confirmed"',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
      humanApproval: { approvalRef: 'approval:computer-use:cu-confirmed' },
    }, workspace, baseConfig('cu-package-bridge-confirmed', [
      {
        type: 'type_text',
        text: 'CONFIRMED_HIGH_RISK_TEXT',
        riskLevel: 'high',
        requiresConfirmation: true,
        confirmationText: 'Allow Computer Use to type the confirmed guarded text?',
      },
    ]), {});

    assert.equal(payload.executionUnits[0]?.status, 'done');
    const trace = JSON.parse(await readFile(join(workspace, '.sciforge/vision-runs/cu-package-bridge-confirmed/vision-trace.json'), 'utf8')) as Record<string, unknown>;
    const traceRequest = trace.request as Record<string, unknown>;
    const computerUseRequest = traceRequest.computerUseRequest as Record<string, unknown>;
    const packageResult = trace.packageResult as Record<string, unknown>;
    const packageSteps = packageResult.steps as Array<Record<string, unknown>>;
    assert.equal(computerUseRequest.riskPolicy, 'allow-confirmed');
    assert.equal(computerUseRequest.approvalRef, 'approval:computer-use:cu-confirmed');
    assert.equal(packageResult.status, 'completed');
    assert.equal(packageResult.approvalRequest, null);
    assert.equal(packageSteps[0]?.status, 'done');
    assert.ok(packageSteps[0]?.execution);
    assert.match(JSON.stringify(packageSteps[0]?.execution), /dry-run package bridge/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
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

async function* eventsForText(
  text: string,
  workspace: string,
  commandId: string,
  attemptId: string,
): AsyncIterable<NormalizedAgentEvent> {
  const base = {
    schemaVersion: 'sciforge.codex.normalized-event.v1' as const,
    timestamp: '2026-05-25T00:00:00.000Z',
    provider: 'test',
    model: 'test',
    profile: 'test',
    workspace,
    commandId,
    attemptId,
    evidenceRefs: [],
  };
  yield { ...base, type: 'message', text, message: text };
  yield { ...base, type: 'done', message: 'done', exitCode: 0, signal: null };
}

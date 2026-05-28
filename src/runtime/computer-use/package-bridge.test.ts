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

async function readJsonEvidence(path: string): Promise<Record<string, any>> {
  assert.equal((await stat(path)).isFile(), true);
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function assertPackageBridgeEvidenceFiles(runDir: string, options: { expectApproval?: boolean } = {}) {
  const request = await readJsonEvidence(join(runDir, 'computer-use-request.json'));
  const hostPorts = await readJsonEvidence(join(runDir, 'host-ports.json'));
  const payload = await readJsonEvidence(join(runDir, 'tool-payload.json'));
  const guiPresent = await readJsonEvidence(join(runDir, 'gui-present.json'));
  const tuiHostChain = await readJsonEvidence(join(runDir, 'tui-host-run-task-chain.json'));
  const directoryListing = await readJsonEvidence(join(runDir, 'directory-listing.json'));

  assert.equal(request.schemaVersion, 'sciforge.computer-use.request.v1');
  assert.equal(hostPorts.schemaVersion, 'sciforge.computer-use.host-ports.v1');
  assert.ok(hostPorts.ports.capture);
  assert.equal(directoryListing.schemaVersion, 'sciforge.computer-use.evidence-directory-listing.v1');
  assert.ok(directoryListing.fileRefs.some((ref: string) => ref.endsWith('/vision-trace.json')));
  assert.ok(directoryListing.fileRefs.some((ref: string) => ref.endsWith('/tui-host-run-task-chain.json')));
  assert.match(JSON.stringify(payload), /vision-trace\.json/);
  assert.match(JSON.stringify(payload), /workEvidence:computer-use-action-provider/);
  assert.equal(guiPresent.port, 'gui.present');
  assert.ok(guiPresent.payload.traceRefs.some((ref: string) => ref.endsWith('/vision-trace.json')));
  assert.ok(guiPresent.payload.artifactRefs.some((ref: string) => ref.endsWith('/vision-trace.json')));
  assert.equal(tuiHostChain.schemaVersion, 'sciforge.computer-use.tui-host-run-task-chain.v1');
  assert.equal(tuiHostChain.actionProvider, 'action.sciforge.computer-use');
  assert.equal(tuiHostChain.boundary.packageMayCallGuiDirectly, false);
  assert.match(JSON.stringify(tuiHostChain), /computer-use-request\.json/);
  assert.match(JSON.stringify(tuiHostChain), /host-ports\.json/);
  assert.match(JSON.stringify(tuiHostChain), /tool-payload\.json/);
  assert.match(JSON.stringify(tuiHostChain), /vision-trace\.json/);
  assert.match(JSON.stringify(tuiHostChain), /directory-listing\.json/);
  assert.ok(tuiHostChain.links.some((link: Record<string, unknown>) => link.kind === 'tui-host-runTask' && link.status === 'present'));
  assert.ok(tuiHostChain.links.some((link: Record<string, unknown>) => link.kind === 'gui.present' && link.status === 'present'));
  assert.ok(tuiHostChain.links.some((link: Record<string, unknown>) => link.kind === 'directory-listing' && link.status === 'present'));
  assert.doesNotMatch(JSON.stringify(tuiHostChain), /data:image\/|;base64,/);

  if (options.expectApproval) {
    const guiAskUser = await readJsonEvidence(join(runDir, 'gui-ask-user.json'));
    const approvalRequest = await readJsonEvidence(join(runDir, 'approval-request.json'));
    const riskAudit = await readJsonEvidence(join(runDir, 'risk-audit.json'));
    const blockedManifest = await readJsonEvidence(join(runDir, 'blocked-manifest.json'));
    const repairHint = await readJsonEvidence(join(runDir, 'repair-hint.json'));
    const continuationRequest = await readJsonEvidence(join(runDir, 'continuation-request.json'));
    assert.equal(guiAskUser.port, 'gui.ask_user');
    assert.equal(guiAskUser.status, 'needs-confirmation');
    assert.ok(guiAskUser.payload.approvalRequest);
    assert.equal(guiAskUser.deniedExecuted, false);
    assert.equal(guiAskUser.packageMayCallGuiDirectly, false);
    assert.match(JSON.stringify(guiAskUser.payload.approvalRequest), /approval/i);
    assert.ok(guiAskUser.payload.relatedRefs.some((ref: string) => ref.endsWith('/vision-trace.json')));
    assert.equal(approvalRequest.schemaVersion, 'sciforge.computer-use.approval-request-sidecar.v1');
    assert.equal(approvalRequest.status, 'needs-confirmation');
    assert.equal(approvalRequest.approvalRequestId, guiAskUser.approvalRequestId);
    assert.equal(approvalRequest.riskActionHash, guiAskUser.riskActionHash);
    assert.equal(approvalRequest.approvalRef, guiAskUser.approvalRef);
    assert.equal(approvalRequest.deniedExecuted, false);
    assert.equal(riskAudit.schemaVersion, 'sciforge.computer-use.risk-audit-sidecar.v1');
    assert.equal(riskAudit.approvalRequestId, approvalRequest.approvalRequestId);
    assert.equal(riskAudit.riskActionHash, approvalRequest.riskActionHash);
    assert.equal(riskAudit.approvalRef, approvalRequest.approvalRef);
    assert.equal(riskAudit.deniedExecuted, false);
    assert.equal(blockedManifest.schemaVersion, 'sciforge.computer-use.blocked-manifest-sidecar.v1');
    assert.match(String(blockedManifest.approvalRequestRef), /approval-request\.json$/);
    assert.equal(repairHint.blockedManifestRef, blockedManifest.traceRef.replace(/vision-trace\.json$/, 'blocked-manifest.json'));
    assert.match(String(continuationRequest.repairHintRef), /repair-hint\.json$/);
    assert.ok(tuiHostChain.links.some((link: Record<string, unknown>) => link.kind === 'gui.ask_user' && link.status === 'present'));
    assert.ok(tuiHostChain.links.some((link: Record<string, unknown>) => link.kind === 'approval-request' && link.status === 'present'));
    assert.ok(tuiHostChain.links.some((link: Record<string, unknown>) => link.kind === 'repair-continuity' && link.status === 'present'));
  }
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
    assert.equal(
      (trace.packageBridge as Record<string, unknown>).tuiHostRunTaskChainRef,
      '.sciforge/vision-runs/cu-package-bridge-ok/tui-host-run-task-chain.json',
    );
    assert.equal((trace.packageResult as Record<string, unknown>).status, 'completed');
    assert.doesNotMatch(JSON.stringify(trace), /data:image\/|;base64,|fallbackActions|computer-use-action-loop/);
    assert.ok(payload.objectReferences?.some((ref) => ref.id === 'ref:computer-use-tui-host-actions'));
    assert.ok(events.some((event) => event.type === 'computer-use.tui-host-actions'));
    await assertPackageBridgeEvidenceFiles(join(workspace, '.sciforge/vision-runs/cu-package-bridge-ok'));
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
    const guiStep = (trace.steps as Array<Record<string, any>>).find((step) => step.kind === 'gui-execution');
    assert.equal(guiStep?.scheduler?.executorLease?.mode, 'real-gui-executor-lock');
    assert.equal(guiStep?.scheduler?.executorLease?.status, undefined);
    assert.equal(typeof guiStep?.scheduler?.executorLease?.lockId, 'string');
    assert.equal(typeof guiStep?.scheduler?.executorLease?.acquiredAt, 'string');
    assert.equal(typeof guiStep?.scheduler?.executorLease?.releasedAt, 'string');
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
    const traceArtifact = payload.artifacts.find((artifact) => artifact.path === '.sciforge/vision-runs/cu-package-bridge-independent-session/vision-trace.json');
    const traceArtifactMetadata = traceArtifact?.metadata as Record<string, unknown> | undefined;
    assert.equal(traceArtifactMetadata?.finalArtifactRef, '.sciforge/vision-runs/cu-package-bridge-independent-session/virtual-slide-deck.md');
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

test('package bridge keeps report artifact intent open until a visible final artifact is produced', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-report-artifact-'));
  const planner = new FakePlannerAdapter([
    JSON.stringify({
      done: true,
      reason: 'the report summary is complete from prior trace refs',
      actions: [],
    }),
    JSON.stringify({
      done: false,
      reason: 'write the report artifact content',
      actions: [{ type: 'type_text', text: '# Evidence summary\n- screenshot refs\n- action mapping\n- field/control evidence' }],
    }),
    JSON.stringify({
      done: true,
      reason: 'visible report artifact exists',
      actions: [],
    }),
  ]);
  try {
    const config = baseConfig('cu-package-bridge-report-artifact', []);
    config.testActionFixtureMode = false;
    config.dryRun = false;
    config.maxSteps = 5;
    config.inputAdapter = 'remote-desktop';
    config.independentInputAdapterProvider = SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER;
    config.allowSharedSystemInput = false;

    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run write an evidence summary report with action mapping and field/control visual evidence refs',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, config, {}, {
      codexPlannerAdapter: planner,
    });

    assert.equal(payload.executionUnits[0]?.status, 'done');
    const outputArtifacts = Array.isArray(payload.executionUnits[0]?.outputArtifacts)
      ? payload.executionUnits[0]?.outputArtifacts
      : [];
    assert.ok(outputArtifacts.includes('.sciforge/vision-runs/cu-package-bridge-report-artifact/report.md'));
    assert.ok(planner.commandTexts.some((command) => /visible final artifact\/report ref/.test(command)));

    const runDir = join(workspace, '.sciforge/vision-runs/cu-package-bridge-report-artifact');
    const trace = JSON.parse(await readFile(join(runDir, 'vision-trace.json'), 'utf8')) as Record<string, any>;
    assert.equal(trace.finalArtifactRef, '.sciforge/vision-runs/cu-package-bridge-report-artifact/report.md');
    assert.equal(trace.packageResult.status, 'completed');
    assert.ok(JSON.stringify(trace.steps).includes('# Evidence summary'));
    const guiPresent = JSON.parse(await readFile(join(runDir, 'gui-present.json'), 'utf8')) as Record<string, any>;
    assert.ok(guiPresent.payload.artifactRefs.includes('.sciforge/vision-runs/cu-package-bridge-report-artifact/report.md'));
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
	      uiState: {
	        computerUseLong: {
	          taskId: 'T084',
	          scenarioId: 'CU-LONG-999',
	          cuNextTaskId: 'CU-NEXT-99',
	          round: 1,
	          expectedTrace: ['Runtime Codex planner command receives acceptance contract'],
	          acceptance: ['one generic action then done'],
	          requiredEvidence: ['vision-trace.json'],
	        },
	      },
	      artifacts: [],
	    }, workspace, config, {}, {
	      codexPlannerAdapter: planner,
	    });

    assert.equal(payload.executionUnits[0]?.status, 'done');
	    assert.ok(planner.commandTexts.length >= 1);
	    assert.match(planner.commandTexts[0] ?? '', /Compact observation JSON/);
	    assert.match(planner.commandTexts[0] ?? '', /Planner acceptance contract JSON/);
	    assert.match(planner.commandTexts[0] ?? '', /Runtime Codex planner command receives acceptance contract/);
	    assert.doesNotMatch(planner.commandTexts[0] ?? '', /image_url|data:image|accessibilityTree|DOMSnapshot/);
    const traceText = await readFile(join(workspace, '.sciforge/vision-runs/cu-package-bridge-codex-planner/vision-trace.json'), 'utf8');
    assert.match(traceText, /runtime-codex-tui-text-planner/);
    assert.doesNotMatch(traceText, /openai-compatible-vision-planner|fallbackActions|computer-use-action-loop/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge action-ledger completion waits for current-round quota', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-ledger-quota-'));
  try {
    const config = baseConfig('cu-package-bridge-ledger-quota', [
      { type: 'click', targetDescription: 'visible search field for low-risk validation test', x: 120, y: 80 },
      { type: 'type_text', text: 'nonexistent validation query' },
      { type: 'click', targetDescription: 'visible empty result or no-result message area', x: 160, y: 110 },
      { type: 'click', targetDescription: 'clear search field control', x: 190, y: 90 },
      { type: 'click', targetDescription: 'visible safe search field after clearing', x: 120, y: 80 },
    ]);
    config.maxSteps = 5;
    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run create a low-risk validation/no-result state in a visible search field, observe it, then clear or correct the field; do not submit, save, send, delete, or authorize anything',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      uiState: {
        computerUseLong: {
          taskId: 'T084',
          scenarioId: 'CU-LONG-004',
          cuNextTaskId: 'CU-NEXT-07',
          round: 3,
          acceptance: ['at least 20 generic actions'],
          acceptanceProgress: {
            schemaVersion: 'sciforge.computer-use-long.acceptance-progress.v1',
            round: 3,
            roundCount: 4,
            remainingRounds: 2,
            minimumScenarioActionCount: 20,
            observedScenarioActionCount: 15,
            remainingScenarioActionCount: 5,
            suggestedCurrentRoundActionTarget: 5,
          },
        },
      },
      artifacts: [],
    }, workspace, config, {});

    assert.equal(payload.executionUnits[0]?.status, 'done');
    const trace = JSON.parse(await readFile(join(workspace, '.sciforge/vision-runs/cu-package-bridge-ledger-quota/vision-trace.json'), 'utf8')) as Record<string, any>;
    assert.equal((trace.packageResult as Record<string, any>).metrics.actionCount, 5);
    const verifierReasons = (trace.steps as Array<Record<string, any>>)
      .filter((step) => step.kind === 'gui-execution')
      .map((step) => String(step.verifier?.reason ?? ''));
    assert.ok(verifierReasons.some((reason) => /current-round acceptance quota is not met yet/.test(reason)));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge propagates runtime abort to the text planner and writes a trace', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-abort-'));
  const adapter = new AbortAwarePlannerAdapter();
  const controller = new AbortController();
  try {
    const config = {
      ...baseConfig('cu-package-bridge-abort', []),
      testActionFixtureMode: false,
      testOnlyPlannedActions: [],
    };
    const run = runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run wait for a planner action unless the runtime aborts',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, config, { signal: controller.signal }, { codexPlannerAdapter: adapter });

    await adapter.started;
    controller.abort();
    const payload = await run;

    assert.equal(adapter.abortSignalSeen, true);
    assert.equal(adapter.aborted, true);
    assert.equal(payload.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(String(payload.executionUnits[0]?.failureReason || payload.message), /aborted|cancelled|planner/i);
    const tracePath = join(workspace, '.sciforge/vision-runs/cu-package-bridge-abort/vision-trace.json');
    const trace = JSON.parse(await readFile(tracePath, 'utf8')) as Record<string, any>;
    assert.equal(trace.schemaVersion, 'sciforge.vision-trace.v1');
    assert.match(JSON.stringify(trace), /planner aborted by test signal|Runtime Codex text planner failed/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge preserves partial GUI execution trace when runtime aborts before finalResult', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-partial-abort-'));
  const adapter = new AbortAfterFirstActionPlannerAdapter();
  const controller = new AbortController();
  try {
    const config = {
      ...baseConfig('cu-package-bridge-partial-abort', []),
      testActionFixtureMode: false,
      testOnlyPlannedActions: [],
      maxSteps: 3,
    };
    const run = runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run type two low-risk text snippets and preserve partial trace if interrupted',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      selectedActionIds: ['action.sciforge.computer-use'],
      artifacts: [],
    }, workspace, config, { signal: controller.signal }, { codexPlannerAdapter: adapter });

    await adapter.secondStarted;
    controller.abort(new Error('test round timeout after first action'));
    const payload = await run;

    assert.equal(payload.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(String(payload.executionUnits[0]?.failureReason || payload.message), /test round timeout after first action/);
    const trace = JSON.parse(await readFile(join(workspace, '.sciforge/vision-runs/cu-package-bridge-partial-abort/vision-trace.json'), 'utf8')) as Record<string, any>;
    assert.ok((trace.steps as Array<Record<string, unknown>>).some((step) => step.kind === 'gui-execution'));
    assert.ok((trace.steps as Array<Record<string, unknown>>).some((step) => step.kind === 'planning' && step.status === 'done'));
    assert.equal((trace.steps as Array<Record<string, unknown>>).filter((step) => step.kind === 'gui-execution').length, 1);
  } finally {
    controller.abort();
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
    await assertPackageBridgeEvidenceFiles(join(workspace, '.sciforge/vision-runs/cu-package-bridge-approval'), { expectApproval: true });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge confirmed retry carries approvalRef and executes guarded dry-run action', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-confirmed-'));
  try {
    const approvalProvenance = {
      source: 'prior-fail-closed-request',
      sourceRunId: 'cu-package-bridge-needs-confirmation',
      sourceApprovalRequestRef: '.sciforge/vision-runs/cu-package-bridge-needs-confirmation/approval-request.json',
      sourceGuiAskUserRecordRef: '.sciforge/vision-runs/cu-package-bridge-needs-confirmation/gui-ask-user.json',
      sourceRiskAuditRef: '.sciforge/vision-runs/cu-package-bridge-needs-confirmation/risk-audit.json',
      approvalRequestId: 'approval-request:cu-confirmed',
      approvalRef: 'approval:computer-use:cu-confirmed',
      riskActionHash: 'risk-action:cu-confirmed',
      highRiskAction: { actionKind: 'type_text', targetDescription: 'confirmed guarded text' },
      approvalRequestSidecar: {
        schemaVersion: 'sciforge.computer-use.approval-request-sidecar.v1',
        status: 'needs-confirmation',
        approvalRequestId: 'approval-request:cu-confirmed',
        approvalRef: 'approval:computer-use:cu-confirmed',
        riskActionHash: 'risk-action:cu-confirmed',
        approvalRequest: {
          id: 'approval-request:cu-confirmed',
          approvalRef: 'approval:computer-use:cu-confirmed',
          riskActionHash: 'risk-action:cu-confirmed',
          actionKind: 'type_text',
          riskLevel: 'high',
        },
      },
      guiAskUserSidecar: {
        schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
        port: 'gui.ask_user',
        status: 'needs-confirmation',
        payload: {
          approvalRequest: {
            id: 'approval-request:cu-confirmed',
            approvalRef: 'approval:computer-use:cu-confirmed',
            riskActionHash: 'risk-action:cu-confirmed',
          },
        },
      },
      riskAuditSidecar: {
        schemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1',
        status: 'needs-confirmation',
        approvalRequestId: 'approval-request:cu-confirmed',
        approvalRef: 'approval:computer-use:cu-confirmed',
        riskActionHash: 'risk-action:cu-confirmed',
      },
    };
    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use approve --approval-ref "approval:computer-use:cu-confirmed"',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
      humanApproval: { approvalRef: 'approval:computer-use:cu-confirmed', approvalProvenance },
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
    assert.deepEqual((computerUseRequest.metadata as Record<string, unknown>).approvalProvenance, approvalProvenance);
    assert.equal(packageResult.status, 'completed');
    assert.equal(packageResult.approvalRequest, null);
    assert.equal(packageSteps[0]?.status, 'done');
    assert.ok(packageSteps[0]?.execution);
    assert.match(JSON.stringify(packageSteps[0]?.execution), /dry-run package bridge/);
    const confirmedRequest = await readJsonEvidence(join(workspace, '.sciforge/vision-runs/cu-package-bridge-confirmed/confirmed-request.json'));
    const approvalRequest = await readJsonEvidence(join(workspace, '.sciforge/vision-runs/cu-package-bridge-confirmed/approval-request.json'));
    const guiAskUser = await readJsonEvidence(join(workspace, '.sciforge/vision-runs/cu-package-bridge-confirmed/gui-ask-user.json'));
    const riskAudit = await readJsonEvidence(join(workspace, '.sciforge/vision-runs/cu-package-bridge-confirmed/risk-audit.json'));
    assert.equal(approvalRequest.schemaVersion, 'sciforge.computer-use.approval-request-sidecar.v1');
    assert.equal(approvalRequest.status, 'needs-confirmation');
    assert.equal(approvalRequest.approvalRef, 'approval:computer-use:cu-confirmed');
    assert.equal(approvalRequest.approvalRequestId, 'approval-request:cu-confirmed');
    assert.equal(approvalRequest.riskActionHash, 'risk-action:cu-confirmed');
    assert.equal(approvalRequest.approvalRequestId, confirmedRequest.approvalRequestId);
    assert.equal(approvalRequest.riskActionHash, confirmedRequest.riskActionHash);
    assert.equal(approvalRequest.confirmedRequestRef, '.sciforge/vision-runs/cu-package-bridge-confirmed/confirmed-request.json');
    assert.equal(approvalRequest.approvalBoundary.source, 'prior-fail-closed-request');
    assert.equal(approvalRequest.approvalBoundary.sourceStatus, 'needs-confirmation');
    assert.equal(guiAskUser.schemaVersion, 'sciforge.computer-use.tui-host-actions.v1');
    assert.equal(guiAskUser.port, 'gui.ask_user');
    assert.equal(guiAskUser.status, 'needs-confirmation');
    assert.equal(guiAskUser.approvalRef, 'approval:computer-use:cu-confirmed');
    assert.equal(guiAskUser.approvalRequestId, confirmedRequest.approvalRequestId);
    assert.equal(guiAskUser.riskActionHash, confirmedRequest.riskActionHash);
    assert.ok(guiAskUser.payload.approvalRequest);
    assert.equal(confirmedRequest.schemaVersion, 'sciforge.computer-use.confirmed-request-sidecar.v1');
    assert.equal(confirmedRequest.approvalRef, 'approval:computer-use:cu-confirmed');
    assert.equal(confirmedRequest.approvalRequestId, 'approval-request:cu-confirmed');
    assert.equal(confirmedRequest.riskActionHash, 'risk-action:cu-confirmed');
    assert.equal(confirmedRequest.confirmedRequestRef, '.sciforge/vision-runs/cu-package-bridge-confirmed/confirmed-request.json');
    assert.equal(confirmedRequest.approvalBoundary.source, 'prior-fail-closed-request');
    assert.equal(confirmedRequest.approvalBoundary.sourceApprovalRequestRef, '.sciforge/vision-runs/cu-package-bridge-confirmed/approval-source-request.json');
    assert.equal(confirmedRequest.deniedExecuted, false);
    assert.equal(confirmedRequest.packageMayCallGuiDirectly, false);
    assert.equal(riskAudit.approvalRequestId, confirmedRequest.approvalRequestId);
    assert.equal(riskAudit.riskActionHash, confirmedRequest.riskActionHash);
    assert.equal(riskAudit.approvalRef, confirmedRequest.approvalRef);
    assert.equal(riskAudit.confirmedRequestRef, '.sciforge/vision-runs/cu-package-bridge-confirmed/confirmed-request.json');
    assert.equal(riskAudit.deniedExecuted, false);
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

class AbortAwarePlannerAdapter implements AgentCliAdapter {
  abortSignalSeen = false;
  aborted = false;
  private resolveStarted!: () => void;
  readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });

  async startTurn(input: AgentCliStartTurnInput): Promise<AgentCliTurn> {
    this.abortSignalSeen = Boolean(input.abortSignal);
    this.resolveStarted();
    const turnId = input.commandId ?? 'abort-aware-turn';
    const attemptId = input.attemptId ?? 'abort-aware-attempt';
    return {
      turnId,
      attemptId,
      events: this.events(input, turnId, attemptId),
    };
  }

  async cancel(): Promise<void> {}

  private async *events(
    input: AgentCliStartTurnInput,
    commandId: string,
    attemptId: string,
  ): AsyncIterable<NormalizedAgentEvent> {
    if (!input.abortSignal?.aborted) {
      await new Promise<void>((resolve) => input.abortSignal?.addEventListener('abort', () => resolve(), { once: true }));
    }
    this.aborted = true;
    const base = {
      schemaVersion: 'sciforge.codex.normalized-event.v1' as const,
      timestamp: '2026-05-25T00:00:00.000Z',
      provider: 'test',
      model: 'test',
      profile: 'test',
      workspace: input.workspacePath,
      commandId,
      attemptId,
      evidenceRefs: [],
    };
    yield { ...base, type: 'failed', status: 'failed', message: 'planner aborted by test signal', exitCode: 143, signal: 'SIGTERM' };
  }
}

class AbortAfterFirstActionPlannerAdapter implements AgentCliAdapter {
  private calls = 0;
  private resolveSecondStarted!: () => void;
  readonly secondStarted = new Promise<void>((resolve) => {
    this.resolveSecondStarted = resolve;
  });

  async startTurn(input: AgentCliStartTurnInput): Promise<AgentCliTurn> {
    this.calls += 1;
    const turnId = input.commandId ?? `partial-abort-turn-${this.calls}`;
    const attemptId = input.attemptId ?? `partial-abort-attempt-${this.calls}`;
    if (this.calls === 1) {
      return {
        turnId,
        attemptId,
        events: eventsForText(JSON.stringify({
          done: false,
          reason: 'type first visible text before continuing',
          actions: [{ type: 'type_text', text: 'first partial trace action' }],
        }), input.workspacePath, turnId, attemptId),
      };
    }
    this.resolveSecondStarted();
    return {
      turnId,
      attemptId,
      events: this.waitForAbortEvents(input, turnId, attemptId),
    };
  }

  async cancel(): Promise<void> {}

  private async *waitForAbortEvents(
    input: AgentCliStartTurnInput,
    commandId: string,
    attemptId: string,
  ): AsyncIterable<NormalizedAgentEvent> {
    if (!input.abortSignal?.aborted) {
      await new Promise<void>((resolve) => input.abortSignal?.addEventListener('abort', () => resolve(), { once: true }));
    }
    const reason = input.abortSignal?.reason instanceof Error
      ? input.abortSignal.reason.message
      : String(input.abortSignal?.reason || 'aborted');
    yield {
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      timestamp: '2026-05-25T00:00:00.000Z',
      provider: 'test',
      model: 'test',
      profile: 'test',
      workspace: input.workspacePath,
      commandId,
      attemptId,
      evidenceRefs: [],
      type: 'failed',
      status: 'failed',
      message: reason,
      exitCode: 143,
      signal: 'SIGTERM',
    };
  }
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

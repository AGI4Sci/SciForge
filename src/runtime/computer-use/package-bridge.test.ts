import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import type { AgentCliAdapter, AgentCliStartTurnInput, AgentCliTurn } from '../codex/agent-cli-adapter.js';
import type { NormalizedAgentEvent } from '../codex/codex-event-normalizer.js';
import type { WorkspaceRuntimeEvent } from '../runtime-types.js';
import { SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER } from './independent-input-adapter.js';
import {
  materializePackageBridgeCompletionGradeEvidence,
} from './package-bridge-evidence.js';
import {
  runComputerUsePackageBridge,
  setComputerUsePackageBridgeProcessRunnerForTests,
} from './package-bridge.js';
import type { ComputerUseConfig } from './types.js';
import {
  cuNext07DenseGroundingMarker,
  isolatedL3CompletionEvidence,
  materializeCuNextAcceptanceRefs,
} from '../../../tests/smoke/helpers/cu-next-runner-fixtures.js';
import { visionSenseModelRouterCapabilities } from '../../../packages/observe/vision/computer-use-runtime-policy.js';

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

async function writeWorkspaceRef(workspace: string, ref: string, text = 'final artifact fixture\n') {
  const path = join(workspace, ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

async function withInjectedComputerUsePackageResult<T>(
  packageResult: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  setComputerUsePackageBridgeProcessRunnerForTests(async () => packageResult);
  try {
    return await run();
  } finally {
    setComputerUsePackageBridgeProcessRunnerForTests(undefined);
  }
}

async function withEnv<T>(updates: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = new Map(Object.keys(updates).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function assertPackageBridgeEvidenceFiles(runDir: string, options: { expectApproval?: boolean; expectChatOrigin?: boolean } = {}) {
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
  if (options.expectChatOrigin) {
    assert.equal(request.metadata.chatOrigin.handoffSource, 'ui-chat');
    assert.equal(request.metadata.chatOrigin.entrypoint, 'sciforge-chat');
    assert.equal(request.metadata.chatOrigin.terminalEquivalentText, true);
    assert.equal(tuiHostChain.origin.handoffSource, 'ui-chat');
    assert.equal(tuiHostChain.origin.entrypoint, 'sciforge-chat');
    assert.equal(tuiHostChain.origin.terminalEquivalentText, true);
    assert.ok(tuiHostChain.links.some((link: Record<string, unknown>) => link.kind === 'sciForge-chat-origin' && link.status === 'present'));
  }
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

function completedPackageResult(runId: string, finalRef: string): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.computer-use.result.v1',
    status: 'completed',
    reason: 'semantic verifier accepted current-run final artifact',
    finalArtifactRefs: [finalRef],
    finalObservationRef: `.sciforge/vision-runs/${runId}/after.png`,
    metrics: { actionCount: 1, stepCount: 1, observationCount: 1 },
    steps: [{
      status: 'done',
      beforeRef: `.sciforge/vision-runs/${runId}/before.png`,
      afterRef: `.sciforge/vision-runs/${runId}/after.png`,
      action: { kind: 'click', target: { description: 'export final artifact' } },
      verification: {
        ok: true,
        done: true,
        reason: 'final artifact is visible',
        metadata: {
          finalArtifactRefs: [finalRef],
          evidenceRefs: [`.sciforge/vision-runs/${runId}/after.png`],
        },
      },
    }],
  };
}

function validL3ProducerSourceEvidence(finalRef: string) {
  const sourceEvidence = stripEvidenceL3Prefix({
    ...isolatedL3CompletionEvidence(finalRef),
    focusCropRefs: ['evidence/l3/focus-crop.png'],
    groundingDiagnosticsRefs: ['evidence/l3/coarse-fine-rejected-targets.json'],
    evidenceMarkers: [cuNext07DenseGroundingMarker()],
  }) as Record<string, any>;
  sourceEvidence.taskFinalArtifactRefs = [finalRef];
  sourceEvidence.taskArtifactBinding = {
    ...(sourceEvidence.taskArtifactBinding ?? {}),
    finalArtifactRef: finalRef,
    finalArtifactRefs: [finalRef],
  };
  sourceEvidence.presentationEvidence = {
    ...(sourceEvidence.presentationEvidence ?? {}),
    artifactRefs: ((sourceEvidence.presentationEvidence?.artifactRefs ?? []) as unknown[])
      .filter((ref): ref is string => typeof ref === 'string' && !ref.startsWith('.sciforge/')),
  };
  return sourceEvidence;
}

async function materializeL3SourceEvidenceRefs(sourceDir: string, evidence: unknown) {
  await Promise.all(collectBundleLocalRefStrings(evidence).map(async (ref) => {
    const fileRef = ref.split('#', 1)[0];
    if (!fileRef || fileRef.startsWith('.sciforge/')) return;
    const target = join(sourceDir, fileRef);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, /\.[cp]?sv$/i.test(fileRef) ? 'label,value\nfixture,true\n' : `${JSON.stringify({ ref: fileRef, fixture: 'materialized-completion-evidence-ref' }, null, 2)}\n`, 'utf8');
  }));
}

function collectBundleLocalRefStrings(value: unknown, key = ''): string[] {
  const refs: string[] = [];
  const visit = (item: unknown, itemKey = '') => {
    if (typeof item === 'string') {
      if (itemKey.endsWith('Ref') || itemKey.endsWith('Refs')) refs.push(item);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child) => visit(child, itemKey));
      return;
    }
    if (item && typeof item === 'object') {
      Object.entries(item as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey));
    }
  };
  visit(value, key);
  return [...new Set(refs.filter(isBundleLocalRefString))];
}

function isBundleLocalRefString(ref: string) {
  const fileRef = ref.trim().split('#', 1)[0];
  return fileRef
    && !fileRef.startsWith('/')
    && !fileRef.startsWith('~')
    && !fileRef.includes('..')
    && !/^[a-z][a-z0-9+.-]*:/i.test(fileRef);
}

function stripEvidenceL3Prefix(value: unknown): unknown {
  if (typeof value === 'string') return value.startsWith('evidence/l3/') ? value.slice('evidence/l3/'.length) : value;
  if (Array.isArray(value)) return value.map(stripEvidenceL3Prefix);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      stripEvidenceL3Prefix(child),
    ]));
  }
  return value;
}

test('package bridge calls TypeScript host-port loop and writes refs-first trace', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-bridge-'));
  const events: WorkspaceRuntimeEvent[] = [];
  try {
    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run type low risk local smoke text',
      handoffSource: 'ui-chat',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      selectedActionIds: ['action.sciforge.computer-use'],
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
    await assertPackageBridgeEvidenceFiles(join(workspace, '.sciforge/vision-runs/cu-package-bridge-ok'), { expectChatOrigin: true });
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

test('package bridge blocks legacy direct grounder URLs on the product path', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-legacy-grounder-'));
  try {
    const config = baseConfig('cu-package-bridge-legacy-grounder-blocked', [
      {
        type: 'click',
        targetDescription: 'visible private provider target',
      },
    ]);
    config.grounder.baseUrl = 'https://private-provider.example/v1?token=secret';

    const payload = await runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run click the visible private provider target through router grounding only',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, config, {});

    assert.equal(payload.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(
      String(payload.executionUnits[0]?.failureReason || payload.message),
      /legacy direct grounding adapter is disabled/i,
    );
    const traceText = await readFile(join(workspace, '.sciforge/vision-runs/cu-package-bridge-legacy-grounder-blocked/vision-trace.json'), 'utf8');
    assert.match(traceText, /model-router\.capability\.computer-use\.grounding-translator/);
    assert.doesNotMatch(traceText, /https:\/\/private-provider\.example|token=secret|grounderUrl|healthUrl|legacy grounding adapter health preflight/i);
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
    assert.equal(guiStep?.scheduler?.executorLease?.status, 'released');
    assert.equal(guiStep?.scheduler?.executorLease?.leaseScope?.kind, 'window-local');
    assert.equal(guiStep?.scheduler?.executorLease?.displayGroupId, 'display-group-1');
    assert.equal(guiStep?.scheduler?.executorLease?.screenId, 'screen-1');
    assert.equal(typeof guiStep?.scheduler?.executorLease?.windowId, 'string');
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
      done: false,
      reason: 'show the report artifact in the visible file manager',
      actions: [{ type: 'open_app', appName: 'Finder' }],
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
    assert.equal(trace.packageResult.failureDiagnostics, undefined);
    const packageSteps = trace.packageResult.steps as Array<Record<string, any>>;
    assert.equal(packageSteps.at(-1)?.verification?.done, true);
    assert.match(String(packageSteps.at(-1)?.verification?.reason ?? ''), /visible final artifact accepted by current-run verifier/);
    const guiPresent = JSON.parse(await readFile(join(runDir, 'gui-present.json'), 'utf8')) as Record<string, any>;
    assert.ok(guiPresent.payload.artifactRefs.includes('.sciforge/vision-runs/cu-package-bridge-report-artifact/report.md'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge promotes current-run package final artifact refs into trace and gui.present', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-final-ref-'));
  try {
    const runId = 'cu-package-bridge-promote-final-ref';
    const finalRef = `.sciforge/vision-runs/${runId}/analysis-report.md`;
    await writeWorkspaceRef(workspace, finalRef, 'analysis report fixture\n');
    const packageResult = {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      reason: 'semantic verifier accepted current-run final artifact',
      traceRefs: [],
      artifactRefs: [],
      finalObservationRef: `.sciforge/vision-runs/${runId}/step-001-after.png`,
      metrics: { actionCount: 1, stepCount: 1, observationCount: 1 },
      steps: [{
        status: 'done',
        beforeRef: `.sciforge/vision-runs/${runId}/step-001-before.png`,
        afterRef: `.sciforge/vision-runs/${runId}/step-001-after.png`,
        action: { kind: 'click', target: { description: 'save report button' } },
        verification: {
          ok: true,
          done: true,
          reason: 'report is visible and saved',
          metadata: {
            finalArtifactRefs: [finalRef],
            evidenceRefs: [`.sciforge/vision-runs/${runId}/step-001-after.png`],
          },
        },
      }],
    };

    const payload = await withInjectedComputerUsePackageResult(packageResult, () => runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run create a visible markdown report artifact',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, baseConfig(runId, []), {}));

    assert.equal(payload.executionUnits[0]?.status, 'done');
    assert.ok(payload.artifacts.some((artifact) => artifact.path === finalRef));
    const outputArtifacts = payload.executionUnits[0]?.outputArtifacts;
    assert.ok(Array.isArray(outputArtifacts));
    assert.ok(outputArtifacts.includes(finalRef));

    const runDir = join(workspace, `.sciforge/vision-runs/${runId}`);
    const trace = JSON.parse(await readFile(join(runDir, 'vision-trace.json'), 'utf8')) as Record<string, any>;
    assert.equal(trace.finalArtifactRef, finalRef);
    assert.deepEqual(trace.finalArtifactRefs, [finalRef]);
    assert.deepEqual(trace.artifactRefs, [finalRef]);
    assert.equal(trace.cuUserAcceptance.finalArtifactRef, finalRef);

    const guiPresent = JSON.parse(await readFile(join(runDir, 'gui-present.json'), 'utf8')) as Record<string, any>;
    assert.ok(guiPresent.payload.artifactRefs.includes(finalRef));
    const directoryListing = JSON.parse(await readFile(join(runDir, 'directory-listing.json'), 'utf8')) as Record<string, any>;
    assert.deepEqual(directoryListing.finalArtifactRefs, [finalRef]);
    assert.ok(directoryListing.fileRefs.includes(finalRef));
    assert.ok(directoryListing.fileRefs.includes(`.sciforge/vision-runs/${runId}/completion-grade-diagnostics.json`));
    assert.ok(!directoryListing.fileRefs.includes(`.sciforge/vision-runs/${runId}/cu-user-acceptance-manifest.json`));
    const completionDiagnostic = JSON.parse(await readFile(join(runDir, 'completion-grade-diagnostics.json'), 'utf8')) as Record<string, any>;
    assert.equal(completionDiagnostic.schemaVersion, 'sciforge.computer-use.completion-grade-diagnostic.v1');
    assert.equal(completionDiagnostic.status, 'blocked');
    assert.equal(completionDiagnostic.expectedCompletionEvidenceRef, `.sciforge/vision-runs/${runId}/isolated-desktop-l3-workflow-evidence.json`);
    assert.ok(completionDiagnostic.issues.some((issue: string) => /does not exist|current-run regular file/.test(issue)));
    assert.match(String(completionDiagnostic.reason), /fail-closed/);
    await assert.rejects(() => stat(join(runDir, 'cu-user-acceptance-manifest.json')), { code: 'ENOENT' });
    const tuiHostChain = JSON.parse(await readFile(join(runDir, 'tui-host-run-task-chain.json'), 'utf8')) as Record<string, any>;
    assert.equal(tuiHostChain.completionGrade.status, 'blocked');
    assert.equal(tuiHostChain.completionGrade.diagnosticRef, `.sciforge/vision-runs/${runId}/completion-grade-diagnostics.json`);
    assert.match(String(tuiHostChain.completionGrade.reason), /fail-closed/);
    assert.ok(tuiHostChain.links.some((link: Record<string, unknown>) => (
      link.kind === 'completion-grade-evidence'
      && link.status === 'blocked'
      && String(link.recordRef).endsWith('/completion-grade-diagnostics.json')
    )));
    const toolPayload = JSON.parse(await readFile(join(runDir, 'tool-payload.json'), 'utf8')) as Record<string, any>;
    assert.ok(toolPayload.workEvidence?.some((entry: Record<string, any>) => (
      entry.provider === 'computer-use-package-bridge'
      && entry.status === 'blocked'
      && entry.evidenceRefs?.includes(`.sciforge/vision-runs/${runId}/completion-grade-diagnostics.json`)
      && /Produce canonical isolated-desktop-l3-workflow-evidence\.json/.test(String(entry.nextStep))
    )));
    assert.ok(payload.workEvidence?.some((entry) => (
      entry.provider === 'computer-use-package-bridge'
      && entry.status === 'blocked'
      && entry.evidenceRefs?.some((ref) => ref.endsWith('/completion-grade-diagnostics.json'))
    )));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge attaches current-run user acceptance manifest only when canonical L3 evidence is present', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-completion-grade-'));
  try {
    const runId = 'cu-package-bridge-completion-grade';
    const runDir = join(workspace, `.sciforge/vision-runs/${runId}`);
    await mkdir(runDir, { recursive: true });
    const finalRef = `.sciforge/vision-runs/${runId}/dense-grounding-export.csv`;
    const completionEvidence = {
      ...isolatedL3CompletionEvidence(finalRef),
      focusCropRefs: ['focus-crop.png'],
      groundingDiagnosticsRefs: ['coarse-fine-rejected-targets.json'],
      evidenceMarkers: [cuNext07DenseGroundingMarker()],
    };
    await materializeCuNextAcceptanceRefs(runDir, {
      completionEvidence,
      completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
      screenshotRefs: { before: ['before.png'], after: ['after.png'] },
      focusCropRefs: ['focus-crop.png'],
      groundingDiagnosticsRefs: ['coarse-fine-rejected-targets.json'],
      finalArtifactRef: finalRef,
      finalVisibleScreenshotRef: 'final-visible.png',
      guiPresent: {
        displayedRefs: [finalRef],
        artifactRefs: [finalRef],
        recordRef: 'gui-present.json',
        payloadRef: 'tool-payload.json',
      },
      evidenceMarkers: [cuNext07DenseGroundingMarker()],
    });
    const packageResult = {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      reason: 'semantic verifier accepted current-run final artifact',
      finalArtifactRefs: [finalRef],
      finalObservationRef: `.sciforge/vision-runs/${runId}/after.png`,
      metrics: { actionCount: 1, stepCount: 1, observationCount: 1 },
      steps: [{
        status: 'done',
        beforeRef: `.sciforge/vision-runs/${runId}/before.png`,
        afterRef: `.sciforge/vision-runs/${runId}/after.png`,
        action: { kind: 'click', target: { description: 'export dense grounding report' } },
        verification: {
          ok: true,
          done: true,
          reason: 'final artifact is visible',
          metadata: { finalArtifactRefs: [finalRef] },
        },
      }],
    };

    const payload = await withInjectedComputerUsePackageResult(packageResult, () => runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run CU-NEXT-07 dense grounding visible artifact',
      handoffSource: 'ui-chat',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      selectedActionIds: ['action.sciforge.computer-use'],
      artifacts: [],
      uiState: {
        computerUseNext: {
          taskId: 'CU-NEXT-07',
          title: 'Computer Use live task acceptance',
        },
        computerUseLong: {
          taskId: 'CU-NEXT-07',
          cuNextTaskId: 'CU-NEXT-07',
          scenarioId: 'CU-LONG-004',
        },
      },
    }, workspace, baseConfig(runId, []), {}));

    assert.equal(payload.executionUnits[0]?.status, 'done');
    const acceptance = JSON.parse(await readFile(join(runDir, 'cu-user-acceptance-manifest.json'), 'utf8')) as Record<string, any>;
    assert.equal(acceptance.schemaVersion, 'sciforge.computer-use.user-acceptance-manifest.v1');
    assert.equal(acceptance.status, 'multi-app-workflow-passed');
    assert.equal(acceptance.taskId, 'CU-NEXT-07');
    assert.equal(acceptance.scenarioId, 'CU-LONG-004');
    assert.equal(acceptance.completionEvidenceRef, 'isolated-desktop-l3-workflow-evidence.json');
    assert.equal(acceptance.finalArtifactRef, finalRef);
    assert.equal(acceptance.productPathClassification.tier, 'package-diagnostic');
    assert.equal(acceptance.productPathClassification.diagnosticOnly, true);
    assert.equal(acceptance.productPathClassification.packageDiagnosticOnly, true);
    assert.notEqual(acceptance.productPathClassification.tier, 'product-smoke');
    assert.equal(acceptance.productPathClassification.nativePluginInvocationRef, undefined);
    assert.equal(acceptance.virtualDisplayGroup.diagnosticOnly, true);
    assert.equal(acceptance.virtualDisplayGroup.packageDiagnosticOnly, true);
    assert.equal(acceptance.virtualDisplayGroup.screens.length, 1);
    assert.equal(acceptance.virtualDisplayGroup.screens[0].screenId, `${runId}-diagnostic-screen`);
    assert.equal(acceptance.virtualDisplayGroup.screens[0].windowId, `${runId}-diagnostic-window`);
    assert.equal(acceptance.actorCursorProvenance.length, 1);
    assert.equal(acceptance.actorCursorProvenance[0].diagnosticOnly, true);
    assert.equal(acceptance.actorCursorProvenance[0].actorId, `${runId}-diagnostic-actor`);
    assert.equal(acceptance.executorLease.screenId, `${runId}-diagnostic-screen`);
    assert.equal(acceptance.executorLease.windowId, `${runId}-diagnostic-window`);
    assert.equal(acceptance.executorLease.leaseScope.kind, 'window-local');
    assert.equal(acceptance.executorLease.leaseScope.diagnosticOnly, true);
    assert.equal(acceptance.executorLease.leaseScope.packageDiagnosticOnly, true);
    assert.equal(acceptance.executorLeases.length, 1);
    assert.equal(acceptance.executorLeases[0].diagnosticOnly, true);
    assert.equal(acceptance.executorLeases[0].packageDiagnosticOnly, true);
    assert.equal(acceptance.actionCausality.length, 1);
    assert.equal(acceptance.actionCausality[0].diagnosticOnly, true);
    assert.equal(acceptance.actionCausality[0].packageDiagnosticOnly, true);
    assert.ok(acceptance.actionCausality[0].beforeEvidenceRefs.length > 0);
    assert.ok(acceptance.actionCausality[0].beforeEvidenceRefs.every((ref: string) => ref.startsWith(`.sciforge/vision-runs/${runId}/`)));
    assert.ok(acceptance.actionCausality[0].afterEvidenceRefs.includes(`.sciforge/vision-runs/${runId}/final-visible.png`));
    assert.ok(acceptance.actionCausality[0].afterEvidenceRefs.every((ref: string) => ref.startsWith(`.sciforge/vision-runs/${runId}/`)));
    assert.equal(acceptance.replayBundle.diagnosticOnly, true);
    assert.equal(acceptance.replayBundle.packageDiagnosticOnly, true);
    assert.equal(acceptance.replayBundle.frames.length, 1);
    assert.ok(acceptance.guiPresent.displayedRefs.includes(`.sciforge/vision-runs/${runId}/final-visible.png`));
    assert.equal(acceptance.evidenceLedger.diagnosticOnly, true);
    assert.equal(acceptance.evidenceLedger.packageDiagnosticOnly, true);
    assert.equal(acceptance.evidenceLedger.productSmokeEligible, false);
    assert.ok(acceptance.evidenceLedger.evidenceIndexRefs.includes(`.sciforge/vision-runs/${runId}/directory-listing.json`));
    assert.ok(acceptance.tuiHostChain.some((link: Record<string, unknown>) => link.kind === 'sciForge-chat-origin' && link.status === 'present'));
    assert.ok(acceptance.focusCropRefs.length > 0);
    assert.ok(acceptance.groundingDiagnosticsRefs.length > 0);
    assert.ok(acceptance.evidenceClaims.some((claim: Record<string, unknown>) => (
      claim.kind === 'sciForge-chat-origin'
      && claim.status === 'present'
      && Array.isArray(claim.sessionRefs)
      && claim.sessionRefs.includes(`.sciforge/vision-runs/${runId}/computer-use-request.json`)
    )));
    assert.ok(acceptance.evidenceMarkers.some((marker: Record<string, unknown>) => marker.kind === 'dense-grounding'));
    const acceptanceInput = JSON.parse(await readFile(join(runDir, 'cu-user-acceptance-input.json'), 'utf8')) as Record<string, any>;
    assert.equal(acceptanceInput.completionEvidenceRef, 'isolated-desktop-l3-workflow-evidence.json');
    assert.equal(acceptanceInput.finalArtifactRef, finalRef);
    await assert.rejects(() => stat(join(runDir, 'completion-grade-diagnostics.json')), { code: 'ENOENT' });

    const directoryListing = JSON.parse(await readFile(join(runDir, 'directory-listing.json'), 'utf8')) as Record<string, any>;
    assert.ok(directoryListing.fileRefs.includes(`.sciforge/vision-runs/${runId}/cu-user-acceptance-input.json`));
    assert.ok(directoryListing.fileRefs.includes(`.sciforge/vision-runs/${runId}/cu-user-acceptance-manifest.json`));
    assert.ok(directoryListing.fileRefs.includes(`.sciforge/vision-runs/${runId}/isolated-desktop-l3-workflow-evidence.json`));
    assert.ok(!directoryListing.fileRefs.includes(`.sciforge/vision-runs/${runId}/completion-grade-diagnostics.json`));
    const tuiHostChain = JSON.parse(await readFile(join(runDir, 'tui-host-run-task-chain.json'), 'utf8')) as Record<string, any>;
    assert.equal(tuiHostChain.completionGrade.status, 'attached');
    assert.equal(tuiHostChain.completionGrade.acceptanceInputRef, `.sciforge/vision-runs/${runId}/cu-user-acceptance-input.json`);
    assert.equal(tuiHostChain.completionGrade.acceptanceManifestRef, `.sciforge/vision-runs/${runId}/cu-user-acceptance-manifest.json`);
    assert.equal(tuiHostChain.completionGrade.completionEvidenceBundleRef, `.sciforge/vision-runs/${runId}/isolated-desktop-l3-workflow-evidence.json`);
    assert.ok(tuiHostChain.links.some((link: Record<string, unknown>) => (
      link.kind === 'completion-grade-evidence'
      && link.status === 'present'
      && String(link.recordRef).endsWith('/cu-user-acceptance-manifest.json')
    )));
    const toolPayload = JSON.parse(await readFile(join(runDir, 'tool-payload.json'), 'utf8')) as Record<string, any>;
    assert.ok(toolPayload.workEvidence?.some((entry: Record<string, any>) => (
      entry.provider === 'computer-use-package-bridge'
      && entry.status === 'verified'
      && entry.evidenceRefs?.includes(`.sciforge/vision-runs/${runId}/cu-user-acceptance-input.json`)
      && entry.evidenceRefs?.includes(`.sciforge/vision-runs/${runId}/cu-user-acceptance-manifest.json`)
      && entry.evidenceRefs?.includes(`.sciforge/vision-runs/${runId}/isolated-desktop-l3-workflow-evidence.json`)
      && entry.failureReason === undefined
    )));
    assert.ok(payload.workEvidence?.some((entry) => (
      entry.provider === 'computer-use-package-bridge'
      && entry.status === 'verified'
      && entry.evidenceRefs?.some((ref) => ref.endsWith('/cu-user-acceptance-manifest.json'))
      && entry.evidenceRefs?.some((ref) => ref.endsWith('/isolated-desktop-l3-workflow-evidence.json'))
    )));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge completion grade projects only diagnostic current-run product path refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-diagnostic-product-path-'));
  try {
    const runId = 'cu-package-bridge-diagnostic-product-path';
    const runDir = join(workspace, `.sciforge/vision-runs/${runId}`);
    await mkdir(runDir, { recursive: true });
    const finalRef = `.sciforge/vision-runs/${runId}/dense-grounding-export.csv`;
    const completionEvidence = {
      ...isolatedL3CompletionEvidence(finalRef),
      focusCropRefs: ['focus-crop.png'],
      groundingDiagnosticsRefs: ['coarse-fine-rejected-targets.json'],
      evidenceMarkers: [cuNext07DenseGroundingMarker()],
    };
    await materializeCuNextAcceptanceRefs(runDir, {
      completionEvidence,
      completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
      screenshotRefs: { before: ['before.png'], after: ['after.png'] },
      focusCropRefs: ['focus-crop.png'],
      groundingDiagnosticsRefs: ['coarse-fine-rejected-targets.json'],
      finalArtifactRef: finalRef,
      finalVisibleScreenshotRef: 'final-visible.png',
      guiPresent: {
        displayedRefs: [finalRef],
        artifactRefs: [finalRef],
        recordRef: 'gui-present.json',
        payloadRef: 'tool-payload.json',
      },
      evidenceMarkers: [cuNext07DenseGroundingMarker()],
    });

    const attachment = await materializePackageBridgeCompletionGradeEvidence({
      actionProviderRequest: {
        task: '/computer-use run CU-NEXT-07 dense grounding visible artifact',
        metadata: {
          chatOrigin: {
            schemaVersion: 'sciforge.computer-use.chat-origin.v1',
            handoffSource: 'ui-chat',
            entrypoint: 'sciforge-chat',
            terminalEquivalentText: true,
          },
          plannerAcceptanceContract: {
            taskId: 'CU-NEXT-07',
            scenarioId: 'CU-LONG-004',
          },
        },
      },
      config: baseConfig(runId, []),
      packageResult: completedPackageResult(runId, finalRef),
      payload: {
        artifacts: [],
        executionUnits: [{ id: 'unit-1', tool: 'local.vision-sense', status: 'done' }],
        objectReferences: [],
      } as any,
      state: {
        runId,
        runDir,
        screenshotLedger: [
          { id: 'before', path: 'before.png' },
          { id: 'after', path: 'after.png' },
          { id: 'final-visible', path: 'final-visible.png' },
        ],
        visibleArtifacts: [{ artifactRef: finalRef }],
      },
      workspace,
    });

    assert.equal(attachment.status, 'attached');
    const acceptance = JSON.parse(await readFile(join(runDir, 'cu-user-acceptance-manifest.json'), 'utf8')) as Record<string, any>;
    assert.equal(acceptance.productPathClassification.tier, 'package-diagnostic');
    assert.equal(acceptance.productPathClassification.diagnosticOnly, true);
    assert.equal(acceptance.productPathClassification.packageDiagnosticOnly, true);
    assert.equal(acceptance.productPathClassification.nativePluginInvocationRef, undefined);
    assert.equal(acceptance.virtualDisplayGroup.diagnosticOnly, true);
    assert.equal(acceptance.virtualDisplayGroup.packageDiagnosticOnly, true);
    assert.equal(acceptance.virtualDisplayGroup.screens.length, 1);
    assert.equal(acceptance.virtualDisplayGroup.screens[0].screenId, `${runId}-diagnostic-screen`);
    assert.equal(acceptance.virtualDisplayGroup.screens[0].windowId, `${runId}-diagnostic-window`);
    assert.equal(acceptance.actorCursorProvenance.length, 1);
    assert.equal(acceptance.actorCursorProvenance[0].diagnosticOnly, true);
    assert.equal(acceptance.executorLease.leaseScope.diagnosticOnly, true);
    assert.equal(acceptance.executorLease.leaseScope.packageDiagnosticOnly, true);
    assert.equal(acceptance.executorLeases.length, 1);
    assert.equal(acceptance.executorLeases[0].diagnosticOnly, true);
    assert.equal(acceptance.executorLeases[0].packageDiagnosticOnly, true);
    assert.equal(acceptance.actionCausality.length, 1);
    assert.equal(acceptance.actionCausality[0].diagnosticOnly, true);
    assert.equal(acceptance.actionCausality[0].packageDiagnosticOnly, true);
    assert.equal(acceptance.replayBundle.diagnosticOnly, true);
    assert.equal(acceptance.replayBundle.packageDiagnosticOnly, true);
    assert.ok(acceptance.guiPresent.displayedRefs.includes(`.sciforge/vision-runs/${runId}/final-visible.png`));
    assert.equal(acceptance.evidenceLedger.diagnosticOnly, true);
    assert.equal(acceptance.evidenceLedger.packageDiagnosticOnly, true);
    assert.equal(acceptance.evidenceLedger.productSmokeEligible, false);
    assert.ok(acceptance.evidenceLedger.evidenceIndexRefs.includes(`.sciforge/vision-runs/${runId}/directory-listing.json`));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge blocks completion-grade when canonical L3 evidence is present but not validator accepted', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-completion-invalid-'));
  try {
    const runId = 'cu-package-bridge-completion-invalid';
    const runDir = join(workspace, `.sciforge/vision-runs/${runId}`);
    await mkdir(runDir, { recursive: true });
    const finalRef = `.sciforge/vision-runs/${runId}/invalid-l3-report.md`;
    await writeWorkspaceRef(workspace, finalRef, 'invalid l3 report fixture\n');
    await writeFile(join(runDir, 'isolated-desktop-l3-workflow-evidence.json'), `${JSON.stringify({
      schemaVersion: 'sciforge.computer-use.isolated-desktop-l3-workflow-evidence.v1',
      evidenceKind: 'isolated-L3',
      status: 'completed',
      acceptanceTier: 'l3-multi-app-workflow',
      targetEnvironmentKind: 'linux-isolated-desktop-session',
      realWindowEvidence: true,
      userAcceptanceEligible: true,
      diagnosticOnly: false,
      errors: [],
      l3Workflow: {
        status: 'completed',
        completed: false,
        sameSession: true,
        sourceToWriterToPreviewCausality: true,
      },
    }, null, 2)}\n`, 'utf8');

    const payload = await withInjectedComputerUsePackageResult(completedPackageResult(runId, finalRef), () => runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run CU-NEXT-07 dense grounding visible artifact',
      handoffSource: 'ui-chat',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      selectedActionIds: ['action.sciforge.computer-use'],
      artifacts: [],
      uiState: {
        computerUseNext: {
          taskId: 'CU-NEXT-07',
          title: 'Computer Use live task acceptance',
        },
        computerUseLong: {
          taskId: 'CU-NEXT-07',
          cuNextTaskId: 'CU-NEXT-07',
          scenarioId: 'CU-LONG-004',
        },
      },
    }, workspace, baseConfig(runId, []), {}));

    assert.equal(payload.executionUnits[0]?.status, 'done');
    await assert.rejects(() => stat(join(runDir, 'cu-user-acceptance-manifest.json')), { code: 'ENOENT' });
    const completionDiagnostic = JSON.parse(await readFile(join(runDir, 'completion-grade-diagnostics.json'), 'utf8')) as Record<string, any>;
    assert.equal(completionDiagnostic.schemaVersion, 'sciforge.computer-use.completion-grade-diagnostic.v1');
    assert.equal(completionDiagnostic.status, 'blocked');
    assert.match(String(completionDiagnostic.reason), /present but not validator-accepted isolated L3 evidence/);
    assert.equal(completionDiagnostic.expectedCompletionEvidenceRef, `.sciforge/vision-runs/${runId}/isolated-desktop-l3-workflow-evidence.json`);
    assert.ok(completionDiagnostic.issues.some((issue: string) => (
      /l3Workflow\.completed must be true|applicationEvidence/.test(issue)
    )));
    const tuiHostChain = JSON.parse(await readFile(join(runDir, 'tui-host-run-task-chain.json'), 'utf8')) as Record<string, any>;
    assert.equal(tuiHostChain.completionGrade.status, 'blocked');
    assert.ok(tuiHostChain.links.some((link: Record<string, unknown>) => (
      link.kind === 'completion-grade-evidence'
      && link.status === 'blocked'
      && String(link.recordRef).endsWith('/completion-grade-diagnostics.json')
    )));
    const toolPayload = JSON.parse(await readFile(join(runDir, 'tool-payload.json'), 'utf8')) as Record<string, any>;
    assert.ok(toolPayload.workEvidence?.some((entry: Record<string, any>) => (
      entry.provider === 'computer-use-package-bridge'
      && entry.kind === 'validate'
      && entry.status === 'blocked'
      && entry.evidenceRefs?.includes(`.sciforge/vision-runs/${runId}/completion-grade-diagnostics.json`)
      && /Produce canonical isolated-desktop-l3-workflow-evidence\.json/.test(String(entry.nextStep))
    )));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge blocks completion-grade when canonical L3 evidence is not bound to current final artifact', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-completion-binding-'));
  try {
    const runId = 'cu-package-bridge-completion-binding';
    const runDir = join(workspace, `.sciforge/vision-runs/${runId}`);
    await mkdir(runDir, { recursive: true });
    const l3FinalRef = `.sciforge/vision-runs/${runId}/l3-report.md`;
    const packageFinalRef = `.sciforge/vision-runs/${runId}/package-report.md`;
    await writeWorkspaceRef(workspace, l3FinalRef, 'l3 report fixture\n');
    await writeWorkspaceRef(workspace, packageFinalRef, 'package report fixture\n');
    const completionEvidence = validL3ProducerSourceEvidence(l3FinalRef);
    await materializeCuNextAcceptanceRefs(runDir, {
      completionEvidence,
      completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
      screenshotRefs: { before: ['before.png'], after: ['after.png'] },
      focusCropRefs: ['focus-crop.png'],
      groundingDiagnosticsRefs: ['coarse-fine-rejected-targets.json'],
      finalArtifactRef: l3FinalRef,
      finalVisibleScreenshotRef: 'final-visible.png',
      guiPresent: {
        displayedRefs: [l3FinalRef],
        artifactRefs: [l3FinalRef],
        recordRef: 'gui-present.json',
        payloadRef: 'tool-payload.json',
      },
      evidenceMarkers: [cuNext07DenseGroundingMarker()],
    });
    const packageResult = {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      reason: 'semantic verifier accepted a different current-run final artifact',
      finalArtifactRefs: [packageFinalRef],
      finalObservationRef: `.sciforge/vision-runs/${runId}/after.png`,
      metrics: { actionCount: 1, stepCount: 1, observationCount: 1 },
      steps: [{
        status: 'done',
        beforeRef: `.sciforge/vision-runs/${runId}/before.png`,
        afterRef: `.sciforge/vision-runs/${runId}/after.png`,
        action: { kind: 'click', target: { description: 'export package report' } },
        verification: {
          ok: true,
          done: true,
          reason: 'package final artifact is visible',
          metadata: { finalArtifactRefs: [packageFinalRef] },
        },
      }],
    };

    const payload = await withInjectedComputerUsePackageResult(packageResult, () => runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run CU-NEXT-07 dense grounding visible artifact',
      handoffSource: 'ui-chat',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      selectedActionIds: ['action.sciforge.computer-use'],
      artifacts: [],
      uiState: {
        computerUseNext: {
          taskId: 'CU-NEXT-07',
          title: 'Computer Use live task acceptance',
        },
        computerUseLong: {
          taskId: 'CU-NEXT-07',
          cuNextTaskId: 'CU-NEXT-07',
          scenarioId: 'CU-LONG-004',
        },
      },
    }, workspace, baseConfig(runId, []), {}));

    assert.equal(payload.executionUnits[0]?.status, 'done');
    await assert.rejects(() => stat(join(runDir, 'cu-user-acceptance-manifest.json')), { code: 'ENOENT' });
    const completionDiagnostic = JSON.parse(await readFile(join(runDir, 'completion-grade-diagnostics.json'), 'utf8')) as Record<string, any>;
    assert.equal(completionDiagnostic.status, 'blocked');
    assert.match(String(completionDiagnostic.reason), /not bound to the current package bridge final artifact/);
    assert.ok(completionDiagnostic.issues.some((issue: string) => (
      /completionEvidenceRef evidence must bind to acceptance finalArtifactRef/.test(issue)
    )));
    const tuiHostChain = JSON.parse(await readFile(join(runDir, 'tui-host-run-task-chain.json'), 'utf8')) as Record<string, any>;
    assert.equal(tuiHostChain.completionGrade.status, 'blocked');
    assert.ok(tuiHostChain.links.some((link: Record<string, unknown>) => (
      link.kind === 'completion-grade-evidence'
      && link.status === 'blocked'
      && String(link.recordRef).endsWith('/completion-grade-diagnostics.json')
    )));
    const toolPayload = JSON.parse(await readFile(join(runDir, 'tool-payload.json'), 'utf8')) as Record<string, any>;
    assert.ok(toolPayload.workEvidence?.some((entry: Record<string, any>) => (
      entry.provider === 'computer-use-package-bridge'
      && entry.kind === 'validate'
      && entry.status === 'blocked'
      && entry.evidenceRefs?.includes(`.sciforge/vision-runs/${runId}/completion-grade-diagnostics.json`)
      && Array.isArray(entry.recoverActions)
    )));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('package bridge rejects control old outside and pseudo final artifact refs during promotion', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-package-final-ref-filter-'));
  try {
    const runId = 'cu-package-bridge-filter-final-ref';
    const validRef = `.sciforge/vision-runs/${runId}/briefing-deck.pptx`;
    const nestedBogusRef = `.sciforge/vision-runs/${runId}/nested-but-not-explicit.md`;
    await writeWorkspaceRef(workspace, validRef, 'briefing deck fixture\n');
    await writeWorkspaceRef(workspace, nestedBogusRef, 'nested ref should not promote\n');
    const rejectedRefs = [
      `.sciforge/vision-runs/${runId}/vision-trace.json`,
      `.sciforge/vision-runs/${runId}/tool-payload.json`,
      `.sciforge/vision-runs/${runId}/cu-user-acceptance-manifest.json`,
      `.sciforge/vision-runs/${runId}/l3-validator.json`,
      '.sciforge/vision-runs/old-run/old-report.md',
      '/tmp/sciforge-old-run/outside-report.md',
      'artifact:computer-use/final-report.md',
    ];
    const packageResult = {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      reason: 'package returned mixed final refs',
      finalArtifactRef: rejectedRefs[0],
      finalArtifactRefs: [...rejectedRefs, validRef],
      finalObservationRef: `.sciforge/vision-runs/${runId}/after.png`,
      metrics: { actionCount: 1, stepCount: 1, observationCount: 1 },
      steps: [{
        status: 'done',
        beforeRef: `.sciforge/vision-runs/${runId}/before.png`,
        afterRef: `.sciforge/vision-runs/${runId}/after.png`,
        action: { kind: 'click', target: { description: 'save deck button' } },
        verification: {
          ok: true,
          done: true,
          reason: 'mixed verifier refs',
          metadata: {
            finalArtifactRefs: [...rejectedRefs, validRef],
            evidenceRefs: [`.sciforge/vision-runs/${runId}/after.png`],
            semanticVerifier: {
              finalArtifactRefs: [nestedBogusRef],
            },
          },
        },
      }],
    };

    const payload = await withInjectedComputerUsePackageResult(packageResult, () => runComputerUsePackageBridge({
      skillDomain: 'knowledge',
      prompt: '/computer-use run create a visible briefing deck artifact',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, workspace, baseConfig(runId, []), {}));

    assert.equal(payload.executionUnits[0]?.status, 'done');
    const runDir = join(workspace, `.sciforge/vision-runs/${runId}`);
    const trace = JSON.parse(await readFile(join(runDir, 'vision-trace.json'), 'utf8')) as Record<string, any>;
    assert.equal(trace.finalArtifactRef, validRef);
    assert.deepEqual(trace.finalArtifactRefs, [validRef]);
    assert.deepEqual(trace.artifactRefs, [validRef]);
    for (const ref of rejectedRefs) {
      assert.ok(!trace.artifactRefs.includes(ref), `rejected ref was promoted: ${ref}`);
      assert.ok(!trace.finalArtifactRefs.includes(ref), `rejected final ref was promoted: ${ref}`);
    }
    assert.ok(!trace.artifactRefs.includes(nestedBogusRef), `nested final ref was promoted: ${nestedBogusRef}`);
    assert.ok(!trace.finalArtifactRefs.includes(nestedBogusRef), `nested final ref was promoted: ${nestedBogusRef}`);

    const directoryListing = JSON.parse(await readFile(join(runDir, 'directory-listing.json'), 'utf8')) as Record<string, any>;
    assert.deepEqual(directoryListing.finalArtifactRefs, [validRef]);
    const guiPresent = JSON.parse(await readFile(join(runDir, 'gui-present.json'), 'utf8')) as Record<string, any>;
    assert.ok(guiPresent.payload.artifactRefs.includes(validRef));
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
          acceptanceProgress: {
            schemaVersion: 'sciforge.computer-use-long.acceptance-progress.v1',
            round: 1,
            roundCount: 1,
            remainingRounds: 0,
            suggestedCurrentRoundActionTarget: 1,
            suggestedCurrentRoundNonWaitActionTarget: 1,
          },
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
    assert.match(traceText, new RegExp(visionSenseModelRouterCapabilities.computerUsePlanner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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
    config.windowTarget = {
      enabled: true,
      required: true,
      mode: 'app-window',
      appName: 'Validation Workspace',
      title: 'Search validation',
      virtualWindowId: 'window-ledger-quota',
      coordinateSpace: 'window-local',
      inputIsolation: 'require-focused-target',
    };
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
    const guiPresent = actions.find((action) => action.port === 'gui.present');
    assert.ok(guiPresent);
    assert.ok(actions.some((action) => action.port === 'gui.ask_user'));
    assert.deepEqual((guiPresent.payload as Record<string, unknown>).blockedManifestRefs, ['.sciforge/vision-runs/cu-package-bridge-approval/blocked-manifest.json']);
    assert.deepEqual((guiPresent.payload as Record<string, unknown>).repairHintRefs, ['.sciforge/vision-runs/cu-package-bridge-approval/repair-hint.json']);
    assert.deepEqual((guiPresent.payload as Record<string, unknown>).continuationRequestRefs, ['.sciforge/vision-runs/cu-package-bridge-approval/continuation-request.json']);
    assert.deepEqual((guiPresent.payload as Record<string, unknown>).runTaskChainRefs, ['.sciforge/vision-runs/cu-package-bridge-approval/tui-host-run-task-chain.json']);
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
    const approvalDecision = await readJsonEvidence(join(workspace, '.sciforge/vision-runs/cu-package-bridge-confirmed/approval-decision.json'));
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
    assert.equal(approvalDecision.schemaVersion, 'sciforge.computer-use.approval-decision-sidecar.v1');
    assert.equal(approvalDecision.status, 'confirmed');
    assert.equal(approvalDecision.decision, 'approved');
    assert.equal(approvalDecision.approvalRef, confirmedRequest.approvalRef);
    assert.equal(approvalDecision.confirmedRequestRef, '.sciforge/vision-runs/cu-package-bridge-confirmed/confirmed-request.json');
    assert.equal(approvalDecision.deniedExecuted, false);
    assert.equal(approvalDecision.packageMayCallGuiDirectly, false);
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

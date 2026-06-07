import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateCuNextLiveAcceptanceTaskEvidence } from './live-acceptance-validator.js';
import { hasRequiredCuTuiHostChain } from './user-acceptance-manifest.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

type PackageJson = {
  scripts?: Record<string, string>;
};

const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as PackageJson;

const pythonProductPath = /\bpytest\b|\bpython3?\b.*\bsciforge_computer_use\b|\bPYTHONPATH=.*sciforge_computer_use\b/i;
const retiredVirtualAppScreenPath = /VirtualAppScreen|virtual-app-screen|native-virtual-app-screen/i;

function npmRunTargets(command: string): string[] {
  return Array.from(command.matchAll(/\bnpm\s+run\s+([^\s&|;]+)/g), (match) => match[1].replace(/["']/g, ''));
}

function collectReachableScripts(start: string, scripts: Record<string, string>, seen = new Set<string>()): Set<string> {
  if (seen.has(start)) {
    return seen;
  }
  seen.add(start);
  const command = scripts[start] ?? '';
  for (const target of npmRunTargets(command)) {
    if (scripts[target]) {
      collectReachableScripts(target, scripts, seen);
    }
  }
  return seen;
}

test('default Computer Use package checks stay on the TypeScript product path', () => {
  const scripts = packageJson.scripts ?? {};
  const defaultRoots = ['test', 'verify', 'verify:fast', 'verify:single-agent-final', 'verify:single-agent-release', 'smoke:all', 'packages:check'];
  const reachable = new Set(defaultRoots.flatMap((script) => Array.from(collectReachableScripts(script, scripts))));
  const offenders = Array.from(reachable)
    .map((script) => [script, scripts[script] ?? ''] as const)
    .filter(([, command]) => pythonProductPath.test(command) || retiredVirtualAppScreenPath.test(command));

  assert.deepEqual(offenders, []);
});

test('Computer Use product-named scripts do not route through retired Python or VirtualAppScreen paths', () => {
  const scripts = packageJson.scripts ?? {};
  const offenders = Object.entries(scripts).filter(([script, command]) => {
    const isComputerUseProductAlias = /computer-use|cu-next|cu-l3/i.test(script);
    return isComputerUseProductAlias && (pythonProductPath.test(command) || retiredVirtualAppScreenPath.test(command));
  });

  assert.deepEqual(offenders, []);
});

test('retired Python and VirtualAppScreen scripts are absent', () => {
  const scripts = packageJson.scripts ?? {};
  const offenders = Object.entries(scripts).filter(([script, command]) => {
    return pythonProductPath.test(command) || retiredVirtualAppScreenPath.test(`${script} ${command}`);
  });

  assert.deepEqual(offenders, []);
});

test('action-provider manifest advertises a TypeScript product entrypoint only', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'action-provider.manifest.json'), 'utf8'),
  ) as {
    entrypoint?: Record<string, unknown>;
    publicSurfaceParity?: {
      nativeProductGatePolicy?: Record<string, unknown>;
      claimLimit?: string;
    };
  };

  assert.equal(manifest.entrypoint?.type, 'typescript-package');
  assert.match(String(manifest.entrypoint?.module), /\.ts$/);
  assert.equal('legacyPythonImplementation' in manifest, false);
  assert.doesNotMatch(JSON.stringify(manifest.entrypoint), pythonProductPath);
  assert.doesNotMatch(JSON.stringify(manifest.publicSurfaceParity?.nativeProductGatePolicy ?? {}), retiredVirtualAppScreenPath);
  assert.doesNotMatch(String(manifest.publicSurfaceParity?.claimLimit ?? ''), /active Computer Use product gate.*virtual-app-screen/i);
});

test('primitive service exposes no legacy procedure host port escape hatch', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'index.ts'), 'utf8');

  assert.doesNotMatch(source, /\brunProcedure\?\s*\(/);
});

test('manifest does not advertise run_procedure as a host port', () => {
  const manifestText = readFileSync(resolve(import.meta.dirname, 'action-provider.manifest.json'), 'utf8');

  assert.doesNotMatch(manifestText, /runProcedure\/control host port/i);
  assert.doesNotMatch(manifestText, /register bind\/observe\/act\/runProcedure\/control/i);
});

test('manifest act action schema documents action-specific required fields', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'action-provider.manifest.json'), 'utf8'),
  ) as {
    actionSchema?: {
      inputShape?: {
        oneOf?: Array<{ properties?: Record<string, { const?: string; oneOf?: unknown[] }> }>;
      };
    };
  };
  const actInput = manifest.actionSchema?.inputShape?.oneOf?.find((branch) =>
    branch.properties?.schemaVersion?.const === 'sciforge.computer-use.act-input.v1',
  );
  const action = actInput?.properties?.action as { oneOf?: unknown[] } | undefined;

  assert.equal(action?.oneOf?.length, 8);
});

test('runtime package bridge request helper does not expose runTask as its boundary name', () => {
  const source = readFileSync(resolve(repoRoot, 'src/runtime/computer-use/package-bridge-request.ts'), 'utf8');

  assert.doesNotMatch(source, /RUN_TASK_BOUNDARY|RunTaskInvocation|materializePackageBridgeRunTaskInvocation|computer_use\.runTask/);
});

test('user acceptance host chain requires primitive session evidence instead of runTask', () => {
  assert.equal(hasRequiredCuTuiHostChain([
    { id: 'chat-origin', kind: 'sciForge-chat-origin', status: 'present', requestRef: '.sciforge/vision-runs/product-smoke/computer-use-request.json' },
    { id: 'computer-use-primitive-session', kind: 'computer-use-primitive-session', status: 'present', sessionRef: 'computer-use:session:product-smoke', primitiveTraceRef: '.sciforge/vision-runs/product-smoke/primitive-trace.json' },
    { id: 'computer-use-action-provider', kind: 'computer-use-action-provider', status: 'present', toolPayloadRef: '.sciforge/vision-runs/product-smoke/tool-payload.json' },
  ]), true);
  const legacyRunTaskChain = [
    { id: 'chat-origin', kind: 'sciForge-chat-origin', status: 'present', requestRef: '.sciforge/vision-runs/product-smoke/computer-use-request.json' },
    { id: 'tui-host-runTask', kind: 'tui-host-runTask', status: 'present', requestRef: '.sciforge/vision-runs/product-smoke/computer-use-request.json', hostPortsRef: '.sciforge/vision-runs/product-smoke/host-ports.json' },
    { id: 'computer-use-action-provider', kind: 'computer-use-action-provider', status: 'present', toolPayloadRef: '.sciforge/vision-runs/product-smoke/tool-payload.json' },
  ];
  assert.equal(hasRequiredCuTuiHostChain(
    legacyRunTaskChain as unknown as Parameters<typeof hasRequiredCuTuiHostChain>[0],
  ), false);
});

test('product-smoke classification fail-closes without independent action ledger records', () => {
  const evidence = productSmokeEvidenceWithoutActionLedger();
  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-01',
    evidence,
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.requiredRefs, false);
  assert.ok(
    result.issues.some((issue) => (
      issue.id === 'missing-evidence-ledger-trace'
      && /evidence ledger/i.test(issue.reason)
    )),
  );
  assert.equal(
    result.issues.some((issue) => issue.path === 'productPathClassification.sciforgeComputerUseRunTaskRef'),
    false,
  );
});

test('package diagnostic classification cannot satisfy product-smoke live acceptance', () => {
  const evidence = productSmokeEvidenceWithoutActionLedger();
  const classification = evidence.productPathClassification as Record<string, unknown>;
  classification.tier = 'package-diagnostic';
  classification.diagnosticOnly = true;
  classification.packageDiagnosticOnly = true;

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-01',
    evidence,
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.requiredRefs, false);
  assert.ok(
    result.issues.some((issue) => (
      issue.id === 'invalid-product-path-classification'
      && issue.path === 'productPathClassification.tier'
      && /package diagnostic.*not product smoke/i.test(issue.reason)
    )),
  );
  assert.ok(
    result.issues.some((issue) => (
      issue.id === 'invalid-product-path-classification'
      && issue.path === 'productPathClassification.diagnosticOnly'
      && /package diagnostic evidence must not be accepted/i.test(issue.reason)
    )),
  );
});

test('artifact completion rejects missing validation and existence-only verifier support', () => {
  const evidence = productSmokeEvidenceWithoutActionLedger();
  delete evidence.artifactValidationRef;
  delete evidence.artifactValidation;
  const verifierVerdict = evidence.verifierVerdict as Record<string, unknown>;
  delete verifierVerdict.artifactValidationRef;
  delete verifierVerdict.savedByActionRef;
  verifierVerdict.sourceRefs = [];
  const action = (evidence.mutatingActions as Record<string, unknown>[])[0];
  action.artifactRefs = [];

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-01',
    evidence,
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.id === 'missing-artifact-validation-ref'));
  assert.ok(result.issues.some((issue) => issue.id === 'missing-artifact-action-causality'));
  assert.ok(result.issues.some((issue) => issue.id === 'invalid-artifact-verifier-support'));
});

test('artifact completion rejects artifactValidationRef without readable refRecord', () => {
  const evidence = productSmokeEvidenceWithoutActionLedger();

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-01',
    evidence,
    refRecords: {},
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => (
      issue.id === 'invalid-artifact-validation-ref'
      && /readable validation record/i.test(issue.reason)
    )),
  );
});

test('artifact completion rejects content binding satisfied only by finalArtifactRef', () => {
  const evidence = productSmokeEvidenceWithoutActionLedger();
  const finalArtifactRef = evidence.finalArtifactRef as string;
  const artifactValidationRef = evidence.artifactValidationRef as string;
  const artifactValidation = evidence.artifactValidation as Record<string, unknown>;
  const verifierVerdict = evidence.verifierVerdict as Record<string, unknown>;
  delete artifactValidation.contentRefs;
  delete verifierVerdict.contentRefs;

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-01',
    evidence,
    refRecords: {
      [artifactValidationRef]: {
        status: 'passed',
        finalArtifactRef,
        artifactRef: finalArtifactRef,
        sourceRefs: ['.sciforge/vision-runs/cu-next-01-product-smoke/literature-refs.json'],
        sha256: '0'.repeat(64),
        bytes: 1024,
        metadata: { slideCount: 8 },
        format: 'pptx',
        validator: 'sciforge-pptx-artifact-contract-validator',
      },
    },
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => (
      issue.id === 'invalid-artifact-verifier-support'
      && /content refs/i.test(issue.reason)
    )),
  );
});

test('artifact completion rejects validation records bound to a different content ref', () => {
  const evidence = productSmokeEvidenceWithoutActionLedger();
  const finalArtifactRef = evidence.finalArtifactRef as string;
  const artifactValidationRef = evidence.artifactValidationRef as string;
  const artifactValidation = evidence.artifactValidation as Record<string, unknown>;
  const unrelatedContentRef = finalArtifactRef.replace(/\/[^/]+$/, '/unrelated-deck.pptx');

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-01',
    evidence,
    refRecords: {
      [artifactValidationRef]: {
        status: 'passed',
        finalArtifactRef,
        artifactRef: finalArtifactRef,
        contentRefs: [unrelatedContentRef],
        sourceRefs: artifactValidation.sourceRefs,
        sha256: '0'.repeat(64),
        bytes: 1024,
        metadata: { slideCount: 8 },
        format: 'pptx',
        validator: 'sciforge-pptx-artifact-contract-validator',
      },
    },
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => (
      issue.id === 'invalid-artifact-validation-ref'
      && /content refs/i.test(issue.reason)
    )),
  );
});

test('artifact completion rejects diagnostic validation records for product smoke', () => {
  const evidence = productSmokeEvidenceWithoutActionLedger();
  const finalArtifactRef = evidence.finalArtifactRef as string;
  const artifactValidationRef = evidence.artifactValidationRef as string;
  const artifactValidation = evidence.artifactValidation as Record<string, unknown>;

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-01',
    evidence,
    refRecords: {
      [artifactValidationRef]: {
        status: 'passed',
        diagnosticOnly: true,
        productAcceptanceEvidence: false,
        finalArtifactRef,
        artifactRef: finalArtifactRef,
        contentRefs: [finalArtifactRef],
        sourceRefs: artifactValidation.sourceRefs,
        sha256: '0'.repeat(64),
        bytes: 1024,
        metadata: { validatorScope: 'contract-level' },
        format: 'pptx',
        validator: 'sciforge-generic-pptx-artifact-contract-validator',
      },
    },
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => (
      issue.id === 'invalid-artifact-validation-ref'
      && /diagnostic/i.test(issue.reason)
    )),
  );
});

test('artifact completion rejects fixture validation records for product smoke', () => {
  const evidence = productSmokeEvidenceWithoutActionLedger();
  const finalArtifactRef = evidence.finalArtifactRef as string;
  const artifactValidationRef = evidence.artifactValidationRef as string;
  const artifactValidation = evidence.artifactValidation as Record<string, unknown>;

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-01',
    evidence,
    refRecords: {
      [artifactValidationRef]: {
        schemaVersion: 'sciforge.computer-use.fixture-artifact-validation.v1',
        status: 'passed',
        ok: true,
        finalArtifactRef,
        artifactRef: finalArtifactRef,
        contentRefs: [finalArtifactRef],
        sourceRefs: artifactValidation.sourceRefs,
        sha256: '0'.repeat(64),
        bytes: 1024,
        metadata: {
          generatedBy: 'cu-next-runner-fixture',
          validationScope: 'fixture-contract-record',
        },
        format: 'pptx',
        validator: 'sciforge-generic-pptx-artifact-contract-validator',
      },
    },
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => (
      issue.id === 'invalid-artifact-validation-ref'
      && /fixture/i.test(issue.reason)
    )),
  );
});

test('artifact completion rejects unresolved verifier uncertainty', () => {
  const evidence = productSmokeEvidenceWithoutActionLedger();
  const verifierVerdict = evidence.verifierVerdict as Record<string, unknown>;
  verifierVerdict.blockingUncertainty = 'verifier could not confirm source-backed slide content';

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-01',
    evidence,
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => (
      issue.id === 'blocking-artifact-uncertainty'
      && /Blocking uncertainty must be resolved/i.test(issue.reason)
    )),
  );
});

function productSmokeEvidenceWithoutActionLedger(): Record<string, unknown> {
  const runId = 'cu-next-01-product-smoke';
  const ref = (name: string) => `.sciforge/vision-runs/${runId}/${name}`;
  const sessionRef = ref('computer-use-session.json');
  const finalArtifactRef = ref('literature-briefing-deck.pptx');
  const screenMain = `${runId}-screen-main`;
  const screenPreview = `${runId}-screen-preview`;
  const windowMain = `${runId}-window-main`;
  const windowWriter = `${runId}-window-writer`;
  const actorAgent = `${runId}-actor-agent`;
  const cursorAgent = `${runId}-cursor-agent`;
  const actorWriter = `${runId}-actor-writer`;
  const cursorWriter = `${runId}-cursor-writer`;
  const actorPreview = `${runId}-actor-preview`;
  const cursorPreview = `${runId}-cursor-preview`;
  const chatOrigin = {
    schemaVersion: 'sciforge.computer-use.chat-origin.v1',
    handoffSource: 'ui-chat',
    entrypoint: 'sciforge-chat',
    terminalEquivalentText: true,
  };

  return {
    schemaVersion: 'sciforge.computer-use.user-acceptance-manifest.v1',
    runId,
    taskId: 'CU-NEXT-01',
    scenarioId: 'CU-LONG-001',
    cuNextTask: {
      taskId: 'CU-NEXT-01',
      primaryScenarioId: 'CU-LONG-001',
      longScenarioIds: ['CU-LONG-001', 'CU-LONG-002'],
    },
    createdAt: '2026-06-06T00:00:00.000Z',
    status: 'multi-app-workflow-passed',
    taskText: 'CU-NEXT-01 literature to briefing deck',
    level: 'L3',
    appWorkflow: {
      kind: 'multi-app-workflow',
      apps: ['Browser', 'LibreOffice Impress', 'Finder'],
      windowSwitchTraceRefs: [ref('window-switch-trace.json')],
    },
    productPathClassification: {
      schemaVersion: 'sciforge.computer-use.product-path-classification.v1',
      tier: 'product-smoke',
      entrypoint: 'codex-app-server/native-plugin',
      hops: ['codex-app-server', 'codex-native-plugin', 'sciforge-computer-use', 'native-multi-screen-sidecar'],
      appServerRunRef: ref('codex-app-server-run.json'),
      nativePluginInvocationRef: ref('native-plugin-invocation.json'),
      sciforgeComputerUsePrimitiveTraceRef: ref('primitive-trace.json'),
      platformSidecarIsolationReportRef: ref('platform-sidecar-isolation-report.json'),
      currentBundleRef: `.sciforge/vision-runs/${runId}`,
      currentBundleOnly: true,
      diagnosticOnly: false,
      packageDiagnosticOnly: false,
    },
    actionLedgerRef: ref('action-ledger.json'),
    evidenceIndexRef: ref('evidence-index.json'),
    userControlPlane: {
      schemaVersion: 'sciforge.computer-use.user-control-plane.v1',
      status: 'present',
      sessionPermissionRef: ref('session-permission.json'),
      allowedAppRefs: [ref('allowed-apps.json')],
      allowedWindowRefs: [ref('allowed-windows.json')],
      forbiddenAppRefs: [ref('forbidden-apps.json')],
      inputModalityPolicyRef: ref('input-modality-policy.json'),
      riskPreviewRef: ref('risk-preview.json'),
      dataVisibilityRef: ref('data-visibility.json'),
      stopRef: ref('stop-cancel-lease.json'),
      approvalMode: 'bounded-low-risk',
    },
    platformSidecarIsolationReport: {
      schemaVersion: 'sciforge.computer-use.platform-sidecar-isolation-report.v1',
      status: 'passed',
      backendKind: 'native-multi-screen-sidecar',
      sidecarKind: 'native-multi-screen-sidecar',
      reportRef: ref('platform-sidecar-isolation-report.json'),
      captureRef: ref('sidecar-capture.json'),
      stateRef: ref('sidecar-state.json'),
      preflightRef: ref('sidecar-preflight.json'),
      executorAdapterRef: ref('sidecar-executor-adapter.json'),
      isolationFlags: {
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        sidecarDoesPlanning: false,
        sidecarDoesCompletion: false,
      },
    },
    virtualDisplayGroup: {
      displayGroupId: `${runId}-display-group`,
      ref: ref('virtual-display-group.json'),
      screens: [
        { screenId: screenMain, ref: ref('virtual-screen-main.json') },
        { screenId: screenPreview, ref: ref('virtual-screen-preview.json') },
      ],
    },
    actorCursorProvenance: [
      { actorId: actorAgent, cursorId: cursorAgent, screenId: screenMain, actorCursorLogRef: ref('actor-cursors.jsonl') },
      { actorId: actorWriter, cursorId: cursorWriter, screenId: screenMain, actorCursorLogRef: ref('actor-cursors.jsonl') },
      { actorId: actorPreview, cursorId: cursorPreview, screenId: screenPreview, actorCursorLogRef: ref('actor-cursors.jsonl') },
    ],
    cursorEvents: [
      { kind: 'move', actorId: actorAgent, cursorId: cursorAgent, screenId: screenMain, cursorEventLogRef: ref('actor-cursors.jsonl'), readOnlyCursorEvent: true, mutatingGuiAction: false },
      { kind: 'point', actorId: actorWriter, cursorId: cursorWriter, screenId: screenMain, cursorEventLogRef: ref('actor-cursors.jsonl'), readOnlyCursorEvent: true, mutatingGuiAction: false },
      { kind: 'annotate', actorId: actorPreview, cursorId: cursorPreview, screenId: screenPreview, cursorEventLogRef: ref('actor-cursors.jsonl'), readOnlyCursorEvent: true, mutatingGuiAction: false },
    ],
    antiShortcutGuard: { status: 'passed', rejectedClaims: [] },
    artifactValidationRef: ref('artifact-validation.json'),
    artifactValidation: {
      artifactValidationRef: ref('artifact-validation.json'),
      status: 'passed',
      finalArtifactRef,
      artifactRef: finalArtifactRef,
      contentRefs: [finalArtifactRef],
      sourceRefs: [ref('literature-refs.json')],
      sha256: '0'.repeat(64),
      bytes: 1024,
      format: 'pptx',
      validator: 'sciforge-pptx-artifact-contract-validator',
    },
    tuiHostChain: [
      { id: 'chat-origin', kind: 'sciForge-chat-origin', status: 'present', requestRef: ref('computer-use-request.json'), origin: chatOrigin },
      { id: 'computer-use-primitive-session', kind: 'computer-use-primitive-session', status: 'present', sessionRef: 'computer-use:session:product-smoke', primitiveTraceRef: ref('primitive-trace.json') },
      { id: 'computer-use-action-provider', kind: 'computer-use-action-provider', status: 'present', toolPayloadRef: ref('tool-payload.json') },
      { id: 'gui-present', kind: 'gui.present', status: 'present', recordRef: ref('gui-present.json') },
    ],
    screenshotRefs: { before: [ref('before.png')], after: [ref('after.png')] },
    focusCropRefs: [ref('focus-crop.png')],
    groundingDiagnosticsRefs: [ref('grounding-diagnostics.json')],
    executorLease: {
      status: 'present',
      ref: ref('executor-lease.json'),
      owner: 'native-platform-sidecar',
      screenId: screenMain,
      windowId: windowMain,
      actorId: actorAgent,
      cursorId: cursorAgent,
      leaseScope: { kind: 'window-local', screenId: screenMain, windowId: windowMain },
    },
    observeBeforeMutate: {
      schemaVersion: 'sciforge.computer-use.observe-before-mutate.v1',
      status: 'passed',
      currentAppStateRef: ref('current-app-state.json'),
      currentScreenshotRef: ref('before.png'),
      stateSnapshotRef: ref('state-snapshot.json'),
      freshnessCheckRef: ref('freshness-check.json'),
      browserRuntimeObservationRef: ref('browser-dom-ax-observation.json'),
    },
    browserRuntimeDomAxObservation: {
      schemaVersion: 'sciforge.computer-use.browser-runtime-dom-ax-observation.v1',
      trust: 'untrusted-page-observation',
      refsFirst: true,
      currentBundleOnly: true,
      screenId: screenMain,
      windowId: windowMain,
      observationRef: ref('browser-dom-ax-observation.json'),
      visibleDomRef: ref('browser-visible-dom.json'),
      accessibilitySnapshotRef: ref('browser-accessibility.json'),
      playwrightEvaluateRef: ref('browser-playwright-evaluate.json'),
      pageQueryRef: ref('browser-page-query.json'),
      stableRefs: [ref('browser-stable-refs.json')],
      groundingHintRefs: [ref('browser-grounding-hints.json')],
      observationUse: 'observe-before-mutate-hint',
      executorLeaseSubstitute: false,
      guiActionSubstitute: false,
      artifactCausalitySubstitute: false,
      completionEvidenceEligible: false,
      userLevelCompletionSubstitute: false,
    },
    actionProposals: [
      { proposalId: `${runId}-proposal-main`, proposalRef: ref('proposal-main.json'), actorId: actorAgent, cursorId: cursorAgent, leaseScope: { kind: 'window-local', screenId: screenMain, windowId: windowMain } },
      { proposalId: `${runId}-proposal-writer`, proposalRef: ref('proposal-writer.json'), actorId: actorWriter, cursorId: cursorWriter, leaseScope: { kind: 'window-local', screenId: screenMain, windowId: windowWriter } },
      { proposalId: `${runId}-proposal-preview`, proposalRef: ref('proposal-preview.json'), actorId: actorPreview, cursorId: cursorPreview, leaseScope: { kind: 'screen-global', screenId: screenPreview } },
    ],
    executorQueue: [
      { queueId: `${runId}-window-local-queue`, screenId: screenMain, queueKind: 'window-local', leaseOwnerRefs: [ref('executor-lease.json')] },
      { queueId: `${runId}-screen-global-queue`, screenId: screenPreview, queueKind: 'screen-global', leaseOwnerRefs: [ref('screen-global-lease.json')] },
    ],
    mutatingActions: [
      {
        actionKind: 'click',
        screenId: screenMain,
        windowId: windowMain,
        actorId: actorAgent,
        cursorId: cursorAgent,
        leaseId: `${runId}-lease-window-main`,
        leaseScope: { kind: 'window-local', screenId: screenMain, windowId: windowMain },
        target: { scope: 'window', screenId: screenMain, windowId: windowMain, bounds: { x: 10, y: 12, width: 80, height: 28 } },
        beforeEvidenceRefs: [ref('before.png')],
        afterEvidenceRefs: [ref('after.png')],
        inputIntentRef: ref('input-intent-click.json'),
        providerAdapterRef: ref('sidecar-executor-adapter.json'),
        currentAppStateRef: ref('current-app-state.json'),
        currentScreenshotRef: ref('before.png'),
        stateSnapshotRef: ref('state-snapshot.json'),
        freshnessCheckRef: ref('freshness-check.json'),
        groundingRefs: [ref('grounding-diagnostics.json'), ref('browser-grounding-hints.json')],
        executorEventRef: ref('executor-event.json'),
        verificationRefs: [ref('verifier-verdict.json')],
        artifactRefs: [finalArtifactRef],
      },
    ],
    replayBundle: {
      ref: ref('replay-bundle.json'),
      frames: [
        { screenId: screenMain, screenshotRef: ref('before.png'), cursorOverlayRefs: [ref('cursor-overlay-before.json')] },
        { screenId: screenPreview, screenshotRef: ref('preview-before.png'), cursorOverlayRefs: [ref('cursor-overlay-preview-before.json')] },
      ],
      cursorOverlayRefs: [ref('cursor-overlay-before.json'), ref('cursor-overlay-preview-before.json')],
      leaseOwnerRefs: [ref('executor-lease.json'), ref('screen-global-lease.json')],
      beforeEvidenceRefs: [ref('before.png'), ref('preview-before.png')],
      afterEvidenceRefs: [ref('after.png'), ref('preview-after.png')],
    },
    finalArtifactRef,
    finalVisibleScreenshotRef: ref('final-visible.png'),
    verifierVerdict: {
      status: 'passed',
      verdict: 'multi-app-workflow-passed',
      ref: ref('verifier-verdict.json'),
      contentRefs: [finalArtifactRef],
      sourceRefs: [ref('literature-refs.json')],
      savedByActionRef: ref('executor-event.json'),
      artifactValidationRef: ref('artifact-validation.json'),
    },
    guiPresent: {
      status: 'present',
      recordRef: ref('gui-present.json'),
      payloadRef: ref('gui-present-payload.json'),
      displayedRefs: [finalArtifactRef, ref('after.png'), ref('replay-bundle.json')],
      sessionRefs: [sessionRef],
    },
    evidenceClaims: [
      { id: 'chat-origin', kind: 'sciForge-chat-origin', status: 'present', ref: ref('computer-use-request.json'), refs: [ref('computer-use-request.json')], sessionRefs: [sessionRef], origin: chatOrigin },
      { id: 'real-computer-use', kind: 'real-computer-use', refs: [ref('vision-trace.json')], sessionRefs: [sessionRef] },
      { id: 'independent-input-adapter', kind: 'independent-input-adapter', refs: [ref('executor-event.json')], sessionRefs: [sessionRef] },
      { id: 'gui-present-record', kind: 'gui-present-record', ref: ref('gui-present.json'), refs: [ref('gui-present.json')], artifactRefs: [finalArtifactRef] },
    ],
    evidenceMarkers: [
      {
        kind: 'briefing-deck',
        deckRef: finalArtifactRef,
        sourceRefs: [ref('literature-refs.json')],
        outlineRef: ref('deck-outline.json'),
        slideCount: 8,
      },
    ],
  };
}
